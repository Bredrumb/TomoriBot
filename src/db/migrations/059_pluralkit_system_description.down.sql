-- Migration 059 down: drop the PluralKit system description column.

ALTER TABLE pluralkit_systems DROP COLUMN IF EXISTS system_description;
