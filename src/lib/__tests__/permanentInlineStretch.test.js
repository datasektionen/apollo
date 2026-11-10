import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

describe('Permanent In-Line Stretch Architecture Verification', () => {
  let WasmProcessorClass;

  beforeEach(async () => {
    const stretchCode = fs.readFileSync(
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

  it('proves permanent in-line routing maintains continuous healthy audio across rate transitions', async () => {
    const sampleRate = 48000;
    const blockSize = 128;

    // Create a permanent in-line processor
    const proc = new WasmProcessorClass({
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    for (let i = 0; i < 20; i++) {
      if (proc.wasmReady) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(proc.wasmReady).toBe(true);

    const port = {
      postMessage: (data) => {
        proc.port.onmessage?.({ data });
      },
    };
    proc.port.peerPort = port;

    const schedule = (obj) => {
      const id = Math.random();
      port.postMessage([id, 'schedule', obj]);
    };

    // Initial state: 1.0x bypass (active: false)
    schedule({ active: false, semitones: 0 });

    let currentTime = 0;
    const renderBlock = (freq, rate) => {
      currentTime += (blockSize / sampleRate);
      const in0 = new Float32Array(blockSize);
      const in1 = new Float32Array(blockSize);
      for (let i = 0; i < blockSize; i++) {
        const val = Math.sin((2 * Math.PI * freq * (currentTime + (i / sampleRate))) * rate) * 0.5;
        in0[i] = val;
        in1[i] = val;
      }
      const out0 = new Float32Array(blockSize);
      const out1 = new Float32Array(blockSize);
      proc.process([[in0, in1]], [[out0, out1]], {});
      return [out0, out1];
    };

    // Phase 1: 50 blocks at 1.0x bypass
    console.log('--- Phase 1: 1.0x bypass ---');
    for (let b = 0; b < 50; b++) {
      const [out0] = renderBlock(440, 1.0);
      const max = Math.max(...out0.map(Math.abs));
      expect(max).toBeGreaterThan(0.3);
    }

    // Phase 2: Transition in-line to 0.8333x (5/6) without disconnecting!
    console.log('--- Phase 2: Switch in-line to 0.8333x with pitch preservation ---');
    const rate = 5 / 6;
    const semitones = -12 * Math.log2(rate);
    schedule({ active: true, semitones, tonalityHz: 6000, formantCompensation: false });

    // Render 100 blocks at 0.8333x
    const outputsPhase2 = [];
    for (let b = 0; b < 100; b++) {
      const [out0] = renderBlock(440, rate);
      outputsPhase2.push(...out0);
    }
    // After STFT priming (~35 blocks), output must be healthy and continuous
    const activePhase2 = outputsPhase2.slice(40 * blockSize);
    const maxPhase2 = Math.max(...activePhase2.map(Math.abs));
    expect(maxPhase2).toBeGreaterThan(0.3);

    // Phase 3: Transition in-line to 0.5x without disconnecting!
    console.log('--- Phase 3: Switch in-line to 0.5x ---');
    const rate3 = 0.5;
    const semitones3 = -12 * Math.log2(rate3);
    schedule({ active: true, semitones: semitones3, tonalityHz: 6000, formantCompensation: false });

    const outputsPhase3 = [];
    for (let b = 0; b < 50; b++) {
      const [out0] = renderBlock(440, rate3);
      outputsPhase3.push(...out0);
    }
    const maxPhase3 = Math.max(...outputsPhase3.map(Math.abs));
    expect(maxPhase3).toBeGreaterThan(0.3);

    // Phase 4: Transition back to 1.0x bypass without disconnecting!
    console.log('--- Phase 4: Switch in-line back to 1.0x bypass ---');
    schedule({ active: false, semitones: 0 });
    for (let b = 0; b < 50; b++) {
      const [out0] = renderBlock(440, 1.0);
      const max = Math.max(...out0.map(Math.abs));
      expect(max).toBeGreaterThan(0.3);
    }
  });

  it('proves repetitive configure calls do not wipe STFT buffers or mute audio', async () => {
    const sampleRate = 44100;
    const blockSize = 128;

    const proc = new WasmProcessorClass({
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    for (let i = 0; i < 20; i++) {
      if (proc.wasmReady) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(proc.wasmReady).toBe(true);

    const configure = (config) => {
      proc.port.onmessage?.({ data: [Math.random(), 'configure', config] });
    };
    const schedule = (obj) => {
      proc.port.onmessage?.({ data: [Math.random(), 'schedule', obj] });
    };

    const initialCount = proc.configureCount || 0;

    // Initial configure and schedule at 0.5x (semitones: 12)
    configure({ blockMs: 100, intervalMs: 25, splitComputation: false });
    schedule({ active: true, semitones: 12, tonalityHz: 6000, formantCompensation: false });

    const configuredCount = proc.configureCount;
    expect(configuredCount).toBe(initialCount + 1);

    let currentTime = 198.46;
    const renderBlock = () => {
      currentTime += (blockSize / sampleRate);
      const in0 = new Float32Array(blockSize);
      const in1 = new Float32Array(blockSize);
      for (let i = 0; i < blockSize; i++) {
        const val = 0.0127 * Math.SQRT2 * Math.sin(2 * Math.PI * 440 * (currentTime + i / sampleRate));
        in0[i] = val;
        in1[i] = val;
      }
      const out0 = new Float32Array(blockSize);
      const out1 = new Float32Array(blockSize);
      proc.process([[in0, in1]], [[out0, out1]], {});
      return [out0, out1];
    };

    // Run 100 blocks, spamming configure() every 10 blocks (simulating React re-renders)
    const outAmplitudes = [];
    for (let b = 0; b < 100; b++) {
      if (b % 10 === 0) {
        configure({ blockMs: 100, intervalMs: 25, splitComputation: false });
      }
      const [out0] = renderBlock();
      outAmplitudes.push(Math.max(...out0.map(Math.abs)));
    }

    // configureCount must remain identical because arguments did not change
    expect(proc.configureCount).toBe(configuredCount);

    // Audio output after warmup (blocks 40+) must be healthy and non-zero
    const activeBlocks = outAmplitudes.slice(40);
    const maxActive = Math.max(...activeBlocks);
    expect(maxActive).toBeGreaterThan(0.01);
  });
});
