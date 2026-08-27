/**
 * Sam Messages — drop-in message intake + team routing (does not replace desk.js or desk-nlu.js).
 *
 * WIRE (same pattern as desk-nlu.js — do not deploy; public site stays closed):
 *
 *   <script src="./sam-voice.js"></script>
 *   <script src="./desk-nlu.js"></script>
 *   <script src="./desk-messages.js"></script>   <-- this file, after desk-nlu
 *   <script src="./sam-states.js"></script>
 *   <script src="./desk.js"></script>
 *
 * desk.js changes (one extra branch at the top of handle()):
 *
 *   const msgSession = SamMessages.createSession();
 *   async handle(text) {
 *     if (SamMessages.active(msgSession) || SamMessages.wants(text)) {
 *       const turn = SamMessages.turn(msgSession, text);
 *       speak(turn.reply);
 *       if (turn.action === "submit_message") {
 *         const r = await fetch("/api/message", {
 *           method: "POST",
 *           headers: { "content-type": "application/json" },
 *           body: JSON.stringify(turn.payload),
 *         });
 *         speak(r.ok ? SamMessages.LINES.sent : SamMessages.LINES.send_failed);
 *       }
 *       return;
 *     }
 *     // ...existing SamNLU.turn(...) path unchanged
 *   }
 *
 * Voice rules (SAM.md): she is Sam, receptionist. Never "the desk". Never a
 * person's name in her mouth — she routes to "the right person" / a team, and
 * the actual recipient is resolved server-side in /api/message.
 */
