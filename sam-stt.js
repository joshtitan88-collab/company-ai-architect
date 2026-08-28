/**
 * sam-stt.js — dev-only local speech-to-text client.
 *
 * window.SamSTT = {
 *   available(): Promise<boolean>   — cached check of POST /api/stt (HEAD; 501 = unavailable)
 *   record(opts): Promise<string>   — records mic via MediaRecorder (audio/webm),
 *                                     stops after opts.maxMs (default 6000) or when
 *                                     the returned promise's .stop() is called;
 *                                     resolves with the transcript string.
 * }
 * No frameworks. Only works when the local dev server exposes /api/stt.
 */
(function () {
  "use strict";

  var availCache = null;

  function available() {
    if (availCache) return availCache;
    availCache = fetch("/api/stt", { method: "HEAD" })
      .then(function (r) { return r.status !== 501 && r.status !== 404; })
      .catch(function () { return false; });
    return availCache;
  }

  function transcribe(blob) {
    return fetch("/api/stt", {
      method: "POST",
      headers: { "content-type": blob.type || "audio/webm" },
      body: blob,
    }).then(function (r) {
      if (!r.ok) throw new Error("stt_http_" + r.status);
      return r.json();
    }).then(function (j) {
      if (!j.ok) throw new Error(j.error || "stt_failed");
      return j.text || "";
    });
  }

  function record(opts) {
    opts = opts || {};
    var maxMs = opts.maxMs || 6000;
    var stopFn = null;

    var p = new Promise(function (resolve, reject) {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        return reject(new Error("mediarecorder_unsupported"));
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        var rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        var chunks = [];
        var timer = setTimeout(function () { stop(); }, maxMs);

        function stop() {
          clearTimeout(timer);
          if (rec.state !== "inactive") rec.stop();
        }
        stopFn = stop;

        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onerror = function (e) {
          clearTimeout(timer);
          stream.getTracks().forEach(function (t) { t.stop(); });
          reject(e.error || new Error("recorder_error"));
        };
        rec.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(chunks, { type: mime || "audio/webm" });
          transcribe(blob).then(resolve, reject);
        };
        rec.start();
      }, reject);
    });

    p.stop = function () { if (stopFn) stopFn(); };
    return p;
  }

  window.SamSTT = { available: available, record: record };
})();
