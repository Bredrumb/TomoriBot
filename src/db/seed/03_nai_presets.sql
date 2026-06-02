-- NovelAI sampling preset seed data.
-- Loaded on every startup after schema.sql and before numbered migrations.

-- NOVELAI SAMPLING PRESETS (March 2026)
-- Idempotent upserts for all Kayra (13) and Erato (5) presets.
-- ON CONFLICT keeps the table up-to-date when preset data changes.
-- ============================================================================

-- ============ KAYRA PRESETS ============

-- Carefree-Kayra (DEFAULT for kayra-v1)
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Carefree-Kayra', 'kayra', TRUE,
    'Balanced and relaxed, a reliable all-purpose preset for natural roleplay.',
    'バランスが取れたリラックスしたプリセット。自然なロールプレイに最適。',
    '{"order":[2,3,0,4,1],"temperature":1.35,"max_length":150,"min_length":1,"top_k":15,"top_p":0.85,"top_a":0.1,"tail_free_sampling":0.915,"repetition_penalty":2.8,"repetition_penalty_range":2048,"repetition_penalty_slope":0.02,"repetition_penalty_frequency":0.02,"repetition_penalty_presence":0,"phrase_rep_pen":"aggressive","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Asper-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Asper-Kayra', 'kayra', FALSE,
    'Crisp and focused, lower temperature with Typical Sampling for steady, disciplined prose.',
    '温度低めでTypical Samplingを使用。落ち着いた規律ある文体に最適。',
    '{"order":[5,0,1,3],"temperature":1.16,"max_length":150,"min_length":1,"top_k":175,"typical_p":0.96,"tail_free_sampling":0.994,"repetition_penalty":1.68,"repetition_penalty_range":2240,"repetition_penalty_slope":1.5,"repetition_penalty_frequency":0,"repetition_penalty_presence":0.005,"phrase_rep_pen":"medium","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Blended-Coffee-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Blended-Coffee-Kayra', 'kayra', FALSE,
    'Smooth and grounded, blends top-K and tail-free for consistent, natural storytelling.',
    'トップKとテールフリーを組み合わせた滑らかで安定した文体。',
    '{"order":[0,1,2,3],"temperature":1.0,"max_length":150,"min_length":1,"top_k":25,"top_p":1.0,"tail_free_sampling":0.925,"repetition_penalty":1.6,"repetition_penalty_frequency":0.001,"repetition_penalty_range":0,"repetition_penalty_presence":0,"phrase_rep_pen":"medium","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Blook-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Blook-Kayra', 'kayra', FALSE,
    'Bold repetition-fighter, very aggressive phrase rep penalty keeps outputs fresh and varied.',
    '非常に攻撃的なフレーズ繰り返しペナルティで新鮮でバラエティ豊かな出力を実現。',
    '{"order":[2,3,1,0],"temperature":1.0,"max_length":150,"min_length":1,"top_k":0,"top_p":0.96,"tail_free_sampling":0.96,"repetition_penalty":2.0,"repetition_penalty_slope":1.0,"repetition_penalty_frequency":0.02,"repetition_penalty_range":0,"repetition_penalty_presence":0.3,"phrase_rep_pen":"very_aggressive","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- CosmicCube-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'CosmicCube-Kayra', 'kayra', FALSE,
    'Mirostat entropy sampling, experimental entropy-based sampler for unpredictable, cosmic outputs.',
    'ミロスタットエントロピーサンプリング。予測不可能で宇宙的な出力のための実験的サンプラー。',
    '{"order":[8,5,0,3],"temperature":0.9,"max_length":150,"min_length":1,"typical_p":0.95,"tail_free_sampling":0.92,"mirostat_lr":0.22,"mirostat_tau":4.95,"repetition_penalty":3.0,"repetition_penalty_range":4000,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"phrase_rep_pen":"off","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Fresh-Coffee-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Fresh-Coffee-Kayra', 'kayra', FALSE,
    'Light and clean, fresher top-K outputs with minimal phrase repetition penalty.',
    '軽くクリーンなトップK出力。フレーズ繰り返しペナルティを最小化。',
    '{"order":[0,1,2,3],"temperature":1.0,"max_length":150,"min_length":1,"top_k":25,"top_p":1.0,"tail_free_sampling":0.925,"repetition_penalty":1.9,"repetition_penalty_range":768,"repetition_penalty_slope":1.0,"repetition_penalty_frequency":0.0025,"repetition_penalty_presence":0.001,"phrase_rep_pen":"off","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Green-Active-Writer-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Green-Active-Writer-Kayra', 'kayra', FALSE,
    'High-energy mirostat writer, creative and dynamic at temperature 1.5 with strong anti-repetition.',
    '高エネルギーなミロスタットライター。温度1.5で創造的かつダイナミック、強い反復防止付き。',
    '{"order":[0,8,5,3],"temperature":1.5,"max_length":150,"min_length":1,"typical_p":0.95,"tail_free_sampling":0.95,"mirostat_lr":0.2,"mirostat_tau":5.5,"repetition_penalty":1.0,"repetition_penalty_range":1632,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"phrase_rep_pen":"very_aggressive","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Pilotfish-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Pilotfish-Kayra', 'kayra', FALSE,
    'Multi-sampler blend, layered top-K/P/A/Typical for rich narrative variety.',
    '複数のサンプラーを組み合わせた豊かなナラティブバリエーション。',
    '{"order":[0,4,1,2,5,3],"temperature":1.31,"max_length":150,"min_length":1,"top_k":25,"top_p":0.97,"top_a":0.18,"typical_p":0.98,"tail_free_sampling":1.0,"repetition_penalty":1.55,"repetition_penalty_frequency":0.00075,"repetition_penalty_presence":0.00085,"repetition_penalty_range":8192,"repetition_penalty_slope":1.8,"phrase_rep_pen":"medium","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Pro_Writer-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Pro_Writer-Kayra', 'kayra', FALSE,
    'Refined narrative, tuned for written prose quality using top-A and Typical Sampling.',
    '洗練されたナラティブ。トップAとTypical Samplingによる高品質な文章向け。',
    '{"order":[3,4,5,0],"temperature":1.06,"max_length":150,"min_length":1,"top_a":0.146,"typical_p":0.976,"tail_free_sampling":0.969,"repetition_penalty":1.86,"repetition_penalty_slope":2.33,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"repetition_penalty_range":2048,"phrase_rep_pen":"medium","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Stelenes-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Stelenes-Kayra', 'kayra', FALSE,
    'Maximum chaos, very high temperature (2.5) for maximally experimental and unpredictable text.',
    '最大カオス。温度2.5による極めて実験的で予測不可能なテキスト生成。',
    '{"order":[3,0,5],"temperature":2.5,"max_length":150,"min_length":1,"typical_p":0.969,"tail_free_sampling":0.941,"repetition_penalty":1.0,"repetition_penalty_range":1024,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"phrase_rep_pen":"medium","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Tea_Time-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Tea_Time-Kayra', 'kayra', FALSE,
    'Quiet and mellow, top-A and Typical with aggressive phrase guard for tranquil outputs.',
    'トップAとTypical、攻撃的フレーズガードで穏やかで落ち着いた出力を実現。',
    '{"order":[5,0,4],"temperature":1.0,"max_length":150,"min_length":1,"top_a":0.017,"typical_p":0.975,"repetition_penalty":3.0,"repetition_penalty_slope":0.09,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"repetition_penalty_range":7680,"phrase_rep_pen":"aggressive","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Tesseract-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Tesseract-Kayra', 'kayra', FALSE,
    'Sharp and precise, very low temperature (0.895) for highly deterministic, focused responses.',
    '非常に低い温度（0.895）による高度に決定論的でフォーカスした応答。',
    '{"order":[0,5],"temperature":0.895,"max_length":150,"min_length":1,"typical_p":0.9,"repetition_penalty":2.0,"repetition_penalty_slope":3.2,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"repetition_penalty_range":4048,"phrase_rep_pen":"aggressive","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Writers-Daemon-Kayra
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Writers-Daemon-Kayra', 'kayra', FALSE,
    'Daemon-driven mirostat, comprehensive multi-sampler with high entropy for creative writing.',
    'デーモン駆動のミロスタット。高エントロピーの包括的マルチサンプラーでクリエイティブライティングに最適。',
    '{"order":[8,0,5,3,2,4],"temperature":1.5,"max_length":150,"min_length":1,"top_a":0.02,"top_p":0.95,"typical_p":0.95,"tail_free_sampling":0.95,"mirostat_lr":0.25,"mirostat_tau":5.0,"repetition_penalty":1.625,"repetition_penalty_range":2016,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"phrase_rep_pen":"very_aggressive","min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- ============ ERATO PRESETS ============

