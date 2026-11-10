const fs = require('fs');
const path = require('path');

const filesToPatch = [
  path.join(__dirname, '../public/signalsmith-stretch.js'),
  path.join(__dirname, '../node_modules/signalsmith-stretch/SignalsmithStretch.mjs'),
  path.join(__dirname, '../node_modules/signalsmith-stretch/SignalsmithStretch.js'),
];

const newConfigureImplementation = `configure() {
			const targetChannels = Math.max(1, Number(this.channels) || 2);
			const blockSamples = this.config.blockMs ? Math.round(this.config.blockMs/1000*sampleRate) : 0;
			const intervalSamples = this.config.blockMs ? Math.round((this.config.intervalMs || this.config.blockMs*0.25)/1000*sampleRate) : 0;
			const splitComputation = Boolean(this.config.splitComputation);
			const preset = this.config.preset || 'default';

			if (
				this.wasmConfigured &&
				this.lastChannels === targetChannels &&
				this.lastBlockSamples === blockSamples &&
				this.lastIntervalSamples === intervalSamples &&
				this.lastSplitComputation === splitComputation &&
				this.lastPreset === preset
			) {
				return;
			}

			this.lastChannels = targetChannels;
			this.lastBlockSamples = blockSamples;
			this.lastIntervalSamples = intervalSamples;
			this.lastSplitComputation = splitComputation;
			this.lastPreset = preset;
			this.wasmConfigured = true;
			this.configureCount = (this.configureCount || 0) + 1;

			if (this.config.blockMs) {
				this.wasmModule._configure(this.channels, blockSamples, intervalSamples, splitComputation);
				this.wasmModule._reset();
			} else if (this.config.preset == 'cheaper') {
				this.wasmModule._presetCheaper(this.channels, sampleRate);
			} else {
				this.wasmModule._presetDefault(this.channels, sampleRate);
			}
			this.updateBuffers();
			this.inputLatencySeconds = this.wasmModule._inputLatency()/sampleRate;
			this.outputLatencySeconds = this.wasmModule._outputLatency()/sampleRate;
		}

		updateBuffers() {`;

