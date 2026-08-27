# canned-voice — FINAL

## Findings
- api/tts.js is xAI-only (voice "eve", XAI_API_KEY). No OpenAI path exists in it.
- sam-voice.js cannedUrl() auto-derives "./assets/voice/" + SamVoice.slug(text) + ".mp3" for any text, so pre-rendered files are found WITHOUT any manifest or code change. manifest.json is informational only. sam-voice.js untouched.
- desk-nlu.js exports LINES/GREETING via module.exports; desk-messages.js only attaches SamMessages to globalThis (script handles both).
- 32 candidate lines collected (SamNLU.LINES + SamMessages.LINES, greeting + "{placeholder}" lines excluded).

## What happened
- Wrote scripts/render-voice.mjs (concurrency 2, skips existing, never logs the key; model gpt-4o-mini-tts voice nova, env-overridable SAM_TTS_MODEL / SAM_TTS_OPENAI_VOICE).
- Ran via bash -lc: OPENAI_API_KEY IS present (236 chars, format sk-proj-... OK, no whitespace contamination) but OpenAI returns 401 "Incorrect API key" for all requests -> key is invalid/revoked.
- Fallbacks checked: piper NOT installed, espeak-ng NOT installed (only ffmpeg exists). XAI_API_KEY absent from login env. Dev server :8788 /api/tts returns 501 tts_not_configured.
- Per instructions: reported clearly, changed nothing else. 0 mp3s rendered. manifest.json untouched. index.html untouched. No commits.

## Residue
- assets/voice/.rendered-map.json exists containing "{}" (2 bytes) — written by the failed run; rm was permission-denied. Safe to delete.

## Tests
- node require of sam-voice.js: OK
- node --check scripts/render-voice.mjs: OK
- rendered files: 0, total bytes: 0 (blocked on valid key)

## To finish later
Fix OPENAI_API_KEY (or export XAI_API_KEY and adapt tts call), then:
  bash -lc 'node /home/joshua/Projects/company-ai-architect-site/.claude/worktrees/sam-messages/scripts/render-voice.mjs'
It will render all 32 lines, skip existing, and write assets/voice/.rendered-map.json (text -> path) for merging into manifest.json.
