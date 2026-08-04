DROP INDEX IF EXISTS idx_reminders_effective_due_time;
ALTER TABLE reminders DROP COLUMN IF EXISTS delivery_retry_count;
ALTER TABLE reminders DROP COLUMN IF EXISTS next_attempt_at;
