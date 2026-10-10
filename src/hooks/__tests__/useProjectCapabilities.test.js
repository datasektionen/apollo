import { describe, expect, it } from 'vitest';
import {
  PERMISSION_PROJECT_MANAGER,
  PERMISSION_PROJECT_READER,
  PERMISSION_TRACK_CREATOR,
  PERMISSION_TRACK_MANAGER,
  PERMISSION_TRACK_READER,
  RBAC_SCOPE_ALL,
  RBAC_SCOPE_GROUP_NAME,
  RBAC_SCOPE_PROJECT,
  buildProjectAccessSummary,
  isProjectWriteRejectedError,
  validateAndTransformProjectWrite,
} from '../../../server/src/rbac.js';
import { findProjectWriteViolation } from '../../../shared/accessRules.js';
import {
  EDITOR_MODE_ADVANCED_MIX,
  EDITOR_MODE_HOSTED,
  EDITOR_MODE_LOCAL,
  computeProjectCapabilities,
} from '../useProjectCapabilities.js';

const OWNER = 'owner-1';
const USER = 'user-1';
const PROJECT_ROW = { id: 'project-1', createdByUserId: OWNER, showId: 'show-1' };

function makeProject() {
  return {
    projectId: 'project-1',
    projectName: 'Test',
    musicalNumber: '1.1',
    sampleRate: 44100,
    masterVolume: 100,
    showId: 'show-1',
    published: false,
    autoPan: { enabled: false },
    exportSettings: { transformedPanRange: 100 },
    tracks: [
      { id: 'sop', name: 'Soprano', role: 'choir_soprano', volume: 100, pan: 0, muted: false, soloed: false, clips: [], createdByUserId: OWNER },
      { id: 'alto', name: 'Alto', role: 'choir_alto', volume: 100, pan: 0, muted: false, soloed: false, clips: [], createdByUserId: OWNER },
      { id: 'lead', name: 'Lead', role: 'lead', volume: 100, pan: 0, muted: false, soloed: false, clips: [], createdByUserId: OWNER },
      { id: 'mine', name: 'Mine', role: 'other', volume: 100, pan: 0, muted: false, soloed: false, clips: [], createdByUserId: USER },
    ],
    trackTree: [
      { id: 'g-choir', kind: 'group', name: 'Choir', order: 0, parentId: null },
      { id: 'n-sop', kind: 'track', trackId: 'sop', parentId: 'g-choir', order: 0 },
      { id: 'n-alto', kind: 'track', trackId: 'alto', parentId: 'g-choir', order: 1 },
      { id: 'n-lead', kind: 'track', trackId: 'lead', parentId: null, order: 1 },
      { id: 'n-mine', kind: 'track', trackId: 'mine', parentId: null, order: 2 },
    ],
    loop: { enabled: false, startMs: 0, endMs: 0 },
  };
}

function accessFor(grants, { userId = USER, project = makeProject(), isAdmin = false } = {}) {
  // projectTags=null makes the builder derive name-filter matches from the
  // snapshot's track binding info, like the server does for a single project.
  return buildProjectAccessSummary(userId, PROJECT_ROW, grants, null, isAdmin, project);
}

function capsFor(grants, { userId = USER, project = makeProject(), isAdmin = false } = {}) {
  const access = accessFor(grants, { userId, project, isAdmin });
  return {
    access,
    caps: computeProjectCapabilities({
      access,
      project,
      userId,
      projectId: 'project-1',
      showId: 'show-1',
      projectCreatedByUserId: OWNER,
      mode: EDITOR_MODE_HOSTED,
    }),
  };
}

async function serverAccepts({ grants, userId = USER, mutate }) {
  const current = makeProject();
  const next = mutate(JSON.parse(JSON.stringify(current)));
  const access = accessFor(grants, { userId, project: current });
  try {
    await validateAndTransformProjectWrite({
      userId,
      project: PROJECT_ROW,
      access,
      currentSnapshot: current,
      nextSnapshot: next,
    });
    return true;
  } catch (error) {
    if (isProjectWriteRejectedError(error)) return false;
    throw error;
  }
}

