# Real-browser waveform benchmark

This opt-in harness implements the browser measurement portion of `docs/zoom-fix.md`. It mounts the **actual `Timeline`**, modern waveform/group components, shared scheduler, media cache, worker, service, and Canvas 2D renderer. It does not mock those systems or start Apollo's backend. Only the benchmark entry points and this document are added; app configuration and dependencies are unchanged.

## Run

From the project root, with dependencies already installed:

```sh
node --version
node -e 'console.log(typeof WebSocket)'
node scripts/waveform-benchmark.mjs --fixture quick --out artifacts/waveform/quick
node scripts/waveform-benchmark.mjs --fixture reference --out artifacts/waveform/reference
node scripts/waveform-benchmark.mjs --fixture medium --out artifacts/waveform/medium
node scripts/waveform-benchmark.mjs --fixture stress --out artifacts/waveform/stress
node scripts/waveform-benchmark.mjs --fixture medium --trace --out .cache/waveform/medium-trace
```

Requirements:

- Node with its built-in `WebSocket` (22.4+; 24+ recommended). The runner checks availability. No CDP, WebSocket, Playwright, or Puppeteer dependency is added.
- Installed macOS Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Permission to bind/connect to loopback sockets and launch Chrome. An editor terminal sandbox may deny these even though normal shell execution works. Run with the appropriate parent/editor permission; do not interpret a sandbox failure as a renderer regression.

Each invocation is a separate cold run with a fresh temporary Chrome profile and Vite cache. The programmatic Vite server uses `configFile: false`, the existing React plugin, `127.0.0.1`, and port `0`. Vite 5's high-level `listen()` replaces zero with its default port, so the harness calls its initializing HTTP-server wrapper with zero directly. No fixed application port, TLS configuration, proxy, or existing development server is used.

Chrome runs headless, with a temporary profile, remote debugging bound to loopback and `--remote-debugging-port=0`. The runner discovers the assigned port/browser endpoint through **`DevToolsActivePort`**, connects using Node's built-in WebSocket, and uses flattened CDP sessions. It does not expose a remote debugger on the LAN or disable Chrome's sandbox. No external audio/media is fetched. Machine hostname and hardware/browser information are recorded locally; redact them before sharing results if needed.

The default **total deadline is 120 seconds**, including a reserved 10 seconds for cleanup. `--timeout-ms` can lower it (15,000–120,000). Cold source completion has a separate **60-second maximum**, page initialization 20 seconds, browser discovery 15 seconds, and visible settling 8 seconds per operation. The total deadline overrides all stage budgets. Timeout is a failure, never an empty successful sample.

The runner closes the page's resources, Chrome/CDP, Vite, and the temporary profile in `finally`, including on SIGINT/SIGTERM. It escalates Chrome termination to SIGKILL if necessary and has a final hard deadline. SIGKILL of the runner itself or an OS crash cannot execute JavaScript cleanup.

## Outputs and exit status

`--out` must resolve to a **subdirectory of this project**, without symlink escapes. Outputs are:

- `results.json`: machine/browser identity, fixture metadata/version/seed, real measurements and sample counts, assertions, resource counters, errors, cleanup results, and limitations.
- `settled.png`: CDP screenshot at 1440 × 1500 CSS px, DPR 2, after the final Timeline settles. Its pixel dimensions are normally twice the CSS dimensions. On a completed run with failed checks a screenshot is still useful; inspect the JSON rather than assuming an existing image means success.
- `chrome-trace.json` (with `--trace`): Chrome timeline/V8/user-timing events around warm interactions, readable in Chrome's Performance panel. Capture starts when the runner observes the warm stage (up to 150 ms after its start) and stops when it observes the following stage. The runner caps trace output at 64 MiB and rejects reported data loss. Tracing adds overhead; use a separate untraced run for timing comparisons. Function-call events enable investigation but do not supply a complete sampling profile or automatically classify waveform-attributable long tasks.

These filenames are overwritten on a new run in the same directory. Old screenshots/traces are removed at startup. Early startup failures can produce JSON without a screenshot. The absolute hard-stop fallback may terminate before JSON can be written.

**`artifacts/` is not currently ignored.** This change deliberately does not edit `.gitignore`. Choose an output path under already-ignored `.cache/` for disposable results, or have the parent decide an artifact retention/ignore policy:

```sh
node scripts/waveform-benchmark.mjs --fixture medium --out .cache/waveform/medium
```

Exit 0 means functional/raster/resource assertions passed, no uncaught browser/console errors were observed, and cleanup succeeded. Exit 1 means startup, execution, an assertion, or cleanup failed. **Exit 0 is not a performance release certification.** Provisional timing budgets are reported for comparison rather than enforced on an unnamed headless machine. Review `page.budgets`, full distributions, and failures together.

