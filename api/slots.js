import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyPrivateIntake } from "./private-intake.js";

function load() {
  return JSON.parse(readFileSync(join(process.cwd(), "availability.json"), "utf8"));
}
function overlaps(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }

export function openSlots(data, now = Date.now()) {
  const busy = (data.busy || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
  const end = Date.parse(data.rangeEnd + "T23:59:59-04:00");
  const out = [];
  const startDay = new Date();
  startDay.setHours(0, 0, 0, 0);
  for (let day = 0; day < 21; day++) {
    const cur = new Date(startDay.getTime() + day * 86400000);
    if (!data.weekdays.includes(cur.getDay())) continue;
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const da = String(cur.getDate()).padStart(2, "0");
    for (let h = data.hours.start; h < data.hours.end; h++) {
      for (let min = 0; min < 60; min += data.slotMinutes) {
        const start = Date.parse(`${y}-${m}-${da}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00-04:00`);
        const stop = start + data.slotMinutes * 60000;
        if (start < now || start > end) continue;
        if (busy.some(([b0, b1]) => overlaps(start, stop, b0, b1))) continue;
        out.push({ start, iso: new Date(start).toISOString() });
      }
    }
  }
  return out;
}

function field(issueBody, key) {
  const m = String(issueBody || "").match(new RegExp(`^- ${key}: (.*)$`, "m"));
  return m ? m[1].trim() : "";
}

// Returns a Set of booked slot start times (ms since epoch, UTC instants)
// taken by open desk-booking intake issues. On any failure (no token, HTTP
// error, network error) returns an empty Set so the calendar never breaks.
export async function bookedStarts() {
  const token = process.env.GITHUB_TOKEN;
  const intake = await verifyPrivateIntake(token);
  if (!intake.ok) {
    console.log(JSON.stringify({ evt: "slots_booked_filter_skipped", reason: intake.error }));
    return new Set();
  }
  try {
    const r = await fetch(
      `https://api.github.com/repos/${intake.repo}/issues?labels=desk-booking&state=open&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!r.ok) {
      console.log(JSON.stringify({ evt: "slots_booked_filter_skipped", reason: "http", status: r.status }));
      return new Set();
    }
    const issues = await r.json();
    const taken = new Set();
    for (const issue of Array.isArray(issues) ? issues : []) {
      const iSlot = field(issue.body, "slot_utc") || field(issue.body, "slot_iso");
      const t = Date.parse(iSlot);
      if (iSlot && !isNaN(t)) taken.add(t);
    }
    return taken;
  } catch (e) {
    console.log(JSON.stringify({ evt: "slots_booked_filter_skipped", reason: "fetch_failed" }));
    return new Set();
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  try {
    const data = load();
    const taken = await bookedStarts();
    const slots = openSlots(data).filter((s) => !taken.has(s.start));
    res.status(200).json({ timezone: data.timezone, slotMinutes: data.slotMinutes, count: slots.length, slots });
  } catch (e) {
    res.status(500).json({ error: "slots_failed" });
  }
}
