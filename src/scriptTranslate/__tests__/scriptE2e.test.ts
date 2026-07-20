// (User 20/07) Phase B — e2e KHÔNG AI: fixture JS tổng hợp đủ các ca hiểm (template literal
// + ${}, object key Trung, regex Trung, dot-notation) đi qua extract → "dịch giả" → reinsert
// → alternation, rồi kiểm bằng acorn: kết quả PHẢI là JS hợp lệ, key Trung PHẢI nguyên vẹn.
import { describe, it, expect } from 'vitest';
import * as acorn from 'acorn';
import { extractCJKTokens, reinsertTranslations } from '../../utils/surgical';
import { isTranslatableToken } from '../tokenBatcher';
import { applyRegexAlternation } from '../regexAlternation';

const FIXTURE = `
const hn = { 子时: "00:00", 丑时: "02:00" };
const label = "核心记忆";
const toast = \`系统: \${name} 已加载\`;
const html = '<div class="zhino-fab">别名编辑</div>';
const rx = /秋青子\\s*[:：]?\\s*/g;
export function greet(user) {
  console.log("你好，" + user + "！");
  return hn.子时;
}
`;

const FAKE_VI: Record<string, string> = {
  核心记忆: 'Ký ức cốt lõi',
  '系统: ': 'Hệ thống: ',
  ' 已加载': ' đã tải',
  别名编辑: 'Sửa biệt danh',
  '你好，': 'Xin chào, ',
  '！': '!',
};

describe('e2e không-AI: extract → dịch giả → reinsert → alternation', () => {
  it('trọn pipeline giữ JS hợp lệ + bảo toàn những gì phải bảo toàn', () => {
    // Zone bảo vệ regex literal (giả lập protectZones của worker)
    const lits = [...FIXTURE.matchAll(/\/秋青子[^/]*\/g/g)];
    const zones = lits.map((m) => ({ start: m.index!, end: m.index! + m[0].length, reason: 'regex' }));

    const tokens = extractCJKTokens(FIXTURE, zones as never, 'preserve');
    expect(tokens.length).toBeGreaterThan(0);

    // Token trong regex literal KHÔNG được extract (zone bảo vệ)
    for (const t of tokens) {
      const inRegex = zones.some((z) => t.start >= z.start && t.end <= z.end);
      expect(inRegex, `token ${t.text} lọt vào regex literal`).toBe(false);
    }

    // "Dịch": chỉ token dịch được + có trong bảng giả
    for (const t of tokens) {
      if (!isTranslatableToken(t)) continue;
      const vi = FAKE_VI[t.text];
      if (vi) t.translated = vi;
    }

    let out = reinsertTranslations(FIXTURE, tokens);
    const r = applyRegexAlternation(out, { 秋青子: 'Thu Thanh Tử' });
    out = r.code;

    // 1) JS hợp lệ
    expect(() => acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow();
    // 2) Object key Trung + dot-notation nguyên vẹn
    expect(out).toContain('子时: "00:00"');
    expect(out).toContain('hn.子时');
    // 3) Chuỗi UI đã sang tiếng Việt
    expect(out).toContain('Ký ức cốt lõi');
    expect(out).toContain('Sửa biệt danh');
    // 4) ${} interpolation còn nguyên trong template literal
    expect(out).toContain('${name}');
    // 5) Regex được thêm nhánh, giữ Hán
    expect(out).toContain('(?:秋青子|Thu Thanh Tử)');
    expect(r.changed).toBe(1);
    // 6) CSS class không bị đổi
    expect(out).toContain('class="zhino-fab"');
  });
});
