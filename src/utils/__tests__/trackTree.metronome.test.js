import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import {
  attachTrackNode,
  createGroupNode,
  getTrackNodeByTrackId,
  moveTrackTreeNode,
  normalizeTrackTree,
  syncDirectChildRolesFromGroupCategories,
  TRACK_NODE_TYPE_AUDIO,
  TRACK_NODE_TYPE_GROUP,
} from '../trackTree';

describe('metronome track tree rules', () => {
  it('keeps nested metronome tracks under their parent group', () => {
    const metronome = createTrack('Click', TRACK_ROLES.METRONOME);
    let project = createEmptyProject('Metronome Test');
    project = createGroupNode({ ...project, tracks: [metronome] }, 'Band');
    const groupNode = project.trackTree.find((node) => node.kind === 'group');
    const existingMetronomeNode = getTrackNodeByTrackId(project, metronome.id);

    const normalized = normalizeTrackTree({
      ...project,
      trackTree: (project.trackTree || []).map((node) => (
        node.id === existingMetronomeNode?.id
          ? { ...node, parentId: groupNode.id, order: 0 }
          : node
      )),
    });

    expect(getTrackNodeByTrackId(normalized, metronome.id)?.parentId).toBe(groupNode.id);
  });

  it('attaches metronome tracks under groups', () => {
    const metronome = createTrack('Click', TRACK_ROLES.METRONOME);
    let project = createEmptyProject('Metronome Test');
    project = { ...project, tracks: [metronome] };
    project = createGroupNode(project, 'Band');
    const groupNode = project.trackTree.find((node) => node.kind === 'group');

    const nextProject = attachTrackNode(project, metronome.id, groupNode.id);

    expect(getTrackNodeByTrackId(nextProject, metronome.id)?.parentId).toBe(groupNode.id);
  });

  it('allows moving a metronome track inside a group', () => {
    const metronome = createTrack('Click', TRACK_ROLES.METRONOME);
    const instrument = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    let project = createEmptyProject('Metronome Test');
    project = { ...project, tracks: [metronome, instrument] };
    project = createGroupNode(project, 'Band');
    const groupNode = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, metronome.id);
    project = attachTrackNode(project, instrument.id);

    const metronomeNodeId = getTrackNodeByTrackId(project, metronome.id)?.id;
    const movedProject = moveTrackTreeNode(project, metronomeNodeId, groupNode.id, 'inside');

    expect(getTrackNodeByTrackId(movedProject, metronome.id)?.parentId).toBe(groupNode.id);
  });
});

describe('track tree type and part normalization', () => {
  it('normalizes broad track node types and prevents nested part tracks', () => {
    let project = createEmptyProject('Parts Test');
    project = createGroupNode(project, 'Choir');
    const parentGroup = project.trackTree.find((node) => node.kind === 'group');
    project = createGroupNode(project, 'Soprano', parentGroup.id);
    const childGroup = project.trackTree.find((node) => node.kind === 'group' && node.id !== parentGroup.id);

    const normalized = normalizeTrackTree({
      ...project,
      trackTree: project.trackTree.map((node) => (
        node.id === parentGroup.id || node.id === childGroup.id
          ? { ...node, part: true }
          : node
      )),
    });

    const normalizedParent = normalized.trackTree.find((node) => node.id === parentGroup.id);
    const normalizedChild = normalized.trackTree.find((node) => node.id === childGroup.id);

    expect(normalizedParent).toMatchObject({
      type: TRACK_NODE_TYPE_GROUP,
      part: true,
    });
    expect(normalizedChild).toMatchObject({
      type: TRACK_NODE_TYPE_GROUP,
      part: false,
    });
  });

  it('adds audio type and part defaults to track nodes', () => {
    const audioTrack = createTrack('Solo', TRACK_ROLES.LEAD);
    const normalized = normalizeTrackTree({
      ...createEmptyProject('Audio Type Test'),
      tracks: [audioTrack],
      trackTree: [],
    });

    expect(getTrackNodeByTrackId(normalized, audioTrack.id)).toMatchObject({
      type: TRACK_NODE_TYPE_AUDIO,
      part: false,
    });
  });

  it('keeps descendants on the same type, including Other groups', () => {
    const childTrack = createTrack('Nested child', TRACK_ROLES.LEAD);
    let project = {
      ...createEmptyProject('Other Sync Test'),
      tracks: [childTrack],
    };
    project = createGroupNode(project, 'Other root');
    const parentGroup = project.trackTree.find((node) => node.kind === 'group');
    project = createGroupNode(project, 'Nested group', parentGroup.id);
    const childGroup = project.trackTree.find((node) => node.kind === 'group' && node.id !== parentGroup.id);
    project = attachTrackNode(project, childTrack.id, childGroup.id);

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    let synced;
    try {
      synced = syncDirectChildRolesFromGroupCategories(project);
    } finally {
      debugSpy.mockRestore();
    }
    const syncedChildGroup = synced.trackTree.find((node) => node.id === childGroup.id);
    const syncedChildTrack = synced.tracks.find((track) => track.id === childTrack.id);

    expect(syncedChildGroup.role).toBe(TRACK_ROLES.OTHER);
    expect(syncedChildTrack.role).toBe(TRACK_ROLES.OTHER);
    expect(syncedChildTrack.icon).toBe('mic');
  });
});
