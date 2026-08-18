/**
 * `getvar()` KHÔNG TỰ BÓC CẶP — và cả tầng EJS của tool từng làm ngơ chuyện đó.
 * ─────────────────────────────────────────────────────────────────────────────
 * MVU lưu biến theo HAI dạng (mvuReference.ts · MVU_INITVAR):
 *     Máu: 100                                   ← giá trị trần
 *     Cảnh Giới: ["Luyện Khí", "cảnh giới…"]      ← CẶP ValueWithDescription
 * Macro `{{format_message_variable::…}}` tự format, còn `getvar()` trả về NGUYÊN thứ đang nằm
 * trong stat_data.
 *
 * Thẻ do chính tool sinh thì initvar luôn xuất giá trị TRẦN nên bản cũ chạy được — nhưng thẻ
 * NHẬP TỪ NGOÀI (card Trung/Việt thật rất hay dùng cặp) thì `Number(getvar(...))` ra NaN, mọi
 * nhánh `if` so sánh số sai IM LẶNG, không một dòng lỗi đỏ nào.
 *
 * Bên Game UI đã bịt lỗ này từ lâu (mvuGet/mvuText/mvuNum trong mvuRuntime.ts); tầng EJS thì
 * chưa: 37 chỗ trong ejsSnippets đọc trần, prompt dạy AI viết EJS không hề nhắc tới dạng cặp.
 */
import { describe, it, expect } from 'vitest';
import { EJS_SNIPPETS, EJS_ADVANCED_TEMPLATES } from '../../../components/ejs/ejsSnippets';
import { STPT_API_PROMPT_BLOCK } from '../stptApi';
import { validateEJSEntry, generateGetvarCall } from '../ejsParser';

/** Chạy THẬT biểu thức được nhúng vào thẻ, trên đúng hai dạng dữ liệu MVU. */
const unwrap = (v: unknown) => (new Function('v', 'return [].concat(v)[0];') as (x: unknown) => unknown)(v);

describe('bóc cặp [giá trị, "mô tả"]', () => {
  it('cặp → chỉ lấy giá trị; trần → giữ nguyên', () => {
    expect(unwrap(['Luyện Khí', 'cảnh giới hiện tại'])).toBe('Luyện Khí');
    expect(unwrap([100, 'máu tối đa'])).toBe(100);
    expect(unwrap(100)).toBe(100);
    expect(unwrap('Sáng')).toBe('Sáng');
  });

  it('Number(cặp) là NaN — đúng cái làm mọi so sánh số trượt lặng lẽ', () => {
    expect(Number(['100', 'máu'] as unknown as number)).toBeNaN();
    expect(Number(unwrap([100, 'máu']))).toBe(100);
  });
});

describe('ejsSnippets — mọi getvar đều đã bọc', () => {
  const allCode = [
    ...EJS_SNIPPETS.map(s => s.code),
    ...EJS_ADVANCED_TEMPLATES.map(t => t.code),
  ].join('\n');

  it('không còn getvar() nào đọc trần', () => {
    const bare = [...allCode.matchAll(/(.{0,14})getvar\(/g)]
      .filter(m => !m[1].endsWith('[].concat('))
      .map(m => m[0]);
    expect(bare).toEqual([]);
  });

  it('vẫn giữ đủ tiền tố stat_data. cho mọi đường dẫn', () => {
    const paths = [...allCode.matchAll(/getvar\('([^']+)'/g)].map(m => m[1]);
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter(p => !p.startsWith('stat_data.'))).toEqual([]);
  });
});

describe('bộ kiểm EJS nhắc khi quên bọc', () => {
  it('getvar trần → cảnh báo kèm cách sửa', () => {
    const r = validateEJSEntry("@@preprocessing\n<%_ var hp = Number(getvar('stat_data.Nhân vật.HP', { defaults: 100 })); _%>");
    expect(r.warnings.some(w => /chưa bóc cặp/.test(w))).toBe(true);
    expect(r.warnings.some(w => /\[\]\.concat/.test(w))).toBe(true);
  });

  it('đã bọc rồi thì im lặng', () => {
    const r = validateEJSEntry("@@preprocessing\n<%_ var hp = Number([].concat(getvar('stat_data.Nhân vật.HP', { defaults: 100 }))[0]); _%>");
    expect(r.warnings.some(w => /chưa bóc cặp/.test(w))).toBe(false);
  });
});

describe('nút "chèn getvar" của EJS Editor', () => {
  it('sinh sẵn bản đã bọc, không để user tự nhớ', () => {
    const call = generateGetvarCall('/Nhân vật/HP', 100);
    expect(call).toBe("[].concat(getvar('stat_data.Nhân vật.HP', { defaults: 100 }))[0]");
  });
});

describe('prompt sinh EJS dạy đúng luật', () => {
  it('nêu cả hai dạng lưu và cách bọc', () => {
    expect(STPT_API_PROMPT_BLOCK).toContain('[].concat(getvar(');
    expect(STPT_API_PROMPT_BLOCK).toContain('stat_data.');
    expect(STPT_API_PROMPT_BLOCK).toMatch(/CẶP \[giá_trị, "mô tả"\]/);
  });
});
