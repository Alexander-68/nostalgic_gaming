/*
 * Sudoku — fill every row, column and 3×3 box with the digits 1–9.
 *
 * Follows the catalogue conventions:
 *   - classic script (no modules), runs from file://
 *   - fixed-ratio letterbox: the 9×9 grid is a square; chrome lives in the
 *     leftover space (side panels in landscape, top/bottom bands in portrait).
 *   - touch-first: tap a cell to select it, then tap the number pad to fill.
 *     ERASE clears the cell; FILL/NOTES toggle switches between placing digits
 *     and pencilling in candidates.
 *   - three difficulties (EASY / MED / HARD), each generating a puzzle with a
 *     unique solution via backtracking + MRV + uniqueness verification.
 *
 * Keyboard (desktop dev): arrows to navigate, 1–9 to fill, Del to erase,
 * N for new game, F to toggle fill/notes mode, D to cycle difficulty.
 */
(function () {
  'use strict';

  // ---- palette (matches the catalogue's phosphor look) ----------------------
  var FG    = '#4dff88';   // phosphor green — primary
  var DIM   = '#1d5e38';   // board grid lines / ambient
  var INK   = '#d6f7e4';   // neutral text (given digits)
  var MUTED = '#6b7a72';   // secondary / readouts
  var ERR   = '#ff5d6c';   // conflict red
  var AMBER = '#ffcf4d';   // notes-mode accent
  var PANEL = '#0a1410';   // board backing

  var DIFFS = [
    { key: 'EASY', givens: 46 },
    { key: 'MED',  givens: 32 },
    { key: 'HARD', givens: 24 },
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ===========================================================================
  // ENGINE — pure sudoku logic, no DOM.
  // ===========================================================================

  function canPlace(grid, row, col, num) {
    var i, br, bc, dr, dc;
    for (i = 0; i < 9; i++) if (grid[row*9+i] === num) return false;
    for (i = 0; i < 9; i++) if (grid[i*9+col] === num) return false;
    br = ((row/3)|0)*3; bc = ((col/3)|0)*3;
    for (dr = 0; dr < 3; dr++)
      for (dc = 0; dc < 3; dc++)
        if (grid[(br+dr)*9+(bc+dc)] === num) return false;
    return true;
  }

  function shuffle(arr) {
    var i, j, t;
    for (i = arr.length - 1; i > 0; i--) {
      j = (Math.random() * (i+1)) | 0;
      t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Backtracking solver with MRV (minimum remaining values) heuristic.
  // Fills `grid` in place; returns true when a solution is found.
  // `randomize` shuffles candidates so each call produces a different solution.
  function solveGrid(grid, randomize) {
    var best = -1, bestCnt = 10, i, r, c, n, cnt;
    for (i = 0; i < 81; i++) {
      if (grid[i] !== 0) continue;
      r = (i/9)|0; c = i%9; cnt = 0;
      for (n = 1; n <= 9; n++) if (canPlace(grid, r, c, n)) cnt++;
      if (cnt === 0) return false;
      if (cnt < bestCnt) { bestCnt = cnt; best = i; }
    }
    if (best === -1) return true; // all cells filled — solved
    r = (best/9)|0; c = best%9;
    var nums = [1,2,3,4,5,6,7,8,9];
    if (randomize) shuffle(nums);
    for (i = 0; i < 9; i++) {
      if (canPlace(grid, r, c, nums[i])) {
        grid[best] = nums[i];
        if (solveGrid(grid, randomize)) return true;
        grid[best] = 0;
      }
    }
    return false;
  }

  // Count distinct solutions, stopping once `limit` are found (typically 2).
  function countSolutions(grid, limit) {
    var count = 0;
    function solve(g) {
      if (count >= limit) return;
      var best = -1, bestCnt = 10, i, r, c, n, cnt;
      for (i = 0; i < 81; i++) {
        if (g[i] !== 0) continue;
        r = (i/9)|0; c = i%9; cnt = 0;
        for (n = 1; n <= 9; n++) if (canPlace(g, r, c, n)) cnt++;
        if (cnt === 0) return;
        if (cnt < bestCnt) { bestCnt = cnt; best = i; }
      }
      if (best === -1) { count++; return; }
      r = (best/9)|0; c = best%9;
      for (n = 1; n <= 9; n++) {
        if (count >= limit) return;
        if (canPlace(g, r, c, n)) {
          g[best] = n;
          solve(g);
          g[best] = 0;
        }
      }
    }
    solve(grid.slice());
    return count;
  }

  function generatePuzzle(givenCount) {
    var i, k, backup;

    // Build a complete random solution.
    var solution = [];
    for (i = 0; i < 81; i++) solution.push(0);
    solveGrid(solution, true);

    // Remove cells one by one, keeping the puzzle uniquely solvable.
    var puzzle = solution.slice();
    var positions = [];
    for (i = 0; i < 81; i++) positions.push(i);
    shuffle(positions);

    var removed = 0, target = 81 - givenCount;
    for (k = 0; k < positions.length && removed < target; k++) {
      i = positions[k];
      backup = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle, 2) !== 1) {
        puzzle[i] = backup; // restoring keeps uniqueness
      } else {
        removed++;
      }
    }

    return { puzzle: puzzle, solution: solution };
  }

  // Returns a plain object whose keys are flat indices (r*9+c) of cells that
  // violate a row, column or box constraint.
  function getConflicts(board) {
    var out = {}, r, c, v, i, rr, cc, br, bc, dr, dc;
    for (r = 0; r < 9; r++) {
      for (c = 0; c < 9; c++) {
        v = board[r*9+c];
        if (!v) continue;
        for (cc = 0; cc < 9; cc++) {
          if (cc !== c && board[r*9+cc] === v) { out[r*9+c] = true; out[r*9+cc] = true; }
        }
        for (rr = 0; rr < 9; rr++) {
          if (rr !== r && board[rr*9+c] === v) { out[r*9+c] = true; out[rr*9+c] = true; }
        }
        br = ((r/3)|0)*3; bc = ((c/3)|0)*3;
        for (dr = 0; dr < 3; dr++) {
          for (dc = 0; dc < 3; dc++) {
            rr = br+dr; cc = bc+dc;
            if ((rr !== r || cc !== c) && board[rr*9+cc] === v) {
              out[r*9+c] = true; out[rr*9+cc] = true;
            }
          }
        }
      }
    }
    return out;
  }

  function isBoardComplete(board, solution) {
    for (var i = 0; i < 81; i++) if (board[i] !== solution[i]) return false;
    return true;
  }

  // ===========================================================================
  // GAME — state, layout, input and rendering. Browser only.
  // ===========================================================================

  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- sizing / layout state -----------------------------------------------
    var vw = 0, vh = 0, drawScale = 1, lastInfo = null;
    var S = 0, cs = 0, boardLeft = 0, boardTop = 0, panelMode = 'wide';
    var animLast = 0, clock = 0;

    // ---- game state ----------------------------------------------------------
    var diffIdx = 0;
    var puzzle, solution, board, notes;
    var selected = null;       // { r, c } or null
    var gameState = 'play';    // 'play' | 'won'
    var fillMode = 'fill';     // 'fill' | 'notes'
    var conflicts = {};
    var highlightNum = 0;      // digit highlighted across the board (0 = none)
    var timerStarted = false, startClock = 0, finalTime = 0;

    function makeNotes() {
      var n = [], i, row;
      for (i = 0; i < 81; i++) {
        row = [false,false,false,false,false,false,false,false,false,false];
        n.push(row);
      }
      return n;
    }

    function newGame() {
      var gen = generatePuzzle(DIFFS[diffIdx].givens);
      puzzle   = gen.puzzle;
      solution = gen.solution;
      board    = puzzle.slice();
      notes    = makeNotes();
      selected = null;
      gameState    = 'play';
      fillMode     = 'fill';
      conflicts    = {};
      highlightNum = 0;
      timerStarted = false;
      startClock = clock;
      finalTime  = 0;
    }

    function elapsed() {
      if (!timerStarted) return 0;
      if (gameState !== 'play') return finalTime;
      return Math.floor(clock - startClock);
    }

    function isGiven(r, c) { return puzzle[r*9+c] !== 0; }

    function fillCell(r, c, n) {
      if (gameState !== 'play' || isGiven(r, c)) return;
      var cellIdx = r*9+c, i, br, bc, dr, dc;
      if (!timerStarted) { timerStarted = true; startClock = clock; }

      if (fillMode === 'notes') {
        if (n !== 0) notes[cellIdx][n] = !notes[cellIdx][n];
        return;
      }

      // Filled cells are locked — must erase before overwriting.
      if (board[cellIdx] !== 0) return;

      board[cellIdx] = n;
      // Auto-clear matching notes in same row / col / box.
      for (i = 0; i < 9; i++) { notes[r*9+i][n] = false; notes[i*9+c][n] = false; }
      br = ((r/3)|0)*3; bc = ((c/3)|0)*3;
      for (dr = 0; dr < 3; dr++)
        for (dc = 0; dc < 3; dc++) notes[(br+dr)*9+(bc+dc)][n] = false;
      for (i = 1; i <= 9; i++) notes[cellIdx][i] = false;

      conflicts = getConflicts(board);
      if (isBoardComplete(board, solution)) {
        gameState = 'won';
        finalTime = elapsed();
      }
      selected = null; // deselect after a successful fill
    }

    function eraseCell(r, c) {
      if (gameState !== 'play' || isGiven(r, c)) return;
      var cellIdx = r*9+c, i;
      board[cellIdx] = 0;
      for (i = 1; i <= 9; i++) notes[cellIdx][i] = false;
      conflicts = getConflicts(board);
    }

    function cycleDiff()  { diffIdx = (diffIdx + 1) % DIFFS.length; newGame(); }
    function goFinish()   { window.location.href = '../../index.html'; }

    // ---- layout --------------------------------------------------------------
    function layout(info) {
      lastInfo = info;
      var dpr = window.devicePixelRatio || 1;
      vw = info.width; vh = info.height;
      canvas.style.width  = vw + 'px';
      canvas.style.height = vh + 'px';
      canvas.width  = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      drawScale = dpr;

      var pad = clamp(Math.min(vw, vh) * 0.018, 4, 14);
      if (vw >= vh) {
        panelMode = 'wide';
        var minP = clamp(Math.min(vw, vh) * 0.24, 108, 300);
        S = Math.max(60, Math.min(vh - 2*pad, vw - 2*minP));
      } else {
        panelMode = 'stacked';
        var band = clamp(vh * 0.23, 108, 220);
        S = Math.max(60, Math.min(vw - 2*pad, vh - 2*band));
      }
      boardLeft = (vw - S) / 2;
      boardTop  = (vh - S) / 2;
      cs = S / 9;
    }

    function cellAt(px, py) {
      if (px < boardLeft || px >= boardLeft+S || py < boardTop || py >= boardTop+S) return null;
      var c = Math.floor((px - boardLeft) / cs);
      var r = Math.floor((py - boardTop)  / cs);
      if (r < 0 || r > 8 || c < 0 || c > 8) return null;
      return { r: r, c: c };
    }

    // ---- chrome layout -------------------------------------------------------
    // Computes positions of every interactive chrome element. Called each frame
    // so it always reflects the current viewport; cheap since it's just arithmetic.
    function chromeLayout() {
      var unit = Math.min(vw, vh);
      var gap  = clamp(unit * 0.022, 5, 18);
      var bh   = clamp(unit * 0.065, 28, 52);

      if (panelMode === 'wide') {
        var lw = boardLeft;
        var rw = vw - (boardLeft + S);
        var cxL = lw / 2;
        var cxR = boardLeft + S + rw / 2;
        var bwL = clamp(lw * 0.82, 70, 210);
        var lx  = cxL - bwL / 2;

        // Left panel (top-down): FINISH, NEW, DIFF, timer readout.
        var finish = { x: lx, y: boardTop + gap,              w: bwL, h: bh };
        var newBtn = { x: lx, y: finish.y + bh + gap,         w: bwL, h: bh };
        var diff   = { x: lx, y: newBtn.y + bh + gap,         w: bwL, h: bh };
        var timer  = { x: lx, y: diff.y   + bh + gap,         w: bwL, h: bh };

        // Right panel: 3×3 number pad, then ERASE and FILL/NOTES below.
        var halfGap = Math.floor(gap / 2);
        var numS = Math.min(Math.floor((rw * 0.82 - 2*halfGap) / 3), Math.floor(bh * 1.5), 64);
        var padW = 3*numS + 2*halfGap;
        var padX = cxR - padW / 2;
        var padTop = boardTop + gap;
        var n, row, col;
        var numPad = [];
        for (n = 1; n <= 9; n++) {
          row = ((n-1)/3)|0; col = (n-1)%3;
          numPad.push({
            n: n,
            x: padX + col*(numS+halfGap),
            y: padTop + row*(numS+halfGap),
            s: numS
          });
        }
        var padBottom = padTop + 3*(numS+halfGap) - halfGap;
        var bwR = clamp(rw * 0.82, 70, 210);
        var rx  = cxR - bwR / 2;
        var erase   = { x: rx, y: padBottom + gap,      w: bwR, h: bh };
        var modeBtn = { x: rx, y: erase.y + bh + gap/2, w: bwR, h: bh };

        return {
          panelMode: 'wide',
          finish: finish, newBtn: newBtn, diff: diff, timer: timer,
          numPad: numPad, erase: erase, modeBtn: modeBtn
        };
      }

      // ---- stacked (portrait) ------------------------------------------------
      var tb   = boardTop;
      var bb0  = boardTop + S;
      var topH = tb;
      var botH = vh - bb0;
      var mgx  = clamp(vw * 0.04, 8, 24);

      // Top band: four equal buttons in one row — FINISH | DIFF | TIMER | NEW.
      var topBtnH = clamp(topH * 0.44, 24, 48);
      var topBtnW = Math.floor((vw - 2*mgx - 3*gap) / 4);
      var topY    = topH / 2 - topBtnH / 2;
      var finish  = { x: mgx,                     y: topY, w: topBtnW, h: topBtnH };
      var diff    = { x: mgx + topBtnW + gap,      y: topY, w: topBtnW, h: topBtnH };
      var timer   = { x: mgx + 2*(topBtnW+gap),   y: topY, w: topBtnW, h: topBtnH };
      var newBtn  = { x: mgx + 3*(topBtnW+gap),   y: topY, w: topBtnW, h: topBtnH };

      // Bottom band: 5 + 5 layout (1–5 top row, 6–9 + ERASE bottom row),
      // then FILL/NOTES toggle stretching full width below.
      var numCols = 5;
      var numH    = Math.floor(botH * 0.28);
      var numW    = Math.floor((vw - 2*mgx - (numCols-1)*gap) / numCols);
      var numStartY = bb0 + clamp(botH * 0.055, 4, 12);
      var numPad = [], n, row, col;
      for (n = 1; n <= 9; n++) {
        row = (n <= 5) ? 0 : 1;
        col = (n <= 5) ? (n-1) : (n-6);
        numPad.push({
          n: n,
          x: mgx + col*(numW+gap),
          y: numStartY + row*(numH+gap),
          s: numH
        });
      }
      // ERASE occupies column 4, row 1 (alongside 6–9).
      var erase = {
        x: mgx + 4*(numW+gap),
        y: numStartY + numH + gap,
        w: numW,
        h: numH
      };
      // FILL / NOTES spans full width below both number rows.
      var modeY      = numStartY + 2*(numH+gap);
      var modeBtnH   = clamp(botH * 0.22, 22, 42);
      var modeBtn    = { x: mgx, y: modeY, w: vw - 2*mgx, h: modeBtnH };

      return {
        panelMode: 'stacked',
        finish: finish, diff: diff, timer: timer, newBtn: newBtn,
        numPad: numPad, erase: erase, modeBtn: modeBtn
      };
    }

    // ---- input ---------------------------------------------------------------
    function inRect(px, py, b) {
      return b && px >= b.x && px < b.x+b.w && py >= b.y && py < b.y+b.h;
    }
    function inSq(px, py, b) {
      return b && px >= b.x && px < b.x+b.s && py >= b.y && py < b.y+b.s;
    }

    var anchors = {};
    NG.createTouch(canvas, {
      onDown: function (pt) {
        anchors[pt.id] = { sx: pt.x, sy: pt.y, moved: false };
      },
      onMove: function (pt) {
        var a = anchors[pt.id];
        if (a && (Math.abs(pt.x-a.sx) > 8 || Math.abs(pt.y-a.sy) > 8)) a.moved = true;
      },
      onUp: function (pt) {
        var a = anchors[pt.id];
        delete anchors[pt.id];
        if (!a || a.moved) return;

        var cl = chromeLayout(), k;
        if (inRect(pt.x, pt.y, cl.finish))  { goFinish();  return; }
        if (inRect(pt.x, pt.y, cl.newBtn))  { newGame();   return; }
        if (inRect(pt.x, pt.y, cl.diff))    { cycleDiff(); return; }
        if (inRect(pt.x, pt.y, cl.modeBtn)) {
          fillMode = (fillMode === 'fill') ? 'notes' : 'fill';
          return;
        }
        if (inRect(pt.x, pt.y, cl.erase)) {
          if (selected) eraseCell(selected.r, selected.c);
          return;
        }
        for (k = 0; k < cl.numPad.length; k++) {
          if (inSq(pt.x, pt.y, cl.numPad[k])) {
            var n = cl.numPad[k].n;
            if (selected) fillCell(selected.r, selected.c, n);
            highlightNum = n; // always keep the filled digit highlighted
            return;
          }
        }
        if (gameState === 'won') { newGame(); return; }
        var cell = cellAt(pt.x, pt.y);
        if (cell) {
          if (selected && selected.r === cell.r && selected.c === cell.c) {
            selected = null; // tap same cell to deselect
          } else {
            selected = cell;
            // When tapping a filled cell, highlight that digit across the board.
            var cellVal = board[cell.r*9+cell.c];
            if (cellVal) highlightNum = cellVal;
          }
        }
      }
    });

    // Keyboard shortcuts — desktop dev convenience (not required for touch).
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === 'n')         { newGame();  return; }
      if (k === 'd')         { cycleDiff(); return; }
      if (k === 'f')         { fillMode = (fillMode==='fill')?'notes':'fill'; return; }
      if (!selected) {
        // Allow arrow keys to start at top-left when nothing is selected.
        if (k==='arrowup'||k==='arrowdown'||k==='arrowleft'||k==='arrowright') {
          selected = { r: 0, c: 0 }; ev.preventDefault();
        }
        return;
      }
      if (k === 'arrowup')    { ev.preventDefault(); selected = { r: Math.max(0, selected.r-1), c: selected.c }; return; }
      if (k === 'arrowdown')  { ev.preventDefault(); selected = { r: Math.min(8, selected.r+1), c: selected.c }; return; }
      if (k === 'arrowleft')  { ev.preventDefault(); selected = { r: selected.r, c: Math.max(0, selected.c-1) }; return; }
      if (k === 'arrowright') { ev.preventDefault(); selected = { r: selected.r, c: Math.min(8, selected.c+1) }; return; }
      if (k === 'backspace' || k === 'delete' || k === '0') { eraseCell(selected.r, selected.c); return; }
      var num = parseInt(k, 10);
      if (num >= 1 && num <= 9) {
        fillCell(selected.r, selected.c, num);
        highlightNum = num;
      }
    });

    NG.onExit(goFinish);

    // ---- drawing helpers -----------------------------------------------------
    function rrect(px, py, w, h, rad) {
      rad = Math.min(rad, w/2, h/2);
      ctx.beginPath();
      ctx.moveTo(px+rad, py);
      ctx.arcTo(px+w, py,   px+w, py+h, rad);
      ctx.arcTo(px+w, py+h, px,   py+h, rad);
      ctx.arcTo(px,   py+h, px,   py,   rad);
      ctx.arcTo(px,   py,   px+w, py,   rad);
      ctx.closePath();
    }

    function drawButton(b, label, col, active) {
      ctx.lineWidth  = active ? 2.5 : 1.5;
      ctx.strokeStyle = col;
      ctx.fillStyle  = active ? 'rgba(77,255,136,0.12)' : 'rgba(0,0,0,0.4)';
      rrect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h)*0.24);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + Math.min(b.h*0.44, b.w*0.28).toFixed(0) + 'px "Courier New",monospace';
      ctx.fillText(label, b.x+b.w/2, b.y+b.h*0.54);
    }

    // ---- board ---------------------------------------------------------------
    function drawBoard() {
      var r, c, b;

      // Backing
      ctx.fillStyle = '#000';
      ctx.fillRect(boardLeft, boardTop, S, S);

      // Per-cell backgrounds and digits / notes.
      for (r = 0; r < 9; r++) for (c = 0; c < 9; c++) drawCell(r, c);

      // Thin grid lines within boxes.
      ctx.lineWidth  = Math.max(0.5, cs*0.02);
      ctx.strokeStyle = DIM;
      for (var i = 1; i < 9; i++) {
        if (i % 3 === 0) continue; // box dividers drawn next
        ctx.beginPath(); ctx.moveTo(boardLeft+i*cs, boardTop);   ctx.lineTo(boardLeft+i*cs, boardTop+S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(boardLeft, boardTop+i*cs);   ctx.lineTo(boardLeft+S, boardTop+i*cs); ctx.stroke();
      }

      // Box dividers.
      ctx.lineWidth  = Math.max(1, cs*0.035);
      ctx.strokeStyle = FG;
      for (b = 3; b < 9; b += 3) {
        ctx.beginPath(); ctx.moveTo(boardLeft+b*cs, boardTop);   ctx.lineTo(boardLeft+b*cs, boardTop+S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(boardLeft, boardTop+b*cs);   ctx.lineTo(boardLeft+S, boardTop+b*cs); ctx.stroke();
      }

      // Outer border.
      ctx.lineWidth  = Math.max(1, cs*0.045);
      ctx.strokeStyle = FG;
      ctx.strokeRect(boardLeft, boardTop, S, S);
    }

    function drawCell(r, c) {
      var cellIdx = r*9+c;
      var v       = board[cellIdx];
      var given   = isGiven(r, c);
      var isSel   = selected && selected.r === r && selected.c === c;
      var isErr   = !!conflicts[cellIdx];
      var cx = boardLeft + c*cs, cy = boardTop + r*cs;

      // Background priority:
      //   selected cell  → bright highlight
      //   digit selected → same digit: bright; all others: darkened
      //   no digit sel   → selected cell only; all others at base
      var bg;
      if (isSel) {
        bg = '#1e3f2c';
      } else if (highlightNum && v === highlightNum) {
        bg = '#1a3824';
      } else {
        bg = '#000';
      }

      ctx.fillStyle = bg;
      ctx.fillRect(cx, cy, cs, cs);

      if (isErr) {
        ctx.fillStyle = 'rgba(255,93,108,0.18)';
        ctx.fillRect(cx, cy, cs, cs);
      }

      if (v) {
        // Draw the digit.
        ctx.fillStyle = given ? INK : (isErr ? ERR : FG);
        ctx.globalAlpha = given ? 0.85 : 1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = (given ? 'bold ' : '') + (cs*0.55).toFixed(0) + 'px "Courier New",monospace';
        ctx.fillText(String(v), cx+cs/2, cy+cs*0.56);
        ctx.globalAlpha = 1;
      } else {
        // Draw pencil notes (3×3 mini-grid).
        var noteSize = cs / 3;
        var noteFs   = clamp(noteSize*0.56, 7, 15);
        ctx.fillStyle   = MUTED;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = noteFs.toFixed(0) + 'px "Courier New",monospace';
        for (var n = 1; n <= 9; n++) {
          if (!notes[cellIdx][n]) continue;
          var nr = ((n-1)/3)|0, nc = (n-1)%3;
          ctx.fillText(String(n),
            cx + nc*noteSize + noteSize/2,
            cy + nr*noteSize + noteSize*0.52);
        }
      }
    }

    // True when all 9 correct instances of `n` are on the board.
    function isDigitComplete(n) {
      var count = 0, i;
      for (i = 0; i < 81; i++) if (board[i] === n && solution[i] === n) count++;
      return count === 9;
    }

    function drawChrome(cl) {
      var t  = elapsed();
      var ts = Math.floor(t/60) + ':' + ('0'+(t%60)).slice(-2);

      drawButton(cl.finish,  'FINISH', FG,    false);
      drawButton(cl.newBtn,  'NEW',    FG,    false);
      drawButton(cl.diff,    DIFFS[diffIdx].key, FG, false);
      drawButton(cl.timer,   ts,       MUTED, false);
      drawButton(cl.erase,   'ERASE',  MUTED, false);
      var notesOn = fillMode === 'notes';
      drawButton(cl.modeBtn, notesOn ? 'NOTES' : 'FILL', notesOn ? AMBER : FG, notesOn);

      // Number pad buttons — active when highlighted, greyed when all 9 placed.
      var k, nb, active, done;
      for (k = 0; k < cl.numPad.length; k++) {
        nb   = cl.numPad[k];
        done = isDigitComplete(nb.n);
        active = (nb.n === highlightNum) && !done;
        ctx.lineWidth   = done ? 0.5 : (active ? 2 : 1);
        ctx.strokeStyle = done ? '#2a2a2a' : (active ? FG : DIM);
        ctx.fillStyle   = done ? 'rgba(0,0,0,0.2)' : (active ? 'rgba(77,255,136,0.12)' : 'rgba(0,0,0,0.35)');
        rrect(nb.x, nb.y, nb.s, nb.s, nb.s*0.18);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = done ? 0.22 : 1;
        ctx.fillStyle   = active ? FG : INK;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + (nb.s*0.55).toFixed(0) + 'px "Courier New",monospace';
        ctx.fillText(String(nb.n), nb.x+nb.s/2, nb.y+nb.s*0.56);
        ctx.globalAlpha = 1;
      }
    }

    function drawWon() {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(boardLeft, boardTop, S, S);
      var unit = Math.min(vw, vh);
      var cx = boardLeft + S/2, cy = boardTop + S/2;
      var pulse = 0.65 + 0.35*Math.abs(Math.sin(clock*2.2));

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = FG; ctx.shadowColor = FG; ctx.shadowBlur = unit*0.035;
      ctx.font = 'bold ' + (unit*0.11).toFixed(0) + 'px "Courier New",monospace';
      ctx.fillText('SOLVED', cx, cy - unit*0.065);
      ctx.shadowBlur = 0;

      var t = finalTime;
      var ts = Math.floor(t/60) + ':' + ('0'+(t%60)).slice(-2);
      ctx.fillStyle = INK;
      ctx.font = 'bold ' + (unit*0.035).toFixed(0) + 'px "Courier New",monospace';
      ctx.fillText('TIME  ' + ts, cx, cy + unit*0.015);

      ctx.globalAlpha = pulse;
      ctx.font = 'bold ' + (unit*0.038).toFixed(0) + 'px "Courier New",monospace';
      ctx.fillText('TAP TO PLAY AGAIN', cx, cy + unit*0.085);
      ctx.globalAlpha = 1;
    }

    // ---- frame ---------------------------------------------------------------
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);
      drawBoard();
      if (gameState === 'won') drawWon();
      drawChrome(chromeLayout());
    }

    // ---- boot ----------------------------------------------------------------
    NG.onResize(layout);
    newGame();

    function loop(t) {
      if (!animLast) animLast = t;
      clock += Math.min((t - animLast) / 1000, 1/20);
      animLast = t;
      draw();
      window.requestAnimationFrame(loop);
    }
    window.requestAnimationFrame(loop);
  });
})();
