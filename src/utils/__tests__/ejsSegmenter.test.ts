import { describe, it, expect } from 'vitest';
import { segmentEjs, reassembleEjs, isEjsProseField, collectProseToTranslate, hasResidualCjkInProse, maskEjsCode, unmaskEjsCode } from '../ejsSegmenter';

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

describe('maskEjsCode / unmaskEjsCode — surgical dịch prose (Đợt 1b)', () => {
  const src = 'note: "该操作在" <% if (isPrep) { %> 阶段 <%- j({"op":"replace","path":"/A/战斗"}) %> 结束';

  it('mask che MỌI code + macro, chỉ để prose; unmask khôi phục nguyên vẹn (chưa dịch)', () => {
    const { masked, codes } = maskEjsCode(src);
    expect(codes.length).toBe(2);                           // 2 khối <%…%>
    expect(masked).not.toContain('<%');                     // code đã bị che
    expect(masked).toContain('{{__ejs_0__}}');
    const { text, restored } = unmaskEjsCode(masked, codes);
    expect(restored).toBe(codes.length);
    expect(text).toBe(src);                                 // round-trip
  });

  it('mô phỏng AI dịch prose (giữ nguyên token) → unmask ra bản KHÔNG lẫn Hán trong prose, code y nguyên', () => {
    const { masked, codes } = maskEjsCode(src);
    // AI dịch: thay CJK ở PROSE, GIỮ token {{__ejs_N__}}
    const aiOut = masked.replace(/该操作在/g, 'Thao tác này ở').replace(/结束/g, 'kết thúc');
    const { text, restored } = unmaskEjsCode(aiOut, codes);
    expect(restored).toBe(codes.length);
    // code CJK bên trong vẫn còn (do covariance/dict lo sau), prose đã Việt hoá
    expect(text).toContain('Thao tác này ở');
    expect(text).toContain('kết thúc');
    expect(text).toContain('<%- j({"op":"replace","path":"/A/战斗"}) %>'); // code nguyên vẹn
  });

  it('AI làm RƠI token → restored < codes.length (caller sẽ fallback giữ gốc)', () => {
    const { masked, codes } = maskEjsCode(src);
    const broken = masked.replace('{{__ejs_1__}}', ''); // rơi 1 token
    const { restored } = unmaskEjsCode(broken, codes);
    expect(restored).toBeLessThan(codes.length);
  });

  it('text đã chứa "__ejs_" → KHÔNG mask (tránh nhầm)', () => {
    const t = 'giá trị __ejs_x lạ <% code %>';
    expect(maskEjsCode(t).codes.length).toBe(0);
  });
});
