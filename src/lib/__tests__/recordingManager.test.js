import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SAMPLE_RATE = 48000;

function createFakeAudioBuffer(channelCount, length, sampleRate) {
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  return {
    numberOfChannels: channelCount,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (index) => channels[index],
  };
}

const fakeContext = {
  sampleRate: SAMPLE_RATE,
  currentTime: 0,
  state: 'running',
  destination: {},
  audioWorklet: { addModule: vi.fn(async () => {}) },
  createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
  createMediaStreamDestination: vi.fn(() => ({ stream: { getTracks: () => [] }, connect: vi.fn(), disconnect: vi.fn() })),
  createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
  createBuffer: vi.fn(createFakeAudioBuffer),
};

const mockAudioManager = {
  audioContext: fakeContext,
  init: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
};

vi.mock('../audioManager', () => ({ audioManager: mockAudioManager }));

let workletNodes = [];

class FakeAudioWorkletNode {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage: vi.fn((message) => {
        if (message?.type === 'flush') {
          // Reply asynchronously like a real worklet would.
          setTimeout(() => {
            this.port.onmessage?.({ data: { type: 'flushed', id: message.id, frame: this.lastPostedFrame } });
          }, 0);
        }
      }),
    };
    this.lastPostedFrame = 0;
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    workletNodes.push(this);
  }

  /** Deliver frames [startFrame, startFrame + length) whose sample value equals the frame index. */
  emitFrames(startFrame, length, channelCount = 1) {
    const channels = [];
    for (let c = 0; c < channelCount; c += 1) {
      const data = new Float32Array(length);
      for (let i = 0; i < length; i += 1) data[i] = startFrame + i + c * 1_000_000;
      channels.push(data);
    }
    this.lastPostedFrame = startFrame + length;
    this.port.onmessage?.({ data: { type: 'frames', startFrame, length, channels } });
  }
}

