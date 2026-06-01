-- Rollback for 021_decouple_image_tags.sql.

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('personas', 'physical_appearance_tags', 'nai_tags', '''{}''::TEXT[]'),
      ('persona_imagegen_configs', 'physical_appearance_tags', 'nai_tags', '''{}''::TEXT[]'),
      ('users', 'physical_appearance_tags', 'nai_char_tags', '''{}''::TEXT[]'),
      ('user_personalization_configs', 'physical_appearance_tags', 'nai_char_tags', '''{}''::TEXT[]'),
      (
        'server_novelai_imagegen_configs',
        'image_default_positive_tags',
        'nai_style_tags',
        '''{"absurdres","aesthetic","very aesthetic","masterpiece","best quality","good quality","newest"}''::TEXT[]'
      ),
      (
        'server_novelai_imagegen_configs',
        'image_default_negative_tags',
        'nai_negative_tags',
        '''{"lowres","worst quality","low quality","bad quality","old","oldest","unfinished","scan artifacts","jpeg artifacts","jaggy lines","unclear","sketch","blurry","bad anatomy","very displeasing","displeasing","bad hands","bad fingers","missing fingers","bad proportions","bad perspective","bad eyes","bad pupils","multiple heads","extra faces","many arms","poorly drawn face","poorly drawn hands","fused hands","bad feet","too many legs","malformed limbs","extra arms","multiple ears","extra digits","fewer digits","twitter username","username","watermark","signature","2koma","4koma","comic"}''::TEXT[]'
      )
    ) AS v(table_name, old_name, new_name, default_expr)
  LOOP
    IF to_regclass(format('public.%I', item.table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = item.table_name
        AND column_name = item.old_name
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = item.table_name
        AND column_name = item.new_name
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', item.table_name, item.old_name, item.new_name);
    ELSE
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I TEXT[]', item.table_name, item.new_name);

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = item.table_name
          AND column_name = item.old_name
      ) THEN
        EXECUTE format(
          'UPDATE %I SET %I = COALESCE(NULLIF(%I, ''{}''::TEXT[]), %I, %s)',
          item.table_name,
          item.new_name,
          item.new_name,
          item.old_name,
          item.default_expr
        );
        EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS %I', item.table_name, item.old_name);
      END IF;
    END IF;

    EXECUTE format('UPDATE %I SET %I = %s WHERE %I IS NULL', item.table_name, item.new_name, item.default_expr, item.new_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', item.table_name, item.new_name, item.default_expr);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET NOT NULL', item.table_name, item.new_name);
  END LOOP;
END $$;
