// Pure access-rule evaluation shared by the server (authoritative enforcement in
// server/src/rbac.js) and the frontend (UI gating in src/hooks/useProjectCapabilities.js).
//
// Everything in this module is a pure function of plain data: a project snapshot,
// the per-project access summary the server computes, the current user id and a
// lightweight project descriptor ({ id, showId, createdByUserId }). It must not
// import anything from the server or the browser runtime.

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

export const TRACK_SCOPE_GROUP_NAME = 'group_name';
export const TRACK_SCOPE_PART_NAME = 'part_name';
export const TRACK_SCOPE_TYPES = [
  TRACK_SCOPE_GROUP_NAME,
  TRACK_SCOPE_PART_NAME,
];
export const TRACK_BINDING_SCOPE_TYPES = [
  RBAC_SCOPE_TRACK,
  TRACK_SCOPE_GROUP_NAME,
  TRACK_SCOPE_PART_NAME,
];

export const TRACK_ROLE_INSTRUMENT = 'instrument';
export const TRACK_ROLE_LEAD = 'lead';
export const TRACK_ROLE_CHOIR = 'choir';
export const TRACK_ROLE_METRONOME = 'metronome';
export const TRACK_ROLE_OTHER = 'other';
export const GROUP_ROLE_NONE = 'group';
export const GROUP_ROLE_INSTRUMENTS = 'instruments';
export const GROUP_ROLE_LEADS = 'leads';
export const GROUP_ROLE_CHOIRS = 'choirs';
export const GROUP_ROLE_OTHERS = 'others';
export const TRACK_NODE_TYPE_GROUP = 'group';
export const TRACK_NODE_TYPE_AUDIO = 'audio';

export const COUNTABLE_TRACK_ROLES = new Set([
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
]);

export const GROUP_PARENT_ROLES = new Set([
  GROUP_ROLE_INSTRUMENTS,
  GROUP_ROLE_LEADS,
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_OTHERS,
]);

export const GROUP_ALLOWED_ROLES = new Set([
  GROUP_ROLE_NONE,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_METRONOME,
  TRACK_ROLE_OTHER,
  ...Array.from({ length: 5 }, (_unused, idx) => `choir-part-${idx + 1}`),
  ...GROUP_PARENT_ROLES,
]);

// Error code carried by every fine-grained write rejection so that transports
// (WebSocket + REST) and the client can recognise it without parsing messages.
export const WRITE_REJECTED_CODE = 'WRITE_REJECTED';

export class ProjectWriteRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectWriteRejectedError';
    this.code = WRITE_REJECTED_CODE;
  }
}

