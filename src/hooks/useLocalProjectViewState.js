import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadLocalProjectState, saveLocalProjectState } from '../lib/db';
import { reportUserError } from '../utils/errorReporter';

const DEFAULT_LOCAL_LOOP = { enabled: false, startMs: 0, endMs: 0 };

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeLocalLoop(loop = {}, fallback = DEFAULT_LOCAL_LOOP) {
  const startMs = Math.max(0, toFiniteNumber(loop?.startMs, fallback.startMs));
  const endMs = Math.max(0, toFiniteNumber(loop?.endMs, fallback.endMs));
  return {
    enabled: loop?.enabled === true,
    startMs: Math.min(startMs, endMs),
    endMs: Math.max(startMs, endMs),
  };
}

function collapsedGroupIdsFromProject(project) {
  return (project?.trackTree || [])
    .filter((node) => node?.kind === 'group' && node.collapsed === true && node.id)
    .map((node) => node.id);
}

function normalizeCollapsedGroupIds(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)));
}

function buildDefaultLocalProjectState(project, options = {}) {
  const defaultCollapsedGroupIds = options.defaultCollapsedGroupIds;
  return {
    loop: normalizeLocalLoop(project?.loop || DEFAULT_LOCAL_LOOP),
    collapsedGroupIds: Array.isArray(defaultCollapsedGroupIds)
      ? normalizeCollapsedGroupIds(defaultCollapsedGroupIds)
      : collapsedGroupIdsFromProject(project),
    lyricsLaneVisible: false,
  };
}

function normalizeLocalProjectState(state, project, options = {}) {
  const fallback = buildDefaultLocalProjectState(project, options);
  return {
    loop: normalizeLocalLoop(state?.loop || fallback.loop, fallback.loop),
    collapsedGroupIds: normalizeCollapsedGroupIds(state?.collapsedGroupIds ?? fallback.collapsedGroupIds),
    lyricsLaneVisible: state?.lyricsLaneVisible === true,
  };
}

export function applyLocalProjectViewState(project, localState, options = {}) {
  if (!project) return project;
  const normalized = normalizeLocalProjectState(localState, project, options);
  const collapsedGroupIds = new Set(normalized.collapsedGroupIds);
  return {
    ...project,
    loop: normalized.loop,
    trackTree: (project.trackTree || []).map((node) => (
      node?.kind === 'group'
        ? { ...node, collapsed: collapsedGroupIds.has(node.id) }
        : node
    )),
  };
}

export default function useLocalProjectViewState(project, options = {}) {
  const projectId = project?.projectId || null;
  const persist = options.persist !== false;
  const resetKey = options.resetKey ?? null;
  const defaultCollapsedGroupIdsKey = JSON.stringify(normalizeCollapsedGroupIds(options.defaultCollapsedGroupIds));
  const [stateByProjectId, setStateByProjectId] = useState({});

  useEffect(() => {
    if (!projectId) return undefined;
    const fallback = buildDefaultLocalProjectState(project, options);
    if (!persist) {
      setStateByProjectId((previous) => ({
        ...previous,
        [projectId]: fallback,
      }));
      return undefined;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const saved = await loadLocalProjectState(projectId);
        if (cancelled) return;
        const normalized = normalizeLocalProjectState(saved || fallback, project, options);
        setStateByProjectId((previous) => ({
          ...previous,
          [projectId]: normalized,
        }));
        if (!saved) {
          await saveLocalProjectState(projectId, normalized);
        }
      } catch (error) {
        if (cancelled) return;
        reportUserError(
          'Failed to load local project settings. Defaults will be used.',
          error,
          { onceKey: `local-project-state:load:${projectId}` }
        );
        setStateByProjectId((previous) => ({
          ...previous,
          [projectId]: fallback,
        }));
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [defaultCollapsedGroupIdsKey, persist, projectId, resetKey]);

  const localState = useMemo(() => {
    if (!projectId) return null;
    return stateByProjectId[projectId] || buildDefaultLocalProjectState(project, options);
  }, [defaultCollapsedGroupIdsKey, project, projectId, stateByProjectId]);

  const updateLocalState = useCallback((updater) => {
    if (!projectId) return;
    setStateByProjectId((previous) => {
      const current = normalizeLocalProjectState(
        previous[projectId] || buildDefaultLocalProjectState(project, options),
        project,
        options
      );
      const nextRaw = typeof updater === 'function' ? updater(current) : updater;
      const next = normalizeLocalProjectState(nextRaw, project, options);
      if (persist) {
        saveLocalProjectState(projectId, next).catch((error) => {
          reportUserError(
            'Failed to save local project settings.',
            error,
            { onceKey: `local-project-state:save:${projectId}` }
          );
        });
      }
      return {
        ...previous,
        [projectId]: next,
      };
    });
  }, [defaultCollapsedGroupIdsKey, persist, project, projectId]);

  const setLocalLoop = useCallback((updater) => {
    updateLocalState((current) => ({
      ...current,
      loop: typeof updater === 'function'
        ? normalizeLocalLoop(updater(current.loop), current.loop)
        : normalizeLocalLoop(updater, current.loop),
    }));
  }, [updateLocalState]);

  const setLyricsLaneVisible = useCallback((updater) => {
    updateLocalState((current) => ({
      ...current,
      lyricsLaneVisible: typeof updater === 'function'
        ? updater(current.lyricsLaneVisible) === true
        : updater === true,
    }));
  }, [updateLocalState]);

  const setGroupCollapsed = useCallback((groupNodeId, collapsed) => {
    const id = String(groupNodeId || '').trim();
    if (!id) return;
    updateLocalState((current) => {
      const ids = new Set(current.collapsedGroupIds || []);
      if (collapsed) {
        ids.add(id);
      } else {
        ids.delete(id);
      }
      return {
        ...current,
        collapsedGroupIds: Array.from(ids),
      };
    });
  }, [updateLocalState]);

  const setGroupsCollapsed = useCallback((groupNodeIds, collapsed) => {
    const idsToUpdate = normalizeCollapsedGroupIds(groupNodeIds);
    if (!idsToUpdate.length) return;
    updateLocalState((current) => {
      const ids = new Set(current.collapsedGroupIds || []);
      idsToUpdate.forEach((id) => {
        if (collapsed) {
          ids.add(id);
        } else {
          ids.delete(id);
        }
      });
      return {
        ...current,
        collapsedGroupIds: Array.from(ids),
      };
    });
  }, [updateLocalState]);

  const localProject = useMemo(
    () => applyLocalProjectViewState(project, localState, options),
    [defaultCollapsedGroupIdsKey, localState, project]
  );

  return {
    localProject,
    localLoop: localState?.loop || DEFAULT_LOCAL_LOOP,
    lyricsLaneVisible: localState?.lyricsLaneVisible === true,
    setLocalLoop,
    setLyricsLaneVisible,
    setGroupCollapsed,
    setGroupsCollapsed,
  };
}
