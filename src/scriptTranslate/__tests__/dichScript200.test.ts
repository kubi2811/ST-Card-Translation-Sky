/**
 * (bug 200) ĐẠI TU DỊCH SCRIPT v4 — 4 lỗi định vị trên fixture Status Bar 1.7.5 + Hạng mục G/H/I.
 * ─────────────────────────────────────────────────────────────────────────────
 * Spec v4 của user định vị 4 lỗi đến từng hàm; đối chiếu code thật thì khớp cả 4:
 *   1.1  reinsert chỉ bọc nháy khoá khi bản dịch "có dấu cách/dấu tiếng Việt" — tức dựa vào
 *        may rủi cú pháp. `{'Một':1, Hai:2, Ba:3}` và `Anna:{…}` trên fixture là bằng chứng;
 *        verifier lại gộp Identifier→Identifier với Identifier→Literal nên bug lọt cổng QA.
 *   1.2  `looksLikeDataPath` đòi MỌI đoạn có CJK ⇒ `stat_data.世界运转.当前日期` trượt ngay
 *        đoạn đầu; nhánh cứu tái dùng PATH_SEG_RE (một đoạn) cho cả chuỗi ⇒ chết với mọi path
 *        nhiều đoạn. Đo fixture: 7/14 đường dẫn _.get/_.set còn nguyên Hán byte-for-byte.
 *   1.3  `skippedInClass` được tính đúng rồi bị vứt — applyRegexAlternation không đọc.
 *   1.4  Cặp cơ chế 1-ký-tự-CJK phải TRUY NGUỒN: class trùng khoá Từ Điển (hàm phân loại quân
 *        chủng soi trường ĐÃ dịch) = rủi ro cao; bảng số ngày tháng thì giữ nguyên là đúng.
 *        Không có quy tắc chung — chỉ báo, người review quyết.
 *   G    1108 dấu 。 sót trên fixture — chuẩn hoá theo TỪNG VỊ TRÍ, delimiter chức năng bất khả xâm.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import { extractTokensAst, looksLikeDataPath } from '../astExtract';
import { verifyTranslationAst } from '../astVerifier';
import { applyRegexAlternation, alternateRegexBody, analyzeSkippedInClass } from '../regexAlternation';
import { normalizeCjkPunctuation } from '../punctNormalize';
import { reinsertTranslations } from '../../utils/surgical';

const DIR = 'G:/ClaudePJ/TOOL_CARD_GUILLICHAN/d-ch-card-sillytarven/bug/200';
const SB_CN = `${DIR}/Status Bar 1.7.5.js`;
const SB_VI = `${DIR}/Status Bar 1.7.5.vi.js`;
const WE_CN = `${DIR}/World Engine.js`;
const WE_VI = `${DIR}/World Engine.vi.afterpromptv2.js`;
const haveFixtures = [SB_CN, SB_VI, WE_CN, WE_VI].every((f) => existsSync(f));

const parses = (code: string): boolean => {
  for (const sourceType of ['module', 'script'] as const) {
    try { acorn.parse(code, { ecmaVersion: 'latest', sourceType }); return true; } catch { /* thử tiếp */ }
  }
  return false;
};

/** Dịch một đoạn code qua đúng đường thật: extract (AST, dict-only) → reinsert. */
const translateKeys = (code: string, dict: Record<string, string>): string => {
  const ex = extractTokensAst(code, dict);
  expect(ex, 'code test phải parse được').not.toBeNull();
  return reinsertTranslations(code, ex!.tokens);
};

/* ── Mục 1.1 — Hạng mục H: bọc nháy VÔ ĐIỀU KIỆN ─────────────────────────── */

