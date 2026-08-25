export const TRACK_ROLE_INSTRUMENT = 'instrument';
export const TRACK_ROLE_LEAD = 'lead';
export const TRACK_ROLE_CHOIR = 'choir';
export const TRACK_ROLE_METRONOME = 'metronome';
export const TRACK_ROLE_OTHER = 'other';

export const TRACK_CHOIR_PART_ROLES = [
  'choir-part-1',
  'choir-part-2',
  'choir-part-3',
  'choir-part-4',
  'choir-part-5',
];

export const GROUP_ROLE_NONE = 'group';
export const GROUP_ROLE_INSTRUMENTS = 'instruments';
export const GROUP_ROLE_LEADS = 'leads';
export const GROUP_ROLE_CHOIRS = 'choirs';
export const GROUP_ROLE_OTHERS = 'others';

export const TRACK_CATEGORY_ROLES = new Set([
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_METRONOME,
  TRACK_ROLE_OTHER,
]);

const GROUP_PARENT_ROLES = new Set([
  GROUP_ROLE_INSTRUMENTS,
  GROUP_ROLE_LEADS,
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_OTHERS,
]);

const GROUP_ALLOWED_ROLES = new Set([
  GROUP_ROLE_NONE,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_METRONOME,
  TRACK_ROLE_OTHER,
  ...TRACK_CHOIR_PART_ROLES,
  ...GROUP_PARENT_ROLES,
]);

export const TRACK_TYPE_CYCLE_ORDER = [
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_METRONOME,
  TRACK_ROLE_OTHER,
];

const TRACK_TYPE_ICONS = {
  [TRACK_ROLE_INSTRUMENT]: 'guitar',
  [TRACK_ROLE_LEAD]: 'user',
  [TRACK_ROLE_CHOIR]: 'users',
  [TRACK_ROLE_METRONOME]: 'metronome',
  [TRACK_ROLE_OTHER]: 'wave',
};

const TRACK_TYPE_COLOR_CLASSES = {
  [TRACK_ROLE_INSTRUMENT]: 'bg-purple-600',
  [TRACK_ROLE_LEAD]: 'bg-blue-600',
  [TRACK_ROLE_CHOIR]: 'bg-green-600',
  [TRACK_ROLE_METRONOME]: 'bg-orange-600',
  [TRACK_ROLE_OTHER]: 'bg-gray-600',
};

export function isChoirPartRole(role) {
  return typeof role === 'string' && role.startsWith('choir-part-');
}

export function isChoirRole(role) {
  return role === TRACK_ROLE_CHOIR || isChoirPartRole(role);
}

export function isMetronomeRole(role) {
  return role === TRACK_ROLE_METRONOME;
}

export function isTrackRole(role) {
  return TRACK_CATEGORY_ROLES.has(role) || isChoirPartRole(role);
}

export function isGroupParentRole(role) {
  return GROUP_PARENT_ROLES.has(role);
}

export function isGroupRole(role) {
  return GROUP_ALLOWED_ROLES.has(role);
}

export function mapGroupParentRoleToTrackRole(role) {
  if (role === GROUP_ROLE_INSTRUMENTS) return TRACK_ROLE_INSTRUMENT;
  if (role === GROUP_ROLE_LEADS) return TRACK_ROLE_LEAD;
  if (role === GROUP_ROLE_CHOIRS) return TRACK_ROLE_CHOIR;
  if (role === GROUP_ROLE_OTHERS) return TRACK_ROLE_OTHER;
  return null;
}

export function normalizeTrackRole(role) {
  return isTrackRole(role) ? role : TRACK_ROLE_OTHER;
}

export function normalizeGroupRole(role) {
  return isGroupRole(role) ? role : GROUP_ROLE_NONE;
}

export function toCategoryRole(role) {
  const normalized = normalizeTrackRole(role);
  if (isChoirPartRole(normalized)) return TRACK_ROLE_CHOIR;
  return normalized;
}

export function groupRoleToTrackRole(role) {
  const normalized = normalizeGroupRole(role);
  if (normalized === GROUP_ROLE_NONE) return TRACK_ROLE_OTHER;
  if (isGroupParentRole(normalized)) return mapGroupParentRoleToTrackRole(normalized) || TRACK_ROLE_OTHER;
  return toCategoryRole(normalized);
}

export function getTrackTypeCategory(role) {
  const mappedParent = mapGroupParentRoleToTrackRole(role);
  if (mappedParent) return mappedParent;
  return toCategoryRole(role);
}

export function getDefaultIconByRole(role) {
  return TRACK_TYPE_ICONS[getTrackTypeCategory(role)] || TRACK_TYPE_ICONS[TRACK_ROLE_OTHER];
}

export function getRoleColorClass(role) {
  return TRACK_TYPE_COLOR_CLASSES[getTrackTypeCategory(role)] || TRACK_TYPE_COLOR_CLASSES[TRACK_ROLE_OTHER];
}

export const STEM_ICON_RECORDING = 'mic';
export const STEM_ICON_FILE = 'file-music';
export const STEM_ICON_CYCLE_ORDER = [STEM_ICON_RECORDING, STEM_ICON_FILE];
export const DEFAULT_STEM_ICON = STEM_ICON_RECORDING;

export function isStemSourceIcon(icon) {
  return icon === STEM_ICON_RECORDING || icon === STEM_ICON_FILE;
}

export function getStemIcon(icon) {
  return isStemSourceIcon(icon) ? icon : DEFAULT_STEM_ICON;
}

export function getNextStemIcon(icon) {
  const current = getStemIcon(icon);
  const currentIndex = STEM_ICON_CYCLE_ORDER.indexOf(current);
  const index = currentIndex >= 0 ? currentIndex : 0;
  return STEM_ICON_CYCLE_ORDER[(index + 1) % STEM_ICON_CYCLE_ORDER.length];
}

export function getNextTrackType(role) {
  const current = getTrackTypeCategory(role);
  const currentIndex = TRACK_TYPE_CYCLE_ORDER.indexOf(current);
  const index = currentIndex >= 0 ? currentIndex : TRACK_TYPE_CYCLE_ORDER.length - 1;
  return TRACK_TYPE_CYCLE_ORDER[(index + 1) % TRACK_TYPE_CYCLE_ORDER.length];
}

export function isTrackCategoryRole(role, categoryRole) {
  return toCategoryRole(role) === categoryRole;
}
