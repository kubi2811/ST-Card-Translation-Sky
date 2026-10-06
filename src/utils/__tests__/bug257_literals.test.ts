/**
 * (bug 257, bước 3–4) Thẻ "Thần Hào": cùng chuỗi `'房产地产'` dịch ra 'Bất động sản' ở titleMap
 * nhưng 'nhà đất' ở order ⇒ `cats[type].push` TypeError; "Dự Đoán5Ngày nữa" dính chữ; và
 * `'[' + x + ']'` bị hậu xử lý gộp thành một chuỗi `"[' + x + ']"`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// AI giả: cùng một chữ mà mỗi lần được hỏi lại trả một kiểu khác — đúng cái bệnh của thẻ thật.
const asked: Record<string, number> = {};
const VARIANTS: Record<string, string[]> = {
  房产地产: ['Bất động sản', 'nhà đất', 'Nhà Đất'],
  载具交通: ['Phương tiện giao thông', 'xe cộ'],
  天后临产: ['Ngày nữa sắp sinh'],
  今天进入: ['Hôm nay bước vào'],
  技能列表: ['Danh sách kỹ năng'],
};
vi.mock('../apiClient', async (orig) => ({
  ...(await orig<typeof import('../apiClient')>()),
  computePoolConcurrency: () => 1,
  callProvider: vi.fn(async (_c: unknown, _s: string, payload: string) =>
    payload.split('\n').map((line) => {
      const [id, text] = line.split('\t');
      const v = VARIANTS[text] || [text];
      const n = (asked[text] = (asked[text] ?? -1) + 1);
      return `${id}\t${v[n % v.length]}`;
    }).join('\n')),
}));

import { surgicalTranslate } from '../surgical';
import { registerCodeLiteralStore, padConcatBoundaries, stringLiteralDrop, isWholeLiteralToken } from '../codeLiterals';
import { fixNestedQuoteBracketPaths, postProcessRegexHtml } from '../mvuSync';
import { extractCJKTokens } from '../surgical';

let dict: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(asked)) delete asked[k];
  dict = {};
  registerCodeLiteralStore({ get: () => dict, merge: (a) => { dict = { ...a, ...dict }; } });
});

const CFG = { model: 'x' } as never;

describe('bug 257 — bước 3: chuỗi trọn dịch NHẤT QUÁN trong field và giữa các field', () => {
  const SRC = [
    "const titleMap = { '房产地产': 'A', '载具交通': 'B' };",
    "const order = ['房产地产', '载具交通'];",
    "function f(t) { if (/房/.test(t)) return '房产地产'; return '载具交通'; }",
  ].join('\n');

  it('một field: ba chỗ cùng gốc ra cùng một bản dịch', async () => {
    const r = await surgicalTranslate(SRC, CFG, 'Tiếng Việt', undefined, undefined, undefined, false);
    const hits = r.translated.match(/'(Bất động sản|nhà đất|Nhà Đất)'/g) || [];
    expect(hits.length).toBe(3);
    expect(new Set(hits).size).toBe(1);
    expect(asked['房产地产']).toBe(0);           // hỏi AI đúng MỘT lần
    expect(dict['房产地产']).toBe('Bất động sản'); // và nhớ lại cho cả thẻ
  });

  it('field sau dùng lại bản dịch của field trước, không hỏi AI', async () => {
    dict = { 房产地产: 'Bất động sản' };
    const r = await surgicalTranslate("if (type === '房产地产') x();", CFG, 'Tiếng Việt', undefined, undefined, undefined, false);
    expect(r.translated).toContain("type === 'Bất động sản'");
    expect(asked['房产地产']).toBeUndefined();
  });
});

describe('bug 257 — bước 4: dấu cách ở chỗ nối chuỗi, chuỗi bị gộp', () => {
  it('thêm dấu cách phía có phép nối, không đụng khi đang dựng tên key', async () => {
    const src = "const a = prefix + diff + '天后临产';\nconst b = '今天进入' + phase;\nconst k = obj[pre + '天后临产'];";
    const r = await surgicalTranslate(src, CFG, 'Tiếng Việt', undefined, undefined, undefined, false);
    expect(r.translated).toContain("diff + ' Ngày nữa sắp sinh'");
    expect(r.translated).toContain("'Hôm nay bước vào ' + phase");
    expect(r.translated).toContain("obj[pre + 'Ngày nữa sắp sinh']");
  });

  it('template literal: ${n}天后 ⇒ ${n} …', () => {
    const src = 'const s = `${n}天后临产`;';
    const tok = extractCJKTokens(src)[0];
    expect(padConcatBoundaries(src, tok, 'Ngày nữa sắp sinh')).toBe(' Ngày nữa sắp sinh');
  });

  it("fixNestedQuoteBracketPaths không còn gộp '[' + x + ']' — vẫn sửa nháy lồng thật", () => {
    const code = "return s ? '[' + Object.keys(s).length + ']' : '[0]';\nshowBdsmModal('[' + data.roomName + ']', content);";
    expect(fixNestedQuoteBracketPaths(code)).toBe(code);
    expect(postProcessRegexHtml(code)).toBe(code);
    expect(fixNestedQuoteBracketPaths("_.get(d, 'stat['Độ Hảo Cảm']')")).toBe(`_.get(d, "stat['Độ Hảo Cảm']")`);
  });

  it('đếm được chuỗi bị gộp', () => {
    const o = "x = s ? '[' + Object.keys(s).length + ']' : '[0]';";
    const t = "x = s ? \"[' + Object.keys(s).length + ']\" : '[0]';";
    expect(stringLiteralDrop(o, t)).toBe(1);
    expect(stringLiteralDrop(o, o)).toBe(0);
    expect(stringLiteralDrop("<script>var a='甲';</script>", "<script>var a='Giáp';</script>")).toBe(0);
  });

  it('isWholeLiteralToken', () => {
    const src = "a = ['房产地产', '还有 ' + n + ' 天'];";
    const toks = extractCJKTokens(src);
    expect(isWholeLiteralToken(src, toks.find(t => t.text === '房产地产')!)).toBe(true);
    expect(isWholeLiteralToken(src, toks.find(t => t.text === '还有')!)).toBe(false);
  });
});
