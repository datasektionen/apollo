import { createClip, createTrack, TRACK_ROLES } from '../types/project';
import { createId } from './id';
import {
  attachTrackNode,
  getGroupDescendantTrackIdsByGroup,
  getTrackNodeByTrackId,
  normalizeTrackTree,
  reorderTracksByTree,
  syncDirectChildRolesFromGroupCategories,
  TRACK_NODE_TYPE_AUDIO,
  TRACK_NODE_TYPE_GROUP,
} from './trackTree';
import { computeClipEndMs } from './playerTime';
import { groupRoleToTrackRole } from './trackRoles';

export const IMPORT_DESTINATION_MODES = {
  EXISTING: 'existing',
  APPEND: 'append',
  NEW_ROOT: 'new-root',
  NEW_CHILD: 'new-child',
  NEW_SIBLING: 'new-sibling',
};

export const IMPORT_PARENT_NONE = 'none';
export const IMPORT_PLACEMENT_REPLACE = 'replace';
export const IMPORT_PLACEMENT_APPEND = 'append';
export const IMPORT_PLACEMENT_NEW_TRACK = 'new-track';
export const IMPORT_PLACEMENT_NEW_CHILD = 'new-child';

export const IMPORT_FILE_DRAG_TYPE = 'application/x-apollo-import-file';
export const IMPORT_DROP_TYPES = {
  ON: 'on',
  BEFORE: 'before',
  AFTER: 'after',
  AFTER_PARENT: 'after-parent',
  INSIDE: 'inside',
  JOIN: 'join',
  NEW_ROOT: 'new-root',
};

const ROOT_PARENT_ID = null;

export function normalizeImportMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripImportFileExtension(fileName) {
  return String(fileName || '').replace(/\.[^/.]+$/u, '');
}

export function importNamesStrictlyMatch(nodeName, fileName) {
  const nodeKey = normalizeImportMatchText(nodeName);
  const fileKey = normalizeImportMatchText(stripImportFileExtension(fileName));
  if (!nodeKey || !fileKey) return false;
  if (nodeKey === fileKey) return true;

  const nodeTokens = nodeKey.split(' ');
  const fileTokens = fileKey.split(' ');
  if (nodeTokens.length > fileTokens.length) return false;

  for (let index = 0; index <= fileTokens.length - nodeTokens.length; index += 1) {
    if (nodeTokens.every((token, offset) => fileTokens[index + offset] === token)) {
      return true;
    }
  }
  return false;
}

