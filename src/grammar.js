// make.fun — markdown-render-speed-02
// Grammar table for the hand-written renderer.
//
// marked builds its grammar with a small `edit().replace().getRegex()` DSL whose
// whole job is `${placeholder} -> source` substitution with the `^` of the
// inserted source stripped. Rather than ship that DSL, the substitution is done
// here once at module load by a compact helper, and the resulting source strings
// are exact.
//
// The `u` flag matters on the emphasis rules (they use \p{P}/\p{S}) and the `g`
// flag matters on reflinkSearch: with a global regex the scan is linear, and the
// label bounds below cap the backtracking that made it quadratic.

const noop = { exec: () => null };

/**
 * Placeholder substitution, the one thing marked's `edit()` DSL does.
 *
 * Two details matter and both are easy to get wrong: a `^` anchoring the
 * inserted pattern is stripped (so a rule can nest inside another without
 * inheriting its anchor) but a `^` inside a character class such as
 * `[^\[\]\\]` is part of the class and survives; and a placeholder can appear
 * several times in one template, so every occurrence is replaced — but only in
 * the list of pairs that belong to that rule, never against text that an
 * earlier pair inserted.
 */
export function sub(template, pairs) {
  let out = template;
  for (const [name, value] of pairs) {
    const src = typeof value === 'string' ? value : value.source;
    // drop a leading anchor only when the pattern genuinely starts with one
    const unanchored = src.startsWith('^') ? src.slice(1) : src;
    if (!out.includes(name)) continue;
    out = out.split(name).join(unanchored);
  }
  return out;
}

const rx = (source, flags = '') => new RegExp(source, flags);

// --- character classes -------------------------------------------------------
const _punctuation = /[\p{P}\p{S}]/u; // eslint-disable-line no-unused-vars
const _punctuationOrSpace = /[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpace = /[^\s\p{P}\p{S}]/u;

// GFM: `~` is excluded from the punctuation classes so it can sit inside strong/em
const _punctuationGfmStrongEm = /(?!~)[\p{P}\p{S}]/u;
const _punctuationOrSpaceGfmStrongEm = /(?!~)[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpaceGfmStrongEm = /(?:[^\s\p{P}\p{S}]|~)/u;

const _punctuationClass = '[\\p{P}\\p{S}]';
const _punctuationOrSpaceClass = '[\\s\\p{P}\\p{S}]';
const _notPunctuationOrSpaceClass = '[^\\s\\p{P}\\p{S}]';
const _punctuationGfmClass = '(?!~)[\\p{P}\\p{S}]';
const _punctuationOrSpaceGfmClass = '(?!~)[\\s\\p{P}\\p{S}]';
const _notPunctuationOrSpaceGfmClass = '(?:[^\\s\\p{P}\\p{S}]|~)';

// --- block rules -----------------------------------------------------------
const _tag =
  'address|article|aside|base|basefont|blockquote|body|caption'
  + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
  + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
  + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
  + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
  + '|tr|track|ul';

const _commentSrc = '<!--(?:-?>|[\\s\\S]*?(?:-->|$))';
const _attributeSrc =
  ' +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *\'[^\'\\n]*\'| *= *[^\\s"\'=<>`]+)?';

const newlineSrc = '^(?:[ \\t]*(?:\\n|$))+';
const blockCodeSrc = '^((?: {4}| {0,3}\\t)[^\\n]+(?:\\n(?:[ \\t]*(?:\\n|$))*)?)+';
const fencesSrc =
  '^ {0,3}(`{3,}(?=[^`\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}(?:(?=`)\\1`*|(?=~)\\1~*) *(?=\\n|$)|$)';
const hrSrc = '^ {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)';
const headingSrc = '^ {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)';
const bulletSrc = ' {0,3}(?:[*+-]|\\d{1,9}[.)])';

const lheadingCore =
  '^(?!bull |blockCode|fences|blockquote|heading|html%TBLPIPE%)((?:.|\\n(?!\\s*?\\n|bull |fences|blockquote|heading|hr|html%TBLPIPE%))+?)\\n {0,3}(=+|-+)[ \\t]*(?:\\n+|$)';

const lheadingCommonSrc = sub(lheadingCore, [
  ['bull', bulletSrc],
  ['blockCode', '(?: {4}| {0,3}\\t)'],
  ['fences', ' {0,3}(?:`{3,}|~{3,})'],
  ['blockquote', ' {0,3}>'],
  ['heading', ' {0,3}#{1,6}(?:\\s|$)'],
  ['hr', ' {0,3}(?:(?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)'],
  ['html', ' {0,3}<[^\\n>]+>\\n'],
  ['%TBLPIPE%', ''],
]);

const lheadingGfmSrc = sub(lheadingCore, [
  ['bull', bulletSrc],
  ['blockCode', '(?: {4}| {0,3}\\t)'],
  ['fences', ' {0,3}(?:`{3,}|~{3,})'],
  ['blockquote', ' {0,3}>'],
  ['heading', ' {0,3}#{1,6}(?:\\s|$)'],
  ['hr', ' {0,3}(?:(?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)'],
  ['html', ' {0,3}<[^\\n>]+>\\n'],
  ['%TBLPIPE%', '| {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n'],
]);

// Placeholder names use a distinctive marker pair so that substituting one
// placeholder cannot be mistaken for another (a bare "heading" would also match
// inside "lheading"). Each is replaced by its own rule, or deleted outright when
// the variant does not support it.
// The `|` that joins an alternative sits in front of the placeholder, so a
// variant that drops the alternative has to drop the pipe with it.
const _paragraph = '^([^\\n]+(?:\\n(?!hr|heading|%LHD%%BQ%|fences|list|html|%TBL%%WSLINE%)[^\\n]+)*)';
const blockTextSrc = '^[^\\n]+';
const _blockLabelSrc = '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\\\n]|\\n(?![ \\t]*\\n))+';
const blockTitleSrc = '(?:"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\\\n]|\\n(?!\\n))*\'|\\((?:\\\\[\\s\\S]|[^()\\\\])*\\))';
const defSrc = sub(
  '^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)',
  [['label', _blockLabelSrc], ['title', blockTitleSrc]],
);

const listSrc = sub('^(bull)([ \\t][^\\n]*?)?(?:\\n|$)', [['bull', bulletSrc]]);

const htmlSrc = sub(
  '^ {0,3}(?:'
  + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)'
  + '|comment[^\\n]*(\\n+|$)'
  + '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)'
  + '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)'
  + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)'
  + '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)'
  + '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)'
  + '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)'
  + ')',
  [['comment', _commentSrc], ['tag', _tag], ['attribute', _attributeSrc]],
);

