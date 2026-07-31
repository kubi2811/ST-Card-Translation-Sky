/**
 * (bug 174) Chạy bộ mô phỏng trên ĐÚNG file thẻ user gửi — không phải mẫu rút gọn.
 * ─────────────────────────────────────────────────────────────────────────────
 * File nằm trong bug/ nên KHÔNG được đẩy lên git (chứng cứ của user, chỉ có trên máy này).
 * Vì vậy bài kiểm tự bỏ qua khi không tìm thấy file — máy khác chạy suite vẫn xanh.
 *
 * Đo trước khi vá: 9 dòng ĐỎ, cả 9 đều là báo oan, còn lỗi thật (Phả Hệ: Null) thì im lặng.
 * Đo sau khi vá : 1 dòng đỏ đúng chỗ + 1 hệ quả trực tiếp của nó.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { simulateCard, parseInitVar, extractReadPaths } from '../simulateCard';
import { repairInjectPromptArgs } from '../../ai/cardAutoRepair';

const CARD = 'G:/ClaudePJ/TOOL_CARD_GUILLICHAN/d-ch-card-sillytarven/bug/174/Eldran MVU + EJS.json';

interface Entry { comment?: string; name?: string; content?: string; keys?: unknown }

function loadCard() {
  const card = JSON.parse(readFileSync(CARD, 'utf-8'));
  const entries = (card.data.character_book?.entries ?? []) as Entry[];
  const nameOf = (e: Entry) => String(e.comment ?? e.name ?? '');
  return {
    schema: card.data.extensions?.mvuzod?.schema,
    initVarContent: String(entries.find(e => /initvar/i.test(nameOf(e)))?.content ?? ''),
    updateContents: entries.filter(e => /mvu_update/i.test(nameOf(e))).map(e => String(e.content ?? '')),
    readerSources: entries
      .filter(e => /@@ejs|<%/.test(String(e.content ?? '')))
      .map(e => ({ name: nameOf(e), content: String(e.content ?? '') })),
  };
}

describe.skipIf(!existsSync(CARD))('(bug 174) thẻ thật của user', () => {
  it('đọc [initvar] ra ĐÚNG cái Zod nhìn thấy: Phả Hệ là RỖNG chứ không phải chữ "Null"', () => {
    const { initVarContent } = loadCard();
    const data = parseInitVar(initVarContent) as Record<string, Record<string, unknown>>;
    expect(data['Người Chơi']['Phả Hệ']).toBeNull();
  });

  it('bắt đúng lỗi user gặp lúc nhập thẻ, kèm cách sửa cụ thể', () => {
    const res = simulateCard(loadCard());
    const bad = res.issues.filter(i => i.code === 'sim-initvar-value-invalid');
    expect(bad.length).toBe(1);
    expect(bad[0].message).toContain('Phả Hệ');
    expect(bad[0].message, 'phải chỉ thẳng cách sửa, không bắt user tự đoán').toContain('BỌC NHÁY');
  });

  it('hết báo oan: không còn biến ma "Người", không còn kêu khuôn mẫu UpdateVariable', () => {
    const input = loadCard();
    const res = simulateCard(input);
    const missing = res.issues.filter(i => i.code === 'sim-reader-missing-var');
    // Biến ma sinh ra khi bộ dò cắt "Người Chơi" ở khoảng trắng — soi thẳng đầu ra bộ dò.
    for (const src of input.readerSources) {
      expect(extractReadPaths(src.content), `"${src.name}" sinh mảnh cụt`).not.toContain('Người');
    }
    expect(res.issues.filter(i => i.code === 'sim-update-noop')).toEqual([]);
    // Dòng đỏ duy nhất còn lại là HỆ QUẢ của Phả Hệ = null, không phải lỗi riêng.
    expect(missing.length).toBeLessThanOrEqual(1);
  });

  it('10 khối EJS của thẻ đang gọi injectPrompt sai chữ ký → phép vá dọn sạch', () => {
    const card = JSON.parse(readFileSync(CARD, 'utf-8'));
    const entries = (card.data.character_book?.entries ?? []) as Entry[];
    const before = entries.reduce(
      (n, e) => n + (String(e.content ?? '').match(/injectPrompt\s*\(\s*\{/g) ?? []).length, 0);
    expect(before, 'đo trên thẻ thật: đây là số khối EJS chạy mà AI không đọc được gì').toBe(10);

    const after = repairInjectPromptArgs(entries as never);
    expect(after.fixed.length, 'mỗi entry hỏng phải có một dòng báo đã sửa').toBeGreaterThan(0);
    const left = after.entries.reduce(
      (n, e) => n + (String(e.content ?? '').match(/injectPrompt\s*\(\s*\{/g) ?? []).length, 0);
    expect(left).toBe(0);
    // Nội dung chỉ thị phải còn nguyên, chỉ đổi cách đưa ra.
    expect(after.entries.some(e => /print\('\[CẢNH BÁO HỆ THỐNG/.test(String(e.content ?? '')))).toBe(true);
  });

  it('vá initvar xong thì thẻ sạch hoàn toàn phần biến', () => {
    const input = loadCard();
    const res = simulateCard({
      ...input,
      initVarContent: input.initVarContent.replace(/'Phả Hệ':\s*Null/, `'Phả Hệ': "Null"`),
    });
    expect(res.issues.filter(i => i.code === 'sim-initvar-value-invalid')).toEqual([]);
    expect(res.issues.filter(i => i.code === 'sim-reader-missing-var')).toEqual([]);
  });
});
