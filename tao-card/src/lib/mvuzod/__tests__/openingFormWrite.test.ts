// (bugNeedFix/114) "Giao diện Opening khi nhập thông tin, bấm xác nhận thì chỉ mới đang nhập cho
// có, chứ chưa cập nhật vào Trình quản lý biến."
//
// GỐC RỄ: form render input với id CÓ HẬU TỐ (-slider/-input/-cards/-check) nhưng bảng `mappings`
// lại ghi id TRẦN ⇒ `data[m.inputId]` luôn undefined ⇒ không dựng được lệnh _.set nào ⇒ hàm thoát
// IM LẶNG (không lỗi, không toast). Form vẫn nhận chữ, bảng tóm tắt vẫn hiện, nên nhìn như đã lưu.
//
// Thẻ mẫu user gửi (One Piece) ghi biến ĐÚNG bằng `insertOrAssignVariables({stat_data:…})` — API
// mà TavernHelper bơm sẵn vào iframe. Ta lấy đó làm đường dự phòng vì `Mvu` được MagVarUpdate gắn
// lên window.parent nên có thể chưa sẵn sàng.
import { describe, it, expect } from 'vitest';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { checkFormWritePath } from '../mvuHarness';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: 'Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        { path: 'Người Chơi/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
        { path: 'Người Chơi/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 0, max: 100 } },
        { path: 'Người Chơi/Veil Coin', type: 'number', label: 'Veil Coin', defaultValue: 0, constraints: {} },
        { path: 'Người Chơi/Phả Hệ', type: 'string', label: 'Phả Hệ', defaultValue: 'Ignis', constraints: { enumValues: ['Ignis', 'Glacis'] } },
        { path: 'Người Chơi/Đã Thức Tỉnh', type: 'boolean', label: 'Đã Thức Tỉnh', defaultValue: false, constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

const form = buildProgrammaticRegex({ schema: SCHEMA, component: 'opening_form' });
const src = form.scripts.map(s => s.replaceString ?? '').join('\n');

/** Mọi id xuất hiện trong bảng mappings. */
const mapIds = [...src.matchAll(/"inputId":"([^"]+)"/g)].map(m => m[1]);
/** Mọi id thật của thẻ input trong HTML. */
const domIds = [...src.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);

describe('CHÍNH CA: id trong mappings phải khớp id THẬT của thẻ input', () => {
  it('có sinh ra mappings (không rỗng)', () => {
    expect(mapIds.length).toBeGreaterThan(0);
  });

  it('MỌI id trong mappings đều tồn tại trong DOM — không còn tra ra undefined', () => {
    const missing = mapIds.filter(id => !domIds.includes(id));
    expect(missing).toEqual([]);
  });

  it('không còn id TRẦN (thiếu hậu tố) trong mappings', () => {
    const bare = mapIds.filter(id => !/-(?:slider|input|cards|check)$/.test(id));
    expect(bare).toEqual([]);
  });

  it('mỗi loại field dùng đúng hậu tố', () => {
    expect(mapIds.some(id => id.endsWith('-input'))).toBe(true);   // chuỗi
    expect(mapIds.some(id => id.endsWith('-slider'))).toBe(true);  // số
    expect(mapIds.some(id => id.endsWith('-cards'))).toBe(true);   // lựa chọn
    expect(mapIds.some(id => id.endsWith('-check'))).toBe(true);   // bật/tắt
  });
});

describe('collectFormData phải thu ĐỦ mọi loại input', () => {
  it('quét cả thanh trượt (trước đây chỉ thu khi người chơi động vào)', () => {
    expect(src).toContain('input[type=range]');
  });

  it('quét checkbox', () => {
    expect(src).toContain('input[type=checkbox]');
  });

  it('đọc thẻ đang chọn trong lưới lựa chọn', () => {
    expect(src).toContain('.stcs-card-grid');
    expect(src).toContain('.stcs-card.selected');
  });
});

describe('Không được thất bại IM LẶNG', () => {
  it('thu không được gì thì báo rõ trên trang kết quả, kèm danh sách id cần và id có', () => {
    expect(src).toMatch(/Không thu được giá trị nào từ form/);
    expect(src).toContain('showResult(false');
  });
});

describe('(bug 116) Đường ghi biến — MỘT đường duy nhất theo khuôn thẻ One Piece', () => {
  it('ghi qua insertOrAssignVariables với payload bọc stat_data', () => {
    expect(src).toContain('insertOrAssignVariables');
    expect(src).toContain('stat_data: tree');
  });

  it('ghi vào biến của TIN NHẮN mới nhất (đúng chỗ Trình quản lý biến đọc)', () => {
    expect(src).toMatch(/type:\s*'message'/);
    expect(src).toMatch(/message_id:\s*'latest'/);
  });

  it('KHÔNG còn chuỗi fallback Mvu.parseMessage — nhiều phong cách là nhiều chỗ hỏng', () => {
    expect(src).not.toContain('parseMessage');
    expect(src).not.toContain('replaceMvuData');
  });

  it('với không tới được API thì thử TavernHelper ở parent trước khi bó tay', () => {
    expect(src).toContain('window.parent.TavernHelper');
  });
});

describe('(bug 116 — GỐC RỄ THẬT) hàm được gọi phải TỒN TẠI trong script', () => {
  it('stcsSetHtml giờ có trong sharedJS của form (trước đây chỉ status bar có → ReferenceError ở dòng đầu onConfirm, phần ghi biến không bao giờ chạy)', () => {
    expect(src).toMatch(/function stcsSetHtml/);
  });

  it('trang kết quả + copy: showResult / copyProfileText / buildProfileText đều khai báo đủ', () => {
    for (const fn of ['showResult', 'copyProfileText', 'buildProfileText', 'renderSummary']) {
      expect(src, `thiếu khai báo ${fn}`).toMatch(new RegExp(`function ${fn}\\s*\\(`));
    }
  });

  it('trang kết quả có đủ khuôn One Piece: trạng thái + ô hồ sơ + nút Sao chép', () => {
    expect(src).toContain('stcs-result-status');
    expect(src).toContain('stcs-out-text');
    expect(src).toContain('stcs-copy-btn');
    expect(src).toMatch(/gửi làm tin nhắn đầu tiên/);
  });
});

describe('Bộ kiểm harness bắt được đúng lớp lỗi này', () => {
  it('form do builder sinh bây giờ SẠCH', () => {
    const r = checkFormWritePath(src);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('form với id TRẦN bị bắt lỗi đích danh', () => {
    const bad = src.replace(/"inputId":"([^"]+)-(?:slider|input|cards|check)"/g, '"inputId":"$1"');
    const r = checkFormWritePath(bad);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('id TRẦN');
  });

  it('gọi hàm không khai báo (ca stcsSetHtml của bug 116) bị bắt đích danh', () => {
    const bad = src.replace(/function stcsSetHtml/g, 'function stcsSetHtml_renamed');
    const r = checkFormWritePath(bad);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('stcsSetHtml');
    expect(r.problems.join(' ')).toContain('ReferenceError');
  });

  it('thiếu hẳn đường ghi → bắt lỗi', () => {
    const bad = src.replace(/insertOrAssignVariables/g, 'khongCoGi');
    const r = checkFormWritePath(bad);
    expect(r.ok).toBe(false);
  });
});

describe('(bug 116) Trang chọn bối cảnh bắt đầu', () => {
  it('có scenarios → form thêm trang chọn, dùng lưới thẻ nên collectFormData thu được', () => {
    const withSc = buildProgrammaticRegex({
      schema: SCHEMA, component: 'opening_form',
      scenarios: [
        { title: 'Tân binh nhập ngũ', desc: 'Bắt đầu ở doanh trại.' },
        { title: 'Kẻ trốn chạy', desc: 'Mở màn giữa rừng sâu.' },
      ],
    });
    const s2 = withSc.scripts.map(s => s.replaceString ?? '').join('\n');
    expect(s2).toContain('stcs-scenario-cards');
    expect(s2).toContain('Tân binh nhập ngũ');
    expect(s2).toContain('Chọn bối cảnh bắt đầu');
  });

  it('không có scenarios → không có trang bối cảnh (không phình form)', () => {
    // id 'stcs-scenario-cards' vẫn xuất hiện trong JS (buildProfileText đọc nó an toàn) —
    // thứ không được có là TRANG chọn trong HTML.
    expect(src).not.toContain('Chọn bối cảnh bắt đầu');
    expect(src).not.toContain('class="stcs-card-grid" id="stcs-scenario-cards"');
  });
});
