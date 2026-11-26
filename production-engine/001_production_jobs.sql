-- Forgotten AI Studio Production Engine
-- Additive migration only. Not applied to Cloudflare D1 by this commit.
-- Existing tables and records are intentionally untouched.
CREATE TABLE IF NOT EXISTS production_jobs (
 id TEXT PRIMARY KEY, project_id INTEGER, topic_id INTEGER, title TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN ('documentary','short')),
 language TEXT NOT NULL DEFAULT 'en',
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','researching','scripting','fact_checking','storyboarding','creating_visuals','creating_voice','rendering','quality_review','awaiting_owner_approval','approved','rejected','failed')),
 current_stage TEXT NOT NULL DEFAULT 'queued',
 owner_approval_required INTEGER NOT NULL DEFAULT 1 CHECK(owner_approval_required=1),
 error_message TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS production_agent_runs (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
 agent_id INTEGER, agent_name TEXT NOT NULL, stage TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','skipped')),
 input_json TEXT, output_json TEXT, error_message TEXT, started_at TEXT, finished_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS production_assets (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
 asset_type TEXT NOT NULL CHECK(asset_type IN ('research','script','storyboard','image','audio','music','subtitle','video','thumbnail','other')),
 storage_provider TEXT NOT NULL DEFAULT 'pending' CHECK(storage_provider IN ('pending','r2','huggingface','external')),
 storage_key TEXT, public_url TEXT, mime_type TEXT, size_bytes INTEGER, metadata_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS production_approvals (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
 approval_type TEXT NOT NULL CHECK(approval_type IN ('script','final_video','publish')),
 decision TEXT NOT NULL CHECK(decision IN ('pending','approved','rejected','changes_requested')),
 notes TEXT, decided_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_production_jobs_status_created ON production_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS idx_production_agent_runs_job ON production_agent_runs(job_id,created_at);
CREATE INDEX IF NOT EXISTS idx_production_assets_job ON production_assets(job_id,created_at);
CREATE INDEX IF NOT EXISTS idx_production_approvals_job ON production_approvals(job_id,created_at);
