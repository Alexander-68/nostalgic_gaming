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
 *
 * Controls beyond drag-to-move / tap-to-launch:
 *   - PAUSE: the ‖ chip in the HUD, or SPACE on a keyboard (tap anywhere to resume).
 *   - SPEED: +/- scale the whole simulation (a 0.25x–4x debug/▸ slow-mo knob).
 *   - AI: the "AI" chip (or the I key) hands the paddle to the computer — a
 *     hands-free autoplay that serves, clears walls, and replays on its own.
 * Cleared walls roll straight into the next (faster) one automatically.
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
  var WIN_BANNER = 1.3;          // seconds the "wall cleared" banner holds before auto-advancing
  var SPEED_MUL_MIN = 0.25;      // +/- keys scale the whole simulation within these bounds
  var SPEED_MUL_MAX = 8;
  var PADDLE_SHRINK = 0.06;      // paddle loses this fraction of its base width per level...
  var PADDLE_MIN_SCALE = 0.5;    // ...down to half size (reached around level 9)
  var AI_LAUNCH_DELAY = 0.6;     // AI mode: beat on the paddle before it serves
  var AI_RESTART_DELAY = 1.6;    // AI mode: hold on game-over before it replays
  var AI_PADDLE_SPEED = 1.8;     // AI paddle max travel, in screen widths / second
  var AI_FALLBACK_FRAMES = 150;  // AI: frames with no brick broken before it sweeps the ball out of a stuck orbit
  var AI_GIVEUP_FRAMES = 450;    // AI: ...and before it gives up and drops the ball to reset (can't lock)

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
    var fullWall = 0;                 // brick count of a fresh wall (for AI phase thresholds)
    var score = 0, lives = START_LIVES, level = 1;
    var paddle = { cx: 0, w: 0, h: 0, y: 0 };
    var ball = { x: 0, y: 0, vx: 0, vy: 0, r: 0, speed: 0 };
    var trail = [];                   // recent ball positions, for the comet tail
    var clock = 0;                    // wall clock, for prompt pulsing
    var touch = null;
    var paused = false;               // SPACE / ‖ chip: freeze play (state stays 'playing')
    var aiOn = false;                 // AI chip / I key: computer drives the paddle
    var speedMul = 1;                 // +/- debug time scale
    var wonTimer = 0;                 // counts up during the 'won' banner, then auto-advances
    var aiTimer = 0;                  // AI dwell before it serves / replays
    var aiEdge = 0;                   // AI tunnel side: -1 left, +1 right, 0 = re-pick
    var aiPrevBricks = 1e9;           // bricksLeft last AI tick — to detect "no brick broken"
    var aiNoHit = 0;                  // consecutive descending ticks with no brick broken

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
      // bottom edge, leaving a small reaction gap below it. Width also shrinks
      // with the level (see applyPaddleWidth) for a rising difficulty curve.
      applyPaddleWidth();
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
      bricksLeft = fullWall = rows * cols;
      aiEdge = 0;                     // re-pick which edge to tunnel for the new wall
    }
    // Collision uses the full, contiguous cell (bricks touch, so the ball can't
    // thread the visual gaps); drawing insets the cell for the gridded look.
    function cellRect(b) {
      return { x: fieldX + b.col * cellW, y: fieldTop + b.row * cellH, w: cellW, h: cellH };
    }

    // ---- round / game transitions ------------------------------------------
    // Paddle width = its base size for this ratio, scaled down a little per level
    // (floored at half). Recomputed on resize and on every (re)serve so the level
    // ramp takes effect; clamps the paddle centre back inside the narrower bounds.
    function applyPaddleWidth() {
      var baseW = clamp(W * 0.16, unit * 0.14, W * 0.45);
      paddle.w = baseW * clamp(1 - PADDLE_SHRINK * (level - 1), PADDLE_MIN_SCALE, 1);
      paddle.cx = clamp(paddle.cx, paddle.w / 2, W - paddle.w / 2);
    }

    function resetBallReady() {
      applyPaddleWidth();
      aiNoHit = 0; aiPrevBricks = bricksLeft;   // fresh ball — clear the AI stuck-timers
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
    function winLevel() { state = 'won'; wonTimer = 0; NG.setPlaying(false); }
    function advanceWin() { nextLevel(); launch(); }   // roll straight into the next wall

    // ---- pause -------------------------------------------------------------
    function setPaused(p) {
      if (state !== 'playing' && !paused) return;   // only meaningful during play
      paused = p;
      NG.setPlaying(!p);             // bring the FINISH button back while paused
    }
    function togglePause() { if (state === 'playing' || paused) setPaused(!paused); }

    // ---- AI autoplay -------------------------------------------------------
    // A hands-free "watch it play" / take-over mode. The paddle is driven by a
    // predict-and-intercept controller (where will the ball cross the paddle's
    // line, folding side-wall bounces?) that nudges the contact point so the
    // rebound heads back toward whatever bricks remain — so it clears walls
    // instead of drilling one column. With AI on it also serves, advances, and
    // replays on its own, looping as an attract demo until you tap it off.
    function predictPaddleX() {
      if (ball.vy <= 0) return ball.x;
      var plane = paddle.y - ball.r;
      var time = (plane - ball.y) / ball.vy;
      if (time <= 0) return ball.x;
      var lo = ball.r, hi = W - ball.r, span = hi - lo;
      if (span <= 0) return ball.x;
      var x = (ball.x + ball.vx * time - lo) % (2 * span);
      if (x < 0) x += 2 * span;
      if (x > span) x = 2 * span - x;          // reflect off the side walls
      return lo + x;
    }
    // Bricks still standing in each column.
    function colCounts() {
      var counts = [];
      for (var c = 0; c < cols; c++) counts[c] = 0;
      for (var i = 0; i < bricks.length; i++) if (bricks[i].alive) counts[bricks[i].col]++;
      return counts;
    }
    // Centre of mass (x) of the standing bricks — the un-stick pulls the ball here.
    function brickCentroidX() {
      var sx = 0, n = 0;
      for (var i = 0; i < bricks.length; i++) {
        if (!bricks[i].alive) continue;
        sx += fieldX + (bricks[i].col + 0.5) * cellW; n++;
      }
      return n ? sx / n : W / 2;
    }
    // The standing brick whose column sits closest to x — the mop-up target
    // (always a real brick, so aiming here is guaranteed to break one).
    function nearestBrickX(x) {
      var best = x, bestD = Infinity;
      for (var i = 0; i < bricks.length; i++) {
        if (!bricks[i].alive) continue;
        var bx = fieldX + (bricks[i].col + 0.5) * cellW;
        var d = Math.abs(bx - x);
        if (d < bestD) { bestD = d; best = bx; }
      }
      return best;
    }
    // The smart move: TUNNEL up an edge. Rather than spreading fire across the wall,
    // the AI drills a channel up one edge, then fires the ball through that open
    // channel so it pops out ABOVE the wall and bounces along the tops, clearing a
    // chunk hands-off — the classic Breakout strategy. Targeting is layered so it's
    // fast AND can never lock:
    //   1. drill the edge column open;
    //   2. once open, shoot the ball up the channel (leaning at the brick mass);
    //   3. past the half-cleared mark, switch to efficient nearest-brick clearing
    //      (and the same for the last row of stragglers);
    //   4. if nothing breaks for a while, the ball is usually caught in an orbit
    //      hugging a side wall — pull toward the brick centroid and perturb to
    //      shake it loose;
    //   5. and if even that fails, give up and let the ball drop: a fresh serve
    //      always breaks the orbit, so an infinite lock is impossible.
    function aiMovePaddle(edt) {
      var half = paddle.w / 2, target;
      if (ball.vy > 0) {                         // descending — set up the next hit
        var px = predictPaddleX();
        var counts = colCounts();
        if (bricksLeft < aiPrevBricks) aiNoHit = 0; else aiNoHit++;   // track "nothing broke"
        aiPrevBricks = bricksLeft;
        if (aiEdge === 0) aiEdge = (counts[0] <= counts[cols - 1]) ? -1 : 1;  // tunnel the lighter edge

        if (aiNoHit > AI_GIVEUP_FRAMES) {
          // Hopelessly stuck (an orbit the un-stick couldn't break) — dodge to the
          // far corner and let the ball drop. It costs a life, but re-serving with a
          // fresh trajectory ALWAYS breaks the orbit, so the AI can never lock up.
          target = ball.x < W / 2 ? W - half : half;
          target = clamp(target, half, W - half);
          paddle.cx = clamp(paddle.cx + clamp(target - paddle.cx, -W * AI_PADDLE_SPEED * edt, W * AI_PADDLE_SPEED * edt), half, W - half);
          return;
        }

        // gap = columns already cleared inward from the chosen edge; aliveCol = the
        // frontmost column on that side that still has bricks (the drilling front).
        var gap = 0;
        if (aiEdge < 0) { while (gap < cols && counts[gap] === 0) gap++; }
        else { while (gap < cols && counts[cols - 1 - gap] === 0) gap++; }
        var aliveCol = aiEdge < 0 ? gap : cols - 1 - gap;
        var inward = aiEdge < 0 ? 1 : -1;        // +x is "inward" when tunnelling the left edge
        var rel;
        if (bricksLeft <= cols || bricksLeft <= fullWall * 0.55 || aliveCol < 0 || aliveCol >= cols) {
          // Once the channel is open and the top-play has been shown (under ~half the
          // wall left), stop tunnelling and clear efficiently by nearest brick — the
          // ball still pops through the open channel on its own. Keeps wide walls
          // from dragging on. Final stragglers (≤ a row) use the same precise aim.
          rel = clamp((nearestBrickX(px) - px) / (W * 0.5), -0.6, 0.6);
        } else if (aiNoHit > AI_FALLBACK_FRAMES) {
          // Stuck with nothing breaking — almost always the ball caught in a stable
          // orbit hugging a side wall, out of reach of the bricks. Aiming at a far
          // column can't fix it (the paddle can't get outside the ball near a wall),
          // so pull toward the centre of the remaining bricks AND perturb the angle
          // bounce to bounce, which walks the ball off the wall and scatters it out
          // of the orbit, back into the bricks.
          rel = clamp((brickCentroidX() - px) / (W * 0.5), -0.7, 0.7) + 0.4 * Math.sin(Math.floor(aiNoHit / 40) * 1.9);
          rel = clamp(rel, -0.85, 0.85);
        } else if (gap < 1) {
          var ex = fieldX + (aliveCol + 0.5) * cellW;                         // no channel yet — drill the edge open
          rel = clamp((ex - px) / (W * 0.5), -0.85, 0.85);
          if (Math.abs(rel) < 0.08) rel = inward * 0.08;                      // never dead-vertical
        } else {
          // Channel open — fire the ball up through it (a slight INWARD lean aims it
          // at the brick mass rather than the side wall) so it pops out ABOVE the
          // wall and bounces along the tops, clearing a chunk hands-off. The gap
          // widens and sweeps inward as that side falls.
          var gapX = aiEdge < 0 ? fieldX + (gap * 0.5) * cellW : fieldX + (cols - gap * 0.5) * cellW;
          rel = clamp((gapX - px) / (W * 0.5) + inward * 0.12, -0.85, 0.85);
        }
        target = px - rel * half;
      } else {
        target = ball.x;                         // rising — stay under it for the return
      }
      target = clamp(target, half, W - half);
      var maxV = W * AI_PADDLE_SPEED * edt;
      paddle.cx = clamp(paddle.cx + clamp(target - paddle.cx, -maxV, maxV), half, W - half);
    }
    function aiAuto(dt) {
      if (state === 'ready') { aiTimer += dt; if (aiTimer >= AI_LAUNCH_DELAY) { aiTimer = 0; launch(); } }
      else if (state === 'over') { aiTimer += dt; if (aiTimer >= AI_RESTART_DELAY) { aiTimer = 0; newGame(); } }
      else aiTimer = 0;
    }

    // ---- HUD chips (pause + AI toggle, both tappable) ----------------------
    function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
    function chipRects() {
      var fs = Math.max(unit * 0.03, 11);
      var s = fs * 1.7, y = fieldTop * 0.5 - s / 2;
      return {
        pause: { x: W * 0.02, y: y, w: s, h: s },
        ai: { x: W * 0.72, y: y, w: s * 1.5, h: s },
      };
    }

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
      if (state === 'won') { wonTimer += dt; if (wonTimer >= WIN_BANNER) advanceWin(); }
      if (aiOn) aiAuto(dt);

      var edt = dt * speedMul;             // +/- keys scale the whole simulation
      if (!paused) {
        if (aiOn && (state === 'playing' || state === 'ready')) aiMovePaddle(edt);
        else if (!aiOn) applyPaddleInput();
      }

      if (state === 'ready') {             // ball rides the paddle until launch
        ball.x = paddle.cx;
        ball.y = paddle.y - ball.r - 1;
        return;
      }
      if (state !== 'playing' || paused) return;

      // Sub-step so a fast ball can't tunnel through a thin brick or the paddle.
      var travel = Math.hypot(ball.vx, ball.vy) * edt;
      var maxStep = Math.max(2, Math.min(ball.r, cellH * 0.5));
      var steps = Math.max(1, Math.ceil(travel / maxStep));
      var sdt = edt / steps;
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

    function drawChip(r, color, on) {
      ctx.lineWidth = Math.max(1.5, unit * 0.003);
      ctx.strokeStyle = color;
      ctx.fillStyle = on ? color : 'rgba(255,255,255,0.03)';
      rrect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.28);
      ctx.fill();
      ctx.shadowColor = color;
      ctx.shadowBlur = on ? 10 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    function drawHud() {
      ctx.shadowBlur = 0;
      ctx.textBaseline = 'middle';
      var fs = Math.max(unit * 0.03, 11);
      var midY = fieldTop * 0.5;
      var ch = chipRects();

      // pause / resume chip — two bars normally, a ▸ play triangle while paused
      drawChip(ch.pause, paused ? FG : MUTED, paused);
      ctx.fillStyle = paused ? '#06120b' : MUTED;
      if (paused) {
        var trx = ch.pause.x + ch.pause.w * 0.40, trya = ch.pause.y + ch.pause.h * 0.30, trh = ch.pause.h * 0.40;
        ctx.beginPath();
        ctx.moveTo(trx, trya); ctx.lineTo(trx, trya + trh); ctx.lineTo(trx + trh * 0.9, trya + trh / 2);
        ctx.closePath(); ctx.fill();
      } else {
        var bw = ch.pause.w * 0.12, bh = ch.pause.h * 0.42, by = ch.pause.y + ch.pause.h * 0.29, bx = ch.pause.x + ch.pause.w * 0.34;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillRect(bx + bw * 2.2, by, bw, bh);
      }

      // score (after the pause chip) and level / speed (centre)
      ctx.font = 'bold ' + fs.toFixed(0) + 'px "Courier New", monospace';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left';
      ctx.fillText('SCORE ' + String(score).padStart(5, '0'), ch.pause.x + ch.pause.w + fs * 0.6, midY);
      ctx.textAlign = 'center';
      ctx.fillText('LEVEL ' + level + (speedMul !== 1 ? '   x' + speedMul.toFixed(2) : ''), W / 2, midY);

      // AI toggle chip
      drawChip(ch.ai, aiOn ? FG : MUTED, aiOn);
      ctx.fillStyle = aiOn ? '#06120b' : MUTED;
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + (ch.ai.h * 0.5).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('AI', ch.ai.x + ch.ai.w / 2, ch.ai.y + ch.ai.h / 2 + 1);

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
      if (paused) {
        drawCenter([
          { text: 'PAUSED', size: big, color: FG, glow: true },
          { text: 'TAP OR SPACE TO RESUME', size: small, color: INK, alpha: pulse },
        ]);
      } else if (state === 'ready') {
        drawCenter([
          { text: aiOn ? 'AI SERVING…' : 'TAP TO LAUNCH', size: big, color: FG, glow: true, alpha: pulse },
          { text: aiOn ? 'TAP  AI  TO TAKE OVER' : 'DRAG TO MOVE', size: small, color: MUTED },
        ]);
      } else if (state === 'won') {
        drawCenter([
          { text: 'WALL CLEARED', size: big, color: FG, glow: true },
          { text: 'NEXT WALL…', size: small, color: INK, alpha: pulse },
        ]);
      } else if (state === 'over') {
        drawCenter([
          { text: 'GAME OVER', size: big, color: '#ff5d6c', glow: true },
          { text: 'SCORE ' + score, size: small, color: INK },
          { text: aiOn ? 'AI RESTARTING…' : 'TAP TO PLAY AGAIN', size: small, color: INK, alpha: pulse },
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
      else if (state === 'won') advanceWin();    // skip the banner, go now
    }
    touch = NG.createTouch(canvas, {
      onDown: function (pt) {
        var ch = chipRects();
        if (inRect(pt.x, pt.y, ch.ai)) { aiOn = !aiOn; aiTimer = 0; return; }   // toggle AI
        if (inRect(pt.x, pt.y, ch.pause)) { togglePause(); return; }
        if (paused) { setPaused(false); return; }   // tap anywhere resumes
        if (aiOn) return;                           // AI is driving — ignore field taps
        applyPaddleInput();
        tap();
      },
    });

    // Desktop convenience: move the mouse to slide the paddle without holding a
    // button (touch never needs this — a finger is always "down" while dragging).
    window.addEventListener('mousemove', function (ev) {
      if (aiOn || paused || touch.count) return;   // AI / pause own the paddle, or a drag does
      var rect = canvas.getBoundingClientRect();
      paddle.cx = clamp(ev.clientX - rect.left, paddle.w / 2, W - paddle.w / 2);
    });

    // Keyboard: a desktop-development convenience (the game never requires it).
    // SPACE pauses (or resumes); +/- scale the sim speed; I toggles AI; arrows /
    // WASD nudge the paddle and ENTER / UP serve — all when the AI isn't driving.
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      if (k === '+' || k === '=' || k === 'add') { speedMul = Math.min(speedMul * 1.25, SPEED_MUL_MAX); ev.preventDefault(); return; }
      if (k === '-' || k === '_' || k === 'subtract') { speedMul = Math.max(speedMul / 1.25, SPEED_MUL_MIN); ev.preventDefault(); return; }
      if (k === ' ' || k === 'spacebar') {
        if (state === 'playing' || paused) togglePause(); else tap();
        ev.preventDefault(); return;
      }
      if (k === 'i') { aiOn = !aiOn; aiTimer = 0; ev.preventDefault(); return; }
      if (aiOn) return;                            // AI drives the paddle
      var step = W * 0.05, half = paddle.w / 2;
      if (k === 'arrowleft' || k === 'a') { paddle.cx = clamp(paddle.cx - step, half, W - half); ev.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { paddle.cx = clamp(paddle.cx + step, half, W - half); ev.preventDefault(); }
      else if (k === 'enter' || k === 'arrowup' || k === 'w') { tap(); ev.preventDefault(); }
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
