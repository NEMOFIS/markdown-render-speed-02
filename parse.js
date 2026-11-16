// make.fun — markdown-render-speed-02
// parse(markdown) -> HTML string, byte-identical to marked's default output.
//
// The renderer is our own trimmed fork (src/marked-fast.js). This file is the
// public entry point the harness imports.
import { render } from './src/marked-fast.js';

/**
 * Render one markdown document to HTML.
 * @param {string} markdown
 * @returns {string}
 */
export function parse(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('parse() expects a string');
  }
  return render(markdown);
}

export default parse;
