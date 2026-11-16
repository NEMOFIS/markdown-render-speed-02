// make.fun — markdown-render-speed-02
// Block and inline lexing.
//
// This is a faithful port of marked v18.1.3's tokenizer and lexer with the
// expensive rules pushed behind character-class guards (see OPTIMIZATIONS.md).
// Every guard is a pure predicate on the next code unit: when it rejects, the
// regex it protects provably cannot match at that position, so output is byte
// identical and the regex call is simply skipped.
import { inlineGfm, inlineNormal, blockGfm, blockNormal, other } from './grammar.js';
import {
  splitCells,
  rtrim,
  trimTrailingBlankLines,
  normalizeLabel,
  findClosingBracket,
  expandTabs,
  decodeNumericCharacterReferences,
  scanCloserHints,
  lastCloserOf,
  ensureHints,
} from './helpers.js';

// --- local rule references (module scope beats property lookups in the loop) --
const RT_LEADING_SPACE_TAB = /^[ \t]+/;
const RT_SLASH_PIPE = /\\\|/g;
const RT_FIND_PIPE = /\|/g;
const RT_TABLE_ROW_BLANK = /\n[ \t]*$/;
const RT_DOUBLE_BLANK = /\n[ \t]*\n[ \t]*$/;

/** Item pattern cache, keyed by bullet. */
const itemRegexCache = new Map();
function listItemRegex(bull) {
  let re = itemRegexCache.get(bull);
  if (re === undefined) {
    re = new RegExp(`^( {0,3}${bull})((?:[\\t ][^\\n]*)?(?:\\n|$))`);
    itemRegexCache.set(bull, re);
  }
  return re;
}

/**
 * Index of the first non-whitespace character, or -1.
 *
 * `\S` says the same thing, but `String.prototype.search` sets up a regex match
 * for every call and this runs for every line of every list item.
 */
function firstNonSpace(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    // space, tab, newline, vertical tab, form feed, carriage return
    if (c !== 32 && c !== 9 && c !== 10 && c !== 11 && c !== 12 && c !== 13) {
      return i;
    }
  }
  return -1;
}

// --- shared state ------------------------------------------------------------
export const state = {
  inLink: false,
  inRawBlock: false,
  top: true,
  // true until a run proves otherwise: the flag narrows to "this run contains a
  // ')'", and only a run that started with it true can ever set it false
  linkParenPossible: true,
  // true once a link has been emitted in the current label scan
  linkEmitted: false,
  // container bookkeeping for tab-indented code blocks
  indentMarkers: 0,
  tabMarkerIndent: false,
};

// closer-hint frame stack (parallel to the inline pass, like upstream)
const hintStack = [];

function outputLink(cap, link, raw, lexer) {
  const href = link.href;
  const title = link.title || null;
  const text = cap[1].replace(other.outputLinkReplace, '$1');
  const isImage = cap[0].charAt(0) === '!';

  const outerInLink = state.inLink;
  const outerLinkEmitted = state.linkEmitted;
  const outerInRawBlock = state.inRawBlock;

  state.inLink = true;
  state.linkEmitted = false;
  const tokens = lexer.inlineTokens(text);
  const textHasLink = state.linkEmitted;
  state.linkEmitted = outerLinkEmitted;
  state.inLink = outerInLink;

  if (!isImage) {
    // CommonMark: a link may not contain another link at any depth. When the
    // label produced one, this candidate is dropped so the inner link wins.
    if (textHasLink) {
      // the discarded tokens may have opened a raw block; undo it or the text
      // that gets re-scanned would stop being escaped
      state.inRawBlock = outerInRawBlock;
      return undefined;
    }
    state.linkEmitted = true;
  }

  if (isImage) {
    return { type: 'image', raw, href, title, text, tokens };
  }
  return { type: 'link', raw, href, title, text, tokens };
}

function indentCodeCompensation(raw, text) {
  // the captured indent disappears when the code block sits inside a container
  const match = INDENT_COMPENSATION.exec(raw);
  if (match === null) {
    return text;
  }
  const indentToCode = match[1];
  return text
    .split('\n')
    .map((node) => {
      const matchIndentInNode = BEGINNING_SPACE.exec(node);
      if (matchIndentInNode === null) {
        return node;
      }
      const indentInNode = matchIndentInNode[0];
      return node.slice(Math.min(indentInNode.length, indentToCode.length));
    })
    .join('\n');
}

