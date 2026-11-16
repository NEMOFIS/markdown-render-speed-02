// Where the time goes: render every practice case once and attribute CPU time
// to the phase that spent it. Run with --prof for a V8 tick profile instead.
//
//   node tools/profile.js            phase breakdown
//   node tools/profile.js --prof     raw V8 profile (then --prof-process)
import { readFileSync } from 'node:fs';
import { Lexer } from '../src/inline.js';
import { parseTokens } from '../src/parser.js';
import { Tokenizer, state } from '../src/lexer.js';

const KIT = '/opt/data/projects/makefun-tasks/live/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const md = cases.map((c) => c.markdown);

const opts = { gfm: true, breaks: false, pedantic: false };

// --- phase 1: block lexing only ---------------------------------------------
// The inline queue is drained separately, so block cost can be isolated.
let cpu = process.cpuUsage();
const lexers = [];
for (let i = 0; i < md.length; i++) {
  const lexer = new Lexer(opts);
  lexer.lex(md[i]);
  lexers.push(lexer);
}
const blockCpu = process.cpuUsage(cpu);

// --- phase 2: re-lex everything, then render --------------------------------
cpu = process.cpuUsage();
const trees = lexers.map((_, i) => {
  const l = new Lexer(opts);
  return l.lex(md[i]);
});
const fullCpu = process.cpuUsage(cpu);

cpu = process.cpuUsage();
for (let i = 0; i < trees.length; i++) {
  parseTokens(trees[i]);
}
const renderCpu = process.cpuUsage(cpu);

const ms = (u) => (u.user + u.system) / 1000;
console.log(`cases          : ${md.length}`);
console.log(`block+inline   : ${ms(blockCpu).toFixed(1)} ms  (lex only)`);
console.log(`lex (repeat)   : ${ms(fullCpu).toFixed(1)} ms`);
console.log(`render         : ${ms(renderCpu).toFixed(1)} ms`);
console.log(`lex share      : ${((ms(fullCpu) / (ms(fullCpu) + ms(renderCpu))) * 100).toFixed(1)}%`);
