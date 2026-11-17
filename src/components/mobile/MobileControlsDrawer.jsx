import React from 'react';
import { X, Sliders, Gauge, Music, Volume2, Metronome } from 'lucide-react';
import { ADVANCED_MIX_PRACTICE_FOCUS_STEPS } from '../../utils/advancedMix';

export function MobileControlsDrawer({
  isOpen,
  onClose,
  playbackSpeed = 1,
  onSetPlaybackSpeed,
  playbackTranspose = 0,
  onSetPlaybackTranspose,
  practiceFocusControl = 2,
  onSetPracticeFocusControl,
  practicePanRange = 100,
  onSetPracticePanRange,
  hasRealtimeMetronome = false,
  metronomeVolume = 80,
  onSetMetronomeVolume,
}) {
  if (!isOpen) return null;

  const speedOptions = [0.8, 0.9, 1.0, 1.1, 1.2];
  const transposeOptions = [-3, -2, -1, 0, 1, 2, 3];
  const focusSteps = ADVANCED_MIX_PRACTICE_FOCUS_STEPS || ['Off', 'Low', 'Med', 'High', 'Solo'];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Practice and stem controls"
    >
      <div
        className="w-full rounded-t-3xl bg-gray-900 border-t border-gray-700/80 p-5 space-y-6 pb-safe shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders size={20} className="text-blue-400" />
            <h2 className="text-base font-bold text-white">Choir Practice & Controls</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:text-white bg-gray-800"
            aria-label="Close controls"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stem Practice Focus Slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-gray-300">Practice Focus</span>
            <span className="text-blue-400 uppercase font-bold">
              {focusSteps[practiceFocusControl] || 'Normal'}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {focusSteps.map((step, idx) => (
              <button
                key={step}
                type="button"
                onClick={() => onSetPracticeFocusControl(idx)}
                className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                  practiceFocusControl === idx
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-750'
                }`}
              >
                {step}
              </button>
            ))}
          </div>
        </div>

        {/* Playback Speed */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-gray-300 flex items-center gap-1.5">
              <Gauge size={14} className="text-amber-400" />
              <span>Speed</span>
            </span>
            <span className="text-amber-400 font-bold">{playbackSpeed}x</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {speedOptions.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => onSetPlaybackSpeed(speed)}
                className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                  playbackSpeed === speed
                    ? 'bg-amber-500 text-black font-bold shadow-md'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-750'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>

        {/* Pitch Transpose */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-gray-300 flex items-center gap-1.5">
              <Music size={14} className="text-purple-400" />
              <span>Pitch Transpose</span>
            </span>
            <span className="text-purple-400 font-bold">
              {playbackTranspose === 0 ? 'Original' : playbackTranspose > 0 ? `+${playbackTranspose} st` : `${playbackTranspose} st`}
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {transposeOptions.map((semi) => (
              <button
                key={semi}
                type="button"
                onClick={() => onSetPlaybackTranspose(semi)}
                className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                  playbackTranspose === semi
                    ? 'bg-purple-600 text-white shadow-md font-bold'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-750'
                }`}
              >
                {semi > 0 ? `+${semi}` : semi}
              </button>
            ))}
          </div>
        </div>

        {/* Metronome (if available in active snapshot) */}
        {hasRealtimeMetronome && (
          <div className="space-y-2 border-t border-gray-800 pt-3">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-gray-300 flex items-center gap-1.5">
                <Metronome size={14} className="text-teal-400" />
                <span>Metronome Click</span>
              </span>
              <span className="text-teal-400 font-bold">{metronomeVolume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={metronomeVolume}
              onChange={(e) => onSetMetronomeVolume(Number(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-400"
            />
          </div>
        )}

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-semibold text-sm transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export default MobileControlsDrawer;
