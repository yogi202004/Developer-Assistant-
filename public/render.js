// Renders the assistant's Discord-style markdown to HTML. Everything is escaped first;
// only http(s) links are turned into anchors.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const TOKEN = new RegExp(
  [
    String.raw`\[([^\]\n]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)`, // [text](url) or [text](<url>)
    String.raw`<(https?:\/\/[^\s>]+)>`, // <url>
    String.raw`(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])`, // bare url
    String.raw`\*\*([^*\n]+?)\*\*`, // **bold**
    String.raw`\x60([^\x60\n]+)\x60`, // `code`
    String.raw`(?<![\w*])_([^_\n]+)_(?![\w])`, // _italic_
  ].join('|'),
  'g',
);

const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;

export function inline(raw) {
  let out = '';
  let last = 0;
  for (const m of String(raw).matchAll(TOKEN)) {
    out += esc(raw.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) out += link(m[2], esc(m[1]));
    else if (m[3]) out += link(m[3], esc(m[3]));
    else if (m[4]) out += link(m[4], esc(m[4]));
    else if (m[5]) out += `<strong>${inline(m[5])}</strong>`;
    else if (m[6]) out += `<code>${esc(m[6])}</code>`;
    else if (m[7]) out += `<em>${inline(m[7])}</em>`;
  }
  return out + esc(String(raw).slice(last));
}

function blocks(text) {
  const html = [];
  let list = null; // { tag, items }
  let para = [];
  const flushPara = () => { if (para.length) html.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
  const flush = () => { flushPara(); flushList(); };

  for (const line of text.split('\n')) {
    const t = line.trim();
    let m;
    if (!t) { flush(); continue; }
    if (/^[─—-]{4,}$/.test(t)) { flush(); html.push('<hr>'); continue; }
    if ((m = /^#{1,6}\s+(.*)$/.exec(t))) { flush(); html.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(t))) { flush(); html.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = /^(?:[-*•]|\[[ x]\])\s+(.*)$/.exec(t))) {
      flushPara();
      if (list?.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) {
      flushPara();
      if (list?.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    flushList();
    para.push(t);
  }
  flush();
  return html.join('');
}

/** Markdown string -> safe HTML string. Fenced code blocks get a Copy button. */
export function md(text) {
  const parts = String(text ?? '').split(/```[\w-]*\n?([\s\S]*?)```/g);
  return parts
    .map((p, i) => (i % 2
      ? `<div class="codeblock"><button type="button" class="copy-btn" data-copy>Copy</button><pre><code>${esc(p.replace(/\n$/, ''))}</code></pre></div>`
      : blocks(p)))
    .join('');
}
