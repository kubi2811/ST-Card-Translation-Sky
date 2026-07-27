/**
 * (bugNeedFix/128) "Dịch xong ghép lại thì bị lỗi và vòng lặp không thoát ra được" — user gặp
 * NHIỀU LẦN trên nhiều card. Bằng chứng: card 逐梦演艺圈 XP3.7, log lặp
 *     ⚠️ Script vỡ cú pháp sau dịch (tavernHelper[3].content (世界书快捷配置), dòng ~2: Unexpected token (2:12))
 *     ⚠️ Script vỡ cú pháp sau dịch (tavernHelper[1].content ([变量结构]), dòng ~85 … rồi lần sau dòng ~81
 *     ⚠️ Script vỡ cú pháp sau dịch (lorebook[49].content [initvar], dòng ~1: Unexpected token (1:7))
 * và ảnh kết quả: entry đánh dấu XONG/SURGICAL/100% nhưng "còn 1529 chữ Hán" — tức giữ nguyên gốc.
 *
 * Soi commit cũ: bug 34 (đếm nháy dot-notation), 49 (regex/HTML), 95 (fingerprint retry),
 * 109 (object-key mất nháy) — CHƯA fix nào đụng đúng ba gốc bệnh này:
 *   1. ĐỊNH DANH JS TRẦN (`const 配置`) bị đem dịch → `const Cấu hình` = SyntaxError không thuốc
 *      chữa. Surgical tất định nên lần chạy nào cũng vỡ y chang → user gặp đi gặp lại.
 *   2. [initvar] là YAML nhưng YAML chữ Hán VÔ TÌNH parse được như JS (labeled statements) →
 *      lọt guard cú pháp, dịch xong nhãn có dấu cách là bị bắt "dịch lại" vô ích.
 *   3. Vân tay lỗi chứa SỐ DÒNG — văn xuôi dịch xê dịch làm lỗi trôi 85→81, vân tay đổi,
 *      guard tưởng lỗi mới → đốt đủ 3 lượt retry MỖI LẦN CHẠY. Đây là cái "vòng lặp".
 */
import { describe, it, expect } from 'vitest';
import { parse as acornParse } from 'acorn';
import {
  extractCJKTokens,
  reinsertTranslations,
  collectProtectedJsIdentifiers,
} from '../surgical';
import { hasRealJsSignal, jsErrorFingerprint, isLikelyJsScript, jsParseErrorAny } from '../scriptSafety';

/** Giả lập AI dịch: MỌI token được trả về đều thành tiếng Việt CÓ DẤU CÁCH (ca xấu nhất). */
function mockTranslateAll(text: string) {
  const tokens = extractCJKTokens(text);
  for (const t of tokens) t.translated = `Bản Dịch ${t.id}`;
  return { tokens, out: reinsertTranslations(text, tokens) };
}

const parseOk = (code: string) => {
  try { acornParse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }); return true; }
  catch { return false; }
};

// ═══ NGUYÊN HÌNH script trong ảnh bằng chứng (世界书快捷配置 — vỡ tại dòng 2 cột 12) ═══
const REAL_SHAPE = `(async () => {
  const 配置 = {
    世界书名前缀: '逐梦演艺圈',
    默认世界书名: '逐梦演艺圈XP3.7',
    状态按钮名: '🎨 当前状态',
    调试验证: false,
  };
  const 状态 = { 已加载: false };
  if (!配置.调试验证) {
    console.log(配置.世界书名前缀);
    状态.已加载 = true;
  }
  return 配置;
})();`;

