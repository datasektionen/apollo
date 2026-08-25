import { describe, expect, it } from 'vitest';
import {
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_INSTRUMENTS,
  GROUP_ROLE_LEADS,
  GROUP_ROLE_NONE,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_METRONOME,
  TRACK_ROLE_OTHER,
  getDefaultIconByRole,
  getNextStemIcon,
  getNextTrackType,
  getRoleColorClass,
  getStemIcon,
  getTrackTypeCategory,
} from '../trackRoles';

describe('track type icon and color mapping', () => {
  it('gives each track type one icon and color', () => {
    expect(getDefaultIconByRole(TRACK_ROLE_INSTRUMENT)).toBe('guitar');
    expect(getDefaultIconByRole(TRACK_ROLE_LEAD)).toBe('user');
    expect(getDefaultIconByRole(TRACK_ROLE_CHOIR)).toBe('users');
    expect(getDefaultIconByRole(TRACK_ROLE_METRONOME)).toBe('metronome');
    expect(getDefaultIconByRole(TRACK_ROLE_OTHER)).toBe('wave');

    expect(getRoleColorClass(TRACK_ROLE_INSTRUMENT)).toBe('bg-purple-600');
    expect(getRoleColorClass(TRACK_ROLE_LEAD)).toBe('bg-blue-600');
    expect(getRoleColorClass(TRACK_ROLE_CHOIR)).toBe('bg-green-600');
    expect(getRoleColorClass(TRACK_ROLE_METRONOME)).toBe('bg-orange-600');
    expect(getRoleColorClass(TRACK_ROLE_OTHER)).toBe('bg-gray-600');
  });

  it('uses the same icon and color for matching group categories', () => {
    expect(getDefaultIconByRole(GROUP_ROLE_INSTRUMENTS)).toBe('guitar');
    expect(getDefaultIconByRole(GROUP_ROLE_LEADS)).toBe('user');
    expect(getDefaultIconByRole(GROUP_ROLE_CHOIRS)).toBe('users');
    expect(getDefaultIconByRole(GROUP_ROLE_NONE)).toBe('wave');
    expect(getRoleColorClass(GROUP_ROLE_INSTRUMENTS)).toBe(getRoleColorClass(TRACK_ROLE_INSTRUMENT));
    expect(getRoleColorClass(GROUP_ROLE_NONE)).toBe(getRoleColorClass(TRACK_ROLE_OTHER));
  });

  it('cycles types in Change type order', () => {
    expect(getNextTrackType(TRACK_ROLE_INSTRUMENT)).toBe(TRACK_ROLE_LEAD);
    expect(getNextTrackType(TRACK_ROLE_LEAD)).toBe(TRACK_ROLE_CHOIR);
    expect(getNextTrackType(TRACK_ROLE_CHOIR)).toBe(TRACK_ROLE_METRONOME);
    expect(getNextTrackType(TRACK_ROLE_METRONOME)).toBe(TRACK_ROLE_OTHER);
    expect(getNextTrackType(TRACK_ROLE_OTHER)).toBe(TRACK_ROLE_INSTRUMENT);
    expect(getTrackTypeCategory('choir-part-2')).toBe(TRACK_ROLE_CHOIR);
    expect(getNextTrackType('choir-part-2')).toBe(TRACK_ROLE_METRONOME);
  });

  it('limits nested stem tracks to recording and file icons', () => {
    expect(getStemIcon('guitar')).toBe('mic');
    expect(getStemIcon('mic')).toBe('mic');
    expect(getStemIcon('file-music')).toBe('file-music');
    expect(getNextStemIcon('mic')).toBe('file-music');
    expect(getNextStemIcon('file-music')).toBe('mic');
    expect(getNextStemIcon('guitar')).toBe('file-music');
  });
});
