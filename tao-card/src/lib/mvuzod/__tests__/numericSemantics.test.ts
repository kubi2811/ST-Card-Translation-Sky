// (bugNeedFix/113) "nếu không mô tả chi tiết phạm vi giá trị, UI tự động áp giới hạn mặc định
// 0-100 cho TẤT CẢ biến số". Ảnh kèm: "Ngày (Thời gian trôi) 1/100", "Tiền tệ Veil Coin 75/100",
// "Lọ Tinh Chất Veil 2/100" — trong khi "Thiên Phú (Sao) 4/5" và "Tăng tích lũy 1/10" thì đúng.
import { describe, it, expect } from 'vitest';
import {
  decideNumericBounds, isUnboundedCounter, looksLikeGauge, stripBogusNumericCaps,
} from '../numericSemantics';
import type { MVUZODField, MVUZODSchema } from '../../../types/mvuzod.types';

const f = (path: string, extra: Partial<MVUZODField> = {}): MVUZODField => ({
  path, type: 'number', label: path.split('/').pop() ?? path,
  defaultValue: 0, constraints: {}, ...extra,
} as MVUZODField);

/** Trần 0-100 mà AI chép từ ví dụ trong prompt. */
const capped = { min: 0, max: 100 };

describe('CHÍNH CA: bộ đếm không được kẹp trần 100', () => {
  it('Ngày / Thời gian trôi → bỏ trần', () => {
    const d = decideNumericBounds(f('Thế Giới/Ngày (Thời gian trôi)', { constraints: capped }));
    expect(d.bounded).toBe(false);
    expect(d.reason).toBe('counter');
  });

  it('Tiền tệ (Veil Coin / vàng / xu / linh thạch) → bỏ trần', () => {
    for (const name of ['Túi Đồ/Tiền tệ Veil Coin', 'Túi Đồ/Vàng', 'Túi Đồ/Xu', 'Người Chơi/Linh Thạch']) {
      expect(decideNumericBounds(f(name, { constraints: capped })).bounded).toBe(false);
    }
  });

  it('Số lượng vật phẩm → bỏ trần', () => {
    expect(decideNumericBounds(f('Túi Đồ/Số lượng Lọ Tinh Chất', { constraints: capped })).bounded).toBe(false);
  });

  it('Điểm tích luỹ / kinh nghiệm / điểm cống hiến → bỏ trần', () => {
    for (const name of ['Trấn Minh/Điểm Cống Hiến', 'Người Chơi/Kinh Nghiệm', 'Người Chơi/EXP']) {
      expect(decideNumericBounds(f(name, { constraints: capped })).bounded).toBe(false);
    }
  });
});

describe('Biến CÓ trần thật thì phải giữ nguyên (ca user nói đang chạy ĐÚNG)', () => {
  it('"thang 1–5 sao" → giữ 1~5', () => {
    const d = decideNumericBounds(f('Sức Mạnh/Thiên Phú (Sao)', { constraints: { min: 1, max: 5 } }));
    expect(d).toMatchObject({ bounded: true, min: 1, max: 5, reason: 'schema-explicit' });
  });

  it('Tăng tích luỹ thang 1–10 → giữ 1~10 (trần khai rõ, không phải 0-100 chép bừa)', () => {
    const d = decideNumericBounds(f('Sức Mạnh/Tăng tích lũy', { constraints: { min: 1, max: 10 } }));
    expect(d).toMatchObject({ bounded: true, max: 10 });
  });

  it('HP / VP / độ hảo cảm dù trần đúng 0-100 vẫn GIỮ (là đồng hồ đo thật)', () => {
    for (const name of ['Sinh Tồn/Sinh lực vật lý (HP)', 'Sinh Tồn/Veil Point (VP)', 'Quan Hệ/Độ Hảo Cảm']) {
      const d = decideNumericBounds(f(name, { constraints: capped }));
      expect(d.bounded).toBe(true);
      expect(d.max).toBe(100);
    }
  });

  it('clamp cũng được tôn trọng', () => {
    const d = decideNumericBounds(f('X/Tiến Độ', { constraints: { clamp: [0, 50] } }));
    expect(d).toMatchObject({ bounded: true, max: 50 });
  });
});

describe('Không khai gì thì đoán theo ngữ nghĩa, KHÔNG bịa trần', () => {
  it('tên nghe như đồng hồ đo → cho trần 100 để vẽ thanh', () => {
    const d = decideNumericBounds(f('Sinh Tồn/Máu'));
    expect(d).toMatchObject({ bounded: true, max: 100, reason: 'gauge-guess' });
  });

  it('tên nghe như bộ đếm → không trần', () => {
    expect(decideNumericBounds(f('Thế Giới/Ngày')).bounded).toBe(false);
  });

  it('không đoán được gì → KHÔNG bịa trần (thà hiện số trần trụi còn hơn kẹp sai)', () => {
    const d = decideNumericBounds(f('Khác/Chỉ Số Lạ'));
    expect(d).toMatchObject({ bounded: false, reason: 'no-info' });
  });

  it('biến không phải số thì không xét', () => {
    expect(isUnboundedCounter(f('X/Tên', { type: 'string' }))).toBe(false);
    expect(looksLikeGauge(f('X/Máu', { type: 'string' }))).toBe(false);
  });
});

describe('stripBogusNumericCaps — dọn trần bịa khỏi schema (chống Zod KẸP mất dữ liệu)', () => {
  const schema: MVUZODSchema = {
    version: '1.0',
    fields: [
      {
        path: 'Thế Giới', type: 'object', label: 'Thế Giới', defaultValue: {}, constraints: {},
        children: [
          f('Thế Giới/Ngày', { constraints: { min: 0, max: 100, clamp: [0, 100] } }),
          f('Thế Giới/Cường Độ Rift', { constraints: { min: 1, max: 5 } }),
        ],
      },
      {
        path: 'Túi Đồ', type: 'object', label: 'Túi Đồ', defaultValue: {}, constraints: {},
        children: [
          f('Túi Đồ/Veil Coin', { constraints: capped }),
          f('Túi Đồ/Sinh lực (HP)', { constraints: capped }),
        ],
      },
    ],
  } as unknown as MVUZODSchema;

  const { schema: out, stripped } = stripBogusNumericCaps(schema);
  const leaf = (group: number, idx: number) => out.fields[group].children![idx];

  it('bỏ cả max và clamp của bộ đếm', () => {
    const ngay = leaf(0, 0);
    expect(ngay.constraints.max).toBeUndefined();
    expect(ngay.constraints.clamp).toBeUndefined();
    expect(ngay.constraints.min).toBe(0);   // giữ sàn: âm ngày/âm tiền là vô nghĩa
  });

  it('tiền tệ được bỏ trần', () => {
    expect(leaf(1, 0).constraints.max).toBeUndefined();
  });

  it('trần khai rõ (1~5) và đồng hồ đo (HP 0-100) KHÔNG bị đụng', () => {
    expect(leaf(0, 1).constraints.max).toBe(5);
    expect(leaf(1, 1).constraints.max).toBe(100);
  });

  it('báo đúng danh sách biến đã dọn', () => {
    expect(stripped.sort()).toEqual(['Ngày', 'Veil Coin'].sort());
  });

  it('không đột biến schema gốc', () => {
    expect(schema.fields[0].children![0].constraints.max).toBe(100);
  });
});
