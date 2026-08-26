import { GROUP_ROLE_CHOIRS, TRACK_ROLE_CHOIR, isChoirPartRole, isChoirRole } from './trackRoles';
import { getEffectiveTrackMix } from './trackTree';

function readStoredPan(entity) {
  const value = Number(entity?.autoPanStoredPan);
  return Number.isFinite(value) ? value : null;
}

function withAutoPanApplied(entity, nextPan) {
  const stored = readStoredPan(entity);
  const previousPan = Number.isFinite(entity?.pan) ? entity.pan : 0;
  return {
    ...entity,
    autoPanStoredPan: stored === null ? previousPan : stored,
    pan: nextPan,
  };
}

function restoreAutoPanStoredPan(entity) {
  const stored = readStoredPan(entity);
  if (stored === null) return entity;
  const { autoPanStoredPan: _storedPan, ...rest } = entity;
  return {
    ...rest,
    pan: stored,
  };
}

function dropAutoPanStoredPan(entity) {
  if (!entity || !Object.prototype.hasOwnProperty.call(entity, 'autoPanStoredPan')) {
    return entity;
  }
  const { autoPanStoredPan: _storedPan, ...rest } = entity;
  return rest;
}

const STRATEGY_SOLVER_BY_ID = {
  'balanced-highest-middle': 'Balanced Highest Middle',
  'balanced-lowest-middle': 'Balanced Lowest Middle',
  'forced-highest-middle': 'Forced Highest Middle',
  'forced-lowest-middle': 'Forced Lowest Middle',
  'lowest-highest': 'Lowest-Highest',
};

export const AUTO_PAN_STRATEGIES = [
  { id: 'balanced-highest-middle', label: 'Balanced Highest Middle' },
  { id: 'balanced-lowest-middle', label: 'Balanced Lowest Middle' },
  { id: 'forced-highest-middle', label: 'Forced Highest Middle' },
  { id: 'forced-lowest-middle', label: 'Forced Lowest Middle' },
  { id: 'lowest-highest', label: 'Lowest-Highest' },
];

export const DEFAULT_AUTO_PAN_SETTINGS = {
  enabled: false,
  strategy: 'balanced-highest-middle',
  inverted: false,
  manualChoirParts: false,
  rangeLimit: 100,
  spreadK: 2,
};

export function normalizeAutoPanSettings(settings = {}) {
  const next = {
    ...DEFAULT_AUTO_PAN_SETTINGS,
    ...settings,
  };
  if (!STRATEGY_SOLVER_BY_ID[next.strategy]) {
    next.strategy = DEFAULT_AUTO_PAN_SETTINGS.strategy;
  }
  next.rangeLimit = Number.isFinite(next.rangeLimit)
    ? next.rangeLimit
    : DEFAULT_AUTO_PAN_SETTINGS.rangeLimit;
  next.spreadK = Number.isFinite(next.spreadK)
    ? next.spreadK
    : DEFAULT_AUTO_PAN_SETTINGS.spreadK;
  next.inverted = Boolean(next.inverted);
  next.manualChoirParts = Boolean(next.manualChoirParts);
  return next;
}

export function normalizeProjectAutoPan(project) {
  if (!project) return project;
  if (project.autoPan) {
    return { ...project, autoPan: normalizeAutoPanSettings(project.autoPan) };
  }
  return { ...project, autoPan: normalizeAutoPanSettings() };
}

function getNeighborsDiff(perm) {
  const diffs = [];
  for (let i = 0; i < perm.length - 1; i += 1) {
    diffs.push(Math.abs(perm[i] - perm[i + 1]));
  }
  return diffs;
}

function filterA(candidates) {
  let bestScore = -1;
  let scored = [];

  for (const perm of candidates) {
    const diffs = getNeighborsDiff(perm);
    const minDiff = Math.min(...diffs);
    if (minDiff > bestScore) {
      bestScore = minDiff;
      scored = [perm];
    } else if (minDiff === bestScore) {
      scored.push(perm);
    }
  }

  return scored;
}

