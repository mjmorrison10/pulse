---
task: Group per-platform posts into one collapsible clip card
date: 2026-07-14
approved: 2026-07-14
---

# PULSE clip grouping

## Goal
At 3-6 clips/day x up to 9 platforms, PULSE's one-card-per-platform list becomes
20-50 cards/day and unmanageable. Group the per-platform posts of the same clip
into a single collapsible card; expand it to the existing per-platform tracking.

## Design (confirmed with owner)
- **Group key = the clip's hook.** BLAST stamps the same `s.videoHook` on every
  platform-post of one clip, so all its platforms share `post.hook`. Group on the
  normalized hook. Posts with no hook = their own singleton. Owner posts
  exclusively via BLAST -> import, so grouping is automatic and exact.
- **Render-layer only. No stored-data change** (no new persisted field, no
  migration) -> old `pulse_posts_v1` data and backups keep working.
- **Collapsed clip card** shows: hook + `N platforms · X due now · best Yk on <platform>`.
  (Owner picked due-for-check-in + best-performing platform.)
- **Click to expand** -> the current per-platform cards, unchanged (link, 1h/2h/6h
  schedule, snapshots, check now, add link, record views, outcome).
- Default collapsed. Groups sorted due-first then most-recent.

## Steps
1. `app.js`: add `clipGroupKey`, `buildClipGroups(now)` (dueCount, best snapshot
   view, sort), extract the existing per-post card into `postCardHTML(post, now)`.
2. `app.js`: rework `render()` to emit one `.clipcard` per group (header + hidden
   `.clipbody` of post cards); bind a `.cliphead` toggle; keep the existing
   `[data-act]` and snap-input bindings verbatim.
3. `style.css`: styles for `.clipcard/.cliphead/.clipchevron/.cliphook/
   .clipsummary/.clipbody`.

## Files touched
`pulse/app.js` (render only), `pulse/style.css`.

## Rollback
Revert the two files. No data written, so nothing to undo in localStorage.

## Verification
Headless Playwright: seed 2 clips x 3 platforms in `pulse_posts_v1`; assert 2
clip cards (not 6), summary shows "3 platforms", bodies collapsed by default,
6 post cards present inside, clicking a header expands it, best-platform text
reflects seeded snapshots, no console errors. Then deploy and poll live.
