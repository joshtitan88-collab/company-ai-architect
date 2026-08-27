# slots-filter — done

## Changes
- api/slots.js: handler now async. New exported `bookedStarts()` fetches open
  `desk-booking` issues from joshtitan88-collab/company-ai-architect (same header
  pattern as api/book.js, Bearer GITHUB_TOKEN), parses `- slot_utc:` (fallback
  `- slot_iso:`) lines, returns Set of UTC ms instants. Slots filtered by
  `!taken.has(s.start)`. Any failure (no token / non-ok HTTP / thrown fetch)
  returns empty Set + one console.log JSON line (`evt: slots_booked_filter_skipped`)
  so ALL slots are served. Response shape unchanged
  ({timezone, slotMinutes, count, slots}).

## Test
- scripts/test-slots-filter.mjs (mocked global fetch + res shim)
- Cases: 2 fake issues -> both booked slots removed, count 110->108, shape keys
  unchanged; fetch throws -> all 110 served; HTTP 403 -> all served; no token ->
  all served, fetch never called.
- Result: ALL TESTS PASSED.

## Not done
- No commit, no deploy, index.html untouched, dev server untouched.
