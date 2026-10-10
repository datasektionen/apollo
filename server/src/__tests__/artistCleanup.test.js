import { describe, expect, it } from 'vitest';
import {
  detachArtistFromCredits,
  detachArtistFromSnapshot,
  detachArtistRefs,
} from '../artistCleanup.js';

describe('detachArtistRefs', () => {
  it('removes one artist and leaves the other refs', () => {
    const detached = detachArtistRefs([
      { type: 'group', id: 'brass' },
      { type: 'user', id: 'ada' },
    ], 'group', 'brass');

    expect(detached.changed).toBe(true);
    expect(detached.refs).toEqual([{ type: 'user', id: 'ada' }]);
  });

  it('reports no change when the artist is absent', () => {
    const refs = [{ type: 'guest', id: 'sam' }];
    expect(detachArtistRefs(refs, 'guest', 'other')).toEqual({ refs, changed: false });
  });
});

describe('detachArtistFromCredits', () => {
  it('drops a credit row once its only artist is removed', () => {
    const detached = detachArtistFromCredits({
      artist: [
        { roleKey: 'ensemble', artists: [{ type: 'group', id: 'brass' }] },
        { roleKey: 'primary_artist', artists: [{ type: 'user', id: 'ada' }] },
      ],
    }, 'group', 'brass');

    expect(detached.changed).toBe(true);
    expect(detached.credits.artist).toEqual([
      { roleKey: 'primary_artist', artists: [{ type: 'user', id: 'ada' }] },
    ]);
  });
});

describe('detachArtistFromSnapshot', () => {
  it('removes the artist from tracks, folders, and credits', () => {
    const detached = detachArtistFromSnapshot({
      projectName: 'One Day More',
      tracks: [
        { id: 't1', artistRefs: [{ type: 'guest', id: 'sam' }, { type: 'user', id: 'ada' }] },
        { id: 't2', name: 'Piano' },
      ],
      trackTree: [
        { id: 'g1', kind: 'group', artistRefs: [{ type: 'guest', id: 'sam' }] },
      ],
      credits: {
        performers: [
          { partName: 'Trombone', artists: [{ type: 'guest', id: 'sam' }] },
        ],
      },
    }, 'guest', 'sam');

    expect(detached.changed).toBe(true);
    expect(detached.snapshot.projectName).toBe('One Day More');
    expect(detached.snapshot.tracks[0].artistRefs).toEqual([{ type: 'user', id: 'ada' }]);
    expect(detached.snapshot.tracks[1]).toEqual({ id: 't2', name: 'Piano' });
    expect(detached.snapshot.trackTree[0].artistRefs).toEqual([]);
    expect(detached.snapshot.credits.performers).toEqual([]);
  });
});
