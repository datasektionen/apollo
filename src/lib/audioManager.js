import {
  volumeToGain,
  msToSeconds,
  normalizePanLawDb,
  getPanLawCompensationGain,
  getPanLawHeadroomGain,
} from '../utils/audio';
import { SAMPLE_RATE } from '../types/project';
import { getEffectiveTrackMix } from '../utils/trackTree';
import { reportUserError } from '../utils/errorReporter';
import {
  DEFAULT_PLAYBACK_SPEED_SETTINGS,
  applySinkIdToAudioContext,
  applySinkIdToMediaElement,
  collectAudioOutputDeviceIds,
  isDefaultAudioOutputDeviceId,
  normalizePlaybackSpeedSettings,
  shouldAutoPauseForOutputDeviceChange,
  shouldRoutePlaybackThroughMediaElement,
} from '../utils/playbackOutput';
import {
  audioBufferFromPlanarPcm,
  audioBufferToLocalWavBlob,
  decodeFlacArrayBuffer,
  isFlacArrayBuffer,
  isPlanarPcmArrayBuffer,
  prefersSoftwareFlacDecode,
} from './mediaEncoding';
import { logLoadProgress, shortLoadId, withLoadStep } from './loadProgress';
import { MediaBufferCache, mediaWaveformRevision, rememberMediaRevision } from './mediaBufferCache';
import { waveformService } from './waveformService';
import SignalsmithStretch from 'signalsmith-stretch';

const WORKLET_CACHE_KEY = 'v=1.3.2-p3';
const baseWorkletUrl = `${import.meta.env?.BASE_URL || '/'}signalsmith-stretch.js`.replace(/\/+/g, '/');
const workletUrl = `${baseWorkletUrl}?${WORKLET_CACHE_KEY}`;
if (typeof SignalsmithStretch === 'function') {
  SignalsmithStretch.moduleUrl = workletUrl;
}

const MASTER_LIMITER_THRESHOLD_DB = -1;
const MASTER_LIMITER_KNEE_DB = 0;
const MASTER_LIMITER_RATIO = 20;
const MASTER_LIMITER_ATTACK_SEC = 0;
const MASTER_LIMITER_RELEASE_SEC = 0.1;
const MASTER_CEILING = 0.9999;
const MASTER_CEILING_START = 0.98;

function createMasterCeilingCurve(size = 4096) {
  const curve = new Float32Array(size);
  const ceilingRange = MASTER_CEILING - MASTER_CEILING_START;
  const normalization = Math.tanh(3);

  for (let index = 0; index < size; index += 1) {
    const input = (index / (size - 1)) * 2 - 1;
    const sign = input < 0 ? -1 : 1;
    const magnitude = Math.abs(input);
    if (magnitude <= MASTER_CEILING_START) {
      curve[index] = input;
      continue;
    }

    const normalized = (magnitude - MASTER_CEILING_START) / (1 - MASTER_CEILING_START);
    const limitedMagnitude = MASTER_CEILING_START
      + (ceilingRange * Math.tanh(normalized * 3) / normalization);
    curve[index] = sign * Math.min(MASTER_CEILING, limitedMagnitude);
  }

  return curve;
}

/**
 * Audio Manager
 * Handles Web Audio API playback, mixing, and rendering
 */
