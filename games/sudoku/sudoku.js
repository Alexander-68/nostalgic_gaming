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
 * N for new game, F to toggle fill/notes mode, D to cycle difficulty,
 * U to undo, H for hint, A to toggle autoFill, P to pause.
 */
(function () {
  'use strict';

  // ---- palette (matches the catalogue's phosphor look) ----------------------
  var FG    = '#4dff88';   // phosphor green — primary
  var DIM   = '#1d5e38';   // board grid lines / ambient
  var INK   = '#d6f7e4';   // neutral text (given digits)
  var MUTED = '#6b7a72';   // secondary / readouts
  var ERR   = '#ff5d6c';   // conflict red
  var AMBER = '#ffcf4d';   // notes-mode accent / pause
  var HINT_COL = '#4dc8ff'; // hint-revealed digit colour
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

  function solveGrid(grid, randomize) {
    var best = -1, bestCnt = 10, i, r, c, n, cnt;
    for (i = 0; i < 81; i++) {
      if (grid[i] !== 0) continue;
      r = (i/9)|0; c = i%9; cnt = 0;
      for (n = 1; n <= 9; n++) if (canPlace(grid, r, c, n)) cnt++;
      if (cnt === 0) return false;
      if (cnt < bestCnt) { bestCnt = cnt; best = i; }
    }
    if (best === -1) return true;
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
    var solution = [];
    for (i = 0; i < 81; i++) solution.push(0);
    solveGrid(solution, true);

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
        puzzle[i] = backup;
      } else {
        removed++;
      }
    }
    return { puzzle: puzzle, solution: solution };
  }

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
    var puzzle, solution, board, notes, hintCells;
    var selected = null;
    var gameState = 'play';    // 'play' | 'won'
    var fillMode = 'fill';     // 'fill' | 'notes'
    var autoFill = false;      // continuous-fill mode
    var conflicts = {};
    var highlightNum = 0;
    var timerStarted = false, startClock = 0, finalTime = 0;
    var paused = false, pauseStart = 0, totalPaused = 0;
    var undoStack = [];        // [{cellIdx, oldVal, oldNotes, wasHint}]

    function makeNotes() {
      var n = [], i;
      for (i = 0; i < 81; i++) n.push([false,false,false,false,false,false,false,false,false,false]);
      return n;
    }

    function newGame() {
      var gen = generatePuzzle(DIFFS[diffIdx].givens);
      puzzle   = gen.puzzle;
      solution = gen.solution;
      board    = puzzle.slice();
      notes    = makeNotes();
      hintCells = {};
      selected = null;
      gameState    = 'play';
      fillMode     = 'fill';
      autoFill     = false;
      conflicts    = {};
      highlightNum = 0;
      timerStarted = false;
      startClock   = clock;
      finalTime    = 0;
      paused       = false;
      pauseStart   = 0;
      totalPaused  = 0;
      undoStack    = [];
    }

    function elapsed() {
      if (!timerStarted) return 0;
      if (gameState !== 'play') return finalTime;
      var pauseOffset = paused ? (clock - pauseStart) : 0;
      return Math.floor(clock - startClock - totalPaused - pauseOffset);
    }

    function startTimer() {
      if (!timerStarted) { timerStarted = true; startClock = clock; }
    }

    function isGiven(r, c) { return puzzle[r*9+c] !== 0; }

    function clearNotesPeerCells(r, c, n) {
      var i, br, bc, dr, dc;
      br = ((r/3)|0)*3; bc = ((c/3)|0)*3;
      for (i = 0; i < 9; i++) { notes[r*9+i][n] = false; notes[i*9+c][n] = false; }
      for (dr = 0; dr < 3; dr++)
        for (dc = 0; dc < 3; dc++) notes[(br+dr)*9+(bc+dc)][n] = false;
    }

    function checkWin() {
      if (isBoardComplete(board, solution)) {
        // Compute finalTime BEFORE changing gameState so elapsed() works correctly.
        var pauseOffset = paused ? (clock - pauseStart) : 0;
        finalTime = Math.floor(clock - startClock - totalPaused - pauseOffset);
        gameState = 'won';
      }
    }

    function fillCell(r, c, n) {
      if (gameState !== 'play' || isGiven(r, c) || paused) return;
      var cellIdx = r*9+c;
      startTimer();

      if (fillMode === 'notes') {
        if (n !== 0) {
          undoStack.push({ cellIdx: cellIdx, oldVal: board[cellIdx], oldNotes: notes[cellIdx].slice() });
          notes[cellIdx][n] = !notes[cellIdx][n];
        }
        return;
      }

      if (board[cellIdx] !== 0) return;

      undoStack.push({ cellIdx: cellIdx, oldVal: board[cellIdx], oldNotes: notes[cellIdx].slice() });
      board[cellIdx] = n;
      clearNotesPeerCells(r, c, n);
      for (var i = 1; i <= 9; i++) notes[cellIdx][i] = false;
      conflicts = getConflicts(board);
      selected = null;
      checkWin();
    }

    function eraseCell(r, c) {
      if (gameState !== 'play' || isGiven(r, c) || paused) return;
      var cellIdx = r*9+c;
      startTimer();
      undoStack.push({ cellIdx: cellIdx, oldVal: board[cellIdx], oldNotes: notes[cellIdx].slice() });
      board[cellIdx] = 0;
      for (var i = 1; i <= 9; i++) notes[cellIdx][i] = false;
      conflicts = getConflicts(board);
    }

    function undo() {
      if (!undoStack.length || gameState !== 'play' || paused) return;
      var op = undoStack.pop();
      board[op.cellIdx] = op.oldVal;
      notes[op.cellIdx] = op.oldNotes;
      if (op.wasHint) delete hintCells[op.cellIdx];
      conflicts = getConflicts(board);
    }

    function giveHint() {
      if (gameState !== 'play' || paused) return;
      var candidates = [], i;
      for (i = 0; i < 81; i++) {
        if (!puzzle[i] && board[i] !== solution[i]) candidates.push(i);
      }
      if (!candidates.length) return;
      var idx = candidates[(Math.random() * candidates.length) | 0];
      var r = (idx/9)|0, c = idx%9;
      startTimer();
      undoStack.push({ cellIdx: idx, oldVal: board[idx], oldNotes: notes[idx].slice(), wasHint: true });
      board[idx] = solution[idx];
      hintCells[idx] = true;
      clearNotesPeerCells(r, c, solution[idx]);
      for (var j = 1; j <= 9; j++) notes[idx][j] = false;
      conflicts = getConflicts(board);
      highlightNum = solution[idx];
      selected = { r: r, c: c };
      checkWin();
    }

    function togglePause() {
      if (gameState !== 'play' || !timerStarted) return;
      if (paused) {
        totalPaused += clock - pauseStart;
        paused = false;
      } else {
        pauseStart = clock;
        paused = true;
      }
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
    function chromeLayout() {
      var unit = Math.min(vw, vh);
      var gap  = clamp(unit * 0.022, 5, 18);

      if (panelMode === 'wide') {
        var lw = boardLeft;
        var rw = vw - (boardLeft + S);
        var cxL = lw / 2;
        var cxR = boardLeft + S + rw / 2;

        // Left panel: all 9 action buttons distributed across full viewport height.
        var gap2    = Math.max(2, Math.floor(gap * 0.55));
        var edgePad = Math.max(gap, clamp(vh * 0.04, 6, 20));
        var bh9max  = Math.floor((vh - 2 * edgePad - 8 * gap2) / 9);
        var bh9     = Math.min(clamp(unit * 0.065, 24, 52), bh9max);
        var bwL     = clamp(lw * 0.88, 60, 220);
        var lx      = Math.floor(cxL - bwL / 2);
        var totalBH = 9 * bh9 + 8 * gap2;
        var y0      = Math.floor((vh - totalBH) / 2);

        var finish  = { x: lx, y: y0 + 0*(bh9+gap2), w: bwL, h: bh9 };
        var newBtn  = { x: lx, y: y0 + 1*(bh9+gap2), w: bwL, h: bh9 };
        var diff    = { x: lx, y: y0 + 2*(bh9+gap2), w: bwL, h: bh9 };
        var timer   = { x: lx, y: y0 + 3*(bh9+gap2), w: bwL, h: bh9 };
        var undoBtn = { x: lx, y: y0 + 4*(bh9+gap2), w: bwL, h: bh9 };
        var hintBtn = { x: lx, y: y0 + 5*(bh9+gap2), w: bwL, h: bh9 };
        var erase   = { x: lx, y: y0 + 6*(bh9+gap2), w: bwL, h: bh9 };
        var modeBtn = { x: lx, y: y0 + 7*(bh9+gap2), w: bwL, h: bh9 };
        var autoBtn = { x: lx, y: y0 + 8*(bh9+gap2), w: bwL, h: bh9 };

        // Right panel: 1×9 vertical numpad, keys sized to match board cells with a small gap.
        var numKeyGap = Math.max(3, Math.floor(cs * 0.08));
        var numS = Math.min(Math.floor(cs) - numKeyGap, Math.floor(rw * 0.88));
        numS = Math.max(16, numS);
        var padX = Math.floor(cxR - numS / 2);
        var numPad = [], n;
        for (n = 1; n <= 9; n++) {
          numPad.push({
            n: n,
            x: padX,
            y: Math.floor(boardTop + (n - 1) * cs + numKeyGap / 2),
            s: numS
          });
        }

        return {
          panelMode: 'wide',
          finish: finish, newBtn: newBtn, diff: diff, timer: timer,
          undoBtn: undoBtn, hintBtn: hintBtn,
          erase: erase, modeBtn: modeBtn, autoBtn: autoBtn,
          numPad: numPad
        };
      }

      // ---- stacked (portrait) ------------------------------------------------
      var tb   = boardTop;
      var bb0  = boardTop + S;
      var topH = tb;
      var botH = vh - bb0;
      var mgx  = clamp(vw * 0.04, 8, 24);

      // Top band: FINISH | DIFF | TIMER | NEW
      var topBtnH = clamp(topH * 0.44, 24, 48);
      var topBtnW = Math.floor((vw - 2*mgx - 3*gap) / 4);
      var topY    = topH / 2 - topBtnH / 2;
      var finish  = { x: mgx,                    y: topY, w: topBtnW, h: topBtnH };
      var diff    = { x: mgx + topBtnW + gap,     y: topY, w: topBtnW, h: topBtnH };
      var timer   = { x: mgx + 2*(topBtnW+gap),  y: topY, w: topBtnW, h: topBtnH };
      var newBtn  = { x: mgx + 3*(topBtnW+gap),  y: topY, w: topBtnW, h: topBtnH };

      // Bottom: 5+5 numpad rows then a 4-button action row
      var numCols = 5;
      var numH    = Math.floor(botH * 0.28);
      var numW    = Math.floor((vw - 2*mgx - (numCols-1)*gap) / numCols);
      var numStartY = bb0 + clamp(botH * 0.055, 4, 12);
      var numPad = [], n, row, col;
      for (n = 1; n <= 9; n++) {
        row = (n <= 5) ? 0 : 1;
        col = (n <= 5) ? (n-1) : (n-6);
        numPad.push({ n: n, x: mgx + col*(numW+gap), y: numStartY + row*(numH+gap), s: numH });
      }
      var erase = { x: mgx + 4*(numW+gap), y: numStartY + numH + gap, w: numW, h: numH };

      // 4-button action row below numpad: FILL/NOTES | AUTO | UNDO | HINT
      var actY    = numStartY + 2*(numH+gap);
      var actBtnH = clamp(botH * 0.22, 22, 42);
      var actBtnW = Math.floor((vw - 2*mgx - 3*gap) / 4);
      var modeBtn = { x: mgx,                    y: actY, w: actBtnW, h: actBtnH };
      var autoBtn = { x: mgx + actBtnW + gap,     y: actY, w: actBtnW, h: actBtnH };
      var undoBtn = { x: mgx + 2*(actBtnW+gap),  y: actY, w: actBtnW, h: actBtnH };
      var hintBtn = { x: mgx + 3*(actBtnW+gap),  y: actY, w: actBtnW, h: actBtnH };

      return {
        panelMode: 'stacked',
        finish: finish, diff: diff, timer: timer, newBtn: newBtn,
        numPad: numPad, erase: erase,
        modeBtn: modeBtn, autoBtn: autoBtn, undoBtn: undoBtn, hintBtn: hintBtn
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
        if (inRect(pt.x, pt.y, cl.finish))  { goFinish();    return; }
        if (inRect(pt.x, pt.y, cl.newBtn))  { newGame();     return; }
        if (inRect(pt.x, pt.y, cl.diff))    { cycleDiff();   return; }
        if (inRect(pt.x, pt.y, cl.timer))   { togglePause(); return; }
        if (inRect(pt.x, pt.y, cl.undoBtn)) { undo();        return; }
        if (inRect(pt.x, pt.y, cl.hintBtn)) { giveHint();    return; }
        if (inRect(pt.x, pt.y, cl.modeBtn)) {
          fillMode = (fillMode === 'fill') ? 'notes' : 'fill';
          return;
        }
        if (inRect(pt.x, pt.y, cl.autoBtn)) {
          autoFill = !autoFill;
          return;
        }
        if (inRect(pt.x, pt.y, cl.erase)) {
          if (selected) eraseCell(selected.r, selected.c);
          return;
        }
        for (k = 0; k < cl.numPad.length; k++) {
          if (inSq(pt.x, pt.y, cl.numPad[k])) {
            var n = cl.numPad[k].n;
            startTimer();
            if (selected) fillCell(selected.r, selected.c, n);
            highlightNum = n;
            return;
          }
        }
        if (paused) return;
        if (gameState === 'won') { newGame(); return; }
        var cell = cellAt(pt.x, pt.y);
        if (cell) {
          startTimer();
          if (autoFill && highlightNum) {
            // In autoFill mode: tap cell → instantly fill (or add note) with highlighted digit.
            if (fillMode === 'notes') {
              if (!isGiven(cell.r, cell.c)) {
                var cellIdx = cell.r*9+cell.c;
                undoStack.push({ cellIdx: cellIdx, oldVal: board[cellIdx], oldNotes: notes[cellIdx].slice() });
                notes[cellIdx][highlightNum] = !notes[cellIdx][highlightNum];
              }
            } else if (!isGiven(cell.r, cell.c) && board[cell.r*9+cell.c] === 0) {
              fillCell(cell.r, cell.c, highlightNum);
            } else {
              // Already filled or given — just select and show highlight
              selected = cell;
              var cv = board[cell.r*9+cell.c];
              if (cv) highlightNum = cv;
            }
          } else if (selected && selected.r === cell.r && selected.c === cell.c) {
            selected = null;
          } else {
            selected = cell;
            var cellVal = board[cell.r*9+cell.c];
            if (cellVal) highlightNum = cellVal;
          }
        }
      }
    });

    // Keyboard — desktop dev convenience
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === 'n') { newGame();   return; }
      if (k === 'd') { cycleDiff(); return; }
      if (k === 'f') { fillMode = (fillMode==='fill')?'notes':'fill'; return; }
      if (k === 'a') { autoFill = !autoFill; return; }
      if (k === 'u') { undo();      return; }
      if (k === 'h') { giveHint();  return; }
      if (k === 'p') { togglePause(); return; }
      if (paused) return;
      if (!selected) {
        if (k==='arrowup'||k==='arrowdown'||k==='arrowleft'||k==='arrowright') {
          selected = { r: 0, c: 0 }; ev.preventDefault();
        }
        return;
      }
      if (k === 'arrowup')    { ev.preventDefault(); selected = { r: Math.max(0,selected.r-1), c: selected.c }; return; }
      if (k === 'arrowdown')  { ev.preventDefault(); selected = { r: Math.min(8,selected.r+1), c: selected.c }; return; }
      if (k === 'arrowleft')  { ev.preventDefault(); selected = { r: selected.r, c: Math.max(0,selected.c-1) }; return; }
      if (k === 'arrowright') { ev.preventDefault(); selected = { r: selected.r, c: Math.min(8,selected.c+1) }; return; }
      if (k === 'backspace' || k === 'delete' || k === '0') { eraseCell(selected.r, selected.c); return; }
      if (k === ' ') {
        // Space in autoFill mode: fill selected cell with highlighted digit
        if (autoFill && highlightNum && selected) {
          ev.preventDefault();
          fillCell(selected.r, selected.c, highlightNum);
        }
        return;
      }
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
      ctx.lineWidth   = active ? 2.5 : 1.5;
      ctx.strokeStyle = col;
      ctx.fillStyle   = active ? 'rgba(77,255,136,0.12)' : 'rgba(0,0,0,0.4)';
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
      ctx.fillStyle = '#000';
      ctx.fillRect(boardLeft, boardTop, S, S);

      for (r = 0; r < 9; r++) for (c = 0; c < 9; c++) drawCell(r, c);

      ctx.lineWidth   = Math.max(0.5, cs*0.02);
      ctx.strokeStyle = DIM;
      for (var i = 1; i < 9; i++) {
        if (i % 3 === 0) continue;
        ctx.beginPath(); ctx.moveTo(boardLeft+i*cs, boardTop);   ctx.lineTo(boardLeft+i*cs, boardTop+S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(boardLeft, boardTop+i*cs);   ctx.lineTo(boardLeft+S, boardTop+i*cs); ctx.stroke();
      }

      ctx.lineWidth   = Math.max(1, cs*0.035);
      ctx.strokeStyle = FG;
      for (b = 3; b < 9; b += 3) {
        ctx.beginPath(); ctx.moveTo(boardLeft+b*cs, boardTop);   ctx.lineTo(boardLeft+b*cs, boardTop+S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(boardLeft, boardTop+b*cs);   ctx.lineTo(boardLeft+S, boardTop+b*cs); ctx.stroke();
      }

      ctx.lineWidth   = Math.max(1, cs*0.045);
      ctx.strokeStyle = FG;
      ctx.strokeRect(boardLeft, boardTop, S, S);
    }

    function drawCell(r, c) {
      var cellIdx = r*9+c;
      var v       = board[cellIdx];
      var given   = isGiven(r, c);
      var isSel   = selected && selected.r === r && selected.c === c;
      var isErr   = !!conflicts[cellIdx];
      var isHint  = !!hintCells[cellIdx];
      var cx = boardLeft + c*cs, cy = boardTop + r*cs;

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
        var digitCol = given ? INK : (isHint ? HINT_COL : (isErr ? ERR : FG));
        ctx.fillStyle = digitCol;
        ctx.globalAlpha = given ? 0.85 : 1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = (given ? 'bold ' : '') + (cs*0.55).toFixed(0) + 'px "Courier New",monospace';
        ctx.fillText(String(v), cx+cs/2, cy+cs*0.56);
        ctx.globalAlpha = 1;
      } else {
        var noteSize = cs / 3;
        var noteFs   = clamp(noteSize*0.56, 7, 15);
        ctx.fillStyle    = MUTED;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = noteFs.toFixed(0) + 'px "Courier New",monospace';
        for (var n = 1; n <= 9; n++) {
          if (!notes[cellIdx][n]) continue;
          var nr = ((n-1)/3)|0, nc = (n-1)%3;
          ctx.fillText(String(n), cx + nc*noteSize + noteSize/2, cy + nr*noteSize + noteSize*0.52);
        }
      }
    }

    function isDigitComplete(n) {
      var count = 0, i;
      for (i = 0; i < 81; i++) if (board[i] === n && solution[i] === n) count++;
      return count === 9;
    }

    function drawChrome(cl) {
      var t  = elapsed();
      var ts = paused ? 'PAUSED' : (Math.floor(t/60) + ':' + ('0'+(t%60)).slice(-2));

      drawButton(cl.finish,  'FINISH', FG,    false);
      drawButton(cl.newBtn,  'NEW',    FG,    false);
      drawButton(cl.diff,    DIFFS[diffIdx].key, FG, false);
      drawButton(cl.timer,   ts,       paused ? AMBER : MUTED, paused);
      drawButton(cl.undoBtn, 'UNDO',   undoStack.length ? MUTED : DIM, false);
      drawButton(cl.hintBtn, 'HINT',   FG,    false);
      drawButton(cl.erase,   'ERASE',  MUTED, false);
      var notesOn = fillMode === 'notes';
      drawButton(cl.modeBtn, notesOn ? 'NOTES' : 'FILL', notesOn ? AMBER : FG, notesOn);
      drawButton(cl.autoBtn, 'AUTO',   autoFill ? FG : DIM, autoFill);

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

    function drawPaused() {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(boardLeft, boardTop, S, S);
      var unit = Math.min(vw, vh);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = AMBER; ctx.shadowColor = AMBER; ctx.shadowBlur = unit*0.03;
      ctx.font = 'bold ' + (unit*0.09).toFixed(0) + 'px "Courier New",monospace';
      ctx.fillText('PAUSED', boardLeft + S/2, boardTop + S/2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = MUTED;
      ctx.font = (unit*0.032).toFixed(0) + 'px "Courier New",monospace';
      ctx.fillText('TAP TIMER TO RESUME', boardLeft + S/2, boardTop + S/2 + unit*0.075);
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
      if (paused)              drawPaused();
      else if (gameState === 'won') drawWon();
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
