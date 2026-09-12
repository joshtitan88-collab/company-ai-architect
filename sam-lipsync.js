/**
 * Original realistic Sam video presentation. SamVoice alone owns the audio.
 * Natural silences must never freeze Sam's face. The video keeps moving while
 * measured energy is exposed for 3D consumers through samvoice:level events.
 * desk.js owns transitions between idle and talk; this adapter owns no audio.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  let generation = null;
  let trackedAudio = null;
  let syncGreeting = null;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // The MP3 is the introduction's audio with 79 ms of leading delay removed.
  // Verified against the original MP4 audio; do not stretch unrelated replies.
  const GREETING_OFFSET = 0.079;
  function mouth() { return document.getElementById("vidTalk"); }
  function clear() {
    if (trackedAudio && syncGreeting) {
      trackedAudio.removeEventListener("timeupdate", syncGreeting);
      trackedAudio.removeEventListener("playing", syncGreeting);
    }
    trackedAudio = null;
    syncGreeting = null;
    generation = null;
    const video = mouth();
    if (video) {
      video.style.setProperty("--sam-voice-level", "0");
      delete video.dataset.speaking;
    }
  }
  window.addEventListener("samvoice:start", function (event) {
    const detail = event.detail || {};
    if (!detail.audio) return;
    clear();
    if (detail.source === "video") return;
    generation = detail.generation;
    const video = mouth();
    if (!video || video.dataset.ownAudio === "1" || reducedMotion) return;
    video.muted = true;
    if (video.dataset.speechClip === "greeting") {
      trackedAudio = detail.audio;
      syncGreeting = function () {
        if (generation !== detail.generation || video.dataset.speechClip !== "greeting") return;
        const target = (Number(detail.audio.currentTime) || 0) + GREETING_OFFSET;
        if (Math.abs((Number(video.currentTime) || 0) - target) > 0.06) {
          try { video.currentTime = target; } catch (_e) {}
        }
      };
      trackedAudio.addEventListener("timeupdate", syncGreeting);
      trackedAudio.addEventListener("playing", syncGreeting);
      syncGreeting();
    }
    if (video.paused) {
      try { const p = video.play(); if (p && p.catch) p.catch(function () {}); } catch (_e) {}
    }
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
      if (generation === null || !event.detail || event.detail.generation === generation) clear();
    });
  });
})();
