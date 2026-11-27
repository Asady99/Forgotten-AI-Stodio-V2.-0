-- Standalone staging compatibility for optional legacy references.
-- The full studio database normally owns these parent tables. A minimal isolated
-- staging D1 may contain only the production engine; create the referenced
-- integer primary keys only when the host application tables do not exist.
-- Existing projects/topics tables and their data are left untouched.
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY
);
