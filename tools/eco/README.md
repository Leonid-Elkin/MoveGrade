# ECO opening data

`a.tsv`–`e.tsv` are taken verbatim from
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
(CC0-1.0, public domain). Each row is an ECO code, an opening name, and the
mainline PGN that reaches it.

`node tools/build-book.mjs` replays every line and writes `overlay/book.js`.
