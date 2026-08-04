/**
 * (bug 211) "Lỗi tự động bỏ qua khi dịch không được, dịch bị sót tiếng Trung — bấm dịch lại
 * từng entry thì lại được."
 * ─────────────────────────────────────────────────────────────────────────────
 * Nửa nguyên nhân nằm ở chỗ ba đường dịch (vòng chính / dịch lại 1 entry / thử lại hàng loạt)
 * mang BA bộ chốt khác nhau — đường bulk thậm chí không có chốt nào. Test này khoá hợp đồng
 * của bộ chốt CHUNG `finalizeRetryTranslation`: từ nay đường nào cũng chấm bằng đúng một luật.
 */
import { describe, it, expect } from 'vitest';
import { finalizeRetryTranslation } from '../retryGuards';

/** Script JS "thật" — đủ tín hiệu cho isLikelyJsScript + hasRealJsSignal, parse sạch. */
const GOOD_JS = [
  'const stats = { HP: 100, MP: 50 };',
  'let total = 0;',
  'function addUp(n) {',
  '  total = total + n;',
  '  return total;',
  '}',
  'addUp(stats.HP);',
].join('\n');

describe('(bug 211) chốt cú pháp JS trên đường dịch lại', () => {
  it('bản dịch vỡ cú pháp (chuỗi không đóng) ⇒ GIỮ GỐC, có lý do', () => {
    const broken = GOOD_JS.replace("stats.HP", "stats.HP); console.log('đứt");
    const r = finalizeRetryTranslation({
      original: GOOD_JS, translated: broken, label: 'x', group: 'tavern_helper',
    });
    expect(r.keptOriginal).toBe(true);
    expect(r.text).toBe(GOOD_JS);
    expect(r.guardReason).toMatch(/cú pháp JS/);
  });

  it('khoá object bị dịch thành có khoảng trắng ⇒ TỰ VÁ (bọc nháy) chứ không giữ gốc', () => {
    const orig = [
      'const cfg = { 魔力值: 80, 上限: 8 };',
      'let sum = cfg.魔力值;',
      'function tick() { sum = sum + 1; return sum; }',
      'tick();',
    ].join('\n');
    const translated = orig
      .replace('魔力值: 80', 'Điểm ma lực: 80')
      .replace('上限: 8', 'Giới hạn: 8')
      .replace('cfg.魔力值', "cfg['Điểm ma lực']");
    const r = finalizeRetryTranslation({ original: orig, translated, label: 'x', group: 'tavern_helper' });
    expect(r.keptOriginal).toBe(false);
    expect(r.text).toContain("'Điểm ma lực'");
    expect(r.notes.some(n => n.msg.includes('bọc nháy'))).toBe(true);
  });

  it('initvar (YAML) được miễn chốt cú pháp — đúng miễn trừ bugNeedFix/128', () => {
    const orig = 'const x = 1;\nlet y = 2;\nfunction f() { return x + y; }\nf();';
    const brokenLikeYaml = 'nhãn có dấu cách: 1\nmục hai: 2';
    const r = finalizeRetryTranslation({
      original: orig, translated: brokenLikeYaml, label: 'x', group: 'lorebook', entryType: 'initvar',
    });
    expect(r.keptOriginal).toBe(false);
  });
});

describe('(bug 211) chốt toàn vẹn EJS + chống bịa code', () => {
  it('bản dịch làm rơi khối <%…%> ⇒ GIỮ GỐC', () => {
    const orig = 'Mở đầu <%= hp %> và <%= mp %> kết thúc.';
    const r = finalizeRetryTranslation({
      original: orig, translated: 'Mở đầu <%= hp %> và mp kết thúc.', label: 'x', group: 'lorebook',
    });
    expect(r.keptOriginal).toBe(true);
    expect(r.guardReason).toMatch(/EJS/);
  });

  it('AI nhét thêm hàm lạ vào field code ⇒ GIỮ GỐC', () => {
    const orig = 'const a = 1;\nlet b = a + 1;\nfunction dùng() { return b; }\ndùng();';
    const translated = orig + '\nfunction safeString(v) { return String(v ?? ""); }\nsafeString(b);';
    const r = finalizeRetryTranslation({ original: orig, translated, label: 'x', group: 'tavern_helper' });
    expect(r.keptOriginal).toBe(true);
    expect(r.guardReason).toMatch(/bịa code|vỡ dấu nháy/);
  });
});

describe('(bug 211) hậu xử lý dùng chung (trước đây đường bulk KHÔNG có)', () => {
  it('macro {{…}} bị dịch được trả về nguyên văn', () => {
    const r = finalizeRetryTranslation({
      original: 'Chào {{user}}, chúc vui.',
      translated: 'Chào {{người dùng}}, chúc vui.',
      label: 'x', group: 'lorebook',
    });
    expect(r.text).toContain('{{user}}');
    expect(r.notes.some(n => n.msg.includes('macro'))).toBe(true);
  });

  it('nháy cong trong code về nháy thẳng', () => {
    const orig = 'const msg = "hello";\nlet n = 1;\nfunction f() { return msg + n; }\nf();';
    const translated = orig.replace('"hello"', '“xin chào”');
    const r = finalizeRetryTranslation({ original: orig, translated, label: 'x', group: 'tavern_helper' });
    expect(r.keptOriginal).toBe(false);
    expect(r.text).toContain('"xin chào"');
  });

  it('văn xuôi thường dịch sạch ⇒ nhận nguyên bản dịch, không chốt nào chặn', () => {
    const r = finalizeRetryTranslation({
      original: '他走进了大厅。', translated: 'Anh ta bước vào đại sảnh.', label: 'x', group: 'lorebook',
    });
    expect(r.keptOriginal).toBe(false);
    expect(r.text).toBe('Anh ta bước vào đại sảnh.');
    expect(r.guardReason).toBeUndefined();
  });

  it('AI trả về đúng nguyên văn ⇒ keptOriginal=true nhưng KHÔNG có guardReason', () => {
    const r = finalizeRetryTranslation({
      original: '原文不变', translated: '原文不变', label: 'x', group: 'lorebook',
    });
    expect(r.keptOriginal).toBe(true);
    expect(r.guardReason).toBeUndefined();
  });
});
