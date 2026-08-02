/**
 * (bug 187 — Hạng mục E) Test hồi quy trên FIXTURE THẬT của bugNeedFix/187.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ba fixture, ba vai:
 *   • World Engine.js / .vi.js — CA DƯƠNG TÍNH (known-good): bản dịch tay chuẩn, verifier
 *     tuyệt đối không được báo đỏ (bảng đối chiếu mục 1.3 của đề bài: 0 lệch mọi phép kiểm,
 *     5 regex alternation hợp lệ, 36 ký tự CJK đều nằm trong alternation).
 *   • index_addon_cn.js / index_addon.js — CA ÂM TÍNH: bản dịch cũ sót 2.901 ký tự Hán toàn
 *     khoá dot-notation (o.value?.世界经济简报 …) — verifier PHẢI điểm mặt nhóm "khoá dữ liệu".
 *   • Bộ ba World Engine + mvu_dictionary.json — kiểm coverage Từ Điển (Hạng mục B).
 *
 * bugNeedFix/ nằm trong .gitignore (bằng chứng chỉ có trên một máy) → skipIf khi thiếu file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractTokensAst, checkDictCoverage } from '../astExtract';
import { verifyTranslationAst } from '../astVerifier';
import { reinsertTranslations } from '../../utils/surgical';
import { isTranslatableToken } from '../tokenBatcher';

const DIR = resolve(__dirname, '../../../bugNeedFix/187');
const F = {
  weOrg: resolve(DIR, 'World Engine.js'),
  weVi: resolve(DIR, 'World Engine.vi.js'),
  iaOrg: resolve(DIR, 'index_addon_cn.js'),
  iaVi: resolve(DIR, 'index_addon.js'),
  dict: resolve(DIR, 'mvu_dictionary.json'),
};
const has = Object.values(F).every((p) => existsSync(p));
const read = (p: string) => readFileSync(p, 'utf-8');

describe.skipIf(!has)('(bug 187) fixture thật', () => {
  it('CA DƯƠNG TÍNH — World Engine: verifier phải sạch, đúng bảng đối chiếu mục 1.3', { timeout: 120_000 }, () => {
    const org = read(F.weOrg);
    const vi = read(F.weVi);
    const dict = JSON.parse(read(F.dict)) as Record<string, string>;
    const r = verifyTranslationAst(org, vi, dict);

    expect(r.mode).toBe('ast');
    expect(r.hardFail, r.hardFailReasons.join(' | ')).toBe(false);
    expect(r.nodeCountDiffs).toEqual([]);
    expect(r.structuralDiffs).toEqual([]);
    expect(r.identDiffs).toEqual([]);
    expect(r.literalDiffs).toEqual([]);
    expect(r.regexDiffs).toEqual([]);
    expect(r.regexUpgrades).toBe(5);
    expect(r.delimiterDiffs).toEqual([]);
    // 36 ký tự CJK còn lại đều nằm trong alternation (?:trung|việt) — không nhóm nào báo đỏ.
    expect(r.cjkGroups.dataKey).toEqual([]);
    expect(r.cjkGroups.prose).toEqual([]);
    expect(r.cjkGroups.regexNoAlt).toEqual([]);
    expect(r.cjkGroups.alternationChars).toBe(36);
  });

  it('CA ÂM TÍNH — index_addon: khoá dot-notation sót Hán phải bị điểm mặt ĐÚNG NHÓM', { timeout: 300_000 }, () => {
    const org = read(F.iaOrg);
    const vi = read(F.iaVi);
    const r = verifyTranslationAst(org, vi);

    // Nhóm "khoá dữ liệu còn tiếng Trung" phải dày đặc — đây chính là ca 1.1 của đề bài
    // (2.901 ký tự Hán, gần hết là khoá kiểu o.value?.世界经济简报).
    expect(r.cjkGroups.dataKey.length).toBeGreaterThan(50);
    const names = r.cjkGroups.dataKey.map((d) => d.text).join('|');
    expect(names).toContain('世界经济简报');
  });

  it('BỘ BA — coverage Từ Điển (Hạng mục B): World Engine 0 khoá, index_addon 245 khoá', { timeout: 300_000 }, () => {
    // Baseline đo thật (bất ngờ nhưng đúng): World Engine KHÔNG có khoá dữ liệu CJK nào —
    // nó truy cập dữ liệu toàn qua chuỗi văn xuôi/template. Nghĩa là lỗi của ca 1.2 ("có
    // Từ Điển vẫn hỏng") KHÔNG THỂ nằm ở đồng bộ khoá — bằng chứng thu hẹp hướng điều tra.
    const dict = JSON.parse(read(F.dict)) as Record<string, string>;
    const we = extractTokensAst(read(F.weOrg), dict)!;
    expect(we.dataKeys).toEqual([]);

    // index_addon_cn mới là hình mẫu ca 1.1: 245 khoá dot-notation/object-key. Chưa có
    // Từ Điển → coverage phải liệt kê đủ, ĐÍCH DANH — đây là cái gate Hạng mục B dựa vào.
    const ia = extractTokensAst(read(F.iaOrg))!;
    const cov = checkDictCoverage(ia.dataKeys, []);
    expect(cov.total).toBe(245);
    expect(cov.missing.length).toBe(245);
    expect(cov.missing.map((m) => m.name)).toContain('降临');
  });

  it('E2E TẤT ĐỊNH — extract AST → dịch giả lập → reinsert → verifier sạch', { timeout: 120_000 }, () => {
    const org = read(F.weOrg);
    const dict = JSON.parse(read(F.dict)) as Record<string, string>;
    const ex = extractTokensAst(org, dict)!;
    // Dịch giả lập không cần AI: khoá ăn theo dict (extractor tự gắn), văn xuôi thay bằng
    // chuỗi Việt cố định — đủ để chứng minh đường reinsert + verifier không phá cấu trúc.
    let n = 0;
    for (const t of ex.tokens) {
      if (!t.translated && isTranslatableToken(t)) t.translated = `Đoạn dịch ${++n}`;
    }
    const out = reinsertTranslations(org, ex.tokens);
    const r = verifyTranslationAst(org, out, dict);
    expect(r.hardFail, r.hardFailReasons.join(' | ')).toBe(false);
    expect(r.identDiffs).toEqual([]);
    expect(r.literalDiffs).toEqual([]);
    expect(r.renamesOffDict).toBe(0);
    // Khoá đã đổi theo dict thì nhóm dataKey của bản ra phải rỗng.
    expect(r.cjkGroups.dataKey).toEqual([]);
  });
});
