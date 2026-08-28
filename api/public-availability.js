/** Static availability is server input only and must never be served publicly. */
export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ error: "not_found" });
}
