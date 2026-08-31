import { randomUUID } from 'crypto';
import { pool } from './db.js';
import { getAppSettings, getEffectiveAppSettingsForMode } from './appSettings.js';
import { matchesOidcBootstrapRule } from './oidcBootstrap.js';

export const ACCESS_LEVEL_READ = 'read';
export const ACCESS_LEVEL_WRITE = 'write';
export const ACCESS_LEVELS = [ACCESS_LEVEL_READ, ACCESS_LEVEL_WRITE];

export const RBAC_SCOPE_ALL = 'all';
export const RBAC_SCOPE_SHOW = 'show';
export const RBAC_SCOPE_PROJECT = 'project';
export const RBAC_SCOPE_TRACK = 'track';
export const RBAC_SCOPE_GROUP_NAME = 'group_name';
export const RBAC_SCOPE_PART_NAME = 'part_name';
export const RBAC_SCOPE_TYPES = [
  RBAC_SCOPE_ALL,
  RBAC_SCOPE_SHOW,
  RBAC_SCOPE_PROJECT,
  RBAC_SCOPE_TRACK,
  RBAC_SCOPE_GROUP_NAME,
  RBAC_SCOPE_PART_NAME,
];

export const PROJECT_TARGET_ALL_PROJECTS = 'all_projects';
export const PROJECT_TARGET_PROJECT = 'project';
export const PROJECT_TARGET_GROUP_NAME = 'group_name';
export const PROJECT_TARGET_PART_NAME = 'part_name';
export const PROJECT_TARGET_TYPES = [
  PROJECT_TARGET_ALL_PROJECTS,
  PROJECT_TARGET_PROJECT,
  PROJECT_TARGET_GROUP_NAME,
  PROJECT_TARGET_PART_NAME,
];

export const SHOW_TARGET_ALL_SHOWS = 'all_shows';
export const SHOW_TARGET_SHOW = 'show';
export const SHOW_TARGET_TYPES = [
  SHOW_TARGET_ALL_SHOWS,
  SHOW_TARGET_SHOW,
];

export const TRACK_SCOPE_GROUP_NAME = 'group_name';
export const TRACK_SCOPE_PART_NAME = 'part_name';
export const TRACK_SCOPE_TYPES = [
  TRACK_SCOPE_GROUP_NAME,
  TRACK_SCOPE_PART_NAME,
];
const TRACK_BINDING_SCOPE_TYPES = [
  RBAC_SCOPE_TRACK,
  TRACK_SCOPE_GROUP_NAME,
  TRACK_SCOPE_PART_NAME,
];

export const SCOPE_TYPE_ALL_PROJECTS = PROJECT_TARGET_ALL_PROJECTS;
export const SCOPE_TYPE_PROJECT = PROJECT_TARGET_PROJECT;
export const SCOPE_TYPE_GROUP_NAME = PROJECT_TARGET_GROUP_NAME;
export const SCOPE_TYPE_PART_NAME = PROJECT_TARGET_PART_NAME;
export const SCOPE_TYPES = PROJECT_TARGET_TYPES;

export const PERMISSION_SHOW_MANAGER = 'show_manager';
export const PERMISSION_SHOW_CREATOR = 'show_creator';
export const PERMISSION_SHOW_READER = 'show_reader';
export const PERMISSION_PROJECT_MANAGER = 'project_manager';
export const PERMISSION_PROJECT_CREATOR = 'project_creator';
export const PERMISSION_PROJECT_READER = 'project_reader';
export const PERMISSION_TRACK_MANAGER = 'track_manager';
export const PERMISSION_TRACK_CREATOR = 'track_creator';
export const PERMISSION_TRACK_READER = 'track_reader';
export const PERMISSIONS = [
  PERMISSION_SHOW_MANAGER,
  PERMISSION_SHOW_CREATOR,
  PERMISSION_SHOW_READER,
  PERMISSION_PROJECT_MANAGER,
  PERMISSION_PROJECT_CREATOR,
  PERMISSION_PROJECT_READER,
  PERMISSION_TRACK_MANAGER,
  PERMISSION_TRACK_CREATOR,
  PERMISSION_TRACK_READER,
];

// Legacy exports retained while the rest of the app transitions.
export const CAPABILITY_PLAYER_TUTTI = 'player_tutti';
export const CAPABILITY_PROJECT_READ = 'project_read';
export const CAPABILITY_TRACK_WRITE_OWN = 'track_write_own';
export const CAPABILITY_TRACK_WRITE_SCOPE = 'track_write_scope';
export const CAPABILITY_MANAGE_OWN_PROJECTS = 'manage_own_projects';
export const CAPABILITY_PROJECT_MANAGER = PERMISSION_PROJECT_MANAGER;
export const CAPABILITIES = [
  CAPABILITY_PLAYER_TUTTI,
  CAPABILITY_PROJECT_READ,
  CAPABILITY_TRACK_WRITE_OWN,
  CAPABILITY_TRACK_WRITE_SCOPE,
  CAPABILITY_MANAGE_OWN_PROJECTS,
  CAPABILITY_PROJECT_MANAGER,
];

export const SYSTEM_ROLE_ADMIN_ID = 'system-role-admin';
export const SYSTEM_ROLE_ADMIN_KEY = 'admin';
export const SYSTEM_ROLE_DEFAULT_USER_ID = 'system-role-default-user';
export const SYSTEM_ROLE_DEFAULT_USER_KEY = 'default_user';
export const DEFAULT_EMPTY_ACCESS_MESSAGE = 'You do not currently have any permissions. Please contact an admin if you should.';

const TRACK_ROLE_INSTRUMENT = 'instrument';
const TRACK_ROLE_LEAD = 'lead';
const TRACK_ROLE_CHOIR = 'choir';
const TRACK_ROLE_METRONOME = 'metronome';
const TRACK_ROLE_OTHER = 'other';
const GROUP_ROLE_NONE = 'group';
const GROUP_ROLE_INSTRUMENTS = 'instruments';
const GROUP_ROLE_LEADS = 'leads';
const GROUP_ROLE_CHOIRS = 'choirs';
const GROUP_ROLE_OTHERS = 'others';
const TRACK_NODE_TYPE_GROUP = 'group';
const TRACK_NODE_TYPE_AUDIO = 'audio';

const COUNTABLE_TRACK_ROLES = new Set([
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
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
  ...Array.from({ length: 5 }, (_unused, idx) => `choir-part-${idx + 1}`),
  ...GROUP_PARENT_ROLES,
]);

const PERMISSION_DEFINITIONS = [
  {
    value: PERMISSION_SHOW_MANAGER,
    label: 'Show manager',
    description: 'Full control inside the selected show, including projects and tracks. Does not create new shows.',
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW],
    sortOrder: 0,
  },
  {
    value: PERMISSION_SHOW_CREATOR,
    label: 'Show creator',
    description: 'Can create new shows. Created shows become fully manageable by the creator.',
    allowedScopeTypes: [RBAC_SCOPE_ALL],
    sortOrder: 1,
  },
  {
    value: PERMISSION_SHOW_READER,
    label: 'Show reader',
    description: 'Can see that a show exists in the app.',
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW],
    sortOrder: 2,
  },
  {
    value: PERMISSION_PROJECT_MANAGER,
    label: 'Project manager',
    description: 'Full control of the selected musical numbers and all tracks inside them.',
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW, RBAC_SCOPE_PROJECT],
    sortOrder: 3,
  },
  {
    value: PERMISSION_PROJECT_CREATOR,
    label: 'Project creator',
    description: 'Can create new musical numbers inside the selected shows.',
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW],
    sortOrder: 4,
  },
  {
    value: PERMISSION_PROJECT_READER,
    label: 'Project reader',
    description: 'Can see musical numbers in the DAW dashboard and listen to their tutti mixes in Player.',
    sortOrder: 5,
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW, RBAC_SCOPE_PROJECT],
  },
  {
    value: PERMISSION_TRACK_MANAGER,
    label: 'Track manager',
    description: 'Full control of the selected tracks and their descendant subtracks.',
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW, RBAC_SCOPE_PROJECT, RBAC_SCOPE_TRACK, RBAC_SCOPE_GROUP_NAME, RBAC_SCOPE_PART_NAME],
    sortOrder: 6,
  },
  {
    value: PERMISSION_TRACK_CREATOR,
    label: 'Track creator',
    description: 'Can create tracks or subtracks in the selected scope. Created tracks become fully manageable by the creator.',
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW, RBAC_SCOPE_PROJECT, RBAC_SCOPE_TRACK, RBAC_SCOPE_GROUP_NAME, RBAC_SCOPE_PART_NAME],
    sortOrder: 7,
  },
  {
    value: PERMISSION_TRACK_READER,
    label: 'Track reader',
    description: 'Can open musical numbers in the DAW, create mixes, and listen to tutti.',
    allowedScopeTypes: [RBAC_SCOPE_ALL, RBAC_SCOPE_SHOW, RBAC_SCOPE_PROJECT, RBAC_SCOPE_TRACK, RBAC_SCOPE_GROUP_NAME, RBAC_SCOPE_PART_NAME],
    sortOrder: 8,
  },
];

const PERMISSIONS_WITH_GROUP_PART_FILTERS = new Set([
  PERMISSION_PROJECT_MANAGER,
  PERMISSION_PROJECT_READER,
  PERMISSION_TRACK_MANAGER,
  PERMISSION_TRACK_CREATOR,
  PERMISSION_TRACK_READER,
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBoolean(value) {
  return value === true || normalizeLowerText(value) === 'true';
}

function isProjectPublished(project = null, snapshot = null) {
  return normalizeBoolean(project?.published ?? project?.publish ?? snapshot?.published ?? snapshot?.publish);
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sortByOrder(left, right) {
  return toNumber(left?.order, 0) - toNumber(right?.order, 0);
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function uniqueTextValues(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value))));
}

function normalizeArtistUserIds(value = []) {
  const refs = Array.isArray(value) ? value : [];
  return new Set(refs
    .map((ref) => {
      const type = normalizeLowerText(ref?.type);
      const id = normalizeText(ref?.id || ref?.userId);
      return type === 'user' && id ? id : null;
    })
    .filter(Boolean));
}

function isChoirPartRole(role) {
  return typeof role === 'string' && role.startsWith('choir-part-');
}

function isMetronomeRole(role) {
  return role === TRACK_ROLE_METRONOME;
}

function normalizeTrackRole(role) {
  if (
    role === TRACK_ROLE_INSTRUMENT
    || role === TRACK_ROLE_LEAD
    || role === TRACK_ROLE_CHOIR
    || role === TRACK_ROLE_METRONOME
    || role === TRACK_ROLE_OTHER
    || isChoirPartRole(role)
  ) {
    return role;
  }
  return TRACK_ROLE_OTHER;
}

function normalizeGroupRole(role) {
  return GROUP_ALLOWED_ROLES.has(role) ? role : GROUP_ROLE_NONE;
}

function toCategoryRole(role) {
  const normalized = normalizeTrackRole(role);
  return isChoirPartRole(normalized) ? TRACK_ROLE_CHOIR : normalized;
}

function isGroupParentRole(role) {
  return GROUP_PARENT_ROLES.has(role);
}

function mapGroupParentRoleToTrackRole(role) {
  if (role === GROUP_ROLE_INSTRUMENTS) return TRACK_ROLE_INSTRUMENT;
  if (role === GROUP_ROLE_LEADS) return TRACK_ROLE_LEAD;
  if (role === GROUP_ROLE_CHOIRS) return TRACK_ROLE_CHOIR;
  if (role === GROUP_ROLE_OTHERS) return TRACK_ROLE_OTHER;
  return null;
}

function isLegacyPartGroupRole(role) {
  const normalized = normalizeGroupRole(role);
  return (
    normalized !== GROUP_ROLE_NONE
    && normalized !== GROUP_ROLE_OTHERS
    && !isGroupParentRole(normalized)
  );
}

function normalizePartFlag(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return Boolean(fallback);
}

function enforcePartNestingRule(nodes = []) {
  const childrenByParent = buildChildrenMap(nodes);
  const walk = (parentId, hasPartAncestor) => {
    const key = parentId || '__root__';
    const children = childrenByParent.get(key) || [];
    for (const node of children) {
      if (hasPartAncestor && node.part) {
        node.part = false;
      }
      walk(node.id, hasPartAncestor || Boolean(node.part));
    }
  };
  walk(null, false);
  return nodes;
}

function buildNormalizedTrackTree(snapshot = {}) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  const rawNodes = Array.isArray(snapshot?.trackTree) ? snapshot.trackTree : [];
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const validTrackIds = new Set(tracks.map((track) => track.id));
  const seenTrackIds = new Set();
  const nodes = [];

  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const kind = rawNode.kind === 'group' || rawNode.type === TRACK_NODE_TYPE_GROUP
      ? 'group'
      : ((rawNode.kind === 'track' || rawNode.type === 'track' || rawNode.type === TRACK_NODE_TYPE_AUDIO) ? 'track' : null);
    if (!kind) continue;

    if (kind === 'track') {
      const trackId = rawNode.trackId ?? rawNode.track_id;
      if (!validTrackIds.has(trackId) || seenTrackIds.has(trackId)) {
        continue;
      }
      seenTrackIds.add(trackId);
      nodes.push({
        id: String(rawNode.id ?? `track-node:${trackId}`),
        kind: 'track',
        type: TRACK_NODE_TYPE_AUDIO,
        parentId: typeof rawNode.parentId === 'string' ? rawNode.parentId : null,
        order: toNumber(rawNode.order, 0),
        trackId,
        part: normalizePartFlag(rawNode.part, trackById.get(trackId)?.part),
      });
      continue;
    }

    const role = normalizeGroupRole(rawNode.role);
    nodes.push({
      id: String(rawNode.id ?? `group-node:${nodes.length}`),
      kind: 'group',
      type: TRACK_NODE_TYPE_GROUP,
      parentId: typeof rawNode.parentId === 'string' ? rawNode.parentId : null,
      order: toNumber(rawNode.order, 0),
      name: normalizeText(rawNode.name) || 'Group',
      role,
      part: normalizePartFlag(rawNode.part, isLegacyPartGroupRole(role)),
      collapsed: Boolean(rawNode.collapsed),
      muted: Boolean(rawNode.muted),
      soloed: Boolean(rawNode.soloed),
      volume: Math.max(0, Math.min(100, toNumber(rawNode.volume, 100))),
      pan: Math.max(-100, Math.min(100, toNumber(rawNode.pan, 0))),
    });
  }

  const rootNodes = nodes.filter((node) => !node.parentId);
  const nextRootOrder = rootNodes.reduce((max, node) => Math.max(max, toNumber(node.order, 0)), -1) + 1;

  tracks
    .filter((track) => !seenTrackIds.has(track.id))
    .forEach((track, idx) => {
      nodes.push({
        id: `track-node:${track.id}`,
        kind: 'track',
        type: TRACK_NODE_TYPE_AUDIO,
        parentId: null,
        order: nextRootOrder + idx,
        trackId: track.id,
        part: normalizePartFlag(track.part, false),
      });
    });

  return enforcePartNestingRule(nodes);
}

function mapLegacyCapabilityToPermissionKey(capability, scopeType = null) {
  const normalizedCapability = normalizeLowerText(capability);
  const normalizedScopeType = normalizeLowerText(scopeType);
  if (normalizedCapability === CAPABILITY_PLAYER_TUTTI) {
    return (
      normalizedScopeType === PROJECT_TARGET_GROUP_NAME
      || normalizedScopeType === PROJECT_TARGET_PART_NAME
    )
      ? PERMISSION_TRACK_READER
      : PERMISSION_PROJECT_READER;
  }
  if (normalizedCapability === CAPABILITY_PROJECT_READ) return PERMISSION_TRACK_READER;
  if (normalizedCapability === CAPABILITY_TRACK_WRITE_OWN) return PERMISSION_TRACK_CREATOR;
  if (normalizedCapability === CAPABILITY_TRACK_WRITE_SCOPE) return PERMISSION_TRACK_MANAGER;
  if (normalizedCapability === CAPABILITY_MANAGE_OWN_PROJECTS) return PERMISSION_PROJECT_CREATOR;
  if (normalizedCapability === CAPABILITY_PROJECT_MANAGER) return PERMISSION_PROJECT_MANAGER;
  return null;
}

export function normalizeScopeValue(value) {
  const normalized = normalizeLowerText(value);
  return normalized || null;
}

export function normalizeAccessLevel(value) {
  const normalized = normalizeLowerText(value);
  if (normalized === ACCESS_LEVEL_READ || normalized === ACCESS_LEVEL_WRITE) {
    return normalized;
  }
  throw new Error('Invalid access level');
}

