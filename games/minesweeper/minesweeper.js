/*
 * Minesweeper — the catalogue's classic deduction puzzle. One player clears a
 * square minefield: reveal every safe cell without detonating a mine, using the
 * numbers (how many mines touch a cell) to reason out where the mines hide.
 *
 * Mirrors the catalogue's conventions (see games/gomoku/gomoku.js):
 *   - classic script, no modules, runs from file://
 *   - the three design ratios via NG.classify / NG.onResize. Like Gomoku this is
 *     a square N×N grid, so it uses the fixed-ratio LETTERBOX strategy: centre
 *     the largest square that fits and re-letterbox on resize, so cells stay
 *     square in 16:9, 9:8 and 9:16 alike. The field is maximised (full height in
 *     landscape); chrome lives in the leftover space — side panels in landscape,
 *     top/bottom bands in portrait.
 *   - it starts straight into a game (no menu); a difficulty chip cycles
 *     EASY / MED / HARD board sizes, NEW deals a fresh field, FINISH leaves.
 *
 * Touch-first controls (no keyboard, no right-click):
 *   - a big DIG / FLAG toggle picks what a tap does. TAP a cell to dig (or flag)
 *     it; HOLD a cell to flag it without switching modes.
 *   - TAP a revealed number whose flags already match its count to "chord" —
 *     reveal all its remaining neighbours at once (the fast way to open a field).
 * First dig is always safe: mines are dealt after it, clear of the tapped cell
 * and its neighbours, so you never lose on move one.
 *
 * The board engine (deal mines, count neighbours, flood-reveal, win-check) is
 * pure and dependency-free; it's exported under module.exports when run in Node
 * so it can be unit-tested headlessly, and simply runs the game in the browser.
 */
