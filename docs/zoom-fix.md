# Zoom and Waveform Modernization Plan

Status: implemented in the working tree; **release acceptance incomplete** (2026-10-28). The interrupted implementation was recovered in place, with worker/cache, Canvas/group/recording renderers, Timeline integration and modern/legacy switching present. All 684 tests across 72 files and both renderer builds pass. Real Chrome measurements now exist in [waveform-benchmark.md](waveform-benchmark.md): medium frame/response/refinement targets are missed, and the expanded stress run times out. The budgets below remain unchanged targets, not achieved guarantees.

Modern remains the existing development default; retain `?waveformRenderer=legacy` and the `VITE_WAVEFORM_RENDERER=legacy` build option. Neither the flag nor the WaveSurfer dependency should be removed while these gates remain open. No production rollout approval or claim that legacy is faster follows from these measurements.

## Goal and decisions

Deliver an Audacity-inspired editing experience: responsive zoom/scroll/crop, trustworthy waveform detail from project overview to individual samples, and bounded rendering/cache costs on large projects.

**Recommended architecture:** shared, source-keyed multi-resolution min/max/RMS summaries built in a worker; a viewport-bounded Canvas 2D renderer; one frame scheduler; independent DOM interaction overlays. Audio playback remains owned by `audioManager`.

- Replace per-clip WaveSurfer instances rather than patching their resize delay or feeding them one fixed-resolution overview.
- Build the peak service, worker, and renderer together. Deferring workers until the end just moves the import freeze elsewhere.
- Bound work by visible pixels/channels and dirty regions, not source duration or total clip count. A visible clip must not allocate a canvas as wide as its entire timeline extent.
- Preserve existing interaction behavior in the initial renderer rollout. Introduce improved zoom anchoring and display modes as explicit, tested UX changes.
- Start with Canvas 2D. OffscreenCanvas/WebGL/WebGPU are escalation options only if browser profiles show the bounded 2D path misses targets.

## 1. Pre-modernization diagnosis (historical baseline)

| Area | Verified baseline behavior | Implication |
| --- | --- | --- |
| `src/components/Waveform.jsx` | Cropped, full-resolution channel views are passed to `wavesurfer.load('', peaks, duration)`. Normalization can allocate and fill new arrays for the entire crop. | Crop previews can repeatedly process long PCM ranges. Merely wrapping this work in rAF does not make it cheap. |
| Installed WaveSurfer renderer | Version 7.12.1 has a 100 ms resize delay and a bar-rendering path that iterates supplied channel data. | Width changes introduce delayed redraw and redundant sample reduction. Actual total cost depends on internal canvas partitioning/lazy rendering and needs profiling. |
| `src/components/Timeline.jsx` | Ordinary clips and group descendant previews mount Waveform instances without application-level waveform viewport culling. | Many independent renderers respond to zoom; groups add more instances. |
| `src/utils/waveformUtils.js` | Global peak calculation scans full source PCM for every clip, including repeated references to the same `blobId`. Timeline triggers this through load-membership effects and a 500 ms poll. | Cache per-source statistics and replace polling with explicit media lifecycle notifications. It is not a scan on every zoom frame. |
| Timeline editing | Move/crop/gain already use local previews, rAF-coalesced moves, and a mouse-up commit. Zoom changes local visible duration. | Do not rebuild these mechanisms as phase one. Audit final-event flushing, cancellation, and remaining project/history costs instead. |
| `src/store/useStore.js` | Project updates still clone snapshots; autosave/history work remains after a commit. | Avoid no-op writes and measure gesture completion separately from rendering. |

**Corrections to the previous plan and external analysis:**

- The legacy waveform path does **not** encode WAV blobs or create an AudioContext on each crop. Those are obsolete diagnoses.
- WaveSurfer accepts channel data; raw PCM is not inherently an invalid API argument. The problem is its cost and the per-instance architecture for this timeline. “500–2,000 peaks” is not a sufficient data model for all zoom levels.
- Do not assume all instances redraw at exactly the same instant, promise a fixed 8,000× speedup, or assert sub-0.1 ms canvas performance without measurement.
- JS and the browser are viable, but memory copies, garbage collection, layout, canvas rasterization, and device/browser limits still matter.
- CSS scaling during a gesture is an optional temporary preview, not a verified universal DAW technique or a replacement for correct redraws.

