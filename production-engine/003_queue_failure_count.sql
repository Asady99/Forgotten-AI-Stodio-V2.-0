-- Session 05: count failed deliveries separately from normal successful stage executions.
-- Apply after 001_production_jobs.sql and 002_durable_queue.sql.
ALTER TABLE production_queue ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count>=0);
DROP TRIGGER IF EXISTS trg_production_jobs_retry_enqueue;
CREATE TRIGGER trg_production_jobs_retry_enqueue
AFTER UPDATE OF status ON production_jobs
WHEN NEW.status='queued' AND OLD.status!='queued'
BEGIN
 INSERT INTO production_queue(job_id,status,delivery_count,available_at)
 VALUES(NEW.id,'pending',0,CURRENT_TIMESTAMP)
 ON CONFLICT(job_id) DO UPDATE SET status='pending',delivery_count=0,failure_count=0,
 available_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_token=NULL,
 lease_expires_at=NULL,heartbeat_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP;
END;
