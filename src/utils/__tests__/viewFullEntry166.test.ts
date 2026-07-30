/**
 * (bug 166-2) TRỢ LÝ AI PHẢI ĐỌC ĐƯỢC TRỌN ENTRY, KHÔNG CHỈ ĐOẠN ĐẦU.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "trợ lý chỉ đọc/quét được bản tóm tắt/đoạn đầu của các entry (regex/script thì chưa biết)".
 * Đọc code thì thấy đúng, và thấy luôn vì sao: ngữ cảnh cắt content entry ở 500 ký tự rồi ghi
 * "... (truncated)" — hết đường. Regex thì được 4000 ký tự VÀ có VIEW_FULL_REGEX để đọc trọn; entry
 * lorebook thì không có action nào tương ứng, nên trợ lý muốn đọc cũng không đọc được.
 * Nay có VIEW_FULL_ENTRY đối xứng: chỉ ĐỌC, không sửa gì.
 */
import { describe, it, expect } from 'vitest';
import { executeAction, describeAction, type AiAction } from '../aiActions';
import type { CharacterCard } from '../../types/card';

const LONG = 'Nội dung rất dài của entry. '.repeat(400);   // ~11k ký tự

const card = {
  data: {
    character_book: {
      entries: [
        { comment: 'Thế Giới Quan', keys: ['thế giới'], content: LONG, enabled: true, constant: true, position: 0, depth: 4 },
        { comment: 'Nhân vật: Vân Nhi', keys: ['Vân Nhi'], content: 'Ngắn thôi.', enabled: true },
      ],
    },
    extensions: {},
  },
} as unknown as CharacterCard;

const act = (params: Record<string, unknown>): AiAction => ({ action: 'VIEW_FULL_ENTRY', params });

describe('(bug 166-2) VIEW_FULL_ENTRY đọc trọn entry', () => {
  it('trả về TRỌN content, không cắt', () => {
    const r = executeAction(act({ entryIndex: 0 }), card);
    expect(r.success).toBe(true);
    expect(r.viewContent, 'phải chứa trọn nội dung').toContain(LONG.trim().slice(0, 200));
    expect(r.viewContent!.length).toBeGreaterThan(LONG.length);
    expect(r.viewContent, 'không được còn dấu cắt nào').not.toMatch(/truncated|\(CẮT/i);
  });

  it('nêu rõ độ dài thật để AI biết mình đã đọc đủ', () => {
    const r = executeAction(act({ entryIndex: 0 }), card);
    expect(r.viewContent).toContain(`${LONG.length} ký tự`);
  });

  it('kèm metadata kích hoạt — trợ lý cần nó để tư vấn đúng', () => {
    const r = executeAction(act({ entryIndex: 0 }), card);
    for (const k of ['keys', 'enabled', 'constant', 'position', 'depth']) {
      expect(r.viewContent, `thiếu ${k}`).toContain(k);
    }
  });

  it('tìm theo TÊN (comment) cũng được — AI hay nhắc tên hơn là số thứ tự', () => {
    const r = executeAction(act({ name: 'Nhân vật: Vân Nhi' }), card);
    expect(r.success).toBe(true);
    expect(r.viewContent).toContain('Ngắn thôi.');
  });

  it('tìm theo tên KHỚP MỘT PHẦN vẫn ra', () => {
    const r = executeAction(act({ name: 'vân nhi' }), card);
    expect(r.success).toBe(true);
    expect(r.viewContent).toContain('#1');
  });

  it('index sai → báo lỗi rõ kèm số entry thật, không ném exception', () => {
    const r = executeAction(act({ entryIndex: 99 }), card);
    expect(r.success).toBe(false);
    expect(r.message).toContain('2 entry');
  });

  it('thiếu tham số → nói rõ cần gì', () => {
    const r = executeAction(act({}), card);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/entryIndex/);
  });

  it('tên không tồn tại → báo lỗi, không im lặng trả entry đầu', () => {
    const r = executeAction(act({ name: 'không có thật' }), card);
    expect(r.success).toBe(false);
  });

  it('KHÔNG sửa thẻ (chỉ đọc)', () => {
    const before = JSON.stringify(card);
    const r = executeAction(act({ entryIndex: 0 }), card);
    expect(r.newCard, 'action chỉ đọc thì không được trả thẻ mới').toBeUndefined();
    expect(JSON.stringify(card), 'thẻ gốc phải nguyên vẹn').toBe(before);
  });

  it('có nhãn hiển thị cho thẻ duyệt action', () => {
    expect(describeAction(act({ entryIndex: 1 })).type).toBe('view');
    expect(describeAction(act({ entryIndex: 1 })).title).toContain('#1');
    expect(describeAction(act({ name: 'Thế Giới Quan' })).title).toContain('Thế Giới Quan');
  });
});
