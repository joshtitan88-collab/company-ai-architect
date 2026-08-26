export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const company = String(body.company || "").trim();
  const pain = String(body.pain || "").trim();
  const slotIso = String(body.slotIso || "").trim();

  if (!name || !email || !company || !slotIso || !email.includes("@")) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "not_configured" });

  const title = `desk-booking ${slotIso} ${company}`.slice(0, 180);
  const md = [
    "Automated desk booking from companyaiarchitect.com",
    "",
    `- name: ${name}`,
    `- email: ${email}`,
    `- company: ${company}`,
    `- slot_iso: ${slotIso}`,
    `- pain: ${pain.replace(/\n/g, " ")}`,
  ].join("\n");

  const r = await fetch("https://api.github.com/repos/joshtitan88-collab/company-ai-architect/issues", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body: md, labels: ["desk-booking"] }),
  });
  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: "intake_failed", status: r.status });
  res.status(200).json({ ok: true, id: data.number });
}
