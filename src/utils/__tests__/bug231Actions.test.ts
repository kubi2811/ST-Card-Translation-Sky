/**
 * (bug 231) "Chức năng tạo action trong trợ lý bị lỗi, chỉ ghi ra chat thay vì tạo thành nút bấm
 * xác nhận/từ chối."
 *
 * Ảnh user gửi: AI trả về MỘT block <AI_ACTION> chứa BA object JSON trên ba dòng —
 *     <AI_ACTION>
 *     {"action":"VIEW_FULL_REGEX","params":{"scriptIndex":4},"reasoning":"…"}
 *     {"action":"VIEW_FULL_REGEX","params":{"scriptIndex":5},"reasoning":"…"}
 *     {"action":"VIEW_FULL_REGEX","params":{"scriptIndex":6},"reasoning":"…"}
 *     </AI_ACTION>
 * — và cả khối đó hiện NGUYÊN VĂN trong khung chat.
 *
 * `parseAiActions` gọi `JSON.parse` trên TOÀN BỘ nội dung block, mà ba object nối nhau bằng
 * xuống dòng thì không phải JSON hợp lệ ⇒ ném lỗi ⇒ 0 action ⇒ nhánh else của panel in thẳng
 * chuỗi THÔ ra chat. Và chính lời nhắc hệ thống bảo AI "có thể đưa NHIỀU actions trong 1
 * response" nhưng ví dụ duy nhất chỉ có một object — app dạy một đằng, đọc được một nẻo.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAiActions } from '../aiActions';

/** Đúng chuỗi trong ảnh bug/231. */
const REAL_CASE = `Cảm ơn bạn đã xác nhận!

Để đảm bảo an toàn và không bỏ sót bất kỳ lỗi cú pháp nào, tôi sẽ tiến hành đọc trọn vẹn mã nguồn của cả 3 script #4, #5 và #6 ngay bây giờ.

<AI_ACTION>
{"action":"VIEW_FULL_REGEX","params":{"scriptIndex":4},"reasoning":"Đọc trọn vẹn Script #4 (Thanh trạng thái MVU) để rà soát lỗi cú pháp ở phần bị cắt."}
{"action":"VIEW_FULL_REGEX","params":{"scriptIndex":5},"reasoning":"Đọc trọn vẹn Script #5 (Thanh trạng thái MVU di động) để rà soát lỗi cú pháp ở phần bị cắt."}
{"action":"VIEW_FULL_REGEX","params":{"scriptIndex":6},"reasoning":"Đọc trọn vẹn Script #6 (Nhập trả lời nhanh) để rà soát lỗi cú pháp ở phần bị cắt."}
</AI_ACTION>

Sau khi có được toàn bộ nội dung, tôi sẽ quét kỹ lại một lần nữa và báo cáo chi tiết cho bạn xem có điểm mismatch nào cần không sửa không nhé!`;