const READER_GRANTS = [{ permissionKey: PERMISSION_PROJECT_READER, scopeType: RBAC_SCOPE_PROJECT, scopeProjectId: 'project-1' }];
const TRACK_READER_GRANTS = [{ permissionKey: PERMISSION_TRACK_READER, scopeType: RBAC_SCOPE_PROJECT, scopeProjectId: 'project-1' }];
const CHOIR_CREATOR_GRANTS = [{ permissionKey: PERMISSION_TRACK_CREATOR, scopeType: RBAC_SCOPE_GROUP_NAME, scopeNameValue: 'choir', scopeLabel: 'Choir' }];
const ALL_CREATOR_GRANTS = [{ permissionKey: PERMISSION_TRACK_CREATOR, scopeType: RBAC_SCOPE_ALL }];
const CHOIR_MANAGER_GRANTS = [{ permissionKey: PERMISSION_TRACK_MANAGER, scopeType: RBAC_SCOPE_GROUP_NAME, scopeNameValue: 'choir', scopeLabel: 'Choir' }];
const PROJECT_MANAGER_GRANTS = [{ permissionKey: PERMISSION_PROJECT_MANAGER, scopeType: RBAC_SCOPE_PROJECT, scopeProjectId: 'project-1' }];

describe('computeProjectCapabilities modes', () => {
  it('is permissive outside hosted mode and when no access summary is available', () => {
    const permissive = computeProjectCapabilities({ access: null, project: makeProject(), userId: USER, mode: EDITOR_MODE_LOCAL });
    expect(permissive.hasAccessInfo).toBe(false);
    expect(permissive.canExport).toBe(true);
    expect(permissive.canEditTrack('sop')).toBe(true);

    const advanced = computeProjectCapabilities({ access: { canManageProject: false }, project: makeProject(), userId: USER, mode: EDITOR_MODE_ADVANCED_MIX });
    expect(advanced.canEditProjectSettings).toBe(true);

    const hostedNoAccess = computeProjectCapabilities({ access: null, project: makeProject(), userId: USER, mode: EDITOR_MODE_HOSTED });
    expect(hostedNoAccess.hasAccessInfo).toBe(false);
    expect(hostedNoAccess.isReadOnly).toBe(false);
  });
});

describe('computeProjectCapabilities permission matrix', () => {
  it('project_reader: read only, no export', () => {
    const { caps } = capsFor(READER_GRANTS, { userId: 'user-9' });
    expect(caps.hasAccessInfo).toBe(true);
    expect(caps.isReadOnly).toBe(true);
    expect(caps.canExport).toBe(false);
    expect(caps.canEditProjectSettings).toBe(false);
    expect(caps.canManageGroups).toBe(false);
    expect(caps.canCreateTracks).toBe(false);
    expect(caps.canSolo).toBe(false);
    expect(caps.canEditAnyTrack).toBe(false);
    expect(caps.canEditTrack('sop')).toBe(false);
    expect(caps.canRecordTo('sop')).toBe(false);
  });

  it('track_reader: can open and create mixes but not change anything', () => {
    const { caps } = capsFor(TRACK_READER_GRANTS, { userId: 'user-9' });
    expect(caps.isReadOnly).toBe(true);
    expect(caps.canExport).toBe(false);
    expect(caps.canEditTrack('lead')).toBe(false);
    expect(caps.canCreateTracks).toBe(false);
  });

  it('track_creator scoped to a group: can create inside the group and edit own tracks only', () => {
    const { caps } = capsFor(CHOIR_CREATOR_GRANTS);
    expect(caps.isReadOnly).toBe(false);
    expect(caps.canExport).toBe(false);
    expect(caps.canEditProjectSettings).toBe(false);
    expect(caps.canManageGroups).toBe(false);
    expect(caps.canChangeTrackRoles).toBe(false);
    expect(caps.canSolo).toBe(false);

    expect(caps.canCreateTracks).toBe(true);
    expect(caps.canCreateTracksAtRoot).toBe(false);
    expect(caps.canCreateTrackUnder(null)).toBe(false);
    expect(caps.canCreateTrackUnder('g-choir')).toBe(true);
    expect(caps.creatableScopeLabels).toEqual(['Choir']);

    expect(caps.canEditTrack('mine')).toBe(true);
    expect(caps.canEditTrack('sop')).toBe(false);
    expect(caps.canEditTrack('lead')).toBe(false);
    // A track just created locally (not in the snapshot yet) is editable.
    expect(caps.canEditTrack('brand-new-local-track')).toBe(true);
  });

  it('track_creator on all projects: can create at root', () => {
    const { caps } = capsFor(ALL_CREATOR_GRANTS);
    expect(caps.canCreateTracksAtRoot).toBe(true);
    expect(caps.canCreateTrackUnder('g-choir')).toBe(true);
    expect(caps.canEditTrack('sop')).toBe(false);
    expect(caps.canEditTrack('mine')).toBe(true);
  });

  it('track_manager scoped to a group: edits every track in the group, nothing project-level', () => {
    const { caps } = capsFor(CHOIR_MANAGER_GRANTS, { userId: 'user-9' });
    expect(caps.canEditTrack('sop')).toBe(true);
    expect(caps.canEditTrack('alto')).toBe(true);
    expect(caps.canEditTrack('lead')).toBe(false);
    expect(caps.canEditAnyTrack).toBe(true);
    expect(caps.canSolo).toBe(false);
    expect(caps.canExport).toBe(false);
    expect(caps.canManageGroups).toBe(false);
    expect(caps.canCreateTrackUnder('g-choir')).toBe(true);
    expect(caps.canCreateTrackUnder(null)).toBe(false);
  });

  it('project_manager: everything incl. export, settings, groups, solo', () => {
    const { caps } = capsFor(PROJECT_MANAGER_GRANTS, { userId: 'user-9' });
    expect(caps.isReadOnly).toBe(false);
    expect(caps.canExport).toBe(true);
    expect(caps.canEditProjectSettings).toBe(true);
    expect(caps.canManageGroups).toBe(true);
    expect(caps.canChangeTrackRoles).toBe(true);
    expect(caps.canSolo).toBe(true);
    expect(caps.canCreateTracksAtRoot).toBe(true);
    expect(caps.canEditTrack('lead')).toBe(true);
  });

  it('project owner and admin behave like project managers', () => {
    const owner = capsFor([], { userId: OWNER }).caps;
    expect(owner.canExport).toBe(true);
    expect(owner.canEditTrack('mine')).toBe(true);

    const admin = capsFor([], { userId: 'admin-1', isAdmin: true }).caps;
    expect(admin.canExport).toBe(true);
    expect(admin.canSolo).toBe(true);
  });

  it('server canExportProject flag agrees with the client capability', () => {
    for (const [grants, userId] of [
      [READER_GRANTS, 'user-9'],
      [CHOIR_CREATOR_GRANTS, USER],
      [CHOIR_MANAGER_GRANTS, 'user-9'],
      [PROJECT_MANAGER_GRANTS, 'user-9'],
      [[], OWNER],
    ]) {
      const { access, caps } = capsFor(grants, { userId });
      expect(caps.canExport).toBe(Boolean(access.canExportProject));
    }
  });
});

