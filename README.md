# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/NEMOFIS/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/NEMOFIS/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A markdown renderer that produces HTML byte-identical to marked 18.1.3 while using less CPU time per set.

`parse.js` is a drop-in for marked's own `parse`: same input, same bytes out, fewer wasted passes.
It vendors marked 18.1.3 and adds 14 `charCode` guards that skip a regex only where that regex
provably cannot match. `src/OPTIMIZATIONS.md` lists every guard, plus the three further
optimizations that were measured and rejected for being slower than the regex they replaced.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

`main.ts` reads `cases.json` (an array of `{id, markdown}`) from `MAKEFUN_INPUT_DIR` — `/input`
when unset — and writes `html.json` (an array of HTML strings, in the cases' order) to
`MAKEFUN_OUTPUT_DIR`, `/output` when unset.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
