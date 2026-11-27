# Session 04 — Durable Queue & Agent Runner

A separate Cloudflare Worker entry point is added at production-engine/runner.js. It is not deployed and migration 002 is not applied.

Implemented: D1 queue auto-enqueue triggers; retry requeue trigger; atomic conditional lease claim; five-minute lease and expiry recovery; heartbeat/fencing checks; scheduled execution and authenticated POST /internal/tick; nine sequential prompt-driven roles using the Workers AI binding; attempt-scoped durable output records; bounded 24,000-character outputs and three queue deliveries; redacted errors; no paid fallback and no publishing.

Required bindings: DB (same D1 database) and AI (Workers AI). Optional variables: STUDIO_AI_MODEL and RUNNER_ID. Secret: RUNNER_TOKEN. The default model name must be available to the account.

Truthful limitations: the nine roles are prompt-driven stages on one configured Workers AI model, not nine separately deployed agent services. This runner prepares text artifacts only. Visual generation, TTS, FFmpeg rendering, object storage and MP4 output are not implemented. Live D1/AI/scheduler behavior is not verified until separately configured and tested in staging.

Activation requires separate approval for D1 migrations and deployment. Neither is performed in this session.