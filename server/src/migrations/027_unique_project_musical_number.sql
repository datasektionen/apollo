DO $$
DECLARE
  rec RECORD;
  major_num TEXT;
  minor_num BIGINT;
  candidate TEXT;
  found_candidate BOOLEAN;
  k BIGINT;
  base_val TEXT;
  suffix TEXT;
  norm_key TEXT;
BEGIN
  FOR rec IN
    SELECT id, show_id, musical_number, rn, visible_len
    FROM (
      SELECT
        id,
        show_id,
        musical_number,
        char_length(replace(btrim(musical_number), '_', '')) AS visible_len,
        ROW_NUMBER() OVER (
          PARTITION BY show_id, LOWER(REPLACE(BTRIM(musical_number), '_', ''))
          ORDER BY created_at ASC, name ASC, id ASC
        ) AS rn
      FROM projects
    ) ranked
    WHERE visible_len = 0 OR rn > 1
    ORDER BY show_id, rn, id
  LOOP
    base_val := btrim(rec.musical_number);
    found_candidate := FALSE;
    candidate := NULL;

    IF rec.visible_len > 0 AND base_val ~ '^[0-9]+\.[0-9]+$' THEN
      major_num := split_part(base_val, '.', 1);
      minor_num := split_part(base_val, '.', 2)::BIGINT;
      FOR k IN 1..99 LOOP
        candidate := major_num || '.' || (minor_num + k)::TEXT;
        IF char_length(candidate) <= 9 THEN
          norm_key := LOWER(REPLACE(BTRIM(candidate), '_', ''));
          IF norm_key <> '' AND NOT EXISTS (
            SELECT 1
            FROM projects p
            WHERE p.show_id = rec.show_id
              AND p.id <> rec.id
              AND LOWER(REPLACE(BTRIM(p.musical_number), '_', '')) = norm_key
          ) THEN
            found_candidate := TRUE;
            EXIT;
          END IF;
        END IF;
      END LOOP;
    END IF;

    IF NOT found_candidate AND rec.visible_len > 0 THEN
      FOR k IN 2..99 LOOP
        suffix := '-' || k::TEXT;
        candidate := left(base_val, 9 - char_length(suffix)) || suffix;
        norm_key := LOWER(REPLACE(BTRIM(candidate), '_', ''));
        IF norm_key <> '' AND char_length(candidate) <= 9 AND NOT EXISTS (
          SELECT 1
          FROM projects p
          WHERE p.show_id = rec.show_id
            AND p.id <> rec.id
            AND LOWER(REPLACE(BTRIM(p.musical_number), '_', '')) = norm_key
        ) THEN
          found_candidate := TRUE;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF NOT found_candidate THEN
      FOR k IN 1..999999 LOOP
        candidate := k::TEXT;
        IF char_length(candidate) <= 9 THEN
          norm_key := LOWER(candidate);
          IF NOT EXISTS (
            SELECT 1
            FROM projects p
            WHERE p.show_id = rec.show_id
              AND p.id <> rec.id
              AND LOWER(REPLACE(BTRIM(p.musical_number), '_', '')) = norm_key
          ) THEN
            found_candidate := TRUE;
            EXIT;
          END IF;
        END IF;
      END LOOP;
    END IF;

    IF NOT found_candidate THEN
      RAISE EXCEPTION 'Could not find unique musical_number for project % in show %', rec.id, rec.show_id;
    END IF;

    UPDATE projects
    SET musical_number = candidate
    WHERE id = rec.id;

    UPDATE project_heads
    SET latest_snapshot_json = jsonb_set(latest_snapshot_json, '{musicalNumber}', to_jsonb(candidate), true)
    WHERE project_id = rec.id
      AND latest_snapshot_json IS NOT NULL;
  END LOOP;
END $$;

UPDATE projects
SET musical_number = btrim(musical_number)
WHERE musical_number <> btrim(musical_number);

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_musical_number_length_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_musical_number_length_check
  CHECK (
    char_length(btrim(musical_number)) >= 1
    AND char_length(btrim(musical_number)) < 10
    AND char_length(replace(btrim(musical_number), '_', '')) >= 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_show_musical_number_unique
  ON projects (show_id, LOWER(REPLACE(BTRIM(musical_number), '_', '')));
