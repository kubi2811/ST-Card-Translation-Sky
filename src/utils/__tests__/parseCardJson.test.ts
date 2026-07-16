// So sánh card — nạp card từ JSON dán trực tiếp (dùng khi tạo card từ WB, không có file).
import { describe, it, expect } from 'vitest';
import { parseCardJsonText } from '../parseCardFile';

const validCard = JSON.stringify({
  spec: 'chara_card_v2', spec_version: '2.0',
  data: { name: 'Card WB', description: 'từ worldbook', first_mes: 'chào', personality: '', scenario: '', mes_example: '' },
});

describe('parseCardJsonText — dán JSON trực tiếp', () => {
  it('JSON card hợp lệ → parse ra card + fileName mặc định, isPng=false', () => {
    const r = parseCardJsonText(validCard);
    expect(r.card.data?.name).toBe('Card WB');
    expect(r.isPng).toBe(false);
    expect(r.dataUrl).toBeNull();
    expect(r.fileName).toBe('card-dán.json');
  });

  it('nhận fileName tuỳ chỉnh', () => {
    expect(parseCardJsonText(validCard, 'abc.json').fileName).toBe('abc.json');
  });

  it('chuỗi rỗng → báo lỗi rõ', () => {
    expect(() => parseCardJsonText('   ')).toThrow(/Chưa dán/);
  });

  it('JSON sai cú pháp → báo lỗi JSON không hợp lệ', () => {
    expect(() => parseCardJsonText('{ name: bad }')).toThrow(/không hợp lệ/);
  });

  it('JSON đúng cú pháp nhưng KHÔNG phải card → báo định dạng card không hợp lệ', () => {
    expect(() => parseCardJsonText('{"foo": 1}')).toThrow();
  });
});
