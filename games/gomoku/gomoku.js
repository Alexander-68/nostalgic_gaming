/*
 * Gomoku (Five-in-a-Row) — the catalogue's first turn-based strategy title.
 * Two players share one screen (pass-and-play), or one plays against a computer
 * opponent. Touch-first, with a little keyboard support for desktop dev.
 *
 * Mirrors the catalogue's conventions (see games/snake/snake.js):
 *   - classic script under no modules, runs from file://
 *   - the three design ratios via NG.classify / NG.onResize. Gomoku uses the
 *     fixed-ratio LETTERBOX strategy (the board is a square N×N grid): we centre
 *     the largest square that fits and re-letterbox on resize, so the cells stay
 *     square in 16:9, 9:8 and 9:16 alike — no reflowing the grid. The board is
 *     maximised (full height in landscape); chrome lives in the leftover space —
 *     side panels in landscape, top/bottom bands in portrait.
 *   - it starts straight into a 2-player, same-screen game (no menu); each
 *     player's frame carries a robot icon you tap to switch that side between
 *     YOU and COMPUTER — so 1-player (vs computer), 2-player, and even
 *     computer-vs-computer all fall out of the same board.
 *
 * Placing is two taps so a fingertip never misplaces on the dense 15×15 grid:
 * tap an intersection to AIM (a ghost stone + crosshair shows exactly where),
 * tap it again to PLACE. Drag to slide the aim around first. First to five in a
 * row — horizontal, vertical or diagonal — wins, and the line lights up.
 *
 * The computer is a threat-space player: it takes a win outright, blocks an
 * immediate loss, then scores every sensible point by the threats it makes and
 * the threats it denies (fours, open threes, forks), refined one reply deep so
 * it won't walk into an opponent fork. Pure functions over the board array, so
 * it runs from file:// with no transport. (Developed test-first; see the engine
 * section below.)
 */
