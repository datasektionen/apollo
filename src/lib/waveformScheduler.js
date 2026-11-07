import { yieldWaveformTask } from './waveformData';

/**
 * Cooperative jobs return true to continue. Priority is bounded; waiting jobs always age past it.
 * Each animation frame runs up to budgetMs. When no input arrived within interactionMs, settled
 * views keep refining in follow-up tasks of at most budgetMs each, until idleBudgetMs after the
 * frame started, stopping as soon as inputPending() reports queued input. The frame callback
 * itself never grows, so input handled later in that frame is not delayed by refinement.
 * interactionMs spans the gaps between wheel notches or slow slider steps of one gesture.
 * Lower tiers run first: 0 on screen, 1 left/right margins, 2 rows above and below,
 * 3 the return-to-start window. background: true is tier 1.
 */
export function createWaveformScheduler({
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  now = () => performance.now(),
  budgetMs = 4,
  idleBudgetMs = budgetMs,
  interactionMs = 200,
  lastInputAt = () => -Infinity,
  inputPending = () => false,
  postTask = (callback) => { void yieldWaveformTask().then(callback); },
  maxSlicesPerFrame = 128,
} = {}) {
  const jobs = new Map();
  let frame = null;
  let flushing = false;
  let running;
  let turn = 0;
  let sequence = 0;
  let frameStart = -Infinity;
  let idlePosted = false;
  const stats = {
    frames: 0, idleTasks: 0, slices: 0, completed: 0, cancelled: 0, errors: 0, totalMs: 0, maxFrameMs: 0, maxWaitSlices: 0,
  };
  function request() {
    if (!flushing && frame === null && jobs.size) frame = requestFrame(flush);
  }
  const settled = (at) => at - lastInputAt() >= interactionMs && !inputPending();
  function runSlices(start, deadline, yieldToInput) {
    const budget = { now, deadline };
    let slices = 0;
    flushing = true;
    try {
      do {
        let entry;
        for (const candidate of jobs.values()) {
          if (entry && candidate.tier !== entry.tier) {
            if (candidate.tier < entry.tier) entry = candidate;
            continue;
          }
          const score = candidate.waitSince - candidate.priority * 2;
          const best = entry && entry.waitSince - entry.priority * 2;
          if (!entry || score < best || (score === best && candidate.order < entry.order)) entry = candidate;
        }
        if (!entry) break;
        jobs.delete(entry.key);
        if (entry.tier === 0) stats.maxWaitSlices = Math.max(stats.maxWaitSlices, turn - entry.waitSince);
        running = entry;
        let more = false;
        try { more = entry.draw(budget) === true; }
        catch (error) { stats.errors += 1; console.error('Waveform draw failed', error); }
        running = undefined;
        turn += 1;
        slices += 1;
        stats.slices += 1;
        if (more && !entry.cancelled && !jobs.has(entry.key)) {
          entry.waitSince = turn;
          entry.order = ++sequence;
          jobs.set(entry.key, entry);
        } else if (!entry.cancelled) stats.completed += 1;
      } while (jobs.size && slices < maxSlicesPerFrame && now() < deadline && !(yieldToInput && inputPending()));
    } finally {
      running = undefined;
      const elapsed = now() - start;
      stats.totalMs += elapsed;
      stats.maxFrameMs = Math.max(stats.maxFrameMs, elapsed);
      flushing = false;
    }
  }
  function postIdle() {
    if (idlePosted || !jobs.size || idleBudgetMs <= budgetMs) return;
    const at = now();
    if (at >= frameStart + idleBudgetMs || !settled(at)) return;
    idlePosted = true;
    postTask(idle);
  }
  function idle() {
    idlePosted = false;
    const start = now();
    if (!jobs.size || start >= frameStart + idleBudgetMs || !settled(start)) return;
    stats.idleTasks += 1;
    try { runSlices(start, Math.min(start + budgetMs, frameStart + idleBudgetMs), true); } finally {
      if (!jobs.size && frame !== null) { cancelFrame(frame); frame = null; }
      request();
      postIdle();
    }
  }
  function flush() {
    frame = null;
    const start = now();
    frameStart = start;
    stats.frames += 1;
    try { runSlices(start, start + budgetMs, false); } finally {
      request();
      postIdle();
    }
  }
  return {
    schedule(key, draw, { priority = 0, background = false, tier } = {}) {
      const queued = jobs.get(key);
      const previous = queued || (running?.key === key ? running : undefined);
      if (previous) { previous.cancelled = true; stats.cancelled += 1; }
      const rank = Number.isInteger(tier) ? tier : (background ? 1 : 0);
      // Repeated notifications replace work without moving it to the back of the queue.
      const entry = {
        key, draw, priority: Math.max(-4, Math.min(4, Number.isFinite(priority) ? priority : 0)),
        tier: rank, background: rank > 0,
        cancelled: false, waitSince: queued?.waitSince ?? (previous === running && running ? turn + 1 : turn),
        order: queued?.order ?? ++sequence,
      };
      jobs.set(key, entry);
      request();
      return () => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        if (jobs.get(key) === entry) { jobs.delete(key); stats.cancelled += 1; }
        if (!jobs.size && frame !== null) { cancelFrame(frame); frame = null; }
      };
    },
    getStats: () => {
      let backgroundPending = 0;
      for (const entry of jobs.values()) if (entry.background) backgroundPending += 1;
      return { ...stats, pending: jobs.size, backgroundPending, framePending: frame !== null };
    },
  };
}

let lastInput = -Infinity;
if (typeof window !== 'undefined') {
  const mark = () => { lastInput = performance.now(); };
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input', 'scroll', 'touchmove']) {
    window.addEventListener(type, mark, { capture: true, passive: true });
  }
}
export const waveformScheduler = createWaveformScheduler({
  budgetMs: 12,
  idleBudgetMs: 16,
  lastInputAt: () => lastInput,
  inputPending: () => globalThis.navigator?.scheduling?.isInputPending?.() === true,
});
