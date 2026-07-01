/*
 * EMOPAC — an emoji Pac-Man for the Nostalgic Gaming catalogue.
 *
 * Classic script, no ES modules — runs from file:// and HTTP alike. The cast is
 * built from emoji characters: four distinct monster ghosts (👹 😈 👽 👻), a
 * frightened-blue face (🥶), eyes-only when eaten (👀), and bonus fruit (🍒🍓…)
 * drawn with the Canvas text API. Pac himself is a chomping yellow wedge so the
 * direction he faces always reads at a glance — the soul of the game.
 *
 * Layout: fixed-ratio letterbox (like Bejeweled / Sudoku). The 28×31 maze plus
 * a score band on top and a lives/fruit band below render to one fixed logical
 * grid, contain-fit and centred into the viewport (black bars on mismatched
 * windows — fine at 16:9, 9:8 and 9:16 alike).
 *
 * Touch: swipe in a direction to steer (the turn is buffered and taken at the
 * next tile centre), or tap ahead/to-a-side to turn toward it. A canvas FINISH
 * button (top-left of the score band) and the ESC / BACK / HOME keys exit.
 *
 * Mirrors the project conventions: IIFE, 'use strict', NG.onResize,
 * NG.createTouch, NG.onExit, requestAnimationFrame loop.
 */
