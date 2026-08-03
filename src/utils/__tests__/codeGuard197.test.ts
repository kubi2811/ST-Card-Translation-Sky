/**
 * (bug 197) SAU KHI CẬP NHẬT, DỊCH CARD KẸT VÒNG LẶP "Nghi AI BỊA CODE" — TOÀN BÁO OAN.
 * ─────────────────────────────────────────────────────────────────────────────
 * Log user gửi (thẻ 黑色修士 v1.0.5, field tavernHelper[1].content = 变量结构, 32.898 ký tự):
 *
 *   ⚠ Nghi AI BỊA CODE (tavernHelper[1].content (变量结构)):
 *     thêm khai báo lạ [L, Th, Linh…] + dấu "[" THÊM 119 (gốc 108 → dịch 227)
 *     → dịch lại (chỉ dịch chữ, không thêm code)…
 *   ~ Mục lớn "…" (32.898 ký tự) → chia ~3 phần, dịch SONG SONG
 *   i Tiếp tục …: đã có 4 phần (chunk) trong bộ nhớ
 *   … lặp lại y hệt
 *
 * Đo lại trên ĐÚNG field đó (bug/197/card_ccv3.json, xem codeGuard197Live.test.ts):
 *   629 token, trong đó 89 token dot-notation → 89 lần đổi `obj.键` sang `obj['Tên Việt']`
 *   `[` gốc 108 → dịch 197 = THÊM ĐÚNG 89. Mỗi lần đổi thêm cân bằng một `[` và một `]`.
 *
 * BA LỖI RIÊNG BIỆT, đều là báo oan hoặc hỏng thật:
 *
 * 1. `verifyCodeStructureParity` CÓ tham số `expectedBracketPairs` (làm ở bug 154) nhưng LUỒNG
 *    CHÍNH của Dịch Card gọi nó KHÔNG truyền gì cả — chỉ Dịch Script mới truyền. Nên mỗi lần từ
 *    điển/phẫu thuật hoạt động là guard kêu "thêm ngoặc" rồi ép dịch lại. Càng nhiều biến thì
 *    càng chắc chắn dính; thẻ này 89 khoá nên không đời nào thoát.
 *
 * 2. `detectInventedDeclarations` dò khai báo bằng mẫu ASCII `[A-Za-z_$][A-Za-z0-9_$]*`. Tên biến
 *    sau khi dịch là tiếng Việt CÓ DẤU, nên nó cắt ở ký tự có dấu đầu tiên và báo mảnh ASCII cụt
 *    ("C" từ "Cảnh Giới", "L"/"Th"/"Linh" như log user) là "khai báo lạ AI bịa ra".
 *
 * 3. Định danh KHAI BÁO trộn CJK+ASCII (`境界delta境界`) không được lớp bảo vệ nhận ra: biên
 *    mở rộng chỉ chạy trên `[\w$]` nên dừng ngay ở ranh giới Hán, so ra `境界delta` ≠ tên thật.
 *    Hậu quả THẬT (không phải báo oan): nó bị dịch thành `const Cảnh Giới delta Cảnh Giới` —
 *    tên biến có DẤU CÁCH, tức SyntaxError, cả script chết.
 */
import { describe, it, expect } from 'vitest';
import {
  verifyCodeStructureParity,
  detectInventedDeclarations,
  countBracketKeyRewrites,
  collectProtectedJsIdentifiers,
  extractCJKTokens,
  reinsertTranslations,
} from '../surgical';

