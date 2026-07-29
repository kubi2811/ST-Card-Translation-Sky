/**
 * guideMarkdown.ts — (bug 157) Render tài liệu Hướng dẫn của hub.
 * ─────────────────────────────────────────────────────────────────────────────
 * Tại sao KHÔNG dùng lại bộ render của Tạo Card: bộ đó xuất class Tailwind, còn hub thì tô màu
 * bằng CSS variable — bê nguyên sang là chữ đen trên nền đen. Nên viết riêng một bộ nhỏ, chỉ đủ
 * cho những gì USER_GUIDE.md thật sự dùng: tiêu đề, đoạn, danh sách, bảng, trích dẫn, đậm, mã.
 *
 * Thuần chuỗi → chuỗi, không đụng DOM, nên test được thẳng.
 */

/** Bỏ dấu + thường hoá — dùng cho ô tìm kiếm, gõ không dấu vẫn ra. */
export function foldVi(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Định dạng trong dòng: `mã`, **đậm**, *nghiêng*. Chạy SAU khi đã escape. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code class="ig-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

export interface GuideHeading { id: string; text: string; level: number }

/** Id ổn định cho mục lục — giữ chữ có dấu để không đụng nhau khi bỏ dấu trùng. */
export function headingId(text: string): string {
  return foldVi(text).replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
}

export function extractHeadings(md: string): GuideHeading[] {
  const out: GuideHeading[] = [];
  let inCode = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
    out.push({ id: headingId(text), text, level: m[1].length });
  }
  return out;
}

/**
 * Markdown → HTML. Chỉ phủ cú pháp mà tài liệu thật dùng — cố tình KHÔNG viết một bộ parse
 * markdown đầy đủ: tài liệu này do chính repo kiểm soát, thêm cú pháp lạ là việc của người sửa
 * tài liệu chứ không phải rủi ro cần phòng.
 */
export function renderGuide(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inCode = false;
  let code: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let table: string[][] | null = null;
  let quote: string[] | null = null;

  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const closeTable = () => {
    if (!table || !table.length) { table = null; return; }
    const [head, ...body] = table;
    html += '<div class="ig-tablewrap"><table class="ig-table"><thead><tr>'
      + head.map(c => `<th>${inline(c)}</th>`).join('')
      + '</tr></thead><tbody>'
      + body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
      + '</tbody></table></div>';
    table = null;
  };
  const closeQuote = () => {
    if (!quote) return;
    html += `<blockquote class="ig-quote">${quote.map(q => inline(q)).join('<br/>')}</blockquote>`;
    quote = null;
  };
  const closeAll = () => { closeList(); closeTable(); closeQuote(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();

    if (t.startsWith('```')) {
      if (inCode) { html += `<pre class="ig-pre">${esc(code.join('\n'))}</pre>`; code = []; inCode = false; }
      else { closeAll(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }

    if (!t) { closeAll(); continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      closeAll();
      const text = h[2].replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
      const lv = h[1].length;
      html += `<h${lv} id="guide-${headingId(text)}" class="ig-h${lv}">${inline(h[2])}</h${lv}>`;
      continue;
    }

    if (t === '---') { closeAll(); html += '<hr class="ig-hr"/>'; continue; }

    if (t.startsWith('>')) {
      closeList(); closeTable();
      (quote ??= []).push(t.replace(/^>\s?/, ''));
      continue;
    }
    closeQuote();

    // Bảng: | a | b |  và dòng ngăn |---|---|
    if (t.startsWith('|') && t.endsWith('|')) {
      closeList();
      const cells = t.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;   // dòng ngăn — bỏ
      (table ??= []).push(cells);
      continue;
    }
    closeTable();

    const ol = /^(\d+)\.\s+(.*)$/.exec(t);
    if (ol) {
      if (list !== 'ol') { closeList(); html += '<ol class="ig-ol">'; list = 'ol'; }
      html += `<li>${inline(ol[2])}</li>`;
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(t);
    if (ul) {
      if (list !== 'ul') { closeList(); html += '<ul class="ig-ul">'; list = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
      continue;
    }
    closeList();

    html += `<p class="ig-p">${inline(t)}</p>`;
  }
  closeAll();
  if (inCode && code.length) html += `<pre class="ig-pre">${esc(code.join('\n'))}</pre>`;
  return html;
}

/**
 * Lọc tài liệu theo từ khoá — giữ nguyên MỤC nào có khớp (theo tiêu đề hoặc nội dung).
 * Lọc theo MỤC chứ không theo dòng: một dòng lẻ tách khỏi tiêu đề của nó thì đọc không hiểu gì.
 */
export function filterGuide(md: string, query: string): string {
  const q = foldVi(query.trim());
  if (!q) return md;
  const lines = md.split('\n');
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (/^#{1,3}\s+/.test(l.trim()) && cur.length) { blocks.push(cur); cur = []; }
    cur.push(l);
  }
  if (cur.length) blocks.push(cur);
  const hit = blocks.filter(b => foldVi(b.join('\n')).includes(q));
  return hit.length ? hit.map(b => b.join('\n')).join('\n\n') : '';
}