export function isProjectWriteRejectedError(error) {
  return Boolean(error) && (
    error instanceof ProjectWriteRejectedError
    || error?.code === WRITE_REJECTED_CODE
  );
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export function normalizeText(value) {
  return String(value ?? '').trim();
}

export function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeBoolean(value) {
  return value === true || normalizeLowerText(value) === 'true';
}

export function isProjectPublished(project = null, snapshot = null) {
  return normalizeBoolean(project?.published ?? project?.publish ?? snapshot?.published ?? snapshot?.publish);
}

export function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function sortByOrder(left, right) {
  return toNumber(left?.order, 0) - toNumber(right?.order, 0);
}

export function stableJson(value) {
  return JSON.stringify(value ?? null);
}

export function normalizeScopeValue(value) {
  const normalized = normalizeLowerText(value);
  return normalized || null;
}

export function normalizeArtistUserIds(value = []) {
  const refs = Array.isArray(value) ? value : [];
  return new Set(refs
    .map((ref) => {
      const type = normalizeLowerText(ref?.type);
      const id = normalizeText(ref?.id || ref?.userId);
      return type === 'user' && id ? id : null;
    })
    .filter(Boolean));
}

// ---------------------------------------------------------------------------
// Track / group role helpers
// ---------------------------------------------------------------------------

export function isChoirPartRole(role) {
  return typeof role === 'string' && role.startsWith('choir-part-');
}

export function isMetronomeRole(role) {
  return role === TRACK_ROLE_METRONOME;
}

export function normalizeTrackRole(role) {
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

export function normalizeGroupRole(role) {
  return GROUP_ALLOWED_ROLES.has(role) ? role : GROUP_ROLE_NONE;
}

export function toCategoryRole(role) {
  const normalized = normalizeTrackRole(role);
  return isChoirPartRole(normalized) ? TRACK_ROLE_CHOIR : normalized;
}

export function isGroupParentRole(role) {
  return GROUP_PARENT_ROLES.has(role);
}

export function mapGroupParentRoleToTrackRole(role) {
  if (role === GROUP_ROLE_INSTRUMENTS) return TRACK_ROLE_INSTRUMENT;
  if (role === GROUP_ROLE_LEADS) return TRACK_ROLE_LEAD;
  if (role === GROUP_ROLE_CHOIRS) return TRACK_ROLE_CHOIR;
  if (role === GROUP_ROLE_OTHERS) return TRACK_ROLE_OTHER;
  return null;
}

export function isLegacyPartGroupRole(role) {
  const normalized = normalizeGroupRole(role);
  return (
    normalized !== GROUP_ROLE_NONE
    && normalized !== GROUP_ROLE_OTHERS
    && !isGroupParentRole(normalized)
  );
}

export function normalizePartFlag(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return Boolean(fallback);
}

export function buildChildrenMap(nodes = []) {
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

export function buildNormalizedTrackTree(snapshot = {}) {
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

// ---------------------------------------------------------------------------
// Track binding info: everything the scope matcher needs to know about a track
// ---------------------------------------------------------------------------

export function collectTrackBindingInfo(snapshot = {}) {
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

// ---------------------------------------------------------------------------
// Access-summary level predicates
// ---------------------------------------------------------------------------

export function projectLevelWriteEnabled(access) {
  return Boolean(access?.canManageProject);
}

export function hasTrackLevelWrite(access) {
  return Boolean(access?.canCreateTracks || access?.canManageTracks || projectLevelWriteEnabled(access));
}

// Export (rendered mixes, stems, project ZIP) is a project-manager action. The
// two server-side touchpoints of the export flow (forced checkpoint and
// persisting exportSettings) already require project-manager access.
export function canExportProject(access) {
  return projectLevelWriteEnabled(access);
}

export function canEditProjectSettings(access) {
  return projectLevelWriteEnabled(access);
}

export function canManageGroups(access) {
  return projectLevelWriteEnabled(access);
}

export function canChangeTrackRoles(access) {
  return projectLevelWriteEnabled(access);
}

// ---------------------------------------------------------------------------
// Snapshot shape helpers used to detect which parts of a write changed
// ---------------------------------------------------------------------------

export function snapshotTrackMap(snapshot = {}) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  return new Map(tracks.map((track) => [track.id, track]));
}

export function snapshotGroupNodeMap(snapshot = {}) {
  const nodes = buildNormalizedTrackTree(snapshot).filter((node) => node.kind === 'group');
  return new Map(nodes.map((node) => [node.id, node]));
}

export function snapshotTrackNodeMap(snapshot = {}) {
  const nodes = buildNormalizedTrackTree(snapshot).filter((node) => node.kind === 'track');
  return new Map(nodes.map((node) => [node.trackId, node]));
}

export function normalizeTrackForWriteComparison(track = {}) {
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
        id: normalizeText(ref?.id || ref?.userId),
      }))
      : [],
  };
}

