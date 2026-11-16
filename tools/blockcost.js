// Block-rule cost map: time every block rule against the whole practice set
// with the exact arguments the lexer passes it, so the expensive ones stand out
// from the ones that merely get called often.
//
//   node tools/blockcost.js
import { readFileSync } from 'node:fs';
import { blockGfm } from '../src/grammar.js';

const KIT = '/opt/data/projects/makefun-tasks/live/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const md = cases.map((c) => c.markdown);

// Every rule is retried at each block boundary, so measure a full sweep of all
// remaining source per rule rather than one call per document.
const ORDER = ['space', 'code', 'fences', 'heading', 'hr', 'blockquote', 'list',
  'html', 'def', 'table', 'lheading', 'paragraph', 'text'];

const results = [];
for (const name of ORDER) {
  const re = blockGfm[name];
  if (!re || typeof re.exec !== 'function' || !re.source) continue;
  let calls = 0;
  let hits = 0;
  // warm
  for (let i = 0; i < md.length; i += 37) re.exec(md[i]);
  const t = process.cpuUsage();
  for (let i = 0; i < md.length; i++) {
    const src = md[i];
    // sweep the source the way the lexer does, but without feeding results on
    let pos = 0;
    let guard = 0;
    while (pos < src.length && guard++ < 40) {
      const sub = src.slice(pos);
      calls++;
      const m = re.exec(sub);
      if (!m || m[0].length === 0) break;
      hits++;
      pos += m[0].length;
    }
  }
  const d = process.cpuUsage(t);
  results.push([name, calls, hits, (d.user + d.system) / 1000]);
}

results.sort((a, b) => b[3] - a[3]);
console.log('rule'.padEnd(12), 'calls'.padStart(8), 'hits'.padStart(8), 'cpu ms'.padStart(9));
for (const [n, c, h, ms] of results) {
  console.log(n.padEnd(12), String(c).padStart(8), String(h).padStart(8), ms.toFixed(1).padStart(9));
}