function filterB(candidates) {
  let bestScore = -1;
  let scored = [];

  for (const perm of candidates) {
    const diffs = getNeighborsDiff(perm);
    const totalDiff = diffs.reduce((sum, value) => sum + value, 0);
    if (totalDiff > bestScore) {
      bestScore = totalDiff;
      scored = [perm];
    } else if (totalDiff === bestScore) {
      scored.push(perm);
    }
  }

  return scored;
}

function filterC(candidates, value) {
  const n = candidates[0].length;
  const targetIndex = Math.ceil((n - 1) / 2);

  let bestDist = Number.POSITIVE_INFINITY;
  let bestGoodSide = false;
  let scored = [];

  for (const perm of candidates) {
    const indexOfVal = perm.indexOf(value);
    const goodSide = indexOfVal >= targetIndex;
    const dist = Math.abs(indexOfVal - targetIndex);

    if (dist < bestDist) {
      bestDist = dist;
      bestGoodSide = goodSide;
      scored = [perm];
    } else if (dist === bestDist) {
      if (bestGoodSide) {
        if (goodSide) scored.push(perm);
      } else {
        if (!goodSide) scored.push(perm);
        if (goodSide) {
          scored = [perm];
          bestGoodSide = true;
        }
      }
    }
  }

  return scored;
}

function filterD(candidates, value) {
  const n = candidates[0].length;
  const targetIndex = Math.floor((n - 1) / 2);

  let bestDist = Number.POSITIVE_INFINITY;
  let bestGoodSide = false;
  let scored = [];

  for (const perm of candidates) {
    const indexOfVal = perm.indexOf(value);
    const goodSide = indexOfVal <= targetIndex;
    const dist = Math.abs(indexOfVal - targetIndex);

    if (dist < bestDist) {
      bestDist = dist;
      bestGoodSide = goodSide;
      scored = [perm];
    } else if (dist === bestDist) {
      if (bestGoodSide) {
        if (goodSide) scored.push(perm);
      } else {
        if (!goodSide) scored.push(perm);
        if (goodSide) {
          scored = [perm];
          bestGoodSide = true;
        }
      }
    }
  }

  return scored;
}

function generatePermutations(values) {
  const results = [];
  const used = new Array(values.length).fill(false);
  const current = [];

  const backtrack = () => {
    if (current.length === values.length) {
      results.push([...current]);
      return;
    }
    for (let i = 0; i < values.length; i += 1) {
      if (used[i]) continue;
      used[i] = true;
      current.push(values[i]);
      backtrack();
      current.pop();
      used[i] = false;
    }
  };

  backtrack();
  return results;
}

function solveOrder(n, strategyId) {
  const values = Array.from({ length: n }, (_, i) => i + 1);
  const strategy = STRATEGY_SOLVER_BY_ID[strategyId] || STRATEGY_SOLVER_BY_ID[DEFAULT_AUTO_PAN_SETTINGS.strategy];

  if (strategy === 'Lowest-Highest') {
    return values;
  }

  if (n > 10) {
    return values;
  }

  let candidates = generatePermutations(values);
  let orderList = [];

  if (strategy === 'Balanced Highest Middle') {
    orderList = ['A', 'B', ['LOOP', ['C', 'D']]];
  } else if (strategy === 'Balanced Lowest Middle') {
    orderList = ['A', 'B', ['LOOP', ['D', 'C']]];
  } else if (strategy === 'Forced Highest Middle') {
    orderList = ['C', 'A', 'B', 'D', 'STEP', ['LOOP', ['C', 'D']]];
  } else if (strategy === 'Forced Lowest Middle') {
    orderList = ['D', 'A', 'B', 'C', 'STEP', ['LOOP', ['D', 'C']]];
  }

  let lowVal = 1;
  let highVal = n;

  for (const step of orderList) {
    if (candidates.length <= 1) break;

    if (step === 'A') {
      candidates = filterA(candidates);
    } else if (step === 'B') {
      candidates = filterB(candidates);
    } else if (step === 'C') {
      candidates = filterC(candidates, lowVal);
    } else if (step === 'D') {
      candidates = filterD(candidates, highVal);
    } else if (step === 'STEP') {
      lowVal += 1;
      highVal -= 1;
    } else if (Array.isArray(step) && step[0] === 'LOOP') {
      while (true) {
        for (const arg of step[1]) {
          if (arg === 'C') {
            candidates = filterC(candidates, lowVal);
          } else if (arg === 'D') {
            candidates = filterD(candidates, highVal);
          }
          if (candidates.length <= 1) break;
        }
        if (candidates.length <= 1) break;
        lowVal += 1;
        highVal -= 1;
      }
    }
  }

  return candidates[0] || values;
}

