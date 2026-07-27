---
approved: 2026-07-27
---

# PULSE: import a whole batch from BLAST without fusing the clips

## Goal
Wave C leg 2 of 4. BLAST is becoming multi-clip, so one import can cover 24
clips instead of one. PULSE's import minted a single clipId per CALL, which
would have collapsed a whole batch into one "clip" card.

## Facts
- importFromBlast read blast_session_v1 (one clip) and derived clipKey from
  videoHook || base, then reused/minted one clipId for the whole call.
- Dedupe: blastKey = platform + "|" + postedAt, plus a legacy (platform,url)
  fallback. StackData.mergeStates dedupes on bk:<blastKey> and
  pu:<platform>|<url>.

## Changes
- Extract the per-clip body into `importClipRecord(rec, clipKeyOverride,
  counters)`. A queued clip matches the session shape (text -> base,
  hookText -> videoHook), so one reader serves both.
- `importFromBlast` imports the session (when present) plus every queued clip
  that has posted platforms, each with its own clipKey (the RECALL identity)
  and its own clipId. The queue's "quick" clip is skipped when a session
  exists — it is that session's projection, so importing both double-counts.
- **Identity fix**: platform + postedAt is no longer unique once one BLAST
  holds many clips (two clips posted to the same platform in the same
  millisecond would collide and silently dedupe each other). Queued clips
  scope blastKey by their clip key; legacy session imports keep the original
  format so already-tracked posts still dedupe on re-import.
- Toast reports "across N clips" when a batch came in.

## Rollback
Revert the squash commit. No storage migration; new records only.

## Verification (headless Playwright — log below)
Legacy session import byte-identical; 3 queued clips -> 6 posts with 3
distinct clipIds and RECALL-keyed clipKeys; re-import dedupes; session +
quick-post mirror not double-counted; an unposted batch imports nothing.

## Audit
- PLAN approved (this file). EXECUTE/VERIFY/SHIP below.
- EXECUTE importClipRecord extraction, queue branch, clip-scoped blastKey,
  batch toast — PASS.
- VERIFY new suite 22/22 PASS; regression: clipid, clipkey, group, heal,
  record, ux, ytcheck, merge-engine all green.
- SHIP: committed, PR squash-merged, live poll confirmed.
