ALTER TABLE media_objects
  ADD COLUMN IF NOT EXISTS unreferenced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_media_objects_unreferenced_at
  ON media_objects (unreferenced_at)
  WHERE unreferenced_at IS NOT NULL;
