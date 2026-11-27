# Session 05 — Staging integration preparation

Status: configuration and non-mutating smoke checks prepared. Nothing deployed. No D1 migration applied. No cron trigger configured.

## 1. Isolated staging resources
Use a separate D1 database for staging. Do not point this example config at the existing production database. Keep the staging Worker name distinct from the API Worker. Bind D1 as DB and Workers AI as AI. Set RUNNER_TOKEN as a Worker secret; never put it in this file, GitHub source, browser JavaScript or chat. The example has no schedule so it cannot consume queue jobs automatically.

## 2. Migrations
The required order is 001_production_jobs.sql, 002_durable_queue.sql, then 003_queue_failure_count.sql. Migration 003 corrects retry accounting: successful stage deliveries do not consume the failure budget; only failed deliveries increment failure_count. Retry resets the failure counter. These SQL files have not been applied.

Before applying anything, verify the target D1 database name and ID, confirm it is a disposable staging database, inspect its existing tables and take an appropriate backup/export. Apply only after explicit owner approval.

## 3. Worker configuration
Copy wrangler.runner.staging.example.toml to a private local wrangler.runner.staging.toml, replace the D1 placeholders and keep the private file out of Git. Set RUNNER_TOKEN with Wrangler secret input, not as a plain variable. Confirm the Workers AI model is available in this account. The default model in runner.js is only a default identifier, not proof of availability.

Do not add a cron trigger yet. First test health and the unauthenticated rejection path. A successful /health response says configured_not_verified, not ready.

## 4. Non-mutating smoke test
Set STAGING_RUNNER_URL to the staging Worker URL and run:
`node scripts/runner-staging-smoke.mjs`

The script performs GET /health and an unauthenticated POST /internal/tick. It expects the health response to remain explicitly unverified and the tick request to return 401. It does not send RUNNER_TOKEN and cannot claim or execute a job.

## 5. Controlled authenticated test — later approval gate
Only after owner approval, D1 migrations and Worker deployment in isolated staging, create one disposable test job through a staging-only authenticated route. Then invoke one authenticated tick and verify:
- queue row transitions pending → leased → pending/completed;
- one output and one succeeded agent-run record are stored for the current attempt;
- job stage advances exactly once;
- a successful stage increments delivery_count but not failure_count;
- forced model failure increments failure_count and uses bounded retry;
- expired leases can be reclaimed, and stale lease tokens cannot commit;
- final stage stops at awaiting_owner_approval;
- no publish route or paid provider is called.

Do not enable cron until manual tick, lease expiry, retry and owner-approval checks pass. Use a short staging-only schedule and remove it after verification if not needed.

## 6. Known runtime caveats
The current runner checks its lease before and after the Workers AI call; it does not send periodic heartbeats while the model call is in flight. Keep the lease duration and model timeout compatible, and treat a lost lease as a discarded result. The runner is a single-model, prompt-driven nine-stage workflow, not nine separately hosted agents. It prepares text artifacts only: image generation, TTS, FFmpeg rendering, object storage and MP4 output are not implemented.

## Owner approval gates
No D1 migration, Worker deployment, secret creation, cron activation, merge or publishing was performed in Session 05. Each requires separate explicit approval.
