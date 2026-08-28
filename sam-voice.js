/**
 * SamVoice — audio playback for Sam. Never uses window.speechSynthesis.
 *
 *   await SamVoice.play(text)
 *
 * Order: canned map → assets/voice/{slug}.mp3 → POST /api/tts (eve on the server).
 * Events on window: samvoice:start | samvoice:end | samvoice:error | samvoice:unavailable
 *
 * Pre-render canned lines to assets/voice/{SamVoice.slug(text)}.mp3
 * Locked greeting already lives at assets/sam-hello.mp3
 */
(function (root) {
  "use strict";

  const GREETING =
    "Hello, welcome to Company AI Architect. I am Sam, nice to meet you, and who do I have the pleasure of helping today?";

  const CANNED = {};
  CANNED[GREETING] = "./assets/sam-hello-v2.mp3";
  CANNED["hello"] = "./assets/sam-hello-v2.mp3";

  let current = null;
  let objectUrl = null;

  function slug(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function emit(name, detail) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function stop() {
    if (current) {
      try {
        current.pause();
        current.removeAttribute("src");
        current.load();
      } catch (_e) {}
      current = null;
    }
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (_e) {}
      objectUrl = null;
    }
  }

  function playUrl(url) {
    return new Promise(function (resolve, reject) {
      const a = new Audio(url);
      a.preload = "auto";
      const ok = function () {
        a.removeEventListener("error", bad);
        resolve(a);
      };
      const bad = function () {
        a.removeEventListener("playing", ok);
        reject(new Error("audio_failed"));
      };
      a.addEventListener("playing", ok, { once: true });
      a.addEventListener("error", bad, { once: true });
      const p = a.play();
      if (p && p.catch) p.catch(bad);
    });
  }

  function waitEnd(a) {
    return new Promise(function (resolve) {
      if (!a) return resolve();
      const done = function () {
        a.removeEventListener("ended", done);
        a.removeEventListener("error", done);
        resolve();
      };
      a.addEventListener("ended", done, { once: true });
      a.addEventListener("error", done, { once: true });
    });
  }

  async function fetchTts(text) {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text, voice_id: "eve" }),
    });
    if (!r.ok) throw new Error("tts_" + r.status);
    const buf = await r.arrayBuffer();
    if (!buf || buf.byteLength < 64) throw new Error("tts_empty");
    const blob = new Blob([buf], { type: r.headers.get("content-type") || "audio/mpeg" });
    return URL.createObjectURL(blob);
  }

  function cannedUrl(text) {
    if (CANNED[text]) return CANNED[text];
    const s = slug(text);
    if (s && CANNED[s]) return CANNED[s];
    if (text === GREETING) return "./assets/sam-hello-v2.mp3";
    return "./assets/voice/" + s + ".mp3";
  }

  async function play(text) {
    const t = String(text || "").trim();
    if (!t) return;
    stop();
    emit("samvoice:start", { text: t });
    const asset = cannedUrl(t);
    try {
      const a = await playUrl(asset);
      current = a;
      await waitEnd(a);
      if (current === a) {
        current = null;
        emit("samvoice:end", { text: t, source: "asset" });
      }
      return;
    } catch (_assetErr) {
      /* fall through to /api/tts */
    }
    try {
      const url = await fetchTts(t);
      objectUrl = url;
      const a = await playUrl(url);
      current = a;
      await waitEnd(a);
      if (current === a) {
        current = null;
        emit("samvoice:end", { text: t, source: "tts" });
      }
    } catch (err) {
      emit("samvoice:unavailable", { text: t, error: String(err && err.message ? err.message : err) });
      emit("samvoice:error", { text: t, error: String(err && err.message ? err.message : err) });
    }
  }

  const api = {
    GREETING: GREETING,
    slug: slug,
    play: play,
    stop: stop,
    canned: CANNED,
  };

  root.SamVoice = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
