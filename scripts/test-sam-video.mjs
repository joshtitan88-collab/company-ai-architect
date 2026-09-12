import assert from 'node:assert/strict';
import { createSamVideo } from '../src/sam-video.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  let clock = 1000000, timerId = 0, frameId = 0;
  const timers = new Map(), frames = new Map(), requests = [], sockets = [], calls = [], contexts = [];
  const classes = new Set();
  const video = { muted: true, paused: true, readyState: 4, videoWidth: 640, srcObject: null, plays: 0,
    pause() { this.paused = true; },
    play() { this.plays++; this.paused = false; return options.blockPlay ? Promise.reject(Error('blocked')) : Promise.resolve(); },
    requestVideoFrameCallback(fn) { queueMicrotask(fn); return 1; }, cancelVideoFrameCallback() {}, addEventListener() {},
  };
  const desk = { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } };
  class MediaStream { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } }
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); } }); }
    send(text) { if (this.readyState !== 1) throw Error('closed'); this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.(); }
    event(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  const h = { energy: 0, video, classes, requests, sockets, calls, contexts, timers,
    frame() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); },
    timeout(ms) { const found = [...timers].find(([, t]) => t.ms === ms); assert(found, `Expected ${ms}ms timer`); timers.delete(found[0]); found[1].fn(); },
  };
  class AudioContext {
    constructor() { this.state = 'suspended'; this.destination = { output: true }; contexts.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    decodeAudioData() { return options.decode ? options.decode() : Promise.resolve({ duration: 0.2 }); }
    createMediaStreamSource(stream) { assert.equal(stream.getTracks().length, 1); return { connect: target => assert(!target.output, 'Remote meter must never create another output'), disconnect() {} }; }
    createAnalyser() { return { fftSize: 512, getFloatTimeDomainData(buffer) { buffer.fill(h.energy); }, disconnect() {} }; }
  }
  class OfflineAudioContext {
    constructor(channels, frames, sampleRate) { assert.equal(channels, 1); assert.equal(sampleRate, 16000); this.frames = frames; this.destination = {}; }
    createBufferSource() { return { connect() {}, start() {} }; }
    startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(this.frames).fill(0.25) }); }
  }
  const Daily = { createCallObject(args) {
    assert.equal(args.audioSource, false); assert.equal(args.videoSource, false);
    const track = kind => ({ kind, readyState: 'live', stop() { this.readyState = 'ended'; } });
    const audio = track('audio'), picture = track('video'), handlers = new Map();
    const call = { destroyed: 0, audio, picture,
      participants: () => ({ avatar: { local: false, tracks: { audio: { state: 'playable', persistentTrack: audio }, video: { state: 'playable', persistentTrack: picture } } } }),
      on(name, fn) { handlers.set(name, fn); }, off(name) { handlers.delete(name); }, emit(name) { handlers.get(name)?.(); },
      join() { return options.join ? options.join() : Promise.resolve(); }, destroy() { this.destroyed++; return Promise.resolve(); },
    }; calls.push(call); return call;
  } };
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null; requests.push({ url, body, init });
    if (url === '/api/lemonslice-session' && !body) {
      if (options.capability) return options.capability(init);
      return { ok: true, json: async () => ({ enabled: true }) };
    }
    if (body?.action === 'start') {
      if (options.start) return options.start(init);
      return { ok: true, json: async () => ({ ok: true, roomUrl: 'https://example.daily.co/room', meetingToken: 'viewer-token', websocketUrl: 'wss://example/socket', cleanupToken: 'cleanup-token', expiresAt: clock + 600000 }) };
    }
    if (body?.action === 'end') return { ok: true };
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  h.sam = createSamVideo({ root: { matchMedia: () => ({ matches: options.reducedMotion || false }) }, document: { getElementById: id => id === 'desk' ? desk : video },
    fetch, Daily, WebSocket: Socket, MediaStream, AudioContext, OfflineAudioContext, now: () => clock,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = ++frameId; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
  });
  return h;
}
let tests = 0;
async function check(name, fn) { await fn(); tests++; console.log(`PASS ${name}`); }

