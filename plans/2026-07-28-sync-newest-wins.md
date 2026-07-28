---
approved: 2026-07-28
---

# PULSE: import the real batch, and stop un-ticking the platform toggles

## Goal
Two symptoms reported together with the BLAST sync bug (see
blast/plans/2026-07-28-sync-newest-wins.md for the shared root cause):

1. "Import posted clips from BLAST" carried only part of the platforms over,
   and clips the user had marked posted came in as if they weren't.
2. YouTube Shorts, TikTok and LinkedIn kept un-ticking themselves in "Add a
   post manually" — every Drive sync toggled them back off, even though the
   tracked posts plainly show those platforms are in use.

## Confirmed root cause
Both read `blast_session_v1`, which is only a projection of BLAST's Quick clip
and could be a stale one resurrected by a sync.

- `importFromBlast` imported the session and SKIPPED the queue's quick clip to
  avoid double-counting — so when the session was stale, the stale copy won and
  the newer platforms were missing.
- `runningPlatforms()` derived the checkboxes live from that session's
  statuses. Derived state means every sync re-derived it, silently discarding
  what the user had just ticked.

## Changes
- `importFromBlast`: when a queue exists, import the queue — including its
  quick clip — and ignore the raw session; the session is imported only on a
  legacy device that has no queue. The quick clip deliberately keeps the
  LEGACY unscoped `blastKey` format (`platform|postedAt`), because posts
  already tracked from it carry unscoped keys; scoping it would have
  re-imported every link-less post as a duplicate. Batch clips still scope by
  their RECALL identity.
- Platform checkboxes are a preference, not derived state: the selection is
  stored in `settings.platforms` (`pulse_settings_v1`, which never syncs), and
  saved on every toggle as well as on add. First run on a device seeds from the
  platforms your tracked posts are actually on, then falls back to the old
  derivation chain.

## Files
`pulse/app.js`, plus the vendored `pulse/stackdata.js` (byte-identical copy of
the shared merge engine).

## Rollback
Revert the commit. `settings.platforms` is additive — an older build ignores it.

## Verification
`blast-sync-truth-verify.mjs` R5 and R6 blocks, plus the full PULSE suite set.

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R5 all four platforms of the real clip import; the stale session is not imported; one clipId | PASS |
| R5 re-importing does not duplicate (legacy key format preserved for quick) | PASS |
| R6 first run seeds from tracked posts (YouTube Shorts, TikTok, LinkedIn) | PASS |
| R6 my selection survives a sync that rewrites blast_session_v1, and a reload | PASS |
| R6 toggles stored in the never-synced settings key | PASS |
| Regression: pulse clipid/clipkey/group/heal/record/ux/ytcheck/batch-import/autopromote, merge-engine, drive-sync, sync-wiring, restore-replace, stack-key | PASS |
| stackdata sha256 identical across all four repos | PASS |
