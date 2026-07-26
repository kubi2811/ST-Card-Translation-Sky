// (bugNeedFix/105) "Nhân vật thành {{user}}" không hoạt động: điền Triệu Hy Ngạn nhưng thẻ ra
// vẫn kể "Triệu Hy Ngạn … chạm mặt {{user}}" — model coi hai người là hai. Nay thay bằng code.
import { describe, it, expect } from 'vitest';
import { swapNameToUser, applyUserPersonaSwap, isSameAsUserPersona } from '../userPersonaSwap';

describe('CHÍNH CA: thay tên người chơi bằng {{user}}', () => {
  it('đúng câu trong ảnh bằng chứng — hết cảnh hai người', () => {
    const src = 'Triệu Hy Ngạn vừa đạp chiếc xe đạp Phượng Hoàng mới coóng từ xưởng trở về, '
      + 'chạm mặt {{user}} cũng vừa bước ra sân.';
    const r = swapNameToUser(src, 'Triệu Hy Ngạn');
    expect(r.count).toBe(1);
    expect(r.text).not.toContain('Triệu Hy Ngạn');
    // Hai lần {{user}} đứng cạnh nhau thì gộp, còn ở đây cách nhau nên vẫn là 2 chỗ.
    expect(r.text.startsWith('{{user}} vừa đạp')).toBe(true);
  });

  it('thay cả biệt danh, ưu tiên tên dài trước để không cắt vụn', () => {
    const r = swapNameToUser(
      'Tiểu Triệu cười. Triệu Hy Ngạn gật đầu. Triệu ca im lặng.',
      'Triệu Hy Ngạn', ['Tiểu Triệu', 'Triệu ca'],
    );
    expect(r.text).toBe('{{user}} cười. {{user}} gật đầu. {{user}} im lặng.');
  });

  it('khớp cả bản không dấu (Trieu Hy Ngan)', () => {
    expect(swapNameToUser('Trieu Hy Ngan đi chợ', 'Triệu Hy Ngạn').text).toBe('{{user}} đi chợ');
  });

  it('KHÔNG cắt vào giữa tên người khác', () => {
    // "Triệu Hy Ngạn Nhi" là người khác — không được biến thành "{{user}} Nhi"? Vẫn thay phần
    // khớp trọn từ; điều quan trọng là không đụng "Triệu Hy Ngạnh" (dính chữ).
    expect(swapNameToUser('Triệu Hy Ngạnh là ai', 'Triệu Hy Ngạn').count).toBe(0);
  });

  it('tên 1 ký tự bị bỏ qua (thay bừa rất nguy hiểm)', () => {
    expect(swapNameToUser('A đi chợ với An', 'A').count).toBe(0);
  });

  it('gộp {{user}} {{user}} đứng liền nhau', () => {
    expect(swapNameToUser('Triệu Hy Ngạn Tiểu Triệu về nhà', 'Triệu Hy Ngạn', ['Tiểu Triệu']).text)
      .toBe('{{user}} về nhà');
  });

  it('không có tên thì không đụng gì', () => {
    const src = 'Một ngày bình thường.';
    expect(swapNameToUser(src, '').text).toBe(src);
  });
});

describe('Áp lên toàn thẻ', () => {
  const card = {
    name: 'Tần Hoài Nhứ',
    description: 'Quen biết Triệu Hy Ngạn từ nhỏ.',
    personality: '',
    scenario: 'Triệu Hy Ngạn đứng trước hiên nhà.',
    firstMes: '*nhìn Tiểu Triệu* Cậu về rồi à?',
    worldEntries: [
      { keys: ['Triệu Hy Ngạn', 'Tứ Hợp Viện'], content: 'Nhà của Triệu Hy Ngạn ở số 95.' },
    ],
  };

  const { card: out, report } = applyUserPersonaSwap(card, 'Triệu Hy Ngạn', ['Tiểu Triệu']);

  it('quét hết mọi trường, không sót', () => {
    expect(out.description).toBe('Quen biết {{user}} từ nhỏ.');
    expect(out.scenario).toBe('{{user}} đứng trước hiên nhà.');
    expect(out.firstMes).toBe('*nhìn {{user}}* Cậu về rồi à?');
    expect(out.worldEntries[0].content).toBe('Nhà của {{user}} ở số 95.');
    expect(report.count).toBe(4);
    expect(report.leftovers).toEqual([]);
  });

  it('key lore theo tên người chơi bị bỏ (macro không phải từ khoá người chơi gõ)', () => {
    expect(out.worldEntries[0].keys).toEqual(['Tứ Hợp Viện']);
  });

  it('TÊN THẺ giữ nguyên — thẻ là của nhân vật khác', () => {
    expect(out.name).toBe('Tần Hoài Nhứ');
  });
});

describe('Chặn mâu thuẫn: làm thẻ cho chính người chơi', () => {
  it('trùng tên → phát hiện', () => {
    expect(isSameAsUserPersona('Triệu Hy Ngạn', 'Triệu Hy Ngạn')).toBe(true);
    expect(isSameAsUserPersona('  triệu hy ngạn ', 'Triệu Hy Ngạn')).toBe(true);
    expect(isSameAsUserPersona('Trieu Hy Ngan', 'Triệu Hy Ngạn')).toBe(true);
  });

  it('trùng BIỆT DANH cũng là trùng', () => {
    expect(isSameAsUserPersona('Tiểu Triệu', 'Triệu Hy Ngạn', ['Tiểu Triệu'])).toBe(true);
  });

  it('người khác thì không chặn nhầm', () => {
    expect(isSameAsUserPersona('Tần Hoài Nhứ', 'Triệu Hy Ngạn', ['Tiểu Triệu'])).toBe(false);
    expect(isSameAsUserPersona('Triệu Hy Ngạn', '')).toBe(false);
  });
});
