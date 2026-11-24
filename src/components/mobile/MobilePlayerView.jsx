import React, { useState } from 'react';
import { Home, Search, Library } from 'lucide-react';
import MobileHomeTab from './MobileHomeTab';
import MobileSearchTab from './MobileSearchTab';
import MobileLibraryTab from './MobileLibraryTab';
import MobileMiniPlayer from './MobileMiniPlayer';
import MobileNowPlayingModal from './MobileNowPlayingModal';
import MobileUserMenuModal from './MobileUserMenuModal';

export function MobilePlayerView({
  session,
  onLogout,
  onOpenProfile,
  onSwitchToDawDashboard,
  onOpenAdmin,
  // Audio settings
  audioSettings,
  setAudioSettings,
  audioInputs,
  audioOutputs,
  monoOutputActive,
  outputChannelCount,
  onRefreshAudioDevices,
  // Playback state
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
  // Active queue
  activeQueueItem,
  // Library content
  shows,
  playlists,
  folders,
  playlistItemsByPlaylistId,
  tuttiMixes,
  homeMixes = null,
  globalMixes,
  myMixes,
  onPlayMix,
  onPlayLibraryMix,
  onPlayPlaylistRow,
  // Search
  searchDraft,
  onSearchDraftChange,
  searchType,
  onSearchTypeChange,
  searchResults,
  searchSongItems,
  focusedSearchCreditId,
  onFocusedCreditChange,
  onSelectSearchItem,
  onPlaySearchItem,
  // Stem Controls
  playbackSpeed,
  onSetPlaybackSpeed,
  onToggleSpeed,
  playbackTranspose,
  onSetPlaybackTranspose,
  onToggleTranspose,
  practiceFocusControl,
  onSetPracticeFocusControl,
  onTogglePracticeFocus,
  practicePanRange,
  onSetPracticePanRange,
  onTogglePracticePanRange,
  hasRealtimeMetronome,
  metronomeVolume,
  onSetMetronomeVolume,
  onToggleMetronomeMute,
  // Lyrics & Credits
  currentPlaybackLyrics,
  hasCurrentLyrics,
}) {
  const [activeTab, setActiveTab] = useState('home');
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <div className="relative flex h-full w-full flex-col bg-[var(--player-bg-canvas)] text-[var(--player-text-primary)] overflow-hidden pt-safe">
      {/* Active Tab Screen */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'home' && (
          <MobileHomeTab
            shows={shows}
            tuttiMixes={homeMixes ?? tuttiMixes}
            playlists={playlists}
            activeQueueItem={activeQueueItem}
            isPlaying={isPlaying}
            shuffleEnabled={shuffleEnabled}
            onToggleShuffle={onToggleShuffle}
            onTogglePlay={onTogglePlay}
            onPlayMix={onPlayMix || onPlayLibraryMix}
            onSelectPlaylist={() => setActiveTab('library')}
            onOpenUserMenu={() => setUserMenuOpen(true)}
          />
        )}

        {activeTab === 'search' && (
          <MobileSearchTab
            searchDraft={searchDraft}
            onSearchDraftChange={onSearchDraftChange}
            searchType={searchType}
            onSearchTypeChange={onSearchTypeChange}
            searchResults={searchResults}
            searchSongItems={searchSongItems}
            focusedSearchCreditId={focusedSearchCreditId}
            onFocusedCreditChange={onFocusedCreditChange}
            onSelectSearchItem={onSelectSearchItem}
            onPlaySearchItem={onPlaySearchItem}
            onOpenUserMenu={() => setUserMenuOpen(true)}
          />
        )}

        {activeTab === 'library' && (
          <MobileLibraryTab
            playlists={playlists}
            folders={folders}
            playlistItemsByPlaylistId={playlistItemsByPlaylistId}
            myMixes={myMixes}
            tuttiMixes={tuttiMixes}
            activeQueueItem={activeQueueItem}
            isPlaying={isPlaying}
            shuffleEnabled={shuffleEnabled}
            onToggleShuffle={onToggleShuffle}
            onTogglePlay={onTogglePlay}
            onPlayLibraryMix={onPlayLibraryMix}
            onPlayPlaylistRow={onPlayPlaylistRow}
            onOpenUserMenu={() => setUserMenuOpen(true)}
          />
        )}
      </main>

      {/* Floating Mini Player (Visible above tabs whenever track is active) */}
      <div className="relative z-30 shrink-0">
        {activeQueueItem ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-7 left-0 right-0 h-7 bg-gradient-to-t from-[var(--player-bg-canvas)] via-[var(--player-bg-canvas)]/75 to-transparent"
          />
        ) : null}
        <MobileMiniPlayer
          activeQueueItem={activeQueueItem}
          isPlaying={isPlaying}
          isRendering={isRendering}
          currentTimeSec={currentTimeSec}
          durationSec={durationSec}
          onTogglePlay={onTogglePlay}
          onOpenNowPlaying={() => setNowPlayingOpen(true)}
        />
      </div>

      {/* Uniform, Centered Obsidian Bottom Navigation Bar (Home, Search, Your Library) */}
      <nav
        className="relative z-40 flex h-16 w-full items-center justify-center border-t border-[var(--player-border-subtle)] bg-[var(--player-bg-canvas-translucent)] backdrop-blur-md pb-safe select-none shrink-0"
        aria-label="Mobile Navigation"
      >
        <div className="grid grid-cols-3 w-full max-w-md mx-auto items-center">
          {/* Tab 1: Home */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            data-active={activeTab === 'home' ? 'true' : 'false'}
            className={`relative flex flex-col items-center justify-center gap-1 w-full py-1.5 transition-colors active:scale-95 ${
              activeTab === 'home'
                ? 'text-[var(--player-text-primary)] font-semibold'
                : 'text-[var(--player-text-muted)] hover:text-[var(--player-text-secondary)]'
            }`}
            aria-label="Home"
            aria-selected={activeTab === 'home'}
          >
            {activeTab === 'home' ? (
              <span className="absolute top-0 h-[2px] w-4 rounded-full bg-[var(--player-accent)]" aria-hidden="true" />
            ) : null}
            <Home size={21} className={activeTab === 'home' ? 'stroke-[2.4] text-[var(--player-accent-text)]' : 'stroke-[1.75]'} />
            <span className="text-[11px] leading-none">Home</span>
          </button>

          {/* Tab 2: Search */}
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            data-active={activeTab === 'search' ? 'true' : 'false'}
            className={`relative flex flex-col items-center justify-center gap-1 w-full py-1.5 transition-colors active:scale-95 ${
              activeTab === 'search'
                ? 'text-[var(--player-text-primary)] font-semibold'
                : 'text-[var(--player-text-muted)] hover:text-[var(--player-text-secondary)]'
            }`}
            aria-label="Search"
            aria-selected={activeTab === 'search'}
          >
            {activeTab === 'search' ? (
              <span className="absolute top-0 h-[2px] w-4 rounded-full bg-[var(--player-accent)]" aria-hidden="true" />
            ) : null}
            <Search size={21} className={activeTab === 'search' ? 'stroke-[2.4] text-[var(--player-accent-text)]' : 'stroke-[1.75]'} />
            <span className="text-[11px] leading-none">Search</span>
          </button>

          {/* Tab 3: Your Library */}
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            data-active={activeTab === 'library' ? 'true' : 'false'}
            className={`relative flex flex-col items-center justify-center gap-1 w-full py-1.5 transition-colors active:scale-95 ${
              activeTab === 'library'
                ? 'text-[var(--player-text-primary)] font-semibold'
                : 'text-[var(--player-text-muted)] hover:text-[var(--player-text-secondary)]'
            }`}
            aria-label="Your Library"
            aria-selected={activeTab === 'library'}
          >
            {activeTab === 'library' ? (
              <span className="absolute top-0 h-[2px] w-4 rounded-full bg-[var(--player-accent)]" aria-hidden="true" />
            ) : null}
            <Library size={21} className={activeTab === 'library' ? 'stroke-[2.4] text-[var(--player-accent-text)]' : 'stroke-[1.75]'} />
            <span className="text-[11px] leading-none">Your Library</span>
          </button>
        </div>
      </nav>

      {/* Full-Screen Now Playing View (with scroll-down practice controls, sliders, lyrics, and credits) */}
      <MobileNowPlayingModal
        isOpen={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        activeQueueItem={activeQueueItem}
        isPlaying={isPlaying}
        isRendering={isRendering}
        currentTimeSec={currentTimeSec}
        durationSec={durationSec}
        volume={volume}
        onSetVolume={onSetVolume}
        loopMode={loopMode}
        shuffleEnabled={shuffleEnabled}
        onTogglePlay={onTogglePlay}
        onPrevious={onPrevious}
        onNext={onNext}
        onSeek={onSeek}
        beginTimelineScrub={beginTimelineScrub}
        endTimelineScrub={endTimelineScrub}
        onCycleLoopMode={onCycleLoopMode}
        onToggleShuffle={onToggleShuffle}
        // Choir practice sliders
        playbackSpeed={playbackSpeed}
        onSetPlaybackSpeed={onSetPlaybackSpeed}
        onToggleSpeed={onToggleSpeed}
        playbackTranspose={playbackTranspose}
        onSetPlaybackTranspose={onSetPlaybackTranspose}
        onToggleTranspose={onToggleTranspose}
        practiceFocusControl={practiceFocusControl}
        onSetPracticeFocusControl={onSetPracticeFocusControl}
        onTogglePracticeFocus={onTogglePracticeFocus}
        practicePanRange={practicePanRange}
        onSetPracticePanRange={onSetPracticePanRange}
        onTogglePracticePanRange={onTogglePracticePanRange}
        hasRealtimeMetronome={hasRealtimeMetronome}
        metronomeVolume={metronomeVolume}
        onSetMetronomeVolume={onSetMetronomeVolume}
        onToggleMetronomeMute={onToggleMetronomeMute}
        // Lyrics & Session
        currentPlaybackLyrics={currentPlaybackLyrics}
        hasCurrentLyrics={hasCurrentLyrics}
        session={session}
      />

      {/* User Menu Modal / Slide-over */}
      <MobileUserMenuModal
        isOpen={userMenuOpen}
        onClose={() => setUserMenuOpen(false)}
        session={session}
        onOpenProfile={onOpenProfile}
        onSwitchToDawDashboard={onSwitchToDawDashboard}
        onOpenAdmin={onOpenAdmin}
        onLogout={onLogout}
        audioSettings={audioSettings}
        setAudioSettings={setAudioSettings}
        audioInputs={audioInputs}
        audioOutputs={audioOutputs}
        monoOutputActive={monoOutputActive}
        outputChannelCount={outputChannelCount}
        onRefreshAudioDevices={onRefreshAudioDevices}
      />
    </div>
  );
}

export default MobilePlayerView;
