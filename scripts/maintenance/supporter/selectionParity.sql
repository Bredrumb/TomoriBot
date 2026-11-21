WITH personal_scopes AS (
  SELECT user_id FROM user_saved_provider_configs WHERE provider = 'supporter'
  UNION
  SELECT users.user_id FROM users JOIN supporter_identities ON users.user_disc_id = supporter_identities.discord_user_id
), server_scopes AS (
  SELECT server_id FROM saved_provider_configs WHERE provider = 'supporter'
  UNION
  SELECT server_id FROM supporter_server_sponsorships WHERE status = 'active'
  UNION
  SELECT server_id FROM server_model_configs WHERE cardinality(subscription_capabilities) > 0
), selections AS (
  SELECT 'personalProviders' AS section, concat_ws(':', user_id, provider) AS row_key, to_jsonb(row) AS payload
  FROM (
    SELECT user_id, provider, api_key IS NOT NULL AS has_key,
      llm_id, vision_llm_id, embedding_model_id, diffusion_model_id, nai_diffusion_model_id, video_model_id,
      speech_design_model_id, speech_clone_model_id, transcription_model_id, enabled_capabilities, assigned_capabilities
    FROM user_saved_provider_configs WHERE user_id IN (SELECT user_id FROM personal_scopes)
  ) row
  UNION ALL
  SELECT 'personalFallbacks', user_id::text, to_jsonb(row) FROM (
    SELECT user_id, fallback_model_refs, model_randomizer_enabled FROM user_personalization_configs
    WHERE user_id IN (SELECT user_id FROM personal_scopes)
  ) row
  UNION ALL
  SELECT 'serverProviders', concat_ws(':', server_id, provider), to_jsonb(row) FROM (
    SELECT server_id, provider, api_key IS NOT NULL AS has_key,
      llm_id, vision_llm_id, embedding_model_id, diffusion_model_id, nai_diffusion_model_id, video_model_id,
      fallback_model_refs
    FROM saved_provider_configs WHERE server_id IN (SELECT server_id FROM server_scopes)
  ) row
  UNION ALL
  SELECT 'serverModels', server_id::text, to_jsonb(row) FROM (
    SELECT server_id, llm_id, vision_llm_id, embedding_model_id, diffusion_model_id, video_model_id,
      decision_model_id, subscription_capabilities
    FROM server_model_configs WHERE server_id IN (SELECT server_id FROM server_scopes)
  ) row
  UNION ALL
  SELECT 'serverSpeech', server_id::text, to_jsonb(row) FROM (
    SELECT server_id, speech_design_model_id, speech_clone_model_id, transcription_model_id,
      speech_design_endpoint_id, speech_clone_endpoint_id
    FROM server_speech_configs WHERE server_id IN (SELECT server_id FROM server_scopes)
  ) row
  UNION ALL
  SELECT 'serverChat', server_id::text, to_jsonb(row) FROM (
    SELECT server_id, response_reviewer_llm_id, response_rule_checker_ref, fallback_model_refs, model_randomizer_enabled
    FROM server_chat_configs
    WHERE server_id IN (SELECT server_id FROM server_scopes)
  ) row
  UNION ALL
  SELECT 'serverNudges', server_id::text, to_jsonb(row) FROM (
    SELECT server_id, llm_id, checker_llm_id, checker_decision_model_id FROM server_natural_nudge_configs
    WHERE server_id IN (SELECT server_id FROM server_scopes)
  ) row
  UNION ALL
  SELECT 'registrations', scoped_model_registration_id::text, to_jsonb(row) FROM (
    SELECT scoped_model_registration_id, server_id, user_id, llm_id, decision_model_id, embedding_model_id,
      diffusion_model_id, video_model_id, speech_model_id, transcription_model_id
    FROM scoped_model_registrations
    WHERE user_id IN (SELECT user_id FROM personal_scopes) OR server_id IN (SELECT server_id FROM server_scopes)
  ) row
), referenced AS (
  SELECT DISTINCT kind, (value #>> '{}')::int AS id FROM selections
  CROSS JOIN LATERAL jsonb_each(payload) AS item(field, value)
  JOIN (VALUES
    ('llm_id', 'llm'), ('vision_llm_id', 'llm'), ('response_reviewer_llm_id', 'llm'), ('checker_llm_id', 'llm'),
    ('embedding_model_id', 'embedding'), ('diffusion_model_id', 'image'), ('nai_diffusion_model_id', 'image'),
    ('video_model_id', 'video'), ('decision_model_id', 'decision'), ('checker_decision_model_id', 'decision'),
    ('speech_model_id', 'speech'), ('speech_design_model_id', 'speech'), ('speech_clone_model_id', 'speech'),
    ('transcription_model_id', 'transcription')
  ) AS fields(name, kind) ON fields.name = item.field
  WHERE jsonb_typeof(value) = 'number'
  UNION
  SELECT 'llm', (ref->>'id')::int FROM selections
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'fallback_model_refs') = 'array'
    THEN payload->'fallback_model_refs' ELSE '[]'::jsonb END) AS ref
  WHERE ref->>'type' = 'llm' AND jsonb_typeof(ref->'id') = 'number'
), catalog AS (
  SELECT 'llm' AS kind, llm_id AS id, llm_provider AS provider, llm_codename AS codename,
    is_deprecated, is_scoped_registration, NULL::text AS slot_constraint FROM llms
  UNION ALL
  SELECT 'image', diffusion_model_id, provider, codename, is_deprecated, is_scoped_registration, NULL FROM image_diffusion_models
  UNION ALL
  SELECT 'video', video_model_id, provider, codename, is_deprecated, is_scoped_registration, NULL FROM video_generation_models
  UNION ALL
  SELECT 'embedding', embedding_model_id, provider, codename, is_deprecated, is_scoped_registration, model_family FROM embedding_models
  UNION ALL
  SELECT 'decision', decision_model_id, provider, codename, is_deprecated, is_scoped_registration, NULL FROM decision_models
  UNION ALL
  SELECT 'speech', speech_model_id, provider, codename, is_deprecated, is_scoped_registration, voice_mode FROM speech_models
  UNION ALL
  SELECT 'transcription', transcription_model_id, provider, codename, is_deprecated, is_scoped_registration, NULL FROM transcription_models
), manifest AS (
  SELECT * FROM selections
  UNION ALL
  SELECT 'identities', supporter_identity_id::text, to_jsonb(row) FROM (
    SELECT supporter_identity_id, users.user_id FROM supporter_identities
    LEFT JOIN users ON users.user_disc_id = supporter_identities.discord_user_id
  ) row
  UNION ALL
  SELECT 'entitlements', supporter_entitlement_id::text, to_jsonb(row) FROM (
    SELECT supporter_entitlement_id, supporter_identity_id, tier_key, is_active, patron_status,
      cancel_at_period_end, period_start, period_end, next_charge_at, source
    FROM supporter_entitlements
  ) row
  UNION ALL
  SELECT 'sponsorships', sponsorship_id::text, to_jsonb(row) FROM (
    SELECT sponsorship_id, server_id, sponsor_identity_id, status, revoked_at
    FROM supporter_server_sponsorships
  ) row
  UNION ALL
  SELECT 'memberKeys', member_key_id::text, to_jsonb(row) FROM (
    SELECT member_key_id, supporter_identity_id, api_key IS NOT NULL AS has_key, disabled,
      pending_action, applied_limit, funded_period_start, funded_period_end
    FROM supporter_member_keys
  ) row
  UNION ALL
  SELECT 'referencedModels', concat_ws(':', referenced.kind, referenced.id),
    jsonb_build_object('kind', referenced.kind, 'id', referenced.id, 'provider', catalog.provider,
      'codename', catalog.codename, 'is_deprecated', catalog.is_deprecated,
      'is_scoped_registration', catalog.is_scoped_registration, 'slot_constraint', catalog.slot_constraint)
  FROM referenced LEFT JOIN catalog USING (kind, id)
)
SELECT section, row_key, payload FROM manifest ORDER BY section, row_key;
