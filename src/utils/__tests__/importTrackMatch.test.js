import { describe, expect, it } from 'vitest';
import { createClip, createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import { attachTrackNode, createGroupNode, getTrackNodeByTrackId, updateGroupNode } from '../trackTree';
import { GROUP_ROLE_CHOIRS } from '../trackRoles';
import {
  IMPORT_DESTINATION_MODES,
  IMPORT_DROP_TYPES,
  IMPORT_PARENT_NONE,
  IMPORT_PLACEMENT_APPEND,
  IMPORT_PLACEMENT_NEW_CHILD,
  IMPORT_PLACEMENT_NEW_TRACK,
  IMPORT_PLACEMENT_REPLACE,
  applyImportAssignments,
  applyImportParentKey,
  applyImportPlacement,
  assignImportDrop,
  indentImportDestination,
  outdentImportDestination,
  resolveImportDropPlacement,
  toggleImportReplaceMode,
  buildImportPreviewRows,
  destinationReplacesAudio,
  getImportAncestorPath,
  getImportParentKey,
  getImportPlacementValue,
  guessImportDestinations,
  importNamesStrictlyMatch,
  listImportTree,
} from '../importTrackMatch';

function projectWithTracks(tracks, attach = (project) => project) {
  let project = { ...createEmptyProject('Import Test'), tracks };
  for (const track of tracks) {
    project = attachTrackNode(project, track.id);
  }
  return attach(project);
}

describe('importNamesStrictlyMatch', () => {
  it('treats underscore, hyphen, and space as the same character and ignores case', () => {
    expect(importNamesStrictlyMatch('Lead Vocal', 'lead_vocal.wav')).toBe(true);
    expect(importNamesStrictlyMatch('Lead Vocal', 'LEAD-VOCAL.flac')).toBe(true);
    expect(importNamesStrictlyMatch('Lead Vocal', 'lead vocal.mp3')).toBe(true);
  });

  it('matches a track name that is an exact token sequence inside the file name', () => {
    expect(importNamesStrictlyMatch('Soprano', 'choir_soprano_dry.wav')).toBe(true);
    expect(importNamesStrictlyMatch('Lead Vocal', '01_lead_vocal_take2.wav')).toBe(true);
  });

  it('does not fuzzy-match partial tokens', () => {
    expect(importNamesStrictlyMatch('Sop', 'soprano.wav')).toBe(false);
    expect(importNamesStrictlyMatch('alto', 'contralto.wav')).toBe(false);
    expect(importNamesStrictlyMatch('Lead Vocal', 'vocal_lead.wav')).toBe(false);
  });
});

describe('guessImportDestinations', () => {
  it('puts unmatched files on a new root track', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    const project = projectWithTracks([piano]);
    const [destination] = guessImportDestinations(['drums.wav'], project);
    expect(destination).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_ROOT,
      role: TRACK_ROLES.INSTRUMENT,
    });
  });

  it('assigns a unique leaf match even when that track already has clips', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old', 0, 1000));
    const project = projectWithTracks([piano]);
    const [destination] = guessImportDestinations(['piano_take2.wav'], project);
    expect(destination.mode).toBe(IMPORT_DESTINATION_MODES.EXISTING);
    expect(destination.trackId).toBe(piano.id);
    expect(destinationReplacesAudio(destination, project)).toBe(true);
  });

  it('prefers empty child tracks when a group name matches', () => {
    const empty = createTrack('Soprano', TRACK_ROLES.CHOIR);
    const filled = createTrack('Alto', TRACK_ROLES.CHOIR);
    filled.clips.push(createClip('old', 0, 1000));
    let project = { ...createEmptyProject('Choir'), tracks: [empty, filled] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, filled.id, choir.id);
    project = attachTrackNode(project, empty.id, choir.id);

    const [destination] = guessImportDestinations(['choir_mix.wav'], project);
    expect(destination).toEqual({
      mode: IMPORT_DESTINATION_MODES.EXISTING,
      trackId: empty.id,
      role: TRACK_ROLES.CHOIR,
    });
  });

  it('falls back to the first valid child when a group has no empty tracks', () => {
    const first = createTrack('Soprano', TRACK_ROLES.CHOIR);
    const second = createTrack('Alto', TRACK_ROLES.CHOIR);
    first.clips.push(createClip('a', 0, 1000));
    second.clips.push(createClip('b', 0, 1000));
    let project = { ...createEmptyProject('Choir'), tracks: [first, second] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, first.id, choir.id);
    project = attachTrackNode(project, second.id, choir.id);

    const [destination] = guessImportDestinations(['CHOIR.wav'], project);
    expect(destination.trackId).toBe(first.id);
    expect(destinationReplacesAudio(destination, project)).toBe(true);
  });

  it('prefers empty tracks when multiple leaf names match', () => {
    const empty = createTrack('Vocal', TRACK_ROLES.LEAD);
    const filled = createTrack('Lead Vocal', TRACK_ROLES.LEAD);
    filled.clips.push(createClip('old', 0, 1000));
    const project = projectWithTracks([filled, empty]);

    const [destination] = guessImportDestinations(['lead_vocal_wet.wav'], project);
    expect(destination.trackId).toBe(empty.id);
    expect(destinationReplacesAudio(destination, project)).toBe(false);
  });

  it('spreads multiple files across empty group children in tree order', () => {
    const soprano = createTrack('Soprano', TRACK_ROLES.CHOIR);
    const alto = createTrack('Alto', TRACK_ROLES.CHOIR);
    let project = { ...createEmptyProject('Choir'), tracks: [soprano, alto] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, soprano.id, choir.id);
    project = attachTrackNode(project, alto.id, choir.id);

    const destinations = guessImportDestinations(['choir_a.wav', 'choir_b.wav'], project);
    expect(destinations.map((destination) => destination.trackId)).toEqual([soprano.id, alto.id]);
  });

  it('appends extra unique leaf matches onto the claimed track', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    const project = projectWithTracks([piano]);
    const destinations = guessImportDestinations(['piano_a.wav', 'piano_b.wav'], project);
    expect(destinations[0]).toEqual({
      mode: IMPORT_DESTINATION_MODES.EXISTING,
      trackId: piano.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
    expect(destinations[1]).toEqual({
      mode: IMPORT_DESTINATION_MODES.APPEND,
      trackId: piano.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
  });

  it('creates a child track when a matching group has no leftover tracks', () => {
    let project = createEmptyProject('Empty group');
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');

    const [destination] = guessImportDestinations(['choir.wav'], project);
    expect(destination).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: choir.id,
      role: TRACK_ROLES.OTHER,
    });
  });
});

