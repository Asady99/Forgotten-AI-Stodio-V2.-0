-- Session 04 durable queue. Additive only; not applied to Cloudflare D1.
CREATE TABLE IF NOT EXISTS production_queue (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id TEXT NOT NULL UNIQUE REFERENCES production_jobs(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','completed','dead')),
 delivery_count INTEGER NOT NULL DEFAULT 0 CHECK(delivery_count>=0),
 max_deliveries INTEGER NOT NULL DEFAULT 3 CHECK(max_deliveries BETWEEN 1 AND 10),
 available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_owner TEXT, lease_token TEXT, lease_expires_at TEXT, heartbeat_at TEXT,
 last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((status='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
 OR (status!='leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_production_queue_claim ON production_queue(status,available_at,lease_expires_at,id);
CREATE TABLE IF NOT EXISTS production_agent_outputs (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
 attempt_number INTEGER NOT NULL CHECK(attempt_number>=1),
 stage TEXT NOT NULL,
 agent_run_id TEXT NOT NULL UNIQUE REFERENCES production_agent_runs(id) ON DELETE CASCADE,
 output_text TEXT NOT NULL, model_name TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_production_agent_outputs_job ON production_agent_outputs(job_id,attempt_number,created_at);
CREATE TRIGGER IF NOT EXISTS trg_production_jobs_enqueue AFTER INSERT ON production_jobs
BEGIN
 INSERT INTO production_queue(job_id,status,available_at) VALUES(NEW.id,'pending',CURRENT_TIMESTAMP)
 ON CONFLICT(job_id) DO UPDATE SET status='pending',available_at=CURRENT_TIMESTAMP,
 lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER IF NOT EXISTS trg_production_jobs_retry_enqueue
AFTER UPDATE OF status ON production_jobs WHEN NEW.status='queued' AND OLD.status!='queued'
BEGIN
 INSERT INTO production_queue(job_id,status,delivery_count,available_at) VALUES(NEW.id,'pending',0,CURRENT_TIMESTAMP)
 ON CONFLICT(job_id) DO UPDATE SET status='pending',delivery_count=0,available_at=CURRENT_TIMESTAMP,
 lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP;
END;
