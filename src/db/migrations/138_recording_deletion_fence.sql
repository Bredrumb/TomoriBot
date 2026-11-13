ALTER TABLE conversation_recording_sessions ADD COLUMN IF NOT EXISTS last_deleted_at TIMESTAMPTZ;
