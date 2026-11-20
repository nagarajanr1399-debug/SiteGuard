# Task: Fix multilingual voice alerts in SiteGuard — Web Speech API only works for English on most devices

## Branch context

Work on `nagaraj-main` on `github.com/BASILAHAMED/SiteGuard` (seeded from this
repo's `72d3da2` dark-mode mission-control UI). Four commits exist on top of
that seed which **must be preserved/merged, not discarded**:

- `ba4457d` — adds Sinhala (`si`) as a 10th supported language across
  `shared/types.ts`, `components/VoiceIncidentRecorder.tsx`,
  `server/geminiService.ts`, `server/store.ts`, `shared/wearableAlertSpecs.ts`,
  plus two corrected test assertions (9→10 languages) in `tests/e2e/`.
- `f7217ea` — Vercel serverless adaptation: extracted all Express routes from
  `server.ts` into `src/server/app.ts`'s `createApp()` factory, added
  `api/index.ts` (Vercel entrypoint) and `vercel.json`.
- `fa20d29` — bumped `esbuild` to `^0.28.0` in `package.json` /
  `package-lock.json` (vite 8's peer-dependency requirement broke a clean
  `npm install` on Vercel).
- `155868f` — gitignore `.vercel/`.

Full 10-language set now live: `en, ar, hi, ur, bn, tl, ta, ml, ne, si`.
Deployed at `https://siteguard-nagaraj.vercel.app`.

## Bug

`src/hooks/useWorkerVoiceAlerts.ts` speaks alerts via the browser's native
`SpeechSynthesisUtterance`, tagging `utterance.lang` correctly (e.g. `ta-IN`
for Tamil) and trying to match an installed OS voice via
`pickBestSpeechVoice()`.

Confirmed via a real (non-headless) Chrome instance on Windows that most
consumer machines only have English SAPI voices installed (`Microsoft
David/Hazel/Susan/Heera/Ravi/George/Mark/Zira`, all `en-*`). When no matching
voice exists, the browser silently falls back to a default English voice
reading the correctly-translated text with English pronunciation — so
selecting Tamil (or Hindi, Arabic, etc. on most devices) visibly shows the
right script but does not actually speak that language.

**This affects every non-English language, not just Tamil.**

## Fix required

Replace (or add as a preferred path ahead of) client-side Web Speech API with
**server-side cloud TTS** so pronunciation is correct regardless of the end
device's installed voices.

This project already calls Gemini server-side in `src/server/geminiService.ts`
— check whether Gemini's audio-output/TTS models (e.g.
`gemini-2.5-flash-preview-tts` or equivalent) can generate speech per
language, or integrate another TTS provider (Google Cloud TTS, Azure Speech,
ElevenLabs) if Gemini TTS isn't suitable.

Add a new endpoint (e.g. `POST /api/worker/:id/speak`) that takes
`{ text, language }`, returns synthesized audio (base64 or a stream), and have
`useWorkerVoiceAlerts.ts` play that via an `<audio>` element instead of (or
before falling back to) `SpeechSynthesisUtterance`.

## Acceptance criteria

- For all 10 languages, triggering an alert produces audio that is actually
  recognizable as that language, verifiable without depending on the test
  machine's installed OS voices.
- Existing fallback to Web Speech API is only used in local/offline dev if no
  TTS API key is configured, not as the default production path.
- Update/extend the existing unit + e2e suites (currently 20 unit / 28 e2e
  passing on `nagaraj-main`) to cover the new speech endpoint.
- Document the new required env var (e.g. `GEMINI_API_KEY` scope, or a new TTS
  provider key) in `.env.example`.
- Preserve all four commits listed above — do not re-fork from an earlier
  state of the branch.
