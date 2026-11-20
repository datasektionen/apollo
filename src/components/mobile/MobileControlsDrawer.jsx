import React, { useRef } from 'react';
import { X, Sliders, Gauge, Music, Metronome, Headphones, HeadphoneOff, Scale } from 'lucide-react';
import {
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
  ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
} from '../../utils/advancedMix';
import {
  PLAYBACK_SPEED_DRAG_BOUNDS,
  PLAYBACK_TRANSPOSE_BOUNDS,
  formatPlaybackSpeed,
  formatPlaybackTranspose,
  getNextPlaybackSpeed,
} from '../../utils/playerControlsSidebar';

function formatFocusLabel(step) {
  if (step === 'omitted') return 'Omitted';
  if (step === 'solo') return 'Solo';
  const numeric = Number(step);
  if (!Number.isFinite(numeric)) return '0 dB';
  if (numeric === 0) return '0 dB';
  return `${numeric > 0 ? '+' : ''}${numeric} dB`;
}

function getBipolarTrackStyle(pct) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 50));
  return {
    '--player-bipolar-start': `${Math.min(50, clamped)}%`,
    '--player-bipolar-end': `${Math.max(50, clamped)}%`,
  };
}

export function MobileControlsDrawer({
  isOpen,
  onClose,
  playbackSpeed = 1,
  onSetPlaybackSpeed,
  playbackTranspose = 0,
  onSetPlaybackTranspose,
  practiceFocusControl = ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
  onSetPracticeFocusControl,
  hasRealtimeMetronome = false,
  metronomeVolume = 80,
  onSetMetronomeVolume,
}) {
  const previousMetronomeRef = useRef(metronomeVolume || 80);
  const previousTransposeRef = useRef(1);
  const previousNumericFocusRef = useRef(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX);

  if (!isOpen) return null;

  const focusSteps = ADVANCED_MIX_PRACTICE_FOCUS_STEPS;
  const clampedFocusIdx = Math.max(
    0,
    Math.min(
      focusSteps.length - 1,
      Number.isFinite(Number(practiceFocusControl))
        ? Number(practiceFocusControl)
        : ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX
    )
  );
  const focusStep = focusSteps[clampedFocusIdx];
  const focusPct = focusSteps.length > 1 ? (clampedFocusIdx / (focusSteps.length - 1)) * 100 : 50;
  const FocusIcon = focusStep === 'omitted'
    ? HeadphoneOff
    : (focusStep === 'solo' ? Headphones : Scale);

  const clampedSpeed = Math.max(
    PLAYBACK_SPEED_DRAG_BOUNDS.MIN,
    Math.min(PLAYBACK_SPEED_DRAG_BOUNDS.MAX, Number(playbackSpeed) || 1)
  );
  const speedPct =
    ((clampedSpeed - PLAYBACK_SPEED_DRAG_BOUNDS.MIN) /
      (PLAYBACK_SPEED_DRAG_BOUNDS.MAX - PLAYBACK_SPEED_DRAG_BOUNDS.MIN)) *
    100;

  const clampedTranspose = Math.max(
    PLAYBACK_TRANSPOSE_BOUNDS.MIN,
    Math.min(PLAYBACK_TRANSPOSE_BOUNDS.MAX, Number(playbackTranspose) || 0)
  );
  const transposePct =
    ((clampedTranspose - PLAYBACK_TRANSPOSE_BOUNDS.MIN) /
      (PLAYBACK_TRANSPOSE_BOUNDS.MAX - PLAYBACK_TRANSPOSE_BOUNDS.MIN)) *
    100;

  const effectiveMetronome = Math.max(0, Math.min(100, Number(metronomeVolume) || 0));
  const isMetronomeMuted = effectiveMetronome <= 0;
  const isFocusActive = focusStep === 'omitted' || focusStep === 'solo' || Number(focusStep) !== 0;
  const isSpeedActive = Math.abs((Number(playbackSpeed) || 1) - 1) > 0.005;
  const isTransposeActive = Math.abs(Number(playbackTranspose) || 0) > 1e-4;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[var(--player-bg-scrim)] backdrop-blur-sm animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Practice and stem controls"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl bg-[var(--player-bg-surface)] border-t border-[var(--player-border-default)] p-5 space-y-5 pb-safe shadow-[var(--player-shadow-sheet)] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-[var(--player-border-subtle)] pb-3">
          <div className="flex items-center gap-2">
            <Sliders size={18} className="text-[var(--player-accent-text)]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--player-text-primary)]">
              Choir Practice & Controls
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] p-1.5 text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]"
            aria-label="Close controls"
          >
            <X size={18} />
          </button>
        </div>

        {/* Metronome (if available in active snapshot) */}
        {hasRealtimeMetronome && (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-[var(--player-text-secondary)]">Metronome</span>
              <span className={`font-bold tabular-nums ${isMetronomeMuted ? 'text-[var(--player-text-muted)]' : 'text-[var(--player-accent-text)]'}`}>
                {isMetronomeMuted ? 'Muted' : `${Math.round(effectiveMetronome)}%`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isMetronomeMuted) {
                    onSetMetronomeVolume?.(previousMetronomeRef.current || 80);
                  } else {
                    previousMetronomeRef.current = effectiveMetronome;
                    onSetMetronomeVolume?.(0);
                  }
                }}
                aria-label={isMetronomeMuted ? 'Unmute metronome' : 'Mute metronome'}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  !isMetronomeMuted
                    ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                    : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-muted)]'
                }`}
              >
                <Metronome size={18} />
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={effectiveMetronome}
                onChange={(e) => onSetMetronomeVolume?.(Number(e.target.value))}
                style={{ '--player-range-pct': `${effectiveMetronome}%` }}
                className="player-range player-range-touch flex-1 cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Stem Practice Focus */}
        <div className={`space-y-1.5 ${hasRealtimeMetronome ? 'border-t border-[var(--player-border-subtle)] pt-3.5' : ''}`}>
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-[var(--player-text-secondary)]">Practice Focus</span>
            <span className={`font-bold tabular-nums ${isFocusActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'}`}>
              {formatFocusLabel(focusStep)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (typeof focusStep === 'number') {
                  previousNumericFocusRef.current = clampedFocusIdx;
                  onSetPracticeFocusControl?.(focusSteps.length - 1);
                } else if (focusStep === 'solo') {
                  onSetPracticeFocusControl?.(0);
                } else {
                  onSetPracticeFocusControl?.(previousNumericFocusRef.current ?? ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX);
                }
              }}
              aria-label="Cycle practice focus"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                isFocusActive
                  ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                  : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]'
              }`}
            >
              <FocusIcon size={18} />
            </button>
            <input
              type="range"
              min="0"
              max={focusSteps.length - 1}
              step="1"
              value={clampedFocusIdx}
              onChange={(e) => onSetPracticeFocusControl?.(Number(e.target.value))}
              style={getBipolarTrackStyle(focusPct)}
              className="player-range player-range-bipolar player-range-touch flex-1 cursor-pointer"
              aria-label="Practice Focus Slider"
            />
          </div>
        </div>

        {/* Playback Speed */}
        <div className="space-y-1.5 border-t border-[var(--player-border-subtle)] pt-3.5">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-[var(--player-text-secondary)]">Playback Speed</span>
            <span className={`font-bold tabular-nums ${isSpeedActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'}`}>
              {formatPlaybackSpeed(playbackSpeed)}x
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSetPlaybackSpeed?.(getNextPlaybackSpeed(playbackSpeed))}
              aria-label="Step playback speed"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                isSpeedActive
                  ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                  : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]'
              }`}
            >
              <Gauge size={18} />
            </button>
            <input
              type="range"
              min={PLAYBACK_SPEED_DRAG_BOUNDS.MIN}
              max={PLAYBACK_SPEED_DRAG_BOUNDS.MAX}
              step={PLAYBACK_SPEED_DRAG_BOUNDS.STEP}
              value={clampedSpeed}
              onChange={(e) => onSetPlaybackSpeed?.(Number(e.target.value))}
              style={getBipolarTrackStyle(speedPct)}
              className="player-range player-range-bipolar player-range-touch flex-1 cursor-pointer"
              aria-label="Playback Speed Slider"
            />
          </div>
        </div>

        {/* Pitch Transpose */}
        <div className="space-y-1.5 border-t border-[var(--player-border-subtle)] pt-3.5">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-[var(--player-text-secondary)]">Pitch Transpose</span>
            <span className={`font-bold tabular-nums ${isTransposeActive ? 'text-[var(--player-accent-text)]' : 'text-[var(--player-text-primary)]'}`}>
              {formatPlaybackTranspose(playbackTranspose)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const current = Number(playbackTranspose) || 0;
                if (Math.abs(current) > 1e-4) {
                  previousTransposeRef.current = current;
                  onSetPlaybackTranspose?.(0);
                } else {
                  onSetPlaybackTranspose?.(previousTransposeRef.current || 1);
                }
              }}
              aria-label="Toggle pitch transpose"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                isTransposeActive
                  ? 'border-[var(--player-accent-border)] bg-[var(--player-accent-soft)] text-[var(--player-accent-text)]'
                  : 'border-[var(--player-border-subtle)] bg-[var(--player-bg-elevated)] text-[var(--player-text-secondary)]'
              }`}
            >
              <Music size={18} />
            </button>
            <input
              type="range"
              min={PLAYBACK_TRANSPOSE_BOUNDS.MIN}
              max={PLAYBACK_TRANSPOSE_BOUNDS.MAX}
              step={PLAYBACK_TRANSPOSE_BOUNDS.STEP}
              value={clampedTranspose}
              onChange={(e) => onSetPlaybackTranspose?.(Number(e.target.value))}
              style={getBipolarTrackStyle(transposePct)}
              className="player-range player-range-bipolar player-range-touch flex-1 cursor-pointer"
              aria-label="Pitch Transpose Slider"
            />
          </div>
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl border border-[var(--player-border-default)] bg-[var(--player-bg-elevated)] hover:bg-[var(--player-bg-popover)] text-[var(--player-text-primary)] font-semibold text-sm transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export default MobileControlsDrawer;
