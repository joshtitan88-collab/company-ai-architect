/**
 * SamLipsync — energy-gated mouth animation for Sam.
 *
 * Listens for samvoice:start / samvoice:end. When SamVoice hands us the
 * playing HTMLAudioElement (detail.audio), we tap it through WebAudio
 * (MediaElementSource -> Analyser -> destination) and gate the #vidTalk
 * mouth video on speech energy: playing while Sam speaks, paused during
 * silences (>220ms below threshold), with hysteresis so it doesn't flicker.
 *
 * Never touches #vidTalk while vidTalk.dataset.ownAudio === "1" (the
 * lip-synced greeting clip plays its own audio — hands off).
 *
 * Fully optional: sam-voice.js works identically when this file is absent.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Enter speech above THRESH_ON, leave speech only after RMS stays below
  // THRESH_OFF for SILENCE_MS (hysteresis: on-threshold > off-threshold).
  const THRESH_ON = 0.02;
  const THRESH_OFF = 0.012;
  const SILENCE_MS = 220;

  let ctx = null; // shared AudioContext, created lazily inside the event
  const taps = new WeakMap(); // HTMLAudioElement -> AnalyserNode (a media element allows only ONE MediaElementSource, ever)
  let buf = null;
  let rafId = 0;
  let session = null;

  function getCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
      } catch (_e) {
        return null;
      }
    }
    if (ctx.state === "suspended") {
      try {
        const p = ctx.resume();
        if (p && p.catch) p.catch(function () {});
      } catch (_e) {}
    }
    return ctx;
  }

  function analyserFor(audio) {
    const c = getCtx();
    if (!c) return null;
    let an = taps.get(audio);
    if (an) return an;
    let src;
    try {
      src = c.createMediaElementSource(audio);
    } catch (_e) {
      return null; // already claimed elsewhere or unsupported — leave audio alone
    }
    an = c.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.5;
    // Route through to destination so the sound still plays.
    src.connect(an);
    an.connect(c.destination);
    taps.set(audio, an);
    return an;
  }

  function mouth() {
    return document.getElementById("vidTalk");
  }

  function mouthPlay() {
    const v = mouth();
    if (!v || v.dataset.ownAudio === "1") return;
    if (v.paused) {
      try {
        const p = v.play();
        if (p && p.catch) p.catch(function () {});
      } catch (_e) {}
    }
  }

  function mouthPause() {
    const v = mouth();
    if (!v || v.dataset.ownAudio === "1") return;
    if (!v.paused) {
      try {
        v.pause();
      } catch (_e) {}
    }
  }

  function stopLoop() {
    if (rafId) {
      try {
        cancelAnimationFrame(rafId);
      } catch (_e) {}
      rafId = 0;
    }
    session = null;
    // Leave #vidTalk alone here — desk.js owns mode transitions.
  }

  function rms(an) {
    const n = an.fftSize;
    if (!buf || buf.length !== n) buf = new Uint8Array(n);
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = (buf[i] - 128) / 128;
      sum += d * d;
    }
    return Math.sqrt(sum / n);
  }

  window.addEventListener("samvoice:start", function (e) {
    const audio = e && e.detail ? e.detail.audio : null;
    if (!audio || typeof audio.play !== "function") return;
    const an = analyserFor(audio);
    if (!an) return;
    stopLoop();

    const s = { audio: audio, an: an, speaking: true, silentAt: 0 };
    session = s;

    const tick = function () {
      if (session !== s) return;
      if (audio.ended) {
        stopLoop();
        return;
      }
      if (ctx && ctx.state === "suspended") {
        try {
          const p = ctx.resume();
          if (p && p.catch) p.catch(function () {});
        } catch (_e) {}
      }
      const level = rms(an);
      const now = (window.performance && performance.now) ? performance.now() : Date.now();
      const threshold = s.speaking ? THRESH_OFF : THRESH_ON;
      if (level >= threshold) {
        s.silentAt = 0;
        if (!s.speaking) s.speaking = true;
        mouthPlay();
      } else {
        if (!s.silentAt) {
          s.silentAt = now;
        } else if (now - s.silentAt > SILENCE_MS) {
          if (s.speaking) s.speaking = false;
          mouthPause();
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });

  window.addEventListener("samvoice:end", stopLoop);
  window.addEventListener("samvoice:error", stopLoop);
  window.addEventListener("samvoice:unavailable", stopLoop);
})();
