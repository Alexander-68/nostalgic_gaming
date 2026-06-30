# Waiting list

Games queued for the catalogue but not yet built. Each must still meet the
hard constraints in `CLAUDE.md` (no dependencies, runs from `file://` and HTTP,
touch-only, and playable at all three design ratios — 16:9, 9:8, 9:16).

| Game | Style | Players | Notes |
|------|-------|---------|-------|
| Space Invaders | Fixed shooter (PvE) | 1 | First shooter. Drag-to-move + tap/auto fire. Grid scales to width. |
| Frogger | Lane-crossing action | 1 | Swipe/tap lane movement. Rows scale naturally, and hazards are simple sprites with strong arcade recognition. |
| Pac-Man | Maze chase | 1 vs AI | Highest recognition + real opponent AI, but the fixed maze is the hardest layout to fit across all three ratios. |
| Pinball | Physics table | 1–2 hot-seat | Best touch/multitouch story, but highest effort (custom physics) and worst landscape fit. Flagship/centerpiece, not a quick win. |

Add the next idea here as a row (and a section below if it needs detail), then
promote it into `/games/<name>/` and link it from `/index.html` once built.

## Details

### Space Invaders — fixed shooter
Fills the missing shooter genre and the missing pure-PvE game (no opponent AI —
the descending formation is the challenge). Drag anywhere along the bottom to
move the cannon, tap to fire (or auto-fire for one-finger play). The invader grid
scales to width; portrait just means a taller descent and fewer columns. Easy at
all three ratios.

### Frogger — lane-crossing action
A strong arcade fit that avoids the fixed-maze problem. The level is a stack of
horizontal lanes: road traffic, safe medians, river logs/turtles, and goal slots.
Input is simple and touch-native — swipe or tap a direction to hop one tile. In
landscape, lanes can be wider with bigger horizontal travel; in portrait, the
same number of lanes remain readable because the frog advances vertically.

The main risk is tuning density and speed so it feels fair on all ratios, but the
technical model is modest: repeated lane objects moving at constant speeds, grid
snapping for the frog, collision with cars, and carried motion on logs.

### Pac-Man — maze chase (runner-up)
Highest brand recognition of the lot and gives genuine opponent AI (four ghosts
with distinct personalities). Swipe to steer. The catch is the fixed maze: it's
the hardest thing to make look right across 16:9 / 9:8 / 9:16, so slot it after
the cleaner-fitting games above, once you want to take on that layout challenge.

### Pinball — physics table (flagship / centerpiece)
Best control story in the catalogue — left flipper = tap left half of screen,
right flipper = tap right half, both at once = real two-finger multitouch;
plunger = pull-back/flick gesture. Purely touch-native and leans on the hardware
hard.

Trade-offs that make this the "big one," not a quick win:

- **Aspect ratios.** A table is intrinsically a tall, fixed portrait object that
  can't reshape like Pong's paddles or Tetris's panels. 9:16 is native; 9:8 works
  with a shorter table; **16:9 must letterbox** the table and fill the sides with
  backglass/scoring art (`NG.fit` supports this) — it won't go edge-to-edge in
  landscape the way the other games do.
- **Physics.** Less "a game," more "a small 2D physics engine": fast ball + thin
  walls = the tunnelling problem from Breakout but worse (needs continuous
  collision detection); curved/arbitrary surfaces (bumpers, arcs, lane guides)
  rather than axis-aligned rectangles; rotating flippers that impart momentum from
  angular velocity (a moving segment hitting a moving circle and adding energy) —
  the finicky core to make feel right.
- **Content.** Two flippers and a blank table get boring fast; the fun is bespoke
  table features (ramps, slingshots, pop bumpers, targets, multiball, scoring
  modes).

Multiplayer is clean, though: classic hot-seat alternating balls maps perfectly
to same-device, no AI needed. Budget for it like building a physics engine, not a
weekend game.

**References:**

- <https://github.com/k4zmu2a/SpaceCadetPinball> — reverse-engineered 3D Pinball
  Space Cadet; full-fidelity physics/table reference (C++).
- <https://github.com/vpinball/vpinball> — Visual Pinball; the heavyweight,
  feature-complete table simulator (C++).
- <https://github.com/dozingcat/Vector-Pinball> — **simplest reference**: vector
  visualization with claimed good physics (Java/libGDX + Box2D). Closest in
  spirit to our look; best starting point for understanding the model.
- <https://www.247pinball.com/> — playable online web game; not bad as a
  feel/UX reference.

## Shipped from this list

- **Missile Command** — built in `games/missile-command/`. Endless-wave tap-to-intercept defence. Tap the sky to fire a counter-missile that detonates at the tapped point, destroying anything in the blast radius; multitouch lets you target several threats at once. Waves escalate with splitting missiles, bombers, and smart bombs; a bonus round banks points for surviving cities and leftover ammo between waves. AI autoplay (robot icon in HUD). Responsive-court layout — the play field fills the screen at all three ratios with no letterbox.

- **Sudoku** — built in `games/sudoku/`. Single-player logic puzzle. Puzzles are generated fresh each game using a backtracking solver with MRV heuristic and uniqueness verification (guaranteed one solution). Tap a cell to select, tap a digit to fill; ERASE clears a cell before overwriting; FILL/NOTES toggle switches between final answers and pencil marks (pencil marks auto-clear when a digit is placed in the same row/column/box). Digit highlighting: tapping a digit highlights all matching cells; once all nine are correctly placed its numpad button greys out. Timer starts on first move. Three difficulties (EASY 46 givens / MED 32 / HARD 24). Fixed-ratio letterbox layout — side panels in landscape, top/bottom bands in portrait.

- **Gomoku** (Five-in-a-Row) — built in `games/gomoku/`. 15×15 board that boots
  straight into a same-screen 2-player game; each player's frame carries a robot
  icon you tap to switch that side between YOU and COMPUTER (threat-space AI), so
  1-player, 2-player and computer-vs-computer all share one board. Aim-and-confirm
  tap placement, win-line highlight, undo, tap-to-restart. The board is maximised
  (full height in landscape) with chrome in the leftover space; it letterboxes to
  the largest centred square at all three ratios.

- **Tetris** — built in `games/tetris/`. Solo, VS computer, and same-device
  2-player versus (clear lines → send garbage). Touch controls: drag=move,
  tap=rotate, flick-down=hard-drop, swipe-up=hold; ghost piece; HOLD slot; 3-deep
  NEXT queue; 7-bag randomiser. Fixed-ratio letterbox layout — 9:16 is home turf;
  16:9 flanks the well(s) with score/NEXT/HOLD panels; 9:8 uses a narrower well.
  Computer targets Tetris (4-line clears) when the board is clean and low, and
  always soft-drops (no hard-slam) when facing a human opponent. Robot icons toggle
  each well between YOU and COMPUTER.

- **Minesweeper** — built in `games/minesweeper/`. Single-player deduction grid
  on a maximised square field that letterboxes at all three ratios (side panels in
  landscape, top/bottom bands in portrait). A big DIG/FLAG segmented toggle drives
  taps, with hold-to-flag as a shortcut and chord-on-number for fast sweeps; first
  dig is always safe (mines dealt afterward, clear of the tap + neighbours).
  Flood-fill reveals, classic-coloured numbers, mine + timer readouts, three
  difficulty sizes (9×9/10, 13×13/28, 16×16/51) and tap-to-restart. The board
  engine is pure and unit-tested headlessly under Node (`module.exports`).
