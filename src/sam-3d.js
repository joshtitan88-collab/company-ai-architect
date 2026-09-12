import { TalkingHead } from '@met4citizen/talkinghead';
import { LipsyncEn } from '@met4citizen/talkinghead/modules/lipsync-en.mjs';

// SAM's renderer never plays sound. SamVoice is the only audio authority.
const host = document.getElementById('sam3d');
const stage = document.getElementById('desk');
const progress = document.getElementById('avatarProgress');
const phonetics = new LipsyncEn();
let head, audio, timeline, level = null, smoothed = 0, lastViseme = '';
let loading, ready = false, loaded = false, contextLost = false, pageHidden = false;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clearSpeech() {
  audio = null;
  timeline = null;
  level = null;
  smoothed = 0;
  if (head) {
    head.isSpeaking = false;
    if (lastViseme) head.setValue('viseme_' + lastViseme, 0, 70);
    head.setValue('jawOpen', 0, 70);
  }
  lastViseme = '';
}

function animate(dt) {
  if (!head || !ready) return;
  const speaking = audio && !audio.paused && !audio.ended;
  // Viseme sequence follows actual media time; RMS closes lips in silence.
  // Word timing is estimated until the TTS provider supplies alignment.
  // Audio still plays without Web Audio on some devices. In that case use the
  // estimated viseme timing instead of leaving Sam's mouth completely still.
  const target = speaking ? (level === null ? .45 : Math.min(1, level * 9)) : 0;
  smoothed += (target - smoothed) * Math.min(1, dt / 65);
  let viseme = '';
  if (speaking && timeline && Number.isFinite(audio.duration) && audio.duration > 0) {
    const time = audio.currentTime / audio.duration * timeline.duration;
    let i = timeline.times.findIndex((t, n) => time >= t && time < t + timeline.durations[n]);
    if (i >= 0) viseme = timeline.visemes[i];
  }
  if (lastViseme && lastViseme !== viseme) head.setValue('viseme_' + lastViseme, 0, 65);
  if (viseme) {
    head.setValue('jawOpen', 0, 50);
    head.setValue('viseme_' + viseme, smoothed * .85, 50);
  }
  else head.setValue('jawOpen', smoothed * .42, 50);
  lastViseme = viseme;
}

function showReady() {
  ready = true;
  head.isSpeaking = Boolean(audio && !audio.paused && !audio.ended);
  stage.classList.add('avatar-3d-ready');
  host.setAttribute('aria-label', 'Sam, your interactive 3D receptionist');
  if (progress) progress.textContent = 'Interactive 3D';
  if (document.hidden || pageHidden) head.stop(); else head.start();
  window.dispatchEvent(new CustomEvent('sam3d:ready'));
}

function showUnavailable() {
  ready = false;
  stage.classList.remove('avatar-3d-ready');
  if (progress) progress.textContent = 'Sam is available by voice and text';
  window.dispatchEvent(new CustomEvent('sam3d:unavailable'));
}

async function start() {
  if (ready) return true;
  if (loading) return loading;
  loading = (async () => {
    let expired = false;
    try {
      head = new TalkingHead(host, {
        lipsyncModules: [], ttsEndpoint: null,
        cameraView: 'upper', cameraDistance: .12,
        cameraRotateEnable: false, cameraPanEnable: false, cameraZoomEnable: false,
        modelFPS: 30, modelPixelRatio: Math.min(1, 1.5 / (window.devicePixelRatio || 1)),
        modelMovementFactor: reduced ? 0 : .3,
        avatarIdleEyeContact: .85, avatarIdleHeadMove: reduced ? 0 : .15,
        avatarSpeakingEyeContact: .95, avatarSpeakingHeadMove: reduced ? 0 : .2,
        lightAmbientIntensity: 2.1, lightDirectIntensity: 16,
        lightDirectColor: 0xffe9db, lightSpotColor: 0x77b9ff, lightSpotIntensity: 6,
        avatarMood: 'neutral', update: animate,
      });
      // Three.js restores its own GPU resources; retain this instance so a
      // mobile context loss can recover without downloading a second model.
      head.renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        contextLost = true;
        head.stop();
        showUnavailable();
      });
      head.renderer.domElement.addEventListener('webglcontextrestored', () => {
        contextLost = false;
        if (loaded) showReady();
      });
      let loadTimer;
      const avatarLoad = head.showAvatar({ url: '/assets/3d/sam.glb', body: 'F', avatarMood: 'neutral' }, e => {
        if (progress && e.lengthComputable) progress.textContent = 'Preparing Sam · ' + Math.round(e.loaded / e.total * 100) + '%';
      });
      avatarLoad.then(() => { if (expired) head.stop(); }, () => {});
      try {
        await Promise.race([avatarLoad, new Promise((_, reject) => { loadTimer = setTimeout(() => reject(new Error('avatar_load_timeout')), 30000); })]);
      } finally { clearTimeout(loadTimer); }
      loaded = true;
      head.setValue('mouthSmileLeft', .12, 400);
      head.setValue('mouthSmileRight', .12, 400);
      head.lookAtCamera(6000);
      head.isSpeaking = Boolean(audio && !audio.paused && !audio.ended);
      if (contextLost) { head.stop(); return false; }
      showReady();
      return true;
    } catch (error) {
      expired = true;
      if (head) head.stop();
      console.warn('SAM 3D unavailable:', error.message);
      showUnavailable();
      return false;
    }
  })();
  return loading;
}

window.addEventListener('samvoice:start', event => {
  if (!event.detail?.audio) return;
  clearSpeech();
  audio = event.detail.audio;
  const t = phonetics.wordsToVisemes(event.detail.text || '');
  timeline = { ...t, duration: t.times.length ? t.times.at(-1) + t.durations.at(-1) : 1 };
  if (head && ready) { head.isSpeaking = true; head.lookAtCamera(5000); }
});
window.addEventListener('samvoice:level', event => {
  if (event.detail?.audio && event.detail.audio !== audio) return;
  const value = Number(event.detail?.level);
  if (Number.isFinite(value)) level = Math.max(0, value);
});
['samvoice:end', 'samvoice:cancel', 'samvoice:error', 'samvoice:unavailable'].forEach(name => window.addEventListener(name, clearSpeech));
window.addEventListener('sam:mode', event => {
  if (!head || !ready) return;
  if (event.detail?.mode === 'listen') head.lookAtCamera(10000);
});
window.addEventListener('pagehide', () => { pageHidden = true; clearSpeech(); if (head) head.stop(); });
document.addEventListener('visibilitychange', () => {
  if (!head || !ready) return;
  if (document.hidden || pageHidden) head.stop(); else head.start();
});
window.addEventListener('pageshow', () => { pageHidden = false; if (head && ready && !document.hidden) head.start(); });
window.Sam3D = { start, active: () => ready };
start();