export function stripTrackWriteRestrictedShape(track = {}) {
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

// The fields of a track that only project managers may change on an existing
// track. Solo is handled separately (it requires edit access to every track).
export function pickTrackWriteRestrictedShape(track = {}) {
  return {
    role: track?.role ?? null,
    createdByUserId: normalizeText(track?.createdByUserId) || null,
    accessScopeType: normalizeLowerText(track?.accessScopeType) || null,
    accessScopeValue: normalizeScopeValue(track?.accessScopeValue) || null,
  };
}

export function trackWriteRestrictedShapeChanged(currentTrack, nextTrack) {
  return stableJson(pickTrackWriteRestrictedShape(currentTrack)) !== stableJson(pickTrackWriteRestrictedShape(nextTrack));
}

export function normalizeGroupForComparison(node = {}) {
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

export function normalizeTopLevelForRestrictedWrite(snapshot = {}) {
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

// ---------------------------------------------------------------------------
// Scope matching
// ---------------------------------------------------------------------------

export function trackMatchesGrantedScopeEntry(trackInfo, scope, project) {
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

export function isTrackArtist(trackInfo, userId) {
  const normalizedUserId = normalizeText(userId);
  return Boolean(normalizedUserId && trackInfo?.artistUserIds?.has(normalizedUserId));
}

export function trackIsEditable(trackInfo, access, userId, project = null, projectCreatedByUserId = null, options = {}) {
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

export function canEditAllTracksInSnapshot({
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

export function soloStateChanged(currentSnapshot = {}, nextSnapshot = {}) {
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

// ---------------------------------------------------------------------------
// New-track scope resolution
// ---------------------------------------------------------------------------

export function scopeSpecificity(scope) {
  if (!scope) return -1;
  if (scope.type === RBAC_SCOPE_TRACK) return 5;
  if (scope.partNameValue || scope.type === RBAC_SCOPE_PART_NAME) return 4;
  if (scope.groupNameValue || scope.type === RBAC_SCOPE_GROUP_NAME) return 4;
  if (scope.type === RBAC_SCOPE_PROJECT) return 3;
  if (scope.type === RBAC_SCOPE_SHOW) return 2;
  if (scope.type === RBAC_SCOPE_ALL) return 1;
  return 0;
}

export function scopeBindingForCreatedTrack(scope = null) {
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

export function chooseCreatableScopeForNewTrack(track, access, project = null, inferredTrackInfo = null) {
  const explicitType = TRACK_BINDING_SCOPE_TYPES.includes(normalizeLowerText(track?.accessScopeType))
    ? normalizeLowerText(track.accessScopeType)
    : null;
  const explicitValue = normalizeScopeValue(track?.accessScopeValue);
  const creatableScopes = Array.isArray(access?.creatableTrackScopes) ? access.creatableTrackScopes : [];

  if (explicitType && explicitValue) {
    const matching = creatableScopes.find((scope) => (
      scope.type === explicitType
      && String(scope.value || scope.trackId || '') === String(explicitValue)
    ));
    if (!matching) {
      throw new ProjectWriteRejectedError('New track scope is not permitted for this project');
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
    throw new ProjectWriteRejectedError('You cannot create tracks in this scope');
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
    throw new ProjectWriteRejectedError('New tracks match multiple allowed scopes. Please place them more specifically.');
  }
  return best;
}

// Non-throwing variant for UI gating: can this user create a track at all in
// this project? (Placement-specific checks still happen on the server.)
export function canCreateTrackInProject(access, project = null, inferredTrackInfo = null) {
  if (projectLevelWriteEnabled(access)) return true;
  if (!access?.canCreateTracks) return false;
  try {
    chooseCreatableScopeForNewTrack({}, access, project, inferredTrackInfo);
    return true;
  } catch (error) {
    if (isProjectWriteRejectedError(error)) return false;
    throw error;
  }
}

export function cloneTrackWithStampedAccess(track, { userId, scope = null }) {
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

// ---------------------------------------------------------------------------
// Client-side pre-validation
// ---------------------------------------------------------------------------

/**
 * Synchronous mirror of the server's track-level write validation
 * (server/src/rbac.js validateAndTransformProjectWrite). Returns the rejection
 * message the server would produce, or null when the write would be accepted.
 *
 * Used by the editor to refuse an optimistic update *before* it is applied so
 * a forbidden change is never visible for a frame. The two server-only checks
 * (project-manager retain scopes and track-artist self-removal) are not
 * mirrored; those are rare and still handled by the structured rejection path.
 */
export function findProjectWriteViolation({
  access,
  currentSnapshot,
  nextSnapshot,
  userId,
  project = null,
  projectCreatedByUserId = null,
}) {
  if (!currentSnapshot || !nextSnapshot || currentSnapshot === nextSnapshot) return null;
  if (projectLevelWriteEnabled(access)) return null;
  if (!hasTrackLevelWrite(access)) {
    return 'You do not have permission to edit this project';
  }

  if (stableJson(normalizeTopLevelForRestrictedWrite(currentSnapshot)) !== stableJson(normalizeTopLevelForRestrictedWrite(nextSnapshot))) {
    return 'Project-level settings require project manager access';
  }

  const currentGroupMap = snapshotGroupNodeMap(currentSnapshot);
  const nextGroupMap = snapshotGroupNodeMap(nextSnapshot);
  if (currentGroupMap.size !== nextGroupMap.size) {
    return 'Group changes require project manager access';
  }
  for (const [groupId, currentGroup] of currentGroupMap.entries()) {
    const nextGroup = nextGroupMap.get(groupId);
    if (!nextGroup || stableJson(normalizeGroupForComparison(currentGroup)) !== stableJson(normalizeGroupForComparison(nextGroup))) {
      return 'Group changes require project manager access';
    }
  }

  const currentTracks = snapshotTrackMap(currentSnapshot);
  const nextTracks = snapshotTrackMap(nextSnapshot);
  const currentTrackNodes = snapshotTrackNodeMap(currentSnapshot);
  const nextTrackNodes = snapshotTrackNodeMap(nextSnapshot);
  const currentTrackInfo = collectTrackBindingInfo(currentSnapshot);
  const nextTrackInfo = collectTrackBindingInfo(nextSnapshot);
  const normalizedProject = {
    id: project?.id || currentSnapshot?.projectId || nextSnapshot?.projectId || null,
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
    return 'Soloing tracks requires permission to edit every track in the project';
  }

  for (const trackId of currentTracks.keys()) {
    if (!nextTracks.has(trackId)) {
      if (!trackIsEditable(currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
        return 'You can only delete tracks that you are allowed to edit';
      }
    }
  }

  for (const [trackId, nextTrack] of nextTracks.entries()) {
    if (!currentTracks.has(trackId)) {
      if (!access?.canCreateTracks) {
        return 'You cannot create tracks in this project';
      }
      try {
        chooseCreatableScopeForNewTrack(nextTrack, access, normalizedProject, nextTrackInfo.get(trackId) || null);
      } catch (error) {
        if (isProjectWriteRejectedError(error)) return error.message;
        throw error;
      }
      continue;
    }

    const currentTrack = currentTracks.get(trackId);
    if (stableJson(normalizeTrackForWriteComparison(currentTrack)) === stableJson(normalizeTrackForWriteComparison(nextTrack))) {
      continue;
    }
    if (!trackIsEditable(currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
      return 'You can only edit tracks that you are allowed to edit';
    }
    if (!trackIsEditable(nextTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
      return 'That change would move or rename the track outside your permitted scope';
    }
    if (trackWriteRestrictedShapeChanged(currentTrack, nextTrack)) {
      return 'Track role and scope changes require project manager access';
    }
  }

  for (const [trackId, currentNode] of currentTrackNodes.entries()) {
    const nextNode = nextTrackNodes.get(trackId);
    if (!nextNode) continue;
    if (currentNode.parentId === nextNode.parentId && toNumber(currentNode.order, 0) === toNumber(nextNode.order, 0)) {
      continue;
    }
    if (!trackIsEditable(currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
      return 'You can only move tracks that you are allowed to edit';
    }
    if (!trackIsEditable(nextTrackInfo.get(trackId) || currentTrackInfo.get(trackId), access, userId, normalizedProject, projectCreatedByUserId)) {
      return 'Moving this track would break its allowed scope';
    }
  }

  return null;
}

// Fields the server stamps onto tracks during validation. The client merges
// these back from `op.ack` so its local copy matches the stored snapshot.
export const TRACK_ACCESS_STAMP_FIELDS = ['createdByUserId', 'accessScopeType', 'accessScopeValue'];

export function collectTrackAccessStamps(snapshot = {}) {
  const stamps = {};
  for (const track of Array.isArray(snapshot?.tracks) ? snapshot.tracks : []) {
    if (!track?.id) continue;
    stamps[track.id] = {
      createdByUserId: normalizeText(track.createdByUserId) || null,
      accessScopeType: TRACK_BINDING_SCOPE_TYPES.includes(normalizeLowerText(track.accessScopeType))
        ? normalizeLowerText(track.accessScopeType)
        : null,
      accessScopeValue: normalizeScopeValue(track.accessScopeValue),
    };
  }
  return stamps;
}

export function trackAccessStampsDiffer(currentSnapshot = {}, nextSnapshot = {}) {
  return stableJson(collectTrackAccessStamps(currentSnapshot)) !== stableJson(collectTrackAccessStamps(nextSnapshot));
}

export function applyTrackAccessStamps(snapshot, stampsByTrackId = {}) {
  if (!snapshot || typeof snapshot !== 'object' || !stampsByTrackId) return snapshot;
  let changed = false;
  const nextTracks = (Array.isArray(snapshot.tracks) ? snapshot.tracks : []).map((track) => {
    const stamp = track?.id ? stampsByTrackId[track.id] : null;
    if (!stamp) return track;
    const current = collectTrackAccessStamps({ tracks: [track] })[track.id];
    if (stableJson(current) === stableJson(stamp)) return track;
    changed = true;
    return { ...track, ...stamp };
  });
  if (!changed) return snapshot;
  return { ...snapshot, tracks: nextTracks };
}