export function normalizeScopeType(value) {
  const normalized = normalizeLowerText(value);
  if (SCOPE_TYPES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid scope type');
}

export function accessLevelToFlags(accessLevel) {
  const normalized = normalizeAccessLevel(accessLevel);
  return {
    canRead: normalized === ACCESS_LEVEL_READ || normalized === ACCESS_LEVEL_WRITE,
    canWrite: normalized === ACCESS_LEVEL_WRITE,
  };
}

export function getHigherAccessLevel(currentLevel, nextLevel) {
  if (normalizeAccessLevel(currentLevel) === ACCESS_LEVEL_WRITE || normalizeAccessLevel(nextLevel) === ACCESS_LEVEL_WRITE) {
    return ACCESS_LEVEL_WRITE;
  }
  return ACCESS_LEVEL_READ;
}

function capabilityToLegacyAccessLevel(capability) {
  const mapped = PERMISSIONS.includes(normalizeLowerText(capability))
    ? normalizeLowerText(capability)
    : mapLegacyCapabilityToPermissionKey(capability);
  const normalized = normalizePermissionKey(mapped);
  if (
    normalized === PERMISSION_SHOW_MANAGER
    || normalized === PERMISSION_PROJECT_MANAGER
    || normalized === PERMISSION_TRACK_MANAGER
  ) {
    return ACCESS_LEVEL_WRITE;
  }
  return ACCESS_LEVEL_READ;
}

function permissionDefinition(permissionKey) {
  return PERMISSION_DEFINITIONS.find((entry) => entry.value === permissionKey) || null;
}

export function normalizeCapability(value) {
  return normalizePermissionKey(mapLegacyCapabilityToPermissionKey(value, PROJECT_TARGET_ALL_PROJECTS));
}

export function normalizePermissionKey(value) {
  const normalized = normalizeLowerText(value);
  if (PERMISSIONS.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid permission');
}

export function normalizeRbacScopeType(value) {
  const normalized = normalizeLowerText(value || RBAC_SCOPE_ALL);
  if (RBAC_SCOPE_TYPES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid scope type');
}

function assertPermissionSupportsScope(permissionKey, scopeType) {
  const definition = permissionDefinition(permissionKey);
  if (!definition) {
    throw new Error('Invalid permission');
  }
  if (!definition.allowedScopeTypes.includes(scopeType)) {
    throw new Error('Invalid scope for selected permission');
  }
  return definition;
}

export function normalizeProjectTargetType(value) {
  return normalizeScopeType(value);
}

export function normalizeShowTargetType(value) {
  const normalized = normalizeLowerText(value || SHOW_TARGET_ALL_SHOWS);
  if (SHOW_TARGET_TYPES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid show target type');
}

export function normalizeTrackScopeType(value) {
  const normalized = normalizeLowerText(value);
  if (TRACK_SCOPE_TYPES.includes(normalized)) {
    return normalized;
  }
  throw new Error('Invalid track scope type');
}

function addTag(tagsByKey, tagType, displayName) {
  const trimmedLabel = normalizeText(displayName);
  const normalizedValue = normalizeScopeValue(trimmedLabel);
  if (!trimmedLabel || !normalizedValue) return;
  const key = `${tagType}:${normalizedValue}`;
  if (tagsByKey.has(key)) return;
  tagsByKey.set(key, {
    tagType,
    tagValue: normalizedValue,
    displayName: trimmedLabel,
  });
}

function buildChildrenMap(nodes = []) {
  const map = new Map();
  for (const node of nodes) {
    const key = node.parentId || '__root__';
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(node);
  }
  for (const siblings of map.values()) {
    siblings.sort(sortByOrder);
  }
  return map;
}

function collectTrackBindingInfo(snapshot = {}) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const nodes = buildNormalizedTrackTree(snapshot);
  const childrenByParent = buildChildrenMap(nodes);
  const infoByTrackId = new Map();

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const walk = (parentId, inherited) => {
    const key = parentId || '__root__';
    const children = childrenByParent.get(key) || [];

    for (const node of children) {
      const nodeParentRole = inherited.parentRole;
      const isImmediateChildOfParentRole = Boolean(nodeParentRole && inherited.parentGroupId === parentId);

      if (node.kind === 'group') {
        const normalizedGroupValue = normalizeScopeValue(node.name);
        const nextAncestorGroupValues = normalizedGroupValue
          ? [...inherited.ancestorGroupValues, normalizedGroupValue]
          : [...inherited.ancestorGroupValues];
        const next = {
          ancestorGroupValues: nextAncestorGroupValues,
          ancestorTrackIds: [...inherited.ancestorTrackIds, String(node.id)],
          parentRole: inherited.parentRole,
          parentGroupId: inherited.parentGroupId,
          parentUnitName: inherited.parentUnitName,
          forcedRole: inherited.forcedRole,
          forcedUnitName: inherited.forcedUnitName,
          choirRole: inherited.choirRole,
          choirUnitName: inherited.choirUnitName,
          partUnitName: inherited.partUnitName,
        };

        if (node.part) {
          next.partUnitName = node.name;
        }

        if (isImmediateChildOfParentRole) {
          next.parentUnitName = node.name;
          if (nodeParentRole === TRACK_ROLE_CHOIR) {
            next.choirRole = next.choirRole || TRACK_ROLE_CHOIR;
            next.choirUnitName = next.parentUnitName;
          }
        }

        const groupRole = normalizeGroupRole(node.role);
        if (isGroupParentRole(groupRole)) {
          const mappedRole = mapGroupParentRoleToTrackRole(groupRole);
          next.parentRole = mappedRole;
          next.parentGroupId = node.id;
          next.parentUnitName = null;
          next.forcedRole = null;
          next.forcedUnitName = null;
          if (mappedRole === TRACK_ROLE_CHOIR) {
            next.choirRole = TRACK_ROLE_CHOIR;
            next.choirUnitName = null;
          } else {
            next.choirRole = null;
            next.choirUnitName = null;
          }
        } else if (groupRole !== GROUP_ROLE_NONE && !nodeParentRole) {
          const categoryRole = toCategoryRole(groupRole);
          next.forcedRole = categoryRole;
          next.forcedUnitName = node.name;
          if (categoryRole === TRACK_ROLE_CHOIR) {
            next.choirRole = isChoirPartRole(groupRole) ? groupRole : TRACK_ROLE_CHOIR;
            next.choirUnitName = next.forcedUnitName;
          } else {
            next.choirRole = null;
            next.choirUnitName = null;
          }
        }

        walk(node.id, next);
        continue;
      }

      const track = trackById.get(node.trackId);
      if (!track) continue;
      const nextAncestorTrackIds = [...inherited.ancestorTrackIds];
      const parentNode = node.parentId ? nodeById.get(node.parentId) : null;
      if (parentNode?.kind === 'track' && parentNode.trackId) {
        nextAncestorTrackIds.push(String(parentNode.trackId));
      }

      const ownRole = toCategoryRole(track.role);
      const inheritedRole = inherited.parentRole || inherited.forcedRole || null;
      const effectiveRole = isMetronomeRole(track.role)
        ? TRACK_ROLE_METRONOME
        : (inheritedRole || ownRole);
      const isImmediateTrackChildOfParentRole = Boolean(inherited.parentRole && inherited.parentGroupId === parentId);

      let roleUnitName = null;
      if (COUNTABLE_TRACK_ROLES.has(effectiveRole)) {
        if (inherited.parentRole && effectiveRole === inherited.parentRole) {
          roleUnitName = isImmediateTrackChildOfParentRole
            ? track.name
            : (inherited.parentUnitName || track.name);
        } else if (inherited.forcedRole && effectiveRole === inherited.forcedRole) {
          roleUnitName = inherited.forcedUnitName || track.name;
        } else {
          roleUnitName = track.name;
        }
      }

      let choirUnitName = null;
      if (effectiveRole === TRACK_ROLE_CHOIR) {
        if (inherited.parentRole === TRACK_ROLE_CHOIR) {
          choirUnitName = isImmediateTrackChildOfParentRole
            ? track.name
            : (inherited.parentUnitName || roleUnitName || track.name);
        } else {
          choirUnitName = inherited.choirUnitName || roleUnitName || track.name;
        }
      }

      const derivedPartValues = new Set();
      const explicitPartName = node.part || track.part
        ? track.name
        : inherited.partUnitName;
      const explicitPartValue = normalizeScopeValue(explicitPartName);
      if (explicitPartValue) {
        derivedPartValues.add(explicitPartValue);
      }

      if (!derivedPartValues.size) {
        if (effectiveRole === TRACK_ROLE_INSTRUMENT || effectiveRole === TRACK_ROLE_LEAD) {
          const normalized = normalizeScopeValue(roleUnitName);
          if (normalized) derivedPartValues.add(normalized);
        }
        if (effectiveRole === TRACK_ROLE_CHOIR) {
          const normalized = normalizeScopeValue(choirUnitName);
          if (normalized) derivedPartValues.add(normalized);
        }
      }

      infoByTrackId.set(track.id, {
        trackId: track.id,
        nodeId: node.id,
        name: normalizeText(track.name) || 'Untitled track',
        parentId: node.parentId || null,
        ancestorTrackIds: nextAncestorTrackIds,
        createdByUserId: normalizeText(track.createdByUserId) || null,
        artistUserIds: normalizeArtistUserIds(track.artistRefs),
        accessScopeType: TRACK_BINDING_SCOPE_TYPES.includes(normalizeLowerText(track.accessScopeType))
          ? normalizeLowerText(track.accessScopeType)
          : null,
        accessScopeValue: normalizeScopeValue(track.accessScopeValue),
        derivedGroupValues: new Set(inherited.ancestorGroupValues),
        derivedPartValues,
      });

      walk(node.id, {
        ...inherited,
        ancestorTrackIds: [...nextAncestorTrackIds, String(track.id), String(node.id)],
        partUnitName: node.part || track.part ? track.name : inherited.partUnitName,
      });
    }
  };

  walk(null, {
    ancestorGroupValues: [],
    ancestorTrackIds: [],
    parentRole: null,
    parentGroupId: null,
    parentUnitName: null,
    forcedRole: null,
    forcedUnitName: null,
    choirRole: null,
    choirUnitName: null,
    partUnitName: null,
  });

  for (const track of tracks) {
    if (infoByTrackId.has(track.id) || isMetronomeRole(track.role)) continue;
    const normalizedTrackName = normalizeScopeValue(track.name);
    const derivedPartValues = new Set();
    const effectiveRole = toCategoryRole(track.role);
    if (track.part) {
      if (normalizedTrackName) {
        derivedPartValues.add(normalizedTrackName);
      }
    }
    if (
      !derivedPartValues.size
      && (
        effectiveRole === TRACK_ROLE_INSTRUMENT
        || effectiveRole === TRACK_ROLE_LEAD
        || effectiveRole === TRACK_ROLE_CHOIR
      )
      && normalizedTrackName
    ) {
      derivedPartValues.add(normalizedTrackName);
    }
    infoByTrackId.set(track.id, {
      trackId: track.id,
      nodeId: `track-node:${track.id}`,
      name: normalizeText(track.name) || 'Untitled track',
      parentId: null,
      ancestorTrackIds: [],
      createdByUserId: normalizeText(track.createdByUserId) || null,
      artistUserIds: normalizeArtistUserIds(track.artistRefs),
      accessScopeType: TRACK_BINDING_SCOPE_TYPES.includes(normalizeLowerText(track.accessScopeType))
        ? normalizeLowerText(track.accessScopeType)
        : null,
      accessScopeValue: normalizeScopeValue(track.accessScopeValue),
      derivedGroupValues: new Set(),
      derivedPartValues,
    });
  }

  return infoByTrackId;
}

export function extractProjectAccessTags(snapshot = {}) {
  const tagsByKey = new Map();
  const trackTree = buildNormalizedTrackTree(snapshot);
  for (const node of trackTree) {
    if (node?.kind !== 'group') continue;
    addTag(tagsByKey, PROJECT_TARGET_GROUP_NAME, node?.name);
    if (node.part) {
      addTag(tagsByKey, PROJECT_TARGET_PART_NAME, node?.name);
    }
  }

  const trackBindings = collectTrackBindingInfo(snapshot);
  for (const info of trackBindings.values()) {
    info.derivedPartValues.forEach((value) => addTag(tagsByKey, PROJECT_TARGET_PART_NAME, value));
  }

  return Array.from(tagsByKey.values()).sort((left, right) => {
    if (left.tagType !== right.tagType) return left.tagType.localeCompare(right.tagType);
    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}

export async function replaceProjectAccessTags(db, projectId, snapshot = {}) {
  await db.query('DELETE FROM project_access_tags WHERE project_id = $1', [projectId]);
  const tags = extractProjectAccessTags(snapshot);
  for (const tag of tags) {
    await db.query(
      `INSERT INTO project_access_tags(project_id, tag_type, tag_value, display_name)
       VALUES($1, $2, $3, $4)`,
      [projectId, tag.tagType, tag.tagValue, tag.displayName]
    );
  }
}

export async function syncAllProjectAccessTags(db = pool) {
  const result = await db.query(
    `SELECT project_id AS "projectId", latest_snapshot_json AS "snapshot"
     FROM project_heads`
  );
  for (const row of result.rows) {
    await replaceProjectAccessTags(db, row.projectId, row.snapshot || {});
  }
}

function buildTagMapFromRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.projectId)) {
      map.set(row.projectId, {
        [PROJECT_TARGET_GROUP_NAME]: new Set(),
        [PROJECT_TARGET_PART_NAME]: new Set(),
      });
    }
    const tags = map.get(row.projectId);
    if (row.tagType === PROJECT_TARGET_GROUP_NAME || row.tagType === PROJECT_TARGET_PART_NAME) {
      tags[row.tagType].add(row.tagValue);
    }
  }
  return map;
}

function mapRoleRow(row) {
  const systemKey = row.systemKey || row.system_key || '';
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    emptyAccessMessage: row.emptyAccessMessage || row.empty_access_message || '',
    isSystem: Boolean(row.isSystem ?? row.is_system),
    systemKey,
    membersHidden: systemKey === SYSTEM_ROLE_DEFAULT_USER_KEY,
    memberCount: Number(row.memberCount || row.member_count || 0),
    grantCount: Number(row.grantCount || row.grant_count || 0),
    parentCount: Number(row.parentCount || row.parent_count || 0),
    linkCount: Number(row.linkCount || row.link_count || 0),
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
  };
}

export function getPermissionCatalog() {
  return PERMISSION_DEFINITIONS.map((entry) => ({ ...entry }));
}

export function getCapabilityCatalog() {
  return getPermissionCatalog();
}

export function getPermissionLabel(permissionKey) {
  return permissionDefinition(normalizePermissionKey(permissionKey))?.label || permissionKey;
}

export function getCapabilityLabel(capability) {
  const permissionKey = mapLegacyCapabilityToPermissionKey(capability, PROJECT_TARGET_ALL_PROJECTS);
  return permissionKey ? getPermissionLabel(permissionKey) : capability;
}

export async function getRoleBySystemKey(systemKey, db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            description,
            empty_access_message AS "emptyAccessMessage",
            is_system AS "isSystem",
            system_key AS "systemKey",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_roles r
     WHERE system_key = $1
     LIMIT 1`,
    [systemKey]
  );
  return result.rows[0] ? mapRoleRow(result.rows[0]) : null;
}

export async function getAdminRole(db = pool) {
  return await getRoleBySystemKey(SYSTEM_ROLE_ADMIN_KEY, db);
}

export async function getDefaultUserRole(db = pool) {
  return await getRoleBySystemKey(SYSTEM_ROLE_DEFAULT_USER_KEY, db);
}

function isAdminSystemRole(role) {
  return role?.systemKey === SYSTEM_ROLE_ADMIN_KEY;
}

function isDefaultUserSystemRole(role) {
  return role?.systemKey === SYSTEM_ROLE_DEFAULT_USER_KEY;
}

async function assertRoleExists(roleId, db = pool) {
  const role = await getRoleById(roleId, db);
  if (!role) {
    throw new Error('Role not found');
  }
  return role;
}

async function assertRoleDefinitionEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) {
    throw new Error('System roles cannot be renamed or deleted');
  }
  return role;
}

async function assertRoleGrantEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isAdminSystemRole(role)) {
    throw new Error('Admin role grants cannot be modified');
  }
  return role;
}

async function assertRoleMembershipEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isDefaultUserSystemRole(role)) {
    throw new Error('Default user membership is automatic');
  }
  return role;
}

async function assertRoleInheritanceEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) {
    throw new Error('System roles cannot participate in role inheritance');
  }
  return role;
}

export async function userHasAdminRole(userId, db = pool) {
  const result = await db.query(
    `SELECT EXISTS(
       SELECT 1
       FROM rbac_role_memberships rm
       JOIN rbac_roles r
         ON r.id = rm.role_id
       WHERE rm.user_id = $1
         AND r.system_key = $2
     ) AS "isAdmin"`,
    [userId, SYSTEM_ROLE_ADMIN_KEY]
  );
  return Boolean(result.rows[0]?.isAdmin);
}

export async function countActiveAdminUsers(db = pool) {
  const result = await db.query(
    `SELECT COUNT(*)::integer AS "count"
     FROM users u
     JOIN rbac_role_memberships rm
       ON rm.user_id = u.id
     JOIN rbac_roles r
       ON r.id = rm.role_id
     WHERE u.is_active = TRUE
       AND r.system_key = $1`,
    [SYSTEM_ROLE_ADMIN_KEY]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function assertUserCanLoseAdminRole(userId, db = pool) {
  const isAdmin = await userHasAdminRole(userId, db);
  if (!isAdmin) return;
  const userResult = await db.query('SELECT is_active AS "isActive" FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0];
  if (!user?.isActive) return;
  const activeAdminCount = await countActiveAdminUsers(db);
  if (activeAdminCount <= 1) {
    throw new Error('At least one active admin user must remain');
  }
}

export async function listRoles(db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_roles r
     ORDER BY CASE
       WHEN r.system_key = 'admin' THEN 0
       WHEN r.system_key = 'default_user' THEN 1
       WHEN r.is_system THEN 2
       ELSE 3
     END,
     r.name ASC`
  );
  return result.rows.map(mapRoleRow);
}

