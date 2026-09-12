import { TalkingHead } from '@met4citizen/talkinghead';
import { LipsyncEn } from '@met4citizen/talkinghead/modules/lipsync-en.mjs';

// SAM's renderer never plays sound. SamVoice is the only audio authority.
const host = document.getElementById('sam3d');
const stage = document.getElementById('desk');
const progress = document.getElementById('avatarProgress');
const phonetics = new LipsyncEn();
let head, audio, timeline, level = 0, smoothed = 0, lastViseme = '';
let loading, ready = false;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clearSpeech() {
  audio = null;
  timeline = null;
  level = 0;
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
  const target = speaking ? Math.min(1, level * 9) : 0;
  smoothed += (target - smoothed) * Math.min(1, dt / 65);
  let viseme = '';
  if (speaking && timeline && Number.isFinite(audio.duration) && audio.duration > 0) {
    const time = audio.currentTime / audio.duration * timeline.duration;
    let i = timeline.times.findIndex((t, n) => time >= t && time < t + timeline.durations[n]);
    if (i >= 0) viseme = timeline.visemes[i];
  }
  if (lastViseme && lastViseme !== viseme) head.setValue('viseme_' + lastViseme, 0, 65);
  if (viseme) head.setValue('viseme_' + viseme, smoothed * .85, 50);
  else head.setValue('jawOpen', smoothed * .42, 50);
  lastViseme = viseme;
}

async function start() {
  if (ready) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      head = new TalkingHead(host, {
        lipsyncModules: [], ttsEndpoint: null,
        cameraView: 'upper', cameraDistance: .12,
        cameraRotateEnable: false, cameraPanEnable: false, cameraZoomEnable: false,
        modelFPS: 30, modelPixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        modelMovementFactor: reduced ? 0 : .3,
        avatarIdleEyeContact: .85, avatarIdleHeadMove: reduced ? 0 : .15,
        avatarSpeakingEyeContact: .95, avatarSpeakingHeadMove: reduced ? 0 : .2,
        lightAmbientIntensity: 2.1, lightDirectIntensity: 16,
        lightDirectColor: 0xffe9db, lightSpotColor: 0x77b9ff, lightSpotIntensity: 6,
        avatarMood: 'neutral', update: animate,
      });
      await head.showAvatar({ url: '/assets/3d/sam.glb', body: 'F', avatarMood: 'neutral' }, e => {
        if (progress && e.lengthComputable) progress.textContent = 'Preparing Sam · ' + Math.round(e.loaded / e.total * 100) + '%';
      });
      ready = true;
      stage.classList.add('avatar-3d-ready');
      host.setAttribute('aria-label', 'Sam, your interactive 3D receptionist');
      if (progress) progress.textContent = 'Interactive 3D';
      head.setValue('mouthSmileLeft', .12, 400);
      head.setValue('mouthSmileRight', .12, 400);
      head.lookAtCamera(6000);
      window.dispatchEvent(new CustomEvent('sam3d:ready'));
      return true;
    } catch (error) {
      if (progress) progress.textContent = 'Sam is available by voice and text';
      console.warn('SAM 3D unavailable:', error.message);
      stage.classList.remove('avatar-3d-ready');
      return false;
    }
  })();
  return loading;
}

window.addEventListener('samvoice:start', event => {
  if (!event.detail?.audio) return;
  audio = event.detail.audio;
  const t = phonetics.wordsToVisemes(event.detail.text || '');
  timeline = { ...t, duration: t.times.length ? t.times.at(-1) + t.durations.at(-1) : 1 };
  if (head && ready) { head.isSpeaking = true; head.lookAtCamera(5000); }
});
window.addEventListener('samvoice:level', event => { level = Number(event.detail?.level) || 0; });
['samvoice:end', 'samvoice:cancel', 'samvoice:unavailable'].forEach(name => window.addEventListener(name, clearSpeech));
window.addEventListener('sam:mode', event => {
  if (!head || !ready) return;
  if (event.detail.mode === 'listen') head.lookAtCamera(10000);
});
window.addEventListener('pagehide', () => { clearSpeech(); if (head) head.stop(); });
document.addEventListener('visibilitychange', () => {
  if (!head || !ready) return;
  if (document.hidden) head.stop(); else head.start();
});
window.Sam3D = { start, active: () => ready };
start();