await check('capability is cached, times out, and honors reduced motion', async () => {
  const h = harness(); assert.equal(await h.sam.enabled(), true); assert.equal(await h.sam.enabled(), true); assert.equal(h.requests.length, 1);
  const reduced = harness({ reducedMotion: true }); assert.equal(await reduced.sam.enabled(), false); assert.equal(reduced.requests.length, 0);
  const stalled = harness({ capability: init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('timeout')))) });
  const pending = stalled.sam.enabled(); stalled.timeout(2000); assert.equal(await pending, false);
});
await check('one synchronized video output sends PCM16 chunks and starts only on response audio', async () => {
  const h = harness(); let starts = 0, output;
  const playing = h.sam.play('/tts', { onStart: ({ audio }) => { starts++; output = audio; } });
  await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.video.srcObject.getTracks().length, 2); assert(h.classes.has('sam-video-ready'));
  const commands = h.sockets[0].sent;
  assert.deepEqual(commands.map(x => x.command), ['audio', 'audio', 'audio_end']);
  assert.equal(commands[0].sampleRate, 16000); assert.equal(commands[0].encoding, 'PCM16');
  assert.equal(Buffer.from(commands[0].audio, 'base64').length, 3200);
  h.frame(); assert.equal(starts, 0, 'Idle playing video must not signal speech');
  h.energy = 0.05; h.frame(); assert.equal(starts, 1); assert.equal(output, h.video);
  h.sockets[0].event({ command: 'playback_finished', interrupted: false });
  assert.equal(await playing, 'playback_finished'); assert.equal(h.video.muted, true); assert.equal(h.calls[0].destroyed, 0);
  h.sam.stop('pagehide'); await flush();
});
await check('completed rooms survive ordinary next-turn stops without duplicate track playback', async () => {
  const h = harness(); let p = h.sam.play('/tts'); await flush();
  const initialPlays = h.video.plays; h.calls[0].emit('participant-updated'); await flush(); assert.equal(h.video.plays, initialPlays);
  h.sockets[0].event({ command: 'playback_finished' }); await p;
  h.sam.stop('visitor_interrupt'); assert.equal(h.video.srcObject, null); assert.equal(h.video.muted, true);
  p = h.sam.play('/tts'); await flush(); assert.equal(h.calls.length, 1); assert.equal(h.requests.filter(r => r.body?.action === 'start').length, 1);
  h.sockets[0].event({ command: 'playback_finished' }); await p;
  h.sam.stop('visitor_stop'); assert(h.calls[0].destroyed > 0); await flush();
});
await check('interrupt silences immediately and stale completion cannot finish a new generation', async () => {
  const h = harness(); const controller = new AbortController();
  const first = h.sam.play('/tts', { signal: controller.signal }); const rejected = assert.rejects(first, e => e.playbackStarted === true);
  await flush(); const old = h.sockets[0]; const staleHandler = old.onmessage;
  controller.abort(); assert.equal(h.video.muted, true); assert.equal(h.video.paused, true); assert.equal(h.video.srcObject, null); assert(!h.classes.has('sam-video-ready'));
  assert.equal(old.readyState, 3); assert(h.calls[0].destroyed > 0); await rejected;
  let complete = false; const next = h.sam.play('/tts').then(x => { complete = true; return x; }); await flush();
  staleHandler({ data: JSON.stringify({ command: 'playback_finished' }) }); await flush(); assert.equal(complete, false);
  h.sockets[1].event({ command: 'playback_finished' }); await next; h.sam.stop('end'); await flush();
});
await check('late backend session after cancellation is cleaned up without joining', async () => {
  let deliver;
  const h = harness({ start: () => new Promise(resolve => { deliver = resolve; }) });
  const p = h.sam.play('/tts'); const rejected = assert.rejects(p, e => e.playbackStarted === false);
  h.sam.stop('visitor_stop'); await rejected;
  deliver({ ok: true, json: async () => ({ ok: true, roomUrl: 'room', meetingToken: 'token', websocketUrl: 'socket', cleanupToken: 'late-cleanup', expiresAt: 99999999999 }) });
  await flush(); assert.equal(h.calls.length, 0); assert(h.requests.some(r => r.body?.cleanupToken === 'late-cleanup'));
});
await check('late Daily join cannot resurrect a canceled room or start audio', async () => {
  let joined; const h = harness({ join: () => new Promise(resolve => { joined = resolve; }) });
  const p = h.sam.play('/tts'); const rejected = assert.rejects(p, e => e.playbackStarted === false);
  await flush(); h.sam.stop('visitor_stop'); await rejected; joined(); await flush();
  assert(h.calls[0].destroyed >= 2); assert.equal(h.video.srcObject, null); assert(!h.sockets[0].sent.some(x => x.command === 'audio'));
});
await check('idle transport failures dispose rooms and a later turn starts fresh', async () => {
  const h = harness(); let p = h.sam.play('/tts'); await flush(); h.sockets[0].event({ command: 'playback_finished' }); await p;
  h.sockets[0].close(); assert.equal(h.video.srcObject, null); assert(h.calls[0].destroyed > 0);
  p = h.sam.play('/tts'); await flush(); assert.equal(h.calls.length, 2); h.sockets[1].event({ command: 'playback_finished' }); await p;
  h.calls[1].emit('error'); assert.equal(h.video.srcObject, null); assert(h.calls[1].destroyed > 0); await flush();
});
await check('init and playback deadlines clean up and preserve safe fallback evidence', async () => {
  const h = harness({ join: () => new Promise(() => {}) }); const waiting = h.sam.play('/tts'); const failed = assert.rejects(waiting, e => !e.playbackStarted);
  await flush(); h.timeout(30000); await failed; assert.equal(h.video.srcObject, null);
  const active = harness(); const playing = active.sam.play('/tts'); const stopped = assert.rejects(playing, e => e.playbackStarted);
  await flush(); active.timeout(300000); await stopped; assert.equal(active.video.srcObject, null); assert.equal(active.sockets[0].readyState, 3); await flush();
});
await check('autoplay rejection fails before source audio can be duplicated', async () => {
  const h = harness({ blockPlay: true }); const p = h.sam.play('/tts'); await assert.rejects(p, e => !e.playbackStarted);
  assert.equal(h.video.srcObject, null); assert.equal(h.sockets[0].sent.filter(x => x.command === 'audio').length, 0); await flush();
});
await check('prepared gesture context is reused for analysis and closed on page exit', async () => {
  const h = harness(); h.sam.prepare(); const prepared = h.contexts[0]; assert.equal(prepared.state, 'running');
  const p = h.sam.play('/tts'); await flush(); h.sockets[0].event({ command: 'playback_finished' }); await p;
  assert.equal(prepared.state, 'running'); h.sam.stop('pagehide'); assert.equal(prepared.state, 'closed'); await flush();
});
console.log(`${tests} synchronized video lifecycle checks passed.`);
