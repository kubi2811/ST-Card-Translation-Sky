import { describe, it, expect } from 'vitest';
import { segmentEjs, reassembleEjs, isEjsProseField, collectProseToTranslate, hasResidualCjkInProse } from '../ejsSegmenter';

/**
 * (User 2026) Surgical EJS: chẻ CODE/PROSE để dịch entry EJS không còn nửa vời / vỡ code.
 * BẤT BIẾN quan trọng nhất: reassembleEjs(segmentEjs(x)) === x với MỌI x.
 */
describe('ejsSegmenter — round-trip AN TOÀN', () => {
  const samples = [
    '',
    'chỉ là văn bản thuần',
    '当创角叙事全部结束后 <% if (isPrep) { %> phase: <%- j(ph) %> <% } %> 结束',
    'note: "该操作将在阶段切换" action: <%- j({"op":"replace","path":"/A/B","value":true}) %>',
    'Xin chào {{char}}, {{getvar::力量}} — xem https://cdn.discord.com/a/b.png nhé',
    '<%= x %><%- y %><% z %>',
    '没有任何代码块的中文',
  ];
  it('reassemble(segment(x)) === x cho mọi mẫu (không mất byte)', () => {
    for (const s of samples) {
      expect(reassembleEjs(segmentEjs(s))).toBe(s);
    }
  });
  it('khối <% %> / {{}} / URL luôn là CODE, giữ nguyên', () => {
    const segs = segmentEjs('a <% code %> b {{char}} c https://x.com/y d');
    const code = segs.filter((s) => s.type === 'code').map((s) => s.text);
    expect(code).toContain('<% code %>');
    expect(code).toContain('{{char}}');
    expect(code).toContain('https://x.com/y');
  });
  it('văn bản giữa các khối là PROSE', () => {
    const segs = segmentEjs('前 <% c %> 后');
    const prose = segs.filter((s) => s.type === 'prose').map((s) => s.text);
    expect(prose).toEqual(['前 ', ' 后']);
  });
});

describe('isEjsProseField', () => {
  it('có <%…%> + prose CJK → true', () => {
    expect(isEjsProseField('规则 <% if(x){ %> 动作 <% } %>')).toBe(true);
  });
  it('không có khối EJS → false (không phải template)', () => {
    expect(isEjsProseField('const x = "力量"; // pure JS')).toBe(false);
  });
  it('có EJS nhưng prose không CJK → false (không cần dịch)', () => {
    expect(isEjsProseField('all english <% code %> more english')).toBe(false);
  });
});

describe('collectProseToTranslate + residual', () => {
  it('chỉ gom PROSE có CJK, giữ code ngoài danh sách', () => {
    const segs = segmentEjs('中文A <% code中文 %> 中文B english');
    const { indices, texts } = collectProseToTranslate(segs);
    // 2 prose có CJK: "中文A " và " 中文B english"; code "<% code中文 %>" KHÔNG được gom
    expect(texts.length).toBe(2);
    expect(texts.every((t) => /[一-鿿]/.test(t))).toBe(true);
    expect(indices.every((i) => segs[i].type === 'prose')).toBe(true);
  });
  it('sau khi thay prose bằng bản dịch → hết CJK sót', () => {
    const segs = segmentEjs('规则A <% keep中文 %> 规则B');
    const { indices } = collectProseToTranslate(segs);
    for (const i of indices) segs[i].text = segs[i].text.replace(/[一-鿿]+/g, 'Quy tắc');
    expect(hasResidualCjkInProse(segs)).toBe(false);
    // code vẫn giữ CJK bên trong (đúng — không đụng)
    expect(reassembleEjs(segs)).toContain('<% keep中文 %>');
  });
});
