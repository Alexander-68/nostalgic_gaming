# Waiting list

Games queued for the catalogue but not yet built. Each must still meet the
hard constraints in `CLAUDE.md` (no dependencies, runs from `file://` and HTTP,
touch-only, and playable at all three design ratios — 16:9, 9:8, 9:16).

| Game | Style | Players | Notes |
|------|-------|---------|-------|
| Space Invaders | Fixed shooter (PvE) | 1 | First shooter. Drag-to-move + tap/auto fire. Grid scales to width. |
| Frogger | Lane-crossing action | 1 | Swipe/tap lane movement. Rows scale naturally, and hazards are simple sprites with strong arcade recognition. |
| Asteroids | Free-flying vector shooter | 1 | Fills the 360° shooter slot (vs. Space Invaders' fixed formation). Screen-wrap tolerates any aspect, so it's a clean responsive-court fit. |
| Simon | Memory / pattern repeat | 1 | New genre (memory). Four touch quadrants, no AI, trivial ratio fit — the catalogue's quickest remaining win. |
| Solitaire (Klondike) | Card / patience | 1 | Fills the card-game slot. Tap-to-move + drag, no opponent. Tableau layout is the only real ratio challenge. |
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

### Asteroids — free-flying vector shooter
A second shooter that plays nothing like Space Invaders: instead of a fixed
formation descending, you free-fly a ship through a screen of drifting rocks that
split into smaller, faster rocks when shot. The wrap-around playfield (everything
that exits one edge re-enters the opposite) is exactly what makes it a clean
responsive-court fit — the field simply *is* the viewport at any aspect, no
letterbox, and wrap hides ratio differences instead of fighting them.

Touch maps to a thrust/rotate/fire layout in the established multitouch style:
left thumb rotates (a two-zone or arc control), right thumb thrusts and fires, and
several fingers can be down at once (rotate + thrust + fire simultaneously), which
leans on the same hardware Pong's paddles do. Vector look fits the catalogue's
phosphor aesthetic. The one bit of real work is inertial physics — momentum,
drift, and continuous collision for the fast bullets — but it's a much smaller
engine than Pinball's, with axis-free circles rather than bespoke table surfaces.

### Simon — memory / pattern repeat (quick win)
The catalogue has no memory game, and this is the cheapest one to add. Four big
coloured quadrants flash a growing sequence; the player taps it back; one mistake
ends the run and the round count is the score. It's almost pure UI and timing —
no physics, no AI, no opponent — and the four-quadrant layout fits all three
ratios trivially (a centred square of pads with chrome in the leftover space, the
same letterbox approach as the puzzle games). Audio is part of the identity here
(each pad has a tone), generated with the Web Audio API so there are no asset
files to load — `file://`-safe by construction. A good palette-cleanser between
the heavier strategy and physics builds.

### Solitaire (Klondike) — card / patience
Fills the missing card-game genre with the most recognisable single-player card
game there is. Seven tableau columns, four foundations, a stock/waste pile; build
the foundations up by suit, build the tableau down in alternating colours. Input
is touch-native: tap a card to auto-move it to a legal foundation, or drag a card
(and the run beneath it) between columns; double-tap-to-auto-finish is a nice
optional flourish. No opponent and no physics, so the complexity is all in the
move rules and the deal/win bookkeeping — well-bounded, and the deck renders
cleanly as drawn shapes/pips with zero external assets (`file://`-safe).

The one real challenge is the tableau across ratios: seven overlapping columns
want width, so 16:9 is native, 9:8 is comfortable, and **9:16 is the tight case** —
narrower columns with tighter fan overlap, or a slightly reduced card size, to
keep all seven readable. It's a layout-tuning problem, not a fixed-maze one (see
the shipped Emopac for how that harder case was handled).

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