function createFakeStream(sampleRate = SAMPLE_RATE) {
  const track = {
    readyState: 'live',
    label: 'Headset Microphone',
    addEventListener: vi.fn(),
    getSettings: () => ({
      deviceId: 'mic-headset',
      groupId: 'headset',
      sampleRate,
      channelCount: 1,
    }),
    stop: vi.fn(),
  };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('recordingManager capture engine', () => {
  let recordingManager;

  beforeEach(async () => {
    vi.resetModules();
    workletNodes = [];
    fakeContext.currentTime = 0;
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => createFakeStream()) },
    });
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => 'blob:fake';
      URL.revokeObjectURL = () => {};
    }
    ({ recordingManager } = await import('../recordingManager'));
  });

  afterEach(() => {
    recordingManager.dispose();
    vi.unstubAllGlobals();
  });

  async function openCapture() {
    const ready = recordingManager.ensureCapture({ deviceId: 'mic-headset' });
    await flushMicrotasks();
    const node = workletNodes[0];
    node.emitFrames(0, 2048);
    await ready;
    return node;
  }

  it('passes the selected device to getUserMedia with processing disabled', async () => {
    await openCapture();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
        channelCount: { max: 2 },
        sampleRate: { ideal: SAMPLE_RATE },
        deviceId: { exact: 'mic-headset' },
      },
    });
    const gain = fakeContext.createGain.mock.results.at(-1).value;
    const pull = fakeContext.createMediaStreamDestination.mock.results.at(-1).value;
    expect(gain.connect).toHaveBeenCalledWith(pull);
    expect(gain.connect).not.toHaveBeenCalledWith(fakeContext.destination);
  });

  it('reopens the microphone at the project sample rate when it comes back in another format', async () => {
    const opened = [];
    navigator.mediaDevices.getUserMedia.mockImplementation(async (constraints) => {
      const rate = constraints.audio.sampleRate?.exact || constraints.audio.sampleRate?.ideal || 16000;
      const stream = createFakeStream(constraints.audio.sampleRate?.exact ? rate : 16000);
      opened.push(stream);
      return stream;
    });

    await openCapture();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(navigator.mediaDevices.getUserMedia.mock.calls[1][0].audio.sampleRate).toEqual({ exact: SAMPLE_RATE });
    expect(opened[0].getTracks()[0].stop).toHaveBeenCalledTimes(1);
    expect(opened[1].getTracks()[0].stop).not.toHaveBeenCalled();
  });

  it('trims the round trip from the take start and keeps the clip as long as the playhead', async () => {
    const node = await openCapture();
    const roundTripMs = 100; // 4800 frames
    const startFrame = SAMPLE_RATE * 1; // 1.0 s on the audio clock
    const stopFrame = SAMPLE_RATE * 2; // 2.0 s

    // Feed through the tail: the sound played at the stop point arrives one round trip later.
    for (let frame = 2048; frame < stopFrame + 4800 + 2048; frame += 2048) node.emitFrames(frame, 2048);

    recordingManager.beginRecording({
      trackId: 'track-1',
      startContextTime: 1.0,
      timelineStartMs: 12_345,
      roundTripMs,
    });

    const result = await recordingManager.stopRecording({ endContextTime: 2.0 });

    expect(result.trackId).toBe('track-1');
    expect(result.startTimeMs).toBe(12_345);
    // Source frames [start + rt, stop + rt): the clip spans the full playhead interval.
    expect(result.audioBuffer.length).toBe(stopFrame - startFrame);
    expect(result.audioBuffer.getChannelData(0)[0]).toBe(startFrame + 4800);
    expect(result.audioBuffer.getChannelData(0)[result.audioBuffer.length - 1]).toBe(stopFrame + 4800 - 1);
    expect(result.durationMs).toBeCloseTo(1000, 6);
  });

  it('splits at a loop wrap on the audio clock and keeps capturing into the next segment', async () => {
    const node = await openCapture();
    const roundTripMs = 50; // 2400 frames
    recordingManager.beginRecording({
      trackId: 'track-1',
      startContextTime: 1.0,
      timelineStartMs: 4000,
      roundTripMs,
    });

    // Frames available only up to 1.5 s when the wrap happens.
    for (let frame = 2048; frame < SAMPLE_RATE * 1.5; frame += 2048) node.emitFrames(frame, 2048);

    const closedPromise = recordingManager.splitSegment({ endContextTime: 1.5, nextTimelineStartMs: 4000 });
    let settled = false;
    closedPromise.then(() => { settled = true; });
    await flushMicrotasks();
    // The wrapped segment needs its tail (one round trip after the wrap) before it can close.
    expect(settled).toBe(false);

    for (let frame = SAMPLE_RATE * 1.5 - (SAMPLE_RATE * 1.5) % 2048; frame < SAMPLE_RATE * 2.2; frame += 2048) {
      node.emitFrames(frame, 2048);
    }
    const closed = await closedPromise;
    expect(closed.startTimeMs).toBe(4000);
    // Full performer-time length of the loop pass: [1.0 + rt, 1.5 + rt) = 0.5 s.
    expect(closed.audioBuffer.length).toBe(SAMPLE_RATE * 0.5);
    expect(closed.audioBuffer.getChannelData(0)[0]).toBe(SAMPLE_RATE * 1 + 2400);

    const final = await recordingManager.stopRecording({ endContextTime: 2.0 });
    expect(final.startTimeMs).toBe(4000);
    // Second pass: [1.5 + rt, 2.0 + rt) = the full 0.5 s up to the stop point.
    expect(final.audioBuffer.length).toBe(SAMPLE_RATE * 0.5);
    expect(final.audioBuffer.getChannelData(0)[0]).toBe(SAMPLE_RATE * 1.5 + 2400);
    expect(recordingManager.isRecording).toBe(false);
  });

  async function finishWaveformTasks() {
    for (let i = 0; i < 1000; i += 1) {
      const capture = recordingManager.getWaveformSnapshot()?.capture;
      if (!capture || !capture.getStats().pending) return;
      await flushMicrotasks();
    }
    throw new Error('Recording summary tasks did not finish');
  }

  function readWaveform(capture, channel, start, end) {
    const query = capture.createRangeQuery(channel, start, end);
    for (let i = 0; i < 10000; i += 1) {
      const step = query();
      expect(step.rawSamples).toBeLessThanOrEqual(128);
      if (step.done) return step.result;
    }
    throw new Error('Recording query did not finish');
  }

  it('builds preview outside the message handler and matches latency-correct extraction with gaps and channel changes', async () => {
    const node = await openCapture();
    const listener = vi.fn();
    const unsubscribe = recordingManager.subscribeWaveform(listener);
    recordingManager.beginRecording({ trackId: 't', startContextTime: 2200 / SAMPLE_RATE,
      timelineStartMs: 12000, roundTripMs: 1 });
    const capture = recordingManager.getWaveformSnapshot().capture;
    node.emitFrames(2048, 256);
    node.emitFrames(2400, 900, 2);
    expect(capture.getStats().samplesScanned).toBe(0);
    await finishWaveformTasks();
    expect(recordingManager.getWaveformSnapshot()).toMatchObject({ recordingStartMs: 12000,
      sourceStartFrame: 2248, sourceEndFrame: 3300, numberOfChannels: 2 });
    const exact = recordingManager.extractFrames(2248, 3248);
    for (let c = 0; c < 2; c += 1) {
      const data = exact.getChannelData(c);
      const range = readWaveform(capture, c, 2248, 3248);
      expect(range).toEqual({ min: Math.min(...data), max: Math.max(...data),
        count: data.length, sumSquares: data.reduce((sum, value) => sum + value * value, 0) });
    }
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    recordingManager.cancelRecording();
    expect(listener).not.toHaveBeenCalled();
    expect(capture.getStats()).toMatchObject({ bytes: 0, pending: 0, runs: 0 });
  });

  it('maps loop preview to the new source interval while preserving the previous latency tail', async () => {
    const node = await openCapture();
    recordingManager.beginRecording({ trackId: 't', startContextTime: 3000 / SAMPLE_RATE,
      timelineStartMs: 5000, roundTripMs: 1 });
    node.emitFrames(2048, 1452);
    const closedPromise = recordingManager.splitSegment({ endContextTime: 3500 / SAMPLE_RATE, nextTimelineStartMs: 5000 });
    expect(recordingManager.getWaveformSnapshot()).toMatchObject({ sourceStartFrame: 3548,
      sourceEndFrame: 3548, recordingStartMs: 5000 });
    node.emitFrames(3500, 900, 2);
    const closed = await closedPromise;
    expect(closed.audioBuffer.length).toBe(500);
    expect(closed.audioBuffer.getChannelData(0)[0]).toBe(3048);
    expect(closed.audioBuffer.getChannelData(0)[499]).toBe(3547);
    await finishWaveformTasks();
    const snapshot = recordingManager.getWaveformSnapshot();
    expect(snapshot).toMatchObject({ sourceStartFrame: 3548, sourceEndFrame: 4400, numberOfChannels: 2 });
    expect(readWaveform(snapshot.capture, 1, 3548, 3550)).toMatchObject({
      min: 1003548, max: 1003549, count: 2,
    });
    const final = await recordingManager.stopRecording({ endContextTime: 3900 / SAMPLE_RATE });
    expect(final.audioBuffer.getChannelData(0)[0]).toBe(3548);
    expect(final.audioBuffer.getChannelData(0)[399]).toBe(3947);
    expect(final.audioBuffer.length).toBe(400);
    expect(recordingManager.getWaveformSnapshot()).toBeNull();
  });

  it('allows a new take while an older stop is still collecting its tail', async () => {
    const node = await openCapture();
    recordingManager.beginRecording({ trackId: 'old', startContextTime: 3000 / SAMPLE_RATE,
      timelineStartMs: 0, roundTripMs: 1 });
    node.emitFrames(2048, 1452);
    const oldResult = recordingManager.stopRecording({ endContextTime: 3500 / SAMPLE_RATE });
    await flushMicrotasks();
    recordingManager.beginRecording({ trackId: 'new', startContextTime: 3600 / SAMPLE_RATE,
      timelineStartMs: 1000, roundTripMs: 1 });
    node.emitFrames(3500, 1000);
    const old = await oldResult;
    expect(old.trackId).toBe('old');
    expect(old.audioBuffer.length).toBe(500);
    expect(old.audioBuffer.getChannelData(0)[499]).toBe(3547);
    await finishWaveformTasks();
    expect(recordingManager.getWaveformSnapshot()).toMatchObject({ trackId: 'new', sourceStartFrame: 3648 });
    const next = await recordingManager.stopRecording({ endContextTime: 4000 / SAMPLE_RATE });
    expect(next.audioBuffer.getChannelData(0)[0]).toBe(3648);
    expect(next.audioBuffer.length).toBe(400);
  });

  it('cancels an outstanding stop/tail immediately and never publishes a stale finalized segment', async () => {
    const node = await openCapture();
    recordingManager.beginRecording({ trackId: 't', startContextTime: 2200 / SAMPLE_RATE,
      timelineStartMs: 0, roundTripMs: 1 });
    node.emitFrames(2048, 1000);
    const result = recordingManager.stopRecording({ endContextTime: 5000 / SAMPLE_RATE });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await flushMicrotasks();
    await flushMicrotasks();
    recordingManager.cancelRecording();
    await rejected;
    expect(recordingManager.frameWaiters).toHaveLength(0);
    expect(recordingManager.pendingSegments).toHaveLength(0);
    expect(recordingManager.getWaveformSnapshot()).toBeNull();
    node.emitFrames(3048, 3000);
    await flushMicrotasks();
    expect(recordingManager.getWaveformSnapshot()).toBeNull();
  });

  it('keeps stereo input as two channels', async () => {
    const node = await openCapture();
    for (let frame = 2048; frame < SAMPLE_RATE; frame += 2048) node.emitFrames(frame, 2048, 2);
    recordingManager.beginRecording({ trackId: 't', startContextTime: 0.1, timelineStartMs: 0, roundTripMs: 0 });
    const result = await recordingManager.stopRecording({ endContextTime: 0.5 });
    expect(result.audioBuffer.numberOfChannels).toBe(2);
    expect(result.audioBuffer.getChannelData(1)[0]).toBe(SAMPLE_RATE * 0.1 + 1_000_000);
  });
});
