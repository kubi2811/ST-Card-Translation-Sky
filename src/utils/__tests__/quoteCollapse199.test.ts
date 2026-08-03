/**
 * (bug 199) "⚠️ Nghi AI BỊA CODE … dấu "(" BỚT 1015 (gốc 1018 → dịch 3)" LẶP VÔ HẠN
 * trên field tavernHelper[1].content (变量结构) của thẻ 黑色修士.
 * ─────────────────────────────────────────────────────────────────────────────
 * Mổ ra thì "BỚT 1015" là chẩn đoán RÁC, và có BA lỗ ghép lại thành vòng lặp:
 *
 *  1. CHỐT CÚ PHÁP JS BỊ TẮT OAN. Script viết thẳng `val === <user>` (61 chỗ) — với
 *     SillyTavern là hợp lệ (macro thay lúc chạy), với acorn là vỡ ngay. Điều kiện
 *     "bản gốc parse sạch" không thoả ⇒ chốt tắt ⇒ nháy vỡ do AI dịch không ai bắt.
 *  2. CỔNG ĐẾM NGOẶC MÙ MÀ KHÔNG BIẾT MÌNH MÙ. Một dấu nháy vỡ ở đầu file làm stripper
 *     coi cả phần còn lại là ruột chuỗi ⇒ "gốc 1018 → dịch 3". Đo trên văn bản THÔ thì
 *     hai bản cân nhau — bằng chứng thứ hỏng là ranh giới chuỗi, không phải ngoặc.
 *  3. VÂN TAY CHỨA SỐ ĐO DAO ĐỘNG. Mỗi lượt AI vỡ kiểu hơi khác ("BỚT 1015" rồi "BỚT
 *     1013"…) ⇒ chốt "trùng lý do thì dừng" (bug 198) không bao giờ khớp ⇒ lặp.
 *
 * Số đo gốc (từ chính field thật, bài dưới có bản gated): thô 1022 dấu "(", sau lột
 * chuỗi 1018 — đúng con số 1018 trong log user.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { verifyCodeStructureParity, stripCommentsAndStringContent } from '../surgical';
import { neutralizeStMacros, jsParseErrorAny, jsErrorFingerprint } from '../scriptSafety';
import { decideSoftGate } from '../softGate';

// Field thật bóc từ PNG thẻ (bug/199/v1.0.5_1.png → data.extensions.tavern_helper.scripts[1]).
// bug/ chỉ nằm trên máy local — thiếu file thì cả describe tự bỏ qua.
const FILE = 'G:/ClaudePJ/TOOL_CARD_GUILLICHAN/d-ch-card-sillytarven/bug/199/th1_bien-cau-truc.js';
const cnt = (s: string, ch: string) => s.split(ch).length - 1;

/* ── lỗ 1: chốt cú pháp phải sống lại với script có macro ─────────────────── */

describe('(bug 199) neutralizeStMacros — macro SillyTavern không được làm tắt chốt cú pháp', () => {
  it('`val === <user>` trở thành JS parse được, và số dòng giữ nguyên', () => {
    const code = 'const f = (val) => (val === <user> || val === undefined ? 100 : Number(val));';
    const n = neutralizeStMacros(code);
    // (bug 203) Dạng thay thế đổi từ `__user__` sang `$user$` để GIỮ NGUYÊN ĐỘ DÀI: bộ vá khoá
    // object cắt chuỗi theo VỊ TRÍ acorn trả về, lệch một ký tự là vá nhầm chỗ.
    expect(n).toContain('$user$');
    expect(n.length).toBe(code.length);
    expect(jsParseErrorAny(code)).toBeNull();
    expect(neutralizeStMacros('a\n<user>\nb').split('\n').length).toBe(3);
  });

  it('so sánh thật `a<user>b` (biến tên user) KHÔNG bị đụng vào', () => {
    const code = 'const x = a<user>b;';
    expect(neutralizeStMacros(code)).toBe(code);
  });

  it('nháy vỡ trong bản dịch giờ bị acorn chỉ ĐÚNG bệnh, đúng dòng', () => {
    const orig = "import x from 'y';\nexport const a = z.prefault('未命名');\nconst b = (<user>);";
    expect(jsParseErrorAny(orig), 'bản gốc có macro phải được coi là sạch').toBeNull();
    const broken = orig.replace("prefault('未命名')", "prefault('Chưa đặt tên);");
    const err = jsParseErrorAny(broken);
    expect(err?.msg).toMatch(/Unterminated string/);
    expect(err?.line).toBe(2);
  });
});

/* ── lỗ 2: cổng đếm ngoặc phải biết khi nào nó mù ─────────────────────────── */

/** Dựng code tổng hợp cùng hình dạng ca thật: nhiều chuỗi + nhiều ngoặc trong code. */
const synth = (n = 60) =>
  Array.from({ length: n }, (_, i) => `const v${i} = f(g('nhãn ${i}'), (x) => (x + ${i}));`).join('\n');

