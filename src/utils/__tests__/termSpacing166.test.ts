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

/**
 * (bug 172) HỒI QUY DO CHÍNH BẢN VÁ 166-1 — tự thêm khoảng trắng vào GIỮA CHỮ.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "thay vì 'Môi đỏ' lại dịch thành 'M ôi đỏ'", "M ô tả", và trong entry [mvu_update]:
 * "Theo D õi", "D ữ Liệu", "Đường D ẫn".
 *
 * Nguyên nhân, tái hiện được: chữ cái tiếng Việt có dấu KHÔNG phải ASCII, nên trong "Môi" thì cụm
 * ASCII duy nhất là "M" (ô là U+00F4). Bản 166-1 gom "thuật ngữ" bằng mọi cụm ASCII trong nguyên
 * bản — chỉ cần MỘT chữ cái đơn lẻ dính CJK ở bất kỳ đâu (ví dụ "M码") là "M" vào danh sách, rồi
 * MỌI chữ "M" trong bản dịch mà theo sau là chữ cái đều bị chèn dấu cách. Một ký tự lạc ở đầu file
 * đủ làm hỏng cả bản dịch.
 *
 * Bài học: danh sách thuật ngữ gom TOÀN CỤC rồi áp TOÀN CỤC thì một phần tử rác cũng lan ra khắp
 * nơi. Nên siết hình dạng thuật ngữ, và đòi có RANH GIỚI HOA-THƯỜNG thật sự mới chèn.
 */
describe('(bug 172) không được thêm dấu cách vào giữa chữ tiếng Việt', () => {
  // Nguyên bản có đúng một chữ Latin đơn lẻ dính CJK — điều kiện sinh ra lỗi.
  const origWithStrayLetter = 'M码红唇，说明';

  it('ca thật: "Môi đỏ" KHÔNG được thành "M ôi đỏ"', () => {
    expect(restoreTermSpacing(origWithStrayLetter, 'Môi đỏ')).toBe('Môi đỏ');
  });

  it('ca thật: "Mô tả" giữ nguyên', () => {
    expect(restoreTermSpacing(origWithStrayLetter, 'Mô tả')).toBe('Mô tả');
  });

  it('ca thật trong [mvu_update]: "Theo Dõi", "Dữ Liệu", "Đường Dẫn" giữ nguyên', () => {
    const orig = 'D盘追踪，数据，路径';
    const tr = 'Theo Dõi, Dữ Liệu, Đường Dẫn';
    expect(restoreTermSpacing(orig, tr)).toBe(tr);
  });

  it('chữ cái ASCII ĐƠN LẺ không bao giờ được coi là thuật ngữ', () => {
    for (const ch of ['M', 'D', 'T', 'K', 'V']) {
      const tr = `${ch}ôi ${ch}ữ ${ch}ẫn`;
      expect(restoreTermSpacing(`${ch}码测试`, tr), `chữ ${ch} bị tách`).toBe(tr);
    }
  });

  it('cụm chữ thường/hoa-thường lẫn lộn cũng không được tách (chỉ nhận acronym hoặc có chữ số)', () => {
    // "Trang" là cụm ASCII dài nhưng là TỪ TIẾNG VIỆT bình thường — tách ra là hỏng.
    const tr = 'Trangphục đẹp';
    expect(restoreTermSpacing('Trang码服装', tr)).toBe(tr);
  });

  it('KHÔNG cắt vào giữa một từ ASCII có sẵn (CHAIN chứa AI)', () => {
    // Nếu "AI" lọt vào danh sách thuật ngữ, tìm chuỗi con sẽ trúng giữa "CHAIN".
    const tr = 'CHAIN of command';
    expect(restoreTermSpacing('AI测试链', tr)).toBe(tr);
  });

  it('nhưng acronym dính chữ thường THẬT thì vẫn phải vá (không siết quá tay)', () => {
    expect(restoreTermSpacing('结合当前NSFW细节', 'Nội dung kết hợp hiện tạiNSFWchi tiết'))
      .toContain('hiện tại NSFW chi tiết');
  });
});
