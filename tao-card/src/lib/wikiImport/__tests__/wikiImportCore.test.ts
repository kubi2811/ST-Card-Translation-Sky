import { describe, it, expect } from 'vitest';
import { detectPlatform, normalizeArticleUrl, isArticleLink, isCategoryUrl } from '../platform';
import { partitionPages, buildBatchSource, createClaimStore } from '../coordinator';
import { FactIndex } from '../factIndex';
import { initCrawlState } from '../crawler';
import type { PageDoc } from '../types';

/**
 * (bug 120/121/122) Core của bộ Wiki Importer mới — test trên ĐÚNG danh sách URL mẫu trong
 * yêu cầu 121 (Fandom / MediaWiki / wiki.gg / Miraheze / Baidu).
 */

describe('detectPlatform — nhận diện tổng quát, không hardcode từng site', () => {
  const MW_URLS = [
    'https://pokemon.fandom.com/wiki/Pokémon_Wiki',
    'https://naruto.fandom.com/wiki/Narutopedia',
    'https://marvel.fandom.com/wiki/Marvel_Database',
    'https://starwars.fandom.com/wiki/Wookieepedia',
    'https://onepiece.fandom.com/wiki/One_Piece_Wiki',
    'https://genshin-impact.fandom.com/wiki/Genshin_Impact_Wiki',
    'https://eldenring.fandom.com/wiki/Elden_Ring_Wiki',
    'https://en.wikipedia.org/wiki/Pokémon',
    'https://bulbapedia.bulbagarden.net/wiki/Main_Page',
    'https://yugipedia.com/wiki/Main_Page',
    'https://www.mediawiki.org/wiki/MediaWiki',
    'https://minecraft.wiki/',
    'https://terraria.wiki.gg/wiki/Terraria_Wiki',
    'https://valheim.wiki.gg/wiki/Valheim_Wiki',
    'https://deep-rock-galactic.wiki.gg/wiki/Deep_Rock_Galactic_Wiki',
    'https://minecraft.miraheze.org/wiki/Main_Page',
    'https://terraria.miraheze.org/wiki/Main_Page',
  ];
  it(`cả ${MW_URLS.length} URL họ MediaWiki trong yêu cầu 121 đều nhận diện đúng`, () => {
    for (const u of MW_URLS) {
      const p = detectPlatform(u);
      expect(p.platform, u).toBe('mediawiki');
      expect(p.apiBase, u).toContain('/api.php');
    }
  });

  it('cả 4 URL Baidu Baike trong yêu cầu 121 → baidu', () => {
    for (const u of [
      'https://baike.baidu.com/item/宝可梦',
      'https://baike.baidu.com/item/原神',
      'https://baike.baidu.com/item/海贼王',
      'https://baike.baidu.com/item/火影忍者',
    ]) {
      expect(detectPlatform(u).platform, u).toBe('baidu');
    }
  });

  it('site lạ không dấu hiệu wiki → generic (vẫn cào được, đọc HTML tổng quát)', () => {
    expect(detectPlatform('https://docs.example.com/guide/intro').platform).toBe('generic');
  });

  it('URL rác → ném lỗi rõ ràng', () => {
    expect(() => detectPlatform('khong-phai-url')).toThrow(/URL không hợp lệ/);
  });
});

describe('normalizeArticleUrl — hai URL cùng bài phải ra CÙNG chuỗi (dedup không thủng)', () => {
  it('bỏ #fragment và query rác', () => {
    expect(normalizeArticleUrl('https://a.fandom.com/wiki/Luffy#History'))
      .toBe(normalizeArticleUrl('https://a.fandom.com/wiki/Luffy'));
    expect(normalizeArticleUrl('https://a.fandom.com/wiki/Luffy?veaction=edit&utm_source=x'))
      .toBe(normalizeArticleUrl('https://a.fandom.com/wiki/Luffy'));
  });

  it('decode percent-encoding — bài tiếng Việt/CJK không bị coi là 2 trang', () => {
    expect(normalizeArticleUrl('https://baike.baidu.com/item/%E5%AE%9D%E5%8F%AF%E6%A2%A6'))
      .toBe(normalizeArticleUrl('https://baike.baidu.com/item/宝可梦'));
  });
});

describe('isArticleLink — cấm đúng các loại trang 121 liệt kê', () => {
  const wiki = detectPlatform('https://onepiece.fandom.com/wiki/Monkey_D._Luffy');

  it('bài viết thường → cào', () => {
    expect(isArticleLink('https://onepiece.fandom.com/wiki/Roronoa_Zoro', wiki)).toBe(true);
  });

  it.each([
    ['user page', 'https://onepiece.fandom.com/wiki/User:SomeGuy'],
    ['talk/discussion', 'https://onepiece.fandom.com/wiki/Talk:Luffy'],
    ['file/image', 'https://onepiece.fandom.com/wiki/File:Luffy.png'],
    ['template', 'https://onepiece.fandom.com/wiki/Template:CharBox'],
    ['special', 'https://onepiece.fandom.com/wiki/Special:RecentChanges'],
    ['user blog', 'https://onepiece.fandom.com/wiki/User_blog:X/abc'],
    ['edit page', 'https://onepiece.fandom.com/wiki/Luffy?action=edit'],
    ['history page', 'https://onepiece.fandom.com/wiki/Luffy?action=history'],
    ['external link', 'https://twitter.com/onepiece'],
    ['wiki khác (external)', 'https://naruto.fandom.com/wiki/Naruto'],
  ])('%s → KHÔNG cào', (_label, url) => {
    expect(isArticleLink(url, wiki)).toBe(false);
  });

  it('Baidu: /item/ hợp lệ, đường khác thì không', () => {
    const baidu = detectPlatform('https://baike.baidu.com/item/海贼王');
    expect(isArticleLink('https://baike.baidu.com/item/路飞', baidu)).toBe(true);
    expect(isArticleLink('https://baike.baidu.com/usercenter', baidu)).toBe(false);
  });

  it('category được giữ cho crawler bóc member (không bị chặn ở tầng link)', () => {
    expect(isArticleLink('https://onepiece.fandom.com/wiki/Category:Pirates', wiki)).toBe(true);
    expect(isCategoryUrl('https://onepiece.fandom.com/wiki/Category:Pirates')).toBe(true);
    expect(isCategoryUrl('https://onepiece.fandom.com/wiki/Luffy')).toBe(false);
  });
});