export async function getRoleById(roleId, db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_roles r
     WHERE r.id = $1`,
    [roleId]
  );
  return result.rowCount === 0 ? null : mapRoleRow(result.rows[0]);
}

export async function createRole({ name, description = '' }, actorUserId = null, db = pool) {
  const trimmedName = normalizeText(name);
  if (!trimmedName) {
    throw new Error('Role name is required');
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO rbac_roles(id, name, description, created_by)
     VALUES($1, $2, $3, $4)`,
    [id, trimmedName, normalizeText(description), actorUserId]
  );
  return await getRoleById(id, db);
}

export async function listRoleParents(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) return [];
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri2 WHERE ri2.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_role_inheritance ri
     JOIN rbac_roles r
       ON r.id = ri.parent_role_id
     WHERE ri.role_id = $1
     ORDER BY r.name ASC`,
    [roleId]
  );
  return result.rows.map(mapRoleRow);
}

export async function listRoleChildren(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) return [];
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm WHERE rm.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri2 WHERE ri2.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_role_inheritance ri
     JOIN rbac_roles r
       ON r.id = ri.role_id
     WHERE ri.parent_role_id = $1
     ORDER BY r.name ASC`,
    [roleId]
  );
  return result.rows.map(mapRoleRow);
}

async function assertRoleParentsValid(roleId, parentRoleIds, db = pool) {
  await assertRoleInheritanceEditable(roleId, db);
  const normalizedParentIds = uniqueTextValues(parentRoleIds);
  if (normalizedParentIds.includes(roleId)) {
    throw new Error('Role cannot inherit from itself');
  }
  if (!normalizedParentIds.length) {
    return [];
  }

  const parentResult = await db.query(
    `SELECT id,
            is_system AS "isSystem"
     FROM rbac_roles
     WHERE id = ANY($1::text[])`,
    [normalizedParentIds]
  );
  if (parentResult.rowCount !== normalizedParentIds.length) {
    throw new Error('Parent role not found');
  }
  if (parentResult.rows.some((row) => row.isSystem)) {
    throw new Error('System roles cannot participate in role inheritance');
  }

  const cycleResult = await db.query(
    `WITH RECURSIVE ancestors(id) AS (
       SELECT unnest($1::text[])
       UNION
       SELECT ri.parent_role_id
       FROM rbac_role_inheritance ri
       JOIN ancestors a
         ON ri.role_id = a.id
     )
     SELECT 1
     FROM ancestors
     WHERE id = $2
     LIMIT 1`,
    [normalizedParentIds, roleId]
  );
  if (cycleResult.rowCount > 0) {
    throw new Error('Role inheritance cannot contain cycles');
  }

  return normalizedParentIds;
}

