import { useCallback, useEffect, useRef, useState } from 'react';
import { audioManager } from '../lib/audioManager';
import { reportUserError } from '../utils/errorReporter';
import {
  DEFAULT_PLAYBACK_DEVICE_SETTINGS,
  detectOutputChannelCount,
  isDefaultAudioOutputDeviceId,
  isMonoOutputActive,
  normalizePlaybackDeviceSettings,
  resolvePlaybackPanLawDisplayDb,
} from '../utils/playbackOutput';

export function useAudioDeviceAutoPause(onAutoPause) {
  const onAutoPauseRef = useRef(onAutoPause);
  onAutoPauseRef.current = onAutoPause;

  useEffect(() => audioManager.subscribePlaybackInterrupted((event) => {
    onAutoPauseRef.current?.(event?.timeMs, event?.reason);
  }), []);
}

export function usePlaybackDeviceSettings(options = {}) {
  const {
    defaults = DEFAULT_PLAYBACK_DEVICE_SETTINGS,
    errorPrefix = 'settings',
    onRecordingOffsetChange = null,
  } = options;

  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [audioSettings, setAudioSettings] = useState(normalizePlaybackDeviceSettings(defaults));
  const [outputChannelCount, setOutputChannelCount] = useState(2);
  const hasHydratedSettingsRef = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem('apollo.settings');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setAudioSettings((prev) => normalizePlaybackDeviceSettings({
        ...prev,
        ...parsed,
      }));
    } catch (error) {
      reportUserError(
        'Failed to read app settings from local storage. Defaults will be used.',
        error,
        { onceKey: `${errorPrefix}:settings-parse` }
      );
    }
  }, [errorPrefix]);

  useEffect(() => {
    if (!hasHydratedSettingsRef.current) {
      hasHydratedSettingsRef.current = true;
    } else {
      let existing = {};
      try {
        existing = JSON.parse(localStorage.getItem('apollo.settings') || '{}');
      } catch (error) {
        reportUserError(
          'Failed to parse existing app settings from local storage. They will be replaced.',
          error,
          { onceKey: `${errorPrefix}:settings-merge-parse` }
        );
        existing = {};
      }

      localStorage.setItem('apollo.settings', JSON.stringify({
        ...existing,
        ...normalizePlaybackDeviceSettings(audioSettings),
      }));
    }

    if (typeof onRecordingOffsetChange === 'function') {
      onRecordingOffsetChange(Math.max(0, Number(audioSettings.recordingOffsetMs) || 0));
    }
  }, [audioSettings, errorPrefix, onRecordingOffsetChange]);

  const applyEnumeratedDevices = useCallback((devices) => {
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    setAudioInputs(inputs);
    setAudioOutputs(outputs);

    setAudioSettings((prev) => {
      const selectedOutputId = String(prev.outputDeviceId || '');
      if (isDefaultAudioOutputDeviceId(selectedOutputId)) return prev;
      const hasRealOutputIds = outputs.some((device) => device.deviceId);
      if (!hasRealOutputIds) return prev;
      if (outputs.some((device) => device.deviceId === selectedOutputId)) return prev;
      // Don't reroute to the OS default while audio is still playing.
      if (audioManager.isPlaying) return prev;
      return { ...prev, outputDeviceId: '' };
    });
  }, []);

  const listAudioDevices = useCallback(async ({ requestPermissionIfNeeded = false } = {}) => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some((device) => device.label);
    if (requestPermissionIfNeeded && !hasLabels) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (error) {
        reportUserError(
          'Could not access microphone permissions to read device labels.',
          error,
          { onceKey: `${errorPrefix}:device-label-permission` }
        );
      }
    }

    applyEnumeratedDevices(devices);
  }, [applyEnumeratedDevices, errorPrefix]);

  const refreshAudioDevices = useCallback(async () => {
    await listAudioDevices({ requestPermissionIfNeeded: true });
  }, [listAudioDevices]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return undefined;

    const handleDeviceChange = () => {
      void listAudioDevices({ requestPermissionIfNeeded: false });
    };

    if (typeof mediaDevices.addEventListener === 'function') {
      mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    }

    mediaDevices.ondevicechange = handleDeviceChange;
    return () => {
      if (mediaDevices.ondevicechange === handleDeviceChange) {
        mediaDevices.ondevicechange = null;
      }
    };
  }, [listAudioDevices]);

  useEffect(() => {
    let ignore = false;

    const updateOutputChannelCount = async () => {
      const nextCount = await detectOutputChannelCount(audioSettings.outputDeviceId);
      if (!ignore) {
        setOutputChannelCount(nextCount);
      }
    };

    updateOutputChannelCount();
    return () => {
      ignore = true;
    };
  }, [audioSettings.outputDeviceId]);

  const normalizedAudioSettings = normalizePlaybackDeviceSettings(audioSettings);
  const monoOutputActive = isMonoOutputActive(normalizedAudioSettings.forceMonoOutput, outputChannelCount);
  const playbackPanLawDb = resolvePlaybackPanLawDisplayDb(normalizedAudioSettings, outputChannelCount);

  return {
    audioInputs,
    audioOutputs,
    audioSettings: normalizedAudioSettings,
    monoOutputActive,
    outputChannelCount,
    playbackPanLawDb,
    refreshAudioDevices,
    setAudioSettings,
  };
}
