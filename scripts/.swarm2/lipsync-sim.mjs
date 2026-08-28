// Sim: require sam-voice.js with a window stub, assert public API + event contract + blob cache.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);

const events = []; // {name, detail}

if (typeof globalThis.CustomEvent !== "function") {
  globalThis.CustomEvent = class CustomEvent {
    constructor(name, opts) {
      this.type = name;
      this.detail = (opts && opts.detail) || {};
    }
  };
}

globalThis.window = {
  dispatchEvent(ev) {
    events.push({ name: ev.type, detail: ev.detail });
    return true;
  },
  addEventListener() {},
};

// --- Audio stub: canned greeting + blob: URLs play; other asset paths 404 ---
class FakeAudio {
  constructor(url) {
    this.src = url;
    this._ls = {};
    this.preload = "";
  }
  addEventListener(n, f) {
    (this._ls[n] = this._ls[n] || []).push(f);
  }
  removeEventListener(n, f) {
    if (this._ls[n]) this._ls[n] = this._ls[n].filter((x) => x !== f);
  }
  _fire(n) {
    const fs = (this._ls[n] || []).slice();
    this._ls[n] = []; // sam-voice always uses {once:true}
    for (const f of fs) f();
  }
  play() {
    const good = this.src === "./assets/sam-hello-v2.mp3" || this.src.startsWith("blob:");
    return Promise.resolve().then(() => {
      if (good) {
        this._fire("playing");
        setTimeout(() => this._fire("ended"), 5);
      } else {
        this._fire("error");
        throw new Error("404");
      }
    });
  }
  pause() {}
  removeAttribute() {}
  load() {}
}
globalThis.Audio = FakeAudio;

// --- fetch + object URL stubs -----------------------------------------------
let fetchCalls = 0;
globalThis.fetch = async (url, opts) => {
  fetchCalls++;
  assert.equal(url, "/api/tts");
  assert.equal(JSON.parse(opts.body).voice_id, "eve");
  return {
    ok: true,
    headers: { get: () => "audio/mpeg" },
    arrayBuffer: async () => new ArrayBuffer(128),
  };
};
if (typeof globalThis.Blob !== "function") globalThis.Blob = class Blob { constructor() {} };
let urlN = 0;
const revoked = [];
globalThis.URL.createObjectURL = () => "blob:fake-" + ++urlN;
globalThis.URL.revokeObjectURL = (u) => revoked.push(u);

// --- load module -------------------------------------------------------------
const SamVoice = require("../../sam-voice.js");

// 1) public API surface unchanged
assert.deepEqual(Object.keys(SamVoice).sort(), ["GREETING", "canned", "play", "slug", "stop"]);
assert.equal(typeof SamVoice.play, "function");
assert.equal(typeof SamVoice.stop, "function");
assert.equal(typeof SamVoice.slug, "function");
assert.ok(SamVoice.GREETING.startsWith("Hello, welcome to Company AI Architect"));
assert.equal(SamVoice.canned["hello"], "./assets/sam-hello-v2.mp3");
assert.equal(SamVoice.slug("Hi, There!!"), "hi-there");
assert.equal(globalThis.window.SamVoice, SamVoice);

// 2) canned-asset path: start carries {text, audio}, then end {source:"asset"}
events.length = 0;
await SamVoice.play("hello");
assert.deepEqual(events.map((e) => e.name), ["samvoice:start", "samvoice:end"]);
assert.equal(events[0].detail.text, "hello");
assert.ok(events[0].detail.audio instanceof FakeAudio, "start detail.audio missing (asset path)");
assert.equal(events[1].detail.source, "asset");

// 3) tts path: asset 404 -> fetch, start carries audio, end source "tts"
events.length = 0;
await SamVoice.play("dynamic line one");
assert.deepEqual(events.map((e) => e.name), ["samvoice:start", "samvoice:end"]);
assert.ok(events[0].detail.audio instanceof FakeAudio, "start detail.audio missing (tts path)");
assert.ok(events[0].detail.audio.src.startsWith("blob:"), "tts path should play a blob URL");
assert.equal(events[1].detail.source, "tts");
assert.equal(fetchCalls, 1);

// 4) blob cache: replaying same text does NOT refetch
events.length = 0;
await SamVoice.play("dynamic line one");
assert.equal(fetchCalls, 1, "cache miss: refetched a cached line");
assert.deepEqual(events.map((e) => e.name), ["samvoice:start", "samvoice:end"]);

// 5) cache cap ~40 with oldest eviction (revokes evicted objectURLs)
for (let i = 0; i < 45; i++) await SamVoice.play("filler line " + i);
assert.equal(fetchCalls, 1 + 45);
assert.ok(revoked.length >= 5, "expected oldest entries evicted+revoked, got " + revoked.length);
await SamVoice.play("dynamic line one"); // was oldest -> evicted -> refetch
assert.equal(fetchCalls, 1 + 45 + 1, "evicted line should refetch");

// 6) sam-lipsync.js absent: nothing above depended on it — and loading it in a
//    DOM-less env must be a no-op, not a crash
require("../../sam-lipsync.js");

console.log("lipsync-sim: ALL PASS (" + fetchCalls + " tts fetches, " + revoked.length + " evictions)");