## 2. What to borrow from Audacity

Audacity is a strong reference for both **signal fidelity** and **bounded caching**, not just its waveform appearance.

Verified reference behavior:

- Audacity's published 3.2.0 `WaveDataCache` selects raw samples, 256-sample summaries, or 65,536-sample summaries according to samples per display column. Each summary carries min, max, and RMS information.
- Its `GraphicsDataCache` uses 256-column cache elements keyed by zoom scale and first sample, with viewport-related limits and LRU cleanup. It separates data aggregation from graphics caching.
- The waveform manual documents signed linear amplitude, separate stereo channels, optional RMS/dB/clipping displays, and connected sample points at deep zoom.

Apply these principles in a fresh web implementation. Apollo need not copy Audacity's exact block sizes, C++ classes, or storage format. The linked generated source is explicitly **Audacity 3.2.0**, not evidence about every current Audacity release. Avoid relying on the external analysis's unverified “1 MB block files” claim.

**Licensing:** the referenced Audacity source headers are GPL-2.0-or-later. Study algorithms and behavior; do not paste/translate implementation code or copy assets without checking compatibility, attribution, and distribution obligations. Any direct reuse requires a licensing review first.

## 3. Data model and fidelity requirements

### Shared source summary service

Introduce a waveform service separate from React component state and playback buffers, integrated with `src/lib/loadStemAudio.js`, import/record paths in `src/components/Editor.jsx`, and the media-cache lifecycle.

- Key by source identity **and revision/content fingerprint**, decoded sample rate, channel layout, sample count, and summary algorithm/schema version. A `blobId` alone is safe only if its immutability is enforced.
- One extraction job/pyramid per unique source; split/cropped/repeated clips and group previews share it. Deduplicate in-flight requests.
- Record per-channel signed `min`/`max`, energy (`sumSquares`), valid sample count, and source absolute peak. Counts can be derived from block metadata where unambiguous.
- Never average extrema or average RMS values directly. Parent min/max are extrema of children; energy and counts add; `rms = sqrt(sumSquares / count)`. Handle partial final blocks correctly.
- Preserve samples outside ±1 for truthful over-range diagnostics; do not clamp data during extraction. Define deterministic handling for non-finite samples and silence, with no division by zero or fabricated spikes.
- Use a base bucket provisionally around 64–256 samples and power-of-two parent levels; choose the final base size using fidelity, memory, and extraction benchmarks. Do not persist a sample-per-bucket level duplicating all PCM.
- Keep summaries independent of color, clip position/crop/gain, selection, and display normalization. Those changes must not trigger extraction.

### Source-to-screen mapping

Use one tested mapping across ruler, waveform, overlays, hit-testing, and edits. For current unstretched clips:

```text
sourceTimeMs = cropStartMs + timelineTimeMs - timelineStartMs
sourceSample = sourceTimeMs * sampleRate / 1000
samplesPerDevicePixel = sampleRate / (1000 * pixelsPerMs * effectiveDpr)
```

- Store/query half-open sample ranges `[start, end)`, clamped to decoded length. Establish one rounding policy for milliseconds to sample boundaries and preserve edit/playback alignment.
- Aggregate **both signed extrema** over each displayed interval; do not use every Nth sample, absolute-only peaks, or audio averaging. Preserve transients, asymmetry, and DC offset.
- Choose the coarsest summary level whose bucket does not exceed the requested samples per column; combine the necessary buckets, not merely the nearest single bucket. Refine partial boundaries through finer levels/raw samples so cropped-away transients do not bleed into a clip.
- Internal display-column approximation, if used during gestures, must have a documented subpixel error bound. Settled views and crop boundaries must pass the reference-query tests.
- Below the finest summary resolution, query only the visible PCM window. At roughly one sample per device pixel and closer, draw connected signed sample points; show dots only when spaced sufficiently. Never stretch a coarse envelope and call it sample detail.
- A future time-stretch/reverse feature must extend this mapping explicitly; do not infer support from the summary cache.

