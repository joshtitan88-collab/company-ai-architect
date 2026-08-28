/**
 * POST /api/message-nlu
 * Server-side NLP for Sam's message intake. Classifies the utterance and
 * extracts every slot in one shot so the front-end can skip questions the
 * caller already answered. Keys never leave the function; nothing here mints
 * or stores a key — credentials stay in Vercel environment settings only.
 *
 * Provider order (same policy as /api/sam-chat):
 *   1. Ollama (LAN / vercel dev only — skipped on Vercel unless OLLAMA_HOST is remote)
 *   2. xAI (XAI_API_KEY)  3. OpenAI (OPENAI_API_KEY)  4. Anthropic (ANTHROPIC_API_KEY)
 * If none are configured, returns { ok:false, error:"llm_not_configured" } so
 * the client keeps its local rule engine.
 */
const SYSTEM = `You are the intake classifier behind Sam, receptionist for Company AI Architect.
Given the latest caller utterance and dialogue state, return ONLY JSON (no prose, no markdown):
{"wants_message":true,"handoff_book":false,"department":"sales","message":"","name":"","company":"","contact":"","contact_kind":"email","urgent":false}

Rules:
- wants_message: true if the caller wants a message taken/forwarded or someone to get back to them.
- handoff_book: true ONLY if the caller is pivoting to booking an appointment/discovery call instead.
- department: exactly one of sales, technical, billing, privacy, general. Ignore negated topics ("not a billing thing").
- message: the content to pass along, in the caller's words, framing stripped ("tell them X" -> "X"). Empty if none yet.
- name / company: only if the caller stated them. Never invent.
- contact: an email or phone number if present. contact_kind: "email" or "phone" or "".
- urgent: true if the caller signals urgency.
Return only fields present in THIS utterance; empty string/false otherwise.`;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function bodyOf(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return req.body || {};
}

function isLocalHost(url) {
  try {
    const u = new URL(url);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return true;
  }
}

function ollamaBase() {
  const raw = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  return raw.replace(/\/$/, "").replace(/\/api$/, "");
}

function ollamaAllowed() {
  if (process.env.VERCEL === "1" && isLocalHost(ollamaBase())) return false;
  if (process.env.SAM_DISABLE_OLLAMA === "1") return false;
  return true;
}

function parseJson(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

const DEPTS = new Set(["sales", "technical", "billing", "privacy", "general"]);

// Deterministic keyword routing — overrides a lazy "general" from the model.
const DEPT_HINTS = {
  billing: ["invoice", "bill", "billing", "payment", "refund", "receipt", "charge", "overcharged"],
  technical: ["install", "hardware", "tower", "server", "gpu", "broken", "bug", "error", "not working", "reboot"],
  sales: ["price", "pricing", "cost", "quote", "package", "buy", "discovery", "audit", "demo"],
  privacy: ["privacy", "gdpr", "personal information", "delete my", "nda", "legal"],
};
function keywordDept(text) {
  const t = String(text || "").toLowerCase();
  let best = null, bestScore = 0;
  for (const [dept, words] of Object.entries(DEPT_HINTS)) {
    const score = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = dept; bestScore = score; }
  }
  return best;
}

function sanitize(raw, sourceText) {
  if (!raw || typeof raw !== "object") return null;
  let department = DEPTS.has(raw.department) ? raw.department : "general";
  if (department === "general") {
    const kw = keywordDept(`${sourceText || ""} ${raw.message || ""}`);
    if (kw) department = kw;
  }
  return {
    ok: true,
    wants_message: Boolean(raw.wants_message),
    handoff_book: Boolean(raw.handoff_book),
    department,
    message: String(raw.message || "").slice(0, 2000),
    name: String(raw.name || "").slice(0, 80),
    company: String(raw.company || "").slice(0, 80),
    contact: String(raw.contact || "").slice(0, 160),
    contact_kind: raw.contact_kind === "phone" ? "phone" : raw.contact_kind === "email" ? "email" : "",
    urgent: Boolean(raw.urgent),
  };
}

function userPrompt(text, state) {
  return `Dialogue state: ${JSON.stringify(state || {})}\nCaller said: ${JSON.stringify(String(text || "").slice(0, 600))}`;
}

async function tryOllama(text, state) {
  if (!ollamaAllowed()) return null;
  const model = process.env.SAM_NLU_MODEL || "qwen2.5:7b-instruct";
  const r = await fetch(`${ollamaBase()}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0 },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(text, state) },
      ],
    }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return parseJson(data && data.message && data.message.content);
}

async function tryOpenAiCompat(base, key, model, text, state) {
  if (!key) return null;
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(text, state) },
      ],
    }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return parseJson(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
}

async function tryAnthropic(text, state) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.SAM_NLU_MODEL_ANTHROPIC || "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(text, state) }],
    }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return parseJson(data && data.content && data.content[0] && data.content[0].text);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const body = bodyOf(req);
  const text = String(body.text || "").trim();
  const state = body.state && typeof body.state === "object" ? body.state : {};
  if (!text) return res.status(400).json({ ok: false, error: "missing_text" });

  const attempts = [
    () => tryOllama(text, state),
    () => tryOpenAiCompat("https://api.x.ai/v1", process.env.XAI_API_KEY, process.env.SAM_NLU_MODEL_XAI || "grok-3-mini", text, state),
    () => tryOpenAiCompat("https://api.openai.com/v1", process.env.OPENAI_API_KEY, process.env.SAM_NLU_MODEL_OPENAI || "gpt-4o-mini", text, state),
    () => tryAnthropic(text, state),
  ];

  for (const attempt of attempts) {
    try {
      const parsed = sanitize(await attempt(), text);
      if (parsed) return res.status(200).json(parsed);
    } catch {
      // provider down/misconfigured — try the next one
    }
  }
  return res.status(200).json({ ok: false, error: "llm_not_configured" });
}
