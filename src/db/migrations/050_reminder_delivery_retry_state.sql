-- Keep delivery retries independent from the canonical occurrence time so recurring cadence does not drift.
SELECT add_column_if_not_exists('reminders', 'next_attempt_at', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('reminders', 'delivery_retry_count', 'INTEGER', '0', 'NOT NULL');

CREATE INDEX IF NOT EXISTS idx_reminders_effective_due_time
  ON reminders((COALESCE(next_attempt_at, reminder_time)));
