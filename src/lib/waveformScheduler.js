/** Cooperative jobs return true to continue. Priority is bounded; waiting jobs always age past it. */
export function createWaveformScheduler({
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  now = () => performance.now(),
  budgetMs = 4,
  maxSlicesPerFrame = 128,
} = {}) {
  const jobs = new Map();
  let frame = null;
  let flushing = false;
  let running;
  let turn = 0;
  let sequence = 0;
  const stats = { frames: 0, slices: 0, completed: 0, cancelled: 0, errors: 0, totalMs: 0, maxFrameMs: 0, maxWaitSlices: 0 };
  function request() {
    if (!flushing && frame === null && jobs.size) frame = requestFrame(flush);
  }
  function flush() {
    frame = null;
    flushing = true;
    const start = now();
    const budget = { now, deadline: start + budgetMs };
    let slices = 0;
    stats.frames += 1;
    try {
      do {
        let entry;
        for (const candidate of jobs.values()) {
          const score = candidate.waitSince - candidate.priority * 2;
          const best = entry && entry.waitSince - entry.priority * 2;
          if (!entry || score < best || (score === best && candidate.order < entry.order)) entry = candidate;
        }
        if (!entry) break;
        jobs.delete(entry.key);
        stats.maxWaitSlices = Math.max(stats.maxWaitSlices, turn - entry.waitSince);
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
      } while (jobs.size && slices < maxSlicesPerFrame && now() - start < budgetMs);
    } finally {
      running = undefined;
      const elapsed = now() - start;
      stats.totalMs += elapsed;
      stats.maxFrameMs = Math.max(stats.maxFrameMs, elapsed);
      flushing = false;
      request();
    }
  }
  return {
    schedule(key, draw, { priority = 0 } = {}) {
      const queued = jobs.get(key);
      const previous = queued || (running?.key === key ? running : undefined);
      if (previous) { previous.cancelled = true; stats.cancelled += 1; }
      // Repeated notifications replace work without moving it to the back of the queue.
      const entry = {
        key, draw, priority: Math.max(-4, Math.min(4, Number.isFinite(priority) ? priority : 0)),
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
    getStats: () => ({ ...stats, pending: jobs.size, framePending: frame !== null }),
  };
}

export const waveformScheduler = createWaveformScheduler();
