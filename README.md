# Nostalgic Arcade

A little collection of vintage games that run in any web browser. No installs, no accounts, no internet required — just open it and play. Great on a touchscreen, and works with a mouse too.

## Start playing

**Easiest way:** double-click **`index.html`**. It opens in your browser and you're in the arcade.

That's it — pick a game from the menu and tap/click it.

> Prefer a web address? You can also serve the folder and open `http://localhost:8000`:
> ```
> python -m http.server 8000
> ```

## Any screen, any orientation

Every game is built to fill the whole screen and play well **landscape, portrait, or square** — turn your tablet or phone however you like and the game lays itself out to match.

## Leaving a game

- Tap the **FINISH** button at the top of the screen (it hides during play and reappears between rounds), **or**
- Press **Esc**, **Back**, or **Home** — handy on a kiosk, remote, or keyboard.

Either one takes you back to the game menu.

---

## The games

### 🏓 Pong

The classic. A ball bounces between two paddles — don't let it get past yours. First to **7** wins.

**On a touchscreen**
- **Drag** on your side of the screen to move your paddle.
- It's **two players at once**: each person controls the paddle on their side, using their own finger — so you can play a friend on a single screen.
- Playing alone? Any paddle you're not touching plays itself, so you can warm up solo.

**With a mouse**
- **Left-click your paddle to lock onto it** — now just move the mouse and the paddle follows. No need to hold the button down.
- **Right-click**, or **left-click away from the paddle**, to let go.

**Curve the ball!**
Flick your paddle sideways at the moment you hit the ball and you'll put **spin** on it — the ball bends through the air, kicks off the side walls at an angle, and is much harder to return. A spinning ball glows **amber** with a comet trail so you can see it coming.

**To start / restart:** tap or click anywhere — the screen tells you when (“TAP TO SERVE”, “TAP TO REMATCH”).

---

### 🐍 Snake

Eat the apples, grow longer, don't crash. The board fills the whole screen and reshapes with your device orientation — wide in landscape, tall in portrait.

**Solo** — classic Nokia mode. Eat apples to grow and score; hit a wall or your own tail and it's over. Speed creeps up the longer you get.

**Two players** — last snake alive wins. Each player swipes within their own half of the screen (both fingers work simultaneously). You die on your own body, the other snake, a wall, or a head-on collision — ties break on length.

**Tap a robot icon** next to your name to hand that snake to the computer.

---

### 🧱 Breakout

Drag the paddle; knock the ball up through the wall, brick by brick. The bounce angle depends on **where** the ball strikes your paddle — centre sends it straight up, edges kick it out at a steep angle — so you aim by positioning, exactly like the original.

The ball speeds up when it breaks into the red and amber rows at the top. Clear the wall and the next one loads automatically, a little faster. Three lives. Pause any time; tap anywhere to resume.

**AI autoplay** — tap the AI chip in the HUD to hand the paddle to the computer and watch a full run play out hands-free.

---

### ⚫ Gomoku

Five stones in a row wins — across, down, or diagonally — on a 15×15 grid. Tap an intersection to aim, tap again to confirm. The winning line lights up when the game ends; undo a move at any time; tap to restart.

**Robot icons** next to each player's panel toggle that side between human and computer, so you get solo vs. AI, pass-and-play with a friend, or computer vs. computer, all on the same board.

---

### 🟦 Tetris

Stack the falling tetrominoes and complete full rows to clear them. Every row you clear scores points; the game speeds up as you go. In **2-player**, clearing two or more rows at once drops **garbage** into your opponent's well, pushing their stack up — last one standing wins.

**Touch controls** (each finger steers the well it starts in):
- **Drag left/right** — slide the piece column by column under your finger
- **Tap** — rotate clockwise
- **Drag or flick down** — soft-drop while held; a fast flick hard-drops instantly
- **Swipe up** — swap the piece into the HOLD slot

