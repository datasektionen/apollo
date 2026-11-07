import { useEffect, useRef, useState } from 'react';
import { waveformService } from '../lib/waveformService';

export const DAW_VIEW_STORAGE_KEY = 'apollo.dawView';

export const DEFAULT_DAW_VIEW_SETTINGS = {
  displayMode: 'linear',
  showRms: false,
  stereo: false,
  scaleWaveformsByGain: true,
};

export function normalizeDawViewSettings(value) {
  const mode = value?.displayMode;
  return {
    displayMode: mode === 'normalized' || mode === 'db' ? mode : 'linear',
    showRms: value?.showRms === true,
    stereo: value?.stereo === true,
    scaleWaveformsByGain: value?.scaleWaveformsByGain !== false,
  };
}

function readDawViewSettings() {
  try {
    const saved = localStorage.getItem(DAW_VIEW_STORAGE_KEY);
    return saved ? normalizeDawViewSettings(JSON.parse(saved)) : DEFAULT_DAW_VIEW_SETTINGS;
  } catch {
    return DEFAULT_DAW_VIEW_SETTINGS;
  }
}

/** Waveform display choices for this machine. They are not part of the project. */
export function useDawViewSettings() {
  const [settings, setSettings] = useState(readDawViewSettings);
  const skipWrite = useRef(true);

  useEffect(() => {
    waveformService?.setDefaultChannels?.(settings.stereo ? 2 : 1);
  }, [settings.stereo]);

  useEffect(() => {
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    localStorage.setItem(DAW_VIEW_STORAGE_KEY, JSON.stringify(normalizeDawViewSettings(settings)));
  }, [settings]);

  return [settings, setSettings];
}
