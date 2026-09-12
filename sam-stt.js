/** Cancellable microphone recording. Tap again to send; cancel never submits audio. */
(function () {
  'use strict';
  let check;
  function available() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return Promise.resolve(false);
    if (!check) check = fetch('/api/stt', { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      .then(r => { if (!r.ok) check = null; return r.ok; }).catch(() => { check = null; return false; });
    return check;
  }
  function record(opts = {}) {
    let recorder, stream, timer, finished = false, cancelled = false, stopRequested = false;
    let rejectPromise;
    const controller = new AbortController();
    const cleanup = () => { clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); };
    const stop = () => { stopRequested = true; if (recorder?.state === 'recording') recorder.stop(); };
    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject;
      const fail = error => { if (finished) return; finished = true; cleanup(); reject(error); };
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(media => {
        stream = media;
        if (cancelled || stopRequested) { cleanup(); return fail(new Error('recording_cancelled')); }
        try {
          const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
          if (!mime) return fail(new Error('unsupported_audio'));
          recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
          const chunks = [];
          recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
          recorder.onerror = event => fail(event.error || new Error('recording_failed'));
          recorder.onstop = async () => {
            cleanup();
            if (cancelled || finished) return;
            opts.onTranscribing?.();
            try {
              const blob = new Blob(chunks, { type: recorder.mimeType || mime });
              if (!blob.size || blob.size > 1024 * 1024) throw new Error('invalid_audio_size');
              const bytes = new Uint8Array(await blob.arrayBuffer());
              let binary = '';
              for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
              if (cancelled) return;
              timer = setTimeout(() => controller.abort(), 25000);
              const response = await fetch('/api/stt', {
                method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ mimeType: blob.type, audioBase64: btoa(binary) }),
              });
              const result = await response.json();
              if (!response.ok || !result.ok) throw new Error(result.error || 'stt_failed');
              if (!cancelled && !finished) { finished = true; cleanup(); resolve(result.text || ''); }
            } catch (error) { fail(error); }
          };
          recorder.start(); opts.onRecording?.();
          timer = setTimeout(stop, Math.min(20000, Math.max(1000, opts.maxMs || 15000)));
        } catch (error) { fail(error); }
      }, fail);
    });
    promise.stop = stop;
    promise.cancel = () => {
      if (finished) return;
      cancelled = true; finished = true; controller.abort(); stop(); cleanup();
      rejectPromise(new Error('recording_cancelled'));
    };
    return promise;
  }
  window.SamSTT = { available, record };
})();
