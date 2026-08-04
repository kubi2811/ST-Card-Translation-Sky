/**
 * (bug 210) "Tra wiki vẫn còn sai — nên cho dán link vào để cào chứ đừng đưa từ khoá ra cầu may."
 * ─────────────────────────────────────────────────────────────────────────
 * Ca thật user gửi ảnh: ô Kiến thức nền gõ "lord of the mysterious" (Lord of the Mysteries),
 * tool nhả ra bài Wikipedia tiếng Việt về "Những đứa con của thuyền trưởng Grant" của Jules
 * Verne rồi lặng lẽ dùng nó làm nền cho cả lượt sinh entry.
 *
 * Test ở đây kiểm ĐƯỜNG MỚI: dán link thì cào đúng trang đó, một link hỏng không giết cả
 * lượt, và khối kiến thức nền luôn mang theo URL để nhìn phát là biết lấy đúng hay sai.
 * fetch inject nên chạy không cần mạng.
 */
import { describe, it, expect } from 'vitest';
import {
  splitWikiRefs, looksLikeUrl, toAbsoluteUrl, fetchWikiBackground, formatWikiDigest,
} from '../backgroundFetch';
import type { FetchLike } from '../types';

const page = (title: string, body: string) => `<!DOCTYPE html><html><head><title>${title}</title></head>
<body><h1 id="firstHeading">${title}</h1>
<div id="mw-content-text"><div class="mw-parser-output"><p>${body}</p></div></div>
</body></html>`;

const SITE: Record<string, string> = {
  'https://lordofthemysteries.fandom.com/wiki/Klein_Moretti': page(
    'Klein Moretti',
    `Klein Moretti là nhân vật chính của Lord of the Mysteries. ${'Anh là một Beyonder đi con đường Seer và sau đó là Fool. '.repeat(6)}`,
  ),
  'https://lordofthemysteries.fandom.com/wiki/Beyonder': page(
    'Beyonder',
    `Beyonder là người đã nuốt ma dược và bước lên con đường phi phàm. ${'Mỗi Sequence có một quyền năng riêng. '.repeat(6)}`,
  ),
};

const fakeFetch: FetchLike = async (url) => {
  // Bóc URL thật khỏi mọi lớp vỏ proxy / api.php mà FetchClient có thể dựng.
  let real = url;
  const q = url.match(/[?&](?:url|value)=([^&]+)/);
  if (q) real = decodeURIComponent(q[1]);
  const mw = url.match(/^(https?:\/\/[^/]+)\/api\.php\?.*\bpage=([^&]+)/);
  if (mw) real = `${mw[1]}/wiki/${decodeURIComponent(mw[2])}`;
  const local = url.match(/^\/api\/cors-proxy\/(.+)$/);
  if (local) real = decodeURIComponent(local[1]);

  const body = SITE[real];
  if (body === undefined) return { ok: false, status: 404, url: real, text: async () => 'not found' };
  // Đường mw-api trả JSON; các đường khác trả HTML thô. Cả hai phải ra cùng một kết quả.
  if (mw) {
    return {
      ok: true, status: 200, url,
      text: async () => JSON.stringify({ parse: { title: real.split('/wiki/')[1].replace(/_/g, ' '), text: body } }),
    };
  }
  return { ok: true, status: 200, url, text: async () => body };
};

