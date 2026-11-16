// make.fun — markdown-render-speed-02 entry point.
//
// Reads cases.json (an array of {id, markdown}) from INPUT_DIR, renders each
// case with parse(), and writes the resulting array of HTML strings to
// html.json inside OUTPUT_DIR.
//
// Written as plain ESM so it runs under `node main.ts` (Node 22 strips types)
// with no build step and no dependencies beyond the vendor tree.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

interface Case {
  id: string | number;
  markdown: string;
}

function main(): void {
  const raw = readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8');
  const cases = JSON.parse(raw) as Case[];

  const out: string[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    out[i] = parse(cases[i].markdown);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(out));
}

main();
