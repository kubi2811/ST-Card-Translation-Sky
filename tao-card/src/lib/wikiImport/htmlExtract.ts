/**
 * src/lib/wikiImport/htmlExtract.ts — HTML BÀI WIKI → PageDoc (bug 121: CONTENT EXTRACTION).
 * ─────────────────────────────────────────────────────────────────────────
 * Phải đọc được cả infobox, bảng, danh sách, section gập — "không bỏ sót nội dung quan trọng
 * chỉ vì nằm trong template", đồng thời vứt rác (nav, script, edit-link, reference marker).
 * Chạy trong trình duyệt nên dùng DOMParser; có fallback regex khi môi trường không có DOM
 * (test node) — cùng một hợp đồng đầu ra.
 */

import type { PageDoc, WikiPlatform } from './types';
import type { PlatformInfo } from './platform';
import { isArticleLink, normalizeArticleUrl } from './platform';

/** Selector các khối RÁC cần gỡ trước khi lấy chữ (chung cho mọi nền tảng). */
const JUNK_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  '.mw-editsection', '.reference', '.references', 'sup.reference', 'ol.references',
  '.navbox', '.vertical-navbox', '.sidebar-navbox', '.toc', '#toc', '.mw-jump-link',
  '.printfooter', '.catlinks + *', '.wikia-gallery', '.gallery',
  '.top-ads-container', '.bottom-ads-container', '[class*="advert"]',
  '.lemma-relation', '.side-content', '.right-ad', '.header-wrapper', 'header', 'footer', 'nav',
  '.page-footer', '.global-footer', '.comments', '#comments', '.talk',
];

/** Bảng → text dạng "cột: giá trị" từng hàng — giữ dữ liệu, bỏ khung. */
function tableToText(table: HTMLTableElement): string {
  const rows: string[] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.querySelectorAll('th,td')).map(c => (c.textContent || '').trim()).filter(Boolean);
    if (cells.length) rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

/** Infobox (aside.portable-infobox của Fandom, table.infobox của MediaWiki, .basic-info của Baidu). */
function extractInfobox(root: ParentNode): Record<string, string> {
  const out: Record<string, string> = {};
  const push = (k: string, v: string) => {
    const key = k.trim(), val = v.trim();
    if (key && val && key.length < 60 && !out[key]) out[key] = val.slice(0, 400);
  };
  // Fandom portable infobox
  for (const item of Array.from(root.querySelectorAll('.portable-infobox .pi-item.pi-data'))) {
    const label = item.querySelector('.pi-data-label')?.textContent || '';
    const value = item.querySelector('.pi-data-value')?.textContent || '';
    push(label, value);
  }
  // MediaWiki classic infobox
  for (const tr of Array.from(root.querySelectorAll('table.infobox tr'))) {
    const th = tr.querySelector('th')?.textContent || '';
    const td = tr.querySelector('td')?.textContent || '';
    push(th, td);
  }
  // Baidu basic-info
  for (const dt of Array.from(root.querySelectorAll('[class*="basicInfo"] dt, .basic-info dt'))) {
    const dd = dt.nextElementSibling;
    push(dt.textContent || '', dd?.textContent || '');
  }
  return out;
}

