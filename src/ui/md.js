/* What an AI writes, drawn as a card (src/ui/chat.js): a small, safe Markdown renderer. Every piece
 * of text is escaped first, and only these tags are added: paragraphs, strong and em, bullet and
 * numbered lists (one level of nesting), small headings (### and ####: a card's, not a page's), a
 * rule, and simple pipe tables (in a box of their own that scrolls sideways when they're wide). No
 * raw HTML, links or images from a model: a link keeps its words, an image goes.
 *
 * A line that's only an embed ([[sleep]], [[weight:90d]]) becomes what o.embed(token) returns: the
 * app draws it from its own data, and '' drops it. One inside a line of text is drawn after that
 * block, and nothing of either ever shows as [[…]] text.
 *
 * o.streaming: an answer still coming in. Whatever is half there is drawn as it will be, or not yet:
 * an unclosed ** is bold up to the end, a list marker with nothing after it waits, a table half
 * there is a table with the rows so far, and an embed or a link that isn't finished waits. So the
 * answer grows in place, with no markup that's broken or there for a moment.
 *
 * GH.md.render(text, o) → HTML; GH.md.plain(text) → the words, for Copy.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  const EMBED = /\[\[([^[\]\n]{1,60})\]\]/g;
  const EMBED_LINE = /^\s*\[\[([^[\]\n]{1,60})\]\]\s*$/;
  const HEAD = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
  const MARKER = /^\s*(?:[-*+•]|\d{1,3}[.)])\s*$/;
  const width = (s) => s.replace(/\t/g, '    ').length;
  // A table's row: its cells, without the pipes at either end.
  function cells(line) {
    const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return t ? t.split('|').map((c) => c.trim()) : [];
  }
  const isSep = (line) => line.includes('|') && cells(line).length > 0 && cells(line).every((c) => /^:?-+:?$/.test(c));

  // Inline marks on one line. open: this line is where the answer is coming in, so a mark it opened
  // and hasn't closed yet is drawn as if closed (and a link or an embed not finished waits).
  function inline(raw, open) {
    let s = String(raw)
      .replace(/!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '') // images go
      .replace(/\[([^\]\n]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1') // a link keeps its words
      .replace(EMBED, '') // drawn after the block
      .replace(/\[\[[^\]\n]*\]?|\]\]|`+|~~/g, ''); // and never a stray [[ or ]]
    // Still coming: a link not finished, and a mark with nothing after it yet, wait.
    if (open) s = s.replace(/!?\[[^\]\n]*(?:\](?:\([^)\n]*)?)?$/, '').replace(/(^|\s)(?:\*{1,2}|_)$/, '$1');
    s = esc(s);
    // **bold**: in pairs; an odd one out is the answer still coming (bold to the end, less the first
    // half of its closing mark) or a slip (dropped).
    const parts = s.split('**');
    const unclosed = parts.length > 1 && parts.length % 2 === 0;
    if (parts.length > 1) {
      let out = '';
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) out += parts[i];
        else if (i < parts.length - 1) out += `<strong>${parts[i]}</strong>`;
        else out += open ? `<strong>${parts[i].replace(/\*$/, '')}</strong>` : parts[i];
      }
      s = out;
    }
    s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
    // An *italic* still coming is italic to the end.
    if (open && !unclosed) s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*)$/, '$1<em>$2</em>').replace(/(^|[\s(])_(?=\S)([^_\n]*)$/, '$1<em>$2</em>');
    return s.trim();
  }

  // The lines as blocks: p, list, h, hr, table, embed. A block can carry embeds found inside its
  // lines (after), drawn when it ends.
  function blocks(text, live) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let cur = null;
    const start = (b) => { out.push(b); cur = b.t === 'p' || b.t === 'list' || b.t === 'table' ? b : null; return b; };
    const carry = (b, line) => { for (const m of line.matchAll(EMBED)) (b.after || (b.after = [])).push(m[1].trim()); };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/^\s{0,3}>\s?/, ''); // a quote is just its words
      const last = live && i === lines.length - 1;
      if (!line.trim()) { cur = null; continue; }
      let m = EMBED_LINE.exec(line);
      if (m) { start({ t: 'embed', token: m[1].trim() }); continue; }
      // Half there: an embed, a heading's marks, a list marker (or its number) with nothing after it yet.
      if (last && (/^\s*\[\[[^\]\n]*\]?\s*$/.test(line) || /^\s*(?:#{1,6}|--|\*\*|__|\d{1,3})\s*$/.test(line) || MARKER.test(line))) continue;
      if (RULE.test(line)) { start({ t: 'hr' }); continue; }
      m = HEAD.exec(line);
      if (m) { if (m[2]) carry(start({ t: 'h', level: m[1].length, text: m[2] }), line); continue; }
      if (/^\s*\|/.test(line) || (line.includes('|') && isSep(lines[i + 1] || ''))) {
        if (!cur || cur.t !== 'table') start({ t: 'table', rows: [] });
        if (!isSep(line)) { const c = cells(line); if (c.length) cur.rows.push(c); }
        continue;
      }
      m = ITEM.exec(line);
      if (m) {
        const ordered = /\d/.test(m[2]);
        const ind = width(m[1]);
        if (cur && cur.t === 'list' && (ind >= cur.base + 2 || cur.ordered === ordered)) {
          cur.items.push({ depth: ind >= cur.base + 2 ? 1 : 0, ordered, text: m[3] });
        } else start({ t: 'list', base: ind, ordered, n: ordered ? parseInt(m[2], 10) : 1, items: [{ depth: 0, ordered, text: m[3] }] });
        carry(cur, line);
        continue;
      }
      // An indented line under a list item carries on that item.
      if (cur && cur.t === 'list' && width(/^\s*/.exec(line)[0]) >= cur.base + 2) {
        const it = cur.items[cur.items.length - 1];
        it.text += ` ${line.trim()}`;
        carry(cur, line);
        continue;
      }
      if (!cur || cur.t !== 'p') start({ t: 'p', lines: [] });
      cur.lines.push(line);
      carry(cur, line);
    }
    return out;
  }

  const NUMERIC = /^[+\-−]?[\d.,]/;
  function table(rows, open) {
    const n = Math.max(...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(n - r.length).fill(''));
    const head = pad(rows[0]);
    const body = rows.slice(1).map(pad);
    // Columns of numbers line up on the right.
    const num = head.map((_, c) => body.length > 0 && body.every((r) => !r[c] || NUMERIC.test(r[c])));
    const cell = (tag, v, c, isOpen) => `<${tag}${num[c] ? ' class="md-num"' : ''}>${inline(v, isOpen)}</${tag}>`;
    const lastRow = rows.length - 1;
    return `<div class="md-table"><table><thead><tr>${head.map((v, c) => cell('th', v, c, open && lastRow === 0)).join('')}</tr></thead>${body.length ? `<tbody>${body.map((r, k) => `<tr>${r.map((v, c) => cell('td', v, c, open && k + 1 === lastRow)).join('')}</tr>`).join('')}</tbody>` : ''}</table></div>`;
  }

  function list(b, open) {
    const tag = (ordered) => (ordered ? 'ol' : 'ul');
    let html = '';
    let sub = null; // the nested list being written
    const lastItem = b.items.length - 1;
    b.items.forEach((it, k) => {
      const words = inline(it.text, open && k === lastItem);
      if (it.depth && html) {
        if (sub == null) { sub = it.ordered; html = html.replace(/<\/li>$/, `<${tag(sub)}>`); }
        html += `<li>${words}</li>`;
        return;
      }
      if (sub != null) { html += `</${tag(sub)}></li>`; sub = null; }
      html += `<li>${words}</li>`;
    });
    if (sub != null) html += `</${tag(sub)}></li>`;
    const startAt = b.ordered && b.n > 1 ? ` start="${b.n}"` : '';
    return `<${tag(b.ordered)}${startAt}>${html}</${tag(b.ordered)}>`;
  }

  function render(text, o) {
    const opt = o || {};
    const live = !!opt.streaming;
    const bl = blocks(text, live);
    const embed = (token) => (opt.embed ? opt.embed(token) || '' : '');
    let html = '';
    bl.forEach((b, k) => {
      const open = live && k === bl.length - 1;
      if (b.t === 'p') {
        const words = b.lines.map((l, j) => inline(l, open && j === b.lines.length - 1)).filter(Boolean);
        if (words.length) html += `<p>${words.join('<br>')}</p>`;
      } else if (b.t === 'list') html += list(b, open);
      else if (b.t === 'h') { const w = inline(b.text, open); if (w) html += b.level >= 4 ? `<h4 class="md-h4">${w}</h4>` : `<h3 class="md-h">${w}</h3>`; }
      else if (b.t === 'hr') html += '<hr class="md-hr">';
      else if (b.t === 'table') { if (b.rows.length) html += table(b.rows, open); }
      else if (b.t === 'embed') html += embed(b.token);
      for (const t of b.after || []) html += embed(t);
    });
    return html;
  }

  // The words without the marks, for Copy: embeds and table rules go, a table's cells are joined
  // with a bar, list markers stay.
  function plain(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split('\n')
      .filter((l) => !EMBED_LINE.test(l) && !isSep(l))
      .map((l) => l.replace(EMBED, '').replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' | ')
        .replace(/!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '').replace(/\[([^\]\n]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1').replace(/\*\*|`+|~~/g, '').replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2').trimEnd())
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  GH.md = { render, plain, esc };
})(typeof window !== 'undefined' ? window : globalThis);
