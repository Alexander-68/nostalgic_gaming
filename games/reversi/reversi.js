/*
 * Reversi / Othello — strategic disc-flipping board game.
 * 8×8 board, fixed-ratio letterbox layout (same as Gomoku / Minesweeper).
 * Two robot-icon toggles let each side be YOU or COMPUTER — covers solo,
 * pass-and-play, and computer-vs-computer on one board.
 *
 * AI: minimax with alpha-beta pruning (depth 5), move-ordered by the classic
 * positional weight matrix (corners >> edges >> interior), plus a mobility
 * bonus so the computer tries to keep its options open.
 */
(function () {
  'use strict';

  // ---- palette --------------------------------------------------------------
  var FG    = '#4dff88';    // P1 — phosphor green
  var P2C   = '#ffcf4d';    // P2 — amber
  var DIM   = '#1d5e38';
  var INK   = '#d6f7e4';
  var MUTED = '#6b7a72';
  var BOARD_BG = '#081008';
  var RGB1  = [77, 255, 136];
  var RGB2  = [255, 207, 77];

  // ---- constants ------------------------------------------------------------
  var N = 8;
  var DIRS8 = [
    [-1,-1], [-1, 0], [-1, 1],
    [ 0,-1],           [ 0, 1],
    [ 1,-1], [ 1, 0], [ 1, 1],
  ];
  var AI_DELAY = 480;   // ms pause before computer plays
  var AI_DEPTH = 5;     // minimax half-moves (plies)

  // Classic Othello positional weight matrix — corners dominant, X-squares penalised
  var WEIGHT = [
    100,-25, 10,  5,  5, 10,-25,100,
    -25,-50,  3,  3,  3,  3,-50,-25,
     10,  3,  3,  3,  3,  3,  3, 10,
      5,  3,  3,  3,  3,  3,  3,  5,
      5,  3,  3,  3,  3,  3,  3,  5,
     10,  3,  3,  3,  3,  3,  3, 10,
    -25,-50,  3,  3,  3,  3,-50,-25,
    100,-25, 10,  5,  5, 10,-25,100,
  ];

  function idx(x, y) { return y * N + x; }
  function inB(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ===========================================================================
  // ENGINE — pure functions over a flat array: 0=empty, 1=P1(green), 2=P2(amber)
  // ===========================================================================

  function getFlips(board, x, y, p) {
    if (board[idx(x, y)] !== 0) return [];
    var opp = 3 - p, result = [], i, j;
    for (i = 0; i < DIRS8.length; i++) {
      var dx = DIRS8[i][0], dy = DIRS8[i][1];
      var cx = x + dx, cy = y + dy;
      var line = [];
      while (inB(cx, cy) && board[idx(cx, cy)] === opp) {
        line.push([cx, cy]);
        cx += dx; cy += dy;
      }
      if (line.length > 0 && inB(cx, cy) && board[idx(cx, cy)] === p) {
        for (j = 0; j < line.length; j++) result.push(line[j]);
      }
    }
    return result;
  }

  function isValid(board, x, y, p) {
    return board[idx(x, y)] === 0 && getFlips(board, x, y, p).length > 0;
  }

  function getLegalMoves(board, p) {
    var out = [];
    for (var y = 0; y < N; y++)
      for (var x = 0; x < N; x++)
        if (isValid(board, x, y, p)) out.push([x, y]);
    return out;
  }

  function applyMove(board, x, y, p) {
    var flips = getFlips(board, x, y, p);
    board[idx(x, y)] = p;
    for (var i = 0; i < flips.length; i++) board[idx(flips[i][0], flips[i][1])] = p;
    return flips;
  }

  function countDiscs(board) {
    var c = [0, 0, 0];  // [empty, P1, P2]
    for (var i = 0; i < board.length; i++) c[board[i]]++;
    return c;
  }

  // Positional + mobility heuristic for the maximising player (me).
  function evaluate(board, me) {
    var opp = 3 - me, score = 0;
    for (var i = 0; i < N * N; i++) {
      if (board[i] === me) score += WEIGHT[i];
      else if (board[i] === opp) score -= WEIGHT[i];
    }
    var myMov  = getLegalMoves(board, me).length;
    var oppMov = getLegalMoves(board, opp).length;
    if (myMov + oppMov > 0) score += (myMov - oppMov) * 6;
    return score;
  }

  // Sort moves by weight so alpha-beta sees the most promising moves first.
  function sortMoves(moves) {
    return moves.slice().sort(function (a, b) {
      return WEIGHT[idx(b[0], b[1])] - WEIGHT[idx(a[0], a[1])];
    });
  }

  function minimax(board, depth, alpha, beta, maximizing, me) {
    var p = maximizing ? me : 3 - me;
    var moves = getLegalMoves(board, p);
    if (moves.length === 0) {
      var oppMoves = getLegalMoves(board, 3 - p);
      if (oppMoves.length === 0) {
        var c = countDiscs(board);
        var d = c[me] - c[3 - me];
        return d > 0 ? 1e9 + d : d < 0 ? -1e9 + d : 0;
      }
      // pass: switch sides, same depth
      return minimax(board, depth, alpha, beta, !maximizing, me);
    }
    if (depth === 0) return evaluate(board, me);

    moves = sortMoves(moves);
    var i, v, copy;
    if (maximizing) {
      var best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        copy = board.slice();
        applyMove(copy, moves[i][0], moves[i][1], p);
        v = minimax(copy, depth - 1, alpha, beta, false, me);
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    } else {
      var best = Infinity;
      for (i = 0; i < moves.length; i++) {
        copy = board.slice();
        applyMove(copy, moves[i][0], moves[i][1], p);
        v = minimax(copy, depth - 1, alpha, beta, true, me);
        if (v < best) best = v;
        if (v < beta) beta = v;
        if (alpha >= beta) break;
      }
      return best;
    }
  }

  function chooseMove(board, me) {
    var moves = getLegalMoves(board, me);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    moves = sortMoves(moves);
    var best = moves[0], bestScore = -Infinity, i;
    for (i = 0; i < moves.length; i++) {
      var copy = board.slice();
      applyMove(copy, moves[i][0], moves[i][1], me);
      var score = minimax(copy, AI_DEPTH - 1, -Infinity, Infinity, false, me);
      if (score > bestScore) { bestScore = score; best = moves[i]; }
    }
    return best;
  }

  // ===========================================================================
  // GAME — state, layout, input, rendering
  // ===========================================================================
  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- layout state -------------------------------------------------------
    var vw = 0, vh = 0, drawScale = 1;
    var S = 0, cs = 0, dr = 0;       // board side, cell size, disc radius
    var boardLeft = 0, boardTop = 0;
    var panelMode = 'wide';           // 'wide' (side panels) | 'stacked' (bands)

    // ---- game state ---------------------------------------------------------
    var board, turnPlayer, history, legalMoves;
    var aiFlags = [false, false];
    var aiGen = 0, clock = 0;
    var state, result;
    var passing = 0;      // player number whose turn was skipped (display only)
    var passShown = 0;    // clock value when passing was set (for toast timeout)
    var flipAnims = [];   // {x, y, from, to, started} — coin-flip disc transitions

    // ---- engine wrappers ----------------------------------------------------
    function initBoard() {
      board = [];
      for (var i = 0; i < N * N; i++) board.push(0);
      board[idx(3, 3)] = 2; board[idx(4, 4)] = 2;  // P2 in the usual starting corners
      board[idx(3, 4)] = 1; board[idx(4, 3)] = 1;  // P1 in the other corners
    }

    function updateLegal() { legalMoves = getLegalMoves(board, turnPlayer); }

    // ---- flow ---------------------------------------------------------------
    function newGame() {
      initBoard();
      turnPlayer = 1;
      history = [];
      state = 'playing';
      result = null;
      passing = 0;
      flipAnims = [];
      aiGen++;
      updateLegal();
      scheduleAI();
    }

    function endGame() {
      state = 'over';
      var c = countDiscs(board);
      if (c[1] > c[2]) result = { winner: 1 };
      else if (c[2] > c[1]) result = { winner: 2 };
      else result = { draw: true };
    }

    // After a disc is placed, determine whose turn comes next.
    function advanceTurn() {
      var counts = countDiscs(board);
      if (counts[0] === 0) { endGame(); return; }

      var next = 3 - turnPlayer;
      if (getLegalMoves(board, next).length > 0) {
        turnPlayer = next;
        passing = 0;
        updateLegal();
        scheduleAI();
        return;
      }
      // next player has no moves — check if current player can still go
      if (getLegalMoves(board, turnPlayer).length === 0) { endGame(); return; }
      // current player continues; show a "P? SKIPPED" toast
      passing = next;
      passShown = clock;
      updateLegal();
      scheduleAI();
    }

    function placeDisc(x, y) {
      if (state !== 'playing') return;
      if (!isValid(board, x, y, turnPlayer)) return;
      passing = 0;
      history.push({ board: board.slice(), turn: turnPlayer });
      var p = turnPlayer;
      var flips = applyMove(board, x, y, p);
      var now = clock;
      for (var i = 0; i < flips.length; i++) {
        flipAnims.push({ x: flips[i][0], y: flips[i][1], from: 3 - p, to: p, started: now });
      }
      aiGen++;
      advanceTurn();
    }

    function undo() {
      if (!history.length) return;
      aiGen++;
      var snap = history.pop();
      board = snap.board;
      turnPlayer = snap.turn;
      state = 'playing';
      result = null;
      passing = 0;
      flipAnims = [];
      updateLegal();
      scheduleAI();
    }

    function scheduleAI() {
      if (state !== 'playing' || !aiFlags[turnPlayer - 1]) return;
      var gen = aiGen;
      window.setTimeout(function () {
        if (gen !== aiGen || state !== 'playing' || !aiFlags[turnPlayer - 1]) return;
        var mv = chooseMove(board, turnPlayer);
        if (mv) placeDisc(mv[0], mv[1]);
      }, AI_DELAY);
    }

    function toggleAI(player) {
      aiFlags[player - 1] = !aiFlags[player - 1];
      aiGen++;
      scheduleAI();
    }

    function finishToCatalogue() { window.location.href = '../../index.html'; }

    // ---- layout -------------------------------------------------------------
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
        var minPanel = clamp(Math.min(vw, vh) * 0.20, 100, 260);
        S = Math.max(60, Math.min(vh - 2 * padB, vw - 2 * minPanel));
      } else {
        panelMode = 'stacked';
        var band = clamp(vh * 0.15, 80, 180);
        S = Math.max(60, Math.min(vw - 2 * padB, vh - 2 * band));
      }
      boardLeft = (vw - S) / 2;
      boardTop  = (vh - S) / 2;
      cs = S / N;
      dr = cs * 0.42;
    }

    function cellPx(x, y) {
      return { x: boardLeft + (x + 0.5) * cs, y: boardTop + (y + 0.5) * cs };
    }

    function hitCell(px, py) {
      var col = Math.floor((px - boardLeft) / cs);
      var row = Math.floor((py - boardTop) / cs);
      if (col < 0 || col >= N || row < 0 || row >= N) return null;
      return [col, row];
    }

    // Positions for chrome elements around the board.
    function chromeLayout() {
      var unit = Math.min(vw, vh);
      var bw = clamp(unit * (panelMode === 'wide' ? 0.16 : 0.13), 64, 168);
      var bh = clamp(unit * 0.055, 28, 46);
      if (panelMode === 'wide') {
        var lw = boardLeft, rw = vw - (boardLeft + S);
        var by0 = boardTop, by1 = boardTop + S;
        var cxL = lw / 2, cxR = boardLeft + S + rw / 2;
        var gap = clamp(unit * 0.03, 10, 30);
        var pw = clamp(Math.min(lw, rw) * 0.86, 80, 220);
        var ph = clamp(unit * 0.24, 80, 180);
        var midY = by0 + (by1 - by0) / 2 - ph / 2;
        return {
          mode: 'wide',
          finish:  { x: cxL - bw / 2, y: by0 + gap, w: bw, h: bh },
          newGame: { x: cxR - bw / 2, y: by0 + gap, w: bw, h: bh },
          undo:    { x: cxR - bw / 2, y: by1 - gap - bh, w: bw, h: bh },
          p1: { x: cxL - pw / 2, y: midY, w: pw, h: ph },
          p2: { x: cxR - pw / 2, y: midY, w: pw, h: ph },
        };
      }
      // stacked
      var tb1 = boardTop, bb0 = boardTop + S;
      var cx   = vw / 2;
      var mgx  = clamp(vw * 0.03, 8, 26);
      var mgy  = clamp(tb1 * 0.14, 6, 20);
      var pw2  = clamp(vw * 0.65, 160, Math.min(unit * 0.85, 360));
      var ph2  = clamp(tb1 * 0.52, 52, 110);
      return {
        mode: 'stacked',
        finish:  { x: mgx, y: mgy, w: bw, h: bh },
        newGame: { x: vw - mgx - bw, y: mgy, w: bw, h: bh },
        undo:    null,
        p1: { x: cx - pw2 / 2, y: tb1 - ph2 - mgy, w: pw2, h: ph2 },
        p2: { x: cx - pw2 / 2, y: bb0 + (vh - bb0) / 2 - ph2 / 2, w: pw2, h: ph2 },
      };
    }

    // Three-section frame: [P# + robot] / [count] / [role]
    function pillLayout(b) {
      var s1 = b.h * 0.36, s2 = b.h * 0.36, s3 = b.h * 0.28;
      var is = clamp(s1 * 0.78, 20, 68);
      var lf = s1 * 0.52;
      var lw = lf * 1.28;
      var gap = is * 0.26;
      var gw = lw + gap + is;
      var sx = b.x + b.w / 2 - gw / 2;
      var cy1 = b.y + s1 / 2;
      return {
        labelFont: lf,
        labelX: sx + lw / 2, labelY: cy1,
        icon: { x: sx + lw + gap, y: cy1 - is / 2, w: is, h: is },
        countFont: Math.min(s2 * 0.68, b.w * 0.3),
        countY: b.y + s1 + s2 / 2,
        roleFont: Math.min(s3 * 0.5, b.w * 0.15),
        roleY: b.y + s1 + s2 + s3 / 2,
      };
    }

    function iconRectFor(b) { return pillLayout(b).icon; }

    function inRect(px, py, b) {
      return b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
    }

    // ---- touch input --------------------------------------------------------
    var anchors = Object.create(null);

    NG.createTouch(canvas, {
      onDown: function (pt) {
        anchors[pt.id] = { sx: pt.x, sy: pt.y, moved: false };
      },
      onMove: function (pt) {
        var a = anchors[pt.id];
        if (!a) return;
        if (Math.abs(pt.x - a.sx) > 8 || Math.abs(pt.y - a.sy) > 8) a.moved = true;
      },
      onUp: function (pt) {
        var a = anchors[pt.id];
        delete anchors[pt.id];
        if (!a || a.moved) return;

        var cl = chromeLayout();
        if (inRect(pt.x, pt.y, cl.finish))  { finishToCatalogue(); return; }
        if (inRect(pt.x, pt.y, cl.newGame)) { newGame(); return; }
        if (cl.undo && inRect(pt.x, pt.y, cl.undo)) { undo(); return; }
        if (inRect(pt.x, pt.y, iconRectFor(cl.p1))) { toggleAI(1); return; }
        if (inRect(pt.x, pt.y, iconRectFor(cl.p2))) { toggleAI(2); return; }

        if (state === 'over') { newGame(); return; }

        if (state === 'playing' && !aiFlags[turnPlayer - 1]) {
          var cell = hitCell(pt.x, pt.y);
          if (cell) placeDisc(cell[0], cell[1]);
        }
      },
    });

    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === 'n') { newGame(); ev.preventDefault(); }
      if (k === 'u') { undo();    ev.preventDefault(); }
      if (state === 'over' && (k === 'enter' || k === ' ')) { newGame(); ev.preventDefault(); }
    });

    NG.onExit(finishToCatalogue);

    // ---- drawing helpers ----------------------------------------------------
    function rrect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y,     x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x,     y + h, r);
      ctx.arcTo(x,     y + h, x,     y,     r);
      ctx.arcTo(x,     y,     x + w, y,     r);
      ctx.closePath();
    }

    function rgba(p, a) {
      var c = p === 1 ? RGB1 : RGB2;
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    }
    function hex(p) { return p === 1 ? FG : P2C; }

    // ---- board --------------------------------------------------------------
    function drawBoard() {
      ctx.fillStyle = BOARD_BG;
      rrect(boardLeft, boardTop, S, S, cs * 0.25);
      ctx.fill();

      // thin grid
      ctx.strokeStyle = 'rgba(29,94,56,0.6)';
      ctx.lineWidth = Math.max(0.5, cs * 0.035);
      var i;
      for (i = 0; i <= N; i++) {
        var xp = boardLeft + i * cs, yp = boardTop + i * cs;
        ctx.beginPath(); ctx.moveTo(xp, boardTop);     ctx.lineTo(xp, boardTop + S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(boardLeft, yp);    ctx.lineTo(boardLeft + S, yp); ctx.stroke();
      }

      // centre dot markers (traditional Reversi / Othello)
      var dots = [[2,2],[5,2],[2,5],[5,5]];
      ctx.fillStyle = 'rgba(77,255,136,0.25)';
      for (i = 0; i < dots.length; i++) {
        var dc = cellPx(dots[i][0] + 0.5, dots[i][1] + 0.5);
        ctx.beginPath(); ctx.arc(dc.x - cs * 0.5, dc.y - cs * 0.5, Math.max(2, cs * 0.08), 0, Math.PI * 2); ctx.fill();
      }

      // board border
      ctx.strokeStyle = DIM;
      ctx.lineWidth = Math.max(2, cs * 0.09);
      rrect(boardLeft, boardTop, S, S, cs * 0.25);
      ctx.stroke();
    }

    // Draw one disc at cell (x,y) with an optional horizontal scale (for flip anim).
    function drawDiscAt(x, y, player, scaleX) {
      var c = cellPx(x, y), rr = dr;
      var col  = hex(player);
      var hiC  = player === 1 ? 'rgba(200,255,220,0.92)' : 'rgba(255,248,205,0.92)';
      var loC  = player === 1 ? '#1a874a' : '#b8912e';
      var edgeC = player === 1 ? '#0c5130' : '#7a5010';

      if (scaleX !== undefined && Math.abs(scaleX) < 0.99) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(scaleX, 1);
        ctx.translate(-c.x, -c.y);
      }

      var grad = ctx.createRadialGradient(
        c.x - rr * 0.3, c.y - rr * 0.32, rr * 0.06,
        c.x, c.y, rr
      );
      grad.addColorStop(0, hiC);
      grad.addColorStop(0.48, col);
      grad.addColorStop(1, loC);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = edgeC;
      ctx.lineWidth = Math.max(1, cs * 0.055);
      ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.stroke();

      if (scaleX !== undefined && Math.abs(scaleX) < 0.99) ctx.restore();
    }

    function drawDiscs() {
      var FLIP_DUR = 0.38;
      var flipping = Object.create(null);
      var i;
      for (i = 0; i < flipAnims.length; i++) {
        var fa = flipAnims[i];
        var t = (clock - fa.started) / FLIP_DUR;
        flipping[fa.x + ',' + fa.y] = { fa: fa, t: t };
      }
      // Expire completed animations
      flipAnims = flipAnims.filter(function (fa) {
        return (clock - fa.started) / FLIP_DUR < 1;
      });

      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var v = board[idx(x, y)];
          if (v === 0) continue;
          var key = x + ',' + y;
          var anim = flipping[key];
          if (anim) {
            var t = anim.t;
            if (t < 0.5) {
              // Phase 1: squeeze outward (original colour visible)
              drawDiscAt(x, y, anim.fa.from, 1 - t * 2);
            } else {
              // Phase 2: expand back (new colour)
              drawDiscAt(x, y, anim.fa.to, (t - 0.5) * 2);
            }
          } else {
            drawDiscAt(x, y, v);
          }
        }
      }
    }

    // Translucent dots showing where the current player can legally move.
    function drawLegalHints() {
      if (state !== 'playing') return;
      if (aiFlags[turnPlayer - 1]) return;
      var col = rgba(turnPlayer, 0.28);
      ctx.fillStyle = col;
      for (var i = 0; i < legalMoves.length; i++) {
        var c = cellPx(legalMoves[i][0], legalMoves[i][1]);
        ctx.beginPath(); ctx.arc(c.x, c.y, dr * 0.33, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ---- robot icon ---------------------------------------------------------
    function drawRobot(ic, color, active) {
      var cx = ic.x + ic.w / 2, cy = ic.y + ic.h / 2, s = ic.w * 0.42;
      ctx.globalAlpha = active ? 1 : 0.52;
      ctx.lineWidth = Math.max(1.5, s * 0.16);
      ctx.strokeStyle = color;
      // antenna
      ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.56); ctx.lineTo(cx, cy - s * 1.1); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy - s * 1.22, Math.max(1.5, s * 0.16), 0, Math.PI * 2); ctx.fill();
      // head
      var hw = s * 1.5, hh = s * 1.25;
      var hx = cx - hw / 2, hy = cy - s * 0.56;
      ctx.fillStyle = active ? color : 'rgba(255,255,255,0.04)';
      rrect(hx, hy, hw, hh, s * 0.32); ctx.fill(); ctx.stroke();
      // face
      var face = active ? BOARD_BG : color;
      ctx.fillStyle = face;
      ctx.beginPath(); ctx.arc(cx - s * 0.4, cy + s * 0.08, s * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + s * 0.4, cy + s * 0.08, s * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = face; ctx.lineWidth = Math.max(1, s * 0.14);
      ctx.beginPath(); ctx.moveTo(cx - s * 0.34, cy + s * 0.54); ctx.lineTo(cx + s * 0.34, cy + s * 0.54); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- player frame -------------------------------------------------------
    function roleText(player) {
      if (aiFlags[player - 1]) {
        return (state === 'playing' && turnPlayer === player) ? 'THINKING…' : 'COMPUTER';
      }
      return 'YOU';
    }

    function drawPill(b, player) {
      var col = hex(player);
      var isTurn = state === 'playing' && turnPlayer === player;
      ctx.globalAlpha = isTurn ? 1 : 0.52;
      ctx.strokeStyle = col;
      ctx.lineWidth = isTurn ? 3 : 1.5;
      ctx.fillStyle = isTurn ? rgba(player, 0.07) : 'rgba(255,255,255,0.02)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.2);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      var pl = pillLayout(b);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = isTurn ? 1 : 0.72;

      // Line 1: P# + robot icon
      ctx.fillStyle = col;
      ctx.font = 'bold ' + pl.labelFont.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('P' + player, pl.labelX, pl.labelY);
      drawRobot(pl.icon, col, aiFlags[player - 1]);

      // Line 2: disc count
      var c = countDiscs(board);
      ctx.fillStyle = col;
      ctx.font = 'bold ' + pl.countFont.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('' + c[player], b.x + b.w / 2, pl.countY);

      // Line 3: role
      ctx.fillStyle = aiFlags[player - 1] ? col : MUTED;
      ctx.font = 'bold ' + pl.roleFont.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(roleText(player), b.x + b.w / 2, pl.roleY);
      ctx.globalAlpha = 1;
    }

    // ---- buttons ------------------------------------------------------------
    function drawButton(b, label, enabled) {
      if (!b) return;
      ctx.globalAlpha = enabled ? 1 : 0.3;
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

    // ---- "P? SKIPPED" toast -------------------------------------------------
    function drawPassToast() {
      if (!passing) return;
      var age = clock - passShown;
      if (age > 2.5) return;
      var alpha = age > 2.0 ? 1 - (age - 2.0) / 0.5 : 1;
      var unit = Math.min(vw, vh);
      var fs = clamp(unit * 0.038, 14, 28);
      var msg = 'P' + passing + ' HAS NO MOVES';
      ctx.save();
      ctx.globalAlpha = alpha * 0.92;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + fs + 'px "Courier New", monospace';
      var tw = ctx.measureText(msg).width;
      var px = vw / 2, py = boardTop + S / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      rrect(px - tw / 2 - 16, py - fs * 0.8, tw + 32, fs * 1.6, fs * 0.4);
      ctx.fill();
      ctx.fillStyle = hex(passing);
      ctx.fillText(msg, px, py);
      ctx.restore();
    }

    // ---- chrome (all non-board elements) ------------------------------------
    function drawChrome(cl) {
      drawPill(cl.p1, 1);
      drawPill(cl.p2, 2);
      drawButton(cl.finish,  'FINISH', true);
      drawButton(cl.newGame, 'NEW',    true);
      drawButton(cl.undo,    'UNDO',   history.length > 0);
    }

    // ---- game-over overlay --------------------------------------------------
    function drawOver() {
      ctx.fillStyle = 'rgba(0,0,0,0.52)';
      ctx.fillRect(0, 0, vw, vh);

      var unit = Math.min(vw, vh);
      var cx = vw / 2, cy = vh / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      if (result.draw) {
        ctx.fillStyle = INK;
        ctx.font = 'bold ' + (unit * 0.1).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('DRAW', cx, cy - unit * 0.045);
      } else {
        var col = hex(result.winner);
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = unit * 0.025;
        ctx.font = 'bold ' + (unit * 0.09).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('PLAYER ' + result.winner + ' WINS', cx, cy - unit * 0.05);
        ctx.shadowBlur = 0;
      }

      var pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
      ctx.globalAlpha = pulse;
      ctx.fillStyle = INK;
      ctx.font = 'bold ' + (unit * 0.04).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('TAP TO PLAY AGAIN', cx, cy + unit * 0.055);
      ctx.globalAlpha = 1;
    }

    // ---- main draw ----------------------------------------------------------
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

      drawBoard();
      drawDiscs();
      drawLegalHints();
      drawChrome(chromeLayout());
      drawPassToast();
      if (state === 'over') drawOver();
    }

    // ---- boot ---------------------------------------------------------------
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
