-- Rollback for 012_enforce_one_main_persona_per_server.sql
-- Drops the partial unique index that enforces one non-alter persona per server.
-- After rolling back, duplicate main personas are again possible; re-apply the
-- pre-flight check before re-running the forward migration.

DROP INDEX IF EXISTS personas_one_main_per_server;
