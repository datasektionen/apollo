import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, X } from 'lucide-react';
import '../styles/player-theme.css';
import {
  abortLoadProgress,
  dismissLoadProgress,
  formatLoadBytes,
  formatLoadDuration,
  formatLoadProgressText,
  loadLogLevelPrefix,
  readServerPipeline,
  subscribeLoadProgress,
} from '../lib/loadProgress';

function levelClass(level) {
  if (level === 'ok') return 'text-[var(--player-success)]';
  if (level === 'error') return 'text-[var(--player-danger)]';
  if (level === 'warn') return 'text-[var(--player-accent-text)]';
  if (level === 'start') return 'text-[var(--player-info)]';
  return 'text-[var(--player-text-secondary)]';
}

function barPercent(done, total) {
  const safeTotal = Number(total) || 0;
  if (safeTotal <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(done) / safeTotal) * 100));
}

function blobsInCache(stems) {
  if (!stems?.classified) return (stems?.cached || 0) + (stems?.pendingLoaded || 0);
  return (stems.cached || 0) + (stems.idbLoaded || 0) + (stems.serverCached || 0);
}

function ProgressCount({
  label,
  done,
  total,
  tone = 'ready',
  size = 'sub',
}) {
  const percent = barPercent(done, total);
  const barHeight = size === 'main' ? 'h-2.5' : 'h-1.5';
  const fill = tone === 'step' ? 'bg-[var(--player-accent)]' : 'bg-[var(--player-success)]';
  const labelClass = size === 'main'
    ? 'text-sm font-semibold text-[var(--player-text-primary)]'
    : 'text-sm text-[var(--player-text-secondary)]';
  return (
    <div>
      <div className={`mb-1.5 flex items-center justify-between ${labelClass}`}>
        <span>{label}</span>
        <span className="tabular-nums">{done}/{total}</span>
      </div>
      <div
        className={`${barHeight} w-full overflow-hidden rounded-full border border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)]`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className={`h-full transition-all duration-150 ${fill}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function StemMeters({ stems, now }) {
  const inCache = blobsInCache(stems);
  const pipeline = readServerPipeline(stems, now);
  return (
    <>
      <ProgressCount
        label="Audio sources"
        done={inCache}
        total={stems.total || 0}
        size="main"
      />
      <div className="space-y-3 border-l border-[var(--player-border-subtle)] pl-3">
        {stems.cached > 0 ? (
          <ProgressCount
            label="Already loaded"
            done={stems.cached}
            total={stems.cached}
          />
        ) : null}
        {stems.classified && stems.idbTotal > 0 ? (
          <ProgressCount
            label="Loaded from local database"
            done={stems.idbLoaded || 0}
            total={stems.idbTotal}
          />
        ) : null}
        {stems.classified && stems.fetchTotal > 0 ? (
          <div className="space-y-3">
            <ProgressCount
              label="Loaded from server"
              done={stems.serverCached || 0}
              total={stems.fetchTotal}
            />
            <div className="space-y-3 border-l border-[var(--player-border-subtle)] pl-3">
              <ProgressCount
                label="Downloaded"
                done={stems.fetched || 0}
                total={stems.fetchTotal}
                tone="step"
              />
              <ProgressCount
                label="Converted"
                done={stems.converted || 0}
                total={stems.fetchTotal}
                tone="step"
              />
              {pipeline ? (
                <p className="text-xs text-[var(--player-text-muted)] tabular-nums">
                  Download busy {formatLoadDuration(pipeline.downloadBusyMs)}
                  {' · '}
                  Convert busy {formatLoadDuration(pipeline.convertBusyMs)}
                  {' · '}
                  Convert idle {formatLoadDuration(pipeline.convertIdleMs)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {!stems.classified && stems.pendingTotal > 0 ? (
          <ProgressCount
            label="Loading"
            done={stems.pendingLoaded || 0}
            total={stems.pendingTotal}
          />
        ) : null}
      </div>
    </>
  );
}

function OpenLoadPage({ state, now }) {
  const elapsedMs = (state.endedAt || now) - state.startedAt;
  const stems = state.stems || {};
  const waveforms = state.waveforms || { ready: 0, total: 0 };
  const running = state.status === 'running';
  return (
    <div
      className="player-theme player-showcase-surface fixed inset-0 z-[80] bg-[var(--player-bg-canvas)] text-[var(--player-text-primary)]"
      data-player-theme="dark-gold"
    >
      <button
        type="button"
        className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-3.5 py-1.5 text-sm font-medium text-[var(--player-text-primary)] transition hover:bg-[var(--player-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--player-focus-ring)]"
        onClick={() => abortLoadProgress()}
        aria-label="Back"
      >
        <ArrowLeft size={16} />
        Back
      </button>
      <div className="flex h-full items-center justify-center px-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-progress-title"
          className="w-full max-w-lg space-y-5 rounded-2xl border border-[var(--player-border-subtle)] bg-[var(--player-bg-surface)] p-6 shadow-[var(--player-shadow-elevated)]"
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
              {state.status === 'error' ? 'Could not open project' : 'Opening project'}
            </div>
            <h2 id="open-progress-title" className="mt-1 truncate text-2xl font-bold tracking-tight text-[var(--player-text-primary)]">
              {state.title}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--player-text-secondary)]">
            {running ? <Loader2 size={16} className="animate-spin text-[var(--player-accent-text)]" /> : null}
            <span>{state.current || 'Preparing project…'}</span>
          </div>
          {(stems.total > 0) ? <StemMeters stems={stems} now={now} /> : null}
          {waveforms.total > 0 ? (
            <ProgressCount
              label="Waveforms"
              done={waveforms.ready}
              total={waveforms.total}
              size="main"
              tone="step"
            />
          ) : null}
          {state.error ? (
            <p className="text-sm text-[var(--player-danger)]">{state.error}</p>
          ) : null}
          <div className="text-xs tabular-nums text-[var(--player-text-muted)]">
            Elapsed {formatLoadDuration(elapsedMs)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayLoadBars({ state, now }) {
  const elapsedMs = (state.endedAt || now) - state.startedAt;
  const stems = state.stems || {};

  return (
    <div
      className="player-theme fixed inset-0 z-[70] flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4"
      data-player-theme="dark-gold"
      onClick={() => dismissLoadProgress()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-progress-title"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--player-border-default)] bg-[var(--player-bg-surface)] text-[var(--player-text-primary)] shadow-[var(--player-shadow-popover)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="player-hero-surface flex items-start justify-between gap-3 border-b border-[var(--player-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
              {state.status === 'error'
                ? "Couldn't load audio"
                : state.status === 'done'
                  ? 'Audio ready'
                  : 'Loading audio'}
            </div>
            <h2 id="play-progress-title" className="mt-1 truncate text-lg font-bold tracking-tight text-[var(--player-text-primary)]">
              {state.title}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-[var(--player-text-muted)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors"
            onClick={() => dismissLoadProgress()}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <StemMeters stems={stems} now={now} />
          {state.error ? (
            <p className="text-sm text-[var(--player-danger)]">{state.error}</p>
          ) : null}
          <div className="text-xs tabular-nums text-[var(--player-text-muted)]">
            Elapsed {formatLoadDuration(elapsedMs)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoadProgressDialog() {
  const [state, setState] = useState(null);
  const [now, setNow] = useState(() => (
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  ));
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef(null);

  useEffect(() => subscribeLoadProgress(setState), []);

  useEffect(() => {
    if (state?.status !== 'running') return undefined;
    const id = window.setInterval(() => {
      setNow(typeof performance !== 'undefined' ? performance.now() : Date.now());
    }, 100);
    return () => window.clearInterval(id);
  }, [state?.status, state?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [state?.logs?.length, state?.id]);

  useEffect(() => {
    setCopied(false);
  }, [state?.id]);

  async function copyLog() {
    const text = formatLoadProgressText(state, now);
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (!state?.visible) return null;

  if (state.presentation === 'bars' && state.kind === 'open') {
    return <OpenLoadPage state={state} now={now} />;
  }

  if (state.presentation === 'bars') {
    return <PlayLoadBars state={state} now={now} />;
  }

  // Technical step log. Used when LOAD_PROGRESS_VERBOSE_LOG is enabled.
  const elapsedMs = (state.endedAt || now) - state.startedAt;
  const running = state.status === 'running';
  const stemLabel = state.stemTotal > 0
    ? `Stem ${Math.min(state.stemIndex, state.stemTotal)} / ${state.stemTotal}`
    : null;

  return (
    <div
      className="player-theme fixed inset-0 z-[70] flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4"
      data-player-theme="dark-gold"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="load-progress-title"
        className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--player-border-default)] bg-[var(--player-bg-surface)] text-[var(--player-text-primary)] shadow-[var(--player-shadow-popover)]"
      >
        <div className="player-hero-surface flex items-start justify-between gap-3 border-b border-[var(--player-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--player-accent-text)]">
              {state.kind === 'play' ? 'Play request' : 'Open request'}
            </div>
            <h2 id="load-progress-title" className="mt-1 truncate text-lg font-bold tracking-tight text-[var(--player-text-primary)]">
              {state.title}
            </h2>
            {state.detail ? (
              <p className="mt-1 truncate text-xs text-[var(--player-text-muted)]">{state.detail}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-[var(--player-text-muted)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] disabled:opacity-40 transition-colors"
            onClick={() => dismissLoadProgress()}
            disabled={running}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-[var(--player-border-subtle)] px-5 py-3">
          <div className="flex items-center gap-2 text-sm">
            {running ? <Loader2 size={16} className="animate-spin text-[var(--player-accent-text)]" /> : null}
            <span className={state.status === 'error' ? 'text-[var(--player-danger)]' : 'text-[var(--player-text-primary)]'}>
              {state.current}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--player-text-secondary)]">
            <span className="tabular-nums">Elapsed {formatLoadDuration(elapsedMs)}</span>
            {state.phase ? <span>Phase {state.phase}</span> : null}
            {stemLabel ? <span className="tabular-nums">{stemLabel}</span> : null}
            <span className="tabular-nums">{state.logs.length} log lines</span>
            {state.status === 'done' ? <span className="text-[var(--player-success)]">Complete</span> : null}
            {state.status === 'error' ? <span className="text-[var(--player-danger)]">Failed</span> : null}
          </div>
          {state.error ? (
            <p className="mt-2 text-xs text-[var(--player-danger)]">{state.error}</p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 select-text overflow-auto bg-[var(--player-bg-canvas)] px-4 py-3 font-mono text-xs leading-5">
          {state.logs.map((entry) => (
            <div
              key={entry.id}
              className={`${levelClass(entry.level)}`}
              style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
            >
              <span className="text-[var(--player-text-disabled)]">+{formatLoadDuration(entry.atMs)}</span>
              {'  '}
              <span className="text-[var(--player-text-muted)]">{loadLogLevelPrefix(entry.level)}</span>
              {'  '}
              {entry.message}
              {entry.durationMs != null ? (
                <span className="text-[var(--player-text-muted)]">  ({formatLoadDuration(entry.durationMs)})</span>
              ) : null}
              {entry.bytes != null ? (
                <span className="text-[var(--player-text-muted)]">  {formatLoadBytes(entry.bytes)}</span>
              ) : null}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--player-border-subtle)] px-5 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--player-text-primary)] hover:bg-[var(--player-hover)] transition-colors"
            onClick={copyLog}
          >
            {copied ? <Check size={14} className="text-[var(--player-success)]" /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy log'}
          </button>
          <button
            type="button"
            className="rounded-lg bg-[var(--player-accent)] px-4 py-2 text-sm font-bold text-[var(--player-accent-foreground)] hover:bg-[var(--player-accent-hover)] disabled:opacity-40 transition-colors"
            onClick={() => dismissLoadProgress()}
            disabled={running}
          >
            {running ? 'Working…' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
