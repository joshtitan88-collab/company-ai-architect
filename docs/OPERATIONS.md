# SAM activation and acceptance

The public website is `company-ai-architect`. A successful deployment does not establish that booking, microphone hardware, rendered 3D, or a telephone number works.

## Public access comes first

On September 12, the production domain began returning a Vercel Authentication redirect even though its deployment was READY. Before client demonstrations, run `node scripts/check-live.mjs`. This read-only check stops on login redirects and verifies the homepage, release, availability, avatar route and transcription configuration. It never creates an appointment or message.

For this public showcase, use Vercel project **Settings → Deployment Protection → Vercel Authentication → Standard Protection**, which protects previews while allowing production domains. See the [official protection scopes](https://vercel.com/docs/deployment-protection). A connector that reads deployments does not necessarily have permission to change this setting. Do not treat an authenticated preview or a share link as proof the public website works.

## Booking and messages

An earlier September 12 deployment showed `intake_not_configured`. The later production update provisions a dedicated private repository and uses it only for this exact production project. Live availability returned 200 with 240 openings after that update. Preview/local environments still require explicit configuration. Keep these isolation and private-intake checks enabled.

Production now uses the dedicated **private** `company-ai-architect-intake` repository under the project owner, with Issues enabled. Do not direct customer details into the public source repository. Use a runtime token scoped to that repository with metadata read and Issues read/write. If creating a new repository, create it with an administrative credential first, then use the narrower runtime token for configuration.

For optional calendar/email/telephone settings or an explicit configuration override, on an authorized workstation create an untracked `.env.setup.local` containing:

```dotenv
INTAKE_REPO=OWNER/PRIVATE_INTAKE_REPOSITORY
GITHUB_TOKEN=
VERCEL_TOKEN=
```

The Vercel token needs access to this team's project settings. Populate credentials locally, never in chat, git, command arguments, or screenshots. Run a read-only preflight, then apply and rebuild:

```bash
node --env-file=.env.setup.local scripts/configure-production.mjs
node --env-file=.env.setup.local scripts/configure-production.mjs --apply --redeploy
```

The script verifies team/project identity and private repository status before writing. It upserts **production only**, preserves unspecified settings, and installs the supplied runtime GitHub token. An optional `--create-intake` creates a private repository owned by the authenticated GitHub user only when it returns 404; creation needs a suitably authorized token. Remove administrative credentials afterward.

Without Google Calendar, submissions are **requests**, not confirmed appointments. For calendar confirmation supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and optionally `GOOGLE_CALENDAR_ID`. The OAuth grant must allow free/busy reads and event creation. For acknowledgement emails supply `RESEND_API_KEY` after verifying the `companyaiarchitect.com` sending domain. These values may be included in the same local setup file and are uploaded only when provided.

## Browser voice

`POST /api/stt` accepts a short base64 audio clip and proxies xAI's [batch transcription API](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text). It uses the existing server-only `XAI_API_KEY`. `HEAD /api/stt` checks key presence; only an actual transcription verifies provider access. Clips are limited to 1 MiB, recording to 20 seconds, and provider calls to 20 seconds. Server rate damping is per warm instance; it is not a global spend quota.

Browsers with native speech recognition use it first. Browser-service failures offer the server transcription path. Permission denial keeps text usable. Talk starts recording; Done finishes it. Stop, typing a new message, and page navigation cancel pending capture/transcription. All spoken replies retain the existing Eve voice.

## Telephone adapter: disabled until configured

`POST /api/phone-tools` implements Vapi's [custom function-tool contract](https://docs.vapi.ai/tools/custom-tools). This is an integration adapter, not a purchased number or running telephone assistant. No provider account, number, forwarding rule, or billing subscription is created by deploying it.

1. Set a random `SAM_PHONE_WEBHOOK_SECRET` of at least 32 characters in production.
2. In Vapi, create a [Bearer Token Custom Credential](https://docs.vapi.ai/server-url/server-authentication) with that same value, Authorization header, and Bearer prefix enabled. Keep it out of prompts and tool descriptions.
3. Configure the function tools in `integrations/phone-tools.json` with server URL `https://www.companyaiarchitect.com/api/phone-tools` and the credential ID. Add them to the assistant and enable `tool-calls` server messages. Set a tool timeout compatible with booking's bounded dependencies; test timeout/retry behavior before use.
4. Use the company facts and fixed prices from `sam-knowledge.js`. The assistant must disclose that it is AI, ask one question at a time, read back appointment/message details, and obtain caller approval before calling a write tool. It must announce only the result returned by a tool. A requested appointment is not confirmed. No invented transfers or outbound calls.
5. Select and verify the telephone voice against Eve before connecting a business number. This repository does not assume that Vapi exposes xAI Eve natively. Provider and voice choice remain an activation requirement.
6. Connect an authorized telephone number only after inbound call tests pass. No outbound calling or SMS is implemented here.

The adapter returns at most eight slots at a time, with an optional business-local date filter and explicit request/confirmation mode. Booking reuses website validation and idempotency. Messages with an idempotency key check existing private records before creating a new one, including closed messages; retries must preserve both key and payload. The website retains the key across uncertain outcomes and changes it for corrected drafts. This reduces response-loss duplicates but is not an atomic distributed lock. In general, GitHub-backed intake has no atomic reservation lock without the configured calendar; same-slot calendar inserts use stable Google event IDs. These limits require review before high-volume service.

## Acceptance gates

- Availability: public endpoint returns 200 with real conflict filtering; an upstream outage still returns 503.
- Intake: explicitly identified test visitor can submit a message and request; verify private records and clean them up deliberately. Never test with a real third-party mailbox.
- Calendar: verify a real test event, overlap rejection, requested/confirmed wording, and invitation delivery. An API 200 alone is insufficient.
- Browser: greeting, a business question, a demo, interruption, a retry, denied microphone access, and recording on actual Chrome/Safari/Firefox devices.
- Mobile: 320–430 px widths, virtual keyboard, keyboard focus, touch controls and reduced motion.
- 3D: a WebGL-enabled device must show the model, blinking, idle movement and media-timed mouth movement. Word timing remains estimated, so phoneme-perfect alignment is not established. A WebGL-disabled browser verifies only the fallback.
- Telephone: actual inbound call, spoken response, interruption, factual answer, confirmed message, booking failure and successful booking. Finish with a real-device audio check.

## Verification commands

```bash
npm ci
node scripts/test-sam-voice.mjs
node scripts/test-sam-conversation.mjs
node scripts/test-reception-reliability.mjs
node scripts/test-speech-and-phone.mjs
node scripts/test-message-corrections.mjs
node scripts/test-desk-submission.mjs
node scripts/test-sam-3d.mjs
npm run build
node scripts/test-release-layout.mjs
node scripts/check-live.mjs
```

These automated checks use mocked providers unless an explicit live test is performed. They do not certify phone service, production credentials, audible voice quality, or microphone hardware.
