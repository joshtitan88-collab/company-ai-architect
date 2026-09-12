/**
 * POST /api/sam-chat
 * Server-side Sam NLU fallback. Keys never leave the function.
 *
 * Provider order:
 *   1. Ollama (LAN / vercel dev only — skipped on Vercel unless OLLAMA_HOST is remote)
 *   2. xAI (XAI_API_KEY)  3. OpenAI  4. Anthropic
 * If providers are unavailable, shared company knowledge keeps conversation useful.
 */
import "../sam-knowledge.js";
const KNOWLEDGE = globalThis.SamKnowledge;
import { SYSTEM } from "./company-system.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
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
  const host = ollamaBase();
  if (process.env.VERCEL === "1" && isLocalHost(host)) return false;
  if (process.env.SAM_DISABLE_OLLAMA === "1") return false;
  return true;
}

function sanitizeReply(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/\bthe desk\b/gi, "the front");
  t = t.replace(/this conversation is the product\.?/gi, "");
  t = t.replace(/\bI(?:['’]m| am) the (?:desk|install)\b/gi, "I am Sam, the receptionist");
  t = t.replace(/\bthe install\b/gi, "the fourteen-day package");
  if (t.length > 650) t = t.slice(0, 647) + "…";
  return t;
}

function extractJson(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const brace = s.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      return JSON.parse(brace[0]);
    } catch {
      return null;
    }
  }
  return null;
}

const INTENTS = new Set([
  "greet",
  "who",
  "product",
  "demo",
  "price",
  "privacy",
  "book",
  "contact",
  "human",
  "hours",
  "shop_leak",
  "thanks",
  "bye",
  "confirm",
  "deny",
  "unknown",
]);
const ACTIONS = new Set([
  "none",
  "show_calendar",
  "show_packages",
  "show_stages",
  "open_book",
  "need_fields",
]);

function normalizeOut(parsed, source) {
  let intent = String((parsed && parsed.intent) || "unknown").toLowerCase().trim();
  if (intent.includes("|") || !INTENTS.has(intent)) intent = "unknown";
  let action = String((parsed && parsed.action) || "none").toLowerCase().trim();
  if (action.includes("|") || !ACTIONS.has(action)) action = "none";
  const extract = (parsed && parsed.extract) || {};
  return {
    ok: true,
    source,
    intent,
    reply: sanitizeReply(parsed && parsed.reply),
    action: action || "none",
    extract: {
      name: String(extract.name || "").slice(0, 80),
      email: String(extract.email || "").slice(0, 120),
      company: String(extract.company || "").slice(0, 120),
      pain: String(extract.pain || "").slice(0, 240),
      slotIso: String(extract.slotIso || "").slice(0, 40),
      slotHint: String(extract.slotHint || "").slice(0, 80),
    },
  };
}

function userPayload(body) {
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const hist = history
    .map((h) => {
      const role = h.role === "sam" || h.role === "assistant" ? "Sam" : "Visitor";
      return role + ": " + String(h.text || "").slice(0, 240);
    })
    .join("\n");
  const slots = Array.isArray(body.slotHints)
    ? body.slotHints
        .slice(0, 8)
        .map((s) => (s.label ? s.label + " (" + s.iso + ")" : s.iso))
        .join("; ")
    : "";
  return [
    hist ? "Recent turns:\n" + hist : "",
    "Phase: " + (body.phase || "idle"),
    "Visitor business context: " + String(body.businessContext || "").slice(0,800),
    "Demonstration state (read-only roleplay): " + JSON.stringify(body.demo || null),
    "Booking so far: " + JSON.stringify(body.booking || {}),
    body.guess ? "Local matcher guess: " + JSON.stringify(body.guess) : "",
    slots ? "Open slots (Eastern): " + slots : "Open slots: (none passed)",
    "Visitor: " + String(body.message || "").slice(0, 500),
  ]
    .filter(Boolean)
    .join("\n");
}

async function timedFetch(url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function chatOllama(prompt) {
  const model = process.env.SAM_CHAT_MODEL || "qwen2.5:7b-instruct";
  const r = await timedFetch(
    ollamaBase() + "/api/chat",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.2, num_predict: 280 },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
    },
    // Cold model load + long system prompt can exceed 7s locally; Vercel
    // never reaches this path (ollama skipped), so a generous local timeout
    // costs production nothing.
    Number(process.env.SAM_OLLAMA_TIMEOUT_MS || 30000)
  );
  if (!r.ok) throw new Error("ollama_" + r.status);
  const data = await r.json();
  const raw = (data && data.message && data.message.content) || "";
  const parsed = extractJson(raw);
  if (!parsed) throw new Error("ollama_parse");
  return normalizeOut(parsed, "ollama:" + model);
}