### Display contract

- First ship the new renderer with Apollo-compatible styling and normalization so performance comparisons are meaningful.
- Then offer a clearly labeled, fixed **±1 linear amplitude** default, linked stereo channel lanes, optional RMS shading, optional dB/vertical zoom, and source over-range indicators. Validate dB floors, sign preservation, zero lines, and labels.
- Retain project-normalized display as an explicit compatibility option. Derive its scale from cached maxima over unique referenced sources, not repeated PCM scans. Define membership/removal/replacement behavior and avoid scale jumps as sources arrive asynchronously.
- Display scaling is not playback gain. Specify source/pre-gain versus clip-gain visualization; if gain-aware view is added, apply gain at draw time and label it. Source sample peaks are not true-peak or final-mix clipping/loudness measurements.
- RMS is signal energy, not LUFS/perceived loudness. Fade RMS out at sample zoom; dB/RMS toggles must not require rescanning PCM.

## 4. Renderer, scheduler, and viewport architecture

### Viewport-bounded Canvas 2D

- Evolve `src/components/Waveform.jsx` into a lightweight view over the shared service. No media player, media element, extra progress canvas, WAV encoding, or per-view AudioContext.
- Initially use canvases only for visible portions of visible clips. Use reusable fixed-width tiles (initially evaluate 256–512 CSS px) or a viewport-sized row surface; keep selection, labels, handles, and hit targets as separate overlays.
- Distinguish CSS size from backing-store size; use `effectiveDpr`, reset transforms correctly after resize, and redraw when DPR changes. Account for `width * height * 4` bytes per RGBA surface and temporary/back buffers.
- A many-hour clip zoomed to samples still allocates only a visible window plus bounded overscan. Browser canvas dimensions must never be approached by full-clip backing stores.
- Cache summary queries separately from optional raster tiles. Raster keys include source revision/channel, source interval or first sample, scale, DPR, height, display mode/scale/gain, and style revision. Do not reuse a tile for a mismatched fractional sample alignment.
- Position/selection/playhead changes must not rebuild source summaries. Playhead animation should not invalidate waveform pixels.

### One scheduling authority

- Coalesce scroll, zoom, resize, media-ready, and edit-preview invalidations into **one timeline rAF scheduler**, not one uncontrolled rAF loop per clip.
- Measure shared geometry once, then query/draw dirty visible regions within a frame budget. Prioritize on-screen active edits; use bounded overscan and progressively refine lower-priority regions.
- Publish canvas updates only when source/view generation still matches. Cancel stale work on project switch, unmount, source replacement, and rapid zoom reversal. A stale completion must never overwrite a newer view.
- Observe the actual viewport/container and shared vertical scroller, not just `window.resize`; avoid ResizeObserver feedback loops and debounced “redraw only when zoom stops.”
- If necessary, transform the last valid image for immediate gesture feedback, then replace it with exact tiles during/after the gesture. Correct transform origin and source bounds are mandatory; never transform hit-testing overlays or leave newly revealed areas blank indefinitely. Respect reduced-motion preferences for nonessential animations.

### Culling beyond waveform pixels

- Derive horizontal visible time from the shared scroll state and vertical visibility from Editor's actual shared scroller and variable row heights.
- Cull waveform surfaces first; then virtualize rows/clip shells where profiling warrants it. Keep row height spacers, stable IDs, scroll extent, selection state, focused/actively edited elements, and drag targets intact.
- A visible long clip draws only its intersecting source range. Culling whole offscreen clips alone is insufficient.
- Generate only visible ruler ticks plus overscan. Maintain row-offset and sorted clip-range indexes incrementally so scrolling does not scan the full project or repeatedly sum preceding row heights.
- Consider a shared row surface if thousands of tiny visible clips make per-clip canvases expensive. Choose from measurements rather than immediately rewriting the entire timeline DOM.