## Versioned fixtures

Fixture definition: `scripts/waveformFixtures.js`, version `apollo-waveform-v1`, seed `0x5eed2026`. Bump the version when changing PCM generation, placement, or membership. PCM is created with a real browser `AudioContext.createBuffer()`, populated in yielding chunks, and inserted with `audioManager.mediaCache.set()` so the production worker/data lifecycle starts normally. Fixture creation time is separate from cold extraction timing. Buffers are never played.

| Fixture | Metadata | Real allocated PCM |
| --- | --- | --- |
| `quick` | 16 tracks, 64 clips, two nested groups | Two ~3-second 48 kHz stereo sources (~2.3 MiB) |
| `reference` | 12 tracks, 36 repeated/cropped clips, nested groups | Six ~2-second sources: mono/stereo at 44.1/48/96 kHz, with partial final buckets |
| `medium` | **24 tracks, 200 clips**, repeated/unique source membership, nested groups; viewport accommodates at least 12 rows | **Four unique three-minute, 48 kHz stereo sources**, 12 unique decoded minutes, 276,480,000 playback PCM bytes (~264 MiB), plus worker summaries/staging/browser memory |
| `stress` | **64 tracks, exactly 2,000 clips**, six nested groups, narrow clips, one two-hour source clip | Four real ~3-second 48 kHz stereo sources. **`fullPCM: false`**; the two-hour source is metadata only, with **zero** PCM bytes allocated |

The stress two-hour clip stays missing media. It is mapped through the real Timeline at sample zoom and its shell/resource bounds are checked. **No short AudioBuffer is associated with the two-hour identity.** This tests long-time geometry and missing-media behavior, not decoding/extracting/rasterizing two hours of audio. The short sources have truthful matching source duration and crop metadata. Stress results must not be presented as a full-PCM two-hour performance claim. True long-source extraction, paging, playback, and recording are separate gates.

Reference PCM includes silence, positive/negative DC, positive-only/negative-only sections, sine/square waves, inverted stereo, boundary impulses, partial final buckets, values outside ±1, NaN, and infinity. The settled browser checks cover visible ink, stereo lanes, group activity, source crops, and sample zoom. A dedicated real Timeline reference view crops to `[130,190)` ms of +0.3/−0.3 stereo DC, excluding early impulses. Pixel reads verify left-channel ink above its zero line and right-channel ink below its zero line, without opposite-sign/cropped impulse bleed. This is a targeted raster assertion, **not** a replacement for exact range-query/property tests across every signal/boundary.

## Measurement procedure

1. Generate real PCM, then timestamp each cache insertion. Wait for all real sources to report ready, rejecting source errors explicitly. Record cache-set-to-ready timings and their p95, including serial worker queue wait. Verify one job per unique source, worker rather than fallback, and attached PCM buffers.
2. Settle the actual visible scheduler, then inspect Canvas `getImageData()`. The host is a height-constrained flex column, matching Timeline's flex layout contract; a zero-height tracks viewport fails immediately. Count blue waveform/red over-range ink separately from neutral gray zero lines, require actual waveform and group ink, check stereo lanes, document overflow, bounded canvas width, effective DPR, and backing bytes. Pixel scans are outside measured warm gestures.
3. Collect **60 idle frame intervals** using `requestAnimationFrame` and `performance.now()` as a cadence baseline.
4. Collect **180 warm frame intervals**, driving range inputs through the native `HTMLInputElement.value` setter plus bubbling `input`/`change`, modifier-wheel events with coordinates derived from the real component rectangle, and horizontal/vertical scroll events. Events run inside the browser harness, not a substitute renderer. Synthetic wheel events have no browser default scrolling; normal scrolling is applied explicitly to the real scroller.
5. Wrap the existing scheduler's `schedule()` callbacks temporarily to sum actual job execution time between observed frames. The production scheduler and its cooperative draw jobs still do the work. Report the raw samples and p95; confirm warm gestures do not start extraction or copy/scan full PCM.
6. Observe actual waveform Canvas fill/stroke submissions following inputs, excluding neutral zero-line fills. At the next measured rAF record input-to-submission-frame response. Report observed, missing/superseded and total sample counts, not fabricated zeroes for missing responses. The scalar distribution requires at least ten observed submissions. This is a conservative renderer response proxy, **not physical presentation latency**, and not proof every pixel has refined. Wrappers are restored before visual/lifecycle work.
7. Measure ten isolated alternating slider inputs through visible scheduler-idle/ready settling. Report input-to-settled p50/p95 and raw samples separately from first submission. This conservative proxy includes React work and rAF/poll overhead, not precise physical presentation or gesture-end timestamps. Then exercise sample zoom, signed/cropped stereo (reference fixture), DPR 2, and a **container-only width change to 1080 CSS px**, without dispatching `window.resize`. Assert actual viewport update and bounded raster geometry.
8. Open/close the real Timeline **20 times**, allowing every mounted view to settle. Record mounted/unmounted service/raster/scheduler stats for every cycle. Require zero retained owned raster bytes/surfaces, no pending scheduler frames/jobs, zero pins, and service view listener count back at the clean baseline on every unmount. Sources intentionally remain warm in the playback cache across these cycles. This tests view/project-open-close resources, not full decode/reload or heap GC.
9. Restore the overview, settle, collect final counters, take the screenshot via CDP, then dispose/terminate everything.

