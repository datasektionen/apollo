import {
  volumeToGain,
  msToSeconds,
  normalizePanLawDb,
  getPanLawCompensationGain,
  getPanLawHeadroomGain,
} from '../utils/audio';
import { SAMPLE_RATE } from '../types/project';
import { getEffectiveTrackMix } from '../utils/trackTree';
import { isMetronomeRole } from '../utils/trackRoles';
import { reportUserError } from '../utils/errorReporter';
import { applySinkIdToMediaElement } from '../utils/playbackOutput';
import { audioBufferToLocalWavBlob } from './mediaEncoding';

/**
 * Audio Manager
 * Handles Web Audio API playback, mixing, and rendering
 */
export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.masterGainNode = null;
    this.mediaCache = new Map(); // blobId -> AudioBuffer
    this.activeSources = new Map(); // trackId -> { source, gainNode, panNode }
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.isInitializingPlayback = false; // Flag to prevent concurrent play() calls
    this.playbackRequestId = 0;
    this.initializingPlaybackRequestId = null;
    this.currentMasterVolume = 100;
    this.currentPanLawDb = normalizePanLawDb();
    this.currentOutputDeviceId = '';
    this.currentOutputChannelCount = 2;
    this.forceMonoOutput = false;
    this.masterVolumeCurve = 'legacy';
    this.masterHeadroomEnabled = true;
    this.outputStreamDestination = null;
    this.outputRoutingElement = null;
    this.outputTargetNode = null;
  }

  /**
   * Initialize Audio Context (must be called after user interaction)
   */
  async init() {
    if (this.audioContext) return;

    this.audioContext = new AudioContext({
      sampleRate: SAMPLE_RATE,
    });

    // Create master gain node
    this.masterGainNode = this.audioContext.createGain();
    this.masterGainNode.channelCountMode = 'explicit';
    this.masterGainNode.channelInterpretation = 'speakers';
    this.masterGainNode.channelCount = this.getTargetOutputChannelCount();
    this.masterGainNode.gain.value = this.getMasterOutputGain();
    await this.configureOutputRouting();
    
    console.log('AudioManager initialized', {
      sampleRate: this.audioContext.sampleRate,
      state: this.audioContext.state,
    });
  }

  /**
   * Ensure audio context is running (handle browser autoplay policies)
   */
  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    await this.resumeOutputRoutingElement();
  }

  /**
   * Decode audio file to AudioBuffer
   */
  async decodeAudioFile(arrayBuffer) {
    if (!this.audioContext) {
      await this.init();
    }

    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    
    // Resample to 44.1kHz if needed
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      console.log(`Resampling from ${audioBuffer.sampleRate}Hz to ${SAMPLE_RATE}Hz`);
      return await this.resampleAudioBuffer(audioBuffer);
    }

    return audioBuffer;
  }

  /**
   * Resample AudioBuffer to 44.1kHz
   */
  async resampleAudioBuffer(audioBuffer) {
    const duration = audioBuffer.duration;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = Math.ceil(duration * SAMPLE_RATE);

    const offlineContext = new OfflineAudioContext(
      numberOfChannels,
      length,
      SAMPLE_RATE
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
  async loadAudioBuffer(blobId, blob) {
    // Check cache
    if (this.mediaCache.has(blobId)) {
      return this.mediaCache.get(blobId);
    }

    // Decode blob
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.decodeAudioFile(arrayBuffer);

    // Cache it
    this.mediaCache.set(blobId, audioBuffer);

    return audioBuffer;
  }

  /**
   * Play project from current time
   */
  async play(project, currentTimeMs, options = {}) {
    const playbackRequestId = ++this.playbackRequestId;
    this.isInitializingPlayback = true;
    this.initializingPlaybackRequestId = playbackRequestId;
    this.stopActiveSources('Failed to replace an active audio source.', 'audio:replace-source');

    try {
      if (!this.audioContext) {
        await this.init();
      }
      if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;

      await this.resume();
      if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;

      this.isPlaying = true;
      this.startTime = this.audioContext.currentTime - msToSeconds(currentTimeMs);
      const useProjectMasterVolume = options?.useProjectMasterVolume !== false;
      if (useProjectMasterVolume) {
        this.currentMasterVolume = Number.isFinite(Number(project?.masterVolume))
          ? Number(project.masterVolume)
          : this.currentMasterVolume;
      }
      this.applyMasterGain();
      const mix = getEffectiveTrackMix(project);

      // Start all tracks. Metronome stays scheduled at gain 0 when muted so mute
      // can be toggled live without restarting playback.
      for (const track of project.tracks) {
        if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;
        await this.playTrack(
          track,
          currentTimeMs,
          getPlaybackTrackState(track, mix.statesByTrackId.get(track.id)),
          playbackRequestId
        );
      }
    } finally {
      if (this.initializingPlaybackRequestId === playbackRequestId) {
        this.isInitializingPlayback = false;
        this.initializingPlaybackRequestId = null;
      }
    }
  }

  /**
   * Play a single track
   */
  async playTrack(track, currentTimeMs, effectiveState, playbackRequestId = this.playbackRequestId) {
    // Skip if track has no clips
    if (!track.clips || track.clips.length === 0) return;
    if (!effectiveState?.audible) return;

    // Play all clips that should be audible at current time or in the future
    for (const clip of track.clips) {
      if (!this.isPlaybackRequestCurrent(playbackRequestId)) return;
      if (clip.muted) continue;
      const clipStartTimeMs = clip.timelineStartMs;
      const clipDurationMs = clip.cropEndMs - clip.cropStartMs;
      const clipEndTimeMs = clipStartTimeMs + clipDurationMs;

      // Skip clips that have already ended
      if (clipEndTimeMs < currentTimeMs) continue;

      // Load audio buffer from cache
      if (!this.mediaCache.has(clip.blobId)) {
        console.warn(`Audio buffer not loaded for clip ${clip.id}`);
        continue;
      }

      const audioBuffer = this.mediaCache.get(clip.blobId);

      // Create source
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Create gain node
      const gainNode = this.audioContext.createGain();
      const baseGain = Number.isFinite(effectiveState.effectiveGain)
        ? effectiveState.effectiveGain
        : volumeToGain(track.volume);
      const clipGain = Math.pow(10, clip.gainDb / 20);

      // Create pan node
      const panNode = this.audioContext.createStereoPanner();
      const effectivePan = Number.isFinite(effectiveState.effectivePan) ? effectiveState.effectivePan : track.pan;
      panNode.pan.value = this.getEffectiveOutputPan(effectivePan) / 100;
      gainNode.gain.value = this.getClipOutputGain(baseGain, clipGain, effectivePan);

      // Connect: source -> gain -> pan -> master -> destination
      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(this.masterGainNode);

      // Calculate playback timing
      const offset = msToSeconds(clip.cropStartMs);
      const duration = msToSeconds(clipDurationMs);

      if (clipStartTimeMs > currentTimeMs) {
        // Clip starts in the future
        const when = this.audioContext.currentTime + msToSeconds(clipStartTimeMs - currentTimeMs);
        source.start(when, offset, duration);
      } else {
        // Clip is currently playing
        const elapsedInClip = currentTimeMs - clipStartTimeMs;
        if (elapsedInClip < clipDurationMs) {
          const remainingDuration = msToSeconds(clipDurationMs - elapsedInClip);
          source.start(this.audioContext.currentTime, offset + msToSeconds(elapsedInClip), remainingDuration);
        }
      }

      // Store active source (use unique key for multiple clips)
      const sourceKey = `${track.id}-${clip.id}`;
      if (!this.isPlaybackRequestCurrent(playbackRequestId)) {
        try {
          source.stop(0);
        } catch (e) {
          if (e?.name !== 'InvalidStateError') {
            reportUserError('Failed to stop a superseded audio source.', e, { onceKey: 'audio:superseded-source' });
          }
        }
        return;
      }
      this.activeSources.set(sourceKey, {
        source,
        gainNode,
        panNode,
        baseGain,
        clipGain,
        effectivePan,
      });

      // Auto-cleanup when done
      source.onended = () => {
        // Only delete if this is still the current source for this key
        // (prevents old sources from deleting new ones with the same key)
        const current = this.activeSources.get(sourceKey);
        if (current && current.source === source) {
          this.activeSources.delete(sourceKey);
        }
      };
    }
  }

  /**
   * Stop playback
   */
  stop() {
    this.playbackRequestId += 1;
    this.isPlaying = false;
    this.pauseTime = 0;
    this.isInitializingPlayback = false;
    this.initializingPlaybackRequestId = null;
    this.stopActiveSources('Failed to stop an active audio source.', 'audio:stop-source');
  }

  stopActiveSources(errorMessage, onceKey) {
    for (const nodes of this.activeSources.values()) {
      try {
        // Use stop(0) to immediately stop even sources scheduled for future
        nodes.source.stop(0);
      } catch (e) {
        if (e?.name !== 'InvalidStateError') {
          reportUserError(errorMessage, e, { onceKey });
        }
      }
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
    this.pauseTime = currentTimeMs;
    this.isInitializingPlayback = false;
    this.initializingPlaybackRequestId = null;
    this.stopActiveSources('Failed to pause an active audio source.', 'audio:pause-source');
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
    
    const elapsed = this.audioContext.currentTime - this.startTime;
    return elapsed * 1000; // Convert to ms
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.stop();

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
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mediaCache.clear();
    this.activeSources.clear();
  }

  getMasterOutputGain() {
    if (this.isMonoOutput()) {
      return this.getMasterVolumeGain();
    }
    const headroomGain = this.masterHeadroomEnabled
      ? getPanLawHeadroomGain(this.currentPanLawDb)
      : 1;
    return this.getMasterVolumeGain() * headroomGain;
  }

  getMasterVolumeGain() {
    const clamped = Math.max(0, Math.min(100, Number(this.currentMasterVolume) || 0));
    if (clamped <= 0) return 0;
    if (this.masterVolumeCurve === 'unity') {
      return clamped / 100;
    }
    return volumeToGain(clamped);
  }

  applyMasterGain() {
    if (!this.masterGainNode) return;
    this.masterGainNode.channelCount = this.getTargetOutputChannelCount();
    this.masterGainNode.gain.value = this.getMasterOutputGain();
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

  async configureOutputRouting() {
    if (!this.audioContext || !this.masterGainNode) return;

    if (this.outputTargetNode) {
      try {
        this.masterGainNode.disconnect(this.outputTargetNode);
      } catch {
        // Ignore reconnect noise when the previous route is already gone.
      }
    } else {
      try {
        this.masterGainNode.disconnect();
      } catch {
        // Ignore initial disconnect attempts before anything is connected.
      }
    }

    const routedTarget = await this.ensureOutputRoutingTarget();
    this.outputTargetNode = routedTarget || this.audioContext.destination;

    if (this.outputTargetNode === this.audioContext.destination) {
      this.applyOutputChannelConfig();
    }

    this.masterGainNode.connect(this.outputTargetNode);
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

export function getPlaybackTrackState(track, mixState) {
  if (!isMetronomeRole(track?.role)) return mixState;
  return {
    audible: true,
    effectiveGain: mixState?.audible === true && Number.isFinite(mixState.effectiveGain)
      ? mixState.effectiveGain
      : 0,
    effectivePan: Number.isFinite(mixState?.effectivePan) ? mixState.effectivePan : 0,
  };
}

// Singleton instance
export const audioManager = new AudioManager();