## 5. Worker, cache, and recording lifecycle

- Use a bounded worker queue with visible-source priority, job deduplication, cancellation/generation tokens, and progress/error states. Coarse overviews may arrive first, followed by detailed levels.
- Never transfer/detach `audioBuffer.getChannelData(...).buffer`: playback owns those buffers. Use bounded copied PCM chunks transferred to the worker, reuse temporary buffers where possible, and preserve bucket carry/energy across chunk boundaries.
- Chunking/copying on the main thread must also fit the interaction budget. Avoid a full-file copy or duplicate decode per clip; measure peak memory during import and extraction.
- Add source-ready/replaced/removed/evicted notifications; stop relying on clip-ID polling to discover media. Summary availability must not gate playback readiness.
- Persist summaries as **rebuildable local derived data** in a versioned Dexie/IndexedDB store in `src/lib/db.js`. Keep them out of project JSON, undo history, collaboration messages, exports, and media uploads unless a separate format is designed.
- Validate persisted metadata and lengths; discard stale/corrupt entries. Handle quota, private browsing, eviction, worker failure, and unsupported APIs with a nonblocking placeholder and bounded fallback/retry. Never silently fall back to a synchronous full-source scan during interaction.
- Maintain byte-accounted LRU limits for resident summaries, worker staging, and raster surfaces independently. Initial benchmark limits: 64 MiB resident summaries, 64 MiB raster surfaces, and 16 MiB PCM staging, excluding playback-owned PCM; tune explicitly by device. Eviction must release buffers/bitmaps and avoid visible-tile rebuild loops.
- For long sources, page/chunk summaries and pin only visible working sets; do not require every source pyramid resident. IndexedDB has a separate quota-aware retention/cleanup policy.
- During recording, append summaries incrementally and recompute only the incomplete tail bucket. Preserve continuity across recording segments and use the same final cache format when recording stops; leave the audio capture callback free of heavy rendering/summary work.

## 6. Zoom and edit interaction contract

Before modernization, Apollo used logarithmic zoom, an 8-second minimum fit duration, a 500 ms maximum-magnification viewport, and playhead recentering. The implementation introduces the following deliberate upgrades, with physical-browser acceptance still required:

- Cursor/pinch zoom anchors the timeline time under the pointer/gesture center. For anchor position `x` within the viewport: `anchorMs = (oldScrollLeft + x) / oldPixelsPerMs`; `newScrollLeft = anchorMs * newPixelsPerMs - x`, clamped to valid scroll extent.
- Slider/keyboard zoom preserves the playhead's existing screen position when visible, otherwise viewport center. Provide explicit Fit Project, Fit Selection, and zoom-to-samples actions; define playback-follow behavior so it does not fight manual zoom/scroll.
- Extend deep zoom beyond the present 500 ms limit based on sample rate and viewport width. Use adaptive fine ruler intervals/labels; evaluate a floating/segmented timeline origin before huge CSS scroll widths reach browser limits. Keep empty, short, and multi-hour projects usable.
- Clamp duration/slider state at both ends when project duration or viewport size changes. Specify whether Fit remains a live mode or preserves duration after edits.
- Normalize wheel `deltaMode`, accumulate burst input, and ensure one owner handles each wheel event; current nested handlers need audit. Preserve normal scrolling, OS/browser zoom conventions, ruler/track sync, and trackpad behavior across browsers.
- Retain local preview + one commit per completed gesture. Flush pending movement/release coordinates before commit; cancel cleanly on Escape, blur, pointer cancellation, lost capture, source/project replacement, or unmount. Define scrolling/zoom changes during drag using the same coordinate mapping.
- At commit, revalidate selected clips, source bounds, collisions, destination existence, and permissions against current project state. Define conflict behavior for remote updates; multi-clip changes must be atomic, not lose clips on a stale destination.
- Suppress no-op commits; use structural sharing where possible and profile history/autosave completion. Do not put waveform caches in undo state.
- Preserve keyboard range controls, accessible names/value text, focus visibility, and usable hit targets. Add keyboard alternatives for zoom and precision crop/move. Virtualization must not unmount focused controls or change selection semantics.

