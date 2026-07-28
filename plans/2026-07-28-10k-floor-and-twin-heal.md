---
approved: 2026-07-28
---

# PULSE: a 10k floor under auto-promotion, and healing duplicate imports

## Goal
Two reports in one message.

1. Another X post cleared even the cross-platform gate. The owner's call: a
   hard floor. "10k is when the game actually starts and you're no longer a
   complete noob on the platform anyways." Below that, being your own best on
   a platform you just started is noise wearing a percentile.
2. The Pinterest list showed duplicate videos, out of order, hard to tell
   apart. The owner suspected the title/description work; the timing matched
   but the mechanism was elsewhere.

## Changes — the floor
`AUTO_PROMOTE` gains `MIN_VIEWS: 10000`, checked first in `qualifies()`.

Deliberately a hardcoded number, and deliberately only a FLOOR. The relative
gates (sample size, top 10%, 3x median, cross-platform balance) stay exactly as
they were, because they answer the question the floor can't: "is this a
breakout FOR YOU". A 500k-a-post account still promotes nothing without them.
The floor only removes the class of promotion where the multiples were
flattering because the denominator was tiny.

The owner's alternative — "reduce the platform criteria and mostly go off all
platforms combined" — is not implemented; their own follow-up ("Actually that
might work better... 10k would fix it all") chose the floor, which delivers the
intent without redesigning the engine.

## Confirmed root cause — the duplicates
Toggling a platform's Posted mark off and on in BLAST re-stamps `postedAt`
(`clearPosted` deletes it, `stampPosted` writes `Date.now()`). PULSE identified
a tracked post by `blastKey = clip + platform + "|" + postedAt`, so a re-mark
produced a NEW key and the next import minted a TWIN. The `(platform, url)`
fallback couldn't catch it on Pinterest, where the live link is rarely pasted.
The twins carried re-mark times rather than real posting times, which is what
scrambled the by-platform order (it sorts on `postedAt`), and near-identical
rows are what made them hard to tell apart.

Not caused by the title/description work — that change simply landed in the
same period as the re-marking that triggered it.

## Changes — heal and prevent
- `healImportTwins()` runs on boot beside `migrateClipIds()`. Groups posts by
  `clipId + platform` (posts with no clipId are hand-added and never touched),
  and for each group >1 keeps the richest post — manual verdict first, then a
  live link, then most readings, then earliest — while unioning every twin's
  snapshots (newest reading wins a checkpoint, same rule as stackdata's
  `mergePost`), keeping the EARLIEST `postedAt` (the real posting moment, which
  restores ordering), and lifting any url / hook / caption / outcome /
  ledgerLoggedAt the keeper lacked. Dropped ids are tombstoned as `pulsePost`
  so a Drive merge can't resurrect them. One toast; idempotent on re-run.
- The import dupe predicate now checks clip + platform FIRST, then the old
  BLAST key, then `(platform, url)`. One clip goes to one platform once — that
  is what a tracked post IS; the timestamp was a stand-in that broke.

## Files
`pulse/app.js`

## Rollback
Revert the commit. Healed data stays healed — the twins were corruption, and
the merge preserved every reading and verdict.

## Verification
`pulse-autopromote-verify.mjs` (floor cases + rescaled fixtures) and the new
`pulse-twins-verify.mjs`.

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R11 8,000 views at ~4.7x its median, top of platform, clean cross-platform → not promoted | PASS |
| R11 12,000 views on a 3,400 median → promoted (the floor doesn't kill small-side winners) | PASS |
| R11 a 40k–85k account with no real breakout → promotes nothing (floor never promotes on its own) | PASS |
| Rescaled fixtures still test their original properties above the floor (per-platform independence, X-only promote→demote, CROSS_MULT boundary) | PASS |
| R3 twin Pinterest rows merge to one; both readings kept; earliest postedAt kept; twin's live link preserved; dropped id tombstoned; announced; idempotent | PASS |
| R3b a manual winner verdict on the dropped twin is carried onto the keeper | PASS |
| R4 re-mark posted (new timestamp) + re-import → no duplicate, reported as already tracked | PASS |
| R5 hand-added posts (no clipId) are never merged | PASS |
| Regression: pulse autopromote/batch-import/clipid/clipkey/group/heal/record/ux/ytcheck, blast-sync-truth, blast-batch, blast-verify, merge-engine | PASS |
