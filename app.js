// === PULSE app.js ===
// The analytics loop for the RECALL / HOOKLAB / BLAST stack. Tracks each posted
// clip's view velocity at 1h/2h/6h/... , pulls YouTube stats automatically, and
// logs winners back into the HOOKLAB ledger. Zero-build, BYO-key, localStorage.
// Loaded as a plain (non-module) script — same IIFE style as the other apps.
(function () {
  "use strict";

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uid() { return "p_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

  var LS_POSTS = "pulse_posts_v1";
  var LS_SETTINGS = "pulse_settings_v1";
  var LS_BLAST = "blast_session_v1";
  var LS_HOOKLAB = "hooklab_state_v1";
  var HOOKLAB_URL = "https://mjmorrison10.github.io/Hooklabs/";

  // Same nine platforms BLAST posts to, in the same order/names so imports line up.
  var PLATFORMS = ["YouTube Shorts", "TikTok", "Instagram Reels", "Snapchat Spotlight",
    "Facebook Reels", "X", "Threads", "LinkedIn", "Pinterest"];
  var TEXT_PLATFORMS = { "X": 1, "Threads": 1, "LinkedIn": 1, "Pinterest": 1 };
  function mediumFor(name) { return TEXT_PLATFORMS[name] ? "text" : "video"; }

  // Check-in schedule, in hours. A single reading "covers" every checkpoint at or
  // below its elapsed time, so late reads are honest, not backfilled.
  var CHECKPOINTS = [1, 2, 6, 24, 48, 168];
  function ckLabel(h) { return h < 24 ? h + "h" : (h / 24) + "d"; }

  var posts = [];
  var settings = { ytKey: "", view: "clips" }; // view: "clips" | "platforms"

  // Which clip cards are open, keyed by group key. Every change rebuilds the
  // whole list, so open state must live outside the DOM; sessionStorage also
  // makes an accidental F5 painless. The picked platform in the "By platform"
  // view is session-scoped too (it changes constantly while working a batch).
  var SS_EXPANDED = "pulse_expanded_v1", SS_PLATFORM = "pulse_platform_v1";
  var expandedKeys = {};
  try { (JSON.parse(sessionStorage.getItem(SS_EXPANDED)) || []).forEach(function (k) { expandedKeys[k] = 1; }); } catch (e) {}
  var currentPlatform = "";
  try { currentPlatform = sessionStorage.getItem(SS_PLATFORM) || ""; } catch (e) {}
  function saveExpanded() { try { sessionStorage.setItem(SS_EXPANDED, JSON.stringify(Object.keys(expandedKeys))); } catch (e) {} }

  function loadAll() {
    try { posts = JSON.parse(localStorage.getItem(LS_POSTS)) || []; } catch (e) { posts = []; }
    if (!Array.isArray(posts)) posts = [];
    try { var s = JSON.parse(localStorage.getItem(LS_SETTINGS)); if (s) Object.assign(settings, s); } catch (e) {}
    // ytKey is shared across the stack (shared store wins; legacy local promoted).
    if (window.StackData) settings.ytKey = window.StackData.resolveKeys(settings, ["ytKey"]).ytKey || "";
  }
  function savePosts() {
    try { localStorage.setItem(LS_POSTS, JSON.stringify(posts)); return true; }
    catch (e) { toast("Couldn't save (storage full or blocked)"); return false; }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); return true; }
    catch (e) { toast("Couldn't save settings"); return false; }
  }

  // Heal split clips. A re-import used to mint a NEW clipId per call, so a clip
  // imported in two waves (some platforms posted later) got two ids -> two
  // cards, even though every post shared the same clipKey. Unify: same
  // non-empty clipKey => one canonical clipId (the one whose earliest post is
  // oldest). Replaced ids are stashed in clipIdPrev, so the rewrite is
  // reversible; runs on every load and is a no-op once unified.
  function migrateClipIds() {
    var buckets = {};
    posts.forEach(function (p) {
      var k = String(p.clipKey || "").trim().toLowerCase();
      if (k) (buckets[k] = buckets[k] || []).push(p);
    });
    var changed = 0;
    Object.keys(buckets).forEach(function (k) {
      var list = buckets[k];
      var earliest = {}; // clipId -> earliest postedAt among its posts
      list.forEach(function (p) {
        if (p.clipId && (!(p.clipId in earliest) || p.postedAt < earliest[p.clipId])) earliest[p.clipId] = p.postedAt;
      });
      var ids = Object.keys(earliest);
      if (!ids.length) return; // no clipIds here; the clipKey tier already groups these
      var canonical = ids[0];
      ids.forEach(function (id) { if (earliest[id] < earliest[canonical]) canonical = id; });
      list.forEach(function (p) {
        if (p.clipId === canonical) return;
        if (p.clipId) p.clipIdPrev = p.clipId;
        p.clipId = canonical;
        changed++;
      });
    });
    if (changed) savePosts();
  }

  // ---------- toast ----------
  var toastT;
  function toast(msg) { var el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("show"); }, 2600); }

  // ---------- formatting ----------
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
    return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  }
  // Views move in orders of magnitude — step ~1% of scale so +/- is useful at
  // 300 views and at 300k. 0-99 -> 1, 100-999 -> 10, 1k-9.9k -> 100, else 1000.
  function stepFor(v) { v = Number(v) || 0; return v < 100 ? 1 : v < 1000 ? 10 : v < 10000 ? 100 : 1000; }
  // The views input, pre-filled with the last recorded number (raw digits, never
  // fmtNum) and flanked by -/+ steppers. data-base marks the prefill so we can
  // flag a "changed" cue and the steppers know where to start from an empty box.
  function snapInputHTML(post, ph) {
    var l = latestSnap(post);
    var val = l ? String(l.views) : "";
    return '<button class="stepbtn" type="button" data-act="step" data-dir="-1" data-id="' + post.id + '" aria-label="decrease">−</button>' +
      '<input type="number" min="0" inputmode="numeric" placeholder="' + (ph || "views") + '"' +
      (val ? ' value="' + val + '" data-base="' + val + '"' : '') +
      ' id="snap-' + post.id + '">' +
      '<button class="stepbtn" type="button" data-act="step" data-dir="1" data-id="' + post.id + '" aria-label="increase">+</button>';
  }
  function relTime(ms) {
    var d = Date.now() - ms, m = Math.round(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }
  function inHours(ms) {
    var d = ms - Date.now(), h = d / 3600000;
    if (h < 1) return "in " + Math.max(1, Math.round(d / 60000)) + "m";
    if (h < 48) return "in " + Math.round(h) + "h";
    return "in " + Math.round(h / 24) + "d";
  }

  // ---------- checkpoints ----------
  function maxCovered(post) { return post.snapshots.length ? Math.max.apply(null, post.snapshots.map(function (s) { return s.elapsedMin; })) : -1; }
  function nextDue(post, now) {
    var covered = maxCovered(post);
    for (var i = 0; i < CHECKPOINTS.length; i++) {
      var hMin = CHECKPOINTS[i] * 60;
      if (now >= post.postedAt + hMin * 60000 && hMin > covered) return CHECKPOINTS[i];
    }
    return null;
  }
  function latestSnap(post) { return post.snapshots.length ? post.snapshots[post.snapshots.length - 1] : null; }
  function velocityPerHr(post) {
    if (post.snapshots.length < 2) return null;
    var a = post.snapshots[post.snapshots.length - 2], b = post.snapshots[post.snapshots.length - 1];
    var dt = (b.elapsedMin - a.elapsedMin) / 60; if (dt <= 0) return null;
    return Math.round((b.views - a.views) / dt);
  }

  function recordSnapshot(post, data, source) {
    var now = Date.now();
    post.snapshots.push({
      at: now, elapsedMin: Math.max(0, Math.round((now - post.postedAt) / 60000)),
      views: Number(data.views) || 0,
      likes: data.likes != null ? Number(data.likes) : null,
      comments: data.comments != null ? Number(data.comments) : null,
      source: source
    });
    post.snapshots.sort(function (a, b) { return a.elapsedMin - b.elapsedMin; });
  }

  // ---------- YouTube ----------
  function isYouTube(post) { return /youtu\.?be|youtube\.com/i.test(post.url) || post.platform === "YouTube Shorts"; }
  function ytId(url) {
    var m = String(url).match(/(?:youtube\.com\/(?:shorts|live|embed)\/|youtu\.be\/|[?&]v=)([\w-]{6,})/);
    return m ? m[1] : null;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isRetryable(s) { return s === 429 || s === 500 || s === 503; }
  async function fetchWithRetry(make) {
    var backoff = [3000, 9000];
    for (var attempt = 1; ; attempt++) {
      var res = await make();
      if (!isRetryable(res.status) || attempt >= 3) return res;
      await sleep(backoff[attempt - 1] || 9000);
    }
  }
  async function fetchYouTubeStats(id, key) {
    var url = "https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" +
      encodeURIComponent(id) + "&key=" + encodeURIComponent(key);
    var res = await fetchWithRetry(function () { return fetch(url); });
    if (!res.ok) {
      if (res.status === 400 || res.status === 403) throw new Error("YouTube API key rejected or quota exhausted — check Settings");
      throw new Error("YouTube error " + res.status);
    }
    var j = await res.json();
    var item = j && j.items && j.items[0];
    if (!item) throw new Error("Video not found (private, deleted, or wrong link)");
    var st = item.statistics || {};
    return { views: parseInt(st.viewCount || "0", 10), likes: st.likeCount != null ? parseInt(st.likeCount, 10) : null, comments: st.commentCount != null ? parseInt(st.commentCount, 10) : null };
  }
  async function checkYouTube(post, opts) {
    opts = opts || {};
    if (!settings.ytKey) { if (opts.loud) toast("Add a YouTube API key in Settings to auto-track"); return false; }
    var id = ytId(post.url);
    if (!id) { if (opts.loud) toast("Couldn't read a video id from that URL"); return false; }
    try {
      var stats = await fetchYouTubeStats(id, settings.ytKey);
      recordSnapshot(post, stats, "auto");
      savePosts();
      return true;
    } catch (e) { if (opts.loud) toast(e.message || "YouTube check failed"); return false; }
  }
  // On load / on demand: snapshot every YouTube post that has a due checkpoint.
  async function autoCheckDue(loud) {
    if (!settings.ytKey) { if (loud) toast("Add a YouTube API key in Settings first"); return; }
    var due = posts.filter(function (p) { return isYouTube(p) && ytId(p.url) && nextDue(p, Date.now()) != null; });
    if (!due.length) { if (loud) toast("No YouTube posts are due for a check right now"); return; }
    if (loud) toast("Checking " + due.length + " YouTube post" + (due.length > 1 ? "s" : "") + "…");
    var ok = 0;
    for (var i = 0; i < due.length; i++) { if (await checkYouTube(due[i])) ok++; }
    render();
    if (loud) toast(ok + " updated");
  }

  // ---------- HOOKLAB ledger write-back ----------
  function logToLedger(post, outcome) {
    var raw = null; try { raw = localStorage.getItem(LS_HOOKLAB); } catch (e) {}
    var st = {}; try { st = raw ? JSON.parse(raw) : {}; } catch (e) { st = {}; }
    if (!st.ledger) st.ledger = [];
    if (!st.comps) st.comps = [];
    var latest = latestSnap(post);
    var entry = {
      id: "pulse_" + post.id,
      hook: (String(post.hook || post.caption || "").split("\n")[0].slice(0, 300)) || "(clip)",
      patternId: "", family: "unknown", outcome: outcome,
      platform: post.platform, medium: mediumFor(post.platform),
      niche: "general", retention: "", views: latest ? String(latest.views) : "",
      notes: "via PULSE: " + post.url,
      createdAt: new Date().toISOString(), source: "pulse"
    };
    // Replace any prior PULSE entry for this post so re-logging updates, not dupes.
    st.ledger = st.ledger.filter(function (e) { return e && e.id !== entry.id; });
    st.ledger.unshift(entry);
    try { localStorage.setItem(LS_HOOKLAB, JSON.stringify(st)); }
    catch (e) { toast("Couldn't write to HOOKLAB ledger (storage full or blocked)"); return false; }
    post.outcome = outcome; post.ledgerLoggedAt = Date.now();
    savePosts();
    return true;
  }

  // Remove this post's PULSE-written entry from the HOOKLAB ledger. Matches on
  // the deterministic id "pulse_<post.id>", so it can never touch a
  // HOOKLAB-native entry. Returns true if an entry was actually removed.
  function deleteLedgerEntry(post) {
    var raw = null; try { raw = localStorage.getItem(LS_HOOKLAB); } catch (e) { return false; }
    if (!raw) return false;
    var st; try { st = JSON.parse(raw); } catch (e) { return false; }
    if (!st || !st.ledger || !st.ledger.length) return false;
    var wanted = "pulse_" + post.id;
    var before = st.ledger.length;
    st.ledger = st.ledger.filter(function (e) { return !(e && e.id === wanted); });
    if (st.ledger.length === before) return false;
    try { localStorage.setItem(LS_HOOKLAB, JSON.stringify(st)); return true; }
    catch (e) { return false; }
  }

  // ---------- import from BLAST ----------
  function makePost(platform, url, caption, postedAt, hook, blastKey, clipKey) {
    // hook is its own field now; when absent (legacy callers, old backups) fall
    // back to the caption's first line so nothing regresses.
    var h = (hook != null && String(hook).trim()) ? String(hook).trim() : String(caption || "").split("\n")[0].slice(0, 200);
    var p = { id: uid(), platform: platform, url: url || "", caption: caption || "",
      hook: h.slice(0, 200),
      postedAt: postedAt || Date.now(), snapshots: [], outcome: null, ledgerLoggedAt: null };
    if (blastKey) p.blastKey = blastKey;
    // clipKey groups a clip's per-platform posts even when captions (and thus the
    // caption-derived hook) differ per platform. It's the clip-level identity from
    // the BLAST session (the hook, else the shared base caption).
    if (clipKey) p.clipKey = String(clipKey).slice(0, 300);
    return p;
  }
  function importFromBlast() {
    var raw = null; try { raw = localStorage.getItem(LS_BLAST); } catch (e) {}
    if (!raw) { toast("No BLAST session found in this browser — post something in BLAST first"); return; }
    var s = null; try { s = JSON.parse(raw); } catch (e) {}
    if (!s) { toast("BLAST session couldn't be read"); return; }
    var status = s.status || {}, postUrl = s.postUrl || {}, postedAt = s.postedAt || {},
      postedCaption = s.postedCaption || {}, captions = s.captions || {};
    var hook = (s.videoHook || "").trim();
    // Clip-level key shared by every platform of this clip: the hook if set, else
    // the base caption (written once, before per-platform tailoring). Per-platform
    // captions differ, so we must NOT group on those.
    var clipKey = hook || String(s.base || "").trim();
    // A BLAST session = one clip. Every platform imported in this call shares
    // one clipId, so a clip groups even when it has NO hook AND no base caption.
    // Reuse the clipId already carried by any tracked post of this same clip
    // (dupe match or same clipKey; oldest post wins) — minting a fresh id per
    // call is what used to split a clip imported in two waves. Mint only when
    // no prior id exists.
    var clipId = null, clipIdAt = Infinity;
    var ckNorm = clipKey.toLowerCase();
    posts.forEach(function (p) {
      if (!p.clipId || p.postedAt >= clipIdAt) return;
      var match = !!ckNorm && String(p.clipKey || "").trim().toLowerCase() === ckNorm;
      if (!match) {
        // same dupe predicate as the import loop below
        match = Object.keys(status).some(function (name) {
          if (status[name] !== "posted") return false;
          var u = (postUrl[name] || "").trim();
          return p.blastKey === name + "|" + postedAt[name] || (u && p.platform === name && p.url === u);
        });
      }
      if (match) { clipId = p.clipId; clipIdAt = p.postedAt; }
    });
    if (!clipId) clipId = uid();
    var added = 0, skipped = 0, nolink = 0, healed = 0;
    Object.keys(status).forEach(function (name) {
      if (status[name] !== "posted") return;
      var url = (postUrl[name] || "").trim();
      var at = postedAt[name] || Date.now();
      var blastKey = name + "|" + at;
      // Dedupe on the BLAST session key when we have one; fall back to the old
      // (platform,url) match so posts imported before this change still dedupe.
      var dupe = null;
      for (var di = 0; di < posts.length; di++) {
        var dp = posts[di];
        if (dp.blastKey === blastKey || (url && dp.platform === name && dp.url === url)) { dupe = dp; break; }
      }
      if (dupe) {
        // Re-import heals grouping: unify this clip's shared clipId onto posts
        // tracked before clipId existed OR stamped with a divergent id by an
        // earlier import wave. The old id is kept in clipIdPrev (reversible).
        if (dupe.clipId !== clipId) {
          if (dupe.clipId) dupe.clipIdPrev = dupe.clipId;
          dupe.clipId = clipId;
          healed++;
        }
        skipped++;
        return;
      }
      var cap = postedCaption[name] || captions[name] || s.base || "";
      var np = makePost(name, url, cap, at, hook, blastKey, clipKey);
      np.clipId = clipId;
      posts.unshift(np);
      if (!url) nolink++;
      added++;
    });
    if (added || healed) savePosts();
    render();
    if (added) {
      var msg = "Imported " + added + " post" + (added > 1 ? "s" : "") + " from BLAST";
      if (nolink) msg += " — " + nolink + " without links yet (add each link on its card for stats)";
      else if (skipped) msg += " (" + skipped + " already tracked)";
      if (healed) msg += ", regrouped " + healed + " already-tracked";
      toast(msg);
    }
    else if (healed) toast("Regrouped " + healed + " already-tracked post" + (healed > 1 ? "s" : "") + " into this clip")
    else if (skipped) toast("Those BLAST posts are already tracked");
    else toast("Nothing marked Posted in BLAST yet");
    if (added) autoCheckDue(false);
  }

  // ---------- sparkline ----------
  function sparkline(post) {
    var s = post.snapshots;
    if (s.length < 2) return "";
    var W = 120, H = 34, pad = 2;
    var xs = s.map(function (p) { return p.elapsedMin; }), ys = s.map(function (p) { return p.views; });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var sx = function (x) { return maxx === minx ? pad : pad + (x - minx) / (maxx - minx) * (W - 2 * pad); };
    var sy = function (y) { return maxy === miny ? H / 2 : H - pad - (y - miny) / (maxy - miny) * (H - 2 * pad); };
    var d = s.map(function (p, i) { return (i ? "L" : "M") + sx(p.elapsedMin).toFixed(1) + " " + sy(p.views).toFixed(1); }).join(" ");
    var last = s[s.length - 1];
    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<circle cx="' + sx(last.elapsedMin).toFixed(1) + '" cy="' + sy(last.views).toFixed(1) + '" r="2.4" fill="var(--brand)"/></svg>';
  }

  // ---------- render ----------
  function checksHTML(post) {
    var now = Date.now(), covered = maxCovered(post), sawPending = false;
    return '<div class="checks">' + CHECKPOINTS.map(function (h) {
      var hMin = h * 60, dueTime = post.postedAt + hMin * 60000;
      if (hMin <= covered) return '<span class="checkchip done">' + ckLabel(h) + ' ✓</span>';
      if (now >= dueTime) return '<span class="checkchip due" data-act="focusrec" data-id="' + post.id + '">' + ckLabel(h) + ' due</span>';
      // "next" marks the first not-yet-due chip; mobile hides the rest of the
      // pending tail to keep cards short.
      var cls = sawPending ? "checkchip pending" : "checkchip pending next";
      sawPending = true;
      return '<span class="' + cls + '">' + ckLabel(h) + ' ' + inHours(dueTime) + '</span>';
    }).join("") + '</div>';
  }
  function metricsHTML(post) {
    var l = latestSnap(post);
    if (!l) return '<div class="metrics"><div class="metric"><span class="n">—</span><span class="l">no reading yet</span></div>' + (post.snapshots.length ? "" : "") + '</div>';
    var vel = velocityPerHr(post);
    var out = '<div class="metrics">' +
      '<div class="metric"><span class="n">' + fmtNum(l.views) + '</span><span class="l">views · ' + relTime(l.at) + '</span></div>';
    if (l.likes != null) out += '<div class="metric"><span class="n">' + fmtNum(l.likes) + '</span><span class="l">likes</span></div>';
    if (l.comments != null) out += '<div class="metric"><span class="n">' + fmtNum(l.comments) + '</span><span class="l">comments</span></div>';
    if (vel != null) out += '<div class="metric"><span class="n vel">' + fmtNum(vel) + '</span><span class="l">views / hr</span></div>';
    out += sparkline(post);
    return out + '</div>';
  }
  // === Clip grouping ===
  // Posting one clip to N platforms creates N per-platform posts that all share
  // the clip's hook (BLAST stamps s.videoHook on every one). Group by that hook
  // so each clip is a single collapsible card; expand it for per-platform
  // tracking. No-hook posts stay singletons. Render-layer only, no stored change.
  function clipGroupKey(post) {
    // Per-import clipId first: the most reliable "same clip" signal (one BLAST
    // import = one clip), independent of hook/caption. Then the clip-level
    // caption/hook (merges re-imports and pre-clipId posts), then the
    // caption-derived hook for legacy posts, else a per-post singleton.
    if (post.clipId) return "g:" + post.clipId;
    var c = String(post.clipKey || "").trim().toLowerCase();
    if (c) return "c:" + c;
    var h = String(post.hook || "").trim().toLowerCase();
    return h ? "h:" + h : "i:" + post.id;
  }
  function buildClipGroups(now) {
    var map = {}, order = [];
    posts.forEach(function (p) {
      var k = clipGroupKey(p);
      if (!map[k]) { map[k] = { key: k, hook: (p.clipKey || p.hook), posts: [] }; order.push(k); }
      map[k].posts.push(p);
    });
    var groups = order.map(function (k) { return map[k]; });
    groups.forEach(function (g) {
      g.dueCount = g.posts.filter(function (p) { return nextDue(p, now) != null; }).length;
      g.anyDue = g.dueCount > 0;
      g.maxPostedAt = Math.max.apply(null, g.posts.map(function (p) { return p.postedAt; }));
      var best = null;
      g.posts.forEach(function (p) {
        var s = latestSnap(p);
        if (s && s.views != null && (!best || s.views > best.views)) best = { views: s.views, platform: p.platform };
      });
      g.best = best;
      g.posts.sort(function (a, b) {
        var ia = PLATFORMS.indexOf(a.platform); if (ia < 0) ia = 99;
        var ib = PLATFORMS.indexOf(b.platform); if (ib < 0) ib = 99;
        return ia !== ib ? ia - ib : a.postedAt - b.postedAt;
      });
    });
    groups.sort(function (a, b) {
      if (a.anyDue !== b.anyDue) return a.anyDue ? -1 : 1;
      return b.maxPostedAt - a.maxPostedAt;
    });
    return groups;
  }

  function postCardHTML(post, now) {
      var yt = isYouTube(post) && ytId(post.url);
      var due = nextDue(post, now);
      var linkPart = post.url
        ? '<a href="' + esc(post.url) + '" target="_blank" rel="noopener">open post ↗</a>'
        : '<button class="addlink" data-act="setlink" data-id="' + post.id + '" title="Add the live post link to track stats">＋ add link</button>';
      var capLine = "";
      var capText = String(post.caption || "").replace(/\s+/g, " ").trim();
      if (capText && capText !== String(post.hook || "").trim()) {
        capLine = '<p class="capline" title="' + esc(capText) + '">Caption: ' + esc(capText) + '</p>';
      }
      var head = '<div class="posthead">' +
        '<span class="platformtag">' + esc(post.platform) + '</span>' +
        '<div style="flex:1;min-width:0">' +
        '<p class="hook">' + (esc(post.hook) || '<span style="color:var(--faint)">(no hook noted)</span>') + '</p>' +
        capLine +
        '<div class="sub">' + linkPart +
        '<span>posted ' + relTime(post.postedAt) + '</span>' +
        (yt ? '<span class="pilltag">youtube auto</span>' : '<span class="pilltag">manual</span>') + '</div></div>' +
        '<div class="postactions">' +
        '<button class="postact" data-act="del" data-id="' + post.id + '" title="Stop tracking — keeps its HOOKLAB ledger entry">Stop tracking</button>' +
        '<button class="postact danger" data-act="delall" data-id="' + post.id + '" title="Delete this post and its HOOKLAB ledger entry">Delete</button>' +
        '</div></div>';

      var snaprow = '<div class="snaprow">' +
        (yt ? '<button class="btn ghost" data-act="check" data-id="' + post.id + '">Check now</button>' : '') +
        '<span class="lab">Log views:</span>' +
        snapInputHTML(post, "e.g. 12400") +
        '<button class="btn ghost" data-act="rec" data-id="' + post.id + '">Record</button>' +
        (due != null ? '<span class="lab" style="color:var(--warn)">' + ckLabel(due) + ' check is due</span>' : '') +
        '</div>';

      var oc = post.outcome;
      var outcomerow = '<div class="outcomerow"><span class="lab">Outcome:</span>' +
        ['winner', 'meh', 'dead'].map(function (o) {
          return '<button class="outcomebtn ' + o + (oc === o ? ' on' : '') + '" data-act="outcome" data-id="' + post.id + '" data-outcome="' + o + '">' + o.charAt(0).toUpperCase() + o.slice(1) + '</button>';
        }).join("") +
        (post.ledgerLoggedAt ? '<span class="logged">✓ in HOOKLAB ledger</span>' : '') + '</div>';

      return '<div class="post">' + head + metricsHTML(post) + checksHTML(post) + snaprow + outcomerow + '</div>';
  }

  // === Platform grouping (the "By platform" view) ===
  // One flat list per platform, newest post first — load a platform and walk
  // straight down entering numbers.
  function buildPlatformGroups(now) {
    var map = {};
    posts.forEach(function (p) { (map[p.platform] = map[p.platform] || []).push(p); });
    var names = Object.keys(map);
    names.sort(function (a, b) {
      var ia = PLATFORMS.indexOf(a); if (ia < 0) ia = 99;
      var ib = PLATFORMS.indexOf(b); if (ib < 0) ib = 99;
      return ia !== ib ? ia - ib : (a < b ? -1 : 1);
    });
    return names.map(function (name) {
      var list = map[name];
      list.sort(function (a, b) { return b.postedAt - a.postedAt; });
      return { name: name, posts: list, dueCount: list.filter(function (p) { return nextDue(p, now) != null; }).length };
    });
  }

  // A thin row: identity + the record action. Everything else (outcome,
  // delete, checkpoint strip) lives in the clip view — deliberate non-goal
  // here so the walk-down list stays walkable.
  function platformRowHTML(post, now) {
    var due = nextDue(post, now);
    var l = latestSnap(post);
    var label = String(post.hook || "").trim();
    var link = post.url
      ? '<a class="prowlink" href="' + esc(post.url) + '" target="_blank" rel="noopener" title="Open post">↗</a>'
      : '<button class="prowlink addlink" data-act="setlink" data-id="' + post.id + '" title="Add the live post link">＋</button>';
    return '<div class="prow' + (due != null ? ' due' : '') + '">' +
      '<div class="prowmain">' +
      '<p class="prowlabel" title="' + esc(label || post.caption) + '">' + (esc(label) || '<span style="color:var(--faint)">(no hook)</span>') + '</p>' +
      '<div class="prowmeta">' +
      '<span>' + relTime(post.postedAt) + '</span>' +
      '<span>' + (l ? fmtNum(l.views) + ' views' : 'no reading') + '</span>' +
      (due != null ? '<span class="prowdue">' + ckLabel(due) + ' due</span>' : (post.snapshots.length ? '<span class="prowok">✓</span>' : '')) +
      '</div></div>' +
      link +
      snapInputHTML(post) +
      '<button class="btn ghost" data-act="rec" data-id="' + post.id + '">Record</button>' +
      '</div>';
  }

  function renderPlatformView(host, now) {
    var groups = buildPlatformGroups(now);
    // Sticky platform choice when it still exists; else first with something
    // due (that's where the work is), else the first platform with posts.
    var exists = groups.some(function (g) { return g.name === currentPlatform; });
    if (!exists) {
      currentPlatform = "";
      groups.forEach(function (g) { if (!currentPlatform && g.dueCount) currentPlatform = g.name; });
      if (!currentPlatform && groups.length) currentPlatform = groups[0].name;
    }
    var cur = null;
    groups.forEach(function (g) { if (g.name === currentPlatform) cur = g; });
    var chips = '<div class="platchips">' + groups.map(function (g) {
      return '<button type="button" class="platchip' + (g.name === currentPlatform ? ' on' : '') + '" data-plat="' + esc(g.name) + '">' +
        esc(g.name) + '<span class="platcount">' + g.posts.length + '</span>' +
        (g.dueCount ? '<span class="platdue">' + g.dueCount + ' due</span>' : '') +
        '</button>';
    }).join("") + '</div>';
    var rows = cur ? cur.posts.map(function (p) { return platformRowHTML(p, now); }).join("") : "";
    host.innerHTML = chips + '<div class="prows">' + rows + '</div>';
    host.querySelectorAll(".platchip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        currentPlatform = chip.getAttribute("data-plat");
        try { sessionStorage.setItem(SS_PLATFORM, currentPlatform); } catch (e) {}
        render();
      });
    });
  }

  function renderClipView(host, now) {
    var groups = buildClipGroups(now);
    host.innerHTML = groups.map(function (g) {
      var n = g.posts.length;
      var dueTxt = g.dueCount ? (g.dueCount + " due now") : "none due";
      var bestTxt = g.best ? ("best " + fmtNum(g.best.views) + " on " + esc(g.best.platform)) : "no views yet";
      var summary = n + " platform" + (n > 1 ? "s" : "") + " · " + dueTxt + " · " + bestTxt;
      var body = g.posts.map(function (p) { return postCardHTML(p, now); }).join("");
      // Open state renders from expandedKeys, so a full rebuild (every data
      // change does one) puts the cards back exactly as they were.
      var open = !!expandedKeys[g.key];
      return '<div class="clipcard' + (g.anyDue ? ' due' : '') + '">' +
        '<button class="cliphead' + (open ? ' open' : '') + '" type="button" data-key="' + esc(g.key) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="clipchevron" aria-hidden="true">▸</span>' +
        '<span class="cliphook">' + (esc(g.hook) || '(no hook noted)') + '</span>' +
        '<span class="clipsummary">' + summary + '</span>' +
        '</button>' +
        '<div class="clipbody"' + (open ? '' : ' hidden') + '>' + body + '</div>' +
        '</div>';
    }).join("");

    host.querySelectorAll(".cliphead").forEach(function (head) {
      head.addEventListener("click", function () {
        var body = head.nextElementSibling;
        if (!body) return;
        var key = head.getAttribute("data-key");
        if (body.hasAttribute("hidden")) {
          body.removeAttribute("hidden"); head.setAttribute("aria-expanded", "true"); head.classList.add("open");
          if (key) expandedKeys[key] = 1;
        } else {
          body.setAttribute("hidden", ""); head.setAttribute("aria-expanded", "false"); head.classList.remove("open");
          if (key) delete expandedKeys[key];
        }
        saveExpanded();
      });
    });
  }

  function syncViewToggle() {
    var t = $("#viewToggle"); if (!t) return;
    t.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-view") === settings.view);
    });
  }

  function render() {
    var host = $("#posts");
    // Capture/restore scroll around the innerHTML rebuild so recording a
    // number doesn't teleport the page. Open state is baked into the markup
    // (renderClipView), so the rebuilt page has the same height and layout.
    var y = window.scrollY;
    syncViewToggle();
    if (!posts.length) {
      host.innerHTML = '<div class="empty"><b>No posts tracked yet.</b> Import what you shipped from BLAST, or add one by hand above. Then check back at 1h, 2h, 6h.</div>';
      return;
    }
    var now = Date.now();
    if (settings.view === "platforms") renderPlatformView(host, now);
    else renderClipView(host, now);
    bindPostActions(host);
    window.scrollTo(0, y);
  }

  // Shared by both views — they emit the same data-act / snap-<id> markup.
  function bindPostActions(host) {
    host.querySelectorAll("[data-act]").forEach(function (el) {
      var id = el.getAttribute("data-id");
      var act = el.getAttribute("data-act");
      el.addEventListener("click", function () {
        var post = findPost(id); if (!post) return;
        if (act === "del") { if (confirm("Stop tracking this post? (Its HOOKLAB ledger entry, if logged, stays.)")) { if (window.StackData) StackData.tombstone("pulsePost", id); posts = posts.filter(function (p) { return p.id !== id; }); savePosts(); render(); toast("Stopped tracking"); } }
        else if (act === "delall") {
          var wasLogged = !!post.ledgerLoggedAt;
          if (!confirm("Delete this post everywhere?" + (wasLogged ? " Its HOOKLAB ledger entry is removed too." : ""))) return;
          if (window.StackData) StackData.tombstone("pulsePost", id);
          posts = posts.filter(function (p) { return p.id !== id; }); savePosts();
          var removed = deleteLedgerEntry(post);
          if (removed && window.StackData) StackData.tombstone("hooklabLedger", "pulse_" + id);
          render();
          toast(removed ? "Deleted here and from the HOOKLAB ledger" : "Deleted");
        }
        else if (act === "setlink") {
          var link = prompt("Paste the live post link for " + post.platform, post.url || "");
          if (link == null) return;
          link = link.trim();
          if (link && !/^https?:\/\//i.test(link)) { toast("That doesn't look like a link (needs http…)"); return; }
          post.url = link; savePosts(); render();
          if (link) { toast("Link added"); if (isYouTube(post) && ytId(post.url) && settings.ytKey) checkYouTube(post, {}).then(function (ok) { if (ok) render(); }); }
        }
        else if (act === "check") { checkYouTube(post, { loud: true }).then(function (ok) { if (ok) { render(); toast("Updated from YouTube"); } }); }
        else if (act === "rec") { recordManual(post); }
        else if (act === "step") {
          var sinp = $("#snap-" + id); if (!sinp) return;
          var cur = Number(sinp.value);
          if (sinp.value.trim() === "" || isNaN(cur)) cur = Number(sinp.getAttribute("data-base")) || 0;
          var nv = Math.max(0, cur + Number(el.getAttribute("data-dir")) * stepFor(cur));
          sinp.value = nv;
          var sbase = sinp.getAttribute("data-base");
          sinp.classList.toggle("changed", sbase != null && String(nv) !== sbase);
        }
        else if (act === "focusrec") { var inp = $("#snap-" + id); if (inp) inp.focus(); }
        else if (act === "outcome") { var o = el.getAttribute("data-outcome"); if (logToLedger(post, o)) { render(); toast("Logged as " + o + " in your HOOKLAB ledger"); } }
      });
    });
    host.querySelectorAll("input[id^='snap-']").forEach(function (inp) {
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { var id = inp.id.slice(5); var p = findPost(id); if (p) recordManual(p, { advance: true }); } });
      inp.addEventListener("input", function () { var b = inp.getAttribute("data-base"); inp.classList.toggle("changed", b != null && inp.value !== b); });
    });
  }
  function findPost(id) { for (var i = 0; i < posts.length; i++) if (posts[i].id === id) return posts[i]; return null; }
  function recordManual(post, opts) {
    var inp = $("#snap-" + post.id);
    var v = inp ? inp.value.trim() : "";
    if (v === "" || isNaN(Number(v))) { toast("Enter the view count first"); if (inp) inp.focus(); return; }
    recordSnapshot(post, { views: Number(v) }, "manual");
    savePosts(); render();
    if (opts && opts.advance) {
      // Walk-down flow: after an Enter-record, put the cursor in the next
      // visible views input so the next number is one keystroke away.
      var inputs = document.querySelectorAll("input[id^='snap-']");
      var seen = false;
      for (var i = 0; i < inputs.length; i++) {
        if (seen && inputs[i].offsetParent !== null) { inputs[i].focus(); break; }
        if (inputs[i].id === "snap-" + post.id) seen = true;
      }
    }
    toast("Recorded " + fmtNum(Number(v)) + " views");
  }

  // ---------- manual add ----------
  // "Platforms you're running": the BLAST session's active platforms if present
  // (posted/opened/copied — not skipped), else the platforms you've set caption
  // presets for, else all of them.
  function runningPlatforms() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_BLAST));
      if (s && s.status) {
        var active = PLATFORMS.filter(function (n) { return ["posted", "opened", "copied"].indexOf(s.status[n]) !== -1; });
        if (active.length) return active;
      }
    } catch (e) {}
    try {
      var pr = JSON.parse(localStorage.getItem("blast_presets_v1"));
      if (pr) { var keys = PLATFORMS.filter(function (n) { return pr[n]; }); if (keys.length) return keys; }
    } catch (e) {}
    return PLATFORMS.slice();
  }

  function renderPlatformPicks() {
    var host = $("#mPlatforms"); if (!host) return;
    var on = {}; runningPlatforms().forEach(function (n) { on[n] = 1; });
    host.innerHTML = PLATFORMS.map(function (n) {
      return '<label class="' + (on[n] ? "on" : "") + '"><input type="checkbox" value="' + esc(n) + '"' + (on[n] ? " checked" : "") + '>' + esc(n) + '</label>';
    }).join("");
    host.querySelectorAll("input[type=checkbox]").forEach(function (c) {
      c.addEventListener("change", function () { c.parentNode.classList.toggle("on", c.checked); });
    });
  }

  // Match a pasted URL to the platform it belongs to, so a single link attaches
  // to the right card (the others start link-less).
  function platformForUrl(url) {
    var u = String(url).toLowerCase();
    if (/youtube\.com|youtu\.be/.test(u)) return "YouTube Shorts";
    if (/tiktok\.com/.test(u)) return "TikTok";
    if (/instagram\.com/.test(u)) return "Instagram Reels";
    if (/snapchat\.com/.test(u)) return "Snapchat Spotlight";
    if (/facebook\.com|fb\.watch/.test(u)) return "Facebook Reels";
    if (/(^|\/\/)(x|twitter)\.com/.test(u)) return "X";
    if (/threads\.net/.test(u)) return "Threads";
    if (/linkedin\.com/.test(u)) return "LinkedIn";
    if (/pinterest\./.test(u)) return "Pinterest";
    return null;
  }

  function addManual() {
    var checked = Array.prototype.slice.call(document.querySelectorAll("#mPlatforms input[type=checkbox]:checked"))
      .map(function (c) { return c.value; });
    if (!checked.length) { toast("Pick at least one platform"); return; }
    var url = $("#mUrl").value.trim();
    var hook = $("#mHook").value.trim();
    var caption = $("#mCaption").value.trim();
    var at = $("#mPostedAt").value;
    var postedAt = at ? new Date(at).getTime() : Date.now();
    if (!postedAt || isNaN(postedAt)) postedAt = Date.now();
    // One link attaches to its matching platform (or the first checked one).
    var linkPlatform = url ? (platformForUrl(url) || checked[0]) : null;
    checked.forEach(function (name) {
      var thisUrl = (url && name === linkPlatform) ? url : "";
      posts.unshift(makePost(name, thisUrl, caption, postedAt, hook));
    });
    savePosts();
    $("#mUrl").value = ""; $("#mHook").value = ""; $("#mCaption").value = "";
    render();
    toast("Tracking " + checked.length + " post" + (checked.length > 1 ? "s" : "") + " across your platforms");
    posts.forEach(function (p) {
      if (isYouTube(p) && ytId(p.url) && settings.ytKey) checkYouTube(p, {}).then(function (ok) { if (ok) render(); });
    });
  }

  // ---------- export / import backup ----------
  function exportJSON() {
    var blob = new Blob([JSON.stringify({ posts: posts, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "pulse-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
    toast("Backup downloaded");
  }
  function importJSON(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        // A whole-stack backup picked here routes to the stack importer.
        if (window.StackData && window.StackData.isStackBackup(data)) {
          if (confirm("This is a whole-stack backup. Restore it? It REPLACES data in all four apps on this device.\n\nContains: " + window.StackData.summary(data))) {
            window.StackData.importAll(data, { replace: true }).then(function () { location.reload(); });
          }
          return;
        }
        var incoming = Array.isArray(data) ? data : (data.posts || []);
        var byKey = {}; posts.forEach(function (p) { byKey[p.platform + "|" + p.url] = true; });
        var added = 0;
        incoming.forEach(function (p) {
          if (!p || !p.url) return;
          if (byKey[p.platform + "|" + p.url]) return;
          if (!p.id) p.id = uid();
          if (!Array.isArray(p.snapshots)) p.snapshots = [];
          posts.unshift(p); added++;
        });
        savePosts(); render();
        toast(added + " post" + (added === 1 ? "" : "s") + " imported from backup");
      } catch (e) { toast("That file wasn't valid PULSE JSON"); }
    };
    r.readAsText(file);
  }

  // ---------- settings + theme ----------
  function keyStatus(k) { return k ? "Key saved (" + k.slice(0, 4) + "…" + k.slice(-4) + ")" : "No key saved."; }
  function openSettings() {
    $("#settingscrim").classList.add("open");
    $("#ytkey").value = settings.ytKey || "";
    $("#ytkeystatus").textContent = keyStatus(settings.ytKey);
    $("#ytkeystatus").className = "keystatus " + (settings.ytKey ? "set" : "empty");
    $("#ytkey").type = "password"; $("#ytkeyshow").textContent = "show";
  }
  function closeSettings() { $("#settingscrim").classList.remove("open"); }

  function initSettings() {
    $("#settings").addEventListener("click", openSettings);
    $("#keycancel").addEventListener("click", closeSettings);
    $("#settingscrim").addEventListener("click", function (e) { if (e.target === $("#settingscrim")) closeSettings(); });
    $("#ytkeyshow").addEventListener("click", function () {
      var i = $("#ytkey"); if (i.type === "password") { i.type = "text"; $("#ytkeyshow").textContent = "hide"; } else { i.type = "password"; $("#ytkeyshow").textContent = "show"; }
    });
    $("#ytkeyclear").addEventListener("click", function () { $("#ytkey").value = ""; settings.ytKey = ""; saveSettings(); if (window.StackData) window.StackData.clearSharedKey("ytKey"); $("#ytkeystatus").textContent = "No key saved."; $("#ytkeystatus").className = "keystatus empty"; });
    $("#keysave").addEventListener("click", function () {
      var k = $("#ytkey").value.trim();
      // Accept both Google key formats: legacy "AIza…" and newer "AQ.Ab…" (2026 rollout).
      if (k && !/^(AIza[0-9A-Za-z_\-]{20,}|AQ\.[0-9A-Za-z_\-.]{20,})$/.test(k)) { toast("That doesn't look like a Google API key"); return; }
      settings.ytKey = k; saveSettings();
      if (window.StackData) { if (k) window.StackData.writeSharedKeys({ ytKey: k }); else window.StackData.clearSharedKey("ytKey"); }
      closeSettings(); toast("Settings saved");
      if (k) autoCheckDue(false);
    });
    $("#theme").addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme");
      var next = cur === "dark" ? "light" : cur === "light" ? "dark" : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("pulse-theme", next); } catch (e) {}
    });
  }

  // ---------- boot ----------
  function boot() {
    var t; try { t = localStorage.getItem("pulse-theme"); } catch (e) {}
    if (t) document.documentElement.setAttribute("data-theme", t);

    loadAll();
    migrateClipIds();

    // populate platform checkboxes (pre-checked = platforms you're running) +
    // default posted-at = now (local)
    renderPlatformPicks();
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $("#mPostedAt").value = d.toISOString().slice(0, 16);

    initSettings();
    var vt = $("#viewToggle");
    if (vt) vt.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-view");
        if (settings.view === v) return;
        settings.view = v; saveSettings(); render();
      });
    });
    $("#importBlast").addEventListener("click", importFromBlast);
    $("#mAdd").addEventListener("click", addManual);
    $("#checkAll").addEventListener("click", function () { autoCheckDue(true); });
    $("#exportBtn").addEventListener("click", exportJSON);
    $("#importFileBtn").addEventListener("click", function () { $("#importFile").click(); });
    $("#importFile").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; if (f) importJSON(f); e.target.value = ""; });
    if (window.StackData) {
      var sx = $("#stackexport"); if (sx) sx.addEventListener("click", function () { window.StackData.exportToFile(); });
      var si = $("#stackimport"); if (si) si.addEventListener("click", function () { $("#stackfile").click(); });
      var sf = $("#stackfile"); if (sf) sf.addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; if (f) window.StackData.importFromFile(f, function (msg) { toast(msg); }); e.target.value = ""; });
      if (window.StackData.bindSyncUI) window.StackData.bindSyncUI(toast);
    }

    render();
    // quietly refresh any due YouTube posts on open
    if (settings.ytKey) autoCheckDue(false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
