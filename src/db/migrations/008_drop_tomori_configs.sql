-- Migration 008: Drop legacy tomori_configs table
-- This table has been fully replaced by the 13 split server config tables.
-- All data has been backfilled by migration 007 and all application code
-- now routes through the split tables via ConfigRepository.

DROP TABLE IF EXISTS tomori_configs;
