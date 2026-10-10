import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRealtimeSyncClient } from '../lib/realtimeSyncClient';
import {
  clearPendingSyncOp,
  getMediaBlob,
  getPendingSyncOp,
  loadRemoteProjectMeta,
  saveRemoteProjectMeta,
  upsertPendingSyncOp,
} from '../lib/db';
import { createId } from '../utils/id';
import { bootstrapServerProject, resolveMedia } from '../lib/serverApi';
import { registerAndUploadMediaBlob } from '../lib/mediaUpload';
import { localCacheBlobToWavBlob } from '../lib/mediaEncoding';
import { reportUserError } from '../utils/errorReporter';
import { applyTrackAccessStamps, WRITE_REJECTED_CODE } from '../../shared/accessRules.js';

// Server error codes (server/src/index.js) that mean "this write was refused
// by the access rules" as opposed to transient failures.
export const WRITE_REJECTION_CODES = new Set([WRITE_REJECTED_CODE, 'NO_WRITE_PERMISSION']);

export function isWriteRejectionMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!WRITE_REJECTION_CODES.has(String(message.code || ''))) return false;
  // Lock errors share NO_WRITE_PERMISSION but carry a trackId and no clientOpId.
  return Boolean(message.clientOpId);
}

function collectBlobIds(project) {
  const ids = new Set();
  (project?.tracks || []).forEach((track) => {
    (track.clips || []).forEach((clip) => {
      if (clip?.blobId) ids.add(clip.blobId);
    });
  });
  return Array.from(ids);
}

function remapProjectBlobIds(project, idMap) {
  if (!project || typeof project !== 'object' || !idMap || idMap.size === 0) {
    return project;
  }

  let changed = false;
  const nextTracks = (project.tracks || []).map((track) => {
    let trackChanged = false;
    const nextClips = (track.clips || []).map((clip) => {
      const mapped = idMap.get(clip?.blobId);
      if (!mapped || mapped === clip?.blobId) return clip;
      trackChanged = true;
      changed = true;
      return {
        ...clip,
        blobId: mapped,
      };
    });
    if (!trackChanged) return track;
    return {
      ...track,
      clips: nextClips,
    };
  });

  if (!changed) return project;
  return {
    ...project,
    tracks: nextTracks,
  };
}