export async function setRoleParents(roleId, parentRoleIds = [], db = pool) {
  const normalizedParentIds = await assertRoleParentsValid(roleId, parentRoleIds, db);
  const client = db === pool ? await pool.connect() : db;
  const release = db === pool;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM rbac_role_inheritance WHERE role_id = $1', [roleId]);
    for (const parentRoleId of normalizedParentIds) {
      await client.query(
        `INSERT INTO rbac_role_inheritance(role_id, parent_role_id)
         VALUES($1, $2)
         ON CONFLICT (role_id, parent_role_id) DO NOTHING`,
        [roleId, parentRoleId]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (release) client.release();
  }
}

export async function updateRole(roleId, { name, description, emptyAccessMessage, parentRoleIds } = {}, db = pool) {
  const role = await assertRoleExists(roleId, db);

  if (isAdminSystemRole(role)) {
    throw new Error('Admin role cannot be modified');
  }

  if (isDefaultUserSystemRole(role)) {
    if (name !== undefined || description !== undefined || parentRoleIds !== undefined) {
      throw new Error('Default user role cannot be modified');
    }
    if (emptyAccessMessage === undefined) {
      throw new Error('No valid role fields to update');
    }
    await db.query(
      `UPDATE rbac_roles
       SET empty_access_message = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [roleId, normalizeText(emptyAccessMessage) || DEFAULT_EMPTY_ACCESS_MESSAGE]
    );
    return await getRoleById(roleId, db);
  }

  const client = db === pool ? await pool.connect() : db;
  const release = db === pool;
  try {
    await client.query('BEGIN');
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      const trimmedName = normalizeText(name);
      if (!trimmedName) {
        throw new Error('Role name is required');
      }
      updates.push(`name = $${idx++}`);
      values.push(trimmedName);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(normalizeText(description));
    }
    if (emptyAccessMessage !== undefined) {
      throw new Error('Only the default user role can store a no-access message');
    }

    if (updates.length) {
      updates.push('updated_at = NOW()');
      values.push(roleId);
      await client.query(
        `UPDATE rbac_roles
         SET ${updates.join(', ')}
         WHERE id = $${idx}`,
        values
      );
    }

    if (parentRoleIds !== undefined) {
      await setRoleParents(roleId, parentRoleIds, client);
    }

    if (!updates.length && parentRoleIds === undefined) {
      throw new Error('No valid role fields to update');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (release) client.release();
  }
  return await getRoleById(roleId, db);
}

export async function deleteRole(roleId, db = pool) {
  await assertRoleDefinitionEditable(roleId, db);
  await db.query('DELETE FROM rbac_roles WHERE id = $1', [roleId]);
}

function serializeOidcLinkRow(row) {
  return {
    id: row.id,
    roleId: row.role_id || row.roleId,
    claimPath: row.claim_path || row.claimPath || '',
    claimValue: row.claim_value || row.claimValue || '',
    description: row.description || '',
    createdBy: row.created_by || row.createdBy || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function buildOidcLinkRule(link) {
  const claimPath = normalizeText(link?.claim_path || link?.claimPath);
  const claimValue = normalizeText(link?.claim_value || link?.claimValue);
  return claimPath ? `${claimPath}=${claimValue}` : claimValue;
}

async function assertRoleOidcLinkEditable(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isDefaultUserSystemRole(role)) {
    throw new Error('Default user role links are automatic');
  }
  return role;
}

export async function listRoleOidcLinks(roleId, db = pool) {
  await assertRoleExists(roleId, db);
  const result = await db.query(
    `SELECT id,
            role_id,
            claim_path,
            claim_value,
            description,
            created_by,
            created_at,
            updated_at
     FROM rbac_role_oidc_links
     WHERE role_id = $1
     ORDER BY claim_path ASC, claim_value ASC, created_at ASC`,
    [roleId]
  );
  return result.rows.map(serializeOidcLinkRow);
}

export async function createRoleOidcLink(roleId, { claimPath = '', claimValue = '', description = '' } = {}, actorUserId = null, db = pool) {
  await assertRoleOidcLinkEditable(roleId, db);
  const normalizedClaimPath = normalizeText(claimPath);
  const normalizedClaimValue = normalizeText(claimValue);
  if (!normalizedClaimValue) {
    throw new Error('OIDC link value is required');
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO rbac_role_oidc_links(id, role_id, claim_path, claim_value, description, created_by)
     VALUES($1, $2, $3, $4, $5, $6)`,
    [id, roleId, normalizedClaimPath, normalizedClaimValue, normalizeText(description), actorUserId]
  );
  const result = await db.query(
    `SELECT id,
            role_id,
            claim_path,
            claim_value,
            description,
            created_by,
            created_at,
            updated_at
     FROM rbac_role_oidc_links
     WHERE id = $1`,
    [id]
  );
  return serializeOidcLinkRow(result.rows[0]);
}

export async function deleteRoleOidcLink(roleId, linkId, db = pool) {
  await assertRoleOidcLinkEditable(roleId, db);
  const result = await db.query(
    `DELETE FROM rbac_role_oidc_links
     WHERE id = $1
       AND role_id = $2
     RETURNING id`,
    [linkId, roleId]
  );
  if (result.rowCount === 0) {
    throw new Error('OIDC link not found');
  }
}

export async function applyOidcRoleLinksForUser(userId, rawClaims = {}, db = pool) {
  const result = await db.query(
    `SELECT ol.id,
            ol.role_id,
            ol.claim_path,
            ol.claim_value
     FROM rbac_role_oidc_links ol
     JOIN rbac_roles r
       ON r.id = ol.role_id
     WHERE r.system_key IS DISTINCT FROM $1
     ORDER BY ol.created_at ASC`,
    [SYSTEM_ROLE_DEFAULT_USER_KEY]
  );

  const matchedLinksByRoleId = new Map();
  for (const link of result.rows) {
    if (matchesOidcBootstrapRule(rawClaims || {}, buildOidcLinkRule(link))) {
      matchedLinksByRoleId.set(link.role_id, link.id);
    }
  }

  for (const [roleId, linkId] of matchedLinksByRoleId.entries()) {
    await db.query(
      `INSERT INTO rbac_role_memberships(role_id, user_id, added_by, source, source_oidc_link_id)
       VALUES($1, $2, NULL, 'oidc_link', $3)
       ON CONFLICT (role_id, user_id) DO UPDATE
       SET source = CASE
             WHEN rbac_role_memberships.source = 'oidc_link' THEN 'oidc_link'
             ELSE rbac_role_memberships.source
           END,
           source_oidc_link_id = CASE
             WHEN rbac_role_memberships.source = 'oidc_link' THEN EXCLUDED.source_oidc_link_id
             ELSE rbac_role_memberships.source_oidc_link_id
           END`,
      [roleId, userId, linkId]
    );
  }

  return Array.from(matchedLinksByRoleId.keys());
}

export async function listRoleMembers(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (isDefaultUserSystemRole(role)) {
    return [];
  }
  const result = await db.query(
    `SELECT u.id,
            u.username,
            u.is_active AS "isActive",
            EXISTS(
              SELECT 1
              FROM rbac_role_memberships arm
              JOIN rbac_roles ar
                ON ar.id = arm.role_id
              WHERE arm.user_id = u.id
                AND ar.system_key = $2
            ) AS "isAdmin",
            rm.source,
            rm.created_at AS "addedAt"
     FROM rbac_role_memberships rm
     JOIN users u
       ON u.id = rm.user_id
     WHERE rm.role_id = $1
     ORDER BY u.username ASC`,
    [roleId, SYSTEM_ROLE_ADMIN_KEY]
  );
  return result.rows.map((row) => ({
    id: row.id,
    username: row.username,
    isActive: Boolean(row.isActive),
    isAdmin: Boolean(row.isAdmin),
    source: row.source || 'manual',
    addedAt: row.addedAt,
  }));
}

export async function addRoleMember(roleId, userId, actorUserId = null, db = pool) {
  await assertRoleMembershipEditable(roleId, db);
  const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    throw new Error('User not found');
  }
  await db.query(
    `INSERT INTO rbac_role_memberships(role_id, user_id, added_by, source)
     VALUES($1, $2, $3, 'manual')
     ON CONFLICT (role_id, user_id) DO NOTHING`,
    [roleId, userId, actorUserId]
  );
}

export async function removeRoleMember(roleId, userId, db = pool) {
  const role = await assertRoleMembershipEditable(roleId, db);
  if (role.systemKey === SYSTEM_ROLE_ADMIN_KEY) {
    await assertUserCanLoseAdminRole(userId, db);
  }
  await db.query(
    `DELETE FROM rbac_role_memberships
     WHERE role_id = $1 AND user_id = $2`,
    [roleId, userId]
  );
}

export async function listUserRoles(userId, { includeDefaultUserRole = false } = {}, db = pool) {
  const result = await db.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.empty_access_message AS "emptyAccessMessage",
            r.is_system AS "isSystem",
            r.system_key AS "systemKey",
            r.created_at AS "createdAt",
            r.updated_at AS "updatedAt",
            (SELECT COUNT(*)::integer FROM rbac_role_memberships rm2 WHERE rm2.role_id = r.id) AS "memberCount",
            (SELECT COUNT(*)::integer FROM rbac_grants g WHERE g.role_id = r.id) AS "grantCount",
            (SELECT COUNT(*)::integer FROM rbac_role_inheritance ri WHERE ri.role_id = r.id) AS "parentCount",
            (SELECT COUNT(*)::integer FROM rbac_role_oidc_links ol WHERE ol.role_id = r.id) AS "linkCount"
     FROM rbac_role_memberships rm
     JOIN rbac_roles r
       ON r.id = rm.role_id
     WHERE rm.user_id = $1
       AND ($2::boolean = TRUE OR r.system_key IS DISTINCT FROM $3)
     ORDER BY r.is_system DESC, r.name ASC`,
    [userId, includeDefaultUserRole, SYSTEM_ROLE_DEFAULT_USER_KEY]
  );
  return result.rows.map(mapRoleRow);
}

export async function ensureDefaultUserRoleMembership(userId, db = pool) {
  const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    throw new Error('User not found');
  }
  await db.query(
    `INSERT INTO rbac_role_memberships(role_id, user_id, added_by, source)
     VALUES($1, $2, NULL, 'system')
     ON CONFLICT (role_id, user_id) DO NOTHING`,
    [SYSTEM_ROLE_DEFAULT_USER_ID, userId]
  );
}

async function listResolvedRoleIdsForUser(userId, db = pool) {
  const result = await db.query(
    `WITH RECURSIVE resolved(role_id) AS (
       SELECT rm.role_id
       FROM rbac_role_memberships rm
       WHERE rm.user_id = $1
       UNION
       SELECT ri.parent_role_id
       FROM rbac_role_inheritance ri
       JOIN resolved r
         ON ri.role_id = r.role_id
     )
     SELECT DISTINCT role_id AS id
     FROM resolved`,
    [userId]
  );
  return result.rows.map((row) => row.id);
}

function legacyGrantScopeType(row = {}) {
  const projectTargetType = row.project_target_type || row.projectTargetType || row.scope_type || row.scopeType || null;
  const showTargetType = row.show_target_type || row.showTargetType || null;
  if (projectTargetType === PROJECT_TARGET_PROJECT) return RBAC_SCOPE_PROJECT;
  if (projectTargetType === PROJECT_TARGET_GROUP_NAME) return RBAC_SCOPE_GROUP_NAME;
  if (projectTargetType === PROJECT_TARGET_PART_NAME) return RBAC_SCOPE_PART_NAME;
  if (showTargetType === SHOW_TARGET_SHOW) return RBAC_SCOPE_SHOW;
  return RBAC_SCOPE_ALL;
}

function legacyGrantScopeValue(row = {}) {
  const scopeType = legacyGrantScopeType(row);
  if (scopeType === RBAC_SCOPE_SHOW) {
    return {
      scopeShowId: row.show_target_show_id || row.showTargetShowId || null,
      scopeProjectId: null,
      scopeTrackId: null,
      scopeNameValue: null,
      scopeLabel: row.show_target_label || row.showTargetLabel || '',
    };
  }
  if (scopeType === RBAC_SCOPE_PROJECT) {
    return {
      scopeShowId: row.show_target_show_id || row.showTargetShowId || null,
      scopeProjectId: row.project_target_project_id || row.projectTargetProjectId || row.scope_project_id || row.scopeProjectId || null,
      scopeTrackId: null,
      scopeNameValue: null,
      scopeLabel: row.project_target_label || row.projectTargetLabel || row.scope_label || row.scopeLabel || '',
    };
  }
  if (scopeType === RBAC_SCOPE_GROUP_NAME || scopeType === RBAC_SCOPE_PART_NAME) {
    return {
      scopeShowId: null,
      scopeProjectId: null,
      scopeTrackId: null,
      scopeNameValue: row.project_target_value || row.projectTargetValue || row.scope_value || row.scopeValue || null,
      scopeLabel: row.project_target_label || row.projectTargetLabel || row.scope_label || row.scopeLabel || '',
    };
  }
  return {
    scopeShowId: null,
    scopeProjectId: null,
    scopeTrackId: null,
    scopeNameValue: null,
    scopeLabel: row.scope_label || row.scopeLabel || 'All',
  };
}

function serializeGrantRow(row) {
  const permissionKey = row.permission_key || row.permissionKey
    || mapLegacyCapabilityToPermissionKey(row.capability, row.project_target_type || row.projectTargetType || null);
  const normalizedPermissionKey = normalizePermissionKey(permissionKey);
  const scopeType = row.scope_type || row.scopeType || legacyGrantScopeType(row);
  const normalizedScopeType = normalizeRbacScopeType(scopeType);
  const legacyScope = legacyGrantScopeValue(row);
  const scopeShowId = row.scope_show_id || row.scopeShowId || legacyScope.scopeShowId || null;
  const scopeProjectId = row.scope_project_id || row.scopeProjectId || legacyScope.scopeProjectId || null;
  const scopeTrackId = row.scope_track_id || row.scopeTrackId || null;
  const scopeNameValue = row.scope_name_value || row.scopeNameValue || legacyScope.scopeNameValue || null;
  const scopeLabel = row.scope_label || row.scopeLabel || legacyScope.scopeLabel || (normalizedScopeType === RBAC_SCOPE_ALL ? 'All' : '');
  const scopeGroupNameValue = normalizeScopeValue(row.scope_group_name_value || row.scopeGroupNameValue || (normalizedScopeType === RBAC_SCOPE_GROUP_NAME ? scopeNameValue : null));
  const scopeGroupLabel = row.scope_group_label || row.scopeGroupLabel || (normalizedScopeType === RBAC_SCOPE_GROUP_NAME ? scopeLabel : '') || '';
  const scopePartNameValue = normalizeScopeValue(row.scope_part_name_value || row.scopePartNameValue || (normalizedScopeType === RBAC_SCOPE_PART_NAME ? scopeNameValue : null));
  const scopePartLabel = row.scope_part_label || row.scopePartLabel || (normalizedScopeType === RBAC_SCOPE_PART_NAME ? scopeLabel : '') || '';
  const compatibility = capabilityToLegacyAccessLevel(normalizedPermissionKey);

  const showTargetType = normalizedScopeType === RBAC_SCOPE_SHOW
    ? SHOW_TARGET_SHOW
    : SHOW_TARGET_ALL_SHOWS;
  const projectTargetType = normalizedScopeType === RBAC_SCOPE_PROJECT
    ? PROJECT_TARGET_PROJECT
    : (normalizedScopeType === RBAC_SCOPE_GROUP_NAME
      ? PROJECT_TARGET_GROUP_NAME
      : (normalizedScopeType === RBAC_SCOPE_PART_NAME ? PROJECT_TARGET_PART_NAME : PROJECT_TARGET_ALL_PROJECTS));

  return {
    id: row.id,
    permissionKey: normalizedPermissionKey,
    permissionLabel: getPermissionLabel(normalizedPermissionKey),
    scopeType: normalizedScopeType,
    scopeShowId,
    scopeProjectId,
    scopeTrackId,
    scopeNameValue,
    scopeLabel,
    scopeGroupNameValue,
    scopeGroupLabel,
    scopePartNameValue,
    scopePartLabel,
    roleId: row.role_id || row.roleId || null,
    userId: row.user_id || row.userId || null,
    grantedBy: row.granted_by || row.grantedBy || null,
    sourceType: row.sourceType || row.source_type || 'direct',
    sourceRoleId: row.sourceRoleId || row.source_role_id || null,
    sourceRoleName: row.sourceRoleName || row.source_role_name || '',
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,

    capability: normalizedPermissionKey,
    capabilityLabel: getPermissionLabel(normalizedPermissionKey),
    projectTargetType,
    projectTargetProjectId: scopeProjectId,
    projectTargetValue: scopeNameValue,
    projectTargetLabel: normalizedScopeType === RBAC_SCOPE_PROJECT || normalizedScopeType === RBAC_SCOPE_GROUP_NAME || normalizedScopeType === RBAC_SCOPE_PART_NAME
      ? scopeLabel
      : '',
    showTargetType,
    showTargetShowId: scopeShowId,
    showTargetLabel: normalizedScopeType === RBAC_SCOPE_SHOW ? scopeLabel : 'All shows',
    trackScopeType: normalizedScopeType === RBAC_SCOPE_GROUP_NAME || normalizedScopeType === RBAC_SCOPE_PART_NAME || normalizedScopeType === RBAC_SCOPE_TRACK
      ? normalizedScopeType
      : null,
    trackScopeValue: normalizedScopeType === RBAC_SCOPE_TRACK ? scopeTrackId : scopeNameValue,
    trackScopeLabel: normalizedScopeType === RBAC_SCOPE_TRACK || normalizedScopeType === RBAC_SCOPE_GROUP_NAME || normalizedScopeType === RBAC_SCOPE_PART_NAME
      ? scopeLabel
      : '',

    accessLevel: compatibility,
    canRead: normalizedPermissionKey !== PERMISSION_SHOW_CREATOR,
    canWrite: normalizedPermissionKey === PERMISSION_SHOW_MANAGER || normalizedPermissionKey === PERMISSION_PROJECT_MANAGER || normalizedPermissionKey === PERMISSION_TRACK_MANAGER,
    scopeValue: scopeNameValue,
  };
}

export async function listResolvedGrantsForUser(userId, db = pool) {
  const roleIds = await listResolvedRoleIdsForUser(userId, db);
  const result = await db.query(
    `SELECT g.id,
            g.role_id,
            g.user_id,
            g.permission_key,
            g.scope_type,
            g.scope_show_id,
            g.scope_project_id,
            g.scope_track_id,
            g.scope_name_value,
            g.scope_group_name_value,
            g.scope_group_label,
            g.scope_part_name_value,
            g.scope_part_label,
            g.scope_label,
            g.capability,
            g.project_target_type,
            g.project_target_project_id,
            g.project_target_value,
            g.project_target_label,
            g.show_target_type,
            g.show_target_show_id,
            g.show_target_label,
            g.track_scope_type,
            g.track_scope_value,
            g.track_scope_label,
            g.granted_by,
            g.created_at,
            g.updated_at,
            'direct' AS "sourceType",
            NULL::text AS "sourceRoleId",
            NULL::text AS "sourceRoleName"
     FROM rbac_grants g
     WHERE g.user_id = $1
     UNION ALL
     SELECT g.id,
            g.role_id,
            g.user_id,
            g.permission_key,
            g.scope_type,
            g.scope_show_id,
            g.scope_project_id,
            g.scope_track_id,
            g.scope_name_value,
            g.scope_group_name_value,
            g.scope_group_label,
            g.scope_part_name_value,
            g.scope_part_label,
            g.scope_label,
            g.capability,
            g.project_target_type,
            g.project_target_project_id,
            g.project_target_value,
            g.project_target_label,
            g.show_target_type,
            g.show_target_show_id,
            g.show_target_label,
            g.track_scope_type,
            g.track_scope_value,
            g.track_scope_label,
            g.granted_by,
            g.created_at,
            g.updated_at,
            'role' AS "sourceType",
            r.id AS "sourceRoleId",
            r.name AS "sourceRoleName"
     FROM rbac_grants g
     JOIN rbac_roles r
       ON r.id = g.role_id
     WHERE g.role_id = ANY($2::text[])`,
    [userId, roleIds.length ? roleIds : ['']]
  );
  return result.rows.map(serializeGrantRow);
}

async function loadProjectTagRows(projectIds = null, db = pool) {
  const hasProjectIds = Array.isArray(projectIds) && projectIds.length > 0;
  const result = await db.query(
    `SELECT project_id AS "projectId",
            tag_type AS "tagType",
            tag_value AS "tagValue"
     FROM project_access_tags
     WHERE $1::boolean = FALSE OR project_id = ANY($2::text[])`,
    [hasProjectIds, hasProjectIds ? projectIds : []]
  );
  return result.rows;
}

async function loadProjectRows(projectIds = [], db = pool) {
  const normalizedProjectIds = uniqueTextValues(projectIds);
  if (!normalizedProjectIds.length) return [];
  const result = await db.query(
    `SELECT p.id,
            p.name,
            p.created_by AS "createdByUserId",
            p.published,
            p.musical_number AS "musicalNumber",
            p.scene_order AS "sceneOrder",
            p.show_id AS "showId",
            s.name AS "showName",
            s.created_by AS "showCreatedByUserId"
     FROM projects p
     LEFT JOIN shows s
       ON s.id = p.show_id
     WHERE p.id = ANY($1::text[])`,
    [normalizedProjectIds]
  );
  return result.rows;
}

async function loadProjectHeadRows(projectIds = [], db = pool) {
  const normalizedProjectIds = uniqueTextValues(projectIds);
  if (!normalizedProjectIds.length) return [];
  const result = await db.query(
    `SELECT project_id AS "projectId",
            latest_snapshot_json AS snapshot
     FROM project_heads
     WHERE project_id = ANY($1::text[])`,
    [normalizedProjectIds]
  );
  return result.rows;
}

async function loadProjectRow(projectId, db = pool) {
  const rows = await loadProjectRows([projectId], db);
  return rows[0] || null;
}

async function loadShowRows(showIds = [], db = pool) {
  const normalizedShowIds = uniqueTextValues(showIds);
  if (!normalizedShowIds.length) return [];
  const result = await db.query(
    `SELECT id,
            name,
            order_index AS "orderIndex",
            created_by AS "createdByUserId"
     FROM shows
     WHERE id = ANY($1::text[])`,
    [normalizedShowIds]
  );
  return result.rows;
}

function normalizeGrantShape(grant = {}) {
  const legacyScope = legacyGrantScopeValue(grant);
  const rawScopeType = grant.scopeType || grant.scope_type || legacyGrantScopeType(grant);
  const scopeType = normalizeRbacScopeType(rawScopeType);
  const legacyGroupNameValue = scopeType === RBAC_SCOPE_GROUP_NAME ? legacyScope.scopeNameValue : null;
  const legacyPartNameValue = scopeType === RBAC_SCOPE_PART_NAME ? legacyScope.scopeNameValue : null;
  const scopeGroupNameValue = normalizeScopeValue(
    grant.scopeGroupNameValue
    || grant.scope_group_name_value
    || legacyGroupNameValue
  );
  const scopePartNameValue = normalizeScopeValue(
    grant.scopePartNameValue
    || grant.scope_part_name_value
    || legacyPartNameValue
  );
  return {
    permissionKey: normalizePermissionKey(
      grant.permissionKey
      || grant.permission_key
      || mapLegacyCapabilityToPermissionKey(grant.capability, grant.projectTargetType || grant.project_target_type || grant.scopeType || grant.scope_type || null)
    ),
    scopeType,
    scopeShowId: grant.scopeShowId || grant.scope_show_id || legacyScope.scopeShowId || null,
    scopeProjectId: grant.scopeProjectId || grant.scope_project_id || legacyScope.scopeProjectId || null,
    scopeTrackId: grant.scopeTrackId || grant.scope_track_id || null,
    scopeNameValue: grant.scopeNameValue || grant.scope_name_value || legacyScope.scopeNameValue || null,
    scopeLabel: grant.scopeLabel || grant.scope_label || legacyScope.scopeLabel || '',
    scopeGroupNameValue,
    scopeGroupLabel: grant.scopeGroupLabel || grant.scope_group_label || (legacyGroupNameValue ? legacyScope.scopeLabel : '') || '',
    scopePartNameValue,
    scopePartLabel: grant.scopePartLabel || grant.scope_part_label || (legacyPartNameValue ? legacyScope.scopeLabel : '') || '',
  };
}

function grantMatchesShow(grant, showId = null) {
  if (!grant) return false;
  const shape = normalizeGrantShape(grant);
  if (shape.scopeType === RBAC_SCOPE_ALL) return true;
  if (shape.scopeType === RBAC_SCOPE_SHOW) {
    return Boolean(showId) && String(shape.scopeShowId || '') === String(showId);
  }
  if (shape.scopeType === RBAC_SCOPE_PROJECT || shape.scopeType === RBAC_SCOPE_TRACK) {
    return Boolean(showId) && String(shape.scopeShowId || '') === String(showId);
  }
  return false;
}

function shapeGroupNameValue(shape) {
  return normalizeScopeValue(shape?.scopeGroupNameValue || (
    shape?.scopeType === RBAC_SCOPE_GROUP_NAME ? shape?.scopeNameValue : null
  ));
}

function shapePartNameValue(shape) {
  return normalizeScopeValue(shape?.scopePartNameValue || (
    shape?.scopeType === RBAC_SCOPE_PART_NAME ? shape?.scopeNameValue : null
  ));
}

function shapeHasNameFilters(shape) {
  return Boolean(shapeGroupNameValue(shape) || shapePartNameValue(shape));
}

function projectMatchesShapeNameFilters(shape, projectTags = null, trackInfoById = null) {
  const groupValue = shapeGroupNameValue(shape);
  const partValue = shapePartNameValue(shape);
  if (!groupValue && !partValue) return true;

  if (projectTags) {
    if (groupValue && !projectTags[PROJECT_TARGET_GROUP_NAME]?.has(groupValue)) return false;
    if (partValue && !projectTags[PROJECT_TARGET_PART_NAME]?.has(partValue)) return false;
    return true;
  }

  if (trackInfoById) {
    return Array.from(trackInfoById.values()).some((trackInfo) => (
      (!groupValue || trackInfo.derivedGroupValues?.has(groupValue))
      && (!partValue || trackInfo.derivedPartValues?.has(partValue))
    ));
  }

  return false;
}

function trackMatchesShapeNameFilters(trackInfo, shape) {
  const groupValue = shapeGroupNameValue(shape);
  const partValue = shapePartNameValue(shape);
  if (groupValue && !trackInfo.derivedGroupValues?.has(groupValue)) return false;
  if (partValue && !trackInfo.derivedPartValues?.has(partValue)) return false;
  return true;
}

function structuralScopeMatchesTrack(trackInfo, shape, project = null) {
  if (shape.scopeType === RBAC_SCOPE_ALL || shape.scopeType === RBAC_SCOPE_GROUP_NAME || shape.scopeType === RBAC_SCOPE_PART_NAME) {
    return true;
  }
  if (shape.scopeType === RBAC_SCOPE_SHOW) {
    return Boolean(project?.showId) && String(shape.scopeShowId || '') === String(project.showId);
  }
  if (shape.scopeType === RBAC_SCOPE_PROJECT) {
    return Boolean(project?.id) && String(shape.scopeProjectId || '') === String(project.id);
  }
  if (shape.scopeType === RBAC_SCOPE_TRACK) {
    const targetTrackId = String(shape.scopeTrackId || '');
    return String(trackInfo.trackId || '') === targetTrackId
      || String(trackInfo.nodeId || '') === targetTrackId
      || (trackInfo.ancestorTrackIds || []).includes(targetTrackId);
  }
  return false;
}

function structuralScopeMatchesProject(shape, project = null, trackInfoById = null) {
  if (shape.scopeType === RBAC_SCOPE_ALL || shape.scopeType === RBAC_SCOPE_GROUP_NAME || shape.scopeType === RBAC_SCOPE_PART_NAME) {
    return true;
  }
  if (shape.scopeType === RBAC_SCOPE_SHOW) {
    return Boolean(project?.showId) && String(shape.scopeShowId || '') === String(project.showId);
  }
  if (shape.scopeType === RBAC_SCOPE_PROJECT) {
    return String(shape.scopeProjectId || '') === String(project?.id || '');
  }
  if (shape.scopeType === RBAC_SCOPE_TRACK) {
    if (!trackInfoById) return false;
    return Array.from(trackInfoById.values()).some((trackInfo) => structuralScopeMatchesTrack(trackInfo, shape, project));
  }
  return false;
}

function trackMatchesGrantScope(trackInfo, grant, project = null) {
  if (!trackInfo || !grant) return false;
  const shape = normalizeGrantShape(grant);
  return structuralScopeMatchesTrack(trackInfo, shape, project)
    && trackMatchesShapeNameFilters(trackInfo, shape);
}

function grantMatchesProject(grant, projectOrId, projectTags = null, trackInfoById = null) {
  if (!grant) return false;
  const project = typeof projectOrId === 'object'
    ? projectOrId
    : { id: projectOrId };
  const shape = normalizeGrantShape(grant);
  return structuralScopeMatchesProject(shape, project, trackInfoById)
    && projectMatchesShapeNameFilters(shape, projectTags, trackInfoById);
}

function emptyProjectAccessSummary() {
  return {
    canSeeShow: false,
    canManageShow: false,
    canCreateShows: false,
    canSeeProject: false,
    canOpenProject: false,
    canCreateProjects: false,
    canManageProject: false,
    canCreateTracks: false,
    canManageTracks: false,
    canEditAllTracks: false,
    canListenTutti: false,
    canReadProject: false,
    canCreateMixes: false,
    canWriteOwnTracks: false,
    canWriteScopedTracks: false,
    canManageOwnProject: false,
    canManageProjectUnconditionally: false,
    projectManagerRetainScopes: [],
    creatableTrackScopes: [],
    manageableTrackScopes: [],
    editableTrackScopes: [],
    compatibility: {
      canRead: false,
      canWrite: false,
    },
  };
}

function emptyShowAccessSummary() {
  return {
    canSeeShow: false,
    canManageShow: false,
    canCreateProjects: false,
    canCreateShows: false,
  };
}

function mergeGrantedScope(scopesMap, grant) {
  const shape = normalizeGrantShape(grant);
  mergeScopeEntry(scopesMap, {
    type: shape.scopeType,
    showId: shape.scopeShowId || null,
    projectId: shape.scopeProjectId || null,
    trackId: shape.scopeTrackId || null,
    value: shape.scopeNameValue || shape.scopeTrackId || null,
    groupNameValue: shape.scopeGroupNameValue || null,
    groupLabel: shape.scopeGroupLabel || '',
    partNameValue: shape.scopePartNameValue || null,
    partLabel: shape.scopePartLabel || '',
    label: normalizeText(shape.scopeLabel || shape.scopeNameValue || shape.scopeTrackId || shape.scopeType),
  });
}

function mergeScopeEntry(scopesMap, scope) {
  const key = [
    scope.type,
    scope.showId || '',
    scope.projectId || '',
    scope.trackId || '',
    scope.value || '',
    scope.groupNameValue || '',
    scope.partNameValue || '',
    scope.source || '',
  ].join(':');
  if (scopesMap.has(key)) return;
  scopesMap.set(key, {
    type: scope.type,
    showId: scope.showId || null,
    projectId: scope.projectId || null,
    trackId: scope.trackId || null,
    value: scope.value || scope.trackId || null,
    groupNameValue: scope.groupNameValue || null,
    groupLabel: scope.groupLabel || '',
    partNameValue: scope.partNameValue || null,
    partLabel: scope.partLabel || '',
    label: normalizeText(scope.label || scope.value || scope.trackId || scope.type),
    source: scope.source || null,
  });
}

function buildTrackArtistManagerScopes(trackInfoById, userId, project = null) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId || !trackInfoById) return [];
  return Array.from(trackInfoById.values())
    .filter((trackInfo) => trackInfo.artistUserIds?.has(normalizedUserId))
    .map((trackInfo) => ({
      type: RBAC_SCOPE_TRACK,
      showId: project?.showId || project?.show_id || null,
      projectId: project?.id || project?.projectId || null,
      trackId: String(trackInfo.trackId || ''),
      value: String(trackInfo.trackId || ''),
      label: trackInfo.name || 'Track artist',
      source: 'track_artist',
    }))
    .filter((scope) => scope.trackId);
}

function withoutTrackArtistScopes(access = {}) {
  const filterScopes = (scopes) => (
    Array.isArray(scopes)
      ? scopes.filter((scope) => scope?.source !== 'track_artist')
      : []
  );
  return {
    ...access,
    creatableTrackScopes: filterScopes(access?.creatableTrackScopes),
    manageableTrackScopes: filterScopes(access?.manageableTrackScopes),
    editableTrackScopes: filterScopes(access?.editableTrackScopes),
  };
}

function trackArtistSelfRemoved(currentTrack = {}, nextTrack = {}, userId) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return false;
  const currentArtistUserIds = normalizeArtistUserIds(currentTrack?.artistRefs);
  if (!currentArtistUserIds.has(normalizedUserId)) return false;
  return !normalizeArtistUserIds(nextTrack?.artistRefs).has(normalizedUserId);
}

function assertTrackArtistSelfRemovalAllowed({
  currentTrack,
  nextTrack,
  currentTrackInfo,
  nextTrackInfo,
  access,
  userId,
  project = null,
  projectCreatedByUserId = null,
}) {
  if (!trackArtistSelfRemoved(currentTrack, nextTrack, userId)) return;
  const accessWithoutArtist = withoutTrackArtistScopes(access);
  if (
    trackIsEditable(
      currentTrackInfo,
      accessWithoutArtist,
      userId,
      project,
      projectCreatedByUserId,
      { includeArtistAccess: false }
    )
    && trackIsEditable(
      nextTrackInfo,
      accessWithoutArtist,
      userId,
      project,
      projectCreatedByUserId,
      { includeArtistAccess: false }
    )
  ) {
    return;
  }
  throw new Error('You cannot remove yourself as track artist when that is your only track manager access');
}

function isTrackArtist(trackInfo, userId) {
  const normalizedUserId = normalizeText(userId);
  return Boolean(normalizedUserId && trackInfo?.artistUserIds?.has(normalizedUserId));
}

function projectHasOwnedTrack(trackInfoById, userId) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId || !trackInfoById) return false;
  return Array.from(trackInfoById.values()).some((trackInfo) => normalizeText(trackInfo.createdByUserId) === normalizedUserId);
}

function buildProjectAccessSummary(userId, project, grants = [], projectTags = null, isAdmin = false, snapshot = {}) {
  const summary = emptyProjectAccessSummary();
  const normalizedUserId = normalizeText(userId);
  const createdByUserId = normalizeText(project?.createdByUserId || project?.created_by || '');
  const showCreatedByUserId = normalizeText(project?.showCreatedByUserId || '');
  const trackInfoById = collectTrackBindingInfo(snapshot || {});
  const creatableTrackScopes = new Map();
  const manageableTrackScopes = new Map();
  const projectManagerRetainScopes = new Map();
  const ownsShow = Boolean(showCreatedByUserId && showCreatedByUserId === normalizedUserId);
  const ownsProject = Boolean(createdByUserId && createdByUserId === normalizedUserId);
  const ownsAnyTrack = projectHasOwnedTrack(trackInfoById, userId);
  const artistManagerScopes = buildTrackArtistManagerScopes(trackInfoById, userId, project);
  const managesArtistTracks = artistManagerScopes.length > 0;
  const published = isProjectPublished(project, snapshot);

  if (isAdmin) {
    return {
      ...summary,
      canSeeShow: true,
      canManageShow: true,
      canCreateShows: true,
      canSeeProject: true,
      canOpenProject: true,
      canCreateProjects: true,
      canManageProject: true,
      canCreateTracks: true,
      canManageTracks: true,
      canEditAllTracks: true,
      canListenTutti: true,
      canReadProject: true,
      canCreateMixes: true,
      canWriteOwnTracks: true,
      canWriteScopedTracks: true,
      canManageOwnProject: true,
      canManageProjectUnconditionally: true,
      projectManagerRetainScopes: [],
      creatableTrackScopes: [{ type: RBAC_SCOPE_ALL, showId: null, projectId: null, trackId: null, value: null, label: 'All' }],
      manageableTrackScopes: [{ type: RBAC_SCOPE_ALL, showId: null, projectId: null, trackId: null, value: null, label: 'All' }],
      editableTrackScopes: [{ type: RBAC_SCOPE_ALL, showId: null, projectId: null, trackId: null, value: null, label: 'All' }],
      compatibility: {
        canRead: true,
        canWrite: true,
      },
    };
  }

  if (ownsShow) {
    summary.canSeeShow = true;
    summary.canManageShow = true;
    summary.canCreateProjects = true;
  }
  if (ownsShow || ownsProject) {
    summary.canSeeProject = true;
    summary.canOpenProject = true;
    summary.canManageProject = true;
    summary.canCreateTracks = true;
    summary.canManageTracks = true;
    summary.canCreateMixes = true;
    summary.canListenTutti = true;
    summary.canManageProjectUnconditionally = true;
  }
  if (ownsAnyTrack || managesArtistTracks) {
    summary.canSeeProject = true;
    summary.canOpenProject = true;
    summary.canCreateTracks = true;
    summary.canManageTracks = true;
    summary.canCreateMixes = true;
    summary.canListenTutti = true;
  }
  for (const scope of artistManagerScopes) {
    mergeScopeEntry(creatableTrackScopes, scope);
    mergeScopeEntry(manageableTrackScopes, scope);
  }
  if (published) {
    summary.canSeeShow = true;
    summary.canSeeProject = true;
    summary.canListenTutti = true;
  }

  for (const grant of grants) {
    const { permissionKey } = normalizeGrantShape(grant);
    const matchesShow = grantMatchesShow(grant, project?.showId || project?.show_id || null);
    const matchesProject = grantMatchesProject(grant, project, projectTags, trackInfoById);

    if (permissionKey === PERMISSION_SHOW_CREATOR) {
      summary.canCreateShows = true;
      continue;
    }
    if (permissionKey === PERMISSION_SHOW_READER && matchesShow) {
      summary.canSeeShow = true;
      continue;
    }
    if (permissionKey === PERMISSION_SHOW_MANAGER && matchesShow) {
      summary.canSeeShow = true;
      summary.canManageShow = true;
      summary.canCreateProjects = true;
      summary.canSeeProject = true;
      summary.canOpenProject = true;
      summary.canManageProject = true;
      summary.canCreateTracks = true;
      summary.canManageTracks = true;
      summary.canCreateMixes = true;
      summary.canListenTutti = true;
      summary.canManageProjectUnconditionally = true;
      continue;
    }

    if (permissionKey === PERMISSION_PROJECT_CREATOR && matchesShow) {
      summary.canSeeShow = true;
      summary.canCreateProjects = true;
      continue;
    }

    if (!matchesProject) continue;

    summary.canSeeShow = true;

    if (permissionKey === PERMISSION_PROJECT_READER) {
      summary.canSeeProject = true;
      summary.canListenTutti = true;
      continue;
    }

    if (permissionKey === PERMISSION_PROJECT_MANAGER) {
      const shape = normalizeGrantShape(grant);
      summary.canSeeProject = true;
      summary.canOpenProject = true;
      summary.canManageProject = true;
      summary.canCreateTracks = true;
      summary.canManageTracks = true;
      summary.canCreateMixes = true;
      summary.canListenTutti = true;
      if (shapeHasNameFilters(shape)) {
        mergeGrantedScope(projectManagerRetainScopes, grant);
      } else {
        summary.canManageProjectUnconditionally = true;
      }
      continue;
    }

    if (permissionKey === PERMISSION_TRACK_READER) {
      summary.canSeeProject = true;
      summary.canOpenProject = true;
      summary.canCreateMixes = true;
      summary.canListenTutti = true;
      continue;
    }

    if (permissionKey === PERMISSION_TRACK_CREATOR) {
      summary.canSeeProject = true;
      summary.canOpenProject = true;
      summary.canCreateTracks = true;
      summary.canListenTutti = true;
      mergeGrantedScope(creatableTrackScopes, grant);
      continue;
    }

    if (permissionKey === PERMISSION_TRACK_MANAGER) {
      summary.canSeeProject = true;
      summary.canOpenProject = true;
      summary.canCreateTracks = true;
      summary.canManageTracks = true;
      summary.canCreateMixes = true;
      summary.canListenTutti = true;
      mergeGrantedScope(creatableTrackScopes, grant);
      mergeGrantedScope(manageableTrackScopes, grant);
      continue;
    }
  }

  summary.canManageOwnProject = ownsProject || ownsShow;
  summary.canReadProject = summary.canOpenProject;
  summary.canWriteOwnTracks = ownsAnyTrack;
  summary.canWriteScopedTracks = summary.canManageTracks && manageableTrackScopes.size > 0;
  summary.creatableTrackScopes = Array.from(creatableTrackScopes.values()).sort((left, right) => (
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true })
  ));
  summary.manageableTrackScopes = Array.from(manageableTrackScopes.values()).sort((left, right) => (
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true })
  ));
  summary.projectManagerRetainScopes = Array.from(projectManagerRetainScopes.values()).sort((left, right) => (
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true })
  ));
  summary.editableTrackScopes = summary.manageableTrackScopes;
  summary.compatibility = {
    canRead: summary.canSeeProject,
    canWrite: summary.canManageProject,
  };
  summary.canEditAllTracks = canEditAllTracksInSnapshot({
    snapshot,
    access: summary,
    userId,
    project: {
      id: project?.id || snapshot?.projectId || null,
      showId: project?.showId || project?.show_id || snapshot?.showId || null,
    },
    projectCreatedByUserId: createdByUserId,
  });
  return summary;
}

export function resolveProjectAccessFromGrantRows(grants = [], projectId, projectTags = null, isAdmin = false) {
  if (isAdmin) {
    return { canRead: true, canWrite: true };
  }
  const project = typeof projectId === 'object' ? projectId : { id: projectId };
  let canRead = isProjectPublished(project, null);
  let canWrite = false;
  for (const grant of grants) {
    const permissionKey = grant.permissionKey || grant.permission_key || mapLegacyCapabilityToPermissionKey(
      grant.capability,
      grant.projectTargetType || grant.project_target_type || grant.scopeType || grant.scope_type || null
    );
    if (!permissionKey) continue;
    const matchesShow = grantMatchesShow(grant, project?.showId || null);
    const matchesProject = grantMatchesProject(grant, project, projectTags, null);
    if (permissionKey === PERMISSION_SHOW_MANAGER && matchesShow) {
      return { canRead: true, canWrite: true };
    }
    if (!matchesProject) continue;
    if (permissionKey === PERMISSION_PROJECT_MANAGER) {
      return { canRead: true, canWrite: true };
    }
    if (
      permissionKey === PERMISSION_PROJECT_READER
      || permissionKey === PERMISSION_TRACK_READER
      || permissionKey === PERMISSION_TRACK_CREATOR
      || permissionKey === PERMISSION_TRACK_MANAGER
    ) {
      canRead = true;
    }
  }
  return { canRead, canWrite };
}

async function loadUserGrantContext(userId, projectIds = [], db = pool) {
  const normalizedProjectIds = uniqueTextValues(projectIds);
  const [isAdmin, grants, tagRows, projectRows, headRows] = await Promise.all([
    userHasAdminRole(userId, db),
    listResolvedGrantsForUser(userId, db),
    loadProjectTagRows(normalizedProjectIds, db),
    loadProjectRows(normalizedProjectIds, db),
    loadProjectHeadRows(normalizedProjectIds, db),
  ]);
  return {
    isAdmin,
    grants,
    tagMap: buildTagMapFromRows(tagRows),
    projectById: new Map(projectRows.map((row) => [row.id, row])),
    snapshotByProjectId: new Map(headRows.map((row) => [row.projectId, row.snapshot || {}])),
  };
}

export async function getProjectAccess(userId, projectId, db = pool) {
  const project = await loadProjectRow(projectId, db);
  if (!project) return emptyProjectAccessSummary();
  const { isAdmin, grants, tagMap, snapshotByProjectId } = await loadUserGrantContext(userId, [projectId], db);
  return buildProjectAccessSummary(userId, project, grants, tagMap.get(projectId) || null, isAdmin, snapshotByProjectId.get(projectId) || {});
}

export async function getProjectAccessMap(userId, projectRowsOrIds = [], db = pool) {
  const rows = Array.isArray(projectRowsOrIds) ? projectRowsOrIds : [];
  const normalizedProjectIds = uniqueTextValues(rows.map((entry) => String(entry?.id || entry?.projectId || entry || '')).filter(Boolean));
  const result = new Map();
  if (!normalizedProjectIds.length) return result;

  const { isAdmin, grants, tagMap, projectById, snapshotByProjectId } = await loadUserGrantContext(userId, normalizedProjectIds, db);

  for (const projectId of normalizedProjectIds) {
    const incomingRow = rows.find((entry) => String(entry?.id || entry?.projectId || entry || '') === projectId);
    const project = {
      ...(projectById.get(projectId) || { id: projectId }),
      createdByUserId: incomingRow?.createdByUserId ?? incomingRow?.created_by ?? projectById.get(projectId)?.createdByUserId ?? null,
      published: incomingRow?.published ?? incomingRow?.publish ?? projectById.get(projectId)?.published ?? false,
      musicalNumber: incomingRow?.musicalNumber ?? projectById.get(projectId)?.musicalNumber ?? null,
      sceneOrder: incomingRow?.sceneOrder ?? projectById.get(projectId)?.sceneOrder ?? null,
      showId: incomingRow?.showId ?? incomingRow?.show_id ?? projectById.get(projectId)?.showId ?? null,
      showName: incomingRow?.showName ?? incomingRow?.show_name ?? projectById.get(projectId)?.showName ?? '',
      name: incomingRow?.name ?? projectById.get(projectId)?.name ?? '',
    };
    result.set(projectId, buildProjectAccessSummary(
      userId,
      project,
      grants,
      tagMap.get(projectId) || null,
      isAdmin,
      snapshotByProjectId.get(projectId) || {}
    ));
  }

  return result;
}

function buildShowAccessSummary(userId, show, grants = [], projectsInShow = [], projectAccessMap = new Map(), isAdmin = false) {
  const summary = emptyShowAccessSummary();
  const normalizedUserId = normalizeText(userId);
  const showCreatedByUserId = normalizeText(show?.createdByUserId || show?.created_by || '');
  const ownsShow = Boolean(showCreatedByUserId && showCreatedByUserId === normalizedUserId);

  if (isAdmin) {
    return {
      canSeeShow: true,
      canManageShow: true,
      canCreateProjects: true,
      canCreateShows: true,
    };
  }

  if (ownsShow) {
    summary.canSeeShow = true;
    summary.canManageShow = true;
    summary.canCreateProjects = true;
  }

  for (const grant of grants) {
    const { permissionKey } = normalizeGrantShape(grant);
    const matchesShow = grantMatchesShow(grant, show?.id);
    if (permissionKey === PERMISSION_SHOW_CREATOR) {
      summary.canCreateShows = true;
      continue;
    }
    if (!matchesShow) continue;
    if (permissionKey === PERMISSION_SHOW_READER) {
      summary.canSeeShow = true;
      continue;
    }
    if (permissionKey === PERMISSION_SHOW_MANAGER) {
      summary.canSeeShow = true;
      summary.canManageShow = true;
      summary.canCreateProjects = true;
      continue;
    }
    if (permissionKey === PERMISSION_PROJECT_CREATOR) {
      summary.canSeeShow = true;
      summary.canCreateProjects = true;
    }
  }

  for (const project of projectsInShow) {
    const projectAccess = projectAccessMap.get(String(project.id || '')) || null;
    if (projectAccess?.canSeeProject || projectAccess?.canManageProject || projectAccess?.canManageShow) {
      summary.canSeeShow = true;
    }
    if (projectAccess?.canManageProject || projectAccess?.canManageShow) {
      summary.canCreateProjects = true;
    }
  }

  return summary;
}

export async function getShowAccessMap(userId, showRowsOrIds = [], db = pool) {
  const rows = Array.isArray(showRowsOrIds) ? showRowsOrIds : [];
  const normalizedShowIds = uniqueTextValues(rows.map((entry) => String(entry?.id || entry || '')).filter(Boolean));
  const result = new Map();
  if (!normalizedShowIds.length) return result;

  const [isAdmin, grants, showRows, projectRows] = await Promise.all([
    userHasAdminRole(userId, db),
    listResolvedGrantsForUser(userId, db),
    loadShowRows(normalizedShowIds, db),
    db.query(
      `SELECT p.id,
              p.name,
              p.created_by AS "createdByUserId",
              p.published,
              p.musical_number AS "musicalNumber",
              p.scene_order AS "sceneOrder",
              p.show_id AS "showId",
              s.name AS "showName",
              s.created_by AS "showCreatedByUserId"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       WHERE p.show_id = ANY($1::text[])`,
      [normalizedShowIds]
    ),
  ]);
  const projectAccessMap = await getProjectAccessMap(userId, projectRows.rows, db);

  for (const showId of normalizedShowIds) {
    const incomingRow = rows.find((entry) => String(entry?.id || entry || '') === showId) || {};
    const show = {
      ...(showRows.find((row) => row.id === showId) || { id: showId }),
      name: incomingRow?.name ?? showRows.find((row) => row.id === showId)?.name ?? '',
      orderIndex: incomingRow?.orderIndex ?? showRows.find((row) => row.id === showId)?.orderIndex ?? 0,
      createdByUserId: incomingRow?.createdByUserId ?? showRows.find((row) => row.id === showId)?.createdByUserId ?? null,
    };
    const projectsInShow = projectRows.rows.filter((project) => String(project.showId || '') === showId);
    result.set(showId, buildShowAccessSummary(userId, show, grants, projectsInShow, projectAccessMap, isAdmin));
  }

  return result;
}

export async function getProjectPermission(userId, projectId, _legacyIsAdmin = false, db = pool) {
  const access = await getProjectAccess(userId, projectId, db);
  return {
    canRead: Boolean(access.compatibility.canRead),
    canWrite: Boolean(access.compatibility.canWrite),
  };
}

export async function getProjectPermissionMap(userId, projectIds = [], db = pool) {
  const accessMap = await getProjectAccessMap(userId, projectIds, db);
  const result = new Map();
  accessMap.forEach((access, projectId) => {
    result.set(projectId, {
      canRead: Boolean(access.compatibility.canRead),
      canWrite: Boolean(access.compatibility.canWrite),
    });
  });
  return result;
}

export async function requireProjectPermission(req, res, permission = ACCESS_LEVEL_READ) {
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) {
    res.status(400).json({ error: 'Missing project id' });
    return null;
  }
  const access = await getProjectAccess(req.user.id, projectId);
  if (permission === ACCESS_LEVEL_WRITE && !access.compatibility.canWrite) {
    res.status(403).json({ error: 'No write permission for this project' });
    return null;
  }
  if (permission === ACCESS_LEVEL_READ && !access.compatibility.canRead) {
    res.status(403).json({ error: 'No read permission for this project' });
    return null;
  }
  return {
    projectId,
    access,
    canRead: access.compatibility.canRead,
    canWrite: access.compatibility.canWrite,
  };
}

export async function getProjectAccessCatalog(db = pool) {
  const [showsResult, projectsResult, headsResult, groupResult, partResult] = await Promise.all([
    db.query(
      `SELECT id,
              name,
              order_index AS "orderIndex",
              created_by AS "createdByUserId"
       FROM shows
       ORDER BY order_index ASC, name ASC`
    ),
    db.query(
      `SELECT p.id,
              p.name,
              p.musical_number AS "musicalNumber",
              p.scene_order AS "sceneOrder",
              p.show_id AS "showId",
              s.name AS "showName",
              p.created_by AS "createdByUserId"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       ORDER BY s.order_index ASC, s.name ASC, p.musical_number ASC, p.scene_order ASC NULLS LAST, p.name ASC`
    ),
    db.query(
      `SELECT ph.project_id AS "projectId",
              ph.latest_snapshot_json AS snapshot
       FROM project_heads ph`
    ),
    db.query(
      `SELECT tag_value AS value,
              MIN(display_name) AS label,
              COUNT(DISTINCT project_id)::integer AS "projectCount"
       FROM project_access_tags
       WHERE tag_type = $1
       GROUP BY tag_value
       ORDER BY MIN(display_name) ASC`,
      [PROJECT_TARGET_GROUP_NAME]
    ),
    db.query(
      `SELECT tag_value AS value,
              MIN(display_name) AS label,
              COUNT(DISTINCT project_id)::integer AS "projectCount"
       FROM project_access_tags
       WHERE tag_type = $1
       GROUP BY tag_value
       ORDER BY MIN(display_name) ASC`,
      [PROJECT_TARGET_PART_NAME]
    ),
  ]);
  const tracks = [];
  const projectsById = new Map(projectsResult.rows.map((project) => [project.id, project]));
  for (const row of headsResult.rows) {
    const project = projectsById.get(row.projectId);
    const snapshot = row.snapshot || {};
    const snapshotTracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
    const snapshotTrackById = new Map(snapshotTracks.map((track) => [track.id, track]));
    const normalizedNodes = buildNormalizedTrackTree(snapshot);
    const childrenByParent = buildChildrenMap(normalizedNodes);
    const trackBindings = collectTrackBindingInfo(snapshot);

    const pushCatalogTrack = (entry) => {
      tracks.push({
        ...entry,
        projectId: row.projectId,
        projectName: project?.name || '',
        musicalNumber: project?.musicalNumber || '',
        showId: project?.showId || null,
        showName: project?.showName || '',
      });
    };

    const walk = (parentId, inherited) => {
      const key = parentId || '__root__';
      const children = childrenByParent.get(key) || [];
      for (const node of children) {
        if (node.kind === 'group') {
          const groupValue = normalizeScopeValue(node.name);
          const groupValues = groupValue
            ? Array.from(new Set([...inherited.groupValues, groupValue]))
            : inherited.groupValues;
          const partValue = node.part ? normalizeScopeValue(node.name) : null;
          const partValues = partValue
            ? Array.from(new Set([...inherited.partValues, partValue]))
            : inherited.partValues;
          pushCatalogTrack({
            id: String(node.id),
            nodeId: String(node.id),
            type: TRACK_NODE_TYPE_GROUP,
            kind: 'group',
            name: String(node.name || 'Untitled group'),
            part: Boolean(node.part),
            groupValues: [...groupValues].sort(),
            partValues: [...partValues].sort(),
          });
          walk(node.id, { groupValues, partValues });
          continue;
        }

        const track = snapshotTrackById.get(node.trackId);
        if (!track) continue;
        const binding = trackBindings.get(track.id);
        pushCatalogTrack({
          id: String(track.id),
          nodeId: String(node.id),
          type: TRACK_NODE_TYPE_AUDIO,
          kind: 'track',
          name: String(track.name || 'Untitled track'),
          part: Boolean(node.part || track.part),
          groupValues: Array.from(binding?.derivedGroupValues || []).sort(),
          partValues: Array.from(binding?.derivedPartValues || []).sort(),
        });
        const trackPartValue = node.part || track.part ? normalizeScopeValue(track.name) : null;
        walk(node.id, {
          groupValues: inherited.groupValues,
          partValues: trackPartValue
            ? Array.from(new Set([...inherited.partValues, trackPartValue]))
            : inherited.partValues,
        });
      }
    };

    walk(null, { groupValues: [], partValues: [] });
  }
  return {
    shows: showsResult.rows,
    projects: projectsResult.rows,
    tracks,
    groupNames: groupResult.rows,
    partNames: partResult.rows,
    permissions: getPermissionCatalog(),
    scopeTypes: [
      { value: RBAC_SCOPE_ALL, label: 'All' },
      { value: RBAC_SCOPE_SHOW, label: 'Specific show' },
      { value: RBAC_SCOPE_PROJECT, label: 'Specific musical number' },
      { value: RBAC_SCOPE_TRACK, label: 'Specific track' },
      { value: RBAC_SCOPE_GROUP_NAME, label: 'Specific group' },
      { value: RBAC_SCOPE_PART_NAME, label: 'Specific part' },
    ],
  };
}

function inferLegacyScopeTypeFromInput(input = {}, permissionKey) {
  const projectTargetType = input?.projectTargetType ?? input?.scopeType ?? null;
  const showTargetType = input?.showTargetType ?? null;
  if (input?.scopeType) return input.scopeType;
  if (projectTargetType === PROJECT_TARGET_PROJECT) return RBAC_SCOPE_PROJECT;
  if (projectTargetType === PROJECT_TARGET_GROUP_NAME) return RBAC_SCOPE_GROUP_NAME;
  if (projectTargetType === PROJECT_TARGET_PART_NAME) return RBAC_SCOPE_PART_NAME;
  if (showTargetType === SHOW_TARGET_SHOW) return RBAC_SCOPE_SHOW;
  if (permissionKey === PERMISSION_SHOW_CREATOR) return RBAC_SCOPE_ALL;
  return RBAC_SCOPE_ALL;
}

async function resolveGrantPayload(input, db = pool) {
  const permissionKey = normalizePermissionKey(
    input?.permissionKey
    ?? input?.permission
    ?? mapLegacyCapabilityToPermissionKey(input?.capability, input?.projectTargetType ?? input?.scopeType ?? null)
    ?? (input?.accessLevel === ACCESS_LEVEL_WRITE ? PERMISSION_PROJECT_MANAGER : PERMISSION_TRACK_READER)
  );
  const scopeType = normalizeRbacScopeType(
    input?.scopeType
    ?? inferLegacyScopeTypeFromInput(input, permissionKey)
  );
  assertPermissionSupportsScope(permissionKey, scopeType);

  const requestedGroupNameValue = normalizeScopeValue(input?.scopeGroupNameValue ?? input?.scopeGroupValue);
  const requestedPartNameValue = normalizeScopeValue(input?.scopePartNameValue ?? input?.scopePartValue);
  if ((requestedGroupNameValue || requestedPartNameValue) && !PERMISSIONS_WITH_GROUP_PART_FILTERS.has(permissionKey)) {
    throw new Error('Group and part filters are not valid for selected permission');
  }

  const resolveNamedFilter = async (tagType, value) => {
    if (!value) return { value: null, label: '' };
    const result = await db.query(
      `SELECT tag_value AS value,
              MIN(display_name) AS label
       FROM project_access_tags
       WHERE tag_type = $1
         AND tag_value = $2
       GROUP BY tag_value
       LIMIT 1`,
      [tagType, value]
    );
    if (result.rowCount === 0) {
      throw new Error('Selected named scope was not found');
    }
    return {
      value,
      label: result.rows[0].label || value,
    };
  };

  const [groupFilter, partFilter] = await Promise.all([
    resolveNamedFilter(PROJECT_TARGET_GROUP_NAME, requestedGroupNameValue),
    resolveNamedFilter(PROJECT_TARGET_PART_NAME, requestedPartNameValue),
  ]);
  const filterFields = {
    scopeGroupNameValue: groupFilter.value,
    scopeGroupLabel: groupFilter.label,
    scopePartNameValue: partFilter.value,
    scopePartLabel: partFilter.label,
  };

  if (scopeType === RBAC_SCOPE_ALL) {
    return {
      permissionKey,
      scopeType,
      scopeShowId: null,
      scopeProjectId: null,
      scopeTrackId: null,
      scopeNameValue: null,
      scopeLabel: 'All',
      ...filterFields,
    };
  }

  if (scopeType === RBAC_SCOPE_SHOW) {
    const scopeShowId = normalizeText(input?.scopeShowId ?? input?.showTargetShowId);
    if (!scopeShowId) {
      throw new Error('scopeShowId is required for show-scoped grants');
    }
    const showResult = await db.query(
      `SELECT id, name
       FROM shows
       WHERE id = $1`,
      [scopeShowId]
    );
    if (showResult.rowCount === 0) {
      throw new Error('Selected show not found');
    }
    return {
      permissionKey,
      scopeType,
      scopeShowId,
      scopeProjectId: null,
      scopeTrackId: null,
      scopeNameValue: null,
      scopeLabel: showResult.rows[0].name,
      ...filterFields,
    };
  }

  if (scopeType === RBAC_SCOPE_PROJECT) {
    const scopeProjectId = normalizeText(input?.scopeProjectId ?? input?.projectTargetProjectId ?? input?.scopeProjectId);
    if (!scopeProjectId) {
      throw new Error('scopeProjectId is required for project-scoped grants');
    }
    const projectResult = await db.query(
      `SELECT p.id,
              p.name,
              p.musical_number AS "musicalNumber",
              p.show_id AS "showId",
              s.name AS "showName"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       WHERE p.id = $1`,
      [scopeProjectId]
    );
    if (projectResult.rowCount === 0) {
      throw new Error('Selected project not found');
    }
    const project = projectResult.rows[0];
    return {
      permissionKey,
      scopeType,
      scopeShowId: project.showId || null,
      scopeProjectId,
      scopeTrackId: null,
      scopeNameValue: null,
      scopeLabel: `${project.showName ? `${project.showName} / ` : ''}${project.musicalNumber ? `${project.musicalNumber} - ` : ''}${project.name}`,
      ...filterFields,
    };
  }

  if (scopeType === RBAC_SCOPE_TRACK) {
    const scopeProjectId = normalizeText(input?.scopeProjectId ?? input?.projectTargetProjectId);
    const scopeTrackId = normalizeText(input?.scopeTrackId ?? input?.trackScopeValue);
    if (!scopeProjectId) {
      throw new Error('scopeProjectId is required for track-scoped grants');
    }
    if (!scopeTrackId) {
      throw new Error('scopeTrackId is required for track-scoped grants');
    }
    const projectResult = await db.query(
      `SELECT p.id,
              p.name,
              p.musical_number AS "musicalNumber",
              p.show_id AS "showId",
              s.name AS "showName",
              ph.latest_snapshot_json AS snapshot
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id
       LEFT JOIN project_heads ph
         ON ph.project_id = p.id
       WHERE p.id = $1`,
      [scopeProjectId]
    );
    if (projectResult.rowCount === 0) {
      throw new Error('Selected project not found');
    }
    const project = projectResult.rows[0];
    const snapshotTracks = Array.isArray(project?.snapshot?.tracks) ? project.snapshot.tracks : [];
    const snapshotTrackById = new Map(snapshotTracks.map((entry) => [String(entry?.id || ''), entry]));
    const normalizedNodes = buildNormalizedTrackTree(project?.snapshot || {});
    const node = normalizedNodes.find((entry) => (
      String(entry?.id || '') === scopeTrackId
      || (entry.kind === 'track' && String(entry?.trackId || '') === scopeTrackId)
    ));
    const track = node?.kind === 'group'
      ? { name: node.name || 'Untitled group' }
      : snapshotTrackById.get(String(node?.trackId || ''));
    if (!node || !track) {
      throw new Error('Selected track not found');
    }
    return {
      permissionKey,
      scopeType,
      scopeShowId: project.showId || null,
      scopeProjectId,
      scopeTrackId,
      scopeNameValue: null,
      scopeLabel: `${project.showName ? `${project.showName} / ` : ''}${project.musicalNumber ? `${project.musicalNumber} - ` : ''}${project.name} / ${track.name || 'Untitled track'}`,
      ...filterFields,
    };
  }

  const scopeNameValue = normalizeScopeValue(input?.scopeNameValue ?? input?.projectTargetValue ?? input?.trackScopeValue ?? input?.scopeValue);
  if (!scopeNameValue) {
    throw new Error('scopeNameValue is required for named grants');
  }
  const result = await db.query(
    `SELECT tag_value AS value,
            MIN(display_name) AS label
     FROM project_access_tags
     WHERE tag_type = $1
       AND tag_value = $2
     GROUP BY tag_value
     LIMIT 1`,
    [scopeType, scopeNameValue]
  );
  if (result.rowCount === 0) {
    throw new Error('Selected named scope was not found');
  }
  return {
    permissionKey,
    scopeType,
    scopeShowId: null,
    scopeProjectId: null,
    scopeTrackId: null,
    scopeNameValue,
    scopeLabel: result.rows[0].label || scopeNameValue,
    ...filterFields,
  };
}

export async function listUserDirectGrants(userId, db = pool) {
  const result = await db.query(
    `SELECT id,
            role_id,
            user_id,
            permission_key,
            scope_type,
            scope_show_id,
            scope_project_id,
            scope_track_id,
            scope_name_value,
            scope_group_name_value,
            scope_group_label,
            scope_part_name_value,
            scope_part_label,
            scope_label,
            capability,
            project_target_type,
            project_target_project_id,
            project_target_value,
            project_target_label,
            show_target_type,
            show_target_show_id,
            show_target_label,
            track_scope_type,
            track_scope_value,
            track_scope_label,
            granted_by,
            created_at,
            updated_at
     FROM rbac_grants
     WHERE user_id = $1
     ORDER BY COALESCE(permission_key, capability) ASC, COALESCE(scope_label, project_target_label) ASC, created_at ASC`,
    [userId]
  );
  return result.rows.map(serializeGrantRow);
}

export async function listRoleGrants(roleId, db = pool) {
  const result = await db.query(
    `SELECT id,
            role_id,
            user_id,
            permission_key,
            scope_type,
            scope_show_id,
            scope_project_id,
            scope_track_id,
            scope_name_value,
            scope_group_name_value,
            scope_group_label,
            scope_part_name_value,
            scope_part_label,
            scope_label,
            capability,
            project_target_type,
            project_target_project_id,
            project_target_value,
            project_target_label,
            show_target_type,
            show_target_show_id,
            show_target_label,
            track_scope_type,
            track_scope_value,
            track_scope_label,
            granted_by,
            created_at,
            updated_at
     FROM rbac_grants
     WHERE role_id = $1
     ORDER BY COALESCE(permission_key, capability) ASC, COALESCE(scope_label, project_target_label) ASC, created_at ASC`,
    [roleId]
  );
  return result.rows.map(serializeGrantRow);
}

export async function listRoleInheritedGrants(roleId, db = pool) {
  const role = await assertRoleExists(roleId, db);
  if (role.isSystem) return [];
  const result = await db.query(
    `WITH RECURSIVE ancestors(role_id, depth) AS (
       SELECT parent_role_id, 1
       FROM rbac_role_inheritance
       WHERE role_id = $1
       UNION
       SELECT ri.parent_role_id, a.depth + 1
       FROM rbac_role_inheritance ri
       JOIN ancestors a
         ON ri.role_id = a.role_id
     )
     SELECT DISTINCT ON (g.id)
            g.id,
            g.role_id,
            g.user_id,
            g.permission_key,
            g.scope_type,
            g.scope_show_id,
            g.scope_project_id,
            g.scope_track_id,
            g.scope_name_value,
            g.scope_group_name_value,
            g.scope_group_label,
            g.scope_part_name_value,
            g.scope_part_label,
            g.scope_label,
            g.capability,
            g.project_target_type,
            g.project_target_project_id,
            g.project_target_value,
            g.project_target_label,
            g.show_target_type,
            g.show_target_show_id,
            g.show_target_label,
            g.track_scope_type,
            g.track_scope_value,
            g.track_scope_label,
            g.granted_by,
            g.created_at,
            g.updated_at,
            'inherited' AS "sourceType",
            r.id AS "sourceRoleId",
            r.name AS "sourceRoleName"
     FROM ancestors a
     JOIN rbac_grants g
       ON g.role_id = a.role_id
     JOIN rbac_roles r
       ON r.id = g.role_id
     ORDER BY g.id, a.depth ASC, r.name ASC`,
    [roleId]
  );
  return result.rows.map(serializeGrantRow);
}

async function upsertGrantForPrincipal(principalField, principalId, input, actorUserId = null, db = pool) {
  const resolved = await resolveGrantPayload(input, db);
  const existing = await db.query(
    `SELECT id
     FROM rbac_grants
     WHERE ${principalField} = $1
       AND permission_key = $2
       AND COALESCE(scope_type, '') = COALESCE($3, '')
       AND COALESCE(scope_show_id, '') = COALESCE($4, '')
       AND COALESCE(scope_project_id, '') = COALESCE($5, '')
       AND COALESCE(scope_track_id, '') = COALESCE($6, '')
       AND COALESCE(scope_name_value, '') = COALESCE($7, '')
       AND COALESCE(scope_group_name_value, '') = COALESCE($8, '')
       AND COALESCE(scope_part_name_value, '') = COALESCE($9, '')
     LIMIT 1`,
    [
      principalId,
      resolved.permissionKey,
      resolved.scopeType,
      resolved.scopeShowId,
      resolved.scopeProjectId,
      resolved.scopeTrackId,
      resolved.scopeNameValue,
      resolved.scopeGroupNameValue,
      resolved.scopePartNameValue,
    ]
  );

  if (existing.rowCount > 0) {
    await db.query(
      `UPDATE rbac_grants
       SET scope_label = $2,
           scope_group_label = $3,
           scope_part_label = $4,
           granted_by = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, resolved.scopeLabel, resolved.scopeGroupLabel, resolved.scopePartLabel, actorUserId]
    );
    const updated = await db.query(
      `SELECT id,
              role_id,
              user_id,
              permission_key,
              scope_type,
              scope_show_id,
              scope_project_id,
              scope_track_id,
              scope_name_value,
              scope_group_name_value,
              scope_group_label,
              scope_part_name_value,
              scope_part_label,
              scope_label,
              capability,
              project_target_type,
              project_target_project_id,
              project_target_value,
              project_target_label,
              show_target_type,
              show_target_show_id,
              show_target_label,
              track_scope_type,
              track_scope_value,
              track_scope_label,
              granted_by,
              created_at,
              updated_at
       FROM rbac_grants
       WHERE id = $1`,
      [existing.rows[0].id]
    );
    return serializeGrantRow(updated.rows[0]);
  }

  const id = randomUUID();
  const columns = principalField === 'role_id'
    ? ['id', 'role_id', 'permission_key', 'scope_type', 'scope_show_id', 'scope_project_id', 'scope_track_id', 'scope_name_value', 'scope_group_name_value', 'scope_group_label', 'scope_part_name_value', 'scope_part_label', 'scope_label', 'granted_by']
    : ['id', 'user_id', 'permission_key', 'scope_type', 'scope_show_id', 'scope_project_id', 'scope_track_id', 'scope_name_value', 'scope_group_name_value', 'scope_group_label', 'scope_part_name_value', 'scope_part_label', 'scope_label', 'granted_by'];
  const values = principalField === 'role_id'
    ? [id, principalId, resolved.permissionKey, resolved.scopeType, resolved.scopeShowId, resolved.scopeProjectId, resolved.scopeTrackId, resolved.scopeNameValue, resolved.scopeGroupNameValue, resolved.scopeGroupLabel, resolved.scopePartNameValue, resolved.scopePartLabel, resolved.scopeLabel, actorUserId]
    : [id, principalId, resolved.permissionKey, resolved.scopeType, resolved.scopeShowId, resolved.scopeProjectId, resolved.scopeTrackId, resolved.scopeNameValue, resolved.scopeGroupNameValue, resolved.scopeGroupLabel, resolved.scopePartNameValue, resolved.scopePartLabel, resolved.scopeLabel, actorUserId];
  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  await db.query(
    `INSERT INTO rbac_grants(${columns.join(', ')})
     VALUES(${placeholders.join(', ')})`,
    values
  );
  return serializeGrantRow({
    id,
    [principalField === 'role_id' ? 'role_id' : 'user_id']: principalId,
    permission_key: resolved.permissionKey,
    scope_type: resolved.scopeType,
    scope_show_id: resolved.scopeShowId,
    scope_project_id: resolved.scopeProjectId,
    scope_track_id: resolved.scopeTrackId,
    scope_name_value: resolved.scopeNameValue,
    scope_group_name_value: resolved.scopeGroupNameValue,
    scope_group_label: resolved.scopeGroupLabel,
    scope_part_name_value: resolved.scopePartNameValue,
    scope_part_label: resolved.scopePartLabel,
    scope_label: resolved.scopeLabel,
    granted_by: actorUserId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function upsertRoleGrant(roleId, input, actorUserId = null, db = pool) {
  await assertRoleGrantEditable(roleId, db);
  return await upsertGrantForPrincipal('role_id', roleId, input, actorUserId, db);
}

export async function upsertUserGrant(userId, input, actorUserId = null, db = pool) {
  const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    throw new Error('User not found');
  }
  return await upsertGrantForPrincipal('user_id', userId, input, actorUserId, db);
}

export async function deleteGrant(grantId, db = pool) {
  const grantResult = await db.query(
    `SELECT id, role_id AS "roleId"
     FROM rbac_grants
     WHERE id = $1`,
    [grantId]
  );
  if (grantResult.rowCount === 0) {
    throw new Error('Grant not found');
  }
  if (grantResult.rows[0].roleId) {
    await assertRoleGrantEditable(grantResult.rows[0].roleId, db);
  }
  await db.query('DELETE FROM rbac_grants WHERE id = $1', [grantId]);
}

export async function syncLegacyProjectPermission(userId, projectId, { canRead, canWrite }, actorUserId = null, db = pool) {
  const write = Boolean(canWrite);
  const read = write || Boolean(canRead);
  if (!read) {
    await db.query(
      `DELETE FROM rbac_grants
       WHERE user_id = $1
         AND COALESCE(permission_key, capability) IN ($2, $3)
         AND COALESCE(scope_type, project_target_type) IN ($4, $5)
         AND COALESCE(scope_project_id, project_target_project_id) = $6`,
      [userId, PERMISSION_TRACK_READER, PERMISSION_PROJECT_MANAGER, RBAC_SCOPE_PROJECT, PROJECT_TARGET_PROJECT, projectId]
    );
    return null;
  }
  return await upsertUserGrant(userId, {
    permissionKey: write ? PERMISSION_PROJECT_MANAGER : PERMISSION_TRACK_READER,
    scopeType: RBAC_SCOPE_PROJECT,
    scopeProjectId: projectId,
  }, actorUserId, db);
}

function projectLevelWriteEnabled(access) {
  return Boolean(access?.canManageProject);
}

function hasTrackLevelWrite(access) {
  return Boolean(access?.canCreateTracks || access?.canManageTracks || projectLevelWriteEnabled(access));
}

function snapshotTrackMap(snapshot = {}) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  return new Map(tracks.map((track) => [track.id, track]));
}

