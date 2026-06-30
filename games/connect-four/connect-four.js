/*
 * Connect Four — drop discs to connect four in a row.
 * 7 columns x 6 rows, fixed-ratio letterbox layout (same family as Reversi /
 * Gomoku / Minesweeper). Tap a column to drop your disc; it falls to the lowest
 * empty slot. Win by lining up four horizontally, vertically, or diagonally.
 *
 * Two robot-icon toggles let each side be YOU or COMPUTER — so it covers solo
 * play, pass-and-play, and computer-vs-computer on one board.
 *
 * AI: minimax with alpha-beta pruning (depth 6), centre-first move ordering and
 * an immediate-win cutoff, scoring open 2s / 3s in every length-4 window plus a
 * centre-column preference. Wins/losses are detected per-move (no full re-scan).
 */
(function () {
  'use strict';

  // ---- palette --------------------------------------------------------------
  var FG    = '#4dff88';    // chrome accent — phosphor green
  var INK   = '#d6f7e4';
  var MUTED = '#6b7a72';
  var REDC  = '#ff5366';    // P1 — red disc
  var YELC  = '#ffd24d';    // P2 — yellow disc
  var RGB1  = [255, 83, 102];
  var RGB2  = [255, 210, 77];
  var BOARD_BG = '#0c2f4a';   // deep blue board panel (classic Connect Four)
  var HOLE_BG  = '#06121d';   // empty slot

  // ---- constants ------------------------------------------------------------
  var COLS = 7, ROWS = 6, NCELL = COLS * ROWS;
  var AI_DELAY = 460;   // ms pause before the computer plays
  var AI_DEPTH = 6;     // minimax half-moves (plies)
  var WIN = 100000;     // terminal score magnitude
  var COL_ORDER = [3, 2, 4, 1, 5, 0, 6];  // centre-first move ordering

  function idx(col, row) { return row * COLS + col; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Precompute every length-4 window (as index quads) for the evaluator.
  var WINDOWS = (function () {
    var out = [], c, r, i, q;
    for (r = 0; r < ROWS; r++)            // horizontal
      for (c = 0; c <= COLS - 4; c++) {
        q = []; for (i = 0; i < 4; i++) q.push(idx(c + i, r)); out.push(q);
      }
    for (c = 0; c < COLS; c++)            // vertical
      for (r = 0; r <= ROWS - 4; r++) {
        q = []; for (i = 0; i < 4; i++) q.push(idx(c, r + i)); out.push(q);
      }
    for (c = 0; c <= COLS - 4; c++)       // diagonal down-right
      for (r = 0; r <= ROWS - 4; r++) {
        q = []; for (i = 0; i < 4; i++) q.push(idx(c + i, r + i)); out.push(q);
      }
    for (c = 0; c <= COLS - 4; c++)       // diagonal up-right
      for (r = 3; r < ROWS; r++) {
        q = []; for (i = 0; i < 4; i++) q.push(idx(c + i, r - i)); out.push(q);
      }
    return out;
  })();

  // ===========================================================================
  // ENGINE — pure functions over a flat array: 0=empty, 1=P1(red), 2=P2(yellow)
  // ===========================================================================

  // Lowest empty row in a column (bottom = ROWS-1), or -1 if the column is full.
  function dropRow(board, col) {
    for (var r = ROWS - 1; r >= 0; r--) if (board[idx(col, r)] === 0) return r;
    return -1;
  }

  function legalCols(board) {
    var out = [];
    for (var i = 0; i < COL_ORDER.length; i++) {
      var c = COL_ORDER[i];
      if (board[idx(c, 0)] === 0) out.push(c);
    }
    return out;
  }

  function boardFull(board) {
    for (var c = 0; c < COLS; c++) if (board[idx(c, 0)] === 0) return false;
    return true;
  }

  // The connected line of >=4 same-colour discs through (col,row), or null.
  var LINE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  function winningCellsAt(board, col, row, p) {
    for (var d = 0; d < LINE_DIRS.length; d++) {
      var dx = LINE_DIRS[d][0], dy = LINE_DIRS[d][1];
      var cells = [[col, row]];
      var cx = col + dx, cy = row + dy;
      while (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && board[idx(cx, cy)] === p) {
        cells.push([cx, cy]); cx += dx; cy += dy;
      }
      cx = col - dx; cy = row - dy;
      while (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && board[idx(cx, cy)] === p) {
        cells.push([cx, cy]); cx -= dx; cy -= dy;
      }
      if (cells.length >= 4) return cells;
    }
    return null;
  }

  // Static heuristic from the maximising player's point of view.
  function evaluate(board, me) {
    var opp = 3 - me, score = 0, i, j;
    // centre-column control
    for (i = 0; i < ROWS; i++) if (board[idx(3, i)] === me) score += 6;
    for (i = 0; i < WINDOWS.length; i++) {
      var w = WINDOWS[i], cm = 0, co = 0;
      for (j = 0; j < 4; j++) {
        var v = board[w[j]];
        if (v === me) cm++; else if (v === opp) co++;
      }
      if (cm > 0 && co > 0) continue;        // contested window — dead
      if (cm === 4) score += WIN;
      else if (cm === 3) score += 50;
      else if (cm === 2) score += 10;
      else if (co === 4) score -= WIN;
      else if (co === 3) score -= 80;         // weight defence a touch higher
      else if (co === 2) score -= 8;
    }
    return score;
  }

  // depth = plies remaining; winning sooner (larger depth) scores higher.
  function minimax(board, depth, alpha, beta, maximizing, me) {
    var moves = legalCols(board);
    if (moves.length === 0) return 0;          // full board — draw
    if (depth === 0) return evaluate(board, me);

    var p = maximizing ? me : 3 - me, i, row, v;
    if (maximizing) {
      var best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        row = dropRow(board, moves[i]);
        board[idx(moves[i], row)] = p;
        if (winningCellsAt(board, moves[i], row, p)) v = WIN + depth;
        else v = minimax(board, depth - 1, alpha, beta, false, me);
        board[idx(moves[i], row)] = 0;
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    } else {
      var worst = Infinity;
      for (i = 0; i < moves.length; i++) {
        row = dropRow(board, moves[i]);
        board[idx(moves[i], row)] = p;
        if (winningCellsAt(board, moves[i], row, p)) v = -(WIN + depth);
        else v = minimax(board, depth - 1, alpha, beta, true, me);
        board[idx(moves[i], row)] = 0;
        if (v < worst) worst = v;
        if (worst < beta) beta = worst;
        if (alpha >= beta) break;
      }
      return worst;
    }
  }

  function chooseMove(board, me) {
    var moves = legalCols(board);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    var best = moves[0], bestScore = -Infinity, i, row, score;
    for (i = 0; i < moves.length; i++) {
      row = dropRow(board, moves[i]);
      board[idx(moves[i], row)] = me;
      if (winningCellsAt(board, moves[i], row, me)) score = WIN + AI_DEPTH;
      else score = minimax(board, AI_DEPTH - 1, -Infinity, Infinity, false, me);
      board[idx(moves[i], row)] = 0;
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
    var cs = 0, dr = 0;                 // cell size, disc radius
    var boardW = 0, boardH = 0, boardLeft = 0, boardTop = 0;
    var panelMode = 'wide';             // 'wide' (side panels) | 'stacked' (bands)

    // ---- game state ---------------------------------------------------------
    var board, turnPlayer, history;
    var aiFlags = [false, false];
    var aiGen = 0, clock = 0;
    var state, result;                  // 'playing' | 'over' ; result {winner|draw, cells}
    var scores = [0, 0, 0];
    var scored = false;
    var dropAnims = [];                 // {col, row, player, started}
    var hoverCol = -1;

    var GRAV = 56;        // gravity in cell-units / s^2
    var BOUNCE = 0.16;    // restitution for the single landing bounce

    // ---- engine wrappers ----------------------------------------------------
    function initBoard() {
      board = [];
      for (var i = 0; i < NCELL; i++) board.push(0);
    }

    // ---- flow ---------------------------------------------------------------
    function newGame() {
      initBoard();
      turnPlayer = 1;
      history = [];
      state = 'playing';
      result = null;
      scored = false;
      dropAnims = [];
      hoverCol = -1;
      aiGen++;
      NG.setPlaying(true);
      scheduleAI();
    }

    function recordResult(res) {
      result = res;
      state = 'over';
      NG.setPlaying(false);
      if (!scored) {
        scored = true;
        if (res.winner) scores[res.winner]++;
      }
    }

    function placeDisc(col) {
      if (state !== 'playing') return;
      var row = dropRow(board, col);
      if (row < 0) return;            // column full
      history.push({ board: board.slice(), turn: turnPlayer });
      var p = turnPlayer;
      board[idx(col, row)] = p;
      dropAnims.push({ col: col, row: row, player: p, started: clock });
      aiGen++;

      var cells = winningCellsAt(board, col, row, p);
      if (cells) { recordResult({ winner: p, cells: cells }); return; }
      if (boardFull(board)) { recordResult({ draw: true }); return; }

      turnPlayer = 3 - turnPlayer;
      scheduleAI();
    }

    function undo() {
      if (!history.length) return;
      aiGen++;
      var snap = history.pop();
      board = snap.board;
      turnPlayer = snap.turn;
      state = 'playing';
      result = null;
      scored = false;
      dropAnims = [];
      NG.setPlaying(true);
      scheduleAI();
    }

    function scheduleAI() {
      if (state !== 'playing' || !aiFlags[turnPlayer - 1]) return;
      var gen = aiGen;
      window.setTimeout(function () {
        if (gen !== aiGen || state !== 'playing' || !aiFlags[turnPlayer - 1]) return;
        var mv = chooseMove(board, turnPlayer);
        if (mv != null) placeDisc(mv);
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
      var availW, availH;
      if (vw >= vh) {
        panelMode = 'wide';
        var minPanel = clamp(Math.min(vw, vh) * 0.20, 96, 240);
        availW = vw - 2 * minPanel;
        availH = vh - 2 * padB;
      } else {
        panelMode = 'stacked';
        var band = clamp(vh * 0.15, 80, 180);
        availW = vw - 2 * padB;
        availH = vh - 2 * band;
      }
      // Leave headroom above the grid for the drop preview / falling channel.
      cs = Math.max(20, Math.min(availW / COLS, (availH) / (ROWS + 0.6)));
      boardW = cs * COLS;
      boardH = cs * ROWS;
      boardLeft = (vw - boardW) / 2;
      // Bias the board down a little so a hover disc fits above it.
      boardTop = (vh - boardH) / 2 + cs * 0.3;
      dr = cs * 0.40;
    }

    function cellPx(col, row) {
      return { x: boardLeft + (col + 0.5) * cs, y: boardTop + (row + 0.5) * cs };
    }

    // Which column does a tap fall into? Accepts taps on the board or just above
    // it (the drop channel). Returns a column index or -1.
    function hitColumn(px, py) {
      if (px < boardLeft || px > boardLeft + boardW) return -1;
      if (py < boardTop - cs * 1.2 || py > boardTop + boardH) return -1;
      var c = Math.floor((px - boardLeft) / cs);
      return (c >= 0 && c < COLS) ? c : -1;
    }

    // Positions for chrome elements around the board.
    function chromeLayout() {
      var unit = Math.min(vw, vh);
      var bw = clamp(unit * (panelMode === 'wide' ? 0.16 : 0.13), 64, 168);
      var bh = clamp(unit * 0.055, 28, 46);
      if (panelMode === 'wide') {
        var lw = boardLeft, rw = vw - (boardLeft + boardW);
        var by0 = boardTop, by1 = boardTop + boardH;
        var cxL = lw / 2, cxR = boardLeft + boardW + rw / 2;
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
      // stacked (portrait)
      var tb1 = boardTop, bb0 = boardTop + boardH;
      var cx   = vw / 2;
      var mgx  = clamp(vw * 0.03, 8, 26);
      var mgy  = clamp(tb1 * 0.12, 6, 20);
      var pw2  = clamp(vw * 0.40, 130, Math.min(unit * 0.9, 320));
      var ph2  = clamp(tb1 * 0.5, 52, 110);
      return {
        mode: 'stacked',
        finish:  { x: mgx, y: mgy, w: bw, h: bh },
        newGame: { x: vw - mgx - bw, y: mgy, w: bw, h: bh },
        undo:    { x: cx - bw / 2, y: bb0 + (vh - bb0) / 2 - bh / 2, w: bw, h: bh },
        p1: { x: cx - pw2 - mgx * 0.5, y: tb1 - ph2 - mgy, w: pw2, h: ph2 },
        p2: { x: cx + mgx * 0.5, y: tb1 - ph2 - mgy, w: pw2, h: ph2 },
      };
    }

    // Three-section frame: [P# + robot] / [score] / [role]
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

    function updateHover(px, py) {
      if (state === 'playing' && !aiFlags[turnPlayer - 1]) {
        var c = hitColumn(px, py);
        hoverCol = (c >= 0 && dropRow(board, c) >= 0) ? c : -1;
      } else {
        hoverCol = -1;
      }
    }

    NG.createTouch(canvas, {
      onDown: function (pt) {
        anchors[pt.id] = { sx: pt.x, sy: pt.y, moved: false };
        updateHover(pt.x, pt.y);
      },
      onMove: function (pt) {
        var a = anchors[pt.id];
        if (a && (Math.abs(pt.x - a.sx) > 8 || Math.abs(pt.y - a.sy) > 8)) a.moved = true;
        updateHover(pt.x, pt.y);
      },
      onUp: function (pt) {
        var a = anchors[pt.id];
        delete anchors[pt.id];
        hoverCol = -1;
        if (!a || a.moved) return;

        var cl = chromeLayout();
        if (inRect(pt.x, pt.y, cl.finish))  { finishToCatalogue(); return; }
        if (inRect(pt.x, pt.y, cl.newGame)) { newGame(); return; }
        if (cl.undo && inRect(pt.x, pt.y, cl.undo)) { undo(); return; }
        if (inRect(pt.x, pt.y, iconRectFor(cl.p1))) { toggleAI(1); return; }
        if (inRect(pt.x, pt.y, iconRectFor(cl.p2))) { toggleAI(2); return; }

        if (state === 'over') { newGame(); return; }

        if (state === 'playing' && !aiFlags[turnPlayer - 1]) {
          var col = hitColumn(pt.x, pt.y);
          if (col >= 0) placeDisc(col);
        }
      },
    });

    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === 'n') { newGame(); ev.preventDefault(); return; }
      if (k === 'u') { undo();    ev.preventDefault(); return; }
      if (state === 'over' && (k === 'enter' || k === ' ')) { newGame(); ev.preventDefault(); return; }
      // digit 1-7 drops into that column (desktop convenience)
      if (state === 'playing' && !aiFlags[turnPlayer - 1] && k >= '1' && k <= '7') {
        placeDisc(parseInt(k, 10) - 1); ev.preventDefault();
      }
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
    function hex(p) { return p === 1 ? REDC : YELC; }

    // A filled disc centred at (px,py).
    function drawDisc(px, py, player, rr) {
      var col  = hex(player);
      var hiC  = player === 1 ? 'rgba(255,210,215,0.95)' : 'rgba(255,248,205,0.95)';
      var loC  = player === 1 ? '#a31f30' : '#b8912e';
      var edgeC = player === 1 ? '#6e0f1b' : '#7a5010';
      var grad = ctx.createRadialGradient(
        px - rr * 0.3, py - rr * 0.32, rr * 0.06, px, py, rr
      );
      grad.addColorStop(0, hiC);
      grad.addColorStop(0.48, col);
      grad.addColorStop(1, loC);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = edgeC;
      ctx.lineWidth = Math.max(1, cs * 0.05);
      ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.stroke();
    }

    // Current visual y-centre of a falling disc, and whether it has settled.
    function dropY(anim) {
      var targetY = cellPx(anim.col, anim.row).y;
      var startY  = boardTop - cs * 0.5;       // just above the top of the grid
      var dist = (targetY - startY) / cs;      // fall distance in cell units
      var tFall = Math.sqrt(2 * dist / GRAV);
      var el = clock - anim.started;
      if (el < tFall) {
        return { y: startY + 0.5 * GRAV * el * el * cs, done: false };
      }
      // single damped bounce
      var vImpact = GRAV * tFall;              // cell-units / s
      var tb = (2 * vImpact * BOUNCE) / GRAV;
      var tau = el - tFall;
      if (tau < tb) {
        var rise = (vImpact * BOUNCE) * tau - 0.5 * GRAV * tau * tau; // cell units
        return { y: targetY - rise * cs, done: false };
      }
      return { y: targetY, done: true };
    }

    // ---- board --------------------------------------------------------------
    function drawBoard() {
      // animating cells render their disc in the channel, not in the slot yet
      var animSet = Object.create(null);
      var i;
      for (i = 0; i < dropAnims.length; i++) {
        animSet[dropAnims[i].col + ',' + dropAnims[i].row] = true;
      }

      // outer frame glow
      var fr = cs * 0.32;
      ctx.fillStyle = BOARD_BG;
      rrect(boardLeft - cs * 0.12, boardTop - cs * 0.12,
            boardW + cs * 0.24, boardH + cs * 0.24, fr);
      ctx.fill();
      ctx.strokeStyle = 'rgba(77,255,136,0.45)';
      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.stroke();

      // holes + settled discs
      for (var row = 0; row < ROWS; row++) {
        for (var col = 0; col < COLS; col++) {
          var c = cellPx(col, row);
          var v = board[idx(col, row)];
          if (v === 0 || animSet[col + ',' + row]) {
            // empty hole
            ctx.fillStyle = HOLE_BG;
            ctx.beginPath(); ctx.arc(c.x, c.y, dr, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.45)';
            ctx.lineWidth = Math.max(1, cs * 0.04);
            ctx.beginPath(); ctx.arc(c.x, c.y, dr, 0, Math.PI * 2); ctx.stroke();
          } else {
            drawDisc(c.x, c.y, v, dr);
          }
        }
      }
    }

    // Falling discs travelling down the channel.
    function drawDrops() {
      var still = [];
      for (var i = 0; i < dropAnims.length; i++) {
        var a = dropAnims[i];
        var d = dropY(a);
        var c = cellPx(a.col, a.row);
        drawDisc(c.x, d.y, a.player, dr);
        if (!d.done) still.push(a);
      }
      dropAnims = still;
    }

    // Translucent disc hovering over the column the player is about to drop into.
    function drawHover() {
      if (state !== 'playing' || hoverCol < 0) return;
      if (aiFlags[turnPlayer - 1]) return;
      var px = boardLeft + (hoverCol + 0.5) * cs;
      var py = boardTop - cs * 0.55;
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(clock * 4);
      drawDisc(px, py, turnPlayer, dr * 0.92);
      ctx.globalAlpha = 1;
    }

    // Pulsing rings around the four winning discs.
    function drawWinHighlight() {
      if (!result || !result.cells) return;
      var pulse = 0.5 + 0.5 * Math.abs(Math.sin(clock * 3.2));
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.45 * pulse) + ')';
      ctx.lineWidth = Math.max(2, cs * 0.09);
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = cs * 0.3 * pulse;
      for (var i = 0; i < result.cells.length; i++) {
        var c = cellPx(result.cells[i][0], result.cells[i][1]);
        ctx.beginPath(); ctx.arc(c.x, c.y, dr * 1.02, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    // ---- robot icon ---------------------------------------------------------
    function drawRobot(ic, color, active) {
      var cx = ic.x + ic.w / 2, cy = ic.y + ic.h / 2, s = ic.w * 0.42;
      ctx.globalAlpha = active ? 1 : 0.52;
      ctx.lineWidth = Math.max(1.5, s * 0.16);
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.56); ctx.lineTo(cx, cy - s * 1.1); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy - s * 1.22, Math.max(1.5, s * 0.16), 0, Math.PI * 2); ctx.fill();
      var hw = s * 1.5, hh = s * 1.25;
      var hx = cx - hw / 2, hy = cy - s * 0.56;
      ctx.fillStyle = active ? color : 'rgba(255,255,255,0.04)';
      rrect(hx, hy, hw, hh, s * 0.32); ctx.fill(); ctx.stroke();
      var face = active ? '#0c2f4a' : color;
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
      ctx.fillStyle = isTurn ? rgba(player, 0.08) : 'rgba(255,255,255,0.02)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.2);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      var pl = pillLayout(b);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = isTurn ? 1 : 0.72;

      ctx.fillStyle = col;
      ctx.font = 'bold ' + pl.labelFont.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('P' + player, pl.labelX, pl.labelY);
      drawRobot(pl.icon, col, aiFlags[player - 1]);

      ctx.fillStyle = col;
      ctx.font = 'bold ' + pl.countFont.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('' + scores[player], b.x + b.w / 2, pl.countY);

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
      drawDrops();
      drawHover();
      drawWinHighlight();
      drawChrome(chromeLayout());
      // Wait for the winning/last disc to settle before dimming the board.
      if (state === 'over' && dropAnims.length === 0) drawOver();
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
