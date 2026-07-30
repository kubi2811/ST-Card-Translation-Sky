// (bug 159-5) Ô "Nhờ AI sửa giùm" chỉ sửa được biến có sẵn, không thêm được biến mới.
// Prompt cũ chỉ MỘT câu và câu đó tự chặn chính nó ("Chỉ sửa đúng phần user yêu cầu" ⇒ AI hiểu là
// chỉ được SỬA), lại không dạy hình dạng field / 6 kiểu / quy ước "_child".
// Prompt là LOGIC nên phải test được — đây là lý do nó nằm ở file riêng thay vì chuỗi trong JSX.
import { describe, it, expect } from 'vitest';
import { SCHEMA_COPILOT_SYSTEM, buildSchemaCopilotUser } from '../schemaCopilotPrompt';

describe('(bug 159-5) prompt copilot schema', () => {
  it('cho phép THÊM biến, không chỉ sửa', () => {
    expect(SCHEMA_COPILOT_SYSTEM).toContain('THÊM biến mới');
    expect(SCHEMA_COPILOT_SYSTEM, 'không được để lại câu tự chặn của bản cũ')
      .not.toContain('Chỉ sửa đúng phần user yêu cầu');
  });

  it('vẫn giữ lằn ranh: phần không được nhắc thì không đụng', () => {
    expect(SCHEMA_COPILOT_SYSTEM).toContain('GIỮ NGUYÊN');
  });

  it('dạy đủ 6 kiểu dữ liệu', () => {
    for (const t of ['number', 'string', 'boolean', 'object', 'array', 'record']) {
      expect(SCHEMA_COPILOT_SYSTEM, `thiếu kiểu ${t}`).toContain(t);
    }
  });

  it('dạy quy ước "_child" của array/record — dùng nhầm là biến mất lúc ghi về schema', () => {
    expect(SCHEMA_COPILOT_SYSTEM).toContain('_child');
  });

  it('cảnh báo record KHÔNG khai sẵn tên khoá (đè dữ liệu người chơi mỗi lần khởi tạo)', () => {
    expect(SCHEMA_COPILOT_SYSTEM).toMatch(/không khai sẵn tên khoá/i);
  });

  it('trả lời được ĐÚNG ví dụ user đưa: biến Thời gian 0:00–23:59', () => {
    expect(SCHEMA_COPILOT_SYSTEM).toContain('Thời Gian');
    expect(SCHEMA_COPILOT_SYSTEM, 'giờ phải có trần 23').toContain('"max": 23');
    expect(SCHEMA_COPILOT_SYSTEM, 'phút phải có trần 59').toContain('"max": 59');
  });

  it('có đường xử lý yêu cầu KHÔNG thể làm — không bịa cơ chế không tồn tại', () => {
    expect(SCHEMA_COPILOT_SYSTEM).toContain('KHÔNG THỂ LÀM');
    expect(SCHEMA_COPILOT_SYSTEM).toContain('đừng bịa');
  });

  it('user message mang đủ schema + yêu cầu', () => {
    const u = buildSchemaCopilotUser('{"a":1}', '  thêm biến Máu  ');
    expect(u).toContain('{"a":1}');
    expect(u).toContain('thêm biến Máu');
    expect(u, 'phải trim yêu cầu').not.toContain('  thêm');
  });
});