const INDENT_COMPENSATION = /^(\s+)(?:```)/;
const BEGINNING_SPACE = /^\s+/;
const CODE_REMOVE_INDENT = /^(?: {0,3}\t| {1,4})/gm;

/**
 * How many columns an indented code block keeps when it opens with a tab.
 * A tab advances to the next multiple of four, and the container markers that
 * were themselves tabs have already had their four columns removed, so the
 * leftover padding is the remainder of the combined width.
 */
function tabIndentPadding(totalTabs) {
  const trailingTabs = (4 + 4 * totalTabs - totalTabs) % 4;
  return 4 + trailingTabs;
}

function isLabelEndInsideToken(src, label, labelStart, rules) {
  // a label with no '<' cannot contain an html or autolink token, so there is
  // nothing that could end it early
  if (!label.includes('<')) {
    return false;
  }
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '\\') {
      i++;
      continue;
    }
    if (label[i] === '`') {
      const code = rules.inline.code.exec(label.slice(i));
      if (code) {
        i += code[0].length - 1;
        continue;
      }
    }
    if (label[i] !== '<') {
      continue;
    }
    const tokenSrc = src.slice(labelStart + i);
    const token = rules.inline.tag.exec(tokenSrc) || rules.inline.autolink.exec(tokenSrc);
    if (!token) {
      continue;
    }
    if (token[0].length > label.length - i) {
      return true;
    }
    i += token[0].length - 1;
  }
  return false;
}

// --- tokenizer ---------------------------------------------------------------
export class Tokenizer {
  constructor(options) {
    this.options = options;
    this.rules = options.pedantic ? blockNormal : blockGfm;
    this.inlineRules = options.pedantic ? inlineNormal : inlineGfm;
    this.lexer = null;
    this.state = state;
  }

  // ---- block ----------------------------------------------------------------

  space(src) {
    const cap = this.rules.newline.exec(src);
    if (cap && cap[0].length > 0) {
      return { type: 'space', raw: cap[0] };
    }
  }

  code(src) {
    const cap = this.rules.code.exec(src);
    if (cap) {
      const raw = this.options.pedantic ? cap[0] : trimTrailingBlankLines(cap[0]);
      // Two levels of container already consumed a tab's worth of padding each,
      // which upstream expresses by giving the rule a tab to match per level;
      // the residual two columns of the six-column stop are what stays.
      const text = raw.replace(CODE_REMOVE_INDENT, '');
      return {
        type: 'code',
        raw,
        codeBlockStyle: 'indented',
        text,
      };
    }
  }

  fences(src) {
    const cap = this.rules.fences.exec(src);
    if (cap) {
      const raw = cap[0];
      let text = cap[3] ? indentCodeCompensation(raw, cap[3]) : '';
      return {
        type: 'code',
        raw,
        // the info string is unescaped before it becomes a class name
        lang: cap[2] ? cap[2].trim().replace(other.spaceLine, '').replace(this.inlineRules.anyPunctuation, '$1') : cap[2],
        text,
      };
    }
  }

  heading(src) {
    const cap = this.rules.heading.exec(src);
    if (cap) {
      let text = cap[2].trim();
      // CommonMark requires a space or tab before trailing #s, so "# foo#"
      // keeps its hash while "# foo #" does not
      if (other.endingHash.test(text)) {
        const trimmed = rtrim(text, '#');
        if (this.options.pedantic) {
          text = trimmed.trim();
        } else if (!trimmed || other.endingSpaceTabChar.test(trimmed)) {
          text = trimmed.trim();
        }
      }
      return { type: 'heading', raw: rtrim(cap[0], '\n'), depth: cap[1].length, text, tokens: this.lexer.inline(text) };
    }
  }

  hr(src) {
    const cap = this.rules.hr.exec(src);
    if (cap) {
      return { type: 'hr', raw: rtrim(cap[0], '\n') };
    }
  }

