import { describe, it, expect } from 'vitest';
import {
  countResidualHan,
  extractCjkSamples,
  scanFieldsForResidualCjk,
  buildResidualRetryInstruction,
  stripNonTranslatableForScan,
  type ScannableField,
} from '../residualCjkScan';

/**
 * (User 2026 — việc 80) Quét chữ Trung còn sót SAU khi dịch xong rồi tự dịch lại.
 * Điều kiện then chốt của user: KHÔNG quét chữ Trung trong LINK — CJK trong URL là cố ý,
 * đụng vào là gãy link, mà đếm nó thì retry vô tận vì dịch xong vẫn còn.
 */

const f = (o: Partial<ScannableField>): ScannableField => ({
  path: 'p', label: 'L', group: 'core', status: 'done', original: '中文原文', ...o,
});

describe('countResidualHan — KHÔNG tính chữ Hán trong link', () => {
  it('chữ Hán trong văn bản thường → có tính', () => {
    expect(countResidualHan('Xin chào 世界 nhé')).toBe(2);
  });

  it('chữ Hán trong URL http → KHÔNG tính', () => {
    expect(countResidualHan("import('https://cdn.com/骰子系统/stable.js')")).toBe(0);
  });

  it('chữ Hán trong src=/href= → KHÔNG tính', () => {
    expect(countResidualHan('<img src="./图片/a.png"> Ảnh minh hoạ')).toBe(0);
  });

  it('chữ Hán trong url() của CSS → KHÔNG tính', () => {
    expect(countResidualHan('background: url("/资源/bg.png");')).toBe(0);
  });

  it('phần URL của link markdown không tính, nhưng CHỮ HIỂN THỊ thì có', () => {
    expect(countResidualHan('[链接](https://a.com/资源)')).toBe(2);
  });

  it('bản dịch sạch hoàn toàn → 0', () => {
    expect(countResidualHan('Đây là bản dịch hoàn chỉnh, không còn chữ Hán.')).toBe(0);
  });

  it('cssCjkHandling=preserve → bỏ qua font-family giữ nguyên có chủ ý', () => {
    const css = "body { font-family: '微软雅黑'; } Nội dung đã dịch";
    expect(countResidualHan(css, 'preserve')).toBe(0);
    expect(countResidualHan(css, 'translate')).toBeGreaterThan(0);
  });

  it('chuỗi rỗng/null → 0, không nổ', () => {
    expect(countResidualHan('')).toBe(0);
    expect(countResidualHan(undefined as unknown as string)).toBe(0);
  });
});

describe('stripNonTranslatableForScan', () => {
  it('bỏ link nhưng giữ nguyên phần chữ xung quanh', () => {
    const out = stripNonTranslatableForScan('Xem tại https://a.com/资源 và 世界');
    expect(out).not.toContain('资');
    expect(out).toContain('世界');
  });
});

describe('extractCjkSamples — chỉ mặt chỗ còn sót cho AI', () => {
  it('trả về đoạn có chữ Hán kèm ngữ cảnh', () => {
    const s = extractCjkSamples('Câu đã dịch xong. Nhưng đoạn này 还没有翻译 vẫn còn nguyên.');
    expect(s).toHaveLength(1);
    expect(s[0]).toContain('还没有翻译');
    expect(s[0]).toContain('đoạn này');
  });

  it('gộp chữ Hán gần nhau thành 1 đoạn, tách xa nhau thành nhiều đoạn', () => {
    const far = 'A 中文 ' + 'x'.repeat(80) + ' 日本語 B';
    expect(extractCjkSamples(far).length).toBe(2);
  });

  it('cắt theo maxSamples', () => {
    const many = Array.from({ length: 10 }, (_, i) => `${'y'.repeat(40)} 中${i}`).join(' ');
    expect(extractCjkSamples(many, 3)).toHaveLength(3);
  });

  it('không còn chữ Hán → mảng rỗng', () => {
    expect(extractCjkSamples('Đã dịch hết rồi')).toEqual([]);
  });

  it('chữ Hán chỉ nằm trong link → không lấy mẫu (khỏi retry oan)', () => {
    expect(extractCjkSamples('Tải ở https://a.com/资源/x.js nhé')).toEqual([]);
  });
});

describe('scanFieldsForResidualCjk', () => {
  it('bắt field còn sót, bỏ qua field đã sạch', () => {
    const hits = scanFieldsForResidualCjk([
      f({ path: 'a', translated: 'Đã dịch sạch' }),
      f({ path: 'b', translated: 'Còn sót 世界 đây' }),
    ]);
    expect(hits.map(h => h.path)).toEqual(['b']);
    expect(hits[0].count).toBe(2);
    expect(hits[0].samples[0]).toContain('世界');
  });

  it('bỏ qua field chưa dịch xong (pending/error/translating)', () => {
    const hits = scanFieldsForResidualCjk([
      f({ path: 'a', status: 'pending', translated: '世界' }),
      f({ path: 'b', status: 'error', translated: '世界' }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it('bỏ qua lorebook_keys (chế độ gộp cố ý giữ key gốc)', () => {
    const hits = scanFieldsForResidualCjk([f({ group: 'lorebook_keys', translated: '世界, Thế Giới' })]);
    expect(hits).toHaveLength(0);
    expect(scanFieldsForResidualCjk(
      [f({ group: 'lorebook_keys', translated: '世界, Thế Giới' })],
      { skipLorebookKeys: false },
    )).toHaveLength(1);
  });

  it('nguồn vốn KHÔNG có chữ Hán → không coi là dịch sót', () => {
    const hits = scanFieldsForResidualCjk([
      f({ original: 'Pure ASCII source', translated: 'Có 世界 do AI tự thêm' }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it('field chỉ còn chữ Hán trong LINK → KHÔNG bị bắt dịch lại', () => {
    const hits = scanFieldsForResidualCjk([
      f({ original: '看这个 https://a.com/资源/x.js', translated: 'Xem cái này https://a.com/资源/x.js' }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it('sắp xếp field sót nhiều nhất lên đầu', () => {
    const hits = scanFieldsForResidualCjk([
      f({ path: 'ít', translated: 'a 世 b' }),
      f({ path: 'nhiều', translated: 'a 世界人生天地 b' }),
    ]);
    expect(hits[0].path).toBe('nhiều');
  });

  it('minCount lọc được nhiễu vài chữ lẻ (tên riêng)', () => {
    const hits = scanFieldsForResidualCjk(
      [f({ translated: 'Tên riêng 李 giữ nguyên' })],
      { minCount: 5 },
    );
    expect(hits).toHaveLength(0);
  });

  it('mảng rỗng/undefined → không nổ', () => {
    expect(scanFieldsForResidualCjk([])).toEqual([]);
    expect(scanFieldsForResidualCjk(undefined as unknown as ScannableField[])).toEqual([]);
  });
});

describe('buildResidualRetryInstruction', () => {
  it('liệt kê đúng các đoạn còn sót để AI biết chỗ nào chưa dịch', () => {
    const out = buildResidualRetryInstruction({
      path: 'a', label: 'L', group: 'core', count: 4, samples: ['…还没有翻译…'],
    });
    expect(out).toContain('还没有翻译');
    expect(out).toContain('4');
    expect(out).toMatch(/URL|đường dẫn/);
  });
});
