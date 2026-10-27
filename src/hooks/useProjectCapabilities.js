import { useMemo } from 'react';
import {
  canCreateTrackInProject,
  canEditAllTracksInSnapshot,
  canEditProjectSettings,
  canExportProject,
  canManageGroups,
  canChangeTrackRoles,
  canEditProjectLyrics,
  collectTrackBindingInfo,
  hasTrackLevelWrite,
  projectLevelWriteEnabled,
  trackIsEditable,
} from '../../shared/accessRules.js';

export const EDITOR_MODE_HOSTED = 'hosted';
export const EDITOR_MODE_ADVANCED_MIX = 'advancedMix';
export const EDITOR_MODE_LOCAL_RECORDING = 'localRecording';
export const EDITOR_MODE_LOCAL = 'local';

const ALWAYS_TRUE = () => true;

function permissiveCapabilities(mode) {
  return {
    mode,
    isHosted: mode === EDITOR_MODE_HOSTED,
    hasAccessInfo: false,
    isReadOnly: false,
    canEditProjectSettings: true,
    canEditLyrics: mode !== EDITOR_MODE_HOSTED,
    canManageGroups: true,
    canChangeTrackRoles: true,
    canCreateTracks: true,
    canCreateTracksAtRoot: true,
    canCreateTrackUnder: ALWAYS_TRUE,
    creatableScopeLabels: [],
    canImport: true,
    canSolo: true,
    canExport: true,
    canEditAnyTrack: true,
    canEditTrack: ALWAYS_TRUE,
    canRecordTo: ALWAYS_TRUE,
    explainTrackAccess: () => null,
    editableScopeLabels: [],
    editableTrackIds: null,
  };
}

const PROBE_TRACK_ID = '__capability-probe-track__';
const PROBE_NODE_ID = '__capability-probe-node__';

/**
 * Build the binding info the server would infer for a brand-new track placed
 * under `parentNodeId` (a group node id, or null for root). When `viaTrackId`
 * is given the new track becomes a child of that track, which the editor
 * converts into a group of the same name.
 */
function inferNewTrackInfo(project, parentNodeId, viaTrackId = null) {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  let nodes = Array.isArray(project?.trackTree) ? [...project.trackTree] : [];
  let effectiveParentId = parentNodeId || null;

  if (viaTrackId) {
    const trackNodeIndex = nodes.findIndex((node) => node?.kind === 'track' && node.trackId === viaTrackId);
    const trackNode = trackNodeIndex >= 0 ? nodes[trackNodeIndex] : null;
    const track = tracks.find((candidate) => candidate.id === viaTrackId);
    const groupNodeId = trackNode?.id || `${PROBE_NODE_ID}:group`;
    if (trackNodeIndex >= 0) nodes.splice(trackNodeIndex, 1);
    nodes.push({
      id: groupNodeId,
      kind: 'group',
      name: track?.name || 'Group',
      parentId: trackNode?.parentId ?? null,
      order: trackNode?.order ?? nodes.length,
    });
    effectiveParentId = groupNodeId;
  }

  nodes.push({
    id: PROBE_NODE_ID,
    kind: 'track',
    trackId: PROBE_TRACK_ID,
    parentId: effectiveParentId,
    order: Number.MAX_SAFE_INTEGER,
  });
  const probeSnapshot = {
    ...(project || {}),
    tracks: [...tracks, { id: PROBE_TRACK_ID, name: 'probe', role: 'other', clips: [] }],
    trackTree: nodes,
  };
  return collectTrackBindingInfo(probeSnapshot).get(PROBE_TRACK_ID) || null;
}

/**
 * Pure capability computation. Mirrors the server's write validation
 * (server/src/rbac.js validateAndTransformProjectWrite) using the shared rule
 * module so the UI can hide/disable affordances before a request is made.
 *
 * `access` is the per-project access summary returned by
 * GET /api/projects/:id/bootstrap and the WS `project.joined` message.
 */
