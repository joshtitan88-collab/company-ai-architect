/**
 * POST /api/book — booking intake + qualified-lead handoff.
 *
 * Non-negotiables implemented here (see SAM-PERSONA.md):
 * - Structured handoff: fields below, never free-text chat logs.
 * - Timezone: slot stored as UTC ISO + visitor's original timezone.
 * - Idempotency: client key and/or email+slot dedup against open issues —
 *   a repeat attempt returns the existing booking, never a duplicate.
 * - Double-booking: open desk-booking issues are the source of truth at the
 *   moment of booking; a slot held by someone else returns 409 slot_taken.
 * - Graceful degradation: structured errors so Sam can offer the manual
 *   fallback line instead of dead-ending.
 * - Observability: one structured log line per attempt and per outcome.
 */
const INTAKE_REPO = "joshtitan88-collab/company-ai-architect";

function gh(token, path, init) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init && init.headers),
    },
  });
}

function field(issueBody, key) {
  const m = String(issueBody || "").match(new RegExp(`^- ${key}: (.*)$`, "m"));
  return m ? m[1].trim() : "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const company = String(body.company || "").trim();
  const pain = String(body.pain || "").trim();
  const slotIso = String(body.slotIso || "").trim();
  // qualified-lead handoff fields (all optional; see SAM-PERSONA.md)
  const phone = String(body.phone || "").trim().slice(0, 40);
  const timezone = String(body.timezone || "").trim().slice(0, 60);
  const summary = String(body.summary || "").trim().slice(0, 600);
  const objections = String(body.objections || "").trim().slice(0, 600);
  const highlights = String(body.highlights || "").trim().slice(0, 600);
  const idem = String(body.idempotencyKey || "").trim().slice(0, 80);
  const fitRaw = String(body.fit || "").trim().toLowerCase();
  const fit = ["high", "medium", "low"].includes(fitRaw) ? fitRaw : "";

  if (!name || !email || !company || !slotIso || !email.includes("@")) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const slotDate = new Date(slotIso);
  if (isNaN(slotDate.getTime())) return res.status(400).json({ error: "bad_slot" });
  const slotUtc = slotDate.toISOString();

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "not_configured" });

  console.log(JSON.stringify({ evt: "book_attempt", email, slotUtc, timezone, fit, idem: Boolean(idem) }));

  // Idempotency + double-booking: open desk-booking issues are the live truth.
  try {
    const list = await gh(token, `/repos/${INTAKE_REPO}/issues?labels=desk-booking&state=open&per_page=100`);
    if (list.ok) {
      const issues = await list.json();
      for (const issue of issues) {
        const iSlot = field(issue.body, "slot_utc") || field(issue.body, "slot_iso");
        const iEmail = field(issue.body, "email").toLowerCase();
        const iIdem = field(issue.body, "idem");
        const sameSlot = iSlot && !isNaN(new Date(iSlot).getTime()) && new Date(iSlot).toISOString() === slotUtc;
        if ((idem && iIdem === idem) || (sameSlot && iEmail === email)) {
          console.log(JSON.stringify({ evt: "book_duplicate", id: issue.number, email, slotUtc }));
          return res.status(200).json({ ok: true, id: issue.number, duplicate: true });
        }
        if (sameSlot) {
          console.log(JSON.stringify({ evt: "book_slot_taken", email, slotUtc }));
          return res.status(409).json({ error: "slot_taken" });
        }
      }
    }
    // If the listing itself fails we still book — a rare double is better
    // than refusing a willing customer; the operator dedupes on review.
  } catch {
    console.log(JSON.stringify({ evt: "book_dedup_check_failed", email, slotUtc }));
  }

  const title = `desk-booking ${slotUtc} ${company}`.slice(0, 180);
  const md = [
    "Automated desk booking from companyaiarchitect.com",
    "",
    `- name: ${name}`,
    `- email: ${email}`,
    `- company: ${company}`,
    `- slot_iso: ${slotIso}`,
    `- slot_utc: ${slotUtc}`,
    `- pain: ${pain.replace(/\n/g, " ")}`,
    ...(phone ? [`- phone: ${phone}`] : []),
    ...(timezone ? [`- timezone: ${timezone}`] : []),
    ...(summary ? [`- summary: ${summary.replace(/\n/g, " ")}`] : []),
    ...(objections ? [`- objections: ${objections.replace(/\n/g, " ")}`] : []),
    ...(highlights ? [`- highlights: ${highlights.replace(/\n/g, " ")}`] : []),
    ...(fit ? [`- fit: ${fit}`] : []),
    ...(idem ? [`- idem: ${idem}`] : []),
  ].join("\n");

  const r = await gh(token, `/repos/${INTAKE_REPO}/issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      body: md,
      labels: ["desk-booking", "qualified-lead", ...(fit ? [`fit:${fit}`] : [])],
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    console.log(JSON.stringify({ evt: "book_intake_failed", status: r.status, email, slotUtc }));
    return res.status(502).json({ error: "intake_failed", status: r.status });
  }
  console.log(JSON.stringify({ evt: "book_created", id: data.number, email, slotUtc, fit }));
  res.status(200).json({ ok: true, id: data.number });
}
