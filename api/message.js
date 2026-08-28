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
import { verifyPrivateIntake } from "./private-intake.js";

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

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const name = String(body.name || "").trim().slice(0, 120);
  const company = String(body.company || "").trim().slice(0, 120);
  const contact = String(body.contact || "").trim().slice(0, 160);
  const contactKind = body.contactKind === "phone" ? "phone" : "email";
  const message = String(body.message || "").trim().slice(0, 2000);
  const urgent = Boolean(body.urgent);

  const contactOk =
    contactKind === "email"
      ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact)
      : /^\+?[\d\s().-]{8,20}$/.test(contact);
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

  const title = `desk-message ${team}${urgent ? " URGENT" : ""} from ${name}`.slice(0, 180);
  const md = [
    "Automated desk message from companyaiarchitect.com",
    "",
    `- from: ${name}${company ? ` (${company})` : ""}`,
    `- contact (${contactKind}): ${contact}`,
    `- team: ${team}`,
    `- owner: ${routes[team] || routes.general}`,
    `- urgent: ${urgent ? "yes" : "no"}`,
    `- page: ${String(body.page || "").slice(0, 200)}`,
    "",
    "## Message",
    "",
    message.replace(/\r/g, ""),
  ].join("\n");

  const labels = ["desk-message", `route:${team}`];
  if (urgent) labels.push("priority-high");

  const r = await fetch(`https://api.github.com/repos/${intake.repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body: md, labels }),
  });
  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: "intake_failed", status: r.status });
  res.status(200).json({ ok: true, id: data.number, team });
}
