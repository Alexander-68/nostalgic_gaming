/*
 * Breakout — single-player. Touch-first, with mouse + keyboard for desktop dev.
 *
 * Mirrors the catalogue's core conventions (see games/pong/pong.js):
 *   - classic script under the NG namespace (no modules, runs from file://)
 *   - the three design ratios, via NG.classify / NG.onResize (fill-the-viewport
 *     strategy: the canvas IS the window; the brick wall reshapes per
 *     orientation — wide-and-short in 16:9, tall in 9:16, squarish in 9:8 — so
 *     bricks keep a sensible shape and the layout looks intended at every ratio)
 *   - touch via NG.createTouch: drag anywhere to slide the paddle; tap to launch
 *
 * Unlike Pong, the paddle ALWAYS sits at the bottom (the edge nearest the
 * player) and slides left/right, in every orientation — that's the layout every
 * Breakout player expects. Orientation reshapes the BALL'S travel room and the
 * brick wall, not which edge the paddle defends. The ball travels mostly along
 * the vertical (y) axis; speeds are scaled to the viewport height so a full
 * top-to-paddle traversal takes about the same time at 16:9 as at 9:16.
 *
 * Game feel (see memory: effects come from real geometry, not hidden flags):
 * the bounce angle off the paddle is set by WHERE the ball strikes it — centre
 * sends it straight up, the edges kick it out steeply — so the player aims by
 * positioning, exactly like the original. The ball also speeds up a touch on
 * paddle hits and when it breaks into the higher (red / amber) rows.
 */
