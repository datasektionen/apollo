import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioManager } from '../audioManager';

function makeProject() {
  return {
    masterVolume: 100,
    loop: { enabled: false, startMs: 0, endMs: 0 },
    tracks: [
      {
        id: 'track-1',
        name: 'Backing Track',
        role: 'instrument',
        volume: 100,
        pan: 0,
        muted: false,
        soloed: false,
        clips: [
          {
            id: 'clip-1',
            blobId: 'blob-1',
            timelineStartMs: 0,
            cropStartMs: 0,
            cropEndMs: 5000,
            gainDb: 0,
            muted: false,
          },
        ],
      },
    ],
  };
}

describe('Recording Sync and Buffer Jitter Detection', () => {
  let mockContext;
  let startedSources;

  beforeEach(() => {
    vi.clearAllMocks();
    startedSources = [];

    mockContext = {
      state: 'running',
      sampleRate: 48000,
      currentTime: 10.0,
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 1.0 },
        channelCount: 2,
      })),
      createStereoPanner: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        pan: { value: 0 },
      })),
      createDynamicsCompressor: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 1 },
        attack: { value: 0 },
        release: { value: 0.1 },
      })),
      createWaveShaper: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        curve: null,
        oversample: '4x',
      })),
      createBufferSource: vi.fn(() => {
        const source = {
          buffer: null,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn((when, offset, duration) => {
            source.startWhen = when;
            source.startOffset = offset;
            source.startDuration = duration;
            startedSources.push(source);
          }),
          stop: vi.fn(),
          onended: null,
        };
        return source;
      }),
      destination: {
        maxChannelCount: 2,
        channelCount: 2,
      },
      resume: vi.fn().mockResolvedValue(undefined),
    };

    audioManager.audioContext = mockContext;
    audioManager.mediaCache.set('blob-1', { duration: 5 });
  });

  afterEach(() => {
    audioManager.stop();
  });

  it('detects whether playback scheduling has lookahead headroom to prevent buffer slip', async () => {
    let notifiedEvent = null;
    const unsub = audioManager.subscribePlaybackStarted((event) => {
      notifiedEvent = event;
    });

    const project = makeProject();
    mockContext.currentTime = 10.0;

    await audioManager.play(project, 0);
    unsub();

    expect(startedSources.length).toBeGreaterThan(0);
    const scheduledWhen = startedSources[0].startWhen;

    // Detect if scheduled without lookahead (zero headroom)
    // When scheduled with when <= currentTime, Web Audio renders on the next hardware
    // buffer callback, causing ~10-16 ms timing jitter between takes depending on whether
    // the callback boundary was caught or missed.
    const lookaheadSec = scheduledWhen - 10.0;
    
    // We expect scheduledWhen to have safe lookahead headroom (e.g. >= 20ms)
    // so hardware buffers never slip.
    expect(lookaheadSec).toBeGreaterThanOrEqual(0.02);
    expect(notifiedEvent.contextTime).toBeCloseTo(scheduledWhen, 4);
  });

  it('detects timing variance across 3 simulated takes when main-thread delay occurs', async () => {
    const project = makeProject();
    const takeDelays = [];

    for (let take = 1; take <= 3; take += 1) {
      startedSources = [];
      mockContext.currentTime = 10.0 * take;

      let notifiedEvent = null;
      const unsub = audioManager.subscribePlaybackStarted((event) => {
        notifiedEvent = event;
      });

      // Simulate slight main-thread jitter between takes (e.g. React render, GC, clip scheduling)
      // Take 1: 3ms jitter (misses zero-headroom buffer)
      // Take 2: 0.2ms jitter (catches zero-headroom buffer)
      // Take 3: 4ms jitter (misses zero-headroom buffer)
      const threadJitterSec = take === 2 ? 0.0002 : 0.0035;

      const playPromise = audioManager.play(project, 0);
      mockContext.currentTime += threadJitterSec;
      await playPromise;
      unsub();

      const sourceWhen = startedSources[0].startWhen;
      const scheduledHeadroom = sourceWhen - mockContext.currentTime;
      takeDelays.push(scheduledHeadroom);
    }

    // If there is no lookahead, scheduledHeadroom becomes negative during jitter (take 1 & 3),
    // which causes the hardware to push playback to the next buffer (~15ms slip).
    // With proper lookahead (e.g. 40-50ms), headroom remains comfortably positive (> 0.015s) for ALL takes.
    for (const headroom of takeDelays) {
      expect(headroom).toBeGreaterThanOrEqual(0.015);
    }
  });

  it('verifies calibration signal bypasses limiter/ceiling DSP latency while recording compensates for it', () => {
    // When calibration audio passes through masterLimiterNode (DynamicsCompressor)
    // and masterCeilingNode (WaveShaper with oversample: "4x"):
    // In Web Audio, DynamicsCompressor lookahead = 128 samples (2.67ms @ 48kHz).
    // WaveShaper 4x oversampling decimation FIR filter = 256 samples (5.33ms @ 48kHz).
    // Total DSP delay = 384 samples = 8.0ms.
    // BandLab bypasses master limiters/shapers for its latency test, which explains why
    // BandLab's reported latency is ~8ms lower than Apollo's.
    // With getCalibrationInputNode() routing directly to destination / output target,
    // calibration measures pure hardware roundtrip (matching BandLab), while getMasterDspLatencyMs()
    // automatically compensates for the master limiter/ceiling stage during recording.
    audioManager.outputTargetNode = mockContext.destination;
    audioManager.masterLimiterNode = { threshold: { value: -1 } };
    audioManager.masterCeilingNode = { oversample: '4x' };

    const calibrationNode = audioManager.getCalibrationInputNode();
    expect(calibrationNode).toBe(mockContext.destination);

    const dspLatencyMs = audioManager.getMasterDspLatencyMs();
    expect(dspLatencyMs).toBeCloseTo(8.0, 1);

    // If BandLab or hardware calibration measured 142ms:
    const hardwareOffsetMs = 142;
    const effectiveRecordingOffsetMs = hardwareOffsetMs + dspLatencyMs;
    expect(effectiveRecordingOffsetMs).toBeCloseTo(150.0, 1);
  });
});
