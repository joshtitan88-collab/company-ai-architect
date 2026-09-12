import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Exercise the real coordinator with storage denied, as in privacy-restricted browsers.
class Element {
  constructor() {
    const classes = new Set(['hidden']);
    this.classList = { add: (...items) => items.forEach(x => classes.add(x)), remove: (...items) => items.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
    this.dataset = {}; this.children = []; this.textContent = ''; this.value = '';
    this.listeners = new Map(); this.readyState = 0;
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute() {}
  pause() {}
  play() { return Promise.resolve(); }
  focus() {}
  appendChild(el) { this.children.push(el); }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
}
const elements = new Map();
const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
let uuid = 0, failQualify = false, responseFails = true;
const posts = [];
const context = vm.createContext({
  document: { getElementById: element, querySelectorAll: () => [], createElement: () => new Element() },
  window: { matchMedia: () => ({ matches: true }), addEventListener() {}, dispatchEvent() {} },
  sessionStorage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } },
  localStorage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } },
  crypto: { randomUUID: () => 'test-' + ++uuid },
  SamNLU: { createSession: () => ({ phase: 'confirming', booking: {} }) },
  SamMessages: { createSession: () => ({}) },
  SamQualify: { createSession: () => ({}), fields() { if (failQualify) throw new Error('bad draft'); return {}; } },
  SamVoice: { stop() {}, play() {} },
  CustomEvent: class {}, AbortController, AbortSignal, URLSearchParams, Intl, console,
  setTimeout, clearTimeout,
  fetch: async (url, init) => {
    if (url === '/api/slots') return { ok: true, json: async () => ({ slots: [], bookingMode: 'request' }) };
    if (url === '/api/deposit') return { json: async () => ({ enabled: false }) };
    assert.equal(url, '/api/book'); posts.push(JSON.parse(init.body));
    if (responseFails) throw new Error('response lost');
    return { ok: true, status: 200, json: async () => ({ ok: true, id: 7, status: 'requested' }) };
  },
});
vm.runInContext(await readFile('desk.js', 'utf8'), context);
const evaluate = code => vm.runInContext(code, context);
evaluate("globalThis.draft = {name:'Test Visitor',email:'visitor@example.invalid',company:'Test',slotIso:'2026-10-01T13:00:00Z'}");
assert.equal(await evaluate('postBook(draft)'), false);
assert.equal(await evaluate('postBook(draft)'), false);
assert.equal(posts.length, 2, 'failed first attempt must release booking lock');
assert.equal(posts[0].idempotencyKey, posts[1].idempotencyKey, 'unknown outcome keeps same retry key despite blocked storage');
assert.equal(posts[0].sessionId, posts[1].sessionId);
assert(posts[0].idempotencyKey.endsWith(context.draft.slotIso), 'key uses submitted slot, not mutable calendar selection');
failQualify = true;
assert.equal(await evaluate('postBook(draft)'), false);
failQualify = false; responseFails = false;
assert.equal(await evaluate('postBook(draft)'), true, 'payload preparation failure cannot leave booking locked');
assert.equal(evaluate('bookingBusy'), false);
assert.equal(evaluate('session.phase'), 'requested');
const a = evaluate("messageRequest({contact:'one@example.invalid',message:'First draft'})");
const b = evaluate("messageRequest({contact:'one@example.invalid',message:'First draft'})");
const corrected = evaluate("messageRequest({contact:'two@example.invalid',message:'First draft'})");
assert.equal(a.idempotencyKey, b.idempotencyKey);
assert.notEqual(a.idempotencyKey, corrected.idempotencyKey);
evaluate('messageAttempt = null');
assert.notEqual(corrected.idempotencyKey, evaluate("messageRequest({contact:'two@example.invalid',message:'First draft'})").idempotencyKey);
console.log('PASS real desk coordinator: blocked storage, uncertain booking retries, preparation failure recovery, stable message retry keys and corrected drafts');
