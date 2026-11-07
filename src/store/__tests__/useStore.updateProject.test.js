import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/db', () => ({
  saveProject: vi.fn(async () => {}),
  saveUndoAction: vi.fn(async () => {}),
  loadUndoHistory: vi.fn(async () => []),
}));

import { saveProject, saveUndoAction } from '../../lib/db';
import useStore from '../useStore';

const initialState = useStore.getState();

function makeProject() {
  return {
    projectId: 'project-1',
    name: 'Original',
    tracks: [
      { id: 'track-1', clips: [{ id: 'clip-1', gain: 1 }] },
      { id: 'track-2', clips: [] },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useStore.setState({
    ...initialState,
    project: makeProject(),
    currentProjectId: 'project-1',
    selectedTrackId: 'track-1',
    selectedTrackByProjectId: { 'project-1': 'track-1' },
  }, true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  useStore.setState(initialState, true);
});

describe('updateProject identity no-ops', () => {
  it.each(['updater', 'snapshot'])('preserves redo and all store state for the same %s identity', async (kind) => {
    useStore.getState().updateProject((project) => ({ ...project, name: 'Edited' }));
    useStore.getState().undo();
    await useStore.getState().forceSave();
    useStore.setState({ autosaveTimeout: null });
    vi.clearAllMocks();

    const before = useStore.getState();
    const updater = vi.fn((project) => project);
    const stringify = vi.spyOn(JSON, 'stringify');
    const parse = vi.spyOn(JSON, 'parse');
    const listener = vi.fn();
    const unsubscribe = useStore.subscribe(listener);
    try {
      before.updateProject(kind === 'updater' ? updater : before.project);
      expect(useStore.getState()).toBe(before);
      expect(before.redoStack).toHaveLength(1);
      expect(before.isDirty).toBe(false);
      expect(updater).toHaveBeenCalledTimes(kind === 'updater' ? 1 : 0);
      expect(stringify).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(saveProject).not.toHaveBeenCalled();
      expect(saveUndoAction).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('does not reset a pending autosave or clear existing dirty state', async () => {
    const { updateProject } = useStore.getState();
    updateProject((project) => ({ ...project, name: 'Edited' }));
    await vi.advanceTimersByTimeAsync(1000);
    const before = useStore.getState();

    updateProject((project) => project);

    expect(useStore.getState()).toBe(before);
    expect(before.isDirty).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith(before.project);
    expect(saveUndoAction).toHaveBeenCalledTimes(1);
  });
});

describe('updateProject skip options', () => {
  it.each([
    { skipAutosave: false, skipDirty: false },
    { skipAutosave: true, skipDirty: false },
    { skipAutosave: false, skipDirty: true },
    { skipAutosave: true, skipDirty: true },
  ])('skips cloning and preserves history with %j', async (options) => {
    const { updateProject, undo } = useStore.getState();
    updateProject((project) => ({ ...project, name: 'Edited' }));
    undo();
    await useStore.getState().forceSave();
    useStore.setState({ autosaveTimeout: null });
    vi.clearAllMocks();

    const before = useStore.getState();
    const next = { ...before.project, name: 'Remote snapshot' };
    const stringify = vi.spyOn(JSON, 'stringify');
    const parse = vi.spyOn(JSON, 'parse');

    updateProject(next, 'Apply remote snapshot', { skipUndo: true, ...options });

    const after = useStore.getState();
    expect(stringify).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(after.project).toBe(next);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.undoIndex).toBe(before.undoIndex);
    expect(after.redoStack).toBe(before.redoStack);
    expect(after.isDirty).toBe(!options.skipDirty);
    expect(vi.getTimerCount()).toBe(options.skipAutosave ? 0 : 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(saveProject).toHaveBeenCalledTimes(!options.skipAutosave && !options.skipDirty ? 1 : 0);
  });

  it('preserves already-dirty state and pending autosave when both save flags are skipped', () => {
    const { updateProject } = useStore.getState();
    updateProject((project) => ({ ...project, name: 'Edited' }));
    const before = useStore.getState();

    updateProject((project) => ({ ...project, name: 'Local preview' }), 'Preview', {
      skipUndo: true,
      skipAutosave: true,
      skipDirty: true,
    });

    const after = useStore.getState();
    expect(after.isDirty).toBe(true);
    expect(after.autosaveTimeout).toBe(before.autosaveTimeout);
    expect(after.undoStack).toBe(before.undoStack);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('still records undo when only autosave and dirty tracking are skipped', () => {
    useStore.getState().updateProject((project) => ({ ...project, name: 'Local edit' }), 'Local edit', {
      skipAutosave: true,
      skipDirty: true,
    });

    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().isDirty).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('updateProject history snapshots', () => {
  it('evaluates the updater once before taking exactly one detached history snapshot', async () => {
    const before = useStore.getState().project;
    const updater = vi.fn((project) => ({
      ...project,
      tracks: project.tracks.map((track) => track.id === 'track-1' ? {
        ...track,
        clips: track.clips.map((clip) => ({ ...clip, gain: 0.5 })),
      } : track),
    }));
    const stringify = vi.spyOn(JSON, 'stringify');
    const parse = vi.spyOn(JSON, 'parse');

    useStore.getState().updateProject(updater, 'Change gain');

    const after = useStore.getState();
    expect(updater).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledWith(before);
    expect(stringify).toHaveBeenCalledTimes(1);
    expect(stringify).toHaveBeenCalledWith(before);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(updater.mock.invocationCallOrder[0]).toBeLessThan(stringify.mock.invocationCallOrder[0]);
    expect(after.project.tracks[1]).toBe(before.tracks[1]);
    expect(after.undoStack).toEqual([{ description: 'Change gain', state: before }]);
    expect(after.undoStack[0].state).not.toBe(before);
    expect(after.undoStack[0].state.tracks[1]).not.toBe(before.tracks[1]);
    expect(after.undoIndex).toBe(1);
    expect(after.redoStack).toEqual([]);
    expect(after.isDirty).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith(after.project);
    expect(saveUndoAction).toHaveBeenCalledTimes(1);
    expect(saveUndoAction).toHaveBeenCalledWith('project-1', after.undoStack[0], 0);
  });

  it('treats a new equal-valued object as an edit rather than deep-comparing projects', () => {
    const before = useStore.getState().project;
    const next = { ...before };

    useStore.getState().updateProject(next);

    expect(useStore.getState().project).toBe(next);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().isDirty).toBe(true);
  });

  it('round-trips nested immutable edits through undo and redo without corrupting snapshots', () => {
    const original = makeProject();
    const { updateProject, undo, redo } = useStore.getState();
    updateProject((project) => ({ ...project, name: 'Renamed' }), 'Rename');
    const renamed = useStore.getState().project;
    updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({ ...clip, gain: 0.25 })),
      })),
    }), 'Gain');
    const edited = useStore.getState().project;

    undo();
    expect(useStore.getState().project).toEqual(renamed);
    undo();
    expect(useStore.getState().project).toEqual(original);
    redo();
    expect(useStore.getState().project).toEqual(renamed);
    redo();
    expect(useStore.getState().project).toEqual(edited);
    expect(useStore.getState().undoStack.map((action) => action.state)).toEqual([original, renamed]);
    expect(useStore.getState().undoIndex).toBe(2);
    expect(useStore.getState().redoStack).toEqual([]);
  });

  it('clears redo and replaces only the undone branch for a real edit', () => {
    const original = makeProject();
    const { updateProject, undo, redo } = useStore.getState();
    updateProject((project) => ({ ...project, name: 'First' }), 'First');
    updateProject((project) => ({ ...project, name: 'Discarded' }), 'Discarded');
    undo();
    updateProject((project) => ({ ...project, name: 'Replacement' }), 'Replacement');

    expect(useStore.getState().undoStack.map((action) => action.description)).toEqual(['First', 'Replacement']);
    expect(useStore.getState().redoStack).toEqual([]);
    undo();
    expect(useStore.getState().project.name).toBe('First');
    undo();
    expect(useStore.getState().project).toEqual(original);
    redo();
    redo();
    expect(useStore.getState().project.name).toBe('Replacement');
  });

  it('preserves track selection reconciliation for replacement snapshots', () => {
    const project = useStore.getState().project;
    useStore.getState().updateProject({ ...project, tracks: [project.tracks[1]] }, 'Remove track');
    expect(useStore.getState().selectedTrackId).toBe('track-2');
    expect(useStore.getState().selectedTrackByProjectId).toEqual({ 'project-1': 'track-2' });
    useStore.getState().updateProject({ ...project, tracks: [] }, 'Remove all tracks');
    expect(useStore.getState().selectedTrackId).toBeNull();
    expect(useStore.getState().selectedTrackByProjectId).toEqual({ 'project-1': null });
  });
});
