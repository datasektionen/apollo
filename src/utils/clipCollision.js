/**
 * Apply an edit as one transaction against the latest project. Conflicting remote
 * edits abort the whole gesture rather than overwriting them or dropping clips.
 */
export function applyClipPatches(project, patches, destinations = {}, {
  baseline = {}, canEditTrack = () => true, minimumDurationMs = 100,
} = {}) {
  const locations = new Map();
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  for (const track of project.tracks) {
    for (const clip of track.clips) locations.set(clip.id, { track, clip });
  }
  const changes = new Map();
  for (const [id, patch] of Object.entries(patches)) {
    const entry = locations.get(id);
    if (!entry) return project;
    const targetId = destinations[id] || entry.track.id;
    if (!tracks.has(targetId) || !canEditTrack(entry.track.id) || !canEditTrack(targetId)) return project;
    const original = baseline[id];
    if (original && (original.trackId !== entry.track.id || Object.keys(original).some((key) =>
      key !== 'trackId' && original[key] !== entry.clip[key]))) return project;
    const next = { ...entry.clip, ...patch };
    const durationMs = next.cropEndMs - next.cropStartMs;
    const durationChanged = durationMs !== entry.clip.cropEndMs - entry.clip.cropStartMs;
    if (![next.timelineStartMs, next.cropStartMs, next.cropEndMs, next.sourceDurationMs].every(Number.isFinite)
      || next.timelineStartMs < 0 || next.cropStartMs < 0 || next.cropEndMs > next.sourceDurationMs
      || durationMs <= 0 || (durationChanged && durationMs < minimumDurationMs)
      || (patch.gainDb !== undefined && (!Number.isFinite(next.gainDb) || next.gainDb < -24 || next.gainDb > 24))) return project;
    if (targetId !== entry.track.id || Object.keys(patch).some((key) => patch[key] !== entry.clip[key])) {
      changes.set(id, { clip: next, trackId: targetId });
    }
  }
  if (!changes.size) return project;
  // Validate only changed ranges: unrelated legacy overlaps must not block a gain edit.
  for (const [id, change] of changes) {
    const original = locations.get(id);
    if (change.trackId === original.track.id && change.clip.timelineStartMs === original.clip.timelineStartMs
      && change.clip.cropStartMs === original.clip.cropStartMs && change.clip.cropEndMs === original.clip.cropEndMs) continue;
    for (const [otherId, entry] of locations) {
      if (otherId === id) continue;
      const other = changes.get(otherId) || { clip: entry.clip, trackId: entry.track.id };
      if (other.trackId === change.trackId && findCollidingClips(change.clip, [other.clip]).length) return project;
    }
  }
  return { ...project, tracks: project.tracks.map((track) => {
    const removed = track.clips.some((clip) => changes.has(clip.id));
    const additions = [...changes.values()].filter((change) => change.trackId === track.id).map((change) => change.clip);
    if (!removed && !additions.length) return track;
    return { ...track, clips: [...track.clips.filter((clip) => !changes.has(clip.id)), ...additions]
      .sort((a, b) => a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id)) };
  }) };
}

/**
 * Clip Collision Detection and Resolution
 * Ensures strict one-clip-per-track-at-a-time rule
 */
import { createId } from './id';

/**
 * Check if two time ranges overlap
 */
function rangesOverlap(start1, end1, start2, end2) {
  return start1 < end2 && start2 < end1;
}

/**
 * Get the effective time range of a clip
 */
function getClipRange(clip) {
  const duration = clip.cropEndMs - clip.cropStartMs;
  return {
    start: clip.timelineStartMs,
    end: clip.timelineStartMs + duration,
  };
}

/**
 * Find all clips that would collide with a proposed clip position/size
 * @param {Object} proposedClip - The clip being moved/resized
 * @param {Array} trackClips - All clips in the track
 * @param {string} excludeClipId - ID of clip to exclude (usually the one being edited)
 * @returns {Array} Array of colliding clips
 */
export function findCollidingClips(proposedClip, trackClips, excludeClipId = null) {
  const proposedRange = getClipRange(proposedClip);
  
  return trackClips.filter(clip => {
    // Don't check against itself
    if (clip.id === excludeClipId) return false;
    
    const clipRange = getClipRange(clip);
    return rangesOverlap(proposedRange.start, proposedRange.end, clipRange.start, clipRange.end);
  });
}

/**
 * Check if a clip move would collide
 * @param {Object} clip - The clip being moved
 * @param {number} newTimelineStartMs - Proposed new position
 * @param {Array} trackClips - All clips in the track
 * @returns {boolean} True if collision would occur
 */
export function wouldMoveCollide(clip, newTimelineStartMs, trackClips) {
  const duration = clip.cropEndMs - clip.cropStartMs;
  const proposedClip = {
    ...clip,
    timelineStartMs: newTimelineStartMs,
  };
  
  const collisions = findCollidingClips(proposedClip, trackClips, clip.id);
  return collisions.length > 0;
}

