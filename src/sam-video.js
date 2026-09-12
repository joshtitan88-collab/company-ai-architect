import Daily from '@daily-co/daily-js';

/** One synchronized remote media element. This module never plays source TTS. */
export function createSamVideo(deps = {}) {
  const root = deps.root || window;
  const doc = deps.document || root.document;
  const fetcher = deps.fetch || root.fetch.bind(root);
  const DailyClient = deps.Daily || Daily;
  const Socket = deps.WebSocket || root.WebSocket;
  const Stream = deps.MediaStream || root.MediaStream;
  const AudioCtx = deps.AudioContext || root.AudioContext || root.webkitAudioContext;
  const OfflineCtx = deps.OfflineAudioContext || root.OfflineAudioContext || root.webkitOfflineAudioContext;
  const later = deps.setTimeout || root.setTimeout.bind(root);
  const cancelTimer = deps.clearTimeout || root.clearTimeout.bind(root);
  const raf = deps.requestAnimationFrame || root.requestAnimationFrame.bind(root);
  const cancelFrame = deps.cancelAnimationFrame || root.cancelAnimationFrame.bind(root);
  const now = deps.now || Date.now;
  const video = doc.getElementById('samLiveVideo');
  const desk = doc.getElementById('desk');
  let generation = 0, active = null, connection = null, capability = null;
  let capabilityUntil = 0, capabilityPending = null;
  let preparedContext = null;

  function prepare() {
    if (!AudioCtx) return;
    try {
      if (!preparedContext || preparedContext.state === 'closed') preparedContext = new AudioCtx();
      Promise.resolve(preparedContext.resume()).catch(() => {});
    } catch {}
  }

  function error(code, turn) {
    const e = new Error(code);
    // Once remote output could have been heard, local fallback must not repeat it.
    e.playbackStarted = Boolean(turn && (turn.started || turn.audioExposed));
    return e;
  }
  function current(turn) { return active === turn && generation === turn.generation && !turn.controller.signal.aborted; }
  function assertCurrent(turn) { if (!current(turn)) throw error('video_cancelled', turn); }
  function silence() {
    if (video) { video.muted = true; video.pause(); video.srcObject = null; }
    desk?.classList.remove('sam-video-ready');
  }
  function disposeMeter(conn) {
    if (conn?.meterFrame) cancelFrame(conn.meterFrame);
    if (conn) conn.meterFrame = 0;
    try { conn?.meterSource?.disconnect(); } catch {}
    try { conn?.meter?.disconnect(); } catch {}
    try { if (conn?.meterContext && conn.meterContext !== preparedContext) { const p = conn.meterContext.close(); p?.catch?.(() => {}); } } catch {}
    if (conn) { conn.meterSource = null; conn.meter = null; conn.meterContext = null; }
  }
  function cleanupToken(token) {
    if (!token) return;
    const controller = new AbortController();
    const timer = later(() => controller.abort(), 5000);
    Promise.resolve().then(() => fetcher('/api/lemonslice-session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'end', cleanupToken: token }), signal: controller.signal, keepalive: true,
    })).catch(() => {}).finally(() => cancelTimer(timer));
  }
  function destroyCall(call) {
    try { Promise.resolve(call?.destroy()).catch(() => {}); } catch {}
  }
  function disconnect(conn) {
    if (!conn || conn.closed) return;
    conn.closed = true;
    if (connection === conn) connection = null;
    disposeMeter(conn);
    if (conn.idleTimer) cancelTimer(conn.idleTimer);
    if (conn.frameId && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(conn.frameId);
    for (const [name, listener] of conn.listeners || []) { try { conn.call?.off(name, listener); } catch {} }
    if (conn.ws) {
      conn.ws.onopen = conn.ws.onmessage = conn.ws.onerror = conn.ws.onclose = null;
      try {
        if (conn.ws.readyState === 1) { conn.ws.send(JSON.stringify({ command: 'interrupt' })); conn.ws.send(JSON.stringify({ command: 'terminate' })); }
      } catch {}
      try { conn.ws.close(); } catch {}
    }
    for (const track of conn.stream?.getTracks() || []) { try { track.stop(); } catch {} }
    destroyCall(conn.call);
    cleanupToken(conn.cleanupToken);
  }
  function finish(turn, failure, value) {
    if (!current(turn)) return;
    active = null;
    cancelTimer(turn.initTimer); cancelTimer(turn.turnTimer);
    turn.signal?.removeEventListener('abort', turn.abort);
    turn.controller.abort();
    if (failure) {
      silence(); disconnect(connection);
      turn.reject(failure);
    } else {
      if (video) video.muted = true;
      disposeMeter(connection);
      // Avoid leaving a billable room open after a visitor walks away.
      const conn = connection;
      if (conn) conn.idleTimer = later(() => { if (!active && connection === conn) { silence(); disconnect(conn); } }, 60000);
      turn.resolve(value);
    }
  }
  function fail(turn, code) { finish(turn, error(code, turn)); }
  function stop(reason = 'interrupted') {
    const turn = active;
    const closeReasons = ['pagehide', 'hidden_tab', 'another_tab', 'visitor_stop', 'end', 'stopped', 'fallback', 'timeout'];
    const keepIdle = !turn && !closeReasons.includes(reason) && connection && !connection.closed && connection.ready;
    if (turn) {
      // Reject before invalidating generation, so interrupted play settles promptly.
      finish(turn, error('video_cancelled', turn));
    }
    generation++;
    silence();
    if (!keepIdle) disconnect(connection);
    if (['pagehide', 'hidden_tab', 'another_tab', 'end'].includes(reason) && preparedContext) {
      try { Promise.resolve(preparedContext.close()).catch(() => {}); } catch {}
      preparedContext = null;
    }
  }
  async function enabled() {
    if (!video || !desk || !AudioCtx || !OfflineCtx || !Socket || !Stream || root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    if (capabilityUntil > now()) return capability === true;
    if (capabilityPending) return capabilityPending;
    capabilityPending = (async () => {
      const controller = new AbortController(); const timer = later(() => controller.abort(), 2000);
      try {
        const response = await fetcher('/api/lemonslice-session', { signal: controller.signal, cache: 'no-store' });
        const body = await response.json(); capability = Boolean(response.ok && body.enabled === true);
      } catch { capability = false; }
      finally { cancelTimer(timer); capabilityUntil = now() + (capability ? 60000 : 10000); capabilityPending = null; }
      return capability;
    })();
    return capabilityPending;
  }

  function refreshTracks(conn) {
    if (conn.closed || connection !== conn) return;
    const participants = Object.values(conn.call.participants());
    const publisher = participants.find(p => !p.local && p.tracks?.audio?.state === 'playable' && p.tracks?.video?.state === 'playable');
    if (!publisher) return;
    const audio = publisher.tracks.audio.persistentTrack || publisher.tracks.audio.track;
    const picture = publisher.tracks.video.persistentTrack || publisher.tracks.video.track;
    if (!audio || !picture || audio.readyState === 'ended' || picture.readyState === 'ended') return;
    if (conn.audio === audio && conn.picture === picture && video.srcObject === conn.stream) return;
    if (active?.connection === conn && conn.ready && (conn.audio !== audio || conn.picture !== picture)) { fail(active, 'video_media_changed'); return; }
    conn.audio = audio; conn.picture = picture;
    const stream = conn.stream && conn.stream.getTracks().includes(audio) && conn.stream.getTracks().includes(picture) ? conn.stream : new Stream([audio, picture]);
    conn.stream = stream;
    video.muted = true; video.playsInline = true; video.autoplay = true; video.srcObject = stream;
    const capture = conn;
    Promise.resolve(video.play()).then(() => {
      if (capture.closed || connection !== capture || video.srcObject !== stream) return;
      function decoded() {
        if (capture.closed || connection !== capture || video.srcObject !== stream) return;
        if (video.readyState < 2 || video.videoWidth <= 0) return;
        capture.ready = true;
        desk.classList.add('sam-video-ready');
        capture.resolveReady?.(); capture.resolveReady = null;
      }
      if (typeof video.requestVideoFrameCallback === 'function') capture.frameId = video.requestVideoFrameCallback(decoded);
      else if (video.readyState >= 2 && video.videoWidth > 0) decoded();
      else video.addEventListener('loadeddata', decoded, { once: true });
    }).catch(() => { if (active && connection === conn) fail(active, 'video_playback_blocked'); });
  }
  async function connect(turn) {
    if (connection && !connection.closed && connection.ready && connection.expiresAt > now() + 30000) {
      if (connection.idleTimer) cancelTimer(connection.idleTimer);
      connection.idleTimer = null;
      refreshTracks(connection);
      return connection;
    }
    disconnect(connection);
    const response = await fetcher('/api/lemonslice-session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start' }), signal: turn.controller.signal,
    });
    const data = await response.json();
    if (!current(turn)) { cleanupToken(data.cleanupToken); throw error('video_cancelled', turn); }
    if (!response.ok || !data.ok || !data.roomUrl || !data.meetingToken || !data.websocketUrl || !data.cleanupToken) throw error('video_session_unavailable', turn);
    const conn = { ...data, expiresAt: typeof data.expiresAt === 'number' ? (data.expiresAt < 1e12 ? data.expiresAt * 1000 : data.expiresAt) : Date.parse(data.expiresAt), closed: false, ready: false, listeners: [] };
    connection = conn;
    conn.readyPromise = new Promise(resolve => { conn.resolveReady = resolve; });
    conn.call = DailyClient.createCallObject({ audioSource: false, videoSource: false, subscribeToTracksAutomatically: true });
    const update = () => refreshTracks(conn);
    const callError = () => { if (connection === conn) { if (active) fail(active, 'video_room_failed'); else { silence(); disconnect(conn); } } };
    for (const name of ['participant-joined', 'participant-updated', 'track-started']) { conn.call.on(name, update); conn.listeners.push([name, update]); }
    for (const name of ['error', 'left-meeting']) { conn.call.on(name, callError); conn.listeners.push([name, callError]); }
    conn.ws = new Socket(data.websocketUrl);
    const socketReady = new Promise((resolve, reject) => {
      conn.ws.onopen = () => { if (!conn.closed) resolve(); };
      conn.ws.onerror = () => { reject(error('video_socket_failed', turn)); if (active && connection === conn) fail(active, 'video_socket_failed'); };
      conn.ws.onclose = () => { if (connection === conn) { if (active) fail(active, 'video_socket_closed'); else { silence(); disconnect(conn); } } };
    });
    conn.ws.onmessage = event => {
      if (conn.closed || connection !== conn) return;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      const playing = active;
      if (data.command === 'playback_finished' && playing?.committed && playing.connection === conn) {
        if (data.interrupted) fail(playing, 'video_interrupted');
        else finish(playing, null, 'playback_finished');
      }
    };
    const joining = conn.call.join({ url: data.roomUrl, token: data.meetingToken });
    Promise.resolve(joining).then(() => { if (conn.closed) destroyCall(conn.call); }).catch(() => {});
    await Promise.all([joining, socketReady]);
    assertCurrent(turn); refreshTracks(conn);
    await conn.readyPromise;
    assertCurrent(turn); return conn;
  }

  async function pcm(url, turn) {
    const response = await fetcher(url, { signal: turn.controller.signal });
    if (!response.ok) throw error('video_audio_unavailable', turn);
    const buffer = await response.arrayBuffer(); assertCurrent(turn);
    if (!buffer.byteLength || buffer.byteLength > 20 * 1024 * 1024) throw error('video_audio_invalid', turn);
    const context = new AudioCtx();
    let decoded;
    try { decoded = await context.decodeAudioData(buffer); }
    finally { try { await context.close(); } catch {} }
    assertCurrent(turn);
    if (!decoded.duration || decoded.duration > 300) throw error('video_audio_invalid', turn);
    const frames = Math.ceil(decoded.duration * 16000);
    const offline = new OfflineCtx(1, frames, 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering(); assertCurrent(turn);
    const samples = rendered.getChannelData(0);
    const chunks = [];
    for (let offset = 0; offset < samples.length; offset += 1600) {
      const size = Math.min(1600, samples.length - offset); const bytes = new Uint8Array(size * 2); const view = new DataView(bytes.buffer);
      for (let i = 0; i < size; i++) { const sample = Math.max(-1, Math.min(1, samples[offset + i])); view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); }
      let raw = ''; for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
      chunks.push((deps.btoa || root.btoa.bind(root))(raw));
    }
    return chunks;
  }
  function meter(conn, turn, onStart) {
    const ctx = preparedContext?.state !== 'closed' && preparedContext ? preparedContext : new AudioCtx(); conn.meterContext = ctx;
    const source = ctx.createMediaStreamSource(new Stream([conn.audio])); const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    source.connect(analyser); // Deliberately no destination: video is the sole audio output.
    conn.meterSource = source; conn.meter = analyser;
    const samples = new Float32Array(analyser.fftSize);
    Promise.resolve(ctx.resume()).catch(() => {});
    function frame() {
      if (!current(turn) || connection !== conn) return;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0; for (const sample of samples) energy += sample * sample;
      if (turn.committed && !video.muted && !video.paused && conn.ready && Math.sqrt(energy / samples.length) > 0.003) {
        turn.started = true;
        try { onStart?.({ audio: video }); } catch {}
        return;
      }
      conn.meterFrame = raf(frame);
    }
    conn.meterFrame = raf(frame);
  }
  function play(url, { signal, onStart } = {}) {
    stop('superseded');
    if (signal?.aborted) return Promise.reject(error('video_cancelled'));
    const turn = { generation, controller: new AbortController(), signal, started: false, audioExposed: false, committed: false };
    active = turn;
    const result = new Promise((resolve, reject) => { turn.resolve = resolve; turn.reject = reject; });
    turn.abort = () => { if (current(turn)) stop('interrupted'); };
    signal?.addEventListener('abort', turn.abort, { once: true });
    turn.initTimer = later(() => fail(turn, 'video_initialization_timeout'), 30000);
    turn.turnTimer = later(() => fail(turn, 'video_playback_timeout'), 300000);
    (async () => {
      const [conn, chunks] = await Promise.all([connect(turn), pcm(url, turn)]);
      assertCurrent(turn); turn.connection = conn; cancelTimer(turn.initTimer);
      meter(conn, turn, onStart);
      // Keep the remote idle stream silent until this turn has reached the service.
      for (const audio of chunks) { assertCurrent(turn); conn.ws.send(JSON.stringify({ command: 'audio', audio, sampleRate: 16000, encoding: 'PCM16' })); }
      assertCurrent(turn); turn.committed = true;
      conn.ws.send(JSON.stringify({ command: 'audio_end' }));
      assertCurrent(turn); video.muted = false; turn.audioExposed = true;
      await video.play(); assertCurrent(turn);
    })().catch(() => { if (current(turn)) fail(turn, 'video_playback_failed'); });
    return result;
  }
  return { enabled, play, stop, prepare };
}

if (typeof window !== 'undefined') window.SamVideo = createSamVideo();
