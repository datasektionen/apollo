import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Loader2,
  MicVocal,
  Sliders,
  Music2,
  Info,
  Gauge,
  Music,
  Volume2,
  VolumeX,
  Metronome,
  ChevronsLeftRightEllipsis,
  ChevronDown as ScrollDownIcon,
} from 'lucide-react';
import { formatClock, formatDurationMs } from '../../utils/playerTime';
import { PLAYER_LOOP_MODES } from '../../types/player';
import { ADVANCED_MIX_PRACTICE_FOCUS_STEPS } from '../../utils/advancedMix';
import { getProjectCredits } from '../../lib/serverApi';
import PlayerLyricsView from '../PlayerLyricsView';

export function MobileNowPlayingModal({
  isOpen,
  onClose,
  activeQueueItem,
  isPlaying,
  isRendering,
  currentTimeSec,
  durationSec,
  volume = 80,
  onSetVolume,
  loopMode,
  shuffleEnabled,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  beginTimelineScrub,
  endTimelineScrub,
  onCycleLoopMode,
  onToggleShuffle,
  // Choir stem controls
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
  // Lyrics & Session
  currentPlaybackLyrics,
  hasCurrentLyrics,
  session,
}) {
  const [isMuted, setIsMuted] = useState(false);
  const previousVolumeRef = useRef(volume);
  const [creditsState, setCreditsState] = useState({ status: 'idle', data: null, error: '' });

  // Load credits automatically for the active project
  useEffect(() => {
    if (!activeQueueItem?.projectId) {
      setCreditsState({ status: 'idle', data: null, error: '' });
      return;
    }
    let cancelled = false;
    setCreditsState({ status: 'loading', data: null, error: '' });
    getProjectCredits(activeQueueItem.projectId, session)
      .then((data) => {
        if (!cancelled) {
          setCreditsState({ status: 'ready', data, error: '' });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCreditsState({ status: 'error', data: null, error: err.message || 'Failed to load credits' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeQueueItem?.projectId, session]);

  if (!isOpen || !activeQueueItem) return null;

  const title = activeQueueItem.name || activeQueueItem.title || 'Untitled Track';
  const subtitle = activeQueueItem.showName || activeQueueItem.artist || activeQueueItem.projectName || 'Apollo Choir';
  const musicalNumber = activeQueueItem.musicalNumber || '';
  const collectionName = activeQueueItem.collectionName || activeQueueItem.showName || 'Queue';

  const isLoopOne = loopMode === PLAYER_LOOP_MODES.ONE;
  const isLoopAll = loopMode === PLAYER_LOOP_MODES.ALL;

  const focusSteps = ADVANCED_MIX_PRACTICE_FOCUS_STEPS || ['Omitted', 'Low', 'Med', 'High', 'Solo'];
  const focusLabels = ['Omitted (-)', 'Low', 'Med (Default)', 'High', 'Solo (+)'];
  const speedQuickOptions = [0.8, 0.9, 1.0, 1.1, 1.2];

  const handleToggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      onSetVolume?.(previousVolumeRef.current || 80);
    } else {
      previousVolumeRef.current = volume;
      setIsMuted(true);
      onSetVolume?.(0);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-gray-900 via-gray-950 to-black text-white pt-safe pb-safe select-none animate-in fade-in slide-in-from-bottom-8 duration-200 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
    >
      {/* Top Header */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between px-4 bg-gray-900/90 backdrop-blur-md border-b border-white/5 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center text-gray-300 hover:text-white active:scale-95 transition-transform"
          aria-label="Collapse player"
        >
          <ChevronDown size={28} />
        </button>

        <div className="min-w-0 flex-1 px-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Playing from collection
          </div>
          <div className="truncate text-xs font-semibold text-gray-200">
            {collectionName}
          </div>
        </div>

        <div className="w-10" />
      </header>

      {/* Main View Area */}
      <div className="px-6 py-4 space-y-8 max-w-lg mx-auto w-full">
        {/* ============================================================ */}
        {/* 1. TOP FOLD: Artwork, Track Info, Scrubber, Transport Controls */}
        {/* ============================================================ */}
        <section className="space-y-6">
          {/* Artwork */}
          <div className="flex flex-col items-center justify-center pt-2">
            <div className="relative aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-gray-800 shadow-2xl ring-1 ring-white/10 flex items-center justify-center">
              {activeQueueItem.artworkUrl ? (
                <img
                  src={activeQueueItem.artworkUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-indigo-900 via-blue-900 to-gray-900 p-6 text-center">
                  <Music2 size={64} className="text-blue-400/80 mb-3" />
                  {musicalNumber && (
                    <span className="text-4xl font-extrabold tracking-tight text-white/90">
                      {musicalNumber}
                    </span>
                  )}
                  <span className="mt-2 text-sm font-medium text-gray-300 max-w-[200px] truncate">
                    {subtitle}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Track Info */}
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white line-clamp-2">
              {title}
            </h1>
            <p className="mt-1 text-base font-medium text-gray-400 truncate">
              {subtitle}
            </p>
          </div>

          {/* Scrubber / Progress Bar */}
          <div className="space-y-1.5">
            <input
              type="range"
              min="0"
              max={Math.max(durationSec, 0.001)}
              step="0.01"
              value={Math.min(currentTimeSec, durationSec || 0)}
              onPointerDown={beginTimelineScrub}
              onPointerUp={endTimelineScrub}
              onPointerCancel={endTimelineScrub}
              onChange={(e) => onSeek?.(Number(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-white hover:h-2 transition-all block"
              aria-label="Seek track position"
            />
            <div className="flex justify-between text-xs font-medium text-gray-400 tabular-nums">
              <span>{formatClock(currentTimeSec)}</span>
              <span>{formatClock(durationSec)}</span>
            </div>
          </div>

          {/* Spotify Media Transport Controls */}
          <div className="flex items-center justify-between px-2">
            {/* Shuffle */}
            <button
              type="button"
              onClick={onToggleShuffle}
              className={`flex h-10 w-10 items-center justify-center transition-colors active:scale-90 ${
                shuffleEnabled ? 'text-green-500' : 'text-gray-400 hover:text-white'
              }`}
              aria-label={shuffleEnabled ? 'Shuffle enabled' : 'Shuffle disabled'}
            >
              <Shuffle size={22} />
            </button>

            {/* Previous */}
            <button
              type="button"
              onClick={onPrevious}
              className="flex h-12 w-12 items-center justify-center text-white active:scale-90 transition-transform"
              aria-label="Previous track"
            >
              <SkipBack size={32} className="fill-current" />
            </button>

            {/* Big Circular White Play/Pause Button */}
            <button
              type="button"
              onClick={onTogglePlay}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-2xl active:scale-95 transition-transform hover:scale-105"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isRendering ? (
                <Loader2 size={30} className="animate-spin text-black" />
              ) : isPlaying ? (
                <Pause size={32} className="fill-black" />
              ) : (
                <Play size={32} className="fill-black translate-x-0.5" />
              )}
            </button>

            {/* Next */}
            <button
              type="button"
              onClick={onNext}
              className="flex h-12 w-12 items-center justify-center text-white active:scale-90 transition-transform"
              aria-label="Next track"
            >
              <SkipForward size={32} className="fill-current" />
            </button>

            {/* Loop Mode */}
            <button
              type="button"
              onClick={onCycleLoopMode}
              className={`flex h-10 w-10 items-center justify-center transition-colors active:scale-90 ${
                isLoopAll || isLoopOne ? 'text-green-500' : 'text-gray-400 hover:text-white'
              }`}
              aria-label={`Loop mode: ${loopMode}`}
            >
              {isLoopOne ? <Repeat1 size={22} /> : <Repeat size={22} />}
            </button>
          </div>

          {/* Scroll Down Hint */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 pt-2">
            <span>Scroll down for practice controls, lyrics & credits</span>
            <ScrollDownIcon size={14} className="animate-bounce" />
          </div>
        </section>

        {/* ============================================================ */}
        {/* 2. SCROLL SECTION: Practice & Sound Controls (Desktop-Style Sliders) */}
        {/* ============================================================ */}
        <section className="space-y-5 rounded-2xl bg-gray-900/90 border border-gray-800 p-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-gray-800 pb-3">
            <Sliders size={20} className="text-blue-400" />
            <h2 className="text-base font-bold text-white">Choir Practice & Sound Controls</h2>
          </div>

          {/* 1. Practice Focus Slider (Desktop 5-step Snapping) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-gray-300">Practice Focus</span>
              <span className="text-blue-400 font-bold uppercase">
                {focusLabels[practiceFocusControl] || 'Normal'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="4"
              step="1"
              value={practiceFocusControl}
              onChange={(e) => onSetPracticeFocusControl?.(Number(e.target.value))}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              aria-label="Practice Focus Slider"
            />
            <div className="grid grid-cols-5 gap-1 pt-1">
              {focusSteps.map((step, idx) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => onSetPracticeFocusControl?.(idx)}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                    practiceFocusControl === idx
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-800/80 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {step}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Transformed Pan Range Slider (0 - 200%) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-gray-300 flex items-center gap-1.5">
                <ChevronsLeftRightEllipsis size={14} className="text-blue-400" />
                <span>Pan Range (Choir Width)</span>
              </span>
              <span className="text-blue-400 font-bold">{practicePanRange}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={practicePanRange}
              onChange={(e) => onSetPracticePanRange?.(Number(e.target.value))}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              aria-label="Practice Pan Range Slider"
            />
            <div className="flex justify-between text-[10px] text-gray-500 font-medium">
              <span>0% (Mono)</span>
              <span>100% (Stereo)</span>
              <span>200% (Wide)</span>
            </div>
          </div>

          {/* 3. Playback Speed Slider & Quick Buttons */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-gray-300 flex items-center gap-1.5">
                <Gauge size={14} className="text-amber-400" />
                <span>Playback Speed</span>
              </span>
              <span className="text-amber-400 font-bold">{playbackSpeed}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={playbackSpeed}
              onChange={(e) => onSetPlaybackSpeed?.(Number(e.target.value))}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              aria-label="Playback Speed Slider"
            />
            <div className="grid grid-cols-5 gap-1.5 pt-1">
              {speedQuickOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSetPlaybackSpeed?.(s)}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    Math.abs(playbackSpeed - s) < 0.01
                      ? 'bg-amber-500 text-black font-bold shadow-md'
                      : 'bg-gray-800 text-gray-300 hover:text-white'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* 4. Pitch Transpose Slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-gray-300 flex items-center gap-1.5">
                <Music size={14} className="text-purple-400" />
                <span>Pitch Transposition</span>
              </span>
              <span className="text-purple-400 font-bold">
                {playbackTranspose === 0 ? 'Original (0 st)' : playbackTranspose > 0 ? `+${playbackTranspose} st` : `${playbackTranspose} st`}
              </span>
            </div>
            <input
              type="range"
              min="-6"
              max="6"
              step="1"
              value={playbackTranspose}
              onChange={(e) => onSetPlaybackTranspose?.(Number(e.target.value))}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              aria-label="Pitch Transpose Slider"
            />
            <div className="flex justify-between items-center text-[11px] text-gray-400 pt-1">
              <span>-6 st</span>
              <button
                type="button"
                onClick={() => onSetPlaybackTranspose?.(0)}
                className="px-2.5 py-1 rounded bg-gray-800 text-gray-300 hover:text-white active:scale-95 font-medium"
              >
                Reset to Original
              </button>
              <span>+6 st</span>
            </div>
          </div>

          {/* 5. Master Volume Slider with Mute */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-gray-300 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="hover:text-white transition-colors"
                >
                  {isMuted || volume === 0 ? <VolumeX size={16} className="text-red-400" /> : <Volume2 size={16} className="text-gray-300" />}
                </button>
                <span>Master Volume</span>
              </span>
              <span className="text-gray-200 font-bold">{isMuted ? 'Muted' : `${volume}%`}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setIsMuted(false);
                onSetVolume?.(Number(e.target.value));
              }}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
              aria-label="Master Volume Slider"
            />
          </div>

          {/* 6. Metronome Click Volume (if snapshot has metronome) */}
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
                step="1"
                value={metronomeVolume}
                onChange={(e) => onSetMetronomeVolume?.(Number(e.target.value))}
                className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                aria-label="Metronome Volume Slider"
              />
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* 3. SCROLL SECTION: Synchronized Lyrics */}
        {/* ============================================================ */}
        <section className="space-y-3 rounded-2xl bg-gradient-to-br from-amber-950/30 to-gray-900 border border-amber-900/40 p-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-amber-900/40 pb-3">
            <MicVocal size={20} className="text-amber-400" />
            <h2 className="text-base font-bold text-white">Lyrics</h2>
          </div>

          {hasCurrentLyrics ? (
            <div className="min-h-[220px] max-h-[380px] overflow-y-auto rounded-xl bg-black/40 p-3">
              <PlayerLyricsView
                lyrics={currentPlaybackLyrics}
                currentTimeMs={currentTimeSec * 1000}
                durationMs={durationSec * 1000}
                songTitle={title}
                onSeek={(ms) => onSeek?.(ms / 1000)}
              />
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-gray-500">
              No lyrics available for this song.
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* 4. SCROLL SECTION: Credits */}
        {/* ============================================================ */}
        <section className="space-y-4 rounded-2xl bg-gray-900/90 border border-gray-800 p-5 shadow-xl pb-10">
          <div className="flex items-center gap-2 border-b border-gray-800 pb-3">
            <Info size={20} className="text-purple-400" />
            <h2 className="text-base font-bold text-white">Credits</h2>
          </div>

          {creditsState.status === 'loading' ? (
            <div className="py-8 flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 size={18} className="animate-spin text-purple-400" />
              <span>Loading credits...</span>
            </div>
          ) : creditsState.error ? (
            <div className="rounded-lg border border-red-700/50 bg-red-950/40 p-3 text-xs text-red-200">
              {creditsState.error}
            </div>
          ) : creditsState.data ? (
            <div className="space-y-4 text-sm">
              {/* Show Header */}
              {creditsState.data.show ? (
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3.5 space-y-1">
                  <div className="font-bold text-white">{creditsState.data.show.name}</div>
                  {creditsState.data.show.description && (
                    <p className="text-xs text-gray-300 leading-relaxed">
                      {creditsState.data.show.description}
                    </p>
                  )}
                </div>
              ) : null}

              {/* Composition & Lyrics */}
              {creditsState.data.credits?.compositionLyrics?.length ? (
                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Composition & Lyrics
                  </div>
                  <div className="divide-y divide-gray-800/80 rounded-lg bg-gray-950/40 px-3">
                    {creditsState.data.credits.compositionLyrics.map((item, idx) => (
                      <div key={idx} className="py-2 flex justify-between items-center">
                        <span className="font-medium text-gray-200">{item.artist?.name || item.name}</span>
                        <span className="text-xs text-gray-400">{item.role || 'Writer'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Performers */}
              {creditsState.data.credits?.performers?.length ? (
                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Performers & Choir
                  </div>
                  <div className="divide-y divide-gray-800/80 rounded-lg bg-gray-950/40 px-3 max-h-60 overflow-y-auto">
                    {creditsState.data.credits.performers.map((item, idx) => (
                      <div key={idx} className="py-2 flex justify-between items-center">
                        <span className="font-medium text-gray-200">{item.artist?.name || item.name}</span>
                        <span className="text-xs text-blue-400 font-mono">{item.role || 'Performer'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Production */}
              {creditsState.data.credits?.productionEngineering?.length ? (
                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Production & Engineering
                  </div>
                  <div className="divide-y divide-gray-800/80 rounded-lg bg-gray-950/40 px-3">
                    {creditsState.data.credits.productionEngineering.map((item, idx) => (
                      <div key={idx} className="py-2 flex justify-between items-center">
                        <span className="font-medium text-gray-200">{item.artist?.name || item.name}</span>
                        <span className="text-xs text-gray-400">{item.role || 'Engineer'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-gray-500">
              No credits recorded for this project.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default MobileNowPlayingModal;