export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.masterGainNode = null;
    this.masterLimiterNode = null;
    this.masterCeilingNode = null;
    this.masterOutputNode = null;
    this.mediaCache = new MediaBufferCache({
          onSet: (blobId, buffer, options) => waveformService.ensureSource(blobId, buffer, options),
          onDelete: (blobId, buffer) => waveformService.releaseSource(blobId, buffer),
          onClear: () => waveformService.clear(),
        });
    this.activeSources = new Map(); // trackId -> { source, gainNode, panNode }
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.isInitializingPlayback = false; // Flag to prevent concurrent play() calls
    this.playbackRequestId = 0;
    this.initializingPlaybackRequestId = null;
    this.currentMasterVolume = 100;
    this.currentOutputVolume = 100;
    this.currentPanLawDb = normalizePanLawDb();
    this.currentOutputDeviceId = '';
    this.currentOutputChannelCount = 2;
    this.forceMonoOutput = false;
    this.masterVolumeCurve = 'legacy';
    this.masterHeadroomEnabled = true;
    this.outputStreamDestination = null;
    this.outputRoutingElement = null;
    this.outputTargetNode = null;
    this.outputClockPrimed = false;
    this.previousOutputDeviceIds = new Set();
    this.playbackInterruptedListeners = new Set();
    this.playbackStartedListeners = new Set();
    this.hardwareLifecycleAttached = false;
    this.isConfiguringOutput = false;
    this.boundContextStateChange = null;
    this.boundContextSinkChange = null;
    this.boundDeviceChange = null;
    this.currentPlayOptions = null;
    this.currentProject = null;
    this.currentPlaybackRate = 1.0;
    this.currentTransposeSemitones = 0;
    this.playbackRateAnchorContextTime = 0;
    this.playbackRateAnchorTimelineMs = 0;
    this.playbackSpeedSettings = { ...DEFAULT_PLAYBACK_SPEED_SETTINGS };
    this.stretchNode = null;
    this.trackStretchNodes = new Map();
    this.stretchNodePromise = null;
    this.workletLoadedPromise = null;
    this.isStretchConnected = false;
    this.masterSafetyInputNode = null;
    this.bypassStretch = false;
    this.diagnosticsListeners = new Set();
    this.latestStretchDiagnostics = {
      inRmsDb: -100,
      outRmsDb: -100,
      inRms: 0,
      outRms: 0,
      active: false,
      semitones: 0,
      tonalityHz: 6000,
      channels: 2,
      procDurationMs: 0,
      updatedAt: 0,
    };
    this.workletLastError = null;
    this.lastDiagLogTime = 0;
  }

  /**
   * Initialize Audio Context (must be called after user interaction)
   */
  async init() {
    if (this.audioContext) return;

    // Use the hardware native rate. Forcing 44100 on 48kHz Android devices
    // causes a brief pitch+speed mismatch until the output path settles.
    // "playback" prefers a larger output buffer so music is less likely to
    // drop out on phones; start/stop latency is still fine for rehearsal.
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.audioContext = new AudioContextCtor({ latencyHint: 'playback' });

    // Create master gain node
    this.masterGainNode = this.audioContext.createGain();
    this.masterGainNode.channelCountMode = 'explicit';
    this.masterGainNode.channelInterpretation = 'speakers';
    this.masterGainNode.channelCount = this.getTargetOutputChannelCount();
    this.masterGainNode.gain.value = this.getMasterOutputGain();
    this.createMasterSafetyStage();
    await this.configureOutputRouting();
    this.attachHardwareLifecycleListeners();
    await this.handleOutputDeviceChange({ primeOnly: true });

    await this.ensureStretchNode();

    console.log('AudioManager initialized', {
      sampleRate: this.audioContext.sampleRate,
      state: this.audioContext.state,
    });
  }

  /**
   * Ensure audio context is running (handle browser autoplay policies)
   */
  async resume() {
    if (this.audioContext && this.audioContext.state !== 'running') {
      await this.audioContext.resume();
    }
    if (this.outputTargetNode && this.outputTargetNode === this.outputStreamDestination) {
      await this.resumeOutputRoutingElement();
    }
    this.primeSilentOutput();
  }

  /**
   * Decode audio file to AudioBuffer
   */
  async decodeAudioFile(arrayBuffer) {
    if (!this.audioContext) {
      await this.init();
    }

    let audioBuffer;
    const useSoftwareFlac = isFlacArrayBuffer(arrayBuffer) && prefersSoftwareFlacDecode();
    if (useSoftwareFlac) {
      audioBuffer = await withLoadStep(
        'Decode FLAC (software)',
        async () => decodeFlacArrayBuffer(
          arrayBuffer,
          (channels, frames, sampleRate) => this.audioContext.createBuffer(channels, frames, sampleRate)
        ),
        { depth: 3 }
      );
    } else {
      try {
        audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      } catch (error) {
        const ctx = this.audioContext;
        const contextLabel = ctx
          ? `${Math.round(Number(ctx.sampleRate) || 0)}Hz state=${ctx.state || 'unknown'}`
          : 'AudioContext unavailable';
        logLoadProgress(
          `Native decodeAudioData ${error?.name || 'Error'}: ${error?.message || error} · ${contextLabel}`,
          { depth: 3 }
        );
        if (isFlacArrayBuffer(arrayBuffer) && arrayBuffer.byteLength > 0) {
          logLoadProgress('Retrying FLAC with software decoder', { depth: 3 });
          audioBuffer = await withLoadStep(
            'Decode FLAC (software)',
            async () => decodeFlacArrayBuffer(
              arrayBuffer,
              (channels, frames, sampleRate) => this.audioContext.createBuffer(channels, frames, sampleRate)
            ),
            { depth: 3 }
          );
        } else {
          throw error;
        }
      }
    }

    // decodeAudioData already matches the live context. If a buffer still
    // disagrees, resample to the hardware rate rather than a fixed 44.1kHz.
    if (audioBuffer.sampleRate !== this.audioContext.sampleRate) {
      return await withLoadStep(
        `Resample ${audioBuffer.sampleRate}Hz → ${this.audioContext.sampleRate}Hz`,
        async () => this.resampleAudioBuffer(audioBuffer, this.audioContext.sampleRate),
        { depth: 3 }
      );
    }

    return audioBuffer;
  }

  /**
   * Resample AudioBuffer to a target sample rate
   */
  async resampleAudioBuffer(audioBuffer, targetSampleRate = this.audioContext?.sampleRate || SAMPLE_RATE) {
    const duration = audioBuffer.duration;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = Math.max(1, Math.round(Number(targetSampleRate) || SAMPLE_RATE));
    const length = Math.ceil(duration * sampleRate);

    const offlineContext = new OfflineAudioContext(
      numberOfChannels,
      length,
      sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    return await offlineContext.startRendering();
  }

  /**
   * Convert AudioBuffer to Blob (WAV format)
   */
  audioBufferToBlob(audioBuffer) {
    return audioBufferToLocalWavBlob(audioBuffer);
  }

  /**
   * Load audio buffer from blob (with caching)
   */
  async loadAudioBuffer(blobId, blob, media = null) {
    // Check cache
    if (this.mediaCache.has(blobId)) {
      logLoadProgress(`AudioBuffer already in RAM (${shortLoadId(blobId)})`, {
        depth: 2,
        level: 'ok',
      });
      return this.mediaCache.get(blobId);
    }

    if (!this.audioContext) {
      await this.init();
    }

    const arrayBuffer = await withLoadStep(
      `Read cached bytes into memory (${shortLoadId(blobId)})`,
      async () => blob.arrayBuffer(),
      {
        depth: 2,
        bytesFrom: (buffer) => buffer?.byteLength,
      }
    );

    let audioBuffer;
    if (isPlanarPcmArrayBuffer(arrayBuffer)) {
      audioBuffer = await withLoadStep(
        `Copy planar PCM into AudioBuffer (${shortLoadId(blobId)})`,
        async () => audioBufferFromPlanarPcm(
          arrayBuffer,
          (channels, frames, sampleRate) => this.audioContext.createBuffer(channels, frames, sampleRate)
        ),
        { depth: 2 }
      );
      if (audioBuffer.sampleRate !== this.audioContext.sampleRate) {
        audioBuffer = await withLoadStep(
          `Resample ${audioBuffer.sampleRate}Hz → ${this.audioContext.sampleRate}Hz`,
          async () => this.resampleAudioBuffer(audioBuffer, this.audioContext.sampleRate),
          { depth: 3 }
        );
      }
    } else {
      audioBuffer = await withLoadStep(
        `Decode cached audio to AudioBuffer (${shortLoadId(blobId)})`,
        async () => this.decodeAudioFile(arrayBuffer),
        { depth: 2 }
      );
    }

    rememberMediaRevision(audioBuffer, mediaWaveformRevision(media));
    this.mediaCache.set(blobId, audioBuffer);

    return audioBuffer;
  }

  getPlaybackRate() {
    return this.currentPlaybackRate || 1.0;
  }

  getPlaybackSpeedSettings() {
    return { ...this.playbackSpeedSettings };
  }

  getTransposeSemitones() {
    return this.currentTransposeSemitones || 0;
  }

  async setTransposeSemitones(semitones) {
    const numeric = Number(semitones);
    const valid = Number.isFinite(numeric) ? Math.max(-12, Math.min(12, numeric)) : 0;
    if (Math.abs(this.currentTransposeSemitones - valid) < 1e-4) {
      return;
    }
    this.currentTransposeSemitones = valid;
    if (!this.stretchNode && this.needsPitchStretch()) {
      await this.ensureStretchNode();
    }
    this.updateStretchRouting();
  }

  needsPitchStretch() {
    const rateDiffers = Math.abs((this.currentPlaybackRate || 1.0) - 1.0) > 1e-4;
    const transposeDiffers = Math.abs(this.currentTransposeSemitones || 0) > 1e-4;
    return rateDiffers || transposeDiffers;
  }

  setPlaybackSpeedSettings(settings) {
    const prev = this.playbackSpeedSettings || {};
    const next = normalizePlaybackSpeedSettings({
      ...prev,
      ...settings,
    });

    const blockMsChanged = prev.blockMs !== next.blockMs;
    const overlapChanged = prev.overlap !== next.overlap || prev.highOverlap !== next.highOverlap;
    const tonalityChanged = prev.tonalityHz !== next.tonalityHz;
    const formantChanged = prev.formantCompensation !== next.formantCompensation;
    const formantBaseChanged = prev.formantBaseHz !== next.formantBaseHz;
    const perTrackChanged = prev.stretchPerTrack !== next.stretchPerTrack;
    const showTransposeChanged = prev.showTransposeControl !== next.showTransposeControl;

    if (!blockMsChanged && !overlapChanged && !tonalityChanged && !formantChanged && !formantBaseChanged && !perTrackChanged && !showTransposeChanged) {
      return;
    }

    this.playbackSpeedSettings = next;

    if (blockMsChanged || overlapChanged) {
      const blockMs = next.blockMs;
      const overlap = Number(next.overlap) || (next.highOverlap ? 8 : 4);
      const intervalMs = blockMs / Math.max(1, overlap);

      if (this.stretchNode && typeof this.stretchNode.configure === 'function') {
        try {
          this.stretchNode.configure({ blockMs, intervalMs, splitComputation: false });
        } catch {}
      }
    }

    this.updateStretchRouting();
  }

  async ensureStretchNode() {
    if (this.stretchNode) return this.stretchNode;
    if (!this.audioContext || typeof AudioWorkletNode === 'undefined') return null;
    if (typeof this.audioContext.audioWorklet?.addModule !== 'function') return null;
    if (this.stretchNodePromise) return this.stretchNodePromise;

    this.stretchNodePromise = (async () => {
      try {
        if (typeof SignalsmithStretch === 'function') {
          SignalsmithStretch.moduleUrl = workletUrl;
        }

        if (!this.workletLoadedPromise) {
          this.workletLoadedPromise = this.audioContext.audioWorklet.addModule(workletUrl).catch((err) => {
            console.warn('[AudioManager] Worklet module load warning:', err?.message || err);
          });
        }
        await this.workletLoadedPromise;

        const stretchNode = await SignalsmithStretch(this.audioContext, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        if (stretchNode) {
          stretchNode.onprocessorerror = (err) => {
            console.error('[AudioManager] SignalsmithStretch processor error:', err);
            this.workletLastError = err?.message || 'Processor error';
            this.notifyDiagnosticsListeners();
          };

          if (stretchNode.port) {
            const originalOnMessage = stretchNode.port.onmessage;
            stretchNode.port.onmessage = (event) => {
              const data = event?.data;
              if (Array.isArray(data)) {
                const [msgType, payload] = data;
                if (msgType === 'diagnostics') {
                  const inDb = payload.inRms > 1e-6 ? 20 * Math.log10(payload.inRms) : -100;
                  const outDb = payload.outRms > 1e-6 ? 20 * Math.log10(payload.outRms) : -100;
                  this.latestStretchDiagnostics = {
                    inRms: payload.inRms,
                    outRms: payload.outRms,
                    inRmsDb: Math.round(inDb * 10) / 10,
                    outRmsDb: Math.round(outDb * 10) / 10,
                    active: payload.active,
                    semitones: payload.semitones,
                    tonalityHz: payload.tonalityHz,
                    channels: payload.channels,
                    configureCount: payload.configureCount,
                    procDurationMs: payload.procDurationMs,
                    updatedAt: Date.now(),
                  };
                  this.notifyDiagnosticsListeners();
                  return;
                }
                if (msgType === 'workletError') {
                  console.error('[AudioManager] AudioWorklet reported error:', payload);
                  this.workletLastError = payload?.message || 'Worklet runtime error';
                  this.notifyDiagnosticsListeners();
                  return;
                }
              }
              if (typeof originalOnMessage === 'function') {
                originalOnMessage(event);
              }
            };
          }
        }
        this.stretchNode = stretchNode;
        const blockMs = this.playbackSpeedSettings.blockMs;
        const overlap = Number(this.playbackSpeedSettings.overlap) || (this.playbackSpeedSettings.highOverlap ? 8 : 4);
        const intervalMs = blockMs / Math.max(1, overlap);
        if (typeof stretchNode?.configure === 'function') {
          try {
            stretchNode.configure({ blockMs, intervalMs, splitComputation: false });
          } catch {}
        }
        this.wireMasterAudioGraph();
        this.updateStretchRouting();
        this.notifyDiagnosticsListeners();
        return stretchNode;
      } catch (err) {
        console.error('[AudioManager] SignalsmithStretch initialization failed:', err);
        this.stretchNode = null;
        this.wireMasterAudioGraph();
        return null;
      } finally {
        this.stretchNodePromise = null;
      }
    })();
    return this.stretchNodePromise;
  }

  async ensureTrackStretchNode() {
    return null;
  }

  async ensureTrackStretchNodes() {
    return;
  }

  wireMasterAudioGraph() {
    if (!this.audioContext || !this.masterGainNode) return;
    const targetSink = this.masterSafetyInputNode || this.masterOutputNode;
    if (!targetSink) return;

    try {
      this.masterGainNode.disconnect();
    } catch {}

    if (this.stretchNode && !this.bypassStretch) {
      try {
        this.stretchNode.disconnect();
      } catch {}
      try {
        this.masterGainNode.connect(this.stretchNode);
        this.stretchNode.connect(targetSink);
        this.isStretchConnected = true;
      } catch (err) {
        console.warn('Failed to wire stretch node in-line, falling back to direct master:', err);
        try {
          this.masterGainNode.connect(targetSink);
        } catch {}
        this.isStretchConnected = false;
      }
    } else {
      if (this.stretchNode) {
        try {
          this.stretchNode.disconnect();
        } catch {}
      }
      try {
        this.masterGainNode.connect(targetSink);
      } catch {}
      this.isStretchConnected = false;
    }
    this.notifyDiagnosticsListeners();
  }

  setBypassStretch(bypass) {
    this.bypassStretch = Boolean(bypass);
    this.wireMasterAudioGraph();
    this.updateStretchRouting();
    this.notifyDiagnosticsListeners();
    console.info(`[AudioManager] Stretch engine bypass set to: ${this.bypassStretch}`);
  }

  getAudioDiagnostics() {
    return {
      contextState: this.audioContext?.state || 'uninitialized',
      sampleRate: this.audioContext?.sampleRate || 0,
      currentTime: Math.round((this.audioContext?.currentTime || 0) * 100) / 100,
      isPlaying: Boolean(this.isPlaying),
      playbackRate: this.currentPlaybackRate || 1.0,
      activeSourcesCount: this.activeSources?.size || 0,
      workletLoaded: Boolean(this.stretchNode),
      isStretchConnected: Boolean(this.isStretchConnected),
      bypassStretch: Boolean(this.bypassStretch),
      workletError: this.workletLastError || null,
      worklet: this.latestStretchDiagnostics || {
        inRmsDb: -100,
        outRmsDb: -100,
        inRms: 0,
        outRms: 0,
        active: false,
        semitones: 0,
        tonalityHz: 6000,
        channels: 2,
        configureCount: 0,
        procDurationMs: 0,
      },
    };
  }

  subscribeAudioDiagnostics(listener) {
    if (typeof listener !== 'function') return () => {};
    this.diagnosticsListeners.add(listener);
    try {
      listener(this.getAudioDiagnostics());
    } catch {}
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  notifyDiagnosticsListeners() {
    if (!this.diagnosticsListeners.size) return;
    const diag = this.getAudioDiagnostics();
    for (const listener of this.diagnosticsListeners) {
      try {
        listener(diag);
      } catch {}
    }
  }

  updateStretchRouting() {
    if (!this.audioContext) return;

    const rate = this.currentPlaybackRate || 1.0;
    const transpose = Number(this.currentTransposeSemitones) || 0;
    const rateDiffers = Math.abs(rate - 1.0) > 1e-4;
    const transposeDiffers = Math.abs(transpose) > 1e-4;
    const needsStretch = rateDiffers || transposeDiffers;

    const rateSemitones = rateDiffers ? -12 * Math.log2(rate) : 0;
    const semitones = rateSemitones + transpose;
    const tonalityHz = Number(this.playbackSpeedSettings.tonalityHz) || 8000;
    const formantCompensation = Boolean(this.playbackSpeedSettings.formantCompensation);
    const formantBaseHz = Number(this.playbackSpeedSettings.formantBaseHz) || 500;

    if (this.stretchNode && typeof this.stretchNode.schedule === 'function') {
      try {
        this.stretchNode.schedule({
          active: needsStretch,
          semitones,
          tonalityHz,
          formantCompensation,
          formantBaseHz,
        });
      } catch (err) {
        console.warn('Failed to schedule stretch parameters:', err);
      }
    }
  }

  updateActiveClipRouting() {
    if (!this.audioContext || !this.masterGainNode) return;
    for (const nodes of this.activeSources.values()) {
      if (!nodes?.panNode) continue;
      if (nodes.currentDestination !== this.masterGainNode) {
        try {
          nodes.panNode.disconnect();
        } catch {}
        try {
          nodes.panNode.connect(this.masterGainNode);
          nodes.currentDestination = this.masterGainNode;
        } catch {}
      }
    }
  }

  async setPlaybackRate(rate, project = null, options = {}) {
    const numeric = Number(rate);
    const validRate = Number.isFinite(numeric) && numeric > 0 ? numeric : 1.0;
    const clampedRate = Math.max(0.1, Math.min(10.0, validRate));

    if (Math.abs(this.currentPlaybackRate - clampedRate) < 1e-5 && !options?.forceReschedule) {
      return;
    }

    if (this.isPlaying && this.audioContext) {
      const now = this.audioContext.currentTime;
      const currentTimelineMs = this.timelineMsAtContextTime(now);

      this.currentPlaybackRate = clampedRate;
      this.playbackRateAnchorContextTime = now;
      this.playbackRateAnchorTimelineMs = currentTimelineMs;
      this.startTime = now - (msToSeconds(currentTimelineMs) / clampedRate);

      if (!this.stretchNode && this.needsPitchStretch()) {
        await this.ensureStretchNode();
      }
      this.updateStretchRouting();

      const activeProject = project || this.currentProject;
      if (activeProject) {
        this.currentProject = activeProject;
      }

      const clipsMap = new Map();
      if (activeProject?.tracks) {
        for (const track of activeProject.tracks) {
          for (const clip of track.clips || []) {
            clipsMap.set(this.getClipSourceKey(track.id, clip.id), clip);
          }
        }
      }

      for (const [sourceKey, nodes] of Array.from(this.activeSources.entries())) {
        const source = nodes?.source;
        if (!source) continue;

        if (nodes.timelineStartMs > currentTimelineMs) {
          // Future clip: previous start time on audioContext was scheduled with the old playback rate.
          // Stop old scheduled start and reschedule at the new rate relative to current playback anchor.
          const clip = clipsMap.get(sourceKey) || {
            id: nodes.clipId,
            blobId: nodes.blobId,
            timelineStartMs: nodes.timelineStartMs,
            cropStartMs: nodes.cropStartMs,
            cropEndMs: nodes.cropEndMs,
            gainDb: nodes.clipGainDb,
          };
          this.stopClipSource(nodes, now, 'Failed to reschedule future audio source.', 'audio:reschedule-future-source');
          const schedule = this.getClipSchedule(clip, currentTimelineMs);
          if (schedule) {
            this.startClipSource(sourceKey, nodes, clip, schedule, now, this.playbackRequestId);
          }
        } else {
          // Actively playing clip: update rate smoothly in-flight without stopping
          if (source.playbackRate) {
            try {
              source.playbackRate.setValueAtTime(clampedRate, now);
            } catch {
              source.playbackRate.value = clampedRate;
            }
          }
        }
      }
    } else {
      this.currentPlaybackRate = clampedRate;
      if (project) {
        this.currentProject = project;
      }
      if (this.audioContext) {
        const now = this.audioContext.currentTime;
        this.playbackRateAnchorContextTime = now;
        this.playbackRateAnchorTimelineMs = this.pauseTime;
        this.startTime = now - (msToSeconds(this.pauseTime) / clampedRate);
      }
      if (this.audioContext && this.needsPitchStretch() && !this.stretchNode) {
        void this.ensureStretchNode();
      }
      this.updateStretchRouting();
    }
  }

  /**
   * Play project from current time
   */
  async play(project, currentTimeMs, options = {}) {
    const playbackRequestId = ++this.playbackRequestId;
    this.isInitializingPlayback = true;
    this.initializingPlaybackRequestId = playbackRequestId;
    this.currentPlayOptions = options || {};
    this.currentProject = project;
    this.stopActiveSources('Failed to replace an active audio source.', 'audio:replace-source');

    try {
      if (!this.audioContext) {
        await this.init();
      }
      if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;

      await this.resume();
      if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;

      const rateOption = Number(options?.playbackRate);
      if (Number.isFinite(rateOption) && rateOption > 0) {
        this.currentPlaybackRate = Math.max(0.1, Math.min(10.0, rateOption));
      } else if (options?.resetPlaybackRate) {
        this.currentPlaybackRate = 1.0;
      }

      if (options?.transposeSemitones !== undefined) {
        const transposeOption = Number(options.transposeSemitones);
        if (Number.isFinite(transposeOption)) {
          this.currentTransposeSemitones = Math.max(-12, Math.min(12, transposeOption));
        }
      }

      const useProjectMasterVolume = options?.useProjectMasterVolume !== false;
      if (useProjectMasterVolume) {
        this.currentMasterVolume = Number.isFinite(Number(project?.masterVolume))
          ? Number(project.masterVolume)
          : this.currentMasterVolume;
      }
      this.applyMasterGain();

      if (!this.stretchNode && this.needsPitchStretch()) {
        await this.ensureStretchNode();
      }
      this.updateStretchRouting();

      this.isPlaying = true;
      const at = this.audioContext.currentTime;
      const startMs = Number(currentTimeMs) || 0;
      this.playbackRateAnchorContextTime = at;
      this.playbackRateAnchorTimelineMs = startMs;
      this.startTime = at - (msToSeconds(startMs) / this.currentPlaybackRate);

      this.scheduleProjectClips(project, currentTimeMs, options, playbackRequestId, at, false);
      if (this.isPlaybackRequestCurrent(playbackRequestId)) {
        this.notifyPlaybackStarted({ contextTime: at, timelineMs: startMs });
      }
    } finally {
      if (this.initializingPlaybackRequestId === playbackRequestId) {
        this.isInitializingPlayback = false;
        this.initializingPlaybackRequestId = null;
      }
    }
  }

  /**
   * Seek while keeping mix nodes and output routing. Buffer sources are
   * swapped at one audio-clock time so the jumped-to audio does not overlap
   * itself. Paused seeks only store the new time.
   */
  async seek(project, currentTimeMs, options = {}) {
    const seekMs = Math.max(0, Number(currentTimeMs) || 0);
    if (!this.isPlaying || !this.audioContext) {
      this.pauseTime = seekMs;
      if (this.audioContext) {
        this.playbackRateAnchorContextTime = this.audioContext.currentTime;
        this.playbackRateAnchorTimelineMs = seekMs;
        this.startTime = this.audioContext.currentTime - (msToSeconds(seekMs) / this.currentPlaybackRate);
      }
      return null;
    }

    if (options && Object.keys(options).length > 0) {
      this.currentPlayOptions = options;
    }
    this.currentProject = project || this.currentProject;

    const rateOption = Number(options?.playbackRate);
    if (Number.isFinite(rateOption) && rateOption > 0) {
      this.currentPlaybackRate = Math.max(0.1, Math.min(10.0, rateOption));
    }

    const playbackRequestId = ++this.playbackRequestId;
    this.isInitializingPlayback = false;
    this.initializingPlaybackRequestId = null;

    if (this.audioContext.state !== 'running') {
      await this.resume();
      if (!this.isPlaybackRequestCurrent(playbackRequestId) || !this.isPlaying) {
        this.pauseTime = seekMs;
        return null;
      }
    }

    if (this.needsPitchStretch() && !this.stretchNode) {
      await this.ensureStretchNode();
    }
    this.updateStretchRouting();

    const at = this.audioContext.currentTime;
    this.pauseTime = seekMs;
    this.playbackRateAnchorContextTime = at;
    this.playbackRateAnchorTimelineMs = seekMs;
    this.startTime = at - (msToSeconds(seekMs) / this.currentPlaybackRate);

    this.stopActiveBufferSources(at, 'Failed to pause sources for seek.', 'audio:seek-stop-source');
    this.scheduleProjectClips(project, seekMs, options, playbackRequestId, at, true);
    // The audio-clock instant at which playback jumped. Recording uses this
    // to split a take exactly where the loop wrapped.
    return { contextTime: at, timelineMs: seekMs };
  }

  /**
   * Audio-clock time in seconds (the clock buffer sources are scheduled on).
   */
  getContextTime() {
    return this.audioContext ? this.audioContext.currentTime : 0;
  }

  /**
   * Timeline position (ms) that was playing at a given audio-clock time.
   * Only meaningful while playing; falls back to the paused position.
   */
  timelineMsAtContextTime(contextTime) {
    if (!this.isPlaying || !this.audioContext) return this.pauseTime;
    const rate = this.currentPlaybackRate || 1.0;
    const anchorContext = Number.isFinite(this.playbackRateAnchorContextTime)
      ? this.playbackRateAnchorContextTime
      : this.startTime;
    const anchorTimeline = Number.isFinite(this.playbackRateAnchorTimelineMs)
      ? this.playbackRateAnchorTimelineMs
      : (anchorContext - this.startTime) * 1000;
    const deltaSec = Number(contextTime) - anchorContext;
    return anchorTimeline + (deltaSec * rate * 1000);
  }

  /**
   * Snapshot of the transport read from a single audio-clock sample so the
   * context time and timeline position describe the same instant.
   */
  getTransportPosition() {
    const contextTime = this.getContextTime();
    return {
      contextTime,
      timelineMs: this.timelineMsAtContextTime(contextTime),
      isPlaying: this.isPlaying,
    };
  }

  subscribePlaybackStarted(listener) {
    if (typeof listener !== 'function') return () => {};
    this.playbackStartedListeners.add(listener);
    return () => {
      this.playbackStartedListeners.delete(listener);
    };
  }

  /**
   * Resolve with `{ contextTime, timelineMs }` the next time play() schedules
   * audio. Used to arm recording on the exact instant playback starts.
   */
  waitForPlaybackStart(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      const unsubscribe = this.subscribePlaybackStarted((event) => {
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();
        resolve(event);
      });
      timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for playback to start.'));
      }, timeoutMs);
    });
  }

  notifyPlaybackStarted(event) {
    for (const listener of Array.from(this.playbackStartedListeners)) {
      try {
        listener(event);
      } catch (error) {
        console.warn('Playback start listener failed:', error);
      }
    }
  }

  /**
   * Node to feed test signals into so they travel the same output path as
   * project playback (limiter, ceiling, selected sink) without depending on
   * the project master volume.
   */
  getCalibrationInputNode() {
    return this.masterLimiterNode || this.masterCeilingNode || this.masterGainNode;
  }

  getClipSourceKey(trackId, clipId) {
    return `${trackId}-${clipId}`;
  }

  getClipSchedule(clip, timeMs) {
    if (clip?.muted) return null;
    const startMs = Number(clip?.timelineStartMs) || 0;
    const cropStartMs = Number(clip?.cropStartMs) || 0;
    const durationMs = Math.max(0, (Number(clip?.cropEndMs) || 0) - cropStartMs);
    if (durationMs <= 0) return null;
    const endMs = startMs + durationMs;
    if (endMs < timeMs) return null;
    const elapsedMs = Math.max(0, timeMs - startMs);
    const remainingMs = durationMs - elapsedMs;
    if (remainingMs <= 0) return null;
    const rate = this.currentPlaybackRate || 1.0;
    return {
      whenOffsetSec: msToSeconds(Math.max(0, startMs - timeMs)) / rate,
      offsetSec: msToSeconds(cropStartMs + elapsedMs),
      durationSec: msToSeconds(remainingMs),
    };
  }

  createClipMixNodes(track, clip, effectiveState) {
    const gainNode = this.audioContext.createGain();
    const panNode = this.audioContext.createStereoPanner();
    const nodes = {
      clipId: clip?.id,
      trackId: track?.id,
      clipGainDb: Number(clip?.gainDb) || 0,
      timelineStartMs: Number(clip?.timelineStartMs) || 0,
      cropStartMs: Number(clip?.cropStartMs) || 0,
      cropEndMs: Number(clip?.cropEndMs) || 0,
      blobId: clip?.blobId,
      source: null,
      gainNode,
      panNode,
      baseGain: Number.isFinite(effectiveState?.effectiveGain)
        ? effectiveState.effectiveGain
        : volumeToGain(track?.volume),
      clipGain: Math.pow(10, (Number(clip?.gainDb) || 0) / 20),
      effectivePan: Number.isFinite(effectiveState?.effectivePan)
        ? effectiveState.effectivePan
        : (track?.pan != null ? track.pan : 0),
    };
    this.applyNodeMix(nodes);
    gainNode.connect(panNode);

    panNode.connect(this.masterGainNode);
    nodes.currentDestination = this.masterGainNode;
    return nodes;
  }

  stopClipSource(nodes, when, errorMessage, onceKey) {
    const source = nodes?.source;
    if (!source) return;
    nodes.source = null;
    source.onended = null;
    try {
      if (Number.isFinite(when)) source.stop(when);
      else source.stop();
    } catch (error) {
      if (error?.name !== 'InvalidStateError') {
        reportUserError(errorMessage || 'Failed to stop an audio source.', error, {
          onceKey: onceKey || 'audio:stop-source',
        });
      }
    }
    try {
      source.disconnect();
    } catch {
      // Source may already be disconnected.
    }
  }

  disposeClipNodes(nodes, when, errorMessage, onceKey) {
    this.stopClipSource(nodes, when, errorMessage, onceKey);
    try {
      nodes?.gainNode?.disconnect();
    } catch {
      // Mix node may already be disconnected.
    }
    try {
      nodes?.panNode?.disconnect();
    } catch {
      // Mix node may already be disconnected.
    }
  }

  stopActiveBufferSources(when, errorMessage, onceKey) {
    for (const nodes of this.activeSources.values()) {
      this.stopClipSource(nodes, when, errorMessage, onceKey);
    }
  }

  startClipSource(sourceKey, nodes, clip, schedule, at, playbackRequestId) {
    const audioBuffer = this.mediaCache.get(clip.blobId);
    if (!audioBuffer) {
      console.warn(`Audio buffer not loaded for clip ${clip.id}`);
      return false;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    if (source.playbackRate) {
      try {
        source.playbackRate.value = this.currentPlaybackRate || 1.0;
      } catch {}
    }
    source.connect(nodes.gainNode);
    const when = at + schedule.whenOffsetSec;
    const maxOffset = Math.max(0, (audioBuffer?.duration || 0) - 0.001);
    const safeOffset = Math.min(schedule.offsetSec, maxOffset);
    const safeDuration = Math.min(schedule.durationSec, Math.max(0, (audioBuffer?.duration || 0) - safeOffset));
    if (safeDuration <= 0) return false;
    source.start(when, safeOffset, safeDuration);
    source.onended = () => {
      const current = this.activeSources.get(sourceKey);
      if (current && current.source === source) {
        this.disposeClipNodes(current);
        this.activeSources.delete(sourceKey);
      }
    };

    if (!this.isPlaybackRequestCurrent(playbackRequestId)) {
      this.stopClipSource({ source }, when, 'Failed to stop a superseded audio source.', 'audio:superseded-source');
      return false;
    }

    nodes.source = source;
    return true;
  }

  scheduleProjectClips(project, timeMs, options, playbackRequestId, at, reuseMixNodes) {
    const mix = getEffectiveTrackMix(project);
    const liveMixableTrackIds = options?.liveMixableTrackIds
      ? new Set(options.liveMixableTrackIds)
      : null;
    const neededKeys = new Set();

    for (const track of project?.tracks || []) {
      if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;
      const effectiveState = getPlaybackTrackState(
        track,
        mix.statesByTrackId.get(track.id),
        liveMixableTrackIds
      );
      if (effectiveState?.schedule === false) continue;

      for (const clip of track.clips || []) {
        if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;
        const schedule = this.getClipSchedule(clip, timeMs);
        if (!schedule) continue;

        const sourceKey = this.getClipSourceKey(track.id, clip.id);
        neededKeys.add(sourceKey);
        let nodes = reuseMixNodes ? this.activeSources.get(sourceKey) : null;
        if (!nodes?.gainNode || !nodes?.panNode) {
          nodes = this.createClipMixNodes(track, clip, effectiveState);
        } else {
          nodes.clipId = clip.id;
          nodes.trackId = track.id;
          nodes.clipGainDb = Number(clip?.gainDb) || 0;
          nodes.timelineStartMs = Number(clip?.timelineStartMs) || 0;
          nodes.cropStartMs = Number(clip?.cropStartMs) || 0;
          nodes.cropEndMs = Number(clip?.cropEndMs) || 0;
          nodes.blobId = clip.blobId;
          nodes.baseGain = Number.isFinite(effectiveState?.effectiveGain)
            ? effectiveState.effectiveGain
            : volumeToGain(track?.volume);
          nodes.clipGain = Math.pow(10, (Number(clip?.gainDb) || 0) / 20);
          nodes.effectivePan = Number.isFinite(effectiveState?.effectivePan)
            ? effectiveState.effectivePan
            : (track?.pan != null ? track.pan : 0);
          this.applyNodeMix(nodes);

          if (nodes.currentDestination !== this.masterGainNode) {
            try {
              nodes.panNode.disconnect();
            } catch {}
            try {
              nodes.panNode.connect(this.masterGainNode);
              nodes.currentDestination = this.masterGainNode;
            } catch {}
          }
        }
        this.activeSources.set(sourceKey, nodes);
        if (!this.startClipSource(sourceKey, nodes, clip, schedule, at, playbackRequestId)) {
          this.disposeClipNodes(nodes, at, 'Failed to stop a superseded audio source.', 'audio:superseded-source');
          this.activeSources.delete(sourceKey);
          neededKeys.delete(sourceKey);
        }
      }
    }

    if (!reuseMixNodes) return;
    for (const [sourceKey, nodes] of Array.from(this.activeSources.entries())) {
      if (neededKeys.has(sourceKey)) continue;
      this.disposeClipNodes(nodes, at, 'Failed to discard an unused audio source.', 'audio:seek-discard-source');
      this.activeSources.delete(sourceKey);
    }
  }

  /**
   * Update clip gain in real-time without restarting playback
   */
  updateClipGain(trackId, clipId, gainDb) {
    const db = Number(gainDb) || 0;
    if (trackId && clipId) {
      const sourceKey = this.getClipSourceKey(trackId, clipId);
      const nodes = this.activeSources.get(sourceKey);
      if (nodes) {
        nodes.clipGainDb = db;
        nodes.clipGain = Math.pow(10, db / 20);
        this.applyNodeMix(nodes);
        return;
      }
    }
    const targetClipId = clipId || trackId;
    for (const [sourceKey, nodes] of this.activeSources.entries()) {
      if (nodes.clipId === targetClipId || sourceKey.endsWith(`-${targetClipId}`)) {
        nodes.clipGainDb = db;
        nodes.clipGain = Math.pow(10, db / 20);
        this.applyNodeMix(nodes);
      }
    }
  }

  /**
   * Synchronize active playback sources and mix nodes with the current project snapshot.
   * Handles clip gain changes without restarting playback, stops muted/deleted clips,
   * schedules unmuted/added clips, and reschedules retimed/cropped clips.
   */
  syncProjectClips(project, options = {}) {
    if (!this.isPlaying || this.isInitializingPlayback || !this.audioContext) return;

    if (!project?.tracks?.length) {
      this.stopActiveSources('Failed to stop sources for empty project.', 'audio:sync-empty');
      return;
    }

    const at = this.audioContext.currentTime;
    const timeMs = Math.max(0, this.timelineMsAtContextTime(at));
    this.currentProject = project || this.currentProject;
    const mix = getEffectiveTrackMix(project);
    const effectiveOptions = options && Object.keys(options).length > 0
      ? options
      : (this.currentPlayOptions || {});
    const liveMixableTrackIds = effectiveOptions?.liveMixableTrackIds
      ? (effectiveOptions.liveMixableTrackIds instanceof Set
        ? effectiveOptions.liveMixableTrackIds
        : new Set(effectiveOptions.liveMixableTrackIds))
      : null;

    const neededKeys = new Set();

    for (const track of project.tracks) {
      const effectiveState = getPlaybackTrackState(
        track,
        mix.statesByTrackId.get(track.id),
        liveMixableTrackIds
      );
      if (effectiveState?.schedule === false) {
        continue;
      }

      for (const clip of track.clips || []) {
        const sourceKey = this.getClipSourceKey(track.id, clip.id);
        const existingNodes = this.activeSources.get(sourceKey);

        if (clip.muted) {
          if (existingNodes) {
            this.disposeClipNodes(existingNodes, at, 'Failed to stop muted clip.', 'audio:mute-clip');
            this.activeSources.delete(sourceKey);
          }
          continue;
        }

        const schedule = this.getClipSchedule(clip, timeMs);
        if (!schedule) {
          if (existingNodes) {
            this.disposeClipNodes(existingNodes, at, 'Failed to stop ended clip.', 'audio:ended-clip');
            this.activeSources.delete(sourceKey);
          }
          continue;
        }

        const clipTimelineStartMs = Number(clip.timelineStartMs) || 0;
        const clipCropStartMs = Number(clip.cropStartMs) || 0;
        const clipCropEndMs = Number(clip.cropEndMs) || 0;
        const clipGainDb = Number(clip.gainDb) || 0;
        const clipBlobId = clip.blobId;

        const baseGain = Number.isFinite(effectiveState?.effectiveGain)
          ? effectiveState.effectiveGain
          : volumeToGain(track?.volume);
        const effectivePan = Number.isFinite(effectiveState?.effectivePan)
          ? effectiveState.effectivePan
          : (track?.pan != null ? track.pan : 0);

        if (existingNodes && existingNodes.source) {
          const timingChanged =
            existingNodes.timelineStartMs !== clipTimelineStartMs ||
            existingNodes.cropStartMs !== clipCropStartMs ||
            existingNodes.cropEndMs !== clipCropEndMs ||
            existingNodes.blobId !== clipBlobId;

          if (!timingChanged) {
            existingNodes.clipGainDb = clipGainDb;
            existingNodes.clipGain = Math.pow(10, clipGainDb / 20);
            existingNodes.baseGain = baseGain;
            existingNodes.effectivePan = effectivePan;
            this.applyNodeMix(existingNodes);
            neededKeys.add(sourceKey);
            continue;
          }

          this.stopClipSource(existingNodes, at, 'Failed to stop retimed clip.', 'audio:retime-clip');
        }

        let nodes = existingNodes;
        if (!nodes?.gainNode || !nodes?.panNode) {
          nodes = this.createClipMixNodes(track, clip, effectiveState);
        } else {
          nodes.clipId = clip.id;
          nodes.trackId = track.id;
          nodes.clipGainDb = clipGainDb;
          nodes.timelineStartMs = clipTimelineStartMs;
          nodes.cropStartMs = clipCropStartMs;
          nodes.cropEndMs = clipCropEndMs;
          nodes.blobId = clipBlobId;
          nodes.baseGain = baseGain;
          nodes.clipGain = Math.pow(10, clipGainDb / 20);
          nodes.effectivePan = effectivePan;
          this.applyNodeMix(nodes);
        }

        this.activeSources.set(sourceKey, nodes);
        if (this.startClipSource(sourceKey, nodes, clip, schedule, at, this.playbackRequestId)) {
          neededKeys.add(sourceKey);
        } else {
          this.disposeClipNodes(nodes, at, 'Failed to start clip source.', 'audio:sync-clip-source');
          this.activeSources.delete(sourceKey);
        }
      }
    }

    for (const [sourceKey, nodes] of Array.from(this.activeSources.entries())) {
      if (neededKeys.has(sourceKey)) continue;
      this.disposeClipNodes(nodes, at, 'Failed to discard removed audio source.', 'audio:sync-discard-source');
      this.activeSources.delete(sourceKey);
    }
  }

  /**
   * Stop playback
   */
  stop() {
    this.playbackRequestId += 1;
    this.isPlaying = false;
    this.pauseTime = 0;
    this.playbackRateAnchorContextTime = 0;
    this.playbackRateAnchorTimelineMs = 0;
    this.isInitializingPlayback = false;
    this.initializingPlaybackRequestId = null;
    this.currentPlayOptions = null;
    this.currentProject = null;
    this.stopActiveSources('Failed to stop an active audio source.', 'audio:stop-source');
    if (this.stretchNode && typeof this.stretchNode.schedule === 'function') {
      try {
        this.stretchNode.schedule({ active: false });
      } catch {}
    }
    for (const trackNode of this.trackStretchNodes.values()) {
      if (trackNode && typeof trackNode.schedule === 'function') {
        try {
          trackNode.schedule({ active: false });
        } catch {}
      }
    }
  }

  stopActiveSources(errorMessage, onceKey) {
    const when = this.audioContext?.currentTime;
    for (const nodes of this.activeSources.values()) {
      this.disposeClipNodes(nodes, when, errorMessage, onceKey);
    }
    this.activeSources.clear();
  }

  isPlaybackRequestCurrent(playbackRequestId) {
    return this.playbackRequestId === playbackRequestId;
  }

  /**
   * Pause playback
   */
  async pause(currentTimeMs) {
    this.playbackRequestId += 1;
    this.isPlaying = false;
    this.pauseTime = typeof currentTimeMs === 'number' ? currentTimeMs : this.getCurrentTime();
    this.isInitializingPlayback = false;
    this.initializingPlaybackRequestId = null;
    this.currentPlayOptions = null;
    this.stopActiveSources('Failed to pause an active audio source.', 'audio:pause-source');
    if (this.stretchNode && typeof this.stretchNode.schedule === 'function') {
      try {
        this.stretchNode.schedule({ active: false });
      } catch {}
    }
    for (const trackNode of this.trackStretchNodes.values()) {
      if (trackNode && typeof trackNode.schedule === 'function') {
        try {
          trackNode.schedule({ active: false });
        } catch {}
      }
    }
  }


  /**
   * Set master volume
   */
  setMasterVolume(volume) {
    const parsed = Number(volume);
    if (Number.isFinite(parsed)) {
      this.currentMasterVolume = Math.max(0, Math.min(100, parsed));
    }
    this.applyMasterGain();
  }

  /**
   * Set the local listening/output volume without changing the project mix
   * master. Player mode uses this in addition to the stored project master.
   */
  setOutputVolume(volume) {
    const parsed = Number(volume);
    if (Number.isFinite(parsed)) {
      this.currentOutputVolume = Math.max(0, Math.min(100, parsed));
    }
    this.applyMasterGain();
  }

  setMasterVolumeCurve(curve) {
    this.masterVolumeCurve = curve === 'unity' ? 'unity' : 'legacy';
    this.applyMasterGain();
  }

  setMasterHeadroomEnabled(enabled) {
    this.masterHeadroomEnabled = enabled !== false;
    this.applyMasterGain();
  }

  setPanLawDb(panLawDb) {
    this.currentPanLawDb = normalizePanLawDb(panLawDb);
    this.applyMasterGain();

    for (const nodes of this.activeSources.values()) {
      this.applyNodeMix(nodes);
    }
  }

  async setPlaybackOutputConfig({ outputDeviceId = '', outputChannelCount = 2, forceMonoOutput = false, panLawDb = this.currentPanLawDb } = {}) {
    this.currentOutputDeviceId = String(outputDeviceId || '');
    this.currentOutputChannelCount = Number.isFinite(Number(outputChannelCount))
      ? Number(outputChannelCount)
      : this.currentOutputChannelCount;
    this.forceMonoOutput = forceMonoOutput === true;
    this.currentPanLawDb = normalizePanLawDb(panLawDb);

    if (this.audioContext) {
      await this.configureOutputRouting();
    }
    this.applyMasterGain();

    for (const nodes of this.activeSources.values()) {
      this.applyNodeMix(nodes);
    }
  }

  /**
   * Update track volume in real-time
   */
  updateTrackVolume(trackId, volume) {
    const gain = volumeToGain(volume);
    for (const [sourceKey, nodes] of this.activeSources.entries()) {
      if (sourceKey === trackId || sourceKey.startsWith(`${trackId}-`)) {
        nodes.baseGain = gain;
        nodes.gainNode.gain.value = this.getClipOutputGain(
          nodes.baseGain,
          nodes.clipGain,
          nodes.effectivePan
        );
      }
    }
  }

  /**
   * Update track pan in real-time
   */
  updateTrackPan(trackId, pan) {
    for (const [sourceKey, nodes] of this.activeSources.entries()) {
      if (sourceKey === trackId || sourceKey.startsWith(`${trackId}-`)) {
        nodes.effectivePan = pan;
        this.applyNodeMix(nodes);
      }
    }
  }

  /**
   * Update effective track mix (inherited gain/pan) in real-time
   */
  updateTrackMix(trackId, effectiveGain, effectivePan) {
    for (const [sourceKey, nodes] of this.activeSources.entries()) {
      if (sourceKey === trackId || sourceKey.startsWith(`${trackId}-`)) {
        if (Number.isFinite(effectiveGain)) {
          nodes.baseGain = effectiveGain;
        }
        if (Number.isFinite(effectivePan)) {
          nodes.effectivePan = effectivePan;
        }
        this.applyNodeMix(nodes);
      }
    }
  }

  /**
   * Get current playback time
   */
  getCurrentTime() {
    if (!this.isPlaying || !this.audioContext) return this.pauseTime;
    return this.timelineMsAtContextTime(this.audioContext.currentTime);
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.stop();
    this.detachHardwareLifecycleListeners();

    if (this.stretchNode) {
      try {
        this.stretchNode.disconnect();
      } catch {}
      this.stretchNode = null;
    }
    for (const trackNode of this.trackStretchNodes.values()) {
      try {
        trackNode.disconnect();
      } catch {}
    }
    this.trackStretchNodes.clear();
    this.stretchNodePromise = null;
    this.isStretchConnected = false;

    if (this.outputRoutingElement) {
      try {
        this.outputRoutingElement.pause();
      } catch {
        // Ignore teardown failures for the hidden routing element.
      }
      try {
        this.outputRoutingElement.srcObject = null;
      } catch {
        // Ignore srcObject cleanup failures.
      }
      this.outputRoutingElement = null;
    }
    this.outputStreamDestination = null;
    this.outputTargetNode = null;
    this.outputClockPrimed = false;
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.masterLimiterNode = null;
    this.masterCeilingNode = null;
    this.masterOutputNode = null;
    this.masterSafetyInputNode = null;
    this.currentOutputVolume = 100;

    this.mediaCache.clear();
    this.activeSources.clear();
  }

  getMasterOutputGain() {
    const outputGain = this.getOutputVolumeGain();
    if (this.isMonoOutput()) {
      return this.getMasterVolumeGain() * outputGain;
    }
    const headroomGain = this.masterHeadroomEnabled
      ? getPanLawHeadroomGain(this.currentPanLawDb)
      : 1;
    return this.getMasterVolumeGain() * headroomGain * outputGain;
  }

  getMasterVolumeGain() {
    const clamped = Math.max(0, Math.min(100, Number(this.currentMasterVolume) || 0));
    if (clamped <= 0) return 0;
    if (this.masterVolumeCurve === 'unity') {
      return clamped / 100;
    }
    return volumeToGain(clamped);
  }

  getOutputVolumeGain() {
    const clamped = Math.max(0, Math.min(100, Number(this.currentOutputVolume) || 0));
    return clamped / 100;
  }

  applyMasterGain() {
    if (!this.masterGainNode) return;
    this.masterGainNode.channelCount = this.getTargetOutputChannelCount();
    this.masterGainNode.gain.value = this.getMasterOutputGain();
  }

  createMasterSafetyStage() {
    if (!this.audioContext || !this.masterGainNode) return;

    let limiter = null;
    if (typeof this.audioContext.createDynamicsCompressor === 'function') {
      try {
        limiter = this.audioContext.createDynamicsCompressor();
        limiter.threshold.value = MASTER_LIMITER_THRESHOLD_DB;
        limiter.knee.value = MASTER_LIMITER_KNEE_DB;
        limiter.ratio.value = MASTER_LIMITER_RATIO;
        limiter.attack.value = MASTER_LIMITER_ATTACK_SEC;
        limiter.release.value = MASTER_LIMITER_RELEASE_SEC;
        this.masterLimiterNode = limiter;
      } catch {
        this.masterLimiterNode = null;
      }
    }

    let ceiling = null;
    if (typeof this.audioContext.createWaveShaper === 'function') {
      try {
        ceiling = this.audioContext.createWaveShaper();
        ceiling.curve = createMasterCeilingCurve();
        ceiling.oversample = '4x';
        this.masterCeilingNode = ceiling;
      } catch {
        this.masterCeilingNode = null;
      }
    }

    if (limiter && ceiling) {
      try {
        limiter.connect(ceiling);
      } catch {}
    }

    this.masterSafetyInputNode = limiter || ceiling || null;
    this.masterOutputNode = ceiling || limiter || this.masterGainNode;

    this.wireMasterAudioGraph();
    this.updateStretchRouting();
  }

  getMasterOutputNode() {
    return this.masterOutputNode || this.masterGainNode;
  }

  getClipOutputGain(baseGain, clipGain, pan) {
    if (this.isMonoOutput()) {
      return baseGain * clipGain;
    }
    const panCompensation = getPanLawCompensationGain(pan, this.currentPanLawDb);
    return baseGain * clipGain * panCompensation;
  }

  getTargetOutputChannelCount() {
    return this.isMonoOutput() ? 1 : 2;
  }

  isMonoOutput() {
    return this.forceMonoOutput === true || Number(this.currentOutputChannelCount) <= 1;
  }

  getEffectiveOutputPan(pan) {
    if (this.isMonoOutput()) return 0;
    return Math.max(-100, Math.min(100, Number(pan) || 0));
  }

  applyNodeMix(nodes) {
    if (!nodes?.panNode || !nodes?.gainNode) return;
    nodes.panNode.pan.value = this.getEffectiveOutputPan(nodes.effectivePan) / 100;
    nodes.gainNode.gain.value = this.getClipOutputGain(
      nodes.baseGain,
      nodes.clipGain,
      nodes.effectivePan
    );
  }

  subscribePlaybackInterrupted(listener) {
    if (typeof listener !== 'function') return () => {};
    this.playbackInterruptedListeners.add(listener);
    return () => this.playbackInterruptedListeners.delete(listener);
  }

  attachHardwareLifecycleListeners() {
    if (!this.audioContext || this.hardwareLifecycleAttached) return;
    this.hardwareLifecycleAttached = true;
    this.boundContextStateChange = () => this.handleAudioContextStateChange();
    this.boundContextSinkChange = () => this.handleAudioContextSinkChange();
    this.boundDeviceChange = () => {
      void this.handleOutputDeviceChange();
    };

    if (typeof this.audioContext.addEventListener === 'function') {
      this.addAudioContextEventListener('statechange', this.boundContextStateChange);
      this.addAudioContextEventListener('sinkchange', this.boundContextSinkChange);
    } else {
      this.audioContext.onstatechange = this.boundContextStateChange;
    }

    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (mediaDevices) {
      if (typeof mediaDevices.addEventListener === 'function') {
        mediaDevices.addEventListener('devicechange', this.boundDeviceChange);
      } else {
        mediaDevices.ondevicechange = this.boundDeviceChange;
      }
    }
  }

  addAudioContextEventListener(type, handler) {
    if (typeof this.audioContext?.addEventListener === 'function') {
      this.audioContext.addEventListener(type, handler);
    }
  }

  removeAudioContextEventListener(type, handler) {
    if (typeof this.audioContext?.removeEventListener === 'function') {
      this.audioContext.removeEventListener(type, handler);
    }
  }

  detachHardwareLifecycleListeners() {
    if (!this.hardwareLifecycleAttached) return;

    this.removeAudioContextEventListener('statechange', this.boundContextStateChange);
    this.removeAudioContextEventListener('sinkchange', this.boundContextSinkChange);
    if (this.audioContext && this.audioContext.onstatechange === this.boundContextStateChange) {
      this.audioContext.onstatechange = null;
    }

    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (mediaDevices?.removeEventListener && this.boundDeviceChange) {
      mediaDevices.removeEventListener('devicechange', this.boundDeviceChange);
    } else if (mediaDevices && mediaDevices.ondevicechange === this.boundDeviceChange) {
      mediaDevices.ondevicechange = null;
    }

    this.hardwareLifecycleAttached = false;
    this.boundContextStateChange = null;
    this.boundContextSinkChange = null;
    this.boundDeviceChange = null;
  }

  handleAudioContextStateChange() {
    const state = this.audioContext?.state;
    if (state === 'suspended' || state === 'interrupted') {
      this.handlePlaybackInterrupted(`context-${state}`);
    }
  }

  handleAudioContextSinkChange() {
    if (this.isConfiguringOutput || !this.isPlaying) return;
    const selected = String(this.currentOutputDeviceId || '');
    if (isDefaultAudioOutputDeviceId(selected)) return;
    const sinkId = String(this.audioContext?.sinkId || '');
    if (sinkId !== selected) {
      this.handlePlaybackInterrupted('sink-changed');
    }
  }

  async handleOutputDeviceChange({ primeOnly = false } = {}) {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;

    try {
      const devices = await mediaDevices.enumerateDevices();
      const currentIds = collectAudioOutputDeviceIds(devices);
      if (
        !primeOnly
        && shouldAutoPauseForOutputDeviceChange({
          isPlaying: this.isPlaying,
          selectedDeviceId: this.currentOutputDeviceId,
          previousDeviceIds: this.previousOutputDeviceIds,
          currentDeviceIds: currentIds,
        })
      ) {
        this.handlePlaybackInterrupted('output-device-removed');
      }
      this.previousOutputDeviceIds = currentIds;
    } catch (error) {
      console.warn('Failed to enumerate audio devices:', error);
    }
  }

  handlePlaybackInterrupted(reason = 'interrupted') {
    if (!this.isPlaying) return;
    const timeMs = this.getCurrentTime();
    const safeTimeMs = Number.isFinite(Number(timeMs)) ? Number(timeMs) : (Number(this.pauseTime) || 0);
    void this.pause(safeTimeMs);
    console.info('Playback paused after audio output interruption.', reason);
    for (const listener of this.playbackInterruptedListeners) {
      try {
        listener({ reason, timeMs: safeTimeMs });
      } catch (error) {
        console.warn('Playback interruption listener failed:', error);
      }
    }
  }

  async configureOutputRouting() {
    if (!this.audioContext || !this.masterGainNode) return;

    this.disconnectMasterOutput();

    this.isConfiguringOutput = true;
    let contextSinkApplied = false;
    try {
      contextSinkApplied = await applySinkIdToAudioContext(
        this.audioContext,
        this.currentOutputDeviceId
      );
    } finally {
      this.isConfiguringOutput = false;
    }

    const sinkFailedWhilePlaying = (
      this.isPlaying
      && !isDefaultAudioOutputDeviceId(this.currentOutputDeviceId)
      && typeof this.audioContext.setSinkId === 'function'
      && !contextSinkApplied
    );
    if (sinkFailedWhilePlaying) {
      this.handlePlaybackInterrupted('sink-unavailable');
    }

    const useMediaElementRoute = !sinkFailedWhilePlaying && shouldRoutePlaybackThroughMediaElement({
      outputDeviceId: this.currentOutputDeviceId,
      audioContextSinkApplied: contextSinkApplied,
    });

    if (useMediaElementRoute) {
      const routedTarget = await this.ensureOutputRoutingTarget();
      if (routedTarget) {
        this.outputTargetNode = routedTarget;
        this.getMasterOutputNode().connect(this.outputTargetNode);
        return;
      }
    }

    this.connectMasterToDestination();
    this.pauseOutputRoutingElement();
  }

  disconnectMasterOutput() {
    const outputNode = this.getMasterOutputNode();
    if (!outputNode) return;
    if (this.outputTargetNode) {
      try {
        outputNode.disconnect(this.outputTargetNode);
      } catch {
        // Ignore reconnect noise when the previous route is already gone.
      }
      return;
    }
    try {
      outputNode.disconnect();
    } catch {
      // Ignore initial disconnect attempts before anything is connected.
    }
  }

  connectMasterToDestination() {
    this.applyOutputChannelConfig();
    this.outputTargetNode = this.audioContext.destination;
    this.getMasterOutputNode().connect(this.outputTargetNode);
  }

  pauseOutputRoutingElement() {
    if (!this.outputRoutingElement) return;
    try {
      this.outputRoutingElement.pause();
    } catch {
      // Ignore pause failures on the hidden routing element.
    }
  }

  primeSilentOutput() {
    if (!this.audioContext || !this.masterGainNode || this.outputClockPrimed) return;
    try {
      const silence = this.audioContext.createBuffer(1, 1, this.audioContext.sampleRate);
      const source = this.audioContext.createBufferSource();
      const mute = this.audioContext.createGain();
      mute.gain.value = 0;
      source.buffer = silence;
      source.connect(mute);
      mute.connect(this.masterGainNode);
      source.start(0);
      this.outputClockPrimed = true;
    } catch {
      // Hardware warmup is best-effort and must not block playback.
    }
  }

  applyOutputChannelConfig() {
    if (!this.audioContext?.destination) return;
    const destination = this.audioContext.destination;
    try {
      destination.channelCountMode = 'explicit';
      destination.channelInterpretation = 'speakers';
      const maxChannelCount = Math.max(1, Number(destination.maxChannelCount) || 2);
      destination.channelCount = Math.min(this.getTargetOutputChannelCount(), maxChannelCount);
    } catch {
      // Some browsers lock destination channel configuration.
    }
  }

  async ensureOutputRoutingTarget() {
    if (!this.audioContext) return null;

    try {
      if (!this.outputStreamDestination) {
        this.outputStreamDestination = this.audioContext.createMediaStreamDestination();
      }

      if (!this.outputRoutingElement) {
        const element = new Audio();
        element.autoplay = true;
        element.preload = 'auto';
        element.srcObject = this.outputStreamDestination.stream;
        this.outputRoutingElement = element;
      } else if (this.outputRoutingElement.srcObject !== this.outputStreamDestination.stream) {
        this.outputRoutingElement.srcObject = this.outputStreamDestination.stream;
      }

      await applySinkIdToMediaElement(this.outputRoutingElement, this.currentOutputDeviceId);
      await this.resumeOutputRoutingElement();

      return this.outputStreamDestination;
    } catch (error) {
      reportUserError(
        'Failed to route live playback to the selected output device. Playback will continue on the default output.',
        error,
        { onceKey: `audio:stream-route:${this.currentOutputDeviceId || 'default'}` }
      );
      return null;
    }
  }

  async resumeOutputRoutingElement() {
    if (!this.outputRoutingElement) return;
    try {
      await this.outputRoutingElement.play();
    } catch {
      // Ignore autoplay-related routing element failures.
    }
  }
}

export function getPlaybackTrackState(track, mixState, liveMixableTrackIds = null) {
  const mixable = !(liveMixableTrackIds instanceof Set) || liveMixableTrackIds.has(track?.id);
  if (!mixable) {
    return {
      schedule: false,
      audible: false,
      effectiveGain: 0,
      effectivePan: Number.isFinite(mixState?.effectivePan) ? mixState.effectivePan : 0,
    };
  }

  const audible = mixState?.audible === true;
  return {
    schedule: true,
    audible,
    effectiveGain: audible && Number.isFinite(mixState?.effectiveGain)
      ? mixState.effectiveGain
      : 0,
    effectivePan: Number.isFinite(mixState?.effectivePan) ? mixState.effectivePan : 0,
  };
}

// Singleton instance
export const audioManager = new AudioManager();
