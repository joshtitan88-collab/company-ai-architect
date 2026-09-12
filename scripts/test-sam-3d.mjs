import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Event-level renderer tests; these do not stand in for a GPU visual review.
const source = (await readFile(new URL('../src/sam-3d.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup({ hidden = false, reduced = false } = {}) {
  let finish, reject;
  const pending = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = hidden;
  window.matchMedia = () => ({ matches: reduced });
  window.devicePixelRatio = 3;
  const classes = new Set();
  const host = { setAttribute() {} };
  const progress = {};
  const stage = { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } };
  document.getElementById = name => ({ sam3d: host, desk: stage, avatarProgress: progress })[name];
  const timers = new Map();
  const instances = [];
  class Head {
    constructor(node, options) { this.options = options; this.renderer = { domElement: new EventTarget() }; this.values = {}; instances.push(this); }
    async showAvatar() { await pending; this.start(); }
    setValue(name, value) { this.values[name] = value; }
    lookAtCamera() {}
    start() { this.running = true; }
    stop() { this.running = false; }
  }
  class Phonetics { wordsToVisemes() { return { times: [0], durations: [1000], visemes: ['aa'] }; } }
  class CE extends Event { constructor(name, options = {}) { super(name, options); this.detail = options.detail; } }
  vm.runInNewContext(source, { window, document, TalkingHead: Head, LipsyncEn: Phonetics, CustomEvent: CE,
    console: { warn() {} }, setTimeout(fn) { timers.set(fn, fn); return fn; }, clearTimeout(fn) { timers.delete(fn); } });
  return { window, document, head: instances[0], instances, classes, progress,
    emit(name, detail) { window.dispatchEvent(new CE(name, { detail })); },
    context(name) { const event = new Event(name, { cancelable: true }); instances[0].renderer.domElement.dispatchEvent(event); return event; },
    async complete() { finish(); await flush(); }, async fail() { reject(new Error('offline')); await flush(); },
    async timeout() { for (const fn of timers.values()) fn(); await flush(); },
  };
}

{
  const h = setup();
  const sameLoad = h.window.Sam3D.start();
  await h.complete();
  assert.equal(await sameLoad, true);
  assert.equal(h.instances.length, 1, 'concurrent starts share one model and GPU context');
  assert.equal(h.head.options.modelPixelRatio * 3, 1.5, 'mobile GPU pixel ratio is capped');
  assert.equal(h.window.Sam3D.active(), true);
  assert.equal(h.context('webglcontextlost').defaultPrevented, true);
  assert.equal(h.window.Sam3D.active(), false, 'context loss exposes working video fallback');
  assert.equal(h.classes.has('avatar-3d-ready'), false);
  assert.equal(h.head.running, false);
  h.context('webglcontextrestored');
  assert.equal(h.window.Sam3D.active(), true);
  assert.equal(h.head.running, true);
  assert.equal(h.instances.length, 1, 'GPU recovery reuses the original model');
}
{
  const h = setup({ hidden: true, reduced: true });
  await h.complete();
  assert.equal(h.head.running, false, 'model finishing in background remains suspended');
  assert.equal(h.head.options.modelMovementFactor, 0);
  assert.equal(h.head.options.avatarIdleHeadMove, 0);
  assert.equal(h.head.options.avatarSpeakingHeadMove, 0);
  h.document.hidden = false;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.head.running, true);
  h.emit('pagehide');
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.head.running, false, 'pagehide cannot be undone by an unrelated visibility event');
  h.emit('pageshow');
  assert.equal(h.head.running, true, 'back-forward restoration resumes animation');
}
{
  const h = setup();
  h.emit('pagehide');
  await h.complete();
  assert.equal(h.head.running, false, 'pagehide during initial load does not restart animation');
}
{
  const h = setup();
  h.context('webglcontextlost');
  await h.complete();
  assert.equal(h.window.Sam3D.active(), false, 'late model completion cannot hide fallback while context is lost');
  assert.equal(h.head.running, false);
  h.context('webglcontextrestored');
  assert.equal(h.window.Sam3D.active(), true);
}
{
  const h = setup();
  const audio = { paused: false, ended: false, duration: 2, currentTime: .2 };
  h.emit('samvoice:start', { audio, text: 'Hello' });
  await h.complete();
  assert.equal(h.head.isSpeaking, true, 'speech that began before model readiness is preserved');
  h.head.options.update(65);
  assert.ok(h.head.values.viseme_aa > 0, 'estimated lip motion remains available without Web Audio metering');
  h.emit('samvoice:level', { audio, level: 0 });
  h.head.options.update(65);
  assert.equal(h.head.values.viseme_aa, 0, 'measured silence closes the lips');
  h.emit('samvoice:level', { audio: {}, level: 1 });
  h.head.options.update(65);
  assert.equal(h.head.values.viseme_aa, 0, 'a stale audio meter cannot animate the new utterance');
  h.emit('samvoice:level', { audio, level: .1 });
  h.head.options.update(65);
  h.emit('samvoice:cancel');
  assert.equal(h.head.values.viseme_aa, 0);
  assert.equal(h.head.isSpeaking, false);
}
{
  const h = setup();
  await h.timeout();
  assert.equal(h.window.Sam3D.active(), false);
  await h.complete();
  assert.equal(h.head.running, false, 'a timed-out model never starts animating later');
  assert.equal(h.window.Sam3D.active(), false);
}
{
  const h = setup();
  await h.fail();
  assert.equal(h.window.Sam3D.active(), false);
  assert.match(h.progress.textContent, /voice and text/);
}
console.log('PASS 3D context recovery, background lifecycle, reduced motion, measured/estimated lip sync and load failures');
