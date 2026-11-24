import { useEffect, useRef, useState } from 'react';
import { Volume2, Mic, Gauge, Loader2, X, Check, RotateCcw } from 'lucide-react';
import { measureRecordingRoundTrip } from '../lib/recordingLatencyCalibration';

const WAVEFORM_HEIGHTS = [10, 14, 20, 26, 32, 26, 20, 14, 18, 24, 32, 24, 18, 14, 10];

export function LatencyCorrectionDialog({
  isOpen = false,
  onClose,
  onConfirm,
  inputDeviceId = '',
  initialOffsetMs = 0,
}) {
  const [status, setStatus] = useState('intro'); // 'intro' | 'measuring' | 'success' | 'error'
  const [latencyDraft, setLatencyDraft] = useState('');
  const [activeBarIndex, setActiveBarIndex] = useState(-1);
  const abortControllerRef = useRef(null);
  const animIntervalRef = useRef(null);
  const lastRecordRef = useRef(null);

  // Initialize or reset when dialog opens
  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (animIntervalRef.current) {
        clearInterval(animIntervalRef.current);
        animIntervalRef.current = null;
      }
      setStatus('intro');
      setLatencyDraft(initialOffsetMs ? String(Math.round(initialOffsetMs)) : '65');
      setActiveBarIndex(-1);
      return;
    }
    setStatus('intro');
    setLatencyDraft(initialOffsetMs ? String(Math.round(initialOffsetMs)) : '65');
  }, [isOpen, initialOffsetMs]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, status]);

  const startWaveAnimation = () => {
    if (animIntervalRef.current) clearInterval(animIntervalRef.current);
    let bar = 0;
    animIntervalRef.current = setInterval(() => {
      setActiveBarIndex(bar);
      bar = (bar + 1) % (WAVEFORM_HEIGHTS.length + 3);
    }, 70);
  };

  const stopWaveAnimation = () => {
    if (animIntervalRef.current) {
      clearInterval(animIntervalRef.current);
      animIntervalRef.current = null;
    }
    setActiveBarIndex(-1);
  };

  const handleStartTest = async () => {
    setStatus('measuring');
    startWaveAnimation();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const record = await measureRecordingRoundTrip({
        inputDeviceId,
        burstCount: 3,
        signal: controller.signal,
      });

      stopWaveAnimation();
      if (record && Number.isFinite(record.roundTripMs)) {
        lastRecordRef.current = record;
        const measured = Math.max(0, Math.round(record.roundTripMs));
        setLatencyDraft(String(measured));
        setStatus('success');
      } else {
        setStatus('error');
      }
    } catch (err) {
      stopWaveAnimation();
      if (err?.code === 'aborted') return;
      console.warn('Latency measurement failed:', err);
      setStatus('error');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleClose = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopWaveAnimation();
    onClose?.();
  };

  const handleConfirm = () => {
    const numeric = parseInt(latencyDraft, 10);
    const finalOffset = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    onConfirm?.(finalOffset, lastRecordRef.current);
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="player-theme daw-theme fixed inset-0 z-[100] flex items-center justify-center bg-[var(--player-bg-scrim)] backdrop-blur-sm px-4"
      data-player-theme="dark-gold"
      role="dialog"
      aria-modal="true"
      aria-labelledby="latency-correction-title"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-[var(--player-border-strong)] bg-[var(--player-bg-surface)] p-6 text-[var(--player-text-primary)] shadow-[var(--player-shadow-popover)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4">
          <div className="w-6" /> {/* spacer to balance close button */}
          <h2 id="latency-correction-title" className="text-sm font-semibold tracking-wide text-[var(--player-text-primary)]">
            Round-trip Latency Correction
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-[var(--player-text-muted)] hover:bg-[var(--player-hover)] hover:text-[var(--player-text-primary)] transition-colors focus:outline-none"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content based on status */}
        <div className="py-2">
          {/* INTRO or MEASURING state */}
          {(status === 'intro' || status === 'measuring') && (
            <div className="space-y-6 text-center">
              {/* Graphic: Speaker -> Waveform -> Mic */}
              <div className="flex items-center justify-center gap-3 py-2">
                <Volume2
                  size={24}
                  className={status === 'measuring' ? 'text-red-400 transition-colors' : 'text-[var(--player-text-secondary)]'}
                />
                <div className="flex items-center gap-1 h-10 px-1">
                  {WAVEFORM_HEIGHTS.map((height, i) => {
                    const isLit = status === 'measuring' && Math.abs(activeBarIndex - i) <= 1;
                    return (
                      <div
                        key={i}
                        style={{ height: `${height}px` }}
                        className={`w-1 rounded-full transition-all duration-75 ${
                          isLit
                            ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.85)]'
                            : 'bg-[var(--player-slider-track)]'
                        }`}
                      />
                    );
                  })}
                </div>
                <Mic
                  size={24}
                  className={status === 'measuring' ? 'text-red-400 transition-colors' : 'text-[var(--player-text-secondary)]'}
                />
              </div>

              {/* Explanatory text */}
              <div className="space-y-3 px-2 text-xs text-[var(--player-text-secondary)] leading-relaxed">
                <p>
                  Feeling like you’re slightly behind the beat?
                </p>
                <p>
                  Please make sure your headphones are unplugged and have your microphone close to
                  your speakers.
                </p>
              </div>

              {/* Action Button */}
              <div className="pt-2 pb-1">
                {status === 'intro' ? (
                  <button
                    type="button"
                    onClick={handleStartTest}
                    className="player-play-cta inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold active:scale-95"
                  >
                    <Gauge size={16} />
                    <span>Start Test</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-6 py-2.5 text-sm font-medium text-[var(--player-text-muted)] cursor-wait"
                  >
                    <Loader2 size={16} className="animate-spin text-red-400" />
                    <span>Running...</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SUCCESS state */}
          {status === 'success' && (
            <div className="space-y-4 text-center">
              <div className="flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--player-success-surface)] border border-[var(--player-success-border)] text-[var(--player-success)]">
                  <Check size={24} strokeWidth={2.5} />
                </div>
              </div>

              <div className="text-sm font-medium text-[var(--player-text-primary)]">
                Your Latency <span className="text-xs text-[var(--player-text-muted)] font-normal">(ms)</span>
              </div>

              <div className="flex justify-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={latencyDraft}
                  onChange={(e) => setLatencyDraft(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-44 rounded-xl border border-[var(--player-border-default)] bg-[var(--player-bg-canvas)] px-4 py-2 text-center text-lg font-bold font-mono text-[var(--player-text-primary)] focus:border-[var(--player-accent-border)] focus:outline-none"
                  aria-label="Measured latency in milliseconds"
                />
              </div>

              <div className="space-y-1.5 px-3 text-xs text-[var(--player-text-muted)] leading-relaxed">
                <p>This correction will be applied the next time you press record for your current session.</p>
                <p>If you switch to another microphone you should perform this test again. You can find it in settings.</p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={handleStartTest}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-5 py-2.5 text-sm font-medium text-[var(--player-text-primary)] transition-colors hover:bg-[var(--player-hover)] active:scale-95"
                >
                  <RotateCcw size={15} />
                  <span>Try again</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="player-play-cta inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold active:scale-95"
                >
                  <Check size={16} strokeWidth={2.5} />
                  <span>Confirm</span>
                </button>
              </div>
            </div>
          )}

          {/* ERROR state */}
          {status === 'error' && (
            <div className="space-y-4 text-center">
              <div className="flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--player-danger-surface)] border border-[var(--player-danger-border)] text-[var(--player-danger)]">
                  <X size={24} strokeWidth={2.5} />
                </div>
              </div>

              <div className="text-base font-bold text-[var(--player-text-primary)]">
                Test is unsuccessful
              </div>

              <div className="px-3 text-xs text-[var(--player-text-muted)] leading-relaxed">
                Test sounds weren’t detected. Check your microphone and ensure that your headphones
                aren’t plugged in. You may also manually enter your latency (in milliseconds) below.
              </div>

              <div className="flex justify-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={latencyDraft}
                  onChange={(e) => setLatencyDraft(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-44 rounded-xl border border-[var(--player-border-default)] bg-[var(--player-bg-canvas)] px-4 py-2 text-center text-base font-semibold font-mono text-[var(--player-text-primary)] focus:border-[var(--player-accent-border)] focus:outline-none"
                  aria-label="Manual latency in milliseconds"
                />
              </div>

              <div className="flex items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={handleStartTest}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] px-5 py-2.5 text-sm font-medium text-[var(--player-text-primary)] transition-colors hover:bg-[var(--player-hover)] active:scale-95"
                >
                  <RotateCcw size={15} />
                  <span>Try again</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="player-play-cta inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold active:scale-95"
                >
                  <Check size={16} strokeWidth={2.5} />
                  <span>Confirm</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
