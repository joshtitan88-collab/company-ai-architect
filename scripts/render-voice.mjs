/**
 * render-voice.mjs — pre-render Sam's stock lines to mp3 via OpenAI TTS.
 * Run: bash -lc 'node scripts/render-voice.mjs'  (login env supplies OPENAI_API_KEY)
 * Never logs the key. Skips existing files and lines with {placeholders}.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "voice");

const SamVoice = require(path.join(ROOT, "sam-voice.js"));
const SamNLU = require(path.join(ROOT, "desk-nlu.js"));
require(path.join(ROOT, "desk-messages.js")); // attaches to globalThis
const SamMessages = globalThis.SamMessages;

const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.SAM_TTS_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.SAM_TTS_OPENAI_VOICE || "nova";

function collect() {
  const texts = new Set();
  for (const v of Object.values(SamNLU.LINES || {})) {
    if (typeof v === "string") texts.add(v);
  }
  for (const v of Object.values((SamMessages && SamMessages.LINES) || {})) {
    if (typeof v === "string") texts.add(v);
  }
  texts.add(SamNLU.GREETING);
  const out = [];
  for (const t of texts) {
    const text = String(t).trim();
    if (!text) continue;
    if (text === SamNLU.GREETING) continue; // already sam-hello-v2.mp3
    if (text.includes("{")) continue; // runtime placeholders
    out.push(text);
  }
  return out;
}

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function tts(text) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: text,
      response_format: "mp3",
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error("openai_tts_" + r.status + " " + body.slice(0, 200));
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 64) throw new Error("tts_empty");
  return buf;
}

async function main() {
  if (!KEY) {
    console.error("OPENAI_API_KEY not set — aborting, nothing rendered.");
    process.exit(2);
  }
  await mkdir(OUT, { recursive: true });
  const lines = collect();
  console.log(`Rendering ${lines.length} lines -> ${OUT} (model=${MODEL} voice=${VOICE})`);

  const rendered = [];
  let done = 0, skipped = 0, failed = 0;
  const queue = lines.slice();
  async function worker(id) {
    while (queue.length) {
      const text = queue.shift();
      const slug = SamVoice.slug(text);
      if (!slug) continue;
      const file = path.join(OUT, slug + ".mp3");
      if (await exists(file)) {
        skipped++;
        rendered.push({ text, slug });
        console.log(`[skip] ${slug}`);
        continue;
      }
      try {
        const buf = await tts(text);
        await writeFile(file, buf);
        done++;
        rendered.push({ text, slug });
        console.log(`[ok:${id}] ${slug} (${buf.length}b)`);
      } catch (e) {
        failed++;
        console.error(`[fail] ${slug}: ${e.message}`);
      }
    }
  }
  await Promise.all([worker(1), worker(2)]);
  console.log(`Done. rendered=${done} skipped=${skipped} failed=${failed}`);

  // Emit mapping for manifest.json consumption
  const map = {};
  for (const r of rendered) map[r.text] = "./assets/voice/" + r.slug + ".mp3";
  await writeFile(path.join(OUT, ".rendered-map.json"), JSON.stringify(map, null, 2));
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("fatal: " + e.message);
  process.exit(1);
});
