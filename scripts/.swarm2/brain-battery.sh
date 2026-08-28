#!/usr/bin/env bash
# Sam correctness battery. Default target = PROD; override: BASE=http://127.0.0.1:8788 bash brain-battery.sh
BASE="${BASE:-https://www.companyaiarchitect.com}"
URL="$BASE/api/sam-chat"
PASS=0; FAIL=0

# Global forbidden substrings (case-insensitive): human names, 'the desk', wrong prices
FORBIDDEN_GLOBAL='the desk|joshua|\$2,?000|two thousand|\$3,?000|three thousand|\$5,?000|\$1,?000\b|the install\b'

check() {
  local label="$1" msg="$2" required="$3" extra_forbidden="$4"
  local resp reply t ok=1
  resp=$(curl -s -m 30 -w '\n@TIME@%{time_total}' -X POST "$URL" -H 'Content-Type: application/json' -d "{\"message\":$msg}")
  t=$(printf '%s' "$resp" | grep -o '@TIME@.*' | cut -c7-)
  reply=$(printf '%s' "$resp" | sed 's/@TIME@.*//' | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(d.get("reply","") or ("ERROR:"+str(d.get("error"))))
except Exception: print("PARSE_ERROR")')
  if printf '%s' "$reply" | grep -qiE '^ERROR:|^PARSE_ERROR'; then
    ok=0; reason="api_error"
  fi
  if [ -n "$required" ] && ! printf '%s' "$reply" | grep -qiE "$required"; then
    ok=0; reason="missing required /$required/"
  fi
  if printf '%s' "$reply" | grep -qiE "$FORBIDDEN_GLOBAL"; then
    ok=0; reason="hit global forbidden"
  fi
  if [ -n "$extra_forbidden" ] && printf '%s' "$reply" | grep -qiE "$extra_forbidden"; then
    ok=0; reason="hit forbidden /$extra_forbidden/"
  fi
  if [ "$ok" = 1 ]; then PASS=$((PASS+1)); echo "PASS  [$label] ${t}s :: $reply"
  else FAIL=$((FAIL+1)); echo "FAIL  [$label] ${t}s ($reason) :: $reply"; fi
}

check audit-price '"How much is the AI Opportunity Audit?"' '1,?500|fifteen hundred|one thousand five hundred' ''
check package-price '"What does the Architect plus 14-day package cost?"' '4,?500|four thousand five hundred|forty-?five hundred' ''
check whats-free '"Is anything free?"' 'free' ''
check who-are-you '"Who are you?"' 'sam' ''
check are-you-human '"Are you a real human?"' '' 'yes,? i am human|i am a real (human|person)|i'"'"'m human'
check book-call '"I would like to book a call"' 'book|discovery|call|calendar|name|email' ''
check take-message '"Can you take a message for the team? My printer project stalled."' 'note|message|team|pass|name|email' 'will call you back personally'
check company-does '"What does Company AI Architect actually do?"' 'ai|hardware|local|own' ''
check data-privacy '"Do you store my data?"' 'hardware|stay|private|sold|only' ''
check off-topic '"What is the weather today?"' '' 'degrees|forecast|sunny|rain|celsius|fahrenheit'

echo "----"
echo "TOTAL pass=$PASS fail=$FAIL target=$URL"
