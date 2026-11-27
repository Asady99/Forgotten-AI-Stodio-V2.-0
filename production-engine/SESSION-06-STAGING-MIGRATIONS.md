# Session 06 — Staging database migrations applied

Date: 2026-11-27

## Completed
- Created isolated D1 database: `forgotten-ai-studio-staging-db`.
- Applied the three reviewed migrations in order:
  1. `001_production_jobs.sql`
  2. `002_durable_queue.sql`
  3. `003_queue_failure_count.sql`
- Verified 7 application tables, 8 indexes, and 2 queue triggers.
- Verified `production_queue.failure_count` exists with NOT NULL and default 0.
- Ran `PRAGMA foreign_key_check`; it returned no violations.
- Confirmed D1 metadata reports 7 application tables.
- No production database was changed and no production records were copied.

## Staging configuration
- Added `wrangler.runner.staging.toml` with the verified staging D1 binding and Workers AI binding.
- The config contains no credentials and no cron trigger.
- `RUNNER_TOKEN` is intentionally absent and must only be added using the Worker secret mechanism.
- The model identifier remains the runner's documented default; account-level model availability is not yet verified.

## Not yet done
- No Worker deployed.
- No Worker secret created.
- No authenticated tick or test job executed.
- No cron schedule enabled.
- No production Worker, database, or publishing action touched.
- Billing/plan access remains unavailable through the current Cloudflare connection; no claim is made that future actions cannot incur charges.

## Next controlled steps
1. Review the staging config and confirm the Worker name and D1 binding.
2. Obtain separate owner approval before deploying the staging Worker and creating its secret.
3. Run non-mutating health and unauthenticated 401 smoke checks.
4. Only after separate approval, create one disposable staging job and run a single authenticated tick.
5. Verify stage advancement, output persistence, retry accounting, lease recovery, and the final owner-approval gate.
6. Do not enable cron until manual tests pass.

## Safety
The runner is a single Workers AI model executing nine prompt-driven stages, not nine separately hosted agents. It currently produces text artifacts and planning documents only. Image generation, TTS, FFmpeg rendering, storage integration, and actual MP4 output are not implemented or verified. Publishing remains disabled.

## Deployment and follow-up audit — 2026-11-27

- The staging Worker forgotten-ai-studio-runner-staging was subsequently deployed after explicit owner approval.
- Read-only settings inspection confirms D1 DB points to the isolated staging database, Workers AI AI is bound, and the RUNNER_TOKEN secret binding exists. The secret value is write-only and was not exposed.
- The workers.dev subdomain is enabled; preview URLs are disabled.
- Cron schedules remain empty. No test job has been created and no authenticated tick has been executed.
- Direct HTTP health/security smoke requests from the available environment returned a blocked/forbidden response, so runtime health and the unauthenticated 401 behavior remain unverified.
- Read-only staging D1 checks confirm zero jobs, queue rows, agent runs, and agent outputs. EXPLAIN succeeded for the revised queue/job/attempt failure-update SQL; no data was changed by those checks.
- A further code review found that the failure/retry path also needed stale-lease rollback guards. The PR branch now includes a sentinel guard after the queue, job, and attempt failure updates. This code change has not been redeployed to the staging Worker and has not yet received a confirmed CI run.
- Production resources remain untouched; no cron, publishing, or recurring execution has been enabled.

## Remaining verification

1. Confirm the PR checks for the latest runner failure-path guard commit.
2. Re-deploy the updated runner to staging only after explicit owner approval.
3. Re-test public health and unauthenticated tick behavior from an allowed HTTP client.
4. Only after a separate approval, create one disposable staging job and execute one authenticated tick; then inspect each persisted stage and retry behavior.
5. Keep cron disabled until all manual staging checks pass.
