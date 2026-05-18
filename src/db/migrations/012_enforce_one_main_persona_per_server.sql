-- Phase 6 Step #14.6 — Enforce "one main persona per server" at the schema level.
--
-- Adds a partial unique index so each server can have at most one non-alter persona
-- (is_alter = false). The invariant was previously enforced only by command logic at
-- 15+ call sites; this migration hardens it in the DB so a buggy migration or direct
-- SQL touch cannot silently create two main personas for the same server.
--
-- Data preflight: if duplicate main personas exist, this migration will fail with a
-- unique-violation error and must NOT be run until duplicates are resolved.
-- Check before applying: SELECT server_id, COUNT(*) FROM personas WHERE is_alter = false
--   GROUP BY server_id HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS personas_one_main_per_server
  ON personas(server_id)
  WHERE is_alter = false;