function snapshotGroupNodeMap(snapshot = {}) {
  const nodes = buildNormalizedTrackTree(snapshot).filter((node) => node.kind === 'group');
  return new Map(nodes.map((node) => [node.id, node]));
}

function snapshotTrackNodeMap(snapshot = {}) {
  const nodes = buildNormalizedTrackTree(snapshot).filter((node) => node.kind === 'track');
  return new Map(nodes.map((node) => [node.trackId, node]));
}

function normalizeTrackForWriteComparison(track = {}) {
  return {
    id: track.id,
    type: track.type || TRACK_NODE_TYPE_AUDIO,
    name: track.name,
    part: Boolean(track.part),
    role: track.role,
    icon: track.icon,
    volume: track.volume,
    pan: track.pan,
    muted: Boolean(track.muted),
    soloed: Boolean(track.soloed),
    clips: Array.isArray(track.clips) ? track.clips.map((clip) => ({
      id: clip.id,
      blobId: clip.blobId,
      timelineStartMs: clip.timelineStartMs,
      sourceStartMs: clip.sourceStartMs,
      sourceDurationMs: clip.sourceDurationMs,
      cropStartMs: clip.cropStartMs,
      cropEndMs: clip.cropEndMs,
      gainDb: clip.gainDb,
      muted: Boolean(clip.muted),
    })) : [],
    createdByUserId: normalizeText(track.createdByUserId) || null,
    accessScopeType: TRACK_BINDING_SCOPE_TYPES.includes(normalizeLowerText(track.accessScopeType))
      ? normalizeLowerText(track.accessScopeType)
      : null,
    accessScopeValue: normalizeScopeValue(track.accessScopeValue),
    artistRefs: Array.isArray(track.artistRefs)
      ? track.artistRefs.map((ref) => ({
        type: normalizeLowerText(ref?.type),
        id: normalizeText(ref?.id),
      })).filter((ref) => ref.type && ref.id)
      : [],
  };
}

