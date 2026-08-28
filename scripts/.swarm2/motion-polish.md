# motion-polish progress

## read
- desk.js: modes idle/listen/process/talk via setMode; VIDS map; greeting ownAudio path (vidTalk.dataset.ownAudio==='1', onended->idle); setTalkClip swaps src; armVideos adds .has-vid.
- styles.css 437-470: .desk-still/.desk-vid stacked abs, opacity toggled by .talking/.has-vid combo classes -> hard cuts for listen/process (no rules at all for those vids; they defaulted opacity:1 -> stacking-order luck).

## plan
- CSS: .desk-vid default opacity 0, .26s ease transition; .desk-vid.on -> opacity 1. Drop the .has-vid.talking opacity matrix. Keep still rules for reduced-motion path.
- JS: setMode toggles .on on the active video, plays it; pauses the others after 300ms fadeTimer (skips any video that regained .on, and never pauses the active one -> lipsync-safe: we never force-play/pause vidTalk mid-talk).
- armVideos: reduceMotion -> return before adding has-vid (stills only, real fallback); otherwise add .on to vidIdle when idle.
- Breathing: @keyframes desk-breathe scale 1->1.008 6s on .desk-stage when desk not talking/listening/processing.
- Think veil: @keyframes veil-think opacity pulse on .desk.processing .desk-veil.
- Reduced-motion media block: animation none for .desk-stage/.desk-veil.

## status
- [x] plan
- [x] css edits (crossfade .26s, .desk-vid.on, desk-breathe 6s scale 1->1.008, veil-think pulse, reduced-motion animation:none guard)
- [x] js edits (setMode .on toggle + 300ms fadeTimer pause, armVideos reduceMotion early-return + idle-only nudge, canplay handler consistent)
- [x] verify: node --check OK; CSS brace depth 0, no negatives; dev server (already running on 8788, serves this worktree) receptionist/css/js all 200; served files contain new selectors + FADE_MS logic
