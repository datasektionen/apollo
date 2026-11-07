import { describe, expect, it } from 'vitest';
import { applyClipPatches } from '../clipCollision';
const clip = (id, start = 0) => ({ id, blobId: id, timelineStartMs: start, cropStartMs: 0, cropEndMs: 500, sourceDurationMs: 1000, gainDb: 0 });
const fixture = () => ({ tracks: [{ id: 'a', clips: [clip('one')] }, { id: 'b', clips: [clip('two', 1000)] }, { id: 'c', clips: [] }] });

describe('atomic timeline clip edits', () => {
  it('moves multiple clips atomically and shares untouched tracks', () => {
    const project = fixture();
    const next = applyClipPatches(project, { one: { timelineStartMs: 500 }, two: { timelineStartMs: 1500 } }, { one: 'b' });
    expect(next.tracks[0].clips).toEqual([]);
    expect(next.tracks[1].clips.map((c) => c.id)).toEqual(['one', 'two']);
    expect(next.tracks[2]).toBe(project.tracks[2]);
  });
  it.each([
    [{ one: { timelineStartMs: -1 } }, {}],
    [{ one: { timelineStartMs: NaN } }, {}],
    [{ one: { cropEndMs: 1001 } }, {}],
    [{ one: { cropStartMs: 450 } }, {}],
    [{ one: { gainDb: Infinity } }, {}],
    [{ one: { timelineStartMs: 1000 } }, { one: 'b' }],
    [{ one: { timelineStartMs: 500 } }, { one: 'deleted' }],
    [{ missing: { timelineStartMs: 500 } }, {}],
  ])('rejects invalid bounds, collisions and deleted identities without losing clips', (patches, destinations) => {
    const project = fixture();
    expect(applyClipPatches(project, patches, destinations)).toBe(project);
  });
  it.each([
    [{ gainDb: 3 }, {}],
    [{ muted: true }, {}],
    [{ timelineStartMs: 600 }, {}],
    [{ timelineStartMs: 600 }, { one: 'b' }],
    [{ cropStartMs: 100, cropEndMs: 150 }, {}],
  ])('preserves edits that do not change an existing 50ms fragment duration', (patch, destinations) => {
    const project = fixture();
    project.tracks[0].clips[0].cropEndMs = 50;
    const next = applyClipPatches(project, { one: patch }, destinations);
    expect(next).not.toBe(project);
    const edited = next.tracks.flatMap((track) => track.clips).find((entry) => entry.id === 'one');
    expect(edited).toMatchObject(patch);
    expect(edited.cropEndMs - edited.cropStartMs).toBe(50);
  });
  it('enforces the minimum only on duration changes and always rejects empty or reversed ranges', () => {
    const project = fixture();
    project.tracks[0].clips[0].cropEndMs = 50;
    for (const cropEndMs of [-1, 0, 25, 75]) {
      expect(applyClipPatches(project, { one: { cropEndMs } })).toBe(project);
    }
    expect(applyClipPatches(project, { one: { cropEndMs: 100 } })).not.toBe(project);
    expect(applyClipPatches(project, { one: { gainDb: 0, cropEndMs: 50 } })).toBe(project);
    expect(applyClipPatches(project, { one: { timelineStartMs: -1 } })).toBe(project);
    expect(applyClipPatches(project, { one: { timelineStartMs: 1000 } }, { one: 'b' })).toBe(project);
    expect(applyClipPatches(project, { one: { gainDb: 1 } }, {}, { canEditTrack: () => false })).toBe(project);
  });
  it('rejects collisions among moving clips as a whole', () => {
    const project = fixture();
    expect(applyClipPatches(project, { one: { timelineStartMs: 600 }, two: { timelineStartMs: 600 } }, { one: 'b' })).toBe(project);
  });
  it('revalidates both permissions and baseline after remote changes', () => {
    const project = fixture();
    const patches = { one: { timelineStartMs: 500 } };
    expect(applyClipPatches(project, patches, { one: 'b' }, { canEditTrack: (id) => id !== 'b' })).toBe(project);
    expect(applyClipPatches(project, patches, {}, { baseline: { one: { trackId: 'a', timelineStartMs: 99 } } })).toBe(project);
    expect(applyClipPatches(project, patches, {}, { baseline: { one: { trackId: 'a', blobId: 'replaced' } } })).toBe(project);
  });
  it('suppresses no-ops and permits touching ranges', () => {
    const project = fixture();
    expect(applyClipPatches(project, { one: { timelineStartMs: 0 } })).toBe(project);
    expect(applyClipPatches(project, { one: { timelineStartMs: 500 } }, { one: 'b' })).not.toBe(project);
  });
});
