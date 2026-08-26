import { readFileSync } from "node:fs";
import { join } from "node:path";

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

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  try {
    const data = load();
    const slots = openSlots(data);
    res.status(200).json({ timezone: data.timezone, slotMinutes: data.slotMinutes, count: slots.length, slots });
  } catch (e) {
    res.status(500).json({ error: "slots_failed" });
  }
}
