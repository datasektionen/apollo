import { act, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const localStateDb = vi.hoisted(() => {
  const records = new Map();
  return {
    records,
    load: vi.fn(async (projectId) => records.get(projectId) || null),
    save: vi.fn(async (projectId, updates = {}) => {
      const next = {
        ...(records.get(projectId) || {}),
        ...updates,
        projectId,
      };
      records.set(projectId, next);
      return next;
    }),
  };
});

vi.mock('../../lib/db', () => ({
  loadLocalProjectState: localStateDb.load,
  saveLocalProjectState: localStateDb.save,
}));

vi.mock('../../utils/errorReporter', () => ({
  reportUserError: vi.fn(),
}));

import useLocalProjectViewState from '../useLocalProjectViewState';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const hookResult = { current: null };

function HookHarness({ projectId }) {
  const project = useMemo(() => ({ projectId, trackTree: [] }), [projectId]);
  hookResult.current = useLocalProjectViewState(project);
  return null;
}

async function mountHook(projectId) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<HookHarness projectId={projectId} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    async rerender(nextProjectId) {
      await act(async () => {
        root.render(<HookHarness projectId={nextProjectId} />);
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useLocalProjectViewState lyrics visibility', () => {
  let view;

  beforeEach(() => {
    localStateDb.records.clear();
    localStateDb.load.mockClear();
    localStateDb.save.mockClear();
    hookResult.current = null;
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('defaults the Lyrics track to hidden when a project has no saved local state', async () => {
    view = await mountHook('project-1');

    expect(hookResult.current.lyricsLaneVisible).toBe(false);
    expect(localStateDb.records.get('project-1')).toMatchObject({
      projectId: 'project-1',
      lyricsLaneVisible: false,
    });
  });

  it('persists visibility changes against the current project ID', async () => {
    view = await mountHook('project-1');

    await act(async () => {
      hookResult.current.setLyricsLaneVisible(true);
      await Promise.resolve();
    });

    expect(localStateDb.save).toHaveBeenCalledWith('project-1', expect.objectContaining({
      lyricsLaneVisible: true,
    }));
    expect(localStateDb.records.get('project-1').lyricsLaneVisible).toBe(true);
  });

  it('keeps visibility independent when switching between projects', async () => {
    view = await mountHook('project-1');
    await act(async () => {
      hookResult.current.setLyricsLaneVisible(true);
      await Promise.resolve();
    });

    await view.rerender('project-2');
    expect(hookResult.current.lyricsLaneVisible).toBe(false);
    await act(async () => {
      hookResult.current.setLyricsLaneVisible(true);
      await Promise.resolve();
    });

    await view.rerender('project-1');
    expect(hookResult.current.lyricsLaneVisible).toBe(true);
    expect(localStateDb.records.get('project-1').lyricsLaneVisible).toBe(true);
    expect(localStateDb.records.get('project-2').lyricsLaneVisible).toBe(true);
  });
});
