# Blind UI Critic Rubric & Prompt Template

Use this reference verbatim for **every** blind visual critic—whether running in **T3 Code**, **Cursor**, **Codex**, or **Antigravity**, and across **Claude Opus 5.5**, **Gemini 4 Neon**, **Luna 6**, or **Grok 4.7**.

> **STRICT BLINDNESS RULE:** Never insert round numbers, prior scores, target thresholds, or descriptions of recent edits into the critic prompt. Always run in a brand-new, read-only session/thread.

---

## Non-Negotiable Apollo Design Locks (Include in Every Brief)
1. **Hover-Only Volume & Playback Sliders:** Track volume, master volume, and player sliders intentionally show a crisp white value fill with **no resting knob** when idle, revealing a circular white handle and Apollo Gold highlight only on hover/drag. **Do not penalize missing resting thumbs on idle volume bars.**
2. **No Fake Media Asset Penalties:** Apollo is a rehearsal/choral/DAW tool without external album art or artist photos. Judge how cleanly it presents its real content using typography, spacing, elevation, and accents.
3. **Brand Asset Lock:** Apollo logo/wordmark shapes are fixed; evaluate surrounding presentation only.
4. **Proportional & Dead-Space Audit:** Explicitly flag oversized/sparse modals, awkward dead space, clipped controls, broken z-index layering, cramped native dropdown carets, or low-contrast muted/disabled states.

---

## Rubric A — App Routes (`/player`, `/download`, `/admin`, Landing)
**Screenshot Folders:**
- Current candidate: `.ui-eval/current/`
- Prior baseline: `.ui-eval/baseline/`
- Visual benchmarks: `.ui-eval/references/` (TIDAL & Spotify desktop/mobile)

**5 Categories (`1.0` to `10.0` in `0.1` increments):**
1. **Layout & Screen Architecture** (clarity, proportions, dead space, scannability vs. TIDAL/Spotify)
2. **Obsidian + Apollo Gold Aesthetic** (deep obsidian surfaces, zero leftover legacy blue/gray, restrained gold accents)
3. **Typography, Hierarchy & Legibility** (contrast, headings, numeric alignment, disabled/muted clarity)
4. **Popups, Submenus & Mobile Cohesion** (overlays, context menus, hover states, touch targets, `390x844` responsiveness)
5. **Polish, Alignment & Control Affordance** (borders, sliders, icon alignment, micro-interactions)

---

## Rubric B — Studio DAW (`/daw`)
**Screenshot Folders:**
- Current candidate: `.ui-eval/daw-current/`
- Prior baseline: `.ui-eval/daw-baseline/`
- Cross-app benchmark: `.ui-eval/current/song-desktop.png` (Apollo Player)

**Additional DAW Locks:**
- Must preserve existing desktop layout, control positions, and `384px` track sidebar ergonomics.
- Must maintain **5 distinct jewel-toned track-role colors** (Instrument amethyst, Lead cerulean, Choir emerald, Metronome copper, Other platinum) across stripes, badges, menus, and waveforms.
- Must preserve **unmistakable red recording cues** (Record button, recording playhead/overlay, active Mute).
- Desktop (`1440x900`) is the primary target; mobile (`390x844`) should remain clean and usable.

**5 Categories (`1.0` to `10.0` in `0.1` increments):**
1. **Layout & Control Preservation**
2. **Obsidian + Apollo Gold & Track-Role Color System**
3. **Typography, Contrast & Studio Legibility**
4. **Popups, Modals & Responsive Usability**
5. **Polish, Alignment & Control Affordance**

---

## Copy-Paste Blind Critic Prompt Template (For T3 Code / Cursor / Codex / Antigravity)

```markdown
Evaluate the Apollo UI visually and objectively with zero prior assumptions.
You are a strict, read-only Senior Product Designer. Do NOT edit any files or run build commands.

Inspect ALL PNG screenshots in:
1. Current candidate: `<.ui-eval/current/ OR .ui-eval/daw-current/>`
2. Prior baseline: `<.ui-eval/baseline/ OR .ui-eval/daw-baseline/>`
3. Visual benchmark(s): `<.ui-eval/references/ OR .ui-eval/current/song-desktop.png>`

Evaluate strictly against these rules:
- Follow Apollo's high-contrast Obsidian + Apollo Gold aesthetic with zero legacy blue/gray leakage.
- Volume/playback sliders intentionally show a crisp white fill with NO permanent resting knob at rest, revealing a white circular knob and gold highlight only on hover/drag. Do not penalize missing resting thumbs on idle volume bars (verify hover/interactive screenshots when provided).
- Do not penalize Apollo for lacking external album artwork or artist photos.
- Explicitly inspect for modal proportions, dead vertical/horizontal space, z-index/backdrop leaks, cramped native form controls, muted/disabled contrast, alignment, and mobile clipping.
- <If DAW: Keep existing desktop layout/control positions intact, preserve 5 distinct track-role colors, and keep unmistakable red recording cues.>

Scoring scale (1.0 to 10.0 in 0.1 increments):
- 7.0 = acceptable functional UI
- 8.0 = strong commercial polish
- 9.0 = flagship benchmark studio/music app (TIDAL / Logic Pro dark / Ableton dark)
- 9.5+ = practically flawless

Output:
1. A Markdown comparison table with columns: Category | Baseline | Current | Delta, plus an Average row, across the 5 categories from `.agents/skills/ui-council/references/critic-rubric.md`.
2. Concise, pixel-accurate observations for each screenshot (desktop, interactive/hover states, menus, modals, mobile).
3. The Top 4 concrete, highest-impact visual/CSS/layout fixes for the current candidate (pinpointing exact components/elements visible in the screenshots).
```

---

## Advisory Handling for Tier 3 Wildcard Critics (`Luna 6`, `Grok 4.7`)
When running `Luna 6` (Codex Free) or `Grok 4.7` (Cursor) with the template above:
- Treat their numeric score as **informational only** (do not let it block or override Neon/Opus).
- Audit their Top 4 list against the actual screenshots: adopt concrete real catches (e.g., clipped text, uneven margins, weak contrast) and discard any hallucinated element or lock-violating advice.
