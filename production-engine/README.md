# Forgotten AI Studio — AI Production Engine

Status: development scaffold only. This code and migration are NOT deployed or applied to Cloudflare.

## Approved direction
- Compute: hybrid; free-first now, optional owner-operated GPU compute later.
- First outputs: documentary videos and YouTube Shorts.
- Use the existing 14 studio agents as orchestrators; an agent status flag is not proof of execution.
- Prefer open-source models and self-owned workflows. ElevenLabs and RunwayML are optional adapters, never required dependencies.
- No paid service, billing activation, card, production deployment, database migration, or publishing without separate owner approval.
- Human approval is mandatory before final video release or publishing.

## Pipeline
1. Topic & Trend Agent selects a topic.
2. Research Agent gathers source material and records source URLs.
3. Fact Checking Agent checks claims against independent sources; uncertainty remains flagged.
4. Storytelling + Scriptwriting Agents produce a scene-based script.
5. Director & Storyboard Agent creates a shot list and emotion map.
6. Visual Creation Agent uses an available open model or licensed/public-domain asset fallback.
7. Voiceover Agent uses a pluggable local/open TTS adapter when compute is available.
8. Video Production Agent uses FFmpeg to assemble images/clips, narration, subtitles and sound.
9. Quality Control checks the render and metadata.
10. Owner reviews and approves. Publishing is a separate, explicitly approved action.

## Compute adapters
- Cloudflare Workers AI: optional text/model calls within account limits.
- Hugging Face inference: optional model endpoint; check each model's availability and quota.
- Open model server: future self-hosted ComfyUI, TTS and video-model endpoint.
- FFmpeg renderer: must run on supported compute, not the Chromebook.
- R2 storage: optional future object storage. R2 is not currently enabled.

No adapter may silently fall back to a paid provider. A missing free/open adapter must return a clear unavailable status.

## Storage
D1 stores job state, agent runs, approvals and asset metadata. Binary images/audio/video belong in object storage (R2 when separately enabled and approved), not D1.

## Security
- Never put admin keys or provider tokens in browser code or localStorage.
- Owner and orchestrator API routes use separate server-side credentials in the development scaffold; production browser access still requires a verified Cloudflare Access identity/JWT or same-origin authenticated proxy.
- Apply request limits, input validation, ownership checks and rate limits before enabling writes.
- Configure the Worker variable `STUDIO_ORIGIN` to the exact HTTPS origin of the studio UI. The scaffold rejects browser origins that do not match and handles preflight only for that origin; it does not use wildcard CORS.
- Protect the API hostname with a Cloudflare Access application and verify the Access policy before enabling the UI. The dashboard sends browser session credentials (`credentials: include`) and never stores or sends owner/orchestrator bearer secrets. CORS is not authentication.
- Never expose raw secrets, stack traces or internal storage keys to the browser.

## Current blockers
- Current Space UI does not provide voice synthesis, visual generation or MP4 rendering.
- Existing research records were sourced from Wikipedia only; multi-source evidence is still needed.
- The D1 migration here has NOT been run.
- No R2 bucket has been created or enabled.
- No GPU inference server has been provisioned.
- No workflow queue or end-to-end media render has been verified.

## First acceptance test
A 60–90 second Short and a 3–5 minute image-led documentary must each complete research → sourced script → storyboard → visuals → narration → FFmpeg render → QC → owner approval. MP4 output must be downloadable and reproducible, without a paid-provider dependency.

