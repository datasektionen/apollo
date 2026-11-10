import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioManager } from '../audioManager';

describe('Audio Diagnostics and Emergency Bypass', () => {
  let mockContext;
  let mockMasterGain;
  let mockLimiter;
  let mockCeiling;
  let mockStretchNode;

  beforeEach(() => {
    vi.clearAllMocks();

    mockMasterGain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1.0 },
      channelCount: 2,
    };

    mockLimiter = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 20 },
      attack: { value: 0 },
      release: { value: 0.1 },
    };

    mockCeiling = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      curve: null,
      oversample: '4x',
    };

    mockStretchNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      schedule: vi.fn(),
      configure: vi.fn(),
      port: {
        onmessage: null,
        postMessage: vi.fn(),
      },
    };

    mockContext = {
      state: 'running',
      sampleRate: 48000,
      currentTime: 12.34,
      createGain: vi.fn(() => mockMasterGain),
      createDynamicsCompressor: vi.fn(() => mockLimiter),
      createWaveShaper: vi.fn(() => mockCeiling),
      createStereoPanner: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        pan: { value: 0 },
      })),
      destination: {
        maxChannelCount: 2,
        channelCount: 2,
      },
      audioWorklet: {
        addModule: vi.fn().mockResolvedValue(undefined),
      },
      resume: vi.fn().mockResolvedValue(undefined),
    };

    audioManager.audioContext = mockContext;
    audioManager.masterGainNode = mockMasterGain;
    audioManager.masterSafetyInputNode = mockLimiter;
    audioManager.masterLimiterNode = mockLimiter;
    audioManager.masterCeilingNode = mockCeiling;
    audioManager.masterOutputNode = mockCeiling;
    audioManager.stretchNode = mockStretchNode;
    audioManager.isStretchConnected = false;
    audioManager.bypassStretch = false;
    audioManager.activeSources = new Map([
      ['t1-c1', { source: { playbackRate: { value: 1.25 } } }],
      ['t2-c2', { source: { playbackRate: { value: 1.25 } } }],
    ]);
  });

  it('provides comprehensive diagnostic snapshot via getAudioDiagnostics()', () => {
    audioManager.currentPlaybackRate = 1.25;
    audioManager.isPlaying = true;

    const diag = audioManager.getAudioDiagnostics();
    expect(diag.contextState).toBe('running');
    expect(diag.sampleRate).toBe(48000);
    expect(diag.currentTime).toBe(12.34);
    expect(diag.isPlaying).toBe(true);
    expect(diag.playbackRate).toBe(1.25);
    expect(diag.activeSourcesCount).toBe(2);
    expect(diag.workletLoaded).toBe(true);
    expect(diag.bypassStretch).toBe(false);
    expect(diag.worklet).toBeDefined();
  });

  it('subscribes to diagnostics updates via subscribeAudioDiagnostics()', () => {
    const listener = vi.fn();
    const unsubscribe = audioManager.subscribeAudioDiagnostics(listener);

    // Initial delivery
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      contextState: 'running',
      playbackRate: expect.any(Number),
    }));

    audioManager.notifyDiagnosticsListeners();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    audioManager.notifyDiagnosticsListeners();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('switches to direct routing and disconnects stretchNode when bypass is enabled', () => {
    // Normal in-line stretch routing
    audioManager.wireMasterAudioGraph();
    expect(mockMasterGain.connect).toHaveBeenCalledWith(mockStretchNode);
    expect(mockStretchNode.connect).toHaveBeenCalledWith(mockLimiter);
    expect(audioManager.isStretchConnected).toBe(true);

    mockMasterGain.connect.mockClear();
    mockStretchNode.disconnect.mockClear();

    // Enable Emergency Bypass
    audioManager.setBypassStretch(true);

    expect(audioManager.bypassStretch).toBe(true);
    expect(mockStretchNode.disconnect).toHaveBeenCalled();
    expect(mockMasterGain.connect).toHaveBeenCalledWith(mockLimiter);
    expect(audioManager.isStretchConnected).toBe(false);

    // Restore stretch engine
    mockMasterGain.connect.mockClear();
    audioManager.setBypassStretch(false);

    expect(audioManager.bypassStretch).toBe(false);
    expect(mockMasterGain.connect).toHaveBeenCalledWith(mockStretchNode);
    expect(audioManager.isStretchConnected).toBe(true);
  });

  it('updates latestStretchDiagnostics when worklet posts diagnostics messages', async () => {
    // Emulate ensureStretchNode message listener
    const listener = vi.fn();
    audioManager.subscribeAudioDiagnostics(listener);

    // Trigger message event on stretchNode.port
    const onmessage = vi.fn((event) => {
      const [msgType, payload] = event.data;
      if (msgType === 'diagnostics') {
        audioManager.latestStretchDiagnostics = {
          inRmsDb: -16.5,
          outRmsDb: -16.8,
          active: payload.active,
          semitones: payload.semitones,
          tonalityHz: payload.tonalityHz,
          channels: payload.channels,
          updatedAt: Date.now(),
        };
        audioManager.notifyDiagnosticsListeners();
      }
    });

    onmessage({
      data: ['diagnostics', {
        inRms: 0.15,
        outRms: 0.145,
        active: true,
        semitones: -3.86,
        tonalityHz: 6000,
        channels: 2,
      }],
    });

    const diag = audioManager.getAudioDiagnostics();
    expect(diag.worklet.inRmsDb).toBe(-16.5);
    expect(diag.worklet.outRmsDb).toBe(-16.8);
    expect(diag.worklet.active).toBe(true);
    expect(diag.worklet.semitones).toBe(-3.86);
  });
});
