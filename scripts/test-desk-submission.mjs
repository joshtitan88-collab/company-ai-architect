import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Exercise the real coordinator with storage denied, as in privacy-restricted browsers.
class Element {
  constructor() {
    const classes = new Set(['hidden']);
    this.classList = { add: (...items) => items.forEach(x => classes.add(x)), remove: (...items) => items.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
    this.dataset = {}; this.children = []; this.textContent = ''; this.value = '';
    this.listeners = new Map(); this.readyState = 0; this.muted = false;
    this.defaultMuted = false; this.volume = 1; this.playbacks = [];
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }
  dispatch(name) { (this.listeners.get(name) || []).forEach(fn => fn()); }
  setAttribute() {}
  pause() {}
  play() {
    this.dispatch('play');
    this.playbacks.push({ muted: this.muted, volume: this.volume });
    return Promise.resolve();
  }
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
  window: { matchMedia: () => ({ matches: false }), addEventListener() {}, dispatchEvent() {} },
  sessionStorage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } },
  localStorage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } },
  crypto: { randomUUID: () => 'test-' + ++uuid },
  SamNLU: { GREETING: 'Original greeting', createSession: () => ({ phase: 'confirming', booking: {} }) },
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
evaluate('speak(GREETING)');
assert.equal(element('vidTalk').src, './assets/sam-imagine-speak.mp4');
assert.equal(element('vidTalk').loop, false);
assert.equal(element('vidTalk').dataset.speechClip, 'greeting');
evaluate("speak('Here is an answer to your question.')");
assert.equal(element('vidTalk').src, './assets/desk-talk.mp4');
assert.equal(element('vidTalk').loop, true);
assert.equal(element('vidTalk').dataset.speechClip, 'reply');
console.log('PASS original greeting video selection and same-identity reply loop');

for (const id of ['vidIdle', 'vidTalk', 'vidListen', 'vidProcess']) {
  const video = element(id);
  assert.equal(video.muted, true, id + ' starts muted before loading embedded audio');
  assert.equal(video.defaultMuted, true);
  assert.equal(video.volume, 0);
  // A stale controller or browser UI changing media volume cannot introduce a
  // second voice. Dispatch the same events a real media element would emit.
  video.muted = false; video.volume = 1; video.defaultMuted = false;
  video.dispatch('volumechange');
  assert.equal(video.muted, true, id + ' rejects attempts to unmute');
  assert.equal(video.volume, 0);
  assert.equal(video.defaultMuted, true);
  video.muted = false; video.volume = 1;
  await video.play();
  assert.equal(video.muted, true, id + ' is silenced on delayed playback');
  assert.equal(video.volume, 0);
}
// Legacy ownAudio flags and an obsolete allow-audio argument must not bypass
// the single audio authority when switching the actual desk coordinator.
element('vidTalk').dataset.ownAudio = '1';
for (const mode of ['idle', 'listen', 'process', 'talk']) {
  const id = { idle: 'vidIdle', listen: 'vidListen', process: 'vidProcess', talk: 'vidTalk' }[mode];
  const video = element(id);
  video.muted = false; video.volume = 1;
  evaluate(`setMode('${mode}')`);
  assert.equal(video.muted, true, mode + ' cannot activate an embedded audio track');
  assert.equal(video.volume, 0);
}
evaluate('playVid(vidTalk, true)');
assert.equal(element('vidTalk').muted, true);
assert.equal(element('vidTalk').volume, 0);
for (const id of ['vidIdle', 'vidTalk', 'vidListen', 'vidProcess']) {
  assert.ok(element(id).playbacks.every(playback => playback.muted && playback.volume === 0), id + ' stays silent through every tested play');
}
console.log('PASS all embedded state videos stay muted through volume changes, delayed play, mode changes and legacy own-audio flags');
