/*
 * Pong — two-player, same-device. Touch-first, with mouse support.
 *
 * Demonstrates the catalogue's core conventions:
 *   - classic script under the NG namespace (no modules, runs from file://)
 *   - the three design ratios, via NG.classify / NG.fit / NG.onResize
 *   - multitouch via NG.createTouch (one finger per paddle, simultaneously)
 *
 * Curve ball: the ball carries spin. Flicking a paddle as you strike imparts it;
 * in flight it curves the path (Magnus); at the side walls it adds an along-wall
 * kick (speeds the ball up when the spin runs with its motion, slows it against)
 * while the wall scrubs the spin. A spin-free ball and the paddle hit both follow
 * classic rules. See bounce(), wallBounce(), and the Magnus block in update().
 *
 * Mouse play: left-click a paddle to lock onto it — it then follows the mouse
 * with no button held. Right-click, or a left-click off the paddle, releases.
 *
 * The court is described in an orientation-independent "main / cross" space:
 *   - main  = the long axis the ball travels between the two paddles
 *   - cross = the short axis the paddles slide along
 * In landscape (16:9, 9:8) main = x and the paddles sit left/right.
 * In portrait (9:16) main = y and the paddles sit top/bottom, so the two
 * players face each other across the device. One physics path serves both.
 */