export function getChoirPanPositions(n, rangeLimit = 100, spreadK = 2) {
  if (n <= 1) return [0];
  const maxPan = (rangeLimit * (n - 1)) / (n + spreadK);
  const panStep = (2 * maxPan) / (n - 1);
  const results = [];
  let current = -maxPan;

  for (let i = 0; i < n; i += 1) {
    results.push(current);
    current += panStep;
  }

  return results;
}

function getChoirPartNumber(role) {
  if (!isChoirPartRole(role)) return null;
  const value = Number(role.split('-').pop());
  return Number.isFinite(value) ? value : null;
}

function parseUnitTarget(unitId, fallbackTrackId) {
  if (typeof unitId === 'string' && unitId.startsWith('group:')) {
    return {
      kind: 'group',
      id: unitId.slice('group:'.length),
    };
  }
  if (typeof unitId === 'string' && unitId.startsWith('track:')) {
    return {
      kind: 'track',
      id: unitId.slice('track:'.length),
    };
  }
  return {
    kind: 'track',
    id: fallbackTrackId,
  };
}

function getChoirUnits(project, settings) {
  const mix = getEffectiveTrackMix(project);
  const unitsById = new Map();

  for (const trackId of mix.orderedTrackIds) {
    const state = mix.statesByTrackId.get(trackId);
    if (!state || state.muted || state.effectiveRole !== TRACK_ROLE_CHOIR) continue;
    const unitId = state.choirUnitId || state.roleUnitId || `track:${trackId}`;
    const target = parseUnitTarget(unitId, trackId);
    if (!unitsById.has(unitId)) {
      unitsById.set(unitId, {
        unitId,
        role: state.choirRole,
        label: state.choirUnitName || state.roleUnitName || `Track ${trackId}`,
        targetKind: target.kind,
        targetId: target.id,
        trackIds: [],
      });
    }
    unitsById.get(unitId).trackIds.push(trackId);
  }

  const units = Array.from(unitsById.values());
  if (!settings.manualChoirParts) {
    return units.map((unit, idx) => ({ ...unit, partIndex: idx + 1 }));
  }

  const partNumbers = Array.from(
    new Set(
      units
        .map((unit) => getChoirPartNumber(unit.role))
        .filter((value) => Number.isFinite(value))
    )
  ).sort((a, b) => a - b);
  const partIndexByNumber = new Map(partNumbers.map((value, idx) => [value, idx + 1]));

  const unitsWithPartIndex = units.map((unit) => ({
    ...unit,
    partIndex: partIndexByNumber.get(getChoirPartNumber(unit.role)) || null,
  }));

  const assigned = new Set(
    unitsWithPartIndex
      .map((unit) => unit.partIndex)
      .filter((value) => Number.isFinite(value))
  );

  let nextPartIndex = 1;
  return unitsWithPartIndex.map((unit) => {
    if (unit.partIndex !== null) return unit;
    while (assigned.has(nextPartIndex)) {
      nextPartIndex += 1;
    }
    const filled = { ...unit, partIndex: nextPartIndex };
    assigned.add(nextPartIndex);
    nextPartIndex += 1;
    return filled;
  });
}

