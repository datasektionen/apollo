import { audioManager } from './audioManager';
import { createRecordingWaveform } from './recordingWaveform';

/**
 * Recording Manager
 *
 * Captures the microphone on the same AudioContext that plays the project.
 * Every captured block is tagged with its audio-clock frame index, so a take
 * is placed on the timeline by sample position instead of by the UI playhead.
 * Segments (take start, loop wraps, stop) are expressed as audio-clock times
 * and cut out of one continuous capture; the round-trip latency is removed at
 * extraction time, so the stored clip contains exactly what the performer
 * played against what they heard.
 */

const CAPTURE_PROCESSOR_NAME = 'apollo-capture-processor';
// Frames per message from the worklet. Small enough that stop/loop-wrap
// extraction never waits long, large enough to keep message traffic low.
const CAPTURE_BATCH_FRAMES = 2048;
// History kept while the mic is open but nothing is recording. Lets a take
// begin on an audio-clock instant slightly in the past (the moment the record
// button was pressed) and gives calibration a buffer to read from.
const IDLE_RING_SECONDS = 8;
const MAX_CAPTURE_CHANNELS = 2;

const CAPTURE_WORKLET_SOURCE = `
class ApolloCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchFrames = ${CAPTURE_BATCH_FRAMES};
    this.pending = [];
    this.pendingFrames = 0;
    this.pendingStartFrame = -1;
    this.channelCount = 1;
    this.port.onmessage = (event) => {
      const data = event && event.data;
      if (!data) return;
      if (data.type === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flushed', id: data.id, frame: currentFrame });
      }
    };
  }

  flush() {
    if (this.pendingFrames === 0) return;
    const channelCount = this.channelCount;
    const channels = [];
    for (let c = 0; c < channelCount; c += 1) {
      channels.push(new Float32Array(this.pendingFrames));
    }
    let offset = 0;
    for (const block of this.pending) {
      for (let c = 0; c < channelCount; c += 1) {
        const source = block[Math.min(c, block.length - 1)];
        channels[c].set(source, offset);
      }
      offset += block[0].length;
    }
    this.port.postMessage(
      { type: 'frames', startFrame: this.pendingStartFrame, length: this.pendingFrames, channels },
      channels.map((channel) => channel.buffer)
    );
    this.pending = [];
    this.pendingFrames = 0;
    this.pendingStartFrame = -1;
  }

  process(inputs) {
    const input = inputs[0] || [];
    const blockLength = input[0] ? input[0].length : 128;
    const channelCount = Math.max(1, Math.min(${MAX_CAPTURE_CHANNELS}, input.length || 1));
    if (channelCount !== this.channelCount) {
      this.flush();
      this.channelCount = channelCount;
    }
    if (this.pendingStartFrame < 0) {
      this.pendingStartFrame = currentFrame;
    }
    const block = [];
    for (let c = 0; c < channelCount; c += 1) {
      const copy = new Float32Array(blockLength);
      if (input[c]) copy.set(input[c]);
      block.push(copy);
    }
    this.pending.push(block);
    this.pendingFrames += blockLength;
    if (this.pendingFrames >= this.batchFrames) {
      this.flush();
    }
    return true;
  }
}
registerProcessor('${CAPTURE_PROCESSOR_NAME}', ApolloCaptureProcessor);
`;

async function loadCaptureWorkletModule(audioContext) {
  // Inline the processor so the bundler needs no extra asset. Blob URLs work
  // everywhere current; fall back to a data URL for engines that reject them.
  const blob = new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await audioContext.audioWorklet.addModule(blobUrl);
    return;
  } catch (blobError) {
    console.warn('Recording: blob worklet URL rejected, retrying with a data URL.', blobError);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  const dataUrl = `data:application/javascript;base64,${btoa(unescape(encodeURIComponent(CAPTURE_WORKLET_SOURCE)))}`;
  await audioContext.audioWorklet.addModule(dataUrl);
}

