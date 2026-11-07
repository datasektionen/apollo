// Increment this when signals, placement, or source membership change.
export const FIXTURE_VERSION = 'apollo-waveform-v1';
export const FIXTURE_SEED = 0x5eed2026;

export function describeFixture(name) {
  if (!['quick', 'reference', 'medium', 'stress'].includes(name)) throw Error(`Unknown fixture: ${name}`);
  const reference = name === 'reference';
  const sources = reference
    ? [44100, 48000, 96000].flatMap((sampleRate) => [1, 2].map((channels) => ({
      id: `reference-${sampleRate}-${channels}`, sampleRate, channels,
      length: sampleRate * 2 + 37, signal: 'reference',
    })))
    : Array.from({ length: name === 'quick' ? 2 : 4 }, (_, i) => ({
      id: `source-${i}`, sampleRate: 48000, channels: 2,
      length: 48000 * (name === 'medium' ? 180 : 3) + (name === 'medium' ? 0 : 37), signal: 'music',
    }));
  const trackCount = name === 'stress' ? 64 : name === 'medium' ? 24 : reference ? 12 : 16;
  const clipCount = name === 'stress' ? 2000 : name === 'medium' ? 200 : reference ? 36 : 64;
  return {
    version: FIXTURE_VERSION, seed: FIXTURE_SEED, name, sources, trackCount, clipCount,
    fullPCM: name !== 'stress', metadataOnlyLongSource: name === 'stress',
    longSource: name === 'stress' ? { id: 'two-hour-metadata-only', durationMs: 7200000, sampleRate: 48000, channels: 2, allocatedPCMBytes: 0 } : null,
    decodedDurationSeconds: sources.reduce((sum, source) => sum + source.length / source.sampleRate, 0),
    playbackPCMBytes: sources.reduce((sum, source) => sum + source.length * source.channels * 4, 0),
    caveat: name === 'stress' ? '2,000 metadata clips; four real short stereo buffers. The two-hour source has NO PCM and remains missing media, including at sample zoom. No short buffer is passed off as two-hour audio.' : null,
  };
}

export async function createFixtureBuffers(context, fixture) {
  const buffers = new Map();
  for (let sourceIndex = 0; sourceIndex < fixture.sources.length; sourceIndex += 1) {
    const source = fixture.sources[sourceIndex];
    const buffer = context.createBuffer(source.channels, source.length, source.sampleRate);
    for (let channel = 0; channel < source.channels; channel += 1) {
      const pcm = buffer.getChannelData(channel);
      // Chunk generation yields to the browser; fixture creation is not extraction timing.
      for (let begin = 0; begin < pcm.length; begin += 65536) {
        const end = Math.min(pcm.length, begin + 65536);
        for (let i = begin; i < end; i += 1) {
          const phase = (i + (FIXTURE_SEED % 997) + sourceIndex * 17) * (sourceIndex + 1) * 0.021;
          let value = 0.58 * Math.sin(phase) + 0.17 * Math.sin(phase * 0.137);
          if (source.signal === 'reference') {
            const section = Math.floor(i / source.sampleRate * 8) % 8;
            value = section === 0 ? 0 : section === 1 ? 0.3 : section === 2 ? -0.3
              : section === 3 ? Math.abs(value) : section === 4 ? -Math.abs(value)
                : section === 5 ? (Math.sin(phase) >= 0 ? 0.6 : -0.6) : value;
            if ([255, 256, 257, 511, 512, 1023, pcm.length - 1].includes(i)) value = i % 2 ? 1.25 : -1.4;
            if (i === 777) value = NaN;
            if (i === 778) value = Infinity;
          }
          pcm[i] = channel === 0 ? value : -value;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    buffers.set(source.id, buffer);
  }
  return buffers;
}

export function createFixtureProject(fixture) {
  const tracks = Array.from({ length: fixture.trackCount }, (_, index) => ({
    id: `track-${index}`, name: `Track ${index + 1}`, clips: [], gainDb: 0, pan: 0, muted: false, soloed: false,
  }));
  const depth = fixture.name === 'stress' ? 6 : 2;
  const trackTree = Array.from({ length: depth }, (_, i) => ({
    id: `group-${i}`, kind: 'group', name: `Activity ${i + 1} (not a mix)`,
    parentId: i ? `group-${i - 1}` : null, order: 0, collapsed: false, muted: false, gainDb: 0,
  }));
  tracks.forEach((track, i) => trackTree.push({
    id: `node-${i}`, kind: 'track', trackId: track.id, parentId: `group-${i % depth}`, order: i + 1,
  }));
  for (let i = 0; i < fixture.clipCount; i += 1) {
    const source = fixture.sources[i % fixture.sources.length];
    const duration = source.length / source.sampleRate * 1000;
    const cropStartMs = i % 3 === 0 ? 256 / source.sampleRate * 1000 : 0;
    const length = Math.min(duration - cropStartMs, fixture.name === 'medium' ? 18000 : 750);
    const track = tracks[i % tracks.length];
    const ordinal = Math.floor(i / tracks.length);
    track.clips.push({
      id: `clip-${i}`, name: `${source.id} / crop ${cropStartMs.toFixed(3)}ms`, blobId: source.id,
      timelineStartMs: ordinal * (length + 120), sourceDurationMs: duration,
      cropStartMs, cropEndMs: cropStartMs + length, gainDb: 0, muted: false,
    });
  }
  if (fixture.longSource) {
    // Replace, rather than add, so the advertised total remains exactly 2,000.
    tracks[0].clips[0] = {
      ...tracks[0].clips[0], name: 'Two-hour source — metadata only / missing PCM',
      blobId: fixture.longSource.id, sourceDurationMs: 7200000, cropStartMs: 0, cropEndMs: 7200000,
    };
  }
  return { projectId: `${fixture.version}-${fixture.name}`, name: fixture.name, tracks, trackTree, loop: {}, lyrics: { lines: [] } };
}
