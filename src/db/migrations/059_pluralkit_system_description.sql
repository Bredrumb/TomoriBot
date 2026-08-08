-- Migration 059: Store PluralKit system descriptions for context rendering.
--
-- Unlike member bios, which are snapshotted once into personal memories and never
-- re-synced, a system description is rendered live from this column. It is refreshed
-- from the message-lookup payload we already fetch, so a system that edits or removes
-- its description sees that reflected, and a private description stays NULL.

SELECT add_column_if_not_exists('pluralkit_systems', 'system_description', 'TEXT');