describe('(bug 210) tách link ra khỏi từ khoá', () => {
  it('link đầy đủ, link thiếu giao thức, và từ khoá thường được phân loại đúng', () => {
    const r = splitWikiRefs(
      'https://lordofthemysteries.fandom.com/wiki/Klein_Moretti\nlordofthemysteries.fandom.com/wiki/Beyonder\nlord of the mysteries',
    );
    expect(r.urls).toHaveLength(2);
    expect(r.urls[0]).toContain('/wiki/Klein_Moretti');
    expect(r.urls[1]).toBe('https://lordofthemysteries.fandom.com/wiki/Beyonder');
    expect(r.keyword).toBe('lord of the mysteries');
  });

  it('chữ có dấu chấm KHÔNG bị hiểu nhầm thành link', () => {
    for (const s of ['V.League', 'Chương', 'Mr.', 'lord of the mysterious', '诡秘之主']) {
      expect(looksLikeUrl(s), s).toBe(false);
    }
    expect(splitWikiRefs('lord of the mysterious').urls).toEqual([]);
  });

  it('cùng một trang dán hai lần chỉ cào một lần', () => {
    const r = splitWikiRefs(
      'https://a.fandom.com/wiki/X https://a.fandom.com/wiki/X#Lich_su https://a.fandom.com/wiki/X/',
    );
    expect(r.urls).toHaveLength(1);
  });

  it('toAbsoluteUrl chỉ thêm giao thức khi thiếu', () => {
    expect(toAbsoluteUrl('a.fandom.com/wiki/X')).toBe('https://a.fandom.com/wiki/X');
    expect(toAbsoluteUrl('http://a.fandom.com/wiki/X')).toBe('http://a.fandom.com/wiki/X');
  });
});

describe('(bug 210) cào đúng trang được dán', () => {
  it('hai link ⇒ hai nguồn, đúng tên bài, có chữ', async () => {
    const { sources, failed } = await fetchWikiBackground(
      ['https://lordofthemysteries.fandom.com/wiki/Klein_Moretti',
        'https://lordofthemysteries.fandom.com/wiki/Beyonder'],
      { fetchImpl: fakeFetch },
    );
    expect(failed).toEqual([]);
    expect(sources.map(s => s.title)).toEqual(['Klein Moretti', 'Beyonder']);
    expect(sources[0].text).toContain('Lord of the Mysteries');
    expect(sources[1].text).toContain('Beyonder');
  });

  it('một link chết KHÔNG giết cả lượt — link còn lại vẫn về, kèm lý do hỏng', async () => {
    const { sources, failed } = await fetchWikiBackground(
      ['https://lordofthemysteries.fandom.com/wiki/Khong_Ton_Tai',
        'https://lordofthemysteries.fandom.com/wiki/Klein_Moretti'],
      { fetchImpl: fakeFetch },
    );
    expect(sources.map(s => s.title)).toEqual(['Klein Moretti']);
    expect(failed).toHaveLength(1);
    expect(failed[0].why).toBeTruthy();
  });

  it('URL rác báo hỏng chứ không ném vỡ cả lượt', async () => {
    const { sources, failed } = await fetchWikiBackground(['không-phải-url'], { fetchImpl: fakeFetch });
    expect(sources).toEqual([]);
    expect(failed).toHaveLength(1);
  });

  it('chặn trần số trang để dán cả chục link cũng không treo', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://lordofthemysteries.fandom.com/wiki/P${i}`);
    const { sources, failed } = await fetchWikiBackground(many, { fetchImpl: fakeFetch, maxPages: 3, minHostIntervalMs: 0 });
    expect(sources.length + failed.length).toBe(3);
  });
});

describe('(bug 210) khối kiến thức nền luôn nói rõ nó lấy từ đâu', () => {
  it('mỗi nguồn có tên bài + URL', async () => {
    const { sources } = await fetchWikiBackground(
      ['https://lordofthemysteries.fandom.com/wiki/Klein_Moretti'],
      { fetchImpl: fakeFetch },
    );
    const digest = formatWikiDigest(sources);
    expect(digest).toContain('【Klein Moretti】');
    expect(digest).toContain('https://lordofthemysteries.fandom.com/wiki/Klein_Moretti');
  });

  it('một trang dài không nuốt hết hạn mức của các trang sau', () => {
    const digest = formatWikiDigest([
      { title: 'Dài', url: 'https://a/1', text: 'x'.repeat(50000) },
      { title: 'Ngắn', url: 'https://a/2', text: 'nội dung ngắn nhưng phải còn' },
    ], 4000);
    expect(digest).toContain('【Ngắn】');
    expect(digest).toContain('nội dung ngắn nhưng phải còn');
    expect(digest.length).toBeLessThanOrEqual(4000);
  });

  it('không có nguồn nào thì trả chuỗi rỗng, không trả khung rỗng', () => {
    expect(formatWikiDigest([])).toBe('');
  });
});