(function () {
  'use strict';

  // ---- palette (matches the catalogue's phosphor look) ----------------------
  var FG = '#4dff88';     // paddle / ball / UI — phosphor green
  var DIM = '#1d5e38';    // frame / ambient
  var INK = '#d6f7e4';    // neutral text
  var MUTED = '#6b7a72';  // secondary text

  // Brick rows, top (hardest, worth most) to bottom. The ball speeds up when it
  // breaks into a SPEEDUP tier — classic "it gets faster on the orange & red".
  var TIERS = [
    { color: '#ff5d6c', points: 7 },  // red
    { color: '#ffcf4d', points: 5 },  // amber
    { color: '#4dff88', points: 3 },  // green
    { color: '#4de8d0', points: 1 },  // cyan
  ];
  var SPEEDUP_TIERS = 2;              // tiers 0..1 (red, amber) accelerate the ball

  // ---- tuning ---------------------------------------------------------------
  var START_LIVES = 3;
  var MAX_ANGLE = 1.05;          // ~60deg: steepest launch off a paddle edge
  var SPEED_FRAC0 = 0.62;        // level-1 ball speed, as a fraction of viewport height / sec
  var SPEED_STEP = 0.05;         // +base speed per level
  var MAX_SPEED_FRAC = 1.08;     // ceiling a rally can ramp the ball up to
  var PADDLE_SPEEDUP = 1.025;    // gentle speed-up on every paddle hit
  var BRICK_SPEEDUP = 1.04;      // extra speed-up when a hard (red/amber) brick breaks

  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- layout (recomputed on every resize / orientation change) ----------
    var W = 0, H = 0;                 // viewport size in CSS px
    var unit = 0;                     // min(W, H) — the scale for radii / fonts
    var drawScale = 1;                // devicePixelRatio
    var prevH = 0;                    // to rescale ball speed across a resize
    var fieldX = 0, fieldTop = 0;     // brick wall origin
    var cols = 0, rows = 0, cellW = 0, cellH = 0;

    // ---- game state --------------------------------------------------------
    var state = 'ready';              // 'ready' | 'playing' | 'over' | 'won'
    var started = false;
    var bricks = [];                  // { row, col, alive, tier, color, points }
    var bricksLeft = 0;
    var score = 0, lives = START_LIVES, level = 1;
    var paddle = { cx: 0, w: 0, h: 0, y: 0 };
    var ball = { x: 0, y: 0, vx: 0, vy: 0, r: 0, speed: 0 };
    var trail = [];                   // recent ball positions, for the comet tail
    var clock = 0;                    // wall clock, for prompt pulsing
    var touch = null;

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function baseSpeed() { return clamp(SPEED_FRAC0 + SPEED_STEP * (level - 1), 0, MAX_SPEED_FRAC) * H; }
    function maxSpeed() { return MAX_SPEED_FRAC * H; }

    // ---- layout ------------------------------------------------------------
    function layout(info) {
      var dpr = window.devicePixelRatio || 1;
      W = info.width;
      H = info.height;
      unit = Math.min(W, H);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      drawScale = dpr;

      // Paddle: a fixed fraction of WIDTH (the axis it slides along) so the
      // horizontal challenge is the same at every ratio; it sits just above the
      // bottom edge, leaving a small reaction gap below it.
      paddle.w = clamp(W * 0.16, unit * 0.14, W * 0.45);
      paddle.h = Math.max(unit * 0.022, 10);
      paddle.y = H - unit * 0.05 - paddle.h;
      ball.r = Math.max(unit * 0.012, 4);

      // Brick wall geometry. Columns come from a target brick width relative to
      // the short side, so a wide screen gets more (thinner-looking) columns and
      // a tall one fewer; rows fill ~40% of the height, capped to stay classic.
      var sideGap = W * 0.02;
      fieldX = sideGap;
      var fieldW = W - 2 * sideGap;
      var targetCellW = unit / 8.5;
      var newCols = clamp(Math.round(fieldW / targetCellW), 6, 16);
      cellW = fieldW / newCols;
      cellH = cellW * 0.46;                 // classic wide-brick aspect
      fieldTop = H * 0.085;                 // HUD band above the wall
      var newRows = clamp(Math.round((H * 0.40) / cellH), 4, 9);

      var gridChanged = (newCols !== cols || newRows !== rows);
      cols = newCols;
      rows = newRows;

      if (!started) {
        started = true;
        paddle.cx = W / 2;
        newGame();
      } else {
        // A reshaped grid would strand in-flight bricks/ball — rebuild the wall
        // and re-rack the ball if a round was live. A plain resize that leaves
        // the grid count unchanged just reflows (bricks derive x/y from the grid)
        // and rescales the ball's speed so its feel is preserved.
        if (gridChanged) {
          buildWall();
          if (state === 'playing' || state === 'ready') resetBallReady();
        }
        if (prevH && state === 'playing') {
          var k = H / prevH;
          ball.vx *= k; ball.vy *= k; ball.speed *= k;
        }
        paddle.cx = clamp(paddle.cx, paddle.w / 2, W - paddle.w / 2);
        ball.x = clamp(ball.x, ball.r, W - ball.r);
      }
      prevH = H;
    }

    // ---- wall --------------------------------------------------------------
    function tierForRow(row) {
      return clamp(Math.floor(row / rows * TIERS.length), 0, TIERS.length - 1);
    }
    function buildWall() {
      bricks = [];
      for (var r = 0; r < rows; r++) {
        var t = tierForRow(r);
        for (var c = 0; c < cols; c++) {
          bricks.push({ row: r, col: c, alive: true, tier: t, color: TIERS[t].color, points: TIERS[t].points });
        }
      }
      bricksLeft = rows * cols;
    }
    // Collision uses the full, contiguous cell (bricks touch, so the ball can't
    // thread the visual gaps); drawing insets the cell for the gridded look.
    function cellRect(b) {
      return { x: fieldX + b.col * cellW, y: fieldTop + b.row * cellH, w: cellW, h: cellH };
    }

    // ---- round / game transitions ------------------------------------------
    function resetBallReady() {
      state = 'ready';
      ball.speed = baseSpeed();
      ball.vx = 0; ball.vy = 0;
      ball.x = paddle.cx;
      ball.y = paddle.y - ball.r - 1;
      trail.length = 0;
      NG.setPlaying(false);          // chrome (FINISH) visible until launch
    }
    function newGame() {
      score = 0; lives = START_LIVES; level = 1;
      buildWall();
      resetBallReady();
    }
    function nextLevel() {
      level++;
      buildWall();
      resetBallReady();
    }
    function launch() {
      var angle = (Math.random() - 0.5) * 0.5;   // small spread off straight-up
      ball.speed = baseSpeed();
      ball.vx = ball.speed * Math.sin(angle);
      ball.vy = -ball.speed * Math.cos(angle);   // up (negative y)
      state = 'playing';
      NG.setPlaying(true);           // hide page chrome during active play
    }
    function loseLife() {
      lives--;
      if (lives <= 0) { state = 'over'; NG.setPlaying(false); }
      else resetBallReady();
    }
    function winLevel() { state = 'won'; NG.setPlaying(false); }

    // ---- input -------------------------------------------------------------
    // The paddle tracks the active touch's x (absolute follow, like Pong's
    // paddles). On desktop the mouse drives it too — held as a pointer here, or
    // via the hover handler wired below when no pointer is down.
    function applyPaddleInput() {
      var pts = touch.list();
      if (pts.length) paddle.cx = clamp(pts[pts.length - 1].x, paddle.w / 2, W - paddle.w / 2);
    }

    // ---- simulation --------------------------------------------------------
    function rescaleVel() {
      var m = Math.hypot(ball.vx, ball.vy) || 1;
      ball.vx = ball.vx / m * ball.speed;
      ball.vy = ball.vy / m * ball.speed;
    }

    function collidePaddle(prevY) {
      var top = paddle.y;
      // swept along y: did the ball's underside cross the paddle's top this step?
      if (!(prevY + ball.r <= top && ball.y + ball.r >= top)) return;
      if (ball.x < paddle.cx - paddle.w / 2 - ball.r) return;
      if (ball.x > paddle.cx + paddle.w / 2 + ball.r) return;
      // Where it lands on the paddle picks the angle — the player aims by moving.
      var rel = clamp((ball.x - paddle.cx) / (paddle.w / 2), -1, 1);
      ball.speed = Math.min(ball.speed * PADDLE_SPEEDUP, maxSpeed());
      var ang = rel * MAX_ANGLE;
      ball.vx = ball.speed * Math.sin(ang);
      ball.vy = -ball.speed * Math.cos(ang);
      ball.y = top - ball.r;
    }

    function collideBricks() {
      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (!b.alive) continue;
        var rc = cellRect(b);
        var nx = clamp(ball.x, rc.x, rc.x + rc.w);
        var ny = clamp(ball.y, rc.y, rc.y + rc.h);
        var dx = ball.x - nx, dy = ball.y - ny;
        if (dx * dx + dy * dy > ball.r * ball.r) continue;

        b.alive = false;
        bricksLeft--;
        score += b.points;

        // Reflect off the face the ball came in through: if the ball is within
        // the brick's x-span it struck the top/bottom (flip vy); within the
        // y-span, a side (flip vx); a corner picks the axis it's deepest on.
        var withinX = ball.x > rc.x && ball.x < rc.x + rc.w;
        var withinY = ball.y > rc.y && ball.y < rc.y + rc.h;
        if (withinX && !withinY) {
          ball.y = ball.y < rc.y ? rc.y - ball.r : rc.y + rc.h + ball.r;
          ball.vy = -ball.vy;
        } else if (withinY && !withinX) {
          ball.x = ball.x < rc.x ? rc.x - ball.r : rc.x + rc.w + ball.r;
          ball.vx = -ball.vx;
        } else if (Math.abs(dx) > Math.abs(dy)) {
          ball.x = ball.x < rc.x ? rc.x - ball.r : rc.x + rc.w + ball.r;
          ball.vx = -ball.vx;
        } else {
          ball.y = ball.y < rc.y ? rc.y - ball.r : rc.y + rc.h + ball.r;
          ball.vy = -ball.vy;
        }

        if (b.tier < SPEEDUP_TIERS) { ball.speed = Math.min(ball.speed * BRICK_SPEEDUP, maxSpeed()); rescaleVel(); }
        if (bricksLeft <= 0) winLevel();
        return;                        // at most one brick per substep
      }
    }

    function stepBall(sdt) {
      var prevY = ball.y;
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      else if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < ball.r) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }

      collideBricks();
      if (ball.vy > 0) collidePaddle(prevY);
      if (ball.y - ball.r > H) loseLife();   // fell past the paddle
    }

    function update(dt) {
      clock += dt;
      applyPaddleInput();
      if (state === 'ready') {              // ball rides the paddle until launch
        ball.x = paddle.cx;
        ball.y = paddle.y - ball.r - 1;
        return;
      }
      if (state !== 'playing') return;

      // Sub-step so a fast ball can't tunnel through a thin brick or the paddle.
      var travel = Math.hypot(ball.vx, ball.vy) * dt;
      var maxStep = Math.max(2, Math.min(ball.r, cellH * 0.5));
      var steps = Math.max(1, Math.ceil(travel / maxStep));
      var sdt = dt / steps;
      for (var s = 0; s < steps && state === 'playing'; s++) stepBall(sdt);

      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 12) trail.shift();
    }

    // ---- drawing -----------------------------------------------------------
    function rrect(px, py, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + w, py, px + w, py + h, r);
      ctx.arcTo(px + w, py + h, px, py + h, r);
      ctx.arcTo(px, py + h, px, py, r);
      ctx.arcTo(px, py, px + w, py, r);
      ctx.closePath();
    }

    function drawFrame() {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = DIM;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(2, unit * 0.006);
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, W - 2 * ctx.lineWidth, H - 2 * ctx.lineWidth);
      ctx.globalAlpha = 1;
    }

    function drawHud() {
      ctx.shadowBlur = 0;
      ctx.textBaseline = 'middle';
      var fs = Math.max(unit * 0.03, 11);
      ctx.font = 'bold ' + fs.toFixed(0) + 'px "Courier New", monospace';
      var midY = fieldTop * 0.5;
      // score (left) and level (centre)
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left';
      ctx.fillText('SCORE ' + String(score).padStart(5, '0'), W * 0.03, midY);
      ctx.textAlign = 'center';
      ctx.fillText('LEVEL ' + level, W / 2, midY);
      // lives as little balls (right)
      var lr = fs * 0.32, gap = fs * 0.95, rightX = W * 0.97;
      ctx.fillStyle = FG;
      ctx.shadowColor = FG;
      ctx.shadowBlur = fs * 0.4;
      for (var i = 0; i < lives; i++) {
        ctx.beginPath();
        ctx.arc(rightX - i * gap, midY, lr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    function drawBricks() {
      var ix = Math.max(1, cellW * 0.07), iy = Math.max(1, cellH * 0.14);
      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (!b.alive) continue;
        var rc = cellRect(b);
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = cellH * 0.35;
        rrect(rc.x + ix, rc.y + iy, rc.w - 2 * ix, rc.h - 2 * iy, cellH * 0.18);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    function drawPaddle() {
      ctx.fillStyle = FG;
      ctx.shadowColor = FG;
      ctx.shadowBlur = unit * 0.03;
      rrect(paddle.cx - paddle.w / 2, paddle.y, paddle.w, paddle.h, paddle.h / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function drawBall() {
      // comet tail — shows the real path the ball is travelling
      ctx.fillStyle = FG;
      ctx.shadowColor = FG;
      for (var i = 0; i < trail.length; i++) {
        var t = (i + 1) / trail.length;        // newer = brighter & larger
        ctx.globalAlpha = t * 0.4;
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, ball.r * t, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = unit * 0.025;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function drawCenter(lines) {
      // lines: [{ text, size, color, alpha }]; stacked around the empty mid-zone.
      var topY = fieldTop + rows * cellH, botY = paddle.y;
      var cx = W / 2, cy = (topY + botY) / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var total = 0, i;
      for (i = 0; i < lines.length; i++) total += lines[i].size * 1.5;
      var y = cy - total / 2 + lines[0].size * 0.75;
      for (i = 0; i < lines.length; i++) {
        var ln = lines[i];
        ctx.fillStyle = ln.color;
        ctx.shadowColor = ln.color;
        ctx.shadowBlur = ln.glow ? unit * 0.03 : 0;
        ctx.globalAlpha = ln.alpha == null ? 1 : ln.alpha;
        ctx.font = 'bold ' + ln.size.toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText(ln.text, cx, y);
        y += ln.size * 1.5;
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

      drawFrame();
      drawHud();
      drawBricks();
      drawPaddle();
      drawBall();

      var pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock * 2.2));
      var big = unit * 0.06, small = unit * 0.038;
      if (state === 'ready') {
        drawCenter([
          { text: 'TAP TO LAUNCH', size: big, color: FG, glow: true, alpha: pulse },
          { text: 'DRAG TO MOVE', size: small, color: MUTED },
        ]);
      } else if (state === 'won') {
        drawCenter([
          { text: 'WALL CLEARED', size: big, color: FG, glow: true },
          { text: 'SCORE ' + score, size: small, color: INK },
          { text: 'TAP FOR NEXT WALL', size: small, color: INK, alpha: pulse },
        ]);
      } else if (state === 'over') {
        drawCenter([
          { text: 'GAME OVER', size: big, color: '#ff5d6c', glow: true },
          { text: 'SCORE ' + score, size: small, color: INK },
          { text: 'TAP TO PLAY AGAIN', size: small, color: INK, alpha: pulse },
        ]);
      }
      ctx.shadowBlur = 0;
    }

    // ---- input wiring ------------------------------------------------------
    // Pointer Events cover touch AND mouse. A press launches / restarts; dragging
    // (or, on desktop, moving the mouse — see below) slides the paddle.
    function tap() {
      if (state === 'ready') launch();
      else if (state === 'over') newGame();
      else if (state === 'won') nextLevel();
    }
    touch = NG.createTouch(canvas, {
      onDown: function (pt) { applyPaddleInput(); tap(); },
    });

    // Desktop convenience: move the mouse to slide the paddle without holding a
    // button (touch never needs this — a finger is always "down" while dragging).
    window.addEventListener('mousemove', function (ev) {
      if (touch.count) return;             // a real pointer drag already owns it
      var rect = canvas.getBoundingClientRect();
      paddle.cx = clamp(ev.clientX - rect.left, paddle.w / 2, W - paddle.w / 2);
    });

    // Keyboard: pure desktop-development convenience (the game never requires it).
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      var step = W * 0.05;
      if (k === 'arrowleft' || k === 'a') { paddle.cx = clamp(paddle.cx - step, paddle.w / 2, W - paddle.w / 2); ev.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { paddle.cx = clamp(paddle.cx + step, paddle.w / 2, W - paddle.w / 2); ev.preventDefault(); }
      else if (k === ' ' || k === 'spacebar' || k === 'enter' || k === 'arrowup' || k === 'w') { tap(); ev.preventDefault(); }
    });

    // ---- boot --------------------------------------------------------------
    NG.onResize(layout);
    NG.setPlaying(false);

    var last = 0;
    function loop(t) {
      if (!last) last = t;
      var dt = Math.min((t - last) / 1000, 1 / 30);
      last = t;
      update(dt);
      draw();
      window.requestAnimationFrame(loop);
    }
    window.requestAnimationFrame(loop);
  });
})();
