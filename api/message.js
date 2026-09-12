/**
 * /api/message — receptionist message intake + team routing.
 *
 * Same intake channel as /api/book: files a GitHub issue on the private
 * intake repo, labeled desk-message + route:<team> (+ priority-high when
 * the caller flagged urgency). Recipient names/emails live ONLY here,
 * never in the browser (SAM.md: no operator name in Sam's mouth).
 *
 * Env (Vercel):
 *   GITHUB_TOKEN     required — same token /api/book uses.
 *   SAM_TEAM_ROUTES  optional JSON overriding who owns each department, e.g.
 *                    {"sales":"jo@x.com","technical":"eng@x.com","billing":"jo@x.com"}
 *                    Values land in the issue body as "owner:" so the intake
 *                    workflow (or a human) knows who the message is for.
 */
import { verifyPrivateIntake } from "./_private-intake.js";
import { createHash } from "node:crypto";

// Retry deduplication follows the private booking store's read-before-write
// convention. It handles uncertain responses, but is not a distributed lock.
async function priorMessage(token, repo, key, hash) {
  const deadline = Date.now() + 10000;
  for (let page = 1; page <= 100; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("intake_unavailable");
    const response = await fetch(`https://api.github.com/repos/${repo}/issues?labels=desk-message&state=all&per_page=100&page=${page}`, {
      signal: AbortSignal.timeout(Math.min(8000, remaining)),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error("intake_unavailable");
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error("intake_unavailable");
    for (const issue of records) {
      if (issue.pull_request) continue;
      const metadata = String(issue.body || "").split(/\r?\n## Message(?:\r?\n|$)/)[0];
      const field = name => metadata.match(new RegExp(`^- ${name}: (.*)$`, "m"))?.[1]?.trim();
      if (field("idem") === key) return { id: issue.number, match: field("payload_sha256") === hash, team: field("team") };
    }
    if (records.length < 100) return null;
  }
  throw new Error("intake_unavailable");
}

const rateBuckets = new Map();
function rateLimited(req) {
  const now = Date.now();
  for (const [key, times] of rateBuckets) {
    const recent = times.filter((time) => now - time < 60000);
    if (recent.length) rateBuckets.set(key, recent); else rateBuckets.delete(key);
  }
  const ip = String(req.headers?.["x-forwarded-for"] || "local").split(",")[0].trim();
  const times = rateBuckets.get(ip) || [];
  if (times.length >= 8) return true;
  times.push(now); rateBuckets.set(ip, times); return false;
}

const DEFAULT_ROUTES = {
  sales: "owner",
  technical: "owner",
  billing: "owner",
  privacy: "owner",
  general: "owner",
};

// Server-side recheck of the department — the browser's routing is a hint,
// not trusted input.
const HINTS = {
  sales: ["price", "pricing", "cost", "quote", "package", "buy", "discovery", "audit", "sales", "demo"],
  technical: ["install", "hardware", "tower", "server", "gpu", "model", "setup", "broken", "bug", "error", "api", "technical", "support"],
  billing: ["invoice", "bill", "payment", "refund", "receipt", "charge", "account"],
  privacy: ["privacy", "data", "gdpr", "delete my", "personal information", "nda", "legal"],
};

function routeOf(text, hint) {
  const t = String(text || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [id, words] of Object.entries(HINTS)) {
    const score = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  if (best) return best;
  return Object.prototype.hasOwnProperty.call(DEFAULT_ROUTES, hint) ? hint : "general";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  if (rateLimited(req)) return res.status(429).json({ error: "rate_limited" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return res.status(400).json({ error: "invalid_json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "invalid_json" });
  const line = (value, max) => String(value || "").replace(/[\r\n]/g, " ").trim().slice(0, max);
  const name = line(body.name, 120);
  const company = line(body.company, 120);
  const contact = line(body.contact, 160);
  const contactKind = body.contactKind === "phone" ? "phone" : "email";
  const message = String(body.message || "").trim().slice(0, 2000);
  const urgent = body.urgent === true;
  const idem = String(body.idempotencyKey || "").trim();
  if (idem && !/^[A-Za-z0-9_.:-]{1,80}$/.test(idem)) return res.status(400).json({ error: "bad_idempotency_key" });

  const contactOk =
    contactKind === "email"
      ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact)
      : /^\+?[\d\s().-]{8,20}$/.test(contact) && contact.replace(/\D/g, "").length >= 8;
  if (!name || !message || !contactOk) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const team = routeOf(message, String(body.team || "general"));

  let routes = DEFAULT_ROUTES;
  if (process.env.SAM_TEAM_ROUTES) {
    try {
      routes = { ...DEFAULT_ROUTES, ...JSON.parse(process.env.SAM_TEAM_ROUTES) };
    } catch {
      // bad env JSON — fall back to defaults rather than dropping the message
    }
  }

  const token = process.env.GITHUB_TOKEN;
  const intake = await verifyPrivateIntake(token);
  if (!intake.ok) {
    console.log(JSON.stringify({ evt: "message_blocked", reason: intake.error }));
    return res.status(503).json({ error: intake.error });
  }

  const hash = createHash("sha256").update(JSON.stringify({ name, company, contact, contactKind, message, team, urgent })).digest("hex");
  if (idem) {
    try {
      const previous = await priorMessage(token, intake.repo, idem, hash);
      if (previous) return previous.match
        ? res.status(200).json({ ok: true, id: previous.id, team: previous.team || team, duplicate: true })
        : res.status(409).json({ error: "idempotency_conflict" });
    } catch { return res.status(503).json({ error: "intake_unavailable" }); }
  }

  const title = `desk-message ${team}${urgent ? " URGENT" : ""} from ${name}`.slice(0, 180);
  const md = [
    "Automated desk message from companyaiarchitect.com",
    "",
    `- from: ${name}${company ? ` (${company})` : ""}`,
    `- contact (${contactKind}): ${contact}`,
    `- team: ${team}`,
    `- owner: ${routes[team] || routes.general}`,
    `- urgent: ${urgent ? "yes" : "no"}`,
    `- page: ${line(body.page, 200)}`,
    ...(idem ? [`- idem: ${idem}`, `- payload_sha256: ${hash}`] : []),
    "",
    "## Message",
    "",
    message.replace(/\r/g, ""),
  ].join("\n");

  const labels = ["desk-message", `route:${team}`];
  if (urgent) labels.push("priority-high");

  let r, data;
  try {
  r = await fetch(`https://api.github.com/repos/${intake.repo}/issues`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body: md, labels }),
  });
  data = await r.json();
  } catch { return res.status(502).json({ error: "intake_failed" }); }
  if (!r.ok || !data.number) return res.status(502).json({ error: "intake_failed", status: r.status });
  res.status(200).json({ ok: true, id: data.number, team });
}
