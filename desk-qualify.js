/**
 * Sam Qualify — drop-in soft-qualification tracker (internal only).
 *
 * Implements SAM-PERSONA.md "Soft qualification": Sam qualifies through
 * conversation, never a form, and the visitor never feels assessed. This
 * module only LISTENS — it produces no replies, asks no questions, and its
 * output is never spoken. It turns the conversation into the handoff fields
 * /api/book already accepts (fit, summary, objections, highlights).
 *
 * WIRE (script order: … > desk-messages > desk-qualify > sam-states > desk):
 *
 *   const qual = SamQualify.createSession();
 *   async handle(text) {
 *     SamQualify.observe(qual, text);          // every visitor utterance
 *     …
 *     if (turn.action === "submit_book") {
 *       const payload = { ...turn.payload, ...SamQualify.fields(qual) };
 *       POST /api/book payload;                // handoff carries the notes
 *     }
 *   }
 *
 * Interest level (Low/Medium/High) mirrors the spec:
 *   High   — clear buying signals plus pain, or urgency on top of either
 *   Medium — real pain described, or a single buying signal
 *   Low    — browsing, research, or explicit not-ready signals
 */
(function (root) {
  "use strict";

  const SIGNALS = {
    buying:
      /\bhow (?:do|would|can) we (?:start|begin|work with)|next steps?\b|\btimeline\b|how long (?:does|would)|get(?:ting)? started|sign(?:ing)? up|\bonboard|\bpricing\b|\bprice\b|\bcost\b|how much|what.{0,12}charge/i,
    pain:
      /\bdrowning\b|\bmanual(?:ly)?\b|\bwast(?:e|ing)\b|\btedious\b|\brepetitive\b|miss(?:ed|ing) calls?|falling behind|\boverwhelmed\b|too much time|\bbottleneck|can'?t keep up|losing (?:leads|customers|jobs|money)|\bvoicemail\b|no time (?:to|for)/i,
    urgency:
      /\burgent\b|\basap\b|this (?:week|month)|right away|\bsoon\b|yesterday|before (?:the|our|we)/i,
    decision:
      /\bi own\b|\bmy (?:shop|company|business|garage|practice)\b|i'?m the (?:owner|founder|ceo|boss|manager)|\bwe'?re looking\b|\bi decide\b|my partner and i/i,
    explorer:
      /just (?:looking|browsing|curious)|\bstudent\b|research(?:ing)? for|writing a paper|no budget|not (?:looking|interested|ready|right now)|window shopping/i,
    objection:
      /\bskeptical\b|not sure (?:this|it|ai)|does (?:this|it|ai) (?:really|actually) work|\bhype\b|\bscam\b|\bworried\b|\bconcern|too expensive|\bexpensive\b|sounds pricey|tried .{0,24}before|burned before/i,
  };

  const TOPICS = {
    price: /\bprice|pricing|cost|how much|charge\b/i,
    privacy: /\bprivacy|data|confidential|gdpr|secure|security\b/i,
    technical: /\bmodel|gpu|server|ollama|api|integration|self.?host|local\b/i,
    process: /\bhow (?:does|would) (?:this|it|that) work|what happens (?:next|first)|walk me through\b/i,
  };

  const TEAM_RE = /\b(\d{1,4})\s+(?:employees|people|techs|staff|trucks|locations)\b/i;

  function createSession() {
    return {
      counts: { buying: 0, pain: 0, urgency: 0, decision: 0, explorer: 0, objection: 0 },
      topics: {},
      painLines: [],
      objectionLines: [],
      factLines: [],
      turns: 0,
    };
  }

  function clip(text, n) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  // Feed every VISITOR utterance. Sam's own lines are never scored.
  function observe(q, text) {
    const t = String(text || "");
    if (!t.trim()) return;
    q.turns += 1;
    for (const [key, re] of Object.entries(SIGNALS)) {
      if (re.test(t)) {
        q.counts[key] += 1;
        if (key === "pain" && q.painLines.length < 3) q.painLines.push(clip(t, 160));
        if (key === "objection" && q.objectionLines.length < 3) q.objectionLines.push(clip(t, 140));
      }
    }
    for (const [topic, re] of Object.entries(TOPICS)) {
      if (re.test(t)) q.topics[topic] = true;
    }
    const team = t.match(TEAM_RE);
    if (team && q.factLines.length < 3) q.factLines.push(clip(team[0], 60));
    if (SIGNALS.decision.test(t) && q.factLines.length < 3) {
      const m = t.match(/[^.!?]*(?:i own|i'?m the|my (?:shop|company|business|garage|practice))[^.!?]*/i);
      if (m) q.factLines.push(clip(m[0], 120));
    }
  }

  function interest(q) {
    const c = q.counts;
    if (c.explorer > 0 && c.buying === 0 && c.pain === 0) return "low";
    if (c.buying >= 2 || (c.buying >= 1 && c.pain >= 1) || (c.urgency >= 1 && (c.buying + c.pain) >= 1)) {
      return "high";
    }
    if (c.pain >= 1 || c.buying >= 1) return "medium";
    return "low";
  }

  // The structured internal note — merges straight into the /api/book payload.
  function fields(q) {
    const bits = [];
    if (q.painLines.length) bits.push("Pain: " + q.painLines.join(" / "));
    if (q.factLines.length) bits.push("Context: " + q.factLines.join(" / "));
    const topicList = Object.keys(q.topics);
    return {
      fit: interest(q),
      ...(bits.length ? { summary: clip(bits.join(". "), 600) } : {}),
      ...(q.objectionLines.length ? { objections: clip(q.objectionLines.join(" / "), 600) } : {}),
      ...(topicList.length ? { highlights: clip("Asked about: " + topicList.join(", "), 600) } : {}),
    };
  }

  root.SamQualify = { createSession, observe, interest, fields, SIGNALS, TOPICS };
})(typeof window !== "undefined" ? window : globalThis);