describe('(bug 231) một block <AI_ACTION> chứa NHIỀU action', () => {
  it('ca thật của user: ba object trên ba dòng → phải ra ĐỦ BA action', () => {
    const { actions, textContent } = parseAiActions(REAL_CASE);
    expect(actions).toHaveLength(3);
    expect(actions.map(a => a.action)).toEqual(['VIEW_FULL_REGEX', 'VIEW_FULL_REGEX', 'VIEW_FULL_REGEX']);
    expect(actions.map(a => a.params.scriptIndex)).toEqual([4, 5, 6]);
    expect(actions[0].reasoning).toContain('Script #4');
    // Và khối lệnh KHÔNG được còn sót lại trong chữ hiển thị.
    expect(textContent).not.toContain('AI_ACTION');
    expect(textContent).not.toContain('VIEW_FULL_REGEX');
    expect(textContent).toContain('Cảm ơn bạn đã xác nhận');
  });

  it('mảng JSON trong một block cũng nhận', () => {
    const raw = '<AI_ACTION>[' +
      '{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":1}},' +
      '{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":2}}' +
      ']</AI_ACTION>';
    const { actions } = parseAiActions(raw);
    expect(actions).toHaveLength(2);
    expect(actions[1].params.entryIndex).toBe(2);
  });

  it('object nối nhau bằng DẤU PHẨY (không có ngoặc vuông) cũng nhận', () => {
    const raw = '<AI_ACTION>\n{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":1}},\n' +
      '{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":2}}\n</AI_ACTION>';
    expect(parseAiActions(raw).actions).toHaveLength(2);
  });

  it('block bọc trong hàng rào ```json cũng nhận', () => {
    const raw = '<AI_ACTION>\n```json\n{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":7}}\n```\n</AI_ACTION>';
    const { actions } = parseAiActions(raw);
    expect(actions).toHaveLength(1);
    expect(actions[0].params.entryIndex).toBe(7);
  });

  it('nhiều block riêng lẻ vẫn chạy như cũ (không phá đường cũ)', () => {
    const raw = 'a\n<AI_ACTION>{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":1}}</AI_ACTION>\n' +
      'b\n<AI_ACTION>{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":2}}</AI_ACTION>';
    expect(parseAiActions(raw).actions).toHaveLength(2);
  });

  it('object hỏng lẫn trong block: vẫn lấy được cái ĐỌC ĐƯỢC, và BÁO cái hỏng', () => {
    const raw = '<AI_ACTION>\n{"action":"VIEW_FULL_ENTRY","params":{"entryIndex":1}}\n' +
      '{"action":"VIEW_FULL_ENTRY", "params": {entryIndex: 2}\n</AI_ACTION>';
    const { actions, textContent } = parseAiActions(raw);
    expect(actions).toHaveLength(1);
    expect(textContent).toMatch(/không đọc được|sai định dạng/i);
  });

  it('block KHÔNG đọc được chữ nào: không được im lặng, và KHÔNG được để lọt khối thô ra chat', () => {
    const raw = 'Tôi sẽ làm việc này.\n<AI_ACTION>\nxin lỗi tôi không thể\n</AI_ACTION>';
    const { actions, textContent } = parseAiActions(raw);
    expect(actions).toHaveLength(0);
    expect(textContent).not.toContain('<AI_ACTION>');
    expect(textContent).toMatch(/không đọc được|sai định dạng/i);
  });

  it('action ghi regex đã gỡ vẫn bị chặn kể cả khi đi chung block nhiều object (bug 132 không hở)', () => {
    const raw = '<AI_ACTION>\n{"action":"VIEW_FULL_REGEX","params":{"scriptIndex":0}}\n' +
      '{"action":"EDIT_REGEX","params":{"scriptIndex":0,"field":"replaceString","newValue":"x"}}\n</AI_ACTION>';
    const { actions, textContent } = parseAiActions(raw);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('VIEW_FULL_REGEX');
    expect(textContent).toContain('EDIT_REGEX');
    expect(textContent).toContain('đã được gỡ');
  });

  it('không có block nào thì trả lại nguyên văn, không thêm cảnh báo thừa', () => {
    const raw = 'Chỉ là một câu trả lời bình thường, có nhắc {"action":"x"} trong code block thôi.';
    const { actions, textContent } = parseAiActions(raw);
    expect(actions).toHaveLength(0);
    expect(textContent).toBe(raw);
  });
});

/**
 * Nửa còn lại của bug 231: kể cả khi parser đọc không ra action, panel VẪN không được in chuỗi
 * THÔ. Nhánh `else` cũ dùng `finalResult` nên khối <AI_ACTION> hiện nguyên văn trong khung chat —
 * đúng cảnh "chỉ ghi ra chat". Khoá lại bằng chính mã nguồn vì luồng này phải có API mới chạy.
 */
describe('(bug 231) panel không được in chuỗi THÔ khi không có action', () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, '../../components/AiCompanionPanel.tsx'), 'utf8');

  it('nhánh "không có action" dùng textContent (đã gỡ khối lệnh), không dùng finalResult', () => {
    expect(SRC).not.toContain("setMessages([...nextMessages, { role: 'assistant', content: finalResult }]);");
    expect(SRC).toContain('const noCard = parsedActions.length > 0 && !card;');
  });

  it('lời nhắc hệ thống DẠY rõ format nhiều action (mảng JSON) — nguồn gốc sinh ra khối sai', () => {
    expect(SRC).toContain('VÍ DỤ FORMAT — NHIỀU ACTION');
    expect(SRC).toContain('NHIỀU ACTION THÌ VIẾT THÀNH MỘT MẢNG JSON');
  });
});
