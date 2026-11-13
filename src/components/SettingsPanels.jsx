import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { AUTO_PAN_STRATEGIES } from '../utils/choirAutoPan';
import { PAN_LAW_OPTIONS_DB } from '../utils/audio';
import { audioManager } from '../lib/audioManager';
import {
  DEFAULT_PLAYBACK_SPEED_SETTINGS,
  RECORDING_OFFSET_MODES,
  normalizePlaybackSpeedSettings,
} from '../utils/playbackOutput';

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
          <button
            type="button"
            className="ml-auto rounded bg-gray-700 px-2.5 py-1.5 text-xs text-white hover:bg-gray-600 disabled:cursor-wait disabled:opacity-60"
            onClick={() => onMeasureRecordingDelay()}
            disabled={measuringRecordingDelay}
            aria-busy={measuringRecordingDelay}
          >
            {measuringRecordingDelay ? 'Measuring…' : 'Latency test'}
          </button>
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

function SettingInfoTooltip({ title, description, tuning }) {
  return (
    <span className="relative inline-flex items-center group ml-1 shrink-0 align-middle">
      <span
        tabIndex={0}
        role="button"
        aria-label={`${title} info`}
        className="text-gray-400 hover:text-blue-400 transition-colors p-0.5 rounded cursor-help focus:outline-none focus:text-blue-400"
      >
        <Info size={14} className="shrink-0" />
      </span>
      <div
        role="tooltip"
        className="pointer-events-none invisible group-hover:visible group-focus-within:visible opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 w-72 rounded-lg border border-gray-700 bg-gray-950/95 backdrop-blur-md p-3 text-xs shadow-2xl text-left"
      >
        <div className="font-semibold text-blue-400 mb-1">{title}</div>
        <p className="text-gray-300 leading-relaxed mb-2">{description}</p>
        <div className="text-[11px] text-gray-400 border-t border-gray-800 pt-1.5 leading-snug">
          <span className="font-medium text-gray-200">How to tune: </span>
          {tuning}
        </div>
      </div>
    </span>
  );
}