/**
 * Constrain a clip move to avoid collisions
 * @param {Object} clip - The clip being moved
 * @param {number} proposedTimelineStartMs - Desired new position
 * @param {Array} trackClips - All clips in the track
 * @returns {number} Safe position (may be same as proposed or constrained)
 */
export function constrainClipMove(clip, proposedTimelineStartMs, trackClips) {
  const duration = clip.cropEndMs - clip.cropStartMs;
  
  // Can't move before 0
  if (proposedTimelineStartMs < 0) {
    return 0;
  }
  
  // Check for collisions
  const proposedEnd = proposedTimelineStartMs + duration;
  
  // Find clips that would be in the way
  const otherClips = trackClips
    .filter(c => c.id !== clip.id)
    .map(c => ({
      ...c,
      range: getClipRange(c),
    }))
    .sort((a, b) => a.range.start - b.range.start);
  
  // If moving right, check for clips to the right
  if (proposedTimelineStartMs > clip.timelineStartMs) {
    for (const other of otherClips) {
      if (other.range.start >= clip.timelineStartMs && proposedEnd > other.range.start) {
        // Would collide - constrain to just before this clip
        return Math.max(clip.timelineStartMs, other.range.start - duration);
      }
    }
  }
  // If moving left, check for clips to the left
  else if (proposedTimelineStartMs < clip.timelineStartMs) {
    for (let i = otherClips.length - 1; i >= 0; i--) {
      const other = otherClips[i];
      const currentEnd = clip.timelineStartMs + duration;
      if (other.range.end <= currentEnd && proposedTimelineStartMs < other.range.end) {
        // Would collide - constrain to just after this clip
        return Math.min(clip.timelineStartMs, other.range.end);
      }
    }
  }
  
  return proposedTimelineStartMs;
}

/**
 * Constrain crop start to avoid collisions
 * @param {Object} clip - The clip being cropped
 * @param {number} proposedCropStartMs - Desired new crop start
 * @param {Array} trackClips - All clips in the track
 * @returns {number} Safe crop start (may be constrained)
 */
export function constrainCropStart(clip, proposedCropStartMs, trackClips) {
  // Can't crop before source start
  if (proposedCropStartMs < 0) {
    proposedCropStartMs = 0;
  }
  
  // Can't crop past crop end (maintain minimum 100ms)
  const maxCropStart = clip.cropEndMs - 100;
  if (proposedCropStartMs > maxCropStart) {
    return maxCropStart;
  }
  
  const cropDelta = proposedCropStartMs - clip.cropStartMs;
  const newTimelineStartMs = clip.timelineStartMs + cropDelta;
  
  // Check for collision with previous clip
  const otherClips = trackClips
    .filter(c => c.id !== clip.id)
    .map(c => ({
      ...c,
      range: getClipRange(c),
    }))
    .sort((a, b) => a.range.start - b.range.start);
  
  // Find clips to the left
  for (let i = otherClips.length - 1; i >= 0; i--) {
    const other = otherClips[i];
    if (other.range.end <= clip.timelineStartMs && newTimelineStartMs < other.range.end) {
      // Would collide - constrain to not go past the other clip's end
      const maxNewStart = other.range.end;
      const constrainedCropDelta = maxNewStart - clip.timelineStartMs;
      return clip.cropStartMs + constrainedCropDelta;
    }
  }
  
  return proposedCropStartMs;
}

/**
 * Constrain crop end to avoid collisions
 * @param {Object} clip - The clip being cropped
 * @param {number} proposedCropEndMs - Desired new crop end
 * @param {Array} trackClips - All clips in the track
 * @returns {number} Safe crop end (may be constrained)
 */
export function constrainCropEnd(clip, proposedCropEndMs, trackClips) {
  // Can't extend beyond source duration
  if (proposedCropEndMs > clip.sourceDurationMs) {
    proposedCropEndMs = clip.sourceDurationMs;
  }
  
  // Can't crop before crop start (maintain minimum 100ms)
  const minCropEnd = clip.cropStartMs + 100;
  if (proposedCropEndMs < minCropEnd) {
    return minCropEnd;
  }
  
  const newDuration = proposedCropEndMs - clip.cropStartMs;
  const newTimelineEndMs = clip.timelineStartMs + newDuration;
  
  // Check for collision with next clip
  const otherClips = trackClips
    .filter(c => c.id !== clip.id)
    .map(c => ({
      ...c,
      range: getClipRange(c),
    }))
    .sort((a, b) => a.range.start - b.range.start);
  
  // Find clips to the right
  const currentEnd = clip.timelineStartMs + (clip.cropEndMs - clip.cropStartMs);
  for (const other of otherClips) {
    if (other.range.start >= currentEnd && newTimelineEndMs > other.range.start) {
      // Would collide - constrain to not go past the other clip's start
      const maxNewEnd = other.range.start;
      const maxDuration = maxNewEnd - clip.timelineStartMs;
      return clip.cropStartMs + maxDuration;
    }
  }
  
  return proposedCropEndMs;
}

