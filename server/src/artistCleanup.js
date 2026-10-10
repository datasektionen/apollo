const CREDIT_LIST_KEYS = ['artist', 'compositionLyrics', 'productionEngineering', 'performers'];

export function isArtistRef(ref, type, id) {
  const refType = String(ref?.type || '').trim().toLowerCase();
  const refId = String(ref?.id || ref?.userId || ref?.groupId || ref?.guestId || '').trim();
  return Boolean(type) && Boolean(id) && refType === type && refId === id;
}

export function detachArtistRefs(refs, type, id) {
  if (!Array.isArray(refs)) return { refs, changed: false };
  const next = refs.filter((ref) => !isArtistRef(ref, type, id));
  return { refs: next, changed: next.length !== refs.length };
}

function detachCreditEntry(entry, type, id) {
  if (!entry || typeof entry !== 'object') return { entry, changed: false };
  let next = entry;
  let changed = false;

  for (const key of ['artists', 'artistRefs']) {
    if (!Array.isArray(entry[key])) continue;
    const detached = detachArtistRefs(entry[key], type, id);
    if (detached.changed) {
      next = { ...next, [key]: detached.refs };
      changed = true;
    }
  }

  if (entry.artist && isArtistRef(entry.artist, type, id)) {
    const { artist, ...rest } = next;
    next = rest;
    changed = true;
  }

  if (Array.isArray(entry.members)) {
    const detachedMembers = detachCreditList(entry.members, type, id);
    if (detachedMembers.changed) {
      next = { ...next, members: detachedMembers.entries };
      changed = true;
    }
  }

  return { entry: next, changed };
}

function entryStillHasArtists(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (Array.isArray(entry.artists)) return entry.artists.length > 0;
  if (Array.isArray(entry.artistRefs)) return entry.artistRefs.length > 0;
  if (entry.artist) return true;
  if (Array.isArray(entry.members)) return entry.members.length > 0;
  return true;
}

export function detachCreditList(entries, type, id) {
  if (!Array.isArray(entries)) return { entries, changed: false };
  let changed = false;
  const next = [];
  entries.forEach((entry) => {
    const detached = detachCreditEntry(entry, type, id);
    if (detached.changed) changed = true;
    if (entryStillHasArtists(detached.entry)) next.push(detached.entry);
    else changed = true;
  });
  return { entries: next, changed };
}

export function detachArtistFromCredits(credits, type, id) {
  if (!credits || typeof credits !== 'object' || Array.isArray(credits)) {
    return { credits, changed: false };
  }
  const next = { ...credits };
  let changed = false;
  CREDIT_LIST_KEYS.forEach((key) => {
    if (!(key in credits)) return;
    const detached = detachCreditList(credits[key], type, id);
    if (detached.changed) {
      next[key] = detached.entries;
      changed = true;
    }
  });
  return { credits: next, changed };
}

export function detachArtistFromSnapshot(snapshot = {}, type, id) {
  const next = { ...snapshot };
  let changed = false;

  if (Array.isArray(snapshot.tracks)) {
    next.tracks = snapshot.tracks.map((track) => {
      if (!track || !Array.isArray(track.artistRefs)) return track;
      const detached = detachArtistRefs(track.artistRefs, type, id);
      if (!detached.changed) return track;
      changed = true;
      return { ...track, artistRefs: detached.refs };
    });
  }

  if (Array.isArray(snapshot.trackTree)) {
    next.trackTree = snapshot.trackTree.map((node) => {
      if (!node || !Array.isArray(node.artistRefs)) return node;
      const detached = detachArtistRefs(node.artistRefs, type, id);
      if (!detached.changed) return node;
      changed = true;
      return { ...node, artistRefs: detached.refs };
    });
  }

  if (snapshot.credits) {
    const detached = detachArtistFromCredits(snapshot.credits, type, id);
    if (detached.changed) {
      next.credits = detached.credits;
      changed = true;
    }
  }

  return { snapshot: next, changed };
}
