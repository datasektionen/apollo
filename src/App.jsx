import { useCallback, useRef, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import useStore from './store/useStore';
import Editor from './components/Editor';
import HostedLogin from './components/HostedLogin';
import HostedDashboard from './components/HostedDashboard';
import PlayerDashboard from './components/PlayerDashboard';
import AdminPanel from './components/AdminPanel';
import ProfileDialog from './components/ProfileDialog';
import LoadProgressDialog from './components/LoadProgressDialog';
import { audioManager } from './lib/audioManager';
import { importFromZIP } from './lib/projectPortability';
import { deleteProject as deleteCachedProject, getMediaBlob, saveRemoteProjectMeta, storeMediaBlob } from './lib/db';
import { prepareMediaForImportSource } from './lib/mediaEncoding';
import { registerAndUploadMediaBlob } from './lib/mediaUpload';
import { normalizeProjectName } from './utils/naming';
import { createId } from './utils/id';
import { installNativeDragGuard } from './utils/nativeDrag';
import {
  beginOidcLogin,
  bootstrapServerProject,
  clearServerSession,
  createShow,
  createServerProject,
  deleteServerProject,
  fetchPlayerGlobalMixes,
  fetchPlayerMyDevice,
  getCurrentSession,
  isSessionRecoveryError,
  listServerProjects,
  listShows,
  loadServerSession,
  logout,
  renameShow,
  renameServerProject,
  updateServerProjectMusicalNumber,
  updateVirtualMix,
  saveServerSession,
} from './lib/serverApi';
import {
  ADVANCED_MIX_PRESET_ID,
  createAdvancedMixEditorProject,
  createAdvancedMixSavePayload,
} from './utils/advancedMix';
import { createEditableMixSource } from './lib/exportEngine';
import {
  finishLoadProgress,
  logLoadProgress,
  startLoadProgress,
  summarizeProjectForLoadLog,
  updateLoadProgress,
  withLoadStep,
} from './lib/loadProgress';

function collectBlobIds(project) {
  const ids = new Set();
  (project?.tracks || []).forEach((track) => {
    (track?.clips || []).forEach((clip) => {
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
      const mappedBlobId = idMap.get(clip?.blobId);
      if (!mappedBlobId || mappedBlobId === clip?.blobId) {
        return clip;
      }
      trackChanged = true;
      changed = true;
      return {
        ...clip,
        blobId: mappedBlobId,
      };
    });
    if (!trackChanged) return track;
    return {
      ...track,
      clips: nextClips,
    };
  });

  if (!changed) {
    return project;
  }

  return {
    ...project,
    tracks: nextTracks,
  };
}

function AdminAccessDenied({ onBack, onLogout }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-900 px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-800 p-6 shadow-2xl">
        <h1 className="text-xl font-semibold">Admin access required</h1>
        <p className="mt-2 text-sm text-gray-300">
          Your account does not have permission to open the admin page.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
          >
            Back to Apollo
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded bg-gray-700 px-4 py-2 text-sm text-gray-100 hover:bg-gray-600"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

function RequireAuth({ session, loading, error, onSsoLogin, children }) {
  if (!session) {
    return (
      <HostedLogin
        onSsoLogin={onSsoLogin}
        loading={loading}
        error={error}
      />
    );
  }
  return children;
}

function RequireAdmin({ session, onBack, onLogout, children }) {
  if (!session?.user?.isAdmin) {
    return <AdminAccessDenied onBack={onBack} onLogout={onLogout} />;
  }
  return children;
}

function DawProjectRoute({
  serverSession,
  remoteEditorSession,
  advancedMixSession,
  handleOpenServerProject,
  handleOpenAdvancedMix,
  handleBackToDashboard,
  handleSwitchToPlayerMode,
  handleSaveAdvancedMix,
  setServerError,
}) {
  const { projectId, mixId } = useParams();
  const navigate = useNavigate();
  const loadingKeyRef = useRef('');

  useEffect(() => {
    if (!serverSession || !projectId) return;

    const currentKey = `${projectId}:${mixId || ''}`;
    const isLoaded = mixId
      ? advancedMixSession?.mix?.id === mixId && remoteEditorSession?.serverProjectId === projectId
      : remoteEditorSession?.serverProjectId === projectId && !advancedMixSession;

    if (isLoaded) {
      loadingKeyRef.current = currentKey;
      return;
    }

    if (loadingKeyRef.current === currentKey) return;
    loadingKeyRef.current = currentKey;

    let cancelled = false;

    const performLoad = async () => {
      try {
        if (mixId) {
          const [myDevice, globalMixes] = await Promise.all([
            fetchPlayerMyDevice(serverSession).catch(() => ({ myMixes: [] })),
            fetchPlayerGlobalMixes(serverSession).catch(() => []),
          ]);
          const allMixes = [...(myDevice?.myMixes || []), ...(globalMixes || [])];
          const found = allMixes.find((m) => String(m.id) === String(mixId));
          if (found) {
            await handleOpenAdvancedMix(found);
            return;
          }
          if (!cancelled) {
            console.warn('Advanced mix not found or private. Opening base project.');
            navigate(`/daw/projects/${projectId}`, { replace: true });
          }
          return;
        }

        await handleOpenServerProject({ id: projectId });
      } catch (err) {
        if (!cancelled) {
          setServerError(err.message || 'Failed to open project');
          navigate('/daw', { replace: true });
        }
      }
    };

    performLoad();

    return () => {
      cancelled = true;
    };
  }, [projectId, mixId, serverSession, remoteEditorSession, advancedMixSession, handleOpenServerProject, handleOpenAdvancedMix, navigate, setServerError]);

  const isReady = mixId
    ? advancedMixSession?.mix?.id === mixId && remoteEditorSession?.serverProjectId === projectId
    : remoteEditorSession?.serverProjectId === projectId && !advancedMixSession;

  if (!isReady) {
    return null;
  }

  return (
    <Editor
      onBackToDashboard={handleBackToDashboard}
      onSwitchToPlayerMode={handleSwitchToPlayerMode}
      remoteSession={
        remoteEditorSession
          ? {
              ...remoteEditorSession,
              session: serverSession || null,
            }
          : null
      }
      advancedMixSession={advancedMixSession}
      onSaveAdvancedMix={handleSaveAdvancedMix}
    />
  );
}

function App() {
  const navigate = useNavigate();
  const openAttemptRef = useRef(0);
  const openReturnViewRef = useRef('player');
  const [serverSession, setServerSession] = useState(loadServerSession());
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const [serverProjects, setServerProjects] = useState([]);
  const [serverShows, setServerShows] = useState([]);
  const [serverError, setServerError] = useState('');
  const [serverLoading, setServerLoading] = useState(false);
  const [remoteEditorSession, setRemoteEditorSession] = useState(null);
  const [advancedMixSession, setAdvancedMixSession] = useState(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const { loadProject: loadProjectToStore } = useStore();

  const refreshServerData = async (sessionOverride = null) => {
    const activeSession = sessionOverride || serverSession;
    if (!activeSession) return;

    setServerLoading(true);
    setServerError('');
    try {
      const [shows, projects] = await Promise.all([
        listShows(activeSession),
        listServerProjects(activeSession),
      ]);
      setServerShows(shows);
      setServerProjects(projects);
    } catch (error) {
      setServerError(error.message || 'Failed to refresh server data');
    } finally {
      setServerLoading(false);
    }
  };

  useEffect(() => installNativeDragGuard(), []);

  useEffect(() => {
    if (!serverSession) return;
    refreshServerData(serverSession);
  }, [serverSession]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      setAuthBootstrapping(true);

      const params = new URLSearchParams(window.location.search);
      const authError = params.get('auth_error');
      if (authError) {
        setServerError(authError);
        params.delete('auth_error');
        const nextSearch = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`);
      }

      try {
        const session = await getCurrentSession();
        saveServerSession(session);
        if (!cancelled) {
          setServerSession(session);
        }
      } catch (error) {
        clearServerSession();
        if (!cancelled) {
          setServerSession(null);
          if (!isSessionRecoveryError(error) && !/401\s+Unauthorized/i.test(String(error?.message || ''))) {
            setServerError((previous) => previous || error.message || 'Failed to load session');
          }
        }
      } finally {
        if (!cancelled) {
          setAuthBootstrapping(false);
        }
      }
    };

    bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleSessionUpdated = () => {
      setServerSession(loadServerSession());
    };
    window.addEventListener('apollo:server-session-updated', handleSessionUpdated);
    return () => {
      window.removeEventListener('apollo:server-session-updated', handleSessionUpdated);
    };
  }, []);

  const handleSsoLogin = () => {
    setServerError('');
    beginOidcLogin();
  };

  const handleServerLogout = async () => {
    let redirectUrl = '';
    try {
      const response = await logout();
      redirectUrl = String(response?.redirectUrl || '');
    } catch {
      // ignore logout errors
    }
    clearServerSession();
    setServerSession(null);
    setServerProjects([]);
    setServerShows([]);
    setRemoteEditorSession(null);
    setAdvancedMixSession(null);
    setProfileDialogOpen(false);
    navigate('/player');
    if (redirectUrl) {
      window.location.assign(redirectUrl);
    }
  };

  const abandonOpen = (attempt) => {
    if (openAttemptRef.current !== attempt) return;
    openAttemptRef.current += 1;
    setServerLoading(false);
    setRemoteEditorSession(null);
    setAdvancedMixSession(null);
    navigate(openReturnViewRef.current === 'player' ? '/player' : '/daw');
  };

  const handleOpenServerProject = async (projectMeta) => {
    setServerError('');
    setServerLoading(true);
    const attempt = ++openAttemptRef.current;
    openReturnViewRef.current = 'daw';
    const progressId = startLoadProgress({
      kind: 'open',
      title: projectMeta?.name || 'Project',
      detail: `DAW open · ${projectMeta?.id || 'unknown id'}`,
      onAbort: () => abandonOpen(attempt),
    });
    try {
      updateLoadProgress({ phase: 'Snapshot', current: 'Fetching project snapshot…' });
      const payload = await withLoadStep(
        'Fetch project snapshot (bootstrap)',
        async () => bootstrapServerProject(projectMeta.id, serverSession, 0, { purpose: 'daw' })
      );
      summarizeProjectForLoadLog(payload?.snapshot, 'Project snapshot');
      await withLoadStep(
        'Load snapshot into editor store',
        async () => loadProjectToStore(payload.snapshot, {
          defaultLyricLanguage: payload?.runtimeConfig?.defaultLyricLanguage,
        })
      );
      await withLoadStep(
        'Save remote project metadata',
        async () => saveRemoteProjectMeta({
          projectId: payload.snapshot.projectId,
          serverProjectId: projectMeta.id,
          latestSeq: Number(payload.latestSeq || 0),
        })
      );
      setRemoteEditorSession({
        session: serverSession,
        serverProjectId: projectMeta.id,
        latestSeq: Number(payload.latestSeq || 0),
        projectName: projectMeta?.name || payload?.project?.name || payload?.snapshot?.projectName || '',
        musicalNumber: projectMeta?.musicalNumber || payload?.snapshot?.musicalNumber || '0.0',
        showId: projectMeta?.showId || payload?.project?.showId || payload?.snapshot?.showId || null,
        showName: projectMeta?.showName || payload?.project?.showName || payload?.snapshot?.showName || '',
        projectAccess: payload?.access || null,
      });
      setAdvancedMixSession(null);
      if (openAttemptRef.current !== attempt) return;
      updateLoadProgress({
        phase: 'Audio',
        current: 'Loading audio…',
      });
      logLoadProgress('Editor mounting under the open screen to load stems and waveforms');
    } catch (error) {
      if (openAttemptRef.current !== attempt) return;
      setServerError(error.message || 'Failed to open project');
      finishLoadProgress(error, progressId);
      throw error;
    } finally {
      setServerLoading(false);
    }
  };

  const handleOpenAdvancedMix = async (mix) => {
    const projectId = String(mix?.projectId || '').trim();
    if (!projectId || !mix?.id) return;
    setServerError('');
    setServerLoading(true);
    const attempt = ++openAttemptRef.current;
    openReturnViewRef.current = 'player';
    const progressId = startLoadProgress({
      kind: 'open',
      title: mix?.name || 'Advanced mix',
      detail: `Mix editor open · ${mix.id}`,
      onAbort: () => abandonOpen(attempt),
    });
    try {
      updateLoadProgress({ phase: 'Snapshot', current: 'Fetching mix source snapshot…' });
      const payload = await withLoadStep(
        'Fetch project snapshot (bootstrap)',
        async () => bootstrapServerProject(projectId, serverSession, 0, { purpose: 'daw' })
      );
      const baseSnapshot = payload?.snapshot || {};
      summarizeProjectForLoadLog(baseSnapshot, 'Source project snapshot');
      const mixWithAdvancedState = await withLoadStep(
        'Build editable advanced-mix project',
        async () => {
          const editableMixSource = createEditableMixSource(baseSnapshot, mix);
          const nextMix = {
            ...mix,
            presetId: ADVANCED_MIX_PRESET_ID,
            presetVariantKey: null,
            advancedMix: {
              snapshot: editableMixSource.snapshot,
              focus: editableMixSource.focus,
            },
          };
          const editorProject = createAdvancedMixEditorProject(baseSnapshot, nextMix);
          await loadProjectToStore(editorProject);
          return { nextMix, editableMixSource, editorProject };
        }
      );
      summarizeProjectForLoadLog(mixWithAdvancedState.editorProject, 'Mix editor snapshot');
      setRemoteEditorSession({
        session: serverSession,
        serverProjectId: projectId,
        latestSeq: Number(payload.latestSeq || 0),
        projectName: mix.name || payload?.project?.name || baseSnapshot?.projectName || '',
        musicalNumber: mix.musicalNumber || baseSnapshot?.musicalNumber || '0.0',
        showId: mix.showId || payload?.project?.showId || baseSnapshot?.showId || null,
        showName: mix.showName || payload?.project?.showName || baseSnapshot?.showName || '',
        projectAccess: payload?.access || null,
      });
      setAdvancedMixSession({
        mix: mixWithAdvancedState.nextMix,
        baseSnapshot,
        sourceProjectId: projectId,
        initialControls: mixWithAdvancedState.editableMixSource.controls || null,
      });
      if (openAttemptRef.current !== attempt) return;
      updateLoadProgress({
        phase: 'Audio',
        current: 'Loading audio…',
      });
      logLoadProgress('Mix editor mounting under the open screen to load stems and waveforms');
    } catch (error) {
      if (openAttemptRef.current !== attempt) return;
      setServerError(error.message || 'Failed to open mix editor');
      finishLoadProgress(error, progressId);
      throw error;
    } finally {
      setServerLoading(false);
    }
  };

  const handleSaveAdvancedMix = useCallback(async ({ snapshot, focus }) => {
    if (!advancedMixSession?.mix?.id || !serverSession) return null;
    const advancedMix = createAdvancedMixSavePayload(
      snapshot,
      focus,
      advancedMixSession.sourceProjectId || advancedMixSession.mix.projectId
    );
    const updated = await updateVirtualMix(advancedMixSession.mix.id, {
      presetId: ADVANCED_MIX_PRESET_ID,
      presetVariantKey: null,
      advancedMix,
    }, serverSession);
    setAdvancedMixSession((previous) => (
      previous?.mix?.id === updated?.id
        ? { ...previous, mix: { ...previous.mix, ...updated } }
        : previous
    ));
    return updated;
  }, [advancedMixSession, serverSession]);

  const handleCreateServerProject = async (name, musicalNumber, showId) => {
    setServerError('');
    setServerLoading(true);
    try {
      const created = await createServerProject(name, serverSession, { musicalNumber, showId });
      await refreshServerData();
      if (created?.project?.id) {
        navigate(`/daw/projects/${created.project.id}`);
      }
    } catch (error) {
      setServerError(error.message || 'Failed to create project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleImportServerProject = async (file, showId) => {
    setServerError('');
    setServerLoading(true);
    try {
      if (!file?.name?.toLowerCase().endsWith('.zip')) {
        throw new Error('Only .zip project import is supported here.');
      }

      const importedProject = await importFromZIP(
        file,
        storeMediaBlob,
        audioManager.decodeAudioFile.bind(audioManager)
      );

      if (!importedProject) {
        throw new Error('Import cancelled.');
      }

      const importedName = normalizeProjectName(importedProject.projectName)
        || normalizeProjectName(file.name.replace(/\.zip$/i, ''))
        || 'Imported Project';
      const importedProjectId = createId();
      let snapshot = {
        ...importedProject,
        projectId: importedProjectId,
        projectName: importedName,
        showId,
      };

      const blobIds = collectBlobIds(snapshot);
      const canonicalIdMap = new Map();
      for (const blobId of blobIds) {
        const media = await getMediaBlob(blobId);
        const audioBuffer = await audioManager.loadAudioBuffer(blobId, media.blob);
        const prepared = await prepareMediaForImportSource({
          sourceBlob: media.blob,
          sourceFileName: `${blobId}.wav`,
          sourceMimeType: 'audio/wav',
          audioBuffer,
        });
        const uploaded = await registerAndUploadMediaBlob({
          mediaId: blobId,
          blob: prepared.serverUploadBlob,
          fileName: prepared.serverUploadFileName,
          mimeType: prepared.serverUploadMimeType,
          session: serverSession,
          projectId: importedProjectId,
        });
        if (uploaded.mediaId !== blobId) {
          canonicalIdMap.set(blobId, uploaded.mediaId);
          await storeMediaBlob(prepared.localCacheFileName, audioBuffer, prepared.localCacheBlob, uploaded.mediaId);
        }
      }

      snapshot = remapProjectBlobIds(snapshot, canonicalIdMap);
      await createServerProject(importedName, serverSession, {
        projectId: importedProjectId,
        initialSnapshot: snapshot,
        showId,
      });

      await refreshServerData();
      navigate(`/daw/projects/${importedProjectId}`);
    } catch (error) {
      setServerError(error.message || 'Failed to import ZIP project to server');
    } finally {
      setServerLoading(false);
    }
  };

  const handleDeleteServerProject = async (projectMeta) => {
    setServerError('');
    setServerLoading(true);
    try {
      await deleteServerProject(projectMeta.id, serverSession);
      await deleteCachedProject(projectMeta.id).catch(() => {});
      await refreshServerData();
    } catch (error) {
      setServerError(error.message || 'Failed to delete project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleRenameServerProject = async (projectMeta, nextName) => {
    setServerError('');
    setServerLoading(true);
    try {
      await renameServerProject(projectMeta.id, nextName, serverSession);
      await refreshServerData();
    } catch (error) {
      setServerError(error.message || 'Failed to rename project');
    } finally {
      setServerLoading(false);
    }
  };

  const handleUpdateServerProjectMusicalNumber = async (projectMeta, musicalNumber) => {
    setServerError('');
    setServerLoading(true);
    try {
      await updateServerProjectMusicalNumber(projectMeta.id, musicalNumber, serverSession);
      await refreshServerData();
    } catch (error) {
      setServerError(error.message || 'Failed to update musical number');
    } finally {
      setServerLoading(false);
    }
  };

  const handleCreateShow = async (name) => {
    setServerError('');
    setServerLoading(true);
    try {
      const show = await createShow(name, serverSession);
      await refreshServerData();
      return show;
    } catch (error) {
      setServerError(error.message || 'Failed to create show');
      return null;
    } finally {
      setServerLoading(false);
    }
  };

  const handleRenameShow = async (show, nextName) => {
    if (!show?.id) return null;
    setServerError('');
    setServerLoading(true);
    try {
      const updated = await renameShow(show.id, nextName, serverSession);
      await refreshServerData();
      return updated;
    } catch (error) {
      setServerError(error.message || 'Failed to rename show');
      return null;
    } finally {
      setServerLoading(false);
    }
  };

  const handleBackToDashboard = () => {
    if (advancedMixSession) {
      setAdvancedMixSession(null);
      setRemoteEditorSession(null);
      navigate('/player');
      return;
    }
    setRemoteEditorSession(null);
    navigate('/daw');
  };

  const handleSwitchToPlayerMode = () => {
    setRemoteEditorSession(null);
    setAdvancedMixSession(null);
    navigate('/player');
  };

  const handleSwitchToDawMode = () => {
    setRemoteEditorSession(null);
    setAdvancedMixSession(null);
    navigate('/daw');
  };

  const handleOpenAdmin = () => {
    setRemoteEditorSession(null);
    setAdvancedMixSession(null);
    navigate('/admin');
  };

  const handleLeaveAdmin = () => {
    navigate('/player');
  };

  const handleOpenProfile = () => {
    setProfileDialogOpen(true);
  };

  const handleProfileSaved = (nextSession) => {
    if (!nextSession) return;
    saveServerSession(nextSession);
    setServerSession(nextSession);
  };

  const handleSessionRefresh = useCallback(async () => {
    const nextSession = await getCurrentSession();
    saveServerSession(nextSession);
    setServerSession(nextSession);
    return nextSession;
  }, []);

  if (authBootstrapping) {
    // Keep the document's dark background while auth is resolved. Rendering
    // a temporary screen here causes a distracting flash on every reload.
    return null;
  }

  const playerElement = (
    <RequireAuth session={serverSession} loading={serverLoading} error={serverError} onSsoLogin={handleSsoLogin}>
      <PlayerDashboard
        session={serverSession}
        onLogout={handleServerLogout}
        onSwitchToDawDashboard={handleSwitchToDawMode}
        onOpenDawProject={handleOpenServerProject}
        onOpenAdvancedMix={handleOpenAdvancedMix}
        onOpenAdmin={handleOpenAdmin}
        onOpenProfile={handleOpenProfile}
      />
    </RequireAuth>
  );

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-gray-900 text-white"
      style={{ overscrollBehaviorX: 'auto', overscrollBehaviorY: 'none' }}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/player" replace />} />
        <Route path="/player" element={playerElement} />
        <Route path="/player/shows/:showId" element={playerElement} />
        <Route path="/player/playlists/:playlistId" element={playerElement} />
        <Route path="/player/folders/:folderId" element={playerElement} />
        <Route path="/player/search" element={playerElement} />
        <Route path="/player/*" element={playerElement} />
        <Route
          path="/daw"
          element={
            <RequireAuth session={serverSession} loading={serverLoading} error={serverError} onSsoLogin={handleSsoLogin}>
              <HostedDashboard
                session={serverSession}
                shows={serverShows}
                projects={serverProjects}
                onOpenProject={(project) => navigate(`/daw/projects/${project.id}`)}
                onCreateProject={handleCreateServerProject}
                onImportProject={handleImportServerProject}
                onCreateShow={handleCreateShow}
                onRenameShow={handleRenameShow}
                onLogout={handleServerLogout}
                onDeleteProject={handleDeleteServerProject}
                onRenameProject={handleRenameServerProject}
                onUpdateMusicalNumber={handleUpdateServerProjectMusicalNumber}
                loading={serverLoading}
                error={serverError}
                onSwitchToPlayerMode={handleSwitchToPlayerMode}
                onOpenAdmin={handleOpenAdmin}
                onOpenProfile={handleOpenProfile}
              />
            </RequireAuth>
          }
        />
        <Route
          path="/daw/projects/:projectId"
          element={
            <RequireAuth session={serverSession} loading={serverLoading} error={serverError} onSsoLogin={handleSsoLogin}>
              <DawProjectRoute
                serverSession={serverSession}
                remoteEditorSession={remoteEditorSession}
                advancedMixSession={advancedMixSession}
                handleOpenServerProject={handleOpenServerProject}
                handleOpenAdvancedMix={handleOpenAdvancedMix}
                handleBackToDashboard={handleBackToDashboard}
                handleSwitchToPlayerMode={handleSwitchToPlayerMode}
                handleSaveAdvancedMix={handleSaveAdvancedMix}
                setServerError={setServerError}
              />
            </RequireAuth>
          }
        />
        <Route
          path="/daw/projects/:projectId/mix/:mixId"
          element={
            <RequireAuth session={serverSession} loading={serverLoading} error={serverError} onSsoLogin={handleSsoLogin}>
              <DawProjectRoute
                serverSession={serverSession}
                remoteEditorSession={remoteEditorSession}
                advancedMixSession={advancedMixSession}
                handleOpenServerProject={handleOpenServerProject}
                handleOpenAdvancedMix={handleOpenAdvancedMix}
                handleBackToDashboard={handleBackToDashboard}
                handleSwitchToPlayerMode={handleSwitchToPlayerMode}
                handleSaveAdvancedMix={handleSaveAdvancedMix}
                setServerError={setServerError}
              />
            </RequireAuth>
          }
        />
        <Route path="/admin" element={<Navigate to="/admin/roles" replace />} />
        <Route
          path="/admin/:tab"
          element={
            <RequireAuth session={serverSession} loading={serverLoading} error={serverError} onSsoLogin={handleSsoLogin}>
              <RequireAdmin session={serverSession} onBack={handleLeaveAdmin} onLogout={handleServerLogout}>
                <AdminPanel
                  session={serverSession}
                  onClose={handleLeaveAdmin}
                  onLogout={handleServerLogout}
                  onOpenProfile={handleOpenProfile}
                  onSessionRefresh={handleSessionRefresh}
                />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/roles/:roleId"
          element={
            <RequireAuth session={serverSession} loading={serverLoading} error={serverError} onSsoLogin={handleSsoLogin}>
              <RequireAdmin session={serverSession} onBack={handleLeaveAdmin} onLogout={handleServerLogout}>
                <AdminPanel
                  session={serverSession}
                  onClose={handleLeaveAdmin}
                  onLogout={handleServerLogout}
                  onOpenProfile={handleOpenProfile}
                  onSessionRefresh={handleSessionRefresh}
                />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/player" replace />} />
      </Routes>
      {serverSession ? (
        <ProfileDialog
          open={profileDialogOpen}
          session={serverSession}
          onClose={() => setProfileDialogOpen(false)}
          onSaved={handleProfileSaved}
        />
      ) : null}
      <LoadProgressDialog />
    </div>
  );
}

export default App;
