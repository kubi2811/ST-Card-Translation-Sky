/**
 * (bugNeedFix/184) AI soi khác biệt từng mục trong So Sánh Card.
 * ─────────────────────────────────────────────────────────────────────────────
 * "đôi khi khác có tí xíu nhưng phải dịch lại toàn bộ entry thì không ổn lắm" — phần AI thì
 * không test được bằng máy, nhưng ba thứ quanh nó thì phải chốt:
 *   1. prompt nói đúng việc (giữ tối đa bản dịch cũ, code theo cấu trúc Final);
 *   2. parse chặt chẽ (JSON rác/thiếu patched là ném lỗi, không trả im lặng);
 *   3. verifyPatched — chốt máy TRƯỚC khi cho áp: macro (bug 180), ngoặc rỗng (bug 178),
 *      JS vỡ (bug 49/128). AI vá thì máy phải khám.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  detectContentKind, buildCompareDiffMessages, parseCompareDiffResponse, verifyPatched,
  type CompareDiffInput,
} from '../aiCompareDiff';

const input = (over: Partial<CompareDiffInput> = {}): CompareDiffInput => ({
  label: 'lorebook[3].content', path: 'data.character_book.entries[3].content',
  translated: 'Lâm Uyển là đệ tử {{user}} thu nhận, tính lạnh lùng.',
  final: '林婉是{{user}}收的弟子，性格冷淡，喜欢吃糖。',
  ...over,
});

describe('detectContentKind', () => {
  it('regex/script/schema là code — đúng các loại user nêu đích danh', () => {
    expect(detectContentKind('data.extensions.regex_scripts[0].replaceString', '<div>x</div>')).toBe('code');
    expect(detectContentKind('data.extensions.TavernHelper_scripts[0].content', 'x')).toBe('code');
    expect(detectContentKind('a.b', 'const s = registerMvuSchema({});')).toBe('code');
    expect(detectContentKind('a.b', '[initvar]\nstat_data:')).toBe('code');
  });
  it('văn thường là text', () => {
    expect(detectContentKind('data.description', 'Một cô gái sống ở làng chài.')).toBe('text');
  });
});

describe('buildCompareDiffMessages', () => {
  it('đủ 3 khối: gốc cũ (nếu có) + bản dịch + Final, và system nói rõ luật giữ bản dịch cũ', () => {
    const { system, user } = buildCompareDiffMessages(input({ raw: '林婉是弟子。' }));
    expect(system).toContain('GIỮ NGUYÊN TỐI ĐA');
    expect(system).toContain('cấu trúc code lấy THEO FINAL');
    expect(user).toContain('BẢN GỐC CŨ');
    expect(user).toContain('BẢN DỊCH HIỆN CÓ');
    expect(user).toContain('BẢN FINAL');
  });
  it('không có gốc cũ thì NÓI là không có, không im lặng bỏ khối', () => {
    const { user } = buildCompareDiffMessages(input());
    expect(user).toContain('Không có bản gốc cũ');
  });
});

describe('parseCompareDiffResponse', () => {
  it('bóc JSON kể cả khi bọc ```json', () => {
    const r = parseCompareDiffResponse('```json\n{"differences":["Thêm: 喜欢吃糖 (thích ăn kẹo)"],"patched":"bản vá"}\n```');
    expect(r.differences).toEqual(['Thêm: 喜欢吃糖 (thích ăn kẹo)']);
    expect(r.patched).toBe('bản vá');
  });
  it('thiếu patched là ném lỗi — không cho áp một chuỗi rỗng vào card', () => {
    expect(() => parseCompareDiffResponse('{"differences":[]}')).toThrow();
    expect(() => parseCompareDiffResponse('không phải json')).toThrow();
  });
});

describe('verifyPatched — chốt máy trước khi cho áp', () => {
  it('bản vá lành thì qua, giữ nguyên văn', () => {
    const v = verifyPatched(input(), 'Lâm Uyển là đệ tử {{user}} thu nhận, tính lạnh lùng, thích ăn kẹo.');
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it('(bug 180) macro bị đổi ruột → máy TỰ TRẢ về nguyên văn Final, vẫn ok', () => {
    const v = verifyPatched(input(), 'Lâm Uyển là đệ tử {{基础信息}} thu nhận.');
    expect(v.ok).toBe(true);
    expect(v.patched).toContain('{{user}}');
    expect(v.patched).not.toContain('基础信息');
  });

  it('(bug 178) ngoặc rỗng ruột so với Final → từ chối', () => {
    const inp = input({ final: '【消费监测】支出记录', translated: '【Giám sát chi tiêu】ghi chép' });
    const v = verifyPatched(inp, '【】ghi chép chi tiêu');
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('rỗng ruột');
  });

  it('(bug 49/128) Final là JS lành mà bản vá vỡ cú pháp → từ chối kèm dòng lỗi', () => {
    const inp = input({
      path: 'data.extensions.TavernHelper_scripts[0].content',
      final: 'function hi() { console.log("你好"); }',
      translated: 'function hi() { console.log("xin chào"); }',
    });
    const v = verifyPatched(inp, 'function hi() { console.log("xin chào; }');
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('vỡ cú pháp JS');
  });
});

/* ─────────────── Nối dây: panel phải THẬT SỰ dùng các hàm trên ─────────────── */
describe('CompareCardsPanel nối AI soi khác', () => {
  const SRC = readFileSync(new URL('../../components/CompareCardsPanel.tsx', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');

  it('có nút AI soi khác, chỉ hiện khi Dịch ↔ Final thật sự khác nhau', () => {
    expect(SRC).toContain('AI soi khác');
    expect(SRC).toContain('tv === fv) return null');
  });
  it('kết quả qua verifyPatched trước khi cho áp, và bản vá hỏng thì khoá nút áp', () => {
    expect(SRC).toContain('verifyPatched(input, parsed.patched)');
    expect(SRC).toContain('disabled={aiDiff.problems.length > 0}');
  });
});
