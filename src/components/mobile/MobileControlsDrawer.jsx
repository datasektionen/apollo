import React from 'react';
import { X, Sliders, Gauge, Music, Metronome } from 'lucide-react';
import {
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
  ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
} from '../../utils/advancedMix';
import { formatPlaybackSpeed, formatPlaybackTranspose } from '../../utils/playerControlsSidebar';

function formatFocusLabel(step) {
  if (step === 'omitted') return 'Omitted';
  if (step === 'solo') return 'Solo';
  const numeric = Number(step);
  if (!Number.isFinite(numeric)) return '0 dB';
  if (numeric === 0) return '0 dB';
  return `${numeric > 0 ? '+' : ''}${numeric} dB`;
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
  if (!isOpen) return null;

  const speedOptions = [0.8, 0.9, 1.0, 1.1, 1.2];
  const transposeOptions = [-3, -2, -1, 0, 1, 2, 3];
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
  const focusQuickOptions = [
    { idx: 0, label: 'Omit' },
    { idx: 4, label: '-6' },
    { idx: ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX, label: '0 dB' },
    { idx: 8, label: '+6' },
    { idx: focusSteps.length - 1, label: 'Solo' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[var(--player-bg-scrim)] backdrop-blur-sm animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Practice and stem controls"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl bg-[var(--player-bg-surface)] border-t border-[var(--player-border-default)] p-5 space-y-6 pb-safe shadow-[var(--player-shadow-sheet)] max-h-[85vh] overflow-y-auto"
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

        {/* Stem Practice Focus */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-[var(--player-text-secondary)]">Practice Focus</span>
            <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
              {formatFocusLabel(focusSteps[clampedFocusIdx])}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {focusQuickOptions.map((opt) => {
              const active = clampedFocusIdx === opt.idx;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onSetPracticeFocusControl(opt.idx)}
                  aria-pressed={active}
                  className={`py-2 rounded-lg border text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--player-accent-soft)] border-[var(--player-accent-border)] text-[var(--player-accent-text)]'
                      : 'bg-[var(--player-bg-elevated)] border-[var(--player-border-subtle)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Playback Speed */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
              <Gauge size={14} className="text-[var(--player-accent-text)]" />
              <span>Speed</span>
            </span>
            <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
              {formatPlaybackSpeed(playbackSpeed)}x
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {speedOptions.map((speed) => {
              const active = Math.abs(Number(playbackSpeed) - speed) < 0.01;
              return (
                <button
                  key={speed}
                  type="button"
                  onClick={() => onSetPlaybackSpeed(speed)}
                  aria-pressed={active}
                  className={`py-2 rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
                    active
                      ? 'bg-[var(--player-accent)] border-[var(--player-accent)] text-[var(--player-accent-foreground)] font-bold'
                      : 'bg-[var(--player-bg-elevated)] border-[var(--player-border-subtle)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                  }`}
                >
                  {speed}x
                </button>
              );
            })}
          </div>
        </div>

        {/* Pitch Transpose */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
              <Music size={14} className="text-[var(--player-accent-text)]" />
              <span>Pitch Transpose</span>
            </span>
            <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
              {playbackTranspose === 0 ? 'Original' : formatPlaybackTranspose(playbackTranspose)}
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {transposeOptions.map((semi) => {
              const active = Number(playbackTranspose) === semi;
              return (
                <button
                  key={semi}
                  type="button"
                  onClick={() => onSetPlaybackTranspose(semi)}
                  aria-pressed={active}
                  className={`py-2 rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
                    active
                      ? 'bg-[var(--player-accent-soft)] border-[var(--player-accent-border)] text-[var(--player-accent-text)] font-bold'
                      : 'bg-[var(--player-bg-elevated)] border-[var(--player-border-subtle)] text-[var(--player-text-secondary)] hover:text-[var(--player-text-primary)]'
                  }`}
                >
                  {semi > 0 ? `+${semi}` : semi}
                </button>
              );
            })}
          </div>
        </div>

        {/* Metronome (if available in active snapshot) */}
        {hasRealtimeMetronome && (
          <div className="space-y-2 border-t border-[var(--player-border-subtle)] pt-3">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-[var(--player-text-secondary)] flex items-center gap-1.5">
                <Metronome size={14} className="text-[var(--player-accent-text)]" />
                <span>Metronome Click</span>
              </span>
              <span className="text-[var(--player-accent-text)] font-bold tabular-nums">
                {metronomeVolume}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={metronomeVolume}
              onChange={(e) => onSetMetronomeVolume(Number(e.target.value))}
              style={{ '--player-range-pct': `${metronomeVolume}%` }}
              className="player-range player-range-touch w-full cursor-pointer"
            />
          </div>
        )}

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
