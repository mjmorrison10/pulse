---
task: Keep your place on record, platform-first view, clip split heal, mobile compaction
date: 2026-07-15
approved: 2026-07-15
---

# PULSE tracking UX overhaul

## Goal
Four owner-reported pain points from real use:
1. Recording a view count triggers a full re-render that collapses every card
   and loses scroll — you hunt for where you were after every number.
2. The workflow is platform-first ("load one platform, walk down entering
   numbers") but the app only groups by clip. Decision: add a "By platform"
   view with a toggle, keep the clip view. Row label: hook, caption fallback
   (post.hook already stores exactly that).
3. Import split bug: each "Import from BLAST" call minted a NEW clipId, so a
   clip imported in two waves (IG+Threads first, Snap+X+Pinterest later) got
   two ids -> two cards. clipId outranks the shared clipKey in clipGroupKey,
   and the heal only fixed posts with NO clipId. Owner's data is already
   split — needs a load-time repair, not just a future-proof import fix.
4. Mobile: expanded cards stack 5 full rows per post, no responsive
   compaction anywhere.

## Steps
- C1: `migrateClipIds()` on boot — bucket posts by normalized clipKey; per
  bucket unify all clipIds to the one whose earliest post is oldest; stash
  replaced ids in `clipIdPrev` (reversible); silent, idempotent.
- C2: `importFromBlast()` reuses an existing clipId (dupe match or same
  clipKey, oldest post wins) instead of always minting; heal now unifies
  divergent ids, not just missing ones.
- A: module-level `expandedKeys` (sessionStorage `pulse_expanded_v1`); bake
  open state into the clip-card template via `data-key`; scroll capture and
  restore inside `render()` itself (covers all ~10 callsites centrally);
  Enter-record advances focus to the next visible views input.
- B: `settings.view` ("clips" | "platforms") + `#viewToggle` segmented
  control; `render()` becomes a dispatcher over `renderClipView` /
  `renderPlatformView` with shared `bindPostActions`; `buildPlatformGroups`
  (PLATFORMS order, newest-first within); chip-row platform picker showing
  ONE platform's flat rows; `platformRowHTML` = hook label, rel time,
  latest views, due chip, link, views input + Record. Selected platform is
  ephemeral (sessionStorage `pulse_platform_v1`).
- D: mobile `@media (max-width:560px)` compaction; pending checkpoint chips
  hidden on mobile except the next-due one (class `next` in checksHTML);
  new `.segmented`, `.platchips`, `.prow` styles (44px tap targets).

## Files touched
pulse/app.js, pulse/index.html, pulse/style.css.

## Rollback
Revert the commit. `migrateClipIds` changes only post.clipId (old value kept
in clipIdPrev); new LS/sessionStorage keys are additive.

## Verification (headless Playwright)
1. Record keeps place: expand card 2, scroll, Enter-record -> card still
   expanded, scrollY stable, snapshot saved, focus advanced. Reload ->
   expanded state restored.
2. Platform view: chips in PLATFORMS order with counts/due badges; default =
   first due platform; rows newest-first; Enter-walk 3 rows -> 3 snapshots;
   settings.view persisted; clip view intact on toggle back.
3. Split heal: seed same clipKey with clipId A (older) + B -> one card, all
   on A, clipIdPrev stashed, idempotent second load. Import reuses A.
4. Mobile 390x844: no horizontal overflow, pending chips hidden except
   .next, thin rows.

## Execution log (2026-07-15)
- Implemented as designed: migrateClipIds + import clipId reuse + divergent-id
  heal (C); expandedKeys/sessionStorage + baked-in open state + central scroll
  restore + Enter-advance (A); view toggle, buildPlatformGroups,
  renderPlatformView/platformRowHTML, shared bindPostActions (B); mobile
  media block + next-due chip + platform-view styles (D).
- One addition beyond the letter of the plan: .prowmeta children get
  white-space:nowrap + overflow:hidden — without it the meta spans wrapped
  internally at 390px and rows grew to 71px (caught by verification).
- Headless verification: 30/30 PASS — split heal (5 posts unified on the
  older clipId, clipIdPrev stashed, idempotent reload), button-record keeps
  scroll, Enter-record keeps card open + advances focus, expanded state
  survives F5, import reuses existing clipId, platform chips in PLATFORMS
  order with due badges + first-due default, rows newest-first, records work
  in both views, settings.view round-trips, mobile 390x844 has no horizontal
  overflow / hidden pending chips / 55px rows, zero page errors.
- No divergences requiring a stop.