- **Pac-Man** (shipped as **Emopac**) — built in `games/emopac/`. Single-player maze chase on the classic 28×31 board with a wrap-around side tunnel, four energizers, and a bonus-fruit slot. The cast is emoji: four distinct monster ghosts — 👹 Blinky (chaser), 😈 Pinky (ambush, 4 tiles ahead), 👽 Inky (flank, Blinky-reflected vector), 👻 Clyde (shy inside 8 tiles) — each with an identifying colour glow, turning 🥶 when frightened (flashing white before it wears off) and 👀 (eyes) racing home when eaten. Pac himself is a chomping canvas wedge so his facing always reads. Classic scatter/chase phase schedule with reverse-on-change, per-ghost targeting, staggered house release, and tunnel slowdown. Swipe to steer (buffered to the next tile centre; instant U-turns) or tap to turn toward a point. Energizer → ghosts flee and are edible for a doubling 200/400/800/1600 chain; clear every pellet to advance a level (speeds ramp). Best score persists via `localStorage`. Fixed-ratio letterbox — the maze plus a top score band and bottom lives/fruit band render to one logical grid, contain-fit and centred at all three ratios (the fixed-maze layout challenge this entry warned about, solved with side letterboxing in 16:9). Maze connectivity, geometry, and core mechanics verified headlessly under Node.

- **Connect Four** — built in `games/connect-four/`. Drop-disc strategy on a 7×6 grid. Tap a column to drop your disc to the lowest open slot (gravity fall + a single damped bounce); a pulsing ghost disc previews the hovered column. Win on four in a row — horizontal, vertical, or either diagonal — with the winning four lit by pulsing rings and the game-over banner held until the last disc settles. Two robot-icon toggles (same convention as Gomoku/Reversi) give solo vs. AI, pass-and-play, and computer-vs-computer. AI is minimax with alpha-beta pruning at depth 6, centre-first move ordering, immediate-win cutoff, and a window-scan heuristic with a defence bias. NEW / UNDO / FINISH chrome. Fixed-ratio letterbox — side panels in landscape/9:8, top/bottom bands in portrait.

- **Bejeweled** — built in `games/bejeweled/`. Single-player match-3 on an 8×8 gem grid. Tap a gem then tap an adjacent gem to swap, or short-drag a gem toward its neighbour (direction snaps to the nearest axis); a swap that makes no run of 3+ springs back. Matches clear, gems above fall to fill the gap, fresh gems drop in from the top, and any new matches cascade for a rising combo multiplier (scoring 10 per gem × the cascade level). Six gem types are distinguished by both colour and shape (diamond/circle/square/triangle/hexagon/star) so they read apart even for colour-blind players. The board never starts with a match and reshuffles when no legal move remains. Best score persists via `localStorage`; a robot-icon toggle enables AI autoplay (picks the swap that clears the most gems). Fixed-ratio letterbox layout matching 2048's chrome.

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

- **2048** — built in `games/2048/`. Merge-tile puzzle on a 4×4 grid. Swipe in any direction to slide all tiles; matching values merge into one (each tile merges at most once per swipe). A new 2 or 4 spawns after every valid move. Reach 2048 to win, then keep going for the high score. Best score persisted via `localStorage`. Tile colour ramp from dim green (2) through bright phosphor (16) to amber (64) to warm red (2048+). Fixed-ratio letterbox — side panels in landscape, top/bottom bands in portrait.

- **Reversi** — built in `games/reversi/`. Strategic disc-flipping game on an 8×8 board. Place a disc to flip every opponent disc trapped in a straight line between your new piece and another of yours; most discs when the board fills wins. AI uses minimax with alpha-beta pruning (depth 5), move-ordered by the classic positional weight matrix (corners 100, X-squares −50), plus a mobility bonus — plays in ~10 ms. Two robot-icon toggles (same convention as Gomoku) give solo vs. AI, pass-and-play, and computer-vs-computer. Coin-flip disc animation; "P? HAS NO MOVES" pass toast; UNDO backed by full board snapshots. Fixed-ratio letterbox layout.