function getChildrenMap(trackTree) {
  const map = new Map();
  for (const node of trackTree || []) {
    const key = node.parentId || '__root__';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(node);
  }
  for (const siblings of map.values()) {
    siblings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return map;
}

export function listImportTree(project) {
  const normalized = normalizeTrackTree(project);
  if (!normalized) {
    return {
      groups: [],
      leafTracks: [],
      nodes: [],
      descendantsByGroup: new Map(),
    };
  }
  const trackById = new Map((normalized.tracks || []).map((track) => [track.id, track]));
  const childrenMap = getChildrenMap(normalized.trackTree || []);
  const groups = [];
  const leafTracks = [];
  const nodes = [];

  const walk = (parentId, depth) => {
    const children = childrenMap.get(parentId || '__root__') || [];
    for (const node of children) {
      if (node.kind === 'group') {
        const group = {
          kind: 'group',
          id: node.id,
          name: node.name,
          depth,
          parentId: node.parentId || ROOT_PARENT_ID,
          role: node.role,
        };
        groups.push(group);
        nodes.push(group);
        walk(node.id, depth + 1);
        continue;
      }

      const track = trackById.get(node.trackId);
      if (!track) continue;
      const leaf = {
        kind: 'track',
        id: track.id,
        nodeId: node.id,
        name: track.name,
        depth,
        parentId: node.parentId || ROOT_PARENT_ID,
        clipCount: Array.isArray(track.clips) ? track.clips.length : 0,
        role: track.role || TRACK_ROLES.INSTRUMENT,
      };
      leafTracks.push(leaf);
      nodes.push(leaf);
    }
  };

  walk(ROOT_PARENT_ID, 0);

  return {
    groups,
    leafTracks,
    nodes,
    descendantsByGroup: getGroupDescendantTrackIdsByGroup(normalized),
  };
}

export function createDefaultImportDestination(role = TRACK_ROLES.INSTRUMENT) {
  return {
    mode: IMPORT_DESTINATION_MODES.NEW_ROOT,
    role: role || TRACK_ROLES.INSTRUMENT,
  };
}

export function createUniqueNewRootDestination(role = TRACK_ROLES.INSTRUMENT) {
  return {
    ...createDefaultImportDestination(role),
    slotId: createId(),
  };
}

export function getImportNodeKey(node) {
  if (!node) return IMPORT_PARENT_NONE;
  return node.kind === 'group' ? `group:${node.id}` : `track:${node.id}`;
}

export function lastImportNodeIndex(nodes, node) {
  const start = (nodes || []).findIndex((candidate) => getImportNodeKey(candidate) === getImportNodeKey(node));
  if (start < 0) return -1;
  if (node?.kind !== 'group') return start;
  const depth = node.depth ?? 0;
  let last = start;
  for (let index = start + 1; index < nodes.length; index += 1) {
    if ((nodes[index].depth ?? 0) <= depth) break;
    last = index;
  }
  return last;
}

export function importNodeHasDescendants(nodes, node) {
  const index = lastImportNodeIndex(nodes, node);
  const start = (nodes || []).findIndex((candidate) => getImportNodeKey(candidate) === getImportNodeKey(node));
  return index > start;
}

export function isLastImportNodeInParent(nodes, node) {
  if (!node) return true;
  if (!node.parentId) {
    const lastRootIndex = (nodes || []).reduce((last, candidate, index) => (
      (candidate.depth ?? 0) === 0 ? index : last
    ), -1);
    return lastImportNodeIndex(nodes, node) === lastRootIndex;
  }
  const parent = (nodes || []).find((candidate) => (
    candidate.kind === 'group' && candidate.id === node.parentId
  ));
  if (!parent) return true;
  return lastImportNodeIndex(nodes, node) === lastImportNodeIndex(nodes, parent);
}

export function isFirstImportNodeInParent(nodes, node) {
  if (!node) return true;
  const parentId = node.parentId || ROOT_PARENT_ID;
  const first = (nodes || []).find((candidate) => (candidate.parentId || ROOT_PARENT_ID) === parentId);
  return Boolean(first && getImportNodeKey(first) === getImportNodeKey(node));
}

export function resolveImportDropPlacement(node, offsetRatio, options = {}) {
  const ratio = Math.max(0, Math.min(1, Number(offsetRatio) || 0));
  if (!node) return IMPORT_DROP_TYPES.NEW_ROOT;
  const hasParent = Boolean(node.parentId);
  if (node.kind === 'group') {
    if (ratio < 0.2) {
      if (hasParent && !options.isFirstInParent) return IMPORT_DROP_TYPES.INSIDE;
      return IMPORT_DROP_TYPES.BEFORE;
    }
    if (!options.hasDescendants && ratio > 0.8) {
      if (hasParent && options.isLastInParent) return IMPORT_DROP_TYPES.AFTER_PARENT;
      return IMPORT_DROP_TYPES.AFTER;
    }
    return IMPORT_DROP_TYPES.INSIDE;
  }
  if (ratio < 0.25) {
    if (hasParent && !options.isFirstInParent) return IMPORT_DROP_TYPES.ON;
    return IMPORT_DROP_TYPES.BEFORE;
  }
  if (ratio > 0.75) {
    if (hasParent && options.isLastInParent) return IMPORT_DROP_TYPES.AFTER_PARENT;
    return IMPORT_DROP_TYPES.AFTER;
  }
  return IMPORT_DROP_TYPES.ON;
}

function findImportNode(nodes, kind, id) {
  if (!id) return null;
  return (nodes || []).find((node) => node.kind === kind && node.id === id) || null;
}

function roleFromImportNode(node) {
  if (!node) return null;
  if (node.kind === 'track') return node.role || TRACK_ROLES.INSTRUMENT;
  return groupRoleToTrackRole(node.role);
}

function siblingDestinationForNode(node, role, before = false) {
  if (!node) {
    return createDefaultImportDestination(role);
  }
  if (node.kind === 'group') {
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      groupId: node.id,
      ...(before ? { before: true } : {}),
      role,
    };
  }
  return {
    mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
    trackId: node.id,
    ...(before ? { before: true } : {}),
    role: node.role || role,
  };
}

function destinationAfterImportNode(node, role, nodes = []) {
  if (!node) return createDefaultImportDestination(role);
  if (!node.parentId) return siblingDestinationForNode(node, role);
  const parent = findImportNode(nodes, 'group', node.parentId);
  return {
    mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
    parentGroupId: node.parentId,
    role: roleFromImportNode(parent) || role,
    ...(isLastImportNodeInParent(nodes, node) ? {} : { afterId: node.id }),
  };
}

export function normalizeImportDestination(destination, nodes = []) {
  const current = destination || createDefaultImportDestination();
  if (current.mode !== IMPORT_DESTINATION_MODES.NEW_SIBLING) return current;
  const node = current.groupId
    ? findImportNode(nodes, 'group', current.groupId)
    : findImportNode(nodes, 'track', current.trackId);
  if (!node?.parentId) return current;
  if (current.before && isFirstImportNodeInParent(nodes, node)) {
    const parent = findImportNode(nodes, 'group', node.parentId);
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: node.parentId,
      insert: 'start',
      role: roleFromImportNode(parent) || current.role,
    };
  }
  return destinationAfterImportNode(node, current.role, nodes);
}

export function getImportInheritedRole(destination, nodes = []) {
  const current = normalizeImportDestination(destination, nodes);
  if (current.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && current.parentTrackId) {
    const track = findImportNode(nodes, 'track', current.parentTrackId);
    return track ? roleFromImportNode(track) : null;
  }
  if (current.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && current.parentGroupId) {
    const group = findImportNode(nodes, 'group', current.parentGroupId);
    return group ? roleFromImportNode(group) : null;
  }
  return null;
}

export function importDestinationLocksType(destination, nodes = []) {
  return getImportInheritedRole(destination, nodes) != null;
}