describe('applyImportAssignments', () => {
  it('adds a clip to an empty existing track', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    const project = projectWithTracks([piano]);
    const next = applyImportAssignments(project, [{
      name: 'Piano',
      blobId: 'blob-1',
      durationMs: 2000,
      destination: { mode: IMPORT_DESTINATION_MODES.EXISTING, trackId: piano.id },
    }]);
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[0].clips[0].blobId).toBe('blob-1');
  });

  it('overwrites clips on an occupied track from time zero', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old-a', 1500, 1000), createClip('old-b', 4000, 1000));
    const project = projectWithTracks([piano]);
    const next = applyImportAssignments(project, [{
      name: 'Piano',
      blobId: 'blob-new',
      durationMs: 3000,
      destination: { mode: IMPORT_DESTINATION_MODES.EXISTING, trackId: piano.id },
    }]);
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[0].clips[0].blobId).toBe('blob-new');
    expect(next.tracks[0].clips[0].timelineStartMs).toBe(0);
  });

  it('appends a clip after the end of the last existing clip', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old-a', 0, 1000), createClip('old-b', 2500, 500));
    const project = projectWithTracks([piano]);
    const next = applyImportAssignments(project, [{
      name: 'Piano',
      blobId: 'blob-append',
      durationMs: 800,
      destination: { mode: IMPORT_DESTINATION_MODES.APPEND, trackId: piano.id },
    }]);
    expect(next.tracks[0].clips).toHaveLength(3);
    const appended = next.tracks[0].clips[2];
    expect(appended.blobId).toBe('blob-append');
    expect(appended.timelineStartMs).toBe(3000);
  });

  it('wipes old audio once then chains multiple overwrite files in visual order', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old-a', 0, 1000), createClip('old-b', 2500, 500));
    const project = projectWithTracks([piano]);
    const next = applyImportAssignments(project, [
      {
        name: 'Take A',
        blobId: 'blob-a',
        durationMs: 800,
        destination: { mode: IMPORT_DESTINATION_MODES.EXISTING, trackId: piano.id },
      },
      {
        name: 'Take B',
        blobId: 'blob-b',
        durationMs: 400,
        destination: { mode: IMPORT_DESTINATION_MODES.EXISTING, trackId: piano.id },
      },
    ]);
    expect(next.tracks[0].clips.map((clip) => ({
      blobId: clip.blobId,
      timelineStartMs: clip.timelineStartMs,
    }))).toEqual([
      { blobId: 'blob-a', timelineStartMs: 0 },
      { blobId: 'blob-b', timelineStartMs: 800 },
    ]);
  });

  it('creates a new root track, a sibling, and a new child under a group', () => {
    const alto = createTrack('Alto', TRACK_ROLES.CHOIR);
    let project = { ...createEmptyProject('Mixed'), tracks: [alto] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, alto.id, choir.id);

    const next = applyImportAssignments(project, [
      {
        name: 'Piano',
        blobId: 'blob-root',
        durationMs: 1000,
        destination: { mode: IMPORT_DESTINATION_MODES.NEW_ROOT, role: TRACK_ROLES.INSTRUMENT },
      },
      {
        name: 'Soprano',
        blobId: 'blob-child',
        durationMs: 1000,
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
          parentGroupId: choir.id,
          role: TRACK_ROLES.CHOIR,
        },
      },
      {
        name: 'Alto 2',
        blobId: 'blob-sibling',
        durationMs: 1000,
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
          trackId: alto.id,
          role: TRACK_ROLES.CHOIR,
        },
      },
    ]);

    const piano = next.tracks.find((track) => track.name === 'Piano');
    const soprano = next.tracks.find((track) => track.name === 'Soprano');
    const altoTwo = next.tracks.find((track) => track.name === 'Alto 2');
    expect(piano?.role).toBe(TRACK_ROLES.INSTRUMENT);
    expect(getTrackNodeByTrackId(next, piano.id)?.parentId).toBeNull();
    expect(getTrackNodeByTrackId(next, soprano.id)?.parentId).toBe(choir.id);
    expect(getTrackNodeByTrackId(next, altoTwo.id)?.parentId).toBe(choir.id);
    expect(getTrackNodeByTrackId(next, altoTwo.id)?.order).toBe(
      getTrackNodeByTrackId(next, alto.id).order + 1,
    );
  });

  it('creates a sibling after a group and a child under a track', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old', 0, 1000));
    let project = { ...createEmptyProject('Wrap'), tracks: [piano] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, piano.id);

    const next = applyImportAssignments(project, [
      {
        name: 'Extra Choir',
        blobId: 'blob-group-sib',
        durationMs: 1000,
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
          groupId: choir.id,
          role: TRACK_ROLES.CHOIR,
        },
      },
      {
        name: 'Piano 2',
        blobId: 'blob-track-child',
        durationMs: 800,
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
          parentTrackId: piano.id,
          role: TRACK_ROLES.INSTRUMENT,
        },
      },
    ]);

    const extraChoir = next.tracks.find((track) => track.name === 'Extra Choir');
    const pianoTwo = next.tracks.find((track) => track.name === 'Piano 2');
    const choirNode = next.trackTree.find((node) => node.id === choir.id);
    const extraNode = getTrackNodeByTrackId(next, extraChoir.id);
    const pianoNode = getTrackNodeByTrackId(next, piano.id);
    const pianoTwoNode = getTrackNodeByTrackId(next, pianoTwo.id);
    const pianoGroup = next.trackTree.find((node) => node.id === pianoNode.parentId);

    expect(extraNode.parentId).toBe(choirNode.parentId);
    expect(extraNode.order).toBe(choirNode.order + 1);
    expect(pianoGroup?.kind).toBe('group');
    expect(pianoGroup?.name).toBe('Piano');
    expect(pianoTwoNode.parentId).toBe(pianoGroup.id);
  });

  it('converts an empty track into a group when adding a child', () => {
    const empty = createTrack('Vocals', TRACK_ROLES.LEAD);
    const project = projectWithTracks([empty]);
    const next = applyImportAssignments(project, [{
      name: 'Lead take',
      blobId: 'blob-child',
      durationMs: 1200,
      destination: {
        mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
        parentTrackId: empty.id,
        role: TRACK_ROLES.LEAD,
      },
    }]);

    expect(next.tracks.find((track) => track.id === empty.id)).toBeUndefined();
    const imported = next.tracks.find((track) => track.name === 'Lead take');
    const importedNode = getTrackNodeByTrackId(next, imported.id);
    const group = next.trackTree.find((node) => node.id === importedNode.parentId);
    expect(group?.kind).toBe('group');
    expect(group?.name).toBe('Vocals');
    expect(group?.role).toBe(TRACK_ROLES.LEAD);
  });

  it('puts multiple files on one new child track named after the first file', () => {
    const trumpet = createTrack('Trumpet', TRACK_ROLES.INSTRUMENT);
    const trombone = createTrack('Trombone', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Band'), tracks: [trumpet, trombone] };
    project = createGroupNode(project, 'Band');
    const band = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, trumpet.id, band.id);
    project = attachTrackNode(project, trombone.id, band.id);

    const next = applyImportAssignments(project, [
      {
        name: 'Horn A',
        fileName: 'horn_a.wav',
        blobId: 'blob-a',
        durationMs: 1000,
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
          parentGroupId: band.id,
          afterId: trumpet.id,
          role: TRACK_ROLES.INSTRUMENT,
        },
      },
      {
        name: 'Horn B',
        fileName: 'horn_b.wav',
        blobId: 'blob-b',
        durationMs: 500,
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
          parentGroupId: band.id,
          afterId: trumpet.id,
          role: TRACK_ROLES.INSTRUMENT,
        },
      },
    ]);

    const created = next.tracks.find((track) => track.name === 'Horn A');
    expect(created).toBeTruthy();
    expect(next.tracks.find((track) => track.name === 'Horn B')).toBeUndefined();
    expect(created.clips.map((clip) => ({
      blobId: clip.blobId,
      timelineStartMs: clip.timelineStartMs,
    }))).toEqual([
      { blobId: 'blob-a', timelineStartMs: 0 },
      { blobId: 'blob-b', timelineStartMs: 1000 },
    ]);
    expect(getTrackNodeByTrackId(next, created.id)?.parentId).toBe(band.id);
    expect(getTrackNodeByTrackId(next, created.id)?.order).toBe(
      getTrackNodeByTrackId(next, trumpet.id).order + 1,
    );
  });
});

