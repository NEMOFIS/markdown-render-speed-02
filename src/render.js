// HTML emitter for the token tree.
//
// Written as plain functions rather than a renderer object: every call site here
// is monomorphic, so V8 never has to chase a prototype chain or handle a
// polymorphic receiver once per token.
import { escapeHtmlEntities, cleanUrl } from './helpers.js';
import { other } from './grammar.js';

export function space() {
  return '';
}

export function code(token) {
  const langString = (token.lang || '').match(other.notSpaceStart)?.[0];

  // an empty code block has no content, so it must not gain a newline
  const text = token.text ? token.text.replace(other.endingNewline, '') + '\n' : '';

  if (!langString) {
    return '<pre><code>' + (token.escaped ? text : escapeHtmlEntities(text, true)) + '</code></pre>\n';
  }
  return '<pre><code class="language-'
    + escapeHtmlEntities(langString)
    + '">'
    + (token.escaped ? text : escapeHtmlEntities(text, true))
    + '</code></pre>\n';
}

export function blockquote(token, body) {
  return '<blockquote>\n' + body + '</blockquote>\n';
}

export function html(token) {
  return token.text;
}

export function def() {
  return '';
}

export function heading(token, inline) {
  return '<h' + token.depth + '>' + inline + '</h' + token.depth + '>\n';
}

export function hr() {
  return '<hr>\n';
}

export function listStart(ordered, start) {
  const type = ordered ? 'ol' : 'ul';
  return '<' + type + ((ordered && start !== 1) ? ' start="' + start + '"' : '') + '>\n';
}

export function listEnd(ordered) {
  return '</' + (ordered ? 'ol' : 'ul') + '>\n';
}

export function listitem(item, body) {
  return '<li>' + body + '</li>\n';
}

export function checkbox(checked) {
  return '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

export function paragraph(token, inline) {
  return '<p>' + inline + '</p>\n';
}

export function table(token, header, body) {
  if (body) body = '<tbody>' + body + '</tbody>';
  return '<table>\n<thead>\n' + header + '</thead>\n' + body + '</table>\n';
}

export function tablerow(text) {
  return '<tr>\n' + text + '</tr>\n';
}

export function tablecell(flags, content) {
  const type = flags.header ? 'th' : 'td';
  const tag = flags.align ? '<' + type + ' align="' + flags.align + '">' : '<' + type + '>';
  return tag + content + '</' + type + '>\n';
}

export function strong(inline) {
  return '<strong>' + inline + '</strong>';
}

export function em(inline) {
  return '<em>' + inline + '</em>';
}

export function codespan(token) {
  return '<code>' + escapeHtmlEntities(token.text, true) + '</code>';
}

export function br() {
  return '<br>';
}

export function del(inline) {
  return '<del>' + inline + '</del>';
}

export function link(token, inline) {
  // references are not resolved inside an autolink, so every & there is literal;
  // elsewhere only an & that cannot start one needs escaping
  const parsedText = token.autolink ? escapeHtmlEntities(token.text, true) : inline;
  const cleanHref = cleanUrl(token.href);
  if (cleanHref === null) {
    return parsedText;
  }
  const href = escapeHtmlEntities(cleanHref, token.autolink);
  let out = '<a href="' + href + '"';
  if (token.title) {
    out += ' title="' + escapeHtmlEntities(token.title) + '"';
  }
  return out + '>' + parsedText + '</a>';
}

export function image(token, altText) {
  const cleanHref = cleanUrl(token.href);
  if (cleanHref === null) {
    return escapeHtmlEntities(altText);
  }
  let out = '<img src="' + escapeHtmlEntities(cleanHref) + '" alt="' + escapeHtmlEntities(altText) + '"';
  if (token.title) {
    out += ' title="' + escapeHtmlEntities(token.title) + '"';
  }
  return out + '>';
}

/**
 * Renderer-text escape.
 *
 * This is the non-encoding form: `<`, `>`, `"`, `'` are replaced, and `&` only
 * when it cannot already be the start of a character reference. Encoding
 * everything would double-escape references that the inline pass produced.
 */
export function text(token, inline) {
  if (inline !== undefined && inline !== null) {
    return inline;
  }
  // a text token that never went through the inline pass is still raw source
  return escapeHtmlEntities(token.text, false);
}