export function getImportSlotKey(destination, nodes) {
  const current = nodes
    ? normalizeImportDestination(destination, nodes)
    : (destination || {});
  if (
    (current.mode === IMPORT_DESTINATION_MODES.EXISTING
      || current.mode === IMPORT_DESTINATION_MODES.APPEND)
    && current.trackId
  ) {
    return `track:${current.trackId}`;
  }
  if (current.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && current.parentTrackId) {
    return `wrap:${current.parentTrackId}`;
  }
  if (current.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && current.parentGroupId) {
    if (current.insert === 'start') return `child:${current.parentGroupId}:start`;
    if (current.afterId) return `child:${current.parentGroupId}:after:${current.afterId}`;
    return `child:${current.parentGroupId}:end`;
  }
  if (current.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING && current.groupId) {
    return `sib:group:${current.groupId}:${current.before ? 'before' : 'after'}`;
  }
  if (current.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING && current.trackId) {
    return `sib:track:${current.trackId}:${current.before ? 'before' : 'after'}`;
  }
  if (current.mode === IMPORT_DESTINATION_MODES.NEW_ROOT && current.slotId) {
    return `root:${current.slotId}`;
  }
  return 'root';
}

function pushToMapList(map, key, value) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function makeGhostRow(slotKey, files, node, depth, ghostType, destination) {
  return {
    key: `ghost:${slotKey}`,
    kind: 'ghost',
    ghostType,
    node,
    files,
    entry: files[0],
    depth,
    destination: destination || files[0]?.destination,
  };
}

export function buildImportPreviewRows(nodes = [], files = []) {
  const existingFilesByTrack = new Map();
  const slots = new Map();

  for (const entry of files || []) {
    const destination = normalizeImportDestination(entry?.destination, nodes);
    if (
      (destination.mode === IMPORT_DESTINATION_MODES.EXISTING
        || destination.mode === IMPORT_DESTINATION_MODES.APPEND)
      && destination.trackId
    ) {
      pushToMapList(existingFilesByTrack, destination.trackId, entry);
      continue;
    }
    pushToMapList(slots, getImportSlotKey(destination, nodes), entry);
  }

  const lastIndexByGroupId = new Map();
  (nodes || []).forEach((node, index) => {
    if (node.kind !== 'group') return;
    let last = index;
    for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
      if ((nodes[nextIndex].depth ?? 0) <= (node.depth ?? 0)) break;
      last = nextIndex;
    }
    lastIndexByGroupId.set(node.id, last);
  });

  const rows = [];
  const emitted = new Set();
  const emitSlot = (slotKey, node, depth, ghostType) => {
    if (!slotKey || emitted.has(slotKey)) return;
    const slotFiles = slots.get(slotKey);
    if (!slotFiles?.length) return;
    emitted.add(slotKey);
    rows.push(makeGhostRow(
      slotKey,
      slotFiles,
      node,
      depth,
      ghostType,
      normalizeImportDestination(slotFiles[0]?.destination, nodes),
    ));
  };

  (nodes || []).forEach((node, index) => {
    const parent = node.parentId
      ? (nodes || []).find((candidate) => candidate.kind === 'group' && candidate.id === node.parentId)
      : null;

    if (isFirstImportNodeInParent(nodes, node)) {
      if (parent) {
        emitSlot(`child:${parent.id}:start`, parent, node.depth ?? 0, 'new-child');
      } else if (node.kind === 'group') {
        emitSlot(`sib:group:${node.id}:before`, node, node.depth ?? 0, 'new-sibling');
      } else {
        emitSlot(`sib:track:${node.id}:before`, node, node.depth ?? 0, 'new-sibling');
      }
    }

    rows.push({
      key: getImportNodeKey(node),
      kind: node.kind,
      node,
      depth: node.depth ?? 0,
      files: node.kind === 'track' ? (existingFilesByTrack.get(node.id) || []) : [],
    });

    if (node.kind === 'track') {
      emitSlot(`wrap:${node.id}`, node, (node.depth ?? 0) + 1, 'new-child');
    }

    const hasKids = importNodeHasDescendants(nodes, node);
    if (!hasKids) {
      if (parent && !isLastImportNodeInParent(nodes, node)) {
        emitSlot(`child:${parent.id}:after:${node.id}`, parent, node.depth ?? 0, 'new-child');
      } else if (!parent) {
        if (node.kind === 'group') {
          emitSlot(`sib:group:${node.id}:after`, node, node.depth ?? 0, 'new-sibling');
        } else {
          emitSlot(`sib:track:${node.id}:after`, node, node.depth ?? 0, 'new-sibling');
        }
      }
    }

    const groupsEndingHere = (nodes || [])
      .filter((candidate) => (
        candidate.kind === 'group' && lastIndexByGroupId.get(candidate.id) === index
      ))
      .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));

    for (const group of groupsEndingHere) {
      emitSlot(`child:${group.id}:end`, group, (group.depth ?? 0) + 1, 'new-child');
      const groupParent = group.parentId
        ? (nodes || []).find((candidate) => candidate.kind === 'group' && candidate.id === group.parentId)
        : null;
      if (groupParent) {
        emitSlot(`child:${groupParent.id}:after:${group.id}`, groupParent, group.depth ?? 0, 'new-child');
      } else {
        emitSlot(`sib:group:${group.id}:after`, group, group.depth ?? 0, 'new-sibling');
      }
    }
  });

  emitSlot('root', null, 0, 'new-root');
  for (const [slotKey, slotFiles] of slots.entries()) {
    emitSlot(slotKey, null, 0, 'new-root');
  }

  return rows;
}

export function getImportParentKey(destination) {
  if (!destination || destination.mode === IMPORT_DESTINATION_MODES.NEW_ROOT) {
    return IMPORT_PARENT_NONE;
  }
  if (destination.mode === IMPORT_DESTINATION_MODES.NEW_CHILD) {
    if (destination.parentTrackId) return `track:${destination.parentTrackId}`;
    return `group:${destination.parentGroupId || ''}`;
  }
  if (destination.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING && destination.groupId) {
    return `group:${destination.groupId}`;
  }
  if (
    destination.mode === IMPORT_DESTINATION_MODES.EXISTING
    || destination.mode === IMPORT_DESTINATION_MODES.APPEND
    || destination.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING
  ) {
    return `track:${destination.trackId || ''}`;
  }
  return IMPORT_PARENT_NONE;
}