function stripTrackWriteRestrictedShape(track = {}) {
  const normalized = normalizeTrackForWriteComparison(track);
  return {
    ...normalized,
    role: null,
    soloed: false,
    createdByUserId: null,
    accessScopeType: null,
    accessScopeValue: null,
  };
}

function normalizeGroupForComparison(node = {}) {
  return {
    id: node.id,
    type: TRACK_NODE_TYPE_GROUP,
    parentId: node.parentId || null,
    order: toNumber(node.order, 0),
    name: node.name,
    part: Boolean(node.part),
    muted: Boolean(node.muted),
    soloed: Boolean(node.soloed),
    volume: toNumber(node.volume, 100),
    pan: toNumber(node.pan, 0),
    role: normalizeGroupRole(node.role),
  };
}

function normalizeTopLevelForRestrictedWrite(snapshot = {}) {
  return {
    projectId: snapshot.projectId,
    projectName: snapshot.projectName,
    musicalNumber: snapshot.musicalNumber,
    published: isProjectPublished(snapshot, null),
    sampleRate: snapshot.sampleRate,
    masterVolume: snapshot.masterVolume,
    autoPan: snapshot.autoPan || null,
    exportSettings: snapshot.exportSettings || null,
    credits: snapshot.credits || null,
  };
}

