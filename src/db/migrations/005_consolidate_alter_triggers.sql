-- 005_consolidate_alter_triggers.sql
--
-- Stage B: Consolidates tomoris.alter_triggers into persona_configs.trigger_words
-- and drops the now-redundant column. After this migration, persona_configs.trigger_words
-- is the single source of trigger words for all personas (main and alter alike).
--
-- ─── Behavior-preservation verdict table ──────────────────────────────────────
--
-- Every reader of `persona.is_alter ? alter_triggers : persona_configs.trigger_words`
-- was audited before this migration was written. Verdicts:
--
--  Reader                                       File                            Verdict
--  ─────────────────────────────────────────────────────────────────────────────────────
--  tomoriData.is_alter ? alter_triggers : …     PersonaRepository.ts:834        preserved-by-renamed-body
--    → fallback simplified to personaConfig?.trigger_words ?? []
--  tomoriRow.is_alter ? alter_triggers : …      PersonaRepository.ts:1077       preserved-by-renamed-body
--    → same simplification
--  persona.trigger_words ?? (is_alter ? …)      triggerProcessor.ts:273         preserved-by-renamed-body
--    → entire ?? fallback clause removed; trigger_words from PersonaRepository is canonical
--  triggerSource string + ternary               replyDecision.ts:157            preserved-by-renamed-body
--    → log branch and ternary dissolved; persona.trigger_words used unconditionally
--  persona.is_alter ? alter_triggers : …        admission.ts:571                preserved-by-renamed-body
--    → ternary dissolved; persona.trigger_words used directly
--  persona.is_alter ? alter_triggers : …        contextAnnotations.ts:85        preserved-by-renamed-body
--    → same
--  SELECT alter_triggers FROM tomoris           PresetRepository.ts:677,688     dropped-intentional
--    → column removed; export reads from persona_configs.trigger_words (line 735)
--  SELECT trigger_words FROM tomori_configs     PresetRepository.ts:739         dropped-intentional
--    → fallback dead after persona_configs backfill; tomori_configs drops in 006
--  presetData.alter_triggers ?? null            PresetRepository.ts:767         dropped-intentional
--    → fallback dead after this migration's backfill
--  CASE WHEN is_alter THEN alter_triggers …     schema.sql:442                  preserved-by-renamed-body
--    → schema.sql backfill INSERT simplified to row-ensure only (no trigger_words logic)
--  alter_triggers: z.array()                    types/db/schema.ts:84           dropped-intentional
--    → field removed from Zod schema
--  selectedPersona.alter_triggers display       personaPages.ts:99              dropped-intentional
--    → alterTriggersValue removed; field_alter_triggers embed field removed
--  field_alter_triggers locale key              en-US/tool.ts:245, ja/tool.ts   dropped-intentional
--    → locale keys removed (no remaining usages after personaPages.ts change)
--  alter_triggers: selectedPersona.alter_triggers  export.ts:175               preserved-by-renamed-body
--    → mapped to trigger_words field instead
--
-- Caller counts for repository methods whose SQL changes:
--  PersonaRepository.loadTomoriState — 3 callers confirmed (getCachedTomoriState wrappers)
--  PersonaRepository.loadAllPersonasForServer — 2 callers confirmed (getCachedAllPersonas wrappers)
--  PresetRepository.exportPreset — 2 callers confirmed (export command + import/export flow)
-- ─────────────────────────────────────────────────────────────────────────────

-- Backfill alter persona trigger words into persona_configs.trigger_words where
-- the legacy alter_triggers column still exists. Fresh #16.8 schemas no longer
-- have that column, so this is guarded for migration-runner replay from scratch.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personas'
      AND column_name = 'alter_triggers'
  ) THEN
    UPDATE persona_configs pc
    SET trigger_words = t.alter_triggers
    FROM personas t
    WHERE t.persona_id = pc.persona_id
      AND t.is_alter = true
      AND t.alter_triggers IS NOT NULL
      AND array_length(t.alter_triggers, 1) > 0
      AND (pc.trigger_words IS NULL OR array_length(pc.trigger_words, 1) = 0);

    -- Drop the now-redundant column. All alter trigger data is in persona_configs.trigger_words.
    ALTER TABLE personas DROP COLUMN IF EXISTS alter_triggers;
  END IF;
END $$;
