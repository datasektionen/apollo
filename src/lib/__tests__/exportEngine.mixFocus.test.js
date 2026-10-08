import { describe, expect, it } from 'vitest';
import { createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import {
  ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
  buildAdvancedMixDeviationItems,
} from '../../utils/advancedMix';
import {
  attachTrackNode,
  createGroupNode,
  getEffectiveTrackMix,
  updateGroupNode,
} from '../../utils/trackTree';
import { GROUP_ROLE_CHOIRS, GROUP_ROLE_INSTRUMENTS } from '../../utils/trackRoles';
import {
  EXPORT_PRESETS,
  PRACTICE_REALTIME_MODES,
  collectLiveMixBlobIds,
  createEditableMixSource,
  listPresetVariants,
  resolveAdvancedMixRealtimeTrackMix,
  resolvePracticeRealtimeTrackMix,
} from '../exportEngine';

function addClip(track, blobId) {
  track.clips = [
    {
      id: `${track.id}-clip`,
      blobId,
      timelineStartMs: 0,
      cropStartMs: 0,
      cropEndMs: 1000,
      gainDb: 0,
      muted: false,
    },
  ];
  return track;
}

function groupIdByName(project, name) {
  const node = (project.trackTree || []).find((entry) => entry.kind === 'group' && entry.name === name);
  if (!node) throw new Error(`Missing group ${name}`);
  return node.id;
}

function withTrack(project, track, parentId) {
  return attachTrackNode({
    ...project,
    tracks: [...(project.tracks || []), track],
  }, track.id, parentId);
}

function variantFor(project, presetId, label) {
  const variant = listPresetVariants(project, presetId).find((entry) => entry.label === label);
  if (!variant) throw new Error(`Missing ${presetId} variant ${label}`);
  return variant;
}

function focusItems(project, source) {
  return buildAdvancedMixDeviationItems(project, source.snapshot, source.focus)
    .filter((item) => item.kind === 'focus');
}

/**
 * Instruments
 *   Strings (part)
 *     Violin 1
 *     Violin 2 (muted)
 *     Click
 *     Desk (nested group)
 *       Violin 3
 *   Brass (part)
 *     Trumpet
 *     Horn
 *   Piano (track part)
 */
function createInstrumentPartProject() {
  const violin1 = addClip(createTrack('Violin 1', TRACK_ROLES.INSTRUMENT), 'blob-v1');
  const violin2 = addClip(createTrack('Violin 2', TRACK_ROLES.INSTRUMENT), 'blob-v2');
  violin2.muted = true;
  const violin3 = addClip(createTrack('Violin 3', TRACK_ROLES.INSTRUMENT), 'blob-v3');
  const click = addClip(createTrack('Click', TRACK_ROLES.METRONOME), 'blob-click');
  const trumpet = addClip(createTrack('Trumpet', TRACK_ROLES.INSTRUMENT), 'blob-tpt');
  const horn = addClip(createTrack('Horn', TRACK_ROLES.INSTRUMENT), 'blob-horn');
  const piano = addClip(createTrack('Piano', TRACK_ROLES.INSTRUMENT), 'blob-piano');

  let project = createEmptyProject('Part Highlight');
  project = createGroupNode(project, 'Instruments');
  const instrumentsId = groupIdByName(project, 'Instruments');
  project = updateGroupNode(project, instrumentsId, { role: GROUP_ROLE_INSTRUMENTS });

  project = createGroupNode(project, 'Strings', instrumentsId);
  const stringsId = groupIdByName(project, 'Strings');
  project = updateGroupNode(project, stringsId, { role: TRACK_ROLES.INSTRUMENT, part: true });
  project = withTrack(project, violin1, stringsId);
  project = withTrack(project, violin2, stringsId);
  project = withTrack(project, click, stringsId);

  project = createGroupNode(project, 'Desk', stringsId);
  const deskId = groupIdByName(project, 'Desk');
  project = withTrack(project, violin3, deskId);

  project = createGroupNode(project, 'Brass', instrumentsId);
  const brassId = groupIdByName(project, 'Brass');
  project = updateGroupNode(project, brassId, { role: TRACK_ROLES.INSTRUMENT, part: true });
  project = withTrack(project, trumpet, brassId);
  project = withTrack(project, horn, brassId);

  project = withTrack(project, piano, instrumentsId);

  return {
    project,
    instrumentsId,
    stringsId,
    brassId,
    violin1,
    violin2,
    violin3,
    click,
    trumpet,
    horn,
    piano,
  };
}

describe('mix-mode highlight level', () => {
  it('lists a part mix on the part group, not its unmuted children', () => {
    const { project, stringsId, violin1, violin2, violin3, piano } = createInstrumentPartProject();
    const strings = variantFor(project, EXPORT_PRESETS.INSTRUMENT_PARTS, 'Strings');
    const source = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey: strings.key,
    });

    expect(strings.key).toBe(`group:${stringsId}`);
    expect(source.focus.highlightedGroupIds).toEqual([stringsId]);
    expect(source.focus.highlightedTrackIds).toEqual([]);
    expect(focusItems(project, source)).toEqual([
      expect.objectContaining({
        groupId: stringsId,
        detail: 'Group focus',
        title: 'Strings highlighted',
      }),
    ]);

    const playerMix = resolvePracticeRealtimeTrackMix(
      project,
      EXPORT_PRESETS.INSTRUMENT_PARTS,
      strings.key,
      { practiceFocusDiffDb: 6 }
    );
    expect(new Set(playerMix.targetTrackIds)).toEqual(new Set([violin1.id, violin3.id]));
    expect(playerMix.targetTrackIds).not.toContain(violin2.id);
    expect(playerMix.trackMixByTrackId[violin1.id].gain)
      .toBeGreaterThan(playerMix.trackMixByTrackId[piano.id].gain);

    const editorMix = resolveAdvancedMixRealtimeTrackMix(project, source.focus, {
      practiceFocusControl: ADVANCED_MIX_PRACTICE_FOCUS_STEPS.indexOf(6),
    });
    expect(editorMix.targetTrackIds).toEqual(expect.arrayContaining([violin1.id, violin2.id, violin3.id]));
    expect(editorMix.trackMixByTrackId[violin2.id]).toBeUndefined();
    expect(editorMix.trackMixByTrackId[violin1.id].gain)
      .toBeGreaterThan(editorMix.trackMixByTrackId[piano.id].gain);
  });

  it('keeps an all-audible part on the group, and a single track part on the track', () => {
    const { project, brassId, piano } = createInstrumentPartProject();
    const brass = variantFor(project, EXPORT_PRESETS.INSTRUMENT_PARTS, 'Brass');
    const brassSource = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey: brass.key,
    });
    expect(brassSource.focus.highlightedGroupIds).toEqual([brassId]);
    expect(brassSource.focus.highlightedTrackIds).toEqual([]);

    const pianoVariant = variantFor(project, EXPORT_PRESETS.INSTRUMENT_PARTS, 'Piano');
    const pianoSource = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey: pianoVariant.key,
    });
    expect(pianoSource.focus.highlightedTrackIds).toEqual([piano.id]);
    expect(pianoSource.focus.highlightedGroupIds).toEqual([]);
    expect(focusItems(project, pianoSource)).toEqual([
      expect.objectContaining({
        trackId: piano.id,
        detail: 'Track focus',
        title: 'Piano highlighted',
      }),
    ]);
  });

  it('uses the same part group for omitted part mixes without omitting the metronome', () => {
    const { project, stringsId, violin1, click, piano } = createInstrumentPartProject();
    const strings = variantFor(project, EXPORT_PRESETS.INSTRUMENT_PARTS, 'Strings');
    const source = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED,
      presetVariantKey: strings.key,
    });

    expect(source.focus.highlightedGroupIds).toEqual([stringsId]);
    expect(source.focus.highlightedTrackIds).toEqual([]);
    expect(source.controls.practiceFocusControl).toBe(ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX);

    const playerMix = resolvePracticeRealtimeTrackMix(
      project,
      EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED,
      strings.key,
      null,
      PRACTICE_REALTIME_MODES.OMITTED
    );
    expect(playerMix.targetTrackIds).not.toContain(project.tracks.find((track) => track.name === 'Violin 2').id);
    expect(playerMix.trackMixByTrackId[violin1.id].gain).toBe(0);
    expect(playerMix.trackMixByTrackId[piano.id].gain).toBeGreaterThan(0);

    const baseClick = getEffectiveTrackMix(project).statesByTrackId.get(click.id);
    const editorMix = resolveAdvancedMixRealtimeTrackMix(project, source.focus, source.controls);
    expect(editorMix.trackMixByTrackId[violin1.id].gain).toBe(0);
    expect(editorMix.trackMixByTrackId[piano.id].gain).toBeGreaterThan(0);
    expect(editorMix.trackMixByTrackId[click.id]).toEqual({
      gain: baseClick.effectiveGain,
      pan: baseClick.effectivePan,
    });
  });

  it('does not lift a part group that also contains another audible unit', () => {
    const violin = addClip(createTrack('Violin', TRACK_ROLES.INSTRUMENT), 'blob-violin');
    const soprano = addClip(createTrack('Soprano', TRACK_ROLES.CHOIR), 'blob-soprano');
    let project = createEmptyProject('Split Part');
    project = createGroupNode(project, 'Instruments');
    const instrumentsId = groupIdByName(project, 'Instruments');
    project = updateGroupNode(project, instrumentsId, { role: GROUP_ROLE_INSTRUMENTS });
    project = createGroupNode(project, 'Strings', instrumentsId);
    const stringsId = groupIdByName(project, 'Strings');
    project = updateGroupNode(project, stringsId, { role: TRACK_ROLES.INSTRUMENT, part: true });
    project = withTrack(project, violin, stringsId);
    project = createGroupNode(project, 'Hidden Choir', stringsId);
    const hiddenChoirId = groupIdByName(project, 'Hidden Choir');
    project = updateGroupNode(project, hiddenChoirId, { role: GROUP_ROLE_CHOIRS });
    project = withTrack(project, soprano, hiddenChoirId);

    const strings = variantFor(project, EXPORT_PRESETS.INSTRUMENT_PARTS, 'Strings');
    const source = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey: strings.key,
    });

    expect(source.focus.highlightedGroupIds).toEqual([]);
    expect(source.focus.highlightedTrackIds).toEqual([violin.id]);
    expect(source.focus.highlightedTrackIds).not.toContain(soprano.id);
  });

  it('lists a choir part on the choir group, including when a singer is muted', () => {
    const soprano1 = addClip(createTrack('Soprano 1', TRACK_ROLES.CHOIR), 'blob-s1');
    const soprano2 = addClip(createTrack('Soprano 2', TRACK_ROLES.CHOIR), 'blob-s2');
    soprano2.muted = true;
    const alto = addClip(createTrack('Alto', TRACK_ROLES.CHOIR), 'blob-alto');

    let project = createEmptyProject('Choir Parts');
    project = createGroupNode(project, 'Choirs');
    const choirsId = groupIdByName(project, 'Choirs');
    project = updateGroupNode(project, choirsId, { role: GROUP_ROLE_CHOIRS });
    project = createGroupNode(project, 'Sopranos', choirsId);
    const sopranosId = groupIdByName(project, 'Sopranos');
    project = updateGroupNode(project, sopranosId, { role: TRACK_ROLES.CHOIR, part: true });
    project = withTrack(project, soprano1, sopranosId);
    project = withTrack(project, soprano2, sopranosId);
    project = withTrack(project, alto, choirsId);

    const sopranos = variantFor(project, EXPORT_PRESETS.CHOIR_PARTS, 'Sopranos');
    const source = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.CHOIR_PARTS,
      presetVariantKey: sopranos.key,
    });
    expect(sopranos.key).toBe(`group:${sopranosId}`);
    expect(source.focus.highlightedGroupIds).toEqual([sopranosId]);
    expect(source.focus.highlightedTrackIds).toEqual([]);

    const omitted = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.CHOIR_PARTS_OMITTED,
      presetVariantKey: sopranos.key,
    });
    expect(omitted.focus.highlightedGroupIds).toEqual([sopranosId]);
    expect(omitted.controls.practiceFocusControl).toBe(ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX);

    const altoVariant = variantFor(project, EXPORT_PRESETS.CHOIR_PARTS, 'Alto');
    const altoSource = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.CHOIR_PARTS,
      presetVariantKey: altoVariant.key,
    });
    expect(altoSource.focus.highlightedTrackIds).toEqual([alto.id]);
    expect(altoSource.focus.highlightedGroupIds).toEqual([]);

    const choirOnly = createEditableMixSource(project, { presetId: EXPORT_PRESETS.CHOIR_ONLY });
    expect(choirOnly.focus.highlightedGroupIds).toEqual([choirsId]);
    expect(choirOnly.focus.highlightedTrackIds).toEqual([]);
  });

  it('highlights a root part group that is not nested under a role parent', () => {
    const left = addClip(createTrack('Left', TRACK_ROLES.LEAD), 'blob-left');
    const right = addClip(createTrack('Right', TRACK_ROLES.LEAD), 'blob-right');
    right.muted = true;
    let project = createEmptyProject('Root Part');
    project = createGroupNode(project, 'Soloists');
    const soloistsId = groupIdByName(project, 'Soloists');
    project = updateGroupNode(project, soloistsId, { role: TRACK_ROLES.LEAD, part: true });
    project = withTrack(project, left, soloistsId);
    project = withTrack(project, right, soloistsId);

    const soloists = variantFor(project, EXPORT_PRESETS.LEAD_PARTS, 'Soloists');
    const source = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.LEAD_PARTS,
      presetVariantKey: soloists.key,
    });
    expect(source.focus.highlightedGroupIds).toEqual([soloistsId]);
    expect(source.focus.highlightedTrackIds).toEqual([]);

    const playerMix = resolvePracticeRealtimeTrackMix(
      project,
      EXPORT_PRESETS.LEAD_PARTS,
      soloists.key
    );
    expect(playerMix.targetTrackIds).toEqual([left.id]);
    expect(collectLiveMixBlobIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.LEAD_PARTS,
    })).not.toContain('blob-right');
  });

  it('does not fold a muted stem of another role into a group-mix highlight', () => {
    const violin = addClip(createTrack('Violin', TRACK_ROLES.INSTRUMENT), 'blob-violin');
    const soprano = addClip(createTrack('Soprano', TRACK_ROLES.CHOIR), 'blob-soprano');
    soprano.muted = true;
    let project = createEmptyProject('Mixed Group');
    project = createGroupNode(project, 'Band');
    const bandId = groupIdByName(project, 'Band');
    project = withTrack(project, violin, bandId);
    project = withTrack(project, soprano, bandId);

    const source = createEditableMixSource(project, { presetId: EXPORT_PRESETS.INSTRUMENTAL });
    expect(source.focus.highlightedGroupIds).not.toContain(bandId);
    expect(source.focus.highlightedTrackIds).toEqual([violin.id]);
    expect(collectLiveMixBlobIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.INSTRUMENTAL,
    })).toEqual(['blob-violin']);
  });

  it('still highlights a role group for group mixes, above the individual parts', () => {
    const { project, instrumentsId } = createInstrumentPartProject();
    const source = createEditableMixSource(project, { presetId: EXPORT_PRESETS.INSTRUMENTAL });
    expect(source.focus.highlightedGroupIds).toEqual([instrumentsId]);
    expect(source.focus.highlightedTrackIds).toEqual([]);
  });

  it('keeps player playback from loading muted non-metronome stems', () => {
    const { project, violin2 } = createInstrumentPartProject();
    const playerIds = collectLiveMixBlobIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
    });
    expect(playerIds).toEqual(expect.arrayContaining(['blob-v1', 'blob-v3', 'blob-piano', 'blob-click', 'blob-tpt', 'blob-horn']));
    expect(playerIds).not.toContain('blob-v2');

    expect(collectLiveMixBlobIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.INSTRUMENTAL,
    })).not.toContain('blob-v2');
    expect(collectLiveMixBlobIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.TUTTI,
    })).not.toContain('blob-v2');

    expect(collectLiveMixBlobIds(project, {
      scope: 'daw',
    })).toContain('blob-v2');
    expect(violin2.muted).toBe(true);
  });

  it('leaves an already saved advanced-mix focus untouched', () => {
    const { project, violin1 } = createInstrumentPartProject();
    const strings = variantFor(project, EXPORT_PRESETS.INSTRUMENT_PARTS, 'Strings');
    const source = createEditableMixSource(project, {
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey: strings.key,
      advancedMix: {
        snapshot: project,
        focus: { highlightedTrackIds: [violin1.id] },
      },
    });
    expect(source.focus.highlightedTrackIds).toEqual([violin1.id]);
    expect(source.focus.highlightedGroupIds).toEqual([]);
  });
});