function trackMatchesGrantedScopeEntry(trackInfo, scope, project) {
  if (!trackInfo || !scope) return false;
  let baseMatches = false;
  if (scope.type === RBAC_SCOPE_ALL || scope.type === RBAC_SCOPE_GROUP_NAME || scope.type === RBAC_SCOPE_PART_NAME) {
    baseMatches = true;
  } else if (scope.type === RBAC_SCOPE_SHOW) {
    baseMatches = Boolean(project?.showId) && String(scope.showId || '') === String(project.showId);
  } else if (scope.type === RBAC_SCOPE_PROJECT) {
    baseMatches = Boolean(project?.id) && String(scope.projectId || '') === String(project.id);
  } else if (scope.type === RBAC_SCOPE_TRACK) {
    const targetTrackId = String(scope.trackId || scope.value || '');
    baseMatches = String(trackInfo.trackId || '') === targetTrackId
      || String(trackInfo.nodeId || '') === targetTrackId
      || (trackInfo.ancestorTrackIds || []).includes(targetTrackId);
  }
  if (!baseMatches) return false;

  const groupValue = normalizeScopeValue(scope.groupNameValue || (scope.type === TRACK_SCOPE_GROUP_NAME ? scope.value : null));
  const partValue = normalizeScopeValue(scope.partNameValue || (scope.type === TRACK_SCOPE_PART_NAME ? scope.value : null));
  if (groupValue && !trackInfo.derivedGroupValues?.has(groupValue)) return false;
  if (partValue && !trackInfo.derivedPartValues?.has(partValue)) return false;
  return true;
}

function buildProjectTagSetFromSnapshot(snapshot = {}) {
  const tags = {
    [PROJECT_TARGET_GROUP_NAME]: new Set(),
    [PROJECT_TARGET_PART_NAME]: new Set(),
  };
  for (const tag of extractProjectAccessTags(snapshot)) {
    if (tags[tag.tagType]) {
      tags[tag.tagType].add(tag.tagValue);
    }
  }
  return tags;
}

function projectMatchesScopeEntry(scope, project = null, projectTags = null, trackInfoById = null) {
  if (!scope) return false;
  const shape = {
    scopeType: scope.type,
    scopeShowId: scope.showId || null,
    scopeProjectId: scope.projectId || null,
    scopeTrackId: scope.trackId || null,
    scopeNameValue: scope.value || null,
    scopeGroupNameValue: scope.groupNameValue || (scope.type === RBAC_SCOPE_GROUP_NAME ? scope.value : null),
    scopePartNameValue: scope.partNameValue || (scope.type === RBAC_SCOPE_PART_NAME ? scope.value : null),
  };
  return structuralScopeMatchesProject(shape, project, trackInfoById)
    && projectMatchesShapeNameFilters(shape, projectTags, trackInfoById);
}

