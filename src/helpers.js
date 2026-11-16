// Small utilities: HTML escaping, inline output escaping, URL cleaning, table
// cell splitting, rtrim, and label normalisation.
import { other } from './grammar.js';

const escapeReplacements = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const getEscapeReplacement = (ch) => escapeReplacements[ch];

// Replacement patterns are not module-level globals: a `g` regex carries
// lastIndex between calls, and a test() that matched would leave the following
// replace() resuming mid-string, silently skipping escapes. Each call gets its
// own replace, guarded by a cheap non-global test first.
const TEST_ENCODE = /[&<>"']/;
const TEST_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const REPLACE_ALL = /[&<>"']/g;
const REPLACE_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;

export function escapeHtmlEntities(html, encode) {
  if (encode) {
    if (TEST_ENCODE.test(html)) {
      return html.replace(REPLACE_ALL, getEscapeReplacement);
    }
  } else if (TEST_NO_ENCODE.test(html)) {
    return html.replace(REPLACE_NO_ENCODE, getEscapeReplacement);
  }
  return html;
}

export function decodeNumericCharacterReferences(text) {
  if (!other.numericCharacterReference.test(text)) {
    return text;
  }
  return text.replace(other.numericCharacterReferenceOrAmpersand, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) {
      return '&amp;';
    }
    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return '\uFFFD';
    }
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

export function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(other.percentDecode, '%');
  } catch {
    return null;
  }
  return href;
}

/**
 * Split a table row on unescaped pipes.
 *
 * Upstream rewrites the row with a global replace that walks back over the
 * preceding backslashes for each pipe, then splits on ' |'. Counting the
 * backslashes in one forward pass removes both the rewrite and the per-pipe
 * backward scan, and yields the same cells: a pipe that is not escaped becomes
 * a separator, an escaped one is unescaped into the cell.
 */
export function splitCells(tableRow, count) {
  const cells = [];
  let cell = '';
  let run = 0; // length of the current run of backslashes
  for (let i = 0; i < tableRow.length; i++) {
    const ch = tableRow.charCodeAt(i);
    if (ch === 92 /* \ */) {
      run++;
      continue;
    }
    if (ch === 124 /* | */) {
      // an unescaped pipe separates; escaped pipes lose one backslash
      const before = run >> 1;
      cell += '\\'.repeat(before) + (run & 1 ? '|' : '');
      if (run & 1) {
        run = 0;
        continue;
      }
      cells.push(cell);
      cell = '';
      run = 0;
      continue;
    }
    if (run) {
      cell += '\\'.repeat(run);
      run = 0;
    }
    cell += tableRow[i];
  }
  if (run) {
    cell += '\\'.repeat(run);
  }
  cells.push(cell);

  if (!cells[0].trim()) {
    cells.shift();
  }
  if (cells.length > 0 && !cells[cells.length - 1].trim()) {
    cells.pop();
  }

  if (count) {
    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count) cells.push('');
    }
  }

  for (let i = 0; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(other.slashPipe, '|');
  }
  return cells;
}

/** Remove a trailing run of `c`, or of everything that is not `c` when invert. */
export function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) {
    return '';
  }
  let suffLen = 0;
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) {
      suffLen++;
    } else if (currChar !== c && invert) {
      suffLen++;
    } else {
      break;
    }
  }
  return str.slice(0, l - suffLen);
}

export function trimTrailingBlankLines(str) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && other.blankLine.test(lines[end])) {
    end--;
  }
  if (lines.length - end <= 2) {
    // keep single trailing blank lines
    return str;
  }
  return lines.slice(0, end + 1).join('\n');
}

export function normalizeLabel(label) {
  return label.trim().replace(other.multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}

export function findClosingBracket(str, b) {
  if (str.indexOf(b[0]) === -1 && str.indexOf(b[1]) === -1) {
    return -1;
  }
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) {
        return i;
      }
    }
  }
  if (level > 0) {
    return -2;
  }
  return -1;
}

export function invertBool(encode) {
  return !encode;
}

/**
 * Index of the last `*` / `_` run that can close emphasis or strong, and of the
 * last `~` run that can close strikethrough, found in one left-to-right scan.
 *
 * A run can close only when it is not preceded by whitespace or by the start of
 * the string, so one scan answers "is any closer left?" for every opener in the
 * pass. Finding one only means keep looking: the CommonMark delimiter rules are
 * still applied by the loop itself.
 */
export function scanCloserHints(src) {
  let star = -1;
  let under = -1;
  let del = -1;
  const len = src.length;
  for (let i = 0; i < len; i++) {
    const ch = src.charCodeAt(i);
    if (ch !== 42 && ch !== 95 && ch !== 126) continue;
    const prev = i === 0 ? 10 : src.charCodeAt(i - 1);
    let j = i + 1;
    while (j < len && src.charCodeAt(j) === ch) j++;
    if (prev !== 32 && prev !== 9 && prev !== 10 && prev !== 13 && prev !== 12) {
      if (ch === 126) del = i;
      else if (ch === 42) star = i;
      else under = i;
    }
    i = j - 1;
  }
  return { star, under, del };
}

/**
 * Last position of a single delimiter character that can act as a closer.
 *
 * The full scan above reports all three delimiters, but a call only ever needs
 * one of them. Scanning backwards for that one character and stopping at the
 * first hit is the same answer for a fraction of the work: closers sit near the
 * end of the run far more often than not.
 */
export function lastCloserOf(src, delimCode) {
  const len = src.length;
  for (let i = len - 1; i >= 0; i--) {
    if (src.charCodeAt(i) !== delimCode) continue;
    const prev = i === 0 ? 10 : src.charCodeAt(i - 1);
    if (prev !== 32 && prev !== 9 && prev !== 10 && prev !== 13 && prev !== 12) {
      return i;
    }
    // a run preceded by whitespace cannot close; keep walking back
    while (i > 0 && src.charCodeAt(i - 1) === delimCode) i--;
  }
  return -1;
}

/** Fill a frame's closer hints the first time one is asked for. */
export function ensureHints(frame) {
  if (frame.star !== -2) return frame;
  const hints = scanCloserHints(frame.maskedSrc);
  frame.star = hints.star;
  frame.under = hints.under;
  frame.del = hints.del;
  return frame;
}

export function expandTabs(line, indent = 0) {
  let col = indent;
  let expanded = '';
  for (const char of line) {
    if (char === '\t') {
      const added = 4 - (col % 4);
      expanded += ' '.repeat(added);
      col += added;
    } else {
      expanded += char;
      col++;
    }
  }
  return expanded;
}
