-- Better Time Awareness is opt-out: existing and new servers start enabled.
SELECT add_column_if_not_exists(
  'server_capabilities_configs',
  'time_awareness_enabled',
  'BOOLEAN',
  'TRUE',
  'NOT NULL'
);
