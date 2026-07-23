import { describe, it, expect } from 'vitest';
import { MVU_RUNTIME_HELPERS, MVU_VAR_ACCESS_RULES } from '../mvuRuntime';

/**
 * (User 21/07 — việc 78) Đối chiếu repo MagicalAstrogy/MagVarUpdate + card MVU thật đang
 * chạy được: MVU lưu MỖI biến dưới dạng CẶP `[giá_trị, "mô tả"]`.
 *
 *   stat_data['Cảnh Giới']       →  ["Luyện Khí", "cảnh giới tu luyện hiện tại"]
 *   stat_data['Cảnh Giới'][0]    →  "Luyện Khí"   ← thứ cần hiển thị
 *
 * Đọc thẳng mà không lấy [0] thì bảng in ra cả mô tả (hoặc "[object Object]") — đây chính
 * là "bảng không ăn biến". Bộ helper dưới đây được nhúng vào MỌI UI sinh ra để không bao
 * giờ lặp lại lỗi này.
 */

/** Chạy đoạn helper trong sandbox rồi trả về các hàm để test thật. */
function loadHelpers() {
  const fn = new Function(`${MVU_RUNTIME_HELPERS}; return { mvuLeaf, mvuGet, mvuNum, mvuText };`);
  return fn() as {
    mvuLeaf: (v: unknown) => unknown;
    mvuGet: (data: unknown, path: string, dflt?: unknown) => unknown;
    mvuNum: (v: unknown, dflt?: number) => number;
    mvuText: (v: unknown, dflt?: string) => string;
  };
}

describe('mvuLeaf — bóc cặp [giá trị, mô tả]', () => {
  const { mvuLeaf } = loadHelpers();

  it('mảng cặp → lấy phần tử đầu (giá trị thật)', () => {
    expect(mvuLeaf(['Luyện Khí', 'cảnh giới hiện tại'])).toBe('Luyện Khí');
    expect(mvuLeaf([42, 'máu'])).toBe(42);
  });

  it('giá trị trần (không bọc mảng) → giữ nguyên', () => {
    expect(mvuLeaf('Luyện Khí')).toBe('Luyện Khí');
    expect(mvuLeaf(7)).toBe(7);
  });

  it('mảng rỗng → undefined, không nổ', () => {
    expect(mvuLeaf([])).toBeUndefined();
  });

  it('null/undefined → giữ nguyên, không nổ', () => {
    expect(mvuLeaf(null)).toBeNull();
    expect(mvuLeaf(undefined)).toBeUndefined();
  });
});

describe('mvuGet — đọc theo đường dẫn + tự bóc cặp', () => {
  const { mvuGet } = loadHelpers();
  const data = {
    'Người Chơi': {
      'Cảnh Giới': ['Luyện Khí Tầng 3', 'cảnh giới tu luyện'],
      'Máu': [88, '0-100'],
    },
    'Ngày': ['15/03', 'định dạng dd/mm'],
  };

  it('đọc lồng nhau và bóc luôn cặp', () => {
    expect(mvuGet(data, 'Người Chơi.Cảnh Giới')).toBe('Luyện Khí Tầng 3');
    expect(mvuGet(data, 'Người Chơi.Máu')).toBe(88);
  });

  it('đọc key có KHOẢNG TRẮNG (tên biến tiếng Việt luôn có)', () => {
    expect(mvuGet(data, 'Ngày')).toBe('15/03');
  });

  it('đường dẫn không tồn tại → trả mặc định, KHÔNG nổ', () => {
    expect(mvuGet(data, 'Không.Có.Đâu', '—')).toBe('—');
    expect(mvuGet(null, 'a.b', 'x')).toBe('x');
  });
});

describe('mvuNum / mvuText — ép kiểu an toàn cho hiển thị', () => {
  const { mvuNum, mvuText } = loadHelpers();

  it('mvuNum bóc cặp rồi ép số', () => {
    expect(mvuNum([88, 'máu'])).toBe(88);
    expect(mvuNum(['12', 'chuỗi số'])).toBe(12);
  });

  it('mvuNum gặp giá trị không phải số → trả mặc định (không ra NaN trên giao diện)', () => {
    expect(mvuNum(['abc', 'hỏng'], 0)).toBe(0);
    expect(mvuNum(undefined, 5)).toBe(5);
  });

  it('mvuText bóc cặp rồi ra chuỗi', () => {
    expect(mvuText(['Luyện Khí', 'mô tả'])).toBe('Luyện Khí');
  });

  it('mvuText gặp object (YAML parse lỗi thành dict) → KHÔNG in [object Object]', () => {
    const out = mvuText({ a: 1, b: 2 });
    expect(out).not.toContain('[object Object]');
    expect(out.length).toBeGreaterThan(0);
  });

  it('mvuText null → trả mặc định', () => {
    expect(mvuText(null, '—')).toBe('—');
  });
});

describe('MVU_VAR_ACCESS_RULES — luật bơm vào prompt AI', () => {
  it('nói rõ biến là cặp [giá trị, mô tả] và phải lấy [0]', () => {
    expect(MVU_VAR_ACCESS_RULES).toMatch(/\[0\]/);
    expect(MVU_VAR_ACCESS_RULES).toMatch(/mô tả/i);
  });

  it('bắt buộc dùng helper thay vì đọc thẳng', () => {
    expect(MVU_VAR_ACCESS_RULES).toContain('mvuGet');
  });

  it('có nhắc sự kiện cập nhật lại giao diện', () => {
    expect(MVU_VAR_ACCESS_RULES).toContain('VARIABLE_UPDATE_ENDED');
  });
});
