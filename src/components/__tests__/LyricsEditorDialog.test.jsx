import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import LyricsEditorDialog from '../LyricsEditorDialog';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function mountDialog(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<LyricsEditorDialog {...props} open />));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('LyricsEditorDialog', () => {
  let view;

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('saves edits when closed and has no separate save or cancel controls', () => {
    const project = {
      projectId: 'project-1',
      lyrics: { lines: [{ id: 'line-1', text: 'First', startMs: 120 }] },
    };
    const updateProject = vi.fn((updater) => updater(project));
    const onClose = vi.fn();
    view = mountDialog({ project, updateProject, canEditLyrics: true, onClose });

    const textarea = view.container.querySelector('textarea');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    act(() => {
      setValue.call(textarea, 'Changed first');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => view.container.querySelector('[aria-label="Close lyrics editor"]').click());

    expect(updateProject).toHaveBeenCalledOnce();
    const nextProject = updateProject.mock.calls[0][0](project);
    expect(nextProject.lyrics.lines).toEqual([
      { id: 'line-1', text: 'Changed first', startMs: 120 },
    ]);
    expect(onClose).toHaveBeenCalledOnce();
    expect(view.container.textContent).not.toContain('Save lyrics');
    expect(view.container.textContent).not.toContain('Cancel');
    expect(view.container.textContent).not.toContain('Changes are saved when you close this window.');
  });

  it('sizes the dialog to the lyric content and places the caret at the beginning', async () => {
    const longText = 'L'.repeat(60);
    const project = {
      projectId: 'project-1',
      lyrics: {
        lines: Array.from({ length: 5 }, (_, index) => ({
          id: `line-${index}`,
          text: index === 0 ? longText : `Line ${index + 1}`,
          startMs: index * 500,
        })),
      },
    };
    view = mountDialog({ project, updateProject: vi.fn(), canEditLyrics: true, onClose: vi.fn() });

    const textarea = view.container.querySelector('textarea');
    expect(textarea.rows).toBe(5);
    expect(view.container.querySelector('[role="dialog"]').style.width).toBe('600px');

    await act(async () => {
      await new Promise((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(resolve);
        else window.setTimeout(resolve, 0);
      });
    });

    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);
  });

  it('does not create a write when closed without edits', () => {
    const project = {
      projectId: 'project-1',
      lyrics: { lines: [{ id: 'line-1', text: 'First', startMs: null }] },
    };
    const updateProject = vi.fn();
    view = mountDialog({ project, updateProject, canEditLyrics: true, onClose: vi.fn() });

    act(() => view.container.querySelector('[aria-label="Close lyrics editor"]').click());

    expect(updateProject).not.toHaveBeenCalled();
  });
});