/**
 * Process recording overwrites - crop or delete existing clips
 * @param {number} recordingStartMs - When recording started
 * @param {number} recordingEndMs - Current recording position
 * @param {Array} trackClips - All clips in the track
 * @returns {Array} Updated clips array (some may be cropped or removed)
 */
export function processRecordingOverwrites(recordingStartMs, recordingEndMs, trackClips) {
  return trackClips
    .flatMap(clip => {
      const clipRange = getClipRange(clip);
      
      // Check if recording overlaps with this clip
      if (!rangesOverlap(recordingStartMs, recordingEndMs, clipRange.start, clipRange.end)) {
        // No overlap - keep as is
        return [clip];
      }
      
      // Recording overlaps with this clip
      console.log('Recording overlap detected:', {
        recordingStart: recordingStartMs,
        recordingEnd: recordingEndMs,
        clipStart: clipRange.start,
        clipEnd: clipRange.end,
      });
      
      // Case 1: Recording completely covers the clip - delete it
      if (recordingStartMs <= clipRange.start && recordingEndMs >= clipRange.end) {
        console.log('Case 1: Deleting completely covered clip');
        return []; // Remove from array
      }
      
      // Case 2: Recording starts before clip and ends inside it - crop from left
      if (recordingStartMs <= clipRange.start && recordingEndMs < clipRange.end) {
        const amountOverwritten = recordingEndMs - clipRange.start;
        const remainingDuration = clipRange.end - recordingEndMs;
        
        // Delete if remaining duration is too small
        if (remainingDuration < 100) {
          console.log('Case 2: Deleting clip - remaining duration too small:', remainingDuration);
          return [];
        }
        
        console.log('Case 2: Cropping from left, amount:', amountOverwritten);
        return [{
          ...clip,
          timelineStartMs: recordingEndMs,
          cropStartMs: clip.cropStartMs + amountOverwritten,
        }];
      }
      
      // Case 3: Recording starts inside clip and ends after it - crop from right
      if (recordingStartMs > clipRange.start && recordingEndMs >= clipRange.end) {
        const newDuration = recordingStartMs - clipRange.start;
        
        // Delete if new duration is too small
        if (newDuration < 100) {
          console.log('Case 3: Deleting clip - new duration too small:', newDuration);
          return [];
        }
        
        console.log('Case 3: Cropping from right, new duration:', newDuration);
        return [{
          ...clip,
          cropEndMs: clip.cropStartMs + newDuration,
        }];
      }
      
      // Case 4: Recording is completely inside the clip - split into left and right parts
      if (recordingStartMs > clipRange.start && recordingEndMs < clipRange.end) {
        const leftDuration = recordingStartMs - clipRange.start;
        const rightDuration = clipRange.end - recordingEndMs;
        
        const parts = [];
        
        // Add left part if it's long enough
        if (leftDuration >= 100) {
          const leftPart = {
            ...clip,
            cropEndMs: clip.cropStartMs + leftDuration,
          };
          parts.push(leftPart);
          console.log('Case 4: Keeping left part, duration:', leftDuration);
        } else {
          console.log('Case 4: Left part too small, skipping:', leftDuration);
        }
        
        // Add right part if it's long enough
        if (rightDuration >= 100) {
          const amountCropped = recordingEndMs - clipRange.start;
          const rightPart = {
            ...clip,
            id: createId(), // New ID for the split part
            timelineStartMs: recordingEndMs,
            cropStartMs: clip.cropStartMs + amountCropped,
          };
          parts.push(rightPart);
          console.log('Case 4: Keeping right part, duration:', rightDuration);
        } else {
          console.log('Case 4: Right part too small, skipping:', rightDuration);
        }
        
        // Return both parts (or empty if both too small)
        return parts;
      }
      
      return [clip];
    });
}

/**
 * Validate a new clip addition doesn't collide
 * @param {Object} newClip - The clip to be added
 * @param {Array} trackClips - Existing clips in the track
 * @returns {boolean} True if safe to add
 */
export function canAddClip(newClip, trackClips) {
  const collisions = findCollidingClips(newClip, trackClips);
  return collisions.length === 0;
}

/**
 * Find a safe position to add a clip (e.g., for paste/duplicate)
 * @param {Object} newClip - The clip to be added
 * @param {Array} trackClips - Existing clips in the track
 * @param {number} preferredStartMs - Preferred position
 * @returns {number|null} Safe position or null if no space found
 */
export function findSafePosition(newClip, trackClips, preferredStartMs) {
  const duration = newClip.cropEndMs - newClip.cropStartMs;
  
  // Try preferred position first
  const proposedClip = {
    ...newClip,
    timelineStartMs: preferredStartMs,
  };
  
  if (canAddClip(proposedClip, trackClips)) {
    return preferredStartMs;
  }
  
  // Sort clips by position
  const sortedClips = [...trackClips]
    .map(c => getClipRange(c))
    .sort((a, b) => a.start - b.start);
  
  // Try to place after the last clip
  if (sortedClips.length > 0) {
    const lastClip = sortedClips[sortedClips.length - 1];
    return lastClip.end;
  }
  
  // Track is empty
  return 0;
}