export function computeProjectCapabilities({
  access = null,
  project = null,
  userId = null,
  projectId = null,
  showId = null,
  projectCreatedByUserId = null,
  mode = EDITOR_MODE_HOSTED,
} = {}) {
  // Advanced-mix and local-recording sessions have their own mode-based
  // affordance rules in the Editor; local (non-hosted) projects have no RBAC.
  if (mode !== EDITOR_MODE_HOSTED) {
    return permissiveCapabilities(mode);
  }
  // Hosted session without an access summary (older server): stay permissive
  // and let the server reject, matching the historical behaviour.
  if (!access || typeof access !== 'object') {
    return {
      ...permissiveCapabilities(mode),
      canEditLyrics: false,
    };
  }

  const projectDescriptor = {
    id: projectId || project?.projectId || null,
    showId: showId || project?.showId || null,
  };
  const trackInfoById = collectTrackBindingInfo(project || {});
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];

  const editableTrackIds = new Set();
  for (const track of tracks) {
    if (!track?.id) continue;
    if (trackIsEditable(trackInfoById.get(track.id), access, userId, projectDescriptor, projectCreatedByUserId)) {
      editableTrackIds.add(String(track.id));
    }
  }

  const canEditTrack = (trackId) => {
    if (!trackId) return false;
    if (editableTrackIds.has(String(trackId))) return true;
    // Tracks created locally but not yet known to the server (not in the
    // snapshot info map yet) are editable if the user may create tracks.
    return !trackInfoById.has(trackId) && Boolean(access.canCreateTracks);
  };

  const trackLevelWrite = hasTrackLevelWrite(access);
  const canSolo = canEditAllTracksInSnapshot({
    snapshot: project || {},
    access,
    userId,
    project: projectDescriptor,
    projectCreatedByUserId,
  });
  const canCreateTracksAtRoot = canCreateTrackInProject(access, projectDescriptor, null);
  const creatableScopes = Array.isArray(access.creatableTrackScopes) ? access.creatableTrackScopes : [];
  // "Can create a track somewhere": root, or inside one of the granted scopes
  // (e.g. a track_creator limited to the "Choir" group).
  const canCreateTracks = canCreateTracksAtRoot
    || Boolean(access.canCreateTracks && creatableScopes.length > 0);
  const canCreateTrackUnder = (parentNodeId = null, options = {}) => {
    if (projectLevelWriteEnabled(access)) return true;
    if (!access.canCreateTracks) return false;
    if (!parentNodeId && !options.viaTrackId) return canCreateTracksAtRoot;
    const info = inferNewTrackInfo(project, parentNodeId, options.viaTrackId || null);
    return canCreateTrackInProject(access, projectDescriptor, info);
  };
  const creatableScopeLabels = Array.from(new Set(
    creatableScopes.map((scope) => String(scope?.label || scope?.value || '').trim()).filter(Boolean)
  ));
  const manageableScopes = Array.isArray(access.manageableTrackScopes) ? access.manageableTrackScopes : [];
  const editableScopeLabels = Array.from(new Set(
    manageableScopes.map((scope) => String(scope?.label || scope?.value || '').trim()).filter(Boolean)
  ));
  // Human-readable reason why a track is not editable (null when it is).
  // Used for disabled-control tooltips so the UI never has to guess.
  const explainTrackAccess = (trackId) => {
    if (canEditTrack(trackId)) return null;
    if (!trackLevelWrite) return 'You have read-only access to this project';
    if (editableScopeLabels.length) {
      return `You can only edit tracks you created or tracks inside: ${editableScopeLabels.join(', ')}`;
    }
    return 'You can only edit tracks you created';
  };

  return {
    mode,
    isHosted: true,
    hasAccessInfo: true,
    isReadOnly: !trackLevelWrite,
    canEditProjectSettings: canEditProjectSettings(access),
    canEditLyrics: canEditProjectLyrics(access),
    canManageGroups: canManageGroups(access),
    canChangeTrackRoles: canChangeTrackRoles(access),
    canCreateTracks,
    canCreateTracksAtRoot,
    canCreateTrackUnder,
    creatableScopeLabels,
    canImport: canCreateTracks,
    canSolo,
    canExport: canExportProject(access),
    canEditAnyTrack: trackLevelWrite && (editableTrackIds.size > 0 || canCreateTracks),
    canEditTrack,
    canRecordTo: canEditTrack,
    explainTrackAccess,
    editableScopeLabels,
    editableTrackIds,
  };
}

export default function useProjectCapabilities(input) {
  const {
    access = null,
    project = null,
    userId = null,
    projectId = null,
    showId = null,
    projectCreatedByUserId = null,
    mode = EDITOR_MODE_HOSTED,
  } = input || {};

  // Track editability depends on tracks + tree structure (group names, parts,
  // artists, ownership stamps). Recompute whenever those change.
  return useMemo(
    () => computeProjectCapabilities({ access, project, userId, projectId, showId, projectCreatedByUserId, mode }),
    [access, project?.tracks, project?.trackTree, userId, projectId, showId, projectCreatedByUserId, mode]
  );
}
