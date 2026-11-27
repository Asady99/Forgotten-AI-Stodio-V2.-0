# Session 06 — Staging database, durable Runner and verification

Date: 2026-11-27

## Staging database — completed
- Created isolated D1 database: `forgotten-ai-studio-staging-db`.
- Applied the reviewed migrations in order:
  1. `001_production_jobs.sql`
  2. `002_durable_queue.sql`
  3. `003_queue_failure_count.sql`
- Verified 7 application tables, 8 indexes, 2 queue triggers, and `production_queue.failure_count` with NOT NULL/default 0.
- `PRAGMA foreign_key_check` returned no violations.
- No production database was changed and no production records were copied.

## Staging Runner — deployed
- Worker: `forgotten-ai-studio-runner-staging`.
- Worker URL: `https://forgotten-ai-studio-runner-staging.bakhatfraz.workers.dev`.
- Main module: `production-engine/runner.js`.
- D1 binding points to the isolated staging database; Workers AI binding is present.
- `RUNNER_TOKEN` secret binding is present. Its value is write-only and has not been read or exposed.
- workers.dev is enabled; preview URLs are disabled.
- Cron schedules remain empty.
- The latest Runner source, including stale-lease guards in both success and failure paths, was uploaded to the existing staging Worker after explicit owner approval. A read-only settings check confirmed the bindings and secret binding remained intact.

## Automated verification — passed
Latest GitHub Actions run:
- Run #144 / ID `45983800287`: SUCCESS.
- Node test suite: 50 passed, 0 failed.
- SQLite migration suite: 12 passed, 0 failed.
- Includes stale/expired lease protections for output persistence and terminal failure state, queue retry behavior, owner approval gates, and migration constraints.
- The final CI run used the corrected test assertion; the earlier 49/50 result was superseded.

## Runtime verification — still pending
- Direct HTTP smoke requests from the available execution environment returned a blocked/forbidden response. Therefore public `/health` behavior and unauthenticated `/internal/tick` returning 401 have not been verified from an allowed HTTP client.
- No staging job has been created and no authenticated tick has been executed.
- Read-only D1 checks previously confirmed zero jobs, queue rows, agent runs, and agent outputs. SQL explain checks did not mutate data.
- Do not treat successful deployment or CI as proof that a live Workers AI job works.

## Controlled next steps
1. From an allowed HTTP client, verify `GET /health` and an unauthenticated `POST /internal/tick` returns 401.
2. Create/replace the staging `RUNNER_TOKEN` directly in Cloudflare Dashboard and save its value securely outside chat. Cloudflare does not reveal an existing secret value.
3. After explicit owner approval, create one disposable staging job and execute one authenticated tick.
4. Inspect persisted stage, attempt, run and output records; then test retry and lease recovery only with separate bounded staging checks.
5. Keep Cron disabled until all manual checks pass.

## Safety and scope
- The Runner uses one Workers AI model for nine prompt-driven stages; these are not nine separately hosted models/agents.
- Current outputs are text artifacts and production planning documents only.
- Image generation, TTS, FFmpeg rendering, media storage and actual MP4 output are not implemented or verified here.
- Publishing remains disabled and final approval remains an owner-controlled gate.
- No production resources, production data, scheduled triggers or publishing settings were changed.
- Cloudflare billing/plan access was unavailable in the connected API scope; no promise is made that future Cloudflare actions cannot incur charges.
