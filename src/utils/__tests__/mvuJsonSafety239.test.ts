import { describe, expect, it } from 'vitest';
import {
  applyMvuToJsonText,
  applyMvuToText,
  recanonicalizeMvuInFields,
  restoreEmptyMvuBracketAccess,
  sanitizeMvuVarName,
  translateMvuJsonPointer,
} from '../mvuSync';
import type { TranslationField } from '../../types/card';

describe('MVU JSON safety — dịch theo cấu trúc, không thay chuỗi mù', () => {
  it('đổi object-key nhưng giữ nguyên enum/string value và JSON vẫn parse được', () => {
    const source = JSON.stringify({ 状态: '状态', nested: { 当前值: 1 } }, null, 2);
    const out = applyMvuToText(source, { 状态: 'Trạng "Thái"', 当前值: 'Giá Trị Hiện Tại' }, true);
    const parsed = JSON.parse(out);
    expect(parsed['Trạng "Thái"']).toBe('状态');
    expect(parsed.nested['Giá Trị Hiện Tại']).toBe(1);
  });

  it('JSON Patch chỉ đổi path/from, không đổi value', () => {
    const source = '[{"op":"replace","path":"/状态/当前值","from":"/状态/旧值","value":"状态"}]';
    const out = applyMvuToJsonText(source, {
      状态: 'Trạng Thái', 当前值: 'Giá Trị', 旧值: 'Giá Trị Cũ',
    });
    const [op] = JSON.parse(out!);
    expect(op.path).toBe('/Trạng Thái/Giá Trị');
    expect(op.from).toBe('/Trạng Thái/Giá Trị Cũ');
    expect(op.value).toBe('状态');
  });

  it('giữ đúng escape JSON Pointer cho key chứa / và ~', () => {
    expect(translateMvuJsonPointer('/a~1b/c~0d', { 'a/b': 'Mục/Con', 'c~d': 'Dấu~Ngã' }))
      .toBe('/Mục~1Con/Dấu~0Ngã');
  });

  it('mục từ path A.B được tách thành từng tầng, không bị nuốt dấu chấm thành một property', () => {
    const dict = { '财务.钱财': 'Tài Chính.Tiền Tài' };
    const js = applyMvuToText('const x = state.财务.钱财;', dict, true);
    expect(js).toBe("const x = state['Tài Chính']['Tiền Tài'];");
    expect(() => new Function(js)).not.toThrow();

    const patch = applyMvuToText('[{"op":"replace","path":"/财务/钱财","value":1}]', dict, true);
    expect(JSON.parse(patch)[0].path).toBe('/Tài Chính/Tiền Tài');
  });

  it('không làm mất dữ liệu khi hai key đổ vào cùng một tên dịch', () => {
    const out = applyMvuToJsonText('{"甲":1,"乙":2}', { 甲: 'Trùng', 乙: 'Trùng' });
    expect(JSON.parse(out!)).toEqual({ Trùng: 1, 乙: 2 });
  });
});

describe('MVU covariance cho field JSON', () => {
  it('ép key/path theo bản gốc + từ điển nhưng giữ value AI đã dịch', () => {
    const field = {
      path: 'book[0].content', label: 'patch', group: 'lorebook', entryType: 'json_patch',
      original: '[{"op":"replace","path":"/状态","value":{"说明":"原文"}}]',
      translated: '[{"op":"replace","path":"/Tình trạng","value":{"Mô tả":"Bản dịch"}}]',
      status: 'done', retries: 0,
    } as TranslationField;
    const out = recanonicalizeMvuInFields([field], { 状态: 'Trạng Thái', 说明: 'Mô Tả' }).fields[0].translated!;
    const [op] = JSON.parse(out);
    expect(op.path).toBe('/Trạng Thái');
    expect(op.value).toEqual({ 'Mô Tả': 'Bản dịch' });
  });

  it("khôi phục obj[''] theo key gốc khi từ điển xác định được tên", () => {
    const restored = restoreEmptyMvuBracketAccess(
      "const x = data['状态']; const y = data?.[\"当前值\"];",
      "const x = data['']; const y = data?.[\"\"];",
      { 状态: 'Trạng Thái', 当前值: 'Giá Trị Hiện Tại' },
    );
    expect(restored.count).toBe(2);
    expect(restored.text).toBe("const x = data['Trạng Thái']; const y = data?.[\"Giá Trị Hiện Tại\"];");
  });

  it("sweep đồng biến tự khôi phục [''] trong field code", () => {
    const field = {
      path: 'th[0].content', label: 'schema', group: 'tavern_helper',
      original: "const x = state['状态'];", translated: "const x = state[''];",
      status: 'done', retries: 0,
    } as TranslationField;
    const out = recanonicalizeMvuInFields([field], { 状态: 'Trạng Thái' }).fields[0].translated;
    expect(out).toBe("const x = state['Trạng Thái'];");
  });

  it("không đoán mò [''] khi thiếu từ điển hoặc số access hai phía lệch", () => {
    expect(restoreEmptyMvuBracketAccess("x['状态']", "x['']", {}).text).toBe("x['']");
    expect(restoreEmptyMvuBracketAccess("x['状态']", "x['']; y['']", { 状态: 'Trạng Thái' }).text)
      .toBe("x['']; y['']");
  });

  it('tự loại dấu chấm mọc thêm ở bản dịch của một key đơn; path hợp lệ vẫn giữ tầng', () => {
    expect(sanitizeMvuVarName('状态', 'Trạng.Thái')).toBe('Trạng Thái');
    expect(sanitizeMvuVarName('世界.状态', 'Thế Giới.Trạng Thái')).toBe('Thế Giới.Trạng Thái');
    expect(sanitizeMvuVarName('状态', 'Trạng/"Thái"')).toBe('Trạng Thái');
    expect(JSON.parse(applyMvuToText('{"状态":1}', { 状态: 'Trạng.Thái' }, true)))
      .toEqual({ 'Trạng Thái': 1 });
  });

  it('sweep cuối dọn hết tên CJK còn sót trong hướng dẫn MVU dù tên mới đã xuất hiện', () => {
    const field = {
      path: 'lorebook[19].content', label: 'Hướng dẫn định dạng biến', group: 'lorebook', entryType: 'mvu_logic',
      original: "年龄: z.string(); 状态: z.enum(['通话中', '已挂断']); const x = 人物['年龄'];",
      translated: "Tuổi Tác: z.string(); 年龄 được ghi ở đây; 状态: z.enum(['通话中', '已挂断']); const x = Nhân Vật['Tuổi Tác'];",
      status: 'done', retries: 0,
    } as TranslationField;
    const out = recanonicalizeMvuInFields([field], {
      年龄: 'Tuổi Tác', 状态: 'Trạng Thái', 通话中: 'Đang Gọi', 已挂断: 'Đã Cúp Máy', 人物: 'Nhân Vật',
    }).fields[0].translated!;
    expect(out).not.toMatch(/年龄|状态|通话中|已挂断|人物/);
    expect(out).toContain('Tuổi Tác được ghi ở đây');
    expect(out).toContain("Nhân Vật['Tuổi Tác']");
  });
});
