/**
 * src/lib/wikiImport/platform.ts — NHẬN DIỆN NỀN TẢNG WIKI TỔNG QUÁT (bug 121).
 * ─────────────────────────────────────────────────────────────────────────
 * "Crawler phải tự nhận biết cấu trúc của từng loại wiki thay vì hardcode riêng cho từng
 * website." — nhận diện theo DẤU HIỆU CẤU TRÚC chứ không theo tên miền:
 *   - Họ MediaWiki (Fandom, Wikipedia, wiki.gg, Miraheze, Bulbapedia, Yugipedia, tự host…):
 *     đường dẫn /wiki/<Trang>, có api.php. Một họ — MỘT bộ đọc.
 *   - Baidu Baike: /item/<mục> — HTML thuần, không có API công khai.
 *   - Còn lại: generic HTML (Wiki.js, docs site…).
 * Tên miền chỉ dùng làm heuristic NHANH; xác nhận thật khi fetch (api.php trả JSON hay không).
 */

import type { WikiPlatform } from './types';

export interface PlatformInfo {
  platform: WikiPlatform;
  /** Origin của wiki (https://host). */
  origin: string;
  /** Base URL của api.php nếu là mediawiki (đoán — cần probe xác nhận). */
  apiBase?: string;
  /** Tiền tố đường dẫn bài viết ('/wiki/' | '/item/' | '/'). */
  articlePathPrefix: string;
}

/** Các host chắc chắn thuộc họ MediaWiki (heuristic nhanh, không phải danh sách đóng). */
const MEDIAWIKI_HOST_HINTS = [
  '.fandom.com', '.wikipedia.org', '.wiki.gg', '.miraheze.org',
  'bulbagarden.net', 'yugipedia.com', 'mediawiki.org', 'minecraft.wiki',
];

export function detectPlatform(urlStr: string): PlatformInfo {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error(`URL không hợp lệ: ${urlStr}`);
  }
  const host = u.hostname.toLowerCase();
  const origin = `${u.protocol}//${u.host}`;

  if (host === 'baike.baidu.com') {
    return { platform: 'baidu', origin, articlePathPrefix: '/item/' };
  }

  const looksMediaWiki =
    MEDIAWIKI_HOST_HINTS.some(h => host.endsWith(h) || host.includes(h)) ||
    u.pathname.startsWith('/wiki/') ||
    /[?&]title=/.test(u.search);

  if (looksMediaWiki) {
    return {
      platform: 'mediawiki',
      origin,
      apiBase: `${origin}/api.php`,
      articlePathPrefix: '/wiki/',
    };
  }

  return { platform: 'generic', origin, articlePathPrefix: '/' };
}

/**
 * Normalize một URL bài viết để dedup: bỏ #fragment, bỏ query rác (utm, veaction, oldid…),
 * decode phần trăm, bỏ / thừa cuối. Hai URL cùng bài phải ra CÙNG một chuỗi — không thì
 * visited-set thủng và cào trùng trang.
 */
export function normalizeArticleUrl(urlStr: string): string {
  let u: URL;
  try { u = new URL(urlStr); } catch { return urlStr; }
  u.hash = '';
  // Query rác không đổi nội dung bài.
  const junk = ['utm_source', 'utm_medium', 'utm_campaign', 'veaction', 'action', 'oldid', 'diff', 'redirect', 'so', 'fr', 'fromModule', 'fromtitle', 'from'];
  for (const k of junk) u.searchParams.delete(k);
  if ([...u.searchParams.keys()].length === 0) u.search = '';
  let out = u.toString().replace(/\/+$/, '');
  try { out = decodeURI(out); } catch { /* giữ nguyên khi decode lỗi */ }
  return out;
}

/**
 * Link nội bộ này có phải BÀI VIẾT đáng cào không (bug 121: cấm user/talk/edit/history/
 * special/file/category rỗng/discussion…). Namespace meta của MediaWiki nhận diện theo
 * tiền tố "Ns:"; Baidu và generic lọc theo pattern đường dẫn.
 */
const MW_META_NS = [
  'special', 'talk', 'user', 'user talk', 'user blog', 'user blog comment', 'file', 'image',
  'template', 'template talk', 'category talk', 'help', 'help talk', 'mediawiki', 'module',
  'forum', 'board', 'message wall', 'thread', 'blog', 'portal', 'project', 'draft',
  // bản địa hoá hay gặp
  'thảo luận', 'thành viên', 'tập tin', 'bản mẫu', 'trợ giúp', '特殊', '讨论', '用户', '模板', '帮助', '文件',
];

export function isArticleLink(urlStr: string, wiki: PlatformInfo): boolean {
  let u: URL;
  try { u = new URL(urlStr); } catch { return false; }
  // Cùng wiki — không đi external (bug 121: "Không crawl external links").
  if (`${u.protocol}//${u.host}` !== wiki.origin) return false;

  const path = decodeURIComponent(u.pathname);

  if (wiki.platform === 'baidu') {
    return path.startsWith('/item/') && path.length > '/item/'.length;
  }

  if (wiki.platform === 'mediawiki') {
    if (!path.startsWith('/wiki/')) return false;
    const title = path.slice('/wiki/'.length);
    if (!title) return false;
    // Namespace meta: "Special:...", "User:...", "Thảo luận:..."
    const nsMatch = title.match(/^([^/:]+):/);
    if (nsMatch && MW_META_NS.includes(nsMatch[1].replace(/_/g, ' ').toLowerCase())) return false;
    // Category GIỮ để crawler bóc member rồi bỏ chính nó (không thành PageDoc).
    // action=edit / oldid… đã bị normalize bỏ query, nhưng chặn thêm cho chắc:
    if (/[?&](action|veaction|oldid|diff)=/.test(u.search)) return false;
    return true;
  }

  // generic: cùng origin, không phải asset tĩnh, không phải anchor-only.
  if (/\.(png|jpe?g|gif|svg|webp|css|js|ico|pdf|zip|mp[34])$/i.test(path)) return false;
  if (/\/(login|signup|register|search|tag|feed|rss)\b/i.test(path)) return false;
  return path.length > 1;
}

/** Title có phải category không (để bóc member thay vì tạo entry từ chính nó). */
export function isCategoryUrl(urlStr: string): boolean {
  try {
    const path = decodeURIComponent(new URL(urlStr).pathname);
    return /^\/wiki\/(category|thể loại|分类|カテゴリ):/i.test(path);
  } catch { return false; }
}
