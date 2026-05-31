-- 002_server_config_tables.down.sql
--
-- Stage A rollback: drops all 13 server_*_configs tables.
-- Safe at Stage A because tomori_configs still holds all data.
-- Run in reverse creation order to respect FK dependencies.

DROP TABLE IF EXISTS server_memory_configs;
DROP TABLE IF EXISTS server_byok_configs;
DROP TABLE IF EXISTS server_speech_configs;
DROP TABLE IF EXISTS server_nsfw_configs;
DROP TABLE IF EXISTS server_novelai_imagegen_configs;
DROP TABLE IF EXISTS server_capabilities_configs;
DROP TABLE IF EXISTS server_auto_trigger_configs;
DROP TABLE IF EXISTS server_trigger_behavior_configs;
DROP TABLE IF EXISTS server_welcome_configs;
DROP TABLE IF EXISTS server_channel_scope_configs;
DROP TABLE IF EXISTS server_member_permissions_configs;
DROP TABLE IF EXISTS server_notice_embeds_configs;
DROP TABLE IF EXISTS server_chat_configs;
