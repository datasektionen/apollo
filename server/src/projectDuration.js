function jsonbMsOrZero(objectSql, key) {
  return `(CASE
    WHEN jsonb_typeof(${objectSql}->'${key}') = 'number' THEN (${objectSql}->>'${key}')::double precision
    WHEN jsonb_typeof(${objectSql}->'${key}') = 'string'
      AND (${objectSql}->>'${key}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      THEN (${objectSql}->>'${key}')::double precision
    ELSE 0
  END)`;
}

export function snapshotDurationMsSql(headsAlias = 'ph') {
  const snapshot = `${headsAlias}.latest_snapshot_json`;
  const timelineStartMs = jsonbMsOrZero('clip', 'timelineStartMs');
  const cropStartMs = jsonbMsOrZero('clip', 'cropStartMs');
  const cropEndMs = jsonbMsOrZero('clip', 'cropEndMs');
  const sourceDurationMs = jsonbMsOrZero('clip', 'sourceDurationMs');
  return `COALESCE((
    SELECT MAX(
      ${timelineStartMs}
      + GREATEST(
          0,
          (CASE WHEN ${cropEndMs} > ${cropStartMs} THEN ${cropEndMs} ELSE ${sourceDurationMs} END)
          - ${cropStartMs}
        )
    )
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(${snapshot} -> 'tracks') = 'array'
          THEN ${snapshot} -> 'tracks'
        ELSE '[]'::jsonb
      END
    ) AS track
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(track -> 'clips') = 'array'
          THEN track -> 'clips'
        ELSE '[]'::jsonb
      END
    ) AS clip
  ), 0)`;
}
