/** Reload after changing the query override; no second renderer is mounted for comparison.
 * A recognized URL value overrides the build setting; absent/invalid settings default to modern.
 */
export function getWaveformRenderer({
  buildRenderer = import.meta.env.VITE_WAVEFORM_RENDERER,
  search = typeof window === 'undefined' ? '' : window.location.search,
} = {}) {
  const override = new URLSearchParams(search).get('waveformRenderer');
  if (override === 'legacy' || override === 'modern') return override;
  return buildRenderer === 'legacy' ? 'legacy' : 'modern';
}
