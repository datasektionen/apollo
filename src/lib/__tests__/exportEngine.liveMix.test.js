import { describe, expect, it } from 'vitest';
import { createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import { attachTrackNode } from '../../utils/trackTree';
import { ADVANCED_MIX_PRESET_ID } from '../../utils/advancedMix';
import {
  EXPORT_PRESETS,
  collectLiveMixBlobIds,
  getLiveMixableTrackIds,
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

function createMixProject() {
  const piano = addClip(createTrack('Piano', TRACK_ROLES.INSTRUMENT), 'blob-piano');
  const mutedPad = addClip(createTrack('Pad', TRACK_ROLES.INSTRUMENT), 'blob-pad');
  mutedPad.muted = true;
  const click = addClip(createTrack('Click', TRACK_ROLES.METRONOME), 'blob-click');
  click.muted = true;

  let project = createEmptyProject('Live Mix Test');
  project = { ...project, tracks: [piano, mutedPad, click] };
  project = attachTrackNode(project, piano.id);
  project = attachTrackNode(project, mutedPad.id);
  project = attachTrackNode(project, click.id);
  return { project, piano, mutedPad, click };
}

describe('live-mixable playback stems', () => {
  it('loads every stem in DAW and advanced mix, including muted tracks', () => {
    const { project, piano, mutedPad, click } = createMixProject();

    expect([...getLiveMixableTrackIds(project, { scope: 'daw' })].sort()).toEqual(
      [piano.id, mutedPad.id, click.id].sort()
    );
    expect(collectLiveMixBlobIds(project, { scope: 'daw' }).sort()).toEqual(
      ['blob-click', 'blob-pad', 'blob-piano']
    );

    expect([...getLiveMixableTrackIds(project, { presetId: ADVANCED_MIX_PRESET_ID })].sort()).toEqual(
      [piano.id, mutedPad.id, click.id].sort()
    );
  });

  it('omits DAW-muted non-metronome stems for tutti, part, and group mixes', () => {
    const { project, piano, mutedPad, click } = createMixProject();

    const tuttiIds = getLiveMixableTrackIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.TUTTI,
    });
    const partIds = getLiveMixableTrackIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.INSTRUMENT_PARTS,
    });
    const groupIds = getLiveMixableTrackIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.CHOIR_ONLY,
    });

    expect(tuttiIds.has(piano.id)).toBe(true);
    expect(tuttiIds.has(click.id)).toBe(true);
    expect(tuttiIds.has(mutedPad.id)).toBe(false);
    expect(partIds).toEqual(tuttiIds);
    expect(groupIds).toEqual(tuttiIds);

    expect(collectLiveMixBlobIds(project, {
      scope: 'player',
      presetId: EXPORT_PRESETS.TUTTI,
    }).sort()).toEqual(['blob-click', 'blob-piano']);
  });
});