  blockquote(src) {
    const cap = this.rules.blockquote.exec(src);
    if (cap) {
      let lines = rtrim(cap[0], '\n').split('\n');
      let raw = '';
      let text = '';
      const tokens = [];
      const bqStart = other.blockquoteStart;

      while (lines.length > 0) {
        let inBlockquote = false;
        const currentLines = [];

        let i;
        for (i = 0; i < lines.length; i++) {
          // collect lines up to the first that cannot continue this segment
          if (bqStart.test(lines[i])) {
            currentLines.push(lines[i]);
            inBlockquote = true;
          } else if (!inBlockquote) {
            currentLines.push(lines[i]);
          } else {
            break;
          }
        }
        lines = lines.slice(i);

        // A tab after the marker runs to the next tab stop and the marker takes
        // only one space of it, so the padding must be expanded; setext
        // underlines are pushed out four columns so they stay literal.
        const currentRaw = currentLines.join('\n');
        const currentText = currentRaw
          .replace(other.blockquoteMarkerWhitespace, (_, marker, whitespace) => marker + expandTabs(whitespace, marker.length))
          .replace(other.blockquoteSetextReplace, '\n    $1')
          .replace(other.blockquoteSetextReplace2, '');
        raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
        text = text ? `${text}\n${currentText}` : currentText;

        // the nested content is lexed as top level, so paragraphs merge
        const top = state.top;
        state.top = true;
        this.lexer.blockTokens(currentText, tokens, true);
        state.top = top;

        if (lines.length === 0) {
          break;
        }

        const lastToken = tokens[tokens.length - 1];
        const lastType = lastToken?.type;

        if (lastType === 'code' || lastType === 'heading' || lastType === 'hr'
          || lastType === 'html' || lastType === 'table') {
          break;
        } else if (lastType === 'blockquote') {
          // the continuation belongs to the nested blockquote that already had
          // one marker stripped, so it is re-parsed at the same depth
          const oldToken = lastToken;
          const continuation = lines.join('\n');
          const newText = oldToken.raw + '\n' + continuation.replace(other.blockquoteSetextReplace2, '');
          const newToken = this.blockquote(newText);
          tokens[tokens.length - 1] = newToken;

          // only the lines the nested blockquote actually consumed join raw
          const leftover = newText.substring(newToken.raw.length).replace(/^\n/, '');
          const leftoverCount = leftover ? leftover.split('\n').length : 0;
          const consumed = leftoverCount ? lines.slice(0, lines.length - leftoverCount) : lines;
          if (consumed.length > 0) {
            raw = `${raw}\n${consumed.join('\n')}`;
          }
          text = text.substring(0, text.length - oldToken.text.length) + newToken.text;

          lines = lines.slice(consumed.length);
          if (lines.length > 0 && bqStart.test(lines[0])) {
            continue;
          }
          break;
        } else if (lastType === 'list') {
          const oldToken = lastToken;
          const newText = oldToken.raw + '\n' + lines.join('\n');
          const newToken = this.list(newText);
          tokens[tokens.length - 1] = newToken;

          const consumedCount = newToken.raw.length > oldToken.raw.length
            ? newText.slice(oldToken.raw.length + 1, newToken.raw.length).split('\n').length
            : 0;
          if (consumedCount > 0) {
            const consumed = lines.slice(0, consumedCount).join('\n');
            raw = `${raw}\n${consumed}`;
            text = `${text}\n${consumed}`;
          }
          lines = lines.slice(consumedCount);
          continue;
        }
      }

      return { type: 'blockquote', raw, tokens, text };
    }
  }

  // The list rule needs a bullet (`*`, `-`, `+`) or a digit to match, and the
  // hr rule needs `*`, `-` or `_`. Checking the first character first keeps both
  // off ordinary prose, where they are attempted at every block boundary.
  list(src) {
    const c0 = src.charCodeAt(0);
    let lookahead = 0;
    if (c0 === 32 || c0 === 9) {
      // skip leading spaces before deciding
      while (lookahead < 3 && src.charCodeAt(lookahead) === 32) lookahead++;
    }
    const c = src.charCodeAt(lookahead);
    const isBullet = c === 42 || c === 45 || c === 43;
    const isDigit = c >= 48 && c <= 57;
    if (!isBullet && !isDigit) {
      return;
    }
    return this.listOuter(src);
  }

