---
name: ui-council
description: Runs a portable, harness-agnostic autonomous visual UI hill-climbing loop using deterministic Playwright screenshots and blind multi-model read-only critics (works across T3 Code, Cursor, Codex, and Antigravity).
---
# Autonomous UI Hill-Climbing Protocol (Portable Multi-Provider)

This skill works identically across **T3 Code**, **Cursor**, **Codex**, and **Antigravity**. Always read `AGENTS.md` and `.agents/skills/ui-council/references/critic-rubric.md` before starting a UI cycle.

---

## 1. Council Model Strategy & Tiering

Design the council around **two primary decision models** plus **optional non-blocking wildcard challengers** so quota goes furthest without letting weaker vision models derail or stall iterations:

| Tier | Role | Models & Providers | Blocking / Gate? |
| --- | --- | --- | --- |
| **Phase 1 Architect** | Structural blueprint, layout proportions & dead-space audit (new routes or major overhauls only) | **Claude Opus 5.5** (Antigravity or Cursor) | Sets structural plan before hill-climbing |
| **Tier 1 (Hill-Climber)** | Iterative blind scoring & top-4 visual fix list across Rounds 1–3 | **Gemini 4 Neon** (Antigravity or Cursor) | **Yes** — advance to Tier 2 once all 5 categories `>= 8.9` (or max 3 rounds) |
| **Tier 2 (Final Gate)** | Authoritative blind verification pass after Tier 1 clears | **Claude Opus 5.5** (Antigravity or Cursor) | **Yes** — target `>= 9.2`, or apply its top concrete fixes + visual re-verify when limited to 1 Opus pass |
| **Tier 3 (Wildcard / "Jester")** | Optional multi-lab second opinion to break consensus & surface overlooked nitpicks | **Luna 6** (Codex Free) and/or **Grok 4.7** (Cursor) | **NO (Advisory only)** — never blocks completion and never vetoes; the implementer or Tier 1/2 must visually confirm every wildcard claim before editing |

### Multi-Account & T3 Code Coordination Tips
- **Parallel cross-provider split:** In T3 Code, keep one writer thread on the active branch (e.g., Antigravity or Cursor Account #1) and open **fresh read-only critic threads** on other providers so you parallelize usage.
- **Cursor account rollover:** T3 Code authenticates one Cursor account at a time (`Settings -> Providers -> Cursor -> Change account` or `CURSOR_API_KEY`). Because all state lives in git commits, `AGENTS.md`, and `.ui-eval/` screenshots, rotating from Cursor Account #1 to Account #2 loses zero context.
- **Wildcard sanity rule:** If `Luna 6` or `Grok 4.7` raises a flaw, inspect the PNG yourself first. Keep sharp real catches (dead space, contrast, alignment); immediately discard hallucinations or suggestions that violate `AGENTS.md` taste locks.

---

## 2. Guardrails
- Keep all work on the active feature branch (create a clean git checkpoint commit before starting a new route).
- Commit every round that improves the score (`<Route> Redesign Round <N>: ...`).
- **Revert Guard:** If a round lowers the average Tier 1 score compared to the previous round, revert that round cleanly (`git reset --hard HEAD~1` or `git checkout -- .`) and try a different approach.
- Cap iterative hill-climbing at **3 Tier-1 rounds** before escalating to Tier 2 (and max 5 total rounds) to protect quota.
- **CRITICAL — Strict Blind Scoring:**
  - Never tell any critic what round number it is, what changed since last round, what another critic scored, or what target score stops the loop.
  - Always launch a **brand-new stateless read-only critic** (fresh T3 Code thread, fresh Cursor/Codex subagent, or fresh Antigravity swarm/subagent) per pass, and close/kill it once its reply is recorded.
- **Capture Interactive States:** Static idle views miss hover, focus, active, and popover bugs. Ensure the Playwright script captures key hover/armed/menu states alongside desktop, modal, and mobile shots.

---

## 3. Execution Loop

### Step 0 — Baseline Capture (Once Per Target Area)
Before making edits to a new route, capture a clean baseline:
```bash
./.agents/skills/ui-council/scripts/deploy-and-capture.sh app baseline
# or for DAW:
./.agents/skills/ui-council/scripts/deploy-and-capture.sh daw daw-baseline
```

### Step 1 — Phase 1 Structural Blueprint (Optional, For New Major Routes)
Invoke **Claude Opus 5.5** (read-only) on the baseline screenshots, target source files, and reference images to establish container proportions, hierarchy, and token mappings before grinding micro-polish.

### Step 2 — Round Loop (Build -> Deploy -> Capture -> Blind Critique -> Fix)
For each round:
1. **Build, Deploy & Capture (Single Command):**
   ```bash
   npm run ui:eval:app
   # or for DAW:
   npm run ui:eval:daw
   ```
   Verify exit code `0` (zero `console.error` / `pageerror`) and visually inspect the rendered PNGs before spending a critic call. Fix any obvious broken layout or z-index bug first.
2. **Tier 1 Blind Review (`Gemini 4 Neon`):**
   - Start a fresh read-only critic using the Blind Critic Prompt Template in `.agents/skills/ui-council/references/critic-rubric.md`.
   - Record its 5 category scores and top 4 concrete fixes, then close/kill the critic.
3. **Optional Tier 3 Wildcard Pass (`Luna 6` via Codex Free / `Grok 4.7` via Cursor):**
   - Optionally send the exact same blind rubric prompt to a fresh read-only `Luna 6` or `Grok 4.7` thread.
   - Cross-check any unique findings against the PNGs and `AGENTS.md` locks before adding them to your fix list.
4. **Tier 2 Gate (`Claude Opus 5.5`):**
   - If ANY Tier 1 category is `< 8.9` (and under the 3-round Tier 1 cap): implement the validated fixes, run affected `npx vitest run <tests>`, re-capture, commit the round, and run the next fresh Tier 1 pass.
   - Once ALL 5 Tier 1 categories are `>= 8.9` (or after Round 3): run a fresh blind **Claude Opus 5.5** verification pass using the same rubric.
   - If Opus scores `< 9.2` or identifies concrete high-impact fixes (dead space, typography hierarchy, contrast, responsive polish), apply those fixes, rebuild/deploy/re-capture, visually inspect every changed PNG, and commit (`<Route> Redesign Final Polish (Opus feedback): ...`). Respect any user quota cap on Opus passes (do not re-call Opus if the user asked for a single verification pass).
5. **Final Verification & Report:**
   - Run full `npx vitest run` after the final edit and confirm the latest build is deployed and captured cleanly with exit code `0`.
   - Output a round-by-round score comparison table, commit history (including the revert checkpoint), clickable links to modified files, and exact test/capture results.
