/*
 * Missile Command — single-player, touch-first. (See games/pong/pong.js for the
 * catalogue conventions this mirrors.)
 *
 *   - classic script under the NG namespace (no modules, runs from file://)
 *   - the three design ratios via NG.onResize, fill-the-viewport strategy: the
 *     canvas IS the window. Defence runs along the BOTTOM in every orientation
 *     and missiles always rain from the top — gravity has one direction — so,
 *     unlike Pong, the layout never rotates; it just gets wider (16:9) or
 *     narrower (9:16). Horizontal placement scales with width, fall speed with
 *     height, so a top-to-ground descent takes about the same time at any ratio.
 *   - input via NG.createTouch: tap anywhere in the sky to fire. The nearest
 *     base with ammo launches a counter-missile to that point; it detonates into
 *     an expanding blast. Multitouch fires several at once — one per finger.
 *
 * Game feel (see memory: effects come from real geometry, not hidden flags):
 * a blast destroys an enemy warhead only when the warhead is actually inside the
 * fireball's current radius — so timing and placement are everything, exactly
 * like the original. Cities and bases are destroyed by warheads that physically
 * reach the ground at them. Nothing is scripted; it all falls out of positions.
 *
 * Defence line (left to right): ALPHA base, three cities, DELTA base, three
 * cities, OMEGA base — six cities, three batteries of ten missiles. Bases and
 * ammo refill each wave; destroyed cities stay gone (one returns per BONUS_CITY
 * points). Lose all six cities and it's over.
 */
