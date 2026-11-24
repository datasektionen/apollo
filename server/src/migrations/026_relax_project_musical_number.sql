ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_musical_number_format_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_musical_number_length_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_musical_number_length_check
      CHECK (char_length(musical_number) >= 1 AND char_length(musical_number) < 10);
  END IF;
END $$;