describe('(bug 199) verifyCodeStructureParity — chẩn đoán vỡ nháy thay vì "BỚT cả nghìn ngoặc"', () => {
  it('một dấu nháy vỡ → quoteCollapse=true, reason nói về CHUỖI chứ không phải ngoặc', () => {
    const orig = synth();
    // AI "dịch" làm rơi dấu nháy đóng của chuỗi đầu tiên — đúng kiểu lỗi thật.
    const broken = orig.replace("'nhãn 0'", "'nhan 0");
    const p = verifyCodeStructureParity(orig, broken);
    expect(p.ok).toBe(false);
    expect(p.quoteCollapse).toBe(true);
    expect(p.reason).toMatch(/VỠ DẤU NHÁY|chuỗi/);
    expect(p.reason).not.toMatch(/BỚT \d+ \(gốc/);
  });

  it('AI bịa THẬT một khối hàm → vẫn báo THÊM như cũ, không bị nhầm thành vỡ nháy', () => {
    const orig = synth(20);
    const inject = orig + '\nfunction safeString(a) { return (((a || "") + "")).trim(); }';
    const p = verifyCodeStructureParity(orig, inject);
    expect(p.ok).toBe(false);
    expect(p.quoteCollapse).toBeUndefined();
    expect(p.reason).toMatch(/THÊM/);
  });

  it('AI xoá THẬT nửa file → ngoặc thô cũng lệch to nên vẫn là BỚT, không phải vỡ nháy', () => {
    const orig = synth(60);
    const half = orig.split('\n').slice(0, 20).join('\n');
    const p = verifyCodeStructureParity(orig, half);
    expect(p.ok).toBe(false);
    expect(p.quoteCollapse).toBeUndefined();
    expect(p.reason).toMatch(/BỚT/);
  });

  it('bản dịch trung thực → vẫn sạch như trước, không có báo động mới', () => {
    const orig = synth(30);
    const vi = orig.replace(/nhãn/g, 'nhan de'); // chỉ đổi ruột chuỗi
    expect(verifyCodeStructureParity(orig, vi)).toEqual({ ok: true, maxDiff: 0 });
  });
});

/* ── lỗ 3: vân tay bỏ số thì "cùng bệnh" mới thật sự dừng được ────────────── */

describe('(bug 199) vân tay cổng halluc — số đo dao động không được phá chốt dừng', () => {
  const strip = (s: string) => s.replace(/\d+/g, '#');

  it('hai thông điệp cùng bệnh khác số → cùng MỘT vân tay', () => {
    const a = 'dấu "(" BỚT 1015 (gốc 1018 → dịch 3)';
    const b = 'dấu "(" BỚT 1013 (gốc 1018 → dịch 5)';
    expect(strip(a)).toBe(strip(b));
  });

  it('lượt 2 cùng bệnh → stop-same-reason, hết đường lặp', () => {
    const key1 = 'halluc:' + strip('dấu "(" BỚT 1015 (gốc 1018 → dịch 3)');
    const key2 = 'halluc:' + strip('dấu "(" BỚT 1013 (gốc 1018 → dịch 5)');
    expect(decideSoftGate({ reasonKey: key1, previousReasonKey: undefined, retries: 0, maxRetries: 3 })).toBe('retry');
    expect(decideSoftGate({ reasonKey: key2, previousReasonKey: key1, retries: 1, maxRetries: 3 })).toBe('stop-same-reason');
  });

  it('vân tay lỗi JS cũng đã bỏ số từ trước (bugNeedFix/128) — hai tầng khớp nhau', () => {
    expect(jsErrorFingerprint({ line: 10, msg: 'Unterminated string constant (10:32)' }))
      .toBe(jsErrorFingerprint({ line: 85, msg: 'Unterminated string constant (85:7)' }));
  });
});

/* ── field THẬT của user (gated — thẻ nằm trong bug/, không đẩy git) ──────── */

describe.skipIf(!existsSync(FILE))('(bug 199) field thật 变量结构 (32.898 ký tự)', () => {
  it('khớp số đo trong log user: thô 1022, sau lột chuỗi đúng 1018', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src.length).toBe(32898);
    expect(cnt(src, '(')).toBe(1022);
    expect(cnt(stripCommentsAndStringContent(src), '(')).toBe(1018);
  });

  it('bản gốc 61 macro <user> giờ parse SẠCH → chốt cú pháp JS được bật lại', () => {
    const src = readFileSync(FILE, 'utf8');
    expect((src.match(/<user>/g) || []).length).toBe(61);
    expect(jsParseErrorAny(src)).toBeNull();
  });

  it('nháy vỡ ở dòng 10 → acorn bắt ngay tầng trên, không rơi xuống cổng đếm ngoặc nữa', () => {
    const src = readFileSync(FILE, 'utf8');
    const broken = src.replace("prefault('未命名修士')", "prefault('Tu sĩ chưa đặt tên)");
    const err = jsParseErrorAny(broken);
    expect(err?.msg).toMatch(/Unterminated string/);
    expect(err?.line).toBe(10);
  });

  it('và nếu vẫn tới cổng đếm ngoặc (field không phải JS) thì chẩn đoán là VỠ NHÁY, hết "BỚT 1015"', () => {
    const src = readFileSync(FILE, 'utf8');
    const broken = src.replace("prefault('未命名修士')", "prefault('Tu sĩ chưa đặt tên)");
    const p = verifyCodeStructureParity(src, broken);
    expect(p.ok).toBe(false);
    expect(p.quoteCollapse).toBe(true);
    expect(p.reason).toMatch(/VỠ DẤU NHÁY/);
  });

  it('đường phẫu thuật trên field này vẫn sạch (chốt hồi quy bug 197)', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(verifyCodeStructureParity(src, src).ok).toBe(true);
  });
});
