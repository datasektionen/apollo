import { volumeToGain } from './audio';
import { createId } from './id';
import {
  TRACK_ROLE_CHOIR,
  TRACK_ROLE_INSTRUMENT,
  TRACK_ROLE_LEAD,
  TRACK_ROLE_METRONOME,
  TRACK_ROLE_OTHER,
  GROUP_ROLE_NONE,
  GROUP_ROLE_OTHERS,
  isChoirPartRole,
  isChoirRole,
  isGroupParentRole,
  isMetronomeRole,
  getStemIcon,
  mapGroupParentRoleToTrackRole,
  normalizeGroupRole,
  toCategoryRole,
} from './trackRoles';

const GROUP_HEIGHT = 100;
const ROOT_PARENT_ID = null;

export const TRACK_NODE_TYPE_GROUP = 'group';
export const TRACK_NODE_TYPE_AUDIO = 'audio';

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sortByOrder(a, b) {
  return toNumber(a.order, 0) - toNumber(b.order, 0);
}

function clampPan(value) {
  return Math.max(-100, Math.min(100, toNumber(value, 0)));
}

function isCountableRole(role) {
  return role === TRACK_ROLE_INSTRUMENT || role === TRACK_ROLE_LEAD || role === TRACK_ROLE_CHOIR;
}

function makeTrackNode(trackId, order = 0, parentId = ROOT_PARENT_ID) {
  return {
    id: createId(),
    kind: 'track',
    type: TRACK_NODE_TYPE_AUDIO,
    parentId,
    order,
    trackId,
    part: false,
  };
}

export function getTrackHeight(track) {
  return 100;
}

