import { describe, expect, it } from 'vitest';
import { createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import {
  attachTrackNode,
  createGroupNode,
} from '../../utils/trackTree';
import {
  DEFAULT_EXTERNAL_DAW_MIX_SETTINGS,
  EXTERNAL_DAW_TRACK_SCOPES,
  getExternalDawTrackDescriptors,
  normalizeExternalDawMixSettings,
} from '../externalDawExport';

function addClip(track, blobId) {
  return {
    ...track,
    clips: [{
      id: `${track.id}-clip`,
      blobId,
      timelineStartMs: 0,
      cropStartMs: 0,
      cropEndMs: 1000,
      gainDb: 0,
      muted: false,
    }],
  };
}

describe('external DAW export track descriptors', () => {
  it('normalizes each mix setting independently', () => {
    expect(normalizeExternalDawMixSettings({
      trackVolume: true,
      groupPan: true,
      masterSettings: false,
      unknownSetting: true,
    })).toEqual({
      ...DEFAULT_EXTERNAL_DAW_MIX_SETTINGS,
      trackVolume: true,
      groupPan: true,
    });
  });

  it('uses the full group path for nested tracks and the track name at root', () => {
    const rootTrack = addClip(createTrack('Root Piano', TRACK_ROLES.INSTRUMENT), 'root');
    const nestedTrack = addClip(createTrack('Soprano', TRACK_ROLES.CHOIR), 'soprano');
    let project = {
      ...createEmptyProject('External DAW Test'),
      tracks: [rootTrack, nestedTrack],
    };
    project = createGroupNode(project, 'Choir');
    const choirGroup = project.trackTree.find((node) => node.kind === 'group');
    project = createGroupNode(project, 'Upper Voices', choirGroup.id);
    const upperVoicesGroup = project.trackTree.find(
      (node) => node.kind === 'group' && node.parentId === choirGroup.id
    );
    project = attachTrackNode(project, rootTrack.id);
    project = attachTrackNode(project, nestedTrack.id, upperVoicesGroup.id);

    const descriptors = getExternalDawTrackDescriptors(project);

    expect(descriptors.map((descriptor) => descriptor.filename)).toEqual([
      'Root Piano.wav',
      'Choir - Upper Voices - Soprano.wav',
    ]);
    expect(descriptors[1].pathParts).toEqual(['Choir', 'Upper Voices', 'Soprano']);
  });

  it('omits empty and currently inaudible tracks', () => {
    const audible = addClip(createTrack('Audible', TRACK_ROLES.INSTRUMENT), 'audible');
    const empty = createTrack('Empty', TRACK_ROLES.INSTRUMENT);
    const muted = addClip(createTrack('Muted', TRACK_ROLES.INSTRUMENT), 'muted');
    muted.muted = true;
    let project = {
      ...createEmptyProject('External DAW Test'),
      tracks: [audible, empty, muted],
    };
    project = attachTrackNode(project, audible.id);
    project = attachTrackNode(project, empty.id);
    project = attachTrackNode(project, muted.id);

    expect(getExternalDawTrackDescriptors(project).map((descriptor) => descriptor.name)).toEqual([
      'Audible',
    ]);
  });

  it('supports all-track and selected-track scopes, with metronome opt-in', () => {
    const audible = addClip(createTrack('Audible', TRACK_ROLES.INSTRUMENT), 'audible');
    const muted = addClip(createTrack('Muted', TRACK_ROLES.INSTRUMENT), 'muted');
    muted.muted = true;
    const metronome = addClip(createTrack('Click', TRACK_ROLES.METRONOME), 'click');
    let project = {
      ...createEmptyProject('External DAW Test'),
      tracks: [audible, muted, metronome],
    };
    project = attachTrackNode(project, audible.id);
    project = attachTrackNode(project, muted.id);
    project = attachTrackNode(project, metronome.id);

    expect(getExternalDawTrackDescriptors(project, {
      trackScope: EXTERNAL_DAW_TRACK_SCOPES.ALL,
      includeMetronome: true,
    }).map((descriptor) => descriptor.name)).toEqual(['Audible', 'Muted', 'Click']);

    expect(getExternalDawTrackDescriptors(project, {
      trackScope: EXTERNAL_DAW_TRACK_SCOPES.SELECTED,
      includeMetronome: true,
      selectedTrackIds: [muted.id, metronome.id],
    }).map((descriptor) => descriptor.name)).toEqual(['Muted', 'Click']);
  });
});