(function () {
  'use strict';

  // ---- palette (matches the catalogue's phosphor look) ----------------------
  var FRIEND = '#4dff88';   // cities, bases — phosphor green
  var DIM = '#1d5e38';      // ground, ambient
  var PLAYER = '#5be0ff';   // your counter-missiles / their blasts — cyan
  var ENEMY = '#ff5d6c';    // incoming warheads — red
  var ENEMY_HEAD = '#ffcf4d'; // warhead tip — amber, so it reads against the trail
  var INK = '#d6f7e4';      // neutral text
  var MUTED = '#6b7a72';    // secondary text

  // ---- tuning ----------------------------------------------------------------
  var CITY_COUNT = 6;
  var BASE_COUNT = 3;
  var AMMO_PER_BASE = 10;
  var BONUS_CITY = 10000;        // points between free cities
  var WAVE_BASE_COUNT = 8;       // warheads in wave 1
  var WAVE_COUNT_STEP = 3;       // +warheads per wave
  var WAVE_COUNT_MAX = 40;
  var KILL_POINTS = 25;          // per warhead destroyed (× score multiplier)
  var FLYER_POINTS = 100;        // per bomber / satellite destroyed (× multiplier)
  var CITY_BONUS = 100;          // end-of-wave, per surviving city (× multiplier)
  var AMMO_BONUS = 5;            // end-of-wave, per unused missile (× multiplier)

  NG.ready(function () {
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- layout (recomputed on every resize / orientation change) -----------
    var W = 0, H = 0;              // logical (CSS-pixel) viewport size
    var groundY = 0;              // y of the ground line; defences sit on it
    var drawScale = 1;
    var cityW = 0, cityH = 0, baseW = 0, baseH = 0;
    var baseFontStr = '';         // cached font string for base ammo readout
    var blastMax = 0;             // max fireball radius
    var enemyR = 0;               // warhead head radius (also its hit size)
    var stars = [];               // static background specks, regenerated on layout
    var starCanvas = null;        // offscreen pre-render of the starfield

    // ---- entities -----------------------------------------------------------
    // Positions x are recomputed on layout from evenly-spaced slots so the line
    // reflows with the viewport; alive/ammo state survives a resize.
    var cities = [];   // { slot, x, alive }
    var bases = [];    // { slot, x, ammo, alive }
    var enemies = [];  // incoming warheads (and bomber-dropped bombs)
    var shots = [];    // player counter-missiles in flight
    var blasts = [];   // explosions (friendly ones destroy warheads)
    var flyers = [];   // bombers / satellites that cross and drop bombs

    // ---- game state ---------------------------------------------------------
    var state = 'ready';  // 'ready' | 'playing' | 'wavebonus' | 'over'
    var wave = 1;
    var score = 0;
    var high = loadHigh();
    var sinceCity = 0;            // points accrued toward the next free city
    var toSpawn = 0;              // warheads still to release this wave
    var spawnTimer = 0;           // seconds until the next release
    var flyerTimer = 0;           // seconds until the next bomber may appear
    var bonus = null;             // { cities, ammo, total } shown on the tally screen

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function mult() { return Math.min(6, Math.ceil(wave / 2)); }   // classic-style score multiplier

    function loadHigh() {
      try { return parseInt(localStorage.getItem('ng_missile_high'), 10) || 0; }
      catch (e) { return 0; }
    }
    function saveHigh() {
      try { localStorage.setItem('ng_missile_high', String(high)); } catch (e) {}
    }

    // The nine defence slots, left to right: base, city×3, base, city×3, base.
    // Returns the x for a slot index 0..8, evenly spaced with margins.
    function slotX(slot) { return W * (slot + 1) / (BASE_COUNT + CITY_COUNT + 1); }

    function layout(info) {
      var dpr = window.devicePixelRatio || 1;
      W = info.width; H = info.height;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      drawScale = dpr;

      groundY = H * 0.86;
      cityW = clamp(W * 0.06, 24, 90);
      cityH = clamp(H * 0.05, 14, 46);
      baseW = clamp(W * 0.055, 22, 80);
      baseH = clamp(H * 0.045, 12, 42);
      blastMax = Math.min(W, H) * 0.085;
      enemyR = Math.max(Math.min(W, H) * 0.006, 2.5);
      baseFontStr = 'bold ' + (baseH * 0.55).toFixed(0) + 'px "Courier New", monospace';

      if (!cities.length) buildDefences();
      // Reflow x positions onto the new slot spacing (state is preserved).
      for (var i = 0; i < cities.length; i++) cities[i].x = slotX(cities[i].slot);
      for (var j = 0; j < bases.length; j++) bases[j].x = slotX(bases[j].slot);

      // Static starfield — generate positions, then bake into an offscreen canvas
      // so draw() can blit it with one drawImage instead of N fillRect+alpha calls.
      stars.length = 0;
      var n = Math.round((W * H) / 14000);
      for (var s = 0; s < n; s++) {
        stars.push({ x: Math.random() * W, y: Math.random() * groundY * 0.96, r: rand(0.4, 1.3), a: rand(0.05, 0.35) });
      }
      if (!starCanvas) starCanvas = document.createElement('canvas');
      starCanvas.width = canvas.width;
      starCanvas.height = canvas.height;
      var sc = starCanvas.getContext('2d');
      sc.clearRect(0, 0, starCanvas.width, starCanvas.height);
      sc.setTransform(drawScale, 0, 0, drawScale, 0, 0);
      for (var si = 0; si < stars.length; si++) {
        var st = stars[si];
        sc.globalAlpha = st.a;
        sc.fillStyle = INK;
        sc.fillRect(st.x, st.y, st.r, st.r);
      }
      sc.globalAlpha = 1;
    }

    function buildDefences() {
      cities.length = 0; bases.length = 0;
      // base slots 0,4,8 — city slots 1,2,3,5,6,7
      var baseSlots = [0, 4, 8];
      var citySlots = [1, 2, 3, 5, 6, 7];
      for (var b = 0; b < baseSlots.length; b++) bases.push({ slot: baseSlots[b], x: slotX(baseSlots[b]), ammo: AMMO_PER_BASE, alive: true });
      for (var c = 0; c < citySlots.length; c++) cities.push({ slot: citySlots[c], x: slotX(citySlots[c]), alive: true });
    }

    // ---- wave / game lifecycle ----------------------------------------------
    function startGame() {
      score = 0; sinceCity = 0; wave = 1;
      buildDefences();
      startWave();
    }

    function startWave() {
      enemies.length = 0; shots.length = 0; blasts.length = 0; flyers.length = 0;
      for (var i = 0; i < bases.length; i++) { bases[i].ammo = AMMO_PER_BASE; bases[i].alive = true; }
      toSpawn = Math.min(WAVE_COUNT_MAX, WAVE_BASE_COUNT + (wave - 1) * WAVE_COUNT_STEP);
      spawnTimer = rand(0.3, 0.9);
      flyerTimer = rand(4, 8);
      state = 'playing';
      NG.setPlaying(true);
    }

    function aliveCities() { var n = 0; for (var i = 0; i < cities.length; i++) if (cities[i].alive) n++; return n; }
    function aliveBases() { var n = 0; for (var i = 0; i < bases.length; i++) if (bases[i].alive) n++; return n; }

    // A ground point for a warhead to aim at: a surviving city or base, else a
    // bare patch of ground (so late warheads still rain down on a lost city).
    function pickTarget() {
      var live = [];
      for (var i = 0; i < cities.length; i++) if (cities[i].alive) live.push(cities[i]);
      for (var j = 0; j < bases.length; j++) if (bases[j].alive) live.push(bases[j]);
      if (live.length) {
        var t = live[(Math.random() * live.length) | 0];
        return { x: t.x, obj: t };
      }
      return { x: rand(W * 0.1, W * 0.9), obj: null };
    }

    function spawnWarhead(ox, oy) {
      var tgt = pickTarget();
      var speed = H * (0.045 + wave * 0.006);
      speed = Math.min(speed, H * 0.16);
      var dx = tgt.x - ox, dy = groundY - oy;
      var d = Math.hypot(dx, dy) || 1;
      // MIRV: from wave 2 on, a warhead may split once on the way down.
      var canSplit = wave >= 2 && Math.random() < Math.min(0.5, 0.15 + wave * 0.04);
      enemies.push({
        x: ox, y: oy, ox: ox, oy: oy,
        vx: (dx / d) * speed, vy: (dy / d) * speed,
        target: tgt.obj, tx: tgt.x,
        splitAt: canSplit ? rand(H * 0.3, H * 0.5) : -1,
      });
    }

    function splitWarhead(e) {
      var kids = 1 + ((Math.random() < 0.5) ? 1 : 0);   // 2–3 total
      var speed = Math.hypot(e.vx, e.vy);
      for (var k = 0; k < kids; k++) {
        var tgt = pickTarget();
        var dx = tgt.x - e.x, dy = groundY - e.y;
        var d = Math.hypot(dx, dy) || 1;
        enemies.push({
          x: e.x, y: e.y, ox: e.x, oy: e.y,
          vx: (dx / d) * speed, vy: (dy / d) * speed,
          target: tgt.obj, tx: tgt.x, splitAt: -1,
        });
      }
    }

    function spawnFlyer() {
      var fromLeft = Math.random() < 0.5;
      var sat = Math.random() < 0.5;        // satellite (higher) vs bomber (lower)
      flyers.push({
        x: fromLeft ? -W * 0.05 : W * 1.05,
        y: rand(H * 0.08, H * 0.2),
        vx: (fromLeft ? 1 : -1) * W * rand(0.11, 0.16),
        sat: sat,
        dropTimer: rand(0.4, 1.2),
        drops: 1 + ((Math.random() < 0.5) ? 1 : 0),
      });
    }

    function spawnBlast(x, y, friendly) {
      blasts.push({ x: x, y: y, t: 0, dur: friendly ? 1.1 : 0.55, maxR: friendly ? blastMax : blastMax * 0.5, r: 0, friendly: friendly });
    }

    // Detonate a warhead at the ground: destroy whatever defence it struck.
    function groundHit(e) {
      spawnBlast(e.tx, groundY, false);
      if (e.target && e.target.alive) e.target.alive = false;
    }

    // ---- firing -------------------------------------------------------------
    function fireAt(tx, ty) {
      if (state !== 'playing') return;
      ty = clamp(ty, 0, groundY - 1);
      tx = clamp(tx, 0, W);
      // nearest battery with ammo & still standing
      var best = null, bestD = Infinity;
      for (var i = 0; i < bases.length; i++) {
        var b = bases[i];
        if (!b.alive || b.ammo <= 0) continue;
        var d = Math.abs(b.x - tx);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (!best) return;            // out of missiles everywhere — no shot
      best.ammo--;
      var ox = best.x, oy = groundY - baseH;
      var dx = tx - ox, dy = ty - oy;
      var d2 = Math.hypot(dx, dy) || 1;
      var speed = H * 1.45;
      shots.push({ x: ox, y: oy, vx: (dx / d2) * speed, vy: (dy / d2) * speed, tx: tx, ty: ty, ox: ox, oy: oy });
    }

    // ---- per-frame update ---------------------------------------------------
    function update(dt) {
      if (state !== 'playing') return;

      // release warheads over the course of the wave
      if (toSpawn > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          var burst = (wave >= 4 && Math.random() < 0.35) ? 2 : 1;
          for (var s = 0; s < burst && toSpawn > 0; s++) {
            spawnWarhead(rand(W * 0.05, W * 0.95), 0);
            toSpawn--;
          }
          spawnTimer = rand(0.4, 1.4) * Math.max(0.4, 1 - wave * 0.05);
        }
      }

      // bombers / satellites
      if (wave >= 2) {
        flyerTimer -= dt;
        if (flyerTimer <= 0 && flyers.length === 0 && toSpawn > 0) {
          spawnFlyer();
          flyerTimer = rand(7, 14);
        }
      }
      for (var fi = flyers.length - 1; fi >= 0; fi--) {
        var f = flyers[fi];
        f.x += f.vx * dt;
        f.dropTimer -= dt;
        if (f.dropTimer <= 0 && f.drops > 0 && f.x > W * 0.08 && f.x < W * 0.92) {
          spawnWarhead(f.x, f.y);
          f.drops--;
          f.dropTimer = rand(0.6, 1.4);
        }
        if (f.x < -W * 0.1 || f.x > W * 1.1) flyers.splice(fi, 1);
      }

      // counter-missiles: fly straight to their target point, then detonate
      for (var i = shots.length - 1; i >= 0; i--) {
        var sh = shots[i];
        var ndx = sh.tx - sh.x, ndy = sh.ty - sh.y;
        var step = Math.hypot(sh.vx, sh.vy) * dt;
        if (Math.hypot(ndx, ndy) <= step) {
          spawnBlast(sh.tx, sh.ty, true);
          shots.splice(i, 1);
        } else {
          sh.x += sh.vx * dt; sh.y += sh.vy * dt;
        }
      }

      // warheads: descend; split once at altitude; detonate on the ground
      for (var e = enemies.length - 1; e >= 0; e--) {
        var w = enemies[e];
        w.x += w.vx * dt; w.y += w.vy * dt;
        if (w.splitAt > 0 && w.y >= w.splitAt) { w.splitAt = -1; splitWarhead(w); }
        if (w.y >= groundY) { groundHit(w); enemies.splice(e, 1); }
      }

      // explosions grow then shrink; friendly ones destroy what they touch
      for (var b = blasts.length - 1; b >= 0; b--) {
        var bl = blasts[b];
        bl.t += dt;
        bl.r = bl.maxR * Math.sin(Math.PI * clamp(bl.t / bl.dur, 0, 1));
        if (bl.friendly && bl.r > 0) {
          // warheads caught in the fireball
          for (var ee = enemies.length - 1; ee >= 0; ee--) {
            var en = enemies[ee];
            if (Math.hypot(en.x - bl.x, en.y - bl.y) <= bl.r + enemyR) {
              enemies.splice(ee, 1);
              addScore(KILL_POINTS * mult());
              spawnBlast(en.x, en.y, false);   // visual spark only (no kill radius)
            }
          }
          // bombers / satellites caught in the fireball
          for (var ff = flyers.length - 1; ff >= 0; ff--) {
            var fl = flyers[ff];
            if (Math.hypot(fl.x - bl.x, fl.y - bl.y) <= bl.r + enemyR * 2) {
              flyers.splice(ff, 1);
              addScore(FLYER_POINTS * mult());
              spawnBlast(fl.x, fl.y, false);
            }
          }
        }
        if (bl.t >= bl.dur) blasts.splice(b, 1);
      }

      // lose condition: no cities left standing
      if (aliveCities() === 0) {
        endGame();
        return;
      }

      // wave clear: everything released, nothing left in the air
      if (toSpawn === 0 && enemies.length === 0 && shots.length === 0 &&
          blasts.length === 0 && flyers.length === 0) {
        endWave();
      }
    }

    function addScore(pts) {
      score += pts;
      sinceCity += pts;
      if (sinceCity >= BONUS_CITY) {
        sinceCity -= BONUS_CITY;
        reviveCity();
      }
    }

    function reviveCity() {
      var dead = [];
      for (var i = 0; i < cities.length; i++) if (!cities[i].alive) dead.push(cities[i]);
      if (dead.length) dead[(Math.random() * dead.length) | 0].alive = true;
    }

    function endWave() {
      var m = mult();
      var savedCities = aliveCities();
      var ammoLeft = 0;
      for (var i = 0; i < bases.length; i++) if (bases[i].alive) ammoLeft += bases[i].ammo;
      var cityPts = savedCities * CITY_BONUS * m;
      var ammoPts = ammoLeft * AMMO_BONUS * m;
      addScore(cityPts + ammoPts);
      bonus = { cities: savedCities, cityPts: cityPts, ammo: ammoLeft, ammoPts: ammoPts, total: cityPts + ammoPts };
      state = 'wavebonus';
      NG.setPlaying(false);
    }

    function endGame() {
      if (score > high) { high = score; saveHigh(); }
      state = 'over';
      NG.setPlaying(false);
    }

    // ---- drawing ------------------------------------------------------------
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

      // stars — blit the pre-rendered offscreen canvas; no per-star draw calls
      if (starCanvas) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(starCanvas, 0, 0);
        ctx.restore();
      }

      // ground
      ctx.fillStyle = '#06140c';
      ctx.fillRect(0, groundY, W, H - groundY);
      ctx.strokeStyle = DIM;
      ctx.lineWidth = Math.max(2, H * 0.004);
      ctx.beginPath();
      ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();

      drawDefences();
      drawTrails();
      drawFlyers();
      drawBlasts();

      drawHUD();
      drawOverlay();
      ctx.shadowBlur = 0;
    }

    function drawDefences() {
      // cities
      for (var i = 0; i < cities.length; i++) drawCity(cities[i]);
      // bases
      for (var j = 0; j < bases.length; j++) drawBase(bases[j]);
    }

    function drawCity(c) {
      var w = cityW, h = cityH, x = c.x - w / 2, base = groundY;
      if (c.alive) {
        ctx.fillStyle = FRIEND;
        ctx.shadowColor = FRIEND;
        ctx.shadowBlur = h * 0.4;
        // a tiny skyline of four buildings of varied height
        var heights = [0.55, 1.0, 0.75, 0.4];
        var bw = w / heights.length;
        for (var b = 0; b < heights.length; b++) {
          var bh = h * heights[b];
          ctx.fillRect(x + b * bw + bw * 0.12, base - bh, bw * 0.76, bh);
        }
        ctx.shadowBlur = 0;
      } else {
        // rubble — a low, dim mound where the city stood
        ctx.fillStyle = '#2a1116';
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + w * 0.3, base - h * 0.22);
        ctx.lineTo(x + w * 0.6, base - h * 0.12);
        ctx.lineTo(x + w, base);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawBase(b) {
      var w = baseW, h = baseH, x = b.x - w / 2, base = groundY;
      if (b.alive) {
        ctx.fillStyle = FRIEND;
        ctx.shadowColor = FRIEND;
        ctx.shadowBlur = h * 0.4;
        // a dome / bunker
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + w * 0.18, base - h * 0.7);
        ctx.lineTo(x + w * 0.82, base - h * 0.7);
        ctx.lineTo(x + w, base);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        // ammo readout — a stack of ticks, brighter the more is left
        ctx.fillStyle = b.ammo > 0 ? PLAYER : MUTED;
        var per = w / (AMMO_PER_BASE);
        for (var a = 0; a < b.ammo; a++) {
          ctx.fillRect(x + a * per + per * 0.2, base - h * 0.95, per * 0.55, h * 0.18);
        }
        ctx.fillStyle = b.ammo > 0 ? INK : MUTED;
        ctx.font = baseFontStr;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.ammo), b.x, base - h * 0.32);
      } else {
        ctx.fillStyle = '#2a1116';
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + w * 0.4, base - h * 0.2);
        ctx.lineTo(x + w, base);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawTrails() {
      ctx.lineWidth = Math.max(1.5, enemyR * 0.6);

      // All enemy trails: one path → one shadow-blurred stroke (was N strokes).
      if (enemies.length) {
        ctx.strokeStyle = ENEMY;
        ctx.shadowColor = ENEMY;
        ctx.shadowBlur = enemyR * 1.5;
        ctx.beginPath();
        for (var e = 0; e < enemies.length; e++) {
          var en = enemies[e];
          ctx.moveTo(en.ox, en.oy);
          ctx.lineTo(en.x, en.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // All warhead heads: one batched fill — no individual shadow needed,
        // the trail glow already halos each tip.
        ctx.fillStyle = ENEMY_HEAD;
        ctx.beginPath();
        for (var e2 = 0; e2 < enemies.length; e2++) {
          var en2 = enemies[e2];
          ctx.moveTo(en2.x + enemyR, en2.y);
          ctx.arc(en2.x, en2.y, enemyR, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // All counter-missiles: one path → one shadow-blurred stroke.
      if (shots.length) {
        ctx.strokeStyle = PLAYER;
        ctx.shadowColor = PLAYER;
        ctx.shadowBlur = enemyR * 1.5;
        ctx.beginPath();
        for (var s = 0; s < shots.length; s++) {
          var sh = shots[s];
          ctx.moveTo(sh.ox, sh.oy);
          ctx.lineTo(sh.x, sh.y);
          var r = enemyR * 1.4;
          ctx.moveTo(sh.tx - r, sh.ty - r); ctx.lineTo(sh.tx + r, sh.ty + r);
          ctx.moveTo(sh.tx + r, sh.ty - r); ctx.lineTo(sh.tx - r, sh.ty + r);
        }
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
    }

    function drawFlyers() {
      for (var i = 0; i < flyers.length; i++) {
        var f = flyers[i];
        ctx.fillStyle = ENEMY;
        ctx.shadowColor = ENEMY;
        ctx.shadowBlur = enemyR * 2;
        var r = Math.max(enemyR * 2.2, 6);
        if (f.sat) {
          // satellite: a little diamond with side panels
          ctx.beginPath();
          ctx.moveTo(f.x, f.y - r); ctx.lineTo(f.x + r, f.y);
          ctx.lineTo(f.x, f.y + r); ctx.lineTo(f.x - r, f.y);
          ctx.closePath(); ctx.fill();
          ctx.fillRect(f.x - r * 2.1, f.y - r * 0.3, r * 0.9, r * 0.6);
          ctx.fillRect(f.x + r * 1.2, f.y - r * 0.3, r * 0.9, r * 0.6);
        } else {
          // bomber: a swept wedge pointing the way it flies
          var dir = f.vx >= 0 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(f.x + dir * r * 1.6, f.y);
          ctx.lineTo(f.x - dir * r, f.y - r * 0.7);
          ctx.lineTo(f.x - dir * r * 0.5, f.y);
          ctx.lineTo(f.x - dir * r, f.y + r * 0.7);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    }

    function drawBlasts() {
      // Halos: per-blast (shadowBlur scales with radius so can't batch).
      ctx.globalAlpha = 0.35;
      for (var i = 0; i < blasts.length; i++) {
        var bl = blasts[i];
        if (bl.r <= 0) continue;
        var col = bl.friendly ? PLAYER : ENEMY;
        ctx.shadowColor = col;
        ctx.shadowBlur = bl.r * 0.8;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Cores: all white, same alpha — one batched fill, no shadow needed.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (var j = 0; j < blasts.length; j++) {
        var bl2 = blasts[j];
        if (bl2.r <= 0) continue;
        var cr = bl2.r * 0.5;
        ctx.moveTo(bl2.x + cr, bl2.y);
        ctx.arc(bl2.x, bl2.y, cr, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    function drawHUD() {
      var pad = Math.max(10, W * 0.02);
      var fs = clamp(H * 0.035, 14, 30);
      ctx.textBaseline = 'top';
      ctx.font = 'bold ' + fs.toFixed(0) + 'px "Courier New", monospace';
      ctx.shadowBlur = 0;
      // score (left)
      ctx.fillStyle = FRIEND;
      ctx.textAlign = 'left';
      ctx.fillText(String(score), pad, pad);
      // wave (right)
      ctx.fillStyle = ENEMY_HEAD;
      ctx.textAlign = 'right';
      ctx.fillText('WAVE ' + wave, W - pad, pad);
      // high score (centre, small)
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + (fs * 0.62).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('HI ' + high, W / 2, pad + fs * 0.2);
      // score multiplier (under the wave) once it climbs above 1×
      if (mult() > 1) {
        ctx.fillStyle = ENEMY_HEAD;
        ctx.textAlign = 'right';
        ctx.fillText('×' + mult(), W - pad, pad + fs * 1.05);
      }
    }

    function center(lines, gapFrac) {
      var fs = clamp(Math.min(W, H) * 0.05, 18, 44);
      var gap = (gapFrac || 1.4) * fs;
      var y0 = (state === 'wavebonus' ? groundY * 0.42 : H * 0.42) - (lines.length - 1) * gap / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        ctx.fillStyle = ln.color || INK;
        ctx.shadowColor = ln.color || INK;
        ctx.shadowBlur = ln.glow ? fs * 0.4 : 0;
        ctx.font = 'bold ' + (fs * (ln.scale || 1)).toFixed(0) + 'px "Courier New", monospace';
        ctx.fillText(ln.text, W / 2, y0 + i * gap);
      }
      ctx.shadowBlur = 0;
    }

    function drawOverlay() {
      if (state === 'ready') {
        center([
          { text: 'MISSILE COMMAND', color: FRIEND, glow: true, scale: 1.15 },
          { text: 'TAP THE SKY TO DEFEND YOUR CITIES', color: MUTED, scale: 0.5 },
          { text: 'TAP TO START', color: ENEMY_HEAD, scale: 0.7 },
        ], 1.7);
      } else if (state === 'wavebonus') {
        center([
          { text: 'WAVE ' + wave + ' CLEARED', color: FRIEND, glow: true },
          { text: bonus.cities + ' CITIES  ×' + (CITY_BONUS * mult()) + '  =  ' + bonus.cityPts, color: INK, scale: 0.55 },
          { text: bonus.ammo + ' MISSILES ×' + (AMMO_BONUS * mult()) + '  =  ' + bonus.ammoPts, color: INK, scale: 0.55 },
          { text: 'BONUS ' + bonus.total, color: PLAYER, scale: 0.7 },
          { text: 'TAP TO CONTINUE', color: ENEMY_HEAD, scale: 0.6 },
        ], 1.45);
      } else if (state === 'over') {
        center([
          { text: 'THE LAST CITY HAS FALLEN', color: ENEMY, glow: true, scale: 0.95 },
          { text: 'SCORE ' + score, color: INK, scale: 0.7 },
          { text: 'BEST ' + high, color: MUTED, scale: 0.55 },
          { text: 'TAP TO PLAY AGAIN', color: ENEMY_HEAD, scale: 0.65 },
        ], 1.6);
      }
    }

    // ---- input --------------------------------------------------------------
    // Every touch-down is an action. In play it fires a counter-missile to that
    // point (multitouch = several at once); on the title / tally / game-over
    // screens it advances the state instead.
    NG.createTouch(canvas, {
      onDown: function (p) {
        if (state === 'playing') { fireAt(p.x, p.y); return; }
        if (state === 'ready') { startGame(); }
        else if (state === 'wavebonus') { wave++; startWave(); }
        else if (state === 'over') { startGame(); }
      },
    });

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
