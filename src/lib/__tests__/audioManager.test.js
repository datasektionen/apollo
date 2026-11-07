import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPanLawHeadroomGain } from '../../utils/audio';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeProject() {
  return {
    masterVolume: 100,
    loop: { enabled: false, startMs: 0, endMs: 0 },
    tracks: [
      {
        id: 'track-1',
        name: 'Track 1',
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
            cropEndMs: 2000,
            gainDb: 0,
            muted: false,
          },
        ],
      },
    ],
  };
}

function makeProjectWithMetronome({ metronomeMuted = false } = {}) {
  const project = makeProject();
  project.tracks.push({
    id: 'metro-1',
    name: 'Click',
    role: 'metronome',
    volume: 100,
    pan: 0,
    muted: metronomeMuted,
    soloed: false,
    clips: [
      {
        id: 'metro-clip-1',
        blobId: 'blob-metro',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 2000,
        gainDb: 0,
        muted: false,
      },
    ],
  });
  return project;
}

describe('AudioManager playback requests', () => {
  let routingPlayback;
  let startedSources;
  let createdAudioElements;
  let audioContextOptions;
  let audioContextSetSinkId;
  let outputDevices;
  let deviceChangeListeners;
  let originalMediaDevices;

  beforeEach(() => {
    vi.resetModules();
    routingPlayback = deferred();
    startedSources = [];
    createdAudioElements = [];
    audioContextOptions = [];
    audioContextSetSinkId = null;
    outputDevices = [
      { kind: 'audiooutput', deviceId: 'headphones', label: 'Headphones' },
      { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
    ];
    deviceChangeListeners = [];
    originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        addEventListener: (type, handler) => {
          if (type === 'devicechange') deviceChangeListeners.push(handler);
        },
        removeEventListener: (type, handler) => {
          deviceChangeListeners = deviceChangeListeners.filter((item) => item !== handler);
        },
        enumerateDevices: vi.fn(async () => outputDevices.slice()),
      },
    });

    class MockAudioNode {
      constructor() {
        this.gain = { value: 1 };
        this.pan = { value: 0 };
        this.threshold = { value: 0 };
        this.knee = { value: 0 };
        this.ratio = { value: 1 };
        this.attack = { value: 0 };
        this.release = { value: 0 };
        this.curve = null;
        this.oversample = 'none';
        this.channelCount = 2;
        this.channelCountMode = 'explicit';
        this.channelInterpretation = 'speakers';
        this.connections = [];
      }

      connect(node) {
        this.connections.push(node);
      }

      disconnect() {}
    }

    class MockAudioContext {
      constructor(options) {
        audioContextOptions.push(options);
        this.currentTime = 10;
        this.state = 'running';
        this.sampleRate = options?.sampleRate || 48000;
        this.sinkId = '';
        this.destination = new MockAudioNode();
        this.destination.maxChannelCount = 2;
        this.eventListeners = {
          statechange: [],
          sinkchange: [],
        };
        if (audioContextSetSinkId) {
          this.setSinkId = async (deviceId) => {
            const result = await audioContextSetSinkId(deviceId);
            this.sinkId = String(deviceId || '');
            return result;
          };
        }
      }

      addEventListener(type, handler) {
        if (!this.eventListeners[type]) this.eventListeners[type] = [];
        this.eventListeners[type].push(handler);
      }

      removeEventListener(type, handler) {
        if (!this.eventListeners[type]) return;
        this.eventListeners[type] = this.eventListeners[type].filter((item) => item !== handler);
      }

      dispatchEvent(type) {
        for (const handler of this.eventListeners[type] || []) {
          handler();
        }
      }

      createGain() {
        return new MockAudioNode();
      }

      createStereoPanner() {
        return new MockAudioNode();
      }

      createDynamicsCompressor() {
        return new MockAudioNode();
      }

      createWaveShaper() {
        return new MockAudioNode();
      }

      createBufferSource() {
        const source = {
          buffer: null,
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
      }

      createMediaStreamDestination() {
        return { stream: {} };
      }

      resume() {
        return Promise.resolve();
      }

      close() {
        return Promise.resolve();
      }
    }

    class MockAudioElement {
      constructor() {
        this.autoplay = false;
        this.preload = '';
        this.srcObject = null;
        createdAudioElements.push(this);
      }

      setSinkId() {
        return Promise.resolve();
      }

      play() {
        return routingPlayback.promise;
      }

      pause() {}
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('webkitAudioContext', MockAudioContext);
    vi.stubGlobal('Audio', MockAudioElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: originalMediaDevices,
    });
  });

  it('only starts the latest play request when initialization overlaps', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const firstPlay = manager.play(makeProject(), 0);
    const secondPlay = manager.play(makeProject(), 500);

    routingPlayback.resolve();
    await Promise.all([firstPlay, secondPlay]);

    expect(startedSources).toHaveLength(1);
    expect(manager.activeSources.size).toBe(1);
    expect(manager.startTime).toBeCloseTo(9.5);
  });

  it('applies the stored project master separately from the player output volume', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    manager.setOutputVolume(50);

    const project = makeProject();
    project.masterVolume = 25;
    await manager.play(project, 0);

    expect(manager.currentMasterVolume).toBe(25);
    expect(manager.currentOutputVolume).toBe(50);
    expect(manager.masterGainNode.gain.value).toBeCloseTo(
      manager.getMasterVolumeGain()
        * manager.getOutputVolumeGain()
        * getPanLawHeadroomGain(),
      8
    );
  });

  it('creates a final limiter and sub-0 dBFS safety ceiling for live playback', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    await manager.init();

    expect(manager.masterLimiterNode.threshold.value).toBe(-1);
    expect(manager.masterLimiterNode.ratio.value).toBe(20);
    expect(manager.masterCeilingNode.oversample).toBe('4x');
    expect(Math.max(...manager.masterCeilingNode.curve)).toBeLessThan(1);
    expect(Math.min(...manager.masterCeilingNode.curve)).toBeGreaterThan(-1);
    expect(manager.masterOutputNode).toBe(manager.masterCeilingNode);
    expect(manager.masterOutputNode.connections).toContain(manager.audioContext.destination);
  });

  it('does not start sources after a pending play request is stopped', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const playPromise = manager.play(makeProject(), 0);
    manager.stop();

    routingPlayback.resolve();
    await playPromise;

    expect(startedSources).toHaveLength(0);
    expect(manager.activeSources.size).toBe(0);
    expect(manager.isPlaying).toBe(false);
  });

  it('keeps muted metronome sources scheduled so mute can change without restarting', async () => {
    const { AudioManager, getPlaybackTrackState } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    manager.mediaCache.set('blob-metro', { duration: 2 });

    routingPlayback.resolve();
    await manager.play(makeProjectWithMetronome({ metronomeMuted: true }), 500);

    expect(startedSources).toHaveLength(2);
    expect(manager.activeSources.size).toBe(2);
    expect(manager.isPlaying).toBe(true);
    expect(manager.startTime).toBeCloseTo(9.5);
    expect(manager.activeSources.get('metro-1-metro-clip-1').gainNode.gain.value).toBe(0);

    const playbackRequestId = manager.playbackRequestId;
    const startTime = manager.startTime;
    startedSources.forEach((source) => source.stop.mockClear());

    manager.updateTrackMix('metro-1', 1, 0);

    expect(manager.playbackRequestId).toBe(playbackRequestId);
    expect(manager.startTime).toBe(startTime);
    expect(manager.isPlaying).toBe(true);
    expect(startedSources).toHaveLength(2);
    startedSources.forEach((source) => {
      expect(source.stop).not.toHaveBeenCalled();
    });
    expect(manager.activeSources.get('metro-1-metro-clip-1').gainNode.gain.value).toBeGreaterThan(0);

    const mutedState = getPlaybackTrackState(
      { role: 'metronome' },
      { audible: false, effectiveGain: 0.8, effectivePan: 12 }
    );
    expect(mutedState).toEqual({
      schedule: true,
      audible: false,
      effectiveGain: 0,
      effectivePan: 12,
    });
  });

  it('keeps muted non-metronome sources scheduled so mute can change without restarting', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    routingPlayback.resolve();
    const project = makeProject();
    project.tracks[0].muted = true;
    await manager.play(project, 500);

    expect(startedSources).toHaveLength(1);
    expect(manager.activeSources.get('track-1-clip-1').gainNode.gain.value).toBe(0);

    const playbackRequestId = manager.playbackRequestId;
    const startTime = manager.startTime;
    startedSources.forEach((source) => source.stop.mockClear());

    manager.updateTrackMix('track-1', 1, 0);

    expect(manager.playbackRequestId).toBe(playbackRequestId);
    expect(manager.startTime).toBe(startTime);
    expect(startedSources).toHaveLength(1);
    expect(startedSources[0].stop).not.toHaveBeenCalled();
    expect(manager.activeSources.get('track-1-clip-1').gainNode.gain.value).toBeGreaterThan(0);
  });

  it('does not schedule tracks excluded from the live-mixable set', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    manager.mediaCache.set('blob-metro', { duration: 2 });

    routingPlayback.resolve();
    await manager.play(makeProjectWithMetronome(), 0, {
      liveMixableTrackIds: new Set(['metro-1']),
    });

    expect(startedSources).toHaveLength(1);
    expect(manager.activeSources.has('metro-1-metro-clip-1')).toBe(true);
    expect(manager.activeSources.has('track-1-clip-1')).toBe(false);
  });

  it('uses the hardware sample rate and native destination for default output', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    await manager.play(makeProject(), 0);

    expect(audioContextOptions[0]?.sampleRate).toBeUndefined();
    expect(audioContextOptions[0]?.latencyHint).toBe('playback');
    expect(manager.audioContext.sampleRate).toBe(48000);
    expect(createdAudioElements).toHaveLength(0);
    expect(manager.outputTargetNode).toBe(manager.audioContext.destination);
    expect(manager.masterOutputNode.connections).toContain(manager.audioContext.destination);
    expect(startedSources).toHaveLength(1);
  });

  it('routes through a media element only when a custom sink cannot use AudioContext.setSinkId', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    manager.currentOutputDeviceId = 'headphones';

    const playPromise = manager.play(makeProject(), 0);
    routingPlayback.resolve();
    await playPromise;

    expect(createdAudioElements).toHaveLength(1);
    expect(manager.outputTargetNode).toBe(manager.outputStreamDestination);
    expect(manager.masterOutputNode.connections).toContain(manager.outputStreamDestination);
    expect(startedSources).toHaveLength(1);
  });

  it('prefers AudioContext.setSinkId over media-element routing', async () => {
    audioContextSetSinkId = vi.fn().mockResolvedValue(undefined);
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    manager.currentOutputDeviceId = 'headphones';

    await manager.play(makeProject(), 0);

    expect(audioContextSetSinkId).toHaveBeenCalledWith('headphones');
    expect(createdAudioElements).toHaveLength(0);
    expect(manager.outputTargetNode).toBe(manager.audioContext.destination);
    expect(startedSources).toHaveLength(1);
  });

  it('does not resample decoded audio that already matches the live context rate', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    await manager.init();
    manager.audioContext.decodeAudioData = vi.fn().mockResolvedValue({
      sampleRate: 48000,
      duration: 1,
      numberOfChannels: 1,
    });
    const resampleSpy = vi.spyOn(manager, 'resampleAudioBuffer');

    const decoded = await manager.decodeAudioFile(new ArrayBuffer(8));

    expect(decoded.sampleRate).toBe(48000);
    expect(resampleSpy).not.toHaveBeenCalled();
  });

  it('decodes FLAC with the software decoder when native decodeAudioData fails', async () => {
    const { audioBufferToFlacBlob } = await import('../mediaEncoding');
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    await manager.init();
    manager.audioContext.createBuffer = (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (channel) => data[channel],
      };
    };
    manager.audioContext.decodeAudioData = vi.fn().mockRejectedValue(
      Object.assign(new Error('Decoding failed'), { name: 'EncodingError' })
    );

    const frames = 32;
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) samples[i] = (i / frames) - 0.5;
    const source = {
      numberOfChannels: 1,
      length: frames,
      sampleRate: 48000,
      getChannelData: () => samples,
    };
    const flac = await (await audioBufferToFlacBlob(source)).arrayBuffer();
    const decoded = await manager.decodeAudioFile(flac);

    expect(manager.audioContext.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(decoded.numberOfChannels).toBe(1);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.length).toBe(frames);
    expect(decoded.getChannelData(0)[0]).toBeCloseTo(samples[0], 4);
  });

  it('reuses mix nodes on seek and starts the new source at the same audio time the old one stops', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    await manager.play(makeProject(), 0);
    expect(startedSources).toHaveLength(1);

    const nodes = manager.activeSources.get('track-1-clip-1');
    const previousSource = nodes.source;
    const gainNode = nodes.gainNode;
    const panNode = nodes.panNode;
    const createdAudioCount = createdAudioElements.length;

    await manager.seek(makeProject(), 500);

    expect(manager.isPlaying).toBe(true);
    expect(manager.startTime).toBeCloseTo(9.5);
    expect(manager.activeSources.get('track-1-clip-1').gainNode).toBe(gainNode);
    expect(manager.activeSources.get('track-1-clip-1').panNode).toBe(panNode);
    expect(createdAudioElements).toHaveLength(createdAudioCount);
    expect(previousSource.stop).toHaveBeenCalledWith(10);
    expect(previousSource.disconnect).toHaveBeenCalled();
    expect(startedSources).toHaveLength(2);
    const nextSource = manager.activeSources.get('track-1-clip-1').source;
    expect(nextSource).not.toBe(previousSource);
    expect(nextSource.startWhen).toBe(10);
    expect(nextSource.startOffset).toBeCloseTo(0.5);
    expect(nextSource.startDuration).toBeCloseTo(1.5);
  });

  it('does not start sources when seeking while paused', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    await manager.play(makeProject(), 0);
    await manager.pause(250);
    const startedCount = startedSources.length;

    await manager.seek(makeProject(), 900);

    expect(manager.isPlaying).toBe(false);
    expect(manager.pauseTime).toBe(900);
    expect(startedSources).toHaveLength(startedCount);
    expect(manager.activeSources.size).toBe(0);
  });

  it('pauses playback when AudioContext is interrupted or suspended', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    const interrupted = vi.fn();
    manager.subscribePlaybackInterrupted(interrupted);

    await manager.play(makeProject(), 250);
    expect(manager.isPlaying).toBe(true);

    manager.audioContext.state = 'interrupted';
    manager.audioContext.dispatchEvent('statechange');

    expect(manager.isPlaying).toBe(false);
    expect(manager.pauseTime).toBe(250);
    expect(interrupted).toHaveBeenCalledWith({
      reason: 'context-interrupted',
      timeMs: 250,
    });
  });

  it('pauses when the selected output device is unplugged', async () => {
    audioContextSetSinkId = vi.fn().mockResolvedValue(undefined);
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    manager.currentOutputDeviceId = 'headphones';

    await manager.play(makeProject(), 0);
    expect(manager.isPlaying).toBe(true);
    expect(deviceChangeListeners).toHaveLength(1);

    outputDevices = [{ kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' }];
    deviceChangeListeners[0]();
    await vi.waitFor(() => {
      expect(manager.isPlaying).toBe(false);
    });
  });

  it('pauses default-output playback when an output route is removed', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    await manager.play(makeProject(), 0);
    expect(manager.isPlaying).toBe(true);

    outputDevices = [{ kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' }];
    deviceChangeListeners[0]();
    await vi.waitFor(() => {
      expect(manager.isPlaying).toBe(false);
    });
  });

  it('does not pause when a new output is connected', async () => {
    outputDevices = [{ kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' }];
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    await manager.play(makeProject(), 0);
    outputDevices = [
      { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
      { kind: 'audiooutput', deviceId: 'headphones', label: 'Headphones' },
    ];
    deviceChangeListeners[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.isPlaying).toBe(true);
  });

  it('pauses when a custom sink cannot be applied during playback', async () => {
    audioContextSetSinkId = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disconnected'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    await manager.play(makeProject(), 0);
    await manager.setPlaybackOutputConfig({ outputDeviceId: 'headphones' });

    expect(manager.isPlaying).toBe(false);
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('updates clip gain in real time without restarting the buffer source', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const project = makeProject();
    await manager.play(project, 0);

    const nodes = manager.activeSources.get('track-1-clip-1');
    expect(nodes).toBeDefined();
    const source = nodes.source;
    expect(source).toBeDefined();
    const initialGain = nodes.gainNode.gain.value;

    manager.updateClipGain('track-1', 'clip-1', -6);
    expect(nodes.gainNode.gain.value).toBeCloseTo(initialGain * Math.pow(10, -6 / 20), 4);
    expect(source.stop).not.toHaveBeenCalled();
    expect(nodes.source).toBe(source);
  });

  it('synchronizes clip gain changes during playback without restarting source', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const project = makeProject();
    await manager.play(project, 0);

    const nodes = manager.activeSources.get('track-1-clip-1');
    const source = nodes.source;
    const initialGain = nodes.gainNode.gain.value;

    const updatedProject = {
      ...project,
      tracks: [
        {
          ...project.tracks[0],
          clips: [
            {
              ...project.tracks[0].clips[0],
              gainDb: -10,
            },
          ],
        },
      ],
    };

    manager.syncProjectClips(updatedProject);
    expect(nodes.gainNode.gain.value).toBeCloseTo(initialGain * Math.pow(10, -10 / 20), 4);
    expect(source.stop).not.toHaveBeenCalled();
    expect(nodes.source).toBe(source);
  });

  it('stops active source and mix nodes when clip is muted during playback', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const project = makeProject();
    await manager.play(project, 0);

    const nodes = manager.activeSources.get('track-1-clip-1');
    const source = nodes.source;

    const mutedProject = {
      ...project,
      tracks: [
        {
          ...project.tracks[0],
          clips: [
            {
              ...project.tracks[0].clips[0],
              muted: true,
            },
          ],
        },
      ],
    };

    manager.syncProjectClips(mutedProject);
    expect(source.stop).toHaveBeenCalled();
    expect(manager.activeSources.has('track-1-clip-1')).toBe(false);
  });

  it('starts buffer source when clip is unmuted during playback', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const project = makeProject();
    project.tracks[0].clips[0].muted = true;
    await manager.play(project, 0);

    expect(manager.activeSources.has('track-1-clip-1')).toBe(false);

    const unmutedProject = {
      ...project,
      tracks: [
        {
          ...project.tracks[0],
          clips: [
            {
              ...project.tracks[0].clips[0],
              muted: false,
            },
          ],
        },
      ],
    };

    manager.syncProjectClips(unmutedProject);
    expect(manager.activeSources.has('track-1-clip-1')).toBe(true);
    const nodes = manager.activeSources.get('track-1-clip-1');
    expect(nodes.source).toBeDefined();
    expect(nodes.source.start).toHaveBeenCalled();
  });

  it('stops active source and mix nodes when clip is deleted during playback', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const project = makeProject();
    await manager.play(project, 0);

    const nodes = manager.activeSources.get('track-1-clip-1');
    const source = nodes.source;

    const deletedClipProject = {
      ...project,
      tracks: [
        {
          ...project.tracks[0],
          clips: [],
        },
      ],
    };

    manager.syncProjectClips(deletedClipProject);
    expect(source.stop).toHaveBeenCalled();
    expect(manager.activeSources.has('track-1-clip-1')).toBe(false);
  });

  it('re-schedules buffer source when clip timing or crop changes during playback', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 5 });

    const project = makeProject();
    project.tracks[0].clips[0].cropEndMs = 5000;
    await manager.play(project, 0);

    const oldNodes = manager.activeSources.get('track-1-clip-1');
    const oldSource = oldNodes.source;

    const retimedProject = {
      ...project,
      tracks: [
        {
          ...project.tracks[0],
          clips: [
            {
              ...project.tracks[0].clips[0],
              cropStartMs: 1000,
            },
          ],
        },
      ],
    };

    manager.syncProjectClips(retimedProject);
    expect(oldSource.stop).toHaveBeenCalled();
    const currentNodes = manager.activeSources.get('track-1-clip-1');
    expect(currentNodes.source).toBeDefined();
    expect(currentNodes.source).not.toBe(oldSource);
    expect(currentNodes.cropStartMs).toBe(1000);
  });

  it('starts source when a new clip is added during playback', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });
    manager.mediaCache.set('blob-2', { duration: 3 });

    const project = makeProject();
    await manager.play(project, 0);

    const addedClipProject = {
      ...project,
      tracks: [
        {
          ...project.tracks[0],
          clips: [
            ...project.tracks[0].clips,
            {
              id: 'clip-2',
              blobId: 'blob-2',
              timelineStartMs: 0,
              cropStartMs: 0,
              cropEndMs: 3000,
              gainDb: 0,
              muted: false,
            },
          ],
        },
      ],
    };

    manager.syncProjectClips(addedClipProject);
    expect(manager.activeSources.has('track-1-clip-1')).toBe(true);
    expect(manager.activeSources.has('track-1-clip-2')).toBe(true);
    const clip2Nodes = manager.activeSources.get('track-1-clip-2');
    expect(clip2Nodes.source).toBeDefined();
    expect(clip2Nodes.source.start).toHaveBeenCalled();
  });
});
