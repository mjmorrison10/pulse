---
approved: 2026-07-22
---

# PULSE: pre-filled record inputs + steppers

## Goal
Owner records views in the "By platform" view, walking down the list. Today
each views input is empty (placeholder only), so re-entering a number that
barely moved is friction. Ask: pre-fill each input with the last recorded
number, add up/down nudge buttons, and make it obvious whether anything
changed — so an unchanged clip is a single "Record" tap.

## What changed (app.js, style.css)
- New helpers after `fmtNum`: `stepFor(v)` (adaptive step: 1 / 10 / 100 / 1000
  by magnitude) and `snapInputHTML(post, ph)` (returns `−` / input / `+`). The
  input pre-fills with `String(latestSnap(post).views)` — raw digits, never
  `fmtNum` — and carries `data-base` = the prefilled value. Empty state (no
  snapshots) keeps the placeholder, no value/base.
- Both render sites use the helper: `postCardHTML` snaprow (placeholder
  "e.g. 12400") and `platformRowHTML` (placeholder "views").
- `bindPostActions`: new `data-act="step"` branch nudges the input by
  `stepFor(current)` (falling back to `data-base` when the box is empty),
  clamped ≥0, and toggles a `.changed` class vs `data-base`. An `input`
  listener toggles the same class on manual typing.
- `recordManual` unchanged — it already accepts the pre-filled value, so
  "press Record unchanged" just records the current number; the full `render()`
  after recording re-fills every input from the new latest snapshot (the
  walk-down flow).
- CSS: `.stepbtn` (34px, border/surface2, brand hover, brand-ghost active) and
  `input.changed{border-color:var(--brand)}`; mobile shrinks `.prow .stepbtn`
  to 30px and `.prow input` to 70px so the row still fits.

## Files touched
`app.js`, `style.css`. No storage/schema change (snapshots unchanged).

## Rollback
Revert both files. Existing posts/snapshots unaffected.

## Verification — PASS (headless Playwright, 2026-07-22)
Seeded one post with a 12400-view snapshot + one with none, in By-platform
view; 13/13 green:
- input pre-fills raw `12400` with `data-base`, not marked changed;
  no-snapshot input stays empty (placeholder).
- two steppers present; `+` → `13400` (step 1000) and marks `.changed`.
- Record → new 13400 snapshot; input re-fills to 13400 after render.
- Record on the untouched pre-fill records again (snapshots grow).
- Record on the empty input adds no snapshot (toast path).
- no page errors.
Script: scratchpad/pulse-record-verify.mjs.

## Audit (post-execution)
- PLAN: written + approved (this file). PASS
- EXECUTE: app.js helpers + step branch + input listener, style.css. PASS
- VERIFY: 13/13 headless assertions green. PASS
- SHIP: push → PR → squash-merge → live-URL cache-busted poll (below).
