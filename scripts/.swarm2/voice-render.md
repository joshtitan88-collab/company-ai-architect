# voice-render findings (render-voice-prod.mjs)

Status: COMPLETE 2026-08-28

- Script: scripts/render-voice-prod.mjs — POSTs live https://www.companyaiarchitect.com/api/tts {text, voice_id:"eve"}; concurrency 2, 20s timeout, skip existing >1KB, 1 retry.
- 43 unique canned lines collected (SamNLU.LINES minus greeting, SamMessages.LINES minus dynamic/fragments, 4 inline NLU strings, 9 desk.js hardcoded strings). Greeting skipped (locked at assets/sam-hello-v2.mp3).
- Result: 42 mp3 files in assets/voice/, all >1KB, 0 failures, total_bytes=3,503,232. ffprobe spot-check: what-s-your-name.mp3 = valid mp3, 1.176s. 24kHz mono 128kbps.
- Manifest of rendered slugs: assets/voice/.rendered-map.json

## SLUG COLLISION (43 lines -> 42 files)
SamNLU.LINES.book_fail ("I could not file that slot just now. Try again, or leave me a message and someone will follow up within a few hours.") and desk.js catch-line ("...someone will follow up.") truncate to the SAME 80-char slug `i-could-not-file-that-slot-just-now-try-again-or-leave-me-a-message-and-someone-`. File audio = book_fail (longer) text. Playing the desk.js line uses that same file — close enough in meaning, but not word-identical.

## Dynamic lines (cannot be canned — fall through to live /api/tts)
1. SamMessages.LINES.sent — "{team}" placeholder
2. SamMessages.LINES.confirm_prefix / confirm_suffix — fragments inside confirmLine() (name/company/contact/message interpolation)
3. SamNLU askNext/turn confirm: "That's {when} Eastern for {name} at {company}. I'll file it now?" and "That's {when} Eastern. I'll file it now?"
4. Any reply + openingsLine(slots) suffix: LINES.schedule/schedule_none/leak + " Next openings: ...", and "I don't have that opening." + openings variant
5. desk.js welcome-back with booking: "Welcome back — good to see you again. You're on the book for {slotLabel}. Anything else I can help with?"
6. All /api/sam-chat (LLM) freeform replies

Note: LINES.schedule with non-empty slots always gets the openings suffix appended, so the plain canned schedule mp3 mostly serves the rare empty-suffix path; harmless.