-- Erato-Shosetsu (DEFAULT for llama-3-erato-v1)
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Erato-Shosetsu', 'erato', TRUE,
    'Novel-style writing, Shosetsu (小説) tuned for structured narrative with strong rep control.',
    '「小説」スタイル。整理されたナラティブと強い反復制御に最適化。',
    '{"order":[9,10],"temperature":1.0,"max_length":150,"min_length":1,"top_k":50,"top_p":0.85,"top_a":1.0,"typical_p":1.0,"tail_free_sampling":0.895,"repetition_penalty":1.63,"repetition_penalty_range":1024,"repetition_penalty_slope":3.33,"repetition_penalty_frequency":0.0035,"repetition_penalty_presence":0,"phrase_rep_pen":"medium","mirostat_lr":1.0,"mirostat_tau":0,"min_p":0.05}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Erato-Dragonfruit
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Erato-Dragonfruit', 'erato', FALSE,
    'Fruity and vivid, complex sampler chain with mirostat for elaborate and colorful prose.',
    '複雑なサンプラーチェーンとミロスタットで鮮やかで精巧な文体を実現。',
    '{"order":[0,5,9,10,8,4],"temperature":1.37,"max_length":150,"min_length":1,"top_k":0,"top_p":1.0,"top_a":0.1,"typical_p":0.875,"tail_free_sampling":0.87,"repetition_penalty":3.25,"repetition_penalty_range":6000,"repetition_penalty_slope":3.25,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"phrase_rep_pen":"off","mirostat_lr":0.2,"mirostat_tau":4.0,"min_p":0.035}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Erato-Golden Arrow
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Erato-Golden Arrow', 'erato', FALSE,
    'Classic and balanced, standard tail-free sampling for coherent, flowing narrative.',
    'クラシックでバランスの取れた、テールフリーサンプリングによる一貫した滑らかなナラティブ。',
    '{"order":[9,2],"temperature":1.0,"max_length":150,"min_length":1,"top_k":0,"top_p":0.995,"top_a":1.0,"typical_p":1.0,"tail_free_sampling":0.87,"repetition_penalty":1.5,"repetition_penalty_range":2240,"repetition_penalty_slope":1.0,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"phrase_rep_pen":"light","mirostat_lr":1.0,"mirostat_tau":0,"min_p":0}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Erato-Wilder
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Erato-Wilder', 'erato', FALSE,
    'Wild and expansive, high top-K (300) for more varied and adventurous outputs.',
    '高いトップK（300）による多様で冒険的な出力。',
    '{"order":[9,10],"temperature":1.0,"max_length":150,"min_length":1,"top_k":300,"top_p":0.98,"top_a":0.004,"typical_p":0.96,"tail_free_sampling":0.96,"repetition_penalty":1.48,"repetition_penalty_range":2240,"repetition_penalty_slope":0.64,"repetition_penalty_frequency":0,"repetition_penalty_presence":0,"phrase_rep_pen":"medium","mirostat_lr":1.0,"mirostat_tau":0,"min_p":0.02}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;

-- Erato-Zany Scribe
INSERT INTO nai_presets (preset_name, model_target, is_default, preset_desc, ja_preset_desc, parameters)
VALUES (
    'Erato-Zany Scribe', 'erato', FALSE,
    'Zany and unpredictable, high frequency/presence penalties for maximally varied outputs.',
    '高い頻度・存在ペナルティによる最大限に多様な出力。',
    '{"order":[9,2],"temperature":1.0,"max_length":150,"min_length":1,"top_k":0,"top_p":0.99,"top_a":1.0,"typical_p":1.0,"tail_free_sampling":0.99,"repetition_penalty":1.0,"repetition_penalty_range":64,"repetition_penalty_slope":1.0,"repetition_penalty_frequency":0.75,"repetition_penalty_presence":1.5,"phrase_rep_pen":"medium","mirostat_lr":1.0,"mirostat_tau":1.0,"min_p":0.08}'::jsonb
)
ON CONFLICT (preset_name, model_target) DO UPDATE
    SET parameters     = EXCLUDED.parameters,
        is_default     = EXCLUDED.is_default,
        preset_desc    = EXCLUDED.preset_desc,
        ja_preset_desc = EXCLUDED.ja_preset_desc;
