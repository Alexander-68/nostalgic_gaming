# Waiting list

Games queued for the catalogue but not yet built. Each must still meet the
hard constraints in `CLAUDE.md` (no dependencies, runs from `file://` and HTTP,
touch-only, and playable at all three design ratios — 16:9, 9:8, 9:16).

| Game | Style | Players | Notes |
|------|-------|---------|-------|
| Tetris | Falling-block puzzle | 1 (2P versus later) | Biggest genre gap. Portrait-native; well reshapes per orientation. |
| Space Invaders | Fixed shooter (PvE) | 1 | First shooter. Drag-to-move + tap/auto fire. Grid scales to width. |
| Missile Command | Tap-to-intercept defense | 1 | Purest multitouch showcase — the whole game is tapping the sky. |
| Pac-Man | Maze chase | 1 vs AI | Highest recognition + real opponent AI, but the fixed maze is the hardest layout to fit across all three ratios. |
| Pinball | Physics table | 1–2 hot-seat | Best touch/multitouch story, but highest effort (custom physics) and worst landscape fit. Flagship/centerpiece, not a quick win. |

Add the next idea here as a row (and a section below if it needs detail), then
promote it into `/games/<name>/` and link it from `/index.html` once built.

## Details

### Tetris — falling-block puzzle
The single most iconic missing game and a whole new genre. Swipe left/right to
move, tap to rotate, swipe-down/flick to soft/hard drop — fully touch-native, no
buttons. The well is naturally tall, so **9:16 is home turf**; in 16:9 flank the
well with next/hold/score panels, in 9:8 a narrower well. Reshapes per
orientation like Pong's paddles. Later: same-device 2-player versus (clear lines
→ send garbage) to exercise multitouch.

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
