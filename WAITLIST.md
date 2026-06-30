# Waiting list

Games queued for the catalogue but not yet built. Each must still meet the
hard constraints in `CLAUDE.md` (no dependencies, runs from `file://` and HTTP,
touch-only, and playable at all three design ratios — 16:9, 9:8, 9:16).

| Game | Style | Players | Notes |
|------|-------|---------|-------|
| 2048 | Merge-tile puzzle | 1 | Swipe to slide; matching tiles merge. 4×4 grid, pure touch, trivial state. Highest fun-per-line-of-code ratio. |
| Reversi / Othello | Strategic board game | 1–2 / vs AI | 8×8 square grid — same letterbox layout as Gomoku. Flip discs, classic AI (minimax + positional score). |
| Connect Four | Drop-disc strategy | 1–2 / vs AI | Tap a column to drop; first to four in a row wins. Landscape-native 7×6 grid; simple gravity + look-ahead AI. |
| Bejeweled | Match-3 puzzle | 1 | Swap adjacent gems to make rows/cols of 3+. Cascades, combos, score-chase. Square grid scales to all ratios. |
| Space Invaders | Fixed shooter (PvE) | 1 | First shooter. Drag-to-move + tap/auto fire. Grid scales to width. |
| Frogger | Lane-crossing action | 1 | Swipe/tap lane movement. Rows scale naturally, and hazards are simple sprites with strong arcade recognition. |
| Pac-Man | Maze chase | 1 vs AI | Highest recognition + real opponent AI, but the fixed maze is the hardest layout to fit across all three ratios. |
| Pinball | Physics table | 1–2 hot-seat | Best touch/multitouch story, but highest effort (custom physics) and worst landscape fit. Flagship/centerpiece, not a quick win. |

Add the next idea here as a row (and a section below if it needs detail), then
promote it into `/games/<name>/` and link it from `/index.html` once built.

## Details

### 2048 — merge-tile puzzle
Swipe in any of four directions to slide all tiles simultaneously; two tiles of the same value that collide merge into one. Reach 2048 to win, keep going for the high score.

The state is a 4×4 grid of integers — trivially small. No animation engine is needed (tiles can snap to position). The square grid letterboxes cleanly at all three ratios; chrome (score, best score, NEW) fits above or beside the board. Input is four swipe directions, detected as the dominant axis of any drag gesture — one of the cleanest touch models in the catalogue.

The only subtlety is the merge rule (each tile merges at most once per swipe) and spawning a random 2 or 4 in an empty cell after every valid move.

### Reversi / Othello — strategic board game
Place a disc; every opponent disc trapped in a straight line between your new disc and another of yours flips to your colour. Most discs when the board fills wins.

The 8×8 grid is a perfect fit for the square-letterbox layout already used by Gomoku and Sudoku. Chrome (score, robot toggles, NEW) goes in the side panels (landscape) or top/bottom bands (portrait). AI is minimax with a standard positional weight matrix (corners > edges > interior) and a depth of 4–6 half-moves — strong enough to be a challenge, cheap enough to run synchronously.

Two robot icons (same convention as Gomoku and Tetris) give solo vs. AI, pass-and-play, and computer-vs-computer on the same board.

### Connect Four — drop-disc strategy
Tap a column to drop a disc to the lowest empty row; first to four in a row — horizontal, vertical, or diagonal — wins. A simple, satisfying mechanic with no hidden state.

The 7×6 grid is wider than tall, making it landscape-native. In portrait, rotate the board concept 90° (drop from the left side, discs fall rightward) or simply let the grid scale down — both work. AI is a look-ahead on open threes and fours, threat-blocking first, then scoring, similar to the Gomoku AI. Two-player hot-seat (same screen) is free from the single-column-tap input.

### Bejeweled — match-3 puzzle
Swap two adjacent gems to make a horizontal or vertical run of three or more matching colours; matched gems vanish and the board cascades as gems fall to fill the gap. Chain reactions score multipliers; the goal is score-chasing before no valid swaps remain.

The square gem grid (8×8 is classic) fits the same letterbox pattern as the other square-board games. Touch input is a short drag from one gem toward its neighbour — direction snaps to the nearest axis. The trickiest part is the cascade engine: after each removal, fall-fill, check for new matches, repeat until the board stabilises. No animation is required beyond colour fills, but smooth falling adds a lot of feel for modest extra code.

Variants to consider: timed mode (beat the clock), or a level-based mode with a gem-clear quota. Either gives a natural difficulty progression without procedural level design.

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
