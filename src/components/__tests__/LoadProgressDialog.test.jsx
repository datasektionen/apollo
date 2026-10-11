import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import LoadProgressDialog from '../LoadProgressDialog';
import {
  beginPlayStemProgress,
  dismissLoadProgress,
  finishLoadProgress,
  logLoadProgress,
  reportPlayStemEvent,
  startLoadProgress,
} from '../../lib/loadProgress';

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  finishLoadProgress();
  dismissLoadProgress();
});

async function renderDialog() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<LoadProgressDialog />);
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('LoadProgressDialog play bars', () => {
  it('renders only the bars that have work, with export-style counts', async () => {
    const view = await renderDialog();
    let sessionId;
    await act(async () => {
      sessionId = startLoadProgress({ kind: 'play', title: 'Tutti' });
      beginPlayStemProgress({
        total: 20,
        cached: 5,
        classified: true,
        idbTotal: 8,
        fetchTotal: 7,
      }, sessionId);
    });

    expect(view.container.textContent).toContain('Tutti');
    expect(view.container.textContent).toContain('Audio sources');
    expect(view.container.textContent).toContain('5/20');
    expect(view.container.textContent).toContain('Already loaded');
    expect(view.container.textContent).toContain('5/5');
    expect(view.container.textContent).toContain('Loaded from local database');
    expect(view.container.textContent).toContain('0/8');
    expect(view.container.textContent).toContain('Loaded from server');
    expect(view.container.textContent).toContain('Downloaded');
    expect(view.container.textContent).toContain('Converted');
    expect(view.container.textContent).toContain('0/7');
    expect(view.container.textContent).toContain('Convert idle');
    expect(view.container.textContent).not.toContain('Copy log');

    const bars = view.container.querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(6);
    expect(bars[0].querySelector('div').style.width).toBe('25%');
    expect(bars[1].querySelector('div').style.width).toBe('100%');
    expect(bars[2].querySelector('div').style.width).toBe('0%');

    await act(async () => {
      reportPlayStemEvent('idb-loaded', sessionId);
      reportPlayStemEvent('download-start', sessionId);
      reportPlayStemEvent('fetched', sessionId);
      reportPlayStemEvent('convert-start', sessionId);
      reportPlayStemEvent('converted', sessionId);
      reportPlayStemEvent('server-cached', sessionId);
    });
    const updated = view.container.querySelectorAll('[role="progressbar"]');
    expect(view.container.textContent).toContain('7/20');
    expect(view.container.textContent).toContain('1/8');
    expect(view.container.textContent).toContain('1/7');
    expect(updated[0].querySelector('div').style.width).toBe('35%');
    expect(updated[3].querySelector('div').style.width).toBe(`${(1 / 7) * 100}%`);
    expect(updated[4].querySelector('div').style.width).toBe(`${(1 / 7) * 100}%`);
    expect(updated[5].querySelector('div').style.width).toBe(`${(1 / 7) * 100}%`);

    await view.unmount();
  });

  it('renders nothing when every stem is already cached', async () => {
    const view = await renderDialog();
    await act(async () => {
      startLoadProgress({ kind: 'play', title: 'Tutti' });
      beginPlayStemProgress({
        total: 4,
        cached: 4,
        classified: true,
        idbTotal: 0,
        fetchTotal: 0,
      });
    });
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    await view.unmount();
  });

  it('omits empty groups', async () => {
    const view = await renderDialog();
    await act(async () => {
      const sessionId = startLoadProgress({ kind: 'play', title: 'Tutti' });
      beginPlayStemProgress({
        total: 3,
        cached: 0,
        classified: true,
        idbTotal: 0,
        fetchTotal: 3,
      }, sessionId);
    });
    expect(view.container.textContent).toContain('Audio sources');
    expect(view.container.textContent).toContain('0/3');
    expect(view.container.textContent).not.toContain('Already loaded');
    expect(view.container.textContent).not.toContain('Loaded from local database');
    expect(view.container.textContent).toContain('Loaded from server');
    expect(view.container.textContent).toContain('Downloaded');
    expect(view.container.textContent).toContain('Converted');
    expect(view.container.querySelectorAll('[role="progressbar"]')).toHaveLength(4);
    await view.unmount();
  });

  it('keeps the technical log available for debugging', async () => {
    const view = await renderDialog();
    await act(async () => {
      startLoadProgress({ kind: 'open', title: 'Song', verbose: true });
      logLoadProgress('IndexedDB miss (stem-1)');
    });
    expect(view.container.textContent).toContain('Open request');
    expect(view.container.textContent).toContain('IndexedDB miss (stem-1)');
    expect(view.container.textContent).toContain('Copy log');
    expect(view.container.textContent).not.toContain('Already loaded');
    await view.unmount();
  });

  it('stays open with the finished counts until dismissed', async () => {
    const view = await renderDialog();
    let sessionId;
    await act(async () => {
      sessionId = startLoadProgress({ kind: 'open', title: 'Song' });
      beginPlayStemProgress({
        total: 4,
        cached: 1,
        classified: true,
        idbTotal: 3,
        fetchTotal: 0,
      }, sessionId);
    });
    await act(async () => {
      reportPlayStemEvent('idb-loaded', sessionId);
      reportPlayStemEvent('idb-loaded', sessionId);
      reportPlayStemEvent('idb-loaded', sessionId);
      finishLoadProgress(null, sessionId);
    });
    expect(view.container.textContent).toContain('Audio ready');
    expect(view.container.textContent).toContain('4/4');
    expect(view.container.textContent).toContain('3/3');
    expect(view.container.textContent).not.toContain('Close');

    const dialog = view.container.querySelector('[role="dialog"]');
    dialog.click();
    expect(view.container.querySelector('[role="dialog"]')).toBeTruthy();

    await act(async () => {
      view.container.firstElementChild.click();
    });
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    await view.unmount();
  });
});
