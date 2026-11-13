import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { PlaybackDevicesSettingsPanel } from '../SettingsPanels';
import { normalizePlaybackDeviceSettings } from '../../utils/playbackOutput';

const views = [];

afterEach(async () => {
  while (views.length) {
    await views.pop().unmount();
  }
});

async function renderPanel(initialSettings, extraProps = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let settings = normalizePlaybackDeviceSettings(initialSettings);
  const setAudioSettings = (updater) => {
    settings = normalizePlaybackDeviceSettings(typeof updater === 'function' ? updater(settings) : updater);
    render();
  };
  const render = () => {
    root.render(
      <PlaybackDevicesSettingsPanel
        audioSettings={settings}
        setAudioSettings={setAudioSettings}
        audioInputs={[]}
        audioOutputs={[]}
        {...extraProps}
      />
    );
  };
  await act(async () => {
    render();
  });
  const view = {
    container,
    getSettings: () => settings,
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

function offsetField(container) {
  return container.querySelector('#manual-recording-offset-ms');
}

function setFieldValue(field, value) {
  const prototype = window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor.set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('PlaybackDevicesSettingsPanel recording delay', () => {
  it('uses a typed number as the manual offset', async () => {
    const view = await renderPanel({ recordingOffsetMs: 12 });
    const field = offsetField(view.container);
    expect(field.disabled).toBe(false);
    expect(field.type).toBe('text');
    expect(view.container.textContent).toContain('Milliseconds trimmed from each take');
    expect(view.container.textContent).not.toContain('Manual offset');

    await act(async () => {
      field.focus();
      setFieldValue(field, '48');
    });

    expect(view.getSettings().recordingOffsetMode).toBe('manual');
    expect(view.getSettings().recordingOffsetMs).toBe(48);
    expect(offsetField(view.container).value).toBe('48');

    await act(async () => {
      setFieldValue(offsetField(view.container), '63.6');
    });
    expect(view.getSettings().recordingOffsetMs).toBe(64);
    expect(offsetField(view.container).value).toBe('64');
    expect(view.container.textContent).not.toContain('Refresh device list');
  });

  it('shows the measured offset in the same field and measures from the button', async () => {
    const onMeasureRecordingDelay = vi.fn();
    const view = await renderPanel({}, {
      recordingDelay: {
        status: 'measured',
        calibration: { roundTripMs: 63.4, measuredAt: Date.UTC(2026, 9, 12) },
        deviceInfo: { input: { label: 'Headset Mic' }, output: { label: 'Headset' }, warnings: [] },
      },
      onMeasureRecordingDelay,
    });
    expect(offsetField(view.container).value).toBe('63');
    expect(view.container.textContent).not.toContain('Headset Mic');
    expect(view.container.textContent).not.toContain('Measure the input-to-output round trip');
    expect(view.container.textContent).not.toContain('input device can hear the output device');
    expect(view.container.textContent).not.toContain('Keep measuring until I stop');
    const button = Array.from(view.container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent.trim() === 'Latency test' || candidate.textContent.trim() === 'Measure');
    await act(async () => {
      button.click();
    });
    expect(onMeasureRecordingDelay).toHaveBeenCalledTimes(1);

    await views.pop().unmount();
    const plain = await renderPanel({});
    expect(plain.container.textContent).not.toContain('Latency test');
    expect(plain.container.textContent).not.toContain('Measure');
    expect(offsetField(plain.container)).toBeTruthy();
  });

  it('shows a loading state on the measure button while a measurement is running', async () => {
    const view = await renderPanel({}, {
      recordingDelay: {
        status: 'measured',
        calibration: { roundTripMs: 214, sigmaMs: 14.2, stable: false },
      },
      onMeasureRecordingDelay: vi.fn(),
      measuringRecordingDelay: true,
      recordingDelayError: 'The microphone did not pick up the test sound.',
    });
    expect(offsetField(view.container).value).toBe('214');
    const button = Array.from(view.container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent.trim() === 'Measuring…');
    expect(button.disabled).toBe(true);
    expect(view.container.textContent).toContain('did not pick up the test sound');
  });

  it('does not render hover text on the measure button even when wireless is detected', async () => {
    const view = await renderPanel({}, {
      recordingDelay: {
        status: 'missing',
        deviceInfo: { bluetooth: true, warnings: [] },
      },
      onMeasureRecordingDelay: vi.fn(),
    });
    expect(view.container.textContent).not.toContain('Wireless device detected');
    expect(view.container.textContent).not.toContain('Measure the input-to-output round trip');
  });

  it('renders and updates playback speed settings when showPlaybackSpeedSettings is true', async () => {
    const view = await renderPanel({}, { showPlaybackSpeedSettings: true });
    expect(view.container.textContent).toContain('Pitch Preservation Engine (SignalsmithStretch)');

    // Process per track stem checkbox
    const targetCheckbox = view.container.querySelector('input[type="checkbox"][aria-label="Process per track stem"]');
    expect(targetCheckbox).toBeTruthy();
    expect(targetCheckbox.checked).toBe(false);

    // Switch to per-track stems
    await act(async () => {
      targetCheckbox.click();
    });
    expect(view.getSettings().playbackSpeedSettings.stretchPerTrack).toBe(true);

    // Formant compensation checkbox
    const formantCheckbox = view.container.querySelector('input[type="checkbox"][aria-label="Enable vocal formant compensation"]');
    expect(formantCheckbox.checked).toBe(false);
    await act(async () => {
      formantCheckbox.click();
    });
    expect(view.getSettings().playbackSpeedSettings.formantCompensation).toBe(true);

    // Block length slider
    const blockSlider = view.container.querySelector('input[type="range"][aria-label="block (ms)"]');
    expect(blockSlider.value).toBe('120');
    await act(async () => {
      setFieldValue(blockSlider, '80');
    });
    expect(view.getSettings().playbackSpeedSettings.blockMs).toBe(80);

    // Reset defaults button
    const resetButton = Array.from(view.container.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === 'Reset defaults');
    expect(resetButton).toBeTruthy();
    await act(async () => {
      resetButton.click();
    });
    expect(view.getSettings().playbackSpeedSettings.stretchPerTrack).toBe(false);
    expect(view.getSettings().playbackSpeedSettings.formantCompensation).toBe(false);
    expect(view.getSettings().playbackSpeedSettings.blockMs).toBe(120);
  });
});
