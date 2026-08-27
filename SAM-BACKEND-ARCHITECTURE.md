# Sam Backend Architecture (Joshua's spec, 2026-08-27) — mapped to current stack

Two layers, hard boundary between them:

- **Sam layer** (this repo): chat, qualification, booking, message intake.
  Emits structured events; never writes chat logs into the pipeline.
- **Core Operator layer**: pipeline, research, call prep, follow-ups, metrics,
  Daily/Weekly loops. Consumes events; owns the lead after handoff.

## Current transport: GitHub issues on the intake repo

The intake repo (`joshtitan88-collab/company-ai-architect`) is today's queue,
database, and admin view in one. Every event is an issue:

| event               | label(s)                                | emitter        |
|---------------------|-----------------------------------------|----------------|
| appointment_booked  | `desk-booking` `qualified-lead` `fit:*` | `/api/book`    |
| message_taken       | `desk-message` `route:<team>`           | `/api/message` |

`/api/book` embeds the canonical **handoff event** as a fenced JSON block in
the issue body (`## Handoff event`). The Core Operator MUST parse that block,
not the markdown fields (which exist for the human admin view). Shape:

```json
{
  "event_type": "appointment_booked",
  "timestamp": "…Z",
  "lead": { "name": "…", "email": "…", "company": "…", "phone": "…", "source": "sam_website" },
  "appointment": { "start_time_utc": "…Z", "timezone": "America/New_York",
                   "type": "discovery", "duration_minutes": 30,
                   "status": "booked", "created_by": "sam" },
  "conversation_summary": "…",
  "interest_level": "high|medium|low",
  "objections": "…",
  "conversation_highlights": "…",
  "raw_session_id": "sam_chat_…"
}
```

## Spec → status map

| Spec item                          | Status                                                        |
|------------------------------------|---------------------------------------------------------------|
| Structured handoff (no chat logs)  | DONE — JSON event block in issue; summary only, no transcript |
| UTC + original timezone            | DONE — `slot_utc` normalized; `timezone` stored               |
| Idempotency keys                   | DONE — client key + email+slot dedup returns existing booking |
| Duplicate → return existing        | DONE — `{ok, id, duplicate:true}`                             |
| Double-booking check at book time  | DONE — live open-issue scan; `409 slot_taken`                 |
| Clear success/failure back to Sam  | DONE — structured errors (`bad_slot`/`slot_taken`/`intake_failed`) |
| Hard cutover after handoff         | POLICY (SAM-PERSONA.md) — Sam stops at issue creation         |
| Log every payload + API call       | DONE for booking (`book_*` JSON lines in Vercel logs)         |
| Admin view                         | GitHub issues list = admin view (labels are the filters)      |
| Calendar write (Google/Cal.com)    | GAP — no external calendar; availability.json + issues only   |
| Confirmation email to visitor      | GAP — no email sender wired (candidates: Resend, CF Email)    |
| Slot lock w/ short TTL             | PARTIAL — client-side hold planned; server 409 is backstop    |
| Rate-limit calendar/API access     | GAP — Vercel default limits only                              |
| Returning-visitor recognition      | PLANNED — client localStorage session; no email-lookup API on |
|                                    | purpose (would leak booking existence to anyone with an email) |
| Lead/Appointment as DB tables      | DEFERRED — issues suffice at current volume; see migration     |
| Operator post-handoff duties       | Core Operator side (research, briefing, metrics, Daily Loop)  |

## Failure handling (implemented behavior)

- Intake (GitHub) write fails → `502 intake_failed` → Sam says someone will
  follow up within a few hours (front-end wires the line; it exists in LINES).
- Dedup check fails → book anyway + `book_dedup_check_failed` log; a rare
  double beats refusing a customer; operator dedupes on review.
- Email confirmation — once a sender exists: send-after-book with retry;
  appointment survives email failure.

## Migration path (when volume justifies it)

Current stack is deliberate: static site + Vercel functions + GitHub issues —
zero new infra, fully inspectable. When bookings outgrow it:

1. **DB**: Supabase Postgres — `leads` (email unique, status, interest_level,
   first/last_seen) + `appointments` (lead_id, start_utc, timezone, duration,
   type, status, calendar_event_id, created_by) — the spec's models verbatim.
2. **Calendar**: Cal.com API as the availability + booking source of truth
   (replaces availability.json + issue-scan dedup; Cal.com gives real slot
   locking and reschedule links).
3. **Email**: Resend for confirmations + reminders.
4. **Events**: keep emitting the same `appointment_booked` JSON — issues get
   replaced by a webhook/queue, the event shape does not change.
5. **Operator**: consumes the webhook instead of polling issues; Daily Loop
   unchanged.

The event shape above is the stable contract — both transports carry it, so
the Core Operator never needs a rewrite.
