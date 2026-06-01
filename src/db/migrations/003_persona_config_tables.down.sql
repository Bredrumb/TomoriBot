-- 003_persona_config_tables.down.sql
--
-- Stage A rollback: drops all 4 persona_*_configs tables.
-- Safe at Stage A because tomoris still holds all source data.

DROP TABLE IF EXISTS persona_textgen_configs;
DROP TABLE IF EXISTS persona_imagegen_configs;
DROP TABLE IF EXISTS persona_voice_configs;
DROP TABLE IF EXISTS persona_context_note_configs;