(function (root) {
  "use strict";

  // ---- team routing (front-end knows departments only, never names) -------
  // key: department id · label: what Sam may say · hints: keyword scoring
  const TEAMS = {
    sales: {
      label: "the person who runs discovery calls",
      hints: [
        "price", "prices", "pricing", "cost", "quote", "package", "packages",
        "buy", "purchase", "discovery", "audit", "consult", "sales", "demo",
      ],
    },
    technical: {
      label: "our engineer",
      hints: [
        "install", "hardware", "tower", "mini", "server", "gpu", "model",
        "ollama", "local ai", "setup", "config", "broken", "bug", "error",
        "not working", "integration", "api", "technical", "support",
      ],
    },
    billing: {
      label: "the billing team",
      hints: [
        "invoice", "bill", "billing", "payment", "paid", "refund", "receipt",
        "charge", "charged", "account", "overcharged",
      ],
    },
    privacy: {
      label: "the person who handles privacy",
      hints: [
        "privacy", "data", "gdpr", "delete my", "personal information",
        "confidential", "nda", "legal", "terms",
      ],
    },
    general: { label: "the right person", hints: [] },
  };

  const URGENT = /\b(urgent|asap|emergency|right away|immediately|today if possible|time.?sensitive)\b/i;

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

  // ---- intent: does this utterance want a message taken / forwarded? ------
  const WANT_RE = new RegExp(
    [
      "\\bleave (him |her |them )?a message\\b",
      "\\btake a message\\b",
      "\\bpass (this|it|that|a message) (along|on)\\b",
      "\\bforward (this|it|that|a message)\\b",
      "\\bget a message to\\b",
      "\\bhave (someone|somebody) (call|email|ring|contact|get back to) me\\b",
      "\\b(call|ring|phone|email) me back\\b",
      "\\bget back to me\\b",
      "\\btell (the team|whoever|someone|somebody)\\b",
      "\\btalk to (someone|somebody|a person|a human) about\\b",
      "\\bspeak (to|with) (someone|somebody|a person|a human)\\b",
      "\\breach (someone|somebody|the team)\\b",
    ].join("|"),
    "i"
  );

  const YES_RE = /^\s*(y|yes|yeah|yep|sure|correct|right|that's right|send it|go ahead|please do|ok(ay)?)\b/i;
  const NO_RE = /^\s*(n|no|nope|nah|cancel|never ?mind|forget it|don't|stop)\b/i;

  const LINES = {
    start:
      "Of course. Tell me the message and I will get it to the right person. What should I pass along?",
    need_more:
      "Go ahead — what would you like me to pass along?",
    need_name: "And who shall I say it is from?",
    need_contact:
      "Where can they reach you — an email or a phone number?",
    bad_contact:
      "I did not catch a working email or phone number there. Could you give me one of those?",
    confirm_prefix: "Let me read that back. ",
    confirm_suffix: " Shall I send it?",
    sent: "Done. Your message is with {team}. They will reach you at the contact you gave me.",
    send_failed:
      "I could not file that just now. You can email us directly and it will reach the same people.",
    cancelled: "No problem, I will drop that. Anything else — prices, privacy, or a free thirty minutes?",
    already_sent: "That message already went through. Anything else I can do?",
  };

  // ---- department scoring --------------------------------------------------
  function route(text) {
    const t = String(text || "").toLowerCase();
    let best = "general";
    let bestScore = 0;
    for (const [id, team] of Object.entries(TEAMS)) {
      let score = 0;
      for (const hint of team.hints) if (t.includes(hint)) score += 1;
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  }

  function teamLabel(id) {
    return (TEAMS[id] || TEAMS.general).label;
  }

  // Strip the "take a message" framing so the stored message is the payload,
  // e.g. "can you tell the team the invoice from July is wrong" -> "the invoice from July is wrong"
  function extractMessage(text) {
    let t = String(text || "").trim();
    t = t.replace(
      /^(hi|hey|hello|please|can you|could you|would you|i('|’)?d like( you)? to|i want( you)? to)\s+/i,
      ""
    );
    t = t.replace(
      /^(leave (him |her |them )?a message( that| saying| about)?|take a message( that| saying| about)?|pass (this|it|a message) (along|on)( that| saying| about)?|forward (this|a message)( that| saying| about)?|tell (the team|whoever|someone|somebody)( that)?|have (someone|somebody) know( that)?)\s*/i,
      ""
    );
    t = t.replace(
      /^(have (someone|somebody) (call|email|ring|contact|get back to) me( back)?|(call|ring|phone|email) me back|get back to me)( about| regarding| re:?| that| saying)?\s*/i,
      ""
    );
    return t.replace(/^[:,\s-]+/, "").trim();
  }

  function extractContact(text) {
    const email = String(text || "").match(EMAIL_RE);
    if (email) return { kind: "email", value: email[0] };
    const phone = String(text || "").match(PHONE_RE);
    if (phone) return { kind: "phone", value: phone[1].trim() };
    return null;
  }

  function extractName(text) {
    let t = String(text || "").trim();
    t = t.replace(/^(it'?s|it is|this is|i am|i'?m|my name is|name'?s)\s+/i, "");
    return t.replace(/[.!?]+$/, "").trim().slice(0, 80);
  }

  // ---- session -------------------------------------------------------------
  function createSession() {
    return {
      state: "idle", // idle | message | name | contact | confirm | done
      message: "",
      name: "",
      contact: null, // {kind, value}
      team: "general",
      urgent: false,
    };
  }

  function active(session) {
    return session && session.state !== "idle" && session.state !== "done";
  }

  function wants(text) {
    return WANT_RE.test(String(text || ""));
  }

  function confirmLine(s) {
    const from = s.name ? "From " + s.name + ", " : "";
    const reach = s.contact ? "reachable at " + s.contact.value + ". " : "";
    return (
      LINES.confirm_prefix +
      from + reach +
      "For " + teamLabel(s.team) + ": " + s.message.replace(/([^.!?])$/, "$1.") +
      (s.urgent ? " Marked urgent." : "") +
      LINES.confirm_suffix
    );
  }

  // ---- the turn machine ----------------------------------------------------
  // Returns { reply, action: "none"|"submit_message", payload? } — same shape
  // as SamNLU turns so desk.js speaks/acts identically.
  function turn(session, userText) {
    const text = String(userText || "").trim();
    const s = session;

    if (s.state === "done") {
      s.state = "idle";
      return { reply: LINES.already_sent, action: "none" };
    }

    if (active(s) && NO_RE.test(text)) {
      Object.assign(s, createSession());
      return { reply: LINES.cancelled, action: "none" };
    }

    if (s.state === "idle") {
      s.state = "message";
      s.urgent = URGENT.test(text);
      s.team = route(text);
      const inline = extractMessage(text);
      // If the intent phrase carried the message itself, keep it and move on.
      if (inline && inline.split(/\s+/).length >= 4 && !wants(inline)) {
        s.message = inline;
        s.state = "name";
        return { reply: LINES.need_name, action: "none" };
      }
      return { reply: LINES.start, action: "none" };
    }

    if (s.state === "message") {
      if (!text) return { reply: LINES.need_more, action: "none" };
      s.message = extractMessage(text) || text;
      s.urgent = s.urgent || URGENT.test(text);
      const routed = route(text);
      if (routed !== "general") s.team = routed;
      s.state = "name";
      return { reply: LINES.need_name, action: "none" };
    }

    if (s.state === "name") {
      // The name line sometimes carries the contact too ("Dana, dana@x.com") —
      // or ONLY the contact, in which case keep asking for the name.
      const contact = extractContact(text);
      const name = extractName(
        String(text).replace(EMAIL_RE, "").replace(PHONE_RE, "").replace(/[,\s]+$/, "")
      );
      if (contact) s.contact = contact;
      if (name) s.name = name;
      if (!s.name) return { reply: LINES.need_name, action: "none" };
      if (s.contact) {
        s.state = "confirm";
        return { reply: confirmLine(s), action: "none" };
      }
      s.state = "contact";
      return { reply: LINES.need_contact, action: "none" };
    }

    if (s.state === "contact") {
      const contact = extractContact(text);
      if (!contact) return { reply: LINES.bad_contact, action: "none" };
      s.contact = contact;
      s.state = "confirm";
      return { reply: confirmLine(s), action: "none" };
    }

    if (s.state === "confirm") {
      if (YES_RE.test(text)) {
        s.state = "done";
        return {
          reply: LINES.sent.replace("{team}", teamLabel(s.team)),
          action: "submit_message",
          payload: {
            name: s.name,
            contact: s.contact.value,
            contactKind: s.contact.kind,
            message: s.message,
            team: s.team,
            urgent: s.urgent,
            page: (root.location && root.location.pathname) || "",
          },
        };
      }
      // Anything that isn't yes/no is treated as a correction to the message.
      s.message = extractMessage(text) || text;
      return { reply: confirmLine(s), action: "none" };
    }

    Object.assign(s, createSession());
    return { reply: LINES.start, action: "none" };
  }

  root.SamMessages = {
    createSession,
    turn,
    wants,
    active,
    route,
    teamLabel,
    LINES,
    TEAMS,
  };
})(typeof window !== "undefined" ? window : globalThis);
