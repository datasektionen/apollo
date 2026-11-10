import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerControlsSidebar } from '../PlayerControlsSidebar';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('PlayerControlsSidebar', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders all 4 controls with icons and sliders but no static numbers or text labels displayed', () => {
    const view = render(
      <PlayerControlsSidebar
        playbackSpeed={1}
        metronomeControlsEnabled={true}
        metronomeVolume={80}
        practiceControlsEnabled={true}
        practiceFocusControl={0}
        practicePanRange={100}
      />
    );

    // Header has "Controls"
    expect(view.container.textContent).toContain('Controls');

    // But NO inline numbers or text labels should be displayed on the surface
    expect(view.container.textContent).not.toContain('Speed');
    expect(view.container.textContent).not.toContain('1.00x');
    expect(view.container.textContent).not.toContain('Metronome');
    expect(view.container.textContent).not.toContain('80');
    expect(view.container.textContent).not.toContain('Focus');
    expect(view.container.textContent).not.toContain('Pan Range');
    expect(view.container.textContent).not.toContain('100%');

    // All 4 buttons with icons exist
    const speedBtn = view.container.querySelector('button[aria-label="Playback speed"]');
    expect(speedBtn).toBeTruthy();
    expect(speedBtn.getAttribute('title')).toBe('Playback speed: 1 (click for 1.05)');

    expect(view.container.querySelector('button[aria-label="Metronome"]')).toBeTruthy();
    expect(view.container.querySelector('button[aria-label="Practice focus"]')).toBeTruthy();
    expect(view.container.querySelector('button[aria-label="Transformed pan range"]')).toBeTruthy();

    // Speed slider has drag bounds 0.5 to 1.5 with step 0.01
    const speedInput = view.container.querySelector('input[type="range"][min="0.5"]');
    expect(speedInput).toBeTruthy();
    expect(speedInput.getAttribute('max')).toBe('1.5');
    expect(speedInput.getAttribute('step')).toBe('0.01');
    expect(speedInput.getAttribute('value')).toBe('1');

    view.unmount();
  });

  it('clamps speed slider display value to drag bounds [0.5, 1.5] when speed is outside', () => {
    const viewHigh = render(
      <PlayerControlsSidebar
        playbackSpeed={3.5}
      />
    );
    const speedInputHigh = viewHigh.container.querySelector('input[type="range"][min="0.5"]');
    expect(speedInputHigh.getAttribute('value')).toBe('1.5');
    const speedBtnHigh = viewHigh.container.querySelector('button[aria-label="Playback speed"]');
    expect(speedBtnHigh.getAttribute('title')).toBe('Playback speed: 3.5 (click for 0.5)');
    viewHigh.unmount();

    const viewLow = render(
      <PlayerControlsSidebar
        playbackSpeed={0.2}
      />
    );
    const speedInputLow = viewLow.container.querySelector('input[type="range"][min="0.5"]');
    expect(speedInputLow.getAttribute('value')).toBe('0.5');
    const speedBtnLow = viewLow.container.querySelector('button[aria-label="Playback speed"]');
    expect(speedBtnLow.getAttribute('title')).toBe('Playback speed: 0.2 (click for 0.5)');
    viewLow.unmount();
  });

  it('triggers beginSliderDrag and openSliderEdit on speed slider', () => {
    const beginSliderDrag = vi.fn();
    const openSliderEdit = vi.fn();
    const view = render(
      <PlayerControlsSidebar
        playbackSpeed={5 / 6}
        beginSliderDrag={beginSliderDrag}
        openSliderEdit={openSliderEdit}
      />
    );

    const speedInput = view.container.querySelector('input[type="range"][min="0.5"]');
    act(() => {
      speedInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(beginSliderDrag).toHaveBeenCalledTimes(1);
    expect(beginSliderDrag).toHaveBeenCalledWith(expect.any(Object), {
      kind: 'speed',
      value: 5 / 6,
      min: 0.5,
      max: 1.5,
      step: 0.01,
      disabled: false,
    });

    act(() => {
      speedInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(openSliderEdit).toHaveBeenCalledTimes(1);
    expect(openSliderEdit).toHaveBeenCalledWith('speed', 5 / 6, false);

    view.unmount();
  });

  it('renders in minimized mode and allows clicking icons to trigger toggles', () => {
    const store = new Map();
    store.set('apollo.playerControlsSidebar', JSON.stringify({ mode: 'minimized', width: 64 }));
    globalThis.localStorage.getItem = (key) => store.get(key) || null;

    const onToggleSpeed = vi.fn();
    const onToggleMetronomeMute = vi.fn();
    const onTogglePracticeFocus = vi.fn();
    const onTogglePracticePanRange = vi.fn();

    const view = render(
      <PlayerControlsSidebar
        playbackSpeed={1}
        onToggleSpeed={onToggleSpeed}
        metronomeControlsEnabled={true}
        metronomeVolume={80}
        onToggleMetronomeMute={onToggleMetronomeMute}
        practiceControlsEnabled={true}
        practiceFocusControl={0}
        onTogglePracticeFocus={onTogglePracticeFocus}
        practicePanRange={100}
        onTogglePracticePanRange={onTogglePracticePanRange}
      />
    );

    // In minimized mode, the header doesn't show the text "Controls"
    expect(view.container.textContent).not.toContain('Controls');

    // But the 4 icon buttons are rendered with their titles
    const speedIconBtn = view.container.querySelector('button[aria-label="Playback speed"]');
    expect(speedIconBtn).toBeTruthy();
    act(() => {
      speedIconBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleSpeed).toHaveBeenCalledTimes(1);

    const metronomeIconBtn = view.container.querySelector('button[aria-label="Metronome"]');
    expect(metronomeIconBtn).toBeTruthy();
    act(() => {
      metronomeIconBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleMetronomeMute).toHaveBeenCalledTimes(1);

    const focusIconBtn = view.container.querySelector('button[aria-label="Practice focus"]');
    expect(focusIconBtn).toBeTruthy();
    act(() => {
      focusIconBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onTogglePracticeFocus).toHaveBeenCalledTimes(1);

    const panIconBtn = view.container.querySelector('button[aria-label="Transformed pan range"]');
    expect(panIconBtn).toBeTruthy();
    act(() => {
      panIconBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onTogglePracticePanRange).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it('shows speed number flash badge when clicking speed button and fades it out', () => {
    vi.useFakeTimers();
    const onToggleSpeed = vi.fn();

    const view = render(
      <PlayerControlsSidebar
        playbackSpeed={1}
        onToggleSpeed={onToggleSpeed}
      />
    );

    // Initially no flash badge
    expect(view.container.querySelector('[data-testid="speed-flash-badge"]')).toBeNull();

    // Click speed button
    const speedBtn = view.container.querySelector('button[aria-label="Playback speed"]');
    act(() => {
      speedBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onToggleSpeed).toHaveBeenCalledTimes(1);

    // Flash badge appears showing next speed '1.05'
    const badge = view.container.querySelector('[data-testid="speed-flash-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('1.05');
    expect(badge.className).toContain('opacity-100');

    // Fast-forward 700ms: starts fading
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(badge.className).toContain('opacity-0');

    // Fast-forward another 400ms: badge unmounts
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(view.container.querySelector('[data-testid="speed-flash-badge"]')).toBeNull();

    view.unmount();
    vi.useRealTimers();
  });

  it('shows speed number flash badge in minimized mode when clicking speed button', () => {
    vi.useFakeTimers();
    const store = new Map();
    store.set('apollo.playerControlsSidebar', JSON.stringify({ mode: 'minimized', width: 64 }));
    globalThis.localStorage.getItem = (key) => store.get(key) || null;

    const onToggleSpeed = vi.fn();

    const view = render(
      <PlayerControlsSidebar
        playbackSpeed={1.3}
        onToggleSpeed={onToggleSpeed}
      />
    );

    const speedBtn = view.container.querySelector('button[aria-label="Playback speed"]');
    act(() => {
      speedBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onToggleSpeed).toHaveBeenCalledTimes(1);

    // In minimized mode, next speed after 1.3 is 1.5
    const badge = view.container.querySelector('[data-testid="speed-flash-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('1.5');

    view.unmount();
    vi.useRealTimers();
  });

  it('shows 0.83 for 5/6 internal speed without an x', () => {
    vi.useFakeTimers();
    const onToggleSpeed = vi.fn();

    const view = render(
      <PlayerControlsSidebar
        playbackSpeed={0.75}
        onToggleSpeed={onToggleSpeed}
      />
    );

    const speedBtn = view.container.querySelector('button[aria-label="Playback speed"]');
    act(() => {
      speedBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Next step after 0.75 is 5 / 6, displayed as 0.83
    const badge = view.container.querySelector('[data-testid="speed-flash-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('0.83');

    view.unmount();
    vi.useRealTimers();
  });

  it('renders no settings when speed, metronome, and practice controls are disabled (e.g. no song)', () => {
    const view = render(
      <PlayerControlsSidebar
        speedControlsEnabled={false}
        metronomeControlsEnabled={false}
        practiceControlsEnabled={false}
      />
    );

    // Header still renders
    expect(view.container.textContent).toContain('Controls');

    // But none of the setting buttons or sliders render
    expect(view.container.querySelector('button[aria-label="Playback speed"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Metronome"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Practice focus"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Transformed pan range"]')).toBeNull();
    expect(view.container.querySelectorAll('input[type="range"]')).toHaveLength(0);

    view.unmount();
  });

  it('renders only speed control when metronome and practice controls are disabled (standard song)', () => {
    const view = render(
      <PlayerControlsSidebar
        speedControlsEnabled={true}
        metronomeControlsEnabled={false}
        practiceControlsEnabled={false}
      />
    );

    expect(view.container.querySelector('button[aria-label="Playback speed"]')).toBeTruthy();
    expect(view.container.querySelector('input[type="range"][min="0.5"]')).toBeTruthy();

    expect(view.container.querySelector('button[aria-label="Metronome"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Practice focus"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Transformed pan range"]')).toBeNull();

    view.unmount();
  });

  it('renders speed and metronome but not practice controls when practice is unsupported', () => {
    const view = render(
      <PlayerControlsSidebar
        speedControlsEnabled={true}
        metronomeControlsEnabled={true}
        practiceControlsEnabled={false}
      />
    );

    expect(view.container.querySelector('button[aria-label="Playback speed"]')).toBeTruthy();
    expect(view.container.querySelector('button[aria-label="Metronome"]')).toBeTruthy();

    expect(view.container.querySelector('button[aria-label="Practice focus"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="Transformed pan range"]')).toBeNull();

    view.unmount();
  });

  describe('pitch transpose controls', () => {
    it('does not render transpose controls when transposeControlsEnabled is false', () => {
      const view = render(
        <PlayerControlsSidebar
          transposeControlsEnabled={false}
          playbackTranspose={2.5}
        />
      );

      expect(view.container.querySelector('button[aria-label="Pitch transpose"]')).toBeNull();
      expect(view.container.querySelector('input[type="range"][min="-12"]')).toBeNull();
      view.unmount();
    });

    it('does not render transpose controls when speedControlsEnabled is false', () => {
      const view = render(
        <PlayerControlsSidebar
          speedControlsEnabled={false}
          transposeControlsEnabled={true}
          playbackTranspose={2.5}
        />
      );

      expect(view.container.querySelector('button[aria-label="Playback speed"]')).toBeNull();
      expect(view.container.querySelector('button[aria-label="Pitch transpose"]')).toBeNull();
      expect(view.container.querySelector('input[type="range"][min="-12"]')).toBeNull();
      view.unmount();
    });

    it('renders transpose button and slider when transposeControlsEnabled is true', () => {
      const onToggleTranspose = vi.fn();
      const beginSliderDrag = vi.fn();
      const openSliderEdit = vi.fn();

      const view = render(
        <PlayerControlsSidebar
          transposeControlsEnabled={true}
          playbackTranspose={3.5}
          onToggleTranspose={onToggleTranspose}
          beginSliderDrag={beginSliderDrag}
          openSliderEdit={openSliderEdit}
        />
      );

      const transposeBtn = view.container.querySelector('button[aria-label="Pitch transpose"]');
      expect(transposeBtn).toBeTruthy();
      expect(transposeBtn.getAttribute('title')).toContain('+3.5 st');
      expect(transposeBtn.className).toContain('text-blue-300');

      act(() => {
        transposeBtn.click();
      });
      expect(onToggleTranspose).toHaveBeenCalledTimes(1);

      const transposeInput = view.container.querySelector('input[type="range"][min="-12"]');
      expect(transposeInput).toBeTruthy();
      expect(transposeInput.getAttribute('max')).toBe('12');
      expect(transposeInput.getAttribute('step')).toBe('1');
      expect(transposeInput.getAttribute('value')).toBe('3.5');

      act(() => {
        transposeInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(beginSliderDrag).toHaveBeenCalledTimes(1);
      expect(beginSliderDrag).toHaveBeenCalledWith(expect.any(Object), {
        kind: 'transpose',
        value: 3.5,
        min: -12,
        max: 12,
        step: 1,
        disabled: false,
      });

      act(() => {
        transposeInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });
      expect(openSliderEdit).toHaveBeenCalledTimes(1);
      expect(openSliderEdit).toHaveBeenCalledWith('transpose', 3.5, false);

      view.unmount();
    });

    it('highlights transpose icon only when transpose is not 0', () => {
      const viewActive = render(
        <PlayerControlsSidebar
          transposeControlsEnabled={true}
          playbackTranspose={2}
        />
      );
      const activeBtn = viewActive.container.querySelector('button[aria-label="Pitch transpose"]');
      expect(activeBtn.className).toContain('text-blue-300');
      expect(activeBtn.className).not.toContain('text-gray-400');
      viewActive.unmount();

      const viewZero = render(
        <PlayerControlsSidebar
          transposeControlsEnabled={true}
          playbackTranspose={0}
          lastPlaybackTranspose={2}
        />
      );
      const zeroBtn = viewZero.container.querySelector('button[aria-label="Pitch transpose"]');
      expect(zeroBtn.className).toContain('text-gray-400');
      expect(zeroBtn.className).not.toContain('text-blue-300');
      expect(zeroBtn.getAttribute('title')).toContain('click to restore +2 st');
      viewZero.unmount();
    });

    it('renders slider edit tooltip input for manual entry and drag tooltip for discrete drag', () => {
      const setSliderEditTooltip = vi.fn();
      const commitSliderEdit = vi.fn();
      const formatSliderValue = vi.fn((kind, val) => `${val > 0 ? '+' : ''}${val} st`);

      const view = render(
        <PlayerControlsSidebar
          transposeControlsEnabled={true}
          playbackTranspose={0}
          sliderEditTooltip={{ kind: 'transpose', text: '+2.5 st' }}
          sliderDragTooltip={null}
          setSliderEditTooltip={setSliderEditTooltip}
          commitSliderEdit={commitSliderEdit}
          formatSliderValue={formatSliderValue}
        />
      );

      const textInput = view.container.querySelector('input[type="text"]');
      expect(textInput).toBeTruthy();
      expect(textInput.value).toBe('+2.5 st');

      act(() => {
        const prototype = window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor.set.call(textInput, '+3.75');
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        textInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(setSliderEditTooltip).toHaveBeenCalled();

      act(() => {
        textInput.blur();
      });
      expect(commitSliderEdit).toHaveBeenCalled();

      view.unmount();
    });

    it('renders all 5 controls in order: Metronome, Focus, Pan, Speed, Transpose at the bottom', () => {
      const view = render(
        <PlayerControlsSidebar
          speedControlsEnabled={true}
          transposeControlsEnabled={true}
          metronomeControlsEnabled={true}
          practiceControlsEnabled={true}
        />
      );

      const buttons = Array.from(view.container.querySelectorAll('button[aria-label]'))
        .map((btn) => btn.getAttribute('aria-label'))
        .filter((label) => label !== 'Expand Controls' && label !== 'Collapse Controls');

      expect(buttons).toEqual([
        'Metronome',
        'Practice focus',
        'Transformed pan range',
        'Playback speed',
        'Pitch transpose',
      ]);

      view.unmount();
    });
  });
});
