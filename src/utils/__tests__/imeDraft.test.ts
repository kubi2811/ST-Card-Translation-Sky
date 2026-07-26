// (bugNeedFix/107) Gõ tiếng Việt trong ô "Bản dịch": "Tân Thuận" ra "Taân Thuaâận",
// Backspace/Space làm con trỏ nhảy cuối. Nguyên nhân: mỗi phím ghi thẳng vào store ⇒
// React re-render cắt ngang lúc bộ gõ đang TỔ HỢP ký tự.
import { describe, it, expect } from 'vitest';
import {
  createDraftState, onType, onCompositionStart, onCompositionEnd,
  canCommit, afterCommit, onExternalChange, COMMIT_DELAY_MS,
} from '../imeDraft';

describe('CHÍNH CA BUG 107: không được commit khi bộ gõ đang tổ hợp', () => {
  it('mô phỏng gõ Telex "Taan" → "Tân": trong lúc tổ hợp KHÔNG commit lần nào', () => {
    let s = createDraftState('');
    s = onCompositionStart(s);
    s = onType(s, 'T');
    expect(canCommit(s)).toBe(false);
    s = onType(s, 'Ta');
    expect(canCommit(s)).toBe(false);
    s = onType(s, 'Taa');           // ← đúng khoảnh khắc cũ làm hỏng: 'Taa' bị ghi vào store
    expect(canCommit(s)).toBe(false);
    // bộ gõ chốt lại thành 'Tâ'
    s = onCompositionEnd(s, 'Tâ');
    expect(s.draft).toBe('Tâ');
    expect(canCommit(s)).toBe(true); // giờ mới được commit, và commit đúng chữ đã chốt
  });

  it('gõ thường (không IME) vẫn commit được bình thường', () => {
    let s = createDraftState('');
    s = onType(s, 'Hello');
    expect(canCommit(s)).toBe(true);
    expect(s.draft).toBe('Hello');
  });

  it('sau khi commit thì hết "đang sửa dở"', () => {
    let s = onType(createDraftState(''), 'xong');
    s = afterCommit(s);
    expect(canCommit(s)).toBe(false);
    expect(s.draft).toBe('xong');   // chữ vẫn còn trong ô
  });
});

describe('Giá trị đổi từ BÊN NGOÀI (dịch xong / hoàn tác)', () => {
  it('user không sửa gì → nạp giá trị mới vào ô', () => {
    const s = onExternalChange(createDraftState('cũ'), 'bản dịch mới');
    expect(s.draft).toBe('bản dịch mới');
  });

  it('user ĐANG sửa dở → KHÔNG đè, giữ nguyên chữ đang gõ', () => {
    const typing = onType(createDraftState('cũ'), 'tôi đang gõ dở');
    const s = onExternalChange(typing, 'bản dịch từ AI');
    expect(s.draft).toBe('tôi đang gõ dở');
  });

  it('user đang TỔ HỢP ký tự → cũng không đè (nếu không sẽ mất dấu đang gõ)', () => {
    const composing = onCompositionStart(createDraftState('cũ'));
    const s = onExternalChange(composing, 'bản dịch từ AI');
    expect(s.draft).toBe('cũ');
  });

  it('giá trị ngoài trùng chữ đang có → không tạo state mới (khỏi re-render thừa)', () => {
    const base = createDraftState('y hệt');
    expect(onExternalChange(base, 'y hệt')).toBe(base);
  });
});

describe('Hằng số commit', () => {
  it('độ trễ commit đủ ngắn để không mất chữ, đủ dài để không cắt ngang bộ gõ', () => {
    expect(COMMIT_DELAY_MS).toBeGreaterThanOrEqual(200);
    expect(COMMIT_DELAY_MS).toBeLessThanOrEqual(1000);
  });
});
