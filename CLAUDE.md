# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Nostalgic / vintage web games built with **plain HTML, CSS, and JavaScript and zero third-party dependencies**. The root page is a catalogue that links out to individual, self-contained games. Every game must be **touch-operable** and playable across three target aspect ratios, and some games offer a multiplayer mode.

> Reference implementation: **`games/pong/`** is the canonical example — it exercises every constraint below (touch-only, multitouch, the three ratios, local multiplayer with AI fallback). Mirror its structure and use of the shared `NG` API when adding a game.

## Hard constraints

- **No dependencies, no build step, no framework.** No npm packages, bundlers, transpilers, CSS frameworks, or CDN script tags. Ship source that runs directly in the browser. "Shared code" means *local* scripts in this repo, not external packages.
- **Runs from both `file://` and HTTP.** Everything must work when the user double-clicks an HTML file *and* when it's served over HTTP. This is a real constraint that shapes how code is written — see "The `file://` rule" below.
- **Touch-first.** The target is a touchscreen device with *no other input* — no keyboard, no mouse, no physical buttons. Every game must be fully playable by touch alone, including start/serve/restart prompts (use on-screen "tap to…" affordances, never a key press). The hardware supports **multitouch up to 10 simultaneous points**, so designs may rely on several fingers at once (e.g. one paddle per player). Pointer Events give mouse fallback for free during desktop development, but never *require* a mouse or keyboard.
- **Each game is self-contained.** A game lives in its own directory and runs standalone if you open its `index.html` directly. The catalogue links to it; it does not depend on the catalogue.

## The `file://` rule

Browsers treat each `file://` page as a unique opaque origin, so anything governed by CORS is blocked when a file is double-clicked. To keep games playable without a server, **avoid the APIs that `file://` blocks**:

- **No ES modules.** Do not use `<script type="module">` / `import` / `export` — module loading fails over `file://`. Use classic `<script src="...">` instead.
- **Share code via globals.** Load shared code with classic `<script src="../../shared/lib.js">` (works from `file://`) and expose it under a single namespaced global, e.g. `window.NG = window.NG || {}`. Include shared scripts *before* the game script that uses them.
- **No `fetch` / `XMLHttpRequest` of local files.** Inline game data (JS objects, data-URI assets) instead of fetching levels/sprites/JSON. Load images and audio through `<img>` / `<audio>` elements or data URIs, not `fetch`.
- **Watch canvas tainting.** Reading pixels (`getImageData`) from an image loaded off `file://` can throw a security error — embed such images as data URIs if you need pixel access.

Done right, the same files work double-clicked and over HTTP with no changes.

## Running / developing

No build is required. Two ways to run, and both must keep working:

```powershell
# 1. Double-click any index.html (file://) — the baseline, always supported.

# 2. Serve over HTTP (useful for multiplayer, devtools, mobile testing):
python -m http.server 8000        # then open http://localhost:8000
npx serve .                       # Node alternative (dev-only tool, not a project dependency)
```

When adding or changing a game, sanity-check it **both** ways — a stray `import` or `fetch` passes over HTTP but breaks on `file://`.

There is no test runner, linter, or CI configured yet. If you add one, keep it dependency-light and document the commands here (including how to run a single test).

## Architecture

- **Catalogue (`/index.html`)** — the home page. Enumerates the available games and links to each. The list of games is the catalogue's single source of truth; adding a game means adding its entry here.
- **Games (`/games/<game-name>/`)** — one directory per game, each with its own `index.html` entry point plus its JS/CSS/assets. Self-contained and independently runnable.
- **Shared scripts (`/shared/`)** — dependency-free classic scripts reused across games, exposed under the `window.NG` namespace. Games pull these in with relative `<script src>` tags (load order matters: `ng.js` first, then dependents, then the game). Keep shared code generic; game-specific logic stays in the game's own folder. Current modules:

## Current games

