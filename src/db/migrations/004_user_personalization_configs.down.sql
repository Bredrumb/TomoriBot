-- 004_user_personalization_configs.down.sql
--
-- Stage A rollback: drops user_personalization_configs.
-- Safe at Stage A because users still holds all source data.

DROP TABLE IF EXISTS user_personalization_configs;
