/**
 * (bugNeedFix/170) Nút "Sửa bằng AI" ở phần kiểm lỗi: AI phải đọc bản gốc + bản dịch + [initvar],
 * chẩn đoán đúng lỗi, và bản sửa phải qua chốt chặn trước khi được ghi đè.
 *
 * Trọng tâm test là CHỐT CHẶN — đó là thứ quyết định bản sửa có làm hỏng thêm thẻ hay không.
 */
import { describe, it, expect } from 'vitest';
import {
  flattenPaths, readInitvarPaths, collectRepairContext, buildRepairMessages,
  parseRepairResponse, verifyRepair, summarizeRepair,
} from '../aiEntryRepair';
import type { TranslationField } from '../../types/card';

function field(over: Partial<TranslationField> = {}): TranslationField {
  return {
    path: 'data.character_book.entries[1].content', label: 'Bộ điều khiển',
    group: 'lorebook', original: '', translated: '', status: 'done', retries: 0,
    ...over,
  } as TranslationField;
}

const INITVAR = field({
  path: 'data.character_book.entries[0].content',
  label: '[initvar] Biến khởi tạo',
  entryType: 'initvar',
  translated: 'Biến khởi tạo của thẻ:\n{"stat_data":{"Chỉ Số":{"Máu":100,"Khí":50},"Cảnh Giới":"Luyện Khí"}}',
});

describe('Đọc [initvar] làm sự thật về tên biến', () => {
  it('flattenPaths bóc đủ đường dẫn lá, không dừng ở tầng một', () => {
    expect(flattenPaths({ a: { b: 1, c: { d: 2 } }, e: 3 }).sort())
      .toEqual(['a.b', 'a.c.d', 'e']);
  });

  it('nhận cả dạng có và không có tiền tố stat_data — EJS đọc bằng dạng đầy đủ', () => {
    const paths = readInitvarPaths([INITVAR]);
    expect(paths).toContain('stat_data.Chỉ Số.Máu');
    expect(paths).toContain('stat_data.Cảnh Giới');
  });

  it('[initvar] hỏng không parse được thì trả rỗng — KHÔNG đoán bừa', () => {
    const bad = field({ entryType: 'initvar', translated: 'Biến: {đây không phải JSON' });
    expect(readInitvarPaths([bad])).toEqual([]);
  });
});

describe('collectRepairContext — máy tự bắt lỗi trước khi phiền AI', () => {
  it('bắt được biến EJS không có trong [initvar] (ca hay gặp nhất: tên biến bị dịch lệch)', () => {
    const f = field({
      original: `<% if (getvar('stat_data.Cảnh Giới') === 'Luyện Khí') { %>x<% } %>`,
      translated: `<% if (getvar('stat_data.Cảnh giới') === 'Luyện Khí') { %>x<% } %>`,
    });
    const ctx = collectRepairContext(f, [INITVAR, f]);
    expect(ctx.unknownVars).toEqual(['stat_data.Cảnh giới']);
    expect(ctx.machineFindings.join(' ')).toMatch(/KHÔNG có trong \[initvar\]/);
  });

  it('bắt được macro bị rơi khi dịch', () => {
    const f = field({ original: 'Xin chào {{user}}, tôi là {{char}}.', translated: 'Xin chào, tôi là {{char}}.' });
    const ctx = collectRepairContext(f, [f]);
    expect(ctx.machineFindings.join(' ')).toMatch(/RƠI macro.*\{\{user\}\}/);
  });

  it('bắt được lệch số khối EJS', () => {
    const f = field({ original: '<% a %><% b %>', translated: '<% a %>' });
    expect(collectRepairContext(f, [f]).machineFindings.join(' ')).toMatch(/Số khối EJS lệch/);
  });

  it('bản GỐC vốn đã vỡ thì nói rõ để AI không đi đổi logic của tác giả', () => {
    const broken = 'const a = { ;';
    const f = field({ original: broken, translated: broken });
    expect(collectRepairContext(f, [f]).machineFindings.join(' ')).toMatch(/bản GỐC cũng đã vỡ/);
  });

  it('card không có [initvar] thì KHÔNG báo biến lạ (không có gì để so)', () => {
    const f = field({ translated: `<% getvar('bất kỳ.thứ gì') %>` });
    expect(collectRepairContext(f, [f]).unknownVars).toEqual([]);
  });
});

describe('buildRepairMessages — prompt', () => {
  const f = field({
    original: `<% getvar('stat_data.Chỉ Số.Máu') %> {{user}}`,
    translated: `<% getvar('stat_data.Chi So.Mau') %>`,
  });

  it('bơm danh sách biến THẬT và bắt chỉ được dùng chúng', () => {
    const msgs = buildRepairMessages(collectRepairContext(f, [INITVAR, f]));
    const user = msgs[1].content;
    expect(user).toContain('stat_data.Chỉ Số.Máu');
    expect(user).toMatch(/CHỈ được dùng những đường dẫn/);
  });

  it('gửi CẢ bản gốc lẫn bản dịch — đúng yêu cầu "quét lại bản dịch và bản raw"', () => {
    const user = buildRepairMessages(collectRepairContext(f, [INITVAR, f]))[1].content;
    expect(user).toContain('BẢN GỐC (trước khi dịch)');
    expect(user).toContain('BẢN DỊCH ĐANG LỖI');
  });

  it('không có [initvar] thì bắt GIỮ NGUYÊN tên biến thay vì thả cho AI tự đổi', () => {
    const user = buildRepairMessages(collectRepairContext(f, [f]))[1].content;
    expect(user).toMatch(/TUYỆT ĐỐI giữ nguyên mọi tên biến/);
  });

  it('cấm dịch lại toàn bộ — đây là việc sửa lỗi', () => {
    expect(buildRepairMessages(collectRepairContext(f, [f]))[0].content)
      .toMatch(/KHÔNG phải dịch lại/);
  });
});

