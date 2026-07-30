/**
 * (bug 157) HƯỚNG DẪN CỦA HUB PHẢI THEO KỊP TÍNH NĂNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Bảng này sẽ giới thiệu toàn bộ các tính năng hiện có của tool, hướng dẫn cách sử dụng và
 * được AI tự động cập nhật mỗi khi có tính năng mới hoặc sau mỗi lần fix/cập nhật."
 *
 * "Tự động VIẾT hộ" thì không làm được tử tế — máy không biết tính năng dùng ra sao, và để AI bịa
 * vào tài liệu chính thức thì còn hại hơn thiếu. Thứ làm được và có ích thật là TỰ ĐỘNG PHÁT HIỆN
 * THIẾU. Đây là cùng một cơ chế đã dùng cho tài liệu của app Tạo Card
 * (tao-card/src/lib/docs/__tests__/userGuideCoverage.test.ts) — nay áp cho tài liệu cấp hub.
 *
 * Điểm khác và mạnh hơn bản bên tao-card: mục 1 dưới đây KHÔNG đối chiếu với một danh sách chép
 * tay mà đối chiếu thẳng với FLOWS — nguồn sự thật duy nhất về "hub đang có những app nào". Thêm
 * app vào thanh điều hướng mà quên viết hướng dẫn là đỏ ngay, không ai phải nhớ cập nhật test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FLOWS } from '../../flows';

const guide = readFileSync(resolve(__dirname, '../../../USER_GUIDE.md'), 'utf-8');
const norm = guide.toLowerCase();

describe('USER_GUIDE.md (hub) phủ hết app và tính năng lớn', () => {
  it('tài liệu tồn tại và đủ dày để dùng được', () => {
    // Bản đầu chỉ 11.5 KB cho 8 app — mỗi app 3-6 dòng, không đủ để làm theo. Ngưỡng này chặn
    // việc tài liệu bị teo lại về mức đó.
    expect(guide.length).toBeGreaterThan(20000);
  });

  // ── 1. Mọi app trên thanh điều hướng phải có mục riêng ──
  // 'intro' là chính app chứa tài liệu này nên không cần mục giới thiệu bản thân.
  for (const flow of FLOWS.filter(f => f.id !== 'intro')) {
    it(`có mục cho app: ${flow.emoji} ${flow.label}`, () => {
      // Đòi TIÊU ĐỀ chứ không chỉ "có nhắc tên đâu đó" — nhắc tên trong một câu văn thì chưa phải
      // là hướng dẫn dùng app đó.
      const heading = new RegExp(`^#{2,3}\\s+.*${flow.label}`, 'm');
      expect(heading.test(guide),
        `USER_GUIDE.md chưa có mục riêng cho app "${flow.label}" (${flow.id}). `
        + 'Thêm app vào FLOWS thì phải viết một mục "## <emoji> <tên app>" trong hướng dẫn.',
      ).toBe(true);
    });
  }

  // ── 2. Tính năng lớn phải để lại dấu vết ──
  /** [tên tính năng, các từ khoá — chỉ cần MỘT từ khoá có mặt là coi như đã ghi]. */
  const FEATURES: Array<[string, string[]]> = [
    ['Pha 0 — Từ điển (cả 3 app dịch)', ['pha 0', 'từ điển']],
    ['Panel Kiểm tra của Dịch Card', ['panel kiểm tra']],
    ['Schema ↔ Định dạng xuất biến (bug 156)', ['định dạng xuất biến', 'định dạng biến']],
    ['Báo cáo số dòng vào/ra của Dịch Script (bug 160)', ['số dòng']],
    ['Dịch script nhúng trong preset', ['script nhúng']],
    ['Xem trước & Tinh chỉnh (bug 148-2/149)', ['xem trước & tinh chỉnh']],
    ['Ba kiểu cấu trúc Object/Array/Record (bug 155)', ['record']],
    ['Opening Form mô phỏng ở Bước 2 (bug 159-4)', ['opening form']],
    ['Nhờ AI sửa schema giùm (bug 159-5)', ['nhờ ai sửa']],
    ['Tạo thẻ từ truyện (bug 150/158)', ['tạo thẻ từ truyện']],
    ['Sổ tay tri thức / Lorebook', ['sổ tay tri thức', 'lorebook']],
    ['RAG Debug', ['rag debug']],
    ['MVUZOD Studio', ['mvuzod']],
    ['EJS Studio + Preset Nhanh (bug 159-9)', ['preset nhanh']],
    ['Wiki Collector — cào wiki thành lorebook', ['wiki collector']],
    ['Luật [initvar] phải tắt', ['initvar']],
    ['Tool tạo Template Preset (5 khối)', ['template preset', '5 khối']],
    ['Mod Card — Chế độ Mở rộng / đào sâu', ['mở rộng / đào sâu', 'đào sâu']],
    ['Mod Card — Mod biến MVU-Zod', ['mod biến mvu-zod', 'biến mvu-zod']],
    ['Mod Card — mod nối tiếp (bug 88)', ['mod tiếp', 'mod nối tiếp']],
    ['Web Crawler — giả lập host local', ['host local', 'giả lập host']],
    ['Trích Card — model phụ + ngưỡng ký tự (bug 84)', ['model phụ']],
    ['Trích Card — nhập .epub (bug 86)', ['.epub']],
    ['Trích Card — quét trùng & gợi ý gộp', ['gợi ý gộp', 'quét trùng']],
    ['Chọn phiên bản + mở nhiều log (bug 157)', ['chọn phiên bản']],
    ['Cảnh báo lỗi im lặng', ['lỗi im lặng']],
  ];

  for (const [name, keys] of FEATURES) {
    it(`có ghi: ${name}`, () => {
      const hit = keys.some(k => norm.includes(k.toLowerCase()));
      expect(hit, `USER_GUIDE.md chưa nhắc tới "${name}" (tìm: ${keys.join(' / ')}). `
        + 'Thêm tính năng thì phải viết vào hướng dẫn — đây chính là chốt chặn cho việc đó.').toBe(true);
    });
  }

  // ── 3. Ràng buộc của bộ render, không phải sở thích trình bày ──
  it('chỉ dùng tối đa 3 cấp tiêu đề', () => {
    // renderGuide() chỉ bắt /^#{1,3}\s+/. Viết '#### Foo' thì nó rơi xuống nhánh đoạn văn và hiện
    // ra nguyên chữ '#### Foo' trên giao diện — sai mà không có lỗi nào báo.
    const tooDeep = guide.split('\n')
      .map((l, i) => ({ l: l.trimEnd(), n: i + 1 }))
      .filter(({ l }) => /^#{4,}\s+/.test(l));
    expect(tooDeep.map(({ l, n }) => `dòng ${n}: ${l}`),
      'Bộ render của tab Hướng dẫn chỉ hiểu tới ###. Hạ cấp các tiêu đề này xuống.',
    ).toEqual([]);
  });

  it('mọi mục lớn đều đánh số liền mạch', () => {
    // Mục lục ở tab Hướng dẫn được sinh tự động từ tiêu đề, nên không cần mục lục chép tay — thứ
    // cần canh là số mục không nhảy cóc (dấu hiệu đã xoá/chèn mục mà quên đánh số lại).
    const nums = [...guide.matchAll(/^##\s+(\d+)\./gm)].map(m => Number(m[1]));
    expect(nums.length).toBeGreaterThanOrEqual(10);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });
});
