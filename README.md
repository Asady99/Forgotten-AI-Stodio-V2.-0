# Forgotten AI Studio V2.0

A personal AI-assisted creative workspace for historical documentaries, storytelling, scripts, and research.

## Current repair branch

The current frontend repair is being prepared on:

`work/ai-studio-repair-2026-11-26`

Changes are reviewed through draft pull request #1. They are not merged into `main`.

## Current frontend

- `index.html` — responsive single-page workspace.
- `script.js` — optional interface helpers.
- `agents.js` — reads and displays the registered agent list.
- `ai.js` — sends a content prompt to the AI Worker and displays its response.
- `.github/workflows/deploy-pages.yml` — manually triggered GitHub Pages deployment workflow.

The frontend uses plain browser JavaScript and does not require a build step.

## Connected backend services

These endpoints were found in the existing frontend and Cloudflare Worker configuration:

- AI Worker: `https://bold-mud-516e.bakhatfraz.workers.dev/`
  - GET provides a basic service status response.
  - POST accepts JSON containing a `prompt` string.
  - Uses the Cloudflare Workers AI binding named `AI`.
  - Returns a JSON response with `success` and `result` fields on success.

- Agents API: `https://forgotten-agents-api.bakhatfraz.workers.dev/`
  - Reads `id`, `name`, `role`, and `status` from the D1 `agents` table.
  - Returns `success`, `count`, and `agents`.

- Scripts API: `https://forgotten-scripts-api.bakhatfraz.workers.dev/`
  - Provides read endpoints for topics and scripts.
  - Its save endpoint requires the server-side `SAVE_KEY` secret in the `X-Admin-Key` request header.

The AI Worker and the Agents and Scripts APIs were inspected through their Cloudflare configuration. Their bindings are present: Workers AI for the AI Worker and D1 for the two database APIs. This configuration check does not by itself prove that every live request succeeds.

## Security rules

- Never put `SAVE_KEY`, API tokens, or other secrets in frontend files, HTML, Git history, or public repository settings.
- Do not expose administrative save operations directly to an untrusted browser without a protected server-side design.
- Keep publishing and other consequential actions behind explicit human approval.
- Do not claim that an integration is live until it has been tested end to end.

## Deployment status

The GitHub Pages workflow is manual-only (`workflow_dispatch`). It has not been run. A Pages project/hosting destination must be enabled before deployment can succeed.

No deployment, merge, or production Worker change is performed by this repair branch.

## Current limitations

The current frontend is a working UI shell with AI generation and agent-list integrations prepared. It is not yet the complete end-to-end production studio. Script persistence, research workflows, fact-checking orchestration, voiceover, video rendering, YouTube publishing, and analytics still require implementation and testing.

## Project status

Development and verification in progress.
