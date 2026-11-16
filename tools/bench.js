// CPU-time bench runner. One implementation per FRESH node process, so V8 never
// optimizes one library before the other is touched. Reports median of N runs.
//
//   node tools/bench.js [--runs 5] [--reps 1] [--impl ours|baseline] [--json]
//
// Child mode (internal): BENCH_IMPL picks the implementation.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const KIT = '/opt/data/projects/makefun-tasks/live/markdown-render-speed-02-kit';
const CASES = `${KIT}/practice/input/cases.json`;

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}
const has = (n) => args.includes(n);

// ---- child mode: measure one implementation, print one number ---------------
if (process.env.BENCH_IMPL) {
  const which = process.env.BENCH_IMPL;
  const reps = Number(process.env.BENCH_REPS ?? '1');
  const parse =
    which === 'baseline'
      ? (await import(`${KIT}/baselines/parse.js`)).parse
      : (await import(join(ROOT, 'parse.js'))).parse;

  const cases = JSON.parse(readFileSync(CASES, 'utf8'));
  const md = cases.map((c) => c.markdown);

  // warm one full pass (JIT + caches) inside this process, then measure
  for (let i = 0; i < md.length; i++) parse(md[i]);

  let cpu = 0;
  for (let r = 0; r < reps; r++) {
    const u0 = process.cpuUsage();
    for (let i = 0; i < md.length; i++) parse(md[i]);
    const u = process.cpuUsage(u0);
    cpu += (u.user + u.system) / 1000;
  }
  console.log((cpu / reps).toFixed(1));
  process.exit(0);
}

// ---- parent mode -----------------------------------------------------------
const runs = Number(opt('--runs', '5'));
const reps = Number(opt('--reps', '1'));

function measure(impl) {
  const out = execFileSync(
    process.execPath,
    [join(HERE, 'bench.js')],
    {
      env: { ...process.env, BENCH_IMPL: impl, BENCH_REPS: String(reps) },
      encoding: 'utf8',
    },
  );
  return Number(out.trim());
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const ours = [];
const base = [];
for (let r = 0; r < runs; r++) {
  // alternate the order each round so drift hits both sides evenly
  if (r % 2 === 0) {
    ours.push(measure('ours'));
    base.push(measure('baseline'));
  } else {
    base.push(measure('baseline'));
    ours.push(measure('ours'));
  }
  process.stderr.write(`run ${r + 1}/${runs}: ours=${ours.at(-1) ?? ours[0]}ms`);
  process.stderr.write(` baseline=${base.at(-1) ?? base[0]}ms\n`);
}

const mo = median(ours);
const mb = median(base);
const result = {
  runs,
  reps,
  ours_ms: mo,
  baseline_ms: mb,
  speedup: mb / mo,
  ours_all: ours,
  baseline_all: base,
};

if (has('--json')) {
  console.log(JSON.stringify(result));
} else {
  console.log(`ours median     : ${mo.toFixed(1)} ms  (${ours.join(', ')})`);
  console.log(`baseline median : ${mb.toFixed(1)} ms  (${base.join(', ')})`);
  console.log(`speedup         : ${(mb / mo).toFixed(3)}x`);
}
