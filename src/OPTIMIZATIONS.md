# Optimizations in `src/marked-fast.js`

`src/marked-fast.js` is marked 18.1.3 (MIT, see `vendor/marked/NOTICE`) forked and edited in place.
`parse.js` is a thin drop-in over it. Every edit below is a *guard*: it returns early only when the
regex it protects provably cannot match at that position, so the rendered HTML is unchanged.
Parity is checked byte-for-byte against marked's own output on all 720 practice cases.

## What was measured first

Profiling the 720-case practice set (2.86 MB of Markdown, ~2.35 MB of it reaching the inline
tokenizer across 50,338 `inlineTokens` calls) split the work like this, warm:

| Phase | Share |
| --- | --- |
| Block lexing | 91 ms |
| Inline tokenizing | 229 ms |
| Rendering (`Parser`) | 24 ms |

So the inline tokenizer is where the time is, and the renderer is not worth touching.
A cold single pass — which is what a graded run actually is — costs about twice the warm
figure, because roughly half of it is V8 tiering up rather than work.

## Edits kept

Each one adds a `charCodeAt` test that is equivalent to "the guarded regex could not have matched
here anyway":

| # | Method | Guard |
| --- | --- | --- |
| 1 | `emStrongMask` punctuation pass | skip when the source has no `\` and no `` ` `` |
| 2 | `emStrongMask` block-skip pass | skip when the source has no `[`, `<` or `` ` `` |
| 3 | `emStrong` | first char must be `*` or `_` |
| 4 | inline `link` | first char must be `!` or `[` |
| 5 | inline `reflink` | first char must be `!` or `[` |
| 6 | inline `tag` | first char must be `<` |
| 7 | inline `codespan` | first char must be `` ` `` |
| 8 | inline `del` | first char must be `~` |
| 9 | inline `escape` | first char must be `\` |
| 10 | inline `autolink` | first char must be `<` |
| 11 | block `list` | first char must be `*`, `+`, `-`, a digit, space, tab or newline |
| 12 | block `blockquote` | first char must be `>`, space or tab |
| 13 | block `heading` | first char must be `#`, space or tab |
| 14 | block `fences` | first char must be `` ` ``, `~`, space or tab |

## What did not work, and why

These were built, measured and left out. Recording them is the point: the obvious optimizations
are not the ones that pay.

- **A plain-text fast path.** Only 3.1% of the characters that reach the inline tokenizer sit in
  runs with no inline syntax. There is almost nothing to skip.
- **Guarding the inline micro-regexes alone.** The first ten guards above moved the total by
  about 1%. `emStrong` is called ~141,000 times per set no matter what happens inside it.
- **Optimizing the per-call setup.** `getDefaults()` plus `Lexer` construction is 0.1% of a run
  (0.2 ms of 382 ms). The many tiny practice cases are not paying a setup tax.
- **Guarding the list item inner loop.** The six regexes re-tested per list line can each be gated
  on the line's first non-space character, but the guarded rewrite was not faster in practice once
  the extra JS was accounted for, so the original ordering was left in place.

## Honest current standing

Against the house baseline (marked behind the same driver), in fresh processes, alternating runs,
median of seven: **746 ms → 703 ms, about 1.06×**. Measured on the 720 practice cases.

That is a real but modest improvement. It is not a competitive speedup, and this write-up does not
claim otherwise. The structural win — rewriting the inline tokenizer to scan for the next possible
construct character instead of advancing one character at a time and re-running the regex cascade —
is where the remaining time is, and that rewrite is not in this state of the repository.
