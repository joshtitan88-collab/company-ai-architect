/** Short microphone clips -> xAI transcription. Audio and transcripts are never logged. */
const MAX_AUDIO = 1024 * 1024;
const formats = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
const buckets = new Map();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'HEAD') return res.status(process.env.XAI_API_KEY ? 200 : 501).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.XAI_API_KEY) return res.status(501).json({ error: 'stt_not_configured' });
  // Best-effort abuse damping per warm instance, not a distributed quota.
  const now = Date.now();
  for (const [key, b] of buckets) if (b.until <= now) buckets.delete(key);
  const ip = String(req.headers?.['x-forwarded-for'] || 'local').split(',')[0].trim();
  const bucket = buckets.get(ip) || { until: now + 60000, count: 0 };
  if (++bucket.count > 12) return res.status(429).json({ error: 'rate_limited' });
  buckets.set(ip, bucket);
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'invalid_json' }); }
  const encoded = body?.audioBase64;
  const mime = String(body?.mimeType || '').split(';')[0].toLowerCase();
  if (!formats[mime]) return res.status(415).json({ error: 'unsupported_audio' });
  if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return res.status(400).json({ error: 'invalid_audio' });
  if (encoded.length > Math.ceil(MAX_AUDIO / 3) * 4) return res.status(413).json({ error: 'audio_too_large' });
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_AUDIO) return res.status(413).json({ error: 'audio_too_large' });
  const form = new FormData();
  form.append('format', 'true'); form.append('language', 'en'); form.append('keyterm', 'Company AI Architect');
  form.append('file', new Blob([bytes], { type: mime }), 'speech.' + formats[mime]);
  try {
    const response = await fetch('https://api.x.ai/v1/stt', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.XAI_API_KEY },
      body: form, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      console.error('[sam.stt]', JSON.stringify({ code: 'provider_rejected', status: response.status }));
      return res.status(502).json({ error: 'stt_unavailable' });
    }
    const result = await response.json();
    if (typeof result.text !== 'string') throw new Error('invalid_response');
    return res.status(200).json({ ok: true, text: result.text.trim().slice(0, 800) });
  } catch {
    console.error('[sam.stt]', JSON.stringify({ code: 'transcription_failed' }));
    return res.status(502).json({ error: 'stt_unavailable' });
  }
}
