/**
 * Sam Messages v2 — drop-in message intake + team routing with layered NLP.
 * (Does not replace desk.js or desk-nlu.js. Do not deploy; site stays closed.)
 *
 * NLP layers:
 *   1. turnSmart(session, text)  — async; asks /api/message-nlu (server-side LLM,
 *      same provider chain as /api/sam-chat) to classify + extract everything in
 *      one shot. Keys live only in Vercel env. If the endpoint is missing or
 *      unconfigured, silently falls back to layer 2 — same reply contract.
 *   2. turn(session, text)       — deterministic rule engine: intent regexes,
 *      per-utterance slot harvesting (name, company, contact, urgency, dept),
 *      negation-aware department scoring, mid-flow booking handoff.
 *
 * WIRE (script order: sam-voice > desk-nlu > desk-messages > sam-states > desk):
 *
 *   const msgSession = SamMessages.createSession();
 *   async handle(text) {
 *     if (SamMessages.active(msgSession) || SamMessages.wants(text)) {
 *       const turn = await SamMessages.turnSmart(msgSession, text);
 *       speak(turn.reply);
 *       if (turn.action === "handoff_book") { renderCal(); return; }   // let SamNLU book
 *       if (turn.action === "submit_message") {
 *         const r = await fetch("/api/message", {
 *           method: "POST",
 *           headers: { "content-type": "application/json" },
 *           body: JSON.stringify(turn.payload),
 *         });
 *         speak(r.ok ? SamMessages.LINES.sent_short : SamMessages.LINES.send_failed);
 *       }
 *       return;
 *     }
 *     // ...existing SamNLU.turn(...) path unchanged
 *   }
 *
 * Voice rules (SAM.md): she is Sam, receptionist. Never "the desk". Never a
 * person's name in her mouth — departments only; the actual recipient is
 * resolved server-side in /api/message via SAM_TEAM_ROUTES.
 */
