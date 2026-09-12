/** Authenticated Vapi function tools. A deployed endpoint is not a connected telephone line. */
import { timingSafeEqual, createHash } from 'node:crypto';
import slots from './slots.js';
import book from './book.js';
import message from './message.js';
import '../sam-knowledge.js';

function authorized(req) {
  const secret = process.env.SAM_PHONE_WEBHOOK_SECRET || '';
  const supplied = String(req.headers?.authorization || '');
  const expected = 'Bearer ' + secret;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return secret.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}
async function invoke(handler, req) {
  let code = 200, body;
  await handler(req, { setHeader() {}, status(n) { code = n; return this; }, json(data) { body = data; return this; }, end() {} });
  return { code, body };
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.SAM_PHONE_WEBHOOK_SECRET) return res.status(503).json({ error: 'phone_not_configured' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'invalid_json' }); }
  const msg = body?.message;
  const calls = msg?.toolCallList;
  if (msg?.type !== 'tool-calls' || !Array.isArray(calls) || !calls.length || calls.length > 4 || calls.some(c => !c || typeof c.id !== 'string' || c.id.length > 200)) return res.status(400).json({ error: 'invalid_tools' });
  const callId = typeof msg.call?.id === 'string' ? msg.call.id.slice(0, 200) : '';
  const results = [];
  // Sequential: a write must complete before another action observes availability.
  for (const tool of calls) {
    let result;
    try {
      const name = tool.name || tool.function?.name;
      const raw = tool.arguments ?? tool.function?.arguments ?? {};
      const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid_arguments');
      const headers = { 'x-forwarded-for': 'phone-' + createHash('sha256').update(callId || 'unknown').digest('hex').slice(0, 24) };
      if (name === 'check_availability') {
        const out = await invoke(slots, { method: 'GET', headers });
        const validDate = !args.date || /^\d{4}-\d{2}-\d{2}$/.test(args.date);
        if (!validDate) result = { ok: false, error: 'invalid_date' };
        else if (out.code !== 200) result = { ok: false, error: 'availability_unavailable', instruction: 'Do not invent openings. Offer to take a message only if the message tool succeeds.' };
        else {
          const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: out.body.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
          const offered = out.body.slots.filter(s => !args.date || fmt.format(new Date(s.iso)) === args.date);
          const bookingMode = out.body.bookingMode === 'calendar' ? 'calendar' : 'request';
          result = { ok: true, timezone: out.body.timezone, slotMinutes: out.body.slotMinutes, bookingMode, slots: offered.slice(0, 8), moreAvailable: offered.length > 8,
            instruction: bookingMode === 'request' ? 'Offer these as preferred appointment times. Requests need team confirmation; do not call them confirmed appointments.' : 'Availability is checked again when submitting. Confirm only if request_appointment returns confirmed.' };
        }
      } else if (name === 'request_appointment' || name === 'leave_message') {
        if (!callId || args.confirmedByCaller !== true) result = { ok: false, error: 'caller_confirmation_required', instruction: 'Read the details back and obtain the caller’s explicit approval before submitting.' };
        else {
          const key = createHash('sha256').update(callId + ':' + tool.id).digest('hex');
          const payload = name === 'request_appointment'
            ? { name: args.name, email: args.email, company: args.company, phone: args.phone, pain: args.pain, slotIso: args.slotIso, timezone: args.timezone, idempotencyKey: key, type: 'discovery' }
            : { name: args.name, company: args.company, contact: args.contact, contactKind: args.contactKind, message: args.message, team: args.team, urgent: args.urgent, page: 'sam-telephone', idempotencyKey: key };
          const out = await invoke(name === 'request_appointment' ? book : message, { method: 'POST', body: payload, headers });
          result = out.code === 200 ? { ...out.body, instruction: name === 'request_appointment' && out.body.status !== 'confirmed' ? 'This is a request awaiting team confirmation, not a confirmed appointment.' : 'Describe only the action confirmed by this result.' } : { ok: false, error: out.body?.error || 'submission_failed', instruction: 'Do not claim this was saved, booked or emailed. Explain the failure and offer a retry.' };
        }
      } else if (name === 'company_information') {
        result = { ok: true, reply: globalThis.SamKnowledge.answer(String(args.question || '').slice(0, 800)).reply };
      } else result = { ok: false, error: 'unknown_tool' };
    } catch { result = { ok: false, error: 'tool_failed', instruction: 'Do not claim success. Ask the caller to try again.' }; }
    results.push({ toolCallId: tool.id, result: JSON.stringify(result) });
  }
  return res.status(200).json({ results });
}