const newProcessImplementation = `process(inputList, outputList, parameters) {
			const tStart = typeof performance !== 'undefined' ? performance.now() : 0;
			try {
				if (!this.wasmReady) {
					outputList.forEach(output => {
						output.forEach(channel => {
							channel.fill(0);
						});
					});
					return true;
				}
				if (!outputList[0]?.length) return true;

				let outputTime = currentTime + this.outputLatencySeconds;
				while (this.timeMap.length > 1 && this.timeMap[1].output <= outputTime) {
					this.timeMap.shift();
				}
				let currentMapSegment = this.timeMap[0] || {};

				let wasmModule = this.wasmModule;
				let semitones = Number.isFinite(currentMapSegment.semitones) ? currentMapSegment.semitones : 0;
				let tonalityHz = Number.isFinite(currentMapSegment.tonalityHz) ? currentMapSegment.tonalityHz : 6000;
				wasmModule._setTransposeSemitones(semitones, tonalityHz/sampleRate);
				wasmModule._setFormantSemitones(currentMapSegment.formantSemitones || 0, currentMapSegment.formantCompensation || false);
				wasmModule._setFormantBase((currentMapSegment.formantBaseHz || 0)/sampleRate);

				const outChannelCount = outputList[0]?.length || 0;
				if (outChannelCount > 0 && outChannelCount !== this.channels) {
					this.channels = outChannelCount;
					this.configure();
				}

				let outputBlockSize = outputList[0][0]?.length || 128;
				let memory = wasmModule.exports ? wasmModule.exports.memory.buffer : wasmModule.HEAP8.buffer;
				let inputs = inputList[0];

				// Compute input RMS for real-time diagnostics
				let inSumSq = 0;
				let inSampleCount = 0;
				if (inputs && inputs.length > 0) {
					for (let c = 0; c < inputs.length; c++) {
						const ch = inputs[c];
						if (ch && ch.length > 0) {
							for (let i = 0; i < ch.length; i++) {
								const s = ch[i];
								inSumSq += s * s;
							}
							inSampleCount += ch.length;
						}
					}
				}
				const inRms = inSampleCount > 0 ? Math.sqrt(inSumSq / inSampleCount) : 0;

				if (!currentMapSegment.active) {
					outputList[0].forEach((channelBuffer, c) => {
						let channel = inputs && inputs.length > 0 ? inputs[c % inputs.length] : null;
						if (channel && channel.length > 0) {
							channelBuffer.set(channel);
						} else {
							channelBuffer.fill(0);
						}
					});
				} else {
					for (let c = 0; c < this.channels; c++) {
						const inPtr = this.buffersIn[c];
						if (inPtr === undefined) continue;
						let buffer = new Float32Array(memory, inPtr, outputBlockSize);
						let channelBuffer = inputs && inputs.length > 0 ? inputs[c % inputs.length] : null;
						if (channelBuffer && channelBuffer.length > 0) {
							buffer.set(channelBuffer);
						} else {
							buffer.fill(0);
						}
					}

					wasmModule._process(outputBlockSize, outputBlockSize);

					memory = wasmModule.exports ? wasmModule.exports.memory.buffer : wasmModule.HEAP8.buffer;
					for (let c = 0; c < outputList[0].length; c++) {
						const channelBuffer = outputList[0][c];
						const outPtr = this.buffersOut[c];
						if (outPtr !== undefined && channelBuffer) {
							let buffer = new Float32Array(memory, outPtr, outputBlockSize);
							channelBuffer.set(buffer);
						} else if (channelBuffer) {
							channelBuffer.fill(0);
						}
					}
				}

				// Compute output RMS for real-time diagnostics
				let outSumSq = 0;
				let outSampleCount = 0;
				const outputs = outputList[0];
				if (outputs && outputs.length > 0) {
					for (let c = 0; c < outputs.length; c++) {
						const ch = outputs[c];
						if (ch && ch.length > 0) {
							for (let i = 0; i < ch.length; i++) {
								const s = ch[i];
								outSumSq += s * s;
							}
							outSampleCount += ch.length;
						}
					}
				}
				const outRms = outSampleCount > 0 ? Math.sqrt(outSumSq / outSampleCount) : 0;

				this.diagnosticsCounter = (this.diagnosticsCounter || 0) + 1;
				if (this.diagnosticsCounter >= 25) {
					this.diagnosticsCounter = 0;
					const procDuration = tStart > 0 && typeof performance !== 'undefined' ? performance.now() - tStart : 0;
					this.port.postMessage(['diagnostics', {
						inRms,
						outRms,
						active: Boolean(currentMapSegment.active),
						semitones,
						tonalityHz,
						channels: this.channels,
						configureCount: this.configureCount || 0,
						procDurationMs: procDuration,
					}]);
				}

				return true;
			} catch (err) {
				console.error('[SignalsmithStretch] process error:', err);
				try {
					this.port.postMessage(['workletError', {
						message: err?.message || String(err),
						stack: err?.stack,
					}]);
				} catch {}
				return true;
			}
		}
	}

	`;

filesToPatch.forEach((filePath) => {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');

  // Fix bare configure()
  if (content.includes('this.channels = outputList[0]?.length || 0;\n\t\t\t\tconfigure();')) {
    content = content.replace(
      'this.channels = outputList[0]?.length || 0;\n\t\t\t\tconfigure();',
      'this.channels = outputList[0]?.length || 0;\n\t\t\t\tthis.configure();'
    );
  }

  // Fix outputTime check
  if (content.includes("let outputTime = ('outputTime' in objIn) ? objIn.outputTime : currentTime;")) {
    content = content.replace(
      "let outputTime = ('outputTime' in objIn) ? objIn.outputTime : currentTime;",
      "let outputTime = ('outputTime' in objIn) ? objIn.outputTime : ('output' in objIn) ? objIn.output : currentTime;"
    );
  }

  // Replace configure implementation with idempotent version
  const configStart = 'configure() {';
  const configEnd = 'updateBuffers() {';
  const cIdxStart = content.indexOf(configStart);
  const cIdxEnd = content.indexOf(configEnd);
  if (cIdxStart !== -1 && cIdxEnd !== -1 && cIdxEnd > cIdxStart) {
    content = content.slice(0, cIdxStart) + newConfigureImplementation + content.slice(cIdxEnd + configEnd.length);
  }

  // Replace process implementation
  const targetStart = 'process(inputList, outputList, parameters) {';
  const targetEnd = 'registerProcessor(audioNodeKey, WasmProcessor);';
  const idxStart = content.indexOf(targetStart);
  const idxEnd = content.indexOf(targetEnd);

  if (idxStart !== -1 && idxEnd !== -1) {
    content = content.slice(0, idxStart) + newProcessImplementation + content.slice(idxEnd);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[Patch] Successfully patched ${path.basename(filePath)}`);
  }
});