export function getImportAncestorPath(parentKey, nodes = []) {
  if (!parentKey || parentKey === IMPORT_PARENT_NONE) return '(None)';
  const start = (nodes || []).find((node) => getImportNodeKey(node) === parentKey);
  if (!start) return '(None)';

  const names = [];
  const seen = new Set();
  let current = start;
  while (current) {
    const seenKey = `${current.kind}:${current.id}`;
    if (seen.has(seenKey)) break;
    seen.add(seenKey);
    names.unshift(current.name);
    if (!current.parentId) break;
    current = nodes.find((node) => node.kind === 'group' && node.id === current.parentId) || null;
  }
  return names.join('/');
}

export function getImportPlacementValue(destination) {
  if (!destination || destination.mode === IMPORT_DESTINATION_MODES.NEW_ROOT) {
    return destination?.role || TRACK_ROLES.INSTRUMENT;
  }
  if (destination.mode === IMPORT_DESTINATION_MODES.EXISTING) {
    return IMPORT_PLACEMENT_REPLACE;
  }
  if (destination.mode === IMPORT_DESTINATION_MODES.APPEND) {
    return IMPORT_PLACEMENT_APPEND;
  }
  if (destination.mode === IMPORT_DESTINATION_MODES.NEW_CHILD) {
    return IMPORT_PLACEMENT_NEW_CHILD;
  }
  return IMPORT_PLACEMENT_NEW_TRACK;
}

export function applyImportParentKey(destination, parentKey, project) {
  const { leafTracks, groups } = listImportTree(project);
  const currentRole = destination?.role || TRACK_ROLES.INSTRUMENT;

  if (!parentKey || parentKey === IMPORT_PARENT_NONE) {
    return createDefaultImportDestination(currentRole);
  }

  if (parentKey.startsWith('group:')) {
    const groupId = parentKey.slice('group:'.length);
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) return createDefaultImportDestination(currentRole);
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: group.id,
      role: currentRole,
    };
  }

  const trackId = parentKey.startsWith('track:') ? parentKey.slice('track:'.length) : parentKey;
  const leaf = leafTracks.find((candidate) => candidate.id === trackId);
  if (!leaf) return createDefaultImportDestination(currentRole);

  const currentKey = getImportParentKey(destination);
  const sameTrack = currentKey === `track:${leaf.id}`;
  if (sameTrack && (
    destination?.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING
    || destination?.mode === IMPORT_DESTINATION_MODES.APPEND
  )) {
    return {
      ...destination,
      trackId: leaf.id,
      role: leaf.role || currentRole,
    };
  }

  return {
    mode: IMPORT_DESTINATION_MODES.EXISTING,
    trackId: leaf.id,
    role: leaf.role || currentRole,
  };
}

export function applyImportPlacement(destination, placement, project) {
  const parentKey = getImportParentKey(destination);
  if (parentKey === IMPORT_PARENT_NONE) {
    return createDefaultImportDestination(placement || TRACK_ROLES.INSTRUMENT);
  }
  if (parentKey.startsWith('group:')) {
    const next = applyImportParentKey(destination, parentKey, project);
    if (
      placement
      && placement !== IMPORT_PLACEMENT_REPLACE
      && placement !== IMPORT_PLACEMENT_APPEND
      && placement !== IMPORT_PLACEMENT_NEW_TRACK
      && placement !== IMPORT_PLACEMENT_NEW_CHILD
    ) {
      return { ...next, role: placement };
    }
    return next;
  }

  const trackId = destination?.trackId;
  const leaf = listImportTree(project).leafTracks.find((candidate) => candidate.id === trackId);
  if (!leaf) return createDefaultImportDestination();

  if (placement === IMPORT_PLACEMENT_NEW_TRACK) {
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      trackId: leaf.id,
      role: leaf.role || TRACK_ROLES.INSTRUMENT,
    };
  }

  if (placement === IMPORT_PLACEMENT_APPEND) {
    return {
      mode: IMPORT_DESTINATION_MODES.APPEND,
      trackId: leaf.id,
      role: leaf.role || TRACK_ROLES.INSTRUMENT,
    };
  }

  return {
    mode: IMPORT_DESTINATION_MODES.EXISTING,
    trackId: leaf.id,
    role: leaf.role || TRACK_ROLES.INSTRUMENT,
  };
}