describe('import destination encoding', () => {
  it('maps parent and placement dropdowns', () => {
    const piano = createTrack('Piano', TRACK_ROLES.LEAD);
    piano.clips.push(createClip('old', 0, 1000));
    let project = { ...createEmptyProject('Tree'), tracks: [piano] };
    project = createGroupNode(project, 'Band');
    const band = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, piano.id, band.id);

    const none = applyImportParentKey(null, IMPORT_PARENT_NONE, project);
    expect(getImportParentKey(none)).toBe(IMPORT_PARENT_NONE);
    expect(getImportPlacementValue(none)).toBe(TRACK_ROLES.INSTRUMENT);

    const typed = applyImportPlacement(none, TRACK_ROLES.METRONOME, project);
    expect(typed).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_ROOT,
      role: TRACK_ROLES.METRONOME,
    });

    const onTrack = applyImportParentKey(typed, `track:${piano.id}`, project);
    expect(getImportParentKey(onTrack)).toBe(`track:${piano.id}`);
    expect(getImportPlacementValue(onTrack)).toBe(IMPORT_PLACEMENT_REPLACE);
    expect(destinationReplacesAudio(onTrack, project)).toBe(true);

    const sibling = applyImportPlacement(onTrack, IMPORT_PLACEMENT_NEW_TRACK, project);
    expect(sibling.mode).toBe(IMPORT_DESTINATION_MODES.NEW_SIBLING);
    expect(getImportPlacementValue(sibling)).toBe(IMPORT_PLACEMENT_NEW_TRACK);

    const appended = applyImportPlacement(onTrack, IMPORT_PLACEMENT_APPEND, project);
    expect(appended.mode).toBe(IMPORT_DESTINATION_MODES.APPEND);
    expect(getImportPlacementValue(appended)).toBe(IMPORT_PLACEMENT_APPEND);

    const onGroup = applyImportParentKey(sibling, `group:${band.id}`, project);
    expect(onGroup).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: band.id,
      role: TRACK_ROLES.LEAD,
    });
    expect(getImportPlacementValue(onGroup)).toBe(IMPORT_PLACEMENT_NEW_CHILD);
  });

  it('shows ancestor paths with slash separators', () => {
    const soprano = createTrack('Soprano', TRACK_ROLES.CHOIR);
    let project = { ...createEmptyProject('Path'), tracks: [soprano] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group' && node.name === 'Choir');
    project = createGroupNode(project, 'Sopranos', choir.id);
    const sopranos = project.trackTree.find((node) => node.kind === 'group' && node.name === 'Sopranos');
    project = attachTrackNode(project, soprano.id, sopranos.id);
    const tree = listImportTree(project);

    expect(getImportAncestorPath(IMPORT_PARENT_NONE, tree.nodes)).toBe('(None)');
    expect(getImportAncestorPath(`group:${choir.id}`, tree.nodes)).toBe('Choir');
    expect(getImportAncestorPath(`group:${sopranos.id}`, tree.nodes)).toBe('Choir/Sopranos');
    expect(getImportAncestorPath(`track:${soprano.id}`, tree.nodes)).toBe('Choir/Sopranos/Soprano');
  });

  it('lists groups and leaf tracks in tree order with group roles', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Tree'), tracks: [piano] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = updateGroupNode(project, choir.id, { role: GROUP_ROLE_CHOIRS });
    project = attachTrackNode(project, piano.id, choir.id);
    const tree = listImportTree(project);
    expect(tree.nodes.map((node) => node.name)).toEqual(['Choir', 'Piano']);
    expect(tree.groups.map((group) => group.name)).toEqual(['Choir']);
    expect(tree.groups[0].role).toBe(GROUP_ROLE_CHOIRS);
    expect(tree.leafTracks.map((leaf) => leaf.name)).toEqual(['Piano']);
  });

  it('encodes drag drop targets from vertical placement', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Drop'), tracks: [piano] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, piano.id, choir.id);
    const tree = listImportTree(project);
    const pianoNode = tree.leafTracks[0];
    const choirNode = tree.groups[0];
    const current = { mode: IMPORT_DESTINATION_MODES.NEW_ROOT, role: TRACK_ROLES.LEAD };

    expect(resolveImportDropPlacement(pianoNode, 0.5, { isLastInParent: true, isFirstInParent: true })).toBe(IMPORT_DROP_TYPES.ON);
    expect(resolveImportDropPlacement(pianoNode, 0.1, { isLastInParent: true, isFirstInParent: true })).toBe(IMPORT_DROP_TYPES.BEFORE);
    expect(resolveImportDropPlacement(pianoNode, 0.1, { isLastInParent: false, isFirstInParent: false })).toBe(IMPORT_DROP_TYPES.ON);
    expect(resolveImportDropPlacement(pianoNode, 0.9, { isLastInParent: true, isFirstInParent: true })).toBe(IMPORT_DROP_TYPES.AFTER_PARENT);
    expect(resolveImportDropPlacement(choirNode, 0.5, { hasDescendants: true })).toBe(IMPORT_DROP_TYPES.INSIDE);

    expect(assignImportDrop(current, { type: IMPORT_DROP_TYPES.ON, node: pianoNode })).toEqual({
      mode: IMPORT_DESTINATION_MODES.EXISTING,
      trackId: piano.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
    expect(assignImportDrop(current, { type: IMPORT_DROP_TYPES.AFTER, node: pianoNode })).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: choir.id,
      role: TRACK_ROLES.LEAD,
    });
    expect(assignImportDrop(current, { type: IMPORT_DROP_TYPES.INSIDE, node: pianoNode })).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentTrackId: piano.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
    expect(assignImportDrop(current, { type: IMPORT_DROP_TYPES.AFTER, node: choirNode })).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      groupId: choir.id,
      role: TRACK_ROLES.LEAD,
    });
    expect(assignImportDrop(current, { type: IMPORT_DROP_TYPES.INSIDE, node: choirNode })).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: choir.id,
      role: TRACK_ROLES.OTHER,
    });
    expect(assignImportDrop(current, { type: IMPORT_DROP_TYPES.NEW_ROOT })).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_ROOT,
      role: TRACK_ROLES.LEAD,
    });
  });

  it('indents a new track into the row above, wrapping a leaf into a group', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    const project = projectWithTracks([piano]);
    const tree = listImportTree(project);
    const beside = {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      trackId: piano.id,
      role: TRACK_ROLES.LEAD,
    };
    const indented = indentImportDestination(beside, tree.nodes);
    expect(indented).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentTrackId: piano.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
    expect(outdentImportDestination(indented, tree.nodes)).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      trackId: piano.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
  });

  it('toggles overwrite and append only on occupied tracks', () => {
    const piano = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    piano.clips.push(createClip('old', 0, 1000));
    const project = projectWithTracks([piano]);
    const overwrite = {
      mode: IMPORT_DESTINATION_MODES.EXISTING,
      trackId: piano.id,
      role: TRACK_ROLES.INSTRUMENT,
    };
    const appended = toggleImportReplaceMode(overwrite, project);
    expect(appended.mode).toBe(IMPORT_DESTINATION_MODES.APPEND);
    expect(toggleImportReplaceMode(appended, project).mode).toBe(IMPORT_DESTINATION_MODES.EXISTING);
    const empty = createTrack('Empty', TRACK_ROLES.INSTRUMENT);
    const emptyProject = projectWithTracks([empty]);
    const onEmpty = {
      mode: IMPORT_DESTINATION_MODES.EXISTING,
      trackId: empty.id,
      role: TRACK_ROLES.INSTRUMENT,
    };
    expect(toggleImportReplaceMode(onEmpty, emptyProject)).toEqual(onEmpty);
  });

  it('places import files onto existing rows and ghost destinations', () => {
    const soprano = createTrack('Soprano', TRACK_ROLES.CHOIR);
    let project = { ...createEmptyProject('Preview'), tracks: [soprano] };
    project = createGroupNode(project, 'Choir');
    const choir = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, soprano.id, choir.id);
    const tree = listImportTree(project);
    const rows = buildImportPreviewRows(tree.nodes, [
      {
        id: 'file-overwrite',
        file: { name: 'soprano.wav' },
        destination: { mode: IMPORT_DESTINATION_MODES.EXISTING, trackId: soprano.id },
      },
      {
        id: 'file-child',
        file: { name: 'choir_extra.wav' },
        destination: { mode: IMPORT_DESTINATION_MODES.NEW_CHILD, parentGroupId: choir.id },
      },
      {
        id: 'file-root',
        file: { name: 'piano.wav' },
        destination: { mode: IMPORT_DESTINATION_MODES.NEW_ROOT, role: TRACK_ROLES.INSTRUMENT },
      },
    ]);

    expect(rows.map((row) => row.kind)).toEqual(['group', 'track', 'ghost', 'ghost']);
    expect(rows[1].files.map((entry) => entry.id)).toEqual(['file-overwrite']);
    expect(rows[2].ghostType).toBe('new-child');
    expect(rows[2].files.map((entry) => entry.id)).toEqual(['file-child']);
    expect(rows[3].ghostType).toBe('new-root');
  });

  it('places a single child-of-group ghost between two sibling tracks', () => {
    const trumpet = createTrack('Trumpet', TRACK_ROLES.INSTRUMENT);
    const trombone = createTrack('Trombone', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Band'), tracks: [trumpet, trombone] };
    project = createGroupNode(project, 'Band');
    const band = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, trumpet.id, band.id);
    project = attachTrackNode(project, trombone.id, band.id);
    const tree = listImportTree(project);
    const rows = buildImportPreviewRows(tree.nodes, [
      {
        id: 'file-a',
        file: { name: 'horn_a.wav' },
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
          parentGroupId: band.id,
          afterId: trumpet.id,
        },
      },
      {
        id: 'file-b',
        file: { name: 'horn_b.wav' },
        destination: {
          mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
          parentGroupId: band.id,
          afterId: trumpet.id,
        },
      },
    ]);

    expect(rows.map((row) => (row.kind === 'ghost' ? row.ghostType : row.node?.name))).toEqual([
      'Band',
      'Trumpet',
      'new-child',
      'Trombone',
    ]);
    expect(rows[2].files.map((entry) => entry.id)).toEqual(['file-a', 'file-b']);
    expect(rows[2].node.name).toBe('Band');
  });

  it('indents a gap between sibling tracks into a child of the track above', () => {
    const trumpet = createTrack('Trumpet', TRACK_ROLES.INSTRUMENT);
    const trombone = createTrack('Trombone', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Band'), tracks: [trumpet, trombone] };
    project = createGroupNode(project, 'Band');
    const band = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, trumpet.id, band.id);
    project = attachTrackNode(project, trombone.id, band.id);
    const tree = listImportTree(project);
    const between = {
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: band.id,
      afterId: trumpet.id,
      role: TRACK_ROLES.LEAD,
    };

    const indented = indentImportDestination(between, tree.nodes);
    expect(indented).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentTrackId: trumpet.id,
      role: TRACK_ROLES.INSTRUMENT,
    });
    expect(outdentImportDestination(indented, tree.nodes)).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: band.id,
      afterId: trumpet.id,
      role: TRACK_ROLES.OTHER,
    });
  });

  it('shows a new child of a group after its last track', () => {
    const instrument = createTrack('Instrument1', TRACK_ROLES.INSTRUMENT);
    let project = { ...createEmptyProject('Bandet'), tracks: [instrument] };
    project = createGroupNode(project, 'Bandet');
    const bandet = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, instrument.id, bandet.id);
    const tree = listImportTree(project);

    const besideGroup = {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      groupId: bandet.id,
      role: TRACK_ROLES.LEAD,
    };
    const childOfGroup = indentImportDestination(besideGroup, tree.nodes);
    expect(childOfGroup).toEqual({
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: bandet.id,
      role: TRACK_ROLES.OTHER,
    });

    const rows = buildImportPreviewRows(tree.nodes, [{
      id: 'file-new',
      file: { name: 'extra.wav' },
      destination: childOfGroup,
    }]);
    expect(rows.map((row) => (row.kind === 'ghost' ? row.ghostType : row.node?.name))).toEqual([
      'Bandet',
      'Instrument1',
      'new-child',
    ]);
    expect(rows[2].node.name).toBe('Bandet');
    expect(rows[2].depth).toBe(1);

    const nestedSibling = {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      trackId: instrument.id,
      role: TRACK_ROLES.LEAD,
    };
    const nestedRows = buildImportPreviewRows(tree.nodes, [{
      id: 'file-nested',
      file: { name: 'extra.wav' },
      destination: nestedSibling,
    }]);
    expect(nestedRows.map((row) => (row.kind === 'ghost' ? row.ghostType : row.node?.name))).toEqual([
      'Bandet',
      'Instrument1',
      'new-child',
    ]);
  });
});
