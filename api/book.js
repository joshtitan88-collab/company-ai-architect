/**
 * POST /api/book — booking intake + qualified-lead handoff.
 *
 * Non-negotiables implemented here (see SAM-PERSONA.md):
 * - Structured handoff: fields below, never free-text chat logs.
 * - Timezone: slot stored as UTC ISO + visitor's original timezone.
 * - Idempotency: client key and/or email+slot dedup against open issues —
 *   a repeat attempt returns the existing booking, never a duplicate.
 * - Availability: private reservations and configured calendar checked before intake.
 *   Google event IDs protect simultaneous same-slot calendar inserts.
 * - Without a connected calendar, intake is an appointment request awaiting review.
 * - Graceful degradation: structured errors so Sam can offer the manual
 *   fallback line instead of dead-ending.
 * - Observability: one structured log line per attempt and per outcome.
 */
import { sendBookingConfirmation } from "./notify.js";
import { verifyPrivateIntake } from "./private-intake.js";
import { createGoogleBooking, getGoogleBusy, googleCalendarConfigured } from "./google-calendar.js";
import { listBookings, bookingField, bookingRange } from "./booking-store.js";
import { loadAvailability, openSlots, overlaps } from "./slots.js";

// Per-IP rate limiter: max 5 booking POSTs per rolling minute.
// In-memory, per-instance best-effort only — a multi-instance or serverless
// deployment gets one bucket per warm instance, so this is abuse damping,
// not a hard global guarantee.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  // Prune stale entries so the map doesn't grow unbounded.
  for (const [k, times] of rateBuckets) {
    const fresh = times.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length === 0) rateBuckets.delete(k);
    else rateBuckets.set(k, fresh);
  }
  const times = rateBuckets.get(ip) || [];
  if (times.length >= RATE_LIMIT) return true;
  times.push(now);
  rateBuckets.set(ip, times);
  return false;
}

function clientIp(req) {
  const xff = req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"]);
  if (xff) return String(xff).split(",")[0].trim() || "local";
  return "local";
}