function stopMediaStream(mediaStream) {
  mediaStream?.getTracks?.().forEach((track) => {
    try { track.stop(); } catch { /* already stopped */ }
  });
}

function readTrackSettings(mediaStream) {
  const track = mediaStream?.getAudioTracks?.()[0];
  if (!track || typeof track.getSettings !== 'function') return null;
  try {
    return track.getSettings();
  } catch {
    return null;
  }
}

/**
 * Ask for the project's sample rate and at most two channels. A connected
 * Bluetooth output often advertises a different rate and a wider channel
 * layout; leaving the constraints unset lets Chrome open the built-in mic in
 * that format, and the take comes back distorted.
 */
function microphoneConstraints(deviceId, { sampleRate = 0, exactRate = false, voiceIsolation = true } = {}) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { max: MAX_CAPTURE_CHANNELS },
  };
  if (voiceIsolation) audio.voiceIsolation = false;
  if (sampleRate > 0) {
    audio.sampleRate = exactRate ? { exact: sampleRate } : { ideal: sampleRate };
  }
  if (deviceId) audio.deviceId = { exact: deviceId };
  return audio;
}

function applyCaptureChannelFormat(node, settings) {
  if (!node) return;
  const reported = Number(settings?.channelCount);
  const channelCount = Number.isFinite(reported)
    ? Math.max(1, Math.min(MAX_CAPTURE_CHANNELS, Math.round(reported)))
    : 1;
  try {
    node.channelCountMode = 'explicit';
    node.channelInterpretation = 'speakers';
    node.channelCount = channelCount;
  } catch {
    // Some browsers lock the source format after construction.
  }
}

function describeMicrophoneError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error('Microphone access denied. Please grant permission to record.');
  }
  if (error?.name === 'NotFoundError') {
    return new Error('No microphone was found on this device.');
  }
  if (error?.name === 'NotReadableError') {
    return new Error('Microphone is already in use by another application.');
  }
  return new Error(error?.message || 'Failed to access microphone.');
}

class RecordingManager {
  constructor() {
    this.mediaStream = null;
    this.requestedDeviceId = '';
    this.inputFallbackUsed = false;
    this.audioContext = null;
    this.workletModuleContext = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.silentOutputNode = null;
    this.capturePullNode = null;

    this.chunks = []; // { startFrame, endFrame, channels: Float32Array[] }
    this.lastFrame = -1;
    this.firstFrame = -1;
    this.frameWaiters = [];
    this.flushWaiters = new Map();
    this.flushCounter = 0;

    this.openSegment = null;
    this.pendingSegments = [];
    this.retainHolds = new Set();
    this.isRecording = false;
    this.recordingTrackId = null;
    this.setupPromise = null;
    this.recordingGeneration = 0;
    this.recordingController = null;
    this.waveformCapture = null;
    this.waveformSegment = null;
    this.waveformSnapshot = null;
    this.waveformListeners = new Set();
  }

  subscribeWaveform(listener) {
    this.waveformListeners.add(listener);
    return () => this.waveformListeners.delete(listener);
  }

  getWaveformSnapshot() {
    return this.waveformSnapshot;
  }

  publishWaveform() {
    const segment = this.waveformSegment;
    this.waveformSnapshot = segment && this.waveformCapture ? {
      generation: this.recordingGeneration,
      capture: this.waveformCapture,
      sampleRate: this.getSampleRate(),
      trackId: segment.trackId,
      recordingStartMs: segment.timelineStartMs,
      sourceStartFrame: segment.startFrame + segment.roundTripFrames,
      sourceEndFrame: Math.max(segment.startFrame + segment.roundTripFrames,
        Math.min(this.waveformCapture.getEndFrame(), this.lastFrame,
          (segment.endFrame ?? Infinity) + segment.roundTripFrames)),
      numberOfChannels: segment.waveformChannels || 1,
    } : null;
    for (const listener of this.waveformListeners) {
      try { listener(); } catch (error) { console.error('Recording waveform subscriber failed', error); }
    }
  }

