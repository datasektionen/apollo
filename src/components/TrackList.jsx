import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileMusic,
  Guitar,
  Headphones,
  Metronome,
  Mic,
  User,
  Users,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { TRACK_ROLES } from '../types/project';
import { dbToVolume, volumeToDb } from '../utils/audio';
import { AUTO_PAN_STRATEGIES } from '../utils/choirAutoPan';
import { normalizeTrackName } from '../utils/naming';
import {
  GROUP_ROLE_NONE,
  GROUP_ROLE_CHOIRS,
  GROUP_ROLE_INSTRUMENTS,
  GROUP_ROLE_LEADS,
  getDefaultIconByRole,
  getNextStemIcon,
  getNextTrackType,
  getRoleColorClass,
  getStemIcon,
  isChoirRole,
  isGroupParentRole,
  mapGroupParentRoleToTrackRole,
} from '../utils/trackRoles';
import { ADVANCED_MIX_FOCUS_MODES, getAdvancedMixFocusMode as defaultGetAdvancedMixFocusMode } from '../utils/advancedMix';

const TRACK_HEIGHT = 100;
const REMOTE_VALUE_ANIMATION_MS = 800;

function easeInOutQuint(t) {
  if (t < 0.5) {
    return 16 * t * t * t * t * t;
  }
  return 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function TrackList({
  tracks,
  rows,
  remoteAnimation = null,
  trackEffectiveRoleById = {},
  onUpdateTrack,
  onUpdateGroup,
  onCreateSubtrack,
  onSelectRow,
  onSelectTrack,
  selectedNodeId,
  selectedTrackId,
  onAddTrack,
  onDeleteTrack,
  onEditTrackArtists,
  onEditGroupArtists,
  onSetAutoPanStrategy,
  onToggleAutoPanInverted,
  autoPanInverted = false,
  onReorderTrack,
  onMoveNode,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onToggleGroupCollapse,
  advancedMixFocus = null,
  getAdvancedMixFocusMode = defaultGetAdvancedMixFocusMode,
  onToggleAdvancedTrackFocus = null,
  getAdvancedMixGroupFocusState = null,
  onToggleAdvancedGroupFocus = null,
  advancedMixLocked = false,
  localSessionMode = false,
  canSoloTracks = true,
  emptyContextMenu,
  onClearEmptyContextMenu,
}) {
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const reorderDragRef = useRef(null);
  const suppressClickRef = useRef(false);

  const [editingName, setEditingName] = useState(null);
  const [dragTooltip, setDragTooltip] = useState(null);
  const [editTooltip, setEditTooltip] = useState(null);
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const [rowDragPreview, setRowDragPreview] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [animatedValueByKey, setAnimatedValueByKey] = useState({});

  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeMenuPos, setTypeMenuPos] = useState({ x: 0, y: 0 });
  const [autoPanMenuOpen, setAutoPanMenuOpen] = useState(false);
  const [autoPanMenuPos, setAutoPanMenuPos] = useState({ x: 0, y: 0 });
  const [groupTypeMenuOpen, setGroupTypeMenuOpen] = useState(false);
  const [groupTypeMenuPos, setGroupTypeMenuPos] = useState({ x: 0, y: 0 });

  const [isTypeTriggerHover, setIsTypeTriggerHover] = useState(false);
  const [isTypeMenuHover, setIsTypeMenuHover] = useState(false);
  const [isAutoPanTriggerHover, setIsAutoPanTriggerHover] = useState(false);
  const [isAutoPanMenuHover, setIsAutoPanMenuHover] = useState(false);
  const [isGroupTypeTriggerHover, setIsGroupTypeTriggerHover] = useState(false);
  const [isGroupTypeMenuHover, setIsGroupTypeMenuHover] = useState(false);
  const animatedValueByKeyRef = useRef({});
  const valueAnimationFrameRef = useRef(null);
  const pendingIconStateRef = useRef(new Map());
  const [pendingIconStateVersion, setPendingIconStateVersion] = useState(0);

  const trackMap = useMemo(() => new Map((tracks || []).map((track) => [track.id, track])), [tracks]);
  const visibleRows = useMemo(() => {
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }
    return (tracks || []).map((track) => ({
      kind: 'track',
      nodeId: track.id,
      trackId: track.id,
      track,
      depth: 0,
      height: TRACK_HEIGHT,
    }));
  }, [rows, tracks]);
  const rowByNodeId = useMemo(
    () => new Map((visibleRows || []).map((row) => [row.nodeId, row])),
    [visibleRows]
  );
  const advancedMixEnabled = typeof onToggleAdvancedTrackFocus === 'function';
  const advancedMixGroupEnabled = typeof onToggleAdvancedGroupFocus === 'function';
  const metadataLocked = advancedMixLocked || localSessionMode;
  const structureMenuLocked = advancedMixLocked || localSessionMode;
  const getTrackFocusMode = useCallback((trackId) => (
    advancedMixEnabled ? getAdvancedMixFocusMode(advancedMixFocus, trackId) : null
  ), [advancedMixEnabled, advancedMixFocus, getAdvancedMixFocusMode]);
  const getGroupFocusState = useCallback((groupNodeId) => (
  advancedMixGroupEnabled && typeof getAdvancedMixGroupFocusState === 'function'
      ? getAdvancedMixGroupFocusState(groupNodeId)
      : 'none'
  ), [advancedMixGroupEnabled, getAdvancedMixGroupFocusState]);

  const rowArtistRefs = (row) => {
    if (!row) return [];
    if (row.kind === 'group') {
      return Array.isArray(row.artistRefs) ? row.artistRefs : [];
    }
    const track = row.track || trackMap.get(row.trackId);
    return Array.isArray(track?.artistRefs) ? track.artistRefs : [];
  };

  const hasSoloArtistRef = (artistRefs) => (
    Array.isArray(artistRefs)
    && artistRefs.some((ref) => {
      const type = String(ref?.type || '').trim().toLowerCase();
      return type === 'user' || type === 'guest';
    })
  );

  const hasSoloArtistAncestor = (row) => {
    let parentId = row?.parentId ?? null;
    while (parentId) {
      const parentRow = rowByNodeId.get(parentId);
      if (!parentRow) return false;
      if (hasSoloArtistRef(rowArtistRefs(parentRow))) {
        return true;
      }
      parentId = parentRow.parentId ?? null;
    }
    return false;
  };

  const iconOptions = useMemo(() => [
    { key: 'guitar', Icon: Guitar },
    { key: 'user', Icon: User },
    { key: 'users', Icon: Users },
    { key: 'metronome', Icon: Metronome },
    { key: 'wave', Icon: Waves },
    { key: 'mic', Icon: Mic },
    { key: 'file-music', Icon: FileMusic },
  ], []);

  const menuItemClass = 'w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-200 hover:bg-gray-700 whitespace-nowrap';
  const trackTypeOptions = [
    { value: TRACK_ROLES.INSTRUMENT, label: 'Instrument', groupRole: GROUP_ROLE_INSTRUMENTS },
    { value: TRACK_ROLES.LEAD, label: 'Lead', groupRole: GROUP_ROLE_LEADS },
    { value: TRACK_ROLES.CHOIR, label: 'Choir', groupRole: GROUP_ROLE_CHOIRS },
    { value: TRACK_ROLES.METRONOME, label: 'Metronome', groupRole: TRACK_ROLES.METRONOME },
    { value: TRACK_ROLES.OTHER, label: 'Other', groupRole: GROUP_ROLE_NONE },
  ];

  const selectRow = (row) => {
    if (!row) return;
    onSelectRow?.(row);
    if (row.kind === 'track') {
      const trackId = row.trackId || row.track?.id;
      if (trackId) onSelectTrack?.(trackId);
    }
  };

  const getInheritedParentGroupRole = (row) => {
    let parentId = row?.parentId ?? null;
    while (parentId) {
      const parentRow = rowByNodeId.get(parentId);
      if (!parentRow || parentRow.kind !== 'group') return null;
      if (isGroupParentRole(parentRow.role)) {
        return parentRow.role;
      }
      parentId = parentRow.parentId ?? null;
    }
    return null;
  };

  const isLegacyPartTrackRow = (row) => (
    row?.role === TRACK_ROLES.INSTRUMENT
    || row?.role === TRACK_ROLES.LEAD
    || row?.role === TRACK_ROLES.OTHER
    || isChoirRole(row?.role)
  );

  const rowIsPartTrack = (row) => {
    if (!row) return false;
    if (row.part !== undefined) return Boolean(row.part);
    if (row.kind === 'track' && row.track?.part !== undefined) return Boolean(row.track.part);
    return isLegacyPartTrackRow(row);
  };

  const hasDirectParentTypeLock = (row) => {
    const parentId = row?.parentId ?? null;
    let currentParentId = parentId;
    while (currentParentId) {
      const parentRow = rowByNodeId.get(currentParentId);
      if (!parentRow || parentRow.kind !== 'group') return false;
      if (rowIsPartTrack(parentRow)) return true;
      if (currentParentId === parentId) return true;
      currentParentId = parentRow.parentId ?? null;
    }
    return false;
  };

  const getDirectParentForcedRole = (row) => {
    const parentId = row?.parentId ?? null;
    if (!parentId) return null;
    const parentRow = rowByNodeId.get(parentId);
    if (!parentRow || parentRow.kind !== 'group') return null;
    if (isGroupParentRole(parentRow.role)) {
      return mapGroupParentRoleToTrackRole(parentRow.role);
    }
    return getTrackTypeValue(parentRow.role);
  };

  const setGlobalDragCursor = (active) => {
    document.body.classList.toggle('row-drag-cursor', active);
    document.body.style.userSelect = active ? 'none' : '';
  };

  const getDropTarget = (rowMeta, fromIndex, pointerY) => {
    if (!rowMeta.length) return null;

    const metaIndexByNodeId = new Map(rowMeta.map((meta, idx) => [meta.nodeId, idx]));
    const getLastDescendantIndex = (groupIndex) => {
      const groupDepth = rowMeta[groupIndex]?.depth ?? 0;
      let last = groupIndex;
      for (let i = groupIndex + 1; i < rowMeta.length; i += 1) {
        if ((rowMeta[i]?.depth ?? 0) <= groupDepth) break;
        last = i;
      }
      return last;
    };

    let hoverIndex = rowMeta.findIndex((meta) => pointerY < meta.bottom);
    if (hoverIndex === -1) hoverIndex = rowMeta.length - 1;

    const hovered = rowMeta[hoverIndex];
    if (!hovered) return null;

    let target = hovered;
    let placement = 'after';

    if (hovered.kind === 'group') {
      // Hovering the parent row always means drop inside that group.
      placement = 'inside';
    } else {
      const bottomHalf = pointerY >= hovered.mid;
      const parentGroupIndex = hovered.parentId ? metaIndexByNodeId.get(hovered.parentId) : undefined;
      const hasParentGroup = Number.isInteger(parentGroupIndex) && rowMeta[parentGroupIndex]?.kind === 'group';
      const isLastVisibleInParent = hasParentGroup
        ? hoverIndex === getLastDescendantIndex(parentGroupIndex)
        : false;

      if (hasParentGroup && isLastVisibleInParent) {
        if (bottomHalf) {
          // Bottom half of the last child exits the parent group.
          target = rowMeta[parentGroupIndex];
          placement = 'after';
        } else {
          // Top half of the last child stays inside as the last child.
          placement = 'after';
        }
      } else {
        placement = bottomHalf ? 'after' : 'before';
      }
    }

    const targetIndex = rowMeta.findIndex((meta) => meta.nodeId === target.nodeId);
    let insertAnchorIndex = targetIndex;
    if (target.kind === 'group' && (placement === 'after' || placement === 'inside')) {
      // In flattened preview, both "inside as last child" and "after group"
      // land after the group's visible descendants.
      insertAnchorIndex = getLastDescendantIndex(targetIndex);
    }

    let insertIndex = insertAnchorIndex;
    if (placement === 'after' || placement === 'inside') {
      insertIndex = insertAnchorIndex + 1;
    }
    if (insertIndex > fromIndex) {
      insertIndex -= 1;
    }
    insertIndex = Math.max(0, Math.min(rowMeta.length, insertIndex));

    const targetDepth = placement === 'inside' ? target.depth + 1 : target.depth;
    return {
      target,
      placement,
      insertIndex,
      targetDepth,
    };
  };

  const getRowDragOffsetY = (rowIndex, rowNodeId) => {
    if (!rowDragPreview?.moved) return 0;
    const { nodeId, fromIndex, insertIndex, rowHeight, deltaY } = rowDragPreview;
    if (rowNodeId === nodeId) return deltaY;
    if (insertIndex < fromIndex && rowIndex >= insertIndex && rowIndex < fromIndex) {
      return rowHeight;
    }
    if (insertIndex > fromIndex && rowIndex > fromIndex && rowIndex <= insertIndex) {
      return -rowHeight;
    }
    return 0;
  };

  const startValueAnimation = useCallback((entries, durationMs = REMOTE_VALUE_ANIMATION_MS) => {
    const normalizedEntries = (entries || [])
      .map((entry) => ({
        key: entry?.key,
        from: toFiniteNumber(entry?.from, 0),
        to: toFiniteNumber(entry?.to, 0),
      }))
      .filter((entry) => typeof entry.key === 'string' && Math.abs(entry.from - entry.to) > 1e-6);

    if (!normalizedEntries.length) return undefined;

    if (valueAnimationFrameRef.current) {
      cancelAnimationFrame(valueAnimationFrameRef.current);
      valueAnimationFrameRef.current = null;
    }

    setAnimatedValueByKey((previous) => {
      const next = { ...previous };
      normalizedEntries.forEach((entry) => {
        next[entry.key] = entry.from;
      });
      return next;
    });

    const startAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startAt) / durationMs);
      const eased = easeInOutQuint(progress);

      setAnimatedValueByKey((previous) => {
        const next = { ...previous };
        normalizedEntries.forEach((entry) => {
          next[entry.key] = entry.from + ((entry.to - entry.from) * eased);
        });
        return next;
      });

      if (progress < 1) {
        valueAnimationFrameRef.current = requestAnimationFrame(step);
        return;
      }

      valueAnimationFrameRef.current = null;
      setAnimatedValueByKey((previous) => {
        const next = { ...previous };
        normalizedEntries.forEach((entry) => {
          delete next[entry.key];
        });
        return next;
      });
    };

    valueAnimationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (valueAnimationFrameRef.current) {
        cancelAnimationFrame(valueAnimationFrameRef.current);
        valueAnimationFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    animatedValueByKeyRef.current = animatedValueByKey;
  }, [animatedValueByKey]);

  useLayoutEffect(() => {
    if (!remoteAnimation?.token) return;

    const durationMs = Number(remoteAnimation.durationMs || REMOTE_VALUE_ANIMATION_MS);
    const trackValueById = remoteAnimation?.trackValueById || {};
    const groupValueById = remoteAnimation?.groupValueById || {};
    const entries = [];

    const registerKey = (key, fromRaw, toRaw) => {
      const inFlight = animatedValueByKeyRef.current[key];
      const fromValue = Number.isFinite(inFlight) ? inFlight : toFiniteNumber(fromRaw, 0);
      const toValue = toFiniteNumber(toRaw, fromValue);
      if (Math.abs(fromValue - toValue) <= 1e-6) return;
      entries.push({ key, from: fromValue, to: toValue });
    };

    Object.entries(trackValueById).forEach(([trackId, values]) => {
      registerKey(
        `track:${trackId}:volume`,
        values?.fromVolume,
        values?.toVolume
      );
      registerKey(
        `track:${trackId}:pan`,
        values?.fromPan,
        values?.toPan
      );
    });

    Object.entries(groupValueById).forEach(([groupNodeId, values]) => {
      registerKey(
        `group:${groupNodeId}:volume`,
        values?.fromVolume,
        values?.toVolume
      );
      registerKey(
        `group:${groupNodeId}:pan`,
        values?.fromPan,
        values?.toPan
      );
    });

    if (!entries.length) return;
    return startValueAnimation(entries, durationMs);
  }, [remoteAnimation?.token, startValueAnimation]);

  useEffect(() => () => {
    if (valueAnimationFrameRef.current) {
      cancelAnimationFrame(valueAnimationFrameRef.current);
      valueAnimationFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!contextMenu || contextMenu.type !== 'track') {
      setTypeMenuOpen(false);
      setAutoPanMenuOpen(false);
      setIsTypeTriggerHover(false);
      setIsTypeMenuHover(false);
      setIsAutoPanTriggerHover(false);
      setIsAutoPanMenuHover(false);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || contextMenu.type !== 'group') {
      setGroupTypeMenuOpen(false);
      setIsGroupTypeTriggerHover(false);
      setIsGroupTypeMenuHover(false);
    }
  }, [contextMenu]);

  useEffect(() => {
    const typeOpen = isTypeTriggerHover || isTypeMenuHover;
    setTypeMenuOpen(typeOpen);
  }, [isTypeTriggerHover, isTypeMenuHover]);

  useEffect(() => {
    const autoOpen = isAutoPanTriggerHover || isAutoPanMenuHover;
    setAutoPanMenuOpen(autoOpen);
  }, [isAutoPanTriggerHover, isAutoPanMenuHover]);

  useEffect(() => {
    const typeOpen = isGroupTypeTriggerHover || isGroupTypeMenuHover;
    setGroupTypeMenuOpen(typeOpen);
  }, [isGroupTypeTriggerHover, isGroupTypeMenuHover]);

  useEffect(() => {
    const handleMove = (e) => {
      handleDragMove(e);
      handleRowReorderMove(e);
    };
    const handleUp = () => {
      endDrag();
      handleRowReorderEnd();
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      setGlobalDragCursor(false);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (!emptyContextMenu) return;
    setContextMenu(emptyContextMenu);
    onClearEmptyContextMenu?.();
  }, [emptyContextMenu, onClearEmptyContextMenu]);

  const openTypeMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTypeMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsTypeTriggerHover(true);
  };

  const openAutoPanMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAutoPanMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsAutoPanTriggerHover(true);
  };

  const openGroupTypeMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setGroupTypeMenuPos({ x: rect.right + 1, y: rect.top - 1 });
    setIsGroupTypeTriggerHover(true);
  };

  const getPendingIconState = (key) => pendingIconStateRef.current.get(key) || null;

  const setPendingIconState = (key, value) => {
    pendingIconStateRef.current.set(key, value);
    setPendingIconStateVersion((version) => version + 1);
  };

  const getIconOption = (iconKey) => (
    iconOptions.find((opt) => opt.key === iconKey)
    || iconOptions.find((opt) => opt.key === 'wave')
    || iconOptions[0]
  );

  const getIconForRole = (role) => getIconOption(getDefaultIconByRole(role));

  const isSubTrackRow = (row) => row?.kind === 'track' && Boolean(row.parentId);

  const getIconForTrack = (track, row) => {
    const pending = getPendingIconState(`track:${track.id}`);
    if (isSubTrackRow(row)) {
      return getIconOption(getStemIcon(pending?.icon ?? track?.icon));
    }
    return getIconForRole(pending?.role || trackEffectiveRoleById[track.id] || track.role);
  };

  const hasPartTrackAncestor = (row) => {
    let parentId = row?.parentId ?? null;
    while (parentId) {
      const parentRow = rowByNodeId.get(parentId);
      if (!parentRow || parentRow.kind !== 'group') return false;
      if (rowIsPartTrack(parentRow)) {
        return true;
      }
      parentId = parentRow.parentId ?? null;
    }
    return false;
  };

  const cycleStemIcon = (track) => {
    if (metadataLocked) return;
    if (!track?.id) return;
    const pendingKey = `track:${track.id}`;
    const currentIcon = getPendingIconState(pendingKey)?.icon ?? track.icon;
    const nextIcon = getNextStemIcon(currentIcon);
    setPendingIconState(pendingKey, { icon: nextIcon });
    onUpdateTrack?.(track.id, () => ({ icon: nextIcon }));
  };

  const cycleTrackType = (track, row) => {
    if (metadataLocked) return;
    if (hasDirectParentTypeLock(row)) return;
    if (!track?.id) return;
    const pendingKey = `track:${track.id}`;
    const currentRole = getPendingIconState(pendingKey)?.role
      ?? trackEffectiveRoleById[track.id]
      ?? track.role;
    const nextType = getNextTrackType(currentRole);
    const nextPatch = {
      role: nextType,
      icon: getDefaultIconByRole(nextType),
    };
    setPendingIconState(pendingKey, nextPatch);
    onUpdateTrack?.(track.id, () => nextPatch);
  };

  const commitGroupRoleChange = (source, groupRow, nextRole, nextPart = null) => {
    console.debug('[GroupRoleUI]', {
      source,
      groupNodeId: groupRow?.nodeId,
      groupName: groupRow?.name,
      fromRole: groupRow?.role,
      toRole: nextRole,
      fromPart: groupRow?.part,
      toPart: nextPart,
      parentId: groupRow?.parentId ?? null,
    });
    onUpdateGroup?.(groupRow.nodeId, {
      role: nextRole,
      ...(nextPart !== null ? { part: Boolean(nextPart) } : {}),
    });
  };

  const getTrackTypeValue = (role) => {
    if (role === TRACK_ROLES.METRONOME) return TRACK_ROLES.METRONOME;
    if (role === TRACK_ROLES.INSTRUMENT) return TRACK_ROLES.INSTRUMENT;
    if (role === TRACK_ROLES.LEAD) return TRACK_ROLES.LEAD;
    if (isChoirRole(role)) return TRACK_ROLES.CHOIR;
    return TRACK_ROLES.OTHER;
  };

  const getGroupTypeValue = (groupRow) => {
    const role = groupRow?.role;
    if (isGroupParentRole(role)) {
      return mapGroupParentRoleToTrackRole(role) || TRACK_ROLES.OTHER;
    }
    return getTrackTypeValue(role);
  };

  const getRowTypeValue = (row, track = null) => (
    row?.kind === 'group'
      ? getGroupTypeValue(row)
      : getTrackTypeValue(track?.role || row?.track?.role)
  );

  const applyTrackType = (row, track, nextType) => {
    if (metadataLocked) return;
    if (!track?.id) return;
    onUpdateTrack?.(track.id, {
      role: nextType,
      icon: getDefaultIconByRole(nextType),
    });
  };

  const applyGroupType = (groupRow, nextType) => {
    if (metadataLocked) return;
    if (!groupRow?.nodeId) return;
    const option = trackTypeOptions.find((candidate) => candidate.value === nextType);
    const nextPart = Boolean(groupRow.part);
    const nextRole = nextPart ? nextType : (option?.groupRole || GROUP_ROLE_NONE);
    commitGroupRoleChange('context-menu/change-type', groupRow, nextRole, nextPart);
  };

  const toggleTrackPart = (row, track) => {
    if (metadataLocked) return;
    if (!track?.id) return;
    if (hasPartTrackAncestor(row)) return;
    onUpdateTrack?.(track.id, { part: !Boolean(row?.part || track.part) });
  };

  const toggleGroupPart = (groupRow) => {
    if (metadataLocked) return;
    if (!groupRow?.nodeId) return;
    if (hasPartTrackAncestor(groupRow)) return;
    const nextPart = !Boolean(groupRow.part);
    const currentType = getGroupTypeValue(groupRow);
    const option = trackTypeOptions.find((candidate) => candidate.value === currentType);
    commitGroupRoleChange(
      'context-menu/toggle-part',
      groupRow,
      nextPart ? currentType : (option?.groupRole || GROUP_ROLE_NONE),
      nextPart
    );
  };

  const cycleGroupRole = (groupRow) => {
    if (metadataLocked) return;
    if (hasDirectParentTypeLock(groupRow)) return;
    const pendingKey = `group:${groupRow.nodeId}`;
    const currentType = getPendingIconState(pendingKey)?.role ?? getGroupTypeValue(groupRow);
    const nextType = getNextTrackType(currentType);
    setPendingIconState(pendingKey, { role: nextType });
    applyGroupType(groupRow, nextType);
  };

  useLayoutEffect(() => {
    const pending = pendingIconStateRef.current;
    if (!pending.size) return;
    let changed = false;
    pending.forEach((value, key) => {
      if (key.startsWith('track:')) {
        const track = trackMap.get(key.slice('track:'.length));
        if (!track) {
          pending.delete(key);
          changed = true;
          return;
        }
        const roleMatches = !value.role || getTrackTypeValue(track.role) === value.role;
        const iconMatches = !value.icon || getStemIcon(track.icon) === value.icon;
        if (roleMatches && iconMatches) {
          pending.delete(key);
          changed = true;
        }
        return;
      }
      if (key.startsWith('group:')) {
        const groupRow = rowByNodeId.get(key.slice('group:'.length));
        if (!groupRow) {
          pending.delete(key);
          changed = true;
          return;
        }
        if (!value.role || getGroupTypeValue(groupRow) === value.role) {
          pending.delete(key);
          changed = true;
        }
      }
    });
    if (changed) {
      setPendingIconStateVersion((version) => version + 1);
    }
  }, [rowByNodeId, trackMap, pendingIconStateVersion]);

  const handleVolumeChange = (trackId, value) => {
    const next = parseFloat(value);
    const current = trackMap.get(trackId)?.volume;
    if (Number.isFinite(current) && Math.abs(current - next) < 1e-6) return;
    onUpdateTrack(trackId, { volume: next });
  };

  const handlePanChange = (trackId, value) => {
    const next = parseFloat(value);
    const current = trackMap.get(trackId)?.pan;
    if (Number.isFinite(current) && Math.abs(current - next) < 1e-6) return;
    onUpdateTrack(trackId, { pan: next });
  };

  const handleGroupVolumeChange = (groupNodeId, value) => {
    const next = parseFloat(value);
    const current = rowByNodeId.get(groupNodeId)?.volume;
    if (Number.isFinite(current) && Math.abs(current - next) < 1e-6) return;
    onUpdateGroup?.(groupNodeId, { volume: next });
  };

  const handleGroupPanChange = (groupNodeId, value) => {
    const next = parseFloat(value);
    const current = rowByNodeId.get(groupNodeId)?.pan;
    if (Number.isFinite(current) && Math.abs(current - next) < 1e-6) return;
    onUpdateGroup?.(groupNodeId, { pan: next });
  };

  const beginDrag = (e, entityId, type, startValue, onCommit) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (editTooltip) setEditTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setDragTooltip({
      entityId,
      type,
      value: startValue,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
    dragRef.current = {
      entityId,
      type,
      startX: e.clientX,
      startValue,
      lastValue: startValue,
      width: rect.width,
      moved: false,
      onCommit,
    };
  };

  const beginRowReorder = (e, row) => {
    if (advancedMixLocked) return;
    if (e.button !== 0) return;
    if (e.target.closest('[data-track-interactive="true"]')) return;
    e.preventDefault();

    const container = listRef.current;
    if (!container) return;

    const rowMeta = visibleRows
      .map((candidate, index) => {
        const rowElement = container.querySelector(`[data-tree-row-id="${candidate.nodeId}"]`);
        if (!rowElement) return null;
        const rect = rowElement.getBoundingClientRect();
        return {
          index,
          nodeId: candidate.nodeId,
          kind: candidate.kind,
          trackId: candidate.trackId || null,
          parentId: candidate.parentId ?? null,
          depth: candidate.depth ?? 0,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          mid: rect.top + rect.height / 2,
        };
      })
      .filter(Boolean);

    if (rowMeta.length < 2) return;
    const fromIndex = rowMeta.findIndex((meta) => meta.nodeId === row.nodeId);
    if (fromIndex < 0) return;

    reorderDragRef.current = {
      nodeId: row.nodeId,
      kind: row.kind,
      trackId: row.trackId || null,
      fromIndex,
      rowHeight: row.height,
      startY: e.clientY,
      lastY: e.clientY,
      moved: false,
      rowMeta,
      lastDropTarget: null,
    };
    setRowDragPreview({
      nodeId: row.nodeId,
      fromIndex,
      insertIndex: fromIndex,
      rowHeight: row.height,
      deltaY: 0,
      moved: false,
      targetDepth: row.depth ?? 0,
    });
    setDraggingNodeId(row.nodeId);
  };

  const handleDragMove = (e) => {
    if (!dragRef.current) return;
    const { entityId, type, startX, startValue, width, moved } = dragRef.current;
    const deltaX = e.clientX - startX;
    if (!moved && Math.abs(deltaX) < 2) return;
    dragRef.current.moved = true;
    if (editTooltip) setEditTooltip(null);

    if (type === 'volume') {
      const range = 100;
      const next = Math.min(100, Math.max(0, startValue + (deltaX / width) * range));
      if (Math.abs(next - dragRef.current.lastValue) < 1e-6) {
        setDragTooltip((prev) => (prev ? { ...prev, value: next } : { entityId, type, value: next }));
        return;
      }
      dragRef.current.lastValue = next;
      setDragTooltip((prev) => (prev ? { ...prev, value: next } : { entityId, type, value: next }));
    } else {
      const range = 200;
      const next = Math.min(100, Math.max(-100, startValue + (deltaX / width) * range));
      if (Math.abs(next - dragRef.current.lastValue) < 1e-6) {
        setDragTooltip((prev) => (prev ? { ...prev, value: next } : { entityId, type, value: next }));
        return;
      }
      dragRef.current.lastValue = next;
      setDragTooltip((prev) => (prev ? { ...prev, value: next } : { entityId, type, value: next }));
    }
  };

  const endDrag = () => {
    const dragState = dragRef.current;
    dragRef.current = null;
    setDragTooltip(null);
    if (!dragState || !dragState.moved) return;
    const finalValue = Number.isFinite(dragState.lastValue)
      ? dragState.lastValue
      : dragState.startValue;
    if (Math.abs(finalValue - dragState.startValue) < 1e-6) return;
    dragState.onCommit?.(finalValue);
  };

  const getDraggedValue = (entityId, type, fallback) => {
    if (dragTooltip?.entityId === entityId && dragTooltip.type === type) {
      return dragTooltip.value;
    }
    return fallback;
  };

  const getAnimatedValue = (entityKind, entityId, type, fallback) => {
    const key = `${entityKind}:${entityId}:${type}`;
    const animated = animatedValueByKey[key];
    return Number.isFinite(animated) ? animated : fallback;
  };

  const getEntityKind = (entityId) => {
    const row = rowByNodeId.get(entityId);
    if (row?.kind === 'group') return 'group';
    return 'track';
  };

  const getCurrentEntityValue = (entityKind, entityId, type) => {
    if (entityKind === 'group') {
      const row = rowByNodeId.get(entityId);
      if (type === 'volume') return toFiniteNumber(row?.volume, 100);
      return toFiniteNumber(row?.pan, 0);
    }
    const track = trackMap.get(entityId);
    if (type === 'volume') return toFiniteNumber(track?.volume, 100);
    return toFiniteNumber(track?.pan, 0);
  };

  const handleRowReorderMove = (e) => {
    const dragState = reorderDragRef.current;
    if (!dragState) return;
    dragState.lastY = e.clientY;
    const deltaY = e.clientY - dragState.startY;
    if (!dragState.moved && Math.abs(deltaY) < 4) return;
    if (!dragState.moved) {
      setGlobalDragCursor(true);
    }
    dragState.moved = true;
    const dropTarget = getDropTarget(dragState.rowMeta, dragState.fromIndex, e.clientY);
    if (!dropTarget) return;
    dragState.lastDropTarget = dropTarget;
    setRowDragPreview((prev) => {
      if (!prev || prev.nodeId !== dragState.nodeId) return prev;
      return {
        ...prev,
        insertIndex: dropTarget.insertIndex,
        targetDepth: dropTarget.targetDepth,
        deltaY,
        moved: true,
      };
    });
    e.preventDefault();
  };

  const handleRowReorderEnd = () => {
    const dragState = reorderDragRef.current;
    if (!dragState) return;

    reorderDragRef.current = null;
    setDraggingNodeId(null);
    setRowDragPreview(null);
    setGlobalDragCursor(false);

    if (!dragState.moved) return;

    const { rowMeta, nodeId, trackId, lastY, fromIndex } = dragState;
    const dropTarget = dragState.lastDropTarget || getDropTarget(rowMeta, fromIndex, lastY);
    if (!dropTarget) return;
    const { target, placement, insertIndex } = dropTarget;

    if (target.nodeId === nodeId) return;

    if (onMoveNode) {
      onMoveNode(nodeId, target.nodeId, placement);
    } else if (trackId && target.trackId && placement !== 'inside') {
      onReorderTrack?.(trackId, insertIndex);
    }

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const openEditTooltip = (entityId, type, text, e) => {
    setDragTooltip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setEditTooltip({
      entityId,
      type,
      text,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
  };

  const handleVolumeDoubleClick = (entityId, currentVolume, e) => {
    const display = currentVolume <= 0 ? '-∞' : volumeToDb(currentVolume).toFixed(1);
    openEditTooltip(entityId, 'volume', display, e);
  };

  const handlePanDoubleClick = (entityId, currentPan, e) => {
    openEditTooltip(entityId, 'pan', currentPan.toFixed(0), e);
  };

  const commitEditTooltip = ({ onVolumeChange, onPanChange }) => {
    if (!editTooltip) return;

    const entityId = editTooltip.entityId;
    const entityKind = getEntityKind(entityId);
    const text = editTooltip.text.trim();
    if (editTooltip.type === 'volume') {
      let nextVolume = null;
      if (!text) {
        nextVolume = dbToVolume(0);
      } else {
        const normalized = text.toLowerCase();
        if (normalized === '-∞' || normalized === '-inf' || normalized === '-infinity') {
          nextVolume = 0;
        } else {
          const parsed = parseFloat(text);
          if (!Number.isNaN(parsed)) {
            const clampedDb = Math.min(6, Math.max(-60, parsed));
            nextVolume = dbToVolume(clampedDb);
          }
        }
      }

      if (nextVolume !== null) {
        const current = getAnimatedValue(
          entityKind,
          entityId,
          'volume',
          getCurrentEntityValue(entityKind, entityId, 'volume')
        );
        startValueAnimation([{
          key: `${entityKind}:${entityId}:volume`,
          from: current,
          to: nextVolume,
        }]);
        onVolumeChange?.(nextVolume);
      }
    } else {
      let nextPan = null;
      if (!text) {
        nextPan = 0;
      } else {
        const parsed = parseFloat(text);
        if (!Number.isNaN(parsed)) {
          nextPan = Math.min(100, Math.max(-100, parsed));
        }
      }

      if (nextPan !== null) {
        const current = getAnimatedValue(
          entityKind,
          entityId,
          'pan',
          getCurrentEntityValue(entityKind, entityId, 'pan')
        );
        startValueAnimation([{
          key: `${entityKind}:${entityId}:pan`,
          from: current,
          to: nextPan,
        }]);
        onPanChange?.(nextPan);
      }
    }

    setEditTooltip(null);
  };

  const handleToggleMute = (trackId, currentMuted) => {
    onUpdateTrack(trackId, { muted: !currentMuted });
  };

  const handleToggleSolo = (trackId, currentSoloed) => {
    if (!canSoloTracks) {
      window.alert('Solo requires permission to edit every track in the project.');
      return;
    }
    onUpdateTrack(trackId, { soloed: !currentSoloed });
  };

  const handleToggleGroupMute = (groupNodeId, currentMuted) => {
    onUpdateGroup?.(groupNodeId, { muted: !currentMuted });
  };

  const handleToggleGroupSolo = (groupNodeId, currentSoloed) => {
    if (!canSoloTracks) {
      window.alert('Solo requires permission to edit every track in the project.');
      return;
    }
    onUpdateGroup?.(groupNodeId, { soloed: !currentSoloed });
  };

  const handleNameChange = (trackId, newName) => {
    if (metadataLocked) {
      setEditingName(null);
      return;
    }
    const normalizedName = normalizeTrackName(newName);
    if (normalizedName) {
      onUpdateTrack(trackId, { name: normalizedName });
    }
    setEditingName(null);
  };

  const handleRenameGroup = (groupRow) => {
    if (metadataLocked) return;
    const nextNameRaw = window.prompt('Rename group', groupRow.name);
    if (nextNameRaw === null) return;
    const normalizedName = normalizeTrackName(nextNameRaw);
    if (!normalizedName) return;
    onRenameGroup?.(groupRow.nodeId, normalizedName);
  };

  const handleGroupNameChange = (groupNodeId, newName) => {
    if (metadataLocked) {
      setEditingName(null);
      return;
    }
    const normalizedName = normalizeTrackName(newName);
    if (normalizedName) {
      onRenameGroup?.(groupNodeId, normalizedName);
    }
    setEditingName(null);
  };

  const getRoleColor = (role) => getRoleColorClass(role);

  if (!visibleRows.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No tracks yet. Import audio files to get started.</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="flex flex-col min-h-full"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          type: 'empty',
        });
      }}
    >
      {visibleRows.map((row, rowIndex) => {
        const offsetY = getRowDragOffsetY(rowIndex, row.nodeId);
        const isDragging = draggingNodeId === row.nodeId;
        const isActivelyDragging = isDragging && Boolean(rowDragPreview?.moved);
        const previewDepth = isActivelyDragging
          ? (rowDragPreview?.targetDepth ?? row.depth ?? 0)
          : (row.depth ?? 0);
        const hasRowMotion = Boolean(rowDragPreview?.moved);
        const rowMotionStyle = hasRowMotion
          ? {
              transform: `translateY(${offsetY}px)`,
              transition: 'none',
              position: 'relative',
              zIndex: isDragging ? 30 : 1,
              boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.35)' : undefined,
              willChange: 'transform',
            }
          : {};
        const getVolumeSliderWidth = (isGroupRow) => {
          if (isGroupRow) {
            if (previewDepth <= 1) return 123;
            // Fold button starts constraining layout from indent level 2.
            return Math.max(72, 123 - ((previewDepth - 1) * 14));
          }
          if (previewDepth <= 3) return 123;
          return Math.max(72, 123 - ((previewDepth - 3) * 14));
        };

        if (row.kind === 'group') {
          const groupCollapsed = Boolean(row.collapsed);
          const directParentForcedRole = getDirectParentForcedRole(row);
          const pendingGroupState = getPendingIconState(`group:${row.nodeId}`);
          const displayGroupRole = pendingGroupState?.role || directParentForcedRole || row.role;
          const { Icon: GroupIcon, key: groupIconKey } = getIconForRole(displayGroupRole);
          const isSelectedRow = selectedNodeId === row.nodeId;
          const groupFocusState = getGroupFocusState(row.nodeId);
          const isGroupHighlightedInAdvancedMix = groupFocusState === 'all' || groupFocusState === 'partial';
          const groupRowClass = isGroupHighlightedInAdvancedMix
            ? (
              isSelectedRow
                ? 'bg-cyan-800/70 ring-1 ring-inset ring-cyan-300/50'
                : 'bg-cyan-950/45 hover:bg-cyan-900/55 ring-1 ring-inset ring-cyan-700/45'
            )
            : (isSelectedRow ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-750');
          const groupVolumeValue = getDraggedValue(
            row.nodeId,
            'volume',
            getAnimatedValue('group', row.nodeId, 'volume', toFiniteNumber(row.volume, 100))
          );
          const groupPanValue = getDraggedValue(
            row.nodeId,
            'pan',
            getAnimatedValue('group', row.nodeId, 'pan', toFiniteNumber(row.pan, 0))
          );

          return (
            <div
              key={row.nodeId}
              data-tree-row-id={row.nodeId}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  type: 'group',
                  group: row,
                });
              }}
              onMouseDown={(e) => beginRowReorder(e, row)}
              onClick={() => {
                if (suppressClickRef.current) return;
                selectRow(row);
              }}
              className={`border-b border-gray-700 cursor-pointer ${groupRowClass} ${isActivelyDragging ? 'cursor-grabbing' : ''}`}
              style={{
                height: `${row.height}px`,
                minHeight: `${row.height}px`,
                maxHeight: `${row.height}px`,
                ...rowMotionStyle,
              }}
            >
              <div
                className="h-full flex items-center gap-4 pr-4"
                style={{ paddingLeft: `${16 + previewDepth * 16}px` }}
              >
                <div
                  data-track-interactive="true"
                  className="flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (metadataLocked) return;
                      if (hasDirectParentTypeLock(row)) return;
                      cycleGroupRole(row);
                    }}
                    className={`w-14 h-14 rounded-lg ${getRoleColor(displayGroupRole)} text-white flex items-center justify-center overflow-hidden transition-none ${hasDirectParentTypeLock(row) || metadataLocked ? 'opacity-80 cursor-not-allowed' : ''}`}
                    title={metadataLocked ? 'Group category locked in this session' : 'Click to change type'}
                  >
                    <GroupIcon key={groupIconKey} size={32} className="shrink-0" />
                  </button>
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div
                    className="flex items-center min-w-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectRow(row);
                    }}
                  >
                    {editingName === `group:${row.nodeId}` ? (
                      <input
                        type="text"
                        defaultValue={row.name}
                        autoFocus
                        onBlur={(e) => handleGroupNameChange(row.nodeId, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleGroupNameChange(row.nodeId, e.target.value);
                          } else if (e.key === 'Escape') {
                            setEditingName(null);
                          }
                        }}
                        data-track-interactive="true"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-transparent border-b border-blue-500 px-0 py-0 text-lg font-semibold leading-none focus:outline-none min-w-0 h-[28px]"
                      />
	                    ) : (
	                      <span
	                        onDoubleClick={(e) => {
                          if (metadataLocked) return;
                          e.stopPropagation();
                          setEditingName(`group:${row.nodeId}`);
                        }}
                        className="flex-1 text-lg font-semibold truncate min-w-0 h-[28px] flex items-center select-none"
                        title="Double-click to edit"
                      >
                        {row.name}
                      </span>
                    )}
                  </div>

                  <div data-track-interactive="true" className="flex w-full items-center gap-2">
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleGroupMute(row.nodeId, row.muted);
                          }}
                          onContextMenu={(e) => {
                            if (!advancedMixGroupEnabled) return;
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleAdvancedGroupFocus(row.nodeId);
                          }}
                          className={`w-7 h-7 flex items-center justify-center rounded-l-md rounded-r-none border border-gray-600 transition-colors ${
                            row.muted ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                          }`}
                          title={advancedMixGroupEnabled ? 'Left click mute group, right click toggle mix slider target' : (row.muted ? 'Unmute group' : 'Mute group')}
                        >
                          {row.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleGroupSolo(row.nodeId, row.soloed);
                          }}
                          onContextMenu={(e) => {
                            if (!advancedMixGroupEnabled) return;
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleAdvancedGroupFocus(row.nodeId);
                          }}
                          className={`w-7 h-7 flex items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-gray-600 transition-colors ${
                            row.soloed ? 'bg-yellow-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
                          } ${canSoloTracks ? '' : 'opacity-60 cursor-not-allowed'}`}
                          title={
                            advancedMixGroupEnabled
                              ? 'Left click solo group, right click toggle mix slider target'
                              : canSoloTracks
                                ? (row.soloed ? 'Unsolo group' : 'Solo group')
                                : 'Solo requires permission to edit every track in the project'
                          }
                        >
                          <Headphones size={16} />
                        </button>
                      </div>

                      <button
                        data-track-interactive="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRow?.(row);
                          onToggleGroupCollapse?.(row.nodeId);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-600 transition-colors bg-gray-800 hover:bg-gray-600 text-gray-300"
                        title={groupCollapsed ? 'Expand group' : 'Collapse group'}
                      >
                        {groupCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                      <div
                        className="flex items-center relative"
                        style={{ width: `${getVolumeSliderWidth(true)}px` }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="0.1"
                        value={groupVolumeValue}
                        readOnly
                        onMouseDown={(e) => {
                          if (e.detail > 1) return;
                          beginDrag(
                            e,
                            row.nodeId,
                            'volume',
                            groupVolumeValue,
                            (next) => handleGroupVolumeChange(row.nodeId, next)
                          );
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleVolumeDoubleClick(row.nodeId, groupVolumeValue, e);
                        }}
                        className="w-full volume-slider volume-slider-lg cursor-pointer"
                      />
                      {dragTooltip?.entityId === row.nodeId && dragTooltip.type === 'volume' && (
                        <div
                          className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                          style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                        >
                          {dragTooltip.value <= 0 ? '-∞' : volumeToDb(dragTooltip.value).toFixed(1)}
                        </div>
                      )}
                      {editTooltip?.entityId === row.nodeId && editTooltip.type === 'volume' && (
                        <input
                          type="text"
                          value={editTooltip.text}
                          onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => commitEditTooltip({
                            onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                            onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitEditTooltip({
                                onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                                onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                              });
                            } else if (e.key === 'Escape') {
                              setEditTooltip(null);
                            }
                          }}
                          className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                          style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                          autoFocus
                        />
                      )}
                      </div>

                      <div
                        className="relative w-8 h-8 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                      <div className="absolute inset-0 overflow-hidden">
                        <div className="absolute inset-0 pan-ring pointer-events-none" />
                        <div className="absolute left-1/2 top-1/2 w-6 h-6 rounded-full bg-gray-700 border border-gray-600 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                        <div
                          className="absolute left-1/2 top-1/2 w-[3px] h-3 bg-gray-200 rounded-full origin-bottom pointer-events-none"
                          style={{ transform: `translate(-50%, -100%) rotate(${(groupPanValue / 100) * 135}deg)` }}
                        />
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={groupPanValue}
                        readOnly
                        onMouseDown={(e) => {
                          if (e.detail > 1) return;
                          beginDrag(
                            e,
                            row.nodeId,
                            'pan',
                            groupPanValue,
                            (next) => handleGroupPanChange(row.nodeId, next)
                          );
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handlePanDoubleClick(row.nodeId, groupPanValue, e);
                        }}
                        className="absolute top-0 left-0 right-0 h-4 pan-knob opacity-0 cursor-pointer z-10 pointer-events-auto appearance-none touch-none"
                        aria-label="Group pan"
                      />
                      {dragTooltip?.entityId === row.nodeId && dragTooltip.type === 'pan' && (
                        <div
                          className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                          style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                        >
                          {Math.round(dragTooltip.value)}
                        </div>
                      )}
                      {editTooltip?.entityId === row.nodeId && editTooltip.type === 'pan' && (
                        <input
                          type="text"
                          value={editTooltip.text}
                          onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => commitEditTooltip({
                            onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                            onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitEditTooltip({
                                onVolumeChange: (next) => handleGroupVolumeChange(row.nodeId, next),
                                onPanChange: (next) => handleGroupPanChange(row.nodeId, next),
                              });
                            } else if (e.key === 'Escape') {
                              setEditTooltip(null);
                            }
                          }}
                          className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                          style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                          autoFocus
                        />
                      )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        const track = row.track || trackMap.get(row.trackId);
        if (!track) return null;
        const pendingTrackState = getPendingIconState(`track:${track.id}`);
        const displayTrackRole = pendingTrackState?.role || trackEffectiveRoleById[track.id] || track.role;
        const isSubTrack = isSubTrackRow(row);
        const canEditTrackType = !isSubTrack && !hasDirectParentTypeLock(row);
        const canEditStemIcon = isSubTrack && !metadataLocked;
        const trackVolumeValue = getDraggedValue(
          track.id,
          'volume',
          getAnimatedValue('track', track.id, 'volume', toFiniteNumber(track.volume, 100))
        );
        const trackPanValue = getDraggedValue(
          track.id,
          'pan',
          getAnimatedValue('track', track.id, 'pan', toFiniteNumber(track.pan, 0))
        );

        const trackHeight = row.height || TRACK_HEIGHT;
        const { Icon: TrackIcon, key: trackIconKey } = getIconForTrack(track, row);
	        const isSelectedRow = selectedNodeId
	          ? selectedNodeId === row.nodeId
	          : selectedTrackId === track.id;
	        const trackFocusMode = getTrackFocusMode(track.id);
	        const isHighlightedInAdvancedMix = trackFocusMode === ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED;
	        const rowClass = isHighlightedInAdvancedMix
	          ? (
	            isSelectedRow
	              ? 'bg-cyan-800/70 ring-1 ring-inset ring-cyan-300/50'
	              : 'bg-cyan-950/45 hover:bg-cyan-900/55 ring-1 ring-inset ring-cyan-700/45'
	          )
	          : (isSelectedRow ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-750');

	        return (
          <div
            key={row.nodeId}
            data-tree-row-id={row.nodeId}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                type: 'track',
                track,
                row,
              });
            }}
            onMouseDown={(e) => beginRowReorder(e, row)}
            onClick={() => {
              if (suppressClickRef.current) return;
              selectRow(row);
            }}
	            className={`border-b border-gray-700 cursor-pointer ${rowClass} ${isActivelyDragging ? 'cursor-grabbing' : ''}`}
            style={{
              height: `${trackHeight}px`,
              minHeight: `${trackHeight}px`,
              maxHeight: `${trackHeight}px`,
              ...rowMotionStyle,
            }}
          >
            <div
              className="h-full flex items-center gap-4 pr-4"
              style={{ paddingLeft: `${16 + previewDepth * 16}px` }}
            >
                <div
                  data-track-interactive="true"
                  className="flex-shrink-0"
                  onClick={() => selectRow(row)}
                >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (metadataLocked) return;
                    if (isSubTrack) {
                      cycleStemIcon(track);
                      return;
                    }
                    if (!canEditTrackType) return;
                    cycleTrackType(track, row);
                  }}
                  className={`w-14 h-14 rounded-lg ${getRoleColor(displayTrackRole)} text-white flex items-center justify-center overflow-hidden transition-none ${
                    (canEditStemIcon || canEditTrackType) ? '' : 'opacity-80 cursor-not-allowed'
                  }`}
                  title={
                    metadataLocked
                      ? 'Track icon locked in this session'
                      : (isSubTrack ? 'Click to switch recording / file' : 'Click to change type')
                  }
                >
                  <TrackIcon key={trackIconKey} size={32} className="shrink-0" />
                </button>
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div
                  className="flex items-center min-w-0"
                  onClick={() => selectRow(row)}
                >
                  {editingName === track.id ? (
                    <input
                      type="text"
                      defaultValue={track.name}
                      autoFocus
                      onBlur={(e) => handleNameChange(track.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleNameChange(track.id, e.target.value);
                        } else if (e.key === 'Escape') {
                          setEditingName(null);
                        }
                      }}
                      data-track-interactive="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent border-b border-blue-500 px-0 py-0 text-lg font-semibold leading-none focus:outline-none min-w-0 h-[28px]"
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        if (metadataLocked) return;
                        e.stopPropagation();
                        setEditingName(track.id);
                      }}
                      className="flex-1 text-lg font-semibold truncate min-w-0 h-[28px] flex items-center select-none"
                      title="Double-click to edit"
	                      >
	                        {track.name}
	                      </span>
	                    )}
	                  </div>

                <div data-track-interactive="true" className="flex w-full items-center gap-2">
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-0">
	                      <button
	                        onClick={(e) => {
	                          e.stopPropagation();
	                          handleToggleMute(track.id, track.muted);
	                        }}
	                        onContextMenu={(e) => {
	                          if (!advancedMixEnabled) return;
	                          e.preventDefault();
	                          e.stopPropagation();
	                          onToggleAdvancedTrackFocus(track.id, ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED);
	                        }}
	                        className={`w-7 h-7 flex items-center justify-center rounded-l-md rounded-r-none border border-gray-600 transition-colors ${
	                          track.muted ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
	                        }`}
	                        title={advancedMixEnabled ? 'Left click mute, right click toggle mix slider target' : (track.muted ? 'Unmute' : 'Mute')}
	                      >
	                        {track.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
	                      </button>
	                      <button
	                        onClick={(e) => {
	                          e.stopPropagation();
	                          handleToggleSolo(track.id, track.soloed);
	                        }}
	                        onContextMenu={(e) => {
	                          if (!advancedMixEnabled) return;
	                          e.preventDefault();
	                          e.stopPropagation();
	                          onToggleAdvancedTrackFocus(track.id, ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED);
	                        }}
	                        className={`w-7 h-7 flex items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-gray-600 transition-colors ${
	                          track.soloed ? 'bg-yellow-600 text-white' : 'bg-gray-800 hover:bg-gray-600 text-gray-300'
	                        } ${canSoloTracks ? '' : 'opacity-60 cursor-not-allowed'}`}
	                        title={
	                          advancedMixEnabled
	                            ? 'Left click solo, right click toggle mix slider target'
	                            : canSoloTracks
	                              ? (track.soloed ? 'Unsolo' : 'Solo')
	                              : 'Solo requires permission to edit every track in the project'
	                        }
	                      >
                        <Headphones size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    <div
                      className="flex items-center relative"
                      style={{ width: `${getVolumeSliderWidth(false)}px` }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={trackVolumeValue}
                      readOnly
                      onMouseDown={(e) => {
                        if (e.detail > 1) return;
                        beginDrag(
                          e,
                          track.id,
                          'volume',
                          trackVolumeValue,
                          (next) => handleVolumeChange(track.id, next)
                        );
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleVolumeDoubleClick(track.id, trackVolumeValue, e);
                      }}
                      className="w-full volume-slider volume-slider-lg cursor-pointer"
                    />
                    {dragTooltip?.entityId === track.id && dragTooltip.type === 'volume' && (
                      <div
                        className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                        style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                      >
                        {dragTooltip.value <= 0 ? '-∞' : volumeToDb(dragTooltip.value).toFixed(1)}
                      </div>
                    )}
                    {editTooltip?.entityId === track.id && editTooltip.type === 'volume' && (
                      <input
                        type="text"
                        value={editTooltip.text}
                        onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => commitEditTooltip({
                          onVolumeChange: (next) => handleVolumeChange(track.id, next),
                          onPanChange: (next) => handlePanChange(track.id, next),
                        })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitEditTooltip({
                              onVolumeChange: (next) => handleVolumeChange(track.id, next),
                              onPanChange: (next) => handlePanChange(track.id, next),
                            });
                          } else if (e.key === 'Escape') {
                            setEditTooltip(null);
                          }
                        }}
                        className="fixed w-16 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                        style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                        autoFocus
                      />
                    )}
                    </div>

                    <div
                      className="relative w-8 h-8 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                    <div className="absolute inset-0 overflow-hidden">
                      <div className="absolute inset-0 pan-ring pointer-events-none" />
                      <div className="absolute left-1/2 top-1/2 w-6 h-6 rounded-full bg-gray-700 border border-gray-600 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                      <div
                        className="absolute left-1/2 top-1/2 w-[3px] h-3 bg-gray-200 rounded-full origin-bottom pointer-events-none"
                        style={{ transform: `translate(-50%, -100%) rotate(${(trackPanValue / 100) * 135}deg)` }}
                      />
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      step="1"
                      value={trackPanValue}
                      readOnly
                      onMouseDown={(e) => {
                        if (e.detail > 1) return;
                        beginDrag(
                          e,
                          track.id,
                          'pan',
                          trackPanValue,
                          (next) => handlePanChange(track.id, next)
                        );
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handlePanDoubleClick(track.id, trackPanValue, e);
                      }}
                      className="absolute top-0 left-0 right-0 h-4 pan-knob opacity-0 cursor-pointer z-10 pointer-events-auto appearance-none touch-none"
                      aria-label="Pan"
                    />
                    {dragTooltip?.entityId === track.id && dragTooltip.type === 'pan' && (
                      <div
                        className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center z-50"
                        style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translate(-50%, -100%)' }}
                      >
                        {Math.round(dragTooltip.value)}
                      </div>
                    )}
                    {editTooltip?.entityId === track.id && editTooltip.type === 'pan' && (
                      <input
                        type="text"
                        value={editTooltip.text}
                        onChange={(e) => setEditTooltip({ ...editTooltip, text: e.target.value })}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => commitEditTooltip({
                          onVolumeChange: (next) => handleVolumeChange(track.id, next),
                          onPanChange: (next) => handlePanChange(track.id, next),
                        })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitEditTooltip({
                              onVolumeChange: (next) => handleVolumeChange(track.id, next),
                              onPanChange: (next) => handlePanChange(track.id, next),
                            });
                          } else if (e.key === 'Escape') {
                            setEditTooltip(null);
                          }
                        }}
                        className="fixed w-12 px-1 py-0.5 text-xs rounded bg-gray-900 text-gray-200 border border-gray-600 text-center focus:outline-none z-50"
                        style={{ left: editTooltip.x, top: editTooltip.y, transform: 'translate(-50%, -100%)' }}
                        autoFocus
                      />
                    )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {contextMenu && (
        <div
          className="fixed z-[120] bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {contextMenu.type === 'track' && contextMenu.track ? (
            <>
              {!metadataLocked ? (
                <>
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      setEditingName(contextMenu.track.id);
                      setContextMenu(null);
                    }}
                  >
                    Rename track
                  </button>
                  {onEditTrackArtists && !hasSoloArtistAncestor(contextMenu.row) ? (
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        onEditTrackArtists(contextMenu.track);
                        setContextMenu(null);
                      }}
                    >
                      Edit track artist
                    </button>
                  ) : null}

                  {hasDirectParentTypeLock(contextMenu.row) ? (
                    <div className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-500 whitespace-nowrap select-none">
                      Change type (inherited)
                    </div>
                  ) : (
                    <div className="relative">
                      <div
                        className={`${menuItemClass} select-none cursor-pointer`}
                        onMouseEnter={openTypeMenu}
                        onMouseLeave={() => setIsTypeTriggerHover(false)}
                        style={{
                          backgroundColor: (isTypeTriggerHover || isTypeMenuHover)
                            ? '#374151'
                            : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>Change type</span>
                          <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                        </div>
                      </div>
                    </div>
                  )}
                  {!hasPartTrackAncestor(contextMenu.row) ? (
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        toggleTrackPart(contextMenu.row, contextMenu.track);
                        setContextMenu(null);
                      }}
                    >
                      {Boolean(contextMenu.row?.part || contextMenu.track.part) ? '✓ ' : ''}Is part
                    </button>
                  ) : null}
                </>
              ) : null}

	              {advancedMixEnabled ? (
	                <>
	                  <div className="my-0.5 border-t border-gray-700" />
	                  <button
	                    className={menuItemClass}
	                    onClick={() => {
	                      onToggleAdvancedTrackFocus(contextMenu.track.id, ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED);
	                      setContextMenu(null);
	                    }}
	                  >
	                    {getTrackFocusMode(contextMenu.track.id) === ADVANCED_MIX_FOCUS_MODES.HIGHLIGHTED ? '✓ ' : ''}Highlighted in mix
	                  </button>
	                </>
              ) : null}

	              {!metadataLocked && isChoirRole(contextMenu.track.role) && (
                <div className="relative">
                  <div
                    className={`${menuItemClass} select-none cursor-pointer`}
                    onMouseEnter={openAutoPanMenu}
                    onMouseLeave={() => setIsAutoPanTriggerHover(false)}
                    style={{
                      backgroundColor: (isAutoPanTriggerHover || isAutoPanMenuHover) ? '#374151' : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>Auto-pan choir</span>
                      <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                    </div>
                  </div>
                </div>
              )}

              {!structureMenuLocked ? (
                <>
                  <button
                    className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-red-300 hover:bg-gray-700 whitespace-nowrap"
                    onClick={() => {
                      onDeleteTrack?.(contextMenu.track.id);
                      setContextMenu(null);
                    }}
                  >
                    Delete track
                  </button>

                  <div className="my-0.5 border-t border-gray-700" />

                  <button
                    className={menuItemClass}
                    onClick={() => {
                      onAddTrack?.({
                        parentId: contextMenu.row?.parentId || null,
                        afterNodeId: contextMenu.row?.nodeId || null,
                      });
                      setContextMenu(null);
                    }}
                  >
                    Create track
                  </button>
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      onCreateSubtrack?.(contextMenu.track.id);
                      setContextMenu(null);
                    }}
                  >
                    Create subtrack
                  </button>
                </>
              ) : null}
            </>
          ) : null}

          {contextMenu.type === 'group' && contextMenu.group ? (
            <>
              {!metadataLocked ? (
                <>
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      handleRenameGroup(contextMenu.group);
                      setContextMenu(null);
                    }}
                  >
                    Rename group
                  </button>
                  {onEditGroupArtists && !hasSoloArtistAncestor(contextMenu.group) ? (
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        onEditGroupArtists(contextMenu.group);
                        setContextMenu(null);
                      }}
                    >
                      Edit track artist
                    </button>
                  ) : null}
                  {hasDirectParentTypeLock(contextMenu.group) ? (
                    <div className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-gray-500 whitespace-nowrap select-none">
                      Change type (inherited)
                    </div>
                  ) : (
                    <div className="relative">
                      <div
                        className={`${menuItemClass} select-none cursor-pointer`}
                        onMouseEnter={openGroupTypeMenu}
                        onMouseLeave={() => setIsGroupTypeTriggerHover(false)}
                        style={{
                          backgroundColor: (
                            isGroupTypeTriggerHover
                            || isGroupTypeMenuHover
                          )
                            ? '#374151'
                            : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>Change type</span>
                          <ChevronRight size={14} className="text-gray-400 ml-0.5" />
                        </div>
                      </div>
                    </div>
                  )}
                  {!hasPartTrackAncestor(contextMenu.group) ? (
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        toggleGroupPart(contextMenu.group);
                        setContextMenu(null);
                      }}
                    >
                      {Boolean(contextMenu.group.part) ? '✓ ' : ''}Is part
                    </button>
                  ) : null}
                </>
              ) : null}
              {advancedMixGroupEnabled ? (
                <>
                  <div className="my-0.5 border-t border-gray-700" />
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      onToggleAdvancedGroupFocus(contextMenu.group.nodeId);
                      setContextMenu(null);
                    }}
                  >
                    {getGroupFocusState(contextMenu.group.nodeId) === 'all'
                      ? '✓ '
                      : (getGroupFocusState(contextMenu.group.nodeId) === 'partial' ? '- ' : '')}
                    Highlighted in mix
                  </button>
                </>
              ) : null}
              <button
                className={menuItemClass}
                onClick={() => {
                  onToggleGroupCollapse?.(contextMenu.group.nodeId);
                  setContextMenu(null);
                }}
              >
                {contextMenu.group.collapsed ? 'Expand group' : 'Collapse group'}
              </button>
              {!structureMenuLocked ? (
                <>
                  <button
                    className="w-full text-left pl-1 pr-0.5 py-0 text-[16px] text-red-300 hover:bg-gray-700 whitespace-nowrap"
                    onClick={() => {
                      onDeleteGroup?.(contextMenu.group.nodeId);
                      setContextMenu(null);
                    }}
                  >
                    Delete group
                  </button>

                  <div className="my-0.5 border-t border-gray-700" />

                  <button
                    className={menuItemClass}
                    onClick={() => {
                      onAddTrack?.({
                        parentId: contextMenu.group.parentId || null,
                        afterNodeId: contextMenu.group.nodeId,
                      });
                      setContextMenu(null);
                    }}
                  >
                    Create track
                  </button>
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      onAddTrack?.(contextMenu.group.nodeId);
                      setContextMenu(null);
                    }}
                  >
                    Create subtrack
                  </button>
                </>
              ) : null}
            </>
          ) : null}

          {contextMenu.type === 'empty' && !structureMenuLocked ? (
            <>
              <button
                className={menuItemClass}
                onClick={() => {
                  onAddTrack?.();
                  setContextMenu(null);
                }}
              >
                Create a track
              </button>
            </>
          ) : null}
        </div>
      )}

      {contextMenu && contextMenu.type === 'track' && contextMenu.track && typeMenuOpen && !metadataLocked && !hasDirectParentTypeLock(contextMenu.row) && (
        <div
          className="fixed z-[120] bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[120px]"
          style={{ left: typeMenuPos.x, top: typeMenuPos.y }}
          onMouseEnter={() => setIsTypeMenuHover(true)}
          onMouseLeave={() => setIsTypeMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {trackTypeOptions.map((option) => {
            const isCurrent = getRowTypeValue(contextMenu.row, contextMenu.track) === option.value;
            return (
              <button
                key={option.value}
                className={menuItemClass}
                onClick={() => {
                  applyTrackType(contextMenu.row, contextMenu.track, option.value);
                  setContextMenu(null);
                }}
              >
                <span className="inline-block w-4 text-gray-300">{isCurrent ? '✓' : ''}</span>
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {contextMenu && contextMenu.type === 'group' && contextMenu.group && groupTypeMenuOpen && !metadataLocked && !hasDirectParentTypeLock(contextMenu.group) && (
        <div
          className="fixed z-[120] bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[140px]"
          style={{ left: groupTypeMenuPos.x, top: groupTypeMenuPos.y }}
          onMouseEnter={() => setIsGroupTypeMenuHover(true)}
          onMouseLeave={() => setIsGroupTypeMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {trackTypeOptions.map((option) => {
            const isCurrent = getRowTypeValue(contextMenu.group) === option.value;
            return (
              <button
                key={option.value}
                className={menuItemClass}
                onClick={() => {
                  applyGroupType(contextMenu.group, option.value);
                  setContextMenu(null);
                }}
              >
                <span className="inline-block w-4 text-gray-300">{isCurrent ? '✓' : ''}</span>
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {contextMenu && contextMenu.type === 'track' && contextMenu.track && autoPanMenuOpen && !metadataLocked && (
        <div
          className="fixed z-[120] bg-gray-800 border border-gray-700 rounded-md shadow-lg py-0 inline-flex flex-col items-stretch overflow-hidden min-w-[140px]"
          style={{ left: autoPanMenuPos.x, top: autoPanMenuPos.y }}
          onMouseEnter={() => setIsAutoPanMenuHover(true)}
          onMouseLeave={() => setIsAutoPanMenuHover(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className={menuItemClass}
            onClick={() => {
              onToggleAutoPanInverted?.();
              setContextMenu(null);
            }}
          >
            Inverted Auto Pan: {autoPanInverted ? 'On' : 'Off'}
          </button>

          <div className="my-0.5 border-t border-gray-700" />

          <button
            className={menuItemClass}
            onClick={() => {
              onSetAutoPanStrategy?.('off');
              setContextMenu(null);
            }}
          >
            Off
          </button>
          {AUTO_PAN_STRATEGIES.map((option) => (
            <button
              key={option.id}
              className={menuItemClass}
              onClick={() => {
                onSetAutoPanStrategy?.(option.id);
                setContextMenu(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TrackList;
