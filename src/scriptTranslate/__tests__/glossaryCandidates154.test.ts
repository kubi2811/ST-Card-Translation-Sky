// (bug 154-2) "Tạo từ điển (1 lượt AI)" chỉ ra 2~5 thuật ngữ.
//
// Nguyên nhân: pha 0 CỐ Ý loại object key / dot-notation khỏi mẫu, kèm chú thích "tên trong đó
// giữ nguyên, đừng dạy AI dịch". Đúng cho tới bug 151 — hồi đó khoá không bao giờ đổi tên.
// Nhưng bug 151 biến TỪ ĐIỂN thành cơ chế đổi khoá, nên loại chúng ra tức là pha 0 không bao
// giờ đề xuất nổi thứ user cần nhất; còn lại vài tên riêng trong văn xuôi.
import { describe, it, expect } from 'vitest';
import { buildScriptGlossaryCandidates } from '../glossaryPhase';
import { extractCJKTokens } from '../../utils/surgical';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('(bug 154-2) ứng viên từ điển phải gồm KHOÁ DỮ LIỆU', () => {
  it('khoá object và thuộc tính đều thành ứng viên', () => {
    const src = `const a={世界运转:{_开场标识:1,当前日期:2}};const b=x.天气;`;
    const terms = buildScriptGlossaryCandidates(extractCJKTokens(src)).map((c) => c.term);
    for (const want of ['世界运转', '开场标识', '当前日期', '天气']) {
      expect(terms, `thiếu ${want}`).toContain(want);
    }
  });

  it('khoá được đánh dấu fromKeys → giữ dù chỉ xuất hiện MỘT lần', () => {
    // Bỏ sót một khoá là chỗ đọc/ghi lệch nhau, nên không được lọc theo tần suất.
    const cands = buildScriptGlossaryCandidates(extractCJKTokens(`const a={孤立键:1};`));
    const hit = cands.find((c) => c.term === '孤立键');
    expect(hit, 'khoá xuất hiện 1 lần vẫn phải là ứng viên').toBeTruthy();
    expect(hit?.fromKeys).toBe(true);
  });

  it('tiền tố ASCII được bóc: `_开场标识` vào từ điển dưới dạng `开场标识`', () => {
    const terms = buildScriptGlossaryCandidates(extractCJKTokens(`const a={_开场标识:1};`)).map((c) => c.term);
    expect(terms).toContain('开场标识');
    expect(terms, 'không đưa cả gạch dưới vào từ điển').not.toContain('_开场标识');
  });

  it('không có token nào → danh sách rỗng, không tốn lượt AI', () => {
    expect(buildScriptGlossaryCandidates([])).toEqual([]);
  });
});

const SRC = resolve(__dirname, '../../../bug/154/Trước Dịch.txt');
describe.skipIf(!existsSync(SRC))('(bug 154-2) trên script thật của user', () => {
  it('đề xuất được HÀNG CHỤC thuật ngữ, không phải 2~5', () => {
    const toks = extractCJKTokens(readFileSync(SRC, 'utf-8'));
    const cands = buildScriptGlossaryCandidates(toks);
    expect(cands.length, `chỉ đề xuất được ${cands.length} mục`).toBeGreaterThan(20);
    // Đúng những tên user liệt kê trong báo cáo "Đang giữ" phải nằm trong đề xuất.
    const terms = new Set(cands.map((c) => c.term));
    for (const want of ['世界运转', '天气', '当前日期']) {
      expect(terms.has(want), `thiếu ${want} — đúng cái user phàn nàn`).toBe(true);
    }
  });
});
