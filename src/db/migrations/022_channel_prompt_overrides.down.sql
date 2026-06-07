-- Rollback 022: Drop the per-channel system prompt override table.

-- 1. Drop the table (its updated_at trigger drops automatically with the table).
DROP TABLE IF EXISTS channel_prompt_overrides;
