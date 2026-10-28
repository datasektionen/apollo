import { createWaveformBuilder, WAVEFORM_CHUNK_SAMPLES } from '../waveformData';

export function audioBuffer(channels, sampleRate = 48000) {
  const pcm = channels.map((channel) => new Float32Array(channel));
  return {
    sampleRate, numberOfChannels: pcm.length, length: pcm[0].length,
    getChannelData: (channel) => pcm[channel],
  };
}

export function buildPyramid(buffer, chunkSize = WAVEFORM_CHUNK_SAMPLES, baseBlockSize = 128) {
  const builder = createWaveformBuilder({ ...buffer, baseBlockSize });
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    for (let start = 0; start < buffer.length; start += chunkSize) {
      builder.append(c, start, buffer.getChannelData(c).slice(start, start + chunkSize));
    }
  }
  return builder.finish();
}

export function referenceRange(buffer, channel, start, end) {
  const values = [...buffer.getChannelData(channel)].slice(Math.max(0, Math.floor(start)), Math.max(0, Math.ceil(end)))
    .map((value) => Number.isFinite(value) ? value : 0);
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    sumSquares: values.reduce((sum, value) => sum + value * value, 0), count: values.length,
  };
}

export function generatedBuffer(length = 1027, channels = 2, sampleRate = 48000) {
  let seed = 0x12345678;
  return audioBuffer(Array.from({ length: channels }, () => Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0x100000000 - 0.5) * 6;
  })), sampleRate);
}
