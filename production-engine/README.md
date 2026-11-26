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
- Future API must validate a server-side STUDIO_API_TOKEN or a properly configured Cloudflare Access identity.
- Apply request limits, input validation, ownership checks and rate limits before enabling writes.
- Restrict CORS to the verified studio origin before production.
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
