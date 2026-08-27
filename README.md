# MoveGrade

Chrome extension that overlays a live move-quality badge on lichess.org and chess.com —
**Brilliant / Great / Best / Excellent / Good / Book / Inaccuracy / Mistake / Blunder** —
after every move, plus a colour strip of the whole game so far. Stockfish 16
(NNUE, WebAssembly) runs locally inside the extension; nothing is sent anywhere.
Moves that are still theory are named and graded **Book** against a database of
3,328 openings rather than against the engine.

Works on:

- games you **watch** (lichess TV, spectating, broadcasts, chess.com events/watch)
- the **analysis board** and **studies** on either site (steps with you as you click through moves)
- games **against the computer** (lichess Stockfish level N / BOT accounts, chess.com `/play/computer`)
- **finished** games

Both sites change their markup often (lichess even randomises tag names), so
the scraper is structural: it looks for the element holding the most SAN-like
nodes (scoped to `wc-move-list` on chess.com) and uses the `.selected` /
`.active` / `.a1t` marker for the current move.

It deliberately stays paused during a live game you are playing against a human
opponent — real-time engine feedback there counts as engine assistance under
lichess's rules and will get an account flagged. The overlay shows
"Paused: live game vs human" instead and resumes once the game is over.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder (`Projects\movegrade`).
3. Open any lichess game / analysis page. The panel appears top-right.

The toolbar icon shows/hides the panel. Drag it by its title bar; the position
is remembered. ⚙ opens settings: search depth (4–24), piece set (cburnett /
merida / alpha), board colours, mini-board on/off, background grading of
earlier moves.

The panel shows a mini board with the graded move highlighted and its badge
pinned to the destination square, an eval bar, the eval before → after, the
win-chance lost, the name of the opening being played, and the engine's
preferred line when the move wasn't best.
The strip at the bottom is one dot per move of the game — click any dot to
review that move.

**On-board badge.** The badge is also drawn directly on the site's board, on
the destination square of the latest move (chess.com-review style), slightly
transparent while the grade is still provisional. ⊡ hides the panel, leaving
just the on-board badge; the extension's toolbar icon shows the panel again.

## How grading works

For each move the engine evaluates the position before (MultiPV 2, so it knows
the best and second-best move) and after. Both are converted to a win
probability (lichess's formula) and the drop is measured from the mover's side:

| Category   | Rule |
|------------|------|
| Book       | still following theory (see [Opening book](#opening-book)) |
| Best       | engine's top move, or < 0.5 % lost |
| Brilliant  | Best **and** a real sacrifice (piece left en prise / taken by a cheaper piece) in a position that wasn't already won |
| Great      | Best **and** the only good move (second-best ≥ 10 % worse) |
| Excellent  | < 2 % lost |
| Good       | < 5 % lost |
| Inaccuracy | < 10 % lost |
| Mistake    | < 20 % lost |
| Blunder    | ≥ 20 % lost |
| Checkmate  | the move mates |

Tweak thresholds in `overlay/classify.js`.

## Opening book

Grading a gambit purely on eval is wrong: 3. c3 in the Smith-Morra hands over a
pawn, so the engine marks it down and it used to come out as an *Inaccuracy*.
It is theory, and theory is what "Book" is supposed to mean.

So the book is a real database — every position of all 3,328 named openings in
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
(CC0), 7,853 positions in total, from `1. Nh3` to twenty-ply main lines. A move
is **Book** when:

- the position it reaches is in the book, **and**
- the game had not already left theory (otherwise shuffling a knight out and
  back would transpose into a book position and re-enter book), **and**
- it does not leave the mover worse than about −1.5 pawns — which keeps the
  gambits but still lets a named-but-refuted line like the Damiano be graded
  on its merits.

Positions are keyed by structure (board, side to move, castling rights), not by
move order, so lines that transpose into theory are recognised as theory.

The opening's name is shown under the badge whatever the grade is, and stays on
screen dimmed once the game leaves book.

### Regenerating

`overlay/book.js` is generated and checked in, so nothing is fetched at runtime:

```
node tools/build-book.mjs     # tools/eco/*.tsv -> overlay/book.js
node tools/check-book.mjs     # coverage + grading checks, non-zero on failure
```

To pick up new openings, refresh the TSVs from upstream and rebuild.

## Layout

```
manifest.json          MV3 manifest (CSP allows wasm)
background.js          toolbar-button toggle; creates the offscreen engine document
offscreen/             engine host page: owns the Stockfish worker, serves panels over a runtime port
overlay/remote-engine.js  panel-side proxy to the offscreen engine
content.js             lichess/chess.com DOM scraping + iframe mounting + human-game guard
overlay/overlay.html   the panel (runs as an extension page inside an iframe)
overlay/overlay.js     game state, engine scheduling, rendering
overlay/engine.js      UCI wrapper around the Stockfish worker
overlay/classify.js    win%-based classification + the book rule
overlay/book.js        generated opening book (position key -> ECO name)
overlay/book-key.js    the position-keying used by the book, both sides of the build
tools/build-book.mjs   rebuilds overlay/book.js from tools/eco/*.tsv
tools/check-book.mjs   book coverage and grading checks
tools/eco/             ECO tables from lichess-org/chess-openings (CC0)
engine/                stockfish-nnue-16-single.{js,wasm} + NNUE net (40 MB)
lib/chess.js           chess.js 1.4 (SAN parsing, legality, attackers)
pieces/<set>/          SVG piece sets (see pieces/LICENSES.md)
```

## Dev testing without loading the extension

`python -m http.server 8765` in this folder, then open
`http://localhost:8765/overlay/overlay.html` and feed it moves from the console:

```js
window.postMessage({ type: "movegrade:moves", mode: "analysis", allowed: true, reason: "",
  sans: ["e4","e5","Nf3","Nc6","Bc4","Nf6","Ng5","d5","exd5","Nxd5","Nxf7"] }, "*");
```

## Credits

Stockfish (GPL-3.0) via stockfish.js, chess.js (BSD-2-Clause). See the LICENSE
files in `engine/` and `lib/`. Opening names from
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0-1.0).