describe('gốc bệnh 1 — định danh JS trần không được đem dịch', () => {
  it('thu thập đúng các định danh khai báo + gốc truy cập thuộc tính', () => {
    const ids = collectProtectedJsIdentifiers(REAL_SHAPE);
    expect(ids.has('配置')).toBe(true);
    expect(ids.has('状态')).toBe(true);
    // Object key KHÔNG phải định danh trần — vẫn phải dịch được (đã có đường bọc nháy).
    expect(ids.has('世界书名前缀')).toBe(false);
  });

  it('destructuring + tham số hàm + tên trộn Latin (AP上限) đều được thu thập', () => {
    const code = [
      'const { 配置, 状态: 别名 } = window.数据;',
      'function 处理(输入, 选项 = {}) { return 输入; }',
      'const 计算 = (数值) => 数值 + 1;',
      'let AP上限 = 8; AP上限 += 1;',
    ].join('\n');
    const ids = collectProtectedJsIdentifiers(code);
    for (const n of ['配置', '处理', '输入', '选项', '计算', '数值', 'AP上限']) {
      expect(ids.has(n), n).toBe(true);
    }
  });

  it('CHÍNH CA BẰNG CHỨNG: script hình dạng thật, dịch toàn bộ token xong vẫn PARSE ĐƯỢC', () => {
    expect(parseOk(REAL_SHAPE)).toBe(true);
    const { out } = mockTranslateAll(REAL_SHAPE);
    // Định danh giữ nguyên chữ Hán ⇒ không còn `const Bản Dịch N = {` vỡ cú pháp.
    expect(out).toContain('const 配置');
    expect(out).toContain('const 状态');
    expect(parseOk(out)).toBe(true);
  });

  it('object key và chuỗi VẪN được dịch (không bảo vệ oan)', () => {
    const { tokens } = mockTranslateAll(REAL_SHAPE);
    const texts = tokens.map(t => t.text);
    expect(texts).toContain('世界书名前缀');        // key → dịch + tự bọc nháy
    expect(texts.some(t => t.includes('逐梦演艺圈'))).toBe(true); // chuỗi → dịch
    expect(texts).not.toContain('配置');            // định danh → không đưa đi dịch
  });

  it('định danh xuất hiện TRONG CHUỖI thì vẫn dịch (đường stat_data của MVU không bị ảnh hưởng)', () => {
    const code = `const 配置 = 1;\nconst s = 'đường dẫn 配置 trong chuỗi';`;
    const tokens = extractCJKTokens(code);
    expect(tokens.some(t => t.text === '配置')).toBe(true);   // bản trong chuỗi
    // còn bản khai báo ở dòng 1 thì không có token nào trỏ vào vị trí đó
    expect(tokens.filter(t => t.text === '配置')).toHaveLength(1);
  });

  it('văn xuôi thuần không bị ảnh hưởng — tập bảo vệ rỗng, mọi câu vẫn dịch đủ', () => {
    const prose = '她是一名快递员，负责给学院送包裹。\n每天早上都会经过图书馆。';
    expect(collectProtectedJsIdentifiers(prose).size).toBe(0);
    const tokens = extractCJKTokens(prose);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══ Gốc bệnh 2 — [initvar] YAML vô tình parse được như JS ═══
const INITVAR_YAML = `叙事:
  标题: 待定
  引言: 待定

世界:
  当前时间: 待定
  当前地点: 待定
  夹带: {}
  列表: {}
  记录: {}
  状态: {}
  进度: {}`;

describe('gốc bệnh 2 — YAML không được soi cú pháp JS', () => {
  it('bằng chứng lỗ hổng cũ: YAML chữ Hán qua được CẢ isLikelyJsScript LẪN acorn', () => {
    // Đây là lý do guard cũ bắt nhầm: đủ 5 dòng "code" (kết thúc {}) + parse sạch.
    expect(isLikelyJsScript(INITVAR_YAML)).toBe(true);
    expect(jsParseErrorAny(INITVAR_YAML)).toBeNull();
    // Còn bản dịch (nhãn có dấu cách) thì vỡ ngay dòng 1 — đúng "Unexpected token (1:7)".
    const vi = INITVAR_YAML.replace('叙事', 'Tự sự').replace('标题', 'Tiêu đề');
    expect(jsParseErrorAny(vi)).not.toBeNull();
  });

  it('hasRealJsSignal chặn được: YAML không có bằng chứng JS chủ động', () => {
    expect(hasRealJsSignal(INITVAR_YAML)).toBe(false);
  });

  it('script thật thì vẫn qua cổng', () => {
    expect(hasRealJsSignal(REAL_SHAPE)).toBe(true);
    expect(hasRealJsSignal(`const x = 1;\nfunction f() { return x; }`)).toBe(true);
  });
});

// ═══ Gốc bệnh 3 — vân tay lỗi trôi số dòng ═══
describe('gốc bệnh 3 — vân tay lỗi không phụ thuộc số dòng/cột', () => {
  it('CHÍNH CA BẰNG CHỨNG: (85:11) và (81:17) là CÙNG một bệnh', () => {
    const a = jsErrorFingerprint({ line: 85, msg: 'Unexpected token (85:11)' });
    const b = jsErrorFingerprint({ line: 81, msg: 'Unexpected token (81:17)' });
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('hai LOẠI lỗi khác nhau thì vân tay vẫn khác', () => {
    const a = jsErrorFingerprint({ line: 5, msg: 'Unexpected token (5:1)' });
    const b = jsErrorFingerprint({ line: 5, msg: 'Unterminated string constant (5:1)' });
    expect(a).not.toBe(b);
  });

  it('null → chuỗi rỗng, không nổ', () => {
    expect(jsErrorFingerprint(null)).toBe('');
  });
});
