-- Migration 131: Queue the users rows created for shared persona webhooks for removal.
--
-- A turn triggered from a persona's webhook post used to fall back to the message author, which is the
-- channel's shared managed webhook, so each webhook gained a users row named after whichever persona posted
-- first. Those rows' stat counters hold real spend, so they move to the bot account's row instead of
-- cascading away. The bot's row is only known after login, so this migration records the rows and
-- src/events/clientReady/07_mergeWebhookUsers.ts merges and deletes them once, then drops this table.

CREATE TABLE IF NOT EXISTS webhook_user_cleanup (
  user_id INT PRIMARY KEY
);

INSERT INTO webhook_user_cleanup (user_id)
SELECT u.user_id
FROM users u
JOIN discord_managed_webhooks w ON w.webhook_disc_id = u.user_disc_id
ON CONFLICT (user_id) DO NOTHING;