  listOuter(src) {
    // A list item begins with up to three spaces and then a bullet or a digit.
    // Checking the first non-space character costs one code unit and keeps the
    // two regexes below off ordinary prose, where they are attempted but cannot
    // match. This runs once per block position, so it is the hottest test in the
    // lexer.
    let probe = 0;
    while (probe < 3 && src.charCodeAt(probe) === 32) {
      probe++;
    }
    const lead = src.charCodeAt(probe);
    if (lead !== 42 && lead !== 45 && lead !== 43 && !(lead >= 48 && lead <= 57)) {
      return;
    }

    let cap = this.rules.list.exec(src);
    if (!cap) {
      return;
    }

    const listSrc = src;
    const taken = () => listSrc.length - src.length;
    let bull = cap[1].trim();
    const isordered = bull.length > 1;

    const list = {
      type: 'list',
      raw: '',
      ordered: isordered,
      start: isordered ? +bull.slice(0, -1) : '',
      loose: false,
      items: [],
    };

    bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
    if (this.options.pedantic) {
      bull = isordered ? bull : '[*+-]';
    }

    // The item pattern depends only on the bullet, so it is cached: this method
    // is attempted once per block position and almost always fails, which makes
    // compiling a fresh RegExp on every attempt the single most expensive thing
    // in the lexer.
    const itemRegex = listItemRegex(bull);
    let endsWithBlankLine = false;

    while (src) {
      let endEarly = false;
      let itemContents = '';
      if (!(cap = itemRegex.exec(src))) {
        break;
      }
      // An hr is three or more `*`, `-` or `_`; the loop's next item always
      // begins with one of those, so the test is cheap either way, but the
      // digit case can never be an hr.
      if (lead !== 48 && !(lead >= 49 && lead <= 57)) {
        if (this.rules.hr.test(src)) {
          break;
        }
      }

      const itemStart = taken();
      src = src.substring(cap[0].length);

      const firstLine = cap[2].split('\n', 1)[0];
      const bulletIndent = cap[1].length;
      let line = this.options.pedantic
        ? expandTabs(firstLine, bulletIndent)
        : firstLine.replace(RT_LEADING_SPACE_TAB, (whitespace) => expandTabs(whitespace, bulletIndent));
      let nextLine = src.split('\n', 1)[0];
      let blankLine = !line.trim();

      let indent = 0;
      if (this.options.pedantic) {
        indent = 2;
        itemContents = line.trimStart();
      } else if (blankLine) {
        indent = bulletIndent + 1;
      } else {
        const nonSpace = firstNonSpace(line);
        indent = nonSpace > 4 ? 1 : nonSpace;
        itemContents = line.slice(indent);
        indent += bulletIndent;
      }

      if (blankLine && other.blankLine.test(nextLine)) {
        src = src.substring(nextLine.length + 1);
        endEarly = true;
      }

      if (!endEarly) {
        const nextBulletRegex = other.nextBulletRegex(indent);
        const hrRegex = other.hrRegex(indent);
        const fencesBeginRegex = other.fencesBeginRegex(indent);
        const headingBeginRegex = other.headingBeginRegex(indent);
        const htmlBeginRegex = other.htmlBeginRegex(indent);
        const blockquoteBeginRegex = other.blockquoteBeginRegex(indent);

        // The tab expansion only matters on a line that actually contains a tab.
        // `replace` with a callback allocates a match array and a string even
        // when nothing matches, and most lines have no tab, so the test pays for
        // itself. `indexOf`/`slice` replaces `split('\n', 1)[0]`, which built a
        // throwaway array for every line of every list item.
        const expandLineTabs = (text) => {
          if (text.indexOf('\t') === -1) {
            return text;
          }
          let out = text.replace(RT_LEADING_SPACE_TAB, (whitespace) => expandTabs(whitespace));
          return out.replace(/^[ \t]*\t[ \t]*/, (run) => expandTabs(run, 0));
        };

        while (src) {
          const nl = src.indexOf('\n');
          const rawLine = nl === -1 ? src : src.slice(0, nl);
          let nextLineWithoutTabs;
          nextLine = rawLine;

          if (this.options.pedantic) {
            nextLine = nextLine.replace(other.listReplaceNesting, '  ');
            nextLineWithoutTabs = nextLine;
          } else {
            nextLineWithoutTabs = expandLineTabs(nextLine);
          }

          // Every one of these rules is anchored on a specific first character
          // after optional indentation, so a single look at that character
          // decides which (if any) are worth running. Ordinary content lines —
          // the overwhelming majority — run none of the six.
          let li = 0;
          const ln = nextLine.length;
          while (li < ln && (nextLine.charCodeAt(li) === 32 || nextLine.charCodeAt(li) === 9)) li++;
          const fc = li < ln ? nextLine.charCodeAt(li) : -1;

          if (fc === 96 /* ` */ || fc === 126 /* ~ */) {
            if (fencesBeginRegex.test(nextLine)) break;
          } else if (fc === 35 /* # */) {
            if (headingBeginRegex.test(nextLine)) break;
          } else if (fc === 60 /* < */) {
            if (htmlBeginRegex.test(nextLine)) break;
          } else if (fc === 62 /* > */) {
            if (blockquoteBeginRegex.test(nextLine)) break;
          } else if (fc === 42 || fc === 45 || fc === 43 || (fc >= 48 && fc <= 57)) {
            if (nextBulletRegex.test(nextLine)) break;
            if (hrRegex.test(nextLine)) break;
          } else if (fc === 95 /* _ */) {
            if (hrRegex.test(nextLine)) break;
          }

          if (firstNonSpace(nextLineWithoutTabs) >= indent || !nextLine.trim()) {
            itemContents += '\n' + nextLineWithoutTabs.slice(indent);
          } else {
            if (blankLine) break;
            if (firstNonSpace(line.replace(other.tabCharGlobal, '    ')) >= 4) break;

            // Same first-character dispatch as the branch above, restricted to
            // exactly the four rules the original chain ran: fences (` or ~),
            // html (<), heading (#) and hr (* - _). A digit or `+` line can be
            // none of these, so it skips all four. The leading character is
            // found by scanning code units rather than with a regex, because
            // `search` here cost more than the tests it was meant to skip.
            let lcIndex = 0;
            while (lcIndex < line.length && line.charCodeAt(lcIndex) <= 32) {
              lcIndex++;
            }
            const lc = lcIndex < line.length ? line.charCodeAt(lcIndex) : -1;
            if (lc === 96 || lc === 126) {
              if (fencesBeginRegex.test(line)) break;
            } else if (lc === 60) {
              if (htmlBeginRegex.test(line)) break;
            } else if (lc === 35) {
              if (headingBeginRegex.test(line)) break;
            } else if (lc === 42 || lc === 45 || lc === 95) {
              if (hrRegex.test(line)) break;
            }

            const setextContinuation = !this.options.pedantic
              && /^ {0,3}(?:=+|-+) *$/.test(nextLine)
              && this.rules.lheading.test(`${line}\n${nextLine}`);
            const continuation = setextContinuation
              ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
              : nextLine;
            itemContents += '\n' + continuation;
          }

          blankLine = !nextLine.trim();
          src = src.substring(rawLine.length + 1);
          line = nextLineWithoutTabs.slice(indent);
        }
      }

      const raw = listSrc.slice(itemStart, taken());

      if (!list.loose) {
        if (endsWithBlankLine) {
          list.loose = true;
        } else if (RT_DOUBLE_BLANK.test(raw)) {
          endsWithBlankLine = true;
        }
      }

      list.items.push({
        type: 'list_item',
        raw,
        task: !!this.options.gfm && other.listIsTask.test(itemContents),
        loose: false,
        text: itemContents,
        tokens: [],
      });
    }

    const lastItem = list.items[list.items.length - 1];
    if (lastItem) {
      lastItem.raw = lastItem.raw.trimEnd();
      lastItem.text = lastItem.text.trimEnd();
    } else {
      return;
    }
    list.raw = listSrc.slice(0, taken()).trimEnd();

    for (const item of list.items) {
      state.top = false;
      item.tokens = this.lexer.blockTokens(item.text, []);

      // a tight list becomes loose as soon as one item contains a blank line
      // that is separated by more than a single newline
      if (!list.loose) {
        const spacers = item.tokens.filter((t) => t.type === 'space');
        const hasMultipleLineBreaks = spacers.length > 0 && spacers.some((t) => other.anyLine.test(t.raw));
        if (hasMultipleLineBreaks) {
          list.loose = true;
        }
      }
    }

    for (const item of list.items) {
      const itemToken = item.tokens[0];
      if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
        item.text = item.text.replace(other.listReplaceTask, '');
        itemToken.raw = itemToken.raw.replace(other.listReplaceTask, '');
        itemToken.text = itemToken.text.replace(other.listReplaceTask, '');
        for (let i = this.lexer.inlineQueue.length - 1; i >= 0; i--) {
          if (other.listIsTask.test(this.lexer.inlineQueue[i].src)) {
            this.lexer.inlineQueue[i].src = this.lexer.inlineQueue[i].src.replace(other.listReplaceTask, '');
            break;
          }
        }

        const taskRaw = other.listTaskCheckbox.exec(item.raw);
        if (taskRaw) {
          const checkboxToken = {
            type: 'checkbox',
            raw: taskRaw[0] + ' ',
            checked: taskRaw[0] !== '[ ]',
          };
          item.checked = checkboxToken.checked;
          if (list.loose) {
            if (item.tokens[0] && (item.tokens[0].type === 'paragraph' || item.tokens[0].type === 'text') && item.tokens[0].tokens) {
              item.tokens[0].raw = checkboxToken.raw + item.tokens[0].raw;
              item.tokens[0].text = checkboxToken.raw + item.tokens[0].text;
              item.tokens[0].tokens.unshift(checkboxToken);
            } else {
              item.tokens.unshift({
                type: 'paragraph',
                raw: checkboxToken.raw,
                text: checkboxToken.raw,
                tokens: [checkboxToken],
              });
            }
          } else {
            item.tokens.unshift(checkboxToken);
          }
        }
      } else if (item.task) {
        item.task = false;
      }
    }

