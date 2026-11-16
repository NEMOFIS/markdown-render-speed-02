// Rule-parity harness: compile the grammar the same way marked does and compare
// every rule's source string against the vendored build's own compiled regexes.
//
// This is the check that makes hand-writing the grammar safe: if a rule source
// drifts by one character the assertion fails loudly instead of silently
// changing output on some rare input.
//
//   node tools/rule-parity.js
import { marked, Lexer as MarkedLexer } from '../vendor/marked/marked.esm.js';
import { inlineGfm, inlineNormal, blockGfm, blockNormal, other } from '../src/grammar.js';

const markedGfm = new MarkedLexer({ gfm: true, breaks: false, pedantic: false });
const markedNorm = new MarkedLexer({ gfm: false, breaks: false, pedantic: false });

function src(re) {
  return re && re.source ? re.source : '(none)';
}

let fails = 0;
let checks = 0;

function compare(label, mine, theirs) {
  checks++;
  if (src(mine) === src(theirs)) {
    return;
  }
  fails++;
  console.log(`MISMATCH ${label}`);
  console.log(`  marked : ${src(theirs)}`);
  console.log(`  ours   : ${src(mine)}`);
}

// --- inline rules ------------------------------------------------------------
const theirsInlineGfm = markedGfm.tokenizer.rules.inline;
const theirsInlineNorm = markedNorm.tokenizer.rules.inline;
for (const key of Object.keys(theirsInlineGfm)) {
  compare(`inline.gfm.${key}`, inlineGfm[key], theirsInlineGfm[key]);
}
for (const key of Object.keys(theirsInlineNorm)) {
  compare(`inline.normal.${key}`, inlineNormal[key], theirsInlineNorm[key]);
}

// --- block rules -------------------------------------------------------------
const theirsBlockGfm = markedGfm.tokenizer.rules.block;
const theirsBlockNorm = markedNorm.tokenizer.rules.block;
for (const key of Object.keys(theirsBlockGfm)) {
  compare(`block.gfm.${key}`, blockGfm[key], theirsBlockGfm[key]);
}
for (const key of Object.keys(theirsBlockNorm)) {
  compare(`block.normal.${key}`, blockNormal[key], theirsBlockNorm[key]);
}

// --- other rules -------------------------------------------------------------
const theirsOther = { ...markedNorm.tokenizer.rules.other, ...markedGfm.tokenizer.rules.other };
for (const key of Object.keys(theirsOther)) {
  compare(`other.${key}`, other[key], theirsOther[key]);
}

console.log(`\nRULE PARITY ${checks - fails}/${checks}`);
if (fails) {
  console.log(`${fails} rule(s) differ`);
  process.exit(1);
}