## 7. Group previews

- Replace per-descendant Waveform components with one bounded surface per visible group row, querying the same source summaries.
- First preserve a lightweight layered/stacked **activity overview**. A min/max union is not a summed audio mix: cancellation and correlation cannot be reconstructed from independent peak/RMS summaries. Do not label it as accurate group output or clipping.
- Preserve current rules: the previewed group's own mute is ignored for its preview; muted descendant groups, tracks, and clips are excluded. Retain missing-media indication and update from local edit previews as well as committed state.
- If a true post-gain group waveform is wanted later, render/cache an actual background mix with explicit gain, automation, routing, and edit invalidation. Keep that separate from the inexpensive activity preview.

## 8. Implementation order and exit gates

1. **Baseline and regression harness.** Add extraction/query/draw/frame/memory counters; capture cold/warm traces for fixtures below. Add mapping, gesture, and normalization regression tests. Establish exact existing group/display behavior before changing it.
2. **Shared summary service + worker.** Implement source/version keys, min/max/energy pyramid, lifecycle events, chunked extraction, cancellation, and source-peak caching. Exit: deterministic reference tests pass; no playback buffer detachment or duplicate extraction.
3. **Canvas renderer + horizontal windowing behind a flag.** Integrate visible-range/DPR rendering, raw-sample fallback, shared scheduler, and bounded allocation. Exit: crop/zoom fidelity and frame budgets pass with Apollo-compatible appearance; no full-PCM work on warm zoom.
4. **Timeline/group scalability + lifecycle completion.** Add vertical/ruler culling, indexed lookup, group activity surface, incremental recording, persistent summary migration, and eviction/failure handling. Exit: stress fixtures stay bounded through scroll/project switches and cache errors.
5. **Audacity-inspired UX and interaction hardening.** Ship sample zoom, anchoring/actions, fixed-scale/channel/RMS/dB options, accessibility, and final-event/conflict/no-op fixes with dedicated tests. Baseline-discovered correctness blockers can move earlier; avoid bundling unrelated store rewrites.
6. **Rollout and cleanup.** Compare the old/new paths using the same fixtures, not by mounting both renderers concurrently. Enable the new path gradually; retain an explicit rollback switch until acceptance passes. Then remove the legacy component path and `wavesurfer.js` dependency/lockfile entries after confirming no other consumers.

Worker support, bounded memory, correct cropping, and visible-range rendering are release requirements, not optional later polish. Optional raster caching, GPU rendering, true group-mix waveforms, and spectrograms are follow-up work only when justified.

## 9. Validation and performance gates

### Reproducible fixtures

- **Reference:** mono/stereo, 44.1/48/96 kHz; silence, DC, impulses on bucket/pixel/crop boundaries, positive-only/negative-only signals, inverted stereo, sine/square waves, partial final buckets, over-range and non-finite samples.
- **Medium:** 24 tracks, 200 clips, repeated and unique three-minute stereo sources, nested groups, at least 12 visible rows, 1440 px viewport, DPR 2.
- **Stress:** 64 tracks, 2,000 clips, deeply nested groups, a two-hour source, narrow visible clips, long clips at sample zoom, and live recording. Separate metadata-only fixtures from full-PCM fixtures so existing decoder/playback memory limits are reported rather than hidden.
- Record machine/OS/browser/refresh rate, viewport/DPR, sample rate, visible channels, unique decoded duration, and cache state. Test current supported Chrome, Safari, and Firefox on a named baseline Mac and a lower-powered device. Version fixture seeds and benchmark procedure.

### Initial acceptance budgets

