import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import stt from '../api/stt.js';
import phone from '../api/phone-tools.js';
const originalFetch = global.fetch;
const env = { ...process.env };
let request = 0;
const call = async (handler, body, method = 'POST', headers = {}) => {
  const r = { code: 200, setHeader() {}, status(n) { this.code = n; return this; }, json(out) { this.out = out; return this; }, end() {} };
  await handler({ method, body, headers: { 'x-forwarded-for': 'test-' + ++request, ...headers } }, r); return r;
};
try {
  delete process.env.XAI_API_KEY;
  assert.equal((await call(stt, null, 'HEAD')).code, 501);
  process.env.XAI_API_KEY = 'test';
  assert.equal((await call(stt, null, 'HEAD')).code, 200);
  assert.equal((await call(stt, '{')).code, 400);
  assert.equal((await call(stt, { mimeType: 'text/html', audioBase64: 'YQ==' })).code, 415);
  assert.equal((await call(stt, { mimeType: 'audio/webm', audioBase64: '!' })).code, 400);
  assert.equal((await call(stt, { mimeType: 'audio/webm', audioBase64: Buffer.alloc(1048577).toString('base64') })).code, 413);
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.x.ai/v1/stt');
    assert.equal([...init.body.keys()].at(-1), 'file');
    assert.equal(init.headers.Authorization, 'Bearer test');
    return new Response(JSON.stringify({ text: ' Book a discovery. ' }));
  };
  assert.deepEqual((await call(stt, { mimeType: 'audio/mp4', audioBase64: 'YQ==' })).out, { ok: true, text: 'Book a discovery.' });
  global.fetch = async () => new Response('{}', { status: 403 });
  assert.equal((await call(stt, { mimeType: 'audio/webm', audioBase64: 'YQ==' })).code, 502);
  console.log('PASS transcription validation, size limits, provider contract and safe failures');
  delete process.env.SAM_PHONE_WEBHOOK_SECRET;
  assert.equal((await call(phone, {})).code, 503);
  process.env.SAM_PHONE_WEBHOOK_SECRET = 'x'.repeat(40);
  assert.equal((await call(phone, {})).code, 401);
  const headers = { authorization: 'Bearer ' + process.env.SAM_PHONE_WEBHOOK_SECRET };
  const body = (name, args = {}) => ({ message: { type: 'tool-calls', call: { id: 'test-call' }, toolCallList: [{ id: 'test-tool', name, arguments: args }] } });
  global.fetch = async () => { throw Error('No network expected'); };
  let out = await call(phone, body('request_appointment'), 'POST', headers);
  assert.equal(JSON.parse(out.out.results[0].result).error, 'caller_confirmation_required');
  out = await call(phone, body('company_information', { question: 'How much is discovery?' }), 'POST', headers);
  assert.match(JSON.parse(out.out.results[0].result).reply, /free/);
  out = await call(phone, body('delete_records'), 'POST', headers);
  assert.equal(JSON.parse(out.out.results[0].result).error, 'unknown_tool');
  delete process.env.INTAKE_REPO;
  out = await call(phone, body('check_availability'), 'POST', headers);
  assert.equal(JSON.parse(out.out.results[0].result).error, 'availability_unavailable');
  console.log('PASS telephone auth, approved tool allowlist, caller confirmation and outage behavior');
} finally {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
}

// Cancel while the browser permission dialog is outstanding: late stream is released,
// no recording or transcription is allowed to begin.
let provideStream, stopped = 0, recorded = 0, uploads = 0;
const mediaPromise = new Promise(resolve => { provideStream = resolve; });
const context = { window: {}, navigator: { mediaDevices: { getUserMedia: () => mediaPromise } },
  AbortController, AbortSignal, setTimeout, clearTimeout,
  MediaRecorder: class { constructor() { recorded++; } static isTypeSupported() { return true; } },
  fetch: async () => { uploads++; return { ok: true }; },
};
context.window.MediaRecorder = context.MediaRecorder;
vm.runInNewContext(await readFile('sam-stt.js', 'utf8'), context);
const clip = context.window.SamSTT.record();
const cancelled = assert.rejects(clip, /recording_cancelled/);
clip.cancel();
provideStream({ getTracks: () => [{ stop: () => { stopped++; } }] });
await cancelled;
await new Promise(resolve => setTimeout(resolve, 0));
assert(stopped > 0); assert.equal(recorded, 0); assert.equal(uploads, 0);
console.log('PASS cancelled microphone permission cannot produce stale uploads and releases tracks');
