// (bug 159-4) "Bước 2 chỉ cho xem trước Status Bar. Cần bổ sung Opening Form mô phỏng, tương tác
// được… sau khi điền vào Opening Form thì Status Bar cũng phải tự động cập nhật theo."
//
// Hai gốc:
//   • `full_set` dựng CẢ HAI nhưng trả về `previewHtml: statusResult.previewHtml` kèm chú thích
//     "use status bar as primary preview" ⇒ Opening Form bị vứt khỏi khung xem trước.
//   • MVU giả của bug 148-3 CHỈ ĐỌC: insertOrAssignVariables và setvar là hàm rỗng, nên bấm Xác
//     nhận trong form chẳng ghi gì, và Status Bar không bao giờ đổi.
import { describe, it, expect } from 'vitest';
import { withPreviewData } from '../schemaPreviewData';
import { buildProgrammaticRegex } from '../../mvuzod/programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../../mvuzod/normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [{
    path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
    children: [
      { path: '/Người Chơi/Họ Tên', type: 'string', label: 'Họ Tên', defaultValue: '', constraints: {} },
      { path: '/Người Chơi/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: { min: 0, max: 100 } },
    ],
  }],
}) as MVUZODSchema;

describe('(bug 159-4) full_set không được đánh mất Opening Form', () => {
  const built = buildProgrammaticRegex({ schema: SCHEMA, component: 'full_set', themeId: 'fantasy_medieval', gameName: 'Thử' });

  it('trả về CẢ HAI phần, không chỉ Status Bar', () => {
    expect(built.parts?.statusBar, 'thiếu Status Bar').toBeTruthy();
    expect(built.parts?.openingForm, 'Opening Form bị vứt như bản cũ').toBeTruthy();
  });

  it('hai phần là hai tài liệu KHÁC nhau (không phải cùng một thứ đặt hai tên)', () => {
    expect(built.parts?.openingForm).not.toBe(built.parts?.statusBar);
  });

  it('Opening Form có ô nhập và nút bấm — tức là tương tác được', () => {
    const f = built.parts?.openingForm ?? '';
    expect(f).toMatch(/<input|<select|<textarea/i);
    expect(f).toMatch(/onclick=/i);
  });
});

describe('(bug 159-4) MVU giả phải GHI ĐƯỢC, không chỉ đọc', () => {
  const stub = (role: 'form' | 'status' | 'solo') => withPreviewData('<html><head></head><body></body></html>', SCHEMA, role);

  it('insertOrAssignVariables trộn dữ liệu vào rồi phát sự kiện (bản cũ là hàm rỗng)', () => {
    const s = stub('form');
    expect(s).toContain('window.insertOrAssignVariables');
    expect(s, 'phải trộn sâu, không ghi đè cả cây').toContain('deepMerge');
    expect(s, 'ghi xong phải bắn cho bên vẽ biết').toContain('fire()');
  });

  it('setvar cũng ghi thật', () => {
    expect(stub('form')).toMatch(/window\.setvar = function \(path, value\)/);
  });

  it('eventOn GIỮ callback — đó là đường Status Bar đăng ký vẽ lại', () => {
    // Bản cũ eventOn là hàm rỗng nên callback populateData bị bỏ đi, ghi bao nhiêu cũng vô ích.
    expect(stub('status')).toContain('listeners.push(cb)');
  });

  it('khung form PHÁT đi, khung status LẮNG NGHE, khung đơn lẻ thì im', () => {
    expect(stub('form'), 'form phải gửi sang cha').toContain('parent.postMessage');
    expect(stub('status'), 'status phải nghe message').toContain("addEventListener('message'");
    // Vai được chốt bằng hằng số nhúng sẵn, và cả hai nhánh đều canh theo nó — nên khung `solo`
    // không phát mà cũng không nghe, dù đoạn mã vẫn nằm trong chuỗi.
    expect(stub('solo')).toContain('var ROLE = "solo"');
    expect(stub('solo'), 'phát thì phải thoát sớm khi solo').toContain("if (ROLE === 'solo') return");
    expect(stub('solo'), 'nghe thì phải canh vai status').toContain("if (ROLE === 'status')");
  });

  it('mảng thì THAY chứ không trộn — trộn mảng là nhân đôi phần tử', () => {
    expect(stub('form')).toContain('!Array.isArray(v)');
  });

  it('không có schema vẫn dựng được stub, không nổ', () => {
    expect(withPreviewData('<html><head></head><body></body></html>', null, 'form')).toContain('insertOrAssignVariables');
  });
});
