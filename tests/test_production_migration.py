import sqlite3
import unittest
from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[1] / "production-engine" / "001_production_jobs.sql"

class ProductionMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript("""
            CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE topics (id INTEGER PRIMARY KEY, title_en TEXT NOT NULL);
            INSERT INTO projects (id,name) VALUES (1,'Forgotten AI Studio');
            INSERT INTO topics (id,title_en) VALUES (96,'Test topic');
        """)
        self.sql = MIGRATION.read_text(encoding="utf-8")
        self.db.executescript(self.sql)

    def tearDown(self):
        self.db.close()

    def test_creates_all_four_production_tables_and_indexes(self):
        tables = {r[0] for r in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"production_jobs", "production_job_attempts", "production_agent_runs",
                         "production_assets", "production_approvals"}.issubset(tables))
        indexes = {r[0] for r in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='index'")}
        self.assertTrue({"idx_production_jobs_status_created",
                         "idx_production_agent_runs_job",
                         "idx_production_assets_job",
                         "idx_production_approvals_job",
                         "idx_production_job_attempts_job"}.issubset(indexes))

    def test_job_constraints_and_default_owner_approval(self):
        self.db.execute(
            "INSERT INTO production_jobs (id,title,format) VALUES ('j1','Test','documentary')")
        row = self.db.execute(
            "SELECT status,current_stage,owner_approval_required,language FROM production_jobs WHERE id='j1'"
        ).fetchone()
        self.assertEqual(row, ("queued", "queued", 1, "en"))
        retry_defaults = self.db.execute(
            "SELECT attempt_count,max_attempts,last_failed_stage,next_retry_at FROM production_jobs WHERE id='j1'"
        ).fetchone()
        self.assertEqual(retry_defaults, (1, 3, None, None))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO production_jobs (id,title,format) VALUES ('j2','Bad','movie')")

    def test_job_project_and_topic_foreign_keys(self):
        self.db.execute(
            "INSERT INTO production_jobs (id,project_id,topic_id,title,format) "
            "VALUES ('linked',1,96,'Linked job','documentary')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO production_jobs (id,project_id,title,format) "
                "VALUES ('bad-project',999,'Bad project','short')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO production_jobs (id,topic_id,title,format) "
                "VALUES ('bad-topic',999,'Bad topic','short')")
        self.db.execute("DELETE FROM projects WHERE id=1")
        self.assertIsNone(self.db.execute(
            "SELECT project_id FROM production_jobs WHERE id='linked'").fetchone()[0])
        self.db.execute("DELETE FROM topics WHERE id=96")
        self.assertIsNone(self.db.execute(
            "SELECT topic_id FROM production_jobs WHERE id='linked'").fetchone()[0])

    def test_foreign_keys_and_cascade_delete(self):
        self.db.execute(
            "INSERT INTO production_jobs (id,title,format) VALUES ('j1','Test','short')")
        self.db.execute(
            "INSERT INTO production_approvals (id,job_id,approval_type,decision) "
            "VALUES ('a1','j1','final_video','pending')")
        self.db.execute(
            "INSERT INTO production_job_attempts (id,job_id,attempt_number,status,stage) "
            "VALUES ('attempt-1','j1',1,'running','queued')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO production_approvals (id,job_id,approval_type,decision) "
                "VALUES ('a2','missing','final_video','pending')")
        self.db.execute("DELETE FROM production_jobs WHERE id='j1'")
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM production_approvals").fetchone()[0], 0)
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM production_job_attempts").fetchone()[0], 0)

    def test_agent_run_schema_tracks_attempts_references_and_duration(self):
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(production_agent_runs)")}
        self.assertTrue({"attempt_number", "input_ref", "output_ref", "duration_ms"}.issubset(columns))
        indexes = {row[0] for row in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='index'")}
        self.assertIn("idx_production_agent_runs_attempt", indexes)
        self.db.execute("INSERT INTO production_jobs (id,title,format) VALUES ('job-run','Run test','short')")
        self.db.execute(
            "INSERT INTO production_agent_runs (id,job_id,attempt_number,agent_name,stage,status,input_ref) "
            "VALUES ('run-1','job-run',1,'Research Agent','queued','running','research:topic-1')")
        row = self.db.execute(
            "SELECT attempt_number,input_ref,status FROM production_agent_runs WHERE id='run-1'"
        ).fetchone()
        self.assertEqual(row, (1, "research:topic-1", "running"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO production_agent_runs (id,job_id,attempt_number,agent_name,stage,duration_ms) "
                "VALUES ('run-bad','job-run',1,'Bad Agent','queued',-1)")
        self.db.execute("DELETE FROM production_jobs WHERE id='job-run'")
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM production_agent_runs WHERE job_id='job-run'"
        ).fetchone()[0], 0)

    def test_migration_can_be_applied_twice_without_schema_errors(self):
        self.db.executescript(self.sql)
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'production_%'"
        ).fetchone()[0], 5)

if __name__ == "__main__":
    unittest.main()
