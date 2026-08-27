#!/bin/bash
# Full local integration matrix for Sam (run while dev-server is up on 8788).
B=http://127.0.0.1:8788
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "PASS $3"; else fail=$((fail+1)); echo "FAIL $3 (got $1, want $2)"; fi; }

# rate limit: 6 rapid same-IP books -> 6th is 429
codes=""
for i in 1 2 3 4 5 6; do
  c=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/api/book -H "content-type: application/json" -H "x-forwarded-for: 10.9.9.9" -d "{\"name\":\"RL\",\"email\":\"rl@x.dev\",\"company\":\"X\",\"slotIso\":\"2026-09-03T1$i:00:00Z\"}")
  codes="$codes$c "
done
last=$(echo $codes | awk '{print $6}')
ok "$last" "429" "rate limit trips on 6th rapid booking ($codes)"

# different IP unaffected
c=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/api/book -H "content-type: application/json" -H "x-forwarded-for: 10.7.7.7" -d '{"name":"Other IP","email":"oip@x.dev","company":"X","slotIso":"2026-09-04T17:00:00Z"}')
ok "$c" "200" "different IP not rate-limited"

# stt availability probe
c=$(curl -s -o /dev/null -w "%{http_code}" -I $B/api/stt)
ok "$c" "200" "stt probe reports available"

# stt transcription of the real greeting audio
t=$(curl -s -X POST $B/api/stt -H "content-type: audio/mpeg" --data-binary @assets/sam-hello-v2.mp3 | python3 -c "import json,sys; print(json.load(sys.stdin).get('text',''))")
echo "$t" | grep -qi "company ai architect" && { pass=$((pass+1)); echo "PASS stt transcribes greeting: $t"; } || { fail=$((fail+1)); echo "FAIL stt transcript: $t"; }

# sam-chat on qwen2.5:7b-instruct
r=$(curl -s --max-time 120 -X POST $B/api/sam-chat -H "content-type: application/json" -d '{"message":"how much does the audit cost?"}')
echo "$r" | grep -q '"ok":true' && echo "$r" | grep -qi "fifteen hundred\|1,500\|1500\|one thousand five hundred" && { pass=$((pass+1)); echo "PASS sam-chat price via $(echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("source","?"))')"; } || { fail=$((fail+1)); echo "FAIL sam-chat: $(echo "$r" | head -c 220)"; }

# message-nlu extraction
r=$(curl -s --max-time 120 -X POST $B/api/message-nlu -H "content-type: application/json" -d '{"text":"tell the team the invoice is doubled, im dana, dana@x.io","state":{"state":"idle"}}')
echo "$r" | grep -q '"department":"billing"' && { pass=$((pass+1)); echo "PASS message-nlu routes billing"; } || { fail=$((fail+1)); echo "FAIL message-nlu: $(echo "$r" | head -c 200)"; }

# notify skip logged (no RESEND key) — check server log
grep -q "book_confirm_email" /tmp/claude-1000/-home-joshua/*/tasks/*.output 2>/dev/null && { pass=$((pass+1)); echo "PASS notify outcome logged"; } || { fail=$((fail+1)); echo "FAIL notify log line missing"; }

echo "== $pass passed, $fail failed"
exit $fail