export function applyChoirAutoPanToProject(project, settingsOverride = {}) {
  if (!project) return { project, panUpdates: null };

  const nextSettings = normalizeAutoPanSettings({
    ...project.autoPan,
    ...settingsOverride,
  });

  if (!nextSettings.enabled) {
    return {
      project: {
        ...project,
        autoPan: nextSettings,
        tracks: (project.tracks || []).map(dropAutoPanStoredPan),
        trackTree: (project.trackTree || []).map((node) => (
          node.kind === 'group' ? dropAutoPanStoredPan(node) : node
        )),
      },
      panUpdates: null,
    };
  }

  const choirUnits = getChoirUnits(project, nextSettings);
  const n = nextSettings.manualChoirParts
    ? Array.from(new Set(choirUnits.map((unit) => unit.partIndex))).length
    : choirUnits.length;

  const beforeMix = getEffectiveTrackMix(project);
  const panUpdates = {};
  const panByTrackId = new Map();
  const panByGroupNodeId = new Map();

  if (choirUnits.length > 0 && n > 0) {
    const order = solveOrder(n, nextSettings.strategy);
    const pans = getChoirPanPositions(n, nextSettings.rangeLimit, nextSettings.spreadK);
    const panByPartIndex = {};
    order.forEach((partIndex, positionIndex) => {
      panByPartIndex[partIndex] = pans[positionIndex];
    });

    const panByUnitId = new Map();
    choirUnits.forEach((unit, idx) => {
      const partIndex = nextSettings.manualChoirParts ? unit.partIndex : (idx + 1);
      if (!partIndex) return;
      const nextPanRaw = panByPartIndex[partIndex];
      if (!Number.isFinite(nextPanRaw)) return;
      const nextPan = Math.max(-100, Math.min(100, nextSettings.inverted ? -nextPanRaw : nextPanRaw));
      panByUnitId.set(unit.unitId, nextPan);
    });

    choirUnits.forEach((unit) => {
      const unitPan = panByUnitId.get(unit.unitId);
      if (!Number.isFinite(unitPan)) return;
      if (unit.targetKind === 'group' && unit.targetId) {
        panByGroupNodeId.set(unit.targetId, unitPan);
        return;
      }
      for (const trackId of unit.trackIds) {
        panByTrackId.set(trackId, unitPan);
      }
    });
  }

  const nextTracks = (project.tracks || []).map((track) => {
    if (panByTrackId.has(track.id)) {
      return withAutoPanApplied(track, panByTrackId.get(track.id));
    }
    const state = beforeMix.statesByTrackId.get(track.id);
    if (state?.effectiveRole === TRACK_ROLE_CHOIR) {
      return track;
    }
    return restoreAutoPanStoredPan(track);
  });
  const nextTrackTree = (project.trackTree || []).map((node) => {
    if (node.kind !== 'group') return node;
    if (panByGroupNodeId.has(node.id)) {
      return withAutoPanApplied(node, panByGroupNodeId.get(node.id));
    }
    if (isChoirRole(node.role) || node.role === GROUP_ROLE_CHOIRS) {
      return node;
    }
    return restoreAutoPanStoredPan(node);
  });

  const nextProject = {
    ...project,
    autoPan: nextSettings,
    tracks: nextTracks,
    trackTree: nextTrackTree,
  };

  const afterMix = getEffectiveTrackMix(nextProject);
  for (const trackId of afterMix.orderedTrackIds) {
    const afterState = afterMix.statesByTrackId.get(trackId);
    const beforeState = beforeMix.statesByTrackId.get(trackId);
    if (!afterState) continue;
    if (!beforeState || beforeState.effectivePan !== afterState.effectivePan) {
      panUpdates[trackId] = afterState.effectivePan;
    }
  }

  return {
    project: nextProject,
    panUpdates: Object.keys(panUpdates).length > 0 ? panUpdates : null,
  };
}
