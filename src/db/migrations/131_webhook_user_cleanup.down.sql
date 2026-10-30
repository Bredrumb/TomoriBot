-- Migration 131 down: Drop the pending webhook users cleanup queue.
--
-- Rows the login step already merged and deleted are not recoverable here; their stat counters remain on
-- the bot account's row.

DROP TABLE IF EXISTS webhook_user_cleanup;
