import assert from 'node:assert/strict';
import book from '../api/book.js';
import message from '../api/message.js';
import slots, { openSlots, loadAvailability } from '../api/slots.js';
import { listBookings } from '../api/booking-store.js';
import { getGoogleBusy, createGoogleBooking } from '../api/google-calendar.js';
import '../desk-messages.js';
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
let tests = 0, request = 0;
const response = (out, status = 200) => ({ ok: status < 400, status, json: async () => out });
const res = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(out) { this.out = out; return this; }, end() {} });
const call = async (handler, body, method = 'POST') => { const r = res(); await handler({ method, body, headers: { 'x-forwarded-for': `test-${++request}` } }, r); return r; };
const check = (name, fn) => Promise.resolve().then(fn).then(() => { tests++; console.log(`PASS ${name}`); });
try {
  process.env.GITHUB_TOKEN = 'test-token'; process.env.INTAKE_REPO = 'example/private';
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'RESEND_API_KEY']) delete process.env[key];
  const offered = openSlots(loadAvailability())[0].iso;
  const payload = { name: 'Test Visitor', email: 'test@example.com', company: 'Example', slotIso: offered, timezone: 'America/New_York' };
  const mockIntake = (records = [], postStatus = 201) => {
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/repos/example/private')) return response({ private: true });
      if (String(url).includes('/issues?')) return response(records);
      return response({ number: 7 }, postStatus);
    };
  };
  await check('malformed JSON returns 400 for both intake endpoints', async () => {
    assert.equal((await call(book, '{')).code, 400); assert.equal((await call(message, '{')).code, 400);
  });
  await check('past and off-grid appointments rejected', async () => {
    assert.equal((await call(book, { ...payload, slotIso: '2020-01-01T15:00:00Z' })).code, 400);
    assert.equal((await call(book, { ...payload, slotIso: new Date(Date.parse(offered) + 60000).toISOString() })).code, 400);
  });
  await check('private-intake outage never advertises available slots', async () => {
    global.fetch = async () => { throw Error('offline'); };
    assert.equal((await call(slots, {}, 'GET')).code, 503);
    assert.equal((await call(book, payload)).code, 503);
  });
  await check('public repository blocks all intake', async () => {
    global.fetch = async () => response({ private: false });
    assert.equal((await call(book, payload)).code, 503);
    assert.equal((await call(message, { name: 'Test', contact: 'test@example.com', message: 'Please call' })).code, 503);
  });
  await check('booking-list HTTP failure blocks booking writes', async () => {
    global.fetch = async (url) => String(url).endsWith('/repos/example/private') ? response({ private: true }) : response({}, 403);
    assert.equal((await call(book, payload)).code, 503);
  });
  await check('uncalendarized intake is honestly a request', async () => {
    mockIntake(); const r = await call(book, payload);
    assert.equal(r.code, 200); assert.equal(r.out.status, 'requested'); assert.equal(r.out.calendar.added, false); assert.equal(r.out.confirmationEmail.sent, false);
  });
  await check('another visitor cannot use an idempotency key to claim a booking', async () => {
    mockIntake([{ number: 8, body: `- slot_utc: ${offered}\n- email: original@example.com\n- idem: shared` }]);
    assert.equal((await call(book, { ...payload, idempotencyKey: 'shared' })).code, 409);
  });
  await check('pagination retains bookings beyond page one', async () => {
    let pages = 0;
    global.fetch = async (url) => { pages++; return response(String(url).includes('page=2') ? [{ number: 101 }] : Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }))); };
    assert.equal((await listBookings('test', 'example/private')).length, 101); assert.equal(pages, 2);
  });
  await check('business hours follow New York daylight saving transition', () => {
    const schedule = { ...loadAvailability(), rangeEnd: '2027-12-31' };
    const out = openSlots(schedule, Date.parse('2026-10-30T00:00:00Z'));
    assert(out.some(s => s.iso === '2026-10-30T13:00:00.000Z'));
    assert(out.some(s => s.iso === '2026-11-02T14:00:00.000Z'));
    assert(!out.some(s => s.iso === '2026-11-02T13:00:00.000Z'));
  });
  await check('failed message submission retains retryable fields without false success', () => {
    const s = SamMessages.createSession(); Object.assign(s, { state: 'confirm', name: 'Test', contact: { kind: 'email', value: 'test@example.com' }, message: 'Please send a quote' });
    const turn = SamMessages.turn(s, 'yes'); assert.equal(turn.action, 'submit_message'); assert.equal(s.state, 'sending'); assert(!turn.reply.includes('All set'));
    SamMessages.markSubmitted(s, false); assert.equal(s.state, 'confirm'); assert.equal(SamMessages.turn(s, 'try again').action, 'submit_message');
    SamMessages.markSubmitted(s, true); assert.equal(s.state, 'done');
  });
  await check('message provider failure yields structured error', async () => {
    global.fetch = async (url) => { if (String(url).endsWith('/repos/example/private')) return response({ private: true }); throw Error('down'); };
    assert.equal((await call(message, { name: 'Test', contact: 'test@example.com', message: 'Please send a quote' })).code, 502);
  });
  await check('Google per-calendar errors never mean free availability', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test'; process.env.GOOGLE_CLIENT_SECRET = 'test'; process.env.GOOGLE_REFRESH_TOKEN = 'test';
    global.fetch = async (url) => String(url).includes('oauth2') ? response({ access_token: 'test', expires_in: 3600 }) : response({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } });
    await assert.rejects(() => getGoogleBusy(offered, offered), /google_freebusy_failed/);
  });
  await check('calendar uses stable IDs and requested duration; conflict rejected', async () => {
    let event;
    global.fetch = async (_url, init) => { event = JSON.parse(init.body); return response({ id: 'event' }); };
    await createGoogleBooking({ ...payload, slotUtc: offered, durationMinutes: 30 });
    assert.match(event.id, /^[a-f0-9]{64}$/); assert.equal(Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime), 1800000);
    global.fetch = async () => response({}, 409);
    await assert.rejects(() => createGoogleBooking({ ...payload, slotUtc: offered }), /slot_taken/);
  });
} finally { global.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); }
console.log(`${tests} reception reliability checks passed.`);
