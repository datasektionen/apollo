import { createWaveformBuilder, createWaveformFingerprint } from './waveformData';

/** One request/ack at a time bounds transferred PCM and permits cancellation between chunks. */
export function createWaveformWorkerHandler(postMessage, { subtle = globalThis.crypto?.subtle } = {}) {
  let active;
  return async ({ data }) => {
    const { type, jobId, requestId } = data;
    try {
      if (type === 'start') {
        active = { jobId, builder: createWaveformBuilder(data.metadata), fingerprint: createWaveformFingerprint(data.metadata, subtle) };
      } else if (type === 'cancel') {
        if (active?.jobId === jobId) active = undefined;
      } else {
        const current = active;
        if (!current || current.jobId !== jobId) throw new Error('Stale waveform worker job');
        if (type === 'chunk') {
          current.builder.append(data.channelIndex, data.startSample, data.samples);
          await current.fingerprint.append(data.samples);
          if (active !== current) return;
        } else if (type === 'finish') {
          const pyramid = current.builder.finish();
          const fingerprint = await current.fingerprint.finish();
          if (active !== current) return;
          active = undefined;
          const transfers = pyramid.channels.flatMap((channel) => channel.levels.flatMap(
            (level) => [level.min.buffer, level.max.buffer, level.sumSquares.buffer],
          ));
          postMessage({ type: 'result', jobId, requestId, pyramid, fingerprint }, transfers);
          return;
        } else throw new Error('Unknown waveform worker request');
      }
      postMessage({ type: 'ack', jobId, requestId });
    } catch (error) {
      active = undefined;
      postMessage({ type: 'error', jobId, requestId, error: error?.message || String(error) });
    }
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = createWaveformWorkerHandler((message, transfers = []) => globalThis.postMessage(message, transfers));
}
