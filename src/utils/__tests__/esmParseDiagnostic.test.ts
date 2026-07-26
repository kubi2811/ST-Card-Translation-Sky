// (bugNeedFix/95) Chẩn đoán cú pháp script 酒馆助手 (ES module) — bản dịch Zod bị báo lỗi
// "'import' and 'export' may appear only with 'sourceType: module'" ở dòng 1, che mất lỗi THẬT.
import { describe, it, expect } from 'vitest';
import { jsParseErrorAny, isEsModuleScript } from '../scriptSafety';

const ZOD_HEAD = `import { z } from 'https://testingcf.jsdelivr.net/npm/zod@3/+esm';
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
`;

describe('isEsModuleScript', () => {
  it('nhận script mở đầu bằng import (mẫu chuẩn TavernHelper/MVU)', () => {
    expect(isEsModuleScript(ZOD_HEAD)).toBe(true);
    expect(isEsModuleScript('export const schema = 1;')).toBe(true);
  });

  it('không nhận nhầm khi chữ import chỉ nằm trong chuỗi/comment giữa dòng', () => {
    expect(isEsModuleScript(`const s = "hãy import file này";\nconsole.log(s);`)).toBe(false);
    expect(isEsModuleScript(`var a = 1; // import xong rồi`)).toBe(false);
  });
});

describe('jsParseErrorAny — script ESM lành thì KHÔNG báo lỗi', () => {
  it('script Zod hợp lệ (ESM) → null, không có chuyện báo "import may appear only with sourceType: module"', () => {
    const ok = ZOD_HEAD + `
export const schema = z.object({
  "Người Chơi": z.object({ "Máu": z.number().prefault(100) }).prefault({}),
}).prefault({});
registerMvuSchema('stat_data', schema);`;
    expect(jsParseErrorAny(ok)).toBeNull();
  });

  it('script thường (không ESM) vẫn parse được như cũ', () => {
    expect(jsParseErrorAny(`var a = 1;\nfunction f(){ return a; }`)).toBeNull();
  });
});

describe('CHÍNH CA BUG 95: ESM hỏng ở GIỮA file phải báo đúng chỗ, không đổ lỗi cho dòng import', () => {
  it('chuỗi bị vỡ ở giữa (kiểu bản dịch làm hỏng) → lỗi chỉ đúng dòng đó, KHÔNG phải dòng 1', () => {
    const broken = ZOD_HEAD + `
export const schema = z.object({
  "Người Chơi": z.object({
    "Cảnh Giới": z.string().prefault('Luyện Khí),
  }).prefault({}),
}).prefault({});`;
    const err = jsParseErrorAny(broken);
    expect(err).not.toBeNull();
    // Lỗi phải chỉ vào vùng chuỗi vỡ (dòng ≥ 4), không phải dòng import
    expect(err!.line).toBeGreaterThan(1);
    // Và TUYỆT ĐỐI không còn thông điệp đánh lạc hướng về sourceType
    expect(err!.msg).not.toContain('sourceType');
  });

  it('bản dịch làm mất dấu đóng ngoặc → báo lỗi thật, không phải lỗi import', () => {
    const broken = ZOD_HEAD + `
export const schema = z.object({
  "Máu": z.number().prefault(100),
;`;
    const err = jsParseErrorAny(broken);
    expect(err).not.toBeNull();
    expect(err!.msg).not.toContain('sourceType');
  });

  it('script KHÔNG phải ESM mà hỏng → vẫn giữ thông điệp mode script như cũ', () => {
    const err = jsParseErrorAny(`function f( { var a = 1;`);
    expect(err).not.toBeNull();
    expect(err!.line).toBeGreaterThan(0);
  });
});

describe('Dấu vân tay lỗi (chống retry vô ích)', () => {
  // Dịch phẫu thuật là thay-thế-theo-từ-điển ⇒ chạy lại ra kết quả y hệt ⇒ lỗi y hệt.
  it('cùng một bản dịch hỏng → dấu vân tay lỗi KHÔNG đổi giữa 2 lần kiểm', () => {
    const broken = ZOD_HEAD + `export const s = z.object({ "A": z.string().prefault('x) });`;
    const a = jsParseErrorAny(broken)!;
    const b = jsParseErrorAny(broken)!;
    expect(`${a.line}|${a.msg}`).toBe(`${b.line}|${b.msg}`);
  });

  it('hai lỗi KHÁC nhau → dấu vân tay khác (vẫn cho retry khi thật sự đổi)', () => {
    const e1 = jsParseErrorAny(ZOD_HEAD + `const a = 'x;`)!;
    const e2 = jsParseErrorAny(ZOD_HEAD + `\n\n\nconst b = {{{;`)!;
    expect(`${e1.line}|${e1.msg}`).not.toBe(`${e2.line}|${e2.msg}`);
  });
});
