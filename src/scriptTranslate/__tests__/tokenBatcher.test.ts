// (User 20/07) Phase B "Dịch Script": gom token + parse response PHẢI strict theo marker —
// lệch id là bản dịch chui nhầm chỗ trong code, nên thà fail để retry còn hơn đoán vị trí.
import { describe, it, expect } from 'vitest';
import type { CJKToken } from '../../utils/surgical';
import {
  packTokens,
  parseTokenBatchResponse,
  buildTokenBatchPrompt,
  isTranslatableToken,
  TOKEN_BATCH_MAX_COUNT,
  TOKEN_BATCH_CHAR_BUDGET,
} from '../tokenBatcher';

const tok = (id: number, text: string, extra: Partial<CJKToken> = {}): CJKToken =>
  ({ id, text, start: id * 100, end: id * 100 + text.length, ...extra }) as CJKToken;

describe('isTranslatableToken — cái gì GIỮ NGUYÊN có chủ đích', () => {
  it('object key / dot-notation / css class / html attr / identifier → không dịch', () => {
    expect(isTranslatableToken(tok(1, '子时', { isObjectKey: true }))).toBe(false);
    expect(isTranslatableToken(tok(2, '好感度', { isDotNotation: true }))).toBe(false);
    expect(isTranslatableToken(tok(3, '样式', { isCssClass: true }))).toBe(false);
    expect(isTranslatableToken(tok(4, '属性', { isHtmlAttr: true }))).toBe(false);
    expect(isTranslatableToken(tok(5, '变量', { isIdentifier: true }))).toBe(false);
    expect(isTranslatableToken(tok(6, '你好世界'))).toBe(true);
  });
});

describe('packTokens', () => {
  it('bỏ token đã dịch + token phải giữ nguyên; tôn trọng trần số lượng/ký tự', () => {
    const tokens: CJKToken[] = [];
    for (let i = 0; i < 100; i++) tokens.push(tok(i, `chuỗi số ${i} 内容`));
    tokens.push(tok(200, '已经翻译', { translated: 'đã dịch' } as Partial<CJKToken>));
    tokens.push(tok(201, '子时', { isObjectKey: true }));
    const batches = packTokens(tokens);
    const all = batches.flatMap((b) => b.batch);
    expect(all).toHaveLength(100); // 2 token kia bị loại
    for (const b of batches) {
      expect(b.batch.length).toBeLessThanOrEqual(TOKEN_BATCH_MAX_COUNT);
      const chars = b.batch.reduce((s, x) => s + x.original.length, 0);
      expect(chars).toBeLessThanOrEqual(TOKEN_BATCH_CHAR_BUDGET);
    }
  });
});

describe('buildTokenBatchPrompt', () => {
  const batch = [tok(7, '你好'), tok(9, '世界')].map((t) => ({ original: t.text, token: t }));

  it('user liệt kê đúng marker; system có luật giữ ${} và {{macro}}', () => {
    const { system, user } = buildTokenBatchPrompt(batch, [], { nsfw: false, nameStyle: 'hanviet', fandomMode: false, fandomName: '' });
    expect(user).toContain('<<<7>>>\n你好');
    expect(user).toContain('<<<9>>>\n世界');
    expect(system).toContain('${...}');
    expect(system).toContain('{{macros}}');
  });

  it('glossary được lọc theo text lô và chèn vào system', () => {
    const gl = [{ source: '你好', target: 'xin chào' }, { source: '不相关', target: 'không liên quan' }];
    const { system } = buildTokenBatchPrompt(batch, gl, { nsfw: false, nameStyle: 'hanviet', fandomMode: false, fandomName: '' });
    expect(system).toContain('你好 → xin chào');
  });

  it('nsfw bật → có khối chiến thuật; tắt → không', () => {
    const off = buildTokenBatchPrompt(batch, [], { nsfw: false, nameStyle: 'hanviet', fandomMode: false, fandomName: '' }).system;
    const on = buildTokenBatchPrompt(batch, [], { nsfw: true, nameStyle: 'hanviet', fandomMode: false, fandomName: '' }).system;
    expect(off).not.toContain('NSFW TRANSLATION TACTICS');
    expect(on).toContain('NSFW TRANSLATION TACTICS');
  });
});

describe('parseTokenBatchResponse — STRICT, không bao giờ đoán theo vị trí', () => {
  const batch = [tok(1, '你好'), tok(2, '世界'), tok(3, '朋友')].map((t) => ({ original: t.text, token: t }));

  it('response chuẩn → đủ 3 bản dịch, giữ nguyên nội dung nhiều dòng', () => {
    const r = parseTokenBatchResponse('<<<1>>>\nxin chào\n<<<2>>>\nthế giới\ndòng hai\n<<<3>>>\nbạn bè', batch);
    expect(r.failedIds).toEqual([]);
    expect(r.translations.get(1)).toBe('xin chào');
    expect(r.translations.get(2)).toBe('thế giới\ndòng hai');
  });

  it('thiếu id 2 → CHỈ id 2 fail, không lệch id khác', () => {
    const r = parseTokenBatchResponse('<<<1>>>\nxin chào\n<<<3>>>\nbạn bè', batch);
    expect(r.failedIds).toEqual([2]);
    expect(r.translations.get(3)).toBe('bạn bè');
  });

  it('id lạ bị bỏ; response rác → fail cả lô', () => {
    const r1 = parseTokenBatchResponse('<<<99>>>\nabc\n<<<1>>>\nxin chào', batch);
    expect(r1.translations.has(99 as never)).toBe(false);
    expect(r1.failedIds).toEqual([2, 3]);
    const r2 = parseTokenBatchResponse('Tôi không thể giúp việc này.', batch);
    expect(r2.failedIds).toEqual([1, 2, 3]);
  });

  it('bản dịch rỗng → fail id đó', () => {
    const r = parseTokenBatchResponse('<<<1>>>\n\n<<<2>>>\nthế giới\n<<<3>>>\nbạn bè', batch);
    expect(r.failedIds).toEqual([1]);
  });
});
