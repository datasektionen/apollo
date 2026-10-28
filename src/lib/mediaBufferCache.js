// Revision metadata belongs to the local media row, never project/undo state.
const revisions = new WeakMap();
const revisionListeners = new WeakMap();

export function mediaWaveformRevision(media) {
  if (!media?.waveformRevision || !Number.isSafeInteger(media?.blob?.size)) return undefined;
  return {
    waveformRevision: media.waveformRevision,
    blobSize: media.blob.size,
    blobType: media.blob.type || '',
  };
}

export function rememberMediaRevision(buffer, revision) {
  if (!buffer || typeof buffer !== 'object' || !revision) return;
  revisions.set(buffer, revision);
  for (const listener of [...(revisionListeners.get(buffer) || [])]) listener(revision);
}

export function getMediaRevision(buffer) {
  return buffer && typeof buffer === 'object' ? revisions.get(buffer) : undefined;
}

/** Map-compatible playback cache with explicit, synchronous lifecycle notifications. */
export class MediaBufferCache extends Map {
  constructor({ onSet, onDelete, onClear } = {}) {
    super();
    this.listeners = new Set();
    this.revisionSubscriptions = new Map();
    this.onSet = onSet;
    this.onDelete = onDelete;
    this.onClear = onClear;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event) {
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch (error) { console.error('Media cache listener failed', error); }
    }
  }

  set(blobId, buffer, options = {}) {
    const previous = this.get(blobId);
    const revision = options.revision || getMediaRevision(buffer);
    if (previous === buffer && this.has(blobId)) {
      if (revision) {
        this.onSet?.(blobId, buffer, { revision });
        this.notify({ type: 'revision', blobId, buffer, revision });
      }
      return this;
    }
    this.revisionSubscriptions.get(blobId)?.();
    super.set(blobId, buffer);
    if (buffer && typeof buffer === 'object') {
      let listeners = revisionListeners.get(buffer);
      if (!listeners) { listeners = new Set(); revisionListeners.set(buffer, listeners); }
      const listener = (nextRevision) => {
        if (this.get(blobId) !== buffer) return;
        this.onSet?.(blobId, buffer, { revision: nextRevision });
        this.notify({ type: 'revision', blobId, buffer, revision: nextRevision });
      };
      listeners.add(listener);
      this.revisionSubscriptions.set(blobId, () => listeners.delete(listener));
    }
    this.onSet?.(blobId, buffer, revision ? { revision } : {});
    this.notify({ type: previous ? 'replaced' : 'ready', blobId, buffer, previous, revision });
    return this;
  }

  delete(blobId) {
    if (!this.has(blobId)) return false;
    const buffer = this.get(blobId);
    this.revisionSubscriptions.get(blobId)?.();
    this.revisionSubscriptions.delete(blobId);
    const removed = super.delete(blobId);
    this.onDelete?.(blobId, buffer);
    this.notify({ type: 'removed', blobId, buffer });
    return removed;
  }

  clear() {
    for (const unsubscribe of this.revisionSubscriptions.values()) unsubscribe();
    this.revisionSubscriptions.clear();
    super.clear();
    this.onClear?.();
    this.notify({ type: 'cleared' });
  }
}
