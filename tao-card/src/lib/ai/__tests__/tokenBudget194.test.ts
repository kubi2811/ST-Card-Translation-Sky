/**
 * (bug 194) LOREBOOK SINH THEO BATCH LUÔN CHỈ RA MỘT NỬA SỐ TOKEN ĐÃ ĐẶT.
 * (bug 196) Phải cho user chỉnh, và phải chịu được 3000-5000 token/entry với ≥100 entry.
 * ─────────────────────────────────────────────────────────────────────────────
 * Đo bằng chính gpt-tokenizer (đã có sẵn trong dự án):
 *   văn xuôi lore tiếng Việt 3.35 ký tự/token · entry lorebook thật 2.98 ký tự/token
 * ⇒ hằng số 3.5 của tool KHÔNG phải thủ phạm. Ba thủ phạm thật:
 *   1. sàn chấp nhận đặt ở 60% ngân sách (prompt thì hứa 70%) — kết quả dồn hết xuống sát sàn;
 *   2. không bao giờ đếm token thật nên thiếu hụt vô hình với chính cái tool;
 *   3. `max_tokens` là con số cố định trong Settings, không suy ra từ ngân sách × cỡ lô — lô chạm
 *      trần thì mô hình TỰ NÉN mỗi entry cho vừa, không cắt, không cảnh báo.
 */
import { describe, it, expect } from 'vitest';
import {
  countTokens, checkEntryBudget, planBatch, buildLengthDirective, VI_CHARS_PER_TOKEN,
} from '../tokenBudget';

const viText = (tokens: number) =>
  'Nàng là trưởng nữ của gia tộc Ngân Nguyệt, tính cách trầm mặc, kiếm thuật gia truyền rất tinh diệu. '
    .repeat(Math.max(1, Math.ceil(tokens / 30)));

describe('(bug 194) đếm token THẬT, không ước theo ký tự', () => {
  it('đếm được và bám sát tỉ lệ đã đo của tiếng Việt', () => {
    const s = viText(200);
    const n = countTokens(s);
    expect(n).toBeGreaterThan(0);
    const ratio = s.length / n;
    expect(ratio, `tỉ lệ đo được ${ratio.toFixed(2)} — lệch xa số đã khảo sát`).toBeGreaterThan(2.2);
    expect(ratio).toBeLessThan(4.2);
  });

  it('chuỗi rỗng = 0 token, không ném lỗi', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens(undefined as unknown as string)).toBe(0);
  });

  it('hằng số ký tự/token phải là số ĐO ĐƯỢC, không lạc quan hơn thực tế', () => {
    expect(VI_CHARS_PER_TOKEN).toBeLessThanOrEqual(3.35);
  });
});

describe('(User 2026) BỎ SÀN — ngân sách chỉ để ĐO, không để phán đạt/không đạt', () => {
  it('không lộ ra ngưỡng nào để chỗ khác đem đi loại entry', () => {
    const c = checkEntryBudget(viText(180), 200);
    expect(Object.keys(c).sort()).toEqual(['actual', 'ratio', 'target']);
  });

  it('entry ngắn vẫn ĐO được, tỉ lệ phản ánh đúng thực tế', () => {
    const c = checkEntryBudget(viText(100), 200);
    expect(c.actual).toBeGreaterThan(0);
    expect(c.ratio).toBeLessThan(1);
  });

  it('entry ngắn thảm hại cũng chỉ là một con số, không phải bản án', () => {
    const c = checkEntryBudget('Một câu ngắn.', 500);
    expect(c.ratio).toBeLessThan(0.45);
    expect(c.target).toBe(500);
  });

  it('không đặt ngân sách thì không có gì để so', () => {
    const c = checkEntryBudget('bất kỳ', 0);
    expect(c.target).toBe(0);
    expect(c.ratio).toBe(1);
  });
});

describe('(bug 194-3 / 196) cỡ lô và max_tokens phải suy ra TỪ ngân sách', () => {
  it('ngân sách nhỏ, trần rộng → giữ nguyên cỡ lô user muốn', () => {
    const p = planBatch(250, 6, 8192);
    expect(p.entriesPerBatch).toBe(6);
    expect(p.reduced).toBe(false);
    expect(p.maxTokens).toBeLessThanOrEqual(8192);
  });

  it('ca bug 196: 4000 token/entry thì KHÔNG thể nhồi 6 entry một lô', () => {
    const p = planBatch(4000, 6, 8192);
    expect(p.entriesPerBatch, 'nhồi cả 6 là mô hình tự nén cho vừa — đúng bệnh bug 194').toBe(1);
    expect(p.reduced).toBe(true);
  });

  it('trần output lớn thì mới cho nhiều entry mỗi lô', () => {
    const p = planBatch(4000, 6, 65536);
    expect(p.entriesPerBatch).toBeGreaterThan(1);
    expect(p.entriesPerBatch).toBeLessThanOrEqual(6);
  });

  it('max_tokens cấp cho lời gọi phải ĐỦ cho cả lô, và không vượt khả năng model', () => {
    const p = planBatch(3000, 4, 32000);
    expect(p.maxTokens).toBeGreaterThanOrEqual(p.entriesPerBatch * 3000);
    expect(p.maxTokens).toBeLessThanOrEqual(32000);
  });

  it('luôn cho ít nhất 1 entry mỗi lô, kể cả ngân sách vượt trần', () => {
    const p = planBatch(50000, 5, 8192);
    expect(p.entriesPerBatch).toBe(1);
  });

  it('tham số rác không làm vỡ', () => {
    const p = planBatch(0, 0, 0);
    expect(p.entriesPerBatch).toBeGreaterThanOrEqual(1);
    expect(p.maxTokens).toBeGreaterThan(0);
  });
});

describe('(bug 194) chỉ thị độ dài nói bằng ba cách, vì mô hình không tự đếm token được', () => {
  it('có đủ token, ký tự và cấu trúc', () => {
    const d = buildLengthDirective(3000);
    expect(d).toContain('3000 token');
    expect(d).toContain(String(Math.round(3000 * VI_CHARS_PER_TOKEN)));
    expect(d).toMatch(/đoạn/);
  });

  it('(User 2026) KHÔNG nêu sàn, KHÔNG doạ loại bài — nêu là mô hình viết chạm mốc rồi dừng', () => {
    const d = buildLengthDirective(1000);
    expect(d, 'còn doạ sàn cứng').not.toMatch(/sàn|tối thiểu|ít nhất|không dưới/i);
    expect(d, 'còn doạ loại bài vì ngắn').not.toMatch(/bị loại|viết lại/i);
  });

  it('không đặt ngân sách → không chèn chỉ thị nào', () => {
    expect(buildLengthDirective(0)).toBe('');
  });
});

