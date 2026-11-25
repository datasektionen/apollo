# Apollo Agent Guidelines (`AGENTS.md`)

This repository uses a multi-agent workflow across **T3 Code**, **Antigravity**, **Cursor**, and **Codex**. Every agent operating on this repo must follow these architecture rules, design locks, and verification commands.

## 1. Branch & Git Hygiene
- Active UI redesign branch: `ui-player-overhaul` (pre-DAW revert checkpoint: `682e67f`).
- Commit every completed round or verified feature slice cleanly (`git add src/ index.html ...`).
- Never stage `.ui-eval/node_modules/` or temporary screenshot dumps unless explicitly requested.
- If a visual hill-climbing round regresses average council scores vs. the previous round, revert the round before trying a different approach.

## 2. Apollo Design System & Non-Negotiable Taste Locks
All modernized routes (`/player`, `/download`, `/admin`, Landing, and `/daw`) share Apollo's **Obsidian + Apollo Gold** design language:
- **Scoped Theme Architecture:**
  - Core tokens live in `src/styles/player-theme.css` (`.player-theme`, `data-player-theme="dark-gold"`).
  - DAW tokens live in `src/styles/daw-theme.css` (`.daw-theme`, layered alongside `.player-theme`).
  - Always use semantic CSS custom properties (`--player-*`, `--daw-*`) rather than hardcoding legacy Tailwind blue/slate/navy classes (`bg-gray-800`, `bg-blue-600`, `#0b1528`).
- **Brand Asset Lock:** Do **not** redraw, alter, or replace Apollo logo or wordmark SVG assets.
- **Unified Hover-Only Slider Behavior:**
  - All volume, playback progress, and mixer sliders intentionally render a **clean white fill with NO resting thumb** when idle.
  - On hover/active/focus-visible, the fill highlights in **Apollo Gold** (`#cb9e37` / `#d9b76d`) and reveals a **circular white handle** centered on the value.
  - Never add permanent resting thumbs to track/master volume or player range sliders.
  - Practice Focus slider uses the clipped bipolar outline design (`-20` to `+20` in discrete `±2` steps).
- **DAW Studio Constraints:**
  - Preserve desktop layout, control placement, and ergonomics (`384px` left track panel at `md+`, transport order, ruler/zoom controls).
  - Keep **5 distinct jewel-toned track-role colors** via `getDawRolePalette(role)` in `src/utils/trackRoles.js` (`instrument` amethyst, `lead` cerulean, `choir` emerald, `metronome` copper, `other` platinum).
  - Keep **red** for recording cues (Record button, active recording playhead, live recording waveform/overlay, and active Mute indicators).
  - Keep mobile (`390x844`) clean and usable (compact rail + docked mobile Mixer/Zoom bar).
- **Preserve Business Logic:** Do not alter playback, audio engine, sync/locking, routing, or data semantics during visual work unless fixing a verified UI-blocking bug.

## 3. Build, Deploy & Visual Verification Commands
Live Docker stack serves `https://localhost:3000` from `apollo-web-1:/usr/share/nginx/html`. Always rebuild and copy `dist/.` into the container before capturing live screenshots.

- **One-command build + deploy + capture (App routes: `/player`, `/download`, `/admin`):**
  ```bash
  npm run ui:eval:app
  ```
- **One-command build + deploy + capture (DAW routes + modals + hover/armed state + mobile):**
  ```bash
  npm run ui:eval:daw
  ```
- **Optional custom output folder (e.g., refreshing a baseline):**
  ```bash
  ./.agents/skills/ui-council/scripts/deploy-and-capture.sh daw daw-baseline
  ```
- Both Playwright scripts render at Retina `2x` (`1440x900` desktop, `390x844` mobile) and fail immediately on any browser `console.error` or `pageerror`.

## 4. Test Suite & Known Invariants
Run tests with:
```bash
npx vitest run
```
Preserve these test invariants:
- `src/components/GroupWaveform.jsx`: Keep `MISSING_COLOR = 'rgba(248, 113, 113, 0.55)'` (`Waveform.test.jsx:393`).
- `src/components/ImportTrackMap.jsx` & `src/components/TrackList.jsx`: Keep `${getRoleColorClass(role)}` alongside `${palette.badgeClass}` so `.bg-green-600` selectors in `FileImport.test.jsx:177` keep passing while `.daw-theme .daw-role-badge` styles the visual appearance.
- **Pre-existing unrelated test note:** `src/components/__tests__/DistributionLanding.test.jsx:57` may fail on a pre-existing copy assertion (`'If you have 0 space or trust...'` vs `'If you have no space or trust...'`). Always report exact pass/fail counts honestly and ensure `0` regressions in your target area.

## 5. UI Council Skill
For autonomous visual hill-climbing and multi-model UI critique (across Antigravity, Cursor, Codex, and T3 Code), follow:
- Skill: `.agents/skills/ui-council/SKILL.md`
- Shared Blind Critic Rubric & Prompt Template: `.agents/skills/ui-council/references/critic-rubric.md`