describe('client capabilities agree with server write validation', () => {
  const renameTrack = (trackId) => (snapshot) => {
    snapshot.tracks = snapshot.tracks.map((track) => (track.id === trackId ? { ...track, name: `${track.name} edited` } : track));
    return snapshot;
  };
  const changeMasterVolume = (snapshot) => ({ ...snapshot, masterVolume: 50 });
  const changeExportSettings = (snapshot) => ({ ...snapshot, exportSettings: { ...snapshot.exportSettings, transformedPanRange: 30 } });
  const renameGroup = (snapshot) => {
    snapshot.trackTree = snapshot.trackTree.map((node) => (node.id === 'g-choir' ? { ...node, name: 'Chorus' } : node));
    return snapshot;
  };
  const soloTrack = (trackId) => (snapshot) => {
    snapshot.tracks = snapshot.tracks.map((track) => (track.id === trackId ? { ...track, soloed: true } : track));
    return snapshot;
  };
  const changeRole = (trackId) => (snapshot) => {
    snapshot.tracks = snapshot.tracks.map((track) => (track.id === trackId ? { ...track, role: 'instrument' } : track));
    return snapshot;
  };

  const cases = [
    ['choir creator', CHOIR_CREATOR_GRANTS, USER],
    ['choir manager', CHOIR_MANAGER_GRANTS, 'user-9'],
    ['project manager', PROJECT_MANAGER_GRANTS, 'user-9'],
    ['all-projects creator', ALL_CREATOR_GRANTS, USER],
  ];

  it.each(cases)('%s: per-track edits', async (_label, grants, userId) => {
    const { caps } = capsFor(grants, { userId });
    for (const trackId of ['sop', 'alto', 'lead', 'mine']) {
      const accepted = await serverAccepts({ grants, userId, mutate: renameTrack(trackId) });
      expect(accepted, `rename ${trackId}`).toBe(caps.canEditTrack(trackId));
    }
  });

  it.each(cases)('%s: project-level edits', async (_label, grants, userId) => {
    const { caps } = capsFor(grants, { userId });
    expect(await serverAccepts({ grants, userId, mutate: changeMasterVolume })).toBe(caps.canEditProjectSettings);
    expect(await serverAccepts({ grants, userId, mutate: changeExportSettings })).toBe(caps.canEditProjectSettings);
    expect(await serverAccepts({ grants, userId, mutate: renameGroup })).toBe(caps.canManageGroups);
  });

  it.each(cases)('%s: solo and role changes', async (_label, grants, userId) => {
    const { caps } = capsFor(grants, { userId });
    const editable = ['sop', 'alto', 'lead', 'mine'].filter((trackId) => caps.canEditTrack(trackId));
    if (editable.length) {
      const target = editable[0];
      expect(await serverAccepts({ grants, userId, mutate: soloTrack(target) }), 'solo').toBe(caps.canSolo);
      expect(await serverAccepts({ grants, userId, mutate: changeRole(target) }), 'role').toBe(caps.canChangeTrackRoles);
    }
  });

  describe('findProjectWriteViolation mirrors the server verdict', () => {
    const deleteTrack = (trackId) => (snapshot) => {
      snapshot.tracks = snapshot.tracks.filter((track) => track.id !== trackId);
      snapshot.trackTree = snapshot.trackTree.filter((node) => node.trackId !== trackId);
      return snapshot;
    };
    const addRootTrack = (snapshot) => {
      snapshot.tracks.push({ id: 'new-root', name: 'New', role: 'other', clips: [], createdByUserId: USER });
      snapshot.trackTree.push({ id: 'n-new-root', kind: 'track', trackId: 'new-root', parentId: null, order: 9 });
      return snapshot;
    };
    const addChoirTrack = (snapshot) => {
      snapshot.tracks.push({ id: 'new-choir', name: 'Tenor', role: 'choir_tenor', clips: [], createdByUserId: USER });
      snapshot.trackTree.push({ id: 'n-new-choir', kind: 'track', trackId: 'new-choir', parentId: 'g-choir', order: 9 });
      return snapshot;
    };
    const moveTrackOutOfChoir = (snapshot) => {
      snapshot.trackTree = snapshot.trackTree.map((node) => (node.id === 'n-sop' ? { ...node, parentId: null, order: 5 } : node));
      return snapshot;
    };
    const muteGroup = (snapshot) => {
      snapshot.trackTree = snapshot.trackTree.map((node) => (node.id === 'g-choir' ? { ...node, muted: true } : node));
      return snapshot;
    };
    const collapseGroup = (snapshot) => {
      snapshot.trackTree = snapshot.trackTree.map((node) => (node.id === 'g-choir' ? { ...node, collapsed: true } : node));
      return snapshot;
    };
    const changeLoop = (snapshot) => ({ ...snapshot, loop: { enabled: true, startMs: 0, endMs: 1000 } });

    const mutations = [
      ['rename sop', renameTrack('sop')],
      ['rename mine', renameTrack('mine')],
      ['rename lead', renameTrack('lead')],
      ['delete sop', deleteTrack('sop')],
      ['delete mine', deleteTrack('mine')],
      ['add root track', addRootTrack],
      ['add choir track', addChoirTrack],
      ['move sop out of choir', moveTrackOutOfChoir],
      ['master volume', changeMasterVolume],
      ['export settings', changeExportSettings],
      ['rename group', renameGroup],
      ['mute group', muteGroup],
      ['collapse group', collapseGroup],
      ['loop', changeLoop],
      ['solo mine', soloTrack('mine')],
      ['solo sop', soloTrack('sop')],
      ['role mine', changeRole('mine')],
      ['role sop', changeRole('sop')],
    ];

    const allCases = [...cases, ['reader', READER_GRANTS, 'user-9'], ['owner', [], OWNER]];

    it.each(allCases)('%s', async (_label, grants, userId) => {
      const current = makeProject();
      const access = accessFor(grants, { userId, project: current });
      for (const [name, mutate] of mutations) {
        const next = mutate(JSON.parse(JSON.stringify(current)));
        const violation = findProjectWriteViolation({
          access,
          currentSnapshot: current,
          nextSnapshot: next,
          userId,
          project: { id: 'project-1', showId: 'show-1' },
          projectCreatedByUserId: OWNER,
        });
        const accepted = await serverAccepts({ grants, userId, mutate });
        expect(violation === null, `${name}: client says ${violation || 'ok'}, server ${accepted ? 'accepted' : 'rejected'}`).toBe(accepted);
      }
    });
  });

  it('reader: every write is rejected', async () => {
    const userId = 'user-9';
    expect(await serverAccepts({ grants: READER_GRANTS, userId, mutate: renameTrack('lead') })).toBe(false);
    expect(await serverAccepts({ grants: READER_GRANTS, userId, mutate: changeMasterVolume })).toBe(false);
  });
});