The HUD shows the HOLD slot and the next three pieces in the queue. A ghost piece shows exactly where the current piece will land.

**Robot icons** toggle each well between player and computer. The computer plays toward Tetris (four-line clears) when the board is clean, and soft-drops — never hard-slams — when facing a human player.

---

### 💣 Minesweeper

Clear the minefield without setting off a mine. Every revealed number tells you how many of its eight neighbours are mines — read the numbers, deduce where the mines hide, and uncover every safe cell to win.

**Touch controls**
- A big **DIG / FLAG** toggle picks what a tap does. **Tap** a cell to dig it (or flag it).
- **Hold** any cell to flag it without switching modes.
- **Tap a revealed number** whose flags already match its count to **chord** — open all its remaining neighbours at once. The fast way to sweep.

**Always-safe start** — mines are dealt *after* your first dig, clear of the cell you tapped and its neighbours, so you always open into a region and never lose on move one.

**With a mouse** — left-click digs (or flags, per the toggle); **right-click flags** a cell directly, the classic desktop way.

**Three sizes** — tap the difficulty chip to cycle **EASY** (9×9, 10 mines), **MED** (13×13, 28) and **HARD** (16×16, 51). The mine counter and timer track your run; **NEW** deals a fresh field.

---

### 🚀 Missile Command

Defend your cities from a relentless barrage of incoming warheads. Each wave is faster and more complex than the last — missiles split mid-flight, bombers cross the screen, and smart bombs dive straight for your bases.

**Touch controls**
- **Tap anywhere in the sky** to fire a counter-missile that detonates at that point. Anything caught in the blast radius is destroyed.
- **Tap multiple targets at once** — multitouch lets you handle several threats simultaneously; later waves demand it.

Surviving a wave banks a bonus for intact cities and leftover ammo; your arsenal replenishes at the start of each new wave.

**AI autoplay** — tap the robot icon in the HUD to hand the defence to the computer and watch it play out hands-free.

---

### 🔢 Sudoku

Fill every row, column, and 3×3 box with the digits 1–9 — no repeats. Every puzzle is generated fresh with a unique solution.

**Touch controls**
- **Tap a cell** to select it, then **tap a digit** on the number pad to fill it in.
- **Tap ERASE** to clear a filled cell before entering a different digit — cells cannot be overwritten directly.
- **FILL / NOTES toggle** switches between placing final answers and pencilling in candidate digits. Pencil marks in the same row, column, and box are cleared automatically when you place a digit there.

**Digit highlighting** — tapping a digit on the number pad (or selecting a filled cell) highlights every matching cell on the board. Once all nine instances of a digit are correctly placed, its button greys out.

**Three difficulties** — tap DIFF to cycle **EASY**, **MED**, and **HARD**. The timer starts on your first move. **NEW** deals a fresh puzzle at the current difficulty.

---

### 🟩 2048

Swipe in any direction to slide all tiles at once — when two tiles of the same value collide they merge into one. A new tile spawns after every valid move. Reach **2048** to win, then keep going for the highest score you can reach.

**Touch controls**
- **Swipe** in any of the four cardinal directions to slide and merge. The dominant axis of your drag decides the direction.

Your best score is saved between sessions. **NEW** starts a fresh grid.

---

### ⚫ Reversi

Place a disc to flip every opponent disc trapped in a straight line between your new piece and another of yours. When the board fills — or neither player can move — the player with the most discs wins.

**Touch controls**
- **Tap any highlighted cell** to place your disc. Valid moves are shown as translucent dots.
- Flipped discs animate with a coin-flip effect.

**Robot icons** next to each player's panel toggle that side between human and computer. The AI uses minimax with alpha-beta pruning and a classic positional weight matrix — corners are highly prized. When a player has no legal move, their turn is skipped automatically and a brief toast tells you so.

**UNDO** steps back one move. **NEW** starts a fresh game.
