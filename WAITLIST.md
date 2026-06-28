# Waiting list

Games queued for the catalogue but not yet built. Each must still meet the
hard constraints in `CLAUDE.md` (no dependencies, runs from `file://` and HTTP,
touch-only, and playable at all three design ratios — 16:9, 9:8, 9:16).

| Game | Style | Players | Notes |
|------|-------|---------|-------|
| _(empty)_ | | | The list is currently clear — every queued game has shipped. |

Add the next idea here as a row (and a section below if it needs detail), then
promote it into `/games/<name>/` and link it from `/index.html` once built.

## Shipped from this list

- **Gomoku** (Five-in-a-Row) — built in `games/gomoku/`. 15×15 board, pass-and-play
  2-player plus a single-player vs-computer mode (threat-space AI, per-side AI
  toggle like Snake), aim-and-confirm tap placement, win-line highlight, undo,
  and a tap-to-restart prompt. Letterboxes to the largest centred square at all
  three ratios.
