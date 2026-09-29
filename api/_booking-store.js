/** Private booking records. Fail closed: unavailable records are not free time. */
export function bookingField(body, key) {
  const match = String(body || "").match(new RegExp(`^- ${key}: (.*)$`, "m"));
  return match ? match[1].trim() : "";
}

export async function listBookings(token, repo) {
  const all = [];
  const deadline = Date.now() + 10_000;
  for (let page = 1; page <= 100; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("availability_unavailable");
    const response = await fetch(`https://api.github.com/repos/${repo}/issues?labels=desk-booking&state=open&per_page=100&page=${page}`, {
      signal: AbortSignal.timeout(Math.min(8000, remaining)),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error("availability_unavailable");
    const issues = await response.json();
    if (!Array.isArray(issues)) throw new Error("availability_unavailable");
    all.push(...issues.filter((issue) => !issue.pull_request));
    if (issues.length < 100) return all;
  }
  throw new Error("availability_unavailable");
}

export function bookingRange(issue) {
  const body = issue?.body;
  const start = Date.parse(bookingField(body, "slot_utc") || bookingField(body, "slot_iso"));
  const duration = bookingField(body, "duration_minutes");
  // Legacy records omitted duration and represented 30-minute appointments.
  // A present but invalid value must never turn a reservation into free time.
  const minutes = duration === "" ? 30 : Number(duration);
  const end = start + minutes * 60000;
  if (!Number.isFinite(start) || !Number.isInteger(minutes) || minutes <= 0 ||
      !Number.isFinite(end) || !Number.isFinite(new Date(end).getTime())) {
    throw new Error("availability_unavailable");
  }
  return { start, end };
}
