import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const voiceCode = await readFile(new URL('../sam-voice.js', import.meta.url), 'utf8');
const lipCode = await readFile(new URL('../sam-lipsync.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
  const events = [], audios = [], requests = [], urls = [], timers = new Map(), frames = new Map();
  let id = 0, sourceCount = 0, contextCount = 0;
  class CE extends Event { constructor(name, options) { super(name); this.detail = options.detail; } }
  const window = new EventTarget();
  const video = { paused: true, dataset: {}, plays: 0, pauses: 0, style: { setProperty() {} }, play() { this.plays++; this.paused = false; return Promise.resolve(); }, pause() { this.pauses++; this.paused = true; } };
  class Audio extends EventTarget {
    constructor(src) { super(); this.src = src; this.paused = true; this.ended = false; this.duration = 2; audios.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
    playing() { this.paused = false; this.dispatchEvent(new Event('playing')); }
    end() { this.ended = true; this.dispatchEvent(new Event('ended')); }
  }
  class AC {
    constructor() { contextCount++; this.state = 'running'; this.destination = {}; }
    createMediaElementSource(audio) { assert.equal(audio.claimed, undefined, 'only one source per audio element'); audio.claimed = true; sourceCount++; return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 512, connect() {}, disconnect() {}, getByteTimeDomainData(buf) { buf.fill(144); } }; }
  }
  const response = body => ({ ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: () => body || Promise.resolve(new ArrayBuffer(128)) });
  let fetcher = async () => response();
  window.AudioContext = AC;
  window.requestAnimationFrame = cb => { frames.set(++id, cb); return id; };
  window.cancelAnimationFrame = n => frames.delete(n);
  const context = vm.createContext({ window, document: { getElementById: () => video }, CustomEvent: CE, Audio, AbortController, Blob,
    URL: { createObjectURL() { const url = 'blob:' + urls.length; urls.push(url); return url; }, revokeObjectURL() {} },
    fetch(url, init) { requests.push({ url, init }); return fetcher(url, init); },
    setTimeout(cb, delay) { timers.set(++id, { cb, delay }); return id; }, clearTimeout(n) { timers.delete(n); },
  });
  ['loading', 'start', 'level', 'end', 'cancel', 'unavailable', 'error'].forEach(n => window.addEventListener('samvoice:' + n, e => events.push({ name: n, ...e.detail })));
  vm.runInContext(voiceCode, context);
  vm.runInContext(lipCode, context);
  return { voice: window.SamVoice, audios, events, requests, urls, video, timers, frames, response,
    fetchWith(fn) { fetcher = fn; }, counts: () => ({ sourceCount, contextCount }),
    timeout(ms) { const t = [...timers.values()].find(t => t.delay === ms); assert.ok(t, 'timeout registered: ' + ms); t.cb(); },
    frame() { const entries = [...frames.entries()]; frames.clear(); entries.forEach(([, cb]) => cb()); },
    emit(name, detail) { window.dispatchEvent(new CE('samvoice:' + name, { detail })); },
  };
}
{
  const h = setup();
  const pending = h.voice.play('Tell me about workflow automation');
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/tts', 'unknown text goes directly to TTS');
  assert.equal(JSON.parse(h.requests[0].init.body).voice_id, 'eve');
  assert.equal(h.audios.length, 1);
  assert.equal(h.events.filter(e => e.name === 'start').length, 0, 'no speaking during TTS/media loading');
  h.audios[0].playing();
  h.audios[0].playing();
  h.frame();
  assert.equal(h.events.filter(e => e.name === 'start').length, 1, 'one start, actual playback');
  assert.ok(h.events.some(e => e.name === 'level' && e.level > 0), 'actual analyser energy emitted');
  assert.deepEqual(h.counts(), { sourceCount: 1, contextCount: 1 });
  const generation = h.events.find(e => e.name === 'start').generation;
  h.emit('level', { generation, level: 0 });
  assert.equal(h.video.pauses, 0, 'natural silence never freezes face');
  h.audios[0].end();
  assert.equal((await pending).status, 'ended');
  assert.equal(h.video.dataset.speaking, undefined);
  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 0);
}
{
  const h = setup();
  const body = deferred();
  h.fetchWith(async () => h.response(body.promise));
  const old = h.voice.play('Old reply');
  await flush();
  h.fetchWith(async () => h.response());
  const next = h.voice.play('New reply');
  await flush();
  assert.equal((await old).status, 'cancelled', 'body cancellation settles before network returns');
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.audios.length, 1);
  h.audios[0].playing();
  body.resolve(new ArrayBuffer(128));
  await flush();
  assert.equal(h.urls.length, 1, 'late body cannot allocate/cache stale audio');
  assert.equal(h.audios.length, 1, 'late body cannot speak over new reply');
  h.audios[0].end();
  assert.equal((await next).status, 'ended');
  assert.equal(h.events.filter(e => e.name === 'start')[0].text, 'New reply');
}
{
  const h = setup();
  const old = h.voice.play(h.voice.GREETING);
  assert.equal(h.requests.length, 0, 'confirmed greeting plays directly');
  h.audios[0].playing();
  const next = h.voice.play('Next reply');
  assert.equal((await old).status, 'cancelled', 'interrupt settles an active end wait');
  await flush();
  h.audios[0].end();
  h.audios[0].playing();
  assert.equal(h.events.filter(e => e.name === 'end').length, 0, 'stale callbacks cannot end new reply');
  h.audios[1].playing();
  h.voice.stop('user_interrupt');
  assert.equal((await next).status, 'cancelled');
  assert.equal(h.audios[1].paused, true);
  assert.equal(h.video.dataset.speaking, undefined);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
}
{
  const h = setup();
  const hung = deferred();
  h.fetchWith(() => hung.promise);
  const p = h.voice.play('Network hangs');
  await flush();
  h.timeout(25000);
  assert.equal((await p).error, 'tts_timeout');
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.timers.size, 0);
  hung.resolve(h.response());
  await flush();
  assert.equal(h.audios.length, 0);
}
{
  const h = setup();
  const p = h.voice.play('Playback never starts');
  await flush();
  h.timeout(12000);
  assert.equal((await p).error, 'audio_start_timeout');
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.events.some(e => e.name === 'start'), false);
}
{
  const h = setup();
  const p = h.voice.play('Playback never ends');
  await flush();
  h.audios[0].playing();
  h.timeout(17000);
  assert.equal((await p).error, 'audio_end_timeout');
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
}
{
  const h = setup();
  const p = h.voice.play('constructor');
  await flush();
  assert.equal(h.requests[0].url, '/api/tts', 'inherited properties are not canned assets');
  h.voice.stop('before_playback');
  assert.equal((await p).status, 'cancelled', 'interrupt settles before playing event');
  h.audios[0].playing();
  assert.equal(h.events.some(e => e.name === 'start'), false);
  assert.equal(h.timers.size, 0);
}
console.log('PASS SamVoice: actual playback start, Eve TTS, no speculative assets, one analyser, moving pauses, cancellation, stale body/events, bounded fetch/start/end.');
