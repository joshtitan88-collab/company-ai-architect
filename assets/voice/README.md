# Sam voice assets (Eve)

xAI TTS `voice_id=eve`, `language=en`, MP3. Do **not** call the live TTS API until Joshua confirms (paid). Do **not** put `XAI_API_KEY` in the browser.

Public site stays closed (`index.html` title: “Sam is offline”) until critics pass.

## Key

Function reads `process.env.XAI_API_KEY` only.

As of 2026-08-27:

- Tower shell: **absent**
- Vercel project `company-ai-architect` (`prj_C22GLMaAGoNt1XPEdvbKbjqV4Lm8`): **absent** (only `GITHUB_TOKEN` is set)
- `~/.config/xai/create-key-response.json`: error payload, not a live key
- Grok OAuth session in `~/.grok/auth.json` is **not** an API key — do not reuse it for TTS

Joshua must set Vercel env `XAI_API_KEY` (Preview + Production) himself. Do not create or spend keys from this seat.

## LINES → static files

`desk.js` `LINES` map. Prefer these files over `/api/tts` so the greeting is instant and costs nothing at request time.

| id | filename | status |
|---|---|---|
| hello | `hello.mp3` | **exists** — copy of `../sam-hello.mp3` (7.4s, mp3 192kbps, 2026-08-27) |
| capabilities | `capabilities.mp3` | missing — render after confirm |
| price | `price.mp3` | missing — render after confirm |
| privacy | `privacy.mp3` | missing — render after confirm |
| schedule | `schedule.mp3` | missing — render after confirm |
| leak | `leak.mp3` | missing — render after confirm |
| none | `none.mp3` | missing — render after confirm |

Locked hello text:

> Hello, welcome to Company AI Architect. I am Sam, nice to meet you, and who do I have the pleasure of helping today?

Canonical on-disk original: `assets/sam-hello.mp3`. Keep both until `desk.js` is wired.

## Extra spoken lines (not in `LINES`)

Render the same way when desk.js is switched off Chrome `speechSynthesis`:

| id | filename | text |
|---|---|---|
| book-prompt | `book-prompt.mp3` | Name, work email, shop. I take the slot. This board never shows who is booked. |
| booked | `booked.mp3` | It's on the book. You'll get a confirmation. Nothing else is stored on this page. |
| book-fail | `book-fail.mp3` | I could not file that slot. Try again. |

Shorter log-only strings (`Booked.`, `Booking failed.`, mic fallbacks) may stay silent or hit `/api/tts`.

## Live path (after env is set)

`POST /api/tts` `{ "text": "..." }` → `audio/mpeg`.

Allowlist: exact `LINES` + extras above, plus short dynamic receptionist replies (≤220 chars, no URLs). Max 500 chars. Key never leaves the serverless function.

## `desk.js` replace (not done here)

Chrome `speechSynthesis` is forbidden. When Claude/Grok wires voice:

1. Map known `LINES` ids → `/assets/voice/{id}.mp3`
2. `hello` may keep using `/assets/sam-hello.mp3` until the copy is the only source
3. Unknown short replies → `POST /api/tts` blob URL
4. On 503 `not_configured` or network fail: show text, do **not** fall back to `speechSynthesis`

Do not deploy this as an open public receptionist until critics pass and the remaining mp3s exist.
