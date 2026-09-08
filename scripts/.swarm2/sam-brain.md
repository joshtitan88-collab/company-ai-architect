# sam-brain worker notes (crash-safe log)

## Baseline (prod, 2026-08-28, old deployed code)
- price q: 3.82s ok xai:grok-3-mini, correct $1,500 wording
- booking q: 4.77s ok, need_fields, slotHint captured
- message q: 8.11s -> {"ok":false,"error":"llm_failed"} (xai aborted at 8000ms timeout; retried: 8.11s same)
- GET providers: only xai:true in prod (no openai/anthropic fallback) -> the 8s xai leg is the only shot
- Diagnosis: grok-3-mini reasoning on contact-style turns exceeds 8s without reasoning_effort:low/max_tokens caps (old deploy)

## Worktree state on arrival
- api/sam-chat.js ALREADY has: max_tokens 180, temperature 0.2, reasoning_effort low for grok-3-mini, 1-3 sentence brevity rule
- api/message-nlu.js: keywordDept override + sanitize intact (verified lines 75-113)

## Edits made (api/sam-chat.js only; message-nlu.js untouched — verified intact)
1. OpenAI-compat (xai/openai) timeout 8000 -> Number(process.env.SAM_LLM_TIMEOUT_MS || 9000): prod is xai-only, extra 1s headroom turns "llm_failed at 8.0s" into a slow-but-correct reply
2. Prompt trim: dropped redundant "You are attentive and enjoyable." sentence
3. Prompt: appended "Decide quickly; do not deliberate." to the brevity rule (nudges reasoning model)
- Already present before I arrived (kept): max_tokens 180, temperature 0.2, reasoning_effort "low" for grok-3-mini, 1-3 sentence/40-word rule, locked prices, llm_not_configured contract

## Battery (scripts/.swarm2/brain-battery.sh, BASE overridable)
- PROD (old deploy): 10/10 PASS but take-message 7.96s (at cliff); Dana contact case fails 100% (llm_failed @8.1s, 2/2 tries)
- LOCAL 8823 (edited code, ollama qwen2.5:7b): 10/10 PASS, 0.3-0.9s/turn; Dana case ok:true intent=contact name=Dana email=dana@x.io (9.1s cold, model load)
- message-nlu local: Dana msg -> department=billing (keywordDept), message/name/contact extracted correctly
- Syntax: node --check OK both files
- NOTE: port 8788 held by a pre-existing dev server (same worktree, stale module cache) — used PORT=8823 for verification. Prod re-verify needed after orchestrator redeploy.
