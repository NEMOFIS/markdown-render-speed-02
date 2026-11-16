// Minimise a failing case by deleting lines while the failure survives.
//
// The practice set contains very large real-world documents, so a divergence
// reported at byte 100000 says nothing about which construct causes it. This
// reduces a case to the smallest block of lines that still differs.
//
//   node tools/reduce.js <caseIndex>
import { readFileSync } from 'node:fs';
import { parse } from '../parse.js';
import { marked } from '../vendor/marked/marked.esm.js';

const KIT = '/opt/data/projects/makefun-tasks/live/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));

const idx = Number(process.argv[2] ?? '692');

// Compare against marked on the *current* text rather than the full expected
// document, so a reduction that changes the document is still detected.
function stillFails(text) {
  try {
    return parse(text) !== marked.parse(text);
  } catch {
    return true;
  }
}

let lines = cases[idx].markdown.split('\n');
if (!stillFails(lines.join('\n'))) {
  console.log('case does not fail in isolation');
  process.exit(1);
}

// greedy line removal, repeated until nothing more can go
let changed = true;
let pass = 0;
while (changed && lines.length > 1) {
  changed = false;
  pass++;
  const chunk = Math.max(1, Math.floor(lines.length / 8));
  for (let size = chunk; size >= 1; size = Math.floor(size / 2)) {
    for (let i = 0; i + size <= lines.length; i++) {
      const candidate = [...lines.slice(0, i), ...lines.slice(i + size)];
      if (candidate.length && stillFails(candidate.join('\n'))) {
        lines = candidate;
        changed = true;
        break;
      }
    }
    if (changed) break;
  }
}

console.log(`case ${idx}: reduced to ${lines.length} lines (pass ${pass})`);
console.log(JSON.stringify(lines.join('\n')));
const g = parse(lines.join('\n'));
const want = marked.parse(lines.join('\n'));
let k = 0;
while (k < g.length && k < want.length && g[k] === want[k]) k++;
console.log('got :', JSON.stringify(g.slice(Math.max(0, k - 60), k + 80)));
console.log('want:', JSON.stringify(want.slice(Math.max(0, k - 60), k + 80)));
