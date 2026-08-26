import { getTrackNodeByTrackId, normalizeTrackTree } from './trackTree';

const ORDINAL_WORDS = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
  6: 'sixth',
  7: 'seventh',
  8: 'eighth',
  9: 'ninth',
  10: 'tenth',
  11: 'eleventh',
  12: 'twelfth',
  13: 'thirteenth',
  14: 'fourteenth',
  15: 'fifteenth',
  16: 'sixteenth',
  17: 'seventeenth',
  18: 'eighteenth',
  19: 'nineteenth',
  20: 'twentieth',
};

function getOrdinalLabel(position) {
  if (ORDINAL_WORDS[position]) return ORDINAL_WORDS[position];

  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${position}th`;
  }

  const mod10 = position % 10;
  if (mod10 === 1) return `${position}st`;
  if (mod10 === 2) return `${position}nd`;
  if (mod10 === 3) return `${position}rd`;
  return `${position}th`;
}

function getTrackDisplayName(track) {
  if (typeof track?.name === 'string' && track.name.trim()) {
    return track.name.trim();
  }
  return 'Untitled track';
}

function buildTrackPath(normalizedProject, track) {
  const nodeById = new Map((normalizedProject.trackTree || []).map((node) => [node.id, node]));
  const trackNode = getTrackNodeByTrackId(normalizedProject, track.id);
  const segments = [getTrackDisplayName(track)];
  let parentId = trackNode?.parentId ?? null;

  while (parentId) {
    const parentNode = nodeById.get(parentId);
    if (!parentNode || parentNode.kind !== 'group') break;
    segments.unshift(parentNode.name);
    parentId = parentNode.parentId ?? null;
  }

  return segments.join(' / ');
}

function getBlobClipReferences(project, blobId) {
  const normalizedProject = normalizeTrackTree(project);

  return (normalizedProject.tracks || []).flatMap((track) => (
    (track.clips || []).flatMap((clip, clipIndex) => {
      if (clip?.blobId !== blobId) return [];
      return [{
        clipIndex,
        clipLabel: `${getOrdinalLabel(clipIndex + 1)} clip`,
        trackPath: buildTrackPath(normalizedProject, track),
      }];
    })
  ));
}

export function isClipMediaMissing(clip, missingBlobIds, mediaCache = null) {
  if (!clip?.blobId) return true;
  if (mediaCache?.has?.(clip.blobId)) return false;
  if (missingBlobIds instanceof Set) return missingBlobIds.has(clip.blobId);
  if (Array.isArray(missingBlobIds)) return missingBlobIds.includes(clip.blobId);
  return Boolean(missingBlobIds?.has?.(clip.blobId));
}

export function buildBlobReferenceErrorMessage(project, blobId, targetLabel = 'clip audio') {
  const references = getBlobClipReferences(project, blobId);

  if (references.length === 0) {
    return `Failed to load ${targetLabel}.`;
  }

  if (references.length === 1) {
    const [reference] = references;
    return `Failed to load ${targetLabel} for ${reference.trackPath} (${reference.clipLabel}).`;
  }

  const locations = references
    .map((reference) => `${reference.trackPath} (${reference.clipLabel})`)
    .join('; ');
  return `Failed to load ${targetLabel} for ${references.length} clips: ${locations}.`;
}
