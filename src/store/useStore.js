import { create } from 'zustand';
import { saveProject, saveUndoAction, loadUndoHistory } from '../lib/db';
import { createEmptyProject, normalizeExportSettings, normalizeProjectLyrics, normalizeProjectPublished } from '../types/project';
import { normalizeAutoPanSettings, normalizeProjectAutoPan } from '../utils/choirAutoPan';
import { normalizeTrackTree, reorderTracksByTree } from '../utils/trackTree';
import { reportUserError } from '../utils/errorReporter';

/**
 * Apollo Zustand Store
 * 
 * Central state management with:
 * - Project state
 * - Undo/redo with persistence
 * - Autosave (debounced 2s)
 * - Transport controls
 */

const useStore = create((set, get) => ({
  // === PROJECT STATE ===
  project: null,
  currentProjectId: null,
  
  // === PLAYBACK STATE ===
  isPlaying: false,
  isRecording: false,
  currentTimeMs: 0,
  selectedTrackId: null,
  selectedTrackByProjectId: {},
  
  // === UNDO/REDO STATE ===
  undoStack: [],
  redoStack: [],
  undoIndex: 0,
  
  // === AUTOSAVE STATE ===
  isDirty: false,
  isSaving: false,
  lastSaved: null,
  autosaveTimeout: null,
  
  // === ACTIONS ===
  
  /**
   * Initialize a new project
   */
  initProject: (name) => {
    let autoPan = normalizeAutoPanSettings();
    let exportSettings = normalizeExportSettings();
    try {
      const saved = localStorage.getItem('apollo.settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        const strategy = parsed?.defaultChoirPanning;
        const inverted = parsed?.defaultInvertedAutoPan === true;
        const manualChoirParts = parsed?.defaultManualChoirParts === true;
        autoPan = normalizeAutoPanSettings({
          enabled: typeof strategy === 'string' && strategy !== 'off',
          strategy: typeof strategy === 'string' && strategy !== 'off'
            ? strategy
            : autoPan.strategy,
          inverted,
          manualChoirParts,
        });
      }
    } catch (error) {
      reportUserError(
        'Failed to read app settings from local storage. Defaults will be used.',
        error,
        { onceKey: 'store:init-settings-parse' }
      );
    }

    const project = normalizeTrackTree(createEmptyProject(name, autoPan, exportSettings));
    set({
      project,
      currentProjectId: project.projectId,
      selectedTrackId: null,
      undoStack: [],
      redoStack: [],
      undoIndex: 0,
      isDirty: true,
    });
    get().triggerAutosave();
  },
  
  /**
   * Load existing project
   */
  loadProject: async (projectData, options = {}) => {
    const { panLawDb: legacyPanLawDb, ...restProjectData } = projectData || {};
    const normalizedProject = reorderTracksByTree(normalizeTrackTree(normalizeProjectAutoPan({
      ...restProjectData,
      published: normalizeProjectPublished(restProjectData.published ?? restProjectData.publish),
      lyrics: normalizeProjectLyrics(restProjectData.lyrics, options.defaultLyricLanguage),
      exportSettings: normalizeExportSettings({
        ...(restProjectData.exportSettings || {}),
        legacyPanLawDb,
      }),
    })));
    // Load undo history
    const undoStack = await loadUndoHistory(projectData.projectId);
    const { selectedTrackByProjectId } = get();
    const rememberedTrackId = selectedTrackByProjectId[projectData.projectId];
    let initialSelectedTrackId = null;
    if (normalizedProject.tracks && normalizedProject.tracks.length > 0) {
      const hasRemembered = rememberedTrackId && normalizedProject.tracks.some(t => t.id === rememberedTrackId);
      initialSelectedTrackId = hasRemembered ? rememberedTrackId : normalizedProject.tracks[0].id;
    }
    
    set({
      project: normalizedProject,
      currentProjectId: normalizedProject.projectId,
      selectedTrackId: initialSelectedTrackId,
      selectedTrackByProjectId: {
        ...selectedTrackByProjectId,
        [normalizedProject.projectId]: initialSelectedTrackId,
      },
      undoStack,
      redoStack: [],
      undoIndex: undoStack.length,
      isDirty: false,
      lastSaved: normalizedProject.lastModified,
    });
  },
  
  /**
   * Update project (triggers autosave and undo)
   */
  updateProject: (updater, actionDescription = 'Update', options = {}) => {
    const { project, undoStack, undoIndex, selectedTrackId, currentProjectId, selectedTrackByProjectId } = get();
    const { skipUndo = false, skipAutosave = false, skipDirty = false } = options;
    
    // Updaters are immutable; the same identity means no history or save work.
    const newProject = typeof updater === 'function' ? updater(project) : updater;
    if (newProject === project) return;
    
    // Keep detached snapshots for real undoable edits (circular buffer, max 100).
    const newUndoStack = skipUndo
      ? undoStack
      : [...undoStack.slice(0, undoIndex), {
        description: actionDescription,
        state: JSON.parse(JSON.stringify(project)),
      }].slice(-100);
    
    let nextSelectedTrackId = selectedTrackId;
    if (newProject?.tracks?.length) {
      if (!nextSelectedTrackId || !newProject.tracks.some(t => t.id === nextSelectedTrackId)) {
        nextSelectedTrackId = newProject.tracks[0].id;
      }
    } else {
      nextSelectedTrackId = null;
    }

    const nextSelectedTrackByProjectId = currentProjectId
      ? { ...selectedTrackByProjectId, [currentProjectId]: nextSelectedTrackId }
      : selectedTrackByProjectId;

    set({
      project: newProject,
      selectedTrackId: nextSelectedTrackId,
      selectedTrackByProjectId: nextSelectedTrackByProjectId,
      undoStack: newUndoStack,
      redoStack: skipUndo ? get().redoStack : [], // Clear redo on new action
      undoIndex: skipUndo ? undoIndex : newUndoStack.length,
      isDirty: skipDirty ? get().isDirty : true,
    });
    
    if (!skipAutosave) {
      get().triggerAutosave();
    }
  },

  /**
   * Undo last action
   */
  undo: () => {
    const { undoStack, undoIndex, project, redoStack } = get();
    
    if (undoIndex === 0) return; // Nothing to undo
    
    const newIndex = undoIndex - 1;
    const previousState = undoStack[newIndex].state;
    
    // Save current state to redo
    const redoAction = {
      description: 'Redo',
      state: JSON.parse(JSON.stringify(project)),
    };
    
    set({
      project: previousState,
      undoIndex: newIndex,
      redoStack: [redoAction, ...redoStack].slice(0, 100),
      isDirty: true,
    });
    
    get().triggerAutosave();
  },
  
  /**
   * Redo last undone action
   */
  redo: () => {
    const { redoStack, project, undoStack, undoIndex } = get();
    
    if (redoStack.length === 0) return; // Nothing to redo
    
    const [redoAction, ...newRedoStack] = redoStack;
    
    // Save current state to undo
    const undoAction = {
      description: 'Undo',
      state: JSON.parse(JSON.stringify(project)),
    };
    
    const newUndoStack = [...undoStack.slice(0, undoIndex), undoAction].slice(-100);
    
    set({
      project: redoAction.state,
      undoStack: newUndoStack,
      redoStack: newRedoStack,
      undoIndex: newUndoStack.length,
      isDirty: true,
    });
    
    get().triggerAutosave();
  },
  
  /**
   * Trigger autosave (debounced 2s)
   */
  triggerAutosave: () => {
    const { autosaveTimeout } = get();
    
    // Clear existing timeout
    if (autosaveTimeout) {
      clearTimeout(autosaveTimeout);
    }
    
    // Set new timeout
    const timeout = setTimeout(() => {
      get().performAutosave();
    }, 2000);
    
    set({ autosaveTimeout: timeout });
  },
  
  /**
   * Perform actual save to IndexedDB
   */
  performAutosave: async () => {
    const { project, isDirty, undoStack } = get();
    
    if (!isDirty || !project) return;
    
    set({ isSaving: true });
    
    try {
      // Save project
      await saveProject(project);
      
      // Save undo history (last 100 actions)
      for (let i = 0; i < undoStack.length; i++) {
        await saveUndoAction(project.projectId, undoStack[i], i);
      }
      
      set({
        isDirty: false,
        isSaving: false,
        lastSaved: Date.now(),
      });
    } catch (error) {
      reportUserError('Autosave failed.', error, { onceKey: 'store:autosave-failed' });
      set({ isSaving: false });
    }
  },
  
  /**
   * Force immediate save (e.g., before export)
   */
  forceSave: async () => {
    const { autosaveTimeout } = get();
    if (autosaveTimeout) {
      clearTimeout(autosaveTimeout);
    }
    await get().performAutosave();
  },
  
  /**
   * Transport controls
   */
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, currentTimeMs: 0 }),
  setCurrentTime: (timeMs) => set({ currentTimeMs: timeMs }),
  
  /**
   * Recording controls
   */
  startRecording: () => set({ isRecording: true }),
  stopRecording: () => set({ isRecording: false }),
  
  /**
   * Update a clip on a track
   */
  updateClip: (trackId, clipId, updates, action = 'update') => {
    const { project, updateProject } = get();
    
    updateProject((proj) => ({
      ...proj,
      tracks: proj.tracks.map(track => {
        if (track.id !== trackId) return track;
        
        if (action === 'add') {
          // Add new clip
          return {
            ...track,
            clips: [...track.clips, updates],
          };
        } else if (action === 'split') {
          const leftClip = updates?.left;
          const rightClip = updates?.right;
          if (!leftClip || !rightClip) return track;
          return {
            ...track,
            clips: track.clips
              .filter(c => c.id !== clipId)
              .concat([leftClip, rightClip]),
          };
        } else if (action === 'delete') {
          // Delete clip
          return {
            ...track,
            clips: track.clips.filter(c => c.id !== clipId),
          };
        } else {
          // Update existing clip
          return {
            ...track,
            clips: track.clips.map(clip =>
              clip.id === clipId ? { ...clip, ...updates } : clip
            ),
          };
        }
      }),
    }), action === 'add' ? 'Add clip' : action === 'delete' ? 'Delete clip' : action === 'split' ? 'Split clip' : 'Update clip');
  },
  
  /**
   * Track selection
   */
  selectTrack: (trackId) => set((state) => {
    const nextSelectedTrackByProjectId = state.currentProjectId
      ? { ...state.selectedTrackByProjectId, [state.currentProjectId]: trackId }
      : state.selectedTrackByProjectId;

    return {
      selectedTrackId: trackId,
      selectedTrackByProjectId: nextSelectedTrackByProjectId,
    };
  }),
}));

export default useStore;
