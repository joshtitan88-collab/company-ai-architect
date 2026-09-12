import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyPrivateIntake } from "./private-intake.js";
import { getGoogleBusy, googleCalendarConfigured } from "./google-calendar.js";
import { listBookings, bookingRange } from "./booking-store.js";

export function loadAvailability() {
  return JSON.parse(readFileSync(join(process.cwd(), "availability.json"), "utf8"));
}
export function overlaps(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }

// Convert a business-local wall clock to UTC using the zone's actual DST offset.
function wallTimeUtc(year, month, day, hour, minute, timezone) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    const displayed = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    instant += target - displayed;
  }
  return instant;
}

export function openSlots(data, now = Date.now()) {
  const timezone = data.timezone || "America/New_York";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now)).map(({ type, value }) => [type, value]));
  const firstDay = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  const busy = (data.busy || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
  const minutes = Number(data.slotMinutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 240) throw new Error("invalid_schedule");
  const out = [];
  for (let day = 0; day < 21; day++) {
    const cur = new Date(firstDay + day * 86400000);
    if (!data.weekdays.includes(cur.getUTCDay())) continue;
    const dateKey = cur.toISOString().slice(0, 10);
    if (data.rangeEnd && dateKey > data.rangeEnd) continue;
    for (let minute = data.hours.start * 60; minute + minutes <= data.hours.end * 60; minute += minutes) {
      const start = wallTimeUtc(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate(), Math.floor(minute / 60), minute % 60, timezone);
      const stop = start + minutes * 60000;
      if (start <= now || busy.some(([b0, b1]) => overlaps(start, stop, b0, b1))) continue;
      out.push({ start, iso: new Date(start).toISOString() });
    }
  }
  return out;
}

export async function bookedStarts() {
  const token = process.env.GITHUB_TOKEN;
  const intake = await verifyPrivateIntake(token);
  if (!intake.ok) throw new Error(intake.error);
  return new Set((await listBookings(token, intake.repo)).map((issue) => bookingRange(issue).start).filter(Number.isFinite));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  try {
    const data = loadAvailability();
    const intake = await verifyPrivateIntake(process.env.GITHUB_TOKEN);
    if (!intake.ok) return res.status(503).json({ error: "availability_unavailable" });
    const records = await listBookings(process.env.GITHUB_TOKEN, intake.repo);
    const reserved = records.map(bookingRange).filter((range) => Number.isFinite(range.start));
    if (googleCalendarConfigured()) {
      const liveBusy = await getGoogleBusy(new Date().toISOString(), new Date(Date.now() + 21 * 86400000).toISOString());
      data.busy = [...(data.busy || []), ...liveBusy];
    }
    const slots = openSlots(data).filter((s) => !reserved.some((r) => overlaps(s.start, s.start + data.slotMinutes * 60000, r.start, r.end)));
    return res.status(200).json({ timezone: data.timezone, slotMinutes: data.slotMinutes, count: slots.length, slots });
  } catch {
    return res.status(503).json({ error: "availability_unavailable" });
  }
}
