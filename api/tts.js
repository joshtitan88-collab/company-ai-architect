/**
 * POST /api/tts  { text, voice_id? }
 * Proxies Eve-class TTS. Key stays on the server. Default voice: eve (xAI).
 * No OpenAI fallback — that is not Eve. Missing key → 501 tts_not_configured.
 */
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

async function timedFetch(url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function xaiTts(text, voiceId) {
  const r = await timedFetch(
    "https://api.x.ai/v1/tts",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.XAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId || process.env.SAM_TTS_VOICE || "eve",
        language: "en",
      }),
    },
    20000
  );
  if (!r.ok) {
    const err = new Error("xai_tts_" + r.status);
    err.status = r.status;
    throw err;
  }
  return Buffer.from(await r.arrayBuffer());
}


export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const body = bodyOf(req);
  const text = String(body.text || "").replace(/\s+/g, " ").trim();
  if (!text) return res.status(400).json({ error: "missing_text" });
  if (text.length > 800) return res.status(400).json({ error: "too_long" });

  const voiceId = String(body.voice_id || process.env.SAM_TTS_VOICE || "eve");

  try {
    let buf = null;
    let source = "";
    if (!process.env.XAI_API_KEY) {
      return res.status(501).json({ error: "tts_not_configured" });
    }
    buf = await xaiTts(text, voiceId);
    source = "xai";
    if (!buf || buf.length < 64) return res.status(502).json({ error: "tts_empty" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Sam-Tts", source);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: "tts_failed" });
  }
}
