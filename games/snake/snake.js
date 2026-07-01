/*
 * Snake — solo (classic) and two-player (same-device head-to-head). Touch-first,
 * with keyboard support for desktop development.
 *
 * Mirrors the catalogue's core conventions (see games/pong/pong.js):
 *   - classic script under the NG namespace (no modules, runs from file://)
 *   - the three design ratios, via NG.classify / NG.onResize (fill-the-viewport
 *     strategy: the board grid IS the window; orientation reshapes the grid —
 *     wide in 16:9, tall in 9:16, squarish in 9:8 — so square cells fill the
 *     space and the layout looks intended at every target ratio)
 *   - multitouch via NG.createTouch: in two-player, each player swipes within
 *     their own half of the screen, both at once (one snake per player)
 *
 * The board is a cell grid sized to the viewport. Snakes move one cell per tick
 * on a shared clock, so both players always advance in lockstep — fair on one
 * screen. Steering is by swipe: the dominant axis of a drag picks a direction,
 * and the anchor resets after each turn so one held finger can draw a path.
 *
 * Solo: classic Nokia-style — eat apples to grow and score; hit a wall or
 * yourself and it's over. Two-player: last snake slithering wins; you die on a
 * wall, your own body, the other snake, or a head-on — ties break on length.
 */
(function () {
  'use strict';

  // ---- palette (matches the catalogue's phosphor look) ----------------------
  var FG = '#4dff88';     // P1 / solo snake — phosphor green
  var P2 = '#ffcf4d';     // P2 snake — amber
  var APPLE = '#ff5d6c';  // apples — red, distinct from both snakes
  var DIM = '#1d5e38';    // board border / ambient
  var INK = '#d6f7e4';    // neutral text
  var MUTED = '#6b7a72';  // secondary text

  // ---- tuning ---------------------------------------------------------------
  var TARGET_MIN_CELLS = 16;   // cells along the SHORTER viewport axis
  var START_LEN = 4;           // starting snake length
  // Speeds are deliberately a touch gentle (~10% slower than a twitchy snake)
  // so swipe/tap steering stays comfortably in control.
  var SPEED_SOLO = 6.3;        // cells/sec base; ramps up as you grow
  var SPEED_SOLO_MAX = 12.6;
  var SPEED_SOLO_RAMP = 0.32;  // +cells/sec per apple eaten
  var SPEED_DUO = 6.75;
  var SPEED_DUO_MAX = 10.8;
  var SPEED_DUO_RAMP = 0.16;   // per total apple eaten (both players)

  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- layout (recomputed on every resize / orientation change) ----------
    var courtW = 0, courtH = 0;       // viewport size in CSS px
    var cols = 0, rows = 0;           // board dimensions in cells
    var cell = 0;                     // cell size in CSS px
    var offX = 0, offY = 0;           // board's letterbox offset within viewport
    var drawScale = 1;                // devicePixelRatio
    var orientation = 'landscape';    // 'landscape' (incl. 9:8) | 'portrait'
    var SWIPE_THRESH = 18;            // px a drag must travel to register a turn

    // ---- game state --------------------------------------------------------
    var mode = null;                  // 'solo' | 'duo'
    var state = 'menu';               // 'menu' | 'ready' | 'playing' | 'over'
    var snakes = [];                  // active snakes (1 solo, 2 duo)
    var apples = [];                  // {x, y}
    var result = null;                // set on game over
    var tickAcc = 0;                  // seconds accumulated toward the next step
    var clock = 0;                    // wall clock for prompt pulsing
    var speedMul = 1;                 // debug time scale, nudged by the +/- keys
    var menuRects = null;             // hit-rects for the mode buttons
    var anchors = Object.create(null);// pointer id -> { x, y, moved } per active pointer
    var aiFlags = [false, false];     // which snakes are computer-driven (persists across rematches)

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    // ---- layout ------------------------------------------------------------
    function layout(info) {
      var dpr = window.devicePixelRatio || 1;
      courtW = info.width;
      courtH = info.height;
      canvas.style.width = courtW + 'px';
      canvas.style.height = courtH + 'px';
      canvas.width = Math.round(courtW * dpr);
      canvas.height = Math.round(courtH * dpr);
      drawScale = dpr;

      // Square cells filling the viewport: pick a cell size from the shorter
      // axis, derive the grid, then shrink the cell to fit both axes exactly.
      var shortSide = Math.min(courtW, courtH);
      var approx = shortSide / TARGET_MIN_CELLS;
      var newCols = Math.max(8, Math.round(courtW / approx));
      var newRows = Math.max(8, Math.round(courtH / approx));
      cell = Math.min(courtW / newCols, courtH / newRows);
      var boardW = cell * newCols, boardH = cell * newRows;
      offX = (courtW - boardW) / 2;
      offY = (courtH - boardH) / 2;
      SWIPE_THRESH = Math.max(16, cell * 0.5);

      var gridChanged = (newCols !== cols || newRows !== rows);
      cols = newCols;
      rows = newRows;
      orientation = cols >= rows ? 'landscape' : 'portrait';
      menuRects = null;

      // An orientation change reshapes the grid, which can strand in-flight
      // snakes — restart the current round on the new board. A minor resize
      // that leaves the cell count unchanged keeps play going untouched.
      if (gridChanged && state !== 'menu' && mode) initRound();
    }

    // ---- round setup -------------------------------------------------------
    function makeSnake(id, color, dir, cells) {
      return {
        id: id, color: color, dir: dir, queue: [], cells: cells, ai: !!aiFlags[id],
        score: 0, alive: true, dead: false, wallDead: false, grew: -1, nh: null,
      };
    }

    function placeSnakes() {
      snakes = [];
      var len = START_LEN, i, c1;
      if (mode === 'solo') {
        var hx = Math.floor(cols / 2), hy = Math.floor(rows / 2);
        c1 = [];
        for (i = 0; i < len; i++) c1.push({ x: hx - i, y: hy });   // head right
        snakes.push(makeSnake(0, FG, { x: 1, y: 0 }, c1));
        return;
      }
      // Two players start on opposite sides facing each other, each on its own
      // lane so they don't duel on the centreline immediately. Their home side
      // matches the screen half their swipes are read from (see ownerOf).
      var p1 = [], p2 = [];
      if (orientation === 'landscape') {
        var r1 = Math.floor(rows * 0.35), r2 = Math.floor(rows * 0.65);
        var h1x = Math.max(len - 1, Math.floor(cols * 0.28));
        var h2x = Math.min(cols - len, Math.floor(cols * 0.72));
        for (i = 0; i < len; i++) p1.push({ x: h1x - i, y: r1 });  // P1 -> right
        for (i = 0; i < len; i++) p2.push({ x: h2x + i, y: r2 });  // P2 -> left
        snakes.push(makeSnake(0, FG, { x: 1, y: 0 }, p1));
        snakes.push(makeSnake(1, P2, { x: -1, y: 0 }, p2));
      } else {
        var c1c = Math.floor(cols * 0.35), c2c = Math.floor(cols * 0.65);
        var h1y = Math.max(len - 1, Math.floor(rows * 0.28));
        var h2y = Math.min(rows - len, Math.floor(rows * 0.72));
        for (i = 0; i < len; i++) p1.push({ x: c1c, y: h1y - i });  // P1 -> down
        for (i = 0; i < len; i++) p2.push({ x: c2c, y: h2y + i });  // P2 -> up
        snakes.push(makeSnake(0, FG, { x: 0, y: 1 }, p1));
        snakes.push(makeSnake(1, P2, { x: 0, y: -1 }, p2));
      }
    }

    function initRound() {
      placeSnakes();
      apples = [];
      fillApples();
      tickAcc = 0;
      result = null;
      state = 'ready';
      NG.setPlaying(false);   // chrome (FINISH / MENU) visible until play begins
    }

    function pickMode(m) { mode = m; aiFlags = [false, false]; initRound(); }

    function toMenu() {
      state = 'menu';
      snakes = [];
      apples = [];
      aiFlags = [false, false];
      menuRects = null;
      NG.setPlaying(false);
    }

    function startPlay() {
      state = 'playing';
      NG.setPlaying(true);    // hide page chrome during active play
    }

    // ---- apples ------------------------------------------------------------
    function appleTarget() { return mode === 'duo' ? 2 : 1; }

    function appleIndexAt(x, y) {
      for (var i = 0; i < apples.length; i++) {
        if (apples[i].x === x && apples[i].y === y) return i;
      }
      return -1;
    }

    function emptyCell() {
      var occ = Object.create(null), i, j, k;
      for (i = 0; i < snakes.length; i++) {
        for (j = 0; j < snakes[i].cells.length; j++) {
          var c = snakes[i].cells[j];
          occ[c.x + ',' + c.y] = true;
        }
      }
      for (i = 0; i < apples.length; i++) occ[apples[i].x + ',' + apples[i].y] = true;
      var free = [];
      for (j = 0; j < rows; j++) {
        for (k = 0; k < cols; k++) {
          if (!occ[k + ',' + j]) free.push({ x: k, y: j });
        }
      }
      if (!free.length) return null;
      return free[Math.floor(Math.random() * free.length)];
    }

    function fillApples() {
      var target = appleTarget();
      while (apples.length < target) {
        var c = emptyCell();
        if (!c) break;     // board full (extreme endgame) — just stop
        apples.push(c);
      }
    }

    // ---- input -------------------------------------------------------------
    // Which snake a pointer drives. Solo -> the only snake. Duo: there's just
    // one mouse, so it is always Player 1's controller (from anywhere on screen);
    // touches are split by the home half they BEGAN in (left/right in landscape,
    // top/bottom in portrait) so each player owns their side. AI snakes ignore
    // all of this — the guard lives in inputDir().
    function ownerOf(pt, ev) {
      if (mode === 'solo') return snakes[0];
      if (ev && ev.pointerType === 'mouse') return snakes[0];
      var startMain = orientation === 'landscape' ? pt.startNx : pt.startNy;
      return startMain < 0.5 ? snakes[0] : snakes[1];
    }

    // Queue a turn for a snake, rejecting no-ops and 180-degree reversals. The
    // check is against the last QUEUED direction (not just the live one) and the
    // queue is capped at two, so a quick double-swipe can't fold the snake back
    // on itself within a single tick.
    function inputDir(snake, dx, dy) {
      if (!snake || !snake.alive || snake.ai) return;      // AI snakes ignore human steering
      if (state !== 'ready' && state !== 'playing') return;
      if (state === 'ready') startPlay();                  // any directional input starts the round
      var base = snake.queue.length ? snake.queue[snake.queue.length - 1] : snake.dir;
      if (dx === base.x && dy === base.y) return;          // already heading this way
      if (dx === -base.x && dy === -base.y) return;        // 180-degree reversal
      if (snake.queue.length >= 2) return;
      snake.queue.push({ x: dx, y: dy });
    }

    // ---- computer player ---------------------------------------------------
    // A snake can be flipped to AI before the round starts (tap its head). For
    // every legal (non-reversing, non-fatal) move the AI looks one step ahead and
    // scores the resulting position; it then takes the highest score. The scoring
    // is what makes it play sensibly:
    //
    //   SOLO — survival first, then food. A move is only "safe" if, after taking
    //   it, the head can still reach the snake's own tail (an escape route always
    //   exists, so it never seals itself in). Among safe moves it favours open
    //   space and head freedom — that naturally bends OUTWARD toward room rather
    //   than curling inward, and leaves gaps along the walls instead of laying the
    //   body wall-to-wall across a row/column. With room to spare it then heads
    //   for the nearest apple.
    //
    //   DUO — the same survival gate, plus strategy: it rewards moves that shrink
    //   the OPPONENT's reachable space (cutting them off / walling them in) and
    //   moves that reach a contested apple first (denying it). Blocking outweighs
    //   feeding, but never at the cost of its own escape route.
    function blockedCells(ignoreTails) {
      var occ = Object.create(null), i, j, s;
      for (i = 0; i < snakes.length; i++) {
        s = snakes[i];
        if (!s.alive) continue;
        for (j = 0; j < s.cells.length; j++) {
          if (ignoreTails && j === s.cells.length - 1) continue;  // a tail vacates next tick
          occ[s.cells[j].x + ',' + s.cells[j].y] = true;
        }
      }
      return occ;
    }

    function isFatal(x, y, occ) {
      return x < 0 || x >= cols || y < 0 || y >= rows || occ[x + ',' + y] === true;
    }

    // Flood-fill free cells from (sx,sy): returns how many are reachable and
    // whether `targetKey` (e.g. the tail's cell) is among them.
    function floodInfo(sx, sy, occ, targetKey, cap) {
      var seen = Object.create(null), stack = [[sx, sy]], n = 0;
      var found = (sx + ',' + sy) === targetKey;
      seen[sx + ',' + sy] = true;
      while (stack.length && n < cap) {
        var c = stack.pop(); n++;
        var nb = [[c[0] + 1, c[1]], [c[0] - 1, c[1]], [c[0], c[1] + 1], [c[0], c[1] - 1]];
        for (var i = 0; i < 4; i++) {
          var x = nb[i][0], y = nb[i][1], k = x + ',' + y;
          if (seen[k] || isFatal(x, y, occ)) continue;
          seen[k] = true;
          if (k === targetKey) found = true;
          stack.push([x, y]);
        }
      }
      return { count: n, reaches: found };
    }

    function distToApples(x, y, arr) {
      var best = Infinity;
      for (var i = 0; i < arr.length; i++) {
        var d = Math.abs(arr[i].x - x) + Math.abs(arr[i].y - y);
        if (d < best) best = d;
      }
      return best === Infinity ? 0 : best;
    }
    function nearestAppleDist(x, y) { return distToApples(x, y, apples); }

    // The snake's body after it moves one cell in `dir` (index 0 = new head,
    // last = new tail). Grows — keeps its tail — only when the new head eats.
    function bodyAfterMove(s, dir) {
      var nx = s.cells[0].x + dir.x, ny = s.cells[0].y + dir.y;
      var grows = appleIndexAt(nx, ny) >= 0;
      var cells = [{ x: nx, y: ny }];
      var keep = grows ? s.cells.length : s.cells.length - 1;
      for (var j = 0; j < keep; j++) cells.push({ x: s.cells[j].x, y: s.cells[j].y });
      return cells;
    }

    function addCells(occ, cells, from, to) {
      for (var j = from; j < to; j++) occ[cells[j].x + ',' + cells[j].y] = true;
    }

    function headFreedom(x, y, occ) {
      var n = 0;
      if (!isFatal(x + 1, y, occ)) n++;
      if (!isFatal(x - 1, y, occ)) n++;
      if (!isFatal(x, y + 1, occ)) n++;
      if (!isFatal(x, y - 1, occ)) n++;
      return n;
    }

    // Look one move ahead and measure it. Tails (ours and the opponent's) are
    // treated as free, since they vacate next tick.
    function evalMove(s, dir, opp) {
      var self = bodyAfterMove(s, dir);
      var head = self[0], tail = self[self.length - 1], cap = cols * rows, j;
      // our own room + escape route: flood from the new head with our body
      // (minus head and tail) and the opponent's body (minus its tail) blocked.
      var occ = Object.create(null);
      addCells(occ, self, 1, self.length - 1);
      if (opp) for (j = 0; j < opp.cells.length - 1; j++) occ[opp.cells[j].x + ',' + opp.cells[j].y] = true;
      var fi = floodInfo(head.x, head.y, occ, tail.x + ',' + tail.y, cap);
      var nd = nearestAppleDist(head.x, head.y);
      var res = {
        dir: dir, head: { x: head.x, y: head.y }, space: fi.count, reaches: fi.reaches,
        freedom: headFreedom(head.x, head.y, occ),
        appleDist: nd, eats: apples.length > 0 && nd === 0, oppSpace: cap,
      };
      if (opp) {                       // how boxed-in the opponent becomes after our move
        var oocc = Object.create(null);
        addCells(oocc, self, 0, self.length - 1);   // our new body (head included, tail free)
        for (j = 0; j < opp.cells.length - 1; j++) oocc[opp.cells[j].x + ',' + opp.cells[j].y] = true;
        res.oppSpace = floodInfo(opp.cells[0].x, opp.cells[0].y, oocc, null, cap).count;
      }
      return res;
    }

    // Predict where the opponent could be NEXT tick: every cell it could legally
    // step into, plus the one it most likely picks (cheap proxy of its policy:
    // head for food, keep exits). Used to dodge head-on collisions — without this
    // two food-chasing snakes barrel into each other and the round ends in
    // seconds. (We don't recurse into the opponent's full scorer; this is enough.)
    function predictOpp(opp) {
      var danger = { bestKey: null, next: Object.create(null) };
      if (!opp) return danger;
      var od = opp.dir, h = opp.cells[0];
      var opts = [od, { x: od.y, y: -od.x }, { x: -od.y, y: od.x }];
      var occ = blockedCells(true), bestScore = -Infinity;
      for (var i = 0; i < opts.length; i++) {
        var nx = h.x + opts[i].x, ny = h.y + opts[i].y;
        if (isFatal(nx, ny, occ)) continue;
        danger.next[nx + ',' + ny] = true;
        var sc = headFreedom(nx, ny, occ) * 10 - nearestAppleDist(nx, ny);
        if (sc > bestScore) { bestScore = sc; danger.bestKey = nx + ',' + ny; }
      }
      return danger;
    }

    // Of the apples on the board, pick the one to chase: prefer the nearest apple
    // we reach BEFORE the opponent (their head is farther) — racing one they'd win
    // just wastes the trip and risks a head-on at the apple. If we're behind on
    // every apple, fall back to the one where we're least behind.
    function chooseTargetApple(s, opp) {
      if (!apples.length) return null;
      var head = s.cells[0], oh = opp ? opp.cells[0] : null;
      var win = null, winDist = Infinity, any = null, anyMargin = -Infinity;
      for (var i = 0; i < apples.length; i++) {
        var a = apples[i];
        var my = Math.abs(a.x - head.x) + Math.abs(a.y - head.y);
        var op = oh ? Math.abs(a.x - oh.x) + Math.abs(a.y - oh.y) : Infinity;
        if (my < op && my < winDist) { winDist = my; win = a; }     // I get there first
        if (op - my > anyMargin) { anyMargin = op - my; any = a; }   // least-contested fallback
      }
      return win || any;
    }

    function scoreDuo(c, danger) {
      var maxSpace = cols * rows, maxDist = cols + rows;
      var sc = c.reaches ? 100000 : 0;               // our own survival comes first
      if (c.eats) sc += 400;                         // grab a reachable apple (denies it + scores)
      sc += (1 - c.oppSpace / maxSpace) * 120;       // BLOCK: wall the opponent into less space
      sc += (1 - c.appleDist / maxDist) * 400;       // CONTEST: head for the apple (strong enough for border apples)
      sc += (c.space / maxSpace) * 40 + c.freedom * 3;  // keep room so we don't trade our life for it
      if (danger) {                                  // dodge a head-on: don't step where the opponent is going
        var hk = c.head.x + ',' + c.head.y;
        if (hk === danger.bestKey) sc -= 8000;       // most likely collision -> avoid unless it's our only escape
        else if (danger.next[hk]) sc -= 3000;        // possible collision -> avoid if we have an alternative
      }
      return sc;
    }

    // ---- solo: short rollout lookahead -------------------------------------
    // 1-ply "can I reach my tail right now?" is safe but timid: it won't enter a
    // corner even when the snake could thread it with a few well-timed moves. So
    // for each first move we play a quick greedy continuation (head toward food,
    // keep the most exits) several steps ahead, then judge that move by how it
    // turns out: surviving the whole rollout beats everything, eating along the
    // way is a big bonus, distance/freedom break ties. A corner apple is taken
    // only when the rollout both eats it AND stays alive — i.e. it's escapable —
    // otherwise plain survival (which scores higher than eat-then-die) wins, and
    // the snake keeps circling and re-checks next tick.
    function rolloutNextDir(cells, dir, apples0) {
      var head = cells[0];
      var options = [dir, { x: dir.y, y: -dir.x }, { x: -dir.y, y: dir.x }];
      var occ = Object.create(null);
      for (var i = 0; i < cells.length - 1; i++) occ[cells[i].x + ',' + cells[i].y] = true;
      var best = null, bestScore = -Infinity;
      for (var o = 0; o < options.length; o++) {
        var nx = head.x + options[o].x, ny = head.y + options[o].y;
        if (isFatal(nx, ny, occ)) continue;
        var sc = headFreedom(nx, ny, occ) * 100 - distToApples(nx, ny, apples0);
        if (sc > bestScore) { bestScore = sc; best = options[o]; }
      }
      return best;
    }

    function rolloutSurvival(cells0, dir0, apples0, K) {
      var cells = [], arr = [], i;
      for (i = 0; i < cells0.length; i++) cells.push({ x: cells0[i].x, y: cells0[i].y });
      for (i = 0; i < apples0.length; i++) arr.push({ x: apples0[i].x, y: apples0[i].y });
      var dir = { x: dir0.x, y: dir0.y }, ate = false, steps = 0;
      for (steps = 0; steps < K; steps++) {
        var nd = rolloutNextDir(cells, dir, arr);
        if (!nd) break;                              // trapped — dies here
        dir = nd;
        var nx = cells[0].x + dir.x, ny = cells[0].y + dir.y, hit = -1;
        cells.unshift({ x: nx, y: ny });
        for (i = 0; i < arr.length; i++) if (arr[i].x === nx && arr[i].y === ny) { hit = i; break; }
        if (hit >= 0) { ate = true; arr.splice(hit, 1); } else cells.pop();
      }
      return { ate: ate, alive: steps === K, steps: steps };
    }

    function aiChooseSolo(s) {
      var d = s.dir;
      var options = [d, { x: d.y, y: -d.x }, { x: -d.y, y: d.x }];
      var imm = blockedCells(true), head = s.cells[0], L = s.cells.length;
      var K = Math.max(15, Math.min(L + 5, 45));     // look ~a body-length ahead, bounded
      var best = options[0], bestScore = -Infinity, i, j;
      for (i = 0; i < options.length; i++) {
        var nx = head.x + options[i].x, ny = head.y + options[i].y;
        if (isFatal(nx, ny, imm)) continue;
        var ateNow = false;
        for (j = 0; j < apples.length; j++) if (apples[j].x === nx && apples[j].y === ny) { ateNow = true; break; }
        var cells = [{ x: nx, y: ny }], keep = ateNow ? L : L - 1;
        for (j = 0; j < keep; j++) cells.push({ x: s.cells[j].x, y: s.cells[j].y });
        var arr = [];
        for (j = 0; j < apples.length; j++) if (!(apples[j].x === nx && apples[j].y === ny)) arr.push(apples[j]);
        var r = rolloutSurvival(cells, options[i], arr, K);
        var ate = ateNow || r.ate;
        var sc = (r.alive ? 1000000 : r.steps * 1000) + (ate ? 500000 : 0)
               - distToApples(nx, ny, apples) * 10 + headFreedom(nx, ny, imm);
        if (sc > bestScore) { bestScore = sc; best = options[i]; }
      }
      return best;
    }

    function aiChooseDuo(s) {
      var d = s.dir;
      var options = [d, { x: d.y, y: -d.x }, { x: -d.y, y: d.x }];
      var imm = blockedCells(true), head = s.cells[0], i, opp = null;
      for (i = 0; i < snakes.length; i++) if (snakes[i] !== s && snakes[i].alive) opp = snakes[i];
      var cands = [];
      for (i = 0; i < options.length; i++) {
        var nx = head.x + options[i].x, ny = head.y + options[i].y;
        if (isFatal(nx, ny, imm)) continue;
        cands.push(evalMove(s, options[i], opp));
      }
      if (!cands.length) return options[0];          // doomed — keep going straight
      var danger = predictOpp(opp);
      var target = chooseTargetApple(s, opp);        // steer the contest gradient at the apple we can win
      if (target) for (i = 0; i < cands.length; i++) {
        cands[i].appleDist = Math.abs(target.x - cands[i].head.x) + Math.abs(target.y - cands[i].head.y);
      }
      var best = cands[0], bestScore = -Infinity;
      for (i = 0; i < cands.length; i++) {
        var sc = scoreDuo(cands[i], danger);
        if (sc > bestScore) { bestScore = sc; best = cands[i]; }
      }
      return best.dir;
    }

    function aiChoose(s) {
      return mode === 'duo' ? aiChooseDuo(s) : aiChooseSolo(s);
    }

    // ---- simulation: one grid step -----------------------------------------
    function step() {
      var live = [], i, j, s, o;
      for (i = 0; i < snakes.length; i++) if (snakes[i].alive) live.push(snakes[i]);

      // commit one queued turn (or let the AI pick) and compute each new head
      for (i = 0; i < live.length; i++) {
        s = live[i];
        if (s.ai) s.dir = aiChoose(s);
        else if (s.queue.length) s.dir = s.queue.shift();
        s.wallDead = false; s.dead = false; s.grew = -1;
        s.nh = { x: s.cells[0].x + s.dir.x, y: s.cells[0].y + s.dir.y };
      }

      // walls
      for (i = 0; i < live.length; i++) {
        s = live[i];
        if (s.nh.x < 0 || s.nh.x >= cols || s.nh.y < 0 || s.nh.y >= rows) s.wallDead = true;
      }

      // apples (only snakes still on the board can eat)
      for (i = 0; i < live.length; i++) {
        s = live[i];
        if (!s.wallDead) s.grew = appleIndexAt(s.nh.x, s.nh.y);
      }

      // advance bodies: push the new head, drop the tail unless we just ate
      for (i = 0; i < live.length; i++) {
        s = live[i];
        if (s.wallDead) continue;
        s.cells.unshift(s.nh);
        if (s.grew >= 0) s.score++;
        else s.cells.pop();
      }

      // remove eaten apples (dedup by index in case of a shared cell)
      var remove = {};
      for (i = 0; i < live.length; i++) if (live[i].grew >= 0) remove[live[i].grew] = true;
      if (Object.keys(remove).length) {
        var kept = [];
        for (i = 0; i < apples.length; i++) if (!remove[i]) kept.push(apples[i]);
        apples = kept;
      }

      // collisions, resolved on POST-MOVE bodies so a chased tail that moves out
      // of the way is not a crash, and a head-on (both heads in one cell) kills
      // both. A wall-dead snake is treated as already gone (its body is ignored).
      for (i = 0; i < live.length; i++) {
        s = live[i];
        if (s.wallDead) continue;
        var head = s.cells[0];
        for (j = 1; j < s.cells.length; j++) {
          if (s.cells[j].x === head.x && s.cells[j].y === head.y) { s.dead = true; break; }
        }
        if (s.dead) continue;
        for (var oi = 0; oi < live.length; oi++) {
          o = live[oi];
          if (o === s || o.wallDead) continue;
          for (j = 0; j < o.cells.length; j++) {
            if (o.cells[j].x === head.x && o.cells[j].y === head.y) { s.dead = true; break; }
          }
          if (s.dead) break;
        }
      }

      // commit deaths
      for (i = 0; i < live.length; i++) {
        s = live[i];
        if (s.wallDead) s.dead = true;
        if (s.dead) s.alive = false;
      }

      fillApples();

      // end conditions
      if (mode === 'solo') {
        if (!snakes[0].alive) endRound();
      } else {
        var aliveCount = 0;
        for (i = 0; i < snakes.length; i++) if (snakes[i].alive) aliveCount++;
        if (aliveCount <= 1) endRound();
      }
    }

    function endRound() {
      state = 'over';
      NG.setPlaying(false);
      if (mode === 'solo') {
        result = { type: 'solo', score: snakes[0].score, best: NG.bestScore('ng_snake_best', snakes[0].score) };
        return;
      }
      var a = snakes[0], b = snakes[1];
      if (a.alive && !b.alive) result = { type: 'win', winner: 0 };
      else if (b.alive && !a.alive) result = { type: 'win', winner: 1 };
      else if (a.score > b.score) result = { type: 'win', winner: 0 };  // both dead -> longer wins
      else if (b.score > a.score) result = { type: 'win', winner: 1 };
      else result = { type: 'draw' };
    }

    function currentSpeed() {
      var total = 0, i;
      for (i = 0; i < snakes.length; i++) total += snakes[i].score;
      var base = mode === 'solo'
        ? Math.min(SPEED_SOLO + SPEED_SOLO_RAMP * total, SPEED_SOLO_MAX)
        : Math.min(SPEED_DUO + SPEED_DUO_RAMP * total, SPEED_DUO_MAX);
      return base * speedMul;          // speedMul is the +/- debug time scale (applied past the cap)
    }

    function update(dt) {
      clock += dt;
      if (state !== 'playing') return;
      tickAcc += dt;
      var interval = 1 / currentSpeed();
      var steps = 0;
      while (tickAcc >= interval && steps < 8) {     // cap catch-up after a stall (headroom for the +12 debug speed)
        step();
        tickAcc -= interval;
        steps++;
        if (state !== 'playing') break;              // round ended mid-catch-up
      }
    }

    // ---- drawing -----------------------------------------------------------
    function rrect(px, py, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + w, py, px + w, py + h, r);
      ctx.arcTo(px + w, py + h, px, py + h, r);
      ctx.arcTo(px, py + h, px, py, r);
      ctx.arcTo(px, py, px + w, py, r);
      ctx.closePath();
    }

    function cellPx(x, y) { return { px: offX + x * cell, py: offY + y * cell }; }

    function drawBoard() {
      ctx.shadowBlur = 0;
      var bw = cols * cell, bh = rows * cell;
      ctx.fillStyle = '#060a08';
      ctx.fillRect(offX, offY, bw, bh);
      // faint grid for the graph-paper arcade feel
      ctx.strokeStyle = 'rgba(29,94,56,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      var i, p;
      for (i = 0; i <= cols; i++) { p = offX + i * cell; ctx.moveTo(p, offY); ctx.lineTo(p, offY + bh); }
      for (i = 0; i <= rows; i++) { p = offY + i * cell; ctx.moveTo(offX, p); ctx.lineTo(offX + bw, p); }
      ctx.stroke();
      ctx.strokeStyle = DIM;
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.strokeRect(offX, offY, bw, bh);
    }

    function drawApples() {
      var r = cell * 0.34 * (1 + 0.08 * Math.sin(clock * 6));
      for (var i = 0; i < apples.length; i++) {
        var c = cellPx(apples[i].x, apples[i].y);
        ctx.fillStyle = APPLE;
        ctx.shadowColor = APPLE;
        ctx.shadowBlur = cell * 0.6;
        ctx.beginPath();
        ctx.arc(c.px + cell / 2, c.py + cell / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    function drawSnake(s) {
      var n = s.cells.length, i, inset = cell * 0.12, rad = cell * 0.22;
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = s.alive ? cell * 0.45 : 0;
      for (i = n - 1; i >= 0; i--) {                 // tail first, head drawn last
        var c = cellPx(s.cells[i].x, s.cells[i].y);
        var t = (n - i) / n;                         // 1 at head, small at tail
        ctx.globalAlpha = s.alive ? (0.45 + 0.55 * t) : 0.22;
        rrect(c.px + inset, c.py + inset, cell - 2 * inset, cell - 2 * inset, rad);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      // eyes on the head, looking the way it travels
      var h = cellPx(s.cells[0].x, s.cells[0].y);
      var cx = h.px + cell / 2, cy = h.py + cell / 2;
      var fx = s.dir.x, fy = s.dir.y, ox = -fy, oy = fx;  // forward + perpendicular
      var fwd = cell * 0.1, sep = cell * 0.18, er = cell * 0.09;
      ctx.fillStyle = '#06120b';
      var sgn;
      for (sgn = -1; sgn <= 1; sgn += 2) {
        ctx.beginPath();
        ctx.arc(cx + fx * fwd + ox * sep * sgn, cy + fy * fwd + oy * sep * sgn, er, 0, Math.PI * 2);
        ctx.fill();
      }
      // "AI" stamped into the segment behind the head (dark, like the eyes, so
      // it reads against the bright body) — marks a computer-driven snake.
      if (s.ai) {
        var seg = cellPx(s.cells[n > 1 ? 1 : 0].x, s.cells[n > 1 ? 1 : 0].y);
        ctx.fillStyle = '#06120b';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + (cell * 0.45).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('AI', seg.px + cell / 2, seg.py + cell / 2);
      }
    }

    function drawScores() {
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var bw = cols * cell, bh = rows * cell;
      if (mode === 'solo') {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = DIM;
        ctx.font = 'bold ' + (cell * 1.0).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText(String(snakes[0].score), offX + bw / 2, offY + cell * 1.1);
        ctx.globalAlpha = 1;
        return;
      }
      // duo: a big faint number sitting in each player's half (Pong-style ambience)
      var a, b;
      if (orientation === 'landscape') {
        a = [offX + bw * 0.25, offY + bh * 0.5];
        b = [offX + bw * 0.75, offY + bh * 0.5];
      } else {
        a = [offX + bw * 0.5, offY + bh * 0.25];
        b = [offX + bw * 0.5, offY + bh * 0.75];
      }
      ctx.font = 'bold ' + (Math.min(bw, bh) * 0.22).toFixed(0) + 'px "Courier New", monospace';
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = FG; ctx.fillText(String(snakes[0].score), a[0], a[1]);
      ctx.fillStyle = P2; ctx.fillText(String(snakes[1].score), b[0], b[1]);
      ctx.globalAlpha = 1;
    }

    function drawReady() {
      var pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
      // The solo snake lies across the centre row, so drop the prompt into the
      // lower third to keep it clear of the body. In duo the centre sits between
      // the two snakes, so it stays readable there.
      var promptY = mode === 'solo' ? courtH * 0.74 : courtH / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = FG;
      ctx.shadowColor = FG;
      ctx.shadowBlur = cell * 0.4;
      ctx.globalAlpha = pulse;
      ctx.font = 'bold ' + (cell * 0.85).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP TO START', courtW / 2, promptY);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      // tell the player about the tap-a-head-for-AI affordance
      ctx.fillStyle = MUTED;
      ctx.globalAlpha = 0.9;
      ctx.font = 'bold ' + (cell * 0.4).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP A HEAD FOR AI', courtW / 2, promptY + cell * 0.95);
      ctx.globalAlpha = 1;
      if (mode === 'duo') {                  // label each player's home half
        var bw = cols * cell, bh = rows * cell;
        ctx.font = 'bold ' + (cell * 0.5).toFixed(0) + 'px "Courier New", monospace';
        ctx.globalAlpha = 0.85;
        var pa, pb;
        if (orientation === 'landscape') {
          pa = [offX + bw * 0.16, offY + bh * 0.5];
          pb = [offX + bw * 0.84, offY + bh * 0.5];
        } else {
          pa = [offX + bw * 0.5, offY + bh * 0.12];
          pb = [offX + bw * 0.5, offY + bh * 0.88];
        }
        ctx.fillStyle = FG; ctx.fillText('P1', pa[0], pa[1]);
        ctx.fillStyle = P2; ctx.fillText('P2', pb[0], pb[1]);
        ctx.globalAlpha = 1;
      }
    }

    function drawOver() {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(offX, offY, cols * cell, rows * cell);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var cx = courtW / 2, cy = courtH / 2;
      var big = cell * 0.95, small = cell * 0.55;

      if (mode === 'solo') {
        ctx.fillStyle = FG; ctx.shadowColor = FG; ctx.shadowBlur = cell * 0.4;
        ctx.font = 'bold ' + big.toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('GAME OVER', cx, cy - cell * 0.8);
        ctx.shadowBlur = 0; ctx.fillStyle = INK;
        ctx.font = 'bold ' + small.toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('SCORE  ' + result.score, cx, cy);
        ctx.fillStyle = result.best.isNew ? P2 : MUTED;
        ctx.font = 'bold ' + (small * 0.8).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText((result.best.isNew ? 'NEW BEST  ' : 'BEST  ') + result.best.best, cx, cy + cell * 0.55);
      } else if (result.type === 'draw') {
        ctx.fillStyle = INK;
        ctx.font = 'bold ' + big.toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('DRAW', cx, cy - cell * 0.8);
        ctx.font = 'bold ' + small.toFixed(0) + 'px "Courier New", monospace';
        ctx.fillStyle = FG; ctx.fillText('P1  ' + snakes[0].score, cx - cell * 3, cy);
        ctx.fillStyle = P2; ctx.fillText('P2  ' + snakes[1].score, cx + cell * 3, cy);
      } else {
        var col = result.winner === 0 ? FG : P2;
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = cell * 0.4;
        ctx.font = 'bold ' + big.toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('PLAYER ' + (result.winner + 1) + ' WINS', cx, cy - cell * 0.8);
        ctx.shadowBlur = 0;
        ctx.font = 'bold ' + small.toFixed(0) + 'px "Courier New", monospace';
        ctx.fillStyle = FG; ctx.fillText('P1  ' + snakes[0].score, cx - cell * 3, cy);
        ctx.fillStyle = P2; ctx.fillText('P2  ' + snakes[1].score, cx + cell * 3, cy);
      }

      var pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
      ctx.globalAlpha = pulse; ctx.shadowBlur = 0; ctx.fillStyle = INK;
      ctx.font = 'bold ' + (cell * 0.5).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP TO PLAY AGAIN', cx, cy + cell * 1.05);
      ctx.globalAlpha = 1;
    }

    function computeMenuRects() {
      var cx = courtW / 2, solo, duo;
      if (orientation === 'landscape') {
        var bw = Math.min(courtW * 0.34, 360), bh = Math.min(courtH * 0.32, 240);
        var gap = courtW * 0.05, y = courtH * 0.44;
        solo = { x: cx - gap / 2 - bw, y: y, w: bw, h: bh };
        duo = { x: cx + gap / 2, y: y, w: bw, h: bh };
      } else {
        var bw2 = Math.min(courtW * 0.74, 440), bh2 = Math.min(courtH * 0.16, 150);
        var gap2 = courtH * 0.04, y2 = courtH * 0.4;
        solo = { x: cx - bw2 / 2, y: y2, w: bw2, h: bh2 };
        duo = { x: cx - bw2 / 2, y: y2 + bh2 + gap2, w: bw2, h: bh2 };
      }
      return { solo: solo, duo: duo };
    }

    function drawButton(b, label, sub, color) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.14);
      ctx.fill();
      ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.font = 'bold ' + (b.h * 0.24).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h * 0.42);
      ctx.fillStyle = MUTED;
      ctx.font = 'bold ' + (b.h * 0.16).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(sub, b.x + b.w / 2, b.y + b.h * 0.72);
    }

    function drawMenu() {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#060a08';
      ctx.fillRect(0, 0, courtW, courtH);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var cx = courtW / 2, unit = Math.min(courtW, courtH);
      ctx.fillStyle = FG; ctx.shadowColor = FG; ctx.shadowBlur = unit * 0.03;
      ctx.font = 'bold ' + (unit * 0.13).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('SNAKE', cx, courtH * 0.2);
      ctx.shadowBlur = 0; ctx.fillStyle = MUTED;
      ctx.font = 'bold ' + (unit * 0.028).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('NOSTALGIC ARCADE', cx, courtH * 0.2 + unit * 0.09);

      menuRects = computeMenuRects();
      drawButton(menuRects.solo, '1 PLAYER', 'CLASSIC', FG);
      drawButton(menuRects.duo, '2 PLAYERS', 'HEAD TO HEAD', P2);

      ctx.fillStyle = MUTED;
      ctx.font = 'bold ' + (unit * 0.026).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('SWIPE TO STEER  ·  EAT THE APPLES', cx, courtH * 0.9);
    }

    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);
      if (state === 'menu') { drawMenu(); return; }
      drawBoard();
      drawScores();
      drawApples();
      for (var i = 0; i < snakes.length; i++) drawSnake(snakes[i]);
      if (state === 'ready') drawReady();
      else if (state === 'over') drawOver();
      if (speedMul !== 1) {                 // debug speed readout, top-right of the board
        ctx.shadowBlur = 0;
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.font = 'bold ' + (cell * 0.4).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('SPD x' + speedMul.toFixed(2), offX + cols * cell - cell * 0.3, offY + cell * 0.3);
      }
      ctx.shadowBlur = 0;
    }

    // ---- input wiring ------------------------------------------------------
    // Pointer Events cover touch AND mouse, so "tap" below means a tap or a
    // mouse click. A drag past SWIPE_THRESH is a swipe (steer toward the drag);
    // a press that doesn't drag is a tap, resolved on release by game state.
    function inRect(x, y, b) {
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    }
    function hitMenu(x, y) {
      var r = menuRects || computeMenuRects();
      if (inRect(x, y, r.solo)) { pickMode('solo'); return true; }
      if (inRect(x, y, r.duo)) { pickMode('duo'); return true; }
      return false;
    }
    // Which snake's head (if any) is under a point — generous padding for fingers.
    function snakeHeadAt(x, y) {
      for (var i = 0; i < snakes.length; i++) {
        var h = cellPx(snakes[i].cells[0].x, snakes[i].cells[0].y), pad = cell * 0.5;
        if (x >= h.px - pad && x <= h.px + cell + pad && y >= h.py - pad && y <= h.py + cell + pad) {
          return snakes[i];
        }
      }
      return null;
    }
    // Turn a snake toward a tapped point, judged in GRID CELLS relative to the
    // head along the axis ACROSS the direction of travel. Tapping the same row
    // (when moving horizontally) or same column (when moving vertically) is a
    // "straight ahead" tap and carries on; a tap even one cell off to a side
    // turns the snake that way. (A turn onto the cross axis is never a reversal.)
    function turnToward(s, x, y) {
      var base = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
      var hc = s.cells[0];
      var tx = clamp(Math.floor((x - offX) / cell), 0, cols - 1);
      var ty = clamp(Math.floor((y - offY) / cell), 0, rows - 1);
      if (base.y === 0) {                 // moving horizontally -> a different ROW steers vertically
        if (ty !== hc.y) inputDir(s, 0, ty > hc.y ? 1 : -1);
      } else {                            // moving vertically -> a different COLUMN steers horizontally
        if (tx !== hc.x) inputDir(s, tx > hc.x ? 1 : -1, 0);
      }
    }

    NG.createTouch(canvas, {
      onDown: function (pt) {
        anchors[pt.id] = { x: pt.x, y: pt.y, moved: false, handled: false };
        // Mode buttons respond on press; mark the gesture handled so its release
        // isn't then read as a "tap to start" (which would skip the start screen).
        if (state === 'menu' && hitMenu(pt.x, pt.y)) anchors[pt.id].handled = true;
      },
      onMove: function (pt, ev) {
        if (state !== 'ready' && state !== 'playing') return;
        var a = anchors[pt.id];
        if (!a) { a = anchors[pt.id] = { x: pt.x, y: pt.y, moved: false }; }
        var dx = pt.x - a.x, dy = pt.y - a.y;
        if (Math.abs(dx) < SWIPE_THRESH && Math.abs(dy) < SWIPE_THRESH) return;
        a.moved = true;                              // this gesture is a swipe, not a tap
        var s = ownerOf(pt, ev);
        if (s.ai) { if (state === 'ready') startPlay(); }   // can't steer an AI; a swipe still starts
        else if (Math.abs(dx) > Math.abs(dy)) inputDir(s, dx > 0 ? 1 : -1, 0);
        else inputDir(s, 0, dy > 0 ? 1 : -1);
        a.x = pt.x; a.y = pt.y;                       // re-anchor so the next turn registers
      },
      onUp: function (pt, ev) {
        var a = anchors[pt.id];
        delete anchors[pt.id];
        if (!a || a.moved || a.handled) return;      // swipe, or a gesture already spent on the menu
        if (state === 'over') { initRound(); return; }       // tap replays the mode
        if (state === 'ready') {
          var head = snakeHeadAt(pt.x, pt.y);
          if (head) { head.ai = !head.ai; aiFlags[head.id] = head.ai; return; }  // tap a head -> toggle AI
          startPlay();                               // tap elsewhere -> start the round
        } else if (state === 'playing') {
          turnToward(ownerOf(pt, ev), pt.x, pt.y);   // tap/click -> turn toward it (mouse drives P1)
        }
      },
    });

    // Keyboard: a desktop-development convenience (the game never requires it).
    // Arrows drive P1 / the solo snake; WASD drives P2 (or the solo snake too).
    // "+" / "-" scale the simulation speed (debug), in any state.
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === '+' || k === '=' || k === 'add') {
        speedMul = Math.min(speedMul * 1.5, 12); ev.preventDefault(); return;
      }
      if (k === '-' || k === '_' || k === 'subtract') {
        speedMul = Math.max(speedMul / 1.5, 0.25); ev.preventDefault(); return;
      }
      if (state === 'menu') {
        if (k === '1') pickMode('solo');
        else if (k === '2') pickMode('duo');
        return;
      }
      if (state === 'over') {
        if (k !== 'escape' && k !== 'esc') initRound();
        return;
      }
      if (state === 'ready' && (k === 'enter' || k === ' ' || k === 'spacebar')) {
        startPlay(); ev.preventDefault(); return;    // dev convenience: start without steering
      }
      var p1 = snakes[0], p2 = snakes.length > 1 ? snakes[1] : null;
      var handled = true;
      if (k === 'arrowup') inputDir(p1, 0, -1);
      else if (k === 'arrowdown') inputDir(p1, 0, 1);
      else if (k === 'arrowleft') inputDir(p1, -1, 0);
      else if (k === 'arrowright') inputDir(p1, 1, 0);
      else handled = false;
      var wasd = mode === 'duo' && p2 ? p2 : p1;
      if (k === 'w') { inputDir(wasd, 0, -1); handled = true; }
      else if (k === 's') { inputDir(wasd, 0, 1); handled = true; }
      else if (k === 'a') { inputDir(wasd, -1, 0); handled = true; }
      else if (k === 'd') { inputDir(wasd, 1, 0); handled = true; }
      if (handled) ev.preventDefault();
    });

    // FINISH (button + ESC/BACK/HOME keys) is contextual: from a game it backs
    // out to the mode menu; from the menu it leaves for the catalogue.
    NG.enableFinish({
      button: '#finish',
      onFinish: function () {
        if (state === 'menu') window.location.href = '../../index.html';
        else toMenu();
      },
    });

    // ---- boot --------------------------------------------------------------
    NG.onResize(layout);
    NG.setPlaying(false);

    var last = 0;
    function loop(t) {
      if (!last) last = t;
      var dt = Math.min((t - last) / 1000, 1 / 30);
      last = t;
      update(dt);
      draw();
      window.requestAnimationFrame(loop);
    }
    window.requestAnimationFrame(loop);
  });
})();
