---
approved: 2026-07-28
---

# PULSE: auto-promote breakout hooks into the HOOKLAB ledger

## Goal
A video hit 50k views in 24h against a normal range of a few hundred to a few
thousand. The views were recorded in PULSE, and the HOOKLAB ledger showed
nothing — the hook that earned it was never captured, because logging a winner
was a manual button nobody remembers to press.

Make a breakout hook register itself. The bar has to be relative: 50k is a
breakout on one account and a flop on an account that normally does 500k. It
also has to stay silent for an account whose videos all land in the same band —
"top 10% of 1-3k views" is not a hook worth keeping.

## Facts (before this change)
- PULSE writes HOOKLAB entries only from the manual Winner/Meh/Dead buttons,
  via `logToLedger(post, outcome)` -> `hooklab_state_v1.ledger`, id
  `"pulse_" + post.id` (app.js).
- Downstream consumers filter `outcome === "winner"` and read `.hook`: BLAST's
  `loadHooklabEvidence` (blast/app.js:1577) and RECALL Top Clips' ledger
  matching. Neither needs to change for an auto entry to count.
- `StackData.tombstone(kind, id)` suppresses an item in a Drive merge only
  while the tombstone is NEWER than the item's own timestamp (stackdata.js) —
  so a re-added entry with a fresh `createdAt` survives its own old tombstone.
- Every posts mutation (record, YouTube check, BLAST import, manual add,
  delete) ends at `savePosts()`.

## Changes (pulse/app.js, pulse/style.css)
- `AUTO_PROMOTE = { MIN_SAMPLE: 8, TOP_PCT: 0.10, OUTLIER_MULT: 3 }` — one
  block, the only tuning surface. A post is promoted when all three hold on
  **its own platform**:
  1. the platform has >= 8 posts with a recorded view count,
  2. the post is in the top 10% of that platform by views,
  3. it clears 3x that platform's **median**.
  Median, not mean: the outlier being detected would drag a mean upward and
  hide itself. Gate 3 is what keeps a flat account quiet — everything landing
  1-3k has a top 10%, but nothing is 3x the middle. Views of 0 mean "not
  measured", so those posts sit out of both the population and the ranking.
- `computeAutoWinners(posts)` — pure. Population and ranking per platform,
  ties at the top-10% boundary all included (an arbitrary tiebreak would make
  the set flap between saves).
- One entry per HOOK, not per post: group by `clipId`, else `clipKey`, else
  normalized hook text, then fuzzy-merge groups whose hook token sets overlap
  at Jaccard >= 0.55 (`tokens`/`jaccardSets`, following recall/topclips.js).
  That is the workflow case: the clip is cut in RECALL, the caption comes from
  the FULL transcription in BLAST, so the same hook arrives longer or shorter.
  Best-performing instance owns the entry; the rest are named in the notes.
- A manual outcome (winner, meh, OR dead) suppresses auto-promotion for that
  post. The user's own verdict outranks the math in both directions.
- `syncAutoWinners()` recomputes the whole desired set and applies only the
  delta, under its own id namespace `pulseauto_*` — it can never touch a
  manual `pulse_*` or a HOOKLAB-native entry. No delta means no write and no
  toast. Removals are deleted AND tombstoned; a later re-promotion carries a
  fresh `createdAt` and survives. Auto entries are derived state, so a stale
  one arriving from another device is cleaned up on the next pass.
- Called from `savePosts()` (covers every mutation path) and once on boot
  (covers views recorded on another device). It never calls `savePosts`, so
  there is no recursion.
- Feedback: a toast summarizing the change, delayed ~1.1s so the triggering
  action's own toast ("Recorded 50K views") isn't overwritten; a `✦ AUTO in
  HOOKLAB` marker in the outcome row of every promoted post.
- `toast()` now no-ops when `#toast` is missing instead of throwing.

## Files
- `pulse/app.js` — engine, sync, boot call, card marker, toast guard
- `pulse/style.css` — `.autotag`
- (companion) `Hooklabs/app.js`, `Hooklabs/style.css` — AUTO provenance badge

## Rollback
Delete every `pulseauto_*` entry from `hooklab_state_v1.ledger` (one filter);
manual data is untouched. Revert the commit to stop future promotion.

## Verification
`pulse-autopromote-verify.mjs` (headless, real UI, 39 checks) plus the full
regression set.

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R1 the reported case: 9 posts at 500-2100 + one at 50,000 -> exactly one entry, correct hook, provenance "top 10% on TikTok — 50,000 views vs 1,400 median (n=10)" | PASS |
| R2 fewer than 8 recorded posts -> nothing; flat 1-3k account -> nothing, at 10 posts and at 60 | PASS |
| R3 displaced by newer posts -> entry removed and tombstoned; re-qualifying re-adds it despite the tombstone | PASS |
| R4 manual dead -> never promoted; manual winner -> no duplicate, manual and HOOKLAB-native entries untouched | PASS |
| R5 same clip on 3 platforms + a longer-worded re-cut -> one entry, best instance owns it, notes name the others | PASS |
| R6 300 views promotes where the median is 85 while 50,000 does not where the median is 19,000 | PASS |
| R7 BLAST counts the auto hook as a proven winner and it reaches the caption prompt, with no BLAST changes | PASS |
| R8 HOOKLAB badges the auto entry AUTO; hand-logged entries are not badged | PASS |
| R9 unchanged recompute rewrites nothing and stays quiet | PASS |
| Live flow: recording 50,000 in the UI promotes, announces once, marks the card | PASS |
| Regression: pulse clipid/clipkey/group/heal/record/ux/ytcheck/batch-import, merge-engine, hooklab-aiux, drive-sync, restore-replace, sync-wiring, blast-batch, update-banner | PASS |