describe('(bug 200 — 1.1) khoá đã dịch LUÔN là chuỗi có nháy, không dựa vào may rủi cú pháp', () => {
  it('fixture hồi quy của spec: {二:1} phải ra {"Hai":1}, không được ra {Hai:1}', () => {
    const out = translateKeys('const t = { 一: 1, 二: 2, 三: 3 };', { 一: 'Một', 二: 'Hai', 三: 'Ba' });
    expect(out).toContain("'Một': 1");
    expect(out).toContain("'Hai': 2");   // trước fix: Hai: 2 — trần, vì "Hai" không dấu
    expect(out).toContain("'Ba': 3");
    expect(parses(out)).toBe(true);
  });

  it('tên riêng phiên âm không dấu (安娜→Anna) — đúng ca avatar table của fixture', () => {
    const out = translateKeys('const m = { 安娜: { u: 1 } };', { 安娜: 'Anna' });
    expect(out).toContain("'Anna':");
    expect(out).not.toMatch(/[^']Anna:/);
  });

  it('bản dịch có gạch nối: {键:1} → {"Anna-Maria":1} — không bọc là PHÉP TRỪ, hỏng âm thầm', () => {
    const out = translateKeys('const m = { 安娜: 1 };', { 安娜: 'Anna-Maria' });
    expect(out).toContain("'Anna-Maria': 1");
    expect(parses(out)).toBe(true);
  });

  it('dot-notation cũng vô điều kiện: obj.安娜 → obj["Anna"] (obj.Anna-Maria là obj.Anna trừ Maria)', () => {
    const out = translateKeys('const x = obj.安娜;', { 安娜: 'Anna' });
    expect(out).toContain("obj['Anna']");
  });
});

describe('(bug 200 — 1.1) verifier: Identifier→Identifier ở thế khoá là CHẶN CỨNG, không phải rename thường', () => {
  it('khoá dịch không bọc nháy → unsafeKeyRenames + hardFail', () => {
    const r = verifyTranslationAst('const t = { 安娜: 1 };', 'const t = { Anna: 1 };', { 安娜: 'Anna' });
    expect(r.unsafeKeyRenames).toHaveLength(1);
    expect(r.unsafeKeyRenames[0]).toMatchObject({ before: '安娜', after: 'Anna' });
    expect(r.hardFail).toBe(true);
    expect(r.hardFailReasons.join(' ')).toMatch(/bọc nháy/);
  });

  it('cùng phép đổi nhưng bọc nháy đúng (Identifier→Literal) → an toàn, không hardFail', () => {
    const r = verifyTranslationAst('const t = { 安娜: 1 };', "const t = { 'Anna': 1 };", { 安娜: 'Anna' });
    expect(r.unsafeKeyRenames).toHaveLength(0);
    expect(r.hardFail).toBe(false);
    expect(r.keyRenames.some((k) => k.from === '安娜' && k.to === 'Anna' && k.inDict)).toBe(true);
  });
});

/* ── Mục 1.2 — lodash path có gốc ASCII ──────────────────────────────────── */

describe('(bug 200 — 1.2) đường dẫn dữ liệu gốc ASCII không còn vô hình', () => {
  it('looksLikeDataPath nhận stat_data.世界运转.当前日期 — chỉ cần MỘT đoạn có CJK', () => {
    expect(looksLikeDataPath('stat_data.世界运转.当前日期')).toBe(true);
    expect(looksLikeDataPath('世界运转.天气')).toBe(true);
  });

  it('nhưng không nuốt bừa: toàn ASCII / văn xuôi đánh số / có khoảng trắng vẫn bị loại', () => {
    expect(looksLikeDataPath('Hello.World')).toBe(false);       // không có CJK — không có gì để dịch
    expect(looksLikeDataPath('3.5 mét')).toBe(false);
    expect(looksLikeDataPath('他说. 中文')).toBe(false);         // đoạn có khoảng trắng
  });

  it('fixture hồi quy của spec: _.get(e, "stat_data.世界运转.当前日期") dịch đủ, giữ nguyên gốc ASCII', () => {
    const dict = { 世界运转: 'Thế Giới Vận Hành', 当前日期: 'Ngày Hiện Tại' };
    const out = translateKeys('const d = _.get(e, "stat_data.世界运转.当前日期", "");', dict);
    expect(out).toContain('"stat_data.Thế Giới Vận Hành.Ngày Hiện Tại"');
  });

  it('đường dẫn 1 đoạn trong data-call vẫn chạy như cũ (ca 人际网络 vốn không hỏng)', () => {
    const out = translateKeys('const d = _.get(e, "人际网络", {});', { 人际网络: 'Mạng Quan Hệ' });
    expect(out).toContain('"Mạng Quan Hệ"');
  });

  it('getvar (khoá ở arg 0) đi cùng đường: getvar("stat_data.主角.声望")', () => {
    const out = translateKeys('const v = getvar("stat_data.主角.声望");', { 主角: 'Nhân Vật Chính', 声望: 'Danh Vọng' });
    expect(out).toContain('"stat_data.Nhân Vật Chính.Danh Vọng"');
  });
});

/* ── Mục 1.3 + 1.4 — skippedInClass phải TỚI ĐƯỢC report, kèm truy nguồn ─── */

describe('(bug 200 — 1.3) cụm CJK trong character class không còn bị vứt trên đường về', () => {
  it('alternateRegexBody vẫn né class (đúng) và ghi lại đúng cụm', () => {
    const r = alternateRegexBody('[家丁亲兵内丁]', { 家丁: 'gia đinh' });
    expect(r.changed).toBe(false);
    expect(r.skippedInClass).toEqual(['家丁亲兵内丁']);
  });

  it('applyRegexAlternation gom skippedInClassTerms từ mọi literal — trước đây tính xong rồi vứt', () => {
    const code = 'const a = /[家丁亲兵内丁]/; const b = /[骑马骡驼]/; const c = /秋青子/;';
    const r = applyRegexAlternation(code, { 秋青子: 'Thu Thanh Tử', 家丁: 'gia đinh' });
    expect(r.skippedInClassTerms.sort()).toEqual(['家丁亲兵内丁', '骑马骡驼'].sort());
    expect(r.changed).toBe(1); // 秋青子 vẫn được thêm nhánh như cũ — không phá alternation hiện có
  });

  it('(1.4) truy nguồn: trùng Từ Điển = rủi ro cao (Ca A); bảng số không trùng = giữ nguyên hợp lý (Ca B)', () => {
    const dict = { 家丁: 'gia đinh', 骑马: 'kỵ mã', 世界运转: 'Thế Giới Vận Hành' };
    const res = analyzeSkippedInClass(['家丁亲兵内丁', '一二三四五六七八九十百千万'], dict);
    expect(res[0].risky).toBe(true);
    expect(res[0].dictMatches).toContain('家丁');
    expect(res[1].risky).toBe(false); // số Hán — không trùng khoá nào, đúng ca "giữ nguyên là an toàn"
  });
});

/* ── Hạng mục G — chuẩn hoá dấu câu theo TỪNG VỊ TRÍ ─────────────────────── */

describe('(bug 200 — G) dấu câu CJK cosmetic: văn xuôi đổi, vị trí chức năng bất khả xâm', () => {
  it('văn xuôi trong chuỗi và comment được chuẩn hoá', () => {
    const r = normalizeCjkPunctuation("// Kết thúc rồi。xong\nconst a = 'Chào bạn，khoẻ không？';");
    expect(r.code).toContain('Kết thúc rồi. xong');
    expect(r.code).toContain("'Chào bạn, khoẻ không?'");
    expect(r.normalized).toBeGreaterThanOrEqual(3);
  });

  it("delimiter chức năng .split('、') / so sánh === '。' / chuỗi không có chữ — GIỮ NGUYÊN", () => {
    const src = "const a = x.split('、'); const b = y === '。'; const c = '、';";
    const r = normalizeCjkPunctuation(src);
    expect(r.code).toBe(src);
    expect(r.normalized).toBe(0);
    expect(r.keptFunctional).toBeGreaterThanOrEqual(3);
  });

  it('cùng MỘT ký tự: delimiter ở chỗ này giữ, văn xuôi ở chỗ kia đổi — phân loại theo vị trí', () => {
    const src = "const a = x.split('、'); const b = 'một、hai、ba';";
    const r = normalizeCjkPunctuation(src);
    expect(r.code).toContain(".split('、')");
    expect(r.code).toContain("'một, hai, ba'");
  });

  it('regex literal và khoá object không bị đụng', () => {
    const src = "const r = /。/g; const o = { '统计。': 1 };";
    const out = normalizeCjkPunctuation(src);
    expect(out.code).toBe(src);
  });

  it('nháy 「」 đổi sang nháy CONG, không bao giờ sang nháy thẳng ASCII (bài học bug 161)', () => {
    const r = normalizeCjkPunctuation("const s = 'anh ấy nói「chào」nhé';");
    expect(r.code).toContain('“chào”');
    expect(r.code).not.toMatch(/"chào"/);
  });

  it('code không parse được → trả nguyên văn, không đoán mò', () => {
    const src = "const broken = 'chuỗi không đóng。";
    expect(normalizeCjkPunctuation(src)).toEqual({ code: src, normalized: 0, keptFunctional: 0 });
  });
});

/* ── Hạng mục E — fixture THẬT (bug/ chỉ nằm local, thiếu là tự bỏ qua) ───── */

describe.skipIf(!haveFixtures)('(bug 200 — E) fixture Status Bar 1.7.5 + đối chứng World Engine', () => {
  it('1.2 trên file thật: 世界运转 giờ THẤY ĐƯỢC trong dataKeys của bản gốc', () => {
    const cn = readFileSync(SB_CN, 'utf8');
    const ex = extractTokensAst(cn, { 世界运转: 'Thế Giới Vận Hành' });
    expect(ex).not.toBeNull();
    const names = ex!.dataKeys.map((k) => k.name);
    expect(names).toContain('世界运转');
    expect(names).toContain('当前日期');
  });

  it('1.1 trên file thật: verifier bắt đúng 3 khoá không bọc nháy của bản dịch cũ (Anna, Hai, Ba)', () => {
    const cn = readFileSync(SB_CN, 'utf8');
    const vi = readFileSync(SB_VI, 'utf8');
    const r = verifyTranslationAst(cn, vi);
    const unsafe = r.unsafeKeyRenames.map((x) => x.after).sort();
    expect(unsafe).toEqual(['Anna', 'Ba', 'Hai']);
    expect(r.hardFail).toBe(true);
  }, 30000);

  it('đối chứng KHÔNG HỒI QUY: World Engine (ca dương tính) không có unsafeKeyRenames', () => {
    const cn = readFileSync(WE_CN, 'utf8');
    const vi = readFileSync(WE_VI, 'utf8');
    const r = verifyTranslationAst(cn, vi);
    expect(r.unsafeKeyRenames).toHaveLength(0);
    expect(r.structuralDiffs).toHaveLength(0);
    expect(r.identDiffs).toHaveLength(0);
    expect(r.literalDiffs).toHaveLength(0);
  }, 30000);

  it('1.3 trên file thật: đủ các character class của hàm phân loại quân chủng trong skippedInClassTerms', () => {
    const cn = readFileSync(SB_CN, 'utf8');
    const r = applyRegexAlternation(cn, {});
    for (const cls of ['家丁亲兵内丁', '骑马骡驼', '水师船舟', '民壮乡勇团练']) {
      expect(r.skippedInClassTerms, cls).toContain(cls);
    }
  }, 30000);

  it('G trên file thật: bản dịch cũ còn 1108 dấu 。 — chuẩn hoá phải xử phần lớn, và vẫn parse được', () => {
    const vi = readFileSync(SB_VI, 'utf8');
    const before = (vi.match(/。/g) || []).length;
    expect(before).toBe(1108);
    const r = normalizeCjkPunctuation(vi);
    const after = (r.code.match(/。/g) || []).length;
    expect(r.normalized).toBeGreaterThan(800);
    expect(after).toBeLessThan(before / 4);
    expect(parses(r.code)).toBe(true);
  }, 30000);
});
