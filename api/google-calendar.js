/** Google Calendar OAuth helper. All credentials remain server-side. */
let cached = { token: "", expiresAt: 0 };

export function googleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

async function accessToken() {
  if (cached.token && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!googleCalendarConfigured()) throw new Error("google_calendar_not_configured");
  const form = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error("google_token_failed");
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
  };
  return cached.token;
}

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || "primary";
}

export async function getGoogleBusy(timeMin, timeMax) {
  if (!googleCalendarConfigured()) return [];
  const token = await accessToken();
  const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId() }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("google_freebusy_failed");
  const cal = data.calendars && data.calendars[calendarId()];
  return Array.isArray(cal && cal.busy) ? cal.busy : [];
}

export async function createGoogleBooking({ name, email, company, pain, slotUtc, timezone }) {
  if (!googleCalendarConfigured()) return { ok: false, skipped: true };
  const token = await accessToken();
  const start = new Date(slotUtc);
  const end = new Date(start.getTime() + 30 * 60_000);
  const requestId = `sam-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const event = {
    summary: `Discovery — ${company}`,
    description: [`Booked by Sam`, `Visitor: ${name}`, pain ? `Need: ${pain}` : ""].filter(Boolean).join("\n"),
    start: { dateTime: start.toISOString(), timeZone: timezone || "America/New_York" },
    end: { dateTime: end.toISOString(), timeZone: timezone || "America/New_York" },
    attendees: [{ email, displayName: name }],
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  };
  const qs = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId())}/events?${qs}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.id) throw new Error("google_event_failed");
  return { ok: true, id: data.id, htmlLink: data.htmlLink || "", meetLink: data.hangoutLink || "" };
}
