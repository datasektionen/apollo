import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Download, FileAudio, CircleUserRound } from 'lucide-react';
import { isValidMusicalNumber, normalizeMusicalNumber, normalizeProjectName } from '../utils/naming';
import { PlaybackDevicesSettingsPanel } from './SettingsPanels';
import { usePlaybackDeviceSettings } from '../hooks/usePlaybackDeviceSettings';
import { BrandWordmark } from './BrandLogo';
import CreditsEditorDialog from './CreditsEditorDialog';
import { getProjectCredits, getShowMetadata, saveProjectCredits, saveShowMetadata } from '../lib/serverApi';
import { formatDurationMs } from '../utils/playerTime';
import {
  getConfiguredShowId,
  getNoAccessMessage,
  SHOW_SETTINGS_MODES,
} from '../utils/showSettings';

function HostedDashboard({
  session,
  shows = [],
  projects,
  onOpenProject,
  onCreateProject,
  onCreateShow = null,
  onRenameShow = null,
  onLogout,
  onImportProject,
  onDeleteProject,
  onRenameProject,
  onUpdateMusicalNumber,
  loading = false,
  error = '',
  onSwitchToPlayerMode = null,
  onOpenAdmin = null,
  onOpenProfile = null,
}) {
  const [newProjectName, setNewProjectName] = useState('');
  const [newMusicalNumber, setNewMusicalNumber] = useState('0.0');
  const [selectedShowId, setSelectedShowId] = useState('');
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showDropdownOpen, setShowDropdownOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const canCreateShows = Boolean(session?.accessSummary?.canCreateShows && onCreateShow);
  const [contextMenu, setContextMenu] = useState(null);
  const [creditsEditor, setCreditsEditor] = useState(null);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const showSelectorRef = useRef(null);
  const createMenuRef = useRef(null);
  const {
    audioInputs,
    audioOutputs,
    audioSettings,
    outputChannelCount,
    playbackPanLawDb,
    refreshAudioDevices,
    setAudioSettings,
  } = usePlaybackDeviceSettings({
    errorPrefix: 'hosted-dashboard',
  });
  const showNoAccessMessage = Boolean(session?.accessSummary?.showNoAccessMessage);
  const noAccessMessage = getNoAccessMessage(
    session?.accessSummary,
    SHOW_SETTINGS_MODES.DAW
  );
  const defaultDawShowId = getConfiguredShowId(
    session?.accessSummary,
    SHOW_SETTINGS_MODES.DAW
  );
  const projectShowIds = new Set((projects || []).map((project) => project.showId).filter(Boolean));
  const selectableShows = (shows || []).filter((show) => (
    show.canSeeShow || show.canCreateProjects || show.canManageShow || projectShowIds.has(show.id)
  ));
  const selectableShowIds = selectableShows.map((show) => show.id).join('|');
  const selectedShow = selectableShows.find((show) => show.id === selectedShowId)
    || selectableShows[0]
    || null;
  const canCreateProjectsInSelectedShow = Boolean(selectedShow?.canCreateProjects);
  const canRenameSelectedShow = Boolean(selectedShow?.canManageShow && onRenameShow);
  const visibleProjects = (projects || []).filter((project) => (
    selectedShow ? project.showId === selectedShow.id : false
  ));

  useEffect(() => {
    if (!selectableShows.length) {
      setSelectedShowId('');
      return;
    }
    setSelectedShowId((current) => (
      selectableShows.some((show) => show.id === current)
        ? current
        : (
          selectableShows.some((show) => String(show.id) === String(defaultDawShowId))
            ? defaultDawShowId
            : selectableShows[0].id
        )
    ));
  }, [defaultDawShowId, selectableShowIds]);

  const formatRelativeTime = (timestamp) => {
    const numeric = Number(timestamp);
    const value = Number.isFinite(numeric)
      ? numeric
      : Date.parse(String(timestamp || ''));
    if (!Number.isFinite(value)) return 'unknown';

    const diffMs = Date.now() - value;
    if (diffMs < 0) return 'just now';

    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    const weekMs = 7 * dayMs;
    const monthMs = 30 * dayMs;
    const yearMs = 365 * dayMs;

    if (diffMs < minuteMs) return 'just now';
    if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)} min ago`;
    if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)} h ago`;
    if (diffMs < weekMs) return `${Math.floor(diffMs / dayMs)} d ago`;
    if (diffMs < monthMs) return `${Math.floor(diffMs / weekMs)} w ago`;
    if (diffMs < yearMs) return `${Math.floor(diffMs / monthMs)} mo ago`;
    return `${Math.floor(diffMs / yearMs)} y ago`;
  };

  const handleCreateProject = async () => {
    const normalizedName = normalizeProjectName(newProjectName);
    const normalizedMusicalNumber = normalizeMusicalNumber(newMusicalNumber);
    if (!normalizedName || !isValidMusicalNumber(normalizedMusicalNumber) || !selectedShow?.id) return;
    await onCreateProject(normalizedName, normalizedMusicalNumber, selectedShow.id);
    setNewProjectName('');
    setNewMusicalNumber('0.0');
    setShowNewProjectDialog(false);
  };

  const promptCreateShow = async () => {
    if (!onCreateShow) return;
    const name = window.prompt('New show name');
    const normalized = normalizeProjectName(name || '');
    if (!normalized) return;
    const created = await onCreateShow(normalized);
    if (created?.id) {
      setSelectedShowId(created.id);
      setShowDropdownOpen(false);
    }
  };

  const promptRenameShow = async (show) => {
    if (!show?.id || !onRenameShow) return;
    const name = window.prompt('Rename show', show.name || '');
    if (name === null) return;
    const normalized = normalizeProjectName(name || '');
    if (!normalized || normalized === show.name) return;
    const updated = await onRenameShow(show, normalized);
    if (updated?.id) setSelectedShowId(updated.id);
  };

  const openShowCreditsEditor = async (show) => {
    if (!show?.id) return;
    setContextMenu(null);
    try {
      const payload = await getShowMetadata(show.id, session);
      setCreditsEditor({
        mode: 'show',
        title: `Show credits - ${show.name}`,
        showId: show.id,
        description: payload?.show?.description || '',
        producerRefs: payload?.show?.producerRefs || payload?.show?.producers || [],
      });
    } catch (error) {
      window.alert(error.message || 'Failed to load show credits');
    }
  };

  const openProjectCreditsEditor = async (project) => {
    if (!project?.id) return;
    setContextMenu(null);
    try {
      const payload = await getProjectCredits(project.id, session);
      setCreditsEditor({
        mode: 'project',
        title: `Credits - ${project.musicalNumber || '0.0'} ${project.name || ''}`.trim(),
        projectId: project.id,
        credits: payload?.credits || {},
        creditRoleOptions: payload?.creditRoleOptions || null,
      });
    } catch (error) {
      window.alert(error.message || 'Failed to load project credits');
    }
  };

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
      if (!showSelectorRef.current?.contains(event.target)) {
        setShowDropdownOpen(false);
      }
      if (!createMenuRef.current?.contains(event.target)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  const beginProjectRename = (project) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name || '');
  };

  const commitProjectRename = async () => {
    if (!editingProjectId) return;
    const project = (projects || []).find((p) => p.id === editingProjectId);
    if (!project) {
      setEditingProjectId(null);
      setEditingProjectName('');
      return;
    }
    const normalized = normalizeProjectName(editingProjectName);
    if (normalized && normalized !== project.name) {
      await onRenameProject(project, normalized);
    }
    setEditingProjectId(null);
    setEditingProjectName('');
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <div className="relative bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 leading-none">
            <BrandWordmark className="h-9" />
          </h1>
        </div>
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" ref={showSelectorRef}>
          <button
            type="button"
            onClick={() => {
              if (selectableShows.length > 1) {
                setShowDropdownOpen((previous) => !previous);
              }
            }}
            onContextMenu={(event) => {
              if (!canRenameSelectedShow || !selectedShow) return;
              event.preventDefault();
              setContextMenu({
                type: 'show',
                x: event.clientX,
                y: event.clientY,
                show: selectedShow,
              });
            }}
            className={`flex max-w-[42vw] items-center gap-2 rounded-lg px-3 py-1.5 text-center text-base font-semibold text-white transition-colors ${
              selectableShows.length > 1 ? 'hover:bg-gray-700' : 'cursor-default'
            }`}
            title={selectableShows.length > 1 ? 'Switch show' : (selectedShow?.name || 'No show selected')}
          >
            <span className="truncate">{selectedShow?.name || 'No show selected'}</span>
            {selectableShows.length > 1 ? <ChevronDown size={16} className="shrink-0 text-gray-400" /> : null}
          </button>
          {showDropdownOpen && selectableShows.length > 1 ? (
            <div className="absolute left-1/2 top-full mt-2 max-h-80 min-w-64 -translate-x-1/2 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl">
              {selectableShows.map((show) => {
                const active = show.id === selectedShow?.id;
                return (
                  <button
                    key={show.id}
                    type="button"
                    onClick={() => {
                      setSelectedShowId(show.id);
                      setShowDropdownOpen(false);
                    }}
                    onContextMenu={(event) => {
                      if (!show?.canManageShow || !onRenameShow) return;
                      event.preventDefault();
                      setContextMenu({
                        type: 'show',
                        x: event.clientX,
                        y: event.clientY,
                        show,
                      });
                    }}
                    className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm transition-colors ${
                      active ? 'bg-blue-600/20 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    <span className="truncate">{show.name}</span>
                    <span className="shrink-0 text-xs text-gray-500">{show.projectCount || 0}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative" ref={createMenuRef}>
            <button
              onClick={() => {
                if (canCreateShows) {
                  setCreateMenuOpen((previous) => !previous);
                  return;
                }
                setShowNewProjectDialog(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-2 flex items-center justify-center transition-colors disabled:bg-gray-700"
              disabled={loading || (!canCreateProjectsInSelectedShow && !canCreateShows) || (!selectedShow && !canCreateShows)}
              title={selectedShow ? `Create in ${selectedShow.name}` : 'Create'}
            >
              <Plus size={18} />
            </button>
            {createMenuOpen ? (
              <div className="absolute right-0 top-full z-30 mt-2 min-w-52 overflow-hidden rounded-md border border-gray-700 bg-gray-800 py-1 shadow-lg">
                <button
                  type="button"
                  disabled={!canCreateProjectsInSelectedShow || !selectedShow || loading}
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setShowNewProjectDialog(true);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent"
                >
                  Create musical number
                </button>
                {canCreateShows ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setCreateMenuOpen(false);
                      promptCreateShow();
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-500"
                  >
                    Create show
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <label
            className={`bg-green-600 hover:bg-green-700 text-white rounded-lg p-2 flex items-center justify-center transition-colors cursor-pointer ${(loading || !canCreateProjectsInSelectedShow || !selectedShow) ? 'opacity-60 pointer-events-none' : ''}`}
            title={isImporting ? 'Importing project...' : 'Import Project'}
          >
            <Download size={18} />
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!selectedShow?.id) return;
                setIsImporting(true);
                try {
                  await onImportProject(file, selectedShow.id);
                } finally {
                  setIsImporting(false);
                  e.target.value = '';
                }
              }}
            />
          </label>

          <div className="flex items-center rounded-lg bg-gray-700 p-0.5">
            {onSwitchToPlayerMode ? (
              <button
                onClick={onSwitchToPlayerMode}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
                title="Switch to Player mode"
              >Player</button>
            ) : (
              <span className="rounded-md px-3 py-1.5 text-xs font-semibold text-gray-300">Player</span>
            )}
            <button
              type="button"
              disabled
              className="rounded-md px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white cursor-default"
              title="Current mode"
            >
              DAW
            </button>
          </div>

          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileMenuOpen((previous) => !previous)}
              className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-2 flex items-center justify-center transition-colors"
              title="User menu"
            >
              <CircleUserRound size={18} />
            </button>
            {profileMenuOpen ? (
              <div className="absolute right-0 top-full mt-2 min-w-32 rounded-md border border-gray-700 bg-gray-800 shadow-lg z-30 overflow-hidden">
                {onOpenProfile ? (
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onOpenProfile();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    My Profile
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setSettingsOpen(true);
                    refreshAudioDevices();
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                >
                  Settings
                </button>
                {session?.user?.isAdmin ? (
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onOpenAdmin?.();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                  >
                    Admin
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                >
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {showNewProjectDialog && (
            <div className="mb-6 bg-gray-800 border border-gray-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-1">Create New Project</h2>
              <div className="mb-4 text-sm text-gray-400">
                Show: {selectedShow?.name || 'No show selected'}
              </div>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateProject();
                  }
                }}
                placeholder="Enter project name..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 mb-4 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <input
                type="text"
                value={newMusicalNumber}
                onChange={(e) => setNewMusicalNumber(e.target.value)}
                placeholder="Musical number (e.g. 0.0, 2.1, 3.dk)"
                className={`w-full bg-gray-900 border rounded px-4 py-2 mb-2 focus:outline-none ${
                  isValidMusicalNumber(newMusicalNumber) ? 'border-gray-700 focus:border-blue-500' : 'border-red-500 focus:border-red-400'
                }`}
              />
              <p className="text-xs text-gray-400 mb-4">Must start with a number and dot, e.g. <code>0.0</code>, <code>2.1</code>, <code>3.dk</code>.</p>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateProject}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 transition-colors disabled:bg-gray-700"
                  disabled={
                    !normalizeProjectName(newProjectName)
                    || !isValidMusicalNumber(newMusicalNumber)
                    || !selectedShow?.id
                    || loading
                  }
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowNewProjectDialog(false);
                    setNewProjectName('');
                    setNewMusicalNumber('0.0');
                  }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error ? (
            <div className="mb-4 rounded border border-red-600/40 bg-red-900/20 px-4 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {!selectedShow ? (
            <div className="text-center py-12 text-gray-500">
              <FileAudio size={48} className="mx-auto mb-4 opacity-50" />
              <p>{showNoAccessMessage ? noAccessMessage : 'Select or create a show to begin.'}</p>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileAudio size={48} className="mx-auto mb-4 opacity-50" />
              <p>{showNoAccessMessage ? noAccessMessage : 'No projects yet.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-700">
              <div className="min-w-[600px]">
                <div className="grid grid-cols-[68px_minmax(150px,1fr)_96px_70px_106px] bg-gray-800 border-b border-gray-700 px-2 py-3 text-base font-semibold tracking-normal text-gray-200">
                  <div>No.</div>
                  <div>Original Title</div>
                  <div>Length</div>
                  <div>Tracks</div>
                  <div>Last Modified</div>
                </div>
                <div className="divide-y divide-gray-700">
                  {visibleProjects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => {
                        if (editingProjectId === project.id) return;
                        if (!project?.canOpenProject) return;
                        onOpenProject(project);
                      }}
                      onContextMenu={(e) => {
                        if (!project?.canManageProject) return;
                        e.preventDefault();
                        setContextMenu({
                          type: 'project',
                          x: e.clientX,
                          y: e.clientY,
                          project,
                        });
                      }}
                      className={`grid grid-cols-[68px_minmax(150px,1fr)_96px_70px_106px] items-center px-2 py-2.5 transition-colors ${
                        project?.canOpenProject
                          ? 'bg-gray-900 hover:bg-gray-800 cursor-pointer'
                          : 'bg-gray-900/70 text-gray-500 cursor-default'
                      }`}
                    >
                      <div className="text-lg text-gray-300 font-mono truncate">
                        {project.musicalNumber || '0.0'}
                      </div>
                      <div className="min-w-0">
                        {editingProjectId === project.id ? (
                          <input
                            type="text"
                            value={editingProjectName}
                            autoFocus
                            onChange={(e) => setEditingProjectName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={commitProjectRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                commitProjectRename();
                              } else if (e.key === 'Escape') {
                                cancelProjectRename();
                              }
                            }}
                            className="font-semibold text-xl bg-transparent border-b border-blue-500 px-0 py-0 leading-none focus:outline-none w-full"
                          />
                        ) : (
                          <h3 className="flex min-w-0 items-baseline gap-2 text-xl font-semibold">
                            <span className="truncate">{project.name}</span>
                            {!project?.canOpenProject ? <span className="shrink-0 text-xs font-medium text-gray-500">Read only in dashboard</span> : null}
                          </h3>
                        )}
                      </div>
                      <div className="text-lg text-gray-400 tabular-nums">
                        {formatDurationMs(project.durationMs)}
                      </div>
                      <div className="text-lg text-gray-300">
                        {project.trackCount ?? 0}
                      </div>
                      <div className="text-lg text-gray-400">
                        {formatRelativeTime(project.updatedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {contextMenu?.type === 'show' && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            onClick={() => {
              const show = contextMenu.show;
              setContextMenu(null);
              promptRenameShow(show);
            }}
          >
            Rename show
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            onClick={() => openShowCreditsEditor(contextMenu.show)}
          >
            Edit show credits
          </button>
        </div>
      )}

      {contextMenu?.type === 'project' && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            onClick={() => {
              beginProjectRename(contextMenu.project);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            onClick={async () => {
              const project = contextMenu.project;
              setContextMenu(null);
              const nextRaw = window.prompt(
                'Set musical number (must start with "<number>.", e.g. 2.1)',
                project.musicalNumber || '0.0'
              );
              if (nextRaw === null) return;
              const normalized = normalizeMusicalNumber(nextRaw);
              if (!isValidMusicalNumber(normalized)) {
                window.alert('Invalid musical number format. Example valid values: 0.0, 2.1, 3.dk');
                return;
              }
              await onUpdateMusicalNumber?.(project, normalized);
            }}
          >
            Set Musical Number
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            onClick={() => openProjectCreditsEditor(contextMenu.project)}
          >
            Edit credits
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-red-300 hover:bg-gray-700"
            onClick={async () => {
              setContextMenu(null);
              const confirmed = window.confirm(`Delete project "${contextMenu.project.name}"?`);
              if (!confirmed) return;
              await onDeleteProject(contextMenu.project);
            }}
          >
            Delete
          </button>
        </div>
      )}

      <CreditsEditorDialog
        open={Boolean(creditsEditor)}
        mode={creditsEditor?.mode || 'project'}
        title={creditsEditor?.title || 'Credits'}
        session={session}
        initialDescription={creditsEditor?.description || ''}
        initialProducerRefs={creditsEditor?.producerRefs || []}
        initialCredits={creditsEditor?.credits || null}
        creditRoleOptions={creditsEditor?.creditRoleOptions || null}
        resetKey={
          creditsEditor?.mode === 'show'
            ? `show:${creditsEditor?.showId || ''}`
            : `project:${creditsEditor?.projectId || ''}`
        }
        onClose={() => setCreditsEditor(null)}
        onSave={async (payload) => {
          if (creditsEditor?.mode === 'show') {
            await saveShowMetadata(creditsEditor.showId, payload, session);
          } else if (creditsEditor?.mode === 'project') {
            await saveProjectCredits(creditsEditor.projectId, payload, session);
          }
        }}
      />

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <div className="text-sm font-semibold">Settings</div>
              <button
                className="text-gray-400 hover:text-gray-200"
                onClick={() => setSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="px-4 py-3">
              <PlaybackDevicesSettingsPanel
                audioSettings={audioSettings}
                setAudioSettings={setAudioSettings}
                audioInputs={audioInputs}
                audioOutputs={audioOutputs}
                monoOutputActive={audioSettings.forceMonoOutput === true || outputChannelCount <= 1}
                onRefreshDevices={refreshAudioDevices}
                outputChannelCount={outputChannelCount}
                playbackPanLawDb={playbackPanLawDb}
              />
            </div>
            <div className="border-t border-gray-700 px-4 py-3 flex justify-end">
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-2 text-sm"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

export default HostedDashboard;