/** Trích PageDoc từ HTML đầy đủ của một bài. */
export function extractPageDoc(
  html: string,
  pageUrl: string,
  wiki: PlatformInfo,
  depth: number,
): PageDoc | null {
  if (typeof DOMParser === 'undefined') return extractPageDocRegex(html, pageUrl, wiki.platform, depth);

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Vùng nội dung chính theo nền tảng — rơi về body nếu không thấy.
  const content: ParentNode =
    doc.querySelector('#mw-content-text') ||         // MediaWiki/Fandom/wiki.gg/Miraheze
    doc.querySelector('.mw-parser-output') ||
    doc.querySelector('[class*="J-lemma-content"], .lemma-summary')?.parentElement ||  // Baidu
    doc.querySelector('main') || doc.querySelector('article') || doc.body;

  const title =
    doc.querySelector('#firstHeading')?.textContent?.trim() ||
    doc.querySelector('h1')?.textContent?.trim() ||
    (doc.title || '').replace(/ [-|–|] .+$/, '').trim();
  if (!title) return null;

  // Bí danh: dòng đầu in đậm (MediaWiki convention) + redirect note + Baidu 又名
  const aliases = new Set<string>();
  for (const b of Array.from(content.querySelectorAll('p b, p strong')).slice(0, 8)) {
    const t = (b.textContent || '').trim();
    if (t && t.length <= 60 && t !== title) aliases.add(t);
  }

  const infobox = extractInfobox(doc);
  for (const [k, v] of Object.entries(infobox)) {
    if (/alias|other name|khác|又名|别名|異名|romaji|japanese|kanji|english|tên/i.test(k) && v.length <= 80) {
      v.split(/[,、;／/]/).map(s => s.trim()).filter(s => s && s.length <= 60).forEach(s => aliases.add(s));
    }
  }

  // Link nội bộ — lọc bằng isArticleLink, normalize để dedup.
  const links = new Set<string>();
  for (const a of Array.from(content.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) continue;
    let abs: string;
    try { abs = new URL(href, pageUrl).toString(); } catch { continue; }
    if (isArticleLink(abs, wiki)) links.add(normalizeArticleUrl(abs));
  }

  // Categories (chân trang MediaWiki; Baidu: lemma tags)
  const categories: string[] = [];
  for (const a of Array.from(doc.querySelectorAll('#catlinks a, .page-header__categories a, [class*="lemma"] [class*="tag"] a'))) {
    const t = (a.textContent || '').trim();
    if (t && !/^(category|thể loại|分类)$/i.test(t)) categories.push(t);
  }

  // Gỡ rác rồi lấy chữ theo thứ tự tài liệu; bảng đi qua tableToText.
  for (const sel of JUNK_SELECTORS) {
    for (const el of Array.from((content as Element).querySelectorAll?.(sel) ?? [])) el.remove();
  }
  const parts: string[] = [];
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'table') {
        const t = tableToText(child as HTMLTableElement);
        if (t) parts.push(t);
        continue;
      }
      if (/^h[1-6]$/.test(tag)) {
        const t = (child.textContent || '').trim();
        if (t) parts.push(`\n== ${t} ==`);
        continue;
      }
      if (['p', 'li', 'dd', 'dt', 'blockquote', 'caption'].includes(tag)) {
        const t = (child.textContent || '').replace(/\[\d+\]|\[edit\]|\[sửa[^\]]*\]/gi, '').trim();
        if (t) parts.push(t);
        continue;
      }
      walk(child);
    }
  };
  walk(content as Element);
  const text = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 80) return null;   // trang rỗng/stub — bỏ (bug 121: không entry vô nghĩa)

  return {
    url: normalizeArticleUrl(pageUrl), title, aliases: [...aliases].slice(0, 12),
    text: text.slice(0, 60000), infobox, links: [...links], categories,
    platform: wiki.platform, depth,
  };
}

/* ─── Fallback không-DOM (node test): đủ dùng cho title/links/text thô ─── */
function extractPageDocRegex(html: string, pageUrl: string, platform: WikiPlatform, depth: number): PageDoc | null {
  const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/<[^>]+>/g, '').replace(/ [-|–|] .+$/, '').trim();
  if (!title) return null;
  let body = html
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n');
  body = body.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length < 80) return null;
  const links: string[] = [];
  for (const m of html.matchAll(/href="([^"#]+)"/g)) {
    try { links.push(normalizeArticleUrl(new URL(m[1], pageUrl).toString())); } catch { /* bỏ */ }
  }
  return {
    url: normalizeArticleUrl(pageUrl), title, aliases: [], text: body.slice(0, 60000),
    infobox: {}, links: [...new Set(links)], categories: [], platform, depth,
  };
}
