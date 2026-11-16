# markdown-render-speed-02 — NEMOFIS

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/NEMOFIS/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/NEMOFIS/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A markdown renderer that must produce **byte-identical** HTML to `marked`, but faster.

The scoring harness compares every rendered document against the reference output
byte for byte. A single differing byte scores zero, so the interesting engineering
here is not "parse markdown" — it is "reproduce one specific implementation's exact
behaviour, including its quirks, without running its code".

## What it does

`parse.js` exports `parse(markdown) -> htmlString`.

It is a hand-written reimplementation of marked 18.1.3's lexer, tokenizer and
renderer, with marked's default options (`gfm: true`, `breaks: false`,
`pedantic: false`). The vendored copy under `vendor/marked/` is the reference
implementation, used only as an oracle during development — `parse.js` never
calls it.

The grammar is shared verbatim: byte-identical output is only achievable by
having exactly the same regular expressions, in the same order, with the same
state carried between them. The speed comes from never *running* a regex that
provably cannot match.

## Results

- Parity: **720/720** practice cases byte-identical.
- Speed: **~1.22x** versus marked on the same 720 cases, measured as CPU time in
  fresh processes (user + system), median of 7 alternating runs.

See `src/OPTIMIZATIONS.md` for every change, its measured effect, and an honest
account of what did not work.

## Layout

```
parse.js              public entry: parse(markdown) -> html
main.ts               batch driver: cases.json -> html.json
src/grammar.js        all block/inline rules, shared, compiled once
src/lexer.js          block tokenizer + lexer (the hot path)
src/inline.js         inline dispatch loop, masking, block loop
src/parser.js         token -> HTML renderer
src/helpers.js        delimiter scanning, cell splitting, label normalising
vendor/marked/        reference implementation (oracle only, MIT)
tools/parity.js       byte-compare against the reference output
tools/bench.js        CPU time vs marked, fresh processes, median
tools/reduce.js       shrinks a failing case to a minimal reproduction
tools/profile.js      phase attribution: lex vs render
```

## How to run

Render a directory of cases:

```sh
MAKEFUN_INPUT_DIR=./in MAKEFUN_OUTPUT_DIR=./out node main.ts
```

`cases.json` must be an array of `{ id, markdown }`. The output `html.json` is an
array of HTML strings, in the same order.

Check parity against the reference set:

```sh
node tools/parity.js
```

Benchmark against marked:

```sh
node tools/bench.js --runs 9
```

Shrink a failing case to a minimal reproduction:

```sh
node tools/reduce.js <caseIndex>
```

## Requirements

Node 22 or newer. No dependencies beyond the vendored `marked` tree, which is
present for reference and for the parity/bench tools only.

`main.ts` uses type-stripping, so it runs under plain `node`. If your Node
rejects the `.ts` extension directly, run it through `tsx` or compile it first —
`parse.js` itself is plain ESM and has no such requirement.

## Licence

`vendor/marked/` is MIT licensed; see `vendor/marked/LICENSE` and
`vendor/marked/NOTICE`. Everything outside `vendor/` is original work.
