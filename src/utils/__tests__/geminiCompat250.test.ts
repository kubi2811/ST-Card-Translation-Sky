// Bug 250 (gogopikachu) — "tool không tương thích với gemini-3.8-flash và gemini-3.7-flash".
// Hai chỗ chắc chắn sai với model Gemini có suy nghĩ, khoá lại ở đây:
//  1. Chỉ đọc parts[0] — model có suy nghĩ có thể đặt chữ thật ở part sau (part đầu là chữ ký suy nghĩ).
//  2. Trần output mặc định 8192 cho mọi "flash" — token suy nghĩ tính vào trần đó nên bị ăn hết.
import { describe, it, expect } from 'vitest';
import { geminiPartsText, openAiContentText, getMaxOutputTokens } from '../apiClient';

describe('geminiPartsText', () => {
  it('ghép mọi part có chữ, bỏ part suy nghĩ', () => {
    const cand = { content: { parts: [
      { thoughtSignature: 'abc' },
      { text: 'Suy nghĩ nội bộ', thought: true },
      { text: 'Xin ' },
      { text: 'chào' },
    ] } };
    expect(geminiPartsText(cand)).toBe('Xin chào');
  });
  it('model đời cũ (một part) vẫn như trước', () => {
    expect(geminiPartsText({ content: { parts: [{ text: 'A' }] } })).toBe('A');
  });
  it('không có part ⇒ chuỗi rỗng, không ném lỗi', () => {
    expect(geminiPartsText(undefined)).toBe('');
    expect(geminiPartsText({ finishReason: 'MAX_TOKENS' })).toBe('');
  });
});

describe('openAiContentText', () => {
  it('chuỗi thường giữ nguyên', () => expect(openAiContentText('abc')).toBe('abc'));
  it('mảng part: lấy text, bỏ part suy nghĩ', () => {
    expect(openAiContentText([{ type: 'thinking', text: 'x' }, { type: 'text', text: 'Xin chào' }])).toBe('Xin chào');
  });
  it('null/undefined ⇒ rỗng', () => {
    expect(openAiContentText(null)).toBe('');
    expect(openAiContentText(undefined)).toBe('');
  });
});

describe('getMaxOutputTokens — Gemini có suy nghĩ', () => {
  it('gemini 2.5+/3.x flash không còn bị trần 8192', () => {
    expect(getMaxOutputTokens('gemini-3.8-flash')).toBe(65535);
    expect(getMaxOutputTokens('gemini-3.7-flash')).toBe(65535);
    expect(getMaxOutputTokens('gemini-2.5-flash')).toBe(65535);
    expect(getMaxOutputTokens('models/gemini-3.1-flash-lite')).toBe(65535);
  });
  it('model đời cũ giữ nguyên', () => {
    expect(getMaxOutputTokens('gemini-2.0-flash')).toBe(8192);
    expect(getMaxOutputTokens('gemini-1.5-flash')).toBe(8192);
  });
  it('user tự đặt thì luôn thắng', () => {
    expect(getMaxOutputTokens('gemini-3.8-flash', 32000)).toBe(32000);
  });
});
