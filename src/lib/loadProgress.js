// Dead path: play and DAW open show progress bars while this stays false.
// Set it to true to restore the technical step log.
export const LOAD_PROGRESS_VERBOSE_LOG = false;

const listeners = new Set();

let session = null;

function createStemProgress() {
  return {
    total: 0,
    cached: 0,
    classified: true,
    idbTotal: 0,
    idbLoaded: 0,
    fetchTotal: 0,
    fetched: 0,
    convertTotal: 0,
    converted: 0,
    pendingTotal: 0,
    pendingLoaded: 0,
    serverCached: 0,
    activeDownloads: 0,
    activeConverts: 0,
    downloadBusyMs: 0,
    convertBusyMs: 0,
    convertIdleMs: 0,
    pipelineMarkAt: null,
  };
}

function flushServerPipeline(stems, now) {
  if (!stems || !(stems.fetchTotal > 0)) return;
  if (stems.pipelineMarkAt == null) {
    stems.pipelineMarkAt = now;
    return;
  }
  const dt = Math.max(0, now - stems.pipelineMarkAt);
  stems.pipelineMarkAt = now;
  const serverRemaining = stems.serverCached < stems.fetchTotal
    || stems.activeDownloads > 0
    || stems.activeConverts > 0;
  if (!serverRemaining) return;
  if (stems.activeDownloads > 0) stems.downloadBusyMs += dt;
  if (stems.activeConverts > 0) stems.convertBusyMs += dt;
  else if (stems.serverCached < stems.fetchTotal) stems.convertIdleMs += dt;
  stems.downloadBusyMs = Math.round(stems.downloadBusyMs * 1e6) / 1e6;
  stems.convertBusyMs = Math.round(stems.convertBusyMs * 1e6) / 1e6;
  stems.convertIdleMs = Math.round(stems.convertIdleMs * 1e6) / 1e6;
}

export function readServerPipeline(stems, now = nowMs()) {
  if (!stems || !(stems.fetchTotal > 0)) return null;
  const times = {
    downloadBusyMs: Number(stems.downloadBusyMs) || 0,
    convertBusyMs: Number(stems.convertBusyMs) || 0,
    convertIdleMs: Number(stems.convertIdleMs) || 0,
  };
  if (stems.pipelineMarkAt == null) return times;
  const dt = Math.max(0, now - stems.pipelineMarkAt);
  const serverRemaining = stems.serverCached < stems.fetchTotal
    || stems.activeDownloads > 0
    || stems.activeConverts > 0;
  if (!serverRemaining) return times;
  if (stems.activeDownloads > 0) times.downloadBusyMs += dt;
  if (stems.activeConverts > 0) times.convertBusyMs += dt;
  else if (stems.serverCached < stems.fetchTotal) times.convertIdleMs += dt;
  for (const key of Object.keys(times)) times[key] = Math.round(times[key] * 1e6) / 1e6;
  return times;
}

function isVerboseLogSession(target = session) {
  return Boolean(target && target.status === 'running' && target.presentation !== 'bars');
}

function snapshotSession() {
  if (!session) return null;
  return {
    ...session,
    logs: session.logs.slice(),
    stems: { ...(session.stems || {}) },
  };
}

