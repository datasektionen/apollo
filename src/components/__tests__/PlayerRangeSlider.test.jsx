import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import PlayerRangeSlider from '../PlayerRangeSlider';

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

describe('PlayerRangeSlider', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('aligns handle center at exact value and exact 0%/100% track edges', () => {
    const view = render(<PlayerRangeSlider min={0} max={100} value={0} onChange={() => {}} ariaLabel="Volume" />);

    const thumb = view.container.querySelector('.player-slider-thumb');
    const fill = view.container.querySelector('.player-slider-fill');
    expect(thumb.style.left).toBe('0%');
    expect(fill.style.left).toBe('0%');
    expect(fill.style.width).toBe('0%');

    view.rerender(<PlayerRangeSlider min={0} max={100} value={100} onChange={() => {}} ariaLabel="Volume" />);
    expect(view.container.querySelector('.player-slider-thumb').style.left).toBe('100%');
    expect(view.container.querySelector('.player-slider-fill').style.width).toBe('100%');

    view.unmount();
  });

  it('supports bipolar fill from 50% center with optional center tick and drag state', () => {
    const view = render(
      <PlayerRangeSlider
        bipolar
        showCenterTick
        isDragging
        min={-12}
        max={12}
        value={-6}
        percent={25}
        onChange={() => {}}
        ariaLabel="Pitch"
      />
    );

    const root = view.container.querySelector('.player-slider-root');
    const fill = view.container.querySelector('.player-slider-fill');
    const thumb = view.container.querySelector('.player-slider-thumb');

    expect(root.getAttribute('data-dragging')).toBe('true');
    expect(fill.style.left).toBe('25%');
    expect(fill.style.width).toBe('25%');
    expect(fill.className).toContain('rounded-l-full rounded-r-none');
    expect(thumb.style.left).toBe('25%');

    view.rerender(
      <PlayerRangeSlider
        bipolar
        showCenterTick
        min={-12}
        max={12}
        value={6}
        percent={75}
        onChange={() => {}}
        ariaLabel="Pitch"
      />
    );
    const rightFill = view.container.querySelector('.player-slider-fill');
    expect(rightFill.style.left).toBe('50%');
    expect(rightFill.style.width).toBe('25%');
    expect(rightFill.className).toContain('rounded-l-none rounded-r-full');

    view.rerender(
      <PlayerRangeSlider
        bipolar
        min={-12}
        max={12}
        value={0}
        percent={50}
        onChange={() => {}}
        ariaLabel="Pitch"
      />
    );
    expect(view.container.querySelector('.player-slider-fill').className).toContain('rounded-none');

    view.unmount();
  });

  it('triggers readOnly drag handler on root (including overhanging hit-pad) with currentTarget set to root', () => {
    let seenTarget = null;
    const onMouseDown = vi.fn((event) => {
      seenTarget = event.currentTarget;
    });
    const view = render(
      <PlayerRangeSlider
        readOnly
        min={0}
        max={100}
        value={0}
        onMouseDown={onMouseDown}
        ariaLabel="Master volume"
      />
    );

    const root = view.container.querySelector('.player-slider-root');
    const hitPad = view.container.querySelector('[data-slider-hitpad="true"]');
    const input = view.container.querySelector('input[type="range"]');
    expect(hitPad).not.toBeNull();

    act(() => {
      hitPad.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(seenTarget).toBe(root);

    seenTarget = null;
    act(() => {
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(onMouseDown).toHaveBeenCalledTimes(2);
    expect(seenTarget).toBe(root);

    view.unmount();
  });

  it('renders Choir Width left-to-value highlight and secondary white focus-axis dot when active', () => {
    const view = render(
      <PlayerRangeSlider
        min={0}
        max={200}
        value={100}
        percent={50}
        secondaryDotPercent={75}
        onChange={() => {}}
        ariaLabel="Choir width"
      />
    );

    const fill = view.container.querySelector('.player-slider-fill');
    const thumb = view.container.querySelector('.player-slider-thumb');
    const dot = view.container.querySelector('.player-slider-secondary-dot');

    expect(fill.style.left).toBe('0%');
    expect(fill.style.width).toBe('50%');
    expect(thumb.style.left).toBe('50%');
    expect(dot).not.toBeNull();
    expect(dot.style.left).toBe('75%');

    // Hidden when secondaryDotPercent is null or slider is disabled
    view.rerender(
      <PlayerRangeSlider
        min={0}
        max={200}
        value={100}
        percent={50}
        secondaryDotPercent={75}
        disabled
        onChange={() => {}}
        ariaLabel="Choir width"
      />
    );
    expect(view.container.querySelector('.player-slider-secondary-dot')).toBeNull();

    view.unmount();
  });
});