async function chatOpenAiCompat(base, key, model, prompt, label, extra) {
  const r = await timedFetch(
    base.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 280,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        ...(extra || {}),
      }),
    },
    // Prod has only xAI configured — give the sole provider a little more
    // headroom than 8s so a slow turn degrades to "slow" instead of llm_failed.
    Number(process.env.SAM_LLM_TIMEOUT_MS || 6000)
  );
  if (!r.ok) throw new Error(label + "_" + r.status);
  const data = await r.json();
  const raw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const parsed = extractJson(raw);
  if (!parsed) throw new Error(label + "_parse");
  return normalizeOut(parsed, label + ":" + model);
}

async function chatAnthropic(prompt) {
  const model = process.env.SAM_ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
  const r = await timedFetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 280,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt + "\n\nJSON only." }],
      }),
    },
    8000
  );
  if (!r.ok) throw new Error("anthropic_" + r.status);
  const data = await r.json();
  const raw = (data.content || []).map((c) => c.text || "").join("");
  const parsed = extractJson(raw);
  if (!parsed) throw new Error("anthropic_parse");
  return normalizeOut(parsed, "anthropic:" + model);
}

function configured() {
  return {
    ollama: ollamaAllowed(),
    xai: Boolean(process.env.XAI_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

async function runChat(prompt) {
  const errors = [];
  if (ollamaAllowed()) {
    try {
      return await chatOllama(prompt);
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if (process.env.XAI_API_KEY) {
    try {
      const xaiModel = process.env.SAM_CHAT_MODEL || process.env.XAI_MODEL || "grok-3-mini";
      // grok-3-mini is a reasoning model; low effort cuts multi-second thinking
      // time for a receptionist-sized reply without touching the persona.
      const xaiExtra = /grok-3-mini/.test(xaiModel) ? { reasoning_effort: "low" } : undefined;
      return await chatOpenAiCompat(
        "https://api.x.ai/v1",
        process.env.XAI_API_KEY,
        xaiModel,
        prompt,
        "xai",
        xaiExtra
      );
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      return await chatOpenAiCompat(
        "https://api.openai.com/v1",
        process.env.OPENAI_API_KEY,
        process.env.SAM_OPENAI_MODEL || "gpt-4o-mini",
        prompt,
        "openai"
      );
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await chatAnthropic(prompt);
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  const err = new Error(errors.length ? errors.join(",") : "llm_not_configured");
  err.code = errors.length ? "llm_failed" : "llm_not_configured";
  throw err;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, providers: configured() });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const body = bodyOf(req);
  const message = String(body.message || "").trim();
  if (!message) return res.status(400).json({ ok: false, error: "missing_message" });
  if (message.length > 800) return res.status(400).json({ ok: false, error: "too_long" });

  const grounded = KNOWLEDGE.answer(message, body);
  // Fixed facts and demonstrations should be immediate, accurate and independent
  // of provider availability. Other conversation remains contextual model work.
  if (grounded && ["price", "privacy", "demo"].includes(grounded.intent)) {
    return res.status(200).json(grounded);
  }
  try {
    const out = await runChat(userPayload(body));
    if (!out.reply) throw new Error("empty_reply");
    // This endpoint cannot execute bookings or messages. A model's action is
    // only a UI suggestion, never evidence that a transaction succeeded.
    if (/\b(?:you(?:'re| are) booked|(?:i(?:'ve| have)|we(?:'ve| have)) (?:booked|scheduled|sent|saved|filed|emailed|notified)|(?:message|booking|appointment) (?:is |has been )?(?:confirmed|sent|saved)|it's on the book)\b/i.test(out.reply)) {
      return res.status(200).json(grounded || {
        ok: true, source: "company-knowledge", intent: "contact", action: "none", extract: {},
        reply: "I can help with that request. It needs to be submitted through the booking or message form before I can confirm it."
      });
    }
    if (!KNOWLEDGE.wantsBooking(message) && !/awaiting_|confirming/.test(String(body.phase || ""))) {
      if (["show_calendar", "open_book", "need_fields"].includes(out.action)) out.action = "none";
    }
    const validSlots = new Set((Array.isArray(body.slotHints) ? body.slotHints : []).map(s => s.iso));
    if (!validSlots.has(out.extract.slotIso)) out.extract.slotIso = "";
    return res.status(200).json(out);
  } catch (e) {
    if (grounded) return res.status(200).json(grounded);
    // A provider outage must still leave the receptionist useful and present.
    return res.status(200).json({
      ok: true, source: "company-knowledge", intent: "unknown", action: "none", extract: {},
      reply: "I can help you explore our AI automation services, try a sample receptionist conversation, or arrange a discovery. What would you like to focus on?"
    });

  }
}

