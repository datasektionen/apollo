import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatencyCorrectionDialog } from '../LatencyCorrectionDialog';
import * as calibrationModule from '../../lib/recordingLatencyCalibration';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const views = [];

afterEach(async () => {
  while (views.length) {
    await views.pop().unmount();
  }
  vi.restoreAllMocks();
});

async function renderDialog(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const render = () => {
    root.render(
      <LatencyCorrectionDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialOffsetMs={65}
        {...props}
      />
    );
  };

  await act(async () => {
    render();
  });

  const view = {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
  views.push(view);
  return view;
}

describe('LatencyCorrectionDialog', () => {
  it('renders intro state with matching text and Start Test button', async () => {
    const view = await renderDialog();

    expect(view.container.textContent).toContain('Round-trip Latency Correction');
    expect(view.container.textContent).toContain('Feeling like you’re slightly behind the beat?');
    expect(view.container.textContent).toContain('make sure your headphones are unplugged');

    const startButton = Array.from(view.container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Start Test'));
    expect(startButton).toBeTruthy();
  });

  it('runs 3-burst test and shows success state with measured latency', async () => {
    const measureMock = vi.spyOn(calibrationModule, 'measureRecordingRoundTrip').mockResolvedValue({
      roundTripMs: 84.2,
      validCount: 3,
    });
    const onConfirm = vi.fn();
    const view = await renderDialog({ onConfirm });

    const startButton = Array.from(view.container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Start Test'));

    await act(async () => {
      startButton.click();
    });

    expect(measureMock).toHaveBeenCalledWith(expect.objectContaining({
      burstCount: 3,
    }));

    // Shows success state
    expect(view.container.textContent).toContain('Your Latency');
    expect(view.container.textContent).toContain('This correction will be applied the next time you press record');

    const input = view.container.querySelector('input');
    expect(input).toBeTruthy();
    expect(input.value).toBe('84');

    // Confirm button
    const confirmButton = Array.from(view.container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Confirm'));
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton.click();
    });

    expect(onConfirm).toHaveBeenCalledWith(84, expect.objectContaining({
      roundTripMs: 84.2,
      validCount: 3,
    }));
  });

  it('shows error state when measurement fails to detect test sounds', async () => {
    vi.spyOn(calibrationModule, 'measureRecordingRoundTrip').mockRejectedValue(
      new Error('Test sounds were not detected')
    );
    const view = await renderDialog();

    const startButton = Array.from(view.container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Start Test'));

    await act(async () => {
      startButton.click();
    });

    expect(view.container.textContent).toContain('Test is unsuccessful');
    expect(view.container.textContent).toContain('Test sounds weren’t detected');

    const tryAgainButton = Array.from(view.container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Try again'));
    expect(tryAgainButton).toBeTruthy();
  });

  it('calls onClose when close X button is clicked', async () => {
    const onClose = vi.fn();
    const view = await renderDialog({ onClose });

    const closeButton = view.container.querySelector('button[aria-label="Close"]');
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
