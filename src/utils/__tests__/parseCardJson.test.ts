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


/* (User 24/07) So Sánh Card phải nhận CẢ file World Info/lorebook rời, không chỉ card đầy đủ.
 * Trước đây chỉ `validateCard` rồi ném "missing spec, first_mes…" — user nạp lorebook là bị chặn,
 * dù màn Dịch Card vốn đã nhận được. */
const worldbookJson = JSON.stringify({
  entries: {
    '0': { uid: 0, key: ['武魂', 'Võ hồn'], content: '武魂设定', comment: 'Võ hồn' },
    '1': { uid: 1, key: ['魂环'], content: '魂环设定', comment: 'Hồn hoàn' },
  },
});

describe('parseCardJsonText — nhận file World Info / lorebook rời', () => {
  it('lorebook (entries dạng object) → dựng pseudo-card có character_book.entries', () => {
    const r = parseCardJsonText(worldbookJson, 'lore.json');
    const entries = r.card.data?.character_book?.entries;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(2);
    expect(entries?.[0].content).toBe('武魂设定');
    expect(entries?.[0].keys).toContain('武魂');
  });

  it('JSON không phải card cũng không phải lorebook → lỗi nhắc cả hai dạng', () => {
    expect(() => parseCardJsonText('{"foo":1}')).toThrow(/World Info|lorebook/i);
  });
});
