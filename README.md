# Free Game Review

A Chrome extension that reviews your **finished** chess.com games as often as you like, with Stockfish 18 running in your own browser.
No account and no limits. It only reads chess.com's public game archive and sends nothing anywhere else.

## What it does

- Rates every move: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder.
- Accuracy for both players, an evaluation graph, and the opening name.
- A coach box that explains each move ("It loses a piece: your opponent can take with Nxe5").
- **Show best line** to see what the engine would have played, and free exploring: move pieces on the board and the engine evaluates live.
- **Practise my mistakes**: find the better move in every position where you made a mistake, miss or blunder.
- Works for games against bots too.
- Reviews are saved, so opening the same game again is instant.

## Install

1. On this GitHub page, click the green **Code** button, then **Download ZIP**.
2. Unzip it somewhere you'll keep it (for example your Documents folder). Don't delete the folder afterwards: Chrome runs the extension from it.
3. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder (the one that contains `manifest.json`).
5. Pin it: click the puzzle-piece icon in Chrome's toolbar, then the pin next to **Free Game Review**.

To update later: download the ZIP again, replace the folder, and click the reload arrow on the extension in `chrome://extensions`.

## Use

- When a game ends on chess.com, click **Free Review** in the game-over box (under New Game / Rematch), or the floating **Free Review** button (drag it anywhere if it's in the way).
- Or click the toolbar icon, type your chess.com username once, and pick one of your recent games.
- You can also paste any game in PGN format into the toolbar popup.
- On the review page: ← and → step through the moves, ↑ jumps to the start and ↓ to the end, F flips the board.

Only finished games can be reviewed. Live games come from chess.com's public archive, which has no games in progress, and bot games are only read once the page shows the result. It can't help anyone during a game.

## Settings

The gear on the review page sets engine strength: Fast (depth 12), Normal (depth 16, the default) or Deep (depth 20).

## Credits and licences

The extension's own code is free software under the GNU GPL v3 (`LICENSE`), the same licence as Stockfish.

- Stockfish 18 (lite, single-threaded WebAssembly build) by the Stockfish team and Nathan Rugg's stockfish.js, GPLv3: `engine/COPYING-stockfish.txt`. Source: https://github.com/nmrugg/stockfish.js
- chess.js 0.10.3 by Jeff Hlywa, BSD 2-Clause: `lib/LICENSE-chess.js.txt`.
- Chess pieces: "Staunty" by sadsnake1, from the Lichess piece collection, CC BY-NC-SA 4.0 (`pieces/staunty/LICENSE.txt`). Free and not sold, as that licence requires.
- Opening names from Lichess's chess-openings list (CC0): https://github.com/lichess-org/chess-openings
- Opening book (`data/book.bin`): positions that players rated 2200+ reached in at least 3 tournament games, built from the Lichess broadcast database (https://database.lichess.org, April–September 2026), CC BY-SA 4.0. The book file is shared under the same licence (`data/book-LICENSE.txt`).
- Interface icons from Free Icon Pack v3.1 by @gvesster.
- Accuracy uses the formula Lichess publishes; move ratings use win-chance loss, similar to the categories chess.com uses.

Not made by or affiliated with Chess.com.