describe('parseRepairResponse', () => {
  it('đọc đủ ba phần', () => {
    const r = parseRepairResponse(
      '<chan_doan>Tên biến bị dịch</chan_doan><da_sua>NỘI DUNG</da_sua><thay_doi>- đổi A thành B\n- thêm C</thay_doi>',
    );
    expect(r?.diagnosis).toBe('Tên biến bị dịch');
    expect(r?.fixed).toBe('NỘI DUNG');
    expect(r?.changes).toEqual(['đổi A thành B', 'thêm C']);
  });

  it('thiếu khối bản sửa ⇒ null, không đoán mò lấy cả câu trả lời làm nội dung', () => {
    expect(parseRepairResponse('Tôi nghĩ lỗi là do biến sai.')).toBeNull();
  });
});

describe('verifyRepair — CHỐT CHẶN: thà giữ bản lỗi cũ hơn ghi đè bản hỏng hơn', () => {
  const f = field({
    original: `<% if (getvar('stat_data.Cảnh Giới')) { %>Xin chào {{user}}<% } %>`,
    translated: `<% if (getvar('stat_data.Cảnh giới')) { %>Xin chào<% } %>`,
  });
  const ctx = collectRepairContext(f, [INITVAR, f]);

  it('nhận bản sửa đúng, và NÓI RÕ nó tốt lên chỗ nào', () => {
    const fixed = `<% if (getvar('stat_data.Cảnh Giới')) { %>Xin chào {{user}}<% } %>`;
    const v = verifyRepair(ctx, fixed);
    expect(v.ok).toBe(true);
    expect(v.improvements.join(' ')).toMatch(/khôi phục 1 macro/i);
    expect(v.improvements.join(' ')).toMatch(/stat_data\.Cảnh giới/);
  });

  it('TỪ CHỐI bản sửa vẫn thiếu macro của bản gốc', () => {
    const v = verifyRepair(ctx, `<% if (getvar('stat_data.Cảnh Giới')) { %>Xin chào<% } %>`);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/thiếu macro.*\{\{user\}\}/i);
  });

  it('TỪ CHỐI bản sửa đẻ ra biến MỚI không có trong [initvar]', () => {
    const v = verifyRepair(ctx, `<% if (getvar('stat_data.Tu Vi')) { %>Xin chào {{user}}<% } %>`);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/KHÔNG có trong \[initvar\]: stat_data\.Tu Vi/);
  });

  it('TỪ CHỐI bản sửa lệch số khối EJS so với bản gốc', () => {
    const v = verifyRepair(ctx, `Xin chào {{user}}`);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/Số khối EJS vẫn lệch/);
  });

  it('TỪ CHỐI bản sửa teo lại bất thường (AI tóm tắt thay vì sửa)', () => {
    const long = field({
      original: 'A'.repeat(3000) + ' {{user}}',
      translated: 'B'.repeat(3000) + ' {{user}}',
    });
    const c = collectRepairContext(long, [long]);
    const v = verifyRepair(c, 'Tóm tắt ngắn {{user}}');
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/ngắn hơn hẳn/);
  });

  it('TỪ CHỐI nội dung rỗng', () => {
    expect(verifyRepair(ctx, '   ').ok).toBe(false);
  });

  it('biến lạ VỐN ĐÃ CÓ trước khi sửa không bị tính là tội của bản sửa', () => {
    // Giữ nguyên đúng biến lạ cũ + trả lại macro ⇒ vẫn được nhận (đã tốt lên, không xấu đi).
    const v = verifyRepair(ctx, `<% if (getvar('stat_data.Cảnh giới')) { %>Xin chào {{user}}<% } %>`);
    expect(v.ok).toBe(true);
  });

  it('bắt được bản sửa làm vỡ cú pháp JS trong khi bản gốc lành', () => {
    const js = field({ original: 'const a = 1;', translated: 'const a = 1;' });
    const c = collectRepairContext(js, [js]);
    const v = verifyRepair(c, 'const a = ;');
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/vỡ cú pháp JS/);
  });
});

describe('summarizeRepair — báo cáo thật, không hứa suông', () => {
  it('không đạt ⇒ nói rõ đã GIỮ NGUYÊN bản cũ và vì sao', () => {
    const s = summarizeRepair(
      { ok: false, reasons: ['Vẫn thiếu macro {{user}}.'], improvements: [] },
      { diagnosis: 'd', fixed: 'x', changes: [] },
    );
    expect(s).toMatch(/giữ nguyên bản cũ/i);
    expect(s).toMatch(/\{\{user\}\}/);
  });

  it('đạt ⇒ nói số thay đổi và điều đã tốt lên', () => {
    const s = summarizeRepair(
      { ok: true, reasons: [], improvements: ['Đã sửa xong lỗi cú pháp JS.'] },
      { diagnosis: 'd', fixed: 'x', changes: ['a', 'b'] },
    );
    expect(s).toMatch(/2 thay đổi/);
    expect(s).toMatch(/cú pháp JS/);
  });
});
