/**
 * Optional Stripe Checkout deposit. Card data goes directly to Stripe and is
 * never posted to, logged by, or stored on Company AI Architect's servers.
 */
const STRIPE_URL = "https://api.stripe.com/v1/checkout/sessions";

function bodyOf(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return {}; }
  }
  return req.body || {};
}

function cents() {
  const n = Number(process.env.STRIPE_DEPOSIT_CENTS);
  return Number.isInteger(n) && n >= 500 && n <= 2_500_000 ? n : 0;
}

function baseUrl(req) {
  const configured = String(process.env.SITE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  return "https://www.companyaiarchitect.com";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const amount = cents();
  const enabled = Boolean(process.env.STRIPE_SECRET_KEY && amount);
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, enabled, amount, currency: "usd" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!enabled) return res.status(501).json({ error: "deposit_not_configured" });

  const body = bodyOf(req);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
  const name = String(body.name || "").trim().slice(0, 80);
  const company = String(body.company || "").trim().slice(0, 120);
  const bookingId = String(body.bookingId || "").trim().slice(0, 80);
  if (!email || !email.includes("@")) return res.status(400).json({ error: "missing_email" });

  const site = baseUrl(req);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${site}/?deposit=success`);
  form.set("cancel_url", `${site}/?deposit=cancelled`);
  form.set("customer_email", email);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(amount));
  form.set("line_items[0][price_data][product_data][name]", "Company AI Architect deposit");
  form.set("payment_intent_data[description]", "Optional project deposit after discovery booking");
  if (name) form.set("metadata[name]", name);
  if (company) form.set("metadata[company]", company);
  if (bookingId) form.set("metadata[booking_id]", bookingId);

  try {
    const r = await fetch(STRIPE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) return res.status(502).json({ error: "checkout_failed" });
    return res.status(200).json({ ok: true, url: data.url });
  } catch {
    return res.status(502).json({ error: "checkout_failed" });
  }
}
