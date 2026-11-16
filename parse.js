/**
 * parse(markdown): the HTML marked 18.1.3 renders with its default options.
 *
 * src/marked-fast.js is marked 18.1.3 (MIT, see vendor/marked/NOTICE) with the inline
 * tokenizer's punctuation-mask passes gated on the characters they can actually react to.
 * Output is byte-identical; the guard removes two full-length regex replaces whenever the
 * source contains none of ` \ [ < — see src/OPTIMIZATIONS.md.
 */
import { marked } from './src/marked-fast.js';

const render = marked.parse;

/** The HTML marked renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  return render(markdown);
}