    if (list.loose) {
      for (const item of list.items) {
        item.loose = true;
        for (const token of item.tokens) {
          if (token.type === 'text') {
            token.type = 'paragraph';
          }
        }
      }
    }

    return list;
  }

  html(src) {
    const cap = this.rules.html.exec(src);
    if (cap) {
      const raw = trimTrailingBlankLines(cap[0]);
      return {
        type: 'html',
        block: true,
        raw,
        pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
        text: raw,
      };
    }
  }

  def(src) {
    const cap = this.rules.def.exec(src);
    if (cap) {
      if (!other.startAngleBracket.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) {
        return;
      }
      const tag = normalizeLabel(cap[1]);
      const href = cap[2]
        ? cap[2].replace(other.hrefBrackets, '$1').replace(this.inlineRules.anyPunctuation, '$1')
        : '';
      const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.inlineRules.anyPunctuation, '$1') : cap[3];
      return { type: 'def', tag, raw: rtrim(cap[0], '\n'), href, title };
    }
  }

  table(src) {
    const cap = this.rules.table.exec(src);
    if (!cap) {
      return;
    }
    if (!other.tableDelimiter.test(cap[2])) {
      return;
    }

    const headers = splitCells(cap[1]);
    const aligns = cap[2].replace(other.tableAlignChars, '').split('|');
    const rows = cap[3]?.trim() ? cap[3].replace(RT_TABLE_ROW_BLANK, '').split('\n') : [];

    if (headers.length !== aligns.length) {
      return;
    }

    const item = {
      type: 'table',
      raw: rtrim(cap[0], '\n'),
      header: [],
      align: [],
      rows: [],
    };

    for (const align of aligns) {
      if (other.tableAlignRight.test(align)) item.align.push('right');
      else if (other.tableAlignCenter.test(align)) item.align.push('center');
      else if (other.tableAlignLeft.test(align)) item.align.push('left');
      else item.align.push(null);
    }

    for (let i = 0; i < headers.length; i++) {
      item.header.push({
        text: headers[i],
        tokens: this.lexer.inline(headers[i]),
        header: true,
        align: item.align[i],
      });
    }

    for (const row of rows) {
      const cells = splitCells(row, item.header.length);
      const out = [];
      for (let i = 0; i < cells.length; i++) {
        out.push({
          text: cells[i],
          tokens: this.lexer.inline(cells[i]),
          header: false,
          align: item.align[i],
        });
      }
      item.rows.push(out);
    }

    return item;
  }

  lheading(src) {
    const cap = this.rules.lheading.exec(src);
    if (cap) {
      const text = cap[1].trim();
      return {
        type: 'heading',
        raw: rtrim(cap[0], '\n'),
        depth: cap[2].charAt(0) === '=' ? 1 : 2,
        text,
        tokens: this.lexer.inline(text),
      };
    }
  }

  paragraph(src) {
    const cap = this.rules.paragraph.exec(src);
    if (cap) {
      const text = cap[1].charAt(cap[1].length - 1) === '\n' ? cap[1].slice(0, -1) : cap[1];
      return { type: 'paragraph', raw: cap[0], text, tokens: this.lexer.inline(text) };
    }
  }

  text(src) {
    const cap = this.rules.text.exec(src);
    if (cap) {
      // A plain-text block keeps its raw source verbatim: leading indentation
      // here is content, not a container marker, so it must not be trimmed.
      return { type: 'text', raw: cap[0], text: cap[0], tokens: this.lexer.inline(cap[0]) };
    }
  }

  // ---- inline ---------------------------------------------------------------

  escape(src) {
    const cap = this.inlineRules.escape.exec(src);
    if (cap) {
      return { type: 'escape', raw: cap[0], text: cap[1] };
    }
  }

  tag(src) {
    const cap = this.inlineRules.tag.exec(src);
    if (cap) {
      if (!state.inLink && other.startATag.test(cap[0])) {
        state.inLink = true;
      } else if (state.inLink && other.endATag.test(cap[0])) {
        state.inLink = false;
      }
      if (!state.inRawBlock && other.startPreScriptTag.test(cap[0])) {
        state.inRawBlock = true;
      } else if (state.inRawBlock && other.endPreScriptTag.test(cap[0])) {
        state.inRawBlock = false;
      }
      return {
        type: 'html',
        raw: cap[0],
        inLink: state.inLink,
        inRawBlock: state.inRawBlock,
        block: false,
        text: cap[0],
      };
    }
  }

  link(src) {
    if (state.linkParenPossible === false) {
      return undefined;
    }
    const cap = this.inlineRules.link.exec(src);
    if (cap) {
      const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
      if (!this.options.pedantic && isLabelEndInsideToken(src, cap[1], labelStart, { inline: this.inlineRules })) {
        return;
      }

      const trimmedUrl = cap[2].trim();
      if (!this.options.pedantic && other.startAngleBracket.test(trimmedUrl)) {
        if (!other.endAngleBracket.test(trimmedUrl)) {
          return;
        }
        const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
        if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
          return;
        }
      } else {
        const lastParenIndex = findClosingBracket(cap[2], '()');
        if (lastParenIndex === -2) {
          return;
        }
        if (lastParenIndex > -1) {
          const start = cap[0].indexOf('!') === 0 ? 5 : 4;
          const linkLen = start + cap[1].length + lastParenIndex;
          cap[2] = cap[2].substring(0, lastParenIndex);
          cap[0] = cap[0].substring(0, linkLen).trim();
          cap[3] = '';
        }
      }

      const unescaped = rtrim(cap[0].slice(0, -1), '\\');
      if ((cap[0].length - unescaped.length) % 2 === 0) {
        return;
      }

      let href = cap[2];
      let title = '';
      if (this.options.pedantic) {
        const link = other.pedanticHrefTitle.exec(href);
        if (link) {
          href = link[1];
          title = link[3];
        }
      } else {
        title = cap[3] ? cap[3].slice(1, -1) : '';
      }

      href = href.trim();
      if (other.startAngleBracket.test(href)) {
        if (this.options.pedantic && !other.endAngleBracket.test(trimmedUrl)) {
          href = href.slice(1);
        } else {
          href = href.slice(1, -1);
        }
      }
      return outputLink(cap, {
        href: href ? href.replace(this.inlineRules.anyPunctuation, '$1') : href,
        title: title ? title.replace(this.inlineRules.anyPunctuation, '$1') : title,
      }, cap[0], this.lexer);
    }
  }

  reflink(src, links) {
    let cap;
    if ((cap = this.inlineRules.reflink.exec(src)) || (cap = this.inlineRules.nolink.exec(src))) {
      const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
      if (!this.options.pedantic && isLabelEndInsideToken(src, cap[1], labelStart, { inline: this.inlineRules })) {
        return;
      }
      const link = links[normalizeLabel(cap[2] || cap[1])];
      if (!link) {
        const text = cap[0].charAt(0);
        return { type: 'text', raw: text, text };
      }
      return outputLink(cap, link, cap[0], this.lexer);
    }
  }

  emStrong(src, maskedSrc, prevChar = '') {
    // The delimiter rule needs a run of `*` or `_`; anything else cannot open.
    const first = src.charCodeAt(0);
    if (first !== 42 && first !== 95) return;

    let match = this.inlineRules.emStrongLDelim.exec(src);
    if (!match) return;
    if (!match[1] && !match[2] && !match[3] && !match[4]) return;

    const delimChar = match[0][0];
    const midRun = prevChar === delimChar;

    const srcStart = maskedSrc.length - src.length;
    let runStart = srcStart;
    while (!this.options.pedantic && runStart > 0 && maskedSrc[runStart - 1] === delimChar) {
      runStart--;
    }
    const runPrevChar = [...maskedSrc.slice(Math.max(0, runStart - 2), runStart)].at(-1) ?? '';
    const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || !!this.inlineRules.punctuation.exec(runPrevChar);
    if (runStart < srcStart) {
      prevChar = runPrevChar;
    }
    const prevPunct = runStart < srcStart ? runPrevPunct : !!this.inlineRules.punctuation.exec(prevChar);

    if (match[4] && prevChar.match(other.unicodeAlphaNumeric)) return;

    const nextChar = match[1] || match[3] || '';

    if (!nextChar || !prevChar || prevPunct) {
      const lLength = [...match[0]].length - 1;
      let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;

      const runLength = srcStart - runStart + lLength;
      const openerCanClose = !this.options.pedantic && !!runPrevChar.trim()
        && (!!nextChar || (delimChar === '*' && !runPrevPunct));
      if (delimChar !== '*' && delimChar !== '_') return;
      const endReg = delimChar === '*' ? this.inlineRules.emStrongRDelimAst : this.inlineRules.emStrongRDelimUnd;
      const lastPossible = closestHint(maskedSrc, src, delimChar);
      const windowStart = maskedSrc.length - src.length + lLength;
      if (lastPossible < windowStart) return;
      // A window local: reassigning `maskedSrc` itself would leave the hint
      // cache keyed on a string that no longer describes the current pass.
      const windowSrc = maskedSrc.slice(-1 * src.length + lLength);
      const lastPossibleInWindow = lastPossible - windowStart;
      endReg.lastIndex = 0;

      while ((match = endReg.exec(windowSrc)) !== null) {
        if (match.index > lastPossibleInWindow) break;
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (!rDelim) continue;
        rLength = rDelim.length;

        if (match[3] || match[4]) {
          delimTotal += rLength;
          continue;
        } else if (match[5] || match[6] || openerCanClose) {
          if (midRun && (match[5] || match[6])) {
            break;
          }
          if (runLength % 3 && !((runLength + rLength) % 3)) {
            midDelimTotal += rLength;
            continue;
          }
        }

        delimTotal -= rLength;
        if (delimTotal > 0) continue;

        rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
        // The delimiter's own character is measured in code points: a match
        // whose first character is astral occupies two code units, and using
        // charAt(0) would cut the raw in half and emit a lone surrogate.
        const lastCharLength = [...match[0]][0].length;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

        if (Math.min(lLength, rLength) % 2) {
          const text = raw.slice(1, -1);
          return { type: 'em', raw, text, tokens: this.lexer.inlineTokens(text) };
        }
        const text = raw.slice(2, -2);
        return { type: 'strong', raw, text, tokens: this.lexer.inlineTokens(text) };
      }
    }
  }

  codespan(src) {
    const cap = this.inlineRules.code.exec(src);
    if (cap) {
      let text = cap[2].replace(other.newLineCharGlobal, ' ');
      const hasNonSpaceChars = other.nonSpaceChar.test(text);
      const hasSpaceCharsOnBothEnds = other.startingSpaceChar.test(text) && other.endingSpaceChar.test(text);
      if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
        text = text.substring(1, text.length - 1);
      }
      return { type: 'codespan', raw: cap[0], text };
    }
  }

  br(src) {
    const cap = this.inlineRules.br.exec(src);
    if (cap) {
      return { type: 'br', raw: cap[0] };
    }
  }

  del(src, maskedSrc, prevChar = '') {
    let match = this.inlineRules.delLDelim.exec(src);
    if (!match) return;

    const nextChar = match[1] || '';

    if (!nextChar || !prevChar || this.inlineRules.punctuation.exec(prevChar)) {
      const lLength = [...match[0]].length - 1;
      let rDelim, rLength, delimTotal = lLength;

      const endReg = this.inlineRules.delRDelim;
      const lastPossible = closestDelHint(maskedSrc);
      const windowStart = maskedSrc.length - src.length + lLength;
      if (lastPossible < windowStart) return;
      maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
      const lastPossibleInWindow = lastPossible - windowStart;
      endReg.lastIndex = 0;

      while ((match = endReg.exec(maskedSrc)) !== null) {
        if (match.index > lastPossibleInWindow) break;
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (!rDelim) continue;
        rLength = rDelim.length;
        if (rLength !== lLength) continue;

        if (match[3] || match[4]) {
          delimTotal += rLength;
          continue;
        }

        delimTotal -= rLength;
        if (delimTotal > 0) continue;

        rLength = Math.min(rLength, rLength + delimTotal);
        // Measured in code points: an astral first character occupies two code
        // units, and charAt(0) would slice the raw through the surrogate pair.
        const lastCharLength = [...match[0]][0].length;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
        const text = raw.slice(lLength, -lLength);
        return { type: 'del', raw, text, tokens: this.lexer.inlineTokens(text) };
      }
    }
  }

  autolink(src) {
    const cap = this.inlineRules.autolink.exec(src);
    if (cap) {
      let text, href;
      if (cap[2] === '@') {
        text = cap[1];
        href = 'mailto:' + text;
      } else {
        text = cap[1];
        href = text;
      }
      return {
        type: 'link',
        raw: cap[0],
        text,
        href,
        autolink: true,
        tokens: [{ type: 'text', raw: text, text }],
      };
    }
  }

  url(src) {
    let cap;
    if ((cap = this.inlineRules.url.exec(src))) {
      let text, href;
      if (cap[2] === '@') {
        text = cap[0];
        href = 'mailto:' + text;
      } else {
        let prevCapZero;
        do {
          prevCapZero = cap[0];
          cap[0] = this.inlineRules._backpedal.exec(cap[0])?.[0] ?? '';
        } while (prevCapZero !== cap[0]);
        text = cap[0];
        if (cap[1] === 'www.') {
          href = 'http://' + cap[0];
        } else {
          href = cap[0];
        }
      }
      return {
        type: 'link',
        raw: cap[0],
        text,
        href,
        autolink: true,
        tokens: [{ type: 'text', raw: text, text }],
      };
    }
  }

  inlineText(src) {
    const cap = this.inlineRules.text.exec(src);
    if (cap) {
      const escaped = state.inRawBlock;
      return {
        type: 'text',
        raw: cap[0],
        text: escaped ? cap[0] : decodeNumericCharacterReferences(cap[0]),
        escaped,
      };
    }
  }

}

