-- 003_persona_config_tables.sql
--
-- Stage A (Expand): creates 4 command-aligned persona_*_configs tables and
-- backfills data from tomoris. Source columns remain in tomoris; Stage B
-- (a future session after soak) will migrate callers and drop the source columns.
--
-- Primary key: tomori_id (FK → tomoris). #16.8 renames this to persona_id
-- across the entire schema as the final Phase 6 step; do not rename here.
--
-- elevenlabs_voice_* columns are included in persona_voice_configs for Stage A
-- because #14.2 (Pass C) finishes the migration to speech_voice_* columns.
-- Both the old and new column pairs travel together until Pass C ships.

-- ── persona_context_note_configs ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_context_note_configs (
  tomori_id          INT PRIMARY KEY REFERENCES tomoris(tomori_id) ON DELETE CASCADE,
  context_note       TEXT,
  context_note_depth INT  NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_persona_context_note_configs_timestamp ON persona_context_note_configs;
CREATE TRIGGER update_persona_context_note_configs_timestamp
  BEFORE UPDATE ON persona_context_note_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO persona_context_note_configs (tomori_id, context_note, context_note_depth)
SELECT tomori_id, context_note, COALESCE(context_note_depth, 0)
FROM tomoris
ON CONFLICT (tomori_id) DO NOTHING;

-- ── persona_voice_configs ────────────────────────────────────────────────────
-- Kept in sync with tomoris voice columns for Stage A dual-write soak.
-- elevenlabs_voice_* columns remain until #14.2 Pass C drops them.

CREATE TABLE IF NOT EXISTS persona_voice_configs (
  tomori_id                INT PRIMARY KEY REFERENCES tomoris(tomori_id) ON DELETE CASCADE,
  speech_voice_sample_id   INT REFERENCES voice_samples(sample_id) ON DELETE SET NULL,
  speech_voice_id          TEXT,
  speech_voice_name        TEXT,
  speech_voice_design_prompt TEXT,
  elevenlabs_voice_id      TEXT,
  elevenlabs_voice_name    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_persona_voice_configs_timestamp ON persona_voice_configs;
CREATE TRIGGER update_persona_voice_configs_timestamp
  BEFORE UPDATE ON persona_voice_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO persona_voice_configs (
  tomori_id, speech_voice_sample_id, speech_voice_id, speech_voice_name,
  speech_voice_design_prompt, elevenlabs_voice_id, elevenlabs_voice_name
)
SELECT
  tomori_id,
  speech_voice_sample_id,
  speech_voice_id,
  speech_voice_name,
  speech_voice_design_prompt,
  elevenlabs_voice_id,
  elevenlabs_voice_name
FROM tomoris
ON CONFLICT (tomori_id) DO NOTHING;

-- ── persona_imagegen_configs ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_imagegen_configs (
  tomori_id      INT    PRIMARY KEY REFERENCES tomoris(tomori_id) ON DELETE CASCADE,
  nai_tags       TEXT[] NOT NULL DEFAULT '{}',
  nai_char_ref_url TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_persona_imagegen_configs_timestamp ON persona_imagegen_configs;
CREATE TRIGGER update_persona_imagegen_configs_timestamp
  BEFORE UPDATE ON persona_imagegen_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO persona_imagegen_configs (tomori_id, nai_tags, nai_char_ref_url)
SELECT tomori_id, COALESCE(nai_tags, '{}'), nai_char_ref_url
FROM tomoris
ON CONFLICT (tomori_id) DO NOTHING;

-- ── persona_textgen_configs ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_textgen_configs (
  tomori_id       INT      PRIMARY KEY REFERENCES tomoris(tomori_id) ON DELETE CASCADE,
  nai_attg_author TEXT,
  nai_attg_title  TEXT,
  nai_attg_tags   TEXT,
  nai_attg_genre  TEXT,
  nai_attg_stars  SMALLINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_persona_textgen_configs_timestamp ON persona_textgen_configs;
CREATE TRIGGER update_persona_textgen_configs_timestamp
  BEFORE UPDATE ON persona_textgen_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

INSERT INTO persona_textgen_configs (
  tomori_id, nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
)
SELECT tomori_id, nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
FROM tomoris
ON CONFLICT (tomori_id) DO NOTHING;
