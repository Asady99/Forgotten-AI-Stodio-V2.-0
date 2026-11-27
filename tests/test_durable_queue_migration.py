import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/"production-engine"
class DurableQueueMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:");self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE topics(id INTEGER PRIMARY KEY,title_en TEXT);INSERT INTO projects VALUES(1,'Studio');INSERT INTO topics VALUES(1,'Topic');")
  self.db.executescript((ROOT/"001_production_jobs.sql").read_text());self.db.executescript((ROOT/"002_durable_queue.sql").read_text());self.db.executescript((ROOT/"003_queue_failure_count.sql").read_text())
 def tearDown(self):self.db.close()
 def test_new_job_is_automatically_queued(self):
  self.db.execute("INSERT INTO production_jobs(id,title,format) VALUES('j1','Test','short')")
  self.assertEqual(self.db.execute("SELECT job_id,status,delivery_count FROM production_queue").fetchone(),('j1','pending',0))
 def test_queue_is_unique_per_job(self):
  self.db.execute("INSERT INTO production_jobs(id,title,format) VALUES('j1','Test','short')")
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO production_queue(job_id) VALUES('j1')")
 def test_retry_requeues_and_clears_lease(self):
  self.db.execute("INSERT INTO production_jobs(id,title,format) VALUES('j1','Test','short')")
  self.db.execute("UPDATE production_queue SET status='leased',lease_owner='dead',lease_token='old',lease_expires_at=datetime('now','+1 hour') WHERE job_id='j1'")
  self.db.execute("UPDATE production_jobs SET status='failed',current_stage='failed' WHERE id='j1'")
  self.db.execute("UPDATE production_jobs SET status='queued',current_stage='queued',attempt_count=2 WHERE id='j1'")
  self.assertEqual(self.db.execute("SELECT status,delivery_count,lease_owner,lease_token,lease_expires_at FROM production_queue").fetchone(),('pending',0,None,None,None))
 def test_failure_count_starts_at_zero_and_retry_resets_it(self):
  self.db.execute("INSERT INTO production_jobs(id,title,format) VALUES('j1','Test','short')")
  self.db.execute("UPDATE production_queue SET failure_count=2,delivery_count=4 WHERE job_id='j1'")
  self.db.execute("UPDATE production_jobs SET status='failed',current_stage='failed' WHERE id='j1'")
  self.db.execute("UPDATE production_jobs SET status='queued',current_stage='queued',attempt_count=2 WHERE id='j1'")
  self.assertEqual(self.db.execute("SELECT failure_count,delivery_count FROM production_queue WHERE job_id='j1'").fetchone(),(0,0))
 def test_expired_lease_is_reclaimable(self):
  self.db.execute("INSERT INTO production_jobs(id,title,format) VALUES('j1','Test','short')")
  self.db.execute("UPDATE production_queue SET status='leased',lease_owner='dead',lease_token='old',lease_expires_at=datetime('now','-1 minute') WHERE job_id='j1'")
  self.db.execute("UPDATE production_queue SET lease_owner='new',lease_token='new-token',lease_expires_at=datetime('now','+5 minutes'),delivery_count=delivery_count+1 WHERE id=(SELECT id FROM production_queue WHERE status='leased' AND lease_expires_at<=CURRENT_TIMESTAMP) AND status='leased' AND lease_expires_at<=CURRENT_TIMESTAMP")
  self.assertEqual(self.db.execute("SELECT lease_owner,lease_token,delivery_count FROM production_queue").fetchone(),('new','new-token',1))
 def test_output_is_attempt_scoped_and_cascades(self):
  self.db.execute("INSERT INTO production_jobs(id,title,format) VALUES('j1','Test','short')")
  self.db.execute("INSERT INTO production_agent_runs(id,job_id,attempt_number,agent_name,stage,status) VALUES('r1','j1',1,'Research Agent','researching','succeeded')")
  self.db.execute("INSERT INTO production_agent_outputs(id,job_id,attempt_number,stage,agent_run_id,output_text,model_name) VALUES('o1','j1',1,'researching','r1','brief','test-model')")
  self.assertEqual(self.db.execute("SELECT output_text FROM production_agent_outputs").fetchone()[0],"brief")
  self.db.execute("DELETE FROM production_jobs WHERE id='j1'")
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM production_agent_outputs").fetchone()[0],0)
if __name__=="__main__":unittest.main()
