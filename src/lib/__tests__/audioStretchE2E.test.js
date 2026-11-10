import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

describe('SignalsmithStretch Web Audio Graph E2E Verification', () => {
  let WasmProcessorClass;
  let stretchCode;

  beforeEach(async () => {
    stretchCode = fs.readFileSync(
      path.resolve(__dirname, '../../../public/signalsmith-stretch.js'),
      'utf8'
    );

    let capturedProcessor = null;
    const workletSandbox = {
      console,
      setTimeout,
      clearTimeout,
      sampleRate: 48000,
      currentTime: 0,
      registerProcessor: (name, proc) => {
        capturedProcessor = proc;
      },
      AudioWorkletProcessor: class {
        constructor() {
          this.port = {
            onmessage: null,
            postMessage: (msg) => {
              if (this.peerPort?.onmessage) {
                this.peerPort.onmessage({ data: msg });
              }
            },
          };
        }
      },
    };

    vm.createContext(workletSandbox);
    vm.runInContext(stretchCode, workletSandbox);

    await new Promise((resolve) => setTimeout(resolve, 150));
    WasmProcessorClass = capturedProcessor;
  });

  /**
   * Helper to create a functional simulated AudioGraph that processes real Float32Array PCM blocks
   */
  function createAudioGraphSimulation() {
    const sampleRate = 48000;
    const blockSize = 128;
    let graphCurrentTime = 0;

    class SimNode {
      constructor(name) {
        this.name = name;
        this.inputs = [];
        this.outputs = new Set();
      }

      connect(dest) {
        if (!dest) return;
        this.outputs.add(dest);
        if (!dest.inputs.includes(this)) {
          dest.inputs.push(this);
        }
      }

      disconnect(target) {
        if (target) {
          this.outputs.delete(target);
          target.inputs = target.inputs.filter((n) => n !== this);
        } else {
          for (const out of this.outputs) {
            out.inputs = out.inputs.filter((n) => n !== this);
          }
          this.outputs.clear();
        }
      }

      // Default pass-through
      pull(channelCount) {
        const out = Array.from({ length: channelCount }, () => new Float32Array(blockSize));
        for (const inputNode of this.inputs) {
          const inBuf = inputNode.pull(channelCount);
          for (let c = 0; c < channelCount; c++) {
            for (let i = 0; i < blockSize; i++) {
              out[c][i] += inBuf[c][i];
            }
          }
        }
        return out;
      }
    }

    class SimGainNode extends SimNode {
      constructor(name = 'gain') {
        super(name);
        this.gain = { value: 1.0 };
      }

      pull(channelCount) {
        const out = super.pull(channelCount);
        const g = Number(this.gain.value) || 0;
        for (let c = 0; c < channelCount; c++) {
          for (let i = 0; i < blockSize; i++) {
            out[c][i] *= g;
          }
        }
        return out;
      }
    }

    class SimPannerNode extends SimNode {
      constructor(name = 'panner') {
        super(name);
        this.pan = { value: 0 };
      }

      pull(channelCount) {
        const inBuf = super.pull(channelCount);
        const pan = Math.max(-1, Math.min(1, Number(this.pan.value) || 0));
        const leftGain = Math.cos(((pan + 1) * Math.PI) / 4);
        const rightGain = Math.sin(((pan + 1) * Math.PI) / 4);
        const out = [new Float32Array(blockSize), new Float32Array(blockSize)];
        for (let i = 0; i < blockSize; i++) {
          out[0][i] = inBuf[0][i] * leftGain;
          out[1][i] = inBuf[1 ? 1 : 0][i] * rightGain;
        }
        return out;
      }
    }

    class SimStretchWorkletNode extends SimNode {
      constructor(name = 'stretchWorklet') {
        super(name);
        const proc = new WasmProcessorClass({
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.processor = proc;

        // Mock port communication between main thread and worklet
        this.port = {
          postMessage: (data) => {
            proc.port.onmessage?.({ data });
          },
        };
        proc.port.peerPort = this.port;

        // Attach remote methods from ready message
        this.schedule = (obj, adjustPrevious) => {
          return new Promise((resolve) => {
            const id = Math.random();
            this.port.postMessage([id, 'schedule', obj, adjustPrevious]);
            resolve(obj);
          });
        };
        this.configure = (config) => {
          return new Promise((resolve) => {
            const id = Math.random();
            this.port.postMessage([id, 'configure', config]);
            resolve();
          });
        };
      }

      pull(channelCount) {
        const inBuf = super.pull(channelCount);
        const outBuf = Array.from({ length: channelCount }, () => new Float32Array(blockSize));
        this.processor.process([inBuf], [outBuf], {});
        return outBuf;
      }
    }

    class SimBufferSourceNode extends SimNode {
      constructor(audioBuffer, name = 'bufferSource') {
        super(name);
        this.buffer = audioBuffer;
        this.playbackRate = {
          value: 1.0,
          setValueAtTime: (val) => {
            this.playbackRate.value = val;
          },
        };
        this.isPlaying = false;
        this.playheadSample = 0;
      }

      start(when, offset = 0, duration) {
        this.isPlaying = true;
        this.playheadSample = Math.round(offset * sampleRate);
        this.remainingDurationSamples = duration != null ? Math.round(duration * sampleRate) : Infinity;
      }

      stop() {
        this.isPlaying = false;
      }

      pull(channelCount) {
        const out = Array.from({ length: channelCount }, () => new Float32Array(blockSize));
        if (!this.isPlaying || !this.buffer) return out;

        const rate = Math.max(0.01, Number(this.playbackRate.value) || 1.0);
        const bufCh0 = this.buffer.getChannelData(0);
        const bufCh1 = this.buffer.numberOfChannels > 1 ? this.buffer.getChannelData(1) : bufCh0;

        for (let i = 0; i < blockSize; i++) {
          if (this.remainingDurationSamples <= 0 || this.playheadSample >= bufCh0.length) {
            this.isPlaying = false;
            break;
          }
          const idx = Math.floor(this.playheadSample);
          out[0][i] = bufCh0[idx] || 0;
          out[1][i] = bufCh1[idx] || 0;

          this.playheadSample += rate;
          this.remainingDurationSamples -= 1;
        }
        return out;
      }
    }

    const destination = new SimNode('destination');

    return {
      sampleRate,
      blockSize,
      destination,
      createGain: (name) => new SimGainNode(name),
      createPanner: (name) => new SimPannerNode(name),
      createStretchNode: (name) => new SimStretchWorkletNode(name),
      createBufferSource: (buffer, name) => new SimBufferSourceNode(buffer, name),
      createBuffer: (channels, length) => {
        const channelData = Array.from({ length: channels }, () => new Float32Array(length));
        return {
          numberOfChannels: channels,
          length,
          duration: length / sampleRate,
          getChannelData: (c) => channelData[c],
        };
      },
      renderBlocks: (numBlocks) => {
        const allSamplesCh0 = [];
        const allSamplesCh1 = [];
        for (let b = 0; b < numBlocks; b++) {
          graphCurrentTime += blockSize / sampleRate;
          const block = destination.pull(2);
          allSamplesCh0.push(...block[0]);
          allSamplesCh1.push(...block[1]);
        }
        return [new Float32Array(allSamplesCh0), new Float32Array(allSamplesCh1)];
      },
    };
  }

  it('verifies Master Mix stretch routing transitions without audio dropouts', async () => {
    const graph = createAudioGraphSimulation();

    // Create 1-second 440Hz test sine tone
    const audioBuffer = graph.createBuffer(2, 48000 * 2);
    const d0 = audioBuffer.getChannelData(0);
    const d1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < d0.length; i++) {
      const val = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
      d0[i] = val;
      d1[i] = val;
    }

    const source = graph.createBufferSource(audioBuffer, 'clipSource');
    const clipGain = graph.createGain('clipGain');
    const clipPan = graph.createPanner('clipPan');
    const masterGain = graph.createGain('masterGain');
    const stretchNode = graph.createStretchNode('masterStretch');

    // Wait for WASM ready
    for (let i = 0; i < 20; i++) {
      if (stretchNode.processor.wasmReady) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(stretchNode.processor.wasmReady).toBe(true);

    // Initial 1.0x bypass: source -> gain -> pan -> masterGain -> destination
    source.connect(clipGain);
    clipGain.connect(clipPan);
    clipPan.connect(masterGain);
    masterGain.connect(graph.destination);
    source.start(0, 0, 2.0);

    // Render 100 blocks at 1.0x (~0.27s)
    const [pass0] = graph.renderBlocks(100);
    const maxPass0 = Math.max(...pass0.map(Math.abs));
    expect(maxPass0).toBeGreaterThan(0.3);

    // Now transition to 0.83x (5/6 rate) with stretchNode:
    const rate = 5 / 6;
    const semitones = -12 * Math.log2(rate);

    masterGain.disconnect();
    masterGain.connect(stretchNode);
    stretchNode.connect(graph.destination);
    await stretchNode.schedule({
      active: true,
      semitones,
      tonalityHz: 6000,
      formantCompensation: false,
    });
    source.playbackRate.setValueAtTime(rate, 0);

    // Render 200 blocks at 0.83x (~0.53s)
    const [pass1] = graph.renderBlocks(200);
    // After STFT priming (~38 blocks), amplitude should be healthy and continuous
    const activeSlice = pass1.slice(38 * 128);
    const maxPass1 = Math.max(...activeSlice.map(Math.abs));
    expect(maxPass1).toBeGreaterThan(0.3);

    // Check for NaNs or silence
    let nonZeroSamples = 0;
    for (let i = 0; i < activeSlice.length; i++) {
      expect(Number.isNaN(activeSlice[i])).toBe(false);
      if (Math.abs(activeSlice[i]) > 0.01) nonZeroSamples++;
    }
    expect(nonZeroSamples).toBeGreaterThan(activeSlice.length * 0.7);

    // Now transition back to 1.0x bypass on the fly:
    masterGain.disconnect();
    stretchNode.disconnect();
    await stretchNode.schedule({ active: false, semitones: 0 });
    masterGain.connect(graph.destination);
    source.playbackRate.setValueAtTime(1.0, 0);

    // Render 100 blocks at 1.0x
    const [pass2] = graph.renderBlocks(100);
    const maxPass2 = Math.max(...pass2.map(Math.abs));
    expect(maxPass2).toBeGreaterThan(0.3);
  });

  it('verifies Per-Track Stem stretch routing transitions without audio dropouts', async () => {
    const graph = createAudioGraphSimulation();

    const audioBuffer = graph.createBuffer(2, 48000 * 2);
    const d0 = audioBuffer.getChannelData(0);
    const d1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < d0.length; i++) {
      const val = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
      d0[i] = val;
      d1[i] = val;
    }

    const source = graph.createBufferSource(audioBuffer, 'clipSource');
    const clipGain = graph.createGain('clipGain');
    const clipPan = graph.createPanner('clipPan');
    const trackStretchNode = graph.createStretchNode('trackStretch');
    const masterGain = graph.createGain('masterGain');

    for (let i = 0; i < 20; i++) {
      if (trackStretchNode.processor.wasmReady) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(trackStretchNode.processor.wasmReady).toBe(true);

    // Initial 1.0x: pan -> masterGain -> destination
    source.connect(clipGain);
    clipGain.connect(clipPan);
    clipPan.connect(masterGain);
    masterGain.connect(graph.destination);
    source.start(0, 0, 2.0);

    const [pass0] = graph.renderBlocks(50);
    expect(Math.max(...pass0.map(Math.abs))).toBeGreaterThan(0.3);

    // Switch to Per-Track 0.83x:
    // pan -> trackStretch -> masterGain -> destination
    const rate = 5 / 6;
    const semitones = -12 * Math.log2(rate);

    clipPan.disconnect();
    clipPan.connect(trackStretchNode);
    trackStretchNode.connect(masterGain);

    await trackStretchNode.schedule({
      active: true,
      semitones,
      tonalityHz: 6000,
      formantCompensation: false,
    });
    source.playbackRate.setValueAtTime(rate, 0);

    // Render 200 blocks
    const [pass1] = graph.renderBlocks(200);
    const activeSlice = pass1.slice(38 * 128);
    const maxPass1 = Math.max(...activeSlice.map(Math.abs));
    expect(maxPass1).toBeGreaterThan(0.3);

    // Switch from Per-Track back to Master Mix:
    // pan -> masterGain
    // trackStretch disconnected
    clipPan.disconnect();
    trackStretchNode.disconnect();
    await trackStretchNode.schedule({ active: false, semitones: 0 });
    clipPan.connect(masterGain);

    // Render 100 blocks
    const [pass2] = graph.renderBlocks(100);
    expect(Math.max(...pass2.map(Math.abs))).toBeGreaterThan(0.3);
  });
});
