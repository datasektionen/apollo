import { useEffect, useState } from 'react';
import { AUTO_PAN_STRATEGIES } from '../utils/choirAutoPan';
import { PAN_LAW_OPTIONS_DB } from '../utils/audio';
import { RECORDING_OFFSET_MODES } from '../utils/playbackOutput';

function formatOffsetMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return String(Math.max(0, Math.round(numeric)));
}

function integerOffsetDraft(raw) {
  const cleaned = String(raw).replace(/[^\d.]/g, '');
  if (!cleaned) return '';
  if (cleaned.includes('.')) {
    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) return '';
    return String(Math.max(0, Math.round(numeric)));
  }
  return cleaned.replace(/\D/g, '');
}

/**
 * Recording offset for the current device pair. The number is what gets trimmed
 * from each take. Typing it sets a manual offset. Measure writes a new number
 * into the same field.
 */
function RecordingDelaySection({
  audioSettings,
  setAudioSettings,
  recordingDelay = null,
  onMeasureRecordingDelay = null,
  measuringRecordingDelay = false,
  recordingDelayError = '',
}) {
  const manualMode = audioSettings.recordingOffsetMode === RECORDING_OFFSET_MODES.MANUAL;
  const calibration = recordingDelay?.calibration || null;
  const status = recordingDelay?.status || null;
  const warnings = recordingDelay?.deviceInfo?.warnings || [];
  const canMeasure = typeof onMeasureRecordingDelay === 'function';
  const bluetooth = recordingDelay?.deviceInfo?.bluetooth === true;
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (measuringRecordingDelay) setDraft(null);
  }, [measuringRecordingDelay]);

  const storedOffset = manualMode
    ? audioSettings.recordingOffsetMs
    : (calibration && (status === 'measured' || status === 'stale')
      ? calibration.roundTripMs
      : audioSettings.recordingOffsetMs);
  const shownOffset = draft == null ? formatOffsetMs(storedOffset) : draft;

  const commitOffset = (raw) => {
    const numeric = raw === '' ? 0 : Number(raw);
    setAudioSettings((prev) => ({
      ...prev,
      recordingOffsetMode: RECORDING_OFFSET_MODES.MANUAL,
      recordingOffsetMs: Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0,
    }));
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs font-medium text-gray-300">Recording offset</div>
        <p className="mt-1 text-xs text-gray-400">
          Milliseconds trimmed from each take so it lines up with the project.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="manual-recording-offset-ms"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Recording offset (ms)"
          disabled={measuringRecordingDelay}
          className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm focus:outline-none disabled:cursor-not-allowed disabled:text-gray-500"
          value={shownOffset}
          onFocus={() => setDraft(formatOffsetMs(storedOffset))}
          onChange={(event) => {
            const raw = integerOffsetDraft(event.target.value);
            setDraft(raw);
            commitOffset(raw);
          }}
          onBlur={() => setDraft(null)}
        />
        <span className="text-xs text-gray-500">ms</span>
        {canMeasure ? (
          <div className="group relative ml-auto">
            <button
              type="button"
              className="rounded bg-gray-700 px-2.5 py-1.5 text-xs text-white hover:bg-gray-600 disabled:cursor-wait disabled:opacity-60"
              onClick={() => onMeasureRecordingDelay()}
              disabled={measuringRecordingDelay}
              aria-busy={measuringRecordingDelay}
            >
              {measuringRecordingDelay ? 'Measuring…' : 'Measure'}
            </button>
            <div className="invisible absolute bottom-full right-0 z-20 w-64 pb-2 group-hover:visible group-focus-within:visible">
              <div className="rounded border border-gray-600 bg-gray-950 p-3 text-xs text-gray-200 opacity-0 shadow-lg group-hover:opacity-100 group-focus-within:opacity-100">
                <p>Measure the input-to-output round trip. Make sure your input device can hear the output device before measuring.</p>
                {bluetooth ? (
                  <p className="mt-2 text-amber-200">
                    Wireless device detected. Acoustic round trip will likely vary and you will need to manually adjust timing post recording. For best recording precision, use wired devices.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {recordingDelayError ? (
        <p className="text-xs text-amber-200" role="alert">{recordingDelayError}</p>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="space-y-1 text-xs text-amber-200">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PlaybackDevicesSettingsPanel({
  audioSettings,
  setAudioSettings,
  audioInputs,
  audioOutputs,
  monoOutputActive = false,
  outputChannelCount = 2,
  recordingDelay = null,
  onMeasureRecordingDelay = null,
  measuringRecordingDelay = false,
  recordingDelayError = '',
}) {
  const detectedStereoOutput = outputChannelCount > 1;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
        <div className="mb-3 text-sm font-semibold text-gray-100">Input</div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Input device</label>
            <select
              className="w-full rounded bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
              value={audioSettings.inputDeviceId}
              onChange={(e) =>
                setAudioSettings((prev) => ({ ...prev, inputDeviceId: e.target.value }))
              }
            >
              <option value="">Default</option>
              {audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Input ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </div>
          <RecordingDelaySection
            audioSettings={audioSettings}
            setAudioSettings={setAudioSettings}
            recordingDelay={recordingDelay}
            onMeasureRecordingDelay={onMeasureRecordingDelay}
            measuringRecordingDelay={measuringRecordingDelay}
            recordingDelayError={recordingDelayError}
          />
        </div>
      </section>

      <section className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
        <div className="mb-3 text-sm font-semibold text-gray-100">Output</div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Output device</label>
            <select
              className="w-full rounded bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
              value={audioSettings.outputDeviceId}
              onChange={(e) =>
                setAudioSettings((prev) => ({ ...prev, outputDeviceId: e.target.value }))
              }
            >
              <option value="">Default</option>
              {audioOutputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Output ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </div>
          {detectedStereoOutput ? (
            <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                checked={audioSettings.forceMonoOutput === true}
                onChange={(e) =>
                  setAudioSettings((prev) => ({ ...prev, forceMonoOutput: e.target.checked }))
                }
              />
              <span>Force mono</span>
            </label>
          ) : null}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Panning law</label>
            <select
              className={`w-full rounded border px-3 py-2 text-sm focus:outline-none ${
                monoOutputActive
                  ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-950 border-gray-700'
              }`}
              value={String(monoOutputActive ? 0 : audioSettings.stereoPanLawDb)}
              onChange={(e) =>
                setAudioSettings((prev) => ({ ...prev, stereoPanLawDb: Number(e.target.value) }))
              }
              disabled={monoOutputActive}
            >
              {monoOutputActive ? (
                <option value="0">0 dB</option>
              ) : (
                PAN_LAW_OPTIONS_DB.map((value) => (
                  <option key={value} value={value}>
                    {`${value} dB`}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ProjectSettingsPanel({
  project,
  onSetPublished,
  onSetAutoPanStrategy,
  onToggleAutoPanInverted,
  onSetAutoPanManualChoirParts,
}) {
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={Boolean(project?.published)}
          onChange={(e) => onSetPublished(e.target.checked)}
        />
        <span>Publish</span>
      </label>

      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Choir auto-pan
        </label>
        <select
          className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
          value={project?.autoPan?.enabled ? project.autoPan?.strategy : 'off'}
          onChange={(e) => onSetAutoPanStrategy(e.target.value)}
        >
          <option value="off">Off</option>
          {AUTO_PAN_STRATEGIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={Boolean(project?.autoPan?.inverted)}
          onChange={(e) => onToggleAutoPanInverted(e.target.checked)}
        />
        <span>Inverted Auto Pan</span>
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={Boolean(project?.autoPan?.manualChoirParts)}
          onChange={(e) => onSetAutoPanManualChoirParts(e.target.checked)}
        />
        <span>Manually select choir parts</span>
      </label>
    </div>
  );
}
