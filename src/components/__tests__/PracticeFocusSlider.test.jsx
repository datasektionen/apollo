import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PracticeFocusSlider,
  computeFocusGeometry,
  resolveFocusVisualState,
} from '../PracticeFocusSlider';
import {
  ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX,
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
} from '../../utils/advancedMix';

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
    rerender(nextUi) {
      act(() => {
        root.render(nextUi);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function dispatchPointer(el, type, clientX) {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    button: 0,
  });
  act(() => {
    el.dispatchEvent(evt);
  });
}

describe('PracticeFocusSlider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('computes locked Pure Clipped Outline geometry constants and gaps accurately', () => {
    const g = computeFocusGeometry(233.28, 0.72);
    expect(g.trackLeft).toBe(10);
    expect(g.trackRight).toBeCloseTo(334, 4);
    expect(g.cxL).toBe(21);
    expect(g.cxR).toBeCloseTo(323, 4);
    expect(g.cxM).toBeCloseTo(172, 4);
    expect(g.handleMinX).toBe(g.midLeft);
    expect(g.handleMaxX).toBeCloseTo(g.midRight, 4);
    expect(g.midLeft - g.leftSegRight).toBeCloseTo(2.5, 6);
    expect(g.rightSegLeft - g.midRight).toBeCloseTo(2.5, 6);
  });

  it('renders all 5 canonical states (MIN, NEG, CENTER, POS, MAX) cleanly in Rest and Hover layers', () => {
    const negIdx = ADVANCED_MIX_PRACTICE_FOCUS_STEPS.indexOf(-6);
    const posIdx = ADVANCED_MIX_PRACTICE_FOCUS_STEPS.indexOf(10);

    const cases = [
      { idx: ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX, state: 'MIN', text: 'Omitted', sockets: 1, hasGoldTrack: false, special: true },
      { idx: negIdx, state: 'NEG', text: '-6 dB', sockets: 2, hasGoldTrack: true, special: false },
      { idx: ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX, state: 'CENTER', text: '0 dB', sockets: 2, hasGoldTrack: false, special: true },
      { idx: posIdx, state: 'POS', text: '+10 dB', sockets: 2, hasGoldTrack: true, special: false },
      { idx: ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX, state: 'MAX', text: 'Solo', sockets: 1, hasGoldTrack: false, special: true },
    ];

    const view = render(<PracticeFocusSlider valueIndex={cases[0].idx} />);

    for (const tc of cases) {
      expect(resolveFocusVisualState(tc.idx).state).toBe(tc.state);
      view.rerender(<PracticeFocusSlider valueIndex={tc.idx} />);

      const root = view.container.querySelector('[role="slider"]');
      expect(root.getAttribute('data-focus-state')).toBe(tc.state);
      expect(root.getAttribute('aria-valuetext')).toBe(tc.text);
      expect(root.getAttribute('aria-valuenow')).toBe(String(tc.idx));
      expect(root.getAttribute('data-hovered')).toBe('false');

      const restLayer = root.querySelector('[data-layer="rest"]');
      const hoverLayer = root.querySelector('[data-layer="hover"]');
      expect(restLayer.style.opacity).toBe('1');
      expect(hoverLayer.style.opacity).toBe('0');

      const restFills = restLayer.querySelectorAll('[fill="var(--player-focus-fill-rest)"]');
      expect(restFills.length).toBe(1);

      const hoverCircles = hoverLayer.querySelectorAll('circle');
      // 1 or 2 inactive sockets + 1 active handle circle
      expect(hoverCircles.length).toBe(tc.sockets + 1);
      const handleCircle = hoverCircles[hoverCircles.length - 1];
      expect(handleCircle.getAttribute('stroke')).toBe(tc.special ? 'var(--player-focus-accent)' : 'none');

      const goldTracks = hoverLayer.querySelectorAll('rect[fill="var(--player-focus-accent)"]');
      expect(goldTracks.length).toBe(tc.hasGoldTrack ? 1 : 0);
    }

    // Cross-fade into hover layer on mouseEnter and back on mouseLeave
    const root = view.container.querySelector('[role="slider"]');
    act(() => {
      root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(root.getAttribute('data-hovered')).toBe('true');
    expect(root.querySelector('[data-layer="rest"]').style.opacity).toBe('0');
    expect(root.querySelector('[data-layer="hover"]').style.opacity).toBe('1');

    act(() => {
      root.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(root.getAttribute('data-hovered')).toBe('false');

    view.unmount();
  });

  it('handles cap clicks, center pill clicks, and magnetic center detent while dragging', () => {
    const onChangeIndex = vi.fn();
    const onDragIndexChange = vi.fn();
    const view = render(
      <PracticeFocusSlider
        valueIndex={ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX}
        onChangeIndex={onChangeIndex}
        onDragIndexChange={onDragIndexChange}
      />
    );

    const svg = view.container.querySelector('svg');
    // Match SVG viewWidth as 1:1 SVG user units -> clientX === svgX
    const viewWidth = Number(svg.getAttribute('viewBox').split(' ')[2]);
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: viewWidth,
      bottom: 36,
      width: viewWidth,
      height: 36,
    });
    const geom = computeFocusGeometry(160, 0.72);

    // Click left outer cap -> MIN (Omitted)
    dispatchPointer(svg, 'pointerdown', geom.trackLeft + 2);
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX);
    expect(onDragIndexChange).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX);
    dispatchPointer(window, 'pointerup', geom.trackLeft + 2);
    expect(onDragIndexChange).toHaveBeenLastCalledWith(null);

    // Click right outer cap -> MAX (Solo)
    dispatchPointer(svg, 'pointerdown', geom.trackRight - 2);
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX);
    dispatchPointer(window, 'pointerup', geom.trackRight - 2);

    // Click center pill -> CENTER (0 dB)
    dispatchPointer(svg, 'pointerdown', geom.cxM);
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX);

    // Drag to positive side (+20 dB at handleMaxX), then back into center magnetic detent (cxM + 3px)
    dispatchPointer(svg, 'pointermove', geom.handleMaxX);
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_STEPS.indexOf(20));

    dispatchPointer(svg, 'pointermove', geom.cxM + 3);
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX);
    dispatchPointer(window, 'pointerup', geom.cxM + 3);

    view.unmount();
  });

  it('supports keyboard navigation and renders optional sr-only inputAriaLabel', () => {
    const onChangeIndex = vi.fn();
    const view = render(
      <PracticeFocusSlider
        valueIndex={ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX}
        onChangeIndex={onChangeIndex}
        inputAriaLabel="Practice Focus Slider"
      />
    );

    const root = view.container.querySelector('[role="slider"]');
    const srInput = view.container.querySelector('input[aria-label="Practice Focus Slider"]');
    expect(srInput).not.toBeNull();
    expect(srInput.value).toBe(String(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX));

    const press = (key, shiftKey = false) => {
      act(() => {
        root.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
      });
    };

    press('ArrowRight');
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX + 1);

    press('ArrowLeft', true);
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX - 3);

    press('Home');
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_MIN_INDEX);

    press('End');
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_MAX_INDEX);

    view.rerender(
      <PracticeFocusSlider
        valueIndex={2}
        onChangeIndex={onChangeIndex}
        inputAriaLabel="Practice Focus Slider"
      />
    );
    press('0');
    expect(onChangeIndex).toHaveBeenLastCalledWith(ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX);

    view.unmount();
  });

  it('drops hover state immediately after pointer click and mouse leave without requiring an outside click', () => {
    const view = render(<PracticeFocusSlider valueIndex={ADVANCED_MIX_PRACTICE_FOCUS_DEFAULT_INDEX} />);
    const root = view.container.querySelector('[role="slider"]');
    const svg = view.container.querySelector('svg');

    // Hover enters
    act(() => {
      root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(root.getAttribute('data-hovered')).toBe('true');

    // Pointer click triggers focus() on root, then releases
    dispatchPointer(svg, 'pointerdown', 120);
    dispatchPointer(window, 'pointerup', 120);

    // Moving cursor off immediately clears hover state despite DOM focus remaining on root
    act(() => {
      root.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(document.activeElement).toBe(root);
    expect(root.getAttribute('data-hovered')).toBe('false');
    expect(root.querySelector('[data-layer="rest"]').style.opacity).toBe('1');
    expect(root.querySelector('[data-layer="hover"]').style.opacity).toBe('0');

    // Keyboard Tab focus still shows hover/focus ring until blur
    act(() => {
      root.blur();
      root.focus();
    });
    expect(root.getAttribute('data-hovered')).toBe('true');
    act(() => {
      root.blur();
    });
    expect(root.getAttribute('data-hovered')).toBe('false');

    view.unmount();
  });
});
