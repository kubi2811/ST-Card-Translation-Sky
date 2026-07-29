// (bug 154) Đối chiếu trên CHÍNH script user gửi (109KB, 8.033 ký tự Hán).
// Bản dịch user nhận về chết ở dòng 7 cột 14: `_Định danh khởi đầu: …` — khoá object có dấu
// cách mà không được bọc nháy. bug/ nằm trong .gitignore nên test tự bỏ qua khi thiếu file.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractCJKTokens, reinsertTranslations } from '../surgical';
import { jsParseErrorAny } from '../scriptSafety';

const SRC = resolve(__dirname, '../../../bug/154/Trước Dịch.txt');
const has = existsSync(SRC);
const read = () => readFileSync(SRC, 'utf-8');

/** Từ điển lấy từ chính danh sách "Đang giữ" trong báo cáo user gửi kèm. */
const DICT: Record<string, string> = {
  世界运转: 'Thế giới vận hành', 开场标识: 'Định danh khởi đầu', 当前日期: 'Ngày hiện tại',
  当前地点: 'Địa điểm hiện tại', 天气: 'Thời tiết', 天下地图: 'Bản đồ thiên hạ', 变量: 'Biến số',
  主角: 'Nhân vật chính', 私库: 'Tư khố', 重要物品: 'Vật phẩm quan trọng',
  军事: 'Quân sự', 各营: 'Các doanh', 将领: 'Tướng lĩnh',
  经济: 'Kinh tế', 资产: 'Tài sản', 仓储: 'Kho chứa',
  时局与任务: 'Thời cục và nhiệm vụ', 势力关系: 'Quan hệ thế lực', 当前任务: 'Nhiệm vụ hiện tại',
};

describe.skipIf(!has)('(bug 154) script thật của user', () => {
  it('script GỐC parse được — mốc đối chiếu', () => {
    expect(jsParseErrorAny(read())).toBeFalsy();
  });

  it('`_开场标识` được nhận là khoá object (chỗ vỡ trong bản dịch user nhận)', () => {
    const toks = extractCJKTokens(read(), undefined, 'preserve', DICT);
    const t = toks.filter((x) => x.text === '开场标识');
    expect(t.length, 'phải tìm thấy token').toBeGreaterThan(0);
    // Ít nhất một lần xuất hiện nằm ở thế khoá object (`{_开场标识: …}`).
    expect(t.some((x) => x.isObjectKey), 'phải có chỗ nhận là khoá object').toBe(true);
  });

  it('ĐỔI KHOÁ THEO TỪ ĐIỂN TRÊN FILE THẬT → output vẫn parse được', () => {
    const src = read();
    const out = reinsertTranslations(src, extractCJKTokens(src, undefined, 'preserve', DICT));
    const err = jsParseErrorAny(out);
    expect(err, `vẫn vỡ cú pháp: ${err ? `dòng ${err.line}: ${err.msg}` : ''}`).toBeFalsy();
  });

  it('KHÔNG còn định danh trần chứa dấu cách (nguyên nhân trực tiếp làm vỡ file)', () => {
    const src = read();
    const out = reinsertTranslations(src, extractCJKTokens(src, undefined, 'preserve', DICT));
    // `X: ...` hoặc `.X ...` mà X có dấu cách và không nằm trong nháy = chắc chắn vỡ.
    const bad = [...out.matchAll(/(^|[{,\s.])([_$A-Za-zÀ-ỹ][\w$À-ỹ]*(?: +[A-Za-zÀ-ỹ][\w$À-ỹ]*)+)\s*:/gm)]
      .filter((m) => !/['"`]/.test(m[0]))
      .slice(0, 5)
      .map((m) => m[2]);
    expect(bad, 'khoá/thuộc tính có dấu cách mà không bọc nháy').toEqual([]);
  });

  it('đường dẫn nhiều đoạn đổi ĐỒNG BỘ cả chỗ đọc lẫn chỗ ghi', () => {
    const src = read();
    const out = reinsertTranslations(src, extractCJKTokens(src, undefined, 'preserve', DICT));
    // `世界运转` có trong từ điển ⇒ mọi lần xuất hiện ở thế khoá/thuộc tính phải đã đổi;
    // sót lại một chỗ là đọc trúng ô rỗng mà không báo lỗi gì.
    expect(out, 'còn sót 世界运转 ở thế thuộc tính').not.toMatch(/\.世界运转(?![\w$一-鿿])/);
    expect(out).toContain('Thế giới vận hành');
  });
});