(function () {
  'use strict';

  // ---- palette (matches the catalogue's phosphor look) ----------------------
  var FG = '#4dff88';     // player 1 — phosphor green
  var P2 = '#ffcf4d';     // player 2 — amber
  var DIM = '#1d5e38';    // board border / grid ambient
  var INK = '#d6f7e4';    // neutral text
  var MUTED = '#6b7a72';  // secondary text
  var BOARD_BG = '#0a1410';
  var RGB1 = [77, 255, 136], RGB2 = [255, 207, 77];

  // ---- board / engine constants ---------------------------------------------
  var N = 15;                                   // 15×15 classic board
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]]; // E, S, SE, SW
  var AI_DELAY = 430;                           // ms pause before the computer plays, for feel

  function idx(x, y) { return y * N + x; }
  function inB(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ===========================================================================
  // ENGINE — pure functions over a flat board array (0 empty, 1 P1, 2 P2).
  // Developed and unit-tested standalone before being dropped in here.
  // ===========================================================================

  // Exact win check: does placing `p` at (x,y) make five (or more) in a row?
  function makesFive(board, x, y, p) {
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1], run = 1, k;
      for (k = 1; k < 5; k++) { var ax = x + dx * k, ay = y + dy * k; if (inB(ax, ay) && board[idx(ax, ay)] === p) run++; else break; }
      for (k = 1; k < 5; k++) { var bx = x - dx * k, by = y - dy * k; if (inB(bx, by) && board[idx(bx, by)] === p) run++; else break; }
      if (run >= 5) return true;
    }
    return false;
  }

  // The full run of cells (>=5) through (x,y), for the victory highlight — or null.
  function winningLine(board, x, y, p) {
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1], cells = [[x, y]], k;
      for (k = 1; k < N; k++) { var ax = x + dx * k, ay = y + dy * k; if (inB(ax, ay) && board[idx(ax, ay)] === p) cells.push([ax, ay]); else break; }
      for (k = 1; k < N; k++) { var bx = x - dx * k, by = y - dy * k; if (inB(bx, by) && board[idx(bx, by)] === p) cells.unshift([bx, by]); else break; }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  // One direction as a 9-cell window centred on the placed stone:
  // '1' = me, '0' = empty, '2' = opponent or edge (a hard block). Because every
  // length-5/6 substring of a 9-char window covers the centre, an in-window
  // pattern match is a through-the-stone match for the tiers we care about.
  function dirWindow(board, x, y, dx, dy, me) {
    var s = '';
    for (var k = -4; k <= 4; k++) {
      if (k === 0) { s += '1'; continue; }
      var cx = x + dx * k, cy = y + dy * k;
      if (!inB(cx, cy)) { s += '2'; continue; }
      var v = board[idx(cx, cy)];
      s += v === me ? '1' : v === 0 ? '0' : '2';
    }
    return s;
  }

  var FOUR = ['11110', '01111', '11011', '10111', '11101'];     // fillable to five
  var OPEN_THREE = ['011100', '001110', '011010', '010110'];     // becomes an open four
  var THREE = ['11100', '00111', '11010', '01011', '10110', '01101'];
  var OPEN_TWO = ['001100', '011000', '000110', '010100', '001010'];

  function anyIn(s, arr) { for (var i = 0; i < arr.length; i++) if (s.indexOf(arr[i]) !== -1) return true; return false; }

  // Strongest pattern this move makes in one direction.
  function classifyString(s) {
    if (s.indexOf('11111') !== -1) return 'FIVE';
    if (s.indexOf('011110') !== -1) return 'OPEN_FOUR';
    if (anyIn(s, FOUR)) return 'FOUR';
    if (anyIn(s, OPEN_THREE)) return 'OPEN_THREE';
    if (anyIn(s, THREE)) return 'THREE';
    if (anyIn(s, OPEN_TWO)) return 'OPEN_TWO';
    if (s.indexOf('11') !== -1) return 'TWO';
    return 'ONE';
  }

  // Count the four directions' patterns for placing `me` at an (empty) (x,y).
  function analyzePoint(board, x, y, me) {
    var c = { FIVE: 0, OPEN_FOUR: 0, FOUR: 0, OPEN_THREE: 0, THREE: 0, OPEN_TWO: 0, TWO: 0, ONE: 0 };
    for (var d = 0; d < DIRS.length; d++) {
      c[classifyString(dirWindow(board, x, y, DIRS[d][0], DIRS[d][1], me))]++;
    }
    return c;
  }

  var WIN = 1e9;
  // Scalar worth of a move's shape, with fork bonuses (double four, four+three,
  // double three) so a fork dominates any single threat.
  function shapeValue(c) {
    if (c.FIVE > 0) return WIN;
    var v = 0;
    v += c.OPEN_FOUR * 200000;
    v += c.FOUR * 10000;
    v += c.OPEN_THREE * 1200;
    v += c.THREE * 200;
    v += c.OPEN_TWO * 60;
    v += c.TWO * 12;
    v += c.ONE * 1;
    var fours = c.FOUR + c.OPEN_FOUR;
    if (c.OPEN_FOUR > 0) v += 300000;                    // open four ≈ win
    if (fours >= 2) v += 100000;                         // double four
    if (fours >= 1 && c.OPEN_THREE >= 1) v += 80000;     // four + three
    if (c.OPEN_THREE >= 2) v += 20000;                   // double three
    return v;
  }

  // Empty cells within Chebyshev distance `r` of any stone (empty board -> centre).
  function genCandidates(board, r) {
    var out = [], seen = Object.create(null), any = false, x, y;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      if (board[idx(x, y)] === 0) continue;
      any = true;
      for (var ddy = -r; ddy <= r; ddy++) for (var ddx = -r; ddx <= r; ddx++) {
        var nx = x + ddx, ny = y + ddy;
        if (!inB(nx, ny) || board[idx(nx, ny)] !== 0) continue;
        var key = nx + ',' + ny;
        if (!seen[key]) { seen[key] = true; out.push([nx, ny]); }
      }
    }
    if (!any) return [[(N / 2) | 0, (N / 2) | 0]];
    return out;
  }

  function findWin(board, cands, p) {
    for (var i = 0; i < cands.length; i++) {
      if (makesFive(board, cands[i][0], cands[i][1], p)) return cands[i];
    }
    return null;
  }

  var CENTER = (N - 1) / 2;
  function centerBias(x, y) { return (N - (Math.abs(x - CENTER) + Math.abs(y - CENTER))) * 2; }

  // 1-ply value of placing `me` at (x,y): build my own threat AND deny the
  // opponent the threat they'd get on the same square. Centre bias only breaks ties.
  function moveScore(board, x, y, me, opp) {
    return shapeValue(analyzePoint(board, x, y, me))
      + 0.9 * shapeValue(analyzePoint(board, x, y, opp))
      + centerBias(x, y);
  }

  // The single strongest threat the opponent could make on a given board.
  function oppBestThreat(board, opp) {
    var cands = genCandidates(board, 2), best = 0;
    for (var i = 0; i < cands.length; i++) {
      var v = shapeValue(analyzePoint(board, cands[i][0], cands[i][1], opp));
      if (v > best) best = v;
    }
    return best;
  }

  // Pick the computer's move for `me`. Threat-space search: exact win/block first,
  // then a 1-ply attack+defence score, refined on the top moves by the opponent's
  // best reply (depth 2) so the computer won't hand the opponent a fork.
  var TOP_K = 12, FORCING = 10000;
  function chooseMove(board, me) {
    var opp = me === 1 ? 2 : 1;
    var cands = genCandidates(board, 2);
    if (cands.length === 1) return cands[0];

    var win = findWin(board, cands, me);          // 1) take a win outright
    if (win) return win;
    var block = findWin(board, cands, opp);        // 2) block an immediate loss
    if (block) return block;

    var scored = [], i;                            // 3) rank by 1-ply attack+defence
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      scored.push({ c: c, s: moveScore(board, c[0], c[1], me, opp) });
    }
    scored.sort(function (a, b) { return b.s - a.s; });

    // 4) refine the top moves one reply deep. A quiet move that lets the opponent
    // answer with a stronger threat (their own fork) is downgraded; a FORCING move
    // of ours (a four or fork) is exempt — the opponent must answer it, so they
    // can't freely take their best threat, and we keep the initiative.
    var k = Math.min(TOP_K, scored.length);
    var best = scored[0].c, bestRefined = -Infinity;
    for (i = 0; i < k; i++) {
      var x = scored[i].c[0], y = scored[i].c[1];
      var mineShape = shapeValue(analyzePoint(board, x, y, me));
      var refined;
      if (mineShape >= FORCING) {
        refined = mineShape + centerBias(x, y);
      } else {
        board[idx(x, y)] = me;
        var reply = oppBestThreat(board, opp);
        board[idx(x, y)] = 0;
        var deny = 0.9 * shapeValue(analyzePoint(board, x, y, opp));
        refined = mineShape + deny + centerBias(x, y) - 0.95 * reply;
      }
      if (refined > bestRefined) { bestRefined = refined; best = scored[i].c; }
    }
    return best;
  }

  // ===========================================================================
  // GAME — state, layout, input and rendering.
  // ===========================================================================
  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- layout (recomputed on every resize / orientation change) ----------
    var vw = 0, vh = 0, drawScale = 1;
    var S = 0, g = 0, r = 0;                 // board side, intersection spacing, stone radius
    var boardLeft = 0, boardTop = 0;         // top-left of the square board panel
    var gx = 0, gy = 0;                      // pixel of intersection (0,0)
    var panelMode = 'wide';                  // 'wide' (side panels) | 'stacked' (top/bottom bands)
    var SWIPE_THRESH = 14;

    // ---- game state --------------------------------------------------------
    var state = 'playing';                   // 'playing' | 'over' (no menu — always 2-player)
    var board = new Array(N * N);
    var moves = [];                          // {x,y,p,t} in play order
    var lastMove = null;                     // {x,y,p}
    var preview = null;                      // {x,y} aimed-but-not-placed intersection
    var result = null;                       // {winner} | {draw:true}
    var winLine = null;                      // array of [x,y] on victory
    var aiFlags = [false, false];            // which side (P1,P2) is computer-driven
    var streakStats = null;                  // {streak, best, isNew} — set on game over vs computer
    var aiGen = 0;                           // invalidates stale scheduled AI turns
    var clock = 0;                           // wall clock for pulsing / pop animation
    var anchors = Object.create(null);       // pointer id -> { sx, sy, moved, handled }

    function clearBoard() { for (var i = 0; i < N * N; i++) board[i] = 0; }
    function turn() { return moves.length % 2 === 0 ? 1 : 2; }   // P1 always moves first
    function aiTurnNow() { return state === 'playing' && aiFlags[turn() - 1]; }

    // ---- layout ------------------------------------------------------------
    // The board square is maximised; whatever's left over hosts the chrome.
    //   landscape (incl. squarish): side panels left & right -> board uses (near)
    //                               the full viewport height.
    //   portrait:                   top & bottom bands -> board uses the full width.
    function layout(info) {
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
        var minPanel = clamp(Math.min(vw, vh) * 0.18, 96, 240);   // room a side panel needs
        S = Math.max(60, Math.min(vh - 2 * padB, vw - 2 * minPanel));
      } else {
        panelMode = 'stacked';
        var band = clamp(vh * 0.14, 70, 170);                      // room a top/bottom band needs
        S = Math.max(60, Math.min(vw - 2 * padB, vh - 2 * band));
      }
      boardLeft = (vw - S) / 2;
      boardTop = (vh - S) / 2;

      g = S / ((N - 1) + 1.8);            // internal margin m = 0.9g: S = 14g + 1.8g
      var m = 0.9 * g;
      gx = boardLeft + m;
      gy = boardTop + m;
      r = g * 0.46;
      SWIPE_THRESH = Math.max(10, g * 0.45);
      // A resize only re-letterboxes the fixed board; stones keep their cells.
    }

    function cellPx(x, y) { return { x: gx + x * g, y: gy + y * g }; }

    // Positions for the chrome (player frames, FINISH/UNDO, instructions) in the
    // space around the board. FINISH and the instructions share a side/band.
    function chromeLayout() {
      var unit = Math.min(vw, vh);
      var bw = clamp(unit * (panelMode === 'wide' ? 0.16 : 0.13), 64, 168);
      var bh = clamp(unit * 0.055, 30, 48);
      if (panelMode === 'wide') {
        var lw = boardLeft, rw = vw - (boardLeft + S);
        var by0 = boardTop, by1 = boardTop + S;
        var cxL = lw / 2, cxR = boardLeft + S + rw / 2;
        var gap = clamp(unit * 0.03, 10, 30);
        var pw = clamp(Math.min(lw, rw) * 0.86, 80, 220), ph = clamp(unit * 0.2, 70, 150);
        var midY = by0 + (by1 - by0) / 2 - ph / 2;
        return {
          mode: 'wide',
          finish: { x: cxL - bw / 2, y: by0 + gap, w: bw, h: bh },
          undo: { x: cxR - bw / 2, y: by0 + gap, w: bw, h: bh },
          p1: { x: cxL - pw / 2, y: midY, w: pw, h: ph },
          p2: { x: cxR - pw / 2, y: midY, w: pw, h: ph },
          help: { x: cxL, y: by1 - gap, align: 'center', baseline: 'bottom' },
        };
      }
      var tb0 = 0, tb1 = boardTop, bb0 = boardTop + S;
      var cx = vw / 2, mgx = clamp(vw * 0.03, 8, 26), mgy = clamp(tb1 * 0.14, 6, 20);
      var pw2 = clamp(vw * 0.6, 150, Math.min(unit * 0.82, 340)), ph2 = clamp(tb1 * 0.46, 48, 104);
      return {
        mode: 'stacked',
        finish: { x: mgx, y: tb0 + mgy, w: bw, h: bh },
        undo: { x: vw - mgx - bw, y: tb0 + mgy, w: bw, h: bh },
        p1: { x: cx - pw2 / 2, y: tb1 - ph2 - mgy, w: pw2, h: ph2 },
        p2: { x: cx - pw2 / 2, y: bb0 + (vh - bb0) / 2 - ph2 / 2, w: pw2, h: ph2 },
        help: { x: mgx, y: tb0 + mgy + bh + clamp(unit * 0.02, 6, 14), align: 'left', baseline: 'top' },
      };
    }

    // The robot toggle's hit/draw box inside a player frame.
    // Player frame internals: "P#" + robot icon share the top line; the role
    // text ("YOU" / "COMPUTER" / "THINKING…") gets its own line below with the
    // full frame width, so the longer labels never run past the frame.
    function pillLayout(b) {
      var topH = b.h * 0.56;
      var is = clamp(Math.min(topH * 0.82, b.w * 0.34), 28, 84);
      var labelFont = Math.min(topH * 0.62, b.h * 0.42);
      var labelW = labelFont * 1.25;                     // "P2" ≈ two monospace chars
      var gap = is * 0.28;
      var groupW = labelW + gap + is;
      var startX = b.x + b.w / 2 - groupW / 2;
      var rowCy = b.y + topH / 2;
      return {
        labelX: startX + labelW / 2, labelY: rowCy, labelFont: labelFont,
        icon: { x: startX + labelW + gap, y: rowCy - is / 2, w: is, h: is },
        roleFont: Math.min((b.h - topH) * 0.5, b.w * 0.15), roleY: b.y + topH + (b.h - topH) / 2,
      };
    }
    function iconRectFor(b) { return pillLayout(b).icon; }

    // ---- flow --------------------------------------------------------------
    function newGame() {
      clearBoard();
      moves = []; lastMove = null; preview = null; result = null; winLine = null;
      state = 'playing';
      refreshAI();
    }
    function restart() { newGame(); }                 // same robot toggles, fresh board

    function toggleAI(player) {
      aiFlags[player - 1] = !aiFlags[player - 1];
      preview = null;
      refreshAI();
    }

    // Win streak vs the computer — only meaningful when exactly one side is AI,
    // so a 2-human or computer-vs-computer game leaves the record untouched.
    function recordStreak(winner) {
      var aiCount = (aiFlags[0] ? 1 : 0) + (aiFlags[1] ? 1 : 0);
      if (aiCount !== 1) { streakStats = null; return; }
      var human = aiFlags[0] ? 2 : 1;
      var streak = winner === human ? NG.storage.get('ng_gomoku_streak', 0) + 1 : 0;
      NG.storage.set('ng_gomoku_streak', streak);
      var rec = NG.bestScore('ng_gomoku_best_streak', streak);
      streakStats = { streak: streak, best: rec.best, isNew: rec.isNew && streak > 0 };
    }

    function placeStone(x, y) {
      var p = turn();
      board[idx(x, y)] = p;
      moves.push({ x: x, y: y, p: p, t: clock });
      lastMove = { x: x, y: y, p: p };
      preview = null;
      var line = winningLine(board, x, y, p);
      if (line) { result = { winner: p }; winLine = line; state = 'over'; recordStreak(p); return; }
      if (moves.length >= N * N) { result = { draw: true }; state = 'over'; recordStreak(null); return; }
      refreshAI();
    }

    function undo() {
      if (!moves.length) return;
      aiGen++;                                   // cancel any pending computer move
      moves.pop();
      var bothAI = aiFlags[0] && aiFlags[1];
      if (!bothAI) {                             // land back on a human's turn to replay
        while (moves.length > 0 && aiFlags[turn() - 1]) moves.pop();
      }
      rebuildBoard();
      lastMove = moves.length ? moves[moves.length - 1] : null;
      preview = null; result = null; winLine = null;
      state = 'playing';
      refreshAI();
    }

    function rebuildBoard() {
      clearBoard();
      for (var i = 0; i < moves.length; i++) board[idx(moves[i].x, moves[i].y)] = moves[i].p;
    }

    function finishToCatalogue() { window.location.href = '../../index.html'; }

    // Schedule (or cancel) the computer's move for the current turn.
    function refreshAI() {
      aiGen++;
      if (state !== 'playing' || !aiFlags[turn() - 1]) return;
      var gen = aiGen;
      window.setTimeout(function () {
        if (gen !== aiGen || state !== 'playing' || !aiFlags[turn() - 1]) return;
        var mv = chooseMove(board, turn());
        if (mv && board[idx(mv[0], mv[1])] === 0) placeStone(mv[0], mv[1]);
      }, AI_DELAY);
    }

    // ---- input -------------------------------------------------------------
    function inRect(x, y, b) { return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }
    function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

    // Nearest intersection to a pixel, or null if the tap isn't near one.
    function nearestPoint(px, py) {
      var ix = clamp(Math.round((px - gx) / g), 0, N - 1);
      var iy = clamp(Math.round((py - gy) / g), 0, N - 1);
      var c = cellPx(ix, iy);
      if (dist2(px, py, c.x, c.y) > (g * 0.72) * (g * 0.72)) return null;
      return { x: ix, y: iy };
    }

    // A board tap during play: aim, or confirm if the ghost is already there.
    function boardTap(px, py) {
      if (state !== 'playing' || aiTurnNow()) return;
      if (preview && board[idx(preview.x, preview.y)] === 0) {
        var pc = cellPx(preview.x, preview.y);
        if (dist2(px, py, pc.x, pc.y) <= (g * 0.72) * (g * 0.72)) { placeStone(preview.x, preview.y); return; }
      }
      var t = nearestPoint(px, py);
      if (t && board[idx(t.x, t.y)] === 0) preview = t;     // (re)aim
    }

    NG.createTouch(canvas, {
      onDown: function (pt) {
        anchors[pt.id] = { sx: pt.x, sy: pt.y, moved: false, handled: false };
      },
      onMove: function (pt) {
        var a = anchors[pt.id];
        if (!a || a.handled) return;
        if (!a.moved) {
          if (Math.abs(pt.x - a.sx) < SWIPE_THRESH && Math.abs(pt.y - a.sy) < SWIPE_THRESH) return;
          a.moved = true;
        }
        if (state === 'playing' && !aiTurnNow()) {          // drag slides the aim live
          var t = nearestPoint(pt.x, pt.y);
          if (t && board[idx(t.x, t.y)] === 0) preview = t;
        }
      },
      onUp: function (pt) {
        var a = anchors[pt.id];
        delete anchors[pt.id];
        if (!a || a.handled || a.moved) return;             // it was a drag
        var cl = chromeLayout();
        if (inRect(pt.x, pt.y, cl.finish)) { finishToCatalogue(); return; }
        if (inRect(pt.x, pt.y, cl.undo)) { if (moves.length) undo(); return; }
        if (inRect(pt.x, pt.y, iconRectFor(cl.p1))) { toggleAI(1); return; }   // robot toggles YOU/COMPUTER
        if (inRect(pt.x, pt.y, iconRectFor(cl.p2))) { toggleAI(2); return; }
        if (state === 'over') { restart(); return; }        // tap the board to play again
        boardTap(pt.x, pt.y);
      },
    });

    // Keyboard: desktop-development convenience only (the game never requires it).
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === 'u') { undo(); ev.preventDefault(); return; }
      if (k === 'r') { restart(); ev.preventDefault(); return; }
      if (state === 'over' && (k === 'enter' || k === ' ' || k === 'spacebar')) { restart(); ev.preventDefault(); }
    });

    // ESC / BACK / HOME (kiosk hardware + remotes) also leave for the catalogue;
    // the on-screen FINISH button is the touch affordance.
    NG.onExit(finishToCatalogue);

    // ---- drawing helpers ---------------------------------------------------
    function rrect(px, py, w, h, rad) {
      ctx.beginPath();
      ctx.moveTo(px + rad, py);
      ctx.arcTo(px + w, py, px + w, py + h, rad);
      ctx.arcTo(px + w, py + h, px, py + h, rad);
      ctx.arcTo(px, py + h, px, py, rad);
      ctx.arcTo(px, py, px + w, py, rad);
      ctx.closePath();
    }
    function rgba(p, a) { var c = p === 1 ? RGB1 : RGB2; return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
    function hex(p) { return p === 1 ? FG : P2; }
    function stoneShades(p) {
      return p === 1
        ? { hi: 'rgba(220,255,233,0.98)', mid: FG, lo: '#1f9a54', edge: '#0c5e30' }
        : { hi: 'rgba(255,247,216,0.98)', mid: P2, lo: '#caa23a', edge: '#7c5a12' };
    }

    // ---- board + stones ----------------------------------------------------
    function drawBoard() {
      var span = (N - 1) * g;
      ctx.shadowBlur = 0;
      ctx.fillStyle = BOARD_BG;
      rrect(boardLeft, boardTop, S, S, g * 0.5);
      ctx.fill();

      ctx.strokeStyle = rgba(1, 0.16);
      ctx.lineWidth = Math.max(1, g * 0.045);
      ctx.beginPath();
      for (var i = 0; i < N; i++) {
        var p = gx + i * g;
        ctx.moveTo(p, gy); ctx.lineTo(p, gy + span);
        var q = gy + i * g;
        ctx.moveTo(gx, q); ctx.lineTo(gx + span, q);
      }
      ctx.stroke();

      var star = [3, 7, 11];                            // hoshi
      ctx.fillStyle = rgba(1, 0.5);
      for (var a = 0; a < star.length; a++) for (var b = 0; b < star.length; b++) {
        var c = cellPx(star[a], star[b]);
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1.5, g * 0.1), 0, Math.PI * 2); ctx.fill();
      }

      ctx.lineWidth = Math.max(2, g * 0.08);
      ctx.strokeStyle = DIM;
      rrect(boardLeft, boardTop, S, S, g * 0.5);
      ctx.stroke();
    }

    // Crisp, well-defined stones: a shaded bead with a clean dark rim and NO glow.
    function drawStone(x, y, p, scale) {
      var c = cellPx(x, y), rr = r * scale;
      if (rr < 0.5) return;
      var sh = stoneShades(p);
      var grad = ctx.createRadialGradient(c.x - rr * 0.35, c.y - rr * 0.35, rr * 0.1, c.x, c.y, rr);
      grad.addColorStop(0, sh.hi); grad.addColorStop(0.5, sh.mid); grad.addColorStop(1, sh.lo);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1, g * 0.06);
      ctx.strokeStyle = sh.edge;
      ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.stroke();
    }

    function drawStones() {
      for (var i = 0; i < moves.length; i++) {
        var mv = moves[i];
        var age = (clock - mv.t) / 0.12;
        var pp = age >= 1 ? 1 : age < 0 ? 0 : age;
        var ease = 1 - (1 - pp) * (1 - pp);          // easeOutQuad pop
        drawStone(mv.x, mv.y, mv.p, 0.55 + 0.45 * ease);
      }
      if (lastMove) {                                 // last-move pip
        var c = cellPx(lastMove.x, lastMove.y);
        ctx.fillStyle = '#06120b';
        ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.17, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawPreview() {
      if (!preview) return;
      var c = cellPx(preview.x, preview.y), p = turn(), span = (N - 1) * g;
      var pulse = 0.5 + 0.5 * Math.abs(Math.sin(clock * 3.2));
      ctx.strokeStyle = rgba(p, 0.28);               // crosshair to read under the fingertip
      ctx.lineWidth = Math.max(1, g * 0.04);
      ctx.beginPath();
      ctx.moveTo(gx, c.y); ctx.lineTo(gx + span, c.y);
      ctx.moveTo(c.x, gy); ctx.lineTo(c.x, gy + span);
      ctx.stroke();
      ctx.fillStyle = rgba(p, 0.16);
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = hex(p);
      ctx.lineWidth = Math.max(1.5, g * 0.06);
      ctx.setLineDash([g * 0.2, g * 0.16]);
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- player frames + robot toggle --------------------------------------
    function roleText(player) {
      if (aiFlags[player - 1]) return aiTurnNow() && turn() === player ? 'THINKING…' : 'COMPUTER';
      return 'YOU';
    }

    function drawRobot(ic, color, active, bright) {
      var cx = ic.x + ic.w / 2, cy = ic.y + ic.h / 2, s = ic.w * 0.42;
      ctx.globalAlpha = active ? 1 : (bright ? 0.85 : 0.55);
      ctx.lineWidth = Math.max(1.5, s * 0.16);
      ctx.strokeStyle = color;
      var hw = s * 1.5, hh = s * 1.25, hx = cx - hw / 2, hy = cy - hh * 0.36;
      ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(cx, hy - s * 0.5); ctx.stroke();   // antenna
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, hy - s * 0.6, Math.max(1.5, s * 0.16), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = active ? color : 'rgba(255,255,255,0.04)';                         // head
      rrect(hx, hy, hw, hh, s * 0.32); ctx.fill(); ctx.stroke();
      var face = active ? BOARD_BG : color;                                              // eyes + mouth
      ctx.fillStyle = face;
      ctx.beginPath(); ctx.arc(cx - s * 0.4, cy + s * 0.04, s * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + s * 0.4, cy + s * 0.04, s * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = face; ctx.lineWidth = Math.max(1, s * 0.14);
      ctx.beginPath(); ctx.moveTo(cx - s * 0.34, cy + s * 0.5); ctx.lineTo(cx + s * 0.34, cy + s * 0.5); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function drawPill(b, player) {
      var color = hex(player);
      var isTurn = state === 'playing' && turn() === player;
      var ai = aiFlags[player - 1];
      ctx.lineWidth = isTurn ? 3 : 1.5;
      ctx.strokeStyle = color;
      ctx.globalAlpha = isTurn ? 1 : 0.5;
      ctx.fillStyle = isTurn ? rgba(player, 0.07) : 'rgba(255,255,255,0.02)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;

      var pl = pillLayout(b);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = isTurn ? 1 : 0.7;
      ctx.fillStyle = color;                              // line 1: "P#" + robot icon
      ctx.font = 'bold ' + pl.labelFont.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('P' + player, pl.labelX, pl.labelY);
      drawRobot(pl.icon, color, ai, isTurn);
      ctx.globalAlpha = isTurn ? 1 : 0.7;                 // line 2: role, full width
      ctx.fillStyle = ai ? color : MUTED;
      ctx.font = 'bold ' + pl.roleFont.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(roleText(player), b.x + b.w / 2, pl.roleY);
      ctx.globalAlpha = 1;
    }

    // ---- chrome: FINISH / UNDO buttons + instructions ----------------------
    function drawButton(b, label, enabled) {
      ctx.globalAlpha = enabled ? 1 : 0.32;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = FG;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.28);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = FG;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + (b.h * 0.4).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h * 0.54);
      ctx.globalAlpha = 1;
    }

    var HELP = ['TAP TO AIM', 'TAP AGAIN TO PLACE', 'TAP A ROBOT', 'FOR COMPUTER'];
    function drawHelp(h) {
      var fs = clamp(Math.min(vw, vh) * 0.022, 10, 15), lh = fs * 1.5, i;
      ctx.fillStyle = MUTED; ctx.globalAlpha = 0.8;
      ctx.font = 'bold ' + fs.toFixed(0) + 'px "Courier New", monospace';
      ctx.textAlign = h.align; ctx.textBaseline = h.baseline;
      if (h.baseline === 'bottom') {
        for (i = 0; i < HELP.length; i++) ctx.fillText(HELP[HELP.length - 1 - i], h.x, h.y - i * lh);
      } else {
        for (i = 0; i < HELP.length; i++) ctx.fillText(HELP[i], h.x, h.y + i * lh);
      }
      ctx.globalAlpha = 1;
    }

    function drawChrome(cl) {
      drawPill(cl.p1, 1);
      drawPill(cl.p2, 2);
      drawButton(cl.finish, 'FINISH', true);
      drawButton(cl.undo, 'UNDO', moves.length > 0);
      drawHelp(cl.help);
    }

    // ---- victory / draw ----------------------------------------------------
    function drawOver() {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, vw, vh);

      if (winLine) {
        var a = cellPx(winLine[0][0], winLine[0][1]);
        var z = cellPx(winLine[winLine.length - 1][0], winLine[winLine.length - 1][1]);
        var col = hex(result.winner);
        var pulse = 0.6 + 0.4 * Math.abs(Math.sin(clock * 3));
        ctx.lineCap = 'round';
        ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = g * 0.6;
        ctx.globalAlpha = pulse;
        ctx.lineWidth = g * 0.22;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke();
        for (var i = 0; i < winLine.length; i++) {
          var c = cellPx(winLine[i][0], winLine[i][1]);
          ctx.lineWidth = Math.max(2, g * 0.06);
          ctx.beginPath(); ctx.arc(c.x, c.y, r * 1.08, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.lineCap = 'butt';
      }

      var unit = Math.min(vw, vh), cx = vw / 2;

      // Anchor the banner clear of the winning line: drop it into whichever band
      // (above or below the line) has more room, so the text never sits on top of
      // the highlighted five. (A draw has no line, so it stays centred.)
      var cyText = vh / 2, half = unit * 0.14;
      if (winLine) {
        var lineTop = Math.min(a.y, z.y) - g, lineBot = Math.max(a.y, z.y) + g, mg = unit * 0.05;
        if (lineTop - mg >= (vh - mg) - lineBot) cyText = clamp((mg + lineTop) / 2, mg + half, lineTop - half);
        else cyText = clamp((lineBot + (vh - mg)) / 2, lineBot + half, vh - mg - half);
      }

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (result.draw) {
        ctx.fillStyle = INK;
        ctx.font = 'bold ' + (unit * 0.1).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('DRAW', cx, cyText - unit * 0.045);
      } else {
        var c2 = hex(result.winner);
        ctx.fillStyle = c2; ctx.shadowColor = c2; ctx.shadowBlur = unit * 0.02;
        ctx.font = 'bold ' + (unit * 0.1).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('PLAYER ' + result.winner + ' WINS', cx, cyText - unit * 0.045);
        ctx.shadowBlur = 0;
      }
      if (streakStats) {
        ctx.globalAlpha = 1; ctx.fillStyle = streakStats.isNew ? P2 : MUTED;
        ctx.font = 'bold ' + (unit * 0.032).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText(
          (streakStats.isNew ? 'NEW BEST STREAK ' : 'STREAK ' + streakStats.streak + '   BEST ') + streakStats.best,
          cx, cyText + unit * 0.02
        );
      }

      var pulse2 = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
      ctx.globalAlpha = pulse2; ctx.fillStyle = INK;
      ctx.font = 'bold ' + (unit * 0.04).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP TO PLAY AGAIN', cx, cyText + unit * 0.085);
      ctx.globalAlpha = 1;
    }

    // ---- frame -------------------------------------------------------------
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);
      drawBoard();
      drawStones();
      if (state === 'playing' && !aiTurnNow()) drawPreview();
      drawChrome(chromeLayout());
      if (state === 'over') drawOver();
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
