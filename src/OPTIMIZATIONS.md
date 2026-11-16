# Optimizations

Every change below was made against the same 720 practice cases (2.86 MB of
markdown) and validated with `node tools/parity.js` (720/720 byte-identical)
before being kept. Timings are CPU time (user + system) from **fresh node
processes**, median of alternating runs, never two libraries in one process.

The premise: byte-identical output requires marked's exact grammar. So the
grammar is shared verbatim and the work went into **not executing rules that
provably cannot match**.

---

## 1. First-character guards on the block tokenizer

`listOuter` is called once per block position — the hottest entry in the lexer.
It ran `rules.list.exec(src)` and then `rules.hr.test(src)` on every call,
including prose paragraphs where neither can match.

A list item is up to three spaces followed by `*`, `-`, `+` or a digit. One
`charCodeAt` scan decides whether the two regexes are worth running at all.

Measured: `listOuter` invocations dropped from **22,475 to 2,711** over the
practice set, with the hit rate rising from 8.6% to 71.9% — i.e. the guard
removed the ~20,000 calls that could never have matched. Combined with the
changes below this accounted for most of the early gain.

## 2. First-character guards inside the list continuation loop

The loop that decides whether a line continues the current list item ran five
anchored regexes per line (`fencesBegin`, `headingBegin`, `htmlBegin`,
`blockquoteBegin`, `hr`). These are all anchored on a specific leading character,
so a single scan of the line's first non-space character selects the one (or
none) that can match.

The first version of this used `String.prototype.search(/\S/)` to find that
character and measured **slower** than running the regexes — `search` sets up a
match for every line, and cost more than the tests it skipped. Replacing it with
a plain `charCodeAt` scan is what made the guard pay.

## 3. `split('\n', 1)[0]` → `indexOf` + `slice`

The list loop extracted the current line with `src.split('\n', 1)[0]`, which
allocates an array and a substring **per line of every list item**. Replaced with
`indexOf('\n')` and a `slice`, allocating one string instead of two objects.

Measured: this was the single largest step, taking the whole suite from ~1.02x to
~1.11x in the reading immediately after the change.

## 4. Skip tab expansion on lines with no tab

Two `String.replace` calls with callbacks ran on every line to expand tabs to tab
stops. `replace` with a callback allocates a match array and a result string even
when nothing matches. An `indexOf('\t') === -1` test in front skips both for the
overwhelming majority of lines.

## 5. `\S` → `firstNonSpace()` helper

Three call sites used `line.search(/\S/)`. Replaced with a hand-written scan over
code units checking the six whitespace characters `\S` excludes. Same result, no
regex machinery.

## 6. Lazy closer scanning in `emStrong`

`emStrong` needs to know the last position a delimiter could close at. The
original computed this up front for `*`, `_` and `~` on every pass.

Two changes: (a) the scan is now performed for **only the delimiter being
opened**, not all three; (b) it is cached in a single slot keyed on
`(maskedSrc, src, delim)` rather than recomputed per open attempt.

The cache was originally a `Map` keyed on a string built from the two lengths.
That hashed the whole paragraph on every lookup and measured slower than the scan
it was meant to avoid, so it is now a plain slot with identity comparison.

## 7. Gate the mask on content it can actually change

`maskSrc` runs two global replaces over the paragraph. Each was gated already,
but both produced a copy regardless. A single test for the characters either step
can act on (`\`, `` ` ``, `[`, `<`) returns the source untouched otherwise — and
most emphasis runs contain none of them.

## 8. Hoisted tokenizer methods in the inline dispatch

The inline loop calls up to 11 tokenizer methods per character position via
`T.method(...)`. Hoisted to locals and invoked with `.call(T, ...)`, removing the
property load from the inner loop.

Measured: ~1.04x → ~1.06x.

## 9. Correctness fixes found while measuring

These are not speed work, but each was required for parity and several of them
were only discovered because the benchmark pushed enough documents through to
expose them:

- `cachedIndent` must clamp the cache key to 3 (`indent - 1`, capped). Without
  the clamp a marker indented past the limit was treated as a new list item
  instead of a continuation.
- `state.carriageReturn` normalisation was missing from `lex()` entirely, so a
  `#` heading terminated by CRLF was not recognised as a heading.
- The blockquote marker-whitespace expansion was running over the **whole
  document** up front, which also rewrote a `> \t` sitting inside a fenced code
  block. It now happens only inside `blockquote()`.
- `anyPunctuationOutsideCode` must run even when no backslash is present: its
  code-span branch masks the backticks **inside** a span, and skipping that let
  emphasis close in the middle of a code span.
- `lastCharLength` must be measured in code points (`[...match[0]][0].length`),
  not `charAt(0).length`. With an astral first character the latter slices
  through a surrogate pair and emits a replacement character.
- `urlStart` must accept any alphanumeric as the start of a bare email address,
  not just `h`/`f`/`m`/`w`/`x`.
- Image alt text renders through the text rules only, not the inline renderer.

---

## What did not work

Honest list, including things that looked obviously right and were not:

- **`Function.prototype.bind` instead of `.call`.** Hoisting the 11 tokenizer
  methods and binding them per pass should beat `.call`, since it removes the
  arguments spreading. It measured *slower* (~1.048x vs ~1.06x): 11 bound
  closures are allocated on every inline pass, and there are ~50,000 of them.
  Reverted to `.call`.

- **A `Map`-based closer-hints cache.** Keying on `maskedSrc.length + ':' +
  src.length` meant hashing the whole paragraph string on every lookup. The scan
  it replaced is a single linear pass with three compares per character. The
  cache lost. Replaced with a single-slot identity check.

- **A fast path in `inlineText` for runs with no boundary characters.** The idea
  was to scan for any character the text rule stops at, and return the whole
  string as one token without invoking the regex. The scan answered "no" 72,000
  times and "yes" rarely, so it paid an O(n) loop *and* then ran the regex — the
  regex at 8.6% self time versus the fast path's 3.0% overhead plus the regex
  still running. Removed entirely; the plain regex call measured faster.

- **First-character guard on the list continuation branch using `search`.**
  Measured slower than the four regexes it skipped. Fixed by scanning code units
  instead of using `search`, but the `search` version itself was a regression.

- **Guarding `scanCloserHints` behind "does this run contain a marker".** The
  guard already existed at the `inlineInner` level and the scan is needed by
  every run that reaches `emStrong`, so this added a test without removing work.

- **Profiling by timing one library after the other in one process.** The first
  one touched gets optimized by V8 and wins unfairly. All numbers here come from
  fresh processes, and the early in-process measurements were discarded as
  unreliable because they disagreed with the fresh-process ones by more than the
  effect being measured.

- **Reading the remaining variance as an effect.** Repeated runs of the same
  build varied between 1.02x and 1.13x depending on machine load. Numbers below
  about 5% are not distinguishable from noise here, which is why the reported
  figure is a median of 9 alternating runs rather than the best observed run.