function SettingSliderRow({
  label,
  info,
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled = false,
  extraControl = null,
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitValue = (val) => {
    const num = Number(val);
    if (!Number.isFinite(num)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, num));
    onChange(clamped);
    setDraft(String(clamped));
  };

  return (
    <div className={`grid grid-cols-[130px_1fr_76px] sm:grid-cols-[150px_1fr_80px] items-center gap-3 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-1 min-w-0">
        {extraControl}
        <span className="text-xs text-gray-300 truncate" title={label}>{label}</span>
        <SettingInfoTooltip {...info} />
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded bg-gray-800 cursor-pointer accent-blue-500"
      />
      <input
        type="number"
        aria-label={`${label} input`}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          const num = Number(e.target.value);
          if (Number.isFinite(num)) {
            const clamped = Math.max(min, Math.min(max, num));
            onChange(clamped);
          }
        }}
        onBlur={() => commitValue(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitValue(draft);
            e.currentTarget.blur();
          }
        }}
        className="w-full rounded bg-gray-950 border border-gray-700 px-2 py-1 text-xs text-right font-mono text-gray-200 focus:outline-none focus:border-blue-500"
      />
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
  showPlaybackSpeedSettings = false,
}) {
  const detectedStereoOutput = outputChannelCount > 1;
  const speedSettings = normalizePlaybackSpeedSettings(audioSettings?.playbackSpeedSettings);

  const updateSpeedSettings = (patch) => {
    setAudioSettings((prev) => ({
      ...prev,
      playbackSpeedSettings: normalizePlaybackSpeedSettings({
        ...normalizePlaybackSpeedSettings(prev?.playbackSpeedSettings),
        ...patch,
      }),
    }));
  };

  const handleResetSpeedSettings = () => {
    setAudioSettings((prev) => ({
      ...prev,
      playbackSpeedSettings: { ...DEFAULT_PLAYBACK_SPEED_SETTINGS },
    }));
  };

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

      {showPlaybackSpeedSettings ? (
        <section className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-gray-100">Pitch Preservation Engine (SignalsmithStretch)</div>
            </div>
            <button
              type="button"
              onClick={handleResetSpeedSettings}
              className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 transition-colors shrink-0"
              title="Reset to recommended defaults"
            >
              Reset defaults
            </button>
          </div>

          <div className="space-y-4">
            {/* 1. Processing Target Checkbox */}
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300 select-none cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Process per track stem"
                  className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                  checked={speedSettings.stretchPerTrack}
                  onChange={(e) => updateSpeedSettings({ stretchPerTrack: e.target.checked })}
                />
                <span className="font-medium text-gray-200">Process per track stem</span>
                <SettingInfoTooltip
                  title="Process per track stem"
                  description="Runs SignalsmithStretch on each audio stem separately instead of through the master output mix."
                  tuning="Leave unchecked (Master mix) for standard playback to guarantee phase coherence, eliminate inter-instrument comb filtering, and minimize CPU usage. Enable only if experimenting with individual stem pitch manipulation."
                />
              </label>
            </div>

            {/* 2. Show Pitch Transpose in Player Controls Toggle */}
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300 select-none cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Show pitch transpose"
                  className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                  checked={speedSettings.showTransposeControl}
                  onChange={(e) => updateSpeedSettings({ showTransposeControl: e.target.checked })}
                />
                <span className="font-medium text-gray-200">Show pitch transpose</span>
                <SettingInfoTooltip
                  title="Show pitch transpose"
                  description="Displays a pitch transposition sliderin the player controls sidebar."
                  tuning="Enable to rehearse pieces in different keys or perform fine decimal pitch tuning (e.g. A440 to A432) live during playback."
                />
              </label>
            </div>

            <div className="border-t border-gray-800 pt-3 space-y-3">
              {/* 3. Tonality Limit */}
              <SettingSliderRow
                label="tonality limit"
                info={{
                  title: 'Tonality limit',
                  description: 'Frequency ceiling (Hz) separating pitched harmonic tonality from non-tonal noise.',
                  tuning: 'Higher (12,000–20,000 Hz) preserves treble pitch across synths and high solo lines. Lower (4,000–8,000 Hz) keeps cymbals, hi-hats, and vocal sibilance crisp and free of robotic flanging.',
                }}
                min={1000}
                max={20000}
                step={100}
                value={speedSettings.tonalityHz}
                onChange={(tonalityHz) => updateSpeedSettings({ tonalityHz })}
              />

              {/* 4. Vocal Formant Compensation */}
              <SettingSliderRow
                label="formant"
                info={{
                  title: 'Vocal formant compensation',
                  description: 'Preserves the acoustic resonances of the vocal tract ("throat size") when shifting pitch, preventing chipmunk or giant voice effects.',
                  tuning: 'Turn checkbox ON for solo vocal rehearsals. Tune the fundamental frequency (Hz) to match the singer: 100–200 Hz for low/male vocals, 250–500 Hz for high/female vocals. Leave OFF for full music mixes.',
                }}
                min={50}
                max={1000}
                step={10}
                value={speedSettings.formantBaseHz}
                onChange={(formantBaseHz) => updateSpeedSettings({ formantBaseHz })}
                extraControl={
                  <input
                    type="checkbox"
                    aria-label="Enable vocal formant compensation"
                    className="h-4 w-4 rounded border-gray-600 bg-gray-900 shrink-0 mr-1"
                    checked={speedSettings.formantCompensation}
                    onChange={(e) => updateSpeedSettings({ formantCompensation: e.target.checked })}
                  />
                }
              />

              {/* 5. Block (ms) */}
              <SettingSliderRow
                label="block (ms)"
                info={{
                  title: 'Analysis block size',
                  description: 'The Short-Time Fourier Transform (STFT) window duration in milliseconds.',
                  tuning: 'Lower values (40–80 ms) give sharper rhythmic time resolution and crisper drum transients. Higher values (120–200 ms) give purer frequency resolution for sustained chords, choir vocals, and bass.',
                }}
                min={40}
                max={250}
                step={5}
                value={speedSettings.blockMs}
                onChange={(blockMs) => updateSpeedSettings({ blockMs })}
              />

              {/* 6. Overlap */}
              <SettingSliderRow
                label="overlap"
                info={{
                  title: 'Overlap factor',
                  description: 'Number of overlapping analysis frames per STFT block.',
                  tuning: 'Lower values (2x–4x) use minimal CPU, ideal for slower hardware or many stems. Higher values (8x–16x) provide smoother phase alignment and eliminate fluttering artifacts at the cost of higher CPU usage.',
                }}
                min={2}
                max={16}
                step={1}
                value={speedSettings.overlap}
                onChange={(overlap) => updateSpeedSettings({ overlap, highOverlap: overlap >= 8 })}
              />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function DawSettingsPanel({ settings, setSettings }) {
  const update = (patch) => setSettings((prev) => ({ ...prev, ...patch }));
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1" htmlFor="daw-amplitude-scale">
          Amplitude scale
        </label>
        <select
          id="daw-amplitude-scale"
          aria-label="Waveform amplitude scale"
          className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
          value={settings.displayMode}
          onChange={(event) => update({ displayMode: event.target.value })}
        >
          <option value="linear">Fixed linear</option>
          <option value="normalized">Project normalized (compatibility)</option>
          <option value="db">Decibels (-60 dB floor)</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={Boolean(settings.stereo)}
          onChange={(event) => update({ stereo: event.target.checked })}
        />
        <span>Stereo waveforms</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={settings.showRms}
          onChange={(event) => update({ showRms: event.target.checked })}
        />
        <span>RMS energy</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={settings.scaleWaveformsByGain !== false}
          onChange={(event) => update({ scaleWaveformsByGain: event.target.checked })}
        />
        <span>Scale waveforms by gain</span>
      </label>
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
