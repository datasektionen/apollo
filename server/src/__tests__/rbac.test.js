import { describe, expect, it } from 'vitest';
import {
  RBAC_SCOPE_GROUP_NAME,
  RBAC_SCOPE_PART_NAME,
  RBAC_SCOPE_PROJECT,
  RBAC_SCOPE_SHOW,
  PERMISSION_PROJECT_MANAGER,
  PERMISSION_PROJECT_READER,
  PERMISSION_TRACK_CREATOR,
  PERMISSION_TRACK_READER,
  WRITE_REJECTED_CODE,
  extractProjectAccessTags,
  grantFieldsFromBody,
  isProjectWriteRejectedError,
  resolveProjectAccessFromGrantRows,
  validateAndTransformProjectWrite,
} from '../rbac.js';

describe('extractProjectAccessTags', () => {
  it('collects unique normalized group tags from the track tree', () => {
    const tags = extractProjectAccessTags({
      trackTree: [
        { kind: 'group', name: 'Choir' },
        { kind: 'group', name: ' Choir ' },
        { kind: 'track', name: 'Solo' },
        { kind: 'group', name: 'Band' },
      ],
    });

    expect(tags).toEqual([
      { tagType: 'group_name', tagValue: 'band', displayName: 'Band' },
      { tagType: 'group_name', tagValue: 'choir', displayName: 'Choir' },
    ]);
  });

  it('collects explicit part tags and clears nested part descendants', () => {
    const tags = extractProjectAccessTags({
      trackTree: [
        { id: 'choir', kind: 'group', name: 'Choir', part: true },
        { id: 'soprano', kind: 'group', parentId: 'choir', name: 'Soprano', part: true },
      ],
    });

    expect(tags).toEqual([
      { tagType: 'group_name', tagValue: 'choir', displayName: 'Choir' },
      { tagType: 'group_name', tagValue: 'soprano', displayName: 'Soprano' },
      { tagType: 'part_name', tagValue: 'choir', displayName: 'Choir' },
    ]);
  });
});

