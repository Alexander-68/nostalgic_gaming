# Waiting list

Games queued for the catalogue but not yet built. Each must still meet the
hard constraints in `CLAUDE.md` (no dependencies, runs from `file://` and HTTP,
touch-only, and playable at all three design ratios — 16:9, 9:8, 9:16).

| Game | Style | Players | Notes |
|------|-------|---------|-------|
| Space Invaders | Fixed shooter (PvE) | 1 | First shooter. Drag-to-move + tap/auto fire. Grid scales to width. |
| Missile Command | Tap-to-intercept defense | 1 | Purest multitouch showcase — the whole game is tapping the sky. |
| Sudoku | Logic grid puzzle | 1 | Best quiet puzzle fit. Tap a cell, tap a digit; square board letterboxes cleanly and needs no animation engine. |
| Frogger | Lane-crossing action | 1 | Swipe/tap lane movement. Rows scale naturally, and hazards are simple sprites with strong arcade recognition. |
| Minesweeper | Deduction grid puzzle | 1 | Touch-friendly classic: tap to reveal, flag mode toggle for mines. Board size can adapt per ratio/difficulty. |
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

### Missile Command — tap-to-intercept defense
The game that justifies "10 simultaneous touch points" the way Pong justifies
multitouch paddles. The entire game is tapping — tap the sky to detonate an
interceptor; under a heavy raid with multiple bases you field several fingers at
once. A "defend the bottom edge" layout, so it's trivially correct at 16:9, 9:8
and 9:16 with no reflow. Great fit for the CRT-vector aesthetic and the
"visible cause" principle — every explosion comes from a real interceptor arc.

### Sudoku — logic grid puzzle
The cleanest non-arcade addition: a 9×9 square grid, a compact digit pad, and no
physics or animation requirement. Tap a cell to focus it, tap a digit to enter a
candidate or final value, and use a mode toggle for notes. The square board can
use `NG.fit` and letterbox at every ratio; landscape gets side panels for digits,
timer, mistakes and difficulty, while portrait puts the keypad below the board.

Implementation work is mostly puzzle generation/validation and touch UX polish:
generate a complete solved grid, remove clues to a chosen difficulty, enforce a
single solution, and keep hints/undo optional so the baseline game stays small.

### Frogger — lane-crossing action
A strong arcade fit that avoids the fixed-maze problem. The level is a stack of
horizontal lanes: road traffic, safe medians, river logs/turtles, and goal slots.
Input is simple and touch-native — swipe or tap a direction to hop one tile. In
landscape, lanes can be wider with bigger horizontal travel; in portrait, the
same number of lanes remain readable because the frog advances vertically.

The main risk is tuning density and speed so it feels fair on all ratios, but the
technical model is modest: repeated lane objects moving at constant speeds, grid
snapping for the frog, collision with cars, and carried motion on logs.

### Minesweeper — deduction grid puzzle
Classic, compact, and ideal for touch screens as long as flagging is explicit.
Use tap-to-reveal with a visible flag/reveal segmented control, avoiding hidden
long-press timing as the only way to mark a mine. The grid can scale by
difficulty (for example 9×9, 16×16, or a custom ratio-aware board) and letterbox
inside the remaining HUD/keypad space.

The implementation is small compared with action games: mine placement after the
first tap, flood-fill reveals, number rendering, flags, win/loss state and a
restart face/button. It also gives the catalogue another quiet puzzle next to
Sudoku without needing AI.

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