Resource reporting includes the service's chunk/sample/job/cache counters, worker failures/fallbacks, resident/accounted/staging bytes, persistent-cache counters where exposed, raster peak/current bytes/surfaces, and scheduler totals/maxima/errors. A 100 ms observer reports **sampled** queue depth, active jobs, accounted/staging/raster bytes, and Chrome JS heap usage when exposed. Sampled maxima are not exact peak process, worker, compositor, GPU, or playback memory; the service/raster built-in high-water counters are recorded too. Buffer allocation bytes are calculated from the actual fixture shape.

## Interpreting performance honestly

Compare the medium fixture against the plan's provisional targets on a **named baseline device**, using repeated independent runs:

- warm total frame interval p95 ≤16.7 ms for a 60 Hz target;
- scheduler/query/draw p95 approximately ≤4 ms per frame (this harness conservatively includes geometry/observer callback work);
- input-to-first-response p95 ≤33 ms;
- cold three-minute stereo summary p95 ≤2 seconds after buffer availability (this harness includes queue wait, not isolated extraction CPU time).

Raw frame intervals and sample counts are retained. `framesOver16_7Ms` counts intervals above that numeric threshold, **not measured dropped display frames**. `estimatedMissedIdleCadenceFrames` is explicitly an estimate relative to the measured idle median. A headless browser's idle rAF interval **does not establish a physical monitor refresh rate**. The report leaves physical refresh rate unknown; do not advertise 120 Hz support from this run, even if some intervals are under 8.3 ms.

The Long Tasks observer records all ≥50 ms main-thread tasks and tasks overlapping the warm interaction window. Standard Long Tasks attribution does **not identify JavaScript stacks or worker/extraction responsibility**, so `waveformAttributableLongTasks.count` is deliberately `null`, not a fabricated zero. Zero overlapping tasks is useful evidence; nonzero tasks require reviewing a browser Performance trace to establish attribution. Use `--trace` to capture one; capture alone cannot certify “no waveform-attributable long tasks.”

Still required for a release decision: physical Chrome/Safari/Firefox profiling on baseline/lower-powered devices; precise presented refinement latency; DPR transitions and theme/height seams; RMS/dB/scale fidelity; editing/undo/autosave and trusted hardware input; persistent-summary warm reload; playback/capture/live-recording; replacement/eviction/failure stress; full long-source memory/paging; and retained heap/GPU analysis. The focused checks here supplement, rather than replace, existing unit/component tests and those manual gates.

## Recovery and measured results — 2026-10-28

The previous thread stopped at an `EPERM` loopback failure. Loopback and headless Chrome work in this session. The supplied handoff and uncommitted working tree were used as the recovery baseline; Junie's session catalog contains no earlier Apollo session.

Recovered/fixed issues:

- The benchmark host lacked Timeline's flex-column layout contract, leaving the tracks viewport at zero height. It now supplies that layout and rejects zero-height measurements.
- Pixel classification previously counted the blue-gray zero line as blue waveform ink. The classifier now excludes it; the signed DC reference crop passes without opposite-sign/impulse bleed.
- Overview drawing yielded far too frequently: a deterministic reproduction needed 60,804 slices for 54 stereo views. Batching exact 256-sample query steps within a 1 ms local deadline, 8,192-raw-sample/1,024-query-step cap and remaining shared frame deadline reduces the regression to at most 2,200 slices. Both component paths and benchmark instrumentation forward that deadline.
- Long, rebased recording previews restored a huge negative DOM offset and full recording width. Placement now uses a bounded visible surface and `clipOffsetPx`, preserving source-time queries; recording and Timeline integration regressions pass.

### Environment and latest untraced runs

Apple M2, 8 logical CPUs, macOS Darwin 25.6.0, Node 25.5.0, Chrome 156.0.8078.48 (headless), 1440 × 1500 CSS px, DPR 2. Physical refresh rate is unknown; idle rAF p95 was approximately 17 ms. This is a development Vite/React build, not a production-bundle or hardware-display certification. Each row below is one independent run, not a distribution of independent project loads.

