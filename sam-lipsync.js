/**
 * Company-face mouth driver. SamVoice alone owns the audio.
 * No audio-clock seek. After play() starts, currentTime is never assigned.
 * Idle, listen, and process loops are never paused here.
 * video.play() runs in the same turn as the utterance's audio.play().
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  let generation = null;
  let gestureRetry = null;
  let restorePlay = null;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function mouth() { return document.getElementById("vidTalk"); }

  function fileName(value) {
    return String(value || "").split("#")[0].split("?")[0].split("/").pop();
  }

  function declaredSource(video) {
    try {
      const source = video.querySelector && video.querySelector("source");
      return source && source.getAttribute ? source.getAttribute("src") : "";
    } catch (_e) {
      return "";
    }
  }

  function sameSource(video, src) {
    const target = fileName(src);
    if (!target) return false;
    return [video.currentSrc, video.src, declaredSource(video)].some(function (item) {
      return fileName(item) === target;
    });
  }

  function canPlay(video) {
    return video.readyState >= 3;
  }

  function clearLevel() {
    generation = null;
    const video = mouth();
    if (!video) return;
    video.style.setProperty("--sam-voice-level", "0");
    delete video.dataset.speaking;
  }

  function clearAudioHook() {
    const Ctor = window.Audio;
    if (restorePlay && Ctor && Ctor.prototype.play === restorePlay.wrapped) {
      Ctor.prototype.play = restorePlay.orig;
    }
    restorePlay = null;
  }

  function disarmGesture() {
    if (!gestureRetry) return;
    window.removeEventListener("pointerdown", gestureRetry, true);
    window.removeEventListener("keydown", gestureRetry, true);
    gestureRetry = null;
  }

  function retryPlayOnGesture(video) {
    if (!video || gestureRetry) return;
    gestureRetry = function () {
      disarmGesture();
      let pending;
      try { pending = video.play(); } catch (_e) { pending = null; }
      if (pending && typeof pending.catch === "function") {
        pending.catch(function () { retryPlayOnGesture(video); });
      }
    };
    window.addEventListener("pointerdown", gestureRetry, true);
    window.addEventListener("keydown", gestureRetry, true);
  }

  function startVideo(video) {
    if (!video || reducedMotion) return;
    video.muted = true;
    video.defaultMuted = true;
    if ("volume" in video) video.volume = 0;
    video.dataset.mouthStarted = "1";
    video.dataset.mouthLive = "1";
    let pending;
    try {
      pending = video.play();
    } catch (_e) {
      retryPlayOnGesture(video);
      return;
    }
    if (pending && typeof pending.catch === "function") {
      pending.catch(function () { retryPlayOnGesture(video); });
    }
  }

  // One currentTime write per utterance, and only before play().
  function zeroBeforePlay(video) {
    if (!video || video.dataset.mouthStarted === "1") return;
    if (video.currentTime === 0) return;
    try { video.currentTime = 0; } catch (_e) {}
  }

  let prepareGen = 0;
  function whenCanPlay(src, loop) {
    const video = mouth();
    const gen = ++prepareGen;
    if (!video) return Promise.resolve(false);
    video.dataset.mouthStarted = "";
    video.loop = !!loop;
    video.muted = true;
    video.defaultMuted = true;
    if ("volume" in video) video.volume = 0;
    // A src change leaves the previous readyState until the new clip loads.
    // Do not treat that as canplay, and do not seek to recover.
    const changed = !sameSource(video, src);
    if (changed) {
      video.src = src;
      try { video.load(); } catch (_e) {}
    }
    if (!changed && canPlay(video)) return Promise.resolve(true);
    return new Promise(function (resolve) {
      let settled = false;
      const finish = function (ok) {
        if (settled || gen !== prepareGen) return;
        settled = true;
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("error", onError);
        resolve(!!ok && canPlay(video));
      };
      const onReady = function () {
        if (canPlay(video)) finish(true);
      };
      const onError = function () { finish(false); };
      video.addEventListener("canplay", onReady);
      video.addEventListener("error", onError);
      if (!changed && canPlay(video)) finish(true);
    });
  }

  function hookNextAudioPlay(video) {
    clearAudioHook();
    const Ctor = window.Audio;
    const inherited = Ctor && Ctor.prototype ? Ctor.prototype.play : null;
    if (typeof inherited !== "function") {
      startVideo(video);
      return;
    }
    const orig = inherited;
    function wrapped() {
      if (Ctor.prototype.play === wrapped) Ctor.prototype.play = orig;
      restorePlay = null;
      startVideo(video);
      return orig.apply(this, arguments);
    }
    restorePlay = { orig: orig, wrapped: wrapped };
    Ctor.prototype.play = wrapped;
  }

  function startWithAudio(startAudio) {
    const video = mouth();
    if (!video) {
      startAudio();
      return;
    }
    hookNextAudioPlay(video);
    try {
      startAudio();
    } catch (error) {
      clearAudioHook();
      throw error;
    }
  }

  function cancel() {
    prepareGen++;
    clearAudioHook();
    disarmGesture();
    const video = mouth();
    if (video) video.dataset.mouthLive = "";
  }

  window.SamMouth = {
    whenCanPlay: whenCanPlay,
    zeroBeforePlay: zeroBeforePlay,
    startWithAudio: startWithAudio,
    retryPlayOnGesture: retryPlayOnGesture,
    cancel: cancel,
  };

  window.addEventListener("samvoice:start", function (event) {
    const detail = event.detail || {};
    if (!detail.audio) return;
    if (detail.source === "video") {
      clearAudioHook();
      return;
    }
    generation = detail.generation;
    const video = mouth();
    if (!video || video.dataset.ownAudio === "1" || reducedMotion) return;
    video.muted = true;
    if ("volume" in video) video.volume = 0;
  });

  window.addEventListener("samvoice:level", function (event) {
    const detail = event.detail || {};
    if (generation === null || detail.generation !== generation) return;
    const video = mouth();
    if (!video || video.dataset.ownAudio === "1") return;
    const level = Math.max(0, Math.min(1, Number(detail.level) || 0));
    video.style.setProperty("--sam-voice-level", String(level));
    video.dataset.speaking = level > 0.015 ? "1" : "0";
  });

  ["end", "cancel", "error", "unavailable"].forEach(function (name) {
    window.addEventListener("samvoice:" + name, function (event) {
      if (name !== "end") clearAudioHook();
      if (generation === null || !event.detail || event.detail.generation === generation) clearLevel();
    });
  });
})();
