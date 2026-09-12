import assert from 'node:assert/strict';
import '../desk-messages.js';
import message from '../api/message.js';
import book from '../api/book.js';
import phone from '../api/phone-tools.js';
import messageNlu from '../api/message-nlu.js';
import { openSlots, loadAvailability } from '../api/slots.js';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const draft = () => Object.assign(SamMessages.createSession(), {
  state: 'confirm', name: 'Test Visitor', company: 'Example',
  contact: { kind: 'email', value: 'old@example.com' }, message: 'Please send a quote',
});
const reply = (out, status = 200) => ({ ok: status < 400, status, json: async () => out });
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log(`PASS ${name}`); };
let request = 0;
const call = async body => {
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(out) { this.out = out; return this; } };
  await message({ method: 'POST', headers: { 'x-forwarded-for': `message-test-${++request}` }, body }, res);
  return res;
};
try {
  await check('email corrections preserve message and require fresh confirmation', () => {
    for (const text of ['Actually use new@example.com', 'No, use new@example.com', 'Yes, but use new@example.com']) {
      const s = draft(); const result = SamMessages.turn(s, text);
      assert.equal(result.action, 'none'); assert.equal(s.state, 'confirm');
      assert.equal(s.contact.value, 'new@example.com'); assert.equal(s.message, 'Please send a quote');
    }
  });
  await check('identity and company corrections preserve message and contact', () => {
    const s = draft(); SamMessages.turn(s, 'My name is Jane Visitor'); SamMessages.turn(s, 'My company is New Company');
    assert.equal(s.name, 'Jane Visitor'); assert.equal(s.company, 'New Company');
    assert.equal(s.message, 'Please send a quote'); assert.equal(s.contact.value, 'old@example.com');
  });
  await check('smart corrections work locally without provider request', async () => {
    global.fetch = async () => { throw Error('must not call provider'); };
    const s = draft(); const result = await SamMessages.turnSmart(s, 'Use new@example.com instead');
    assert.equal(result.action, 'none'); assert.equal(s.contact.value, 'new@example.com'); assert.equal(s.message, 'Please send a quote');
  });
  await check('model identity correction does not overwrite message with correction instruction', async () => {
    global.fetch = async () => reply({ ok: true, name: 'Jane Visitor', message: 'It should be Jane Visitor' });
    const s = draft(); await SamMessages.turnSmart(s, 'It should be Jane Visitor');
    assert.equal(s.name, 'Jane Visitor'); assert.equal(s.message, 'Please send a quote');
  });
  await check('a second explicit message starts cleanly without stale identity', () => {
    const s = draft(); s.state = 'done';
    const result = SamMessages.turn(s, 'Leave a message about an installation problem');
    assert.equal(s.state, 'collect'); assert.equal(s.message, 'an installation problem');
    assert.equal(s.name, ''); assert.equal(s.company, ''); assert.equal(s.contact, null);
    assert.equal(result.reply, SamMessages.LINES.need_name);
  });
  await check('cancel and unchanged response-loss retry retain their intended behavior', () => {
    let s = draft(); SamMessages.turn(s, 'cancel'); assert.equal(s.state, 'idle'); assert.equal(s.message, '');
    s = draft(); assert.equal(SamMessages.turn(s, 'yes').action, 'submit_message');
    SamMessages.markSubmitted(s, false); assert.equal(SamMessages.turn(s, 'try again').action, 'submit_message');
  });
  await check('qualified yes never authorizes an immediate message submission', () => {
    const s = draft(); assert.equal(SamMessages.turn(s, "Yes, but don't send it yet").action, 'none');
    assert.equal(s.state, 'confirm'); assert.equal(s.message, 'Please send a quote');
    assert.equal(SamMessages.turn(draft(), 'Yes, please').action, 'submit_message');
  });
  await check('aborting message extraction cannot mutate the draft afterward', async () => {
    const controller = new AbortController(); const s = draft(); const before = JSON.stringify(s);
    global.fetch = async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    const pending = SamMessages.turnSmart(s, 'Change what I said', { signal: controller.signal });
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(JSON.stringify(s), before);
  });

  process.env.GITHUB_TOKEN = 'test-token'; process.env.INTAKE_REPO = 'example/private';
  const body = { name: 'Test Visitor', contact: 'test@example.com', message: 'Please send a quote', idempotencyKey: 'test-message-1' };
  await check('phone intake rejects punctuation without enough digits', async () => {
    global.fetch = async () => { throw Error('must not reach intake'); };
    const r = await call({ ...body, contactKind: 'phone', contact: '--------' }); assert.equal(r.code, 400);
  });
  await check('lost successful response followed by retry creates only one private message', async () => {
    const records = []; let writes = 0;
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/repos/example/private')) return reply({ private: true });
      if (String(url).includes('/issues?')) return reply(records);
      writes++; records.push({ number: 19, body: JSON.parse(init.body).body });
      throw Error('connection lost after commit');
    };
    assert.equal((await call(body)).code, 502);
    const retried = await call(body); assert.equal(retried.code, 200); assert.equal(retried.out.id, 19); assert.equal(retried.out.duplicate, true); assert.equal(writes, 1);
    const changed = await call({ ...body, message: 'Different message' }); assert.equal(changed.code, 409); assert.equal(writes, 1);
  });
  await check('message deduplication reads later pages and includes closed records', async () => {
    let posted;
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/repos/example/private')) return reply({ private: true });
      if (String(url).includes('/issues?')) return reply([]);
      posted = JSON.parse(init.body); return reply({ number: 20 }, 201);
    };
    assert.equal((await call(body)).code, 200);
    let pages = 0;
    global.fetch = async url => {
      if (String(url).endsWith('/repos/example/private')) return reply({ private: true });
      assert(String(url).includes('state=all')); pages++;
      return reply(String(url).includes('page=2') ? [{ number: 20, state: 'closed', body: posted.body }] : Array.from({ length: 100 }, (_, i) => ({ number: i + 30, body: '' })));
    };
    assert.equal((await call(body)).out.id, 20); assert.equal(pages, 2);
  });
  await check('retry lookup failure never blindly creates a duplicate', async () => {
    let writes = 0;
    global.fetch = async (url, init) => {
      if (init?.method === 'POST') writes++;
      return String(url).endsWith('/repos/example/private') ? reply({ private: true }) : reply({}, 503);
    };
    assert.equal((await call(body)).code, 503); assert.equal(writes, 0);
  });
  await check('message content cannot impersonate trusted retry metadata', async () => {
    let saved;
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/repos/example/private')) return reply({ private: true });
      if (String(url).includes('/issues?')) return reply([]);
      saved = JSON.parse(init.body).body; return reply({ number: 21 }, 201);
    };
    await call(body);
    let writes = 0;
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/repos/example/private')) return reply({ private: true });
      if (String(url).includes('/issues?')) return reply([{ number: 999, body: 'Message record\n\n## Message\n\n' + saved }]);
      writes++; return reply({ number: 22 }, 201);
    };
    const out = await call(body); assert.equal(out.out.id, 22); assert.equal(writes, 1);
  });
  await check('message retry lookup has a total time budget across pagination', async () => {
    const originalNow = Date.now; let now = originalNow(); let pages = 0; let writes = 0;
    Date.now = () => now;
    try {
      global.fetch = async (url, init) => {
        if (String(url).endsWith('/repos/example/private')) return reply({ private: true });
        if (init?.method === 'POST') writes++;
        pages++; now += 10001; return reply(Array.from({ length: 100 }, (_, i) => ({ number: i, body: '' })));
      };
      assert.equal((await call(body)).code, 503); assert.equal(pages, 1); assert.equal(writes, 0);
    } finally { Date.now = originalNow; }
  });
  await check('message classifier shares one bounded deadline across providers', async () => {
    process.env.SAM_DISABLE_OLLAMA = '1'; process.env.XAI_API_KEY = 'test'; process.env.OPENAI_API_KEY = 'test'; delete process.env.ANTHROPIC_API_KEY;
    const originalTimeout = AbortSignal.timeout; const controller = new AbortController(); let calls = 0;
    AbortSignal.timeout = ms => { assert.equal(ms, 8000); return controller.signal; };
    try {
      global.fetch = async (_url, init) => { calls++; assert.equal(init.signal, controller.signal); controller.abort(); throw new DOMException('aborted', 'AbortError'); };
      const r = { setHeader() {}, status(code) { this.code = code; return this; }, json(out) { this.out = out; return this; } };
      await messageNlu({ method: 'POST', body: { text: 'Please leave a message' } }, r);
      assert.equal(calls, 1); assert.equal(r.out.ok, false);
    } finally { AbortSignal.timeout = originalTimeout; }
  });
  await check('telephone availability explains request mode before collecting an appointment', async () => {
    for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) delete process.env[key];
    process.env.SAM_PHONE_WEBHOOK_SECRET = 'x'.repeat(40);
    global.fetch = async url => String(url).endsWith('/repos/example/private') ? reply({ private: true }) : reply([]);
    const r = { setHeader() {}, status(code) { this.code = code; return this; }, json(out) { this.out = out; return this; } };
    await phone({ method: 'POST', headers: { authorization: 'Bearer ' + process.env.SAM_PHONE_WEBHOOK_SECRET }, body: { message: { type: 'tool-calls', call: { id: 'test-call' }, toolCallList: [{ id: 'test-tool', name: 'check_availability', arguments: {} }] } } }, r);
    const result = JSON.parse(r.out.results[0].result);
    assert.equal(result.bookingMode, 'request'); assert(result.slots.length > 0); assert.match(result.instruction, /need team confirmation/);
  });
  await check('calendar failure diagnostics redact provider detail and report failed conflict cleanup', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test'; process.env.GOOGLE_CLIENT_SECRET = 'test'; process.env.GOOGLE_REFRESH_TOKEN = 'test';
    delete process.env.RESEND_API_KEY;
    const originalLog = console.log; const logs = []; console.log = (...args) => logs.push(args);
    try {
      for (const conflict of [false, true]) {
        global.fetch = async (url, init) => {
          url = String(url);
          if (url.endsWith('/repos/example/private')) return reply({ private: true });
          if (url.includes('/issues?')) return reply([]);
          if (url.includes('oauth2')) return reply({ access_token: 'test', expires_in: 3600 });
          if (url.includes('/freeBusy')) return reply({ calendars: { primary: { busy: [] } } });
          if (url.includes('/events?')) { if (conflict) return reply({}, 409); throw Error('Bearer secret-token visitor@example.com'); }
          if (init.method === 'PATCH') return reply({}, 503);
          return reply({ number: 8 }, 201);
        };
        const r = { setHeader() {}, status(code) { this.code = code; return this; }, json(out) { this.out = out; return this; } };
        await book({ method: 'POST', headers: { 'x-forwarded-for': `book-log-${++request}` }, body: { name: 'Test', email: 'test@example.com', company: 'Example', slotIso: openSlots(loadAvailability())[0].iso } }, r);
        assert.equal(r.code, conflict ? 409 : 200);
      }
      assert(!JSON.stringify(logs).includes('secret-token')); assert(!JSON.stringify(logs).includes('visitor@example.com'));
      assert(JSON.stringify(logs).includes('book_conflict_cleanup_failed'));
    } finally { console.log = originalLog; }
  });
} finally {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}
console.log(`${count} message correction and retry checks passed.`);