## Development API contract
- `GET /health`: deliberately reports `status: scaffold` until all runtime dependencies and authentication are verified.
- `POST /jobs`: creates a queued Documentary or Short job and a pending final-video approval record; owner credential required.
- `GET /jobs` and `GET /jobs/:id`: return production status, asset metadata and approval state; owner credential required; internal agent logs are not exposed in the dashboard response.
- `POST /jobs/:id/stage`: requires a separate orchestrator credential; only the next sequential stage is accepted. A failed stage records the failed stage and closes the current attempt. It cannot approve or reject a video.
- `POST /jobs/:id/retry`: requires the orchestrator credential; only failed jobs can be retried, up to the job's persisted `max_attempts` limit (default 3, schema constrained to 1–10). Retry creation and the job reset use a conditional D1 batch so concurrent retry requests cannot create duplicate attempts.
- `POST /jobs/:id/agent-runs`: orchestrator-only; starts an agent execution record bound to the job's current attempt and stage. Agent names, optional numeric agent IDs and typed opaque input references are validated; raw prompt/output payloads and URLs are not accepted.
- `POST /jobs/:id/agent-runs/:run_id`: orchestrator-only; closes a running record as `succeeded`, `failed` or `skipped`, stores a typed opaque output reference, redacts common credential patterns from failure diagnostics, and records finish time and duration.
- `GET /jobs/:id/agent-runs` and `GET /jobs/:id`: owner-only monitoring returns a bounded recent run history with attempt number, agent, stage, status, safe references, redacted error summary and timing. Raw `input_json`/`output_json` fields are deliberately not returned. The production dashboard includes a job-ID lookup panel that renders the records as plain text.
- Retry uses persisted exponential backoff: 30 seconds after attempt 1, 60 seconds after attempt 2, and 120 seconds after attempt 3 (capped at 300 seconds for future higher limits). Early retries return HTTP 429 with the UTC `retry_after` timestamp.
- `GET /jobs/:id`: includes the bounded attempt history (attempt number, status, last stage, failure message and timestamps) for owner monitoring.
- `POST /jobs/:id/approval`: requires a separate owner credential and is accepted only while the job is awaiting owner approval. Publishing remains a separate action and is not implemented.

The additive migration adds `attempt_count`, `max_attempts`, and `last_failed_stage` to production jobs plus a `production_job_attempts` history table. It also adds attempt-scoped `production_agent_runs` records with typed input/output references, start/finish timestamps, duration and an indexed job/attempt/stage lookup. Each job starts with attempt 1. A failed attempt is terminal until the orchestrator explicitly retries it; retry starts the next numbered attempt at the queued stage. The retry endpoint is a state-management operation only: it does not itself execute an agent, enqueue compute, or guarantee that work resumes. A durable queue/runner and lease-based crash recovery remain separate future work.

The API separates `STUDIO_OWNER_TOKEN` from `STUDIO_ORCHESTRATOR_TOKEN`: stage updates require the orchestrator token; owner routes accept either the server-side owner token or a verified Cloudflare Access identity whose email exactly matches the server-side `STUDIO_OWNER_EMAIL` variable. Configure `STUDIO_OWNER_EMAIL` as a Worker variable and keep both tokens as Worker secrets; never put tokens in dashboard JavaScript or localStorage. Cloudflare documents `ctx.access.getIdentity()` for requests that directly invoke a Worker protected by Access; the Worker now uses that verified identity and does not trust a user-supplied email header. Protect this Worker itself with a Cloudflare Access application and an allow policy restricted to the owner. Configure `STUDIO_ORIGIN` to the exact studio UI origin, verify Access enforcement and browser cookie behavior, bind the existing D1 database, and test the identity path. If Access is not enabled or `STUDIO_OWNER_EMAIL` is missing/mismatched, browser owner routes remain unauthorized (the server-side owner-token path is retained for trusted server clients). The Worker rejects mismatched browser origins; CORS is not authentication. The stage and agent-run endpoints are state/logging interfaces, not an autonomous agent runner. A stage cannot advance while any run for that attempt/stage remains running; a failed stage closes outstanding runs as failed. The orchestrator must explicitly create and finish each run record. These records do not prove that the named AI agent actually performed work. Sequential stage transitions and owner approvals use conditional updates; D1 batch and race behavior still require live integration tests. No research, visual generation, TTS, FFmpeg rendering, or upload adapter is claimed operational until separately implemented and tested.