export function assignImportDrop(destination, drop, nodes = []) {
  const currentRole = destination?.role || TRACK_ROLES.INSTRUMENT;
  const node = drop?.node;
  const type = drop?.type;

  if (type === IMPORT_DROP_TYPES.JOIN && drop?.destination) {
    const joined = normalizeImportDestination(drop.destination, nodes);
    return { ...joined, role: getImportInheritedRole(joined, nodes) || joined.role || currentRole };
  }

  if (!type || type === IMPORT_DROP_TYPES.NEW_ROOT || !node) {
    return createUniqueNewRootDestination(currentRole);
  }

  if (type === IMPORT_DROP_TYPES.ON && node.kind === 'track') {
    const sameTrack = (
      (destination?.mode === IMPORT_DESTINATION_MODES.EXISTING
        || destination?.mode === IMPORT_DESTINATION_MODES.APPEND)
      && destination.trackId === node.id
    );
    return {
      mode: sameTrack && destination.mode === IMPORT_DESTINATION_MODES.APPEND
        ? IMPORT_DESTINATION_MODES.APPEND
        : IMPORT_DESTINATION_MODES.EXISTING,
      trackId: node.id,
      role: node.role || currentRole,
    };
  }

  if (type === IMPORT_DROP_TYPES.INSIDE) {
    return childDestinationForNode(node, currentRole);
  }

  if (type === IMPORT_DROP_TYPES.AFTER_PARENT && node.parentId) {
    const parent = findImportNode(nodes, 'group', node.parentId);
    if (parent?.parentId) {
      return destinationAfterImportNode(parent, currentRole, nodes);
    }
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      groupId: node.parentId,
      role: currentRole,
    };
  }

  if (type === IMPORT_DROP_TYPES.BEFORE || type === IMPORT_DROP_TYPES.AFTER) {
    if (node.parentId) {
      if (type === IMPORT_DROP_TYPES.BEFORE) {
        const parent = findImportNode(nodes, 'group', node.parentId);
        return {
          mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
          parentGroupId: node.parentId,
          insert: 'start',
          role: roleFromImportNode(parent) || currentRole,
        };
      }
      return destinationAfterImportNode(node, currentRole, nodes);
    }
    if (node.kind === 'group') {
      return {
        mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
        groupId: node.id,
        ...(type === IMPORT_DROP_TYPES.BEFORE ? { before: true } : {}),
        role: currentRole,
      };
    }
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      trackId: node.id,
      ...(type === IMPORT_DROP_TYPES.BEFORE ? { before: true } : {}),
      role: node.role || currentRole,
    };
  }

  return createUniqueNewRootDestination(currentRole);
}

function childDestinationForNode(node, role) {
  if (!node) return createDefaultImportDestination(role);
  const inherited = roleFromImportNode(node);
  if (node.kind === 'group') {
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
      parentGroupId: node.id,
      role: inherited || role,
    };
  }
  return {
    mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
    parentTrackId: node.id,
    role: inherited || role,
  };
}

function getImportVirtualSlot(destination, nodes = []) {
  const role = destination?.role || TRACK_ROLES.INSTRUMENT;
  if (!destination || destination.mode === IMPORT_DESTINATION_MODES.NEW_ROOT) {
    return {
      aboveIndex: (nodes.length || 1) - 1,
      depth: 0,
      parentId: ROOT_PARENT_ID,
      role,
    };
  }

  if (
    (destination.mode === IMPORT_DESTINATION_MODES.EXISTING
      || destination.mode === IMPORT_DESTINATION_MODES.APPEND)
    && destination.trackId
  ) {
    const index = nodes.findIndex((node) => node.kind === 'track' && node.id === destination.trackId);
    const node = nodes[index];
    return {
      aboveIndex: index - 1,
      index,
      depth: node?.depth ?? 0,
      parentId: node?.parentId || ROOT_PARENT_ID,
      onTrackId: destination.trackId,
      role: node?.role || role,
    };
  }

  if (destination.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING) {
    const node = destination.groupId
      ? nodes.find((candidate) => candidate.kind === 'group' && candidate.id === destination.groupId)
      : nodes.find((candidate) => candidate.kind === 'track' && candidate.id === destination.trackId);
    if (!node) {
      return { aboveIndex: nodes.length - 1, depth: 0, parentId: ROOT_PARENT_ID, role };
    }
    if (destination.before) {
      const index = nodes.findIndex((candidate) => getImportNodeKey(candidate) === getImportNodeKey(node));
      return {
        aboveIndex: index - 1,
        depth: node.depth ?? 0,
        parentId: node.parentId || ROOT_PARENT_ID,
        role,
      };
    }
    return {
      aboveIndex: lastImportNodeIndex(nodes, node),
      depth: node.depth ?? 0,
      parentId: node.parentId || ROOT_PARENT_ID,
      role,
    };
  }

  if (destination.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && destination.parentTrackId) {
    const index = nodes.findIndex((node) => node.kind === 'track' && node.id === destination.parentTrackId);
    const node = nodes[index];
    return {
      aboveIndex: index,
      depth: (node?.depth ?? 0) + 1,
      parentId: node?.id || ROOT_PARENT_ID,
      parentTrackId: destination.parentTrackId,
      role,
    };
  }

  if (destination.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && destination.parentGroupId) {
    const group = nodes.find((node) => node.kind === 'group' && node.id === destination.parentGroupId);
    if (!group) {
      return { aboveIndex: nodes.length - 1, depth: 0, parentId: ROOT_PARENT_ID, role };
    }
    if (destination.insert === 'start') {
      const index = nodes.findIndex((node) => getImportNodeKey(node) === getImportNodeKey(group));
      return {
        aboveIndex: index,
        depth: (group.depth ?? 0) + 1,
        parentId: group.id,
        role,
      };
    }
    if (destination.afterId) {
      const afterNode = (nodes || []).find((node) => node.id === destination.afterId);
      if (afterNode) {
        return {
          aboveIndex: lastImportNodeIndex(nodes, afterNode),
          depth: afterNode.depth ?? ((group.depth ?? 0) + 1),
          parentId: group.id,
          role,
        };
      }
    }
    return {
      aboveIndex: lastImportNodeIndex(nodes, group),
      depth: (group.depth ?? 0) + 1,
      parentId: group.id,
      role,
    };
  }

  return { aboveIndex: nodes.length - 1, depth: 0, parentId: ROOT_PARENT_ID, role };
}

