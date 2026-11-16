// The harness runs `node /bot/main.ts` on Node 22. It reads every case from /input/cases.json,
// renders each one alone through parse() from parse.js, and writes /output/html.json: the HTML
// strings, one per case, in the cases' order. Outside a container MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Case = { id: string; markdown: string };

const cases: Case[] = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8'));
const html: string[] = Array.from({ length: cases.length }, (_, i) => parse(cases[i].markdown));
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
