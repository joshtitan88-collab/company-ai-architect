/**
 * Optional video fallback for SamVoice. SamVoice alone owns WebAudio analysis.
 * Natural silences must never freeze Sam's face. The video keeps moving while
 * measured energy is exposed for 3D consumers through samvoice:level events.
 * desk.js owns transitions between idle and talk; this adapter owns no audio.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  let generation = null;
  function mouth() { return document.getElementById("vidTalk"); }
  function clear() {
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
    generation = detail.generation;
    const video = mouth();
    if (!video || video.dataset.ownAudio === "1") return;
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
