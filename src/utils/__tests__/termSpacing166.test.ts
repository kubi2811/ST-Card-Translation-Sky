/**
 * (bug 166-1) DỊCH CARD DÍNH CHỮ QUANH THUẬT NGỮ TIẾNG ANH.
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai ví dụ user gửi:
 *   "…tiến hành cập nhật.SFW và WAR trong bối cảnh không cập nhật trường này"
 *   "Nội dung kết hợp hiện tạiNSFWchi tiết tình tiết…"
 *
 * Vì sao xảy ra: tiếng Trung KHÔNG dùng dấu cách, nên nguyên bản viết liền
 * `当前NSFW细节` / `更新。SFW`. AI dịch từng cụm Hán sang tiếng Việt nhưng giữ nguyên thuật ngữ
 * Latin ở giữa, và không tự thêm dấu cách — ra `hiện tạiNSFWchi tiết`.
 *
 * Khác với bug 160: ở Dịch Script, bản dịch được ghép lại bằng reinsertTranslations nên lưới
 * auto-space nằm ở đó. Còn Dịch Card gửi CẢ field cho AI rồi nhận về nguyên khối — không có khâu
 * ghép nào, nên lưới kia không chạm tới. Phải có pass hậu kiểm riêng.
 *
 * NGUYÊN TẮC ĐỂ KHÔNG SỬA OAN: chỉ chèn dấu cách ở ranh giới mà NGUYÊN BẢN là CJK↔Latin. Chỗ nào
 * nguyên bản vốn đã là Latin↔Latin (`getVar`, `iPhone`, `TavernHelper`) thì tuyệt đối không đụng —
 * đó mới là chỗ tách ra sẽ làm hỏng.
 */
import { describe, it, expect } from 'vitest';
import { restoreTermSpacing } from '../apiClient';

describe('(bug 166-1) chèn lại dấu cách quanh thuật ngữ Latin', () => {
  it('ca thật 1: dính sau dấu câu — "cập nhật.SFW"', () => {
    const original = '仅在NSFW语境下进行更新。SFW和WAR语境下不更新此字段';
    const bad = 'Chỉ ở trong NSFW bối cảnh tiến hành cập nhật.SFW và WAR trong bối cảnh không cập nhật trường này';
    const out = restoreTermSpacing(original, bad);
    expect(out).toContain('cập nhật. SFW');
    expect(out, 'chỗ vốn đã có dấu cách thì giữ nguyên').toContain('SFW và WAR');
  });

  it('ca thật 2: dính hai bên — "hiện tạiNSFWchi tiết"', () => {
    const original = '结合当前NSFW细节情节';
    const bad = 'Nội dung kết hợp hiện tạiNSFWchi tiết tình tiết';
    const out = restoreTermSpacing(original, bad);
    expect(out).toContain('hiện tại NSFW chi tiết');
  });

  it('thuật ngữ chỉ dính MỘT bên thì chỉ vá bên đó', () => {
    const out = restoreTermSpacing('当前NSFW 细节', 'hiện tạiNSFW chi tiết');
    expect(out).toBe('hiện tại NSFW chi tiết');
  });

  it('KHÔNG tách camelCase — nguyên bản vốn là Latin↔Latin', () => {
    // Đây là chỗ mà tách ra sẽ làm hỏng thật: tên hàm, tên sản phẩm.
    for (const t of ['getVar', 'TavernHelper', 'iPhone', 'JavaScript', 'setVariables']) {
      expect(restoreTermSpacing(`调用${t}方法`, `gọi ${t} phương thức`)).toContain(t);
      expect(restoreTermSpacing(`调用${t}方法`, `gọi${t}phương thức`)).not.toMatch(
        new RegExp(t.replace(/([A-Z])/g, ' $1')),
      );
    }
  });

  it('không đụng placeholder mask (__CODE_BLOCK_0__, __URL_1__)', () => {
    const original = '看这个__URL_1__链接';
    const bad = 'xem cái__URL_1__liên kết này';
    const out = restoreTermSpacing(original, bad);
    expect(out, 'placeholder phải nguyên vẹn để unmask còn khớp').toContain('__URL_1__');
    expect(out).not.toContain('__URL_ 1__');
    expect(out).not.toContain('_ _URL');
  });

  it('bản dịch không dính gì → trả về y nguyên (không sinh khác biệt vô cớ)', () => {
    const good = 'Chỉ trong bối cảnh NSFW thì mới cập nhật.';
    expect(restoreTermSpacing('仅在NSFW语境下才更新。', good)).toBe(good);
  });

  it('nguyên bản không có CJK → không làm gì (đường an toàn)', () => {
    const t = 'NSFWcontent stays';
    expect(restoreTermSpacing('NSFWcontent stays', t)).toBe(t);
  });

  it('rỗng / thiếu tham số không nổ', () => {
    expect(restoreTermSpacing('', '')).toBe('');
    expect(restoreTermSpacing('当前NSFW', '')).toBe('');
  });

  it('không chèn cách trước dấu câu hoặc sau dấu mở ngoặc', () => {
    // 'NSFW,' → nếu chèn thành 'NSFW ,' thì thành lỗi trình bày mới.
    const out = restoreTermSpacing('当前NSFW，细节', 'hiện tạiNSFW, chi tiết');
    expect(out).toContain('hiện tại NSFW,');
    expect(out).not.toContain('NSFW ,');
  });

  it('thuật ngữ xuất hiện nhiều lần đều được vá', () => {
    const out = restoreTermSpacing('当前NSFW细节和NSFW场景', 'hiện tạiNSFWchi tiết vàNSFWcảnh');
    expect((out.match(/ NSFW /g) ?? []).length).toBe(2);
  });

  it('số và đơn vị: 10px trong CSS không bị tách', () => {
    const out = restoreTermSpacing('阴影10px模糊', 'bóng10pxmờ');
    expect(out).toContain('10px');
    expect(out).not.toContain('10 px');
  });
});
