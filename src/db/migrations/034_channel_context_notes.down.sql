-- Rollback 034: Drop the per-channel context note table.

-- 1. Drop the table (its updated_at trigger drops automatically with the table).
DROP TABLE IF EXISTS channel_context_notes;
