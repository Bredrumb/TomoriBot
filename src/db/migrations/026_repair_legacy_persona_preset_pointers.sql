-- Repair legacy official persona copies that migration 020 could not relink.
--
-- Migration 020 depended on persona_lineage_id already matching an official
-- preset_lineage_id. Older /config setup rows used generated memory lineages,
-- so they stayed independent copies and did not receive live default-preset
-- updates. This pass recognizes known official seed fingerprints from the
-- historical copy shapes and marks only exact copied rows as preset pointers.
--
-- The repair intentionally preserves persona_lineage_id so existing memories
-- and conditioning history stay in their original scope.

WITH legacy_fingerprints(attr_hash, attr_count, sample_count, trigger_count, preset_lineage_id, preset_language) AS (
  VALUES
    -- Default Tomori, en-US
    ('e5047a1b9bd736a11ca72da117097835', 5, 15, 2, 4::BIGINT, 'en-US'),
    ('5b644dd6459b0fcce5fcf27e53af0367', 6, 15, 2, 4::BIGINT, 'en-US'),
    ('47522a84a51837dd046cfcbae985c833', 6, 15, 2, 4::BIGINT, 'en-US'),
    ('8c234ba67a4e73d682e64a19a78e020e', 6, 14, 4, 4::BIGINT, 'en-US'),
    ('6c71dce1b4044bed9bff5911f875fd7d', 6, 14, 4, 4::BIGINT, 'en-US'),
    -- Default Tomori, ja
    ('167283344a29b86ba7cce10ab5db5c53', 5, 15, 4, 4::BIGINT, 'ja'),
    ('cb978af2f023020f14f7fbd130e36a95', 6, 15, 4, 4::BIGINT, 'ja'),
    ('76f4bcef447f73d1bca5133c1ac5f2cb', 6, 15, 4, 4::BIGINT, 'ja'),
    ('1f252d678ac2ff5b005b7f3ee3468095', 6, 14, 4, 4::BIGINT, 'ja'),

    -- Bratty Tomori, en-US
    ('622029b000b16a2f15cc9b363e70b364', 5, 13, 2, 716::BIGINT, 'en-US'),
    ('3fde2f53fc9bcfe481bf41e1acae6afd', 6, 13, 2, 716::BIGINT, 'en-US'),
    ('ffc44c59fae23fad0ec7d7e0f863d421', 6, 13, 2, 716::BIGINT, 'en-US'),
    ('6b9a74c38432c577ec7c96b37b8550f1', 6, 12, 4, 716::BIGINT, 'en-US'),
    ('5c146f214d79d7307c1e51ea995120b9', 6, 12, 4, 716::BIGINT, 'en-US'),
    -- Bratty Tomori, ja
    ('17bfa657b439605378ac2b902be00a5f', 5, 13, 4, 716::BIGINT, 'ja'),
    ('f3e2cc1aba434d9c3a85d384704bfc27', 6, 13, 4, 716::BIGINT, 'ja'),
    ('7d4560ddc58f361a325bf5e8f29f4e33', 6, 13, 4, 716::BIGINT, 'ja'),

    -- Gloomy Tomori, en-US
    ('44b0b85cb8ed6540fd4fb1c1ce063655', 5, 11, 2, 1770::BIGINT, 'en-US'),
    ('d0c1a4a1d4bd940383805d159d0de0d0', 5, 11, 2, 1770::BIGINT, 'en-US'),
    ('8c89f772b454fecd4656ff652fd5b2dc', 6, 11, 2, 1770::BIGINT, 'en-US'),
    ('bb1c56977d3ffdc005c425c4b3f9cdb0', 6, 11, 2, 1770::BIGINT, 'en-US'),
    ('e81ad1a61a394ec8c4eea374c02b6fcd', 6, 11, 2, 1770::BIGINT, 'en-US'),
    ('fbacb66af699d725482e537fdde14782', 6, 11, 2, 1770::BIGINT, 'en-US'),
    ('23047f891a0191eaeebf2105f779e00a', 6, 10, 4, 1770::BIGINT, 'en-US'),
    ('ffd4763341a9222a108c0b5d3bf992c6', 6, 10, 4, 1770::BIGINT, 'en-US'),
    -- Gloomy Tomori, ja
    ('4a07b93e75063d3744e0497964ccd8d7', 5, 11, 4, 1770::BIGINT, 'ja'),
    ('15c1dce01c3636a01a38e97c26cb8a6c', 6, 11, 4, 1770::BIGINT, 'ja'),
    ('3ed1df074790da68a7072807ae20b4a6', 6, 11, 4, 1770::BIGINT, 'ja'),

    -- Shy Tomori, en-US
    ('f0a53448cf6ebdda58b7faaabce195d2', 5, 11, 2, 3585::BIGINT, 'en-US'),
    ('d846cad74ca024a7b7a7f13ab3962608', 5, 11, 2, 3585::BIGINT, 'en-US'),
    ('47a7b823c4f5c5f529609925eec6e02c', 6, 11, 2, 3585::BIGINT, 'en-US'),
    ('7919f2d3db6d88014534ce665fab151c', 6, 11, 2, 3585::BIGINT, 'en-US'),
    ('54288ca82b9323139341655c77c82376', 6, 11, 2, 3585::BIGINT, 'en-US'),
    ('a82d7120be567364e262da7df39cb501', 6, 11, 2, 3585::BIGINT, 'en-US'),
    ('754bdbdfc2fc73b7fca62304a6564bb9', 6, 10, 4, 3585::BIGINT, 'en-US'),
    -- Shy Tomori, ja
    ('b754144907e19e882b7216dcf6ae2701', 5, 11, 4, 3585::BIGINT, 'ja'),
    ('a699223d75f0d00adcfaacc4c3319fea', 6, 11, 4, 3585::BIGINT, 'ja'),
    ('e88c931eddc09e2fab114a82aa807137', 6, 11, 4, 3585::BIGINT, 'ja'),

    -- Nerine / Professional/Loyal Tomori, en-US
    ('3f1f871a56a134ca97a74330cc614f70', 8, 15, 2, 50::BIGINT, 'en-US'),
    ('1ff2338a2019623b3f725ead51715f7e', 8, 15, 2, 50::BIGINT, 'en-US'),
    ('dc065477f5e44396021647a70ac88d70', 9, 15, 2, 50::BIGINT, 'en-US'),
    ('b89fd04e744ac6c6edaaf738526d69a2', 9, 15, 2, 50::BIGINT, 'en-US'),
    ('f7951b8e89f66ac8b8043a163c957462', 9, 15, 2, 50::BIGINT, 'en-US'),
    ('df16865e3e1738911e2288771c9f96c1', 9, 15, 2, 50::BIGINT, 'en-US'),
    -- Nerine / Professional/Loyal Tomori, ja
    ('33ac693a4be18214e0e6797393635a5d', 8, 16, 4, 50::BIGINT, 'ja'),
    ('0597b9f54f3b1ffb305baafe4739614d', 8, 16, 4, 50::BIGINT, 'ja'),
    ('f9322deb1ddc70c02787df57831cb21e', 9, 16, 4, 50::BIGINT, 'ja'),
    ('f9f092c820ab91d3a7d0a10403bf14cb', 9, 16, 4, 50::BIGINT, 'ja'),
    ('88e0d00da690b25f609e63e7870b5f18', 9, 16, 4, 50::BIGINT, 'ja'),
    ('7c59aac49ea999e878c3ca7ca71d270e', 9, 16, 4, 50::BIGINT, 'ja')
),
legacy_sample_fingerprints(sample_count, trigger_count, preset_lineage_id, preset_language, sample_in_hash, sample_out_hash) AS (
  VALUES
    (15, 2, 4::BIGINT, 'en-US', '9e5fafbb07927df180f1e66fc09390d3', '7efcf3cce1318655cf299d10a7a55ee0'),
    (15, 2, 4::BIGINT, 'en-US', '32fafd1b44bbf07638fe37f328a8da68', '7efcf3cce1318655cf299d10a7a55ee0'),
    (14, 4, 4::BIGINT, 'en-US', '32f8301e5d2f02f7b8b439ddd36bcffc', 'e7fa95ac954a86484328fd4288d7c218'),
    (15, 4, 4::BIGINT, 'ja', 'bf73521fcc2864d86b713c95e6bbf7fe', '78511ad81799a79aa0950fb2747b03af'),
    (14, 4, 4::BIGINT, 'ja', '96104214e9c37563f741f44999cf3fb7', 'edfb8eb788177463487341460ac8e085'),

    (13, 2, 716::BIGINT, 'en-US', '6e40be18778d8d989fe46b34b85b9bb6', 'dfc36a3bb38f990da5e0d3fe246e5c66'),
    (13, 2, 716::BIGINT, 'en-US', '3d521899ac88cc3b82b0f66e7e3a017c', 'dfc36a3bb38f990da5e0d3fe246e5c66'),
    (12, 4, 716::BIGINT, 'en-US', '915a4c74724e8855f707b3ff85bb748f', 'b3be7cf6c069577ff9cbdb5981b5af9e'),
    (13, 4, 716::BIGINT, 'ja', 'b905c6ca213159c94c039c2a84510a0c', '2ce366053b5e7310923c96d743c07c88'),

    (11, 2, 1770::BIGINT, 'en-US', 'c420dcfd6c0c60c0063060981295fddf', '266c4e90106773d1a913e8b0e9ae110f'),
    (11, 2, 1770::BIGINT, 'en-US', 'c420dcfd6c0c60c0063060981295fddf', '32522cb739dc26f97a5e1cb31445c72c'),
    (11, 2, 1770::BIGINT, 'en-US', 'f55ca4a421f07bddf5ed20c6b3efaee0', '32522cb739dc26f97a5e1cb31445c72c'),
    (10, 4, 1770::BIGINT, 'en-US', '06d9013ef14732e797d86dcd07744b16', '3805e0e736c0c2c2e36800d3242ff051'),
    (11, 4, 1770::BIGINT, 'ja', '44ff39de7a3177c2bd6750d7b7f8cf69', 'a32c87fbd65f65a4c2a24317911df97d'),

    (11, 2, 3585::BIGINT, 'en-US', '711a9413373692f89ba598fadf4a8891', 'a17ddafc4763e57cc87e1b359bd2ab8f'),
    (11, 2, 3585::BIGINT, 'en-US', '711a9413373692f89ba598fadf4a8891', '24d923b5d746902406f95c23a8580040'),
    (11, 2, 3585::BIGINT, 'en-US', 'e0f85cd52c5363661969f217611f7283', '24d923b5d746902406f95c23a8580040'),
    (10, 4, 3585::BIGINT, 'en-US', 'c8a424e9c88f37f98ed20e00ba2e1dd4', 'e880ed9adadedb673c7a7cf4e5e5c88c'),
    (11, 4, 3585::BIGINT, 'ja', 'a74f5837530331394bbb6f50e0b72f14', 'a31fe83f72e4e84602012083f77600d9'),

    (15, 2, 50::BIGINT, 'en-US', '6d65925fdd710c528e80d6957a5bcfad', 'de2dd2cd11d6acd4e80bc98a7cb242aa'),
    (15, 2, 50::BIGINT, 'en-US', '6d65925fdd710c528e80d6957a5bcfad', 'b7c57ab81b810f581067d9f541fc67f8'),
    (16, 4, 50::BIGINT, 'ja', 'bc0de513b482d59487a91dd5cdb23620', 'c2c0c1a79a8663db91b4454f2320aa2b')
),
persona_fingerprints AS (
  SELECT
    p.persona_id,
    md5(array_to_string(
      COALESCE(
        (
          SELECT array_agg(pa.attribute_text ORDER BY pa.attribute_order)
          FROM persona_attributes pa
          WHERE pa.persona_id = p.persona_id
        ),
        COALESCE(p.attribute_list, ARRAY[]::TEXT[])
      ),
      E'\x1f'
    )) AS attr_hash,
    cardinality(
      COALESCE(
        (
          SELECT array_agg(pa.attribute_text ORDER BY pa.attribute_order)
          FROM persona_attributes pa
          WHERE pa.persona_id = p.persona_id
        ),
        COALESCE(p.attribute_list, ARRAY[]::TEXT[])
      )
    )::INT AS attr_count,
    cardinality(COALESCE(p.sample_dialogues_in, ARRAY[]::TEXT[]))::INT AS sample_count,
    cardinality(COALESCE(pc.trigger_words, ARRAY[]::TEXT[]))::INT AS trigger_count,
    md5(array_to_string(COALESCE(p.sample_dialogues_in, ARRAY[]::TEXT[]), E'\x1f')) AS sample_in_hash,
    md5(array_to_string(COALESCE(p.sample_dialogues_out, ARRAY[]::TEXT[]), E'\x1f')) AS sample_out_hash,
    pc.persona_prompt
  FROM personas p
  LEFT JOIN persona_configs pc ON pc.persona_id = p.persona_id
  WHERE COALESCE(p.is_pointer, false) = false
),
candidate_matches AS (
  SELECT
    pf.persona_id,
    lf.preset_lineage_id,
    lf.preset_language,
    ROW_NUMBER() OVER (
      PARTITION BY pf.persona_id
      ORDER BY lf.preset_lineage_id ASC, lf.preset_language ASC
    ) AS match_rank
  FROM persona_fingerprints pf
  JOIN legacy_fingerprints lf
    ON lf.attr_hash = pf.attr_hash
    AND lf.attr_count = pf.attr_count
    AND lf.sample_count = pf.sample_count
    AND lf.trigger_count = pf.trigger_count
  JOIN legacy_sample_fingerprints sf
    ON sf.sample_count = pf.sample_count
    AND sf.trigger_count = pf.trigger_count
    AND sf.preset_lineage_id = lf.preset_lineage_id
    AND sf.preset_language = lf.preset_language
    AND sf.sample_in_hash = pf.sample_in_hash
    AND sf.sample_out_hash = pf.sample_out_hash
  JOIN persona_presets pp
    ON pp.preset_lineage_id = lf.preset_lineage_id
    AND pp.preset_language = lf.preset_language
  WHERE pf.persona_prompt IS NULL
    OR pf.persona_prompt = pp.persona_preset_desc
)
UPDATE personas p
SET
  is_pointer = true,
  preset_lineage_id = cm.preset_lineage_id,
  preset_language = cm.preset_language,
  updated_at = NOW()
FROM candidate_matches cm
WHERE p.persona_id = cm.persona_id
  AND cm.match_rank = 1
  AND COALESCE(p.is_pointer, false) = false;