function trackIsEditable(trackInfo, access, userId, project = null, projectCreatedByUserId = null, options = {}) {
  if (projectLevelWriteEnabled(access)) return true;
  if (!trackInfo) return false;
  const normalizedUserId = normalizeText(userId);
  const fallbackOwnerUserId = normalizeText(projectCreatedByUserId);
  if (access?.canManageTracks) {
    const scopes = Array.isArray(access?.manageableTrackScopes) ? access.manageableTrackScopes : [];
    if (scopes.some((scope) => trackMatchesGrantedScopeEntry(trackInfo, scope, project))) {
      return true;
    }
  }
  {
    const ownerUserId = normalizeText(trackInfo.createdByUserId) || fallbackOwnerUserId;
    if (ownerUserId && ownerUserId === normalizedUserId) {
      return true;
    }
  }
  if (options.includeArtistAccess !== false && isTrackArtist(trackInfo, normalizedUserId)) {
    return true;
  }
  return false;
}

function canEditAllTracksInSnapshot({
  snapshot = {},
  access,
  userId,
  project = null,
  projectCreatedByUserId = null,
}) {
  if (!hasTrackLevelWrite(access)) return false;
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  if (!tracks.length) return true;
  const trackInfoById = collectTrackBindingInfo(snapshot);
  return tracks.every((track) => trackIsEditable(
    trackInfoById.get(track?.id),
    access,
    userId,
    project,
    projectCreatedByUserId
  ));
}

function soloStateChanged(currentSnapshot = {}, nextSnapshot = {}) {
  const currentTracks = snapshotTrackMap(currentSnapshot);
  const nextTracks = snapshotTrackMap(nextSnapshot);
  const trackIds = new Set([...currentTracks.keys(), ...nextTracks.keys()]);
  for (const trackId of trackIds) {
    if (Boolean(currentTracks.get(trackId)?.soloed) !== Boolean(nextTracks.get(trackId)?.soloed)) {
      return true;
    }
  }

  const currentGroups = snapshotGroupNodeMap(currentSnapshot);
  const nextGroups = snapshotGroupNodeMap(nextSnapshot);
  const groupIds = new Set([...currentGroups.keys(), ...nextGroups.keys()]);
  for (const groupId of groupIds) {
    if (Boolean(currentGroups.get(groupId)?.soloed) !== Boolean(nextGroups.get(groupId)?.soloed)) {
      return true;
    }
  }

  return false;
}

function scopeSpecificity(scope) {
  if (!scope) return -1;
  if (scope.type === RBAC_SCOPE_TRACK) return 5;
  if (scope.partNameValue || scope.type === RBAC_SCOPE_PART_NAME) return 4;
  if (scope.groupNameValue || scope.type === RBAC_SCOPE_GROUP_NAME) return 4;
  if (scope.type === RBAC_SCOPE_PROJECT) return 3;
  if (scope.type === RBAC_SCOPE_SHOW) return 2;
  if (scope.type === RBAC_SCOPE_ALL) return 1;
  return 0;
}

function scopeBindingForCreatedTrack(scope = null) {
  if (!scope) return null;
  if (scope.type === RBAC_SCOPE_TRACK) {
    return { type: RBAC_SCOPE_TRACK, value: scope.trackId || scope.value || null };
  }
  if (scope.partNameValue || scope.type === RBAC_SCOPE_PART_NAME) {
    return {
      type: RBAC_SCOPE_PART_NAME,
      value: scope.partNameValue || scope.value || null,
    };
  }
  if (scope.groupNameValue || scope.type === RBAC_SCOPE_GROUP_NAME) {
    return {
      type: RBAC_SCOPE_GROUP_NAME,
      value: scope.groupNameValue || scope.value || null,
    };
  }
  return null;
}

function chooseCreatableScopeForNewTrack(track, access, project = null, inferredTrackInfo = null) {
  const explicitType = TRACK_BINDING_SCOPE_TYPES.includes(normalizeLowerText(track?.accessScopeType))
    ? normalizeLowerText(track.accessScopeType)
    : null;
  const explicitValue = normalizeScopeValue(track?.accessScopeValue);
  const creatableScopes = Array.isArray(access?.creatableTrackScopes) ? access.creatableTrackScopes : [];

  if (explicitType && explicitValue) {
    const matching = creatableScopes.find((scope) => (
      scope.type === explicitType
      && String(scope.value || scope.trackId || '') === String(explicitType === RBAC_SCOPE_TRACK ? explicitValue : explicitValue)
    ));
    if (!matching) {
      throw new Error('New track scope is not permitted for this project');
    }
    return matching;
  }

  const matchingScopes = creatableScopes
    .filter((scope) => {
      if (!inferredTrackInfo) {
        return scope.type === RBAC_SCOPE_ALL
          || (scope.type === RBAC_SCOPE_SHOW && project?.showId && String(scope.showId || '') === String(project.showId))
          || (scope.type === RBAC_SCOPE_PROJECT && project?.id && String(scope.projectId || '') === String(project.id));
      }
      return trackMatchesGrantedScopeEntry(inferredTrackInfo, scope, project);
    })
    .sort((left, right) => scopeSpecificity(right) - scopeSpecificity(left));

  if (!matchingScopes.length) {
    throw new Error('You cannot create tracks in this scope');
  }

  const best = matchingScopes[0];
  const bestSpecificity = scopeSpecificity(best);
  const equallySpecific = matchingScopes.filter((scope) => scopeSpecificity(scope) === bestSpecificity);
  if (
    bestSpecificity >= 4
    && equallySpecific.length > 1
    && new Set(equallySpecific.map((scope) => {
      const binding = scopeBindingForCreatedTrack(scope);
      return `${binding?.type || scope.type}:${binding?.value || scope.value || scope.trackId || ''}`;
    })).size > 1
  ) {
    throw new Error('New tracks match multiple allowed scopes. Please place them more specifically.');
  }
  return best;
}

function cloneTrackWithStampedAccess(track, { userId, scope = null }) {
  const nextTrack = {
    ...track,
    createdByUserId: normalizeText(track?.createdByUserId) || normalizeText(userId) || null,
  };
  const binding = scopeBindingForCreatedTrack(scope);
  if (binding && TRACK_BINDING_SCOPE_TYPES.includes(binding.type) && binding.value) {
    nextTrack.accessScopeType = binding.type;
    nextTrack.accessScopeValue = normalizeScopeValue(binding.value);
  } else {
    nextTrack.accessScopeType = null;
    nextTrack.accessScopeValue = null;
  }
  return nextTrack;
}

export async function validateAndTransformProjectWrite({
  userId,
  project,
  access,
  currentSnapshot,
  nextSnapshot,
}) {
  if (projectLevelWriteEnabled(access)) {
    const retainScopes = Array.isArray(access?.projectManagerRetainScopes)
      ? access.projectManagerRetainScopes
      : [];
    if (!access?.canManageProjectUnconditionally && retainScopes.length) {
      const normalizedProject = {
        id: project?.id || currentSnapshot?.projectId || nextSnapshot?.projectId,
        showId: project?.showId || currentSnapshot?.showId || nextSnapshot?.showId || null,
      };
      const nextProjectTags = buildProjectTagSetFromSnapshot(nextSnapshot);
      const nextTrackInfo = collectTrackBindingInfo(nextSnapshot);
      const stillCovered = retainScopes.some((scope) => projectMatchesScopeEntry(
        scope,
        normalizedProject,
        nextProjectTags,
        nextTrackInfo
      ));
      if (!stillCovered) {
        throw new Error('That change would remove your only project manager access');
      }
    }
    return nextSnapshot;
  }

  if (!hasTrackLevelWrite(access)) {
    throw new Error('You do not have permission to edit this project');
  }

  if (stableJson(normalizeTopLevelForRestrictedWrite(currentSnapshot)) !== stableJson(normalizeTopLevelForRestrictedWrite(nextSnapshot))) {
    throw new Error('Project-level settings require project manager access');
  }

  const currentGroupMap = snapshotGroupNodeMap(currentSnapshot);
  const nextGroupMap = snapshotGroupNodeMap(nextSnapshot);
  if (currentGroupMap.size !== nextGroupMap.size) {
    throw new Error('Group changes require project manager access');
  }
  for (const [groupId, currentGroup] of currentGroupMap.entries()) {
    const nextGroup = nextGroupMap.get(groupId);
    if (!nextGroup || stableJson(normalizeGroupForComparison(currentGroup)) !== stableJson(normalizeGroupForComparison(nextGroup))) {
      throw new Error('Group changes require project manager access');
    }
  }

  const currentTracks = snapshotTrackMap(currentSnapshot);
  const nextTracks = snapshotTrackMap(nextSnapshot);
  const currentTrackNodes = snapshotTrackNodeMap(currentSnapshot);
  const nextTrackNodes = snapshotTrackNodeMap(nextSnapshot);
  const currentTrackInfo = collectTrackBindingInfo(currentSnapshot);
  const nextTrackInfo = collectTrackBindingInfo(nextSnapshot);
  const projectCreatedByUserId = normalizeText(project?.createdByUserId || project?.created_by || '');
  const normalizedProject = {
    id: project?.id || currentSnapshot?.projectId || nextSnapshot?.projectId,
    showId: project?.showId || currentSnapshot?.showId || nextSnapshot?.showId || null,
  };

  if (
    soloStateChanged(currentSnapshot, nextSnapshot)
    && !canEditAllTracksInSnapshot({
      snapshot: currentSnapshot,
      access,
      userId,
      project: normalizedProject,
      projectCreatedByUserId,
    })
  ) {
    throw new Error('Soloing tracks requires permission to edit every track in the project');
  }

  const nextTracksArray = Array.isArray(nextSnapshot?.tracks) ? [...nextSnapshot.tracks] : [];
  const nextTrackIndexById = new Map(nextTracksArray.map((track, index) => [track.id, index]));

  for (const [trackId, currentTrack] of currentTracks.entries()) {
    if (!nextTracks.has(trackId)) {
      if (!trackIsEditable(currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
        throw new Error('You can only delete tracks that you are allowed to edit');
      }
    }
  }

  for (const [trackId, nextTrack] of nextTracks.entries()) {
    if (!currentTracks.has(trackId)) {
      if (!access?.canCreateTracks) {
        throw new Error('You cannot create tracks in this project');
      }
      const scope = chooseCreatableScopeForNewTrack(nextTrack, access, normalizedProject, nextTrackInfo.get(trackId) || null);
      nextTracksArray[nextTrackIndexById.get(trackId)] = cloneTrackWithStampedAccess(nextTrack, { userId, scope });
      continue;
    }

    const currentTrack = currentTracks.get(trackId);
    const editable = trackIsEditable(currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId);
    if (stableJson(normalizeTrackForWriteComparison(currentTrack)) === stableJson(normalizeTrackForWriteComparison(nextTrack))) {
      continue;
    }
    if (!editable) {
      throw new Error('You can only edit tracks that you are allowed to edit');
    }
    assertTrackArtistSelfRemovalAllowed({
      currentTrack,
      nextTrack,
      currentTrackInfo: currentTrackInfo.get(trackId),
      nextTrackInfo: nextTrackInfo.get(trackId),
      access,
      userId,
      project: normalizedProject,
      projectCreatedByUserId,
    });
    if (!trackIsEditable(nextTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
      throw new Error('That change would move or rename the track outside your permitted scope');
    }
    if (stableJson(stripTrackWriteRestrictedShape(currentTrack)) !== stableJson(stripTrackWriteRestrictedShape(nextTrack))) {
      throw new Error('Track role and scope changes require project manager access');
    }
  }

  for (const [trackId, currentNode] of currentTrackNodes.entries()) {
    const nextNode = nextTrackNodes.get(trackId);
    if (!nextNode) continue;
    if (currentNode.parentId === nextNode.parentId && toNumber(currentNode.order, 0) === toNumber(nextNode.order, 0)) {
      continue;
    }
    if (!trackIsEditable(currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
      throw new Error('You can only move tracks that you are allowed to edit');
    }
    if (!trackIsEditable(nextTrackInfo.get(trackId) || currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
      throw new Error('Moving this track would break its allowed scope');
    }
  }

  return {
    ...nextSnapshot,
    tracks: nextTracksArray,
  };
}

export function canUserMutateTrack({ access, track, trackInfoById, userId, project = null, projectCreatedByUserId = null }) {
  const trackInfo = trackInfoById?.get(track?.id) || null;
  return trackIsEditable(trackInfo, access, userId, project, projectCreatedByUserId);
}

export function getEditableTrackScopeChoices(access = null) {
  return Array.isArray(access?.creatableTrackScopes) ? access.creatableTrackScopes : [];
}

export function buildTrackAccessInfoMap(snapshot = {}) {
  return collectTrackBindingInfo(snapshot);
}

export async function canCreateProjectsInShow(userId, showId, db = pool) {
  const accessMap = await getShowAccessMap(userId, [{ id: showId }], db);
  return Boolean(accessMap.get(String(showId))?.canCreateProjects);
}

export async function getUserAccessSummary(userId, db = pool) {
  await ensureDefaultUserRoleMembership(userId, db);
  const [defaultRole, appSettings] = await Promise.all([
    getDefaultUserRole(db),
    getAppSettings(db),
  ]);
  const defaultRoleGrantCountResult = defaultRole
    ? await db.query(
      `SELECT COUNT(*)::integer AS "count"
       FROM rbac_grants
       WHERE role_id = $1`,
      [defaultRole.id]
    )
    : { rows: [{ count: 0 }] };
  const defaultRoleHasGrants = Number(defaultRoleGrantCountResult.rows?.[0]?.count || 0) > 0;
  const playerSettings = getEffectiveAppSettingsForMode(appSettings, 'player');
  const dawSettings = getEffectiveAppSettingsForMode(appSettings, 'daw');
  const emptyAccessMessage = normalizeText(appSettings.noAccessMessage)
    || normalizeText(defaultRole?.emptyAccessMessage)
    || DEFAULT_EMPTY_ACCESS_MESSAGE;
  const isAdmin = await userHasAdminRole(userId, db);
  const grants = await listResolvedGrantsForUser(userId, db);
  const canCreateShows = isAdmin || grants.some((grant) => normalizeGrantShape(grant).permissionKey === PERMISSION_SHOW_CREATOR);

  const [showRowsResult, projectRowsResult] = await Promise.all([
    db.query(
      `SELECT id,
              name,
              order_index AS "orderIndex",
              created_by AS "createdByUserId"
       FROM shows`
    ),
    db.query(
      `SELECT p.id,
              p.name,
              p.created_by AS "createdByUserId",
              p.show_id AS "showId",
              s.name AS "showName",
              s.created_by AS "showCreatedByUserId"
       FROM projects p
       LEFT JOIN shows s
         ON s.id = p.show_id`
    ),
  ]);
  const [showAccessMap, accessMap] = await Promise.all([
    getShowAccessMap(userId, showRowsResult.rows, db),
    getProjectAccessMap(userId, projectRowsResult.rows, db),
  ]);
  const canCreateProjects = Array.from(showAccessMap.values()).some((access) => access.canCreateProjects);
  const canManageShows = Array.from(showAccessMap.values()).some((access) => access.canManageShow);
  const hasProjectAccess = Array.from(accessMap.values()).some((access) => (
    access.canListenTutti
    || access.canOpenProject
    || access.canSeeProject
    || access.canManageProject
  ));
  const hasShowAccess = Array.from(showAccessMap.values()).some((access) => access.canSeeShow || access.canManageShow);

  const hasAnyAccess = Boolean(isAdmin || canCreateShows || canCreateProjects || canManageShows || hasShowAccess || hasProjectAccess);
  return {
    hasAnyAccess,
    showNoAccessMessage: !hasAnyAccess,
    emptyAccessMessage,
    playerNoAccessMessage: playerSettings.noAccessMessage || emptyAccessMessage,
    dawNoAccessMessage: dawSettings.noAccessMessage || emptyAccessMessage,
    showSettings: {
      defaultShowId: appSettings.defaultShowId,
      splitPlayerDawDefaults: appSettings.splitPlayerDawDefaults,
      playerDefaultShowId: appSettings.playerDefaultShowId,
      dawDefaultShowId: appSettings.dawDefaultShowId,
      noAccessMessage: emptyAccessMessage,
      playerNoAccessMessage: playerSettings.noAccessMessage || emptyAccessMessage,
      dawNoAccessMessage: dawSettings.noAccessMessage || emptyAccessMessage,
    },
    defaultRoleHasGrants,
    canCreateProjects,
    canCreateShows,
    canManageShows,
  };
}
