/**
 * (bug 203) BỘ VÁ KHOÁ MẤT NHÁY CHƯA TỪNG CHẠY TRÊN SCRIPT KIỂU MODULE.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bản vá bugNeedFix/109 sinh ra để chữa đúng ca này: dịch khoá chữ Hán `数量:` sang tiếng Việt
 * ra `Số Lượng:` — có khoảng trắng mà vẫn viết như định danh ⇒ SyntaxError ⇒ cả script chết.
 * Nhưng nó dò lỗi bằng `jsParseError`, hàm chỉ parse mode SCRIPT. Mà script 酒馆助手 chuẩn là
 * ES MODULE (dòng đầu `import { registerMvuSchema } from 'https://…'`), nên với MỌI schema MVU
 * acorn báo lỗi ngay dòng 1 ("'import' and 'export' may appear only with 'sourceType: module'").
 * Bộ vá lấy vị trí đó, không nhận ra dạng hỏng nào, rồi dừng ở vòng đầu ⇒ trả nguyên bản.
 *
 * Hậu quả đo được trên bản dịch THẬT (gemini-3.1-pro, entry 29.700 ký tự của user):
 *   trước bản vá này: 0 khoá được sửa, script vỡ ⇒ chốt cú pháp bắt dịch lại ⇒ lặp.
 *   sau  bản vá này: 168 khoá được sửa, script parse SẠCH.
 * Con số 168 cũng chỉ ra chốt chặn thứ hai: trần MAX_ROUNDS cũ là 40, tức là kể cả khi hàm dò
 * lỗi đúng thì nó vẫn bỏ dở sau 40 chỗ.
 */
import { describe, it, expect } from 'vitest';
import { repairUnquotedObjectKeys } from '../repairObjectKeys';
import { jsParseError, jsParseErrorAny, jsParseErrorPosAny, neutralizeStMacros } from '../scriptSafety';

const ESM_HEAD = "import { registerMvuSchema } from 'https://esm.sh/mvu_zod.js';\n\n";

describe('(bug 203) dò lỗi phải hiểu cả script lẫn module', () => {
  it('CÁI BẪY: parse mode script luôn tố cáo dòng 1 của một ES module hoàn toàn lành lặn', () => {
    const good = ESM_HEAD + 'const a = { x: 1 };\n';
    expect(jsParseError(good)?.msg).toMatch(/sourceType: module/);   // ← nguồn cơn
    expect(jsParseErrorAny(good)).toBeNull();                        // bản đúng: sạch
  });

  it('jsParseErrorPosAny chỉ đúng VỊ TRÍ lỗi thật trong module, không phải dòng 1', () => {
    const broken = ESM_HEAD + 'const a = {\n  Số Lượng: 1,\n};\n';
    const err = jsParseErrorPosAny(broken)!;
    expect(err).not.toBeNull();
    expect(err.line).toBe(4);
    expect(broken.slice(err.pos, err.pos + 5)).toBe('Lượng');
  });
});

describe('(bug 203) vá khoá mất nháy trong ES module', () => {
  it('khoá dịch ra có khoảng trắng được bọc nháy, script hết vỡ', () => {
    const broken = ESM_HEAD + 'const itemEntry = z.object({\n  Số Lượng: safeNum,\n  Trọng Lượng: safeNum,\n});\n';
    const r = repairUnquotedObjectKeys(broken);
    expect(r.repaired).toBe(true);
    expect(r.fixed).toEqual(['Số Lượng', 'Trọng Lượng']);
    expect(r.code).toContain("'Số Lượng': safeNum");
    expect(jsParseErrorAny(r.code)).toBeNull();
  });

  it('hơn 40 khoá hỏng vẫn vá HẾT — trần cũ bỏ dở ở chỗ thứ 41 là vẫn vỡ', () => {
    const keys = Array.from({ length: 120 }, (_, i) => `  Khoá Số ${i}: ${i},`).join('\n');
    const broken = `${ESM_HEAD}const bang = {\n${keys}\n};\n`;
    const r = repairUnquotedObjectKeys(broken);
    expect(r.fixed.length).toBe(120);
    expect(jsParseErrorAny(r.code)).toBeNull();
  });

  it('script thường (không module) vẫn vá được y như trước', () => {
    const broken = 'const o = { AP Giới hạn: 8 };\nconst p = 1;';
    const r = repairUnquotedObjectKeys(broken);
    expect(r.repaired).toBe(true);
    expect(jsParseErrorAny(r.code)).toBeNull();
  });

  it('code đã lành thì không đụng một ký tự', () => {
    const good = ESM_HEAD + "const a = { 'Số Lượng': 1 };\n";
    expect(repairUnquotedObjectKeys(good)).toEqual({ code: good, fixed: [], repaired: false });
  });
});

describe('(bug 203) trung hoà macro phải GIỮ NGUYÊN ĐỘ DÀI', () => {
  it('độ dài không đổi ⇒ vị trí lỗi còn dùng để cắt chuỗi được', () => {
    const code = 'const f = (v) => v === <user> ? 1 : 0;';
    const n = neutralizeStMacros(code);
    expect(n.length).toBe(code.length);
    expect(jsParseErrorAny(code)).toBeNull();
  });

  it('script có macro VÀ có khoá hỏng: vá đúng chỗ, không lệch một ký tự', () => {
    const broken = `${ESM_HEAD}const ai = <user>;\nconst o = {\n  Số Lượng: 1,\n};\n`;
    const err = jsParseErrorPosAny(broken)!;
    expect(broken.slice(err.pos, err.pos + 5)).toBe('Lượng');
    const r = repairUnquotedObjectKeys(broken);
    expect(r.code).toContain("'Số Lượng': 1");
    expect(r.code).toContain('<user>');   // macro giữ nguyên trong KẾT QUẢ
    expect(jsParseErrorAny(r.code)).toBeNull();
  });

  it('so sánh thật `a<user>b` vẫn không bị đụng', () => {
    expect(neutralizeStMacros('const x = a<user>b;')).toBe('const x = a<user>b;');
  });
});
