import { describe, expect, it } from 'vitest';
import { snapshotDurationMsSql } from '../projectDuration.js';

describe('snapshotDurationMsSql', () => {
  it('builds a query against project_heads clip times', () => {
    const sql = snapshotDurationMsSql('ph');
    expect(sql).toContain("ph.latest_snapshot_json -> 'tracks'");
    expect(sql).toContain("clip->>'cropEndMs'");
    expect(sql).toContain("clip->>'sourceDurationMs'");
    expect(sql).toContain("clip->>'timelineStartMs'");
  });
});
