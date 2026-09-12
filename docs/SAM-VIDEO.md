# Sam's realistic video renderer

The video adapter preserves the existing Sam portrait, company conversation logic, and voice. LemonSlice takes the existing voice audio and generates a matching video stream. Only the returned synchronized audio is audible; playing the original TTS locally at the same time would produce overlapping voices.

## Configuration

Add these values as server-only environment variables in the intended Vercel environment:

```dotenv
# Obtain from each provider's own account; never commit real values.
DAILY_API_KEY=replace-in-vercel
LEMONSLICE_API_KEY=replace-in-vercel
# Enable in a preview deployment first; verify it before enabling production.
SAM_VIDEO_ENABLED=true
```

An active LemonSlice subscription is required. Secrets stay on the server. The boolean capability endpoint does not validate billing or prove the upstream providers work. Without the enable flag and both credentials, the site retains its original Sam clips and existing voice path.

`assets/sam-imagine-still.jpg` must be included in the deployed `api/lemonslice-session.js` function. The adapter reads and sends this original image inline, so provider image loading does not depend on the public site's deployment protection. The portrait is not replaced or regenerated.

## Browser contract

- `GET /api/lemonslice-session` returns `{ok, enabled, provider}` without secrets.
- `POST /api/lemonslice-session` with `{action:"start"}` returns `{ok, provider, roomUrl, meetingToken, websocketUrl, cleanupToken, expiresAt}`. The request must have the site's Origin header. `expiresAt` is Unix milliseconds.
- Join the Daily room using the visitor token. It cannot publish microphone or camera tracks. Attach only the remote Sam audio/video once. Keep existing clips muted whenever the stream is audible.
- Connect to `websocketUrl` and send base64 mono PCM16 chunks: `{command:"audio", audio, sampleRate:16000, encoding:"PCM16"}`. Finish each response with `{command:"audio_end"}`.
- Treat `{command:"playback_finished"}` as completion. A TTS download ending is not proof that avatar playback has finished.
- An interrupted turn cancels TTS work, discards queued chunks, and sends `{command:"interrupt"}`. Disconnect before local-voice recovery; never allow both providers to speak.
- On leaving, send `{command:"terminate"}`, disconnect Daily and the websocket, then POST `{action:"end",cleanupToken}` to the session endpoint. The signed handle authorizes only its own session and room. Do not put it in logs or URLs.

The backend creates a random private Daily room with separate publisher and receive-only visitor tokens. Room and participant access expire after ten minutes. LemonSlice idle timeout is sixty seconds. Cleanup also terminates the LemonSlice session server-side and deletes the Daily room. Creation failures trigger cleanup. Cleanup failures return an error so the client can retry; provider timeout limits remain a fallback, not a substitute for cleanup.

The per-IP and aggregate start limits are process-local safeguards, not a distributed billing quota. Before a high-traffic launch, configure provider spending controls and a durable or platform-level rate limit. Same-origin validation blocks casual cross-site allocation but is not user authentication.

## Acceptance

Run `node scripts/test-sam-voice.mjs`, `node scripts/test-sam-video.mjs`, and `node scripts/test-lemonslice-session.mjs` for offline provider-contract, permission, cleanup, expiry, failure, and rate-limit checks. These tests do not demonstrate live provider access or visual quality.

A live acceptance session must verify original appearance, one audible voice, first-frame readiness, speech synchronization, interruption, provider disconnect recovery, microphone operation, phone/mobile browsers, and teardown. Provider gesture prompts are probabilistic; precise walking choreography is not guaranteed. Appointment and telephone functionality remains owned by the separate receptionist services, not by the avatar renderer.

## Official references

- [LemonSlice WebSocket protocol](https://lemonslice.com/docs/websocket)
- [LemonSlice session creation](https://lemonslice.com/docs/api-reference/create-session)
- [LemonSlice session termination](https://lemonslice.com/docs/api-reference/control-session)
- [Daily private room creation](https://docs.daily.co/reference/rest-api/rooms/create-room)
- [Daily scoped meeting tokens](https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token)
