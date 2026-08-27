/**
 * Local dev server for testing Sam — no Vercel login, no deploy, no GitHub
 * writes unless you want them.
 *
 *   node scripts/dev-server.mjs            → http://localhost:8788/receptionist.html
 *
 * - Serves the repo statically.
 * - Mounts api/*.js (Vercel-style handlers) at /api/*.
 * - If GITHUB_TOKEN is unset, GitHub issue writes are mocked to
 *   .local-intake/<n>.json so the full booking/message flow works offline.
 * - Uses local Ollama for /api/sam-chat + /api/message-nlu when it's up
 *   (SAM_CHAT_MODEL / SAM_NLU_MODEL default below); rule engines cover the
 *   rest. /api/tts needs XAI_API_KEY or OPENAI_API_KEY — without one,
 *   canned mp3s + timed talk animation are the fallback (by design).
 */
import http from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8788);
const INTAKE_DIR = path.join(ROOT, ".local-intake");

process.env.SAM_CHAT_MODEL = process.env.SAM_CHAT_MODEL || "mistral:latest";
process.env.SAM_NLU_MODEL = process.env.SAM_NLU_MODEL || "mistral:latest";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".aac": "audio/aac",
  ".woff2": "font/woff2", ".txt": "text/plain", ".md": "text/plain",
};

// ---- offline GitHub intake mock -----------------------------------------
let issueSeq = 0;
const realFetch = globalThis.fetch;
if (!process.env.GITHUB_TOKEN) {
  process.env.GITHUB_TOKEN = "local-dev-mock";
  await mkdir(INTAKE_DIR, { recursive: true });
  const existing = (await readdir(INTAKE_DIR)).filter((f) => f.endsWith(".json"));
  issueSeq = existing.length;
  globalThis.fetch = async (input, init) => {
    const u = String(input);
    if (u.startsWith("https://api.github.com/")) {
      if (u.includes("/issues?")) {
        const files = (await readdir(INTAKE_DIR)).filter((f) => f.endsWith(".json"));
        const issues = [];
        for (const f of files) issues.push(JSON.parse(await readFile(path.join(INTAKE_DIR, f), "utf8")));
        return new Response(JSON.stringify(issues), { status: 200 });
      }
      const payload = JSON.parse(init.body);
      issueSeq += 1;
      const issue = { number: issueSeq, title: payload.title, body: payload.body, labels: payload.labels };
      await writeFile(path.join(INTAKE_DIR, `${String(issueSeq).padStart(4, "0")}.json`), JSON.stringify(issue, null, 2));
      console.log(`[intake] #${issueSeq} ${payload.title}`);
      return new Response(JSON.stringify(issue), { status: 201 });
    }
    return realFetch(input, init);
  };
  console.log(`[dev] GITHUB_TOKEN not set — intake mocked to ${path.relative(ROOT, INTAKE_DIR)}/`);
}

// ---- Vercel-style handler shim ------------------------------------------
const apiCache = new Map();
async function apiHandler(name) {
  if (!apiCache.has(name)) {
    const file = path.join(ROOT, "api", name + ".js");
    if (!existsSync(file)) return null;
    apiCache.set(name, (await import(url.pathToFileURL(file).href)).default);
  }
  return apiCache.get(name);
}

function shimRes(res) {
  return {
    _code: 200,
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { this._code = c; return this; },
    json(o) { res.writeHead(this._code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); },
    send(b) { res.writeHead(this._code); res.end(b); },
    end(b) { res.writeHead(this._code); res.end(b); },
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname.startsWith("/api/")) {
      const name = u.pathname.slice(5).replace(/[^a-z0-9-]/g, "");
      const handler = await apiHandler(name);
      if (!handler) { res.writeHead(404); return res.end('{"error":"no_such_api"}'); }
      let body = "";
      for await (const chunk of req) body += chunk;
      const sreq = { method: req.method, body, headers: req.headers, query: Object.fromEntries(u.searchParams) };
      return await handler(sreq, shimRes(res));
    }
    let p = u.pathname === "/" ? "/receptionist.html" : u.pathname;
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    console.error("[dev]", u.pathname, err.message);
    res.writeHead(500);
    res.end('{"error":"dev_server"}');
  }
});

server.listen(PORT, () => {
  console.log(`[dev] Sam local test → http://localhost:${PORT}/receptionist.html`);
  console.log(`[dev] chat model: ${process.env.SAM_CHAT_MODEL} (Ollama ${process.env.OLLAMA_HOST || "127.0.0.1:11434"})`);
});
