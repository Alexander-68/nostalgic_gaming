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
 *     square in 16:9, 9:8 and 9:16 alike — no reflowing the grid.
 *   - a mode menu (1 player vs computer / 2 players) plus a per-side AI toggle:
 *     tap a player's pill to hand that side to (or take it back from) the
 *     computer — the same "tap for AI" affordance Snake uses, and you can even
 *     watch computer-vs-computer.
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
    var undoBtn = document.getElementById('undo');

    // ---- layout (recomputed on every resize / orientation change) ----------
    var vw = 0, vh = 0, drawScale = 1;
    var S = 0, g = 0, r = 0;                 // board side, intersection spacing, stone radius
    var boardLeft = 0, boardTop = 0;         // top-left of the square board panel
    var gx = 0, gy = 0;                      // pixel of intersection (0,0)
    var topPad = 66, pad = 16;
    var orientation = 'land';
    var menuRects = null;

    // ---- game state --------------------------------------------------------
    var mode = null;                         // '1p' | '2p'
    var state = 'menu';                      // 'menu' | 'playing' | 'over'
    var board = new Array(N * N);
    var moves = [];                          // {x,y,p,t} in play order
    var lastMove = null;                     // {x,y,p}
    var preview = null;                      // {x,y} aimed-but-not-placed intersection
    var result = null;                       // {winner} | {draw:true}
    var winLine = null;                      // array of [x,y] on victory
    var aiFlags = [false, false];            // which side (P1,P2) is computer-driven
    var aiGen = 0;                           // invalidates stale scheduled AI turns
    var clock = 0;                           // wall clock for pulsing / pop animation
    var anchors = Object.create(null);       // pointer id -> { sx, sy, moved, handled }
    var SWIPE_THRESH = 14;

    function clearBoard() { for (var i = 0; i < N * N; i++) board[i] = 0; }
    function turn() { return moves.length % 2 === 0 ? 1 : 2; }   // P1 always moves first
    function aiTurnNow() { return state === 'playing' && aiFlags[turn() - 1]; }

    // ---- layout ------------------------------------------------------------
    function layout(info) {
      var dpr = window.devicePixelRatio || 1;
      vw = info.width; vh = info.height;
      canvas.style.width = vw + 'px';
      canvas.style.height = vh + 'px';
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      drawScale = dpr;

      pad = Math.max(10, Math.min(vw, vh) * 0.035);
      topPad = 66;
      var availW = vw - 2 * pad;
      var availH = vh - topPad - pad;
      S = Math.max(40, Math.min(availW, availH));
      // internal margin m = 0.9g around the grid: S = 14g + 2(0.9g) = 15.8g
      g = S / ((N - 1) + 1.8);
      var m = 0.9 * g;
      boardLeft = (vw - S) / 2;
      boardTop = topPad + (availH - S) / 2;
      gx = boardLeft + m;
      gy = boardTop + m;
      r = g * 0.46;
      orientation = vw >= vh ? 'land' : 'port';
      SWIPE_THRESH = Math.max(10, g * 0.45);
      menuRects = null;
      // A resize only re-letterboxes the fixed board; stones keep their cells.
    }

    function cellPx(x, y) { return { x: gx + x * g, y: gy + y * g }; }

    // ---- flow --------------------------------------------------------------
    function updateChrome() {
      if (undoBtn) undoBtn.style.display = (state !== 'menu' && moves.length > 0) ? 'flex' : 'none';
    }

    function pickMode(m) {
      mode = m;
      aiFlags = m === '1p' ? [false, true] : [false, false];   // 1p: you (P1) vs computer (P2)
      newGame();
    }

    function newGame() {
      clearBoard();
      moves = []; lastMove = null; preview = null; result = null; winLine = null;
      state = 'playing';
      updateChrome();
      refreshAI();
    }

    function restart() { newGame(); }                 // same mode + AI sides, fresh board

    function toMenu() {
      state = 'menu';
      aiGen++;
      moves = []; lastMove = null; preview = null; result = null; winLine = null;
      mode = null; aiFlags = [false, false];
      menuRects = null;
      updateChrome();
    }

    function toggleAI(player) {
      aiFlags[player - 1] = !aiFlags[player - 1];
      preview = null;
      updateChrome();
      refreshAI();
    }

    function placeStone(x, y) {
      var p = turn();
      board[idx(x, y)] = p;
      moves.push({ x: x, y: y, p: p, t: clock });
      lastMove = { x: x, y: y, p: p };
      preview = null;
      var line = winningLine(board, x, y, p);
      if (line) { result = { winner: p }; winLine = line; state = 'over'; updateChrome(); return; }
      if (moves.length >= N * N) { result = { draw: true }; state = 'over'; updateChrome(); return; }
      updateChrome();
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
      updateChrome();
      refreshAI();
    }

    function rebuildBoard() {
      clearBoard();
      for (var i = 0; i < moves.length; i++) board[idx(moves[i].x, moves[i].y)] = moves[i].p;
    }

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

    function hitMenu(x, y) {
      var rcts = menuRects || computeMenuRects();
      if (inRect(x, y, rcts.solo)) { pickMode('1p'); return true; }
      if (inRect(x, y, rcts.duo)) { pickMode('2p'); return true; }
      return false;
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
        var a = { sx: pt.x, sy: pt.y, moved: false, handled: false };
        anchors[pt.id] = a;
        if (state === 'menu' && hitMenu(pt.x, pt.y)) a.handled = true;   // menu responds on press
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
        if (!a || a.handled || a.moved) return;             // spent on menu, or it was a drag
        if (state === 'menu') return;
        var sr = statusRects();
        if (inRect(pt.x, pt.y, sr.p1)) { toggleAI(1); return; }
        if (inRect(pt.x, pt.y, sr.p2)) { toggleAI(2); return; }
        if (state === 'over') { restart(); return; }
        if (state === 'playing') boardTap(pt.x, pt.y);
      },
    });

    // Keyboard: desktop-development convenience only (the game never requires it).
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (state === 'menu') {
        if (k === '1') pickMode('1p');
        else if (k === '2') pickMode('2p');
        return;
      }
      if (k === 'u') { undo(); ev.preventDefault(); return; }
      if (k === 'r') { restart(); ev.preventDefault(); return; }
      if (state === 'over' && (k === 'enter' || k === ' ' || k === 'spacebar')) { restart(); ev.preventDefault(); }
    });

    // FINISH (button + ESC/BACK/HOME) is contextual: from a game it backs out to
    // the mode menu; from the menu it leaves for the catalogue.
    NG.enableFinish({
      button: '#finish',
      onFinish: function () {
        if (state === 'menu') window.location.href = '../../index.html';
        else toMenu();
      },
    });
    if (undoBtn) undoBtn.addEventListener('click', function (e) { e.preventDefault(); undo(); });

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
        ? { hi: 'rgba(216,255,232,0.96)', mid: FG, lo: '#178f4a' }
        : { hi: 'rgba(255,245,212,0.96)', mid: P2, lo: '#b9852a' };
    }

    // ---- board + stones ----------------------------------------------------
    function drawBoard() {
      var span = (N - 1) * g;
      ctx.shadowBlur = 0;
      ctx.fillStyle = BOARD_BG;
      rrect(boardLeft, boardTop, S, S, g * 0.5);
      ctx.fill();

      // grid
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

      // star points (hoshi) at the traditional 15×15 spots
      var star = [3, 7, 11];
      ctx.fillStyle = rgba(1, 0.5);
      for (var a = 0; a < star.length; a++) for (var b = 0; b < star.length; b++) {
        var c = cellPx(star[a], star[b]);
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1.5, g * 0.1), 0, Math.PI * 2); ctx.fill();
      }

      // panel border
      ctx.lineWidth = Math.max(2, g * 0.08);
      ctx.strokeStyle = DIM;
      ctx.shadowColor = DIM; ctx.shadowBlur = g * 0.45;
      rrect(boardLeft, boardTop, S, S, g * 0.5);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    function drawStone(x, y, p, scale) {
      var c = cellPx(x, y), rr = r * scale;
      if (rr < 0.5) return;
      var sh = stoneShades(p);
      ctx.shadowColor = hex(p); ctx.shadowBlur = g * 0.3;
      var grad = ctx.createRadialGradient(c.x - rr * 0.32, c.y - rr * 0.32, rr * 0.12, c.x, c.y, rr);
      grad.addColorStop(0, sh.hi); grad.addColorStop(0.45, sh.mid); grad.addColorStop(1, sh.lo);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1, g * 0.03);
      ctx.strokeStyle = sh.lo;
      ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.stroke();
    }

    function drawStones() {
      for (var i = 0; i < moves.length; i++) {
        var mv = moves[i];
        var age = (clock - mv.t) / 0.13;
        var pp = age >= 1 ? 1 : age < 0 ? 0 : age;
        var ease = 1 - (1 - pp) * (1 - pp);          // easeOutQuad pop
        drawStone(mv.x, mv.y, mv.p, 0.2 + 0.8 * ease);
      }
      // last-move marker: a small dark pip on the freshest stone
      if (lastMove) {
        var c = cellPx(lastMove.x, lastMove.y);
        ctx.fillStyle = '#06120b';
        ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.18, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawPreview() {
      if (!preview) return;
      var c = cellPx(preview.x, preview.y), p = turn(), span = (N - 1) * g;
      var pulse = 0.5 + 0.5 * Math.abs(Math.sin(clock * 3.2));
      // crosshair across the board so the aim reads from under the fingertip
      ctx.strokeStyle = rgba(p, 0.28);
      ctx.lineWidth = Math.max(1, g * 0.04);
      ctx.beginPath();
      ctx.moveTo(gx, c.y); ctx.lineTo(gx + span, c.y);
      ctx.moveTo(c.x, gy); ctx.lineTo(c.x, gy + span);
      ctx.stroke();
      // ghost stone
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

    // ---- status pills (whose turn + tap-to-toggle-AI) ----------------------
    function statusRects() {
      var unit = Math.min(vw, vh), p1, p2;
      if (orientation === 'land') {
        var leftVoid = boardLeft, rightVoid = vw - (boardLeft + S);
        var pw = clamp(Math.max(leftVoid, rightVoid) * 0.82, 92, Math.min(unit * 0.34, 210));
        var ph = clamp(unit * 0.22, 76, 150);
        var cy = boardTop + S / 2 - ph / 2;
        p1 = { x: clamp(leftVoid / 2 - pw / 2, 6, vw - pw - 6), y: cy, w: pw, h: ph };
        p2 = { x: clamp(boardLeft + S + rightVoid / 2 - pw / 2, 6, vw - pw - 6), y: cy, w: pw, h: ph };
      } else {
        var topVoid = boardTop - topPad, botVoid = vh - (boardTop + S);
        var ph2 = clamp(Math.min(topVoid, botVoid) * 0.74, 52, 104);
        var pw2 = clamp(vw * 0.6, 150, Math.min(unit * 0.78, 320));
        p1 = { x: vw / 2 - pw2 / 2, y: topPad + topVoid / 2 - ph2 / 2, w: pw2, h: ph2 };
        p2 = { x: vw / 2 - pw2 / 2, y: boardTop + S + botVoid / 2 - ph2 / 2, w: pw2, h: ph2 };
      }
      return { p1: p1, p2: p2 };
    }

    function roleText(player) {
      if (aiFlags[player - 1]) return aiTurnNow() && turn() === player ? 'THINKING…' : 'COMPUTER';
      return mode === '1p' && player === 1 ? 'YOU' : 'PLAYER ' + player;
    }

    function drawPill(b, player) {
      var color = hex(player);
      var isTurn = state === 'playing' && turn() === player;
      ctx.lineWidth = isTurn ? 3 : 1.5;
      ctx.strokeStyle = color;
      ctx.globalAlpha = isTurn ? 1 : 0.5;
      ctx.fillStyle = isTurn ? rgba(player, 0.07) : 'rgba(255,255,255,0.02)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.2);
      ctx.fill();
      ctx.shadowColor = color; ctx.shadowBlur = isTurn ? 16 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.font = 'bold ' + (b.h * 0.36).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('P' + player, b.x + b.w / 2, b.y + b.h * 0.38);
      ctx.fillStyle = aiFlags[player - 1] ? color : MUTED;
      ctx.globalAlpha = isTurn ? 1 : 0.7;
      ctx.font = 'bold ' + (b.h * 0.18).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(roleText(player), b.x + b.w / 2, b.y + b.h * 0.72);
      ctx.globalAlpha = 1;
    }

    function drawStatus() {
      var sr = statusRects();
      drawPill(sr.p1, 1);
      drawPill(sr.p2, 2);
    }

    function drawHelp() {
      var unit = Math.min(vw, vh);
      var msg = aiTurnNow()
        ? 'COMPUTER THINKING…'
        : 'TAP TO AIM · TAP AGAIN TO PLACE · TAP A PLAYER FOR COMPUTER';
      ctx.shadowBlur = 0;
      ctx.fillStyle = MUTED;
      ctx.globalAlpha = 0.75;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.font = 'bold ' + clamp(unit * 0.022, 10, 15).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(msg, vw / 2, vh - Math.max(6, pad * 0.4));
      ctx.globalAlpha = 1;
    }

    // ---- victory / draw ----------------------------------------------------
    function drawOver() {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, vw, vh);

      // light up the winning line
      if (winLine) {
        var a = cellPx(winLine[0][0], winLine[0][1]);
        var z = cellPx(winLine[winLine.length - 1][0], winLine[winLine.length - 1][1]);
        var col = hex(result.winner);
        var pulse = 0.6 + 0.4 * Math.abs(Math.sin(clock * 3));
        ctx.lineCap = 'round';
        ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = g * 0.8;
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

      var unit = Math.min(vw, vh), cx = vw / 2, cy = vh / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (result.draw) {
        ctx.fillStyle = INK;
        ctx.font = 'bold ' + (unit * 0.1).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('DRAW', cx, cy - unit * 0.05);
      } else {
        var c2 = hex(result.winner);
        ctx.fillStyle = c2; ctx.shadowColor = c2; ctx.shadowBlur = unit * 0.03;
        ctx.font = 'bold ' + (unit * 0.1).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('PLAYER ' + result.winner + ' WINS', cx, cy - unit * 0.05);
        ctx.shadowBlur = 0;
      }
      var pulse2 = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
      ctx.globalAlpha = pulse2; ctx.fillStyle = INK;
      ctx.font = 'bold ' + (unit * 0.04).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP TO PLAY AGAIN', cx, cy + unit * 0.06);
      ctx.globalAlpha = 1;
    }

    // ---- menu --------------------------------------------------------------
    function computeMenuRects() {
      var cx = vw / 2, solo, duo;
      if (orientation === 'land') {
        var bw = Math.min(vw * 0.34, 360), bh = Math.min(vh * 0.32, 230);
        var gap = vw * 0.05, y = vh * 0.46;
        solo = { x: cx - gap / 2 - bw, y: y, w: bw, h: bh };
        duo = { x: cx + gap / 2, y: y, w: bw, h: bh };
      } else {
        var bw2 = Math.min(vw * 0.74, 440), bh2 = Math.min(vh * 0.16, 150);
        var gap2 = vh * 0.04, y2 = vh * 0.42;
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
      ctx.font = 'bold ' + (b.h * 0.15).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(sub, b.x + b.w / 2, b.y + b.h * 0.72);
    }

    function drawMenu() {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#060a08';
      ctx.fillRect(0, 0, vw, vh);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var cx = vw / 2, unit = Math.min(vw, vh);

      // a little decorative cross of stones behind the title
      ctx.fillStyle = FG; ctx.shadowColor = FG; ctx.shadowBlur = unit * 0.03;
      ctx.font = 'bold ' + (unit * 0.12).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('GOMOKU', cx, vh * 0.2);
      ctx.shadowBlur = 0; ctx.fillStyle = MUTED;
      ctx.font = 'bold ' + (unit * 0.028).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('FIVE IN A ROW', cx, vh * 0.2 + unit * 0.085);

      menuRects = computeMenuRects();
      drawButton(menuRects.solo, '1 PLAYER', 'VS COMPUTER', FG);
      drawButton(menuRects.duo, '2 PLAYERS', 'PASS & PLAY', P2);

      ctx.fillStyle = MUTED;
      ctx.font = 'bold ' + (unit * 0.026).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP AN INTERSECTION · FIRST TO FIVE WINS', cx, vh * 0.9);
    }

    // ---- frame -------------------------------------------------------------
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);
      if (state === 'menu') { drawMenu(); return; }
      drawBoard();
      drawStones();
      if (state === 'playing' && !aiTurnNow()) drawPreview();
      drawStatus();
      if (state === 'over') drawOver();
      else drawHelp();
    }

    // ---- boot --------------------------------------------------------------
    NG.onResize(layout);
    updateChrome();

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