/**
 * Paragraph-interrupt html fragment.
 *
 * Built per call rather than once at module load. The block tag-name list it
 * embeds contains the literal words "blockquote" and "table", so if this
 * fragment were shared, any later placeholder pass over a rule that includes it
 * would rewrite those words inside the tag list.
 */
function paragraphInterruptHtml() {
  return ' {0,3}(?:</?(?:' + _tag + ')(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)';
}

/**
 * Compose a paragraph rule.
 *
 * Order matters here and it is subtle: the html fragment embeds the tag-name
 * list, which itself contains the words "blockquote" and "table". Those
 * placeholders therefore have to be resolved before the html fragment is
 * substituted in, or they would be rewritten inside the tag list and silently
 * mangle it.
 */
/**
 * Compose a paragraph rule.
 *
 * The html fragment goes last: it embeds the block tag-name list, which
 * contains the words "blockquote" and "table". Both must already be resolved,
 * or they would be rewritten inside that list and quietly break the rule.
 *
 * `wsLine` differs per caller: inside a blockquote a whitespace-only line must
 * still let the paragraph continue, so the alternative has to be present.
 */
function createParagraphSrc(listInterrupt, wsLine) {
  return sub(_paragraph, [
    ['%TBL%', ''],
    ['%WSLINE%', wsLine ?? ''],
    ['%LHD%', ''],
    ['%BQ%', ' {0,3}>'],
    ['hr', hrSrc],
    ['heading', ' {0,3}#{1,6}(?:\\s|$)'],
    ['fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)'],
    ['list', listInterrupt],
    ['html', paragraphInterruptHtml()],
  ]);
}

// only non-empty lists starting from 1 can interrupt paragraphs
const paragraphSrc = createParagraphSrc(' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]');
// inside a blockquote a bare list marker of any number starts a sibling list
const blockquoteParagraphSrc = createParagraphSrc(' {0,3}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|\\n|$)', '[ \\t]+\\n');

