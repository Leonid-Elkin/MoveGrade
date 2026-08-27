// Sanity checks for the opening book and the "Book" grade.
//
//   node tools/check-book.mjs
//
// Exits non-zero if any expectation fails.

import { Chess } from "../lib/chess.js";
import { classify } from "../overlay/classify.js";
import { lookupOpening, BOOK_POSITIONS, BOOK_OPENINGS } from "../overlay/book.js";

let failures = 0;
function check(ok, what) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
}

// --------------------------------------------------------------- book depth
// How far into each line the book still recognises the position. Gambits are
// the interesting ones: they are theory even though they hand over material.
const LINES = {
  "Smith-Morra Gambit":      "e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6",
  "King's Gambit Accepted":  "e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5",
  "Danish Gambit":           "e4 e5 d4 exd4 c3 dxc3 Bc4 cxb2 Bxb2",
  "Evans Gambit":            "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5",
  "Sicilian Najdorf":        "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5",
  "Queen's Gambit Declined": "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7",
  "Ruy Lopez, Berlin":       "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4",
  "Gruenfeld Defence":       "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3",
  "Budapest Gambit":         "d4 Nf6 c4 e5 dxe5 Ng4",
  "Benko Gambit":            "d4 Nf6 c4 c5 d5 b5 cxb5 a6",
  "Traxler Counterattack":   "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 Bc5",
  "Latvian Gambit":          "e4 e5 Nf3 f5",
  "English, Hedgehog":       "c4 e6 Nf3 Nf6 Nc3 c5 g3 b6 Bg2 Bb7 O-O Be7",
};

console.log(`book: ${BOOK_POSITIONS} positions, ${BOOK_OPENINGS} named openings\n`);
console.log("every ply of these lines is recognised as theory:");
for (const [label, pgn] of Object.entries(LINES)) {
  const chess = new Chess();
  const sans = pgn.split(" ");
  let depth = 0;
  for (const san of sans) {
    chess.move(san);
    if (!lookupOpening(chess.fen())) break;
    depth++;
  }
  check(depth === sans.length, `${label} — ${depth}/${sans.length} plies in book`);
}

console.log("\nnames resolve to the real variation:");
const named = (pgn) => {
  const c = new Chess();
  for (const san of pgn.split(" ")) c.move(san);
  return lookupOpening(c.fen());
};
check(named("e4 c5 d4 cxd4 c3") === "B21 Sicilian Defense: Smith-Morra Gambit",
  `1.e4 c5 2.d4 cxd4 3.c3 -> ${named("e4 c5 d4 cxd4 c3")}`);
check(named("e4 c5") === "B20 Sicilian Defense", `1.e4 c5 -> ${named("e4 c5")}`);
check(named("d4 Nf6 c4 e6 Nf3 b6") ===  "E12 Queen's Indian Defense",
  `Queen's Indian -> ${named("d4 Nf6 c4 e6 Nf3 b6")}`);

// ------------------------------------------------------------- book grading
// classify() only sees engine numbers, so feed it plausible ones. cp is always
// from the point of view of the side to move, which is how the engine reports.
function grade({ pgn, cpBest, cpAfter }) {
  const chess = new Chess();
  const sans = pgn.split(" ");
  const san = sans.pop();
  for (const s of sans) chess.move(s);
  const fenBefore = chess.fen();
  const legal = new Chess(fenBefore).move(san);
  const bestUci = legal.from + legal.to; // pretend theory *is* the engine's pick only when asked
  const before = {
    bestMove: cpBest === null ? bestUci : "a1a1",
    lines: [{ cp: cpBest ?? 0, mate: null, pv: [bestUci] }, { cp: (cpBest ?? 0) - 60, mate: null, pv: [] }],
    depth: 18,
  };
  const after = { bestMove: null, lines: [{ cp: -cpAfter, mate: null, pv: [] }], depth: 18 };
  return classify(before, after, fenBefore, san, sans.length);
}

console.log("\ngambits are book, not inaccuracies:");
// 3.c3 hands over a pawn: a small win-chance loss the old ply<12 window caught.
let g = grade({ pgn: "e4 c5 d4 cxd4 c3", cpBest: 25, cpAfter: -40 });
check(g.cat === "book", `3.c3 Smith-Morra -> ${g.cat} (${g.opening})`);

// 6.Bc4, ply 10, a pawn down with compensation: 6.4% win chance behind the
// engine's choice. This is the case that used to read "Inaccuracy".
g = grade({ pgn: "e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4", cpBest: 10, cpAfter: -60 });
check(g.cat === "book", `6.Bc4 Smith-Morra, ${g.loss.toFixed(1)}% behind best -> ${g.cat}`);
check(g.opening.startsWith("B21 Sicilian Defense: Smith-Morra Gambit"),
  `  named "${g.opening}"`);

// Deep theory past the old 12-ply cutoff.
g = grade({ pgn: "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Rb1", cpBest: 40, cpAfter: 5 });
check(g.cat === "book", `15.Rb1 Gruenfeld (ply 14) -> ${g.cat} (${g.opening})`);

console.log("\nnamed but refuted lines are still graded on their merits:");
// The Damiano is in ECO, but 2...f6 just loses; the mover ends up well worse.
g = grade({ pgn: "e4 e5 Nf3 f6", cpBest: -20, cpAfter: -260 });
check(g.cat !== "book", `2...f6 Damiano -> ${g.cat} (still named "${g.opening}")`);
check(g.opening !== null, `  the name is reported anyway`);

console.log("\nshuffling back into a book position does not re-enter book:");
// 4.Ng1 leaves theory; 4...Nb8 transposes back to the position after 3...Bc5.
g = grade({ pgn: "e4 e5 Nf3 Nc6 Bc4 Bc5 Ng1 Nb8", cpBest: 30, cpAfter: 0 });
check(g.cat !== "book", `4...Nb8 after 4.Ng1 -> ${g.cat}`);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
