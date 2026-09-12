import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const voiceCode = await readFile(new URL('../sam-voice.js', import.meta.url), 'utf8');
const lipCode = await readFile(new URL('../sam-lipsync.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, fail) => { resolve = r; reject = fail; }); return { promise, resolve, reject }; };
// BroadcastChannel delivers queued messages to other contexts of the same
// origin/channel. Explicit delivery lets us test both orders of a claim race.
function channelHub() {
  const channels = [], pending = [];
  class BroadcastChannel {
    constructor(name) { this.name = name; channels.push(this); }
    postMessage(data) {
      for (const target of channels) {
        if (target !== this && target.name === this.name) pending.push({ target, data: structuredClone(data) });
      }
    }
  }
  return { BroadcastChannel, channels,
    deliver(reverse = false) {
      const batch = pending.splice(0);
      if (reverse) batch.reverse();
      batch.forEach(({ target, data }) => target.onmessage?.({ data }));
    },
  };
}
function setup({ reducedMotion = false, hub, owner = 'tab-a', clock = 1000, remote, mediaEvents = [] } = {}) {
  const events = [], audios = [], requests = [], urls = [], timers = new Map(), frames = new Map();
  let id = 0, sourceCount = 0, contextCount = 0;
  class CE extends Event { constructor(name, options) { super(name); this.detail = options.detail; } }
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = false;
  window.crypto = { randomUUID: () => owner };
  if (remote) window.SamVideo = remote;
  if (hub) window.BroadcastChannel = hub.BroadcastChannel;
  let synthesisCancels = 0;
  window.speechSynthesis = { cancel() { synthesisCancels++; } };
  window.matchMedia = () => ({ matches: reducedMotion });
  const video = { paused: true, dataset: {}, plays: 0, pauses: 0, style: { setProperty() {} }, play() { this.plays++; this.paused = false; return Promise.resolve(); }, pause() { this.pauses++; this.paused = true; } };
  class Audio extends EventTarget {
    constructor(src) { super(); this.src = src; this.paused = true; this.ended = false; this.duration = 2; this.muted = false; this.volume = 1; audios.push(this); mediaEvents.push('local-audio'); }
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
  document.getElementById = () => video;
  const context = vm.createContext({ window, document, CustomEvent: CE, Audio, AbortController, Blob,
    Date: class extends Date { static now() { return clock; } },
    URL: { createObjectURL() { const url = 'blob:' + urls.length; urls.push(url); return url; }, revokeObjectURL() {} },
    fetch(url, init) { requests.push({ url, init }); return fetcher(url, init); },
    setTimeout(cb, delay) { timers.set(++id, { cb, delay }); return id; }, clearTimeout(n) { timers.delete(n); },
  });
  ['loading', 'start', 'level', 'end', 'cancel', 'unavailable', 'error'].forEach(n => window.addEventListener('samvoice:' + n, e => events.push({ name: n, ...e.detail })));
  vm.runInContext(voiceCode, context);
  vm.runInContext(lipCode, context);
  return { voice: window.SamVoice, audios, events, requests, urls, video, timers, frames, response,
    reevaluateVoice() { vm.runInContext(voiceCode, context); return window.SamVoice; },
    hide() { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); },
    show() { document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); },
    pagehide() { window.dispatchEvent(new Event('pagehide')); },
    synthesisCancels: () => synthesisCancels,
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

{
  const h = setup();
  h.video.dataset.speechClip = 'greeting';
  h.video.currentTime = 7;
  const greeting = h.voice.play(h.voice.GREETING);
  h.audios[0].currentTime = 0;
  assert.equal(h.video.currentTime, 7, 'loading cannot start or seek the visible greeting');
  h.audios[0].playing();
  assert.equal(h.video.currentTime, .079, 'repeated greeting starts with measured audio offset');
  assert.equal(h.video.muted, true, 'video must never become a second voice');
  h.audios[0].currentTime = 3;
  h.video.currentTime = 1;
  h.audios[0].dispatchEvent(new Event('timeupdate'));
  assert.equal(h.video.currentTime, 3.079, 'greeting follows actual audio after delayed video playback');
  h.voice.stop('interrupt');
  assert.equal((await greeting).status, 'cancelled');
  h.video.dataset.speechClip = 'reply';
  h.video.currentTime = 5;
  h.audios[0].currentTime = 8;
  h.audios[0].dispatchEvent(new Event('timeupdate'));
  assert.equal(h.video.currentTime, 5, 'interrupted greeting cannot seek a later reply');
}
{
  const h = setup({ reducedMotion: true });
  h.video.dataset.speechClip = 'greeting';
  const greeting = h.voice.play(h.voice.GREETING);
  h.audios[0].playing();
  assert.equal(h.video.plays, 0, 'reduced-motion presentation never starts a video');
  h.audios[0].end();
  assert.equal((await greeting).status, 'ended', 'voice remains available with reduced motion');
}
console.log('PASS original greeting alignment, muted video, interrupted sync cleanup and reduced motion');

{
  const hub = channelHub();
  const h = setup({ hub });
  const greeting = h.voice.play(h.voice.GREETING);
  h.audios[0].playing();
  const initialCounts = h.counts();
  assert.equal(h.reevaluateVoice(), h.voice, 'script reevaluation preserves the reachable singleton');
  assert.equal(h.reevaluateVoice(), h.voice);
  assert.equal(hub.channels.length, 1, 'reevaluation cannot create orphaned cross-tab owners');
  assert.deepEqual(h.counts(), initialCounts);
  const cancels = h.events.filter(e => e.name === 'cancel').length;
  h.pagehide();
  assert.equal((await greeting).status, 'cancelled', 'the original owner remains stoppable after reevaluation');
  assert.equal(h.events.filter(e => e.name === 'cancel').length, cancels + 1, 'lifecycle listeners are not duplicated');
  assert.ok(h.synthesisCancels() >= 2, 'interrupt also cancels any residual browser speech');
}
for (const lifecycle of ['hide', 'pagehide']) {
  const h = setup();
  const greeting = h.voice.play(h.voice.GREETING);
  const audio = h.audios[0];
  audio.playing();
  h.frame();
  h[lifecycle]();
  assert.equal((await greeting).status, 'cancelled', lifecycle + ' cancels active playback');
  assert.equal(audio.paused, true);
  assert.equal(audio.muted, true);
  assert.equal(audio.volume, 0);
  assert.equal(audio.src, '');
  const starts = h.events.filter(e => e.name === 'start').length;
  // Simulate a delayed media play completion after the element was torn down.
  audio.playing();
  assert.equal(audio.muted, true, 'late playing events never restore retired audio volume');
  assert.equal(audio.volume, 0);
  assert.equal(h.events.filter(e => e.name === 'start').length, starts);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  h.show();
  assert.equal(h.audios.length, 1, 'returning to the tab does not restart cancelled speech');
}
{
  const h = setup();
  const body = deferred();
  h.fetchWith(async () => h.response(body.promise));
  const pending = h.voice.play('Do not speak after this tab is hidden');
  await flush();
  h.hide();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(h.requests[0].init.signal.aborted, true);
  body.resolve(new ArrayBuffer(128));
  await flush();
  assert.equal(h.audios.length, 0, 'a hidden tab cannot speak a late network response');
  assert.equal(h.urls.length, 0);
}
{
  const hub = channelHub();
  const first = setup({ hub, owner: 'tab-a' });
  const second = setup({ hub, owner: 'tab-b' });
  const old = first.voice.play(first.voice.GREETING);
  first.audios[0].playing();
  hub.deliver();
  const next = second.voice.play(second.voice.GREETING);
  second.audios[0].playing();
  hub.deliver();
  assert.equal((await old).status, 'cancelled', 'a new tab takes ownership from active speech');
  assert.equal(first.audios[0].muted, true);
  assert.equal(first.audios[0].volume, 0);
  assert.equal(second.audios[0].muted, false);
  assert.ok(first.events.some(e => e.reason === 'another_tab'));
  // A later explicit action may reclaim voice even in the same clock tick.
  const reclaimed = first.voice.play(first.voice.GREETING);
  hub.deliver();
  assert.equal((await next).status, 'cancelled');
  first.audios[1].playing();
  first.audios[1].end();
  assert.equal((await reclaimed).status, 'ended');
}
for (const reverse of [false, true]) {
  const hub = channelHub();
  const first = setup({ hub, owner: 'tab-a' });
  const second = setup({ hub, owner: 'tab-b' });
  // Both actions happen before either tab observes the other's claim.
  const a = first.voice.play(first.voice.GREETING);
  const b = second.voice.play(second.voice.GREETING);
  first.audios[0].playing(); second.audios[0].playing();
  hub.deliver(reverse);
  assert.equal((await a).status, 'cancelled', 'equal-clock claims choose one deterministic owner');
  const audible = [...first.audios, ...second.audios].filter(audio => !audio.paused && !audio.muted && audio.volume > 0);
  assert.equal(audible.length, 1, 'simultaneous claims converge to one voice regardless of message order');
  assert.equal(audible[0], second.audios[0]);
  assert.equal(second.events.some(e => e.reason === 'another_tab'), false, 'stale/equal-lower claim cannot cancel the winner');
  second.audios[0].end();
  assert.equal((await b).status, 'ended');
}
console.log('PASS cross-tab takeover and simultaneous arbitration, singleton reevaluation, hidden/pagehide cancellation and permanent retired-media mute');

function remoteHarness({ enabled = Promise.resolve(true) } = {}) {
  const calls = [], mediaEvents = [];
  const remote = {
    enabled: () => enabled,
    play(url, options) {
      mediaEvents.push('remote-play');
      const pending = deferred();
      const audio = Object.assign(new EventTarget(), { paused: true, muted: false, currentTime: 0, duration: 2 });
      calls.push({ url, pending, audio, start() { audio.paused = false; options.onStart({ audio }); } });
      return pending.promise;
    },
    stop(reason) {
      mediaEvents.push('remote-stop:' + reason);
      for (const call of calls) { call.audio.paused = true; call.audio.muted = true; }
    },
  };
  return { remote, calls, mediaEvents };
}
{
  const r = remoteHarness();
  const h = setup(r);
  const pending = h.voice.play('A fresh live video response');
  await flush(); await flush();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, h.urls[0], 'live rendering consumes the generated TTS URL');
  assert.equal(h.audios.length, 0, 'the live renderer never competes with a local Audio element');
  assert.equal(h.events.some(event => event.name === 'start'), false);
  r.calls[0].start();
  const start = h.events.find(event => event.name === 'start');
  assert.equal(start.source, 'video');
  assert.equal(start.audio, r.calls[0].audio);
  assert.equal(start.generation, h.events.find(event => event.name === 'loading').generation);
  assert.equal(start.text, 'A fresh live video response');
  r.calls[0].pending.resolve();
  assert.equal((await pending).status, 'ended');
  assert.equal(h.audios.length, 0);
  assert.equal(h.timers.size, 0);
}
for (const action of ['interrupt', 'hide', 'another_tab']) {
  const r = remoteHarness();
  const hub = channelHub();
  const h = setup({ ...r, hub, owner: 'tab-a' });
  const other = setup({ hub, owner: 'tab-b' });
  const pending = h.voice.play(h.voice.GREETING);
  await flush();
  hub.deliver();
  r.calls[0].start();
  let otherPending;
  if (action === 'interrupt') h.voice.stop('visitor_interrupt');
  if (action === 'hide') h.hide();
  if (action === 'another_tab') { otherPending = other.voice.play(other.voice.GREETING); hub.deliver(); }
  assert.equal(r.calls[0].audio.muted, true, action + ' silences remote media synchronously');
  assert.equal((await pending).status, 'cancelled');
  r.calls[0].pending.resolve();
  await flush();
  assert.equal(h.audios.length, 0, action + ' cannot trigger late local fallback');
  assert.equal(h.events.filter(event => event.name === 'end').length, 0);
  assert.equal(r.mediaEvents.includes('remote-stop:fallback'), false, 'a cancelled attempt cannot stop remote media again from its asynchronous catch');
  if (otherPending) { other.voice.stop(); await otherPending; }
}
{
  const r = remoteHarness();
  const h = setup(r);
  const old = h.voice.play(h.voice.GREETING);
  await flush();
  r.calls[0].start();
  const next = h.voice.play('The replacement live reply');
  await flush(); await flush();
  assert.equal((await old).status, 'cancelled');
  assert.equal(r.calls.length, 2);
  r.calls[1].start();
  r.calls[0].pending.reject(new Error('late_old_disconnect'));
  await flush();
  assert.equal(r.calls[1].audio.muted, false, 'a retired render promise cannot silence its replacement');
  assert.equal(r.mediaEvents.includes('remote-stop:fallback'), false);
  assert.equal(h.audios.length, 0);
  r.calls[1].pending.resolve();
  assert.equal((await next).status, 'ended');
}
{
  const r = remoteHarness();
  const h = setup(r);
  const pending = h.voice.play(h.voice.GREETING);
  await flush();
  r.calls[0].pending.reject(new Error('renderer_connect_failed'));
  await flush();
  assert.equal(h.audios.length, 1, 'failure before playback preserves ordinary audio');
  assert.ok(r.mediaEvents.indexOf('remote-stop:fallback') < r.mediaEvents.indexOf('local-audio'), 'remote media is stopped before any local fallback is allocated');
  assert.equal(h.audios[0].src, './assets/sam-hello-v2.mp3', 'fallback preserves the original greeting asset');
  h.audios[0].playing(); h.audios[0].end();
  assert.equal((await pending).status, 'ended');
}
for (const failure of ['annotated', 'plain', 'timeout']) {
  const r = remoteHarness();
  const h = setup(r);
  const pending = h.voice.play('This sentence has already begun');
  await flush(); await flush();
  r.calls[0].start();
  if (failure === 'timeout') h.timeout(300000);
  else r.calls[0].pending.reject(Object.assign(new Error('renderer_disconnected'), failure === 'annotated' ? { playbackStarted: true } : {}));
  await flush();
  assert.equal(h.audios.length, 0, failure + ' failure after onStart must never repeat the spoken sentence locally');
  assert.equal((await pending).status, 'error');
  assert.equal(r.calls[0].audio.muted, true);
  assert.equal(h.timers.size, 0);
  r.calls[0].pending.resolve();
}
{
  const enabled = deferred();
  const r = remoteHarness({ enabled: enabled.promise });
  const h = setup(r);
  const pending = h.voice.play(h.voice.GREETING);
  await flush();
  h.voice.stop('cancel_while_checking');
  assert.equal((await pending).status, 'cancelled');
  enabled.resolve(true);
  await flush();
  assert.equal(r.calls.length, 0, 'late enabled configuration cannot start a cancelled live session');
  assert.equal(h.audios.length, 0);
  assert.equal(h.timers.size, 0);
}
{
  const enabled = deferred();
  const r = remoteHarness({ enabled: enabled.promise });
  const h = setup(r);
  const pending = h.voice.play(h.voice.GREETING);
  await flush();
  h.timeout(2500);
  await flush();
  assert.equal(h.audios.length, 1, 'a hung video configuration cannot block voice indefinitely');
  enabled.resolve(true);
  await flush();
  assert.equal(r.calls.length, 0, 'late configuration cannot create a second audio owner');
  h.audios[0].playing(); h.audios[0].end();
  assert.equal((await pending).status, 'ended');
}
console.log('PASS live-video audio ownership, generation events, cancellation, prestart-only fallback, poststart failure suppression and bounded configuration');
