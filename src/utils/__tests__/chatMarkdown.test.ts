import { describe, it, expect } from 'vitest';
import { splitChatBlocks } from '../chatMarkdown';

/**
 * (User 2026 — "câu trả lời/code bị văng ra ngoài khung") Bug gốc: bộ tách cũ đóng fence ở BẤT KỲ dấu
 * ``` nào kể cả GIỮA DÒNG → code của trợ lý (loại thao tác chính markdown) bị cắt đôi, nửa sau render
 * thành text trần không khung/không wrap ⇒ tràn khỏi bong bóng chat.
 */
describe('splitChatBlocks — fence chỉ tính khi ở ĐẦU DÒNG', () => {
  it('BUG THẬT: code chứa ``` GIỮA DÒNG (replace(/```$/)) KHÔNG làm đóng fence sớm', () => {
    const content = [
      'Đây là hàm parse:',
      '```javascript',
      "const jsonStr = text.replace(/^```json/i, '').replace(/```$/, '').trim();",
      'return JSON.parse(jsonStr);',
      '```',
      'Bạn xem thử nhé!',
    ].join('\n');

    const blocks = splitChatBlocks(content);
    expect(blocks.map(b => b.type)).toEqual(['text', 'code', 'text']);
    const code = blocks[1] as { type: 'code'; code: string; language: string };
    expect(code.language).toBe('javascript');
    // TOÀN BỘ code nằm trong khối code — không rơi dòng nào ra ngoài
    expect(code.code).toContain('return JSON.parse(jsonStr);');
    expect((blocks[2] as { text: string }).text).toContain('Bạn xem thử nhé!');
  });

  it('nhiều khối code xen văn bản → tách đúng thứ tự', () => {
    const content = 'A\n```ts\nlet a = 1;\n```\nB\n```json\n{"x":1}\n```\nC';
    const blocks = splitChatBlocks(content);
    expect(blocks.map(b => b.type)).toEqual(['text', 'code', 'text', 'code', 'text']);
    expect((blocks[3] as { code: string }).code.trim()).toBe('{"x":1}');
  });

  it('fence MỞ mà chưa ĐÓNG (đang stream / bị cắt token) → vẫn nằm trong KHUNG CODE, không đổ ra text trần', () => {
    const content = 'Đang viết:\n```js\nfunction a() {\n  return 1;';
    const blocks = splitChatBlocks(content);
    expect(blocks.map(b => b.type)).toEqual(['text', 'code']);
    expect((blocks[1] as { code: string }).code).toContain('function a()');
  });

  it('không có fence → 1 khối text duy nhất', () => {
    expect(splitChatBlocks('chỉ là văn bản thường')).toEqual([{ type: 'text', text: 'chỉ là văn bản thường' }]);
  });

  it('nội dung rỗng → mảng rỗng', () => {
    expect(splitChatBlocks('')).toEqual([]);
  });

  it('ngôn ngữ có dấu +/- (c++, objective-c) vẫn nhận đúng', () => {
    const blocks = splitChatBlocks('```c++\nint main(){}\n```');
    expect((blocks[0] as { language: string }).language).toBe('c++');
  });
});
