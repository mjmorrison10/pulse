---
approved: 2026-07-28
---

# PULSE: a hook is not a platform — cross-platform balance for auto-promotion

## Goal
The auto-promote engine shipped earlier today judged each post only against its
own platform. The owner's X account is new and small, so a 346-view post was
top-10% AND past 3x X's median — and its hook went into the HOOKLAB ledger.
The same clip did 3,519 views on Snapchat, which is unremarkable for this
account. The engine had promoted the platform's smallness, not the hook.

Owner's framing: "it's my best post on X but that hook shouldn't be in the
ledger when on other platforms the same video would get thousands... there
needs to be a balance between single platform and all platforms."

## Root cause
`computeAutoWinners` qualified per platform only. Cross-platform data was
consulted for dedupe and notes, never as evidence. A low median makes a small
absolute number clear the 3x gate, and nothing checked whether the same clip
was ordinary everywhere else.

## Changes (pulse/app.js)
- `AUTO_PROMOTE` gains `CROSS_MULT: 2`.
- Grouping now runs over EVERY measured post carrying a hook, not just the ones
  that qualify — the posts that did NOT break out are precisely the evidence
  the new gate needs. Identity tiers and the Jaccard merge are unchanged.
- Per-platform baselines are computed once into `stats` (median, sample size,
  top-10% cutoff); `qualifies(post)` reads from it. Platforms under
  `MIN_SAMPLE` have no reliable median, so they neither promote a post nor
  argue against one.
- New gate, after candidacy: take the clip's best showing on each platform with
  a reliable median, express each as `views / platformMedian`, and require the
  GEOMETRIC MEAN of those multiples to clear `CROSS_MULT`.
  Geometric, so magnitude carries but one reading cannot dominate:
  35x with a flat 1x companion still promotes (~6.0); 3.3x against a 1.0x does
  not (~1.8). One measured platform is unaffected — the mean is its own
  multiple, already past `OUTLIER_MULT`.
- When two or more platforms were measured, the provenance note states the
  balance: `; cross-platform 6x your medians (2 platforms)`, so the reason a
  hook cleared the bar is always visible.

Manual-outcome suppression, demotion, tombstones and toasts are untouched. The
engine is derived state recomputed on every save, so the already-promoted X
entry demotes itself the next time PULSE opens — no manual cleanup.

## Known boundary (deliberate, pinned by a test)
Against a single 1.0x companion platform, `CROSS_MULT: 2` blocks a breakout
below roughly 4x its own median and allows one above it. That is the tradeoff
the owner chose over "must beat median everywhere", which would have vetoed
genuine single-platform algorithm hits. Raising `CROSS_MULT` tightens it; the
constant is the only tuning surface.

## Files
`pulse/app.js` (engine only — no storage shape, no stackdata, no other app)

## Rollback
Revert the commit. Entries blocked by the gate simply reappear on the next
recompute; nothing is destroyed.

## Verification
`pulse-autopromote-verify.mjs`, extended to 57 checks.

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R1 the reported case (346 on X ~3.3x, 3,519 on Snapchat ~1.0x) does not promote | PASS |
| R2 X-only promotes; recording the Snapchat number retroactively demotes it and tombstones it | PASS |
| R3 a 35x smash survives a flat 1x companion; note reads "cross-platform 6x your medians (2 platforms)" | PASS |
| R3 strong-on-several (3x / 2.5x / 1.8x -> 2.4x) promotes | PASS |
| R4 original single-platform cases unchanged (all 39 pre-existing checks) | PASS |
| R5 a platform with only 3 recorded posts neither promotes nor vetoes | PASS |
| R6 a single measured platform reports no cross-platform figure | PASS |
| Boundary pinned: ~4.5x breakout + one ordinary platform promotes at 2.1x | PASS |
| Regression: pulse clipid/clipkey/group/heal/record/ux/ytcheck/batch-import, merge-engine, blast-sync-truth | PASS |
