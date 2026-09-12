/**
 * Booking confirmation email via Resend.
 *
 * Contract:
 * - Never throws — always resolves to a result object.
 * - Without RESEND_API_KEY: returns { ok:false, skipped:true } with zero network calls.
 * - One retry on any failure (network error or non-2xx), then gives up quietly.
 */
const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Sam <sam@companyaiarchitect.com>";

function humanSlot(slotUtc, timezone) {
  try {
    return new Date(slotUtc).toLocaleString("en-US", {
      timeZone: timezone || "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return slotUtc;
  }
}

export async function sendBookingConfirmation({ name, email, company, slotUtc, timezone, status = "requested" }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true };

  const when = humanSlot(slotUtc, timezone);
  const firstName = String(name || "").trim().split(/\s+/)[0] || "there";
  const payload = {
    from: FROM,
    to: [email],
    subject: status === "confirmed" ? `You're booked — ${when}` : `Appointment request received — ${when}`,
    text: [
      `Hi ${firstName},`,
      "",
      status === "confirmed" ? `Your call is confirmed for ${when}.` : `We received your request for ${when}. Our team will confirm the appointment with you.`,
      "",
      `I'm looking forward to digging into what AI can do for ${company}. No prep needed — just bring the problems that eat your time.`,
      "",
      "If anything comes up and you need to move it, just reply to this email.",
      "",
      "Talk soon,",
      "Sam",
      "Company AI Architect",
    ].join("\n"),
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(RESEND_URL, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        let id = "";
        try {
          const data = await r.json();
          id = data && data.id ? String(data.id) : "";
        } catch {}
        return { ok: true, id, attempt };
      }
      if (attempt === 2) return { ok: false, status: r.status, attempt };
    } catch (err) {
      if (attempt === 2) return { ok: false, error: String(err && err.message || err), attempt };
    }
  }
  return { ok: false };
}

