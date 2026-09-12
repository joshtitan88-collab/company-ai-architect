import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const DAILY = "https://api.daily.co/v1";
const LEMON = "https://lemonslice.com/api/liveai/sessions";
const ORIGINAL_SAM = new URL("../assets/sam-imagine-still.jpg", import.meta.url);
const ROOM_SECONDS = 600;
const WINDOW_MS = 600_000;
const ID = /^[A-Za-z0-9_-]{4,100}$/;

// Factory keeps provider contract tests completely offline.
export function createHandler({ env = process.env, request = (...args) => fetch(...args), now = Date.now, uuid = randomUUID, readImage = () => readFile(ORIGINAL_SAM) } = {}) {
  const starts = new Map();
  let allStarts = [];
  const enabled = () => Boolean(env.SAM_VIDEO_ENABLED === "true" && env.DAILY_API_KEY && env.LEMONSLICE_API_KEY);
  const signature = (payload) => createHmac("sha256", env.DAILY_API_KEY).update("sam-video-cleanup-v1:" + payload).digest();
  const seal = (data) => {
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    return payload + "." + signature(payload).toString("base64url");
  };
  function unseal(token) {
    if (typeof token !== "string" || token.length > 1500) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    try {
      const digest = Buffer.from(parts[1], "base64url");
      const expected = signature(parts[0]);
      if (digest.length !== expected.length || !timingSafeEqual(digest, expected)) return null;
      const data = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      const t = Math.floor(now() / 1000);
      if (!/^sam-[a-f0-9-]{36}$/.test(data.room) || !ID.test(data.session) || !Number.isInteger(data.exp) || data.exp < t || data.exp > t + 7200) return null;
      return data;
    } catch { return null; }
  }
  function originAllowed(req) {
    const origins = new Set(["https://www.companyaiarchitect.com", "https://companyaiarchitect.com"]);
    if (env.VERCEL_URL && /^[a-zA-Z0-9.-]+\.vercel\.app$/.test(env.VERCEL_URL)) origins.add("https://" + env.VERCEL_URL);
    if (!env.VERCEL) { origins.add("http://localhost:3000"); origins.add("http://localhost:8788"); }
    return origins.has(String(req.headers?.origin || ""));
  }
  function limited(req) {
    const time = now();
    for (const [key, times] of starts) if (!times.some(t => t > time - WINDOW_MS)) starts.delete(key);
    allStarts = allStarts.filter(t => t > time - WINDOW_MS);
    const ip = String(req.headers?.["x-forwarded-for"] || "unknown").split(",")[0].trim().slice(0,100);
    const times = (starts.get(ip) || []).filter(t => t > time - WINDOW_MS);
    if (times.length >= 3 || allStarts.length >= 20) return true;
    starts.set(ip, [...times,time]); allStarts.push(time); return false;
  }
  async function provider(url, method, body, key, allowMissing = false) {
    const response = await request(url, {
      method, redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allowMissing && response.status === 404) return {};
    if (!response.ok) throw new Error("provider_unavailable");
    return response.json();
  }
  async function cleanup(room, session) {
    const results = await Promise.allSettled([
      ...(session ? [provider(LEMON + "/" + encodeURIComponent(session) + "/control", "POST", { event: "terminate" }, null, true)] : []),
      provider(DAILY + "/rooms/" + encodeURIComponent(room), "DELETE", undefined, env.DAILY_API_KEY, true),
    ]);
    return results.every(r => r.status === "fulfilled");
  }
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") return res.status(200).json({ ok: true, enabled: enabled(), provider: "lemonslice" });
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "method" }); }
    if (!originAllowed(req)) return res.status(403).json({ error: "origin" });
    let body;
    try {
      if (Number(req.headers?.["content-length"] || 0) > 4096) throw new Error();
      if (typeof req.body === "string" && req.body.length > 4096) throw new Error();
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || Array.isArray(body) || typeof body !== "object" || JSON.stringify(body).length > 4096) throw new Error();
    } catch { return res.status(400).json({ error: "bad_request" }); }
    if (body.action === "end") {
      if (!env.DAILY_API_KEY || !env.LEMONSLICE_API_KEY) return res.status(501).json({ error: "avatar_not_configured" });
      const data = unseal(body.cleanupToken);
      if (!data) return res.status(403).json({ error: "invalid_session" });
      const ok = await cleanup(data.room, data.session);
      return res.status(ok ? 200 : 502).json(ok ? { ok: true } : { error: "avatar_cleanup_failed" });
    }
    if (body.action !== "start") return res.status(400).json({ error: "bad_action" });
    if (!enabled()) return res.status(501).json({ error: "avatar_not_configured" });
    if (limited(req)) { res.setHeader("Retry-After", "600"); return res.status(429).json({ error: "avatar_rate_limited" }); }
    const room = "sam-" + uuid();
    const exp = Math.floor(now()/1000) + ROOM_SECONDS;
    let session = "";
    try {
      const image = await readImage();
      if (!Buffer.isBuffer(image) || !image.length || image.length > 921600) throw new Error("bad_portrait");
      const created = await provider(DAILY + "/rooms", "POST", {
        name: room, privacy: "private", properties: { exp, eject_at_room_exp: true, max_participants: 2, enable_chat: false, enable_screenshare: false },
      }, env.DAILY_API_KEY);
      const roomUrl = new URL(created.url);
      if (created.name !== room || roomUrl.protocol !== "https:" || !roomUrl.hostname.endsWith(".daily.co") || roomUrl.username || roomUrl.password) throw new Error("bad_room");
      const tokenFor = (avatar) => provider(DAILY + "/meeting-tokens", "POST", { properties: {
        room_name: room, exp, eject_at_token_exp: true, is_owner: false,
        user_id: avatar ? "sam-avatar" : "sam-viewer", user_name: avatar ? "Sam" : "Visitor",
        start_video_off: !avatar, start_audio_off: !avatar, enable_screenshare: false,
        permissions: { canSend: avatar ? ["audio", "video"] : false, canAdmin: false },
      } }, env.DAILY_API_KEY);
      const [publisher, viewer] = await Promise.all([tokenFor(true), tokenFor(false)]);
      if (typeof publisher.token !== "string" || !publisher.token || typeof viewer.token !== "string" || !viewer.token) throw new Error("bad_token");
      const response = await request(LEMON, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "X-API-Key": env.LEMONSLICE_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          transport_type: "websocket-daily", agent_image_base64: image.toString("base64"),
          daily_properties: { daily_url: created.url, daily_token: publisher.token },
          agent_prompt: "A warm, professional receptionist speaking naturally with subtle facial expressions and gentle hand gestures. Maintain her original appearance and setting.",
          agent_idle_prompt: "An attentive receptionist listening with relaxed posture, natural blinking and subtle breathing, mouth at rest.",
          idle_timeout: 60,
        }),
      });
      if (!response.ok) throw new Error("provider_unavailable");
      const data = await response.json();
      if (typeof data.session_id !== "string" || !ID.test(data.session_id)) throw new Error("bad_session");
      session = data.session_id;
      const socket = new URL(data.websocket_address);
      if (socket.protocol !== "wss:" || socket.username || socket.password) throw new Error("bad_socket");
      return res.status(200).json({ ok: true, provider: "lemonslice", roomUrl: created.url,
        meetingToken: viewer.token, websocketUrl: socket.href, expiresAt: exp * 1000,
        cleanupToken: seal({ room, session, exp: exp + 3600 }),
      });
    } catch {
      await cleanup(room, session);
      // Provider bodies, URLs, credentials, and visitor content never enter logs.
      return res.status(502).json({ error: "avatar_start_failed" });
    }
  };
}

export default createHandler();
