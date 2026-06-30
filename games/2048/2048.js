/*
 * 2048 — merge-tile puzzle for the Nostalgic Gaming catalogue.
 *
 * Classic script, no ES modules — runs from file:// and HTTP alike.
 * Fixed-ratio letterbox layout (like Gomoku / Minesweeper / Sudoku):
 *   the 4×4 board is centred and maximised; chrome (score, best, NEW)
 *   occupies the leftover space — side panels in landscape, bands in portrait.
 *
 * Touch: swipe on the canvas to slide tiles. Keyboard arrow keys work too
 * (desktop-dev convenience only — the game never requires a keyboard).
 *
 * Mirrors the project's conventions: IIFE, 'use strict', NG.onResize,
 * NG.createTouch, NG.enableFinish, NG.setPlaying, requestAnimationFrame loop.
 */
(function () {
  'use strict';

  // ---- palette ---------------------------------------------------------------
  var BG        = '#0a1410';
  var GRID_BG   = '#0e1c16';
  var FG        = '#4dff88';
  var AMBER     = '#ffcf4d';
  var DIM       = '#1d5e38';
  var INK       = '#d6f7e4';
  var MUTED     = '#6b7a72';

  // Tile colours — value -> {bg, fg}
  // Ramp: muted dark green (2) → bright green (16) → amber (128) → warm orange/red (1024+)
  var TILE_COLORS = {
    0:    { bg: '#111e16', fg: MUTED },
    2:    { bg: '#1a3326', fg: INK },
    4:    { bg: '#1f4530', fg: INK },
    8:    { bg: '#236038', fg: FG },
    16:   { bg: '#2a7a44', fg: FG },
    32:   { bg: '#319a50', fg: BG },
    64:   { bg: '#c88000', fg: BG },
    128:  { bg: '#d4890a', fg: BG },
    256:  { bg: '#da9418', fg: BG },
    512:  { bg: '#e09c22', fg: BG },
    1024: { bg: '#cc5500', fg: INK },
    2048: { bg: '#bf3000', fg: INK },
  };
  function tileColor(v) {
    return TILE_COLORS[v] || { bg: '#991a00', fg: INK };
  }

  // ---- constants -------------------------------------------------------------
  var SIZE = 4;         // 4×4 grid
  var SWIPE_MIN = 20;   // px drag threshold before committing a swipe
  var BEST_KEY = 'ng_2048_best';

  // ---- game state ------------------------------------------------------------
  var board = [];       // flat 16-element array
  var score = 0;
  var bestScore = 0;
  var gameState = 'playing';   // 'playing' | 'won' | 'over'
  var wonToastShown = false;
  var wonToastTimer = 0;       // seconds remaining on the win toast
  var WIN_TOAST_DUR = 2.5;     // seconds the "You reached 2048!" toast shows

  // Tile animation: each cell may carry a transient scale for the merge pop.
  var cellAnim = [];    // parallel to board: {scale, t} or null

  // ---- layout (recomputed on resize) ----------------------------------------
  var vw = 0, vh = 0, drawScale = 1;
  var boardLeft = 0, boardTop = 0, boardSize = 0;
  var cellSize = 0, cellPad = 0;
  var panelMode = 'wide';    // 'wide' | 'stacked'

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function idx(r, c) { return r * SIZE + c; }

  // ---- board helpers ---------------------------------------------------------
  function emptyBoard() {
    board = [];
    cellAnim = [];
    for (var i = 0; i < SIZE * SIZE; i++) { board.push(0); cellAnim.push(null); }
  }

  function emptyCells() {
    var out = [];
    for (var i = 0; i < board.length; i++) if (board[i] === 0) out.push(i);
    return out;
  }

  function spawnTile() {
    var empty = emptyCells();
    if (!empty.length) return;
    var pos = empty[(Math.random() * empty.length) | 0];
    board[pos] = Math.random() < 0.9 ? 2 : 4;
    // Spawn pop animation
    cellAnim[pos] = { scale: 0, t: 0, type: 'spawn' };
  }

  // ---- slide logic -----------------------------------------------------------
  // Slides a single row/column (given as an array of indices into `board`) to the left.
  // Returns true if anything moved or merged.
  function slideRow(indices) {
    var vals = indices.map(function (i) { return board[i]; });
    var merged = [false, false, false, false];
    var changed = false;
    // Compress: remove zeros, push non-zeros left
    var packed = vals.filter(function (v) { return v !== 0; });
    // Merge adjacent equal tiles (left to right, each merges at most once)
    for (var k = 0; k < packed.length - 1; k++) {
      if (!merged[k] && packed[k] === packed[k + 1]) {
        packed[k] *= 2;
        score += packed[k];
        if (score > bestScore) {
          bestScore = score;
          try { localStorage.setItem(BEST_KEY, bestScore); } catch (e) {}
        }
        // Check win
        if (packed[k] === 2048 && !wonToastShown) {
          gameState = 'won';
          wonToastShown = true;
          wonToastTimer = WIN_TOAST_DUR;
        }
        packed.splice(k + 1, 1);
        merged[k] = true;
        // Trigger merge pop on the target cell
        var targetIdx = indices[k];
        cellAnim[targetIdx] = { scale: 1.2, t: 0, type: 'merge' };
      }
    }
    // Pad back to SIZE with zeros
    while (packed.length < SIZE) packed.push(0);
    // Write back
    for (var j = 0; j < SIZE; j++) {
      if (board[indices[j]] !== packed[j]) changed = true;
      board[indices[j]] = packed[j];
    }
    return changed;
  }

  // Build index arrays for each row/col in the slide direction, oriented so
  // slideRow always moves toward index 0 (i.e. "to the left" within the row).
  function rowIndices(dir) {
    var rows = [];
    var r, c;
    if (dir === 'left') {
      for (r = 0; r < SIZE; r++) {
        var row = [];
        for (c = 0; c < SIZE; c++) row.push(idx(r, c));
        rows.push(row);
      }
    } else if (dir === 'right') {
      for (r = 0; r < SIZE; r++) {
        var row = [];
        for (c = SIZE - 1; c >= 0; c--) row.push(idx(r, c));
        rows.push(row);
      }
    } else if (dir === 'up') {
      for (c = 0; c < SIZE; c++) {
        var col = [];
        for (r = 0; r < SIZE; r++) col.push(idx(r, c));
        rows.push(col);
      }
    } else { // down
      for (c = 0; c < SIZE; c++) {
        var col = [];
        for (r = SIZE - 1; r >= 0; r--) col.push(idx(r, c));
        rows.push(col);
      }
    }
    return rows;
  }

  function slide(dir) {
    if (gameState === 'over') return false;
    // If 'won' state: keep playing (toast was already shown), set back to playing
    if (gameState === 'won' && wonToastTimer <= 0) gameState = 'playing';

    var groups = rowIndices(dir);
    var moved = false;
    for (var i = 0; i < groups.length; i++) {
      if (slideRow(groups[i])) moved = true;
    }
    if (moved) {
      spawnTile();
      if (!hasMoves()) {
        gameState = 'over';
        NG.setPlaying(false);
      } else {
        NG.setPlaying(true);
      }
    }
    return moved;
  }

  function hasMoves() {
    for (var i = 0; i < board.length; i++) {
      if (board[i] === 0) return true;
    }
    // Check for adjacent equal pairs
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = board[idx(r, c)];
        if (c + 1 < SIZE && board[idx(r, c + 1)] === v) return true;
        if (r + 1 < SIZE && board[idx(r + 1, c)] === v) return true;
      }
    }
    return false;
  }

  // ---- new game --------------------------------------------------------------
  function newGame() {
    emptyBoard();
    score = 0;
    gameState = 'playing';
    wonToastShown = false;
    wonToastTimer = 0;
    spawnTile();
    spawnTile();
    NG.setPlaying(true);
  }

  // ---- layout ----------------------------------------------------------------
  var canvas, ctx;

  function layout(info) {
    var dpr = window.devicePixelRatio || 1;
    vw = info.width; vh = info.height;
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    drawScale = dpr;

    // The board is a square; chrome occupies the remaining space.
    var pad = clamp(Math.min(vw, vh) * 0.02, 6, 20);
    if (vw >= vh) {
      // Landscape / squarish: side panels
      panelMode = 'wide';
      var minPanel = clamp(Math.min(vw, vh) * 0.22, 100, 260);
      boardSize = Math.max(60, Math.min(vh - 2 * pad, vw - 2 * minPanel));
    } else {
      // Portrait: top/bottom bands
      panelMode = 'stacked';
      var band = clamp(vh * 0.14, 72, 180);
      boardSize = Math.max(60, Math.min(vw - 2 * pad, vh - 2 * band));
    }

    boardLeft = (vw - boardSize) / 2;
    boardTop  = (vh - boardSize) / 2;

    cellPad  = clamp(boardSize * 0.025, 3, 12);
    cellSize = (boardSize - cellPad * (SIZE + 1)) / SIZE;
  }

  // Chrome button/score rects for hit-testing and drawing
  function chromeLayout() {
    var unit = Math.min(vw, vh);
    var bw = clamp(unit * 0.18, 70, 180);
    var bh = clamp(unit * 0.055, 28, 46);
    var fs = clamp(unit * 0.032, 11, 22);

    if (panelMode === 'wide') {
      var lw = boardLeft;
      var rw = vw - (boardLeft + boardSize);
      var cy = boardTop + boardSize / 2;
      var cxL = lw / 2;
      var cxR = boardLeft + boardSize + rw / 2;
      var gap = clamp(unit * 0.025, 8, 24);
      return {
        mode: 'wide',
        finish: { x: cxL - bw / 2, y: boardTop + gap, w: bw, h: bh },
        newBtn: { x: cxL - bw / 2, y: boardTop + gap * 2 + bh, w: bw, h: bh },
        scoreBox: { x: cxR - bw / 2, y: cy - bh - gap / 2, w: bw, h: bh },
        bestBox:  { x: cxR - bw / 2, y: cy + gap / 2, w: bw, h: bh },
        fs: fs,
      };
    }
    // stacked
    var tb1 = boardTop;
    var bb0 = boardTop + boardSize;
    var mgx = clamp(vw * 0.03, 8, 24);
    var mgy = clamp(tb1 * 0.12, 6, 20);
    var sbw = clamp(vw * 0.28, 80, 170);
    return {
      mode: 'stacked',
      finish: { x: mgx, y: mgy, w: bw, h: bh },
      newBtn: { x: vw - mgx - bw, y: mgy, w: bw, h: bh },
      scoreBox: { x: vw / 2 - sbw - clamp(unit * 0.015, 4, 10), y: tb1 - bh - mgy, w: sbw, h: bh },
      bestBox:  { x: vw / 2 + clamp(unit * 0.015, 4, 10), y: tb1 - bh - mgy, w: sbw, h: bh },
      fs: fs,
    };
  }

  // Cell pixel position (top-left corner)
  function cellPos(r, c) {
    return {
      x: boardLeft + cellPad + c * (cellSize + cellPad),
      y: boardTop  + cellPad + r * (cellSize + cellPad),
    };
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
    // Board background
    var rad = clamp(boardSize * 0.025, 4, 16);
    ctx.fillStyle = GRID_BG;
    rrect(boardLeft, boardTop, boardSize, boardSize, rad);
    ctx.fill();
    ctx.strokeStyle = DIM;
    ctx.lineWidth = Math.max(1.5, boardSize * 0.005);
    ctx.stroke();
  }

  function drawTile(r, c, value, extraScale) {
    var pos = cellPos(r, c);
    var tc = tileColor(value);
    var scale = extraScale || 1;
    var cr = clamp(cellSize * 0.12, 4, 12);

    if (scale !== 1) {
      // Draw scaled around tile centre
      var cx = pos.x + cellSize / 2;
      var cy = pos.y + cellSize / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    ctx.fillStyle = tc.bg;
    rrect(pos.x, pos.y, cellSize, cellSize, cr);
    ctx.fill();

    if (value !== 0) {
      var label = String(value);
      var fontSize = value < 100
        ? clamp(cellSize * 0.42, 12, 48)
        : value < 1000
          ? clamp(cellSize * 0.33, 10, 38)
          : clamp(cellSize * 0.26, 8, 30);
      ctx.fillStyle = tc.fg;
      ctx.font = 'bold ' + fontSize.toFixed(0) + 'px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x + cellSize / 2, pos.y + cellSize / 2);
    }

    if (scale !== 1) ctx.restore();
  }

  function drawTiles(dt) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var i = idx(r, c);
        var v = board[i];
        var anim = cellAnim[i];
        var sc = 1;
        if (anim) {
          anim.t += dt;
          if (anim.type === 'spawn') {
            // Grow from 0 → 1 over 0.12 s
            var p = Math.min(anim.t / 0.12, 1);
            sc = p * p;   // ease-in quad
            if (p >= 1) cellAnim[i] = null;
          } else if (anim.type === 'merge') {
            // Pop: 1.2 → 1 over 0.15 s
            var p2 = Math.min(anim.t / 0.15, 1);
            sc = 1.2 - 0.2 * (p2 * p2);
            if (p2 >= 1) cellAnim[i] = null;
          }
        }
        drawTile(r, c, v, sc);
      }
    }
  }

  function drawButton(b, label, enabled) {
    ctx.globalAlpha = enabled ? 1 : 0.38;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = FG;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.28);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = FG;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + (b.h * 0.4).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h * 0.54);
    ctx.globalAlpha = 1;
  }

  function drawScoreBox(b, label, value, fs) {
    ctx.fillStyle = GRID_BG;
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.22);
    ctx.fill();
    ctx.stroke();

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

  function drawChrome(cl) {
    drawButton(cl.finish, 'FINISH', true);
    drawButton(cl.newBtn, 'NEW', true);
    drawScoreBox(cl.scoreBox, 'SCORE', score, cl.fs);
    drawScoreBox(cl.bestBox, 'BEST', bestScore, cl.fs);
  }

  function drawOverlay() {
    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(boardLeft, boardTop, boardSize, boardSize);

    var cx = boardLeft + boardSize / 2;
    var cy = boardTop  + boardSize / 2;
    var unit = boardSize;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (gameState === 'over') {
      ctx.fillStyle = '#ff5d6c';
      ctx.font = 'bold ' + (unit * 0.13).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('GAME OVER', cx, cy - unit * 0.09);
      var pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
      ctx.globalAlpha = pulse;
      ctx.fillStyle = INK;
      ctx.font = 'bold ' + (unit * 0.07).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP NEW TO RESTART', cx, cy + unit * 0.08);
      ctx.globalAlpha = 1;
    }
  }

  function drawWonToast() {
    // Short-lived "You reached 2048!" banner, then dismiss
    var alpha = wonToastTimer > 0.4 ? 1 : wonToastTimer / 0.4;
    var cx = boardLeft + boardSize / 2;
    var cy = boardTop  + boardSize / 2;
    var bw = boardSize * 0.88, bh = boardSize * 0.22;
    var bx = cx - bw / 2, by = cy - bh / 2;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#bf3000';
    rrect(bx, by, bw, bh, bh * 0.18);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + (bh * 0.38).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('YOU REACHED 2048!', cx, cy - bh * 0.12);
    ctx.font = 'bold ' + (bh * 0.26).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('KEEP GOING!', cx, cy + bh * 0.22);
    ctx.globalAlpha = 1;
  }

  // ---- main render loop ------------------------------------------------------
  var clock = 0;
  var last = 0;

  function draw(dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

    // Background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, vw, vh);

    drawBoard();
    drawTiles(dt);
    drawChrome(chromeLayout());

    if (gameState === 'over') {
      drawOverlay();
    } else if (gameState === 'won' && wonToastTimer > 0) {
      wonToastTimer -= dt;
      drawWonToast();
      if (wonToastTimer <= 0) {
        // Dismiss toast, resume playing
        gameState = 'playing';
        wonToastTimer = 0;
      }
    }
  }

  function loop(t) {
    if (!last) last = t;
    var dt = Math.min((t - last) / 1000, 1 / 20);
    last = t;
    clock += dt;
    draw(dt);
    window.requestAnimationFrame(loop);
  }

  // ---- touch / swipe input ---------------------------------------------------
  var swipeAnchor = null;   // { x, y, id, committed }

  function handleSwipe(dx, dy) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < SWIPE_MIN && ay < SWIPE_MIN) return;
    var dir;
    if (ax >= ay) dir = dx > 0 ? 'right' : 'left';
    else          dir = dy > 0 ? 'down'  : 'up';
    slide(dir);
  }

  function inRect(px, py, b) {
    return b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }

  // ---- init ------------------------------------------------------------------
  NG.ready(function () {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');

    // Load best score
    try { bestScore = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { bestScore = 0; }

    NG.onResize(layout);
    newGame();

    // Touch / pointer input
    NG.createTouch(canvas, {
      onDown: function (pt) {
        if (swipeAnchor) return;   // one active swipe at a time
        swipeAnchor = { x: pt.x, y: pt.y, id: pt.id, committed: false };
      },
      onMove: function (pt) {
        if (!swipeAnchor || swipeAnchor.id !== pt.id || swipeAnchor.committed) return;
        var dx = pt.x - swipeAnchor.x;
        var dy = pt.y - swipeAnchor.y;
        if (Math.abs(dx) >= SWIPE_MIN || Math.abs(dy) >= SWIPE_MIN) {
          swipeAnchor.committed = true;
          handleSwipe(dx, dy);
        }
      },
      onUp: function (pt) {
        if (!swipeAnchor || swipeAnchor.id !== pt.id) return;
        var dx = pt.x - swipeAnchor.x;
        var dy = pt.y - swipeAnchor.y;
        if (!swipeAnchor.committed) {
          // Was a tap — check chrome buttons
          var cl = chromeLayout();
          if (inRect(pt.x, pt.y, cl.finish)) {
            window.location.href = '../../index.html';
          } else if (inRect(pt.x, pt.y, cl.newBtn)) {
            newGame();
          } else {
            // Short tap on board with no drag — try it as a swipe anyway (no-op if tiny)
            handleSwipe(dx, dy);
          }
        }
        swipeAnchor = null;
      },
    });

    // Keyboard (desktop-dev convenience; game never requires it)
    window.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'ArrowLeft')  { slide('left');  ev.preventDefault(); }
      else if (k === 'ArrowRight') { slide('right'); ev.preventDefault(); }
      else if (k === 'ArrowUp')    { slide('up');    ev.preventDefault(); }
      else if (k === 'ArrowDown')  { slide('down');  ev.preventDefault(); }
      else if (k === 'r' || k === 'R') { newGame(); ev.preventDefault(); }
    });

    // ESC / BACK / HOME → catalogue
    NG.onExit(function () { window.location.href = '../../index.html'; });

    window.requestAnimationFrame(loop);
  });
})();
