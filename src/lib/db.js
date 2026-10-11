import Dexie from 'dexie';
import { createId } from '../utils/id';

/**
 * Apollo IndexedDB Database
 * 
 * Stores:
 * - projects: Full project metadata and state
 * - media: Audio blob storage with metadata
 * - undo: Undo/redo history (last 100 actions per project)
 * - exportDirs: Last-used export directory handles
 * - localProjectState: Per-device project UI/playback state
 * - remoteProjects: Remote sync metadata by project id
 * - syncQueue: Pending sync operations for offline replay
 */
class ApolloDB extends Dexie {
  constructor() {
    super('ApolloDB');
    
    this.version(1).stores({
      // Projects table
      // Primary key: projectId
      projects: 'projectId, projectName, lastModified',
      
      // Media blobs table
      // Primary key: blobId
      // Stores audio data as Blob objects
      media: 'blobId, fileName, sampleRate, durationMs, channels, createdAt',
      
      // Undo/redo history table
      // Composite key: [projectId, actionIndex]
      // Stores last 100 actions per project (circular buffer)
      undo: '[projectId+actionIndex], projectId, actionIndex, timestamp',
    });

    this.version(2).stores({
      projects: 'projectId, projectName, lastModified',
      media: 'blobId, fileName, sampleRate, durationMs, channels, createdAt',
      undo: '[projectId+actionIndex], projectId, actionIndex, timestamp',
      exportDirs: 'id, updatedAt',
    });

    this.version(3).stores({
      projects: 'projectId, projectName, lastModified',
      media: 'blobId, fileName, sampleRate, durationMs, channels, createdAt',
      undo: '[projectId+actionIndex], projectId, actionIndex, timestamp',
      exportDirs: 'id, updatedAt',
      remoteProjects: 'projectId, serverProjectId, updatedAt',
      syncQueue: 'id, projectId, status, updatedAt',
    });

    this.version(4).stores({
      projects: 'projectId, projectName, lastModified',
      media: 'blobId, fileName, sampleRate, durationMs, channels, createdAt',
      undo: '[projectId+actionIndex], projectId, actionIndex, timestamp',
      exportDirs: 'id, updatedAt',
      remoteProjects: 'projectId, serverProjectId, updatedAt',
      syncQueue: 'id, projectId, status, updatedAt',
      localProjectState: 'projectId, updatedAt',
    });

    this.projects = this.table('projects');
    this.media = this.table('media');
    this.undo = this.table('undo');
    this.exportDirs = this.table('exportDirs');
    this.remoteProjects = this.table('remoteProjects');
    this.syncQueue = this.table('syncQueue');
    this.localProjectState = this.table('localProjectState');
  }
}

// Singleton instance
export const db = new ApolloDB();

/**
 * Save a project to IndexedDB
 */
export async function saveProject(project) {
  const projectData = {
    ...project,
    lastModified: Date.now(),
  };
  
  await db.projects.put(projectData);
  return projectData;
}

/**
 * Delete a project and its undo history
 */
export async function deleteProject(projectId) {
  await db.transaction('rw', [db.projects, db.undo, db.remoteProjects, db.syncQueue, db.localProjectState], async () => {
    await db.projects.delete(projectId);
    await db.undo.where('projectId').equals(projectId).delete();
    await db.remoteProjects.delete(projectId);
    await db.syncQueue.where('projectId').equals(projectId).delete();
    await db.syncQueue.delete(`${projectId}:pending`);
    await db.localProjectState.delete(projectId);
  });
}

/**
 * Store audio blob in media table
 */
export async function storeMediaBlob(fileName, audioBuffer, blob, blobId = null) {
  const id = blobId || createId();
  
  const mediaData = {
    blobId: id,
    fileName,
    sampleRate: audioBuffer.sampleRate,
    durationMs: (audioBuffer.duration * 1000), // Convert to ms
    channels: audioBuffer.numberOfChannels,
    blob, // Store the actual Blob
    createdAt: Date.now(),
  };
  
  await db.media.put(mediaData);
  
  return id;
}

/**
 * Retrieve media blob
 */
export async function getMediaBlob(blobId) {
  const media = await db.media.get(blobId);
  if (!media) {
    throw new Error(`Media blob ${blobId} not found`);
  }
  return media;
}

/**
 * Which of these ids already have a media row.
 * Reads primary keys only, so the audio blobs stay unread.
 */
export async function listStoredMediaBlobIds(blobIds) {
  const ids = [];
  const seen = new Set();
  (Array.isArray(blobIds) ? blobIds : []).forEach((blobId) => {
    if (!blobId || seen.has(blobId)) return;
    seen.add(blobId);
    ids.push(blobId);
  });
  if (ids.length === 0) return [];
  return db.media.where('blobId').anyOf(ids).primaryKeys();
}

/**
 * Save undo/redo action (circular buffer, max 100)
 */
export async function saveUndoAction(projectId, action, currentIndex) {
  const actionIndex = currentIndex % 100; // Circular buffer
  
  const undoData = {
    projectId,
    actionIndex,
    action,
    timestamp: Date.now(),
  };
  
  await db.undo.put(undoData);
}

/**
 * Load undo history for a project
 */
export async function loadUndoHistory(projectId) {
  const actions = await db.undo
    .where('projectId')
    .equals(projectId)
    .sortBy('actionIndex');
  
  return actions.map(a => a.action);
}

/**
 * Save directory handle for export location.
 */
export async function saveExportDirectoryHandle(id, handle) {
  await db.exportDirs.put({
    id,
    handle,
    updatedAt: Date.now(),
  });
}

/**
 * Load directory handle for export location.
 */
export async function loadExportDirectoryHandle(id) {
  const row = await db.exportDirs.get(id);
  return row?.handle || null;
}

/**
 * Export utilities
 */

/**
 * Export project as JSON
 * Returns project metadata only (references blobs by ID)
 */
export function exportProjectJSON(project) {
  return JSON.stringify(project, null, 2);
}

/**
 * Save remote project metadata (for hybrid local/server sync)
 */
export async function saveRemoteProjectMeta(meta) {
  if (!meta?.projectId) return;
  await db.remoteProjects.put({
    ...meta,
    updatedAt: Date.now(),
  });
}

export async function loadRemoteProjectMeta(projectId) {
  return await db.remoteProjects.get(projectId);
}

/**
 * Queue or replace pending sync operation for a project.
 * Uses one snapshot-style pending item per project id.
 */
export async function upsertPendingSyncOp(projectId, payload) {
  const id = `${projectId}:pending`;
  await db.syncQueue.put({
    id,
    projectId,
    payload,
    status: 'pending',
    updatedAt: Date.now(),
  });
}

export async function getPendingSyncOp(projectId) {
  const id = `${projectId}:pending`;
  return await db.syncQueue.get(id);
}

export async function clearPendingSyncOp(projectId) {
  const id = `${projectId}:pending`;
  await db.syncQueue.delete(id);
}

export async function loadLocalProjectState(projectId) {
  if (!projectId) return null;
  return await db.localProjectState.get(projectId);
}

export async function saveLocalProjectState(projectId, updates = {}) {
  if (!projectId) return null;
  const existing = await db.localProjectState.get(projectId);
  const next = {
    ...(existing || {}),
    ...updates,
    projectId,
    updatedAt: Date.now(),
  };
  await db.localProjectState.put(next);
  return next;
}
