# lipsync agent — progress

STATUS: DONE (all verifies pass)

## Files changed
- sam-voice.js (upgraded, public API unchanged: GREETING/slug/play/stop/canned)
- sam-lipsync.js (NEW, self-contained IIFE)
- index.html (+1 line: sam-lipsync.js script tag before desk.js)
- receptionist.html (+1 line: same)
- scripts/.swarm2/lipsync-sim.mjs (verification sim)

## sam-voice.js changes
1. TTS blob cache: Map text->objectURL, cap 40, LRU (recency refresh on hit), oldest evicted + revokeObjectURL on eviction. stop() no longer revokes (cache owns URLs). Failed cached playback -> cacheDelete + fresh fetch fallback.
2. samvoice:start detail now { text, audio } (playing HTMLAudioElement) on BOTH asset and tts paths. Start now emitted when playback actually begins (after 'playing' fires) — on total failure only samvoice:unavailable + samvoice:error fire (as before, no end either).
3. Event names/order otherwise identical: start -> end{source:"asset"|"tts"}; unavailable+error on failure.

## sam-lipsync.js contract
- Listens samvoice:start (needs detail.audio; no-ops without it -> works when sam-voice not upgraded), samvoice:end/error/unavailable stop the rAF loop, vidTalk left alone.
- Shared lazy AudioContext (resume() on suspended, retried in tick); per-element AnalyserNode cached in WeakMap (single MediaElementSource rule); source->analyser->destination so sound still plays; createMediaElementSource failure -> bail, audio untouched.
- RMS via getByteTimeDomainData (fftSize 512, smoothing .5). Hysteresis: enter speech at RMS>=0.02, leave only after <0.012 continuously >220ms. Speech -> vidTalk.play(); silence -> vidTalk.pause().
- Hard guard: never touches vidTalk when vidTalk.dataset.ownAudio === "1".

## Verify results
- node --check sam-voice.js: PASS
- node --check sam-lipsync.js: PASS
- node scripts/.swarm2/lipsync-sim.mjs: ALL PASS (API surface, asset+tts start includes audio, cache hit = no refetch, 40-cap eviction+revoke, evicted line refetches, sam-lipsync no-op in DOM-less env)