function getGroupHeight(groupNode) {
  return GROUP_HEIGHT;
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

function normalizeArtistRefs(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((ref) => ({
      type: String(ref?.type || '').trim(),
      id: String(ref?.id || '').trim(),
    }))
    .filter((ref) => {
      const key = `${ref.type}:${ref.id}`;
      if (!ref.type || !ref.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function enforcePartNestingRule(nodes) {
  const childrenMap = getChildrenMap(nodes);
  const walk = (parentId, hasPartAncestor) => {
    const key = parentId || '__root__';
    const children = childrenMap.get(key) || [];
    children.forEach((node) => {
      if (hasPartAncestor && node.part) {
        node.part = false;
      }
      walk(node.id, hasPartAncestor || Boolean(node.part));
    });
  };
  walk(ROOT_PARENT_ID, false);
  return nodes;
}

export function normalizeTrackTree(project) {
  if (!project) return project;
  const tracks = Array.isArray(project.tracks) ? project.tracks : [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const rawNodes = Array.isArray(project.trackTree) ? project.trackTree : [];

  const normalizedNodes = [];
  const seenNodeIds = new Set();
  const seenTrackIds = new Set();

  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const rawKind = rawNode.kind ?? rawNode.type;
    const kind = rawKind === 'group'
      ? 'group'
      : (
        rawKind === 'track' || rawKind === TRACK_NODE_TYPE_AUDIO
          ? 'track'
          : null
      );
    if (!kind) continue;
    const legacyNodeId = rawNode.id ?? rawNode.nodeId;
    const nodeId = typeof legacyNodeId === 'string' && legacyNodeId && !seenNodeIds.has(legacyNodeId)
      ? legacyNodeId
      : createId();
    seenNodeIds.add(nodeId);

    const legacyParentId = rawNode.parentId ?? rawNode.parentNodeId;

    if (kind === 'track') {
      const legacyTrackId = rawNode.trackId ?? rawNode.track_id;
      if (!trackIds.has(legacyTrackId) || seenTrackIds.has(legacyTrackId)) {
        continue;
      }
      const track = tracks.find((candidate) => candidate.id === legacyTrackId);
      seenTrackIds.add(legacyTrackId);
      normalizedNodes.push({
        id: nodeId,
        kind: 'track',
        type: TRACK_NODE_TYPE_AUDIO,
        parentId: typeof legacyParentId === 'string' ? legacyParentId : ROOT_PARENT_ID,
        order: toNumber(rawNode.order, 0),
        trackId: legacyTrackId,
        part: normalizePartFlag(rawNode.part, track?.part),
      });
      continue;
    }

    const role = normalizeGroupRole(rawNode.role);
    normalizedNodes.push({
      id: nodeId,
      kind: 'group',
      type: TRACK_NODE_TYPE_GROUP,
      parentId: typeof legacyParentId === 'string' ? legacyParentId : ROOT_PARENT_ID,
      order: toNumber(rawNode.order, 0),
      name: typeof rawNode.name === 'string' && rawNode.name.trim() ? rawNode.name : 'Group',
      collapsed: Boolean(rawNode.collapsed),
      muted: Boolean(rawNode.muted),
      soloed: Boolean(rawNode.soloed),
      volume: Math.max(0, Math.min(100, toNumber(rawNode.volume, 100))),
      pan: clampPan(rawNode.pan),
      ...(Number.isFinite(Number(rawNode.autoPanStoredPan))
        ? { autoPanStoredPan: clampPan(rawNode.autoPanStoredPan) }
        : {}),
      role,
      part: normalizePartFlag(rawNode.part, isLegacyPartGroupRole(role)),
      artistRefs: normalizeArtistRefs(rawNode.artistRefs),
    });
  }

  const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
  for (const node of normalizedNodes) {
    if (node.parentId === ROOT_PARENT_ID) continue;
    const parent = nodeById.get(node.parentId);
    if (!parent || parent.kind !== 'group') {
      node.parentId = ROOT_PARENT_ID;
    }
  }

  const missingTrackIds = tracks
    .map((track) => track.id)
    .filter((trackId) => !seenTrackIds.has(trackId));
  const rootOrderBase = normalizedNodes
    .filter((node) => node.parentId === ROOT_PARENT_ID)
    .reduce((max, node) => Math.max(max, toNumber(node.order, 0)), -1);

  missingTrackIds.forEach((trackId, idx) => {
    const track = tracks.find((candidate) => candidate.id === trackId);
    normalizedNodes.push({
      ...makeTrackNode(trackId, rootOrderBase + idx + 1, ROOT_PARENT_ID),
      part: normalizePartFlag(track?.part, false),
    });
  });

  enforcePartNestingRule(normalizedNodes);

  const grouped = new Map();
  for (const node of normalizedNodes) {
    const key = node.parentId || '__root__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node);
  }
  for (const siblings of grouped.values()) {
    siblings.sort(sortByOrder);
    siblings.forEach((node, idx) => {
      node.order = idx;
    });
  }

  return { ...project, trackTree: normalizedNodes };
}

function getChildrenMap(trackTree) {
  const map = new Map();
  for (const node of trackTree) {
    const key = node.parentId || '__root__';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(node);
  }
  for (const siblings of map.values()) {
    siblings.sort(sortByOrder);
  }
  return map;
}

export function getTrackNodeByTrackId(project, trackId) {
  const trackTree = project?.trackTree || [];
  return trackTree.find((node) => node.kind === 'track' && node.trackId === trackId) || null;
}

export function getVisibleTimelineRows(project) {
  const normalized = normalizeTrackTree(project);
  const trackById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
  const rows = [];
  const childrenMap = getChildrenMap(normalized.trackTree || []);

  const walk = (parentId, depth) => {
    const key = parentId || '__root__';
    const children = childrenMap.get(key) || [];
    for (const node of children) {
      if (node.kind === 'group') {
        rows.push({
          kind: 'group',
          nodeId: node.id,
          parentId: node.parentId || ROOT_PARENT_ID,
          depth,
          name: node.name,
          type: TRACK_NODE_TYPE_GROUP,
          part: Boolean(node.part),
          collapsed: Boolean(node.collapsed),
          height: getGroupHeight(node),
          muted: Boolean(node.muted),
          soloed: Boolean(node.soloed),
          volume: Math.max(0, Math.min(100, toNumber(node.volume, 100))),
          pan: clampPan(node.pan),
          role: normalizeGroupRole(node.role),
          artistRefs: normalizeArtistRefs(node.artistRefs),
        });
        if (!node.collapsed) {
          walk(node.id, depth + 1);
        }
      } else {
        const track = trackById.get(node.trackId);
        if (!track) continue;
        const part = normalizePartFlag(node.part, track.part);
        rows.push({
          kind: 'track',
          nodeId: node.id,
          trackId: track.id,
          type: TRACK_NODE_TYPE_AUDIO,
          part,
          parentId: node.parentId || ROOT_PARENT_ID,
          depth,
          track: { ...track, type: TRACK_NODE_TYPE_AUDIO, part },
          height: getTrackHeight(track),
        });
      }
    }
  };

  walk(ROOT_PARENT_ID, 0);
  return rows;
}

export function getVisibleTrackIds(project) {
  return getVisibleTimelineRows(project)
    .filter((row) => row.kind === 'track')
    .map((row) => row.trackId);
}

export function getGroupDescendantTrackIdsByGroup(project) {
  const normalized = normalizeTrackTree(project);
  const childrenMap = getChildrenMap(normalized.trackTree || []);
  const byGroupId = new Map();

  const walk = (parentId) => {
    const key = parentId || '__root__';
    const children = childrenMap.get(key) || [];
    const trackIds = [];
    for (const node of children) {
      if (node.kind === 'track') {
        trackIds.push(node.trackId);
        continue;
      }
      const nestedTrackIds = walk(node.id);
      byGroupId.set(node.id, nestedTrackIds);
      trackIds.push(...nestedTrackIds);
    }
    return trackIds;
  };

  walk(ROOT_PARENT_ID);
  return byGroupId;
}

export function reorderTracksByTree(project) {
  if (!project) return project;
  const normalized = normalizeTrackTree(project);
  const childrenMap = getChildrenMap(normalized.trackTree || []);
  const orderedTrackIds = [];

  const walkAll = (parentId) => {
    const key = parentId || '__root__';
    const children = childrenMap.get(key) || [];
    for (const node of children) {
      if (node.kind === 'track') {
        orderedTrackIds.push(node.trackId);
      } else if (node.kind === 'group') {
        walkAll(node.id);
      }
    }
  };

  walkAll(ROOT_PARENT_ID);
  if (!orderedTrackIds.length) return project;
  const rank = new Map(orderedTrackIds.map((id, idx) => [id, idx]));
  const orderedTracks = [...normalized.tracks].sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
  return { ...normalized, tracks: orderedTracks };
}

export function attachTrackNode(project, trackId, parentId = ROOT_PARENT_ID, index = null) {
  const normalized = normalizeTrackTree(project);
  const targetParentId = parentId || ROOT_PARENT_ID;
  const existing = getTrackNodeByTrackId(normalized, trackId);
  if (existing) {
    const currentParentId = existing.parentId || ROOT_PARENT_ID;
    if (currentParentId === targetParentId && index === null) {
      return normalized;
    }

    const nextTree = normalized.trackTree.filter((node) => node.id !== existing.id);

    const oldSiblings = nextTree
      .filter((node) => (node.parentId || ROOT_PARENT_ID) === currentParentId)
      .sort(sortByOrder);
    oldSiblings.forEach((sibling, idx) => {
      sibling.order = idx;
    });

    const targetSiblings = nextTree
      .filter((node) => (node.parentId || ROOT_PARENT_ID) === targetParentId)
      .sort(sortByOrder);
    const insertionIndex = index === null
      ? targetSiblings.length
      : Math.max(0, Math.min(index, targetSiblings.length));
    targetSiblings.forEach((sibling) => {
      if (sibling.order >= insertionIndex) {
        sibling.order += 1;
      }
    });

    nextTree.push({
      ...existing,
      parentId: targetParentId,
      order: insertionIndex,
    });

    return normalizeTrackTree({ ...normalized, trackTree: nextTree });
  }

  const siblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === targetParentId)
    .sort(sortByOrder);
  const insertionIndex = index === null ? siblings.length : Math.max(0, Math.min(index, siblings.length));

  for (const sibling of siblings) {
    if (sibling.order >= insertionIndex) {
      sibling.order += 1;
    }
  }

  return normalizeTrackTree({
    ...normalized,
    trackTree: [
      ...normalized.trackTree,
      makeTrackNode(trackId, insertionIndex, targetParentId),
    ],
  });
}

export function removeTrackNode(project, trackId) {
  const normalized = normalizeTrackTree(project);
  const node = getTrackNodeByTrackId(normalized, trackId);
  if (!node) return normalized;
  const parentId = node.parentId || ROOT_PARENT_ID;
  const filtered = normalized.trackTree.filter((n) => n.id !== node.id);
  const siblings = filtered
    .filter((n) => (n.parentId || ROOT_PARENT_ID) === parentId)
    .sort(sortByOrder);
  siblings.forEach((sibling, idx) => {
    sibling.order = idx;
  });
  return { ...normalized, trackTree: filtered };
}

export function createGroupNode(project, name = 'Group', parentId = ROOT_PARENT_ID, index = null) {
  const normalized = normalizeTrackTree(project);
  const siblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === (parentId || ROOT_PARENT_ID))
    .sort(sortByOrder);
  const insertionIndex = index === null ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  for (const sibling of siblings) {
    if (sibling.order >= insertionIndex) sibling.order += 1;
  }
  const nextNode = {
    id: createId(),
    kind: 'group',
    type: TRACK_NODE_TYPE_GROUP,
    parentId: parentId || ROOT_PARENT_ID,
    order: insertionIndex,
    name: name || 'Group',
    collapsed: false,
    muted: false,
    soloed: false,
    volume: 100,
    pan: 0,
    role: GROUP_ROLE_NONE,
    part: false,
    artistRefs: [],
  };
  return normalizeTrackTree({ ...normalized, trackTree: [...normalized.trackTree, nextNode] });
}

export function updateGroupNode(project, groupNodeId, updates = {}) {
  const normalized = normalizeTrackTree(project);
  return normalizeTrackTree({
    ...normalized,
    trackTree: normalized.trackTree.map((node) => {
      if (node.id !== groupNodeId || node.kind !== 'group') return node;
      const nextRole = updates.role !== undefined
        ? normalizeGroupRole(updates.role)
        : node.role;
      const nextPart = updates.part !== undefined
        ? Boolean(updates.part)
        : Boolean(node.part);
      const nextArtistRefs = updates.artistRefs !== undefined
        ? normalizeArtistRefs(updates.artistRefs)
        : normalizeArtistRefs(node.artistRefs);
      return {
        ...node,
        ...updates,
        type: TRACK_NODE_TYPE_GROUP,
        volume: updates.volume !== undefined
          ? Math.max(0, Math.min(100, toNumber(updates.volume, 100)))
          : node.volume,
        pan: updates.pan !== undefined ? clampPan(updates.pan) : node.pan,
        muted: updates.muted !== undefined ? Boolean(updates.muted) : node.muted,
        soloed: updates.soloed !== undefined ? Boolean(updates.soloed) : node.soloed,
        role: nextRole,
        part: nextPart,
        artistRefs: nextArtistRefs,
      };
    }),
  });
}

export function syncDirectChildRolesFromGroupCategories(project) {
  const normalized = normalizeTrackTree(project);
  const nextTracks = (normalized.tracks || []).map((track) => ({ ...track }));
  const nextTrackTree = (normalized.trackTree || []).map((node) => ({ ...node }));
  const trackIndexById = new Map(nextTracks.map((track, idx) => [track.id, idx]));
  let changed = false;
  const applied = [];

  let passChanged = true;
  let guard = 0;
  while (passChanged && guard < nextTrackTree.length + 1) {
    passChanged = false;
    guard += 1;

    for (const groupNode of nextTrackTree) {
      if (groupNode.kind !== 'group') continue;
      const groupRole = groupNode.role;
      let inheritedRole = null;
      if (isGroupParentRole(groupRole)) {
        inheritedRole = mapGroupParentRoleToTrackRole(groupRole);
      } else {
        const categoryRole = toCategoryRole(groupRole);
        if (
          categoryRole === TRACK_ROLE_INSTRUMENT
          || categoryRole === TRACK_ROLE_LEAD
          || categoryRole === TRACK_ROLE_CHOIR
          || categoryRole === TRACK_ROLE_METRONOME
          || categoryRole === TRACK_ROLE_OTHER
        ) {
          inheritedRole = categoryRole;
        }
      }
      if (!inheritedRole) continue;

      for (let idx = 0; idx < nextTrackTree.length; idx += 1) {
        const child = nextTrackTree[idx];
        if ((child.parentId || ROOT_PARENT_ID) !== groupNode.id) continue;

        if (child.kind === 'track') {
          const trackIdx = trackIndexById.get(child.trackId);
          if (trackIdx === undefined) continue;
          const track = nextTracks[trackIdx];
          const nextIcon = getStemIcon(track.icon);
          if (track.role !== inheritedRole) {
            const previousRole = track.role;
            nextTracks[trackIdx].role = inheritedRole;
            nextTracks[trackIdx].icon = nextIcon;
            applied.push({
              parentGroupId: groupNode.id,
              childKind: 'track',
              childNodeId: child.id,
              trackId: child.trackId,
              fromRole: previousRole,
              toRole: inheritedRole,
            });
            changed = true;
            passChanged = true;
          } else if (track.icon !== nextIcon) {
            nextTracks[trackIdx].icon = nextIcon;
            changed = true;
          }
          continue;
        }

        if (child.kind === 'group' && child.role !== inheritedRole) {
          const previousRole = child.role;
          nextTrackTree[idx].role = inheritedRole;
          applied.push({
            parentGroupId: groupNode.id,
            childKind: 'group',
            childNodeId: child.id,
            fromRole: previousRole,
            toRole: inheritedRole,
          });
          changed = true;
          passChanged = true;
        }
      }
    }
  }

  if (!changed) {
    return normalized;
  }

  console.debug('[GroupRoleSync]', {
    appliedCount: applied.length,
    applied,
  });

  return {
    ...normalized,
    tracks: nextTracks,
    trackTree: nextTrackTree,
  };
}

export function renameGroupNode(project, groupNodeId, name) {
  const normalized = normalizeTrackTree(project);
  return {
    ...normalized,
    trackTree: normalized.trackTree.map((node) => (
      node.id === groupNodeId && node.kind === 'group'
        ? { ...node, name: name || node.name }
        : node
    )),
  };
}

export function toggleGroupCollapsed(project, groupNodeId) {
  const normalized = normalizeTrackTree(project);
  return {
    ...normalized,
    trackTree: normalized.trackTree.map((node) => (
      node.id === groupNodeId && node.kind === 'group'
        ? { ...node, collapsed: !node.collapsed }
        : node
    )),
  };
}

function isDescendant(nodeById, maybeDescendantId, ancestorId) {
  let current = nodeById.get(maybeDescendantId);
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true;
    current = nodeById.get(current.parentId);
  }
  return false;
}

export function moveTrackTreeNode(project, nodeId, targetNodeId, placement = 'after') {
  const normalized = normalizeTrackTree(project);
  const nodeById = new Map(normalized.trackTree.map((node) => [node.id, node]));
  const moving = nodeById.get(nodeId);
  const target = nodeById.get(targetNodeId);
  if (!moving || !target || moving.id === target.id) return normalized;

  let newParentId = target.parentId || ROOT_PARENT_ID;
  if (placement === 'inside') {
    if (target.kind !== 'group') return normalized;
    if (moving.kind === 'group' && isDescendant(nodeById, target.id, moving.id)) {
      return normalized;
    }
    newParentId = target.id;
  }

  const siblingsOfTarget = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === (newParentId || ROOT_PARENT_ID) && node.id !== moving.id)
    .sort(sortByOrder);

  let insertionIndex = siblingsOfTarget.length;
  if (placement !== 'inside') {
    const targetIndex = siblingsOfTarget.findIndex((node) => node.id === target.id);
    if (targetIndex === -1) return normalized;
    insertionIndex = placement === 'before' ? targetIndex : targetIndex + 1;
  }

  const oldParentId = moving.parentId || ROOT_PARENT_ID;
  const oldSiblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === oldParentId && node.id !== moving.id)
    .sort(sortByOrder);
  oldSiblings.forEach((sibling, idx) => { sibling.order = idx; });

  const newSiblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === (newParentId || ROOT_PARENT_ID) && node.id !== moving.id)
    .sort(sortByOrder);
  const clampedIndex = Math.max(0, Math.min(insertionIndex, newSiblings.length));
  newSiblings.splice(clampedIndex, 0, moving);
  newSiblings.forEach((sibling, idx) => {
    sibling.parentId = newParentId;
    sibling.order = idx;
  });

  return reorderTracksByTree(normalizeTrackTree({ ...normalized, trackTree: [...normalized.trackTree] }));
}

