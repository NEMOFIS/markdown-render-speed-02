// Character-level diff for the rules that still differ from the vendored build.
// Prints the first difference with surrounding context so the fix is obvious.
import { Lexer as MarkedLexer } from '../vendor/marked/marked.esm.js';
import { inlineGfm, inlineNormal, blockGfm, blockNormal, other } from '../src/grammar.js';

const gfm = new MarkedLexer({ gfm: true, breaks: false, pedantic: false }).tokenizer.rules;
const norm = new MarkedLexer({ gfm: false, breaks: false, pedantic: false }).tokenizer.rules;

const rows = [];
for (const key of Object.keys(gfm.inline)) rows.push([`inline.gfm.${key}`, inlineGfm[key], gfm.inline[key]]);
for (const key of Object.keys(norm.inline)) rows.push([`inline.normal.${key}`, inlineNormal[key], norm.inline[key]]);
for (const key of Object.keys(gfm.block)) rows.push([`block.gfm.${key}`, blockGfm[key], gfm.block[key]]);
for (const key of Object.keys(norm.block)) rows.push([`block.normal.${key}`, blockNormal[key], norm.block[key]]);
const o = { ...norm.other, ...gfm.other };
for (const key of Object.keys(o)) rows.push([`other.${key}`, other[key], o[key]]);

const src = (r) => (r && r.source ? r.source : '(none)');

for (const [label, mine, theirs] of rows) {
  const a = src(mine);
  const b = src(theirs);
  if (a === b) continue;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log(`\n### ${label}  (differs at ${i})`);
  console.log(`  marked: ...${JSON.stringify(b.slice(Math.max(0, i - 45), i + 45))}`);
  console.log(`  ours  : ...${JSON.stringify(a.slice(Math.max(0, i - 45), i + 45))}`);
  if (a.length !== b.length) console.log(`  length: marked=${b.length} ours=${a.length}`);
}