| Directory | Title | Pattern | Notes |
|---|---|---|---|
| `games/pong/` | Pingpong | Responsive court | **Canonical reference** — multitouch, 3 ratios, AI, same-device multiplayer; best rally length |
| `games/snake/` | Snake | Responsive court | 1–2 players, vs AI, multitouch; best score (solo) |
| `games/breakout/` | Brick Breaker | Responsive court | AI autoplay mode; best score |
| `games/gomoku/` | Gomoku | Fixed-ratio letterbox | Turn-based, vs AI; good reference for square-grid letterbox layout; best win streak vs computer |
| `games/tetris/` | Tetra Drop | Fixed-ratio letterbox | 1–2 players, vs AI, multitouch, garbage mechanic; best score (1P) |
| `games/minesweeper/` | Minesweeper | Fixed-ratio letterbox | Good reference for square-grid + side-panel / top-bottom-band chrome; best time per difficulty |
| `games/missile-command/` | Missile Command | Responsive court | Endless waves, AI autoplay, multitouch; best score |
| `games/sudoku/` | Sudoku | Fixed-ratio letterbox | Puzzle generation (backtracking + MRV + uniqueness), digit-highlight UX; best time per difficulty |
| `games/reversi/` | Reversi | Fixed-ratio letterbox | Disc-flip strategy; minimax AI depth 5 + alpha-beta + positional weights; two robot-icon toggles; best win streak vs computer |
| `games/2048/` | 2048 | Fixed-ratio letterbox | Merge-tile puzzle; swipe to slide; 4×4 grid; best score |
| `games/connect-four/` | Connect Four | Fixed-ratio letterbox | Drop-disc strategy; 7×6 grid; minimax AI depth 6 + alpha-beta; two robot-icon toggles; best win streak vs computer |
| `games/bejeweled/` | Bejeweled | Fixed-ratio letterbox | Match-3 puzzle; tap/drag to swap; cascade engine + combo multiplier; AI autoplay; best score |
| `games/emopac/` | Emopac | Fixed-ratio letterbox | Pac-Man; 28×31 maze + wrap tunnel; emoji ghost cast (👹😈👽👻) with classic scatter/chase AI; swipe/tap steer; energizers + bonus fruit; best score |

