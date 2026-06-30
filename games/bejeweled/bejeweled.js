/*
 * Bejeweled — match-3 puzzle for the Nostalgic Gaming catalogue.
 *
 * Classic script, no ES modules — runs from file:// and HTTP alike.
 * Fixed-ratio letterbox layout (like 2048 / Reversi / Sudoku): the 8×8 gem
 * grid is centred and maximised; chrome (score, best, NEW, robot) occupies the
 * leftover space — side panels in landscape, top/bottom bands in portrait.
 *
 * Touch: tap a gem then tap an adjacent gem to swap, OR short-drag a gem toward
 * the neighbour you want to swap with (direction snaps to the nearest axis).
 * A swap that makes no run of 3+ springs back. Matches clear, gems above fall
 * to fill the gap, new gems drop in from the top, and any fresh matches cascade
 * for a rising combo multiplier.
 *
 * Mirrors the project's conventions: IIFE, 'use strict', NG.onResize,
 * NG.createTouch, NG.enableFinish, NG.setPlaying, requestAnimationFrame loop,
 * and the same chrome / robot-autoplay toggle as 2048 and Reversi.
 */
(function () {
  'use strict';

  // ---- palette ---------------------------------------------------------------
  var BG       = '#0a1410';
  var GRID_BG  = '#0e1c16';
  var SLOT_BG  = '#111e16';
  var FG       = '#4dff88';
  var DIM      = '#1d5e38';
  var INK      = '#d6f7e4';
  var MUTED    = '#6b7a72';

  // Six gem types — each a distinct colour AND shape (so they read apart even
  // for colour-blind players, the same trick the classic arcade games used).
  var GEMS = [
    { color: '#4dff88', dark: '#2a9c55', shape: 'diamond'  }, // green
    { color: '#ff5d6c', dark: '#a8323e', shape: 'circle'   }, // red
    { color: '#5b8cff', dark: '#33518f', shape: 'square'   }, // blue
    { color: '#ffcf4d', dark: '#a8852a', shape: 'triangle' }, // amber
    { color: '#b46bff', dark: '#6f3fa8', shape: 'hex'      }, // purple
    { color: '#4de8d0', dark: '#2a9488', shape: 'star'     }, // cyan
  ];
  var NUM_GEMS = GEMS.length;

  // ---- constants -------------------------------------------------------------
  var SIZE      = 8;
  var DRAG_MIN  = 12;      // CSS px before a drag counts as a directional swipe
  var BEST_KEY  = 'ng_bejeweled_best';
  var AI_DELAY  = 480;     // ms between autoplay moves

  // Animation timings (seconds)
  var SWAP_DUR  = 0.15;
  var CLEAR_DUR = 0.22;
  var FALL_DUR  = 0.26;
  var HINT_DUR  = 0.62;   // hint demo: swap out and spring back

  // ---- game state ------------------------------------------------------------
  var grid = [];          // SIZE*SIZE of gem-type index (0..NUM_GEMS-1); never -1 at rest
  var score = 0;
  var bestScore = 0;

  // Phase machine: 'idle' | 'swap' | 'swapback' | 'clear' | 'fall'
  var phase = 'idle';
  var animStart = 0;      // clock value when the current phase's animation began

  var selected = -1;      // currently selected cell (tap-to-swap), or -1
  var combo = 1;          // cascade multiplier within a single resolution chain
  var comboShown = 0;     // largest combo reached this chain (for the toast)

  // Swap animation descriptor
  var swap = null;        // { a, b, aType, bType }
  // Hint demo descriptor (non-committing swap-and-back)
  var hint = null;        // { a, b, aType, bType }
  // Clear animation
  var matchedList = [];   // flat indices currently clearing
  // Fall animation — fallStart[idx] = visual start row (may be fractional/negative)
  var fallStart = [];

  var aiEnabled = false;
  var aiGen = 0;          // bumps to cancel stale scheduled AI moves

  // ---- layout (recomputed on resize) ----------------------------------------
  var vw = 0, vh = 0, drawScale = 1;
  var boardLeft = 0, boardTop = 0, boardSize = 0;
  var cellSize = 0, cellPad = 0;
  var panelMode = 'wide';

  // ---- utility ---------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function idx(r, c) { return r * SIZE + c; }
  function rowOf(i) { return (i / SIZE) | 0; }
  function colOf(i) { return i % SIZE; }
  function easeOut(t) { return t < 1 ? 1 - (1 - t) * (1 - t) : 1; }
  function randGem() { return (Math.random() * NUM_GEMS) | 0; }
  function adjacent(a, b) {
    var dr = Math.abs(rowOf(a) - rowOf(b)), dc = Math.abs(colOf(a) - colOf(b));
    return (dr + dc) === 1;
  }

  // ---- match / board logic ---------------------------------------------------
  // Returns a boolean array marking every cell that belongs to a run of 3+.
  function findMatches(g) {
    var mark = new Array(SIZE * SIZE);
    var r, c, run, t, k;
    // horizontal runs
    for (r = 0; r < SIZE; r++) {
      run = 1;
      for (c = 1; c <= SIZE; c++) {
        t = c < SIZE ? g[idx(r, c)] : -1;
        if (c < SIZE && t === g[idx(r, c - 1)]) {
          run++;
        } else {
          if (run >= 3) for (k = c - run; k < c; k++) mark[idx(r, k)] = true;
          run = 1;
        }
      }
    }
    // vertical runs
    for (c = 0; c < SIZE; c++) {
      run = 1;
      for (r = 1; r <= SIZE; r++) {
        t = r < SIZE ? g[idx(r, c)] : -1;
        if (r < SIZE && t === g[idx(r - 1, c)]) {
          run++;
        } else {
          if (run >= 3) for (k = r - run; k < r; k++) mark[idx(k, c)] = true;
          run = 1;
        }
      }
    }
    return mark;
  }

  function markCount(mark) {
    var n = 0;
    for (var i = 0; i < mark.length; i++) if (mark[i]) n++;
    return n;
  }

  // Would swapping a,b create any match? (pure — works on a copy)
  function swapMakesMatch(a, b) {
    var g = grid.slice();
    var tmp = g[a]; g[a] = g[b]; g[b] = tmp;
    return markCount(findMatches(g)) > 0;
  }

  // Is there at least one legal move on the current board?
  function hasValidMove() {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var i = idx(r, c);
        if (c + 1 < SIZE && swapMakesMatch(i, idx(r, c + 1))) return true;
        if (r + 1 < SIZE && swapMakesMatch(i, idx(r + 1, c))) return true;
      }
    }
    return false;
  }

  // Fill the board fresh with no pre-existing matches and at least one move.
  function generateBoard() {
    do {
      for (var r = 0; r < SIZE; r++) {
        for (var c = 0; c < SIZE; c++) {
          var t;
          do { t = randGem(); }
          while (
            (c >= 2 && grid[idx(r, c - 1)] === t && grid[idx(r, c - 2)] === t) ||
            (r >= 2 && grid[idx(r - 1, c)] === t && grid[idx(r - 2, c)] === t)
          );
          grid[idx(r, c)] = t;
        }
      }
    } while (!hasValidMove());
  }

  // Collapse gems down each column and refill the top with new gems.
  // Records fallStart[idx] = the (possibly negative) row each gem falls from.
  function applyGravity() {
    fallStart = new Array(SIZE * SIZE);
    for (var c = 0; c < SIZE; c++) {
      var col = [];
      for (var r = 0; r < SIZE; r++) {
        if (grid[idx(r, c)] !== -1) col.push({ t: grid[idx(r, c)], src: r });
      }
      var dest = SIZE - 1;
      for (var i = col.length - 1; i >= 0; i--) {
        var di = idx(dest, c);
        grid[di] = col[i].t;
        fallStart[di] = col[i].src;   // slides down from its old row
        dest--;
      }
      var newCount = dest + 1;          // rows 0..dest need fresh gems
      for (var rr = dest; rr >= 0; rr--) {
        grid[idx(rr, c)] = randGem();
        fallStart[idx(rr, c)] = rr - newCount;   // stacked above the board
      }
    }
  }

  // ---- phase transitions -----------------------------------------------------
  function beginClear(mark) {
    matchedList = [];
    for (var i = 0; i < mark.length; i++) if (mark[i]) matchedList.push(i);
    // Score: 10 per gem, scaled by the cascade multiplier. Bigger groups and
    // deeper cascades pay off.
    score += matchedList.length * 10 * combo;
    if (score > bestScore) {
      bestScore = score;
      try { localStorage.setItem(BEST_KEY, bestScore); } catch (e) {}
    }
    if (combo > comboShown) comboShown = combo;
    phase = 'clear';
    animStart = clock;
  }

  function initiateSwap(a, b) {
    if (phase !== 'idle') return;
    selected = -1;
    swap = { a: a, b: b, aType: grid[a], bType: grid[b] };
    phase = 'swap';
    animStart = clock;
    aiGen++;   // cancel any pending autoplay tick; a move is underway
  }

  // Demonstrate a legal move: animate the two gems swapping out and springing
  // back, committing nothing. Picks the swap that would clear the most gems.
  function startHint() {
    if (phase !== 'idle') return;
    var mv = aiBestSwap();
    if (!mv) return;
    selected = -1;
    hint = { a: mv.a, b: mv.b, aType: grid[mv.a], bType: grid[mv.b] };
    phase = 'hint';
    animStart = clock;
    aiGen++;   // pause autoplay during the demo; rescheduled when it ends
  }

  function settleIdle() {
    phase = 'idle';
    combo = 1;
    if (!hasValidMove()) {
      // No moves left — quietly reshuffle into a fresh solvable board.
      generateBoard();
    }
    NG.setPlaying(false);
    scheduleAI();
  }

  function update() {
    var p;
    if (phase === 'swap') {
      p = (clock - animStart) / SWAP_DUR;
      if (p >= 1) {
        // Commit the swap and see if it matches.
        var t = grid[swap.a]; grid[swap.a] = grid[swap.b]; grid[swap.b] = t;
        var mark = findMatches(grid);
        if (markCount(mark) > 0) {
          combo = 1; comboShown = 0;
          NG.setPlaying(true);
          beginClear(mark);
        } else {
          // Undo: keep the committed (swapped) grid and animate back.
          phase = 'swapback';
          animStart = clock;
        }
      }
    } else if (phase === 'swapback') {
      p = (clock - animStart) / SWAP_DUR;
      if (p >= 1) {
        var t2 = grid[swap.a]; grid[swap.a] = grid[swap.b]; grid[swap.b] = t2;
        swap = null;
        phase = 'idle';
        scheduleAI();
      }
    } else if (phase === 'clear') {
      p = (clock - animStart) / CLEAR_DUR;
      if (p >= 1) {
        for (var i = 0; i < matchedList.length; i++) grid[matchedList[i]] = -1;
        matchedList = [];
        swap = null;
        applyGravity();
        phase = 'fall';
        animStart = clock;
      }
    } else if (phase === 'fall') {
      p = (clock - animStart) / FALL_DUR;
      if (p >= 1) {
        fallStart = [];
        var mark2 = findMatches(grid);
        if (markCount(mark2) > 0) {
          combo++;                 // cascade — bigger multiplier
          beginClear(mark2);
        } else {
          settleIdle();
        }
      }
    } else if (phase === 'hint') {
      if ((clock - animStart) / HINT_DUR >= 1) {
        hint = null;
        phase = 'idle';
        scheduleAI();   // resume autoplay if it was on
      }
    }
  }

  // ---- new game --------------------------------------------------------------
  function newGame() {
    grid = new Array(SIZE * SIZE);
    generateBoard();
    score = 0;
    phase = 'idle';
    selected = -1;
    swap = null;
    matchedList = [];
    fallStart = [];
    combo = 1; comboShown = 0;
    aiGen++;
    NG.setPlaying(false);
    scheduleAI();
  }

  // ---- AI (autoplay) ---------------------------------------------------------
  // Find the adjacent swap that clears the most gems immediately.
  function aiBestSwap() {
    var best = null, bestCount = 0, r, c, i;
    for (r = 0; r < SIZE; r++) {
      for (c = 0; c < SIZE; c++) {
        i = idx(r, c);
        var cands = [];
        if (c + 1 < SIZE) cands.push(idx(r, c + 1));
        if (r + 1 < SIZE) cands.push(idx(r + 1, c));
        for (var k = 0; k < cands.length; k++) {
          var j = cands[k];
          var g = grid.slice();
          var tmp = g[i]; g[i] = g[j]; g[j] = tmp;
          var n = markCount(findMatches(g));
          if (n > bestCount) { bestCount = n; best = { a: i, b: j }; }
        }
      }
    }
    return best;
  }

  function scheduleAI() {
    if (!aiEnabled || phase !== 'idle') return;
    var gen = aiGen;
    window.setTimeout(function () {
      if (gen !== aiGen || !aiEnabled || phase !== 'idle') return;
      var mv = aiBestSwap();
      if (mv) initiateSwap(mv.a, mv.b);
    }, AI_DELAY);
  }

  // ---- layout ----------------------------------------------------------------
  var canvas, ctx;

  function layout(info) {
    var dpr = window.devicePixelRatio || 1;
    vw = info.width; vh = info.height;
    canvas.style.width  = vw + 'px';
    canvas.style.height = vh + 'px';
    canvas.width  = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    drawScale = dpr;

    var pad = clamp(Math.min(vw, vh) * 0.02, 6, 20);
    if (vw >= vh) {
      panelMode = 'wide';
      var minPanel = clamp(Math.min(vw, vh) * 0.22, 100, 260);
      boardSize = Math.max(60, Math.min(vh - 2 * pad, vw - 2 * minPanel));
    } else {
      panelMode = 'stacked';
      var band = clamp(vh * 0.14, 72, 180);
      boardSize = Math.max(60, Math.min(vw - 2 * pad, vh - 2 * band));
    }

    boardLeft = (vw - boardSize) / 2;
    boardTop  = (vh - boardSize) / 2;
    cellPad   = clamp(boardSize * 0.012, 2, 8);
    cellSize  = (boardSize - cellPad * (SIZE + 1)) / SIZE;
  }

  function chromeLayout() {
    var unit = Math.min(vw, vh);
    var bw = clamp(unit * 0.18, 70, 180);
    var bh = clamp(unit * 0.055, 28, 46);
    var fs = clamp(unit * 0.032, 11, 22);

    if (panelMode === 'wide') {
      var lw  = boardLeft;
      var rw  = vw - (boardLeft + boardSize);
      var cxL = lw / 2;
      var cxR = boardLeft + boardSize + rw / 2;
      var gap = clamp(unit * 0.025, 8, 24);
      var cy  = boardTop + boardSize / 2;
      return {
        mode: 'wide',
        finish:   { x: cxL - bw / 2, y: boardTop + gap,              w: bw, h: bh },
        newBtn:   { x: cxL - bw / 2, y: boardTop + gap * 2 + bh,     w: bw, h: bh },
        hintBtn:  { x: cxL - bw / 2, y: boardTop + gap * 3 + bh * 2, w: bw, h: bh },
        robot:    { x: cxL - bw / 2, y: boardTop + gap * 4 + bh * 3, w: bw, h: bh },
        scoreBox: { x: cxR - bw / 2, y: cy - bh - gap / 2,           w: bw, h: bh },
        bestBox:  { x: cxR - bw / 2, y: cy + gap / 2,                w: bw, h: bh },
        fs: fs,
      };
    }
    // stacked
    var tb1 = boardTop;
    var bb0 = boardTop + boardSize;
    var bbH = vh - bb0;
    var mgx = clamp(vw * 0.03, 8, 24);
    var mgy = clamp(tb1 * 0.12, 6, 20);
    var sbw = clamp(vw * 0.28, 80, 170);
    var gapS = clamp(unit * 0.02, 6, 18);
    var byb = bb0 + (bbH - bh) / 2;   // bottom-band button row
    return {
      mode: 'stacked',
      finish:   { x: mgx,           y: mgy, w: bw, h: bh },
      newBtn:   { x: vw - mgx - bw, y: mgy, w: bw, h: bh },
      hintBtn:  { x: vw / 2 - bw - gapS / 2, y: byb, w: bw, h: bh },
      robot:    { x: vw / 2 + gapS / 2,      y: byb, w: bw, h: bh },
      scoreBox: { x: vw / 2 - sbw - clamp(unit * 0.015, 4, 10), y: tb1 - bh - mgy, w: sbw, h: bh },
      bestBox:  { x: vw / 2 + clamp(unit * 0.015, 4, 10),       y: tb1 - bh - mgy, w: sbw, h: bh },
      fs: fs,
    };
  }

  // Cell top-left pixel position — fractional r/c gives smooth interpolated coords
  function cellPos(r, c) {
    return {
      x: boardLeft + cellPad + c * (cellSize + cellPad),
      y: boardTop  + cellPad + r * (cellSize + cellPad),
    };
  }
  function cellFromXY(px, py) {
    if (px < boardLeft || px > boardLeft + boardSize ||
        py < boardTop  || py > boardTop  + boardSize) return -1;
    var c = Math.floor((px - boardLeft - cellPad) / (cellSize + cellPad));
    var r = Math.floor((py - boardTop  - cellPad) / (cellSize + cellPad));
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1;
    return idx(r, c);
  }

  // ---- drawing ---------------------------------------------------------------
  function rrect(px, py, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(px + rad, py);
    ctx.arcTo(px + w, py,     px + w, py + h, rad);
    ctx.arcTo(px + w, py + h, px,     py + h, rad);
    ctx.arcTo(px,     py + h, px,     py,     rad);
    ctx.arcTo(px,     py,     px + w, py,     rad);
    ctx.closePath();
  }

  function drawBoard() {
    var rad = clamp(boardSize * 0.025, 4, 16);
    ctx.fillStyle = GRID_BG;
    rrect(boardLeft, boardTop, boardSize, boardSize, rad);
    ctx.fill();
    ctx.strokeStyle = DIM;
    ctx.lineWidth = Math.max(1.5, boardSize * 0.005);
    ctx.stroke();

    ctx.fillStyle = SLOT_BG;
    var cr = clamp(cellSize * 0.16, 3, 10);
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var pos = cellPos(r, c);
        rrect(pos.x, pos.y, cellSize, cellSize, cr);
        ctx.fill();
      }
    }
  }

  // Draw a gem of `type` centred at (cx, cy) sized to `s` (full cell size),
  // scaled by `scale` and faded by `alpha`.
  function drawGemAt(cx, cy, type, scale, alpha) {
    var gem = GEMS[type];
    var rad = (cellSize / 2) * 0.82 * (scale == null ? 1 : scale);
    if (rad <= 0) return;
    ctx.globalAlpha = alpha == null ? 1 : alpha;

    ctx.beginPath();
    switch (gem.shape) {
      case 'circle':
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        break;
      case 'square': {
        var s = rad * 1.7, q = rad * 0.32;
        rrect(cx - s / 2, cy - s / 2, s, s, q);
        break;
      }
      case 'diamond':
        ctx.moveTo(cx, cy - rad);
        ctx.lineTo(cx + rad, cy);
        ctx.lineTo(cx, cy + rad);
        ctx.lineTo(cx - rad, cy);
        ctx.closePath();
        break;
      case 'triangle':
        ctx.moveTo(cx, cy - rad);
        ctx.lineTo(cx + rad * 0.92, cy + rad * 0.72);
        ctx.lineTo(cx - rad * 0.92, cy + rad * 0.72);
        ctx.closePath();
        break;
      case 'hex': {
        for (var h = 0; h < 6; h++) {
          var a = Math.PI / 6 + h * Math.PI / 3;
          var x = cx + rad * Math.cos(a), y = cy + rad * Math.sin(a);
          if (h === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        break;
      }
      case 'star': {
        for (var p = 0; p < 10; p++) {
          var ang = -Math.PI / 2 + p * Math.PI / 5;
          var rr = (p % 2 === 0) ? rad : rad * 0.46;
          var sx = cx + rr * Math.cos(ang), sy = cy + rr * Math.sin(ang);
          if (p === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        break;
      }
    }
    ctx.fillStyle = gem.color;
    ctx.fill();
    ctx.strokeStyle = gem.dark;
    ctx.lineWidth = Math.max(1, rad * 0.14);
    ctx.stroke();

    // glossy highlight
    ctx.beginPath();
    ctx.arc(cx - rad * 0.3, cy - rad * 0.34, rad * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  // Draw the gem occupying logical cell (r,c) — fractional rows allowed.
  function drawGemCell(r, c, type, scale, alpha) {
    var pos = cellPos(r, c);
    drawGemAt(pos.x + cellSize / 2, pos.y + cellSize / 2, type, scale, alpha);
  }

  function drawGems() {
    var i, r, c;
    if (phase === 'swap' || phase === 'swapback') {
      var p = easeOut(clamp((clock - animStart) / SWAP_DUR, 0, 1));
      var f = (phase === 'swapback') ? 1 - p : p;   // swapback runs in reverse
      // every gem except the two swapping
      for (i = 0; i < grid.length; i++) {
        if (i === swap.a || i === swap.b) continue;
        drawGemCell(rowOf(i), colOf(i), grid[i], 1, 1);
      }
      var ra = rowOf(swap.a), ca = colOf(swap.a);
      var rb = rowOf(swap.b), cb = colOf(swap.b);
      drawGemCell(ra + (rb - ra) * f, ca + (cb - ca) * f, swap.aType, 1, 1);
      drawGemCell(rb + (ra - rb) * f, cb + (ca - cb) * f, swap.bType, 1, 1);
      return;
    }

    if (phase === 'clear') {
      var cp = clamp((clock - animStart) / CLEAR_DUR, 0, 1);
      var clearMark = new Array(grid.length);
      for (i = 0; i < matchedList.length; i++) clearMark[matchedList[i]] = true;
      for (i = 0; i < grid.length; i++) {
        if (grid[i] === -1) continue;
        if (clearMark[i]) {
          // shrink + fade + a little spin-up sparkle feel
          drawGemCell(rowOf(i), colOf(i), grid[i], 1 - cp, 1 - cp);
        } else {
          drawGemCell(rowOf(i), colOf(i), grid[i], 1, 1);
        }
      }
      return;
    }

    if (phase === 'fall') {
      var fp = easeOut(clamp((clock - animStart) / FALL_DUR, 0, 1));
      for (i = 0; i < grid.length; i++) {
        if (grid[i] === -1) continue;
        var sr = (fallStart[i] == null) ? rowOf(i) : fallStart[i];
        var vr = sr + (rowOf(i) - sr) * fp;
        drawGemCell(vr, colOf(i), grid[i], 1, 1);
      }
      return;
    }

    if (phase === 'hint') {
      var hp = clamp((clock - animStart) / HINT_DUR, 0, 1);
      var hf = Math.sin(hp * Math.PI);   // 0 → 1 → 0: swap out, then back
      for (i = 0; i < grid.length; i++) {
        if (i === hint.a || i === hint.b) continue;
        drawGemCell(rowOf(i), colOf(i), grid[i], 1, 1);
      }
      var hra = rowOf(hint.a), hca = colOf(hint.a);
      var hrb = rowOf(hint.b), hcb = colOf(hint.b);
      drawGemCell(hra + (hrb - hra) * hf, hca + (hcb - hca) * hf, hint.aType, 1, 1);
      drawGemCell(hrb + (hra - hrb) * hf, hcb + (hca - hcb) * hf, hint.bType, 1, 1);
      return;
    }

    // idle
    for (i = 0; i < grid.length; i++) {
      if (grid[i] === -1) continue;
      var sc = 1;
      if (i === selected) {
        sc = 1 + 0.08 * Math.abs(Math.sin(clock * 5));
        // selection ring
        var pos = cellPos(rowOf(i), colOf(i));
        ctx.strokeStyle = FG;
        ctx.lineWidth = Math.max(2, cellSize * 0.06);
        rrect(pos.x + 1, pos.y + 1, cellSize - 2, cellSize - 2, cellSize * 0.16);
        ctx.stroke();
      }
      drawGemCell(rowOf(i), colOf(i), grid[i], sc, 1);
    }
  }

  function drawButton(b, label, enabled) {
    ctx.globalAlpha = enabled ? 1 : 0.38;
    ctx.lineWidth   = 1.5;
    ctx.strokeStyle = FG;
    ctx.fillStyle   = 'rgba(0,0,0,0.4)';
    rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.28);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle    = FG;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + (b.h * 0.4).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h * 0.54);
    ctx.globalAlpha = 1;
  }

  function drawScoreBox(b, label, value, fs) {
    ctx.fillStyle   = GRID_BG;
    ctx.strokeStyle = DIM;
    ctx.lineWidth   = 1;
    rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.22);
    ctx.fill(); ctx.stroke();

    var labelFs = clamp(fs * 0.55, 8, 13);
    var valFs   = clamp(fs * 0.9,  10, 20);

    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.font = 'bold ' + labelFs.toFixed(0) + 'px "Courier New", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h * 0.1);
    ctx.fillStyle = INK;
    ctx.font = 'bold ' + valFs.toFixed(0) + 'px "Courier New", monospace';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(value), b.x + b.w / 2, b.y + b.h * 0.92);
  }

  function drawRobotBtn(ic) {
    var cx = ic.x + ic.w / 2, cy = ic.y + ic.h / 2;
    var s  = Math.min(ic.w, ic.h) * 0.36;
    ctx.globalAlpha = aiEnabled ? 1 : 0.72;
    ctx.lineWidth   = aiEnabled ? 2 : 1.5;
    ctx.strokeStyle = FG;
    ctx.fillStyle   = aiEnabled ? 'rgba(77,255,136,0.12)' : 'rgba(0,0,0,0.4)';
    rrect(ic.x, ic.y, ic.w, ic.h, Math.min(ic.w, ic.h) * 0.28);
    ctx.fill(); ctx.stroke();
    // Antenna
    ctx.lineWidth   = Math.max(1.2, s * 0.14);
    ctx.strokeStyle = FG;
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.54); ctx.lineTo(cx, cy - s * 1.04); ctx.stroke();
    ctx.fillStyle = FG;
    ctx.beginPath(); ctx.arc(cx, cy - s * 1.18, Math.max(1.2, s * 0.14), 0, Math.PI * 2); ctx.fill();
    // Head
    var hw = s * 1.4, hh = s * 1.18;
    ctx.fillStyle   = aiEnabled ? FG : 'rgba(255,255,255,0.04)';
    rrect(cx - hw / 2, cy - s * 0.54, hw, hh, s * 0.28); ctx.fill();
    ctx.strokeStyle = FG; ctx.stroke();
    // Eyes + mouth
    var face = aiEnabled ? GRID_BG : FG;
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.arc(cx - s * 0.36, cy + s * 0.06, s * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + s * 0.36, cy + s * 0.06, s * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = face; ctx.lineWidth = Math.max(1, s * 0.13);
    ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy + s * 0.5); ctx.lineTo(cx + s * 0.3, cy + s * 0.5); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawChrome(cl) {
    drawButton(cl.finish, 'FINISH', true);
    drawButton(cl.newBtn, 'NEW', true);
    drawButton(cl.hintBtn, 'HINT', phase === 'idle');
    drawScoreBox(cl.scoreBox, 'SCORE', score, cl.fs);
    drawScoreBox(cl.bestBox,  'BEST',  bestScore, cl.fs);
    drawRobotBtn(cl.robot);
  }

  // Combo banner during a multi-step cascade.
  function drawCombo() {
    if (comboShown < 2) return;
    if (phase !== 'clear' && phase !== 'fall') return;
    var cx = boardLeft + boardSize / 2;
    var cy = boardTop + boardSize / 2;
    var u  = boardSize;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffcf4d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + (u * 0.11).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('COMBO x' + comboShown, cx, cy);
    ctx.globalAlpha = 1;
  }

  // ---- main render loop ------------------------------------------------------
  var clock = 0;
  var last  = 0;

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, vw, vh);

    drawBoard();
    drawGems();
    drawCombo();
    drawChrome(chromeLayout());
  }

  function loop(t) {
    if (!last) last = t;
    var dt = Math.min((t - last) / 1000, 1 / 20);
    last = t;
    clock += dt;
    update();
    draw();
    window.requestAnimationFrame(loop);
  }

  // ---- touch / input ---------------------------------------------------------
  var anchor = null;   // { x, y, id, cell, committed }

  function inRect(px, py, b) {
    return b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }

  function tapGem(cell) {
    if (phase !== 'idle' || cell < 0) return;
    if (selected >= 0 && adjacent(selected, cell)) {
      initiateSwap(selected, cell);
    } else if (selected === cell) {
      selected = -1;
    } else {
      selected = cell;
    }
  }

  function dragSwap(cell, dx, dy) {
    if (phase !== 'idle' || cell < 0) return;
    var r = rowOf(cell), c = colOf(cell), nr = r, nc = c;
    if (Math.abs(dx) >= Math.abs(dy)) nc += dx > 0 ? 1 : -1;
    else nr += dy > 0 ? 1 : -1;
    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return;
    initiateSwap(cell, idx(nr, nc));
  }

  // ---- init ------------------------------------------------------------------
  NG.ready(function () {
    canvas = document.getElementById('game');
    ctx    = canvas.getContext('2d');

    try { bestScore = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { bestScore = 0; }

    NG.onResize(layout);
    newGame();

    NG.createTouch(canvas, {
      onDown: function (pt) {
        if (anchor) return;
        anchor = { x: pt.x, y: pt.y, id: pt.id, cell: cellFromXY(pt.x, pt.y), committed: false };
      },
      onMove: function (pt) {
        if (!anchor || anchor.id !== pt.id || anchor.committed) return;
        var dx = pt.x - anchor.x, dy = pt.y - anchor.y;
        if (anchor.cell >= 0 && (Math.abs(dx) >= DRAG_MIN || Math.abs(dy) >= DRAG_MIN)) {
          anchor.committed = true;
          dragSwap(anchor.cell, dx, dy);
        }
      },
      onUp: function (pt) {
        if (!anchor || anchor.id !== pt.id) return;
        if (!anchor.committed) {
          var cl = chromeLayout();
          if      (inRect(pt.x, pt.y, cl.finish))  { window.location.href = '../../index.html'; }
          else if (inRect(pt.x, pt.y, cl.newBtn))  { newGame(); }
          else if (inRect(pt.x, pt.y, cl.hintBtn)) { startHint(); }
          else if (inRect(pt.x, pt.y, cl.robot))   { aiEnabled = !aiEnabled; aiGen++; scheduleAI(); }
          else { tapGem(anchor.cell); }
        }
        anchor = null;
      },
    });

    // Desktop-dev convenience only — the game never requires a keyboard.
    window.addEventListener('keydown', function (ev) {
      if (ev.key === 'n' || ev.key === 'N') { newGame(); ev.preventDefault(); }
      else if (ev.key === 'h' || ev.key === 'H') { startHint(); ev.preventDefault(); }
      else if (ev.key === 'a' || ev.key === 'A') { aiEnabled = !aiEnabled; aiGen++; scheduleAI(); ev.preventDefault(); }
    });

    NG.onExit(function () { window.location.href = '../../index.html'; });

    window.requestAnimationFrame(loop);
  });
})();
