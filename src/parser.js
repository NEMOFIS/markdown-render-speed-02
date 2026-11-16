// make.fun — markdown-render-speed-02
// Token tree -> HTML.
//
// A flat loop instead of a method dispatch per token: every call site stays
// monomorphic and the hot token types are handled without touching a prototype
// chain. Only composite blocks (blockquote, list) recurse.
import * as R from './render.js';

/**
 * Image alt text is plain text: the label is rendered with the text rules only,
 * so `<em>` markup an emphasis would have produced is dropped rather than
 * escaped, and a link inside the label contributes its text.
 */
function renderPlainText(tokens) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case 'image':
      case 'link':
      case 'strong':
      case 'em':
      case 'del':
        out += renderPlainText(token.tokens);
        break;
      case 'codespan':
        out += token.text;
        break;
      case 'escape':
      case 'html':
      case 'text':
        out += token.text;
        break;
      case 'br':
        out += ' ';
        break;
      case 'checkbox':
        break;
      default:
        out += token.text ?? token.raw ?? '';
    }
  }
  return out;
}

function renderInline(tokens) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      // escape goes through the text renderer, so it is escaped; inline html is
      // passed through untouched
      case 'escape':
        out += R.text(token);
        break;
      case 'html':
        out += R.html(token);
        break;
      case 'text':
        out += R.text(token);
        break;
      case 'link':
        out += R.link(token, renderInline(token.tokens));
        break;
      case 'image':
        out += R.image(token, renderPlainText(token.tokens));
        break;
      case 'strong':
        out += R.strong(renderInline(token.tokens));
        break;
      case 'em':
        out += R.em(renderInline(token.tokens));
        break;
      case 'codespan':
        out += R.codespan(token);
        break;
      case 'br':
        out += R.br();
        break;
      case 'del':
        out += R.del(renderInline(token.tokens));
        break;
      case 'checkbox':
        out += R.checkbox(token.checked);
        break;
      default:
        out += R.text(token);
    }
  }
  return out;
}

function renderBlock(tokens, tight) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'code':
        out += R.code(token);
        break;
      case 'heading':
        out += R.heading(token, renderInline(token.tokens));
        break;
      case 'table':
        out += renderTable(token);
        break;
      case 'hr':
        out += R.hr();
        break;
      case 'blockquote':
        out += R.blockquote(token, renderBlock(token.tokens, false));
        break;
      case 'list':
        out += renderList(token);
        break;
      case 'html':
        out += R.html(token);
        break;
      case 'paragraph':
        out += R.paragraph(token, renderInline(token.tokens));
        break;
      case 'text':
        // A block-level text token is a paragraph only outside a tight list
        // item; inside one it renders bare, which is what makes the list compact.
        out += tight
          ? renderInline(token.tokens)
          : R.paragraph(token, renderInline(token.tokens));
        break;
      case 'checkbox':
        out += R.checkbox(token.checked);
        break;
      default:
        out += token.raw;
    }
  }
  return out;
}

function renderList(token) {
  const tight = !token.loose;
  let items = '';
  for (let i = 0; i < token.items.length; i++) {
    const item = token.items[i];
    items += R.listitem(item, renderBlock(item.tokens, tight));
  }
  return R.listStart(token.ordered, token.start) + items + R.listEnd(token.ordered);
}

function renderTable(token) {
  let header = '';
  for (let i = 0; i < token.header.length; i++) {
    const cell = token.header[i];
    header += R.tablecell({ header: true, align: cell.align }, renderInline(cell.tokens));
  }
  let body = '';
  if (token.rows.length) {
    let rows = '';
    for (let r = 0; r < token.rows.length; r++) {
      const row = token.rows[r];
      let cells = '';
      for (let c = 0; c < row.length; c++) {
        cells += R.tablecell({ header: false, align: row[c].align }, renderInline(row[c].tokens));
      }
      rows += R.tablerow(cells);
    }
    body = rows;
  }
  return R.table(token, R.tablerow(header), body);
}

export function parseTokens(tokens) {
  return renderBlock(tokens, false);
}

export { renderInline, renderBlock };
