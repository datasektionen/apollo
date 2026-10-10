import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const clientHandlers = { current: null };
const submitOp = vi.fn(() => true);
const db = {
  pending: null,
};

vi.mock('../../lib/realtimeSyncClient', () => ({
  createRealtimeSyncClient: vi.fn((options) => {
    clientHandlers.current = options;
    return {
      get connected() {
        return true;
      },
      submitOp,
      acquireTrackLock: vi.fn(() => true),
      heartbeatTrackLock: vi.fn(() => true),
      releaseTrackLock: vi.fn(() => true),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../../lib/db', () => ({
  clearPendingSyncOp: vi.fn(async () => {
    db.pending = null;
  }),
  getMediaBlob: vi.fn(async () => {
    throw new Error('Media blob x not found');
  }),
  getPendingSyncOp: vi.fn(async () => db.pending),
  loadRemoteProjectMeta: vi.fn(async () => null),
  saveRemoteProjectMeta: vi.fn(async () => {}),
  upsertPendingSyncOp: vi.fn(async (projectId, payload) => {
    db.pending = { projectId, payload };
  }),
}));

vi.mock('../../lib/serverApi', () => ({
  bootstrapServerProject: vi.fn(async () => null),
  resolveMedia: vi.fn(async () => ({ found: [] })),
}));

vi.mock('../../lib/mediaUpload', () => ({
  registerAndUploadMediaBlob: vi.fn(async () => ({ mediaId: 'x' })),
}));

vi.mock('../../lib/mediaEncoding', () => ({
  localCacheBlobToWavBlob: vi.fn(async (blob) => blob),
}));

vi.mock('../../utils/errorReporter', () => ({
  reportUserError: vi.fn(),
}));

import * as dbModule from '../../lib/db';
import { reportUserError } from '../../utils/errorReporter';
import useRealtimeProjectSync, { isWriteRejectionMessage } from '../useRealtimeProjectSync';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const SESSION = { token: 't', user: { id: 'user-1' } };

function makeProject(name = 'Original') {
  return {
    projectId: 'local-1',
    projectName: 'Test',
    tracks: [{ id: 'track-1', name, clips: [] }],
    trackTree: [{ id: 'node-1', kind: 'track', trackId: 'track-1', order: 0 }],
  };
}

// Minimal host component so the hook's `project` and `updateProject` behave
// like the Zustand-backed Editor: updateProject replaces the project state.
const harness = { setProject: null, updates: [] };
function Harness({ onState }) {
  const [project, setProject] = useState(makeProject());
  harness.setProject = setProject;
  const updateProject = React.useCallback((updater, label, options) => {
    setProject((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      harness.updates.push({ label, options, project: next });
      return next;
    });
  }, []);
  const state = useRealtimeProjectSync({
    enabled: true,
    project,
    remoteSession: { session: SESSION, serverProjectId: 'server-1', latestSeq: 0 },
    updateProject,
  });
  useEffect(() => {
    onState({ ...state, project });
  }, [state, project, onState]);
  return null;
}

let root = null;
let container = null;
let latest = null;

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  vi.useRealTimers();
  clientHandlers.current = null;
  submitOp.mockClear();
  db.pending = null;
  harness.updates = [];
  latest = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness onState={(state) => { latest = state; }} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('isWriteRejectionMessage', () => {
  it('matches structured write rejections but not lock errors', () => {
    expect(isWriteRejectionMessage({ code: 'WRITE_REJECTED', clientOpId: 'op-1', message: 'nope' })).toBe(true);
    expect(isWriteRejectionMessage({ code: 'NO_WRITE_PERMISSION', clientOpId: 'op-1' })).toBe(true);
    expect(isWriteRejectionMessage({ code: 'NO_WRITE_PERMISSION', trackId: 'track-1' })).toBe(false);
    expect(isWriteRejectionMessage({ code: 'TRACK_LOCKED', trackId: 'track-1' })).toBe(false);
    expect(isWriteRejectionMessage({ message: 'permission denied' })).toBe(false);
  });
});

describe('useRealtimeProjectSync write rejection handling', () => {
  async function joinAndEdit() {
    await flush();
    expect(clientHandlers.current).toBeTruthy();

    const joinedSnapshot = makeProject('Server state');
    await act(async () => {
      await clientHandlers.current.onConnected();
      await clientHandlers.current.onJoined({ latestSeq: 5, snapshot: joinedSnapshot });
    });
    await flush();
    expect(latest.project.tracks[0].name).toBe('Server state');

    // Local optimistic edit → debounced submit.
    await act(async () => {
      harness.setProject(makeProject('Local edit'));
    });
    await flush(200);
    expect(submitOp).toHaveBeenCalledTimes(1);
    const [op, clientOpId] = submitOp.mock.calls[0];
    expect(op.type).toBe('project.replace');
    expect(op.project.tracks[0].name).toBe('Local edit');
    expect(db.pending?.payload?.clientOpId).toBe(clientOpId);
    return { clientOpId, joinedSnapshot };
  }

  it('clears the pending op, reverts to the last acked snapshot and reports the message', async () => {
    const { clientOpId, joinedSnapshot } = await joinAndEdit();

    await act(async () => {
      clientHandlers.current.onError({
        code: 'WRITE_REJECTED',
        message: 'You can only edit tracks that you are allowed to edit',
        retryable: false,
        projectId: 'server-1',
        clientOpId,
      });
    });
    await flush(50);

    expect(dbModule.clearPendingSyncOp).toHaveBeenCalledWith('local-1');
    expect(db.pending).toBeNull();
    expect(latest.project.tracks[0].name).toBe('Server state');
    expect(latest.project).toEqual(joinedSnapshot);
    expect(reportUserError).toHaveBeenCalledWith('You can only edit tracks that you are allowed to edit');
    expect(latest.syncError).toBe('You can only edit tracks that you are allowed to edit');

    // The revert itself must not be re-sent as a new op.
    await flush(200);
    expect(submitOp).toHaveBeenCalledTimes(1);
  });

  it('after an ack, a later rejection reverts to the acked state (not the join snapshot)', async () => {
    const { clientOpId } = await joinAndEdit();

    await act(async () => {
      await clientHandlers.current.onAck({ serverSeq: 6, clientOpId });
    });
    await flush();
    expect(db.pending).toBeNull();

    await act(async () => {
      harness.setProject(makeProject('Second edit'));
    });
    await flush(200);
    expect(submitOp).toHaveBeenCalledTimes(2);
    const secondClientOpId = submitOp.mock.calls[1][1];

    await act(async () => {
      clientHandlers.current.onError({
        code: 'NO_WRITE_PERMISSION',
        message: 'You do not have write access to this project',
        clientOpId: secondClientOpId,
      });
    });
    await flush(50);
    expect(latest.project.tracks[0].name).toBe('Local edit');
  });

  it('merges trackAccessStamps from the ack into the local project without resending', async () => {
    const { clientOpId } = await joinAndEdit();

    await act(async () => {
      await clientHandlers.current.onAck({
        serverSeq: 6,
        clientOpId,
        trackAccessStamps: {
          'track-1': { createdByUserId: 'user-1', accessScopeType: 'group_name', accessScopeValue: 'choir' },
        },
      });
    });
    await flush(200);
    expect(latest.project.tracks[0]).toMatchObject({
      name: 'Local edit',
      createdByUserId: 'user-1',
      accessScopeType: 'group_name',
      accessScopeValue: 'choir',
    });
    expect(submitOp).toHaveBeenCalledTimes(1);
  });

  it('records lock errors per track and ignores them for revert purposes', async () => {
    const { clientOpId } = await joinAndEdit();

    await act(async () => {
      clientHandlers.current.onError({
        code: 'NO_TRACK_WRITE_PERMISSION',
        message: 'You cannot record to this track',
        projectId: 'server-1',
        trackId: 'track-1',
      });
    });
    await flush(50);
    expect(latest.lockErrorByTrackId['track-1']).toMatchObject({
      code: 'NO_TRACK_WRITE_PERMISSION',
      message: 'You cannot record to this track',
    });
    expect(latest.lockErrorByTrackId['track-1'].receivedAt).toBeGreaterThan(0);
    // Local edit is still in place; the pending op untouched.
    expect(latest.project.tracks[0].name).toBe('Local edit');
    expect(db.pending?.payload?.clientOpId).toBe(clientOpId);
  });
});
