/**
 * render-voice-prod.mjs — pre-render Sam's canned lines to mp3 via the LIVE
 * production TTS endpoint (Eve voice, key held server-side — no key needed here).
 *
 *   node scripts/render-voice-prod.mjs
 *
 * POSTs https://www.companyaiarchitect.com/api/tts {text, voice_id:"eve"},
 * writes assets/voice/{SamVoice.slug(text)}.mp3. Concurrency 2, 20s timeout,
 * skips files that already exist >1KB, one retry on failure.
 * The greeting is NOT rendered — it is locked at assets/sam-hello-v2.mp3.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "voice");
const ENDPOINT = process.env.SAM_TTS_URL || "https://www.companyaiarchitect.com/api/tts";
const TIMEOUT_MS = 20000;
const CONCURRENCY = 2;

const SamVoice = require(path.join(ROOT, "sam-voice.js"));
const SamNLU = require(path.join(ROOT, "desk-nlu.js"));
require(path.join(ROOT, "desk-messages.js")); // attaches SamMessages to globalThis
const SamMessages = globalThis.SamMessages;

// Fixed strings hardcoded in desk.js speak()/addLog() paths (desk.js is
// browser-only, cannot be required — keep in sync with desk.js).
const DESK_LINES = [
  "That time just filled. Here is what's still open.",
  "I've noted your interest, and someone will follow up within a few hours.",
  "You're already on the book for that time.",
  "You're set. You'll get a confirmation shortly. I'm glad we found a time.",
  "I could not file that slot just now. Try again, or leave me a message and someone will follow up.",
  "Welcome back — good to see you again.",
  "This browser has no speech recognition — type and I'll help just the same.",
  "I didn't quite catch that — type it and I'll help just the same.",
  "The mic did not start — type and I'll help just the same.",
];

// Fixed strings built inline in desk-nlu.js (outside LINES).
const NLU_INLINE_LINES = [
  "I'm Sam, the receptionist for Company AI Architect. I book discovery, quote the packages, and talk privacy. Not a ChatGPT login.",
  "No problem. Discovery stays free whenever you want it.",
  "No problem. What else — prices, privacy, or a later time?",
  // "I don't have that opening." + fallback when the slot list is empty:
  "I don't have that opening. Name another weekday and time.",
];

// Fragments never spoken standalone (composed into dynamic confirmLine).
const FRAGMENT_KEYS = new Set(["confirm_prefix", "confirm_suffix"]);

function collect() {
  const texts = new Set();
  const dynamic = [];
  for (const [k, v] of Object.entries(SamNLU.LINES || {})) {
    if (typeof v !== "string") continue;
    if (v === SamNLU.GREETING) continue; // locked greeting asset
    texts.add(v);
  }
  for (const [k, v] of Object.entries((SamMessages && SamMessages.LINES) || {})) {
    if (typeof v !== "string") continue;
    if (v.includes("{")) { dynamic.push("SamMessages.LINES." + k + ": " + v); continue; }
    if (FRAGMENT_KEYS.has(k)) { dynamic.push("SamMessages.LINES." + k + " (fragment): " + v); continue; }
    texts.add(v);
  }
  for (const v of NLU_INLINE_LINES) texts.add(v);
  for (const v of DESK_LINES) texts.add(v);
  const out = [];
  for (const t of texts) {
    const text = String(t).trim();
    if (!text || text.includes("{")) continue;
    out.push(text);
  }
  return { lines: out, dynamic };
}

async function bigEnough(p) {
  try {
    const s = await stat(p);
    return s.size > 1024;
  } catch {
    return false;
  }
}

async function ttsOnce(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice_id: "eve" }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error("tts_" + r.status);
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (!/audio|mpeg|octet/.test(ct) && buf.length < 1024) throw new Error("tts_bad_type_" + ct.slice(0, 40));
    if (buf.length < 1024) throw new Error("tts_too_small_" + buf.length);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function renderLine(text, res) {
  const slug = SamVoice.slug(text);
  const file = path.join(OUT, slug + ".mp3");
  if (await bigEnough(file)) {
    console.log("skip  " + slug + ".mp3 (exists)");
    res.skipped.push(slug);
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const buf = await ttsOnce(text);
      await writeFile(file, buf);
      console.log("ok    " + slug + ".mp3  " + buf.length + " bytes");
      res.rendered.push({ slug, bytes: buf.length });
      res.bytes += buf.length;
      return;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (attempt === 2) {
        console.log("FAIL  " + slug + "  " + msg);
        res.failed.push({ text, slug, error: msg });
      } else {
        console.log("retry " + slug + "  (" + msg + ")");
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { lines, dynamic } = collect();
  console.log(lines.length + " canned lines to render; " + dynamic.length + " dynamic (skipped)");
  const res = { rendered: [], skipped: [], failed: [], bytes: 0, dynamic };
  const queue = lines.slice();
  async function worker() {
    while (queue.length) {
      const text = queue.shift();
      await renderLine(text, res);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    "done: rendered=" + res.rendered.length +
    " skipped=" + res.skipped.length +
    " failed=" + res.failed.length +
    " total_bytes=" + res.bytes
  );
  const summaryPath = path.join(OUT, ".rendered-map.json");
  const map = {};
  for (const r of res.rendered) map[r.slug] = r.bytes;
  await writeFile(summaryPath, JSON.stringify({ endpoint: ENDPOINT, voice: "eve", rendered: map, failed: res.failed.map((f) => f.slug), dynamic }, null, 2));
  if (res.failed.length) process.exitCode = 1;
  return res;
}

main().catch((e) => {
  console.error("fatal: " + String(e && e.message ? e.message : e));
  process.exit(2);
});