const blockquoteSrc = sub(
  '^( {0,3}> ?(?:(?![ \\t]*(?:\\n|$))(paragraph)|[^\\n]*)(?:\\n|$))+',
  [['paragraph', blockquoteParagraphSrc]],
);

const gfmTableSrc = sub(
  '^ *([^\\n ].*)\\n'
  + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)'
  + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)',
  [
    ['hr', hrSrc],
    ['heading', ' {0,3}#{1,6}(?:\\s|$)'],
    ['blockquote', ' {0,3}>'],
    ['code', '(?: {4}| {0,3}\t)[^\n]'],
    ['fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)'],
    ['list', ' {0,3}(?:[*+-]|1[.)])[ \\t]'],
    ['html', paragraphInterruptHtml()],
  ],
);

const gfmParagraphSrc = sub(_paragraph, [
  ['%LHD%', ''],
  ['hr', hrSrc],
  ['heading', ' {0,3}#{1,6}(?:\\s|$)'],
  ['%BQ%', ' {0,3}>'],
  ['fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)'],
  ['list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]'],
  ['html', paragraphInterruptHtml()],
  // the whitespace-only-line alternative is separate from the table insert
  ['%TBL%', sub(gfmTableSrc, []).slice(1)],
  ['%WSLINE%', '|[ \\t]+\\n'],
]);

// --- inline building blocks --------------------------------------------------
const escapeSrc = '^\\\\([!"#$%&\'()*+,\\-./:;<=>?@\\[\\]\\\\^_`{|}~])';
const inlineCodeSrc = '^(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)';
const brSrc = '^( {2,}|\\\\)\\n(?!\\s*$)[ \\t]*';
const inlineTextSrc = '^(`+|[^`])(?:(?= {2,}\\n)|[\\s\\S]*?(?:(?=[\\\\<!\\[`*_]|\\b_|$)|[^ ](?= {2,}\\n)))';

const _openQuoteMod = '(?!openQuote)';

const emStrongLDelimCore = '^(?:\\*+(?:((?!\\*)punct)|([^\\s*]))?)|^_+(?:((?!_)punct)|([^\\s_]))?';
const emStrongLDelimSrc = sub(emStrongLDelimCore, [['punct', _punctuationClass]]);
const emStrongLDelimGfmSrc = sub(emStrongLDelimCore, [['punct', _punctuationGfmClass]]);

const emStrongRDelimAstCore =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)'
  + '|[^*]+(?=[^*])'
  + '|(?!\\*)punct(\\*+)(?=[\\s]|$)'
  + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)'
  + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)'
  + '|[\\s](\\*+)(?!\\*)(?=punct)'
  + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)'
  + '|notPunctSpace(\\*+)(?=notPunctSpace)';

const emStrongRDelimAstSrc = sub(emStrongRDelimAstCore, [
  ['notPunctSpace', _notPunctuationOrSpaceClass],
  ['punctSpace', _punctuationOrSpaceClass],
  ['punct', _punctuationClass],
]);
// the gfm classes keep `~` outside the punctuation sets so it can sit inside
// emphasis, which changes both the negation and the character class itself
const emStrongRDelimAstGfmSrc = sub(emStrongRDelimAstCore, [
  ['notPunctSpace', _notPunctuationOrSpaceGfmClass],
  ['punctSpace', _punctuationOrSpaceGfmClass],
  ['punct', _punctuationGfmClass],
]);

const emStrongRDelimUndSrc = sub(
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)'
  + '|[^_]+(?=[^_])'
  + '|(?!_)punct(_+)(?=[\\s]|$)'
  + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)'
  + '|(?!_)punctSpace(_+)(?=notPunctSpace)'
  + '|[\\s](_+)(?!_)(?=punct)'
  + '|(?!_)punct(_+)(?!_)(?=punct)',
  [
    ['notPunctSpace', _notPunctuationOrSpaceClass],
    ['punctSpace', _punctuationOrSpaceClass],
    ['punct', _punctuationClass],
  ],
);

const delLDelimSrc = sub('^~~?(?:((?!~)punct)|[^\\s~])', [['punct', _punctuationClass]]);

