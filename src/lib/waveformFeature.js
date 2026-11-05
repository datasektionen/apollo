let cached;

/** Reload after changing the query override; no second renderer is mounted for comparison.
 * A recognized URL value overrides the build setting; absent/invalid settings default to modern.
 */
export function getWaveformRenderer({
  buildRenderer = import.meta.env.VITE_WAVEFORM_RENDERER,
  search = typeof window === 'undefined' ? '' : window.location.search,
} = {}) {
  // Called on every waveform render.
  if (cached?.search === search && cached.buildRenderer === buildRenderer) return cached.renderer;
  const override = new URLSearchParams(search).get('waveformRenderer');
  const renderer = override === 'legacy' || override === 'modern' ? override
    : buildRenderer === 'legacy' ? 'legacy' : 'modern';
  cached = { search, buildRenderer, renderer };
  return renderer;
}
