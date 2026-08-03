/**
 * (bug 197) Chạy trên ĐÚNG field mà user báo kẹt: thẻ 黑色修士 v1.0.5, tavernHelper[1] = 变量结构.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thẻ nằm trong bug/ (PNG có nhúng JSON) nên không đẩy lên git — bài kiểm tự bỏ qua khi thiếu file.
 *
 * Đo TRƯỚC khi vá: `[` gốc 108 → dịch 197 (THÊM 89, đúng bằng số khoá dot-notation),
 *                  parity ok=false maxDiff=89, invented=['C'] (mảnh cụt của "Cảnh Giới")
 *                  ⇒ cổng "Nghi AI BỊA CODE" bắt 100% số lần ⇒ vòng lặp dịch lại của user.
 * Đo SAU khi vá : parity ok=true maxDiff=0, invented=[] ⇒ đi qua sạch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  extractCJKTokens, reinsertTranslations,
  verifyCodeStructureParity, detectInventedDeclarations, countBracketKeyRewrites,
} from '../surgical';

const CARD = 'G:/ClaudePJ/TOOL_CARD_GUILLICHAN/d-ch-card-sillytarven/bug/197/card_ccv3.json';

/** Bản dịch giả lập: mỗi cụm Hán → tên tiếng Việt CÓ DẤU và CÓ DẤU CÁCH, đúng như đời thật. */
const fakeVi = (s: string) => {
  const words = ['Linh Thạch', 'Tu Vi', 'Cảnh Giới', 'Thuộc Tính', 'Mục Tiêu', 'Lượng Máu', 'Đạo Hạnh'];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return words[h % words.length];
};

function loadField(): string {
  const card = JSON.parse(readFileSync(CARD, 'utf-8'));
  const d = card.data ?? card;
  const sc = (d.extensions.tavern_helper.scripts as Array<{ name: string; content: string }>)
    .find(s => s.name === '变量结构');
  return String(sc?.content ?? '');
}

describe.skipIf(!existsSync(CARD))('(bug 197) field thật 变量结构', () => {
  it('đúng là field 32.898 ký tự trong log user', () => {
    expect(loadField().length).toBe(32898);
  });

  it('phép đổi khoá sang bracket thêm đúng 89 dấu "[" — và đó là HỢP LỆ', () => {
    const original = loadField();
    const tokens = extractCJKTokens(original);
    for (const t of tokens) t.translated = fakeVi(t.text);
    const translated = reinsertTranslations(original, tokens);

    const cnt = (s: string, ch: string) => s.split(ch).length - 1;
    expect(cnt(original, '['), 'khớp con số trong log user').toBe(108);
    expect(cnt(translated, '[') - cnt(original, '['), 'mỗi khoá thêm đúng một [').toBe(89);
    expect(cnt(translated, ']') - cnt(original, ']'), 'và đúng một ] — luôn cân bằng').toBe(89);
    expect(countBracketKeyRewrites(original, translated), 'bộ đếm tự nhận ra đủ 89').toBe(89);
  });

  it('cổng "Nghi AI BỊA CODE" KHÔNG được bắt nữa — đây là gốc của vòng lặp', () => {
    const original = loadField();
    const tokens = extractCJKTokens(original);
    for (const t of tokens) t.translated = fakeVi(t.text);
    const translated = reinsertTranslations(original, tokens);

    const parity = verifyCodeStructureParity(original, translated);
    const invented = detectInventedDeclarations(original, translated);
    expect(parity.maxDiff, `vẫn lệch: ${parity.reason}`).toBe(0);
    expect(parity.ok).toBe(true);
    expect(invented, 'mảnh cụt kiểu "C"/"L"/"Th" không phải khai báo AI bịa').toEqual([]);
  });

  it('vẫn bắt được nếu AI thật sự nhét thêm hàm vào chính field này', () => {
    const original = loadField();
    const tokens = extractCJKTokens(original);
    for (const t of tokens) t.translated = fakeVi(t.text);
    const translated = reinsertTranslations(original, tokens)
      + '\nconst safeString = (v) => { return String(v ?? ""); };';
    expect(verifyCodeStructureParity(original, translated).ok, 'nới lỏng không được nới tới mức mù').toBe(false);
    expect(detectInventedDeclarations(original, translated)).toContain('safeString');
  });
});
