-- Migration 085: Account-wide server model fallback preference.
--
-- Adds the setting behind `/personal config` > Models > Fallbacks. A personal text route that
-- fails can fall back to the server's own text model, which spends that server's credentials and
-- text quota, so the account that pays for the personal route decides whether it may.
-- Existing and unset accounts keep the fallback they already had, so the column defaults to true.

SELECT add_column_if_not_exists('user_personalization_configs', 'personal_server_fallback_enabled', 'BOOLEAN', 'true', 'NOT NULL');
