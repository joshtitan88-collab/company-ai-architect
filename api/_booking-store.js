/** Private booking records. Fail closed: unavailable records are not free time. */
export function bookingField(body, key) {
  const match = String(body || "").match(new RegExp(`^- ${key}: (.*)$`, "m"));
  return match ? match[1].trim() : "";
}

export async function listBookings(token, repo) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues?labels=desk-booking&state=open&per_page=100&page=${page}`, {
      signal: AbortSignal.timeout(8000),
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
  const start = Date.parse(bookingField(issue.body, "slot_utc") || bookingField(issue.body, "slot_iso"));
  const minutes = Number(bookingField(issue.body, "duration_minutes")) || 30;
  return { start, end: start + minutes * 60000 };
}
