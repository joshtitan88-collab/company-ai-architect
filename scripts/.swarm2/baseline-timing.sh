#!/usr/bin/env bash
# Baseline timing of prod /api/sam-chat
URL="https://www.companyaiarchitect.com/api/sam-chat"
run() {
  local label="$1" body="$2"
  local t resp
  resp=$(curl -s -m 30 -w '\n%{time_total}' -X POST "$URL" -H 'Content-Type: application/json' -d "$body")
  t=$(printf '%s' "$resp" | tail -n1)
  printf '== %s == %ss\n' "$label" "$t"
  printf '%s' "$resp" | head -n -1
  printf '\n\n'
}
run price '{"message":"How much does the AI Opportunity Audit cost?"}'
run book '{"message":"I want to book tomorrow afternoon"}'
run message '{"message":"tell the team my invoice is doubled, I am Dana, dana@x.io"}'