| Metric | Target on the named baseline device |
| --- | --- |
| Warm-cache zoom/scroll/edit | p95 total frame interval ≤16.7 ms at 60 Hz; p95 waveform query + draw ≤4 ms per frame on medium fixture |
| Input to first visual response | p95 ≤33 ms; no intentional 100 ms settling delay |
| Crisp visible refinement after gesture end | p95 ≤100 ms with summaries resident; coarse valid imagery remains visible while refining |
| Interaction long tasks | No waveform-attributable main-thread task ≥50 ms, including extraction/copy/persistence work during interaction |
| 120 Hz | Stretch target: p95 frame interval ≤8.3 ms; report separately, not an unconditional guarantee |
| Cold summary generation | Provisional p95 ≤2 s for one three-minute stereo 48 kHz source after decode; extraction must remain cancellable and nonblocking |
| Warm summary reload | Provisional p95 first visible waveform ≤250 ms after source metadata + local summary availability, excluding network/audio decode; report end-to-end project readiness separately |
| Allocation/cache bounds | No full-clip canvas; explicit byte budgets enforced. Repeated zoom/scroll and 20 project open/close cycles show no monotonic retained-resource growth after cleanup |
| Undo/persistence | Exactly one undo entry per completed editing gesture, none for zoom/scroll/cancel/no-op; one logical autosave change per commit |

Budgets must be measured with a browser trace and distributions, not average FPS alone. Report dropped-frame/long-task counts, peak extraction memory, worker queue depth, cache hit rate, canvas backing bytes, and cold/warm load times. Adjust provisional budgets only with a documented device/result rationale.

### Automated and manual checks

- Unit/property tests: pyramid reductions, weighted energy, reference range-query agreement, crop bounds, source/screen mapping, LOD/DPR transitions, normalization policy, and stale/corrupt cache rejection. Use exact extrema and defined numeric tolerance for energy/RMS.
- Interaction tests: zoom anchor within one CSS px except at scroll clamps, burst wheel events handled once, container-only resize, final rAF flushed on release, cancellation, scrolling while dragging, one undo entry, no-op suppression, and concurrent project changes.
- Lifecycle tests: repeated/split clips share one job, replacement under the same ID invalidates, stale jobs never publish, cache eviction/reload works, quota/worker failures remain usable, recording tail is correct, and playback channel buffers remain intact.
- Browser visual tests: stereo, source gain/scale modes, sample dots, RMS/dB, missing media, muted groups, tile seams, clip edges, DPR changes, theme/height changes, and reduced-motion behavior. jsdom tests alone cannot validate raster output or performance.
- Playback regression: zoom/scroll/edit rendering never alters PCM, transport timing, routing, capture, or export. Benchmark during playback and recording, not only on an idle timeline.
- Use existing Vitest infrastructure for pure logic/component scheduling tests; add a real-browser visual/performance harness. Run `npm test -- --run` and `npm run build` for implementation changes; browser profiling is a separate release gate.

## References

- Apollo: `src/components/Waveform.jsx`, `src/components/Timeline.jsx`, `src/utils/waveformUtils.js`, `src/components/Editor.jsx`, `src/lib/loadStemAudio.js`, `src/lib/db.js`, `src/store/useStore.js`.
- Installed dependency inspected: `node_modules/wavesurfer.js/dist/renderer.js` and renderer utilities, version 7.12.1 (`package.json` declares `^7.7.3`). Recheck installed behavior when upgrading.
- [Audacity waveform manual](https://manual.audacityteam.org/man/audacity_waveform.html): display/channel/RMS/sample-detail reference.
- [Audacity 3.2.0 WaveDataCache.cpp](https://doxy.audacityteam.org/_wave_data_cache_8cpp_source.html): raw/summary level selection, per-column extrema/energy aggregation, append-buffer handling.
- [Audacity 3.2.0 GraphicsDataCache.h](https://doxy.audacityteam.org/_graphics_data_cache_8h_source.html): zoom/source-position cache keys, 256-column elements, viewport-related LRU limits.
- [Audacity waveform rendering design PR #2635](https://github.com/audacity/audacity/pull/2635): historical rationale for separating data and graphics caches. Historical design reference, not a guarantee about current internals.