function emit() {
  const snapshot = snapshotSession();
  listeners.forEach((listener) => {
    listener(snapshot);
  });
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function formatLoadDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1) return '<1ms';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(2)}s`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function formatLoadBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function loadLogLevelPrefix(level) {
  if (level === 'ok') return 'ok';
  if (level === 'error') return 'err';
  if (level === 'warn') return 'alt';
  if (level === 'start') return '…';
  return 'i';
}

function resolveFailureLevel(extra, error) {
  const raw = typeof extra?.failureLevel === 'function'
    ? extra.failureLevel(error)
    : extra?.failureLevel;
  if (raw === 'warn' || raw === 'info' || raw === 'ok' || raw === 'error') return raw;
  return 'error';
}

function formatStepFailure(label, error, extra) {
  if (typeof extra?.formatFailure === 'function') {
    return extra.formatFailure(error, label);
  }
  return `${label}: ${error?.message || error}`;
}

export function formatLoadProgressText(session, now = nowMs()) {
  if (!session) return '';
  const kindLabel = session.kind === 'play' ? 'Play request' : 'Open request';
  const elapsedMs = (session.endedAt || now) - session.startedAt;
  const lines = [
    `${kindLabel}: ${session.title || 'Loading'}`,
  ];
  if (session.detail) lines.push(`Detail: ${session.detail}`);
  lines.push(`Status: ${session.status || 'unknown'}`);
  if (session.current) lines.push(`Current: ${session.current}`);
  if (session.phase) lines.push(`Phase: ${session.phase}`);
  if (session.stemTotal > 0) {
    lines.push(`Stem: ${Math.min(session.stemIndex, session.stemTotal)} / ${session.stemTotal}`);
  }
  lines.push(`Elapsed: ${formatLoadDuration(elapsedMs)}`);
  if (session.error) lines.push(`Error: ${session.error}`);
  lines.push('');
  (session.logs || []).forEach((entry) => {
    const indent = '  '.repeat(Math.max(0, Number(entry.depth) || 0));
    const extras = [];
    if (entry.durationMs != null) extras.push(formatLoadDuration(entry.durationMs));
    if (entry.bytes != null) extras.push(formatLoadBytes(entry.bytes));
    const extraText = extras.length ? `  (${extras.join(', ')})` : '';
    lines.push(
      `${indent}+${formatLoadDuration(entry.atMs)}  ${loadLogLevelPrefix(entry.level)}  ${entry.message}${extraText}`
    );
  });
  return lines.join('\n');
}

export function shortLoadId(id) {
  const value = String(id || '').trim();
  if (!value) return 'unknown';
  return value.length <= 10 ? value : `${value.slice(0, 8)}…`;
}

export function logLoadProgress(message, extra = {}) {
  if (!isVerboseLogSession()) return;
  appendLog(extra.level || 'info', message, extra);
  if (extra.current) session.current = String(extra.current);
  emit();
}

export function summarizeProjectForLoadLog(project, label = 'Snapshot') {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  let clipCount = 0;
  const blobIds = new Set();
  tracks.forEach((track) => {
    (track?.clips || []).forEach((clip) => {
      clipCount += 1;
      if (clip?.blobId) blobIds.add(clip.blobId);
    });
  });
  logLoadProgress(
    `${label}: ${tracks.length} tracks, ${clipCount} clips, ${blobIds.size} unique stems`,
    { depth: 1 }
  );
  return {
    trackCount: tracks.length,
    clipCount,
    stemCount: blobIds.size,
  };
}

export function logAudioBufferStats(audioBuffer, extra = {}) {
  if (!audioBuffer) return;
  const channels = Number(audioBuffer.numberOfChannels) || 0;
  const sampleRate = Math.round(Number(audioBuffer.sampleRate) || 0);
  const duration = Number(audioBuffer.duration);
  const durationLabel = Number.isFinite(duration) ? `${duration.toFixed(2)}s` : '?s';
  logLoadProgress(
    `${extra.label || 'AudioBuffer'}: ${channels}ch ${sampleRate}Hz ${durationLabel}`,
    extra
  );
}

export function subscribeLoadProgress(listener) {
  listeners.add(listener);
  listener(snapshotSession());
  return () => listeners.delete(listener);
}

export function getLoadProgress() {
  return session;
}

export function isLoadProgressRunning() {
  return Boolean(session && session.status === 'running' && session.visible);
}

export function isPlayProgressBars() {
  return Boolean(session && session.status === 'running' && session.presentation === 'bars');
}

export function startLoadProgress({
  kind = 'open',
  title = 'Loading',
  detail = '',
  verbose = false,
} = {}) {
  const play = kind === 'play';
  const useVerboseLog = Boolean(verbose) || LOAD_PROGRESS_VERBOSE_LOG;
  session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: play ? 'play' : 'open',
    presentation: useVerboseLog ? 'log' : 'bars',
    title: String(title || 'Loading'),
    detail: String(detail || ''),
    status: 'running',
    visible: useVerboseLog,
    revealed: useVerboseLog,
    startedAt: nowMs(),
    endedAt: null,
    current: useVerboseLog ? 'Starting…' : '',
    phase: play ? 'Play' : 'Open',
    stemIndex: 0,
    stemTotal: 0,
    error: null,
    logs: [],
    stems: createStemProgress(),
  };
  if (useVerboseLog) {
    appendLog('info', `Started ${session.kind}: ${session.title}`);
  }
  emit();
  return session.id;
}

export function beginPlayStemProgress(counts = {}, sessionId = null) {
  if (!isPlayProgressBars()) return;
  if (sessionId != null && session.id !== sessionId) return;
  const total = Math.max(0, Number(counts.total) || 0);
  const cached = Math.max(0, Math.min(total, Number(counts.cached) || 0));
  const classified = counts.classified !== false;
  const idbTotal = classified ? Math.max(0, Number(counts.idbTotal) || 0) : 0;
  const fetchTotal = classified ? Math.max(0, Number(counts.fetchTotal) || 0) : 0;
  session.stems = {
    total,
    cached,
    classified,
    idbTotal,
    idbLoaded: 0,
    fetchTotal,
    fetched: 0,
    convertTotal: fetchTotal,
    converted: 0,
    pendingTotal: classified ? 0 : Math.max(0, total - cached),
    pendingLoaded: 0,
    serverCached: 0,
    activeDownloads: 0,
    activeConverts: 0,
    downloadBusyMs: 0,
    convertBusyMs: 0,
    convertIdleMs: 0,
    pipelineMarkAt: fetchTotal > 0 ? nowMs() : null,
  };
  const needsDialog = cached < total;
  session.revealed = needsDialog;
  session.visible = needsDialog;
  session.current = needsDialog ? 'Loading audio…' : 'Ready';
  emit();
}

const PLAY_STEM_EVENTS = {
  'idb-loaded': ['idbLoaded', 'idbTotal'],
  fetched: ['fetched', 'fetchTotal'],
  converted: ['converted', 'convertTotal'],
  settled: ['pendingLoaded', 'pendingTotal'],
};

export function reportPlayStemEvent(event, sessionId = null, now = nowMs()) {
  if (!isPlayProgressBars()) return;
  if (sessionId != null && session.id !== sessionId) return;
  const stems = session.stems;
  if (!stems) return;
  flushServerPipeline(stems, now);
  if (event === 'idb-missed') {
    if (stems.idbTotal <= 0) return;
    stems.idbTotal -= 1;
    stems.fetchTotal += 1;
    stems.convertTotal += 1;
    if (stems.fetchTotal > 0 && stems.pipelineMarkAt == null) stems.pipelineMarkAt = now;
    emit();
    return;
  }
  if (event === 'download-start') {
    stems.activeDownloads += 1;
    emit();
    return;
  }
  if (event === 'download-stop') {
    stems.activeDownloads = Math.max(0, stems.activeDownloads - 1);
    emit();
    return;
  }
  if (event === 'convert-start') {
    stems.activeConverts += 1;
    emit();
    return;
  }
  if (event === 'convert-stop') {
    stems.activeConverts = Math.max(0, stems.activeConverts - 1);
    emit();
    return;
  }
  if (event === 'fetched') {
    stems.activeDownloads = Math.max(0, stems.activeDownloads - 1);
  }
  if (event === 'converted') {
    stems.activeConverts = Math.max(0, stems.activeConverts - 1);
  }
  if (event === 'server-cached') {
    if (stems.serverCached >= stems.fetchTotal) return;
    stems.serverCached += 1;
    emit();
    return;
  }
  const spec = PLAY_STEM_EVENTS[event];
  if (!spec) return;
  const [doneKey, totalKey] = spec;
  if (stems[doneKey] >= stems[totalKey]) return;
  stems[doneKey] += 1;
  emit();
}

export function updateLoadProgress(patch = {}) {
  if (!session || session.status !== 'running') return;
  if (patch.current != null) session.current = String(patch.current);
  if (patch.phase != null) session.phase = String(patch.phase);
  if (Number.isFinite(Number(patch.stemIndex))) session.stemIndex = Number(patch.stemIndex);
  if (Number.isFinite(Number(patch.stemTotal))) session.stemTotal = Number(patch.stemTotal);
  if (patch.detail != null) session.detail = String(patch.detail);
  emit();
}

function appendLog(level, message, extra = {}) {
  if (!session) return;
  const elapsedMs = Math.max(0, nowMs() - session.startedAt);
  session.logs.push({
    id: session.logs.length + 1,
    atMs: elapsedMs,
    level,
    message,
    durationMs: Number.isFinite(Number(extra.durationMs)) ? Number(extra.durationMs) : null,
    bytes: Number.isFinite(Number(extra.bytes)) ? Number(extra.bytes) : null,
    depth: Number.isFinite(Number(extra.depth)) ? Number(extra.depth) : 0,
  });
}

export async function withLoadStep(label, fn, extra = {}) {
  const depth = Number.isFinite(Number(extra.depth)) ? Number(extra.depth) : 0;
  if (!isVerboseLogSession()) {
    return fn();
  }

  session.current = label;
  appendLog('start', label, { depth });
  emit();
  const startedAt = nowMs();
  try {
    const result = await fn();
    const durationMs = nowMs() - startedAt;
    const bytes = extra.bytesFrom?.(result);
    appendLog('ok', label, {
      durationMs,
      depth,
      bytes: Number.isFinite(Number(bytes)) ? Number(bytes) : extra.bytes,
    });
    emit();
    return result;
  } catch (error) {
    const durationMs = nowMs() - startedAt;
    appendLog(resolveFailureLevel(extra, error), formatStepFailure(label, error, extra), {
      durationMs,
      depth,
    });
    emit();
    throw error;
  }
}

export function finishLoadProgress(error = null, sessionId = null) {
  if (!session || session.status !== 'running') return;
  if (sessionId != null && session.id !== sessionId) return;
  const durationMs = nowMs() - session.startedAt;
  session.endedAt = nowMs();
  const bars = session.presentation === 'bars';
  if (bars && session.stems) {
    flushServerPipeline(session.stems, session.endedAt);
    session.stems.pipelineMarkAt = null;
    session.stems.activeDownloads = 0;
    session.stems.activeConverts = 0;
  }
  if (error) {
    session.error = error?.message || String(error);
    session.current = 'Failed';
    session.status = 'error';
    if (bars) {
      session.visible = Boolean(session.revealed);
    } else {
      appendLog('error', `Failed after ${formatLoadDuration(durationMs)}: ${session.error}`);
    }
  } else {
    session.error = null;
    session.current = 'Done';
    session.status = 'done';
    if (bars) {
      session.visible = Boolean(session.revealed);
    } else {
      appendLog('ok', `Finished in ${formatLoadDuration(durationMs)}`, { durationMs });
    }
  }
  emit();
}

export function dismissLoadProgress() {
  if (!session) return;
  session.visible = false;
  emit();
}
