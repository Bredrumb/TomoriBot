-- Migration 034 down: removes STM customization tables in reverse dependency order.
DROP TABLE IF EXISTS short_term_memories;
DROP TABLE IF EXISTS stm_categories;
DROP TABLE IF EXISTS server_stm_configs;