// Closer hints for the running inline pass, held in a single slot rather than a
// map. A pass changes its source only when it recurses, and the frame stack
// already records the parent there. Keying a Map on the source string meant
// hashing the whole paragraph on every lookup, which cost more than the scan it
// was meant to save.
let hintSlotMasked = null;
let hintSlotSrc = null;
let hintSlotDelim = 0;
let hintSlotHint = -1;

function closestHint(maskedSrc, src, delim) {
  // Only the delimiter being opened is ever asked about, so the scan is narrowed
  // to that one character. The pair (maskedSrc, src, delim) is remembered
  // because one open attempt is followed by another on the same source.
  const code = delim === '*' ? 42 : 95;
  if (hintSlotMasked !== maskedSrc || hintSlotSrc !== src || hintSlotDelim !== code) {
    hintSlotMasked = maskedSrc;
    hintSlotSrc = src;
    hintSlotDelim = code;
    hintSlotHint = lastCloserOf(maskedSrc, code);
  }
  return hintSlotHint;
}

function closestDelHint(maskedSrc) {
  const frame = hintStack[hintStack.length - 1];
  if (frame && frame.maskedSrc === maskedSrc) {
    ensureHints(frame);
    return frame.del;
  }
  return scanCloserHints(maskedSrc).del;
}

export { hintStack, outputLink, indentCodeCompensation };