describe('(bug 197-1) đổi khoá sang bracket KHÔNG phải là bịa code', () => {
  it('tự nhận ra phần ngoặc thêm hợp lệ, không cần ai truyền tay', () => {
    const orig = `const a = t.修为; const b = t.境界; const c = t.灵石;`;
    const trans = `const a = t['Tu Vi']; const b = t['Cảnh Giới']; const c = t['Linh Thạch'];`;
    expect(countBracketKeyRewrites(orig, trans), '3 khoá đổi sang bracket').toBe(3);
    expect(verifyCodeStructureParity(orig, trans).ok, 'đây là bản dịch ĐÚNG, không được coi là bịa').toBe(true);
  });

  it('vẫn bắt được ca AI thêm hẳn một hàm mới', () => {
    const orig = `const a = t.修为;`;
    const trans = `const a = t['Tu Vi'];\nconst safeString = (v) => { return String(v ?? ''); };`;
    const p = verifyCodeStructureParity(orig, trans);
    expect(p.ok, 'thêm hàm = thêm ngoặc () và {} — bracket-allowance không che được').toBe(false);
  });

  it('bớt code vẫn bị bắt (không tha chiều ngược lại)', () => {
    const orig = `function f(){ if (x) { g(); } }`;
    expect(verifyCodeStructureParity(orig, `function f(){ }`).ok).toBe(false);
  });

  it('tham số expectedBracketPairs truyền tay vẫn hoạt động như cũ (Dịch Script)', () => {
    const orig = `t.修为`;
    const trans = `t['Tu Vi']`;
    expect(verifyCodeStructureParity(orig, trans, 0, 1).ok).toBe(true);
  });
});

describe('(bug 197-2) tên biến tiếng Việt có dấu không phải "khai báo lạ"', () => {
  it('ca thật: "Cảnh Giới" không được cắt thành "C"', () => {
    const orig = `const 境界 = 1;`;
    const trans = `const Cảnh_Giới = 1;`;
    expect(detectInventedDeclarations(orig, trans), 'đổi tên ≠ thêm khai báo').toEqual([]);
  });

  it('đúng mảnh mà log user báo: L, Th, Linh', () => {
    const orig = `let 灵石 = 0; let 天赋 = 0; let 灵力 = 0;`;
    const trans = `let Linh_Thạch = 0; let Thiên_Phú = 0; let Linh_Lực = 0;`;
    expect(detectInventedDeclarations(orig, trans)).toEqual([]);
  });

  it('AI thêm hàm THẬT thì vẫn phải bị bắt đích danh', () => {
    const orig = `const 修为 = 1;`;
    const trans = `const Tu_Vi = 1;\nconst safeString = (v) => String(v);`;
    expect(detectInventedDeclarations(orig, trans)).toContain('safeString');
  });

  it('số khai báo không đổi thì tuyệt đối không báo, dù tên khác hẳn', () => {
    expect(detectInventedDeclarations(`var 甲 = 1; var 乙 = 2;`, `var Giáp = 1; var Ất = 2;`)).toEqual([]);
  });

  it('thêm 2 hàm thì báo cả 2', () => {
    const inv = detectInventedDeclarations(`const a = 1;`, `const a = 1;\nfunction h1(){}\nfunction h2(){}`);
    expect(inv.sort()).toEqual(['h1', 'h2']);
  });
});

describe('(bug 197-3) định danh khai báo TRỘN CJK+ASCII phải được bảo vệ', () => {
  it('collectProtectedJsIdentifiers nhận đúng tên trộn', () => {
    expect(collectProtectedJsIdentifiers(`const 境界delta境界 = x => x;`).has('境界delta境界')).toBe(true);
  });

  it('ca thật: KHÔNG được dịch tên khai báo trộn → không đẻ ra dấu cách trong tên biến', () => {
    const src = `const 境界delta境界 = 段 => 段.length === 3;`;
    const tokens = extractCJKTokens(src);
    for (const t of tokens) t.translated = 'Cảnh Giới';
    const out = reinsertTranslations(src, tokens);
    const declName = /const\s+([^=]+?)\s*=/.exec(out)?.[1] ?? '';
    expect(declName, 'tên biến có dấu cách là SyntaxError, cả script chết').not.toMatch(/\s/);
    expect(declName, 'tên khai báo phải giữ nguyên, không có cách nào bọc nháy cho nó').toBe('境界delta境界');
    expect(() => new Function(out), `vỡ cú pháp: ${out}`).not.toThrow();
  });

  it('thuộc tính trộn sau dấu chấm thì VẪN đổi được (không bảo vệ quá tay — bug 171)', () => {
    const src = `const s = f.与user关系;`;
    const tokens = extractCJKTokens(src);
    for (const t of tokens) t.translated = 'Với User Quan Hệ';
    const out = reinsertTranslations(src, tokens);
    expect(out).toContain("f['Với User Quan Hệ']");
    expect(() => new Function(out)).not.toThrow();
  });
});