  clearWaveform() {
    this.waveformCapture?.cancel();
    this.waveformCapture = null;
    this.waveformSegment = null;
    this.publishWaveform();
  }

  setWaveformSegment(segment) {
    this.waveformSegment = segment;
    const start = segment.startFrame + segment.roundTripFrames;
    const end = (segment.endFrame ?? Infinity) + segment.roundTripFrames;
    segment.waveformChannels = 1;
    for (const chunk of this.chunks) {
      if (chunk.endFrame > start && chunk.startFrame < end) {
        segment.waveformChannels = Math.max(segment.waveformChannels, chunk.channels.length);
      }
    }
    this.publishWaveform();
  }

  // ---------------------------------------------------------------------------
  // Capture lifecycle
  // ---------------------------------------------------------------------------

  isCaptureLive() {
    if (!this.mediaStream || !this.workletNode || !this.audioContext) return false;
    if (this.audioContext !== audioManager.audioContext) return false;
    const tracks = this.mediaStream.getAudioTracks();
    return tracks.length > 0 && tracks.every((track) => track.readyState === 'live');
  }

  /**
   * Open (or re-open) the microphone and start the capture worklet. Safe to
   * call repeatedly; it only rebuilds when the device or context changed.
   */
  async ensureCapture({ deviceId = '' } = {}) {
    const requestedDeviceId = String(deviceId || '');
    if (this.isCaptureLive() && this.requestedDeviceId === requestedDeviceId) {
      return;
    }
    if (this.isRecording) {
      if (this.isCaptureLive()) return;
      throw new Error('Microphone capture stopped while recording.');
    }
    if (this.setupPromise) {
      await this.setupPromise;
      if (this.isCaptureLive() && this.requestedDeviceId === requestedDeviceId) return;
    }

    this.setupPromise = this.setupCapture(requestedDeviceId);
    try {
      await this.setupPromise;
    } finally {
      this.setupPromise = null;
    }
  }