const delRDelimSrc = sub(
  '^[^~]+(?=[^~])'
  + '|(?!~)punct(~~?)(?=[\\s]|$)'
  + '|notPunctSpace(~~?)(?!~)(?=punctSpace|$)'
  + '|(?!~)punctSpace(~~?)(?=notPunctSpace)'
  + '|[\\s](~~?)(?!~)(?=punct)'
  + '|(?!~)punct(~~?)(?!~)(?=punct)'
  + '|notPunctSpace(~~?)(?=notPunctSpace)',
  [
    ['notPunctSpace', _notPunctuationOrSpaceClass],
    ['punctSpace', _punctuationOrSpaceClass],
    ['punct', _punctuationClass],
  ],
);

const anyPunctuationSrc = sub('\\\\(punct)', [['punct', _punctuationClass]]);
const anyPunctuationOutsideCodeSrc = sub(
  '(`+)(?:[^`]|[^`][\\s\\S]*?[^`])\\1(?!`)|`+|\\\\(punct)',
  [['punct', _punctuationClass]],
);

const autolinkSrc = sub(
  '^<(scheme:[^\\s\\x00-\\x1f<>]*|email)>',
  [
    ['scheme', '[a-zA-Z][a-zA-Z0-9+.-]{1,31}'],
    // the local part's class has no `^`: a caret here would negate the class
    ['email', '[a-zA-Z0-9.!#$%&\'*+/=?_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])'],
  ],
);

const _inlineCommentSrc = '<!--(?:-?>|-->|(?:-?>|[\\s\\S]*?)(?:-->))';
const _inlineCommentSimple = '<!--(?:-?>|[\\s\\S]*?-->)';

const tagSrc = sub(
  '^comment'
  + '|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>'
  + '|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>'
  + '|^<\\?[\\s\\S]*?\\?>'
  + '|^<![a-zA-Z]+\\s[\\s\\S]*?>'
  + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
  [
    ['comment', _inlineCommentSimple],
    ['attribute', '\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*\'[^\']*\'|\\s*=\\s*[^\\s"\'=<>`]+)?'],
  ],
);

const _inlineLabelBrackets = '\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]';
const _inlineLabelSrc = sub(
  '(?:\\[(?:brackets|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\])|[^\\[\\]\\\\`])*?',
  [['brackets', _inlineLabelBrackets]],
);

const linkHrefSrc = '<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]+|(?=\\))';
const inlineTitleSrc = '"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\])*\'|\\((?:\\\\[\\s\\S]|[^)\\\\])*\\)';
const linkSrc = sub(
  '^!?\\[(label)\\]\\([ \\t\\n]*(href)(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)(title))?[ \\t\\n]*\\)',
  [['label', _inlineLabelSrc], ['href', linkHrefSrc], ['title', inlineTitleSrc]],
);
const reflinkSrc = sub('^!?\\[(label)\\]\\[(ref)\\]', [['label', _inlineLabelSrc], ['ref', _blockLabelSrc]]);
const nolinkSrc = sub('^!?\\[(ref)\\](?:\\[\\])?', [['ref', _blockLabelSrc]]);

const _boundedBlockLabelSrc = '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\]){1,999}';
const _boundedInlineLabelSrc = sub(
  '(?:[^\\[\\]\\\\`]*(?:\\[(?:brackets|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\]))){0,999}?[^\\[\\]\\\\`]*?',
  [['brackets', _inlineLabelBrackets]],
);
const reflinkSearchSrc =
  sub('!?\\[(label)\\]\\[(ref)\\]', [['label', _boundedInlineLabelSrc], ['ref', _boundedBlockLabelSrc]])
  + '|'
  + sub('!?\\[(ref)\\](?:\\[\\])?', [['ref', _boundedBlockLabelSrc]])
  + '(?!\\()';
// the first alternative also matches without its anchor, so the compiled rule
// carries no leading `^` on the whole expression


const _caseInsensitiveProtocol = '[hH][tT][tT][pP][sS]?|[fF][tT][pP]';
const _extendedEmail = '[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])';
const _extendedEmailProtocol = sub('(?:mailto:email|xmpp:email(?:\\/[A-Za-z0-9@.]+)?)', [['email', _extendedEmail]]);
const _gfmEmail = '[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])';

const gfmUrlSrc = sub(
  '^emailProtocol|^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email',
  [
    ['emailProtocol', _extendedEmailProtocol],
    ['protocol', _caseInsensitiveProtocol],
    ['email', _gfmEmail],
  ],
);

