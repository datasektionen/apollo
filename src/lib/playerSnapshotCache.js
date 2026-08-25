export function readCachedProjectSnapshot(cache, projectId) {
  const id = String(projectId || '').trim();
  if (!id || !cache || typeof cache.get !== 'function') return null;
  const entry = cache.get(id);
  if (!entry?.snapshot || typeof entry.snapshot !== 'object') return null;
  return {
    latestSeq: Number(entry.latestSeq || 0),
    snapshot: entry.snapshot,
  };
}

export function writeCachedProjectSnapshot(cache, projectId, payload) {
  const id = String(projectId || '').trim();
  if (!id || !cache || typeof cache.set !== 'function') return null;
  const snapshot = payload?.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const entry = {
    latestSeq: Number(payload.latestSeq || 0),
    snapshot,
  };
  cache.set(id, entry);
  return entry;
}

export async function resolvePlayerProjectSnapshot({
  projectId,
  cache,
  fetchBootstrap,
} = {}) {
  const id = String(projectId || '').trim();
  if (!id) {
    throw new Error('Project snapshot missing');
  }
  if (typeof fetchBootstrap !== 'function') {
    throw new Error('Project snapshot missing');
  }

  const cached = readCachedProjectSnapshot(cache, id);
  if (cached) {
    void Promise.resolve()
      .then(() => fetchBootstrap(cached.latestSeq))
      .then((payload) => {
        writeCachedProjectSnapshot(cache, id, payload);
      })
      .catch(() => {});
    return {
      snapshot: cached.snapshot,
      latestSeq: cached.latestSeq,
      reused: true,
    };
  }

  const payload = await fetchBootstrap(0);
  const snapshot = payload?.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Project snapshot missing');
  }
  writeCachedProjectSnapshot(cache, id, payload);
  return {
    snapshot,
    latestSeq: Number(payload.latestSeq || 0),
    reused: false,
  };
}
