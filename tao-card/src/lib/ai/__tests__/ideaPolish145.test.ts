/**
 * (bugNeedFix/145) Đũa thần ý tưởng KHÔNG BAO GIỜ chạy được — bấm xong hiện
 * "AI làm rơi chi tiết (2.1, 2.2, 2.3, 2.4…) — đã GIỮ NGUYÊN văn gốc của bạn", ý tưởng không
 * được sắp xếp và ô quy tắc cũng không được rút.
 *
 * Gốc bệnh: chốt 1-1 coi MỌI con số là "nội dung phải giữ", kể cả SỐ THỨ TỰ MỤC LỤC. Mà nhiệm
 * vụ của đũa thần đúng là xoá "2.1/2.2" đi để thay bằng tiêu đề "## …" — nên guard bắn mọi lần,
 * với bất kỳ ý tưởng nào viết theo dàn ý đánh số. Số nội dung thật (100 linh thạch, 5 tông môn)
 * vẫn phải được canh giữ như cũ.
 */
import { describe, it, expect } from 'vitest';
import { extractAnchorTokens, verifyIdeaPolish, isOutlineNumber, buildIdeaPolishMessages } from '../ideaPolish';

const ORIGINAL = `Ý tưởng card tu tiên.
1. Nhân vật chính
2. Thế giới
2.1 Đại lục Thiên Nam có 5 tông môn
2.2 Cảnh giới: Luyện Khí, Trúc Cơ, Kim Đan
2.3 Linh thạch dùng làm tiền, 100 linh thạch = 1 lượng vàng
2.4 Nhân vật Lâm Uyển là sư tỷ
3. Cốt truyện`;

const POLISHED_OK = `## Nhân vật chính
- Lâm Uyển là sư tỷ

## Thế giới & bối cảnh
- Đại lục Thiên Nam có 5 tông môn
- Cảnh giới: Luyện Khí, Trúc Cơ, Kim Đan
- Linh thạch dùng làm tiền, 100 linh thạch = 1 lượng vàng

## Cốt truyện & mở đầu
- (ý tưởng chưa nêu)`;

describe('bug 145 — số thứ tự mục lục không phải nội dung', () => {
  it('CHÍNH CA: bản sắp xếp đúng phải được CHẤP NHẬN (trước đây bị từ chối)', () => {
    const r = verifyIdeaPolish(ORIGINAL, POLISHED_OK);
    expect(r.dropped).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('số mục lục bị loại khỏi danh sách neo', () => {
    const anchors = extractAnchorTokens(ORIGINAL);
    // Lưu ý "1" KHÔNG có trong danh sách này: ngoài mục "1." đầu dòng, ý tưởng còn có
    // "= 1 lượng vàng" giữa câu — đó là số NỘI DUNG nên vẫn phải được canh giữ.
    for (const n of ['2', '3', '2.1', '2.2', '2.3', '2.4']) {
      expect(anchors, `số mục ${n} không được tính là neo`).not.toContain(n);
    }
  });

  it('số chỉ đóng vai mục lục (không trùng số nội dung) bị loại sạch', () => {
    const t = '1. Mở đầu\n2. Thân bài\n3. Kết thúc';
    expect(extractAnchorTokens(t).filter(x => /^\d/.test(x))).toEqual([]);
  });

  it('số NỘI DUNG giữa câu vẫn được canh giữ', () => {
    const anchors = extractAnchorTokens(ORIGINAL);
    expect(anchors).toContain('100');
    expect(anchors).toContain('5');
    // Đổi 100 → 1000 vẫn phải bị bắt (đổi ý người dùng).
    const bad = POLISHED_OK.replace('100 linh thạch', '1000 linh thạch');
    expect(verifyIdeaPolish(ORIGINAL, bad).ok).toBe(false);
  });

  it('tên riêng vẫn được canh giữ', () => {
    const anchors = extractAnchorTokens(ORIGINAL);
    expect(anchors).toContain('Thiên Nam');
    expect(anchors).toContain('Lâm Uyển');
    const bad = POLISHED_OK.replace('Lâm Uyển', 'cô ấy');
    expect(verifyIdeaPolish(ORIGINAL, bad).ok).toBe(false);
  });

  it('từ đơn viết hoa ĐẦU MỤC không bị tính là tên riêng', () => {
    // "Nhân" mở đầu "Nhân vật chính" (đầu dòng) — viết hoa do ngữ pháp, đũa thần có quyền
    // đổi tiêu đề nên không được bắt giữ nguyên.
    expect(extractAnchorTokens(ORIGINAL)).not.toContain('Nhân');
  });

  it('từ đơn viết hoa GIỮA CÂU lặp lại vẫn là tên riêng', () => {
    const t = 'Cô gặp Kaelis ở chợ. Sau đó Kaelis biến mất.';
    expect(extractAnchorTokens(t)).toContain('Kaelis');
  });

  it('isOutlineNumber phân biệt đúng hai loại số', () => {
    const t = '2.1 Đại lục có 5 tông môn';
    expect(isOutlineNumber(t, 0, '2.1')).toBe(true);       // số mục
    expect(isOutlineNumber(t, t.indexOf('5'), '5')).toBe(false); // số nội dung
  });

  it('các kiểu đánh số khác cũng được nhận (1), 3-, • 4.)', () => {
    const t = '1) Mở đầu\n- 2. Thân bài\n• 3 Kết';
    const a = extractAnchorTokens(t);
    expect(a).not.toContain('1');
    expect(a).not.toContain('2');
    expect(a).not.toContain('3');
  });
});

describe('bug 145 — thử lại có chỉ đích danh thay vì bắt user tự bấm lại', () => {
  it('lượt đầu chỉ có 2 message', () => {
    expect(buildIdeaPolishMessages('abc')).toHaveLength(2);
  });

  it('lượt sửa có thêm message liệt kê chi tiết đã rơi', () => {
    const msgs = buildIdeaPolishMessages('abc', ['Lâm Uyển', '100']);
    expect(msgs).toHaveLength(3);
    expect(msgs[2].content).toContain('Lâm Uyển');
    expect(msgs[2].content).toContain('100');
    expect(msgs[2].content).toContain('LÀM RƠI');
  });
});