const backpedalSrc = '(?:[^?!.,:;*_\'"~()&]+|\\([^)]*\\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_\'"~)]+(?!$))+';
const delSrc = '^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)';

const gfmTextSrc = sub(
  '^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&\'*+\\/=?_`{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[`*~_]|\\b_|protocol:\\/\\/|wwwStart|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&\'*+\\/=?_`{\\|}~-](?=[a-zA-Z0-9.!#$%&\'*+\\/=?_`{\\|}~-]+@))))',
  [
    ['protocol', _caseInsensitiveProtocol],
    ['emailProtocol', '(?:mailto|xmpp):'],
    ['wwwStart', '(?<![^\\s*_~(])www\\.'],
  ],
);

// --- assembled sets ----------------------------------------------------------
export const inlineNormal = {
  _backpedal: noop,
  anyPunctuation: rx(anyPunctuationSrc, 'gu'),
  anyPunctuationOutsideCode: rx(anyPunctuationOutsideCodeSrc, 'gu'),
  autolink: rx(autolinkSrc),
  blockSkip: rx(
    sub(
      'link|precode-code|html',
      [
        ['link', '\\[(?:[^\\[\\]`]|(?<a>`+)[^`]+\\k<a>(?!`))*?\\]\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)]|\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)])*\\))*\\)'],
        ['precode-', '(?<!`)()'],
        ['code', '(?<b>`+)[^`]+\\k<b>(?!`)'],
        ['html', '<(?! )[^<>]*?>'],
      ],
    ),
    'g',
  ),
  br: rx(brSrc),
  code: rx(inlineCodeSrc),
  del: noop,
  delLDelim: noop,
  delRDelim: noop,
  emStrongLDelim: rx(emStrongLDelimSrc, 'u'),
  emStrongRDelimAst: rx(emStrongRDelimAstSrc, 'gu'),
  emStrongRDelimUnd: rx(emStrongRDelimUndSrc, 'gu'),
  escape: rx(escapeSrc),
  link: rx(linkSrc),
  nolink: rx(nolinkSrc),
  punctuation: rx(sub('^((?![*_])punctSpace)', [['punctSpace', _punctuationOrSpaceClass]]), 'u'),
  reflink: rx(reflinkSrc),
  reflinkSearch: rx(reflinkSearchSrc, 'g'),
  tag: rx(tagSrc),
  text: rx(inlineTextSrc),
  url: noop,
};

export const inlineGfm = {
  ...inlineNormal,
  emStrongRDelimAst: rx(emStrongRDelimAstGfmSrc, 'gu'),
  emStrongLDelim: rx(emStrongLDelimGfmSrc, 'u'),
  delLDelim: rx(delLDelimSrc, 'u'),
  delRDelim: rx(delRDelimSrc, 'gu'),
  url: rx(gfmUrlSrc),
  _backpedal: rx(backpedalSrc),
  del: rx(delSrc),
  text: rx(gfmTextSrc),
};

export const blockNormal = {
  blockquote: rx(blockquoteSrc),
  code: rx(blockCodeSrc),
  def: rx(defSrc),
  fences: rx(fencesSrc),
  heading: rx(headingSrc),
  hr: rx(hrSrc),
  html: rx(htmlSrc, 'i'),
  lheading: rx(lheadingCommonSrc),
  list: rx(listSrc),
  newline: rx(newlineSrc),
  paragraph: rx(paragraphSrc),
  table: noop,
  text: rx(blockTextSrc),
};

export const blockGfm = {
  ...blockNormal,
  lheading: rx(lheadingGfmSrc),
  table: rx(gfmTableSrc),
  paragraph: rx(gfmParagraphSrc),
};

