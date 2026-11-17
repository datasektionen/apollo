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
  playbackTranspose,
  onSetPlaybackTranspose,
  practiceFocusControl,
  onSetPracticeFocusControl,
  practicePanRange,
  onSetPracticePanRange,
  hasRealtimeMetronome,
  metronomeVolume,
  onSetMetronomeVolume,
  // Lyrics & Credits
  currentPlaybackLyrics,
  hasCurrentLyrics,
}) {
  const [activeTab, setActiveTab] = useState('home');
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <div className="relative flex h-full w-full flex-col bg-gray-950 text-white overflow-hidden pt-safe">
      {/* Active Tab Screen */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'home' && (
          <MobileHomeTab
            shows={shows}
            tuttiMixes={tuttiMixes}
            playlists={playlists}
            activeQueueItem={activeQueueItem}
            isPlaying={isPlaying}
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
            onPlayLibraryMix={onPlayLibraryMix}
            onPlayPlaylistRow={onPlayPlaylistRow}
            onOpenUserMenu={() => setUserMenuOpen(true)}
          />
        )}
      </main>

      {/* Floating Mini Player (Visible above tabs whenever track is active) */}
      <div className="relative z-30 shrink-0">
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

      {/* Uniform, Centered Spotify Bottom Navigation Bar (Home, Search, Your Library) */}
      <nav
        className="relative z-40 flex h-16 w-full items-center justify-center border-t border-gray-800/80 bg-gray-950/95 backdrop-blur-md pb-safe select-none shrink-0"
        aria-label="Mobile Navigation"
      >
        <div className="grid grid-cols-3 w-full max-w-md mx-auto items-center">
          {/* Tab 1: Home */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center gap-1 w-full py-1 transition-colors active:scale-95 ${
              activeTab === 'home' ? 'text-white font-semibold' : 'text-gray-400 hover:text-gray-200'
            }`}
            aria-label="Home"
            aria-selected={activeTab === 'home'}
          >
            <Home size={22} className={activeTab === 'home' ? 'stroke-[2.5]' : 'stroke-[1.8]'} />
            <span className="text-[11px] leading-none">Home</span>
          </button>

          {/* Tab 2: Search */}
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex flex-col items-center justify-center gap-1 w-full py-1 transition-colors active:scale-95 ${
              activeTab === 'search' ? 'text-white font-semibold' : 'text-gray-400 hover:text-gray-200'
            }`}
            aria-label="Search"
            aria-selected={activeTab === 'search'}
          >
            <Search size={22} className={activeTab === 'search' ? 'stroke-[2.5]' : 'stroke-[1.8]'} />
            <span className="text-[11px] leading-none">Search</span>
          </button>

          {/* Tab 3: Your Library */}
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`flex flex-col items-center justify-center gap-1 w-full py-1 transition-colors active:scale-95 ${
              activeTab === 'library' ? 'text-white font-semibold' : 'text-gray-400 hover:text-gray-200'
            }`}
            aria-label="Your Library"
            aria-selected={activeTab === 'library'}
          >
            <Library size={22} className={activeTab === 'library' ? 'stroke-[2.5]' : 'stroke-[1.8]'} />
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
        playbackTranspose={playbackTranspose}
        onSetPlaybackTranspose={onSetPlaybackTranspose}
        practiceFocusControl={practiceFocusControl}
        onSetPracticeFocusControl={onSetPracticeFocusControl}
        practicePanRange={practicePanRange}
        onSetPracticePanRange={onSetPracticePanRange}
        hasRealtimeMetronome={hasRealtimeMetronome}
        metronomeVolume={metronomeVolume}
        onSetMetronomeVolume={onSetMetronomeVolume}
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
