// Per-rule call counter for the inline tokenizer.
//
// Wraps each hot rule so that a run over the practice set reports how many times
// each one is actually invoked and how much CPU it consumed. A rule called tens
// of thousands of times with a near-zero hit rate is a guard candidate; one that
// rarely fires is not worth guarding.
//
//   node tools/counters.js
import { readFileSync } from 'node:fs';
import { Lexer } from '../src/inline.js';

const KIT = '/opt/data/projects/makefun-tasks/live/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const md = cases.map((c) => c.markdown);

const opts = { gfm: true, breaks: false, pedantic: false };

const stats = Object.create(null);
function wrap(obj, name) {
  const fn = obj[name];
  if (typeof fn !== 'function') return;
  stats[name] = { calls: 0, hits: 0, cpu: 0 };
  obj[name] = function (...args) {
    const s = stats[name];
    s.calls++;
    const t = process.cpuUsage();
    const out = fn.apply(this, args);
    const d = process.cpuUsage(t);
    s.cpu += (d.user + d.system);
    if (out !== undefined && out !== null) s.hits++;
    return out;
  };
}

// instrument the tokenizer prototype, so every Lexer built afterwards reports
const proto = Object.getPrototypeOf(new Lexer(opts).tokenizer);
for (const name of [
  'escape', 'tag', 'link', 'reflink', 'emStrong', 'codespan', 'br', 'del',
  'autolink', 'url', 'inlineText',
  'space', 'code', 'fences', 'heading', 'hr', 'blockquote', 'list', 'html',
  'def', 'table', 'lheading', 'paragraph', 'text',
]) {
  wrap(proto, name);
}

const t0 = process.cpuUsage();
for (let i = 0; i < md.length; i++) {
  new Lexer(opts).lex(md[i]);
}
const total = process.cpuUsage(t0);
const totalMs = (total.user + total.system) / 1000;

const rows = Object.entries(stats).sort((a, b) => b[1].cpu - a[1].cpu);
console.log(`total ${totalMs.toFixed(1)} ms over ${md.length} cases\n`);
console.log('rule'.padEnd(12), 'calls'.padStart(9), 'hits'.padStart(9), 'hit%'.padStart(7), 'cpu ms'.padStart(9), 'ms/call'.padStart(9));
for (const [name, s] of rows) {
  const cpuMs = s.cpu / 1000;
  console.log(
    name.padEnd(12),
    String(s.calls).padStart(9),
    String(s.hits).padStart(9),
    ((s.hits / s.calls) * 100).toFixed(1).padStart(7),
    cpuMs.toFixed(1).padStart(9),
    (cpuMs / s.calls * 1000).toFixed(2).padStart(9),
  );
}