// --- `other` rules: metadata and single-shot helpers -------------------------
export const other = {
  codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
  outputLinkReplace: rx('\\\\([\\[\\]])', 'g'),
  indentCodeCompensation: rx('^(\\s+)(?:```)'),
  beginningSpace: /^\s+/,
  endingHash: /#$/,
  startingSpaceChar: /^ /,
  endingSpaceChar: / $/,
  endingSpaceTabChar: /[ \t]$/,
  nonSpaceChar: /[^ ]/,
  newLineCharGlobal: /\n/g,
  tabCharGlobal: /\t/g,
  leadingSpaceTab: /^[ \t]+/,
  multipleSpaceGlobal: /\s+/g,
  blankLine: /^[ \t]*$/,
  doubleBlankLine: rx('\\n[ \\t]*\\n[ \\t]*$'),
  blockquoteStart: /^ {0,3}>/,
  blockquoteSetextReplace: rx('\\n {0,3}((?:=+|-+)[ \\t]*)(?=\\n|$)', 'g'),
  blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
  blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
  listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
  listIsTask: /^\[[ xX]\][ \t]+\S/,
  listReplaceTask: /^\[[ xX]\][ \t]+/,
  listTaskCheckbox: /\[[ xX]\]/,
  anyLine: /\n.*\n/,
  hrefBrackets: /^<(.*)>$/,
  tableDelimiter: /[:|]/,
  tableAlignChars: /^\||\| *$/g,
  tableRowBlankLine: /\n[ \t]*$/,
  tableAlignRight: /^ *-+: *$/,
  tableAlignCenter: /^ *:-+: *$/,
  tableAlignLeft: /^ *:-+ *$/,
  startATag: /^<a /i,
  endATag: /^<\/a>/i,
  startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
  endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
  startAngleBracket: /^</,
  endAngleBracket: />$/,
  pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
  unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
  numericCharacterReference: rx('&#(?:(\\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));'),
  numericCharacterReferenceOrAmpersand: rx(
    '&#(?:(\\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)',
    'g',
  ),
  escapeTest: rx('[&<>"\']'),
  escapeReplace: rx('[&<>"\']', 'g'),
  escapeTestNoEncode: rx('[<>"\']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)'),
  escapeReplaceNoEncode: rx('[<>"\']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)', 'g'),
  caret: /(^|[^\[])\^/g,
  percentDecode: rx('%25', 'g'),
  findPipe: rx('\\|', 'g'),
  splitPipe: rx(' \\|'),
  slashPipe: rx('\\\\\\|', 'g'),
  carriageReturn: /\r\n|\r/g,
  spaceLine: rx('^ +$', 'gm'),
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  emptyFile: /^\s*$/,
  startTag: rx('^<(pre|script|style|textarea)[\\s>]', 'i'),
  endTag: rx('^<\\/(pre|script|style|textarea)>', 'i'),
};

// Indent-parameterised rules. marked keys the cache on `indent - 1` and clamps
// that key to 3, so asking for indent 5 yields the same pattern as indent 4.
// Reproducing the clamp exactly matters: without it a marker indented past the
// limit is treated as a new list item instead of a continuation of the current
// one, which changes how deeply nested lists nest.
function cachedIndent(create) {
  const cache = [];
  return (indent) => {
    const i = Math.min(3, Math.max(0, indent - 1));
    if (!cache[i]) cache[i] = create(i);
    return cache[i];
  };
}

const blockTagNames = _tag.split('|').join('|');
const ruleNextBullet = cachedIndent((i) => rx(`^ {0,${i}}(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))`));
const ruleHr = cachedIndent((i) => rx(`^ {0,${i}}((?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)`));
const ruleFencesBegin = cachedIndent((i) => rx(`^ {0,${i}}(?:\`\`\`|~~~)`));
const ruleHeadingBegin = cachedIndent((i) => rx(`^ {0,${i}}#{1,6}(?:\\s|$)`));
const ruleHtmlBegin = cachedIndent((i) =>
  rx(`^ {0,${i}}(?:</?(?:${blockTagNames})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'));
const ruleBlockquoteBegin = cachedIndent((i) => rx(`^ {0,${i}}>`));

// these live alongside the other single-shot rules in `other`, as upstream
other.nextBulletRegex = ruleNextBullet;
other.hrRegex = ruleHr;
other.fencesBeginRegex = ruleFencesBegin;
other.headingBeginRegex = ruleHeadingBegin;
other.htmlBeginRegex = ruleHtmlBegin;
other.blockquoteBeginRegex = ruleBlockquoteBegin;

export const NONE = noop;
export { noop, _notPunctuationOrSpace, _punctuationOrSpace, _punctuation, _notPunctuationOrSpaceGfmStrongEm, _punctuationOrSpaceGfmStrongEm, _punctuationGfmStrongEm };
