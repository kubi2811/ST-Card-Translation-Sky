// (bugNeedFix/111) Entry [initvar] mở đầu bằng "[InitVar] Vui lòng không mở" → trong trình quản
// lý biến, "Thế Giới" biến mất và mọc ra một biến tên "[ InitVar ]" ôm hết biến con của nó.
// Gốc: MVU đọc TRỌN nội dung bằng parseString; nội dung bắt đầu bằng "[" còn khiến nó bỏ hẳn YAML
// để chạy jsonrepair (`/^[[{]/` trong util/common.ts của MagVarUpdate).
import { describe, it, expect } from 'vitest';
import { stripInitVarPreamble, repairInitVarContent, isInitVarEntryText } from '../initVarPreamble';

/** Đúng nội dung trong ảnh user gửi. */
const CA_CUA_USER = `[InitVar] Vui lòng không mở
'Thế Giới':
  'Ngày': 1
  'Khung Giờ': 'Sáng'
  'Địa Điểm': 'Luminaris'
'Người Chơi':
  'Phả Hệ Shard': 'Chưa thức tỉnh'
  'Thiên Phú': 0`;

describe('CHÍNH CA: dòng nhãn nằm trước cây biến', () => {
  const r = repairInitVarContent(CA_CUA_USER)!;

  it('phát hiện và cắt đúng dòng nhãn', () => {
    expect(r).not.toBeNull();
    expect(r.removed).toEqual(['Vui lòng không mở']); // nhãn [InitVar] đã bóc riêng
  });

  it('nội dung sau khi vá BẮT ĐẦU THẲNG bằng cây biến', () => {
    expect(r.content.split('\n')[0].trim()).toBe("'Thế Giới':");
  });

  it('KHÔNG còn bắt đầu bằng "[" — hết bị parseString đẩy sang nhánh jsonrepair', () => {
    expect(r.content.trimStart().startsWith('[')).toBe(false);
  });

  it('giữ nguyên toàn bộ biến, không mất chữ nào', () => {
    for (const k of ['Thế Giới', 'Ngày', 'Khung Giờ', 'Địa Điểm', 'Người Chơi', 'Phả Hệ Shard', 'Thiên Phú']) {
      expect(r.content).toContain(k);
    }
    expect(r.content.split('\n').length).toBe(CA_CUA_USER.split('\n').length - 1);
  });
});

describe('Không đụng nội dung vốn đã đúng', () => {
  it('bắt đầu thẳng bằng cây biến → trả null (không có gì phải sửa)', () => {
    expect(repairInitVarContent("'Thế Giới':\n  'Ngày': 1")).toBeNull();
  });

  it('JSON thuần hợp lệ → giữ nguyên, MVU đọc JSON được', () => {
    const json = '{"Thế Giới": {"Ngày": 1}}';
    expect(stripInitVarPreamble(json).removed).toEqual([]);
    expect(stripInitVarPreamble(json).content).toBe(json);
  });

  it('dòng trống ở đầu không bị tính là nhãn', () => {
    expect(stripInitVarPreamble("\n\n'A':\n  'B': 1").removed).toEqual([]);
  });

  it('comment YAML (#) được giữ — YAML bỏ qua nó, không gây hại', () => {
    const src = "# ghi chú\n'A':\n  'B': 1";
    expect(stripInitVarPreamble(src).removed).toEqual([]);
  });

  it('thân biến không bao giờ bị cắt (chỉ cắt phần ĐẦU)', () => {
    const src = "'A':\n  'B': 1\nmột dòng chữ lạc giữa bài\n'C': 2";
    expect(stripInitVarPreamble(src).removed).toEqual([]);
  });
});

describe('Các kiểu nhãn khác cũng bắt được', () => {
  it('nhiều dòng dặn liên tiếp', () => {
    const r = repairInitVarContent('Đừng bật entry này!\nChỉ dùng để khởi tạo biến.\n\nThế Giới:\n  Ngày: 1')!;
    expect(r.removed.length).toBe(2);
    expect(r.content.split('\n')[0]).toBe('Thế Giới:');
  });

  it('nhãn tiếng Trung của thẻ gốc', () => {
    const r = repairInitVarContent('[InitVar]请勿开启\n世界:\n  日期: 1')!;
    expect(r.removed).toEqual(['请勿开启']);
  });
});

describe('Nhận diện entry khởi tạo biến', () => {
  it('theo comment hoặc theo nội dung, không phân biệt hoa/thường', () => {
    expect(isInitVarEntryText('[initvar]初始化', '')).toBe(true);
    expect(isInitVarEntryText('', '[InitVar] Vui lòng không mở')).toBe(true);
    expect(isInitVarEntryText('Nhân vật chính', 'Một entry lore bình thường')).toBe(false);
  });
});
