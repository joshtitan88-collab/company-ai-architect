/**
 * The single Eve audio authority. play() resolves when finished OR cancelled.
 * Only confirmed canned Eve assets are spoken. Unknown text stays on screen.
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
  // Verified against files in assets/voice. Never guess an asset filename.
  // Spoken replies use these Eve clips only. There is no paid TTS at request time.
  const CANNED = { hello: "./assets/sam-hello-v2.mp3" };
  CANNED[GREETING] = "./assets/sam-hello-v2.mp3";
  CANNED["Discovery is free. The written audit is one thousand five hundred. Architect plus a fourteen-day package starts at four thousand five hundred. You keep the map even if you stop after the audit."] = "./assets/voice/discovery-is-free-the-written-audit-is-one-thousand-five-hundred-architect-plus-.mp3";
  CANNED["Here are open discovery times in Eastern. Openings only — not who is on the book. Pick a slot."] = "./assets/voice/here-are-open-discovery-times-in-eastern-openings-only-not-who-is-on-the-book-pi.mp3";
  CANNED["I can take a message right here and it goes straight to the right team — or I can book you a free thirty-minute discovery now."] = "./assets/voice/i-can-take-a-message-right-here-and-it-goes-straight-to-the-right-team-or-i-can-.mp3";
  CANNED["I take the front, and every booking goes straight to the team. Leave me a message, or pick a discovery slot and I'll file it."] = "./assets/voice/i-take-the-front-and-every-booking-goes-straight-to-the-team-leave-me-a-message-.mp3";
  CANNED["Discovery is weekdays, nine to five Eastern, thirty minutes, free. Openings only on the calendar — no names."] = "./assets/voice/discovery-is-weekdays-nine-to-five-eastern-thirty-minutes-free-openings-only-on-.mp3";
  CANNED["Glad to help. I'm right here whenever you need us."] = "./assets/voice/glad-to-help-i-m-right-here-whenever-you-need-us.mp3";
  CANNED["What's your name?"] = "./assets/voice/what-s-your-name.mp3";
  CANNED["Work email?"] = "./assets/voice/work-email.mp3";
  CANNED["Shop or company name?"] = "./assets/voice/shop-or-company-name.mp3";
  CANNED["Pick an open time on the calendar, or name a weekday and time in Eastern."] = "./assets/voice/pick-an-open-time-on-the-calendar-or-name-a-weekday-and-time-in-eastern.mp3";
  CANNED["I'll file that discovery now?"] = "./assets/voice/i-ll-file-that-discovery-now.mp3";
  CANNED["Of course — I would be happy to pass that along. What would you like me to say?"] = "./assets/voice/of-course-i-would-be-happy-to-pass-that-along-what-would-you-like-me-to-say.mp3";
  CANNED["Go ahead, I am listening — what would you like me to pass along?"] = "./assets/voice/go-ahead-i-am-listening-what-would-you-like-me-to-pass-along.mp3";
  CANNED["And who shall I say it is from?"] = "./assets/voice/and-who-shall-i-say-it-is-from.mp3";
  CANNED["And what is the best way to reach you — an email or a phone number?"] = "./assets/voice/and-what-is-the-best-way-to-reach-you-an-email-or-a-phone-number.mp3";
  CANNED["I did not quite catch a working email or phone number there — could you give me one of those?"] = "./assets/voice/i-did-not-quite-catch-a-working-email-or-phone-number-there-could-you-give-me-on.mp3";
  CANNED["Of course, consider it dropped. Is there anything else I can help with — our packages, privacy, or a free thirty-minute discovery call?"] = "./assets/voice/of-course-consider-it-dropped-is-there-anything-else-i-can-help-with-our-package.mp3";
  CANNED["That message is already on its way. Is there anything else I can help with?"] = "./assets/voice/that-message-is-already-on-its-way-is-there-anything-else-i-can-help-with.mp3";
  CANNED["Even better — let us find you a time. Here are the open slots."] = "./assets/voice/even-better-let-us-find-you-a-time-here-are-the-open-slots.mp3";
  CANNED["That time just filled. Here is what's still open."] = "./assets/voice/that-time-just-filled-here-is-what-s-still-open.mp3";
  CANNED["I've noted your interest, and someone will follow up within a few hours."] = "./assets/voice/i-ve-noted-your-interest-and-someone-will-follow-up-within-a-few-hours.mp3";
  CANNED["You're already on the book for that time."] = "./assets/voice/you-re-already-on-the-book-for-that-time.mp3";
  CANNED["You're set. You'll get a confirmation shortly. I'm glad we found a time."] = "./assets/voice/you-re-set-you-ll-get-a-confirmation-shortly-i-m-glad-we-found-a-time.mp3";
  CANNED["I could not file that slot just now. Try again, or leave me a message and someone will follow up."] = "./assets/voice/i-could-not-file-that-slot-just-now-try-again-or-leave-me-a-message-and-someone-.mp3";
  CANNED["Welcome back — good to see you again."] = "./assets/voice/welcome-back-good-to-see-you-again.mp3";
  CANNED["This browser has no speech recognition — type and I'll help just the same."] = "./assets/voice/this-browser-has-no-speech-recognition-type-and-i-ll-help-just-the-same.mp3";
  CANNED["I didn't quite catch that — type it and I'll help just the same."] = "./assets/voice/i-didn-t-quite-catch-that-type-it-and-i-ll-help-just-the-same.mp3";
  CANNED["The mic did not start — type and I'll help just the same."] = "./assets/voice/the-mic-did-not-start-type-and-i-ll-help-just-the-same.mp3";
  CANNED["I'm Sam, the receptionist for Company AI Architect. I book discovery, quote the packages, and talk privacy. Not a ChatGPT login."] = "./assets/voice/i-m-sam-the-receptionist-for-company-ai-architect-i-book-discovery-quote-the-pac.mp3";
  CANNED["No problem. Discovery stays free whenever you want it."] = "./assets/voice/no-problem-discovery-stays-free-whenever-you-want-it.mp3";
  CANNED["No problem. What else — prices, privacy, or a later time?"] = "./assets/voice/no-problem-what-else-prices-privacy-or-a-later-time.mp3";
  CANNED["I don't have that opening. Name another weekday and time."] = "./assets/voice/i-don-t-have-that-opening-name-another-weekday-and-time.mp3";
  CANNED["Local AI on hardware you own — a tower or a mini at your shop. Calls, jobs, and notes."] = "./assets/voice/local-ai-on-hardware-you-own-a-tower-or-a-mini-at-your-shop-calls-jobs-and-notes.mp3";
  CANNED["That's the leak. I catch it before it becomes a voicemail. Pick a free thirty-minute discovery."] = "./assets/voice/that-s-the-leak-i-catch-it-before-it-becomes-a-voicemail-pick-a-free-thirty-minu.mp3";
  CANNED["You're welcome. Discovery is free if you want a slot."] = "./assets/voice/you-re-welcome-discovery-is-free-if-you-want-a-slot.mp3";
  CANNED["It's on the book. You'll get a confirmation. Nothing else is stored on this page."] = "./assets/voice/it-s-on-the-book-you-ll-get-a-confirmation-nothing-else-is-stored-on-this-page.mp3";
  CANNED["All set. It is with the right person now."] = "./assets/voice/all-set-it-is-with-the-right-person-now.mp3";
  CANNED["I am sorry I could not file that just now. If you email us directly it will reach."] = "./assets/voice/i-am-sorry-i-could-not-file-that-just-now-if-you-email-us-directly-it-will-reach.mp3";
  CANNED["I can book a free discovery, quote the packages, or talk privacy. Thirty minutes free."] = "./assets/voice/i-can-book-a-free-discovery-quote-the-packages-or-talk-privacy-thirty-minutes-fr.mp3";
  CANNED["Sam again. Discovery, prices, privacy, or I can book a free thirty minutes."] = "./assets/voice/sam-again-discovery-prices-privacy-or-i-can-book-a-free-thirty-minutes.mp3";
  CANNED["Customer files do not belong on this site. The discovery call does not need them."] = "./assets/voice/customer-files-do-not-belong-on-this-site-the-discovery-call-does-not-need-them-.mp3";
  CANNED["No open weekday slots in this window. Name a day and time and I'll still take the request."] = "./assets/voice/no-open-weekday-slots-in-this-window-name-a-day-and-time-and-i-ll-still-take-the.mp3";
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
      const asset = Object.prototype.hasOwnProperty.call(CANNED, t) ? CANNED[t] : null;
      if (!asset) throw new Error("tts_not_configured");
      await playUrl(s, asset, "asset");
      check(s);
      active = null;
      emit("end", s, { source: "asset" });
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
