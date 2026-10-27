import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import PlayerLyricsView from '../PlayerLyricsView';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function setScrollDimensions(view, viewportHeight, scrollHeight) {
  const scrollContainer = view.container.querySelector('[aria-label="Lyrics lines"]');
  Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: viewportHeight });
  Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: scrollHeight });
}

function renderLyrics(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PlayerLyricsView {...props} />));
  return {
    container,
    rerender(nextProps) {
      act(() => root.render(<PlayerLyricsView {...nextProps} />));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('PlayerLyricsView', () => {
  let view;

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('highlights the current synced lyric and tones past and upcoming lines separately', () => {
    view = renderLyrics({
      lyrics: {
        useSyncedLyrics: true,
        lines: [
          { id: 'past', text: 'Past line', startMs: 0 },
          { id: 'current', text: 'Current line', startMs: 1000 },
          { id: 'upcoming', text: 'Upcoming line', startMs: 2000 },
        ],
      },
      currentTimeMs: 1500,
    });

    const past = view.container.querySelector('[data-lyric-id="past"]');
    const current = view.container.querySelector('[data-lyric-id="current"]');
    const upcoming = view.container.querySelector('[data-lyric-id="upcoming"]');
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.className).toContain('text-white');
    expect(past.className).toContain('text-gray-400');
    expect(upcoming.className).toContain('text-gray-300');
  });

  it('resets scroll to the start for a new song and a playback restart', () => {
    const firstLyrics = { useSyncedLyrics: false, lines: [{ id: 'old', text: 'Old song' }] };
    const nextLyrics = { useSyncedLyrics: false, lines: [{ id: 'new', text: 'New song' }] };
    view = renderLyrics({ lyrics: firstLyrics, currentTimeMs: 2500, durationMs: 5000 });

    const scrollContainer = view.container.querySelector('[aria-label="Lyrics lines"]');
    scrollContainer.scrollTop = 380;
    view.rerender({ lyrics: nextLyrics, currentTimeMs: 0, durationMs: 5000 });
    expect(scrollContainer.scrollTop).toBe(0);

    scrollContainer.scrollTop = 240;
    view.rerender({ lyrics: nextLyrics, currentTimeMs: 1500, durationMs: 5000 });
    expect(scrollContainer.scrollTop).toBe(240);

    scrollContainer.scrollTop = 300;
    view.rerender({ lyrics: nextLyrics, currentTimeMs: 0, durationMs: 5000 });
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it('keeps the upcoming first lyric at the top without scrollable space above it', () => {
    view = renderLyrics({
      lyrics: {
        useSyncedLyrics: true,
        lines: [
          { id: 'first', text: 'First line', startMs: 1000 },
          { id: 'second', text: 'Second line', startMs: 2000 },
        ],
      },
      currentTimeMs: 0,
      durationMs: 4000,
    });

    const scrollContainer = view.container.querySelector('[aria-label="Lyrics lines"]');
    const firstLine = view.container.querySelector('[data-lyric-id="first"]');
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 600, height: 600 });
    vi.spyOn(firstLine, 'getBoundingClientRect').mockImplementation(() => ({
      top: 16 - scrollContainer.scrollTop,
      bottom: 56 - scrollContainer.scrollTop,
      height: 40,
    }));
    const scrollTo = vi.fn(({ top }) => { scrollContainer.scrollTop = top; });
    scrollContainer.scrollTo = scrollTo;
    setScrollDimensions(view, 600, 1000);

    act(() => scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true })));

    expect(scrollContainer.scrollTop).toBe(0);
    expect(firstLine.getBoundingClientRect().top).toBe(16);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollContainer.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('jumps to the first line when it becomes active after being scrolled out of view', () => {
    vi.useFakeTimers();
    const lyrics = {
      useSyncedLyrics: true,
      lines: [
        { id: 'first', text: 'First line', startMs: 1000 },
        { id: 'second', text: 'Second line', startMs: 2000 },
      ],
    };
    view = renderLyrics({ lyrics, currentTimeMs: 0, durationMs: 4000 });

    const scrollContainer = view.container.querySelector('[aria-label="Lyrics lines"]');
    const firstLine = view.container.querySelector('[data-lyric-id="first"]');
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 200, height: 200 });
    vi.spyOn(firstLine, 'getBoundingClientRect').mockImplementation(() => ({
      top: 16 - scrollContainer.scrollTop,
      bottom: 56 - scrollContainer.scrollTop,
      height: 40,
    }));
    const scrollTo = vi.fn(({ top }) => { scrollContainer.scrollTop = top; });
    scrollContainer.scrollTo = scrollTo;
    setScrollDimensions(view, 200, 1000);
    scrollContainer.scrollTop = 200;
    act(() => scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true })));

    view.rerender({ lyrics, currentTimeMs: 1100, durationMs: 4000 });

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    expect(scrollContainer.scrollTop).toBe(0);
    expect(firstLine.getBoundingClientRect().top).toBe(16);
  });

  it('centers lines when possible and aligns edge lines to the top or bottom', () => {
    vi.useFakeTimers();
    const lyrics = {
      useSyncedLyrics: true,
      lines: [
        { id: 'first', text: 'First line', startMs: 0 },
        { id: 'second', text: 'Second line', startMs: 1000 },
        { id: 'third', text: 'Third line', startMs: 2000 },
        { id: 'last', text: 'Last line', startMs: 3000 },
      ],
    };
    view = renderLyrics({ lyrics, currentTimeMs: 100, durationMs: 4000 });

    const scrollContainer = view.container.querySelector('[aria-label="Lyrics lines"]');
    const firstLine = view.container.querySelector('[data-lyric-id="first"]');
    const secondLine = view.container.querySelector('[data-lyric-id="second"]');
    const thirdLine = view.container.querySelector('[data-lyric-id="third"]');
    const lastLine = view.container.querySelector('[data-lyric-id="last"]');
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 600, height: 600 });
    Object.entries({ firstLine: 16, secondLine: 76, thirdLine: 436, lastLine: 1150 }).forEach(([name, top]) => {
      const element = { firstLine, secondLine, thirdLine, lastLine }[name];
      vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => ({
        top: top - scrollContainer.scrollTop,
        bottom: top + 40 - scrollContainer.scrollTop,
        height: 40,
      }));
    });
    const scrollTo = vi.fn(({ top }) => { scrollContainer.scrollTop = top; });
    scrollContainer.scrollTo = scrollTo;
    setScrollDimensions(view, 600, 1200);

    expect(scrollContainer.scrollTop).toBe(0);
    expect(firstLine.getBoundingClientRect().top).toBe(16);

    view.rerender({ lyrics, currentTimeMs: 1100, durationMs: 4000 });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollContainer.scrollTop).toBe(0);
    expect(secondLine.getBoundingClientRect().top).toBe(76);

    view.rerender({ lyrics, currentTimeMs: 2100, durationMs: 4000 });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 156, behavior: 'smooth' });
    expect(thirdLine.getBoundingClientRect().top).toBe(280);

    act(() => vi.advanceTimersByTime(500));
    view.rerender({ lyrics, currentTimeMs: 4000, durationMs: 4000 });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 600, behavior: 'smooth' });
    expect(scrollContainer.scrollTop).toBe(600);
    expect(lastLine.getBoundingClientRect().top).toBe(550);
  });

  it('shows the directional Sync button and forces an offscreen line into the reachable range', () => {
    vi.useFakeTimers();
    const lyrics = {
      useSyncedLyrics: true,
      lines: [
        { id: 'first', text: 'First line', startMs: 0 },
        { id: 'current', text: 'Current line', startMs: 1000 },
      ],
    };
    view = renderLyrics({ lyrics, currentTimeMs: 1100, durationMs: 5000 });

    const scrollContainer = view.container.querySelector('[aria-label="Lyrics lines"]');
    const currentLine = view.container.querySelector('[data-lyric-id="current"]');
    let lineDocumentTop = 950;
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 200, height: 200 });
    vi.spyOn(currentLine, 'getBoundingClientRect').mockImplementation(() => ({
      top: lineDocumentTop - scrollContainer.scrollTop,
      bottom: lineDocumentTop + 50 - scrollContainer.scrollTop,
      height: 50,
    }));
    const scrollTo = vi.fn(({ top }) => { scrollContainer.scrollTop = top; });
    scrollContainer.scrollTo = scrollTo;
    setScrollDimensions(view, 200, 1000);

    act(() => scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true })));
    let syncButton = view.container.querySelector('button[aria-label="Sync to current lyric"]');
    expect(syncButton.textContent).toBe('Sync');
    expect(syncButton.querySelector('.lucide-chevrons-down')).toBeTruthy();
    act(() => syncButton.click());
    expect(scrollContainer.scrollTop).toBe(800);
    expect(view.container.querySelector('button[aria-label="Sync to current lyric"]')).toBeNull();

    act(() => vi.advanceTimersByTime(500));
    lineDocumentTop = 100;
    scrollContainer.scrollTop = 300;
    act(() => scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true })));
    syncButton = view.container.querySelector('button[aria-label="Sync to current lyric"]');
    expect(syncButton.querySelector('.lucide-chevrons-up')).toBeTruthy();
    act(() => syncButton.click());
    expect(scrollContainer.scrollTop).toBe(25);
  });

  it('does not offer resync at the end of the song and keeps scroll padding compact', () => {
    vi.useFakeTimers();
    view = renderLyrics({
      lyrics: {
        useSyncedLyrics: true,
        lines: [{ id: 'last', text: 'Last line', startMs: 0 }],
      },
      currentTimeMs: 5000,
      durationMs: 5000,
    });

    const scrollContainer = view.container.querySelector('[aria-label="Lyrics lines"]');
    const currentLine = view.container.querySelector('[data-lyric-id="last"]');
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 200, height: 200 });
    vi.spyOn(currentLine, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 550, height: 50 });
    scrollContainer.scrollTo = ({ top }) => { scrollContainer.scrollTop = top; };
    setScrollDimensions(view, 200, 1000);

    act(() => vi.advanceTimersByTime(500));
    act(() => scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true })));

    expect(scrollContainer.className).toContain('pt-4 pb-4');
    expect(scrollContainer.className).not.toContain('pb-[70vh]');
    expect(view.container.querySelector('button[aria-label="Sync to current lyric"]')).toBeNull();
  });

  it('seeks to a lyric start when the line is clicked', () => {
    const onSeek = vi.fn();
    view = renderLyrics({
      lyrics: {
        useSyncedLyrics: true,
        lines: [{ id: 'line', text: 'Jump here', startMs: 1875 }],
      },
      currentTimeMs: 100,
      onSeek,
    });

    act(() => view.container.querySelector('[data-lyric-id="line"]').click());

    expect(onSeek).toHaveBeenCalledWith(1.875);
  });
});
