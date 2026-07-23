// (User 23/07 — bug 91) "Tạo thẻ từ truyện: nội dung đầu ra cũng như các nhân vật BẮT BUỘC
// phải được dịch sang tiếng Việt."
//
// Prompt đã dặn dịch nhưng dặn không phải là bảo đảm — model vẫn hay bê nguyên tên gốc. Đây là
// lưới an toàn thuần luật để pipeline biết mà bắt AI làm lại.
import { describe, it, expect } from 'vitest';
import { hasCjk, countCjk, sampleCjk, scanCjkResidue, buildCjkRetryHint } from '../cjkResidue';

describe('hasCjk / countCjk — bắt chữ Hán, Kana, Hangul', () => {
  it('bắt chữ Hán', () => {
    expect(hasCjk('夏冬 đi chợ')).toBe(true);
    expect(countCjk('夏冬')).toBe(2);
  });

  it('bắt Kana và Hangul', () => {
    expect(hasCjk('さくら')).toBe(true);
    expect(hasCjk('한국')).toBe(true);
  });

  it('tiếng Việt có dấu KHÔNG bị coi là CJK (chống báo động giả)', () => {
    expect(hasCjk('Hạ Đông đi chợ mua rượu')).toBe(false);
    expect(hasCjk('Dương Vạn Xuân — Cảnh Giới Sơ Thức')).toBe(false);
    expect(countCjk('Nguyễn Trãi, Lê Lợi, Trần Hưng Đạo')).toBe(0);
  });

  it('BỎ QUA macro và tag — chúng cố ý không dịch', () => {
    expect(hasCjk('{{user}} chào {{char}}')).toBe(false);
    expect(hasCjk('<UpdateVariable>x</UpdateVariable>')).toBe(false);
  });

  it('sampleCjk gom cụm liền nhau thành một mẫu', () => {
    expect(sampleCjk('tên là 夏冬 và 杨万春')).toEqual(['夏冬', '杨万春']);
  });

  it('sampleCjk không lặp lại và tôn trọng giới hạn', () => {
    expect(sampleCjk('夏冬 夏冬 夏冬')).toEqual(['夏冬']);
    expect(sampleCjk('一 二 三 四 五 六 七', 3)).toHaveLength(3);
  });
});

describe('scanCjkResidue — báo đúng trường nào còn sót', () => {
  it('thẻ sạch → clean', () => {
    const r = scanCjkResidue({ 'Tên': 'Hạ Đông', 'Bối cảnh': 'Một ngôi làng nhỏ' });
    expect(r.clean).toBe(true);
    expect(r.total).toBe(0);
    expect(r.fields).toHaveLength(0);
  });

  it('chỉ điểm ĐÚNG trường dính, không vơ đũa cả nắm', () => {
    const r = scanCjkResidue({
      'Tên': 'Hạ Đông',
      'Bối cảnh': 'Nàng sống ở 京城 từ nhỏ',
      'Lời mở đầu': 'Xin chào!',
    });
    expect(r.clean).toBe(false);
    expect(r.fields).toHaveLength(1);
    expect(r.fields[0].field).toBe('Bối cảnh');
    expect(r.fields[0].samples).toContain('京城');
  });

  it('nhận cả mảng (danh sách lore)', () => {
    const r = scanCjkResidue({ 'Lore': ['sạch', 'còn 魔法 đây'] });
    expect(r.clean).toBe(false);
    expect(r.fields[0].field).toBe('Lore');
  });

  it('bỏ qua trường trống/undefined', () => {
    expect(scanCjkResidue({ a: '', b: undefined }).clean).toBe(true);
  });
});

describe('buildCjkRetryHint — nhắc ĐÍCH DANH chữ còn sót', () => {
  it('nêu tên trường và chữ cụ thể (nhắc chung chung thì model trả lại y nguyên)', () => {
    const hint = buildCjkRetryHint(scanCjkResidue({ 'Tên': '夏冬' }));
    expect(hint).toContain('Tên');
    expect(hint).toContain('夏冬');
    expect(hint).toContain('LÀM LẠI');
  });

  it('sạch rồi → không sinh câu nhắc thừa', () => {
    expect(buildCjkRetryHint(scanCjkResidue({ 'Tên': 'Hạ Đông' }))).toBe('');
  });
});