describe('resolveProjectAccessFromGrantRows', () => {
  it('lets a project manager override a project reader on the targeted project', () => {
    const grants = [
      {
        permissionKey: PERMISSION_PROJECT_READER,
        scopeType: 'all',
      },
      {
        permissionKey: PERMISSION_PROJECT_MANAGER,
        scopeType: RBAC_SCOPE_PROJECT,
        scopeProjectId: 'project-1',
      },
    ];

    expect(resolveProjectAccessFromGrantRows(grants, 'project-1')).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-2')).toEqual({
      canRead: true,
      canWrite: false,
    });
  });

  it('matches named track scopes for current and future projects by normalized tag name', () => {
    const grants = [
      {
        permissionKey: PERMISSION_TRACK_READER,
        scopeType: RBAC_SCOPE_GROUP_NAME,
        scopeNameValue: 'sopran',
      },
      {
        permissionKey: PERMISSION_TRACK_READER,
        scopeType: RBAC_SCOPE_PART_NAME,
        scopeNameValue: 'alto 1',
      },
    ];

    const matchingProjectTags = {
      [RBAC_SCOPE_GROUP_NAME]: new Set(['sopran']),
      [RBAC_SCOPE_PART_NAME]: new Set(['alto 1']),
    };
    const futureProjectTags = {
      [RBAC_SCOPE_GROUP_NAME]: new Set(['sopran']),
      [RBAC_SCOPE_PART_NAME]: new Set(),
    };
    const unrelatedProjectTags = {
      [RBAC_SCOPE_GROUP_NAME]: new Set(['tenor']),
      [RBAC_SCOPE_PART_NAME]: new Set(['bass 2']),
    };

    expect(resolveProjectAccessFromGrantRows(grants, 'project-now', matchingProjectTags)).toEqual({
      canRead: true,
      canWrite: false,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-future', futureProjectTags)).toEqual({
      canRead: true,
      canWrite: false,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-other', unrelatedProjectTags)).toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it('limits project readers to the targeted show when configured', () => {
    const grants = [
      {
        permissionKey: PERMISSION_PROJECT_READER,
        scopeType: RBAC_SCOPE_SHOW,
        scopeShowId: 'show-a',
      },
    ];

    expect(resolveProjectAccessFromGrantRows(grants, { id: 'project-1', showId: 'show-a' })).toEqual({
      canRead: true,
      canWrite: false,
    });
    expect(resolveProjectAccessFromGrantRows(grants, { id: 'project-2', showId: 'show-b' })).toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it('requires show, group, and part filters to all match for project access', () => {
    const grants = [
      {
        permissionKey: PERMISSION_PROJECT_READER,
        scopeType: RBAC_SCOPE_SHOW,
        scopeShowId: 'show-a',
        scopeGroupNameValue: 'choir',
        scopePartNameValue: 'soprano',
      },
    ];

    expect(resolveProjectAccessFromGrantRows(grants, { id: 'project-1', showId: 'show-a' }, {
      [RBAC_SCOPE_GROUP_NAME]: new Set(['choir']),
      [RBAC_SCOPE_PART_NAME]: new Set(['soprano']),
    })).toEqual({
      canRead: true,
      canWrite: false,
    });
    expect(resolveProjectAccessFromGrantRows(grants, { id: 'project-2', showId: 'show-a' }, {
      [RBAC_SCOPE_GROUP_NAME]: new Set(['choir']),
      [RBAC_SCOPE_PART_NAME]: new Set(['alto']),
    })).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(resolveProjectAccessFromGrantRows(grants, { id: 'project-3', showId: 'show-b' }, {
      [RBAC_SCOPE_GROUP_NAME]: new Set(['choir']),
      [RBAC_SCOPE_PART_NAME]: new Set(['soprano']),
    })).toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it('treats published projects as readable without granting write access', () => {
    expect(resolveProjectAccessFromGrantRows([], { id: 'project-public', published: true })).toEqual({
      canRead: true,
      canWrite: false,
    });
  });
});

describe('validateAndTransformProjectWrite', () => {
  it('stamps created tracks from an inferred group scope when exactly one scope matches', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      trackTree: [
        { id: 'group-1', kind: 'group', name: 'Soprano', order: 0 },
      ],
      tracks: [],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };
    const nextSnapshot = {
      ...currentSnapshot,
      tracks: [
        {
          id: 'track-1',
          name: 'Line 1',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
        },
      ],
      trackTree: [
        { id: 'group-1', kind: 'group', name: 'Soprano', order: 0 },
        { id: 'node-track-1', kind: 'track', trackId: 'track-1', parentId: 'group-1', order: 0 },
      ],
    };

    const transformed = await validateAndTransformProjectWrite({
      userId: 'user-1',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canCreateTracks: true,
        creatableTrackScopes: [{ type: 'group_name', value: 'soprano', label: 'Soprano' }],
      },
      currentSnapshot,
      nextSnapshot,
    });

    expect(transformed.tracks[0]).toMatchObject({
      createdByUserId: 'user-1',
      accessScopeType: 'group_name',
      accessScopeValue: 'soprano',
    });
  });

  it('allows a track creator on a specific track to create subtracks under that track', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [
        {
          id: 'parent-track',
          name: 'Lead',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
          createdByUserId: 'owner-1',
        },
      ],
      trackTree: [
        { id: 'node-parent', kind: 'track', trackId: 'parent-track', order: 0 },
      ],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };
    const nextSnapshot = {
      ...currentSnapshot,
      tracks: [
        ...currentSnapshot.tracks,
        {
          id: 'child-track',
          name: 'Harmony',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
        },
      ],
      trackTree: [
        { id: 'node-parent', kind: 'track', trackId: 'parent-track', order: 0 },
        { id: 'node-child', kind: 'track', trackId: 'child-track', parentId: 'node-parent', order: 0 },
      ],
    };

    const transformed = await validateAndTransformProjectWrite({
      userId: 'user-2',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canCreateTracks: true,
        creatableTrackScopes: [{ type: 'track', trackId: 'parent-track', value: 'parent-track', label: 'Lead' }],
      },
      currentSnapshot,
      nextSnapshot,
    });

    expect(transformed.tracks[1]).toMatchObject({
      createdByUserId: 'user-2',
      accessScopeType: 'track',
      accessScopeValue: 'parent-track',
    });
  });

  it('rejects project manager writes that would remove the only matching filtered access', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [],
      trackTree: [
        { id: 'group-1', kind: 'group', name: 'Choir', order: 0 },
      ],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };
    const nextSnapshot = {
      ...currentSnapshot,
      trackTree: [
        { id: 'group-1', kind: 'group', name: 'Band', order: 0 },
      ],
    };

    await expect(validateAndTransformProjectWrite({
      userId: 'user-3',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canManageProject: true,
        canManageProjectUnconditionally: false,
        projectManagerRetainScopes: [{ type: 'all', groupNameValue: 'choir', label: 'Choir' }],
      },
      currentSnapshot,
      nextSnapshot,
    })).rejects.toThrow('remove your only project manager access');
  });

  it('rejects publish changes from track-level writers', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      published: false,
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [],
      trackTree: [],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };

    await expect(validateAndTransformProjectWrite({
      userId: 'user-4',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canCreateTracks: true,
        creatableTrackScopes: [{ type: 'group_name', value: 'choir', label: 'Choir' }],
      },
      currentSnapshot,
      nextSnapshot: {
        ...currentSnapshot,
        published: true,
      },
    })).rejects.toThrow('Project-level settings require project manager access');
  });

  it('rejects solo changes when the writer cannot edit every track', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      published: false,
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [
        {
          id: 'track-1',
          name: 'Lead',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
          createdByUserId: 'user-4',
        },
        {
          id: 'track-2',
          name: 'Band',
          role: 'instrument',
          icon: 'guitar',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
          createdByUserId: 'owner-1',
        },
      ],
      trackTree: [
        { id: 'node-1', kind: 'track', trackId: 'track-1', order: 0 },
        { id: 'node-2', kind: 'track', trackId: 'track-2', order: 1 },
      ],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };

    await expect(validateAndTransformProjectWrite({
      userId: 'user-4',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canManageTracks: true,
        manageableTrackScopes: [{ type: 'track', trackId: 'track-1', value: 'track-1', label: 'Lead' }],
      },
      currentSnapshot,
      nextSnapshot: {
        ...currentSnapshot,
        tracks: currentSnapshot.tracks.map((track) => (
          track.id === 'track-1' ? { ...track, soloed: true } : track
        )),
      },
    })).rejects.toThrow('Soloing tracks requires permission to edit every track in the project');
  });

  it('allows solo changes when a track manager can edit every track', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      published: false,
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [
        {
          id: 'track-1',
          name: 'Lead',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
          createdByUserId: 'owner-1',
        },
        {
          id: 'track-2',
          name: 'Band',
          role: 'instrument',
          icon: 'guitar',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
          createdByUserId: 'owner-1',
        },
      ],
      trackTree: [
        { id: 'node-1', kind: 'track', trackId: 'track-1', order: 0 },
        { id: 'node-2', kind: 'track', trackId: 'track-2', order: 1 },
      ],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };

    const nextSnapshot = {
      ...currentSnapshot,
      tracks: currentSnapshot.tracks.map((track) => (
        track.id === 'track-1' ? { ...track, soloed: true } : track
      )),
    };

    const transformed = await validateAndTransformProjectWrite({
      userId: 'user-4',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canManageTracks: true,
        manageableTrackScopes: [{ type: RBAC_SCOPE_PROJECT, projectId: 'project-1', label: 'Project' }],
      },
      currentSnapshot,
      nextSnapshot,
    });

    expect(transformed.tracks[0].soloed).toBe(true);
  });

  it('allows track-level writers to submit local-only loop and fold state without project manager access', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      published: false,
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [],
      trackTree: [
        { id: 'group-1', kind: 'group', name: 'Choir', order: 0, collapsed: false },
      ],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };

    const transformed = await validateAndTransformProjectWrite({
      userId: 'user-4',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canCreateTracks: true,
        creatableTrackScopes: [{ type: 'group_name', value: 'choir', label: 'Choir' }],
      },
      currentSnapshot,
      nextSnapshot: {
        ...currentSnapshot,
        loop: { enabled: true, startMs: 1000, endMs: 4000 },
        trackTree: [
          { id: 'group-1', kind: 'group', name: 'Choir', order: 0, collapsed: true },
        ],
      },
    });

    expect(transformed.loop).toEqual({ enabled: true, startMs: 1000, endMs: 4000 });
    expect(transformed.trackTree[0].collapsed).toBe(true);
  });

  it('allows a track artist to create descendant tracks through track-manager scope', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      published: false,
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [
        {
          id: 'track-1',
          name: 'Lead',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
          createdByUserId: 'owner-1',
          artistRefs: [{ type: 'user', id: 'user-5' }],
        },
      ],
      trackTree: [
        { id: 'node-1', kind: 'track', trackId: 'track-1', order: 0 },
      ],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };
    const nextSnapshot = {
      ...currentSnapshot,
      tracks: [
        ...currentSnapshot.tracks,
        {
          id: 'child-track',
          name: 'Harmony',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
        },
      ],
      trackTree: [
        { id: 'node-1', kind: 'track', trackId: 'track-1', order: 0 },
        { id: 'node-child', kind: 'track', trackId: 'child-track', parentId: 'node-1', order: 0 },
      ],
    };

    const transformed = await validateAndTransformProjectWrite({
      userId: 'user-5',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canCreateTracks: true,
        canManageTracks: true,
        creatableTrackScopes: [{
          type: 'track',
          trackId: 'track-1',
          value: 'track-1',
          label: 'Lead',
          source: 'track_artist',
        }],
      },
      currentSnapshot,
      nextSnapshot,
    });

    expect(transformed.tracks[1]).toMatchObject({
      createdByUserId: 'user-5',
      accessScopeType: 'track',
      accessScopeValue: 'track-1',
    });
  });

  it('prevents a track artist from removing themselves when that is their only track manager access', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      published: false,
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [
        {
          id: 'track-1',
          name: 'Lead',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
          createdByUserId: 'owner-1',
          artistRefs: [{ type: 'user', id: 'user-5' }],
        },
      ],
      trackTree: [
        { id: 'node-1', kind: 'track', trackId: 'track-1', order: 0 },
      ],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };

    await expect(validateAndTransformProjectWrite({
      userId: 'user-5',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: {
        canManageTracks: true,
        manageableTrackScopes: [{
          type: 'track',
          trackId: 'track-1',
          value: 'track-1',
          label: 'Lead',
          source: 'track_artist',
        }],
      },
      currentSnapshot,
      nextSnapshot: {
        ...currentSnapshot,
        tracks: currentSnapshot.tracks.map((track) => (
          track.id === 'track-1' ? { ...track, artistRefs: [] } : track
        )),
      },
    })).rejects.toThrow('cannot remove yourself as track artist');
  });

  describe('track-level writers editing an existing editable track', () => {
    const ownTrack = {
      id: 'track-1',
      name: 'Lead',
      role: 'lead',
      icon: 'mic',
      volume: 100,
      pan: 0,
      muted: false,
      soloed: false,
      clips: [{ id: 'clip-1', blobId: 'blob-1', timelineStartMs: 0, cropStartMs: 0, cropEndMs: 1000, gainDb: 0, muted: false }],
      createdByUserId: 'user-5',
    };
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      published: false,
      sampleRate: 44100,
      masterVolume: 100,
      showId: 'show-1',
      tracks: [ownTrack],
      trackTree: [{ id: 'node-1', kind: 'track', trackId: 'track-1', order: 0 }],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };
    const write = (patch) => validateAndTransformProjectWrite({
      userId: 'user-5',
      project: { id: 'project-1', createdByUserId: 'owner-1', showId: 'show-1' },
      access: { canCreateTracks: true, creatableTrackScopes: [{ type: 'all', label: 'All' }] },
      currentSnapshot,
      nextSnapshot: {
        ...currentSnapshot,
        tracks: [{ ...ownTrack, ...patch }],
      },
    });

    it('accepts name, mix and clip edits', async () => {
      await expect(write({ name: 'Lead vocal' })).resolves.toBeTruthy();
      await expect(write({ volume: 80, pan: -20, muted: true })).resolves.toBeTruthy();
      await expect(write({ clips: [{ ...ownTrack.clips[0], timelineStartMs: 500 }] })).resolves.toBeTruthy();
      await expect(write({ clips: [] })).resolves.toBeTruthy();
    });

    it('rejects role and access-stamp changes', async () => {
      await expect(write({ role: 'instrument' })).rejects.toThrow('Track role and scope changes require project manager access');
      // Handing the track to someone else also drops the writer's own access, which trips the scope check first.
      await expect(write({ createdByUserId: 'someone-else' })).rejects.toSatisfy(isProjectWriteRejectedError);
      await expect(write({ accessScopeType: 'group_name', accessScopeValue: 'choir' })).rejects.toThrow('Track role and scope changes require project manager access');
    });

    it('rejects with a typed error carrying the WRITE_REJECTED code', async () => {
      await expect(write({ role: 'instrument' })).rejects.toMatchObject({ code: WRITE_REJECTED_CODE });
      await expect(write({ role: 'instrument' })).rejects.toSatisfy(isProjectWriteRejectedError);
    });
  });
});

describe('grantFieldsFromBody', () => {
  it('keeps group and part filters with the rest of the grant', () => {
    expect(grantFieldsFromBody({
      permissionKey: 'track_manager',
      scopeType: 'show',
      scopeShowId: 'show-1',
      scopeGroupNameValue: 'choir',
      scopePartNameValue: 'soprano',
    })).toMatchObject({
      permissionKey: 'track_manager',
      scopeType: 'show',
      scopeShowId: 'show-1',
      scopeGroupNameValue: 'choir',
      scopePartNameValue: 'soprano',
    });
  });
});