**Reference implementations by pattern:**
- Responsive court (canvas = viewport): `games/pong/`
- Fixed-ratio letterbox (square grid + chrome panels): `games/minesweeper/` or `games/gomoku/`
- Puzzle / deduction game: `games/sudoku/`
  - **`shared/ng.js`** — core. `NG.RATIOS` / `NG.RATIO_LIST` (the three design ratios), `NG.classify(w,h)` (nearest design ratio for a viewport, compared in log space), `NG.fit(logicalW, logicalH, vw, vh)` (contain-fit scale + centered letterbox offsets), `NG.ready(fn)`, and `NG.onResize(fn)` (coalesced to one call per frame, fires once immediately, passes `{width, height, ratio}`). Exit handling: `NG.onExit(fn)` fires on the ESC / BACK / HOME keys kiosk hardware and remotes send; `NG.enableFinish({url, button, onFinish})` wires those keys *and* a FINISH button to navigate back to the catalogue (default `../../index.html`). Every game should expose a touch FINISH affordance plus call one of these. `NG.setPlaying(bool)` toggles a `ng-playing` class on `<body>` so page chrome (e.g. the FINISH button) can hide via CSS during active play — call it on your play/idle state transitions. `NG.storage.get(key, fallback)` / `.set(key, value)` wrap `localStorage` with JSON encoding and a try/catch fallback; `NG.bestScore(key, score)` (higher-is-better) and `NG.bestTime(key, time)` (lower-is-better) build on it and both return `{best, isNew}` — see "Best score / best time tracking" below.
  - **`shared/touch.js`** — `NG.createTouch(element, {onDown, onMove, onUp}, {maxPoints, ignoreMouse})`. Pointer-Events-based multitouch (default cap 10; `ignoreMouse` skips mouse pointers when a game drives the mouse itself, e.g. Pong's click-to-lock paddles). Returns a controller with `.list()` (active points for per-frame polling), `.count`, `.destroy()`. Each point carries `x/y` (CSS px in-element), `nx/ny` (normalised 0..1), and `startX/Y` + `startNx/Ny` (e.g. to decide which side/player a touch belongs to). Sets `touch-action: none` on the element so the browser won't steal drags for scroll/zoom.
  - **`shared/ui.js`** — `NG.ui`, the shared in-game UI kit ("Cabinet OS: In Play"): canvas-drawing helpers for the chrome every game shares, so the look is consistent game-to-game. `NG.ui.colors` (the shared palette — green = chrome, amber = live data, red = failure), `NG.ui.font/rrect/text/scrim`, `NG.ui.button(ctx, rect, label, {state, color})` (states: `normal`/`active`/`disabled`), `NG.ui.chip(ctx, x, y, label, value, opts)` (HUD readout, returns width for row layout), `NG.ui.led(ctx, x, y, r, {on, t, color})`, `NG.ui.brackets(...)` (the signature corner-reticle frame), `NG.ui.prompt(...)` (pulsing "TAP TO …" text with the blinking block cursor), and `NG.ui.overlay(ctx, rect, {title, tone, stat, statNew, detail, prompt, t})` (the shared start/win/pause/over modal; `tone` = `win`/`pause`/`lose`; sizes derive from the shorter side so it scales across all three ratios). Animation helpers `NG.ui.blink(t)` / `NG.ui.pulse(t)` take the game's own clock (no internal RAF) and freeze under `prefers-reduced-motion`. Live gallery / living doc: **`shared/ui-demo.html`**. Games predating this kit still inline their own draw code; migrate opportunistically.

## Aspect-ratio system (cross-cutting requirement)

Every game must render correctly in **three orientations**:

- **16:9** — landscape
- **9:16** — portrait
- **9:8** — "half-portrait" (squarish)

This is the dominant design constraint and affects layout, input placement, and gameplay framing in every game. Two layout strategies are available — pick per game:

- **Fill the viewport (responsive court)** — size the canvas to the actual window and lay the game out into whatever space it's given. Edge-to-edge, no letterbox; best when the game tolerates any aspect. **Pong uses this** (`layout()` in `pong.js`): the canvas *is* the full viewport and the window's orientation chooses the layout. At the three target ratios it looks exactly as designed; at in-between sizes it simply uses all the space.
- **Fixed-ratio letterbox** — for games that need exact proportions, render to a fixed logical canvas at one of the design ratios and `NG.fit(...)` it (contain-fit) into the viewport, accepting black bars on mismatched windows. `NG.fit` / `NG.classify` in `shared/ng.js` support this.

Either way, re-lay-out via `NG.onResize(...)`, and remember orientation can change *gameplay* layout, not just scale it — Pong puts paddles on the left/right edges in landscape and top/bottom in portrait. The orientation-independent "main axis / cross axis" model in `pong.js` lets one logic path serve all three ratios. A game is not done until it has been checked at 16:9, 9:8, and 9:16.

## Puzzle-game conventions

Puzzle games (Minesweeper, Sudoku) share a set of UX conventions distinct from action games:

- **Chrome layout**: the puzzle field is centred and maximised; leftover space hosts controls. In landscape (`vw >= vh`): side panels left and right. In portrait: top and bottom bands. Recompute `chromeLayout()` each frame (pure arithmetic — cheap) so input hit-testing always reflects the live viewport.
- **Difficulty cycling**: a single DIFF button cycles difficulty levels in order; changing difficulty immediately starts a new game.
- **Timer starts on first move**, not on game start, so the player can study the initial state without pressure.
- **Cell-lock rule** (Sudoku): once a cell has a digit, it cannot be overwritten — the player must clear it first. This prevents accidental overwrites after deselection.
- **Digit highlighting / armed-digit fill** (Sudoku): `highlightNum` is an independent state variable (0 = none) that also drives filling — tapping a numpad digit arms it, and any subsequent tap on an empty cell instantly fills that digit (no separate "continuous fill" mode/button; this is just how the numpad works). Tapping a filled cell or given clue sets `highlightNum` to its value instead of filling. Tapping outside the board, numpad and buttons disarms the digit, requiring the older select-cell-then-tap-numpad flow to fill again. In the armed-digit flow the highlight stays on the placed value so all matching cells stay lit; in the select-cell-then-numpad flow placing a digit instead clears the highlight (`highlightNum = 0`), so the next numpad tap re-arms a digit rather than overwriting the just-deselected cell. When all 9 correct instances of a digit are on the board, its numpad button is greyed out.
- **Deselect on fill**: after successfully placing a digit, `selected` is set to `null` so the next numpad tap changes the highlight rather than overwriting the just-filled cell.
- **ERASE control** (Sudoku): a dedicated ERASE button clears the currently selected cell, but only a user-filled one — `eraseCell` refuses given clues, so the starting puzzle stays locked. UNDO reverts the last change (handy for the immediately-previous placement), while ERASE lets the player fix an earlier wrong entry without discarding correct later ones. The button renders live (MUTED) only when an erasable cell is selected, dim (DIM) otherwise.
- **Puzzle generation** (Sudoku): backtracking solver with MRV (minimum remaining values) heuristic for speed; cells are removed one at a time with uniqueness verification (`countSolutions(puzzle, 2) === 1`). Generation is synchronous and fast enough not to block the UI noticeably (~2 ms EASY, ~25 ms HARD on modern hardware).

## Best score / best time tracking

Every game records some form of personal best, persisted locally so it survives reloads. There's no server to compare against other players, so "best" always means *this player, this browser*.

- **Storage: `localStorage`, not cookies.** Unlike cookies, it isn't sent with requests (nothing to send it *to* here), needs no consent banner, and — critically — isn't blocked by the `file://` opaque-origin restriction that rules out `fetch`/XHR (see "The `file://` rule"). It survives reloads over both `file://` and HTTP.
- **Shared helper**: `NG.bestScore(key, score)` and `NG.bestTime(key, time)` in `shared/ng.js` (backed by `NG.storage`) — new games should use these rather than hand-rolling `localStorage` calls. Both return `{best, isNew}` for driving a "NEW BEST" callout. Namespace keys per game, e.g. `'ng_<game>_best'` or `'ng_<game>_best_<difficulty>'` for a per-difficulty record (see Sudoku/Minesweeper). Sudoku, 2048, Bejeweled, Emopac and Missile Command predate this helper and inline the equivalent `localStorage` logic directly — functionally the same, just written before the shared version existed.
- **Which metric fits which game** — pick per game, not one-size-fits-all:
  - **Score climbers** (Snake solo, Breakout, Tetris 1P, 2048, Bejeweled, Emopac, Missile Command): `NG.bestScore`, shown next to the final score on the game-over screen.
  - **Puzzle solve time** (Sudoku, Minesweeper): `NG.bestTime`, tracked **per difficulty** (a HARD clear and an EASY clear aren't comparable), shown on the win banner only — a loss has no time worth recording.
  - **Turn-based strategy vs. computer** (Gomoku, Reversi, Connect Four): no natural numeric score, so these track a **win streak vs. the computer** instead, via `NG.bestScore` on a streak counter. Only updated when *exactly one* robot toggle is on — a 2-human or computer-vs-computer game leaves the record untouched, since neither is "your" result. A draw or loss resets the running streak to 0 (via `NG.storage.set`) without touching the persisted best.
  - **Pong**: symmetric 1v1, so a personal high score doesn't fit either; it tracks **best rally length** (consecutive paddle hits in one point) instead, which rewards skill independent of who's controlling which paddle or whether the AI is involved.

## Multiplayer

Multiplayer is an **opt-in capability of some games**, not a baseline. There are two flavours:

- **Same-device** (implemented, see Pong) — multiple players share one screen, each using their own touch point(s). This needs no transport and runs fine from `file://`; it falls out naturally from the multitouch input and is the default multiplayer style here.
- **Networked** (not yet implemented) — the main place the `file://` constraint bites: networked transports (WebSocket / WebRTC signaling) effectively require the HTTP path. A networked game's **single-player or local core must still run from `file://`**, with the networked layer degrading gracefully (or prompting to serve over HTTP) when unavailable. Transport/signaling is undecided — when building the first one, pick a dependency-free mechanism, factor reusable parts into `/shared` under `NG`, and document the design here.