const mkPage = (title: string, depth = 1): PageDoc => ({
  url: `https://x.fandom.com/wiki/${title}`, title, aliases: [], text: `Nội dung về ${title}. `.repeat(30),
  infobox: {}, links: [], categories: [], platform: 'mediawiki', depth,
});

describe('partitionPages — bất biến 122: mỗi trang đúng MỘT batch, không giao nhau', () => {
  it('mọi trang xuất hiện đúng một lần trên toàn bộ các batch', () => {
    const pages = Array.from({ length: 23 }, (_, i) => mkPage(`P${i}`));
    const parts = partitionPages(pages, 4);
    const all = parts.flat().map(p => p.title);
    expect(all).toHaveLength(23);
    expect(new Set(all).size).toBe(23);
    // Không batch nào rỗng khi đủ trang
    expect(parts.every(b => b.length > 0)).toBe(true);
  });

  it('ít trang hơn số batch → không tạo batch rỗng', () => {
    const parts = partitionPages([mkPage('A'), mkPage('B')], 5);
    expect(parts).toHaveLength(2);
  });

  it('tất định: gọi hai lần ra cùng kết quả', () => {
    const pages = Array.from({ length: 10 }, (_, i) => mkPage(`P${i}`));
    expect(JSON.stringify(partitionPages(pages, 3))).toBe(JSON.stringify(partitionPages(pages, 3)));
  });
});

describe('buildBatchSource — trang nông (trung tâm) được ưu tiên, không vỡ ngân sách', () => {
  it('sắp theo depth, tôn trọng maxChars', () => {
    const deep = mkPage('Sâu', 3);
    const shallow = mkPage('Nông', 0);
    const src = buildBatchSource([deep, shallow], 5000);
    expect(src.indexOf('Nông')).toBeLessThan(src.indexOf('Sâu') === -1 ? Infinity : src.indexOf('Sâu'));
    expect(src.length).toBeLessThanOrEqual(5200);
  });
});

describe('createClaimStore — hai worker không thể cùng viết một thực thể', () => {
  it('claim lần đầu OK, lần hai (kể cả lệch hoa thường/khoảng trắng) bị chặn', () => {
    const store = createClaimStore(['Đảo Hải Tặc']);
    expect(store.claim('Monkey D. Luffy')).toBe(true);
    expect(store.claim('monkey d. luffy')).toBe(false);
    expect(store.claim('  Monkey   D.  Luffy ')).toBe(false);
    expect(store.claim('Đảo hải tặc')).toBe(false);  // đã có sẵn trong lorebook
    expect(store.claim('Roronoa Zoro')).toBe(true);
  });
});

describe('FactIndex — trùng NỘI DUNG bị bắt, khác nội dung thì không', () => {
  it('cùng thông tin, KHÁC cách diễn đạt → bắt (yêu cầu 122: không chỉ trùng lặp từ)', () => {
    const idx = new FactIndex();
    idx.add('e1', 'Luffy là thuyền trưởng băng hải tặc Mũ Rơm, ăn trái ác quỷ Gomu Gomu, có thân thể cao su, mơ ước trở thành Vua Hải Tặc.');
    const r = idx.isDuplicate('Thuyền trưởng của băng Mũ Rơm là Luffy — người có cơ thể cao su nhờ trái Gomu Gomu và khát vọng trở thành Vua Hải Tặc.');
    expect(r.dup).toBe(true);
    expect(r.with).toBe('e1');
  });

  it('hai thực thể khác nhau trong cùng thế giới → KHÔNG bắt oan', () => {
    const idx = new FactIndex();
    idx.add('e1', 'Luffy là thuyền trưởng băng Mũ Rơm, sử dụng trái cao su, tính cách vô tư thích phiêu lưu.');
    const r = idx.isDuplicate('Zoro là kiếm sĩ ba kiếm của băng, nghiêm túc lạnh lùng, mơ ước trở thành kiếm sĩ mạnh nhất thế giới.');
    expect(r.dup).toBe(false);
  });

  it('rỗng/chưa có gì → không nổ, không dup', () => {
    expect(new FactIndex().isDuplicate('bất kỳ')).toEqual({ dup: false });
  });
});

describe('initCrawlState — resume', () => {
  it('không có state cũ → seed từ URL; có state cũ còn việc → giữ nguyên', () => {
    const fresh = initCrawlState('https://a.fandom.com/wiki/X#frag');
    expect(fresh.queue).toEqual([['https://a.fandom.com/wiki/X', 0]]);
    const resumed = initCrawlState('https://a.fandom.com/wiki/X', {
      visited: ['u1'], queue: [['u2', 1]], pages: [mkPage('P')], dead: [],
    });
    expect(resumed.visited).toEqual(['u1']);
    expect(resumed.pages).toHaveLength(1);
  });
});