  async setupCapture(requestedDeviceId) {
    if (typeof navigator === 'undefined') {
      throw new Error('Microphone capture is only available in a browser context.');
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      const insecureReason =
        typeof window !== 'undefined' && window.isSecureContext === false
          ? ' This page is not in a secure context. Use https:// or localhost.'
          : '';
      throw new Error(
        `This browser cannot access the microphone because navigator.mediaDevices.getUserMedia is unavailable.${insecureReason}`
      );
    }

    this.teardownCapture();

    await audioManager.init();
    await audioManager.resume();
    const audioContext = audioManager.audioContext;
    if (!audioContext) {
      throw new Error('Audio engine is not available.');
    }
    if (!audioContext.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      throw new Error('This browser cannot record in sync: AudioWorklet is unavailable. Please update your browser.');
    }

    if (this.workletModuleContext !== audioContext) {
      await loadCaptureWorkletModule(audioContext);
      this.workletModuleContext = audioContext;
    }

    const contextRate = Math.round(Number(audioContext.sampleRate) || 0);
    let mediaStream = null;
    this.inputFallbackUsed = false;
    try {
      mediaStream = await this.openMicrophone(requestedDeviceId, contextRate);
    } catch (error) {
      const deviceGone = requestedDeviceId
        && (error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError');
      if (!deviceGone) {
        console.error('Recording: Failed to access microphone:', error);
        throw describeMicrophoneError(error);
      }
      try {
        mediaStream = await this.openMicrophone('', contextRate);
        this.inputFallbackUsed = true;
        console.warn('Recording: selected microphone unavailable, using the default input instead.');
      } catch (fallbackError) {
        console.error('Recording: Failed to access microphone:', fallbackError);
        throw describeMicrophoneError(fallbackError);
      }
    }

    mediaStream = await this.reopenMicrophoneAtContextRate(
      mediaStream,
      this.inputFallbackUsed ? '' : requestedDeviceId,
      contextRate,
    );

    this.mediaStream = mediaStream;
    this.requestedDeviceId = requestedDeviceId;
    this.audioContext = audioContext;
    this.resetCaptureBuffers();

    for (const track of mediaStream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.mediaStream === mediaStream) {
          console.warn('Recording: microphone track ended.');
        }
      });
    }

    const trackSettings = readTrackSettings(mediaStream);
    this.sourceNode = audioContext.createMediaStreamSource(mediaStream);
    applyCaptureChannelFormat(this.sourceNode, trackSettings);
    this.workletNode = new AudioWorkletNode(audioContext, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    applyCaptureChannelFormat(this.workletNode, trackSettings);
    this.workletNode.port.onmessage = (event) => this.handleWorkletMessage(event.data);
    // Keep the worklet rendering, but do not connect it to the hardware
    // output. That sink follows the Bluetooth format and distorts a mic that
    // is running in another one.
    this.silentOutputNode = audioContext.createGain();
    this.silentOutputNode.gain.value = 0;
    applyCaptureChannelFormat(this.silentOutputNode, { channelCount: 1 });
    this.workletNode.connect(this.silentOutputNode);
    if (typeof audioContext.createMediaStreamDestination === 'function') {
      this.capturePullNode = audioContext.createMediaStreamDestination();
      this.silentOutputNode.connect(this.capturePullNode);
    } else {
      this.silentOutputNode.connect(audioContext.destination);
    }
    this.sourceNode.connect(this.workletNode);

    // Wait until frames are flowing so callers can trust the audio clock.
    await this.waitForAnyFrames(3000);
    console.log('Recording: microphone capture ready', {
      contextSampleRate: audioContext.sampleRate,
      trackSampleRate: trackSettings?.sampleRate ?? null,
      trackChannels: trackSettings?.channelCount ?? null,
      device: trackSettings?.deviceId || 'default',
    });
  }

  async openMicrophone(deviceId, sampleRate) {
    const attempts = [
      microphoneConstraints(deviceId, { sampleRate, voiceIsolation: true }),
      microphoneConstraints(deviceId, { sampleRate, voiceIsolation: false }),
    ];
    let lastError = null;
    for (const audio of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio });
      } catch (error) {
        lastError = error;
        if (error?.name !== 'OverconstrainedError') break;
      }
    }
    throw lastError;
  }

  /**
   * getUserMedia can still come back at the Bluetooth rate after an `ideal`
   * request. One exact retry puts the mic on the project clock. If the device
   * cannot do that rate, the first stream is kept.
   */
  async reopenMicrophoneAtContextRate(mediaStream, deviceId, contextRate) {
    const trackRate = Math.round(Number(readTrackSettings(mediaStream)?.sampleRate) || 0);
    if (!contextRate || !trackRate || trackRate === contextRate) return mediaStream;
    try {
      const matched = await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraints(deviceId, {
          sampleRate: contextRate,
          exactRate: true,
          voiceIsolation: false,
        }),
      });
      const matchedRate = Math.round(Number(readTrackSettings(matched)?.sampleRate) || 0);
      if (matchedRate && matchedRate !== contextRate) {
        stopMediaStream(matched);
        console.warn('Recording: microphone sample rate does not match the project.', {
          trackSampleRate: trackRate,
          contextSampleRate: contextRate,
        });
        return mediaStream;
      }
      stopMediaStream(mediaStream);
      return matched;
    } catch (error) {
      console.warn('Recording: microphone sample rate does not match the project.', {
        trackSampleRate: trackRate,
        contextSampleRate: contextRate,
        error,
      });
      return mediaStream;
    }
  }

  teardownCapture() {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch { /* already disconnected */ }
      this.sourceNode = null;
    }
    if (this.workletNode) {
      try { this.workletNode.port.onmessage = null; } catch { /* ignore */ }
      try { this.workletNode.disconnect(); } catch { /* already disconnected */ }
      this.workletNode = null;
    }
    if (this.silentOutputNode) {
      try { this.silentOutputNode.disconnect(); } catch { /* already disconnected */ }
      this.silentOutputNode = null;
    }
    this.capturePullNode = null;
    if (this.mediaStream) {
      stopMediaStream(this.mediaStream);
      this.mediaStream = null;
    }
    this.rejectWaiters(new Error('Microphone capture was closed.'));
    this.resetCaptureBuffers();
  }

  resetCaptureBuffers() {
    this.recordingController?.abort();
    for (const segment of this.pendingSegments) segment.controller?.abort();
    this.recordingGeneration += 1;
    this.clearWaveform();
    this.chunks = [];
    this.lastFrame = -1;
    this.firstFrame = -1;
  }

  getInputTrackSettings() {
    const track = this.mediaStream?.getAudioTracks?.()[0];
    if (!track || typeof track.getSettings !== 'function') return null;
    try {
      return track.getSettings();
    } catch {
      return null;
    }
  }

  getInputTrackLabel() {
    return this.mediaStream?.getAudioTracks?.()[0]?.label || '';
  }

  getSampleRate() {
    return this.audioContext?.sampleRate || audioManager.audioContext?.sampleRate || 48000;
  }

  frameAtContextTime(contextTime) {
    return Math.round(Number(contextTime) * this.getSampleRate());
  }

  framesForMs(ms) {
    return Math.max(0, Math.round((Number(ms) || 0) / 1000 * this.getSampleRate()));
  }

  // ---------------------------------------------------------------------------
  // Worklet messages and frame bookkeeping
  // ---------------------------------------------------------------------------

  handleWorkletMessage(data) {
    if (!data) return;
    if (data.type === 'frames') {
      const channels = (data.channels || []).map((buffer) => (
        buffer instanceof Float32Array ? buffer : new Float32Array(buffer)
      ));
      if (!channels.length || !data.length) return;
      const startFrame = Number(data.startFrame) || 0;
      const endFrame = startFrame + Number(data.length);
      const chunk = { startFrame, endFrame, channels };
      this.chunks.push(chunk);
      // Only enqueue borrowed PCM here. Reduction runs in bounded background tasks.
      this.waveformCapture?.append(chunk);
      const preview = this.waveformSegment;
      if (preview && endFrame > preview.startFrame + preview.roundTripFrames
        && startFrame < (preview.endFrame ?? Infinity) + preview.roundTripFrames) {
        preview.waveformChannels = Math.max(preview.waveformChannels || 1, channels.length);
      }
      if (this.firstFrame < 0) this.firstFrame = startFrame;
      this.lastFrame = Math.max(this.lastFrame, endFrame);
      this.trimChunks();
      this.resolveFrameWaiters();
      return;
    }
    if (data.type === 'flushed') {
      const waiter = this.flushWaiters.get(data.id);
      if (waiter) {
        this.flushWaiters.delete(data.id);
        waiter.resolve(Number(data.frame) || this.lastFrame);
      }
    }
  }

  getRetainFloorFrame() {
    let floor = null;
    const consider = (frame) => {
      if (!Number.isFinite(frame)) return;
      floor = floor == null ? frame : Math.min(floor, frame);
    };
    if (this.openSegment) consider(this.openSegment.startFrame);
    for (const segment of this.pendingSegments) consider(segment.startFrame);
    for (const frame of this.retainHolds) consider(frame);
    if (floor == null) {
      floor = this.lastFrame - Math.round(IDLE_RING_SECONDS * this.getSampleRate());
    }
    return floor;
  }

  trimChunks() {
    const floor = this.getRetainFloorFrame();
    if (!Number.isFinite(floor)) return;
    let dropCount = 0;
    while (dropCount < this.chunks.length && this.chunks[dropCount].endFrame <= floor) {
      dropCount += 1;
    }
    if (dropCount > 0) this.chunks.splice(0, dropCount);
    this.waveformCapture?.prune(floor);
  }

  waitForFrame(frame, timeoutMs = 2000, signal) {
    const abortError = () => Object.assign(new Error('Recording cancelled'), { name: 'AbortError' });
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.lastFrame >= frame) return Promise.resolve(this.lastFrame);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(waiter.timeoutId);
        signal?.removeEventListener('abort', onAbort);
      };
      const waiter = { frame, timeoutId: null,
        resolve: (value) => { cleanup(); resolve(value); },
        reject: (error) => { cleanup(); reject(error); },
      };
      const onAbort = () => {
        this.frameWaiters = this.frameWaiters.filter((entry) => entry !== waiter);
        waiter.reject(abortError());
      };
      waiter.timeoutId = setTimeout(() => {
        this.frameWaiters = this.frameWaiters.filter((entry) => entry !== waiter);
        waiter.reject(new Error('Timed out waiting for microphone frames.'));
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.frameWaiters.push(waiter);
    });
  }

  waitForAnyFrames(timeoutMs = 2000) {
    if (this.lastFrame >= 0) return Promise.resolve(this.lastFrame);
    return this.waitForFrame(0, timeoutMs);
  }

  resolveFrameWaiters() {
    if (!this.frameWaiters.length) return;
    const remaining = [];
    for (const waiter of this.frameWaiters) {
      if (this.lastFrame >= waiter.frame) {
        clearTimeout(waiter.timeoutId);
        waiter.resolve(this.lastFrame);
      } else {
        remaining.push(waiter);
      }
    }
    this.frameWaiters = remaining;
  }

  rejectWaiters(error) {
    for (const waiter of this.frameWaiters) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(error);
    }
    this.frameWaiters = [];
    for (const waiter of this.flushWaiters.values()) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(this.lastFrame);
    }
    this.flushWaiters.clear();
  }

  /**
   * Ask the worklet to post every frame rendered so far. Resolves with the
   * worklet's current frame once the frames have arrived.
   */
  flushWorklet(timeoutMs = 1500) {
    if (!this.workletNode) return Promise.resolve(this.lastFrame);
    const id = ++this.flushCounter;
    return new Promise((resolve) => {
      const waiter = { resolve, timeoutId: null };
      waiter.timeoutId = setTimeout(() => {
        this.flushWaiters.delete(id);
        resolve(this.lastFrame);
      }, timeoutMs);
      this.flushWaiters.set(id, waiter);
      try {
        this.workletNode.port.postMessage({ type: 'flush', id });
      } catch {
        clearTimeout(waiter.timeoutId);
        this.flushWaiters.delete(id);
        resolve(this.lastFrame);
      }
    }).then((frame) => {
      const waiter = this.flushWaiters.get(id);
      if (waiter) {
        clearTimeout(waiter.timeoutId);
        this.flushWaiters.delete(id);
      }
      return frame;
    });
  }

  /**
   * Copy captured frames [startFrame, endFrame) into an AudioBuffer.
   * Frames that were never captured (should not happen) come out as silence.
   */
  extractFrames(startFrame, endFrame) {
    const length = Math.floor(endFrame - startFrame);
    if (!Number.isFinite(length) || length <= 0 || !this.audioContext) return null;

    let channelCount = 1;
    for (const chunk of this.chunks) {
      if (chunk.endFrame <= startFrame || chunk.startFrame >= endFrame) continue;
      channelCount = Math.max(channelCount, Math.min(MAX_CAPTURE_CHANNELS, chunk.channels.length));
    }

    const audioBuffer = this.audioContext.createBuffer(channelCount, length, this.getSampleRate());
    const outputs = [];
    for (let c = 0; c < channelCount; c += 1) {
      outputs.push(audioBuffer.getChannelData(c));
    }

    for (const chunk of this.chunks) {
      const overlapStart = Math.max(chunk.startFrame, startFrame);
      const overlapEnd = Math.min(chunk.endFrame, endFrame);
      if (overlapEnd <= overlapStart) continue;
      const sourceOffset = overlapStart - chunk.startFrame;
      const targetOffset = overlapStart - startFrame;
      const count = overlapEnd - overlapStart;
      for (let c = 0; c < channelCount; c += 1) {
        const source = chunk.channels[Math.min(c, chunk.channels.length - 1)];
        outputs[c].set(source.subarray(sourceOffset, sourceOffset + count), targetOffset);
      }
    }

    return audioBuffer;
  }

  /**
   * Mono copy of the captured signal between two audio-clock times. Used by
   * latency calibration. Waits for the frames to arrive first.
   */
  async captureMonoRange(startContextTime, endContextTime, timeoutMs = 4000) {
    const startFrame = this.frameAtContextTime(startContextTime);
    const endFrame = this.frameAtContextTime(endContextTime);
    this.retainHolds.add(startFrame);
    try {
      try {
        await this.waitForFrame(endFrame, timeoutMs);
      } catch {
        await this.flushWorklet();
      }
      const availableEnd = Math.min(endFrame, this.lastFrame);
      const audioBuffer = this.extractFrames(startFrame, availableEnd);
      if (!audioBuffer) return { samples: new Float32Array(0), startFrame, sampleRate: this.getSampleRate() };
      const samples = new Float32Array(audioBuffer.length);
      for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
        const channel = audioBuffer.getChannelData(c);
        for (let i = 0; i < channel.length; i += 1) samples[i] += channel[i];
      }
      if (audioBuffer.numberOfChannels > 1) {
        const scale = 1 / audioBuffer.numberOfChannels;
        for (let i = 0; i < samples.length; i += 1) samples[i] *= scale;
      }
      return { samples, startFrame, sampleRate: this.getSampleRate() };
    } finally {
      this.retainHolds.delete(startFrame);
      this.trimChunks();
    }
  }

  // ---------------------------------------------------------------------------
  // Recording segments
  // ---------------------------------------------------------------------------

  /**
   * Begin a take. `startContextTime` is the audio-clock instant that maps to
   * `timelineStartMs` on the project timeline. `roundTripMs` is removed from
   * the captured audio so the clip lines up with what the performer heard.
   */
  beginRecording({ trackId, startContextTime, timelineStartMs, roundTripMs = 0 }) {
    if (this.isRecording) {
      throw new Error('Already recording');
    }
    if (!this.isCaptureLive()) {
      throw new Error('Microphone capture is not ready.');
    }
    const startFrame = this.frameAtContextTime(startContextTime);
    this.recordingController = new AbortController();
    this.recordingGeneration += 1;
    this.clearWaveform();
    this.waveformCapture = createRecordingWaveform({
      sampleRate: this.getSampleRate(), onChange: () => this.publishWaveform(),
    });
    const sourceStart = startFrame + this.framesForMs(roundTripMs);
    for (const chunk of this.chunks) {
      if (chunk.endFrame > sourceStart) this.waveformCapture.append(chunk);
    }
    this.openSegment = {
      signal: this.recordingController.signal,
      controller: this.recordingController,
      trackId,
      startFrame,
      timelineStartMs: Number(timelineStartMs) || 0,
      roundTripFrames: this.framesForMs(roundTripMs),
      roundTripMs: Math.max(0, Number(roundTripMs) || 0),
    };
    this.isRecording = true;
    this.recordingTrackId = trackId;
    this.setWaveformSegment(this.openSegment);
    console.log(`Recording started on track ${trackId} at ${this.openSegment.timelineStartMs}ms (frame ${startFrame})`);
    return { startFrame };
  }

  /**
   * Close the current segment at an audio-clock time and immediately open the
   * next one (loop wrap). The closed segment's audio resolves once its tail,
   * which arrives one round trip later, has been captured.
   */
  splitSegment({ endContextTime, nextTimelineStartMs }) {
    const segment = this.openSegment;
    if (!this.isRecording || !segment) {
      throw new Error('Not currently recording');
    }
    const endFrame = Math.max(segment.startFrame, this.frameAtContextTime(endContextTime));
    const closed = { ...segment, endFrame, includeTailRoundTrip: true };
    this.pendingSegments.push(closed);
    this.openSegment = {
      signal: segment.signal,
      controller: segment.controller,
      trackId: segment.trackId,
      startFrame: endFrame,
      timelineStartMs: Number(nextTimelineStartMs) || 0,
      roundTripFrames: segment.roundTripFrames,
      roundTripMs: segment.roundTripMs,
    };
    this.setWaveformSegment(this.openSegment);
    return this.finalizeSegment(closed);
  }

  /**
   * Stop the take at an audio-clock time and return the final segment.
   * The clip runs from the record point to this stop point. The sound the
   * performer played at the cursor reaches the microphone one round trip
   * later, so that tail is included before the clip is stored.
   */
  async stopRecording({ endContextTime } = {}) {
    const segment = this.openSegment;
    if (!this.isRecording || !segment) {
      throw new Error('Not currently recording');
    }
    const stopContextTime = Number.isFinite(Number(endContextTime))
      ? Number(endContextTime)
      : this.audioContext?.currentTime || 0;
    const endFrame = Math.max(segment.startFrame, this.frameAtContextTime(stopContextTime));
    const closed = { ...segment, endFrame, includeTailRoundTrip: true };
    this.openSegment = null;
    this.isRecording = false;
    this.recordingTrackId = null;
    this.pendingSegments.push(closed);
    this.setWaveformSegment(closed);
    await this.flushWorklet();
    const result = await this.finalizeSegment(closed);
    console.log(`Recording stopped: ${Math.round(result.durationMs)}ms`);
    return result;
  }

  async finalizeSegment(closed) {
    const sourceStart = closed.startFrame + closed.roundTripFrames;
    const sourceEnd = closed.endFrame + (closed.includeTailRoundTrip ? closed.roundTripFrames : 0);
    try {
      const timeoutMs = Math.round(closed.roundTripMs) + 2500;
      await this.waitForFrame(sourceEnd, timeoutMs, closed.signal);
    } catch (error) {
      if (closed.signal?.aborted) throw error;
      // Capture stopped early (device lost, context suspended): use what we have.
      await this.flushWorklet();
    }
    if (closed.signal?.aborted) {
      throw Object.assign(new Error('Recording cancelled'), { name: 'AbortError' });
    }
    const availableEnd = Math.min(sourceEnd, this.lastFrame);
    const audioBuffer = this.extractFrames(sourceStart, availableEnd);
    this.pendingSegments = this.pendingSegments.filter((segment) => segment !== closed);
    if (!this.openSegment && !this.pendingSegments.length) this.clearWaveform();
    this.trimChunks();
    return {
      audioBuffer,
      trackId: closed.trackId,
      startTimeMs: closed.timelineStartMs,
      durationMs: audioBuffer ? audioBuffer.duration * 1000 : 0,
    };
  }

  /**
   * Cancel recording without saving
   */
  cancelRecording() {
    this.recordingController?.abort();
    for (const segment of this.pendingSegments) segment.controller?.abort();
    this.recordingGeneration += 1;
    this.clearWaveform();
    if (!this.isRecording && !this.openSegment && !this.pendingSegments.length) return;
    this.openSegment = null;
    this.pendingSegments = [];
    this.isRecording = false;
    this.recordingTrackId = null;
    this.trimChunks();
    console.log('Recording cancelled');
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.cancelRecording();
    this.teardownCapture();
    this.retainHolds.clear();
  }
}

// Singleton instance
export const recordingManager = new RecordingManager();
