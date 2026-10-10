import { describe, expect, it } from 'vitest';
import {
  ProjectWriteRejectedError,
  WRITE_REJECTED_CODE,
  applyTrackAccessStamps,
  canCreateTrackInProject,
  canChangeTrackRoles,
  canEditAllTracksInSnapshot,
  canEditProjectSettings,
  canExportProject,
  canManageGroups,
  collectTrackAccessStamps,
  collectTrackBindingInfo,
  hasTrackLevelWrite,
  isProjectWriteRejectedError,
  projectLevelWriteEnabled,
  trackAccessStampsDiffer,
  trackIsEditable,
} from '../accessRules.js';

const PROJECT = { id: 'project-1', showId: 'show-1' };

function snapshotWithChoir() {
  return {
    projectId: 'project-1',
    showId: 'show-1',
    tracks: [
      { id: 'sop', name: 'Soprano', role: 'choir_soprano', clips: [] },
      { id: 'lead', name: 'Lead', role: 'lead', clips: [], createdByUserId: 'owner-1' },
      { id: 'mine', name: 'Mine', role: 'other', clips: [], createdByUserId: 'user-1' },
    ],
    trackTree: [
      { id: 'g-choir', kind: 'group', name: 'Choir', order: 0 },
      { id: 'n-sop', kind: 'track', trackId: 'sop', parentId: 'g-choir', order: 0 },
      { id: 'n-lead', kind: 'track', trackId: 'lead', order: 1 },
      { id: 'n-mine', kind: 'track', trackId: 'mine', order: 2 },
    ],
  };
}

describe('ProjectWriteRejectedError', () => {
  it('carries a stable code that the client can match on', () => {
    const error = new ProjectWriteRejectedError('nope');
    expect(error.code).toBe(WRITE_REJECTED_CODE);
    expect(error.message).toBe('nope');
    expect(isProjectWriteRejectedError(error)).toBe(true);
    expect(isProjectWriteRejectedError(new Error('nope'))).toBe(false);
    expect(isProjectWriteRejectedError({ code: WRITE_REJECTED_CODE })).toBe(true);
  });
});

describe('project-level predicates', () => {
  it('derive export, settings, group and role rights from canManageProject', () => {
    const manager = { canManageProject: true };
    const trackWriter = { canManageProject: false, canCreateTracks: true };
    expect(projectLevelWriteEnabled(manager)).toBe(true);
    expect(canExportProject(manager)).toBe(true);
    expect(canEditProjectSettings(manager)).toBe(true);
    expect(canManageGroups(manager)).toBe(true);
    expect(canChangeTrackRoles(manager)).toBe(true);

    expect(projectLevelWriteEnabled(trackWriter)).toBe(false);
    expect(canExportProject(trackWriter)).toBe(false);
    expect(canEditProjectSettings(trackWriter)).toBe(false);
    expect(canManageGroups(trackWriter)).toBe(false);
    expect(canChangeTrackRoles(trackWriter)).toBe(false);
    expect(canExportProject(null)).toBe(false);
  });

  it('hasTrackLevelWrite mirrors the server canWriteProjectTracks gate', () => {
    expect(hasTrackLevelWrite({ canSeeProject: true, canOpenProject: true })).toBe(false);
    expect(hasTrackLevelWrite({ canCreateTracks: true })).toBe(true);
    expect(hasTrackLevelWrite({ canManageTracks: true })).toBe(true);
    expect(hasTrackLevelWrite({ canManageProject: true })).toBe(true);
  });
});

describe('trackIsEditable', () => {
  const snapshot = snapshotWithChoir();
  const info = collectTrackBindingInfo(snapshot);

  it('lets a project manager edit everything', () => {
    const access = { canManageProject: true, canManageProjectUnconditionally: true };
    expect(trackIsEditable(info.get('sop'), access, 'user-1', PROJECT, 'owner-1')).toBe(true);
    expect(trackIsEditable(info.get('lead'), access, 'user-1', PROJECT, 'owner-1')).toBe(true);
  });

  it('lets a track creator edit only tracks they created', () => {
    const access = {
      canCreateTracks: true,
      creatableTrackScopes: [{ type: 'group_name', value: 'choir', label: 'Choir' }],
      manageableTrackScopes: [],
    };
    expect(trackIsEditable(info.get('mine'), access, 'user-1', PROJECT, 'owner-1')).toBe(true);
    expect(trackIsEditable(info.get('sop'), access, 'user-1', PROJECT, 'owner-1')).toBe(false);
    expect(trackIsEditable(info.get('lead'), access, 'user-1', PROJECT, 'owner-1')).toBe(false);
  });

  it('lets a track manager edit tracks inside the granted group name', () => {
    const access = {
      canCreateTracks: true,
      canManageTracks: true,
      manageableTrackScopes: [{ type: 'group_name', value: 'choir', label: 'Choir' }],
    };
    expect(trackIsEditable(info.get('sop'), access, 'user-9', PROJECT, 'owner-1')).toBe(true);
    expect(trackIsEditable(info.get('lead'), access, 'user-9', PROJECT, 'owner-1')).toBe(false);
  });

  it('gives a reader nothing except tracks they own', () => {
    const access = { canSeeProject: true, canOpenProject: true };
    expect(trackIsEditable(info.get('sop'), access, 'user-9', PROJECT, 'owner-1')).toBe(false);
    expect(trackIsEditable(info.get('lead'), access, 'user-9', PROJECT, 'owner-1')).toBe(false);
    // Ownership is honoured regardless of grants (matches the server rule).
    expect(trackIsEditable(info.get('mine'), access, 'user-1', PROJECT, 'owner-1')).toBe(true);
  });
});

