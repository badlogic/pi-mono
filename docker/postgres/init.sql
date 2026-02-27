-- Initialize Fugue database extensions
-- Run automatically by postgres on first container start

-- Apache AGE (graph queries)
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- pgmq (message queue)
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Reset search path
SET search_path = "$user", public;
