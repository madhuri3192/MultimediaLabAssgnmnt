# Roadmap

Everything below Phase 0 is intentionally **not** implemented. The MVP is kept small so it can be validated with real users before anything heavier is built. Each phase should be started only when the previous one has produced evidence that the next is worth it.

## Phase 0 — Current MVP (done)

Record or upload ≤ 30 s → choose a synthetic target voice → ElevenLabs Speech-to-Speech → play → download.

- No accounts, no storage, no cloning, no realtime
- Free ElevenLabs plan, developer-configured voices via environment variables
- Full validation before credits are spent; safe error vocabulary

**Exit criterion:** people can speak naturally for 5–15 seconds and shortly afterwards hear the same words, rhythm and emotion convincingly rendered in another voice. Measure actual round-trip times from the dev timing log and note whether short clips *feel* responsive.

## Phase 1 — Product polish

Small, high-leverage improvements once the core loop is validated:

- Proper waveform rendering of the source and result (still Web Audio, no heavy dependency)
- Trim handles so users can cut a long upload down to ≤ 30 s instead of being rejected
- Surface measured provider/round-trip metrics in a dev panel; decide whether streaming output is worth it for perceived latency
- Voice previews: one **pre-generated** sample per target voice committed as a static asset (never generated on page load, never per user)
- Richer error guidance (e.g. detect a muted/silent recording before sending)
- Optional `remove_background_noise` toggle in the UI if testing shows it helps
- Basic per-IP request throttling if the demo is exposed publicly

## Phase 2 — Custom voices (requires a paid ElevenLabs plan)

Instant Voice Cloning is not available on the free plan, so this phase begins only when a paid plan is acceptable.

- Enrollment: user records ~1–2 minutes of clean speech
- **Explicit consent gate:** the user must confirm it is their own voice *or* that they have the speaker's explicit authorization; no cloning of public figures or third parties without consent, ever
- Implement `VoiceCloningProvider` (`createVoice`, `deleteVoice`) behind the existing provider boundary
- Clone lifecycle: temporary/session-scoped voices where the provider allows it, explicit "delete my voice", automatic expiry
- Extend the voice resolver so a slug can resolve to a user-owned voice instead of an environment variable
- Abuse controls proportional to the new risk (rate limits, audit logging without audio, takedown path)

## Phase 3 — Accounts and SaaS plumbing

Only once saved voices, history or billing genuinely require identity:

- Authentication (start with a hosted provider; avoid building it)
- Saved custom voices per user, conversion history (opt-in, with retention limits)
- Usage credits and quotas per user, mirrored against provider spend
- Billing/subscriptions (Stripe or Razorpay depending on market)
- A datastore appears here for the first time — choose it for these needs, not before
- Terms of use, privacy policy and content policy appropriate to a commercial service; move off the free tier

## Phase 4 — Realtime

Investigate continuous microphone → low-latency conversion → speaker output.

- Candidate architecture: WebSocket or WebRTC from the browser → realtime conversion provider → jitter buffer → continuous playback
- Key questions: achievable end-to-end latency, cost per minute, provider availability of a streaming speech-to-speech API, and whether quality holds for short chunks
- The current provider interface is batch-oriented; a streaming interface would sit alongside it rather than replace it

## Phase 5 — Desktop / virtual microphone

A potential standalone product: physical microphone → AI voice conversion → virtual microphone device usable in Discord, Zoom, Meet, games and OBS.

- Requires a native/desktop layer (virtual audio device drivers differ per OS)
- Depends entirely on Phase 4 latency results
- Out of scope for the web application

## Explicitly not planned

Speech-to-text, LLM features, translation, text editing of speech, celebrity or public-figure voices, a voice marketplace, and any feature that would require storing user audio without a clear user-facing reason.
