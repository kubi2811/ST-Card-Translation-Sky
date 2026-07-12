import { describe, it, expect } from 'vitest';
import { tryExtractJsonArray } from './batchGenerator';

const ENTRY = (c: string) => `{"comment":"${c}","keys":["${c.toLowerCase()}"],"content":"Nội dung chi tiết của ${c} dài hơn hai mươi ký tự để qua kiểm."}`;

describe('tryExtractJsonArray — cứu vớt JSON cắt cụt (bug #6)', () => {
  it('mảng đầy đủ vẫn parse bình thường', () => {
    const r = tryExtractJsonArray(`[${ENTRY('A')},${ENTRY('B')}]`);
    expect(r?.map(e => e.comment)).toEqual(['A', 'B']);
  });

  it('mảng bị cắt cụt giữa chừng → cứu các entry hoàn chỉnh, bỏ entry cụt', () => {
    // Không có `]` đóng; entry C bị cắt ngang
    const truncated = `[${ENTRY('A')},${ENTRY('B')},{"comment":"C","keys":["c"],"content":"đang viết dở thì h`;
    const r = tryExtractJsonArray(truncated);
    expect(r?.map(e => e.comment)).toEqual(['A', 'B']);
  });

  it('object chứa ngoặc { } và dấu " escape trong content không phá bộ quét', () => {
    const tricky = `[{"comment":"X","keys":["x"],"content":"có {ngoặc} và \\"trích dẫn\\" bên trong, dài đủ hơn hai mươi ký tự"}`;
    const r = tryExtractJsonArray(tricky); // thiếu `]` đóng
    expect(r?.length).toBe(1);
    expect(r?.[0].comment).toBe('X');
  });

  it('rác dẫn trước + code fence + text sau vẫn lấy được entry', () => {
    const messy = `Đây là kết quả:\n\`\`\`json\n[${ENTRY('A')}]\n\`\`\`\nHy vọng giúp ích!`;
    const r = tryExtractJsonArray(messy);
    expect(r?.map(e => e.comment)).toEqual(['A']);
  });

  it('AI trả object bọc {entries:[...]}', () => {
    const wrapped = `{"entries":[${ENTRY('A')},${ENTRY('B')}]}`;
    const r = tryExtractJsonArray(wrapped);
    expect(r?.map(e => e.comment)).toEqual(['A', 'B']);
  });

  it('hoàn toàn không có JSON → null (để pipeline retry/ báo lỗi đúng)', () => {
    expect(tryExtractJsonArray('Xin lỗi, tôi không thể tạo được.')).toBeNull();
  });
});
