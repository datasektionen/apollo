import { describe, expect, it } from 'vitest';
import { createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import { applyChoirAutoPanToProject } from '../choirAutoPan';
import { attachTrackNode, createGroupNode, normalizeTrackTree, updateGroupNode } from '../trackTree';
import { GROUP_ROLE_CHOIRS, TRACK_ROLE_LEAD } from '../trackRoles';

function projectWithChoirTracks(pans) {
  const tracks = pans.map((pan, idx) => ({
    ...createTrack(`Choir ${idx + 1}`, TRACK_ROLES.CHOIR),
    pan,
  }));
  let project = {
    ...createEmptyProject('Auto Pan Test'),
    tracks,
    autoPan: {
      enabled: true,
      strategy: 'lowest-highest',
      inverted: false,
      manualChoirParts: false,
      rangeLimit: 100,
      spreadK: 2,
    },
  };
  for (const track of tracks) {
    project = attachTrackNode(project, track.id);
  }
  return { project, tracks };
}

describe('applyChoirAutoPanToProject stored pan', () => {
  it('stores the previous pan while choir auto-pan is applied', () => {
    const { project, tracks } = projectWithChoirTracks([12, -40]);
    const { project: next } = applyChoirAutoPanToProject(project);

    const first = next.tracks.find((track) => track.id === tracks[0].id);
    const second = next.tracks.find((track) => track.id === tracks[1].id);

    expect(first.autoPanStoredPan).toBe(12);
    expect(second.autoPanStoredPan).toBe(-40);
    expect(first.pan).not.toBe(12);
    expect(second.pan).not.toBe(-40);
  });

  it('keeps the original stored pan across later auto-pan updates', () => {
    const { project, tracks } = projectWithChoirTracks([12, -40]);
    const firstPass = applyChoirAutoPanToProject(project).project;
    const inverted = applyChoirAutoPanToProject(firstPass, { inverted: true }).project;
    const first = inverted.tracks.find((track) => track.id === tracks[0].id);

    expect(first.autoPanStoredPan).toBe(12);
    expect(first.pan).toBe(-firstPass.tracks.find((track) => track.id === tracks[0].id).pan);
  });

  it('keeps the latest auto-pan and drops the stored value when auto-pan is turned off', () => {
    const { project, tracks } = projectWithChoirTracks([12, -40]);
    const enabled = applyChoirAutoPanToProject(project).project;
    const autoPanned = enabled.tracks.find((track) => track.id === tracks[0].id).pan;
    const disabled = applyChoirAutoPanToProject(enabled, { enabled: false }).project;
    const first = disabled.tracks.find((track) => track.id === tracks[0].id);

    expect(first.pan).toBe(autoPanned);
    expect(first.autoPanStoredPan).toBeUndefined();
  });

  it('restores the stored pan when a track leaves choir while auto-pan is on', () => {
    const { project, tracks } = projectWithChoirTracks([12, -40]);
    const enabled = applyChoirAutoPanToProject(project).project;
    const leaving = {
      ...enabled,
      tracks: enabled.tracks.map((track) => (
        track.id === tracks[0].id ? { ...track, role: TRACK_ROLE_LEAD } : track
      )),
    };
    const restored = applyChoirAutoPanToProject(leaving).project;
    const first = restored.tracks.find((track) => track.id === tracks[0].id);
    const second = restored.tracks.find((track) => track.id === tracks[1].id);

    expect(first.role).toBe(TRACK_ROLE_LEAD);
    expect(first.pan).toBe(12);
    expect(first.autoPanStoredPan).toBeUndefined();
    expect(second.autoPanStoredPan).toBe(-40);
    expect(second.pan).not.toBe(-40);
  });

  it('stores and restores group pan when a choir group leaves choir', () => {
    let project = createEmptyProject('Group Auto Pan');
    project = {
      ...project,
      autoPan: {
        enabled: true,
        strategy: 'lowest-highest',
        inverted: false,
        manualChoirParts: false,
        rangeLimit: 100,
        spreadK: 2,
      },
    };
    project = createGroupNode(project, 'Sopranos');
    project = createGroupNode(project, 'Altos');
    const groups = project.trackTree.filter((node) => node.kind === 'group');
    project = updateGroupNode(project, groups[0].id, { role: TRACK_ROLES.CHOIR, pan: 18 });
    project = updateGroupNode(project, groups[1].id, { role: TRACK_ROLES.CHOIR, pan: -22 });

    const soprano = createTrack('Soprano', TRACK_ROLES.CHOIR);
    const alto = createTrack('Alto', TRACK_ROLES.CHOIR);
    project = { ...project, tracks: [soprano, alto] };
    project = attachTrackNode(project, soprano.id, groups[0].id);
    project = attachTrackNode(project, alto.id, groups[1].id);

    const enabled = applyChoirAutoPanToProject(project).project;
    const sopranoGroup = enabled.trackTree.find((node) => node.id === groups[0].id);
    expect(sopranoGroup.autoPanStoredPan).toBe(18);
    expect(sopranoGroup.pan).not.toBe(18);

    const leaving = updateGroupNode(enabled, groups[0].id, { role: TRACK_ROLE_LEAD });
    const restored = applyChoirAutoPanToProject(leaving).project;
    const restoredGroup = restored.trackTree.find((node) => node.id === groups[0].id);
    expect(restoredGroup.pan).toBe(18);
    expect(restoredGroup.autoPanStoredPan).toBeUndefined();
  });

  it('preserves stored group pan through track tree normalization', () => {
    let project = createEmptyProject('Normalize');
    project = createGroupNode(project, 'Choirs');
    const groupId = project.trackTree.find((node) => node.kind === 'group').id;
    project = updateGroupNode(project, groupId, { role: GROUP_ROLE_CHOIRS, autoPanStoredPan: 33 });
    const normalized = normalizeTrackTree(project);
    const group = normalized.trackTree.find((node) => node.id === groupId);
    expect(group.autoPanStoredPan).toBe(33);
  });
});