| Fixture | Functional/resource run | Warm frame p50 / p95 | Job p95 | First submission p95 | Settled-refinement proxy p50 / p95 |
| --- | --- | --- | --- | --- | --- |
| Quick | Passed, 20 cycles | 16.7 / 18.9 ms | 4.0 ms | 23.7 ms | 499.6 / 549.9 ms |
| Reference | Passed, 20 cycles | 16.7 / 18.2 ms | 4.0 ms | 23.0 ms | 333.4 / 333.4 ms |
| Medium | Passed, 20 cycles | 16.7 / 25.5 ms | 4.0 ms | 37.1 ms | 883.4 / 916.6 ms |
| Stress (metadata-only long source) | **Timed out**, 17/20 cycles | 16.8 / 160.7 ms | 3.3 ms | 399.8 ms | 2450.0 / 2866.2 ms |

Samples: 180 warm frames, 18 observed input submissions for quick/reference/medium, 10 for stress, and 10 isolated refinement inputs each. Stress figures are partial-run observations, not a successful acceptance run. The default 120 s total deadline reserves 10 s for cleanup; the expanded stress fixture exceeded its 110 s execution budget. An earlier stress run without the added refinement stage completed 20 cycles, but it does not supersede this latest failure.

Medium details:

- Four real three-minute stereo buffers: 276,480,000 playback-owned PCM bytes. Source-ready p95 across these four jobs (including serial queue wait) was **1,416.3 ms**; this is not p95 across repeated cold loads.
- Zero ≥50 ms tasks overlapped the measured warm window. Warm gestures started no new source jobs or full-source PCM scans/copies. The four original jobs completed without worker failure or fallback; trusted disk-cache hits were zero in this cold run.
- Observed resident/accounted summaries: **17,301,376 bytes**; raster high-water: **36,094,464 bytes**; observed staging: **65,536 bytes**; sampled maximum queue depth: **4**. These exclude playback PCM and browser-internal compositor/GPU allocations. Sampled JS heap reached approximately **420 MB** and is not a retained-heap measurement.
- All 20 unmounts returned owned raster bytes/surfaces, scheduler jobs/frames and source pins to zero, with service view listeners at baseline. This is warm-buffer Timeline mount/unmount validation, not a full media unload/GC test.
- Initial/final overview each had 111 ink-bearing visible canvases, including two group activity surfaces. Container-only resize, bounded canvas geometry, attached playback PCM and sample view passed.

The latest medium run **misses** the unchanged 16.7 ms frame, 33 ms response and 100 ms refinement targets. An earlier independent untraced medium run had 24.7 ms frame p95 and 31.1 ms response p95, showing that even the response gate is not reliably met. Do not equate the functional `PASS` output with release acceptance.

### Trace evidence and remaining decision

Separate quick/medium traced runs saved `chrome-trace.json` successfully with no reported data loss. Medium capture contains 22,313 events. Main-thread inclusive durations include scheduler `flush` (~1,201 ms), React `performWorkUntilDeadline` (~315 ms), style/layout (~204 ms), and paint/prepaint/layerization (~364 ms); nested totals must not be added together. Six animation callbacks exceed 16.7 ms (maximum 24.7 ms), with input-event/microtask work prominent. No warm main-thread event exceeds 50 ms. The trace lacks compositor/raster/presented-frame data and sampling stacks, so it neither proves a single cause nor rules waveform work out of the frame-time miss.

Local outputs: `.cache/waveform/{quick,reference,medium,stress}/results.json` and successful-run `settled.png`; traces under `.cache/waveform/{quick-trace,medium-trace}/chrome-trace.json`. These ignored files contain machine identity. The traced runs predate the added isolated-refinement stage; use untraced final results for the table above. Final reference and stress overview screenshots from completed runs were inspected visually; the latest failed stress run removes its old screenshot rather than leaving stale success evidence.

**Rollout remains incomplete.** Keep the current modern development default and the working legacy override/build switch; do not remove WaveSurfer or approve production rollout based on these runs. Next work should address repeated exact-query/raster workload and Timeline input/DOM costs, then rerun unchanged gates. Full-PCM long sources/paged residency and recording-finalization summary reuse remain requirements to reconcile with the plan, not validated features of this benchmark. Safari/Firefox, lower-powered/physical devices, playback/capture/export and the remaining manual gates above are unmeasured.

Validation commands completed: `npm test -- --run` (**684 tests / 72 files**), `npm run build`, `VITE_WAVEFORM_RENDERER=legacy npm run build`, final default `npm run build`, and `git diff --check`. Only the known stale Browserslist and large-bundle warnings remain. No dependency, application-server configuration, database service or Docker change was made in this recovery session.
