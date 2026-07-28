---
approved: 2026-07-28
---

# PULSE: stop hardcoding "unknown", and heal the entry already in the ledger

## Goal
The first auto-promoted ledger entry showed the platform caption as its hook and
an empty Pattern family. Both fields were being discarded upstream, and PULSE —
the last app in the chain — wrote placeholders because it had nothing else.

## Changes

### Propagate
- `importFromBlast` passes `patternId` / `patternName` / `patternFamily` from
  each queue clip into `importClipRecord`, which stamps them on the post
  alongside the existing `clipId`.
- `computeAutoWinners` takes `patternId` and `family` from the best-performing
  post in the group that carries them (`firstWith`), instead of the hardcoded
  `patternId: "", family: "unknown"`. A group where no post knows its pattern —
  a hand-added post, or a Quick clip that never went through RECALL — stays
  honestly "unknown" rather than being guessed at.
- `logToLedger` (the manual Winner/Meh/Dead button) gets the same treatment.
- `autoSame` now compares `patternId` and `family`, so a re-import that finally
  supplies the pattern updates the existing entry instead of reading as "no
  change".

### Heal
- `enrichPost` runs when a re-import finds a post it already tracks. It fills in
  pattern fields the post lacks, and replaces the stored hook in exactly two
  cases: there isn't one, or the one there is is verbatim the caption's first
  line — the fallback that put captions where hooks belong. **A hook edited by
  hand is never overwritten.** Reported in the import toast.
- `healImportTwins` carries pattern fields from dropped twins onto the keeper.

### Tidy
- One `HOOK_MAX = 300` for hooks everywhere. It was 200 in `makePost` and 300 at
  the ledger, so the ledger's slice could never actually fire.

## How to fix the entry that is already wrong
Re-send the clip to BLAST from RECALL's Top Clips (which now backfills the
pattern onto the queued clip), then press "Import posted clips from BLAST" in
PULSE. The tracked post is enriched in place and the ledger entry follows on the
next sync. No manual editing, no data loss.

## Files
`pulse/app.js`

## Rollback
Revert the commit. Enriched posts keep their corrected hook — that correction is
the fix, not a side effect.

## Verification
`pattern-loop-verify.mjs` R6–R7.

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R6 an imported post's hook is the SPOKEN hook, not the caption | PASS |
| R6 the post carries the matched pattern | PASS |
| R6 the breakout auto-promotes and the ledger entry's hook is the spoken hook | PASS |
| R6 the ledger entry names its pattern family (was always "unknown") | PASS |
| R6 the ledger entry carries the patternId HOOKLAB's dropdown pre-selects | PASS |
| R7 re-importing over a caption-as-hook post replaces the hook and fills the pattern, with no duplicate | PASS |
| R7 the heal is announced in the toast | PASS |
| R7 a hand-written hook survives a re-import untouched, pattern still filled | PASS |
| Pre-fix proof: family reads "unknown" and the hook reads "a caption line for facebook" on the previous code | PASS |
| Regression: pulse autopromote (66), twins (28), batch-import, clipid, clipkey, group, heal, record, ux, ytcheck | PASS |
