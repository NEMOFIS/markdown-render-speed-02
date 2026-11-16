// make.fun — markdown-render-speed-02
// Hand-written markdown renderer, byte-identical to marked's default output.
//
// Options are pinned to the same shape `marked.parse()` uses by default:
// gfm on, breaks off, pedantic off, smartypants off. With no hooks and no
// async extensions present, the synchronous path is the one marked itself
// takes for these inputs.
import { Lexer } from './inline.js';
import { state } from './lexer.js';
import { parseTokens } from './parser.js';

const DEFAULTS = {
  gfm: true,
  breaks: false,
  pedantic: false,
};

export function render(markdown, options) {
  const opts = options ? { ...DEFAULTS, ...options } : DEFAULTS;
  // The lexer keeps module-level state (link depth, raw-block depth, the top
  // flag). Resetting it here makes every render independent, so one document
  // can never inherit another's flags.
  state.inLink = false;
  state.inRawBlock = false;
  state.top = true;
  state.linkParenPossible = true;
  state.linkEmitted = false;
  state.indentMarkers = 0;
  state.tabMarkerIndent = false;

  const lexer = new Lexer(opts);
  return parseTokens(lexer.lex(markdown));
}

export { Lexer };