function gh(token, path, init) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init && init.headers),
    },
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    console.log(JSON.stringify({ evt: "book_rate_limited", ip }));
    return res.status(429).json({ error: "rate_limited" });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return res.status(400).json({ error: "invalid_json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "invalid_json" });
  const line = (value, max) => String(value || "").replace(/[\r\n]/g, " ").trim().slice(0, max);
  const name = line(body.name, 120);
  const email = line(body.email, 254).toLowerCase();
  const company = line(body.company, 120);
  const pain = line(body.pain, 2000);
  const slotIso = String(body.slotIso || "").trim();
  // qualified-lead handoff fields (all optional; see SAM-PERSONA.md)
  const phone = line(body.phone, 40);
  const timezone = line(body.timezone, 60);
  const summary = line(body.summary, 600);
  const objections = line(body.objections, 600);
  const highlights = line(body.highlights, 600);
  const idem = line(body.idempotencyKey, 80);
  const fitRaw = String(body.fit || "").trim().toLowerCase();
  const fit = ["high", "medium", "low"].includes(fitRaw) ? fitRaw : "";
  const sessionId = line(body.sessionId, 64);
  const apptType = String(body.type || "discovery").trim().slice(0, 40);
  const durationRaw = Number(body.durationMinutes);
  const durationMinutes = Number.isFinite(durationRaw)
    ? Math.min(240, Math.max(5, Math.round(durationRaw)))
    : 30;

  if (!name || !email || !company || !slotIso || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const slotDate = new Date(slotIso);
  if (isNaN(slotDate.getTime())) return res.status(400).json({ error: "bad_slot" });
  const slotUtc = slotDate.toISOString();
  if (slotDate.getTime() <= Date.now()) return res.status(400).json({ error: "bad_slot" });
  if (timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(slotDate); }
    catch { return res.status(400).json({ error: "bad_timezone" }); }
  }
  let availability;
  try { availability = loadAvailability(); }
  catch { return res.status(503).json({ error: "availability_unavailable" }); }
  if (durationMinutes !== availability.slotMinutes || !openSlots(availability).some((slot) => slot.iso === slotUtc)) {
    return res.status(400).json({ error: "bad_slot" });
  }

  const token = process.env.GITHUB_TOKEN;
  const intake = await verifyPrivateIntake(token);
  if (!intake.ok) {
    console.log(JSON.stringify({ evt: "book_blocked", reason: intake.error }));
    return res.status(503).json({ error: intake.error });
  }
  const intakeRepo = intake.repo;

  // Read every page and fail closed if either reservation or calendar checks fail.
  try {
    const issues = await listBookings(token, intakeRepo);
    for (const issue of issues) {
      const range = bookingRange(issue);
      const iEmail = bookingField(issue.body, "email").toLowerCase();
      const iIdem = bookingField(issue.body, "idem");
      const sameSlot = range.start === slotDate.getTime();
      if ((idem && iIdem === idem && sameSlot && iEmail === email) || (sameSlot && iEmail === email)) {
        return res.status(200).json({ ok: true, id: issue.number, duplicate: true, status: bookingField(issue.body, "booking_status") === "confirmed" ? "confirmed" : "requested", calendar: { added: bookingField(issue.body, "booking_status") === "confirmed" }, confirmationEmail: { sent: false } });
      }
      if (overlaps(slotDate.getTime(), slotDate.getTime() + durationMinutes * 60000, range.start, range.end)) {
        return res.status(409).json({ error: "slot_taken" });
      }
    }
    if (googleCalendarConfigured()) {
      const busy = await getGoogleBusy(slotUtc, new Date(slotDate.getTime() + durationMinutes * 60000).toISOString());
      if (busy.some((b) => overlaps(slotDate.getTime(), slotDate.getTime() + durationMinutes * 60000, Date.parse(b.start), Date.parse(b.end)))) {
        return res.status(409).json({ error: "slot_taken" });
      }
    }
  } catch {
    return res.status(503).json({ error: "availability_unavailable" });
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
    `- duration_minutes: ${durationMinutes}`,
    "- booking_status: requested",
    `- pain: ${pain.replace(/\n/g, " ")}`,
    ...(phone ? [`- phone: ${phone}`] : []),
    ...(timezone ? [`- timezone: ${timezone}`] : []),
    ...(summary ? [`- summary: ${summary.replace(/\n/g, " ")}`] : []),
    ...(objections ? [`- objections: ${objections.replace(/\n/g, " ")}`] : []),
    ...(highlights ? [`- highlights: ${highlights.replace(/\n/g, " ")}`] : []),
    ...(fit ? [`- fit: ${fit}`] : []),
    ...(idem ? [`- idem: ${idem}`] : []),
  ].join("\n");

  // Structured handoff event — the Core Operator parses this JSON block,
  // never the markdown above (SAM-BACKEND-ARCHITECTURE.md).
  const handoffEvent = {
    event_type: "appointment_requested",
    timestamp: new Date().toISOString(),
    lead: {
      name,
      email,
      company,
      ...(phone ? { phone } : {}),
      source: "sam_website",
    },
    appointment: {
      start_time_utc: slotUtc,
      timezone: timezone || "America/New_York",
      type: apptType,
      duration_minutes: durationMinutes,
      status: "requested",
      created_by: "sam",
    },
    conversation_summary: summary || pain || "",
    interest_level: fit || "medium",
    ...(objections ? { objections } : {}),
    ...(highlights ? { conversation_highlights: highlights } : {}),
    ...(sessionId ? { raw_session_id: sessionId } : {}),
  };
  const mdWithEvent =
    md + "\n\n## Handoff event\n\n```json\n" + JSON.stringify(handoffEvent, null, 2) + "\n```\n";

  let r, data;
  try {
  r = await gh(token, `/repos/${intakeRepo}/issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      body: mdWithEvent,
      labels: ["desk-booking", "qualified-lead", ...(fit ? [`fit:${fit}`] : [])],
    }),
  });
  data = await r.json();
  } catch { return res.status(502).json({ error: "intake_failed" }); }
  if (!r.ok || !data.number) {
    console.log(JSON.stringify({ evt: "book_intake_failed", status: r.status , slotUtc }));
    return res.status(502).json({ error: "intake_failed", status: r.status });
  }
  console.log(JSON.stringify({ evt: "book_created", id: data.number , slotUtc, fit }));

  // Calendar is a downstream convenience, not the booking source of truth.
  // The GitHub intake above remains committed even if Google is unavailable.
  let calendar = { ok: false, skipped: true };
  try {
    calendar = await createGoogleBooking({ name, email, company, pain, slotUtc, timezone, durationMinutes });
    console.log(JSON.stringify({ evt: "book_calendar", id: data.number, ok: calendar.ok, skipped: calendar.skipped || false }));
  } catch (err) {
    if (err?.message === "slot_taken") {
      // A concurrent request won the calendar insert. Release our intake hold.
      try { await gh(token, `/repos/${intakeRepo}/issues/${data.number}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) }); }
      catch { console.log(JSON.stringify({ evt: "book_conflict_cleanup_failed", id: data.number })); }
      return res.status(409).json({ error: "slot_taken" });
    }
    calendar = { ok: false, error: "calendar_failed" };
    console.log(JSON.stringify({ evt: "book_calendar", id: data.number, ok: false, error: String(err && err.message || err) }));
  }

  const status = calendar.ok ? "confirmed" : "requested";
  if (calendar.ok) {
    handoffEvent.event_type = "appointment_booked";
    handoffEvent.appointment.status = "booked";
    const confirmedBody = md.replace("- booking_status: requested", "- booking_status: confirmed") + "\n\n## Handoff event\n\n```json\n" + JSON.stringify(handoffEvent, null, 2) + "\n```\n";
    try {
      const updated = await gh(token, `/repos/${intakeRepo}/issues/${data.number}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: confirmedBody }) });
      if (!updated.ok) console.log(JSON.stringify({ evt: "book_status_sync_failed", id: data.number }));
    } catch { console.log(JSON.stringify({ evt: "book_status_sync_failed", id: data.number })); }
  }
  // Await the bounded provider call so a serverless response cannot discard it.
  const notification = await sendBookingConfirmation({ name, email, company, slotUtc, timezone, status });
  return res.status(200).json({
    ok: true,
    id: data.number,
    status,
    confirmationEmail: { sent: notification.ok === true },
    calendar: calendar.ok ? { added: true, meetLink: calendar.meetLink || "" } : { added: false },
  });
}
