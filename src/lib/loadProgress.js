const listeners = new Set();

let session = null;

function emit() {
  const snapshot = session ? { ...session, logs: session.logs.slice() } : null;
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

function logLevelPrefix(level) {
  if (level === 'ok') return 'ok';
  if (level === 'error') return 'err';
  if (level === 'start') return '…';
  return 'i';
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
      `${indent}+${formatLoadDuration(entry.atMs)}  ${logLevelPrefix(entry.level)}  ${entry.message}${extraText}`
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
  if (!session || session.status !== 'running') return;
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
  listener(session ? { ...session, logs: session.logs.slice() } : null);
  return () => listeners.delete(listener);
}

export function getLoadProgress() {
  return session;
}

export function isLoadProgressRunning() {
  return Boolean(session && session.status === 'running' && session.visible);
}

export function startLoadProgress({
  kind = 'open',
  title = 'Loading',
  detail = '',
} = {}) {
  session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: kind === 'play' ? 'play' : 'open',
    title: String(title || 'Loading'),
    detail: String(detail || ''),
    status: 'running',
    visible: true,
    startedAt: nowMs(),
    endedAt: null,
    current: 'Starting…',
    phase: kind === 'play' ? 'Play' : 'Open',
    stemIndex: 0,
    stemTotal: 0,
    error: null,
    logs: [],
  };
  appendLog('info', `Started ${session.kind}: ${session.title}`);
  emit();
  return session.id;
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
  if (!session || session.status !== 'running') {
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
    appendLog('error', `${label}: ${error?.message || error}`, { durationMs, depth });
    emit();
    throw error;
  }
}

export function finishLoadProgress(error = null, sessionId = null) {
  if (!session || session.status !== 'running') return;
  if (sessionId != null && session.id !== sessionId) return;
  const durationMs = nowMs() - session.startedAt;
  session.endedAt = nowMs();
  if (error) {
    session.error = error?.message || String(error);
    session.current = 'Failed';
    appendLog('error', `Failed after ${formatLoadDuration(durationMs)}: ${session.error}`);
    session.status = 'error';
  } else {
    session.error = null;
    session.current = 'Done';
    appendLog('ok', `Finished in ${formatLoadDuration(durationMs)}`, { durationMs });
    session.status = 'done';
  }
  emit();
}

export function dismissLoadProgress() {
  if (!session) return;
  session.visible = false;
  emit();
}
