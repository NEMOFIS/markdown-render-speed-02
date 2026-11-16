// Parity gate: render every practice case and compare byte-for-byte with the
// kit's expected.json. Prints the match count; exits non-zero on any mismatch.
//
//   node tools/parity.js [--show N] [--file cases.json] [--expected expected.json]
import { readFileSync } from 'node:fs';
import { parse } from '../parse.js';

const KIT = '/opt/data/projects/makefun-tasks/live/markdown-render-speed-02-kit/practice';
const args = process.argv.slice(2);

function opt(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

const show = Number(opt('--show', '3'));
const casesPath = opt('--file', `${KIT}/input/cases.json`);
const expectedPath = opt('--expected', `${KIT}/reference/expected.json`);

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const expectedCases = expected.cases ?? expected;

if (!Array.isArray(cases) || !Array.isArray(expectedCases)) {
  console.error('bad input: cases/expected are not arrays');
  process.exit(2);
}
if (cases.length !== expectedCases.length) {
  console.error(`count mismatch: cases=${cases.length} expected=${expectedCases.length}`);
}

let match = 0;
let firstBad = -1;
let shown = 0;

for (let i = 0; i < cases.length; i++) {
  const got = parse(cases[i].markdown);
  const want = expectedCases[i].html;
  if (got === want) {
    match++;
  } else {
    if (firstBad === -1) firstBad = i;
    if (shown < show) {
      shown++;
      const a = got ?? '';
      const b = want ?? '';
      let d = 0;
      while (d < a.length && d < b.length && a[d] === b[d]) d++;
      console.log(`--- mismatch case ${i} (id=${cases[i].id}) at byte ${d}`);
      console.log(`  want: ${JSON.stringify(b.slice(Math.max(0, d - 40), d + 60))}`);
      console.log(`  got : ${JSON.stringify(a.slice(Math.max(0, d - 40), d + 60))}`);
    }
  }
}

console.log(`PARITY ${match}/${cases.length}`);
if (match !== cases.length) {
  console.log(`first mismatch index: ${firstBad}`);
  process.exit(1);
}
