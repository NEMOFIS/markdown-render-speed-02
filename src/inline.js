// make.fun — markdown-render-speed-02
// The lexer driver: queued inline passes, the block loop, the inline dispatch
// loop, and the mask that keeps em/strong from seeing delimiters inside links.
import { inlineGfm, inlineNormal, other } from './grammar.js';
import { Tokenizer, state, hintStack } from './lexer.js';
import { normalizeLabel, scanCloserHints, expandTabs } from './helpers.js';

// The blockquote marker-whitespace rule anchored to the start of a line, so a
// `> \t` sitting inside a fenced code block is never rewritten.
const LINE_START_MARKER_WS = new RegExp(`^${other.blockquoteMarkerWhitespace.source}`, 'gm');

export class Lexer {
  constructor(options) {
    this.options = options;
    this.rules = options.pedantic ? inlineNormal : inlineGfm;
    this.tokenizer = new Tokenizer(options);
    this.tokenizer.lexer = this;
    this.tokens = [];
    this.tokens.links = Object.create(null);
    this.inlineQueue = [];
    this.state = state;
  }

  /** Queue an inline run; the pass body fills its tokens later. */
  inline(src, tokens = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }

  lex(srcIn) {
    // CRLF is normalised before anything else, so every rule below can assume
    // it sees bare newlines. Without this a `#` heading line terminated by \r\n
    // keeps its carriage return and is not recognised as a heading.
    let src = srcIn.replace(other.carriageReturn, '\n');
    if (this.options.pedantic) {
      src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
    }
    // No other rewriting happens here: blockquote marker whitespace is expanded
    // inside blockquote() only, on the lines it actually treats as content.
    // Doing it up front would also expand a `> \t` sitting inside a fenced code
    // block, which must stay literal.
    return this.lexNormal(src);
  }

