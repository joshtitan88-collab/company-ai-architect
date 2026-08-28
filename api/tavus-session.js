/**
 * Creates and ends Tavus CVI Echo conversations for Sam's real-time face.
 * Secrets and PAL/face IDs stay in Vercel. The browser only receives the
 * short-lived Daily room URL for the conversation it just requested.
 */
const TAVUS_BASE = "https://tavusapi.com/v2";
const WINDOW_MS = 10 * 60_000;
const MAX_STARTS = 3;
const starts = new Map();

function bodyOf(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return {}; }
  }
  return req.body || {};
}

function clientIp(req) {
  const raw = req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"]);
  return raw ? String(raw).split(",")[0].trim() : "local";
}

function rateLimited(ip) {
  const now = Date.now();
  const fresh = (starts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_STARTS) return true;
  fresh.push(now);
  starts.set(ip, fresh);
  return false;
}

function configured() {
  return Boolean(process.env.TAVUS_API_KEY && process.env.TAVUS_PAL_ID);
}

async function tavus(path, init) {
  return fetch(TAVUS_BASE + path, {
    ...init,
    headers: {
      "x-api-key": process.env.TAVUS_API_KEY,
      "content-type": "application/json",
      ...(init && init.headers),
    },
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, enabled: configured() });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!configured()) return res.status(501).json({ error: "avatar_not_configured" });

  const body = bodyOf(req);
  if (body.action === "end") {
    const id = String(body.conversationId || "");
    if (!/^[A-Za-z0-9_-]{4,100}$/.test(id)) return res.status(400).json({ error: "bad_conversation" });
    try {
      const r = await tavus(`/conversations/${encodeURIComponent(id)}/end`, { method: "POST", body: "{}" });
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
    } catch {
      return res.status(502).json({ error: "avatar_end_failed" });
    }
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) return res.status(429).json({ error: "avatar_rate_limited" });

  const payload = {
    pal_id: process.env.TAVUS_PAL_ID,
    conversation_name: `Sam website ${new Date().toISOString()}`,
    audio_only: false,
    require_auth: true,
    max_participants: 2,
  };
  if (process.env.TAVUS_FACE_ID) payload.face_id = process.env.TAVUS_FACE_ID;

  try {
    const r = await tavus("/conversations", { method: "POST", body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.conversation_url || !data.conversation_id) {
      console.log(JSON.stringify({ evt: "avatar_start_failed", status: r.status }));
      return res.status(502).json({ error: "avatar_start_failed" });
    }
    console.log(JSON.stringify({ evt: "avatar_started", conversationId: data.conversation_id }));
    return res.status(200).json({
      ok: true,
      conversationId: data.conversation_id,
      conversationUrl: data.conversation_url,
      meetingToken: data.meeting_token || "",
    });
  } catch {
    return res.status(502).json({ error: "avatar_start_failed" });
  }
}