(function () {
  'use strict';

  var WIN_SCORE = 7;
  var FG = '#4dff88';      // phosphor green
  var DIM = '#1d5e38';
  var SPIN_C = '#ffcf4d';  // amber — telegraphs a curving ball

  // --- Curve-ball physics -----------------------------------------------------
  // `spin` is the ball's rotational SURFACE speed (units/sec). In flight it curves
  // the path (Magnus). At a side wall it adds an along-wall kick — speeding the
  // ball up when the spin runs with its motion, slowing it when against — and the
  // wall scrubs that spin; a straight (spin-free) ball bounces with NO slow-down,
  // like the classic game. A paddle hit keeps the classic rule (contact offset =
  // angle, slight speed-up); flicking the paddle sideways is what imparts spin.
  var MAGNUS = 5.0;            // curve strength (velocity turn-rate per spin/court-length)
  var SPIN_FROM_PADDLE = 0.40; // spin gained as a fraction of the paddle's flick speed
  var SPIN_HALFLIFE = 1.2;     // seconds for in-flight spin to halve (air drag)
  var WALL_GRIP = 0.30;        // wall: fraction of spin turned into an along-wall kick
  var PADDLE_SPEEDUP = 1.05;   // classic slight speed-up on every paddle hit
  var MAX_BOUNCE = 0.70;       // classic: contact offset -> up to ~40deg launch angle
  var SPIN_MAX_DEV = 1.05;     // max travel angle off the main axis (~60 deg)
  var AI_CURVE_CHANCE = 0.10;  // chance the AI deliberately curves a return

  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- layout (recomputed on every resize / orientation change) ----------
    var mode = 'landscape';        // 'landscape' | 'portrait'
    var courtW = 0, courtH = 0;    // logical pixel size, in screen orientation
    var mainLen = 0, crossLen = 0; // along the main / cross axes
    var WALL, PADDLE_LEN, PADDLE_THICK, BALL_R, SPEED, MAX_SPEED;
    var drawScale = 1;

    // ---- game state --------------------------------------------------------
    var p0 = { cross: 0, prevCross: 0, vel: 0, aimBias: 0, decided: false, flickDir: 0, score: 0 };  // low side  (left / top)
    var p1 = { cross: 0, prevCross: 0, vel: 0, aimBias: 0, decided: false, flickDir: 0, score: 0 };  // high side (right / bottom)
    var ball = { main: 0, cross: 0, vmain: 0, vcross: 0, dir: 1, spin: 0 };
    var trail = [];                    // recent ball positions, for the curve comet tail
    var state = 'ready';               // 'ready' | 'playing' | 'over'
    var winner = -1;
    var rally = 0, matchBestRally = 0; // paddle hits in the current point / match
    var rallyStats = null;             // {best, isNew} — set when a match ends
    var started = false;
    var touch = null;                  // NG.createTouch controller (assigned below)
    var mouseLock = { active: false, side: -1, cross: 0 };  // mouse lock-on (set up below)

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function clampCross(v) { return clamp(v, PADDLE_LEN / 2, crossLen - PADDLE_LEN / 2); }

    function layout(info) {
      // Fill the whole viewport edge-to-edge (no letterbox): the court IS the
      // browser canvas. The three design ratios still drive the *layout* — which
      // edges the paddles sit on — via the screen's actual orientation, so it
      // looks as intended at 16:9 / 9:8 / 9:16 and just uses all the space at any
      // in-between size. (Games needing exact proportions can NG.fit() instead.)
      var dpr = window.devicePixelRatio || 1;
      courtW = info.width;
      courtH = info.height;

      canvas.style.width = courtW + 'px';
      canvas.style.height = courtH + 'px';
      canvas.width = Math.round(courtW * dpr);
      canvas.height = Math.round(courtH * dpr);
      drawScale = dpr;                 // draw directly in CSS-pixel units

      var portrait = courtH > courtW;
      mode = portrait ? 'portrait' : 'landscape';
      mainLen = portrait ? courtH : courtW;
      crossLen = portrait ? courtW : courtH;

      WALL = mainLen * 0.0175;         // small gap behind the paddle, near the screen edge
      PADDLE_LEN = crossLen * 0.20;
      PADDLE_THICK = Math.max(mainLen * 0.018, 8);
      BALL_R = Math.min(mainLen, crossLen) * 0.014;
      SPEED = mainLen * 0.62;          // logical units / second
      MAX_SPEED = mainLen * 1.32;      // ceiling ~15% higher; rallies ramp up to it via PADDLE_SPEEDUP

      if (!started) {
        started = true;
        p0.cross = p1.cross = crossLen / 2;
        p0.prevCross = p1.prevCross = crossLen / 2;
        p0.aimBias = aiBias();
        p1.aimBias = aiBias();
        resetBall(Math.random() < 0.5 ? 1 : -1);
        state = 'ready';
      } else {
        p0.cross = clampCross(p0.cross);
        p1.cross = clampCross(p1.cross);
        ball.cross = clamp(ball.cross, BALL_R, crossLen - BALL_R);
        ball.main = clamp(ball.main, BALL_R, mainLen - BALL_R);
      }
    }

    function resetBall(dir) {
      ball.main = mainLen / 2;
      ball.cross = crossLen / 2;
      ball.vmain = 0;
      ball.vcross = 0;
      ball.dir = dir;
      ball.spin = 0;
      trail.length = 0;
    }

    function launch() {
      var angle = (Math.random() - 0.5) * 0.7;       // small spread
      ball.vmain = ball.dir * SPEED * Math.cos(angle);
      ball.vcross = SPEED * Math.sin(angle);
      state = 'playing';
      NG.setPlaying(true);            // hide page chrome (FINISH button) during play
    }

    function newGame() {
      p0.score = p1.score = 0;
      winner = -1;
      rally = 0; matchBestRally = 0; rallyStats = null;
      resetBall(Math.random() < 0.5 ? 1 : -1);
      state = 'ready';
      NG.setPlaying(false);
    }

    // ---- input: each active touch drives the paddle on the side it began on -
    function applyInput() {
      var pts = touch.list();
      var c0 = false, c1 = false;
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var startMain = mode === 'portrait' ? pt.startNy : pt.startNx;
        var crossNorm = mode === 'portrait' ? pt.nx : pt.ny;
        var target = clampCross(crossNorm * crossLen);
        if (startMain < 0.5) { p0.cross = target; c0 = true; }
        else { p1.cross = target; c1 = true; }
      }
      return { p0: c0, p1: c1 };
    }

    // A fresh off-centre aim point, reseeded whenever a paddle strikes the ball,
    // so AI hits never deflect dead-straight (which makes two AIs lock into a
    // boring 180-degree rally) and instead vary the angle on every return.
    function aiBias() {
      var sgn = Math.random() < 0.5 ? -1 : 1;
      return sgn * PADDLE_LEN * (0.12 + Math.random() * 0.22);   // 12%..34% of paddle length
    }

    // Predict where the ball will cross this paddle's plane (folding side-wall
    // bounces), so the AI can move straight to the intercept instead of shadowing
    // the ball the whole time. Ignores curve — which keeps the AI beatable.
    function predictCross(isLow) {
      var plane = isLow ? WALL + PADDLE_THICK + BALL_R : mainLen - WALL - PADDLE_THICK - BALL_R;
      if (Math.abs(ball.vmain) < 1) return ball.cross;
      var time = (plane - ball.main) / ball.vmain;
      if (time <= 0) return ball.cross;
      var lo = BALL_R, hi = crossLen - BALL_R, span = hi - lo;
      var x = (ball.cross + ball.vcross * time - lo) % (2 * span);
      if (x < 0) x += 2 * span;
      if (x > span) x = 2 * span - x;             // reflect off the side walls
      return lo + x;
    }

    // Which way can a paddle centred at `c` flick? You can only curve by moving,
    // so near an edge only one direction has room (at the very bottom it must
    // flick up). Returns -1 (toward 0), +1 (toward crossLen), or 0 (no room).
    function feasibleFlick(c) {
      var room = PADDLE_LEN * 0.5;
      var canUp = c - PADDLE_LEN / 2 > room;
      var canDown = (crossLen - PADDLE_LEN / 2) - c > room;
      if (canUp && canDown) return Math.random() < 0.5 ? -1 : 1;
      return canUp ? -1 : (canDown ? 1 : 0);
    }

    // Lazy, smarter AI: only move when the ball is coming at this paddle, heading
    // straight to the predicted intercept and then holding. Once per approach it
    // may (AI_CURVE_CHANCE) decide to curve the return — picking a direction it
    // actually has room to flick — then, as the ball arrives, it sweeps the paddle
    // through the contact so it is genuinely MOVING at impact. The spin is produced
    // by that real motion (via p.vel in bounce()), exactly like a human flick — a
    // stationary paddle cannot curve the ball.
    function aiMove(p, dt, isLow) {
      var approaching = isLow ? ball.vmain < 0 : ball.vmain > 0;
      if (!approaching) { p.decided = false; p.flickDir = 0; return; }  // reset each approach

      var intercept = predictCross(isLow);
      var plane = isLow ? WALL + PADDLE_THICK + BALL_R : mainLen - WALL - PADDLE_THICK - BALL_R;
      var tau = (plane - ball.main) / ball.vmain;        // seconds until contact

      if (!p.decided && tau > 0 && tau < 0.35) {         // commit once per approach
        p.decided = true;
        p.flickDir = (Math.random() < AI_CURVE_CHANCE) ? feasibleFlick(intercept) : 0;
      }

      var maxV = crossLen * 0.95;
      // when curving, line up dead-centre (no aim bias) so the sweep stays on the ball
      var target = clampCross(intercept + (p.flickDir ? 0 : p.aimBias));
      if (p.flickDir && tau > 0 && tau < 0.10) {
        // FLICK: keep sweeping in the chosen direction — the far target means the
        // paddle never reaches it and stops, so it is still moving at impact.
        target = clampCross(intercept + p.flickDir * crossLen);
        maxV = PADDLE_LEN * 4;                           // ~0.4 paddle-len of travel over the 0.1s flick
      } else if (Math.abs(target - p.cross) < crossLen * 0.012) {
        return;                                          // parked on the intercept — hold still
      }
      p.cross = clampCross(p.cross + clamp(target - p.cross, -maxV * dt, maxV * dt));
    }

    // Cap the travel angle off the main axis so the ball always heads toward a
    // paddle (the Magnus curve saturates here rather than stalling the rally).
    function clampTravel() {
      var sp = Math.hypot(ball.vmain, ball.vcross);
      if (sp === 0) return;
      var ms = ball.vmain >= 0 ? 1 : -1;
      var dev = clamp(Math.atan2(ball.vcross, Math.abs(ball.vmain)), -SPIN_MAX_DEV, SPIN_MAX_DEV);
      ball.vmain = ms * sp * Math.cos(dev);
      ball.vcross = sp * Math.sin(dev);
    }

    // Side wall: a spin-free ball reflects with no speed loss (classic). Spin adds
    // an along-wall kick — with the motion it speeds the ball up, against it slows
    // the ball down — and the wall scrubs the spin it used. (If the speed-up vs
    // slow-down ever feels inverted, flip the sign of `s`.)
    function wallBounce(low) {
      ball.vcross = low ? Math.abs(ball.vcross) : -Math.abs(ball.vcross);
      var s = (low ? 1 : -1) * ball.spin;        // spin's surface speed along +main
      var lim = 0.6 * Math.abs(ball.vmain);      // cap the kick so a wall can't reverse the ball
      ball.vmain += clamp(WALL_GRIP * s, -lim, lim);
      ball.spin *= (1 - WALL_GRIP);
      var sp = Math.hypot(ball.vmain, ball.vcross);
      if (sp > MAX_SPEED) { ball.vmain *= MAX_SPEED / sp; ball.vcross *= MAX_SPEED / sp; }
    }

    function bounce(p, sign) {
      // Classic paddle rule: where the ball meets the paddle sets the bounce angle,
      // and every hit speeds it up a little (but never below the serve speed).
      var rel = clamp((ball.cross - p.cross) / (PADDLE_LEN / 2), -1, 1);
      var speed = clamp(Math.hypot(ball.vmain, ball.vcross) * PADDLE_SPEEDUP, SPEED, MAX_SPEED);
      var angle = rel * MAX_BOUNCE;
      ball.vmain = sign * speed * Math.cos(angle);
      ball.vcross = speed * Math.sin(angle);
      // The paddle's own sideways motion at impact (p.vel) is what spins the ball —
      // for both a human drag and the AI's flick sweep. A still paddle => no spin.
      ball.spin = clamp(SPIN_FROM_PADDLE * p.vel * sign, -MAX_SPEED, MAX_SPEED);
      p.aimBias = aiBias();           // next AI return from this paddle aims somewhere new
      rally++;
      if (rally > matchBestRally) matchBestRally = rally;
    }

    function afterPoint(dir) {
      rally = 0;
      if (p0.score >= WIN_SCORE) { winner = 0; state = 'over'; rallyStats = NG.bestScore('ng_pong_best_rally', matchBestRally); }
      else if (p1.score >= WIN_SCORE) { winner = 1; state = 'over'; rallyStats = NG.bestScore('ng_pong_best_rally', matchBestRally); }
      else { resetBall(dir); state = 'ready'; }
      NG.setPlaying(false);          // bring the FINISH button back between points / on game over
    }

    function update(dt) {
      var ctrl = applyInput();
      if (mouseLock.active) {           // a mouse-locked paddle follows the cursor
        if (mouseLock.side === 0) { p0.cross = clampCross(mouseLock.cross); ctrl.p0 = true; }
        else { p1.cross = clampCross(mouseLock.cross); ctrl.p1 = true; }
      }
      if (state !== 'playing') {
        // keep prevCross current so the first in-play frame doesn't read a
        // huge phantom paddle velocity (and thus phantom spin).
        p0.prevCross = p0.cross; p1.prevCross = p1.cross;
        return;
      }

      if (!ctrl.p0) aiMove(p0, dt, true); else p0.flickDir = 0;   // human control clears any AI flick
      if (!ctrl.p1) aiMove(p1, dt, false); else p1.flickDir = 0;

      // paddle velocities along the cross axis (units/sec) — the curve source
      p0.vel = (p0.cross - p0.prevCross) / dt; p0.prevCross = p0.cross;
      p1.vel = (p1.cross - p1.prevCross) / dt; p1.prevCross = p1.cross;

      // Magnus: in flight, spin curves the velocity vector, then air drag bleeds
      // it away. clampTravel keeps the ball progressing toward a paddle.
      if (ball.spin) {
        var a = (MAGNUS * ball.spin / mainLen) * dt, ca = Math.cos(a), sa = Math.sin(a);
        var vm = ball.vmain, vc = ball.vcross;
        ball.vmain = vm * ca - vc * sa;
        ball.vcross = vm * sa + vc * ca;
        ball.spin *= Math.pow(0.5, dt / SPIN_HALFLIFE);
        if (Math.abs(ball.spin) < SPEED * 0.02) ball.spin = 0;
      }
      clampTravel();

      var prevMain = ball.main;
      var prevCross = ball.cross;
      ball.main += ball.vmain * dt;
      ball.cross += ball.vcross * dt;

      // side walls: spin-free ball reflects cleanly; spin adds an along-wall kick.
      if (ball.cross < BALL_R) { ball.cross = BALL_R; wallBounce(true); }
      else if (ball.cross > crossLen - BALL_R) { ball.cross = crossLen - BALL_R; wallBounce(false); }

      // swept paddle collisions (avoids tunnelling at high speed)
      var plane0 = WALL + PADDLE_THICK + BALL_R;
      if (ball.vmain < 0 && prevMain >= plane0 && ball.main <= plane0) {
        var t0 = (prevMain - plane0) / (prevMain - ball.main);
        var hit0 = prevCross + (ball.cross - prevCross) * t0;
        if (Math.abs(hit0 - p0.cross) <= PADDLE_LEN / 2 + BALL_R) {
          ball.main = plane0; ball.cross = hit0; bounce(p0, +1);
        }
      }
      var plane1 = mainLen - WALL - PADDLE_THICK - BALL_R;
      if (ball.vmain > 0 && prevMain <= plane1 && ball.main >= plane1) {
        var t1 = (plane1 - prevMain) / (ball.main - prevMain);
        var hit1 = prevCross + (ball.cross - prevCross) * t1;
        if (Math.abs(hit1 - p1.cross) <= PADDLE_LEN / 2 + BALL_R) {
          ball.main = plane1; ball.cross = hit1; bounce(p1, -1);
        }
      }

      // comet tail — records the (possibly curved) path
      trail.push({ m: ball.main, c: ball.cross });
      if (trail.length > 14) trail.shift();

      // scoring
      if (ball.main < -BALL_R) { p1.score++; afterPoint(-1); }
      else if (ball.main > mainLen + BALL_R) { p0.score++; afterPoint(+1); }
    }

    // ---- drawing (all in logical units; main/cross mapped to x/y) -----------
    function toX(main, cross) { return mode === 'portrait' ? cross : main; }
    function toY(main, cross) { return mode === 'portrait' ? main : cross; }

    function fillRectMC(m0, m1, c0, c1) {
      var x0 = mode === 'portrait' ? c0 : m0;
      var x1 = mode === 'portrait' ? c1 : m1;
      var y0 = mode === 'portrait' ? m0 : c0;
      var y1 = mode === 'portrait' ? m1 : c1;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

      ctx.shadowColor = FG;
      ctx.shadowBlur = Math.max(courtW, courtH) * 0.012;

      // net across the middle of the main axis
      ctx.strokeStyle = DIM;
      ctx.lineWidth = BALL_R * 0.6;
      ctx.setLineDash([crossLen * 0.04, crossLen * 0.03]);
      ctx.beginPath();
      ctx.moveTo(toX(mainLen / 2, 0), toY(mainLen / 2, 0));
      ctx.lineTo(toX(mainLen / 2, crossLen), toY(mainLen / 2, crossLen));
      ctx.stroke();
      ctx.setLineDash([]);

      // scores, near each player's side
      ctx.fillStyle = DIM;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + (crossLen * 0.18).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(String(p0.score), toX(mainLen * 0.30, crossLen / 2), toY(mainLen * 0.30, crossLen / 2));
      ctx.fillText(String(p1.score), toX(mainLen * 0.70, crossLen / 2), toY(mainLen * 0.70, crossLen / 2));

      // paddles
      ctx.fillStyle = FG;
      fillRectMC(WALL, WALL + PADDLE_THICK, p0.cross - PADDLE_LEN / 2, p0.cross + PADDLE_LEN / 2);
      fillRectMC(mainLen - WALL - PADDLE_THICK, mainLen - WALL, p1.cross - PADDLE_LEN / 2, p1.cross + PADDLE_LEN / 2);

      // curve comet tail — amber while the ball is actively spinning, so the
      // bend is easy to read; the ball itself picks up the same tint.
      var spinning = Math.abs(MAGNUS * ball.spin / mainLen) > 0.5;
      ctx.fillStyle = spinning ? SPIN_C : FG;
      ctx.shadowColor = spinning ? SPIN_C : FG;
      for (var ti = 0; ti < trail.length; ti++) {
        var ta = (ti + 1) / trail.length;            // newer = brighter & larger
        ctx.globalAlpha = ta * 0.45;
        ctx.beginPath();
        ctx.arc(toX(trail[ti].m, trail[ti].c), toY(trail[ti].m, trail[ti].c), BALL_R * ta, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ball
      ctx.beginPath();
      ctx.arc(toX(ball.main, ball.cross), toY(ball.main, ball.cross), BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = FG;

      // prompts
      ctx.fillStyle = FG;
      if (state === 'ready') {
        ctx.font = 'bold ' + (crossLen * 0.07).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('TAP TO SERVE', courtW / 2, courtH / 2);
      } else if (state === 'over') {
        ctx.font = 'bold ' + (crossLen * 0.09).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('PLAYER ' + (winner + 1) + ' WINS', courtW / 2, courtH / 2 - crossLen * 0.06);
        if (rallyStats) {
          ctx.fillStyle = rallyStats.isNew ? SPIN_C : FG;
          ctx.font = 'bold ' + (crossLen * 0.04).toFixed(0) + 'px "Courier New", monospace';
          ctx.fillText(
            (rallyStats.isNew ? 'NEW BEST RALLY ' : 'BEST RALLY ') + rallyStats.best,
            courtW / 2, courtH / 2
          );
          ctx.fillStyle = FG;
        }
        ctx.font = 'bold ' + (crossLen * 0.06).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText('TAP TO REMATCH', courtW / 2, courtH / 2 + crossLen * 0.09);
      }
      ctx.shadowBlur = 0;
    }

    // ---- wiring ------------------------------------------------------------
    // Fingers drag paddles directly; the mouse is handled separately (lock-on),
    // so the touch helper is told to ignore mouse pointers.
    touch = NG.createTouch(canvas, {
      onDown: function () {
        if (state === 'ready') launch();
        else if (state === 'over') newGame();
      },
    }, { ignoreMouse: true });

    // Mouse: left-click a paddle to lock onto it (no need to hold the button);
    // it then tracks the cursor along the cross axis. Right-click, or a left
    // click that misses both paddles, releases.
    function mouseMC(ev) {
      var rect = canvas.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;   // CSS px == logical
      return mode === 'portrait' ? { main: y, cross: x } : { main: x, cross: y };
    }
    function overPaddle(p, isLow, mc) {
      var face = isLow ? WALL + PADDLE_THICK : mainLen - WALL - PADDLE_THICK;
      var edge = isLow ? 0 : mainLen;
      return mc.main >= Math.min(edge, face) - BALL_R &&
             mc.main <= Math.max(edge, face) + BALL_R * 6 &&
             Math.abs(mc.cross - p.cross) <= PADDLE_LEN / 2 + BALL_R * 2;
    }
    function releaseMouse() { mouseLock.active = false; mouseLock.side = -1; }
    canvas.addEventListener('mousedown', function (ev) {
      if (ev.button === 2) { releaseMouse(); return; }     // right button releases
      if (ev.button !== 0) return;
      var mc = mouseMC(ev);
      if (overPaddle(p0, true, mc)) { mouseLock.active = true; mouseLock.side = 0; mouseLock.cross = mc.cross; }
      else if (overPaddle(p1, false, mc)) { mouseLock.active = true; mouseLock.side = 1; mouseLock.cross = mc.cross; }
      else { releaseMouse(); }                             // clicked off a paddle
      if (state === 'ready') launch();                     // a click also serves / restarts
      else if (state === 'over') newGame();
    });
    window.addEventListener('mousemove', function (ev) {
      if (mouseLock.active) mouseLock.cross = mouseMC(ev).cross;
    });
    canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); releaseMouse(); });

    NG.onResize(layout);
    NG.setPlaying(false);            // start with chrome visible (state is 'ready')

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