export function indentImportDestination(destination, nodes = []) {
  const current = normalizeImportDestination(destination, nodes);
  const slot = getImportVirtualSlot(current, nodes);
  if (slot.aboveIndex < 0) return current;
  const rowAbove = nodes[slot.aboveIndex];
  if (!rowAbove) return current;

  if ((rowAbove.depth ?? 0) === (slot.depth ?? 0) + 1) {
    return destinationAfterImportNode(rowAbove, slot.role, nodes);
  }
  if (rowAbove.kind === 'group') {
    if (current.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && current.parentGroupId === rowAbove.id) {
      return current;
    }
    return childDestinationForNode(rowAbove, slot.role);
  }
  if (rowAbove.kind === 'track') {
    return childDestinationForNode(rowAbove, slot.role);
  }
  return current;
}

export function outdentImportDestination(destination, nodes = []) {
  const current = normalizeImportDestination(destination, nodes);
  const slot = getImportVirtualSlot(current, nodes);
  const role = slot.role || current?.role || TRACK_ROLES.INSTRUMENT;

  if (slot.parentTrackId) {
    const trackNode = findImportNode(nodes, 'track', slot.parentTrackId);
    if (trackNode?.parentId) {
      return destinationAfterImportNode(trackNode, role, nodes);
    }
    return {
      mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
      trackId: slot.parentTrackId,
      role,
    };
  }

  if (!slot.parentId) return current;
  const parent = nodes.find((node) => node.kind === 'group' && node.id === slot.parentId);
  if (!parent) return current;

  const parentLastIndex = lastImportNodeIndex(nodes, parent);
  if (slot.onTrackId) {
    const trackIndex = nodes.findIndex((node) => node.kind === 'track' && node.id === slot.onTrackId);
    if (trackIndex !== parentLastIndex) return current;
  } else if (slot.aboveIndex !== parentLastIndex) {
    return current;
  }

  if (parent.parentId) {
    return destinationAfterImportNode(parent, role, nodes);
  }
  return {
    mode: IMPORT_DESTINATION_MODES.NEW_SIBLING,
    groupId: parent.id,
    role,
  };
}

export function toggleImportReplaceMode(destination, project) {
  if (
    destination?.mode !== IMPORT_DESTINATION_MODES.EXISTING
    && destination?.mode !== IMPORT_DESTINATION_MODES.APPEND
  ) {
    return destination;
  }
  const track = (project?.tracks || []).find((candidate) => candidate.id === destination.trackId);
  if (!track || (track.clips?.length || 0) === 0) return destination;
  return {
    ...destination,
    mode: destination.mode === IMPORT_DESTINATION_MODES.EXISTING
      ? IMPORT_DESTINATION_MODES.APPEND
      : IMPORT_DESTINATION_MODES.EXISTING,
  };
}

export function canToggleImportReplaceMode(destination, project) {
  if (
    destination?.mode !== IMPORT_DESTINATION_MODES.EXISTING
    && destination?.mode !== IMPORT_DESTINATION_MODES.APPEND
  ) {
    return false;
  }
  const track = (project?.tracks || []).find((candidate) => candidate.id === destination.trackId);
  return Boolean(track && (track.clips?.length || 0) > 0);
}

export function toggleImportTrackReplaceMode(files, trackId, project) {
  const track = (project?.tracks || []).find((candidate) => candidate.id === trackId);
  if (!track || (track.clips?.length || 0) === 0) return files;
  const onTrack = (files || []).filter((entry) => (
    (entry.destination?.mode === IMPORT_DESTINATION_MODES.EXISTING
      || entry.destination?.mode === IMPORT_DESTINATION_MODES.APPEND)
    && entry.destination.trackId === trackId
  ));
  if (!onTrack.length) return files;
  const nextMode = onTrack.some((entry) => entry.destination.mode === IMPORT_DESTINATION_MODES.EXISTING)
    ? IMPORT_DESTINATION_MODES.APPEND
    : IMPORT_DESTINATION_MODES.EXISTING;
  return (files || []).map((entry) => {
    if (!onTrack.some((candidate) => candidate.id === entry.id)) return entry;
    return {
      ...entry,
      destination: { ...entry.destination, mode: nextMode },
    };
  });
}

export function destinationReplacesAudio(destination, project) {
  if (destination?.mode !== IMPORT_DESTINATION_MODES.EXISTING || !destination.trackId) {
    return false;
  }
  const track = (project?.tracks || []).find((candidate) => candidate.id === destination.trackId);
  return Boolean(track && (track.clips?.length || 0) > 0);
}

function pickPreferredTrackId(candidateIds, leafById, claimedTrackIds) {
  const emptyId = candidateIds.find((trackId) => {
    const leaf = leafById.get(trackId);
    return leaf && leaf.clipCount === 0 && !claimedTrackIds.has(trackId);
  });
  if (emptyId) return emptyId;

  return candidateIds.find((trackId) => !claimedTrackIds.has(trackId)) || null;
}