export function deleteGroupPromoteChildren(project, groupNodeId) {
  const normalized = normalizeTrackTree(project);
  const group = normalized.trackTree.find((node) => node.id === groupNodeId && node.kind === 'group');
  if (!group) return normalized;

  const parentId = group.parentId || ROOT_PARENT_ID;
  const siblings = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === parentId && node.id !== group.id)
    .sort(sortByOrder);
  const children = normalized.trackTree
    .filter((node) => (node.parentId || ROOT_PARENT_ID) === group.id)
    .sort(sortByOrder);

  const groupIndex = toNumber(group.order, siblings.length);
  const merged = [...siblings];
  merged.splice(groupIndex, 0, ...children);
  merged.forEach((node, idx) => {
    node.parentId = parentId;
    node.order = idx;
  });

  const nextTree = normalized.trackTree.filter((node) => node.id !== group.id);
  return reorderTracksByTree(normalizeTrackTree({ ...normalized, trackTree: nextTree }));
}

export function getEffectiveTrackMix(project) {
  const normalized = normalizeTrackTree(project);
  const childrenMap = getChildrenMap(normalized.trackTree || []);
  const nodeById = new Map((normalized.trackTree || []).map((node) => [node.id, node]));
  const trackById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
  const statesByTrackId = new Map();
  const orderedTrackIds = [];
  let anySolo = false;

  const walk = (parentId, inherited) => {
    const key = parentId || '__root__';
    const children = childrenMap.get(key) || [];
    for (const node of children) {
      const nodeParentRole = inherited.parentRole;
      const isImmediateChildOfParentRole = Boolean(nodeParentRole && inherited.parentGroupId === parentId);

      if (node.kind === 'group') {
        const next = {
          muted: inherited.muted || Boolean(node.muted),
          solo: inherited.solo || Boolean(node.soloed),
          gain: inherited.gain * volumeToGain(Math.max(0, Math.min(100, toNumber(node.volume, 100)))),
          pan: clampPan(inherited.pan + clampPan(node.pan)),
          parentRole: inherited.parentRole,
          parentGroupId: inherited.parentGroupId,
          parentUnitId: inherited.parentUnitId,
          parentUnitName: inherited.parentUnitName,
          forcedRole: inherited.forcedRole,
          forcedUnitId: inherited.forcedUnitId,
          forcedUnitName: inherited.forcedUnitName,
          choirRole: inherited.choirRole,
          choirUnitId: inherited.choirUnitId,
          choirUnitName: inherited.choirUnitName,
        };

        if (isImmediateChildOfParentRole) {
          next.parentUnitId = `group:${node.id}`;
          next.parentUnitName = node.name;
          if (nodeParentRole === TRACK_ROLE_CHOIR) {
            next.choirRole = next.choirRole || TRACK_ROLE_CHOIR;
            next.choirUnitId = next.parentUnitId;
            next.choirUnitName = next.parentUnitName;
          }
        }

        const groupRole = normalizeGroupRole(node.role);
        if (isGroupParentRole(groupRole)) {
          const mappedRole = mapGroupParentRoleToTrackRole(groupRole);
          next.parentRole = mappedRole;
          next.parentGroupId = node.id;
          next.parentUnitId = null;
          next.parentUnitName = null;
          next.forcedRole = null;
          next.forcedUnitId = null;
          next.forcedUnitName = null;
          if (mappedRole === TRACK_ROLE_CHOIR) {
            next.choirRole = TRACK_ROLE_CHOIR;
            next.choirUnitId = null;
            next.choirUnitName = null;
          } else {
            next.choirRole = null;
            next.choirUnitId = null;
            next.choirUnitName = null;
          }
        } else if (groupRole !== GROUP_ROLE_NONE && !nodeParentRole) {
          const categoryRole = toCategoryRole(groupRole);
          next.forcedRole = categoryRole;
          next.forcedUnitId = `group:${node.id}`;
          next.forcedUnitName = node.name;
          if (categoryRole === TRACK_ROLE_CHOIR) {
            next.choirRole = isChoirPartRole(groupRole) ? groupRole : TRACK_ROLE_CHOIR;
            next.choirUnitId = next.forcedUnitId;
            next.choirUnitName = next.forcedUnitName;
          } else {
            next.choirRole = null;
            next.choirUnitId = null;
            next.choirUnitName = null;
          }
        }

        if (node.soloed) {
          anySolo = true;
        }
        walk(node.id, next);
        continue;
      }

      const track = trackById.get(node.trackId);
      if (!track) continue;
      const trackSoloPath = inherited.solo || Boolean(track.soloed);
      if (track.soloed) {
        anySolo = true;
      }
      const ownRole = toCategoryRole(track.role);
      const effectiveRole = inherited.parentRole || inherited.forcedRole || ownRole;
      const isImmediateTrackChildOfParentRole = Boolean(inherited.parentRole && inherited.parentGroupId === parentId);

      let roleUnitId = null;
      let roleUnitName = null;
      if (isCountableRole(effectiveRole)) {
        if (inherited.parentRole && effectiveRole === inherited.parentRole) {
          roleUnitId = isImmediateTrackChildOfParentRole
            ? `track:${track.id}`
            : (inherited.parentUnitId || `track:${track.id}`);
          roleUnitName = isImmediateTrackChildOfParentRole
            ? track.name
            : (inherited.parentUnitName || track.name);
        } else if (inherited.forcedRole && effectiveRole === inherited.forcedRole) {
          roleUnitId = inherited.forcedUnitId || `track:${track.id}`;
          roleUnitName = inherited.forcedUnitName || track.name;
        } else {
          roleUnitId = `track:${track.id}`;
          roleUnitName = track.name;
        }
      }

      let choirRole = null;
      let choirUnitId = null;
      let choirUnitName = null;
      if (effectiveRole === TRACK_ROLE_CHOIR) {
        const explicitChoirRole = isChoirPartRole(track.role) ? track.role : null;
        choirRole = inherited.choirRole || explicitChoirRole || TRACK_ROLE_CHOIR;
        if (inherited.parentRole === TRACK_ROLE_CHOIR) {
          choirUnitId = isImmediateTrackChildOfParentRole
            ? `track:${track.id}`
            : (inherited.parentUnitId || roleUnitId || `track:${track.id}`);
          choirUnitName = isImmediateTrackChildOfParentRole
            ? track.name
            : (inherited.parentUnitName || roleUnitName || track.name);
        } else {
          choirUnitId = inherited.choirUnitId || roleUnitId || `track:${track.id}`;
          choirUnitName = inherited.choirUnitName || roleUnitName || track.name;
        }
      }

      statesByTrackId.set(track.id, {
        trackId: track.id,
        nodeId: node.id,
        muted: inherited.muted || Boolean(track.muted),
        soloPath: trackSoloPath,
        groupGain: inherited.gain,
        groupPan: inherited.pan,
        trackGain: volumeToGain(Math.max(0, Math.min(100, toNumber(track.volume, 100)))),
        trackPan: clampPan(track.pan),
        effectiveGain: inherited.gain * volumeToGain(Math.max(0, Math.min(100, toNumber(track.volume, 100)))),
        effectivePan: clampPan(inherited.pan + clampPan(track.pan)),
        effectiveRole: isMetronomeRole(track.role) ? TRACK_ROLE_METRONOME : effectiveRole,
        roleUnitId,
        roleUnitName,
        choirRole,
        choirUnitId,
        choirUnitName,
      });
      orderedTrackIds.push(track.id);
    }
  };

  walk(ROOT_PARENT_ID, {
    muted: false,
    solo: false,
    gain: 1,
    pan: 0,
    parentRole: null,
    parentGroupId: null,
    parentUnitId: null,
    parentUnitName: null,
    forcedRole: null,
    forcedUnitId: null,
    forcedUnitName: null,
    choirRole: null,
    choirUnitId: null,
    choirUnitName: null,
  });

  for (const trackId of orderedTrackIds) {
    const state = statesByTrackId.get(trackId);
    if (!state) continue;
    state.audible = anySolo ? (state.soloPath && !state.muted) : !state.muted;
  }

  return {
    project: normalized,
    statesByTrackId,
    orderedTrackIds,
    anySolo,
    nodeById,
  };
}
