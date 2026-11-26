-- Recreates setup-seeded rows that a persona-preserving /nuke deleted, because config writers only UPDATE them.
INSERT INTO server_chat_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_model_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_member_permissions_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_byok_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_notice_embeds_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_channel_scope_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_welcome_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_trigger_behavior_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_auto_trigger_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_capabilities_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_novelai_imagegen_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_nsfw_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_speech_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO server_memory_configs (server_id)
SELECT s.server_id FROM servers s
WHERE EXISTS (SELECT 1 FROM personas p WHERE p.server_id = s.server_id AND p.is_alter = false)
ON CONFLICT (server_id) DO NOTHING;