export function guessImportDestinations(fileNames, project, options = {}) {
  const { groups, leafTracks, descendantsByGroup } = listImportTree(project);
  const leafById = new Map(leafTracks.map((leaf) => [leaf.id, leaf]));
  const claimedTrackIds = new Set(options.claimedTrackIds || []);
  const defaultRole = options.defaultRole || TRACK_ROLES.INSTRUMENT;

  return (fileNames || []).map((fileName) => {
    const matchingLeaves = leafTracks.filter((leaf) => importNamesStrictlyMatch(leaf.name, fileName));
    const matchingGroups = groups.filter((group) => importNamesStrictlyMatch(group.name, fileName));
    const uniqueLeafMatch = matchingLeaves.length === 1 && matchingGroups.length === 0;

    if (uniqueLeafMatch) {
      const match = matchingLeaves[0];
      if (!claimedTrackIds.has(match.id)) {
        claimedTrackIds.add(match.id);
        return {
          mode: IMPORT_DESTINATION_MODES.EXISTING,
          trackId: match.id,
          role: match.role || defaultRole,
        };
      }
      return {
        mode: IMPORT_DESTINATION_MODES.APPEND,
        trackId: match.id,
        role: match.role || defaultRole,
      };
    }

    if (matchingLeaves.length === 0 && matchingGroups.length === 0) {
      return createUniqueNewRootDestination(defaultRole);
    }

    const candidateIds = [];
    const seen = new Set();
    for (const leaf of leafTracks) {
      const matchedDirectly = matchingLeaves.some((match) => match.id === leaf.id);
      const matchedViaGroup = matchingGroups.some((group) => (
        (descendantsByGroup.get(group.id) || []).includes(leaf.id)
      ));
      if (!matchedDirectly && !matchedViaGroup) continue;
      if (seen.has(leaf.id)) continue;
      seen.add(leaf.id);
      candidateIds.push(leaf.id);
    }

    const pickedId = pickPreferredTrackId(candidateIds, leafById, claimedTrackIds);
    if (pickedId) {
      claimedTrackIds.add(pickedId);
      const leaf = leafById.get(pickedId);
      return {
        mode: IMPORT_DESTINATION_MODES.EXISTING,
        trackId: pickedId,
        role: leaf?.role || defaultRole,
      };
    }

    if (matchingGroups.length > 0) {
      const group = matchingGroups[0];
      return {
        mode: IMPORT_DESTINATION_MODES.NEW_CHILD,
        parentGroupId: group.id,
        role: groupRoleToTrackRole(group.role) || defaultRole,
      };
    }

    return createUniqueNewRootDestination(defaultRole);
  });
}

function trackNameFromFile(fileName) {
  const base = stripImportFileExtension(fileName).trim();
  return base || 'Track';
}

function lastClipEndMs(track) {
  const clips = Array.isArray(track?.clips) ? track.clips : [];
  if (!clips.length) return 0;
  return clips.reduce((max, clip) => Math.max(max, computeClipEndMs(clip)), 0);
}

function attachNewImportedTrack(project, track, parentId, index = null) {
  const nextProject = {
    ...project,
    tracks: [...(project.tracks || []), track],
  };
  return attachTrackNode(nextProject, track.id, parentId, index);
}

function wrapTrackAsGroupWithChild(project, trackId, childTrack) {
  const normalized = normalizeTrackTree(project);
  const sourceNode = getTrackNodeByTrackId(normalized, trackId);
  const source = (normalized.tracks || []).find((track) => track.id === trackId);
  if (!sourceNode || !source) {
    return attachNewImportedTrack(normalized, childTrack, ROOT_PARENT_ID);
  }

  const hasClips = (source.clips?.length || 0) > 0;
  const groupNodeId = createId();
  const childNodeId = createId();
  const groupNode = {
    id: groupNodeId,
    kind: 'group',
    type: TRACK_NODE_TYPE_GROUP,
    parentId: sourceNode.parentId || ROOT_PARENT_ID,
    order: sourceNode.order ?? 0,
    name: source.name,
    collapsed: false,
    muted: Boolean(source.muted),
    soloed: Boolean(source.soloed),
    volume: Number.isFinite(source.volume) ? source.volume : 100,
    pan: Number.isFinite(source.pan) ? source.pan : 0,
    role: source.role || TRACK_ROLES.OTHER,
    part: Boolean(source.part),
    artistRefs: Array.isArray(source.artistRefs) ? [...source.artistRefs] : [],
  };
  const childNode = {
    id: childNodeId,
    kind: 'track',
    type: TRACK_NODE_TYPE_AUDIO,
    parentId: groupNodeId,
    order: hasClips ? 1 : 0,
    trackId: childTrack.id,
    part: false,
  };

  if (!hasClips) {
    return {
      ...normalized,
      tracks: [
        ...(normalized.tracks || []).filter((track) => track.id !== source.id),
        childTrack,
      ],
      trackTree: [
        ...(normalized.trackTree || []).filter((node) => node.id !== sourceNode.id),
        groupNode,
        childNode,
      ],
    };
  }

  return {
    ...normalized,
    tracks: [...(normalized.tracks || []), childTrack],
    trackTree: [
      ...(normalized.trackTree || []).map((node) => (
        node.id === sourceNode.id
          ? { ...node, parentId: groupNodeId, order: 0 }
          : node
      )),
      groupNode,
      childNode,
    ],
  };
}

