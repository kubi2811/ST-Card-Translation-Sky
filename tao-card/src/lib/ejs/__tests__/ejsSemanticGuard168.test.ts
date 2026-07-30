/**
 * (bugNeedFix/168 mục 4) Chốt chặn NGỮ NGHĨA — bắt lỗi code EJS chạy sai dù cú pháp hoàn hảo.
 *
 * Bài kiểm chính là CHÍNH CARD THẬT user gửi (bugNeedFix/168/Eldran_Game_Master_v3.json) cùng
 * bản đánh giá chất lượng đi kèm. Bản đánh giá chỉ ra 5 lỗi; test này đòi hỏi bộ kiểm mới bắt
 * được đúng những lỗi đó trên đúng dữ liệu đó — không phải trên ví dụ tự bịa.
 *
 * Card nằm ngoài thư mục app nên nếu thiếu file thì SKIP (không FAIL) — cùng quy ước với các
 * test bằng-chứng-thật khác của repo.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkEjsSemantics, findFragileMatches, extractGetvarCalls,
  readInitVarTruth, flattenInitVar, summarizeSemantics,
} from '../ejsSemanticGuard';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const CARD_PATH = resolve(__dirname, '../../../../../bugNeedFix/168/Eldran_Game_Master_v3.json');
const hasCard = existsSync(CARD_PATH);

describe('bóc dữ liệu thật của thẻ', () => {
  it('làm phẳng cây initvar thành đường dẫn chấm', () => {
    const flat = flattenInitVar({ 'Thông Tin Shard': { 'Cảnh Giới': 'Chưa bề', 'Phả Hệ': 'Chưa thức tỉnh' } });
    expect(flat['Thông Tin Shard.Cảnh Giới']).toBe('Chưa bề');
    expect(flat['Thông Tin Shard.Phả Hệ']).toBe('Chưa thức tỉnh');
  });

  it('đọc [initvar] ra bảng có tiền tố stat_data', () => {
    const truth = readInitVarTruth([
      { comment: '[initvar]', content: 'Thông Tin Shard:\n  Cảnh Giới: Chưa bề\n  Phả Hệ: Chưa thức tỉnh' },
    ]);
    expect(truth['stat_data.Thông Tin Shard.Cảnh Giới']).toBe('Chưa bề');
  });

  it('không có [initvar] thì trả bảng rỗng, không nổ', () => {
    expect(readInitVarTruth([{ comment: 'abc', content: 'xyz' }])).toEqual({});
  });
});

describe('bóc getvar + default', () => {
  it('đọc được default dạng chuỗi và dạng số', () => {
    const c = `getvar('stat_data.A', { defaults: 'Chưa rõ' }); getvar('stat_data.B', { defaults: 100 });`;
    const g = extractGetvarCalls(c);
    expect(g[0]).toMatchObject({ path: 'stat_data.A', rawDefault: "'Chưa rõ'", isStringLiteral: true });
    expect(g[1]).toMatchObject({ path: 'stat_data.B', rawDefault: '100', isStringLiteral: false });
  });

  it('getvar không khai default thì rawDefault = null', () => {
    expect(extractGetvarCalls(`getvar('stat_data.A')`)[0].rawDefault).toBeNull();
  });
});

describe('so khớp mong manh — gốc lỗi "chưa bề" khớp chữ a', () => {
  it('bắt includes bằng 1 ký tự', () => {
    const found = findFragileMatches(`if (rank.includes('a') || rank.includes('s')) {}`);
    expect(found.map(f => f.frag).sort()).toEqual(['a', 's']);
  });

  it('KHÔNG bắt cụm từ đầy đủ', () => {
    expect(findFragileMatches(`if (rank.includes('hạng a') || rank.includes('tông sư')) {}`)).toEqual([]);
  });

  it('KHÔNG bắt oan các từ ngắn có nghĩa thật', () => {
    expect(findFragileMatches(`if (g.includes('nam') || s.includes('nữ') || t.includes('có')) {}`)).toEqual([]);
  });

  it('bắt cả startsWith/indexOf ký tự đơn', () => {
    const f = findFragileMatches(`x.startsWith('S'); y.indexOf('f');`);
    expect(f).toHaveLength(2);
  });
});

describe('đối chiếu default với [initvar] thật', () => {
  const entries = [
    { comment: '[initvar]', content: 'Thông Tin Shard:\n  Phả Hệ: Chưa thức tỉnh\n  Cảnh Giới: Chưa bề' },
  ];

  it('CHÍNH CA entry 41: defaults "Chưa rõ" trong khi thật là "Chưa thức tỉnh"', () => {
    const issues = checkEjsSemantics({
      entries,
      schema: null,
      blocks: [{
        name: 'Bộ điều khiển EJS',
        code: `@@preprocessing\n<%_\nvar p = getvar('stat_data.Thông Tin Shard.Phả Hệ', { defaults: 'Chưa rõ' });\n_%>`,
      }],
    });
    const m = issues.find(i => i.kind === 'default-mismatch');
    expect(m, 'phải bắt được default lệch').toBeTruthy();
    expect(m!.level).toBe('error');
    expect(m!.message).toContain('Chưa thức tỉnh');
    expect(m!.fix).toContain('Chưa thức tỉnh');
  });

  it('entry 42 viết ĐÚNG thì không báo gì — không bắt oan', () => {
    const issues = checkEjsSemantics({
      entries,
      schema: null,
      blocks: [{
        name: 'Bộ đẩy prompt',
        code: `@@preprocessing\n<%_\nvar p = getvar('stat_data.Thông Tin Shard.Phả Hệ', { defaults: 'Chưa thức tỉnh' });\n_%>`,
      }],
    });
    expect(issues.filter(i => i.kind === 'default-mismatch')).toEqual([]);
  });

  it('defaults rỗng là cách viết "không quan tâm" — không bắt bẻ', () => {
    const issues = checkEjsSemantics({
      entries,
      schema: null,
      blocks: [{ name: 'X', code: `<%_ var p = getvar('stat_data.Thông Tin Shard.Phả Hệ', { defaults: '' }); _%>` }],
    });
    expect(issues.filter(i => i.kind === 'default-mismatch')).toEqual([]);
  });
});

describe('default sai kiểu + ngoài enum', () => {
  const schema: MVUZODSchema = {
    version: '1.0',
    fields: [
      { path: '/Chỉ Số/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: { min: 0, max: 100 } },
      { path: '/Thông Tin/Cảnh Giới', type: 'string', label: 'Cảnh Giới', defaultValue: 'Chưa bề',
        constraints: { enumValues: ['Chưa bề', 'Tân thủ', 'Cao thủ'] } },
    ],
  };

  it('CHÍNH CA entry 47/48: defaults "100" dạng chuỗi cho biến số', () => {
    const issues = checkEjsSemantics({
      entries: [], schema,
      blocks: [{ name: 'Cảm biến sát thương', code: `<%_ var hp = Number(getvar('stat_data.Chỉ Số.Máu', { defaults: '100' })); _%>` }],
    });
    const t = issues.find(i => i.kind === 'default-type');
    expect(t).toBeTruthy();
    expect(t!.fix).toContain('defaults: 100');
  });

  it('defaults số đúng kiểu thì im lặng', () => {
    const issues = checkEjsSemantics({
      entries: [], schema,
      blocks: [{ name: 'X', code: `<%_ var hp = getvar('stat_data.Chỉ Số.Máu', { defaults: 100 }); _%>` }],
    });
    expect(issues.filter(i => i.kind === 'default-type')).toEqual([]);
  });

  it('default ngoài miền enum bị cảnh báo kèm danh sách hợp lệ', () => {
    const issues = checkEjsSemantics({
      entries: [], schema,
      blocks: [{ name: 'X', code: `<%_ var r = getvar('stat_data.Thông Tin.Cảnh Giới', { defaults: 'Vô Địch' }); _%>` }],
    });
    const e = issues.find(i => i.kind === 'enum-not-matched');
    expect(e).toBeTruthy();
    expect(e!.message).toContain('Chưa bề');
  });
});

describe('nhiều entry cùng đọc một biến', () => {
  it('CHÍNH CA entry 44/45/46 cùng đọc Máu → gợi ý gộp', () => {
    const mk = (n: string) => ({ name: n, code: `<%_ var hp = getvar('stat_data.Chỉ Số.Máu', { defaults: 100 }); _%>` });
    const issues = checkEjsSemantics({
      entries: [], schema: null,
      blocks: [mk('Giới hạn Máu'), mk('Cảnh báo sức khỏe'), mk('Cảnh báo tử vong')],
    });
    const d = issues.find(i => i.kind === 'duplicate-read');
    expect(d).toBeTruthy();
    expect(d!.message).toContain('3 entry');
    expect(d!.fix).toContain('else if');
  });

  it('hai entry đọc chung thì CHƯA báo (ngưỡng 3)', () => {
    const mk = (n: string) => ({ name: n, code: `<%_ getvar('stat_data.A', { defaults: 1 }); _%>` });
    const issues = checkEjsSemantics({ entries: [], schema: null, blocks: [mk('a'), mk('b')] });
    expect(issues.filter(i => i.kind === 'duplicate-read')).toEqual([]);
  });
});

describe('BẰNG CHỨNG THẬT — card Eldran_Game_Master_v3.json', () => {
  it.skipIf(!hasCard)('bắt được đúng các lỗi bản đánh giá chất lượng đã nêu', () => {
    const card = JSON.parse(readFileSync(CARD_PATH, 'utf8')) as {
      data: { character_book: { entries: Array<{ id: number; comment?: string; content?: string }> } };
    };
    const entries = card.data.character_book.entries;
    const blocks = entries
      .filter(e => String(e.content ?? '').includes('<%'))
      .map(e => ({ name: `#${e.id} ${e.comment ?? ''}`.trim(), code: String(e.content) }));

    expect(blocks.length, 'card phải có khối EJS để soi').toBeGreaterThan(10);

    const issues = checkEjsSemantics({ entries, schema: null, blocks });

    // ① Entry 43 — so khớp ký tự đơn lẻ (lỗi NGHIÊM TRỌNG nhất trong bản đánh giá)
    const fragile = issues.filter(i => i.kind === 'fragile-match');
    expect(fragile.length, 'phải bắt được so khớp mong manh').toBeGreaterThan(0);
    expect(fragile.some(i => (i.entry ?? '').includes('43')), 'phải chỉ đích danh entry 43').toBe(true);

    // ② Entry 41 — default lệch với [initvar] thật ("Chưa rõ" vs "Chưa thức tỉnh")
    const mismatch = issues.filter(i => i.kind === 'default-mismatch');
    expect(mismatch.length, 'phải bắt được default lệch initvar').toBeGreaterThan(0);
    expect(mismatch.some(i => i.message.includes('Chưa thức tỉnh'))).toBe(true);
    expect(mismatch.some(i => (i.entry ?? '').includes('41')), 'phải chỉ đích danh entry 41').toBe(true);

    // Mọi lỗi đều phải kèm câu sửa cụ thể — để vòng tự vá dùng được ngay.
    for (const i of issues) {
      expect(i.fix.trim().length, `${i.kind} thiếu câu sửa`).toBeGreaterThan(15);
    }

    expect(summarizeSemantics(issues)).toContain('lỗi');
  });

  /**
   * PHÁT HIỆN NGOÀI BẢN ĐÁNH GIÁ: entry 42 cũng hỏng, theo hai kiểu bản đánh giá chưa nêu.
   * Bản đánh giá khen entry 42 viết đúng vì thấy chuỗi 'Chưa thức tỉnh' — nhưng chuỗi đó là
   * giá trị của biến Phả Hệ, trong khi entry 42 lại đem nó làm default cho biến CẢNH GIỚI
   * (giá trị thật "Chưa bề"). Tức công cụ chép nhầm default từ biến này sang biến kia.
   * Kèm theo: VP Hiện Tại khởi tạo là 0 nhưng code ghi defaults 100.
   * Bộ kiểm bắt được cả hai — đây chính là giá trị của việc đối chiếu bằng máy thay vì đọc mắt.
   */
  it.skipIf(!hasCard)('bắt thêm hai lỗi ở entry 42 mà bản đánh giá đọc sót', () => {
    const card = JSON.parse(readFileSync(CARD_PATH, 'utf8')) as {
      data: { character_book: { entries: Array<{ id: number; comment?: string; content?: string }> } };
    };
    const entries = card.data.character_book.entries;
    const e42 = entries.find(e => e.id === 42)!;
    const issues = checkEjsSemantics({
      entries, schema: null,
      blocks: [{ name: `#42 ${e42.comment}`, code: String(e42.content) }],
    });
    const mm = issues.filter(i => i.kind === 'default-mismatch');
    expect(mm.length).toBe(2);
    // ① default của Cảnh Giới bị lấy nhầm giá trị của Phả Hệ
    expect(mm.some(i => (i.path ?? '').includes('Cảnh Giới') && i.message.includes('Chưa bề'))).toBe(true);
    // ② VP Hiện Tại thật là 0, code ghi 100
    expect(mm.some(i => (i.path ?? '').includes('VP Hiện Tại') && i.message.includes('"0"'))).toBe(true);
  });
});
