# book-hardening — DONE

- [x] TASK A: per-IP rate limiter in api/book.js (5 POST/min, x-forwarded-for first hop, fallback 'local', 429 {error:"rate_limited"}, module-level Map with pruning, per-instance best-effort noted in comment)
- [x] TASK B: api/notify.js — sendBookingConfirmation via Resend; skips with {ok:false,skipped:true} when RESEND_API_KEY unset (no network); one retry; never throws
- [x] TASK C: fire-and-forget notify after book_created (not awaited before response; .catch belt-and-braces; JSON log line evt:"book_confirm_email")
- [x] TEST: scripts/.swarm/book-hardening.test.mjs — ALL PASSED
  1. 6 rapid same-IP posts -> codes 200x5 then 429 (+ body {error:"rate_limited"})
  2. different IP -> 200
  3. fake RESEND_API_KEY -> single Resend POST, body contains slot UTC, Bearer auth
  4. key unset -> {ok:false,skipped:true}, zero fetch calls
  5. bonus: fetch throws -> exactly 2 attempts, resolves {ok:false}, no throw

No commits, no deploy, index.html untouched, no secrets written (test key is a literal fake).
