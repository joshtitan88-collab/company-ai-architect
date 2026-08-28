#!/bin/bash
# Verify every script + media dependency of receptionist.html serves locally.
cd "$(dirname "$0")/.."
MAIN=${SAM_MAIN_CHECKOUT:-../company-ai-architect-site}
FILES="sam-voice.js desk-nlu.js desk-messages.js desk-qualify.js sam-states.js desk.js styles.css assets/sam-imagine-speak.mp4 assets/sam-imagine-still.jpg assets/desk-idle.mp4 assets/sam-listen.mp4 assets/sam-process.mp4 assets/desk.jpg assets/desk-listen.jpg assets/desk-process.jpg assets/sam-hello-v2.mp3 assets/sam-hello.mp3"
for f in $FILES; do
  # pull missing media over from the main checkout so the worktree page is complete
  if [ ! -f "$f" ] && [ -f "$MAIN/$f" ]; then cp "$MAIN/$f" "$f"; echo "copied  $f"; fi
  printf "%-36s %s\n" "$f" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8788/$f")"
done
