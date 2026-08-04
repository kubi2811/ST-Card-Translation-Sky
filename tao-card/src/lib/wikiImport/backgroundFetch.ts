/**
 * src/lib/wikiImport/backgroundFetch.ts — (bug 210) KIẾN THỨC NỀN LẤY THẲNG TỪ LINK DÁN VÀO.
 * ─────────────────────────────────────────────────────────────────────────
 * Ô "Kiến thức nền" ở Tạo thẻ từ truyện trước đây CHỈ nhận từ khoá rồi ném qua
 * `cascadeSearch` (DuckDuckGo → Wikipedia → Fandom → Wiktionary). Đó là cầu may, và đo được
 * bằng chính ảnh user gửi: gõ "lord of the mysterious" thì Wikipedia tiếng Việt trả về
 * "Những đứa con của thuyền trưởng Grant" của Jules Verne — sai hoàn toàn, mà tool vẫn nhét
 * nguyên đoạn đó vào làm nền cho cả lượt sinh entry. Sai kiểu này KHÔNG có dấu hiệu gì:
 * người dùng chỉ thấy một hộp chữ đầy đặn và tin là đúng.
 *
 * Người dùng thì luôn biết trang wiki nào đúng — họ đang đọc nó. Nên đường đi đúng là để họ
 * DÁN LINK, và tool cào đúng trang đó. Không đoán, không xếp hạng, không "kết quả tốt nhất".
 *
 * Dùng lại nguyên bộ cào có sẵn (bug 121/133/135): FetchClient nhiều đường đi (mw-api CORS-safe
 * → proxy nội bộ → direct → proxy công cộng) + htmlExtract. Nghĩa là link Fandom/Wikipedia/
 * wiki.gg/Miraheze/Baidu đều chạy đúng như tab Web Crawler, không phải một đường ống thứ hai.
 */

import { FetchClient } from './fetchClient';
import { detectPlatform, normalizeArticleUrl } from './platform';
import { extractPageDoc } from './htmlExtract';
import type { FetchLike } from './types';

export interface WikiBackgroundSource {
  title: string;
  url: string;
  text: string;
}

export interface WikiBackgroundResult {
  sources: WikiBackgroundSource[];
  /** Trang tải/bóc không được — nêu đích danh để người dùng biết đường nào hỏng. */
  failed: Array<{ url: string; why: string }>;
}

/** Tối đa số trang cào một lần bấm — dán cả chục link thì cũng không treo UI. */
const MAX_PAGES = 8;
/** Trần ký tự của cả khối kiến thức nền (khớp với trần cũ của đường từ khoá). */
const MAX_CHARS = 12000;

/**
 * Một mẩu người dùng gõ có phải LINK không.
 * Nhận cả dạng thiếu giao thức (`abc.fandom.com/wiki/X`) vì copy từ thanh địa chỉ hay rụng
 * `https://`. Bắt buộc phải có dấu chấm trong tên miền VÀ có đường dẫn/`www`, để "V.League"
 * hay "Chương 1. Mở đầu" không bị hiểu nhầm thành link.
 */
export function looksLikeUrl(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (/^https?:\/\/\S+$/i.test(t)) return true;
  return /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+$/i.test(t);
}

/** Thêm giao thức cho link viết tắt; link đã có giao thức thì giữ nguyên. */
export function toAbsoluteUrl(token: string): string {
  const t = token.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/**
 * Tách nội dung ô nhập thành DANH SÁCH LINK và phần từ khoá còn lại.
 * Ngăn cách bằng xuống dòng hoặc khoảng trắng — người dán nhiều link luôn xuống dòng, còn
 * dấu phẩy thì nằm ngay trong tên bài wiki nên KHÔNG được dùng làm dấu ngăn.
 */
export function splitWikiRefs(input: string): { urls: string[]; keyword: string } {
  const tokens = String(input ?? '').split(/\s+/).filter(Boolean);
  const urls: string[] = [];
  const rest: string[] = [];
  for (const t of tokens) {
    if (looksLikeUrl(t)) urls.push(normalizeArticleUrl(toAbsoluteUrl(t)));
    else rest.push(t);
  }
  // Cùng một trang dán hai lần thì chỉ cào một lần.
  return { urls: [...new Set(urls)], keyword: rest.join(' ').trim() };
}

/**
 * Cào ĐÚNG những trang được dán vào. Một trang hỏng không giết cả lượt — nó đi vào `failed`
 * kèm lý do thật, các trang còn lại vẫn về.
 */
export async function fetchWikiBackground(
  urls: string[],
  opts: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    maxPages?: number;
    /** Giãn cách tối thiểu giữa 2 request cùng host — chỉ hạ xuống trong test. */
    minHostIntervalMs?: number;
  } = {},
): Promise<WikiBackgroundResult> {
  const client = new FetchClient({ fetchImpl: opts.fetchImpl, minHostIntervalMs: opts.minHostIntervalMs });
  const sources: WikiBackgroundSource[] = [];
  const failed: WikiBackgroundResult['failed'] = [];

  for (const url of urls.slice(0, opts.maxPages ?? MAX_PAGES)) {
    if (opts.signal?.aborted) break;
    try {
      const wiki = detectPlatform(url);
      const html = await client.get(url, opts.signal);
      if (!html) {
        const why = client.failureReasons().join(' · ') || 'không tải được';
        failed.push({ url, why });
        continue;
      }
      const doc = extractPageDoc(html, url, wiki, 0);
      if (!doc || !doc.text.trim()) {
        failed.push({ url, why: 'tải được nhưng không bóc ra chữ nào' });
        continue;
      }
      sources.push({ title: doc.title, url, text: doc.text.trim() });
    } catch (e) {
      if (opts.signal?.aborted) break;
      failed.push({ url, why: e instanceof Error ? e.message : String(e) });
    }
  }

  return { sources, failed };
}

/**
 * Ghép thành khối kiến thức nền. GHI KÈM URL từng nguồn — đó là thứ duy nhất cho người dùng
 * thấy ngay tool đã lấy đúng trang hay chưa (bệnh của bản cũ là im lặng lấy nhầm).
 * Chia đều hạn mức cho các nguồn để một trang dài không nuốt hết chỗ của các trang sau.
 */
export function formatWikiDigest(sources: WikiBackgroundSource[], maxChars = MAX_CHARS): string {
  if (sources.length === 0) return '';
  const budget = Math.max(400, Math.floor(maxChars / sources.length));
  return sources
    .map((s) => {
      const body = s.text.length > budget ? `${s.text.slice(0, budget)}…` : s.text;
      return `【${s.title}】${s.url}\n${body}`;
    })
    .join('\n\n')
    .slice(0, maxChars);
}
