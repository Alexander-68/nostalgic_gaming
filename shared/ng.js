/*
 * NG — shared core for the Nostalgic Gaming catalogue.
 *
 * Classic script (NOT an ES module): load it with a plain
 *   <script src="../../shared/ng.js"></script>
 * BEFORE any game script that uses it. Works from file:// and HTTP alike.
 *
 * Everything shared lives under the single global `window.NG`. Other shared
 * scripts (input, audio, net, ...) attach themselves to this same object, e.g.
 *   NG.input = { ... };
 * so the page only ever gains one global.
 */
(function (global) {
  'use strict';

  // Idempotent: re-loading the script must not wipe what other shared
  // scripts have already attached.
  var NG = global.NG || (global.NG = {});

  NG.version = '0.1.0';

  // ---------------------------------------------------------------------------
  // Aspect ratios — the project's defining constraint.
  //
  // Every game is designed for these three orientations. `value` is width/height
  // so a viewport's aspect can be compared against them directly.
  // ---------------------------------------------------------------------------
  NG.RATIOS = {
    LANDSCAPE:     { id: '16:9', w: 16, h: 9,  value: 16 / 9 },  // ~1.778, widescreen
    HALF_PORTRAIT: { id: '9:8',  w: 9,  h: 8,  value: 9 / 8 },   // ~1.125, squarish
    PORTRAIT:      { id: '9:16', w: 9,  h: 16, value: 9 / 16 },  // ~0.563, tall
  };

  // Iterable form of the above, for nearest-match searches.
  NG.RATIO_LIST = [NG.RATIOS.LANDSCAPE, NG.RATIOS.HALF_PORTRAIT, NG.RATIOS.PORTRAIT];

  /**
   * Pick which of the three design ratios best matches a viewport.
   * Returns one of the NG.RATIOS entries. Defaults to the live window.
   */
  NG.classify = function (viewportW, viewportH) {
    var w = viewportW != null ? viewportW : global.innerWidth;
    var h = viewportH != null ? viewportH : global.innerHeight;
    var aspect = w / h;

    var best = NG.RATIO_LIST[0];
    var bestGap = Infinity;
    for (var i = 0; i < NG.RATIO_LIST.length; i++) {
      // Compare in log space so "twice as wide" and "twice as tall" are
      // treated as equally far from a target — perceptually nearest.
      var gap = Math.abs(Math.log(aspect) - Math.log(NG.RATIO_LIST[i].value));
      if (gap < bestGap) {
        bestGap = gap;
        best = NG.RATIO_LIST[i];
      }
    }
    return best;
  };

  /**
   * Contain-fit a fixed logical canvas into a viewport, centered with
   * letterboxing. Games render to a fixed logical (logicalW x logicalH)
   * coordinate space; this returns how to place it on screen.
   *
   * @returns {{scale, displayW, displayH, offsetX, offsetY}}
   */
  NG.fit = function (logicalW, logicalH, viewportW, viewportH) {
    var vw = viewportW != null ? viewportW : global.innerWidth;
    var vh = viewportH != null ? viewportH : global.innerHeight;
    var scale = Math.min(vw / logicalW, vh / logicalH);
    var displayW = logicalW * scale;
    var displayH = logicalH * scale;
    return {
      scale: scale,
      displayW: displayW,
      displayH: displayH,
      offsetX: (vw - displayW) / 2,
      offsetY: (vh - displayH) / 2,
    };
  };

  // ---------------------------------------------------------------------------
  // Lifecycle helpers
  // ---------------------------------------------------------------------------

  /** Run `fn` once the DOM is ready (or immediately if it already is). */
  NG.ready = function (fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  };

  /**
   * Subscribe to viewport size/orientation changes, coalesced to one call per
   * animation frame. `fn` receives ({ width, height, ratio }) where `ratio` is
   * the matching NG.RATIOS entry. Returns an unsubscribe function.
   * Fires once immediately so callers can do their initial layout in one place.
   */
  NG.onResize = function (fn) {
    var queued = false;
    function emit() {
      queued = false;
      var w = global.innerWidth;
      var h = global.innerHeight;
      fn({ width: w, height: h, ratio: NG.classify(w, h) });
    }
    function schedule() {
      if (queued) return;
      queued = true;
      global.requestAnimationFrame(emit);
    }
    global.addEventListener('resize', schedule);
    global.addEventListener('orientationchange', schedule);
    emit(); // initial layout
    return function unsubscribe() {
      global.removeEventListener('resize', schedule);
      global.removeEventListener('orientationchange', schedule);
    };
  };

  // ---------------------------------------------------------------------------
  // Exit / finish — leave a game and return to the catalogue.
  //
  // Touch devices use an on-screen FINISH button, but kiosk hardware and
  // remotes often send ESC / BACK / HOME keys instead, so games can listen for
  // those too. Matching is case-insensitive on KeyboardEvent.key and covers the
  // several names different platforms report for "back" and "home".
  // ---------------------------------------------------------------------------
  NG.EXIT_KEYS = [
    'escape', 'esc',
    'goback', 'browserback', 'back',
    'gohome', 'browserhome', 'home',
  ];

  /** Call `fn` when the user presses an exit key. Returns an unsubscribe fn. */
  NG.onExit = function (fn) {
    function onKey(ev) {
      var key = (ev.key || '').toLowerCase();
      if (NG.EXIT_KEYS.indexOf(key) !== -1 || ev.keyCode === 27) {
        ev.preventDefault();
        fn(ev);
      }
    }
    global.addEventListener('keydown', onKey);
    return function () { global.removeEventListener('keydown', onKey); };
  };

  /**
   * Wire up "finish": go back to the catalogue when an exit key is pressed or
   * `opts.button` is tapped.
   *   opts.url      where to go (default '../../index.html' — the catalogue,
   *                 relative to a /games/<name>/ page)
   *   opts.button   the FINISH element, or a CSS selector for it (optional)
   *   opts.onFinish run this instead of navigating (optional)
   * Returns an unsubscribe fn for the key listener.
   */
  NG.enableFinish = function (opts) {
    opts = opts || {};
    var url = opts.url || '../../index.html';
    var btn = typeof opts.button === 'string'
      ? document.querySelector(opts.button)
      : opts.button;
    function finish() {
      if (opts.onFinish) opts.onFinish();
      else global.location.href = url;
    }
    if (btn) {
      btn.addEventListener('click', function (ev) { ev.preventDefault(); finish(); });
    }
    return NG.onExit(finish);
  };

  /**
   * Reflect whether a game is in active play onto <body> as the `ng-playing`
   * class, so page chrome (e.g. a FINISH button) can hide itself via CSS during
   * play and reappear between points / on game over.
   */
  NG.setPlaying = function (on) {
    if (document.body) document.body.classList.toggle('ng-playing', !!on);
  };

  // ---------------------------------------------------------------------------
  // Best score / best time — local persistence via localStorage.
  //
  // Games have no server/networking, so "best" is always this player, this
  // browser: localStorage survives reloads over both file:// and HTTP (unlike
  // fetch/CORS-governed APIs, it isn't blocked on file://) and needs no consent
  // banner the way cookies would. Keys should be namespaced per game, e.g.
  // 'ng_<game>_best' or 'ng_<game>_best_<variant>' for per-difficulty records.
  // ---------------------------------------------------------------------------
  NG.storage = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
  };

  /**
   * Record a score where higher is better (arcade-style). Returns
   * {best, isNew}: `best` is the record after this call, `isNew` marks
   * whether `score` just beat the previous one.
   */
  NG.bestScore = function (key, score) {
    var prev = NG.storage.get(key, 0);
    var isNew = score > prev;
    if (isNew) NG.storage.set(key, score);
    return { best: isNew ? score : prev, isNew: isNew };
  };

  /**
   * Record a time (seconds) where lower is better (puzzle-solve / clear
   * time). Returns {best, isNew} like NG.bestScore.
   */
  NG.bestTime = function (key, time) {
    var prev = NG.storage.get(key, null);
    var isNew = prev === null || time < prev;
    if (isNew) NG.storage.set(key, time);
    return { best: isNew ? time : prev, isNew: isNew };
  };
})(window);