export function applyImportAssignments(project, assignments = []) {
  let nextProject = normalizeTrackTree(project);
  const convertedTrackGroups = new Map();
  const consumed = new Set();

  const applyClipsToExistingTrack = (trackId, group) => {
    const target = (nextProject.tracks || []).find((track) => track.id === trackId);
    if (!target) return;
    const shouldWipe = group.some((assignment) => (
      assignment.destination?.mode === IMPORT_DESTINATION_MODES.EXISTING
    )) && (target.clips?.length || 0) > 0;
    let startMs = shouldWipe ? 0 : lastClipEndMs(target);
    const clips = shouldWipe ? [] : [...(target.clips || [])];
    for (const assignment of group) {
      const durationMs = Number(assignment.durationMs) || 0;
      if (!assignment.blobId) continue;
      clips.push(createClip(assignment.blobId, startMs, durationMs));
      startMs += durationMs;
    }
    nextProject = {
      ...nextProject,
      tracks: nextProject.tracks.map((track) => (
        track.id === target.id ? { ...track, clips } : track
      )),
    };
  };

  for (let index = 0; index < assignments.length; index += 1) {
    if (consumed.has(index)) continue;
    const assignment = assignments[index];
    if (!assignment) continue;
    const destination = assignment.destination || createDefaultImportDestination();
    const blobId = assignment.blobId;
    if (!blobId && !(
      destination.mode === IMPORT_DESTINATION_MODES.EXISTING
      || destination.mode === IMPORT_DESTINATION_MODES.APPEND
    )) continue;

    if (
      (destination.mode === IMPORT_DESTINATION_MODES.EXISTING
        || destination.mode === IMPORT_DESTINATION_MODES.APPEND)
      && destination.trackId
    ) {
      const group = [];
      for (let nextIndex = index; nextIndex < assignments.length; nextIndex += 1) {
        const candidate = assignments[nextIndex];
        const candidateDestination = candidate?.destination;
        if (
          (candidateDestination?.mode === IMPORT_DESTINATION_MODES.EXISTING
            || candidateDestination?.mode === IMPORT_DESTINATION_MODES.APPEND)
          && candidateDestination.trackId === destination.trackId
        ) {
          group.push(candidate);
          consumed.add(nextIndex);
        }
      }
      applyClipsToExistingTrack(destination.trackId, group);
      continue;
    }

    if (!blobId) continue;

    const slotKey = getImportSlotKey(destination);
    const group = [];
    for (let nextIndex = index; nextIndex < assignments.length; nextIndex += 1) {
      if (consumed.has(nextIndex)) continue;
      const candidate = assignments[nextIndex];
      if (!candidate?.blobId) continue;
      if (getImportSlotKey(candidate.destination || createDefaultImportDestination()) !== slotKey) continue;
      group.push(candidate);
      consumed.add(nextIndex);
    }
    if (!group.length) continue;

    const role = destination.role || TRACK_ROLES.INSTRUMENT;
    const trackName = group[0].name || trackNameFromFile(group[0].fileName);
    const newTrack = createTrack(trackName, role);
    let startMs = 0;
    for (const item of group) {
      const itemDuration = Number(item.durationMs) || 0;
      newTrack.clips.push(createClip(item.blobId, startMs, itemDuration));
      startMs += itemDuration;
    }

    if (destination.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING && destination.groupId) {
      const groupNode = (nextProject.trackTree || []).find((node) => (
        node.kind === 'group' && node.id === destination.groupId
      ));
      const parentId = groupNode?.parentId || ROOT_PARENT_ID;
      const insertIndex = groupNode
        ? (groupNode.order ?? 0) + (destination.before ? 0 : 1)
        : null;
      nextProject = attachNewImportedTrack(nextProject, newTrack, parentId, insertIndex);
      continue;
    }

    if (destination.mode === IMPORT_DESTINATION_MODES.NEW_SIBLING && destination.trackId) {
      const siblingNode = getTrackNodeByTrackId(nextProject, destination.trackId);
      const parentId = siblingNode?.parentId || ROOT_PARENT_ID;
      const insertIndex = siblingNode
        ? (siblingNode.order ?? 0) + (destination.before ? 0 : 1)
        : null;
      nextProject = attachNewImportedTrack(nextProject, newTrack, parentId, insertIndex);
      continue;
    }

    if (destination.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && destination.parentTrackId) {
      const existingGroupId = convertedTrackGroups.get(destination.parentTrackId);
      if (existingGroupId) {
        nextProject = attachNewImportedTrack(nextProject, newTrack, existingGroupId);
        continue;
      }
      nextProject = wrapTrackAsGroupWithChild(nextProject, destination.parentTrackId, newTrack);
      const childNode = getTrackNodeByTrackId(nextProject, newTrack.id);
      if (childNode?.parentId) {
        convertedTrackGroups.set(destination.parentTrackId, childNode.parentId);
      }
      continue;
    }

    const parentId = destination.mode === IMPORT_DESTINATION_MODES.NEW_CHILD
      ? destination.parentGroupId || ROOT_PARENT_ID
      : ROOT_PARENT_ID;
    let insertIndex = null;
    if (destination.mode === IMPORT_DESTINATION_MODES.NEW_CHILD && destination.parentGroupId) {
      if (destination.insert === 'start') {
        insertIndex = 0;
      } else if (destination.afterId) {
        const afterTrack = getTrackNodeByTrackId(nextProject, destination.afterId);
        const afterGroup = (nextProject.trackTree || []).find((node) => (
          node.kind === 'group' && node.id === destination.afterId
        ));
        const afterNode = afterTrack || afterGroup;
        insertIndex = afterNode ? (afterNode.order ?? 0) + 1 : null;
      }
    }
    nextProject = attachNewImportedTrack(nextProject, newTrack, parentId, insertIndex);
  }

  nextProject = normalizeTrackTree(nextProject);
  nextProject = syncDirectChildRolesFromGroupCategories(nextProject);
  return reorderTracksByTree(nextProject);
}
