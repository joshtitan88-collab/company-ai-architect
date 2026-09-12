/**
 * The single Eve audio authority. play() resolves when finished OR cancelled.
 * Only confirmed canned assets are attempted; other text goes directly to /api/tts.
 * Events: loading, start (actual playback; includes audio), level (RMS 0..1),
 * end, cancel, unavailable, error. Every event includes its generation.
 * SamVoice owns the sole MediaElementSource; visual consumers use level events.
 */
(function (root) {
  "use strict";
  // Re-evaluating a script must not leave a second, unreachable audio owner.
  if (root.SamVoice && typeof root.SamVoice.stop === "function") {
    if (typeof module !== "undefined" && module.exports) module.exports = root.SamVoice;
    return;
  }
  const GREETING = "Hello, welcome to Company AI Architect. I am Sam, nice to meet you, and who do I have the pleasure of helping today?";
  // Verified against assets/voice/manifest.json. Never guess an asset filename.
  const CANNED = { hello: "./assets/sam-hello-v2.mp3" };
  CANNED[GREETING] = "./assets/sam-hello-v2.mp3";
  const FETCH_TIMEOUT = 25000;
  const START_TIMEOUT = 12000;
  const END_TIMEOUT = 300000;
  const ttsCache = new Map();
  let active = null;
  let generation = 0;
  let audioContext = null;
  const ownerId = root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  let voiceChannel = null, latestClaim = { clock: 0, owner: "" };
  try {
    if (root.BroadcastChannel) {
      voiceChannel = new root.BroadcastChannel("company-ai-architect-sam-voice");
      voiceChannel.onmessage = function (event) {
        const claim = event.data;
        if (!claim || claim.type !== "claim" || !Number.isFinite(claim.clock) || typeof claim.owner !== "string") return;
        if (claim.clock > latestClaim.clock || (claim.clock === latestClaim.clock && claim.owner > latestClaim.owner)) {
          latestClaim = claim;
          if (claim.owner !== ownerId) stop("another_tab");
        }
      };
    }
  } catch (_e) {}
  function claimVoice() {
    latestClaim = { type: "claim", clock: Math.max(Date.now(), latestClaim.clock + 1), owner: ownerId };
    try { voiceChannel?.postMessage(latestClaim); } catch (_e) {}
  }

  function emit(name, session, extra) {
    if (!root.dispatchEvent) return;
    root.dispatchEvent(new CustomEvent("samvoice:" + name, {
      detail: Object.assign({ generation: session ? session.id : generation, text: session ? session.text : "" }, extra || {}),
    }));
  }
  function cancelled() { return new Error("audio_cancelled"); }
  function isActive(s) { return active === s && !s.cancelled; }
  function check(s) { if (!isActive(s)) throw cancelled(); }
  function cacheDelete(text) {
    const url = ttsCache.get(text);
    if (!url) return;
    ttsCache.delete(text);
    URL.revokeObjectURL(url);
  }
  function cacheGet(text) {
    const url = ttsCache.get(text);
    if (url) { ttsCache.delete(text); ttsCache.set(text, url); }
    return url;
  }
  function cachePut(text, url) {
    cacheDelete(text);
    ttsCache.set(text, url);
    while (ttsCache.size > 40) cacheDelete(ttsCache.keys().next().value);
  }
  function slug(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }

  // A cancellation race also settles when a browser/network operation ignores abort.
  function bounded(s, work, ms, timeoutName, onTimeout) {
    check(s);
    return new Promise(function (resolve, reject) {
      let settled = false;
      const finish = function (error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.waiters.delete(cancel);
        if (error) reject(error); else resolve(value);
      };
      const cancel = function () { finish(cancelled()); };
      const timer = setTimeout(function () {
        if (onTimeout) onTimeout();
        finish(new Error(timeoutName));
      }, ms);
      s.waiters.add(cancel);
      Promise.resolve().then(function () { check(s); return work(); }).then(
        function (value) { if (!isActive(s)) finish(cancelled()); else finish(null, value); },
        function (error) { finish(error); }
      );
    });
  }

  // Resume in the initiating gesture; do not route audio through a suspended graph.
  function prepareContext() {
    try { root.SamVideo?.prepare?.(); } catch (_e) {}
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audioContext) audioContext = new AC();
      if (audioContext.state === "suspended") {
        const p = audioContext.resume();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (_e) {}
  }
  function meter(s, audio) {
    if (!audioContext || audioContext.state !== "running" || !root.requestAnimationFrame) return function () {};
    let source, analyser, raf = 0, stopped = false;
    try {
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source = audioContext.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioContext.destination);
    } catch (_e) {
      // If a source exists, retain an audible route even if analysis failed.
      try { if (source) source.connect(audioContext.destination); } catch (_ignored) {}
      return function () { try { if (source) source.disconnect(); } catch (_ignored) {} };
    }
    const buffer = new Uint8Array(analyser.fftSize);
    const tick = function () {
      if (stopped || !isActive(s)) return;
      let level = 0;
      if (!audio.paused && !audio.ended) {
        analyser.getByteTimeDomainData(buffer);
        for (let i = 0; i < buffer.length; i++) {
          const value = (buffer[i] - 128) / 128;
          level += value * value;
        }
        level = Math.sqrt(level / buffer.length);
      }
      emit("level", s, { audio: audio, level: level });
      raf = root.requestAnimationFrame(tick);
    };
    raf = root.requestAnimationFrame(tick);
    return function () {
      stopped = true;
      root.cancelAnimationFrame(raf);
      try { source.disconnect(); analyser.disconnect(); } catch (_e) {}
    };
  }

  function stop(reason) {
    const s = active;
    active = null;
    generation += 1;
    // The live renderer must silence its media synchronously before local audio
    // can acquire ownership, including another-tab and hidden-page interrupts.
    try { root.SamVideo?.stop(reason || "stopped"); } catch (_e) {}
    try { root.speechSynthesis?.cancel(); } catch (_e) {}
    if (s) {
      s.cancelled = true;
      if (s.controller) s.controller.abort();
      Array.from(s.waiters).forEach(function (cancel) { cancel(); });
      if (s.cleanupAudio) s.cleanupAudio();
      emit("level", s, { level: 0, audio: s.audio || null });
    }
    emit("cancel", s, { reason: reason || "stopped" });
  }

  async function playUrl(s, url, origin) {
    if (root.SamVideo) {
      const enabled = await bounded(s, () => root.SamVideo.enabled(), 2500, "video_config_timeout").catch(error => {
        check(s);
        return false;
      });
      check(s);
      if (enabled) {
        let remoteStarted = false;
        try {
          await bounded(s, () => root.SamVideo.play(url, {
            onStart(detail) {
              check(s);
              remoteStarted = true;
              emit("start", s, { audio: detail.audio, source: "video" });
            },
          }), END_TIMEOUT, "video_end_timeout", () => root.SamVideo.stop("timeout"));
          return;
        } catch (error) {
          check(s);
          root.SamVideo.stop("fallback");
          // Never replay a sentence that has already begun through the avatar.
          if (remoteStarted) error.playbackStarted = true;
          if (error.playbackStarted || error.message === "audio_gesture_required") throw error;
        }
      }
    }
    return playLocalUrl(s, url, origin);
  }

  function playLocalUrl(s, url, origin) {
    check(s);
    return new Promise(function (resolve, reject) {
      const audio = new Audio(url);
      let started = false, settled = false, timer;
      let stopMeter = function () {};
      s.audio = audio;
      audio.preload = "auto";
      const cleanup = function () {
        clearTimeout(timer);
        s.waiters.delete(cancel);
        audio.removeEventListener("playing", playing);
        audio.removeEventListener("ended", ended);
        audio.removeEventListener("error", failed);
        stopMeter();
        // Silence first: a late play() completion cannot resurrect audible media.
        audio.muted = true;
        audio.volume = 0;
        try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (_e) {}
        if (s.audio === audio) s.audio = null;
        if (s.cleanupAudio === cleanup) s.cleanupAudio = null;
      };
      const finish = function (error) {
        if (settled) return;
        settled = true;
        cleanup();
        if (isActive(s)) emit("level", s, { level: 0, audio: audio });
        if (error) { error.playbackStarted = started; reject(error); } else resolve();
      };
      const cancel = function () { finish(cancelled()); };
      const playing = function () {
        if (!isActive(s)) return cancel();
        if (started) return;
        started = true;
        clearTimeout(timer);
        const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 + 15000 : END_TIMEOUT;
        timer = setTimeout(function () { finish(new Error("audio_end_timeout")); }, Math.min(END_TIMEOUT, durationMs));
        stopMeter = meter(s, audio);
        emit("start", s, { audio: audio, source: origin });
      };
      const ended = function () { finish(isActive(s) ? null : cancelled()); };
      const failed = function (error) { finish(new Error(error && error.name === "NotAllowedError" ? "audio_gesture_required" : "audio_failed")); };
      s.waiters.add(cancel);
      s.cleanupAudio = cleanup;
      audio.addEventListener("playing", playing);
      audio.addEventListener("ended", ended);
      audio.addEventListener("error", failed);
      timer = setTimeout(function () { finish(new Error("audio_start_timeout")); }, START_TIMEOUT);
      try {
        const p = audio.play();
        if (p && p.catch) p.catch(failed);
      } catch (error) { failed(error); }
    });
  }

  async function fetchTts(s) {
    const ctrl = new AbortController();
    s.controller = ctrl;
    try {
      return await bounded(s, async function () {
        const response = await fetch("/api/tts", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: s.text, voice_id: "eve" }), signal: ctrl.signal,
        });
        check(s);
        if (!response.ok) throw new Error("tts_" + response.status);
        const buffer = await response.arrayBuffer();
        // The body may resolve after abort or after a new reply. Never cache or play it.
        check(s);
        if (ctrl.signal.aborted) throw cancelled();
        if (!buffer || buffer.byteLength < 64) throw new Error("tts_empty");
        return new Blob([buffer], { type: response.headers.get("content-type") || "audio/mpeg" });
      }, FETCH_TIMEOUT, "tts_timeout", function () { ctrl.abort(); });
    } finally { if (s.controller === ctrl) s.controller = null; }
  }

  async function play(text) {
    const t = String(text || "").trim();
    if (!t) return { status: "empty" };
    stop("superseded");
    claimVoice();
    const s = { id: generation, text: t, cancelled: false, waiters: new Set(), audio: null, controller: null };
    active = s;
    prepareContext();
    emit("loading", s);
    try {
      let origin = "tts";
      const asset = Object.prototype.hasOwnProperty.call(CANNED, t) ? CANNED[t] : null;
      let complete = false;
      if (asset) {
        try { await playUrl(s, asset, "asset"); complete = true; origin = "asset"; }
        catch (error) {
          check(s);
          if (error.playbackStarted || error.message === "audio_gesture_required") throw error;
        }
      }
      if (!complete) {
        let url = cacheGet(t);
        if (url) {
          try { await playUrl(s, url, "tts"); complete = true; }
          catch (error) {
            check(s);
            cacheDelete(t);
            if (error.playbackStarted || error.message === "audio_gesture_required") throw error;
          }
        }
        if (!complete) {
          const blob = await fetchTts(s);
          check(s);
          url = URL.createObjectURL(blob);
          cachePut(t, url);
          await playUrl(s, url, "tts");
        }
      }
      check(s);
      active = null;
      emit("end", s, { source: origin });
      return { status: "ended" };
    } catch (error) {
      if (!isActive(s)) return { status: "cancelled" };
      active = null;
      if (s.cleanupAudio) s.cleanupAudio();
      emit("level", s, { level: 0 });
      const detail = { error: error && error.message ? error.message : String(error) };
      emit("unavailable", s, detail);
      emit("error", s, detail);
      return { status: "error", error: detail.error };
    }
  }
  const api = { GREETING: GREETING, slug: slug, play: play, stop: stop, canned: CANNED };
  root.SamVoice = api;
  root.addEventListener?.("pagehide", function () { stop("pagehide"); });
  if (typeof document !== "undefined") document.addEventListener?.("visibilitychange", function () {
    if (document.hidden) stop("hidden_tab");
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