  lexNormal(src) {
    this.blockTokens(src, this.tokens);

    const queue = this.inlineQueue;
    for (let i = 0; i < queue.length; i++) {
      // an inline <pre>/<code>/<kbd>/<script> left open ends with its block
      state.inRawBlock = false;
      this.inlineTokens(queue[i].src, queue[i].tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }

  blockTokens(src, tokens = [], lastParagraphClipped = false) {
    if (this.options.pedantic) {
      src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
    }
    const T = this.tokenizer;
    const links = this.tokens.links;

    let srcLength = Infinity;

    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        break; // the source stopped shrinking: no endless loop
      }

      let token;

      // 1. blank line
      if ((token = T.space(src))) {
        src = src.substring(token.raw.length);
        const lastToken = tokens[tokens.length - 1];
        if (token.raw.length === 1 && lastToken !== undefined) {
          // a lone blank line terminates the previous line
          lastToken.raw += '\n';
        } else {
          tokens.push(token);
        }
        continue;
      }

      // 2. indented code; it cannot interrupt a paragraph
      if ((token = T.code(src))) {
        src = src.substring(token.raw.length);
        const lastToken = tokens[tokens.length - 1];
        if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      // 3. fences
      if ((token = T.fences(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 4. heading
      if ((token = T.heading(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 5. hr
      if ((token = T.hr(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 6. blockquote
      if ((token = T.blockquote(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 7. list
      if ((token = T.list(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 8. html block
      if ((token = T.html(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 9. link reference definition
      if ((token = T.def(src))) {
        src = src.substring(token.raw.length);
        const lastToken = tokens[tokens.length - 1];
        if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.raw;
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          // first definition of a label wins; a later one still consumes its text
          if (!links[token.tag]) {
            links[token.tag] = { href: token.href, title: token.title };
          }
          tokens.push(token);
        }
        continue;
      }

      // 10. gfm table
      if ((token = T.table(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 11. setext heading
      if ((token = T.lheading(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // 12. top-level paragraph
      if (state.top && (token = T.paragraph(src))) {
        const lastToken = tokens[tokens.length - 1];
        if (lastParagraphClipped && lastToken?.type === 'paragraph') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        lastParagraphClipped = false;
        src = src.substring(token.raw.length);
        continue;
      }

      // 13. plain text
      if ((token = T.text(src))) {
        src = src.substring(token.raw.length);
        const lastToken = tokens[tokens.length - 1];
        if (lastToken?.type === 'text') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      break;
    }

    // Restore the top flag: a list item lexes its own content with top off, and
    // without this reset every block after a list would be treated as nested,
    // which changes when a paragraph is recognised.
    state.top = true;

    return tokens;
  }

  inlineTokens(src, tokens = []) {
    this.tokenizer.lexer = this;
    // ')' absent for the whole run means the link rule cannot match, which
    // also keeps its backtracking off unterminated-link inputs
    const prevLinkParenPossible = state.linkParenPossible;
    state.linkParenPossible = prevLinkParenPossible && src.includes(')');
    try {
      return this.inlineInner(src, tokens);
    } finally {
      state.linkParenPossible = prevLinkParenPossible;
    }
  }

  inlineInner(src, tokens) {
    // The mask and the closer scan are only read by em/strong/del, all of which
    // need a `*`, `_` or `~` to start. A run without one reaches the text rule
    // untouched, so both steps are skipped entirely — and most runs are prose.
    let maskedSrc = src;
    let frame = null;

    if (src.indexOf('*') !== -1 || src.indexOf('_') !== -1 || src.indexOf('~') !== -1) {
      maskedSrc = this.maskSrc(src);
      // The frame is keyed on the masked source it describes: a nested pass
      // (link label, list item) masks its own, shorter source, and reusing the
      // enclosing frame's hints would let an opener close past its own text.
      frame = makeCloserFrame(maskedSrc, src);
      hintStack.push(frame);
    } else {
      hintStack.push(NO_MARKERS);
    }

    try {
      return this.tokenizeInlines(src, maskedSrc, tokens);
    } finally {
      hintStack.pop();
    }
  }

  maskSrc(src) {
    let maskedSrc = src;
    const rules = this.rules;

    // Mask reflinks so a bracketed reference is not read as emphasis. Only a
    // run that contains both a bracket and a known reference can need this.
    if (this.tokens.links && src.indexOf('[') !== -1) {
      const links = this.tokens.links;
      const maskReflink = (match0) => {
        const refStart = match0.lastIndexOf('[');
        if (!Object.hasOwn(links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
          return match0;
        }
        // Links may not nest, so when this candidate's label contains a link,
        // mask the label's own links first and keep the emphasis visible
        // around them instead of flattening the whole span.
        if (refStart > 1 && match0.charAt(0) !== '!') {
          const text = match0.slice(1, refStart - 1);
          if (this.linkInText(text)) {
            return '[' + text.replace(rules.reflinkSearch, maskReflink)
              + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(match0.length - 2) + ']';
      };
      maskedSrc = maskedSrc.replace(rules.reflinkSearch, maskReflink);
    }

    // Both steps rewrite the same string, and the second only cares about
    // brackets, backticks and `<`. A single scan for those decides whether the
    // work is needed at all; strings without any of them -- most emphasis runs
    // -- come back untouched without paying for two global replaces.
    const hasCodeOrEscape = maskedSrc.indexOf('\\') !== -1 || maskedSrc.indexOf('`') !== -1;
    const hasBlockish = maskedSrc.indexOf('[') !== -1 || maskedSrc.indexOf('`') !== -1 || maskedSrc.indexOf('<') !== -1;

    if (!hasCodeOrEscape && !hasBlockish) {
      return maskedSrc;
    }

    // This step is not only about backslashes: its `code` branch also masks the
    // backticks inside a code span, and that is what keeps a `` ``x` `` run from
    // lining up as an emphasis delimiter. Gating the whole replace on a
    // backslash being present skips it for every span without one, which lets
    // emphasis close inside a code span.
    if (hasCodeOrEscape) {
      maskedSrc = maskedSrc.replace(rules.anyPunctuationOutsideCode, (match0, code, punct) => {
        if (punct) {
          // a backslash-escaped character must not read as a delimiter.
          // `+` is one code unit, so an escaped astral character (two units)
          // is refilled to its full length rather than truncating the string.
          return '+'.repeat(match0.length);
        }
        if (code) {
          // The span keeps its length; only the inner backticks change, so the
          // offsets em/strong slice by still line up.
          return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
        }
        return match0;
      });
    }

    // Links, code spans and html are invisible to em/strong. Recomputed after
    // the step above, which can turn every backtick into `+` and make this pass
    // unnecessary.
    const blockishNow = hasBlockish && (maskedSrc.indexOf('[') !== -1 || maskedSrc.indexOf('`') !== -1 || maskedSrc.indexOf('<') !== -1);
    if (blockishNow) {
      maskedSrc = maskedSrc.replace(rules.blockSkip, (match0, _link, context) => {
        const offset = context ? context.length : 0;
        return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
      });
    }

    return maskedSrc;
  }

  /**
   * Does this link label already hold a link?
   *
   * An image does not count: an image may hold a link, a link may not. The
   * check runs the blockSkip rule (which matches whole links, code spans and
   * html) and tests each match against the link pattern, so it never needs a
   * nested lex at all.
   */
  linkInText(text) {
    if (!text.includes('[')) {
      return false;
    }

    const inlineRules = this.tokenizer.inlineRules;
    const linkRule = inlineRules.link;
    for (const match of text.matchAll(inlineRules.blockSkip)) {
      // blockSkip leaves the `!` of an image out of the match, so look back
      if (linkRule.test(match[0]) && text.charAt(match.index - 1) !== '!') {
        return true;
      }
    }

    for (const match of text.matchAll(inlineRules.reflinkSearch)) {
      const match0 = match[0];
      const refStart = match0.lastIndexOf('[');
      // an image may hold a link, a link may not, so `![...][ref]` is skipped
      if (match0.charAt(0) === '!') {
        continue;
      }
      const label = normalizeLabel(match0.slice(refStart + 1, -1));
      if (!Object.hasOwn(this.tokens.links, label)) {
        continue;
      }
      // a reference that resolves to a link counts as a link in the label
      return true;
    }

    return false;
  }

  tokenizeInlines(src, maskedSrc, tokens) {
    const T = this.tokenizer;
    // Hoisting the tokenizer methods into locals keeps the dispatch loop from
    // doing a property load on `T` for every character it examines. They are
    // plain functions on the prototype and never rebound, so the local is safe.
    // Hoisted as the unbound prototype functions and invoked with `.call(T)`:
    // that skips the property load on `T` for every character examined, without
    // allocating a bound closure per pass (bind measured slower, not faster).
    const tokEscape = T.escape;
    const tokTag = T.tag;
    const tokLink = T.link;
    const tokReflink = T.reflink;
    const tokEmStrong = T.emStrong;
    const tokCodespan = T.codespan;
    const tokBr = T.br;
    const tokDel = T.del;
    const tokAutolink = T.autolink;
    const tokUrl = T.url;
    const tokInlineText = T.inlineText;
    const rules = this.rules;
    const links = this.tokens.links;

    let keepPrevChar = false;
    let prevChar = '';
    let srcLength = Infinity;

    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        break;
      }

      if (!keepPrevChar) {
        prevChar = '';
      }
      keepPrevChar = false;

      let token;
      const c = src.charCodeAt(0);

      // --- dispatch ------------------------------------------------------------
      // Upstream order: escape, tag, link, reflink, emStrong, codespan, br,
      // del, autolink, url, text. The character guard only decides whether a
      // rule is worth calling; the order decides which one wins.

      if (c === 92) {
        if ((token = tokEscape.call(T, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (c === 60) {
        if ((token = tokTag.call(T, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (c === 33 || c === 91) {
        if ((token = tokLink.call(T, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if ((token = tokReflink.call(T, src, links))) {
          src = src.substring(token.raw.length);
          const lastToken = tokens[tokens.length - 1];
          if (token.type === 'text' && lastToken?.type === 'text') {
            lastToken.raw += token.raw;
            lastToken.text += token.text;
          } else {
            tokens.push(token);
          }
          continue;
        }
      }

      if (c === 42 || c === 95) {
        if ((token = tokEmStrong.call(T, src, maskedSrc, prevChar))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (c === 96) {
        if ((token = tokCodespan.call(T, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (c === 10 || c === 32 || c === 92) {
        // br matches "  \n" or "\\\n", so a backslash is a candidate too
        if ((token = tokBr.call(T, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (c === 126) {
        if ((token = tokDel.call(T, src, maskedSrc, prevChar))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (c === 60) {
        if ((token = tokAutolink.call(T, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (!state.inLink && urlStart(c, src)) {
        if ((token = tokUrl.call(T, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if ((token = tokInlineText.call(T, src))) {
        src = src.substring(token.raw.length);
        if (token.raw.charCodeAt(token.raw.length - 1) !== 95 /* _ */) {
          prevChar = token.raw.charAt(token.raw.length - 1);
        }
        keepPrevChar = true;
        const lastToken = tokens[tokens.length - 1];
        if (lastToken?.type === 'text') {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      break;
    }

    return tokens;
  }
}

/**
 * Does the gfm url rule have any chance here?
 *
 * It matches a protocol prefix, "www.", or a bare email address. An address
 * starts with an alphanumeric local-part character, so that is the widest test
 * worth making: returning true for every alphanumeric costs one wasted call on
 * prose words, while returning false for one would lose a link.
 */
function urlStart(c, src) {
  if (c === 119 /* w */) {
    if (src.charCodeAt(1) === 119 && src.charCodeAt(2) === 119 && src.charCodeAt(3) === 46) {
      return true;
    }
    // "www." is not the only `w` case: a bare address such as
    // `will@example.com` begins with one, and the rule must be offered it.
  }
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/** Shared empty frame for runs that contain no emphasis or strikethrough marker. */
const NO_MARKERS = { maskedSrc: '', star: -1, under: -1, del: -1 };

function makeCloserFrame(maskedSrc, src) {
  // Closer hints are computed on first use, not up front: a run that opens
  // emphasis once does not need them, and most runs never open it at all. The
  // raw `src` is stored alongside so a lookup only matches the pass it was
  // built for.
  return {
    maskedSrc,
    src,
    star: -2,
    under: -2,
    del: -2,
  };
}


export { NO_MARKERS };
