import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import {
  dismissLoadProgress,
  formatLoadBytes,
  formatLoadDuration,
  formatLoadProgressText,
  subscribeLoadProgress,
} from '../lib/loadProgress';

function levelClass(level) {
  if (level === 'ok') return 'text-emerald-300';
  if (level === 'error') return 'text-red-300';
  if (level === 'start') return 'text-sky-300';
  return 'text-gray-300';
}

function levelPrefix(level) {
  if (level === 'ok') return 'ok';
  if (level === 'error') return 'err';
  if (level === 'start') return '…';
  return 'i';
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

  const elapsedMs = (state.endedAt || now) - state.startedAt;
  const running = state.status === 'running';
  const stemLabel = state.stemTotal > 0
    ? `Stem ${Math.min(state.stemIndex, state.stemTotal)} / ${state.stemTotal}`
    : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="load-progress-title"
        className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 text-white"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {state.kind === 'play' ? 'Play request' : 'Open request'}
            </div>
            <h2 id="load-progress-title" className="mt-1 truncate text-lg font-semibold">
              {state.title}
            </h2>
            {state.detail ? (
              <p className="mt-1 truncate text-xs text-gray-500">{state.detail}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
            onClick={() => dismissLoadProgress()}
            disabled={running}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-gray-800 px-5 py-3">
          <div className="flex items-center gap-2 text-sm">
            {running ? <Loader2 size={16} className="animate-spin text-blue-300" /> : null}
            <span className={state.status === 'error' ? 'text-red-300' : 'text-gray-100'}>
              {state.current}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>Elapsed {formatLoadDuration(elapsedMs)}</span>
            {state.phase ? <span>Phase {state.phase}</span> : null}
            {stemLabel ? <span>{stemLabel}</span> : null}
            <span>{state.logs.length} log lines</span>
            {state.status === 'done' ? <span className="text-emerald-400">Complete</span> : null}
            {state.status === 'error' ? <span className="text-red-400">Failed</span> : null}
          </div>
          {state.error ? (
            <p className="mt-2 text-xs text-red-300">{state.error}</p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 select-text overflow-auto bg-gray-950 px-4 py-3 font-mono text-xs leading-5">
          {state.logs.map((entry) => (
            <div
              key={entry.id}
              className={`${levelClass(entry.level)}`}
              style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
            >
              <span className="text-gray-600">+{formatLoadDuration(entry.atMs)}</span>
              {'  '}
              <span className="text-gray-500">{levelPrefix(entry.level)}</span>
              {'  '}
              {entry.message}
              {entry.durationMs != null ? (
                <span className="text-gray-500">  ({formatLoadDuration(entry.durationMs)})</span>
              ) : null}
              {entry.bytes != null ? (
                <span className="text-gray-500">  {formatLoadBytes(entry.bytes)}</span>
              ) : null}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700"
            onClick={copyLog}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy log'}
          </button>
          <button
            type="button"
            className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-40"
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