describe('canEditAllTracksInSnapshot / canCreateTrackInProject', () => {
  it('solo rule requires every track to be editable', () => {
    const snapshot = snapshotWithChoir();
    const scoped = {
      canCreateTracks: true,
      canManageTracks: true,
      manageableTrackScopes: [{ type: 'group_name', value: 'choir', label: 'Choir' }],
    };
    expect(canEditAllTracksInSnapshot({ snapshot, access: scoped, userId: 'user-9', project: PROJECT, projectCreatedByUserId: 'owner-1' })).toBe(false);
    expect(canEditAllTracksInSnapshot({ snapshot, access: { canManageProject: true, canManageProjectUnconditionally: true }, userId: 'user-9', project: PROJECT, projectCreatedByUserId: 'owner-1' })).toBe(true);
  });

  it('track creation needs canCreateTracks plus a scope matching the placement', () => {
    const snapshot = snapshotWithChoir();
    const info = collectTrackBindingInfo(snapshot);
    const choirCreator = {
      canCreateTracks: true,
      creatableTrackScopes: [{ type: 'group_name', value: 'choir', label: 'Choir' }],
    };
    expect(canCreateTrackInProject({ canCreateTracks: false }, PROJECT, null)).toBe(false);
    expect(canCreateTrackInProject({ canManageProject: true, canCreateTracks: true }, PROJECT, null)).toBe(true);
    expect(canCreateTrackInProject({ canCreateTracks: true, creatableTrackScopes: [{ type: 'all', label: 'All' }] }, PROJECT, null)).toBe(true);
    // A group-scoped creator cannot create at the root, but can inside the group.
    expect(canCreateTrackInProject(choirCreator, PROJECT, null)).toBe(false);
    expect(canCreateTrackInProject(choirCreator, PROJECT, info.get('sop'))).toBe(true);
    expect(canCreateTrackInProject(choirCreator, PROJECT, info.get('lead'))).toBe(false);
  });
});

describe('track access stamps', () => {
  it('collects, compares and applies ownership stamps without touching other fields', () => {
    const before = snapshotWithChoir();
    const after = {
      ...before,
      tracks: before.tracks.map((track) => (
        track.id === 'sop'
          ? { ...track, createdByUserId: 'user-7', accessScopeType: 'group_name', accessScopeValue: 'choir' }
          : track
      )),
    };
    const stampsBefore = collectTrackAccessStamps(before);
    const stampsAfter = collectTrackAccessStamps(after);
    expect(trackAccessStampsDiffer(before, after)).toBe(true);
    expect(trackAccessStampsDiffer(before, before)).toBe(false);
    expect(stampsAfter.sop).toMatchObject({ createdByUserId: 'user-7', accessScopeType: 'group_name', accessScopeValue: 'choir' });

    const localCopy = { ...before, tracks: before.tracks.map((track) => ({ ...track, name: `${track.name}!` })) };
    const stamped = applyTrackAccessStamps(localCopy, stampsAfter);
    expect(stamped).not.toBe(localCopy);
    expect(stamped.tracks.find((track) => track.id === 'sop')).toMatchObject({
      name: 'Soprano!',
      createdByUserId: 'user-7',
      accessScopeType: 'group_name',
      accessScopeValue: 'choir',
    });
    // Applying identical stamps is a no-op (same reference) so it never triggers a resend loop.
    expect(applyTrackAccessStamps(stamped, stampsAfter)).toBe(stamped);
    expect(applyTrackAccessStamps(before, stampsBefore)).toBe(before);
  });
});