(function () {
  'use strict';

  // ===========================================================================
  // ENGINE — pure functions over a flat array of cells. No DOM, no globals.
  // A cell: { mine:false, count:0, revealed:false, flagged:false, rt:0 }.
  // ===========================================================================

  function makeBoard(N) {
    var b = new Array(N * N);
    for (var i = 0; i < N * N; i++) b[i] = { mine: false, count: 0, revealed: false, flagged: false, rt: 0 };
    return b;
  }

  function inBounds(x, y, N) { return x >= 0 && x < N && y >= 0 && y < N; }

  // The (up to 8) neighbour coordinates of a cell.
  function neighborsOf(x, y, N) {
    var out = [];
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny, N)) out.push([nx, ny]);
      }
    }
    return out;
  }

  // Fill `count` on every cell from the mines already placed.
  function computeCounts(board, N) {
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var c = board[y * N + x];
        if (c.mine) { c.count = 0; continue; }
        var nb = neighborsOf(x, y, N), n = 0;
        for (var i = 0; i < nb.length; i++) if (board[nb[i][1] * N + nb[i][0]].mine) n++;
        c.count = n;
      }
    }
  }

  // Deal `mineCount` mines, keeping the first-dig cell (sx,sy) AND its neighbours
  // clear, so the opening reveal always floods a region. `rng` defaults to
  // Math.random; pass one for deterministic tests. Mutates `board`.
  function placeMines(board, N, mineCount, sx, sy, rng) {
    rng = rng || Math.random;
    var safe = Object.create(null);
    safe[sx + ',' + sy] = true;
    var nb = neighborsOf(sx, sy, N);
    for (var i = 0; i < nb.length; i++) safe[nb[i][0] + ',' + nb[i][1]] = true;

    var spots = [];
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        if (!safe[x + ',' + y]) spots.push(y * N + x);
      }
    }
    mineCount = Math.min(mineCount, spots.length);
    // Partial Fisher–Yates: pick the first `mineCount` of a shuffle.
    for (var k = 0; k < mineCount; k++) {
      var j = k + ((rng() * (spots.length - k)) | 0);
      var tmp = spots[k]; spots[k] = spots[j]; spots[j] = tmp;
      board[spots[k]].mine = true;
    }
    computeCounts(board, N);
    return board;
  }

  // Reveal (x,y); if it's a 0 it floods outward across all connected 0s and the
  // numbered cells bordering them. Stops at flagged cells. `stamp` (optional) is
  // written to each newly-revealed cell's `rt` for the pop animation. Mutates.
  function floodReveal(board, N, x, y, stamp) {
    stamp = stamp || 0;
    var stack = [[x, y]];
    while (stack.length) {
      var p = stack.pop(), cx = p[0], cy = p[1], c = board[cy * N + cx];
      if (c.revealed || c.flagged) continue;
      c.revealed = true;
      c.rt = stamp;
      if (c.count === 0 && !c.mine) {
        var nb = neighborsOf(cx, cy, N);
        for (var i = 0; i < nb.length; i++) {
          var nc = board[nb[i][1] * N + nb[i][0]];
          if (!nc.revealed && !nc.flagged) stack.push(nb[i]);
        }
      }
    }
  }

  // Won when every non-mine cell is revealed.
  function checkWin(board, N) {
    for (var i = 0; i < N * N; i++) {
      var c = board[i];
      if (!c.mine && !c.revealed) return false;
    }
    return true;
  }

  function countFlags(board) {
    var n = 0;
    for (var i = 0; i < board.length; i++) if (board[i].flagged) n++;
    return n;
  }

  var ENGINE = {
    makeBoard: makeBoard, neighborsOf: neighborsOf, computeCounts: computeCounts,
    placeMines: placeMines, floodReveal: floodReveal, checkWin: checkWin,
    countFlags: countFlags, inBounds: inBounds,
  };

  // Headless test hook: under Node, export the engine and DON'T touch the DOM.
  // In the browser there is no `module`, so we boot the game instead.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ENGINE;
    return;
  }

  // ===========================================================================
  // GAME — state, layout, input and rendering. Browser only.
  // ===========================================================================

  // ---- palette (matches the catalogue's phosphor look) ----------------------
  var FG = '#4dff88';     // phosphor green — primary
  var DIM = '#1d5e38';    // borders / ambient
  var INK = '#d6f7e4';    // neutral text
  var MUTED = '#6b7a72';  // secondary text
  var FLAG = '#ff5d6c';   // flag red
  var AMBER = '#ffcf4d';  // "new best" accent
  var PANEL = '#0a1410';  // field backing
  var RAISED = '#22633c'; // unrevealed cell face (kept bright so it reads clearly)
  var RAISED_PRESS = '#2e7d4d'; // unrevealed cell while held under a finger
  var SUNK = '#08120b';   // revealed cell face
  // Classic 1..8 number colours, tuned to read on the dark field.
  var NUMCOL = [null, '#5b8cff', '#4dff88', '#ff5d6c', '#b46bff', '#ffcf4d', '#36dcff', '#ff9f43', '#d6f7e4'];

  var DIFFS = [
    { key: 'EASY', n: 9, mines: 10 },
    { key: 'MED', n: 13, mines: 28 },
    { key: 'HARD', n: 16, mines: 51 },
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- layout (recomputed on every resize / orientation change) ----------
    var vw = 0, vh = 0, drawScale = 1, lastInfo = null;
    var S = 0, cs = 0;                        // field side, cell size
    var boardLeft = 0, boardTop = 0;          // top-left of the square field
    var panelMode = 'wide';                   // 'wide' (side panels) | 'stacked' (bands)
    var SWIPE_THRESH = 14;
    var LONGPRESS = 380;                      // ms hold to flag

    // ---- game state --------------------------------------------------------
    var diffIdx = 0;
    var N = DIFFS[0].n, mineCount = DIFFS[0].mines;
    var board = makeBoard(N);
    var state = 'play';                       // 'play' | 'won' | 'lost'
    var started = false;                      // mines dealt yet?
    var mode = 'dig';                         // 'dig' | 'flag'
    var flags = 0;
    var startClock = 0, finalTime = 0;
    var explode = null;                       // {x,y} the detonated mine
    var clock = 0;                            // wall clock for animation / timer
    var anchors = Object.create(null);        // pointer id -> gesture state
    var pressCell = null;                     // {x,y} cell under a finger, for feedback
    var winStats = null;                      // {best, isNew} — set on win, per difficulty

    function at(x, y) { return board[y * N + x]; }

    // ---- layout ------------------------------------------------------------
    // The field square is maximised; whatever's left over hosts the chrome.
    //   landscape (incl. squarish): side panels left & right.
    //   portrait:                   top & bottom bands.
    function layout(info) {
      lastInfo = info;
      var dpr = window.devicePixelRatio || 1;
      vw = info.width; vh = info.height;
      canvas.style.width = vw + 'px';
      canvas.style.height = vh + 'px';
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      drawScale = dpr;

      var padB = clamp(Math.min(vw, vh) * 0.02, 6, 22);
      if (vw >= vh) {
        panelMode = 'wide';
        var minPanel = clamp(Math.min(vw, vh) * 0.2, 104, 260);  // room a side panel needs
        S = Math.max(60, Math.min(vh - 2 * padB, vw - 2 * minPanel));
      } else {
        panelMode = 'stacked';
        var band = clamp(vh * 0.15, 78, 180);                     // room a top/bottom band needs
        S = Math.max(60, Math.min(vw - 2 * padB, vh - 2 * band));
      }
      boardLeft = (vw - S) / 2;
      boardTop = (vh - S) / 2;
      cs = S / N;
      SWIPE_THRESH = Math.max(10, cs * 0.4);
    }
    function relayout() { if (lastInfo) layout(lastInfo); }

    function cellRect(x, y) {
      var inset = cs * 0.06;
      return { x: boardLeft + x * cs + inset, y: boardTop + y * cs + inset, s: cs - inset * 2 };
    }
    function cellCenter(x, y) { return { x: boardLeft + (x + 0.5) * cs, y: boardTop + (y + 0.5) * cs }; }

    // Pixel -> cell, or null if the point is off the field.
    function cellAt(px, py) {
      if (px < boardLeft || px > boardLeft + S || py < boardTop || py > boardTop + S) return null;
      var x = Math.floor((px - boardLeft) / cs);
      var y = Math.floor((py - boardTop) / cs);
      if (x < 0 || x >= N || y < 0 || y >= N) return null;
      return { x: x, y: y };
    }

    // ---- chrome layout -----------------------------------------------------
    // Rectangles for FINISH / NEW, the DIG/FLAG toggle, the difficulty chip and
    // the mine + timer readouts, placed in the space around the field. `help` is
    // a text anchor. Two arrangements: side panels (wide) or top/bottom bands.
    function chromeLayout() {
      var unit = Math.min(vw, vh);
      if (panelMode === 'wide') {
        var lw = boardLeft, rw = vw - (boardLeft + S);
        var cxL = lw / 2, cxR = boardLeft + S + rw / 2;
        var gap = clamp(unit * 0.028, 8, 22);
        var bw = clamp(Math.min(lw, rw) * 0.78, 76, 210);
        var bh = clamp(unit * 0.06, 30, 50);
        var lx = cxL - bw / 2, rx = cxR - bw / 2;

        // LEFT panel, top-down: FINISH, mine readout, timer readout, difficulty.
        var finish = { x: lx, y: boardTop + gap, w: bw, h: bh };
        var mines = { x: lx, y: finish.y + bh + gap * 1.4, w: bw, h: bh };
        var timer = { x: lx, y: mines.y + bh + gap, w: bw, h: bh };
        var diff = { x: lx, y: timer.y + bh + gap, w: bw, h: bh };

        // RIGHT panel: big mode toggle centred, NEW above it, help below.
        var tw = clamp(Math.min(rw * 0.84, unit * 0.42), 96, 250);
        var th = clamp(unit * 0.17, 74, 156);
        var modeR = { x: cxR - tw / 2, y: boardTop + S * 0.5 - th / 2, w: tw, h: th };
        var newBtn = { x: rx, y: modeR.y - bh - gap * 1.4, w: bw, h: bh };
        var help = { x: cxR, y: boardTop + S - gap, align: 'center', baseline: 'bottom' };
        return { mode: 'wide', finish: finish, newBtn: newBtn, toggle: modeR, diff: diff, mines: mines, timer: timer, help: help };
      }

      // stacked: top band carries FINISH | mines · timer | NEW; bottom band the
      // big toggle with the difficulty chip beside it and help underneath.
      var tb1 = boardTop, bb0 = boardTop + S;
      var mgx = clamp(vw * 0.035, 8, 28);
      var gapS = clamp(unit * 0.02, 6, 16);
      var bhT = clamp(tb1 * 0.4, 28, 56);
      var bwT = clamp(vw * 0.22, 60, 150);
      var topCy = tb1 * 0.5;
      var finishS = { x: mgx, y: topCy - bhT / 2, w: bwT, h: bhT };
      var newS = { x: vw - mgx - bwT, y: topCy - bhT / 2, w: bwT, h: bhT };
      var rdW = clamp((vw - 2 * (bwT + 2 * mgx)) / 2 - gapS, 48, 120);
      var groupX = vw / 2 - (rdW * 2 + gapS) / 2;
      var minesS = { x: groupX, y: topCy - bhT / 2, w: rdW, h: bhT };
      var timerS = { x: groupX + rdW + gapS, y: topCy - bhT / 2, w: rdW, h: bhT };

      var bandH = vh - bb0;
      var th2 = clamp(bandH * 0.62, 50, 130);
      var tw2 = clamp(vw * 0.42, 120, 300);
      var botCy = bb0 + bandH * 0.46;
      var toggleS = { x: vw / 2 - tw2 / 2, y: botCy - th2 / 2, w: tw2, h: th2 };
      var dchipW = clamp(vw * 0.22, 70, 160), dchipH = clamp(th2 * 0.46, 30, 54);
      var diffS = { x: clamp(toggleS.x - dchipW - gapS * 1.5, mgx, vw), y: botCy - dchipH / 2, w: dchipW, h: dchipH };
      if (diffS.x + diffS.w > toggleS.x) {            // narrow screen: tuck the chip under the toggle
        diffS = { x: vw / 2 - dchipW / 2, y: toggleS.y + th2 + gapS * 0.6, w: dchipW, h: dchipH };
      }
      var helpS = { x: vw / 2, y: vh - gapS, align: 'center', baseline: 'bottom' };
      return { mode: 'stacked', finish: finishS, newBtn: newS, toggle: toggleS, diff: diffS, mines: minesS, timer: timerS, help: helpS };
    }

    // ---- flow --------------------------------------------------------------
    function newGame() {
      var d = DIFFS[diffIdx];
      N = d.n; mineCount = d.mines;
      board = makeBoard(N);
      state = 'play'; started = false; flags = 0;
      startClock = 0; finalTime = 0; explode = null; pressCell = null; winStats = null;
      relayout();                                     // cell size depends on N
    }
    function cycleDiff() { diffIdx = (diffIdx + 1) % DIFFS.length; newGame(); }
    function toggleMode() { mode = mode === 'dig' ? 'flag' : 'dig'; }
    function finishToCatalogue() { window.location.href = '../../index.html'; }

    function elapsed() {
      if (!started) return 0;
      if (state !== 'play') return finalTime;
      return Math.min(999, Math.floor(clock - startClock));
    }

    function toggleFlag(x, y) {
      if (state !== 'play') return;
      var c = at(x, y);
      if (c.revealed) return;
      c.flagged = !c.flagged;
      flags += c.flagged ? 1 : -1;
    }

    function dig(x, y) {
      if (state !== 'play') return;
      var c = at(x, y);
      if (c.revealed || c.flagged) return;
      if (!started) {
        placeMines(board, N, mineCount, x, y);
        started = true;
        startClock = clock;
      }
      if (c.mine) { c.revealed = true; c.rt = clock; explode = { x: x, y: y }; lose(); return; }
      floodReveal(board, N, x, y, clock);
      if (checkWin(board, N)) win();
    }

    // Chord: tap a revealed number whose neighbouring flags already equal its
    // count to dig every other neighbour at once. A wrong flag detonates a mine.
    function chord(x, y) {
      if (state !== 'play') return;
      var c = at(x, y);
      if (!c.revealed || c.count === 0) return;
      var nb = neighborsOf(x, y, N), f = 0, i;
      for (i = 0; i < nb.length; i++) if (at(nb[i][0], nb[i][1]).flagged) f++;
      if (f !== c.count) return;
      for (i = 0; i < nb.length && state === 'play'; i++) {
        var nc = at(nb[i][0], nb[i][1]);
        if (!nc.flagged && !nc.revealed) dig(nb[i][0], nb[i][1]);
      }
    }

    function lose() {
      state = 'lost';
      finalTime = Math.min(999, Math.floor(clock - startClock));
      for (var i = 0; i < N * N; i++) {            // expose every mine
        if (board[i].mine && !board[i].revealed) { board[i].revealed = true; board[i].rt = clock; }
      }
    }

    function win() {
      state = 'won';
      finalTime = Math.min(999, Math.floor(clock - startClock));
      for (var i = 0; i < N * N; i++) {            // auto-flag the mines we found
        if (board[i].mine && !board[i].flagged) { board[i].flagged = true; }
      }
      flags = mineCount;
      winStats = NG.bestTime('ng_minesweeper_best_' + DIFFS[diffIdx].key.toLowerCase(), finalTime);
    }

    // ---- input -------------------------------------------------------------
    function inRect(x, y, b) { return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

    // A tap that landed on the field (not on chrome) during play.
    function fieldTap(x, y) {
      var c = at(x, y);
      if (c.revealed) { chord(x, y); return; }
      if (mode === 'flag') { toggleFlag(x, y); return; }
      if (c.flagged) { toggleFlag(x, y); return; }    // dig-mode tap on a flag un-flags it
      dig(x, y);
    }

    NG.createTouch(canvas, {
      onDown: function (pt) {
        var cell = cellAt(pt.x, pt.y);
        var a = { sx: pt.x, sy: pt.y, moved: false, handled: false, cell: cell, lp: 0 };
        anchors[pt.id] = a;
        if (cell && state === 'play' && !at(cell.x, cell.y).revealed) {
          pressCell = cell;
          // Hold-to-flag: an unrevealed cell held still becomes (un)flagged.
          a.lp = window.setTimeout(function () {
            if (a.handled || a.moved) return;
            a.handled = true;
            pressCell = null;
            toggleFlag(cell.x, cell.y);
          }, LONGPRESS);
        }
      },
      onMove: function (pt) {
        var a = anchors[pt.id];
        if (!a || a.handled) return;
        if (!a.moved && (Math.abs(pt.x - a.sx) >= SWIPE_THRESH || Math.abs(pt.y - a.sy) >= SWIPE_THRESH)) {
          a.moved = true;
          if (a.lp) { window.clearTimeout(a.lp); a.lp = 0; }
          if (pressCell && a.cell && pressCell.x === a.cell.x && pressCell.y === a.cell.y) pressCell = null;
        }
      },
      onUp: function (pt) {
        var a = anchors[pt.id];
        delete anchors[pt.id];
        if (!a) return;
        if (a.lp) { window.clearTimeout(a.lp); a.lp = 0; }
        if (pressCell && a.cell && pressCell.x === a.cell.x && pressCell.y === a.cell.y) pressCell = null;
        if (a.handled || a.moved) return;                 // long-pressed or dragged: no tap

        var cl = chromeLayout();
        if (inRect(pt.x, pt.y, cl.finish)) { finishToCatalogue(); return; }
        if (inRect(pt.x, pt.y, cl.newBtn)) { newGame(); return; }
        if (inRect(pt.x, pt.y, cl.toggle)) { toggleMode(); return; }
        if (inRect(pt.x, pt.y, cl.diff)) { cycleDiff(); return; }
        if (state !== 'play') {                            // any tap on a finished field re-deals
          if (a.cell) newGame();
          return;
        }
        if (a.cell) fieldTap(a.cell.x, a.cell.y);
      },
    });

    // Mouse: right-click flags the cell under the cursor — the classic desktop
    // mapping. A desktop convenience; touch uses the DIG/FLAG toggle + hold.
    // (The shared touch helper ignores non-primary mouse buttons, so the
    // right-click never also registers as a dig.)
    canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    canvas.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType !== 'mouse' || ev.button !== 2) return;
      ev.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var c = cellAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (c && state === 'play') toggleFlag(c.x, c.y);
    });

    // Keyboard: desktop-development convenience only (never required).
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === 'f') { toggleMode(); ev.preventDefault(); return; }
      if (k === 'n' || k === 'r') { newGame(); ev.preventDefault(); return; }
      if (k === 'd') { cycleDiff(); ev.preventDefault(); }
    });

    // ESC / BACK / HOME (kiosk hardware + remotes) also leave for the catalogue.
    NG.onExit(finishToCatalogue);

    // ---- drawing helpers ---------------------------------------------------
    function rrect(px, py, w, h, rad) {
      rad = Math.min(rad, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(px + rad, py);
      ctx.arcTo(px + w, py, px + w, py + h, rad);
      ctx.arcTo(px + w, py + h, px, py + h, rad);
      ctx.arcTo(px, py + h, px, py, rad);
      ctx.arcTo(px, py, px + w, py, rad);
      ctx.closePath();
    }
    function pop(rt) {                                  // easeOutQuad pop since reveal
      var age = (clock - rt) / 0.12, p = age >= 1 ? 1 : age < 0 ? 0 : age;
      return 1 - (1 - p) * (1 - p);
    }

    // ---- field + cells -----------------------------------------------------
    function drawField() {
      ctx.shadowBlur = 0;
      ctx.fillStyle = PANEL;
      rrect(boardLeft, boardTop, S, S, cs * 0.25);
      ctx.fill();

      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) drawCell(x, y);
      }

      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.strokeStyle = DIM;
      rrect(boardLeft, boardTop, S, S, cs * 0.25);
      ctx.stroke();
    }

    function drawCell(x, y) {
      var c = at(x, y), R = cellRect(x, y), rad = R.s * 0.16;
      var pressed = pressCell && pressCell.x === x && pressCell.y === y;

      if (!c.revealed) {
        // Raised face with a soft top-left highlight and bottom-right shade.
        ctx.fillStyle = pressed ? RAISED_PRESS : RAISED;
        rrect(R.x, R.y, R.s, R.s, rad); ctx.fill();
        ctx.lineWidth = Math.max(1, R.s * 0.07);
        ctx.strokeStyle = 'rgba(150,255,195,0.28)';
        ctx.beginPath();
        ctx.moveTo(R.x + rad, R.y + R.s * 0.06);
        ctx.lineTo(R.x + R.s - rad, R.y + R.s * 0.06);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.moveTo(R.x + R.s * 0.94, R.y + rad);
        ctx.lineTo(R.x + R.s * 0.94, R.y + R.s - rad);
        ctx.stroke();
        if (c.flagged) drawFlag(R, x, y);
        return;
      }

      // Revealed: recessed face. Mines and numbers pop in.
      var sc = pop(c.rt);
      ctx.fillStyle = (explode && explode.x === x && explode.y === y) ? 'rgba(255,93,108,0.35)' : SUNK;
      rrect(R.x, R.y, R.s, R.s, rad); ctx.fill();
      ctx.lineWidth = Math.max(1, R.s * 0.04);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      rrect(R.x, R.y, R.s, R.s, rad); ctx.stroke();

      if (c.mine) { drawMine(R, sc, explode && explode.x === x && explode.y === y); return; }
      if (c.flagged && !c.mine && state === 'lost') { drawFlag(R, x, y); drawCross(R); return; } // wrong flag
      if (c.count > 0) {
        ctx.globalAlpha = sc;
        ctx.fillStyle = NUMCOL[c.count];
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + (R.s * 0.66).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText(String(c.count), R.x + R.s / 2, R.y + R.s * 0.56);
        ctx.globalAlpha = 1;
      }
    }

    function drawFlag(R, x, y) {
      var cx = R.x + R.s * 0.5, base = R.y + R.s * 0.78, top = R.y + R.s * 0.22;
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.5, R.s * 0.07); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - R.s * 0.16, base); ctx.lineTo(cx + R.s * 0.16, base); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - R.s * 0.06, base); ctx.lineTo(cx - R.s * 0.06, top); ctx.stroke();
      ctx.fillStyle = FLAG;
      ctx.beginPath();
      ctx.moveTo(cx - R.s * 0.06, top);
      ctx.lineTo(cx + R.s * 0.28, top + R.s * 0.13);
      ctx.lineTo(cx - R.s * 0.06, top + R.s * 0.26);
      ctx.closePath(); ctx.fill();
      ctx.lineCap = 'butt';
    }

    function drawMine(R, sc, hot) {
      var cx = R.x + R.s * 0.5, cy = R.y + R.s * 0.5, r = R.s * 0.26 * (0.4 + 0.6 * sc);
      ctx.fillStyle = hot ? FLAG : INK;
      ctx.strokeStyle = hot ? FLAG : INK;
      ctx.lineWidth = Math.max(1.5, R.s * 0.08); ctx.lineCap = 'round';
      for (var i = 0; i < 8; i++) {                    // spikes
        var a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r * 1.7, cy + Math.sin(a) * r * 1.7);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';         // glint
      ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'butt';
    }

    function drawCross(R) {
      ctx.strokeStyle = FLAG; ctx.lineWidth = Math.max(2, R.s * 0.09); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(R.x + R.s * 0.2, R.y + R.s * 0.2); ctx.lineTo(R.x + R.s * 0.8, R.y + R.s * 0.8);
      ctx.moveTo(R.x + R.s * 0.8, R.y + R.s * 0.2); ctx.lineTo(R.x + R.s * 0.2, R.y + R.s * 0.8);
      ctx.stroke(); ctx.lineCap = 'butt';
    }

    // ---- chrome ------------------------------------------------------------
    function drawButton(b, label, accent, active) {
      var col = accent || FG;
      ctx.lineWidth = active ? 3 : 1.5;
      ctx.strokeStyle = col;
      ctx.fillStyle = active ? 'rgba(77,255,136,0.1)' : 'rgba(0,0,0,0.4)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.26);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + Math.min(b.h * 0.42, b.w * 0.3).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h * 0.54);
    }

    // The big DIG / FLAG toggle: the active half is lit; tap to flip.
    function drawToggle(b) {
      ctx.lineWidth = 2; ctx.strokeStyle = FG;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.18);
      ctx.fill(); ctx.stroke();
      var halfH = b.h / 2;
      var digOn = mode === 'dig';
      // active half highlight
      ctx.save();
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.18); ctx.clip();
      ctx.fillStyle = digOn ? 'rgba(77,255,136,0.16)' : 'rgba(255,93,108,0.16)';
      ctx.fillRect(b.x, digOn ? b.y : b.y + halfH, b.w, halfH);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.12, b.y + halfH); ctx.lineTo(b.x + b.w * 0.88, b.y + halfH); ctx.stroke();

      var fs = Math.min(halfH * 0.46, b.w * 0.24);
      drawToggleHalf(b, 'DIG', fs, b.y + halfH * 0.5, digOn ? FG : MUTED, digOn ? 1 : 0.55, false);
      drawToggleHalf(b, 'FLAG', fs, b.y + halfH * 1.5, digOn ? MUTED : FLAG, digOn ? 0.55 : 1, true);
    }

    // One row of the toggle: a small drawn icon (a spade for DIG, a flag for
    // FLAG) followed by the label, centred as a group — no emoji glyphs.
    function drawToggleHalf(b, label, fs, cy, col, alpha, isFlag) {
      var iconW = fs * 0.95, gap = fs * 0.4;
      var textW = label.length * fs * 0.6;
      var startX = b.x + b.w / 2 - (iconW + gap + textW) / 2;
      var icx = startX + iconW / 2;
      ctx.globalAlpha = alpha;
      if (isFlag) {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, fs * 0.1); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(icx - iconW * 0.18, cy + iconW * 0.42); ctx.lineTo(icx - iconW * 0.18, cy - iconW * 0.42); ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(icx - iconW * 0.18, cy - iconW * 0.42);
        ctx.lineTo(icx + iconW * 0.4, cy - iconW * 0.18);
        ctx.lineTo(icx - iconW * 0.18, cy + iconW * 0.06);
        ctx.closePath(); ctx.fill();
        ctx.lineCap = 'butt';
      } else {
        ctx.fillStyle = col;                                   // a little spade/scoop
        ctx.beginPath();
        ctx.moveTo(icx, cy - iconW * 0.45);
        ctx.lineTo(icx + iconW * 0.42, cy + iconW * 0.18);
        ctx.lineTo(icx - iconW * 0.42, cy + iconW * 0.18);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(icx - iconW * 0.1, cy + iconW * 0.14, iconW * 0.2, iconW * 0.4);
      }
      ctx.fillStyle = col;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + fs.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(label, startX + iconW + gap, cy);
      ctx.globalAlpha = 1;
    }

    // A boxed readout: a small icon on the left, a value on the right.
    function drawReadout(b, kind, value) {
      ctx.lineWidth = 1.5; ctx.strokeStyle = DIM;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.22);
      ctx.fill(); ctx.stroke();
      var icx = b.x + b.h * 0.5, icy = b.y + b.h * 0.5, ir = b.h * 0.2;
      if (kind === 'mine') {
        ctx.fillStyle = FLAG;
        ctx.strokeStyle = FLAG; ctx.lineWidth = Math.max(1, ir * 0.5); ctx.lineCap = 'round';
        for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(icx, icy); ctx.lineTo(icx + Math.cos(a) * ir * 1.6, icy + Math.sin(a) * ir * 1.6); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(icx, icy, ir, 0, Math.PI * 2); ctx.fill();
        ctx.lineCap = 'butt';
      } else {
        ctx.strokeStyle = FG; ctx.lineWidth = Math.max(1.5, ir * 0.35);
        ctx.beginPath(); ctx.arc(icx, icy, ir * 1.2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(icx, icy - ir * 0.6); ctx.lineTo(icx, icy); ctx.lineTo(icx + ir * 0.55, icy + ir * 0.3); ctx.stroke();
      }
      ctx.fillStyle = INK;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + (b.h * 0.46).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(value, b.x + b.w - b.h * 0.28, b.y + b.h * 0.54);
    }

    function pad3(n) { var s = (n < 0 ? '-' : '') + Math.min(999, Math.abs(n)); while (s.length < 3) s = '0' + s; return s; }

    function drawDiff(b) {
      ctx.lineWidth = 1.5; ctx.strokeStyle = FG;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.26);
      ctx.fill(); ctx.stroke();
      var d = DIFFS[diffIdx];
      ctx.fillStyle = FG;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + Math.min(b.h * 0.34, b.w * 0.2).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(d.key + ' ' + d.n + '×' + d.n, b.x + b.w / 2, b.y + b.h * 0.54);
    }

    function drawHelp(h) {
      var lines = mode === 'dig'
        ? ['TAP TO DIG', 'HOLD TO FLAG', 'TAP A NUMBER TO SWEEP']
        : ['TAP TO FLAG', 'SWITCH TO DIG', 'TO REVEAL CELLS'];
      var fs = clamp(Math.min(vw, vh) * 0.021, 9, 14), lh = fs * 1.5, i;
      ctx.fillStyle = MUTED; ctx.globalAlpha = 0.8;
      ctx.font = 'bold ' + fs.toFixed(0) + 'px "Courier New", monospace';
      ctx.textAlign = h.align; ctx.textBaseline = h.baseline;
      for (i = 0; i < lines.length; i++) {
        ctx.fillText(lines[lines.length - 1 - i], h.x, h.y - i * lh);
      }
      ctx.globalAlpha = 1;
    }

    function drawChrome(cl) {
      drawButton(cl.finish, 'FINISH', FG, false);
      drawButton(cl.newBtn, 'NEW', FG, false);
      drawToggle(cl.toggle);
      drawDiff(cl.diff);
      drawReadout(cl.mines, 'mine', pad3(mineCount - flags));
      drawReadout(cl.timer, 'time', pad3(elapsed()));
      drawHelp(cl.help);
    }

    // ---- win / lose banner -------------------------------------------------
    function drawOver() {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      rrect(boardLeft, boardTop, S, S, cs * 0.25); ctx.fill();
      var unit = Math.min(vw, vh), cx = boardLeft + S / 2, cy = boardTop + S / 2;
      var won = state === 'won';
      var col = won ? FG : FLAG;
      var pulse = 0.6 + 0.4 * Math.abs(Math.sin(clock * 2.4));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = unit * 0.03;
      ctx.font = 'bold ' + (unit * 0.11).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(won ? 'CLEARED' : 'BOOM', cx, cy - unit * 0.05);
      ctx.shadowBlur = 0;
      ctx.fillStyle = INK;
      ctx.font = 'bold ' + (unit * 0.035).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(won ? 'TIME ' + pad3(finalTime) + 'S' : 'YOU HIT A MINE', cx, cy + unit * 0.02);
      if (won && winStats) {
        ctx.fillStyle = winStats.isNew ? AMBER : MUTED;
        ctx.font = 'bold ' + (unit * 0.03).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText(
          (winStats.isNew ? 'NEW BEST  ' : 'BEST  ') + pad3(winStats.best) + 'S',
          cx, cy + unit * 0.055
        );
      }
      ctx.globalAlpha = pulse; ctx.fillStyle = INK;
      ctx.font = 'bold ' + (unit * 0.04).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP TO PLAY AGAIN', cx, cy + (won && winStats ? unit * 0.115 : unit * 0.085));
      ctx.globalAlpha = 1;
    }

    // ---- frame -------------------------------------------------------------
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);
      drawField();
      if (state !== 'play') drawOver();
      drawChrome(chromeLayout());
    }

    // ---- boot --------------------------------------------------------------
    NG.onResize(layout);
    newGame();

    var last = 0;
    function loop(t) {
      if (!last) last = t;
      clock += Math.min((t - last) / 1000, 1 / 20);
      last = t;
      draw();
      window.requestAnimationFrame(loop);
    }
    window.requestAnimationFrame(loop);
  });
})();