function isMissingMediaBlobError(error) {
  const message = String(error?.message || '');
  return /^Media blob .+ not found$/.test(message);
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nearlyEqual(a, b, epsilon = 1e-6) {
  return Math.abs(toNumber(a) - toNumber(b)) <= epsilon;
}

function collectTrackById(project) {
  const map = new Map();
  (project?.tracks || []).forEach((track) => {
    if (track?.id) {
      map.set(track.id, track);
    }
  });
  return map;
}

function collectGroupNodeById(project) {
  const map = new Map();
  (project?.trackTree || []).forEach((node) => {
    if (node?.kind === 'group' && node?.id) {
      map.set(node.id, node);
    }
  });
  return map;
}

function collectClipStateById(project) {
  const map = new Map();
  (project?.tracks || []).forEach((track) => {
    (track?.clips || []).forEach((clip) => {
      if (!clip?.id) return;
      map.set(clip.id, {
        trackId: track.id,
        timelineStartMs: toNumber(clip.timelineStartMs, 0),
        cropStartMs: toNumber(clip.cropStartMs, 0),
        cropEndMs: toNumber(clip.cropEndMs, 0),
      });
    });
  });
  return map;
}

function buildRemoteAnimationDiff(previousProject, nextProject) {
  const changedTrackIds = new Set();
  const changedGroupNodeIds = new Set();
  const changedClipIds = new Set();
  const trackValueById = {};
  const groupValueById = {};
  const clipValueById = {};
  const fromMasterVolume = toNumber(previousProject?.masterVolume, 100);
  const toMasterVolume = toNumber(nextProject?.masterVolume, 100);

  const previousTracksById = collectTrackById(previousProject);
  const nextTracksById = collectTrackById(nextProject);
  nextTracksById.forEach((nextTrack, trackId) => {
    const previousTrack = previousTracksById.get(trackId);
    if (!previousTrack) return;
    const fromVolume = toNumber(previousTrack.volume, 100);
    const toVolume = toNumber(nextTrack.volume, 100);
    const fromPan = toNumber(previousTrack.pan, 0);
    const toPan = toNumber(nextTrack.pan, 0);
    if (
      !nearlyEqual(fromVolume, toVolume)
      || !nearlyEqual(fromPan, toPan)
    ) {
      changedTrackIds.add(trackId);
      trackValueById[trackId] = {
        fromVolume,
        toVolume,
        fromPan,
        toPan,
      };
    }
  });

  const previousGroupsById = collectGroupNodeById(previousProject);
  const nextGroupsById = collectGroupNodeById(nextProject);
  nextGroupsById.forEach((nextGroup, nodeId) => {
    const previousGroup = previousGroupsById.get(nodeId);
    if (!previousGroup) return;
    const fromVolume = toNumber(previousGroup.volume, 100);
    const toVolume = toNumber(nextGroup.volume, 100);
    const fromPan = toNumber(previousGroup.pan, 0);
    const toPan = toNumber(nextGroup.pan, 0);
    if (
      !nearlyEqual(fromVolume, toVolume)
      || !nearlyEqual(fromPan, toPan)
    ) {
      changedGroupNodeIds.add(nodeId);
      groupValueById[nodeId] = {
        fromVolume,
        toVolume,
        fromPan,
        toPan,
      };
    }
  });

  const previousClipStateById = collectClipStateById(previousProject);
  const nextClipStateById = collectClipStateById(nextProject);
  nextClipStateById.forEach((nextClipState, clipId) => {
    const previousClipState = previousClipStateById.get(clipId);
    if (!previousClipState) return;
    const fromTimelineStartMs = toNumber(previousClipState.timelineStartMs, 0);
    const toTimelineStartMs = toNumber(nextClipState.timelineStartMs, 0);
    const fromCropStartMs = toNumber(previousClipState.cropStartMs, 0);
    const toCropStartMs = toNumber(nextClipState.cropStartMs, 0);
    const fromCropEndMs = toNumber(previousClipState.cropEndMs, 0);
    const toCropEndMs = toNumber(nextClipState.cropEndMs, 0);
    if (
      previousClipState.trackId !== nextClipState.trackId
      || !nearlyEqual(fromTimelineStartMs, toTimelineStartMs)
      || !nearlyEqual(fromCropStartMs, toCropStartMs)
      || !nearlyEqual(fromCropEndMs, toCropEndMs)
    ) {
      changedClipIds.add(clipId);
      clipValueById[clipId] = {
        fromTrackId: previousClipState.trackId,
        toTrackId: nextClipState.trackId,
        fromTimelineStartMs,
        toTimelineStartMs,
        fromCropStartMs,
        toCropStartMs,
        fromCropEndMs,
        toCropEndMs,
      };
    }
  });

  return {
    changedTrackIds: Array.from(changedTrackIds),
    changedGroupNodeIds: Array.from(changedGroupNodeIds),
    changedClipIds: Array.from(changedClipIds),
    trackValueById,
    groupValueById,
    clipValueById,
    masterVolume: nearlyEqual(fromMasterVolume, toMasterVolume)
      ? null
      : {
        from: fromMasterVolume,
        to: toMasterVolume,
      },
  };
}

export default function useRealtimeProjectSync({
  enabled,
  project,
  remoteSession,
  updateProject,
}) {
  const [connected, setConnected] = useState(false);
  const [latestSeq, setLatestSeq] = useState(0);
  const [syncError, setSyncError] = useState('');
  const [lockByTrackId, setLockByTrackId] = useState({});
  const [lockErrorByTrackId, setLockErrorByTrackId] = useState({});
  const [remoteAnimation, setRemoteAnimation] = useState(null);
  const [joined, setJoined] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const clientRef = useRef(null);
  const projectRef = useRef(project);
  const applyingRemoteRef = useRef(false);
  const lastSyncedSnapshotRef = useRef('');
  const localEditSeqRef = useRef(0);
  const uploadedBlobIdsRef = useRef(new Set());
  const localClientOpIdsRef = useRef(new Set());
  const acknowledgedClientOpIdsRef = useRef(new Set());
  // Project snapshots for ops that have been submitted but not yet acked, keyed
  // by clientOpId, plus the most recent snapshot the server accepted. A rejected
  // op reverts the local project to the latter without a re-bootstrap.
  const inFlightProjectByClientOpIdRef = useRef(new Map());
  const lastAckedSnapshotRef = useRef(null);
  const lastRejectionAlertRef = useRef({ message: '', at: 0 });
  const latestSeqRef = useRef(0);
  const projectId = project?.projectId || null;
  const session = remoteSession?.session || null;
  const serverProjectId = remoteSession?.serverProjectId || projectId;

  const lockHelpers = useMemo(() => ({
    acquire(trackId) {
      return clientRef.current?.acquireTrackLock(trackId) || false;
    },
    heartbeat(trackId) {
      return clientRef.current?.heartbeatTrackLock(trackId) || false;
    },
    release(trackId) {
      return clientRef.current?.releaseTrackLock(trackId) || false;
    },
  }), []);

  const ensureMediaUploaded = useCallback(async (currentProject) => {
    if (!session) return currentProject;

    const blobIds = collectBlobIds(currentProject);
    const unresolvedBlobIds = blobIds.filter((blobId) => !uploadedBlobIdsRef.current.has(blobId));
    if (unresolvedBlobIds.length > 0) {
      const resolution = await resolveMedia(unresolvedBlobIds, session, { projectId: serverProjectId });
      for (const mediaId of resolution?.found || []) {
        uploadedBlobIdsRef.current.add(String(mediaId));
      }
    }

    const canonicalByBlobId = new Map();
    for (const blobId of blobIds) {
      if (uploadedBlobIdsRef.current.has(blobId)) continue;

      let media;
      try {
        media = await getMediaBlob(blobId);
      } catch (error) {
        if (isMissingMediaBlobError(error)) {
          // Preserve forward progress for sync: keep submitting project updates even
          // if some historical media IDs are unavailable in local IndexedDB.
          continue;
        }
        throw error;
      }
      const uploaded = await registerAndUploadMediaBlob({
        mediaId: blobId,
        blob: await localCacheBlobToWavBlob(media.blob),
        fileName: media.fileName?.replace(/\.apcm$/i, '.wav') || `${blobId}.wav`,
        mimeType: 'audio/wav',
        session,
        projectId: serverProjectId,
      });
      const canonicalMediaId = String(uploaded?.mediaId || blobId);
      if (canonicalMediaId !== blobId) {
        canonicalByBlobId.set(blobId, canonicalMediaId);
        uploadedBlobIdsRef.current.add(canonicalMediaId);
      }

      uploadedBlobIdsRef.current.add(blobId);
    }
    return remapProjectBlobIds(currentProject, canonicalByBlobId);
  }, [serverProjectId, session]);

  useEffect(() => {
    latestSeqRef.current = latestSeq;
  }, [latestSeq]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    if (!enabled || !session || !projectId || !serverProjectId) return;

    let disposed = false;
    setLockByTrackId({});
    setLockErrorByTrackId({});
    setJoined(false);
    inFlightProjectByClientOpIdRef.current.clear();
    lastAckedSnapshotRef.current = null;

    const rememberServerSeq = async (seq) => {
      const nextSeq = Number(seq || 0);
      if (nextSeq > 0) {
        setLatestSeq(nextSeq);
        await saveRemoteProjectMeta({
          projectId,
          serverProjectId,
          latestSeq: nextSeq,
        });
      }
    };

    const applyRemoteSnapshot = async (snapshot, seq, options = {}) => {
      if (!snapshot || typeof snapshot !== 'object') return;

      // Own/stale snapshots must never rewind a newer local click.
      if (options.own === true || options.localEditSeq != null) {
        const incomingEditSeq = Number(options.localEditSeq || 0);
        if (incomingEditSeq < localEditSeqRef.current) {
          await rememberServerSeq(seq);
          return;
        }
      }

      const shouldAnimate = Boolean(options?.animateFromOtherClient && projectRef.current);
      let animationPayload = null;
      if (shouldAnimate) {
        const diff = buildRemoteAnimationDiff(projectRef.current, snapshot);
        if (
          diff.changedTrackIds.length > 0
          || diff.changedGroupNodeIds.length > 0
          || diff.changedClipIds.length > 0
          || diff.masterVolume
        ) {
          animationPayload = {
            token: createId(),
            durationMs: 800,
            easing: 'easeInOutQuint',
            ...diff,
          };
        }
      }

      if (animationPayload) {
        // Keep animation payload and incoming snapshot in sync to avoid a one-frame jump
        // where the UI renders "to" values before animation state is applied.
        flushSync(() => {
          setRemoteAnimation(animationPayload);
        });
      }

      applyingRemoteRef.current = true;
      collectBlobIds(snapshot).forEach((blobId) => {
        uploadedBlobIdsRef.current.add(blobId);
      });
      const snapshotString = JSON.stringify(snapshot);
      lastSyncedSnapshotRef.current = snapshotString;
      lastAckedSnapshotRef.current = snapshot;
      updateProject(snapshot, 'Apply remote sync update', {
        skipUndo: true,
      });
      await rememberServerSeq(seq);
      setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    };

    // Apply a snapshot that came from the server in response to our own op
    // (stamps, reverts). Unlike applyRemoteSnapshot this must not swallow a
    // local edit that is still waiting in the debounce window.
    const applyLocalCorrection = (nextProject, label) => {
      const current = projectRef.current;
      if (!nextProject || nextProject === current) return;
      const hasUnsentLocalEdits = Boolean(current)
        && JSON.stringify(current) !== lastSyncedSnapshotRef.current;
      if (!hasUnsentLocalEdits) {
        applyingRemoteRef.current = true;
        lastSyncedSnapshotRef.current = JSON.stringify(nextProject);
      }
      updateProject(nextProject, label, { skipUndo: true });
      if (!hasUnsentLocalEdits) {
        setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 0);
      }
    };

    const handleWriteRejected = async (message) => {
      const rejectedClientOpId = String(message?.clientOpId || '');
      const text = message?.message || 'The server rejected this change.';
      localClientOpIdsRef.current.delete(rejectedClientOpId);
      inFlightProjectByClientOpIdRef.current.delete(rejectedClientOpId);

      const pending = await getPendingSyncOp(projectId);
      if (pending?.payload?.clientOpId && String(pending.payload.clientOpId) === rejectedClientOpId) {
        await clearPendingSyncOp(projectId);
      }
      if (disposed) return;

      // Invalidate any in-flight send so it cannot resubmit the rejected state.
      localEditSeqRef.current += 1;

      const base = lastAckedSnapshotRef.current;
      if (base) {
        applyingRemoteRef.current = true;
        lastSyncedSnapshotRef.current = JSON.stringify(base);
        updateProject(base, 'Revert rejected change', { skipUndo: true });
        setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 0);
      } else if (serverProjectId && session) {
        // No acked baseline yet (rejection before join completed): fall back
        // to re-bootstrapping the authoritative snapshot.
        try {
          const payload = await bootstrapServerProject(serverProjectId, session, 0, { purpose: 'daw' });
          if (!disposed && payload?.snapshot) {
            await applyRemoteSnapshot(payload.snapshot, Number(payload.latestSeq || 0), {
              animateFromOtherClient: false,
            });
          }
        } catch {
          // Keep the sync error visible; nothing else to do.
        }
      }

      const now = Date.now();
      const last = lastRejectionAlertRef.current;
      if (last.message !== text || now - last.at > 3000) {
        lastRejectionAlertRef.current = { message: text, at: now };
        reportUserError(text);
      }
    };

    const flushPending = async () => {
      const pending = await getPendingSyncOp(projectId);
      if (!pending?.payload) return;
      const payload = pending.payload;
      const uploadReadyProject = await ensureMediaUploaded(payload.project);
      if (uploadReadyProject !== payload.project) {
        payload.project = uploadReadyProject;
        payload.op = {
          ...(payload.op || {}),
          type: 'project.replace',
          project: uploadReadyProject,
        };
        await upsertPendingSyncOp(projectId, payload);
      }
      if (payload.clientOpId) {
        localClientOpIdsRef.current.add(String(payload.clientOpId));
        inFlightProjectByClientOpIdRef.current.set(String(payload.clientOpId), payload.project);
      }
      clientRef.current?.submitOp(payload.op, payload.clientOpId);
    };

    (async () => {
      const remoteMeta = await loadRemoteProjectMeta(projectId);
      const knownSeq = Number(remoteMeta?.latestSeq || remoteSession?.latestSeq || 0);

      if (disposed) return;
      clientRef.current = createRealtimeSyncClient({
        session,
        projectId: serverProjectId,
        knownSeq,
        onConnected: async () => {
          if (disposed) return;
          setConnected(true);
          setSyncError('');
        },
        onDisconnected: () => {
          if (disposed) return;
          setConnected(false);
        },
        onJoined: async (message) => {
          if (disposed) return;
          setJoined(true);
          const seq = Number(message.latestSeq || 0);
          if (message.snapshot) {
            await applyRemoteSnapshot(message.snapshot, seq, {
              animateFromOtherClient: false,
            });
          } else {
            setLatestSeq(seq);
          }
          if (Array.isArray(message.missingOps) && message.missingOps.length > 0) {
            for (const entry of message.missingOps) {
              if (entry?.op?.type === 'project.replace' && entry.op.project) {
                await applyRemoteSnapshot(entry.op.project, Number(entry.serverSeq || seq), {
                  animateFromOtherClient: true,
                });
              }
            }
          }
          try {
            await flushPending();
          } catch (error) {
            if (!disposed) {
              setSyncError(error?.message || 'Failed to flush pending sync operations');
            }
          }
        },
        onBroadcast: async (message) => {
          if (disposed) return;
          const seq = Number(message.serverSeq || 0);
          if (seq < latestSeqRef.current) return;

          if (message?.op?.type === 'project.replace' && message.op.project) {
            const broadcastClientOpId = message?.clientOpId ? String(message.clientOpId) : '';
            const isOwnClientOp = Boolean(
              broadcastClientOpId
              && (
                localClientOpIdsRef.current.has(broadcastClientOpId)
                || acknowledgedClientOpIdsRef.current.has(broadcastClientOpId)
              )
            );
            if (isOwnClientOp) {
              if (broadcastClientOpId) {
                localClientOpIdsRef.current.delete(broadcastClientOpId);
                acknowledgedClientOpIdsRef.current.delete(broadcastClientOpId);
              }
              await rememberServerSeq(seq);
              return;
            }
            await applyRemoteSnapshot(message.op.project, seq, {
              animateFromOtherClient: true,
            });
          } else {
            setLatestSeq(seq);
          }
        },
        onAck: async (message) => {
          if (disposed) return;
          const seq = Number(message.serverSeq || 0);
          const ackClientOpId = message?.clientOpId ? String(message.clientOpId) : '';
          if (ackClientOpId) {
            localClientOpIdsRef.current.delete(ackClientOpId);
            acknowledgedClientOpIdsRef.current.add(ackClientOpId);
            if (acknowledgedClientOpIdsRef.current.size > 256) {
              const oldest = acknowledgedClientOpIdsRef.current.values().next().value;
              if (oldest) acknowledgedClientOpIdsRef.current.delete(oldest);
            }
          }

          const pending = await getPendingSyncOp(projectId);

          if (pending?.payload?.clientOpId && pending.payload.clientOpId === message.clientOpId) {
            await clearPendingSyncOp(projectId);
          }
          if (disposed) return;

          // The server stamps ownership/scope on new tracks; merge those stamps
          // into the local copy so later edits to our own tracks are accepted.
          const stamps = message?.trackAccessStamps && typeof message.trackAccessStamps === 'object'
            ? message.trackAccessStamps
            : null;
          const ackedProject = ackClientOpId
            ? inFlightProjectByClientOpIdRef.current.get(ackClientOpId) || null
            : null;
          if (ackClientOpId) {
            inFlightProjectByClientOpIdRef.current.delete(ackClientOpId);
          }
          if (ackedProject) {
            lastAckedSnapshotRef.current = stamps ? applyTrackAccessStamps(ackedProject, stamps) : ackedProject;
          } else if (stamps && lastAckedSnapshotRef.current) {
            lastAckedSnapshotRef.current = applyTrackAccessStamps(lastAckedSnapshotRef.current, stamps);
          }
          if (stamps && projectRef.current) {
            applyLocalCorrection(
              applyTrackAccessStamps(projectRef.current, stamps),
              'Apply track access stamps'
            );
          }

          await rememberServerSeq(seq);
        },
        onLockState: (message) => {
          if (disposed) return;
          setLockByTrackId((prev) => ({
            ...prev,
            [message.trackId]: {
              ownerUserId: message.ownerUserId,
              ownerName: message.ownerName,
              expiresAt: message.expiresAt,
            },
          }));
        },
        onError: (message) => {
          if (disposed) return;
          const text = message?.message || 'Realtime sync error';
          setSyncError(text);
          if (message?.trackId) {
            setLockErrorByTrackId((prev) => ({
              ...prev,
              [message.trackId]: {
                code: String(message.code || ''),
                message: text,
                receivedAt: Date.now(),
              },
            }));
          }
          if (isWriteRejectionMessage(message)) {
            handleWriteRejected(message).catch(() => {});
          }
        },
      });
    })();

    return () => {
      disposed = true;
      setConnected(false);
      setJoined(false);
      if (clientRef.current) {
        clientRef.current.dispose();
        clientRef.current = null;
      }
      localClientOpIdsRef.current.clear();
      acknowledgedClientOpIdsRef.current.clear();
      inFlightProjectByClientOpIdRef.current.clear();
    };
  }, [enabled, session, serverProjectId, projectId, updateProject, remoteSession?.latestSeq, ensureMediaUploaded]);

  useEffect(() => {
    if (!enabled || !project || !projectId || !session || !joined) return;
    if (applyingRemoteRef.current) return;

    const snapshot = JSON.stringify(project);
    if (snapshot === lastSyncedSnapshotRef.current) return;
    lastSyncedSnapshotRef.current = snapshot;
    localEditSeqRef.current += 1;
    const localEditSeq = localEditSeqRef.current;

    const send = async () => {
      if (localEditSeqRef.current !== localEditSeq) return;
      const op = {
        type: 'project.replace',
        project,
      };
      const clientOpId = createId();
      localClientOpIdsRef.current.add(clientOpId);
      if (!clientRef.current?.connected) {
        if (localEditSeqRef.current !== localEditSeq) return;
        await upsertPendingSyncOp(projectId, { op, clientOpId, project, localEditSeq });
        return;
      }

      try {
        if (localEditSeqRef.current !== localEditSeq) return;
        await upsertPendingSyncOp(projectId, { op, clientOpId, project, localEditSeq });
        if (localEditSeqRef.current !== localEditSeq) return;
        const uploadReadyProject = await ensureMediaUploaded(project);
        if (localEditSeqRef.current !== localEditSeq) return;
        const opToSend = uploadReadyProject === project
          ? op
          : {
            ...op,
            project: uploadReadyProject,
          };
        if (opToSend !== op) {
          await upsertPendingSyncOp(projectId, {
            op: opToSend,
            clientOpId,
            project: uploadReadyProject,
            localEditSeq,
          });
        }
        if (localEditSeqRef.current !== localEditSeq) return;

        inFlightProjectByClientOpIdRef.current.set(clientOpId, uploadReadyProject);
        const sent = clientRef.current.submitOp(opToSend, clientOpId);
        if (!sent) {
          inFlightProjectByClientOpIdRef.current.delete(clientOpId);
          return;
        }
      } catch (error) {
        if (localEditSeqRef.current !== localEditSeq) return;
        setSyncError(error.message || 'Failed to sync project update');
        await upsertPendingSyncOp(projectId, { op, clientOpId, project, localEditSeq });
        lastSyncedSnapshotRef.current = '';
        setTimeout(() => {
          setRetryTick((value) => value + 1);
        }, 2000);
      }
    };

    const timeoutId = setTimeout(() => {
      send().catch((error) => {
        setSyncError(error.message || 'Failed to sync project update');
      });
    }, 120);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [enabled, project, projectId, session, retryTick, ensureMediaUploaded, joined]);

  return {
    connected,
    latestSeq,
    syncError,
    remoteAnimation,
    lockByTrackId,
    lockErrorByTrackId,
    lockHelpers,
  };
}
