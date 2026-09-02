import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installNativeDragGuard,
  isIntentionalHtml5Drag,
  preventUnwantedNativeDragStart,
} from '../nativeDrag';

function dragEvent(target) {
  return {
    target,
    preventDefault: vi.fn(),
  };
}

describe('native drag guard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('allows dragstart from explicit HTML5 drag sources', () => {
    document.body.innerHTML = '<div draggable="true"><span class="handle">x</span></div>';
    const event = dragEvent(document.querySelector('.handle'));
    expect(isIntentionalHtml5Drag(event)).toBe(true);
    expect(preventUnwantedNativeDragStart(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('blocks native dragstart from canvases and generic surfaces', () => {
    document.body.innerHTML = '<canvas></canvas><div class="timeline"></div>';

    const canvasEvent = dragEvent(document.querySelector('canvas'));
    expect(preventUnwantedNativeDragStart(canvasEvent)).toBe(true);
    expect(canvasEvent.preventDefault).toHaveBeenCalledTimes(1);

    const timelineEvent = dragEvent(document.querySelector('.timeline'));
    expect(preventUnwantedNativeDragStart(timelineEvent)).toBe(true);
    expect(timelineEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('installs a document listener that cancels unwanted dragstart', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const uninstall = installNativeDragGuard();

    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    uninstall();
  });

  it('does not cancel dragstart from draggable sources', () => {
    const source = document.createElement('div');
    source.setAttribute('draggable', 'true');
    document.body.appendChild(source);
    const uninstall = installNativeDragGuard();

    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    source.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    uninstall();
  });
});
