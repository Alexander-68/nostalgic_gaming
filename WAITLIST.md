# Waiting list

Games queued for the catalogue but not yet built. Each must still meet the
hard constraints in `CLAUDE.md` (no dependencies, runs from `file://` and HTTP,
touch-only, and playable at all three design ratios — 16:9, 9:8, 9:16).

| Game | Style | Players | Notes |
|------|-------|---------|-------|
| **Gomoku** (Five-in-a-Row) | Abstract strategy, turn-based | 1–2, same-device (+ optional AI) | First non-arcade title. See below. |

## Gomoku (Five-in-a-Row)

Place stones on a grid; first to five in a row (horizontal, vertical, or
diagonal) wins. A natural fit for this catalogue:

- **Touch-native.** Tap an intersection to place a stone — no keyboard or
  drag needed. The whole game is taps.
- **Same-device multiplayer falls out for free.** Two players share one
  screen and alternate turns (the default multiplayer style here). A solo
  "vs computer" mode adds an AI opponent — a minimax / threat-space search
  over the board, no transport required, so it runs from `file://`.
- **Scales cleanly to every ratio.** The board is a square N×N grid; in
  16:9 / 9:8 / 9:16 it letterboxes to the largest centred square (or biases
  toward the short axis), so the cells stay square at any orientation —
  reuse the `NG.fit` / centred-board approach rather than reflowing the grid.

Suggested scope when promoted: 15×15 board (classic), pass-and-play 2-player
plus a single-player vs-AI mode, win-line highlight on victory, and a tap-to-
restart prompt. Mirror the structure of `games/snake/` (mode menu + AI toggle)
and the shared `NG` API.