(function (root) {
  "use strict";

  // ---- team routing (front-end knows departments only, never names) -------
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

  const URGENT =
    /\b(urgent|urgently|asap|emergency|critical|right away|immediately|today if possible|time.?sensitive|end of day|eod)\b/i;

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

  // "this is Dana Whitfield from Acme Tooling" — name + optional company
  const INTRO_RE =
    /\b(?:this is|my name is|name'?s|it'?s|it is|i'?m|i am)\s+([^,.;:!?@\n]+?)(?:\s+(?:from|at|with)\s+([^,.;:!?@\n]+))?\s*(?=[,.;:!?]|$)/i;

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

  // Mid-flow pivot to booking: "actually can I just book a call instead"
  const BOOK_RE =
    /\b(book|schedule|set up|grab)\b.{0,24}\b(call|meeting|slot|time|appointment|discovery)\b|\bappointment\b|\bsee the calendar\b/i;

  const YES_RE =
    /^\s*(y|yes|yeah|yep|sure|correct|right|that's right|send it|go ahead|please do|ok(ay)?)\b/i;
  const NO_RE = /^\s*(n|no|nope|nah|cancel|never ?mind|forget it|don't|stop)\b/i;

  const LINES = {
    start:
      "Of course. Tell me the message and I will get it to the right person. What should I pass along?",
    need_more: "Go ahead — what would you like me to pass along?",
    need_name: "And who shall I say it is from?",
    need_contact: "Where can they reach you — an email or a phone number?",
    bad_contact:
      "I did not catch a working email or phone number there. Could you give me one of those?",
    confirm_prefix: "Let me read that back. ",
    confirm_suffix: " Shall I send it?",
    sent: "Done. Your message is with {team}. They will reach you at the contact you gave me.",
    sent_short: "Done. It is with the right person now.",
    send_failed:
      "I could not file that just now. You can email us directly and it will reach the same people.",
    cancelled:
      "No problem, I will drop that. Anything else — prices, privacy, or a free thirty minutes?",
    already_sent: "That message already went through. Anything else I can do?",
    handoff_book:
      "Even better — let us just get you on the calendar. Here are the open slots.",
  };

  // ---- department scoring (negation-aware) --------------------------------
  // "it's not a billing problem, the install is down" must not score billing.
  function scoringText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\b(?:not|isn'?t|no|nothing to do with|other than)\s+(?:about\s+)?(?:a|an|the|my)?\s*[\w-]+/g, " ");
  }

  function route(text) {
    const t = scoringText(text);
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

  // ---- extraction ----------------------------------------------------------
  // "…please tell the team X" anywhere in the utterance -> X is the message.
  const TAIL_RE =
    /(?:tell (?:the team|whoever|someone|somebody)(?: that)?|let (?:them|the team) know(?: that)?|pass (?:this|it|a message) (?:along|on)(?: that| saying| about)?|leave (?:him |her |them )?a message(?: that| saying| about)?|take a message(?: that| saying| about)?|forward (?:this|a message)(?: that| saying| about)?)\s+(.+)$/i;

  // Strip the "take a message" framing so the stored message is the payload.
  function extractMessage(text) {
    let t = String(text || "").trim();
    const tail = t.match(TAIL_RE);
    if (tail && tail[1] && tail[1].split(/\s+/).length >= 3) return tail[1].trim();
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

  function cleanName(t) {
    return String(t || "")
      .replace(/^(it'?s|it is|this is|i am|i'?m|my name is|name'?s)\s+/i, "")
      .replace(/[.!?]+$/, "")
      .trim()
      .slice(0, 80);
  }

  // Pull whatever slots this utterance happens to carry into the session.
  // Explicit patterns only — never guesses a name out of free text.
  function harvest(s, text) {
    const t = String(text || "");
    if (!s.contact) {
      const c = extractContact(t);
      if (c) s.contact = c;
    }
    if (!s.name) {
      const m = t.match(INTRO_RE);
      if (m) {
        const candidate = cleanName(m[1].replace(EMAIL_RE, "").replace(PHONE_RE, ""));
        if (candidate && !/^(calling|writing|reaching|leaving)/i.test(candidate)) {
          s.name = candidate;
          if (m[2] && !s.company) s.company = m[2].trim().slice(0, 80);
        }
      }
    }
    s.urgent = s.urgent || URGENT.test(t);
    const dept = route(t);
    if (dept !== "general") s.team = dept;
  }

  // ---- session -------------------------------------------------------------
  function createSession() {
    return {
      state: "idle", // idle | collect | confirm | done
      message: "",
      name: "",
      company: "",
      contact: null, // {kind, value}
      team: "general",
      urgent: false,
      askedContact: false,
    };
  }

  function active(session) {
    return session && session.state !== "idle" && session.state !== "done";
  }

  function wants(text) {
    return WANT_RE.test(String(text || ""));
  }

  function confirmLine(s) {
    const from = s.name
      ? "From " + s.name + (s.company ? " at " + s.company : "") + ", "
      : "";
    const reach = s.contact ? "reachable at " + s.contact.value + ". " : "";
    return (
      LINES.confirm_prefix +
      from +
      reach +
      "For " + teamLabel(s.team) + ": " + s.message.replace(/([^.!?])$/, "$1.") +
      (s.urgent ? " Marked urgent." : "") +
      LINES.confirm_suffix
    );
  }

  function payloadOf(s) {
    return {
      name: s.name,
      company: s.company,
      contact: s.contact.value,
      contactKind: s.contact.kind,
      message: s.message,
      team: s.team,
      urgent: s.urgent,
      page: (root.location && root.location.pathname) || "",
    };
  }

  // Ask for the next missing slot; confirm when everything is filled.
  function advance(s, firstAsk) {
    if (!s.message) return { reply: firstAsk ? LINES.start : LINES.need_more, action: "none" };
    if (!s.name) return { reply: LINES.need_name, action: "none" };
    if (!s.contact) {
      const again = s.askedContact;
      s.askedContact = true;
      return { reply: again ? LINES.bad_contact : LINES.need_contact, action: "none" };
    }
    s.state = "confirm";
    return { reply: confirmLine(s), action: "none" };
  }

  // ---- layer 2: deterministic turn ----------------------------------------
  // Returns { reply, action: "none"|"submit_message"|"handoff_book", payload? }
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

    // Caller pivots to booking mid-flow — hand back to the calendar/SamNLU.
    if (active(s) && BOOK_RE.test(text) && /\binstead\b|\brather\b|\bactually\b|\bjust\b/i.test(text)) {
      Object.assign(s, createSession());
      return { reply: LINES.handoff_book, action: "handoff_book" };
    }

    if (s.state === "confirm") {
      if (YES_RE.test(text)) {
        const done = { reply: LINES.sent.replace("{team}", teamLabel(s.team)), action: "submit_message", payload: payloadOf(s) };
        s.state = "done";
        return done;
      }
      // Anything that isn't yes/no is a correction to the message.
      harvest(s, text);
      const corrected = extractMessage(text) || text;
      if (corrected) s.message = corrected;
      return { reply: confirmLine(s), action: "none" };
    }

    if (s.state === "idle") {
      s.state = "collect";
      harvest(s, text);
      const inline = extractMessage(text);
      if (inline && inline.split(/\s+/).length >= 4 && !wants(inline)) s.message = inline;
      return advance(s, !s.message);
    }

    // collect — figure out which slot this utterance fills.
    harvest(s, text);
    if (!s.message) {
      const body = extractMessage(text) || text;
      // Pure intro/contact lines aren't the message ("this is Dana", "555-0100").
      const residue = body
        .replace(INTRO_RE, "")
        .replace(EMAIL_RE, "")
        .replace(PHONE_RE, "")
        .trim();
      if (residue.split(/\s+/).filter(Boolean).length >= 3) s.message = body;
    } else if (!s.name && !extractContact(text) && text) {
      // We just asked for the name and got free text: take it as the name.
      const candidate = cleanName(text.replace(EMAIL_RE, "").replace(PHONE_RE, "").replace(/[,\s]+$/, ""));
      if (candidate && candidate.split(/\s+/).length <= 5) s.name = candidate;
    }
    return advance(s, false);
  }

  // ---- layer 1: LLM-assisted turn -----------------------------------------
  // POSTs to /api/message-nlu; merges its extraction into the session, then
  // the same advance() drives the dialogue. Falls back to turn() on any miss.
  async function turnSmart(session, userText, opts) {
    const s = session;
    const text = String(userText || "").trim();

    // Deterministic guards stay local — never spend an LLM call on "yes".
    if (s.state === "done" || (active(s) && (NO_RE.test(text) || YES_RE.test(text))) || typeof fetch !== "function") {
      return turn(s, text);
    }

    const endpoint = (opts && opts.endpoint) || "/api/message-nlu";
    let d = null;
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          state: {
            state: s.state,
            have_message: Boolean(s.message),
            have_name: Boolean(s.name),
            have_contact: Boolean(s.contact),
            team: s.team,
          },
        }),
      });
      if (r.ok) d = await r.json();
    } catch {
      d = null;
    }
    if (!d || !d.ok) return turn(s, text);

    if (d.handoff_book) {
      Object.assign(s, createSession());
      return { reply: LINES.handoff_book, action: "handoff_book" };
    }
    if (s.state === "idle" && !d.wants_message) return turn(s, text);

    if (s.state === "idle") s.state = "collect";
    if (d.message && (!s.message || s.state === "confirm")) s.message = String(d.message).slice(0, 2000);
    if (d.name && !s.name) s.name = String(d.name).slice(0, 80);
    if (d.company && !s.company) s.company = String(d.company).slice(0, 80);
    if (d.contact && !s.contact) {
      const kind = d.contact_kind === "phone" ? "phone" : "email";
      const ok = kind === "email" ? EMAIL_RE.test(d.contact) : PHONE_RE.test(d.contact);
      if (ok) s.contact = { kind, value: String(d.contact).trim() };
    }
    if (d.urgent) s.urgent = true;
    if (d.department && TEAMS[d.department] && d.department !== "general") s.team = d.department;

    if (s.state === "confirm") return { reply: confirmLine(s), action: "none" };
    return advance(s, !s.message);
  }

  root.SamMessages = {
    createSession,
    turn,
    turnSmart,
    wants,
    active,
    route,
    teamLabel,
    harvest,
    LINES,
    TEAMS,
  };
})(typeof window !== "undefined" ? window : globalThis);