(function () {
  'use strict';

  // ---- palette ---------------------------------------------------------------
  var BG        = '#000000';
  var WALL      = '#1822a8';   // neon-blue maze fill
  var WALL_EDGE = '#4a63ff';   // lighter inner line — the classic double-wall look
  var DOOR      = '#ffb0d4';   // ghost-house door
  var PELLET    = '#ffd9b0';   // pellets / energizers — warm peach
  var PAC       = '#ffe94d';   // Pac yellow
  var FG        = '#4dff88';   // phosphor green — catalogue UI accent
  var INK       = '#d6f7e4';
  var MUTED     = '#6b7a72';
  var RED        = '#ff5d6c';

  // ---- maze ------------------------------------------------------------------
  // '#' wall · '.' pellet · 'o' energizer · '-' ghost-house door · ' ' open path
  // 28 columns × 31 rows. Row 14 is the wrap-around tunnel.
  var MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.#####.##.#####.######',
    '######.#####.##.#####.######',
    '######.##..........##.######',
    '######.##.###--###.##.######',
    '######.##.#      #.##.######',
    '          #      #          ',
    '######.##.#      #.##.######',
    '######.##.########.##.######',
    '######.##..........##.######',
    '######.##.########.##.######',
    '######.##.########.##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################',
  ];
  var COLS = 28, ROWS = 31, TUNNEL_ROW = 14;

  // ---- directions ------------------------------------------------------------
  var UP = { x: 0, y: -1 }, DOWN = { x: 0, y: 1 }, LEFT = { x: -1, y: 0 }, RIGHT = { x: 1, y: 0 }, NONE = { x: 0, y: 0 };
  var DIRS = [UP, LEFT, DOWN, RIGHT];       // ghost tie-break preference order (classic)

  // ---- ghost cast ------------------------------------------------------------
  // Four distinct emoji monsters, each with an identifying glow colour and the
  // classic personalities (chaser / ambusher / flanker / shy).
  var GHOSTS_DEF = [
    { name: 'blinky', emoji: '👹', glow: '#ff5d6c', homeX: 13, scatter: { x: 25, y: 0 }, releaseAt: 0.0 },
    { name: 'pinky',  emoji: '😈', glow: '#ff9ce0', homeX: 13, scatter: { x: 2,  y: 0 }, releaseAt: 2.0 },
    { name: 'inky',   emoji: '👽', glow: '#5be0ff', homeX: 11, scatter: { x: 27, y: 30 }, releaseAt: 4.5 },
    { name: 'clyde',  emoji: '👻', glow: '#ffb84d', homeX: 16, scatter: { x: 0,  y: 30 }, releaseAt: 8.0 },
  ];
  var FRIGHT_EMOJI = '🥶';
  var EATEN_EMOJI  = '👀';
  var FRUITS = [
    { emoji: '🍒', pts: 100 }, { emoji: '🍓', pts: 300 }, { emoji: '🍊', pts: 500 },
    { emoji: '🍎', pts: 700 }, { emoji: '🍇', pts: 1000 }, { emoji: '🍈', pts: 2000 },
    { emoji: '🔔', pts: 3000 }, { emoji: '🔑', pts: 5000 },
  ];

  // ---- tuning ----------------------------------------------------------------
  var PAC_SPEED    = 6.2;     // tiles / second (base, level 1)
  var GHOST_SPEED  = 5.5;
  var FRIGHT_SPEED = 3.6;
  var EATEN_SPEED  = 13.0;
  var FRIGHT_TIME  = 7.0;     // seconds ghosts stay frightened (shrinks with level)
  var FRUIT_TIME   = 9.0;
  var BEST_KEY     = 'ng_emopac_best';
  // scatter/chase schedule (seconds): scatter, chase, scatter, chase, ...
  var MODE_SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity];

  // ---- state -----------------------------------------------------------------
  var dots = [];             // ROWS×COLS: 0 empty | 2 pellet | 3 energizer
  var totalDots = 0, dotsEaten = 0;
  var score = 0, best = 0, lives = 3, level = 1;
  var state = 'title';       // title | playing | respawn | dying | levelclear | over
  var stateTimer = 0;        // counts down for timed states
  var levelFlash = 0;

  var pac = null, ghosts = [];
  var mode = 'scatter', modeIndex = 0, modeTimer = 0;  // scatter/chase phase machine
  var frightTimer = 0, ghostCombo = 200;
  var fruit = null;          // { def, timer } | null
  var fruitsWon = [];        // emoji collected this game (shown in the bottom band)
  var playTime = 0;          // seconds since the current life started playing

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function ti(v) { return Math.round(v); }
  function key(c, r) { return c + ',' + r; }

  // ---- maze queries ----------------------------------------------------------
  function tileChar(c, r) {
    if (r < 0 || r >= ROWS) return '#';
    if (c < 0 || c >= COLS) return r === TUNNEL_ROW ? ' ' : '#';   // open only in the tunnel
    return MAZE[r].charAt(c);
  }
  function passablePac(c, r) {
    var ch = tileChar(c, r);
    return ch !== '#' && ch !== '-';
  }
  function passableGhost(c, r, allowDoor) {
    var ch = tileChar(c, r);
    if (ch === '#') return false;
    if (ch === '-') return !!allowDoor;
    return true;
  }

  // ---- level / entity setup --------------------------------------------------
  function buildDots() {
    dots = [];
    totalDots = 0;
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < COLS; c++) {
        var ch = MAZE[r].charAt(c);
        if (ch === '.') { row.push(2); totalDots++; }
        else if (ch === 'o') { row.push(3); totalDots++; }
        else row.push(0);
      }
      dots.push(row);
    }
    dotsEaten = 0;
  }

  function makePac() {
    return { x: 13, y: 23, dir: { x: -1, y: 0 }, want: NONE, mouth: 0 };
  }

  function makeGhosts() {
    var arr = [];
    for (var i = 0; i < GHOSTS_DEF.length; i++) {
      var d = GHOSTS_DEF[i];
      var g = {
        def: d, homeX: d.homeX,
        x: d.homeX, y: 14, dir: LEFT,
        state: i === 0 ? 'normal' : 'house',   // Blinky starts on the board
        fright: false, bob: i * 0.7, releaseAt: d.releaseAt,
      };
      if (i === 0) { g.x = 13; g.y = 11; }
      arr.push(g);
    }
    return arr;
  }

  function resetActors() {
    pac = makePac();
    ghosts = makeGhosts();
    mode = 'scatter'; modeIndex = 0; modeTimer = 0;
    frightTimer = 0; ghostCombo = 200;
    playTime = 0;
  }

  function newGame() {
    score = 0; lives = 3; level = 1;
    fruitsWon = [];
    buildDots();
    fruit = null;
    resetActors();
    state = 'title';
  }

  function startPlaying() {
    state = 'playing';
  }

  function nextLevel() {
    level++;
    buildDots();
    fruit = null;
    resetActors();
    state = 'respawn';
    stateTimer = 1.4;
  }

  function loseLife() {
    lives--;
    fruit = null;
    if (lives < 0) {
      state = 'over';
      if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, best); } catch (e) {} }
    } else {
      resetActors();
      state = 'respawn';
      stateTimer = 1.4;
    }
  }

  // ---- speeds (ramp gently with level) ---------------------------------------
  function levelScale() { return Math.min(1 + (level - 1) * 0.06, 1.5); }
  function pacSpeed()   { return PAC_SPEED * levelScale(); }
  function ghostSpeed(g) {
    if (g.state === 'eaten') return EATEN_SPEED;
    if (g.fright) return FRIGHT_SPEED * levelScale();
    var s = GHOST_SPEED * levelScale();
    // ghosts crawl through the side tunnel, the player's classic escape valve
    if (g.y === TUNNEL_ROW && (g.x < 6 || g.x > COLS - 7)) s *= 0.5;
    return s;
  }
  function frightDuration() { return Math.max(2, FRIGHT_TIME - (level - 1) * 0.4); }

  // ---- grid movement ---------------------------------------------------------
  // Move an entity `dist` tiles along its dir, calling decide() each time it
  // arrives at a tile centre (integer coords). Tile centres are integers; speeds
  // are low enough that there is at most one crossing per frame, but leftover
  // distance recurses so a turn carries its remaining motion through.
  function advance(e, dist, decide) {
    if (e.dir.x === 0 && e.dir.y === 0) { decide(e); return; }
    var ax = e.dir.x !== 0 ? 'x' : 'y';
    var d  = e.dir.x !== 0 ? e.dir.x : e.dir.y;
    var before = e[ax];
    var nextCenter = d > 0 ? Math.floor(before) + 1 : Math.ceil(before) - 1;
    var after = before + d * dist;
    if ((d > 0 && after >= nextCenter) || (d < 0 && after <= nextCenter)) {
      var used = Math.abs(nextCenter - before);
      e[ax] = nextCenter;
      // snap the cross axis to dead-centre so corners stay clean
      e[ax === 'x' ? 'y' : 'x'] = Math.round(e[ax === 'x' ? 'y' : 'x']);
      // tunnel wrap
      if (e.x < 0) e.x += COLS; else if (e.x >= COLS) e.x -= COLS;
      decide(e);
      var leftover = dist - used;
      if (leftover > 1e-6 && (e.dir.x !== 0 || e.dir.y !== 0)) advance(e, leftover, decide);
    } else {
      e[ax] = after;
    }
  }

  // ---- Pac steering ----------------------------------------------------------
  function setWant(dir) {
    if (state === 'title' || state === 'over') return;
    if (state === 'respawn') return;
    pac.want = dir;
    // an instant U-turn needs no tile centre — flip in place
    if (dir.x === -pac.dir.x && dir.y === -pac.dir.y && (dir.x || dir.y)) pac.dir = dir;
  }

  function pacDecide(e) {
    var c = Math.round(e.x), r = Math.round(e.y);
    if ((e.want.x || e.want.y) && passablePac(c + e.want.x, r + e.want.y)) {
      e.dir = e.want;
    }
    if (!passablePac(c + e.dir.x, r + e.dir.y)) e.dir = NONE;   // wall ahead — halt at the centre
  }

  // ---- ghost AI --------------------------------------------------------------
  function pacTile() { return { x: Math.round(pac.x), y: Math.round(pac.y) }; }

  function ghostTarget(g) {
    if (g.state === 'eaten') return { x: 13, y: 11 };           // head back to the house door
    if (g.fright) return null;                                   // frightened → random
    if (mode === 'scatter') return g.def.scatter;
    var p = pacTile();
    switch (g.def.name) {
      case 'blinky': return p;
      case 'pinky':  return { x: p.x + pac.dir.x * 4, y: p.y + pac.dir.y * 4 };
      case 'inky': {
        var ahead = { x: p.x + pac.dir.x * 2, y: p.y + pac.dir.y * 2 };
        var b = ghosts[0];
        return { x: ahead.x * 2 - Math.round(b.x), y: ahead.y * 2 - Math.round(b.y) };
      }
      case 'clyde': {
        var dx = p.x - g.x, dy = p.y - g.y;
        return (dx * dx + dy * dy > 64) ? p : g.def.scatter;     // shy when within 8 tiles
      }
    }
    return p;
  }

  function ghostDecide(g) {
    var c = Math.round(g.x), r = Math.round(g.y);
    var rev = { x: -g.dir.x, y: -g.dir.y };
    var allowDoor = g.state === 'eaten';
    var opts = [];
    for (var i = 0; i < DIRS.length; i++) {
      var dd = DIRS[i];
      if (dd.x === rev.x && dd.y === rev.y) continue;            // ghosts never reverse on their own
      if (passableGhost(c + dd.x, r + dd.y, allowDoor)) opts.push(dd);
    }
    if (!opts.length) { g.dir = rev; return; }                  // dead end — forced to turn back

    if (g.fright) {                                             // frightened: wander randomly
      g.dir = opts[(Math.random() * opts.length) | 0];
      return;
    }
    var target = ghostTarget(g);
    var best = opts[0], bestD = Infinity;
    for (var j = 0; j < opts.length; j++) {
      var nx = c + opts[j].x, ny = r + opts[j].y;
      var ddx = nx - target.x, ddy = ny - target.y;
      var dsq = ddx * ddx + ddy * ddy;
      if (dsq < bestD) { bestD = dsq; best = opts[j]; }          // DIRS order breaks ties
    }
    g.dir = best;
  }

  function reverse(g) {
    if (g.dir.x || g.dir.y) g.dir = { x: -g.dir.x, y: -g.dir.y };
  }

  // House choreography for ghosts that aren't roaming the maze yet.
  function houseUpdate(g, dt) {
    var s = ghostSpeed(g) * dt;
    if (g.state === 'house') {
      g.x = g.homeX;
      g.bob += dt;
      g.y = 14 + Math.sin(g.bob * 3) * 0.32;
      if (playTime >= g.releaseAt) { g.state = 'exiting'; g.bob = 0; }
      return;
    }
    if (g.state === 'exiting') {
      if (g.y > 11 + 1e-3) {
        if (Math.abs(g.x - 13) > 1e-3) { g.x += clamp(13 - g.x, -s, s); g.dir = g.x < 13 ? RIGHT : LEFT; }
        else { g.y -= Math.min(s, g.y - 11); g.dir = UP; }
      } else {
        g.x = 13; g.y = 11; g.state = 'normal'; g.dir = LEFT;
      }
      return;
    }
    if (g.state === 'entering') {                                 // eaten ghost descending home
      if (g.y < 14 - 1e-3) { g.x = 13; g.y += Math.min(s, 14 - g.y); g.dir = DOWN; }
      else if (Math.abs(g.x - g.homeX) > 1e-3) { g.x += clamp(g.homeX - g.x, -s, s); }
      else { g.state = 'exiting'; g.fright = false; g.bob = 0; }  // revived — come back out
    }
  }

  // ---- mode / fright timers --------------------------------------------------
  function updateModes(dt) {
    if (frightTimer > 0) {
      frightTimer -= dt;
      if (frightTimer <= 0) {
        frightTimer = 0;
        for (var i = 0; i < ghosts.length; i++) ghosts[i].fright = false;
      }
      return;   // scatter/chase clock is frozen while ghosts are frightened
    }
    modeTimer += dt;
    var dur = MODE_SCHEDULE[modeIndex];
    if (modeTimer >= dur) {
      modeTimer = 0;
      modeIndex = Math.min(modeIndex + 1, MODE_SCHEDULE.length - 1);
      mode = (mode === 'scatter') ? 'chase' : 'scatter';
      for (var k = 0; k < ghosts.length; k++) {                   // ghosts flip around on a phase change
        if (ghosts[k].state === 'normal') reverse(ghosts[k]);
      }
    }
  }

  function energize() {
    frightTimer = frightDuration();
    ghostCombo = 200;
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      if (g.state === 'normal') { g.fright = true; reverse(g); }
    }
  }

  // ---- eating ----------------------------------------------------------------
  function eatAt(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    var v = dots[r][c];
    if (v === 0) return;
    dots[r][c] = 0;
    dotsEaten++;
    if (v === 2) score += 10;
    else { score += 50; energize(); }
    if (dotsEaten === 70 || dotsEaten === 170) spawnFruit();
    if (dotsEaten >= totalDots) { state = 'levelclear'; stateTimer = 1.6; levelFlash = 0; }
  }

  function spawnFruit() {
    var def = FRUITS[Math.min(level - 1, FRUITS.length - 1)];
    fruit = { def: def, timer: FRUIT_TIME };
  }

  // ---- one simulation step ---------------------------------------------------
  function step(dt) {
    playTime += dt;
    pac.mouth += dt * (pac.dir.x || pac.dir.y ? 16 : 0);
    updateModes(dt);

    // Pac
    advance(pac, pacSpeed() * dt, pacDecide);
    eatAt(Math.round(pac.x), Math.round(pac.y));

    // fruit lifetime + pickup
    if (fruit) {
      fruit.timer -= dt;
      if (fruit.timer <= 0) fruit = null;
      else {
        var fdx = pac.x - 13, fdy = pac.y - 17;
        if (fdx * fdx + fdy * fdy < 0.4) {
          score += fruit.def.pts;
          fruitsWon.push(fruit.def.emoji);
          fruit = null;
        }
      }
    }

    // ghosts
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      if (g.state === 'house' || g.state === 'exiting' || g.state === 'entering') {
        houseUpdate(g, dt);
      } else {
        advance(g, ghostSpeed(g) * dt, ghostDecide);
        if (g.state === 'eaten') {
          var ex = g.x - 13, ey = g.y - 11;
          if (ex * ex + ey * ey < 0.3) { g.state = 'entering'; g.dir = DOWN; }
        }
      }
    }

    // collisions (post-move)
    for (var j = 0; j < ghosts.length; j++) {
      var gg = ghosts[j];
      if (gg.state === 'eaten' || gg.state === 'entering' || gg.state === 'house') continue;
      var dx = pac.x - gg.x, dy = pac.y - gg.y;
      if (dx * dx + dy * dy > 0.5 * 0.5) continue;
      if (gg.fright) {
        score += ghostCombo;
        ghostCombo = Math.min(ghostCombo * 2, 1600);
        gg.state = 'eaten'; gg.fright = false;
      } else {
        state = 'dying'; stateTimer = 1.2; pac.mouth = 0;
        return;
      }
    }

    if (score > best) best = score;
  }

  function update(dt) {
    if (state === 'playing') { step(dt); return; }
    if (state === 'respawn') {
      stateTimer -= dt;
      if (stateTimer <= 0) state = 'playing';
      return;
    }
    if (state === 'dying') {
      stateTimer -= dt;
      pac.mouth += dt;       // drives the death-spin animation
      if (stateTimer <= 0) loseLife();
      return;
    }
    if (state === 'levelclear') {
      stateTimer -= dt;
      levelFlash += dt;
      if (stateTimer <= 0) nextLevel();
      return;
    }
  }

  // ---- layout ----------------------------------------------------------------
  // The maze is maximised: in landscape it takes the full canvas height and the
  // HUD (buttons + text) sits in a left-hand panel; in portrait the board is
  // maximised on width with the HUD split into top / bottom bands.
  var canvas, ctx, vw = 0, vh = 0, drawScale = 1;
  var cell = 0, mazeLeft = 0, mazeTop = 0;
  var panelMode = 'left';
  var hud = {};
  var finishRect = null;

  function layout(info) {
    var dpr = window.devicePixelRatio || 1;
    vw = info.width; vh = info.height;
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    drawScale = dpr;

    var pad = clamp(Math.min(vw, vh) * 0.02, 6, 24);

    if (vw >= vh) {
      // Landscape / squarish: fill the height with the board, HUD on the left.
      panelMode = 'left';
      var minPanel = clamp(vw * 0.20, 130, 340);
      cell = Math.min((vh - 2 * pad) / ROWS, (vw - minPanel - 2 * pad) / COLS);
      var bW = cell * COLS, bH = cell * ROWS;
      mazeTop = (vh - bH) / 2;
      mazeLeft = vw - bW - pad;                         // board hugs the right edge
      var panelX = pad, panelW = mazeLeft - 2 * pad, cx = panelX + panelW / 2;
      var fs = clamp(Math.min(panelW * 0.16, cell * 1.3), 12, 34);
      var fbh = clamp(cell * 1.5, 28, 52), fbw = clamp(panelW * 0.92, 80, 280);
      finishRect = { x: cx - fbw / 2, y: mazeTop + pad, w: fbw, h: fbh };
      hud = {
        mode: 'left', cx: cx, fs: fs,
        scoreY: mazeTop + bH * 0.22, highY: mazeTop + bH * 0.36, levelY: mazeTop + bH * 0.49,
        livesY: mazeTop + bH * 0.66, fruitY: mazeTop + bH * 0.84,
      };
    } else {
      // Portrait: maximise the board on width, HUD in top / bottom bands.
      panelMode = 'stacked';
      cell = (vw - 2 * pad) / COLS;
      var minBand = clamp(vh * 0.07, 44, 130);
      if (cell * ROWS > vh - 2 * minBand) cell = (vh - 2 * minBand) / ROWS;
      var bW2 = cell * COLS, bH2 = cell * ROWS;
      mazeLeft = (vw - bW2) / 2;
      mazeTop = (vh - bH2) / 2;
      var topH = mazeTop, botY = mazeTop + bH2, botH = vh - botY;
      var fbh2 = clamp(topH * 0.5, 24, 46), fbw2 = clamp(cell * 4.2, 64, 160);
      finishRect = { x: mazeLeft, y: (topH - fbh2) / 2, w: fbw2, h: fbh2 };
      hud = { mode: 'stacked', fs: clamp(cell * 1.1, 12, 26), boardW: bW2, topY: topH / 2, botY: botY + botH / 2 };
    }
  }

  function inBoard(x, y) {
    return x >= mazeLeft && x <= mazeLeft + COLS * cell && y >= mazeTop && y <= mazeTop + ROWS * cell;
  }

  // tile coord -> pixel centre
  function px(tx) { return mazeLeft + (tx + 0.5) * cell; }
  function py(ty) { return mazeTop + (ty + 0.5) * cell; }

  // ---- drawing ---------------------------------------------------------------
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawMaze() {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var ch = MAZE[r].charAt(c);
        var x = mazeLeft + c * cell, y = mazeTop + r * cell;
        if (ch === '#') {
          ctx.fillStyle = WALL;
          ctx.fillRect(x, y, cell + 0.6, cell + 0.6);
        } else if (ch === '-') {
          ctx.fillStyle = DOOR;
          ctx.fillRect(x, y + cell * 0.4, cell, cell * 0.2);
        }
      }
    }
    // inner neon edge: draw a lighter inset line on each wall tile so the solid
    // fill reads as the classic double-stroke pipework.
    ctx.strokeStyle = WALL_EDGE;
    ctx.lineWidth = Math.max(1, cell * 0.07);
    var inset = cell * 0.18;
    for (var rr = 0; rr < ROWS; rr++) {
      for (var cc = 0; cc < COLS; cc++) {
        if (MAZE[rr].charAt(cc) !== '#') continue;
        // only stroke the edges that border open space, for a cleaner outline
        var x2 = mazeLeft + cc * cell, y2 = mazeTop + rr * cell;
        ctx.beginPath();
        if (MAZE[rr].charAt(cc - 1) !== '#' && cc > 0) { ctx.moveTo(x2 + inset, y2); ctx.lineTo(x2 + inset, y2 + cell); }
        if (tileChar(cc + 1, rr) !== '#') { ctx.moveTo(x2 + cell - inset, y2); ctx.lineTo(x2 + cell - inset, y2 + cell); }
        if (tileChar(cc, rr - 1) !== '#') { ctx.moveTo(x2, y2 + inset); ctx.lineTo(x2 + cell, y2 + inset); }
        if (tileChar(cc, rr + 1) !== '#') { ctx.moveTo(x2, y2 + cell - inset); ctx.lineTo(x2 + cell, y2 + cell - inset); }
        ctx.stroke();
      }
    }
  }

  function drawDots() {
    var pr = cell * 0.09;
    var pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = dots[r][c];
        if (!v) continue;
        ctx.fillStyle = PELLET;
        ctx.beginPath();
        if (v === 2) {
          ctx.arc(px(c), py(r), pr, 0, Math.PI * 2);
        } else {
          ctx.globalAlpha = 0.55 + 0.45 * pulse;
          ctx.arc(px(c), py(r), cell * 0.26, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawFruit() {
    if (!fruit) return;
    drawEmoji(fruit.def.emoji, px(13), py(17), cell * 1.1);
  }

  function drawEmoji(em, cx, cy, size) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = size.toFixed(0) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.fillText(em, cx, cy);
  }

  // Pac as a chomping wedge, mouth facing travel direction.
  function drawPacAt(cx, cy, r, dir, openAmt) {
    var ang = Math.atan2(dir.y, dir.x);
    if (dir.x === 0 && dir.y === 0) ang = Math.atan2(pac.dir.y || 0, pac.dir.x || -1);
    var half = openAmt * Math.PI * 0.5;       // 0 = closed, ~0.5π = wide open
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = PAC;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, half, Math.PI * 2 - half);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPac() {
    if (state === 'dying') {
      // mouth opens all the way until Pac vanishes
      var t = clamp(1 - stateTimer / 1.2, 0, 1);
      var open = t;                            // 0 → 1 (fully open / gone)
      ctx.save();
      ctx.globalAlpha = 1 - t * 0.6;
      var rr = cell * 0.46 * (1 - t * 0.3);
      var ang = Math.atan2(pac.dir.y, pac.dir.x);
      ctx.translate(px(pac.x), py(pac.y));
      ctx.rotate(ang);
      ctx.fillStyle = PAC;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, rr, open * Math.PI, Math.PI * 2 - open * Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    var openAmt = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(pac.mouth));
    if (state === 'title' || state === 'respawn') openAmt = 0.35;
    drawPacAt(px(pac.x), py(pac.y), cell * 0.46, pac.dir, openAmt);
  }

  function drawGhost(g) {
    var cx = px(g.x), cy = py(g.y), size = cell * 1.05;
    if (g.state === 'eaten' || g.state === 'entering') {
      drawEmoji(EATEN_EMOJI, cx, cy, cell * 0.85);
      return;
    }
    var em = g.def.emoji, glow = g.def.glow;
    if (g.fright) {
      // flash white in the final two seconds as a warning
      var flashing = frightTimer < 2 && (Math.floor(frightTimer * 6) % 2 === 0);
      glow = flashing ? '#ffffff' : '#3b5bff';
      em = FRIGHT_EMOJI;
    }
    // identity glow behind the emoji
    var grd = ctx.createRadialGradient(cx, cy, cell * 0.1, cx, cy, cell * 0.7);
    grd.addColorStop(0, glow);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawEmoji(em, cx, cy, size);
  }

  function drawFinish() {
    var fb = finishRect;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = FG;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    rrect(fb.x, fb.y, fb.w, fb.h, fb.h * 0.28);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = FG;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + (fb.h * 0.42).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('FINISH', fb.x + fb.w / 2, fb.y + fb.h * 0.54);
  }

  // label above value, centred on (cx, y)
  function drawStat(label, val, cx, y, fs) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = FG;
    ctx.font = 'bold ' + (fs * 0.55).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText(label, cx, y - fs * 0.55);
    ctx.fillStyle = INK;
    ctx.font = 'bold ' + fs.toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText(String(val), cx, y + fs * 0.35);
  }

  function drawLivesRow(cx, y) {
    var lr = cell * 0.42, gap = lr * 0.7, n = Math.max(0, lives);
    var total = n > 0 ? n * lr * 2 + (n - 1) * gap : 0;
    var sx = cx - total / 2 + lr;
    for (var i = 0; i < n; i++) drawPacAt(sx + i * (lr * 2 + gap), y, lr, LEFT, 0.32);
  }

  function drawFruitRow(cx, y) {
    var shown = fruitsWon.slice(-6), step = cell * 1.05;
    var fw = (shown.length - 1) * step, fx = cx - fw / 2;
    for (var f = 0; f < shown.length; f++) drawEmoji(shown[f], fx + f * step, y, cell * 0.85);
  }

  function drawHud() {
    var fs = hud.fs;
    drawFinish();

    if (hud.mode === 'left') {
      var cx = hud.cx;
      drawStat('1UP', score, cx, hud.scoreY, fs);
      drawStat('HIGH', best, cx, hud.highY, fs);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = FG;
      ctx.font = 'bold ' + (fs * 0.62).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('LEVEL ' + level, cx, hud.levelY);
      ctx.fillStyle = MUTED;
      ctx.font = 'bold ' + (fs * 0.5).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('LIVES', cx, hud.livesY - cell * 0.95);
      drawLivesRow(cx, hud.livesY);
      ctx.fillStyle = MUTED;
      ctx.font = 'bold ' + (fs * 0.5).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('FRUIT', cx, hud.fruitY - cell * 0.95);
      drawFruitRow(cx, hud.fruitY);
      return;
    }

    // stacked (portrait): score in the top band, lives / level / fruit below
    drawStat('1UP', score, mazeLeft + hud.boardW * 0.28, hud.topY, fs);
    drawStat('HIGH', best, mazeLeft + hud.boardW * 0.72, hud.topY, fs);
    drawLivesRow(mazeLeft + hud.boardW * 0.22, hud.botY);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = FG;
    ctx.font = 'bold ' + (fs * 0.62).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('LVL ' + level, mazeLeft + hud.boardW * 0.5, hud.botY);
    drawFruitRow(mazeLeft + hud.boardW * 0.78, hud.botY);
  }

  function drawCenterText(big, small, color) {
    var cx = mazeLeft + COLS * cell / 2, cy = mazeTop + ROWS * cell * 0.55;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = 'bold ' + (cell * 1.3).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText(big, cx, cy);
    if (small) {
      var pulse = 0.5 + 0.5 * Math.abs(Math.sin(clock * 2.4));
      ctx.globalAlpha = pulse;
      ctx.fillStyle = INK;
      ctx.font = 'bold ' + (cell * 0.7).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText(small, cx, cy + cell * 1.6);
      ctx.globalAlpha = 1;
    }
  }

  function drawReady() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffcf4d';
    ctx.font = 'bold ' + (cell * 1.0).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('READY!', mazeLeft + COLS * cell / 2, py(17) + cell * 1.2);
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(drawScale, 0, 0, drawScale, 0, 0);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, vw, vh);

    drawMaze();
    drawDots();
    drawFruit();

    if (state !== 'dying' && state !== 'title') for (var i = 0; i < ghosts.length; i++) drawGhost(ghosts[i]);
    if (state !== 'title') drawPac();

    if (state === 'respawn' || (state === 'levelclear' && Math.floor(levelFlash * 6) % 2 === 0)) drawReady();
    drawHud();

    if (state === 'title') {
      drawTitle();
    } else if (state === 'over') {
      drawCenterText('GAME OVER', 'TAP TO PLAY AGAIN', RED);
    } else if (state === 'levelclear') {
      // board flashes (handled in drawMaze? keep simple) — show LEVEL UP briefly
      var cx = mazeLeft + COLS * cell / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = FG;
      ctx.font = 'bold ' + (cell * 0.9).toFixed(0) + 'px "Courier New", monospace';
      ctx.fillText('LEVEL CLEAR', cx, mazeTop + ROWS * cell * 0.4);
    }
  }

  function drawTitle() {
    var cx = mazeLeft + COLS * cell / 2;
    var cy = mazeTop + ROWS * cell * 0.34;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PAC;
    ctx.font = 'bold ' + (cell * 2.2).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('EMOPAC', cx, cy);

    // a little cast line under the logo
    var em = ['👹', '😈', '👽', '👻'];
    for (var i = 0; i < em.length; i++) {
      drawEmoji(em[i], cx + (i - 1.5) * cell * 1.6, cy + cell * 2.0, cell * 1.2);
    }
    drawPacAt(cx - (1.5 + 1) * cell * 1.6, cy + cell * 2.0, cell * 0.55, RIGHT, 0.35);

    var pulse = 0.5 + 0.5 * Math.abs(Math.sin(clock * 2.4));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = INK;
    ctx.font = 'bold ' + (cell * 0.8).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('TAP OR PRESS A KEY', cx, cy + cell * 4.2);
    ctx.globalAlpha = 1;

    ctx.fillStyle = MUTED;
    ctx.font = 'bold ' + (cell * 0.55).toFixed(0) + 'px "Courier New", monospace';
    ctx.fillText('SWIPE OR TAP TO STEER', cx, cy + cell * 5.6);
  }

  // ---- main loop -------------------------------------------------------------
  var clock = 0, last = 0;
  function loop(t) {
    if (!last) last = t;
    var dt = Math.min((t - last) / 1000, 1 / 30);
    last = t;
    clock += dt;
    update(dt);
    draw();
    window.requestAnimationFrame(loop);
  }

  // ---- input -----------------------------------------------------------------
  var anchor = null;
  function inRect(x, y, b) { return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

  // Tap-to-steer: turn Pac toward the tapped point along the axis across travel
  // (a tap on a different row when moving horizontally steers vertically, etc.).
  function turnToward(x, y) {
    var hc = pacTile();
    var tx = clamp(Math.floor((x - mazeLeft) / cell), 0, COLS - 1);
    var ty = clamp(Math.floor((y - mazeTop) / cell), 0, ROWS - 1);
    if (pac.dir.y === 0 && pac.dir.x !== 0) {
      if (ty !== hc.y) setWant(ty > hc.y ? DOWN : UP);
      else setWant(tx > hc.x ? RIGHT : LEFT);
    } else if (pac.dir.x === 0 && pac.dir.y !== 0) {
      if (tx !== hc.x) setWant(tx > hc.x ? RIGHT : LEFT);
      else setWant(ty > hc.y ? DOWN : UP);
    } else {
      if (Math.abs(tx - hc.x) > Math.abs(ty - hc.y)) setWant(tx > hc.x ? RIGHT : LEFT);
      else setWant(ty > hc.y ? DOWN : UP);
    }
  }

  function tapStart() {
    if (state === 'title') { startPlaying(); return true; }
    if (state === 'over') { newGame(); startPlaying(); return true; }
    return false;
  }

  NG.ready(function () {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');

    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }

    NG.onResize(layout);
    newGame();

    var SWIPE = 0;
    NG.createTouch(canvas, {
      onDown: function (pt) {
        anchor = { x: pt.x, y: pt.y, id: pt.id, moved: false, onFinish: inRect(pt.x, pt.y, finishRect) };
        SWIPE = Math.max(16, cell * 0.5);
      },
      onMove: function (pt) {
        if (!anchor || anchor.id !== pt.id || anchor.onFinish) return;
        var dx = pt.x - anchor.x, dy = pt.y - anchor.y;
        if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) return;
        anchor.moved = true;
        if (Math.abs(dx) > Math.abs(dy)) setWant(dx > 0 ? RIGHT : LEFT);
        else setWant(dy > 0 ? DOWN : UP);
        anchor.x = pt.x; anchor.y = pt.y;      // re-anchor so a held finger can curve
      },
      onUp: function (pt) {
        if (!anchor || anchor.id !== pt.id) return;
        var a = anchor; anchor = null;
        if (a.onFinish && inRect(pt.x, pt.y, finishRect)) { window.location.href = '../../index.html'; return; }
        if (a.moved) return;
        if (tapStart()) return;
        if (state === 'playing' && inBoard(pt.x, pt.y)) turnToward(pt.x, pt.y);
      },
    });

    // Keyboard: navigation keys steer AND start the game (tap or any nav key
    // begins play). The game never *requires* a keyboard — it's a desktop /
    // kiosk-remote convenience on top of the touch controls.
    window.addEventListener('keydown', function (ev) {
      var k = (ev.key || '').toLowerCase();
      var dir = null;
      if (k === 'arrowup' || k === 'w') dir = UP;
      else if (k === 'arrowdown' || k === 's') dir = DOWN;
      else if (k === 'arrowleft' || k === 'a') dir = LEFT;
      else if (k === 'arrowright' || k === 'd') dir = RIGHT;
      if (dir) {
        if (state === 'title' || state === 'over') tapStart();   // any nav key starts / restarts
        setWant(dir);
        ev.preventDefault();
        return;
      }
      if (k === 'enter' || k === ' ' || k === 'spacebar') { tapStart(); ev.preventDefault(); }
    });

    NG.onExit(function () { window.location.href = '../../index.html'; });

    window.requestAnimationFrame(loop);
  });
})();
