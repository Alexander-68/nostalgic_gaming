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
  var DIM       = '#1d5e38';
  var INK       = '#d6f7e4';
  var MUTED     = '#6b7a72';

  // Tile colours — value -> {bg, fg}
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
  var SIZE      = 4;
  var SWIPE_MIN = 20;
  var BEST_KEY  = 'ng_2048_best';
  var AI_DELAY  = 320;    // ms between autoplay moves

  // Animation timings (seconds)
  var SLIDE_DUR   = 0.10;   // tile travel time
  var MERGE_DUR   = 0.16;   // merge-result pop (starts after slide)
  var SPAWN_DUR   = 0.12;   // spawn scale-in
  // Tiles spawned after a move wait for the slide to finish before appearing
  var AFTER_SLIDE = SLIDE_DUR;

  // Snake weight matrix — keeps large tiles toward top-left corner
  var SNAKE = [15, 14, 13, 12,
                8,  9, 10, 11,
                7,  6,  5,  4,
                0,  1,  2,  3];

  // ---- game state ------------------------------------------------------------
  var board = [];
  var score = 0;
  var bestScore = 0;
  var gameState = 'playing';   // 'playing' | 'won' | 'over'
  var wonToastShown = false;
  var wonToastTimer = 0;
  var WIN_TOAST_DUR = 2.5;

  var aiEnabled = false;
  var aiGen = 0;

  // ---- visual tile system ----------------------------------------------------
  // Each tile: { id, value, r, c, fr, fc, born, type, spawnDelay }
  //   r/c       — logical destination (fractional OK — used for lerp)
  //   fr/fc     — animation start position
  //   born      — clock value when this animation began
  //   type      — 'idle' | 'slide' | 'merge-vanish' | 'merge-pop' | 'spawn'
  //   spawnDelay — extra wait before spawn animation starts (post-slide spawns)
  var visTiles   = [];
  var nextTileId = 0;
  // tileGrid[idx] = the canonical live tile at that board position (or null)
  var tileGrid   = [];

  // ---- layout (recomputed on resize) ----------------------------------------
  var vw = 0, vh = 0, drawScale = 1;
  var boardLeft = 0, boardTop = 0, boardSize = 0;
  var cellSize = 0, cellPad = 0;
  var panelMode = 'wide';

  // ---- utility ---------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function idx(r, c) { return r * SIZE + c; }
  function easeOut(t) { return t < 1 ? 1 - (1 - t) * (1 - t) : 1; }

  function mkVisTile(value, r, c, type, spawnDelay) {
    return {
      id: nextTileId++, value: value,
      r: r, c: c, fr: r, fc: c,
      born: clock, type: type,
      spawnDelay: spawnDelay || 0,
    };
  }

  // Current interpolated position of a tile (for chaining animations correctly)
  function tileCurPos(tile) {
    if (tile.type === 'idle') return { r: tile.r, c: tile.c };
    var t = easeOut(Math.min((clock - tile.born) / SLIDE_DUR, 1));
    return { r: tile.fr + (tile.r - tile.fr) * t, c: tile.fc + (tile.c - tile.fc) * t };
  }

  // ---- board helpers ---------------------------------------------------------
  function emptyBoard() {
    board = []; visTiles = []; tileGrid = [];
    for (var i = 0; i < SIZE * SIZE; i++) { board.push(0); tileGrid.push(null); }
  }

  function emptyCells() {
    var out = [];
    for (var i = 0; i < board.length; i++) if (board[i] === 0) out.push(i);
    return out;
  }

  function spawnTile(spawnDelay) {
    var empty = emptyCells();
    if (!empty.length) return;
    var pos = empty[(Math.random() * empty.length) | 0];
    board[pos] = Math.random() < 0.9 ? 2 : 4;
    var r = (pos / SIZE) | 0, c = pos % SIZE;
    var tile = mkVisTile(board[pos], r, c, 'spawn', spawnDelay || 0);
    visTiles.push(tile);
    tileGrid[pos] = tile;
  }

  // ---- slide logic -----------------------------------------------------------
  // Slides one row/column (array of flat indices into board[]) toward index 0.
  // Updates board[], visTiles, tileGrid. Returns true if anything changed.
  function slideRowTracked(indices) {
    var entries = [], i, k;
    for (i = 0; i < indices.length; i++) {
      if (board[indices[i]] !== 0) entries.push({ v: board[indices[i]], fi: indices[i] });
    }

    var changed = false, outCount = 0;
    k = 0;
    while (k < entries.length) {
      var dstI = indices[outCount];
      var dr = (dstI / SIZE) | 0, dc = dstI % SIZE;

      if (k + 1 < entries.length && entries[k].v === entries[k + 1].v) {
        // ---- MERGE ---------------------------------------------------------
        var newVal = entries[k].v * 2;
        score += newVal;
        if (score > bestScore) {
          bestScore = score;
          try { localStorage.setItem(BEST_KEY, bestScore); } catch (e) {}
        }
        if (newVal === 2048 && !wonToastShown) {
          gameState = 'won'; wonToastShown = true; wonToastTimer = WIN_TOAST_DUR;
        }

        // Both source tiles animate toward dstI then vanish
        var fiA = entries[k].fi, fiB = entries[k + 1].fi;
        [fiA, fiB].forEach(function (fi) {
          var t = tileGrid[fi];
          if (t) {
            var cp = tileCurPos(t);
            t.fr = cp.r; t.fc = cp.c;
            t.r = dr; t.c = dc;
            t.born = clock; t.type = 'merge-vanish';
            tileGrid[fi] = null;
          }
        });

        // Create the merged result — pops in after the slide completes
        var tM = mkVisTile(newVal, dr, dc, 'merge-pop', 0);
        visTiles.push(tM);
        tileGrid[dstI] = tM;

        board[fiA] = 0; board[fiB] = 0; board[dstI] = newVal;
        changed = true;
        outCount++; k += 2;

      } else {
        // ---- PLAIN MOVE ----------------------------------------------------
        var fi = entries[k].fi;
        if (fi !== dstI) {
          var t = tileGrid[fi];
          if (t) {
            var cp = tileCurPos(t);
            t.fr = cp.r; t.fc = cp.c;
            t.r = dr; t.c = dc;
            t.born = clock; t.type = 'slide';
            tileGrid[fi] = null;
            tileGrid[dstI] = t;
          }
          board[fi] = 0; board[dstI] = entries[k].v;
          changed = true;
        }
        outCount++; k++;
      }
    }
    return changed;
  }

  // Build index arrays for each row/col oriented so slideRowTracked always
  // moves toward index 0 (i.e., "to the left" of the array).
  function rowIndices(dir) {
    var rows = [], r, c;
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
    if (gameState === 'won' && wonToastTimer <= 0) gameState = 'playing';

    var groups = rowIndices(dir);
    var moved = false;
    for (var i = 0; i < groups.length; i++) {
      if (slideRowTracked(groups[i])) moved = true;
    }
    if (moved) {
      aiGen++;
      spawnTile(AFTER_SLIDE);   // new tile appears after slide finishes
      if (!hasMoves()) {
        gameState = 'over';
        NG.setPlaying(false);
      } else {
        NG.setPlaying(true);
        scheduleAI();
      }
    }
    return moved;
  }

  function hasMoves() {
    for (var i = 0; i < board.length; i++) {
      if (board[i] === 0) return true;
    }
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = board[idx(r, c)];
        if (c + 1 < SIZE && board[idx(r, c + 1)] === v) return true;
        if (r + 1 < SIZE && board[idx(r + 1, c)] === v) return true;
      }
    }
    return false;
  }

  // ---- AI (autoplay) ---------------------------------------------------------
  // Pure slide on an arbitrary board array — no global side-effects.
  function simulateSlide(b, dir) {
    var groups = rowIndices(dir), moved = false, i, k, j;
    for (i = 0; i < groups.length; i++) {
      var indices = groups[i];
      var vals = indices.map(function (gi) { return b[gi]; });
      var merged = [false, false, false, false];
      var packed = vals.filter(function (v) { return v !== 0; });
      for (k = 0; k < packed.length - 1; k++) {
        if (!merged[k] && packed[k] === packed[k + 1]) {
          packed[k] *= 2; packed.splice(k + 1, 1); merged[k] = true;
        }
      }
      while (packed.length < SIZE) packed.push(0);
      for (j = 0; j < SIZE; j++) {
        if (b[indices[j]] !== packed[j]) { moved = true; b[indices[j]] = packed[j]; }
      }
    }
    return moved;
  }

  function aiEval(b) {
    var empty = 0, weighted = 0, i;
    for (i = 0; i < b.length; i++) {
      if (b[i] === 0) { empty++; continue; }
      weighted += SNAKE[i] * Math.log2(b[i]);
    }
    return empty * 256 + weighted;
  }

  // 2-ply expectimax: for each direction, average inner-best over all 2-spawns.
  var AI_DIRS = ['up', 'left', 'down', 'right'];
  function aiBestDir() {
    var best = null, bestVal = -Infinity, d, j, i;
    for (d = 0; d < AI_DIRS.length; d++) {
      var copy = board.slice();
      if (!simulateSlide(copy, AI_DIRS[d])) continue;
      var empty = [];
      for (i = 0; i < copy.length; i++) if (copy[i] === 0) empty.push(i);
      var total = 0, count = 0;
      if (!empty.length) {
        total = aiEval(copy); count = 1;
      } else {
        for (j = 0; j < empty.length; j++) {
          copy[empty[j]] = 2;
          var innerBest = -Infinity;
          for (var d2 = 0; d2 < AI_DIRS.length; d2++) {
            var copy2 = copy.slice();
            if (!simulateSlide(copy2, AI_DIRS[d2])) continue;
            var s2 = aiEval(copy2);
            if (s2 > innerBest) innerBest = s2;
          }
          total += innerBest === -Infinity ? aiEval(copy) : innerBest;
          copy[empty[j]] = 0; count++;
        }
      }
      var avg = total / count;
      if (avg > bestVal) { bestVal = avg; best = AI_DIRS[d]; }
    }
    return best;
  }

  function scheduleAI() {
    if (!aiEnabled || gameState !== 'playing') return;
    var gen = aiGen;
    window.setTimeout(function () {
      if (gen !== aiGen || !aiEnabled || gameState !== 'playing') return;
      var dir = aiBestDir();
      if (dir) slide(dir);
    }, AI_DELAY);
  }

  // ---- new game --------------------------------------------------------------
  function newGame() {
    emptyBoard();
    score = 0;
    gameState = 'playing';
    wonToastShown = false;
    wonToastTimer = 0;
    aiGen++;
    spawnTile(0);   // no slide preceding — appear immediately
    spawnTile(0);
    NG.setPlaying(true);
    scheduleAI();
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
    cellPad   = clamp(boardSize * 0.025, 3, 12);
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
        robot:    { x: cxL - bw / 2, y: boardTop + gap * 3 + bh * 2, w: bw, h: bh },
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
    return {
      mode: 'stacked',
      finish:   { x: mgx,             y: mgy,                 w: bw,  h: bh },
      newBtn:   { x: vw - mgx - bw,   y: mgy,                 w: bw,  h: bh },
      robot:    { x: vw / 2 - bw / 2, y: bb0 + (bbH - bh) / 2, w: bw, h: bh },
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

    // Empty cell slot backgrounds
    ctx.fillStyle = TILE_COLORS[0].bg;
    var cr = clamp(cellSize * 0.12, 4, 12);
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var pos = cellPos(r, c);
        rrect(pos.x, pos.y, cellSize, cellSize, cr);
        ctx.fill();
      }
    }
  }

  // Draw one tile at fractional (r, c) with optional scale factor
  function drawTile(r, c, value, scale) {
    var pos = cellPos(r, c);
    var tc  = tileColor(value);
    var cr  = clamp(cellSize * 0.12, 4, 12);
    scale = scale || 1;

    if (scale !== 1) {
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

    var label    = String(value);
    var fontSize = value < 100
      ? clamp(cellSize * 0.42, 12, 48)
      : value < 1000
        ? clamp(cellSize * 0.33, 10, 38)
        : clamp(cellSize * 0.26, 8, 30);
    ctx.fillStyle    = tc.fg;
    ctx.font         = 'bold ' + fontSize.toFixed(0) + 'px "Courier New", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pos.x + cellSize / 2, pos.y + cellSize / 2);

    if (scale !== 1) ctx.restore();
  }

  // Render one visual tile with its current animated state
  function drawVisTile(tile) {
    var elapsed = clock - tile.born;

    switch (tile.type) {
      case 'idle':
        drawTile(tile.r, tile.c, tile.value, 1);
        break;

      case 'slide': {
        var t = easeOut(Math.min(elapsed / SLIDE_DUR, 1));
        drawTile(
          tile.fr + (tile.r - tile.fr) * t,
          tile.fc + (tile.c - tile.fc) * t,
          tile.value, 1
        );
        if (t >= 1) tile.type = 'idle';
        break;
      }

      case 'merge-vanish': {
        // Slide into the merge target, then disappear (purged from visTiles)
        var t = easeOut(Math.min(elapsed / SLIDE_DUR, 1));
        drawTile(
          tile.fr + (tile.r - tile.fr) * t,
          tile.fc + (tile.c - tile.fc) * t,
          tile.value, 1
        );
        break;
      }

      case 'merge-pop': {
        // Wait for slide to finish, then pop with an overshoot bounce
        var popT = elapsed - SLIDE_DUR;
        if (popT < 0) break;
        var p = Math.min(popT / MERGE_DUR, 1);
        if (p >= 1) tile.type = 'idle';
        // 0 → 1.25 in first half, 1.25 → 1 in second half
        var sc = p < 0.5 ? (p / 0.5) * 1.25 : 1.25 - ((p - 0.5) / 0.5) * 0.25;
        drawTile(tile.r, tile.c, tile.value, sc);
        break;
      }

      case 'spawn': {
        var spawnT = elapsed - tile.spawnDelay;
        if (spawnT < 0) break;
        var p = Math.min(spawnT / SPAWN_DUR, 1);
        if (p >= 1) tile.type = 'idle';
        // ease-in then slight overshoot: 0 → 1.08 → 1
        var sc = p < 0.75 ? (p / 0.75) * 1.08 : 1.08 - ((p - 0.75) / 0.25) * 0.08;
        drawTile(tile.r, tile.c, tile.value, sc);
        break;
      }
    }
  }

  function drawVisTiles() {
    // Remove merge-vanish tiles once they've finished travelling
    visTiles = visTiles.filter(function (t) {
      return !(t.type === 'merge-vanish' && clock - t.born >= SLIDE_DUR);
    });

    // Two-pass: moving / idle / spawn tiles first; merge-pop result on top
    var i;
    for (i = 0; i < visTiles.length; i++) {
      if (visTiles[i].type !== 'merge-pop') drawVisTile(visTiles[i]);
    }
    for (i = 0; i < visTiles.length; i++) {
      if (visTiles[i].type === 'merge-pop') drawVisTile(visTiles[i]);
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
    drawScoreBox(cl.scoreBox, 'SCORE', score, cl.fs);
    drawScoreBox(cl.bestBox,  'BEST',  bestScore, cl.fs);
    drawRobotBtn(cl.robot);
  }

  function drawOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(boardLeft, boardTop, boardSize, boardSize);

    var cx = boardLeft + boardSize / 2;
    var cy = boardTop  + boardSize / 2;
    var u  = boardSize;

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff5d6c';
    ctx.font = 'bold ' + (u * 0.13).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('GAME OVER', cx, cy - u * 0.09);
    var pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = INK;
    ctx.font = 'bold ' + (u * 0.07).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('TAP NEW TO RESTART', cx, cy + u * 0.08);
    ctx.globalAlpha = 1;
  }

  function drawWonToast() {
    var alpha = wonToastTimer > 0.4 ? 1 : wonToastTimer / 0.4;
    var cx = boardLeft + boardSize / 2;
    var cy = boardTop  + boardSize / 2;
    var bw = boardSize * 0.88, bh = boardSize * 0.22;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = '#bf3000';
    rrect(cx - bw / 2, cy - bh / 2, bw, bh, bh * 0.18);
    ctx.fill();
    ctx.fillStyle    = INK;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + (bh * 0.38).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('YOU REACHED 2048!', cx, cy - bh * 0.12);
    ctx.font = 'bold ' + (bh * 0.26).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('KEEP GOING!', cx, cy + bh * 0.22);
    ctx.globalAlpha = 1;
  }

  // ---- main render loop ------------------------------------------------------
  var clock = 0;
  var last  = 0;

  function draw(dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, vw, vh);

    drawBoard();
    drawVisTiles();
    drawChrome(chromeLayout());

    if (gameState === 'over') {
      drawOverlay();
    } else if (gameState === 'won' && wonToastTimer > 0) {
      wonToastTimer -= dt;
      drawWonToast();
      if (wonToastTimer <= 0) { gameState = 'playing'; wonToastTimer = 0; }
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
  var swipeAnchor = null;

  function handleSwipe(dx, dy) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < SWIPE_MIN && ay < SWIPE_MIN) return;
    slide(ax >= ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }

  function inRect(px, py, b) {
    return b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
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
        if (swipeAnchor) return;
        swipeAnchor = { x: pt.x, y: pt.y, id: pt.id, committed: false };
      },
      onMove: function (pt) {
        if (!swipeAnchor || swipeAnchor.id !== pt.id || swipeAnchor.committed) return;
        var dx = pt.x - swipeAnchor.x, dy = pt.y - swipeAnchor.y;
        if (Math.abs(dx) >= SWIPE_MIN || Math.abs(dy) >= SWIPE_MIN) {
          swipeAnchor.committed = true;
          handleSwipe(dx, dy);
        }
      },
      onUp: function (pt) {
        if (!swipeAnchor || swipeAnchor.id !== pt.id) return;
        if (!swipeAnchor.committed) {
          var cl = chromeLayout();
          if      (inRect(pt.x, pt.y, cl.finish)) { window.location.href = '../../index.html'; }
          else if (inRect(pt.x, pt.y, cl.newBtn)) { newGame(); }
          else if (inRect(pt.x, pt.y, cl.robot))  { aiEnabled = !aiEnabled; aiGen++; scheduleAI(); }
          else { handleSwipe(pt.x - swipeAnchor.x, pt.y - swipeAnchor.y); }
        }
        swipeAnchor = null;
      },
    });

    window.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if      (k === 'ArrowLeft')  { slide('left');  ev.preventDefault(); }
      else if (k === 'ArrowRight') { slide('right'); ev.preventDefault(); }
      else if (k === 'ArrowUp')    { slide('up');    ev.preventDefault(); }
      else if (k === 'ArrowDown')  { slide('down');  ev.preventDefault(); }
      else if (k === 'r' || k === 'R') { newGame(); ev.preventDefault(); }
      else if (k === 'a' || k === 'A') { aiEnabled = !aiEnabled; aiGen++; scheduleAI(); ev.preventDefault(); }
    });

    NG.onExit(function () { window.location.href = '../../index.html'; });

    window.requestAnimationFrame(loop);
  });
})();
