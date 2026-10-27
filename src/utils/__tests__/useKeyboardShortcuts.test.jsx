import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import useKeyboardShortcuts from '../useKeyboardShortcuts';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function Harness({ onToggleLoop, onToggleLyricsLane, onConfirmLyricPlacement }) {
  useKeyboardShortcuts({
    enabled: true,
    onToggleLoop,
    onToggleLyricsLane,
    onConfirmLyricPlacement,
  });
  return null;
}

describe('lyrics lane keyboard shortcut', () => {
  let root;
  let container;

  afterEach(() => {
    if (root) act(() => root.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it('uses Shift+L for the lyrics lane and preserves L for loop', () => {
    const onToggleLoop = vi.fn();
    const onToggleLyricsLane = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(
      <Harness onToggleLoop={onToggleLoop} onToggleLyricsLane={onToggleLyricsLane} />
    ));

    const lyricsEvent = new KeyboardEvent('keydown', {
      code: 'KeyL', key: 'L', shiftKey: true, bubbles: true, cancelable: true,
    });
    window.dispatchEvent(lyricsEvent);
    expect(lyricsEvent.defaultPrevented).toBe(true);
    expect(onToggleLyricsLane).toHaveBeenCalledOnce();
    expect(onToggleLoop).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyL', key: 'l', bubbles: true, cancelable: true,
    }));
    expect(onToggleLoop).toHaveBeenCalledOnce();
  });

  it('confirms lyric placement once per P press and ignores key repeats', () => {
    const onConfirmLyricPlacement = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness onConfirmLyricPlacement={onConfirmLyricPlacement} />));

    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyP', key: 'p', bubbles: true, cancelable: true,
    }));
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyP', key: 'p', repeat: true, bubbles: true, cancelable: true,
    }));

    expect(onConfirmLyricPlacement).toHaveBeenCalledOnce();
  });

  it('does not toggle the lane while typing in a text field', () => {
    const onToggleLyricsLane = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness onToggleLyricsLane={onToggleLyricsLane} />));
    const input = document.createElement('input');
    document.body.appendChild(input);

    input.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyL', key: 'L', shiftKey: true, bubbles: true, cancelable: true,
    }));

    expect(onToggleLyricsLane).not.toHaveBeenCalled();
    input.remove();
  });
});
