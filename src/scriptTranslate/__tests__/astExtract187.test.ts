/**
 * (bug 187 — Hạng mục A) Bộ trích token dựa AST.
 * ─────────────────────────────────────────────────────────────────────────────
 * Mỗi ca lịch sử của chuỗi vá regex-lookback (#151/#154/#160/#161/#171/#178) được
 * viết lại ở đây theo cơ chế MỚI: phân loại phải đúng vì VỊ TRÍ NODE nói thế,
 * không phải vì một mẫu regex tình cờ khớp.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAnyAst, extractTokensAst, checkDictCoverage, looksLikeDataPath, stripAsciiAffixes,
} from '../astExtract';
import { reinsertTranslations } from '../../utils/surgical';
import { jsParseErrorAny } from '../../utils/scriptSafety';
import { isTranslatableToken } from '../tokenBatcher';

const ex = (code: string, dict?: Record<string, string>) => {
  const r = extractTokensAst(code, dict);
  expect(r, 'code mẫu phải parse được').not.toBeNull();
  return r!;
};

describe('parse', () => {
  it('module lẫn script đều parse được; code vỡ trả null', () => {
    expect(parseAnyAst('import x from "y"; const a = 1;')).not.toBeNull();
    expect(parseAnyAst('return 1;')).not.toBeNull(); // return ngoài hàm — script mode
    expect(parseAnyAst('const const = ;')).toBeNull();
    expect(extractTokensAst('const const = ;')).toBeNull();
  });
});

describe('văn xuôi trong chuỗi — thứ DUY NHẤT được gửi AI', () => {
  it('chuỗi thường thành token dịch được, kèm đúng dấu nháy đang bao (bug 161)', () => {
    const { tokens } = ex(`const a = '你好世界'; const b = "另一句话";`);
    expect(tokens).toHaveLength(2);
    expect(tokens.every(isTranslatableToken)).toBe(true);
    expect(tokens[0].inStringQuote).toBe("'");
    expect(tokens[1].inStringQuote).toBe('"');
  });

  it('"1. 中文" trong chuỗi là VĂN XUÔI — thời regex-lookback từng nhận nhầm dot-notation', () => {
    const { tokens } = ex(`sysPrompt += '1. 回答要求如下';`);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].isDotNotation).toBe(false);
    expect(isTranslatableToken(tokens[0])).toBe(true);
  });

  it('template literal: chỉ phần chữ thành token, ${…} là code đi đường code', () => {
    const { tokens } = ex('const t = `你好${userName}世界`;');
    expect(tokens.map((t) => t.text)).toEqual(['你好', '世界']);
    expect(tokens.every(isTranslatableToken)).toBe(true);
  });

  it('comment dòng + khối đều được dịch', () => {
    const { tokens } = ex('// 注释一\nconst a = 1; /* 注释二 */');
    expect(tokens.map((t) => t.text)).toEqual(['注释一', '注释二']);
  });

  it('CJK trong URL không bao giờ thành token', () => {
    const { tokens } = ex(`const u = 'https://cdn.com/骰子系统/stable.js';`);
    expect(tokens).toHaveLength(0);
  });

  it('class="中文" nhúng trong chuỗi HTML → giữ nguyên (selector chết nếu dịch có dấu cách)', () => {
    const { tokens } = ex(`el.innerHTML = '<div class="中文类">正文内容</div>';`);
    const attr = tokens.find((t) => t.text === '中文类');
    const prose = tokens.find((t) => t.text === '正文内容');
    expect(attr?.isHtmlAttr).toBe(true);
    expect(isTranslatableToken(attr!)).toBe(false);
    expect(isTranslatableToken(prose!)).toBe(true);
  });

  it('(bug 178) ngoặc lẻ 】 không được lọt vào token — cắt thành hai cụm sạch', () => {
    // ': ' ASCII trước 【 → run bắt đầu tại 消 (【 nằm ngoài) → 】 thành ngoặc mồ côi trong run.
    const { tokens } = ex(`const s = '- 模板: 【消费监测】支出金额';`);
    const texts = tokens.map((t) => t.text);
    expect(texts.some((t) => t.includes('】') || t.includes('【'))).toBe(false);
    expect(texts.join('|')).toContain('消费监测');
    expect(texts.join('|')).toContain('支出金额');
  });
});

describe('khoá dữ liệu — CHỈ đổi theo Từ Điển, không bao giờ hỏi AI', () => {
  const DICT = { 人际网络: 'Mạng lưới quan hệ', 预产天数: 'Số ngày dự sinh', 状态: 'Trạng Thái', 军事: 'Quân sự', 各营: 'Các doanh' };

  it('dot-notation: t.人际网络 → token khoá, dịch sẵn từ dict', () => {
    const { tokens, dataKeys } = ex('t.人际网络.x = 1;', DICT);
    const k = tokens.find((t) => t.text === '人际网络')!;
    expect(k.isDotNotation).toBe(true);
    expect(k.fromDictionary).toBe(true);
    expect(k.translated).toBe('Mạng lưới quan hệ');
    expect(isTranslatableToken(k)).toBe(false);
    expect(dataKeys.map((d) => d.name)).toContain('人际网络');
  });

  it('(bug 151) tiền tố ASCII: n._预产天数 → token bắt đầu từ chữ Hán, reinsert tự ghép `_`', () => {
    const src = 'if (n._预产天数 > 0) { x(); }';
    const { tokens } = ex(src, DICT);
    const k = tokens.find((t) => t.text === '预产天数')!;
    expect(k.isDotNotation).toBe(true);
    const out = reinsertTranslations(src, tokens);
    expect(out).toContain(`n['_Số ngày dự sinh']`);
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it('(bug 171) khoá trộn CJK+ASCII là MỘT token: f.与user关系', () => {
    const { tokens } = ex('const v = f.与user关系 || 1;');
    expect(tokens.map((t) => t.text)).toEqual(['与user关系']);
    expect(tokens[0].isDotNotation).toBe(true);
  });

  it('(bug 154) object key trần lẫn có nháy đều là khoá: {_开场标识: 1, "当前日期": 2}', () => {
    const dict = { 开场标识: 'Định danh khởi đầu', 当前日期: 'Ngày hiện tại' };
    const src = 'const ee = {_开场标识: 1, "当前日期": 2};';
    const { tokens } = ex(src, dict);
    expect(tokens.every((t) => t.isObjectKey)).toBe(true);
    const out = reinsertTranslations(src, tokens);
    expect(out).toContain(`'_Định danh khởi đầu': 1`);
    expect(out).toContain(`"Ngày hiện tại": 2`);
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it('obj["状态"] computed → khoá bracket, thay thẳng trong nháy', () => {
    const src = 'const x = obj["状态"];';
    const { tokens } = ex(src, DICT);
    expect(tokens).toHaveLength(1);
    expect(isTranslatableToken(tokens[0])).toBe(false);
    const out = reinsertTranslations(src, tokens);
    expect(out).toContain('obj["Trạng Thái"]');
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it('optional chain: wd.时势?.标题 — cả hai đoạn đều là khoá dot-notation', () => {
    const { tokens } = ex('const t = wd.时势?.标题;');
    expect(tokens.map((t) => [t.text, t.isDotNotation])).toEqual([['时势', true], ['标题', true]]);
  });

  it("(bug 151/154) chuỗi đường dẫn '_​军事.各营' đổi theo TỪNG ĐOẠN, dấu chấm bất khả xâm", () => {
    const src = `const v = _.get(t, '军事.各营');`;
    const { tokens } = ex(src, DICT);
    expect(tokens.map((t) => t.text)).toEqual(['军事', '各营']);
    // Trong chuỗi thì KHÔNG bracket-wrap (bọc là xẻ đôi chuỗi) — chỉ thay chữ.
    expect(tokens.every((t) => !t.isDotNotation)).toBe(true);
    const out = reinsertTranslations(src, tokens);
    expect(out).toContain(`'Quân sự.Các doanh'`);
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it("một đoạn đơn trong lời gọi dữ liệu _.get(t,'军事') cũng là khoá", () => {
    const { tokens } = ex(`const v = _.get(t, '军事');`, DICT);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].translated).toBe('Quân sự');
    expect(isTranslatableToken(tokens[0])).toBe(false);
  });

  it('văn xuôi có dấu chấm câu Trung KHÔNG bị nhận nhầm đường dẫn', () => {
    expect(looksLikeDataPath('军事.各营')).toBe(true);
    expect(looksLikeDataPath('他说。这就是一切')).toBe(false);
    expect(looksLikeDataPath('3.5米')).toBe(false);
  });
});

describe('(review 187) các ca bộ review đối kháng bắt được', () => {
  it('hậu tố ASCII của khoá phải SỐNG SÓT qua tra core: 魔力值2 + dict{魔力值} → Mana2', () => {
    const src = 'obj.魔力值2 = 5;\nconst a = { 魔力值2: 1, 魔力值: 2 };';
    const { tokens } = ex(src, { 魔力值: 'Mana' });
    const out = reinsertTranslations(src, tokens);
    // (bug 200 — Hạng mục H) Khoá đã dịch nay LUÔN thành chuỗi có nháy — kể cả khi bản dịch
    // tình cờ hợp lệ làm identifier ("Mana2"). Điều test này canh — hậu tố `2` sống sót và
    // hai khoá không sập làm một — vẫn nguyên; chỉ có hình thức là bracket/quote vô điều kiện.
    expect(out).toContain("obj['Mana2'] = 5");        // hậu tố 2 còn nguyên
    expect(out).toContain("'Mana2': 1");
    expect(out).toContain("'Mana': 2");               // hai khoá KHÁC NHAU không sập làm một
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it('mục Từ Điển đích danh cho tên có hậu tố phải THẮNG mục core', () => {
    const src = 'obj.魔力值2 = 5;';
    const { tokens } = ex(src, { 魔力值: 'Mana', 魔力值2: 'Mana Hai' });
    expect(reinsertTranslations(src, tokens)).toContain(`obj['Mana Hai']`);
  });

  it('mục identity (nguồn = đích) nghĩa là GIỮ khoá có chủ đích — không sinh bản thay', () => {
    const { tokens } = ex('obj.身份 = 1;', { 身份: '身份' });
    expect(tokens[0].translated).toBeUndefined();
    expect(tokens[0].fromDictionary).toBeUndefined();
  });

  it("getvar('key')/setvar('key') — khoá ở ARG 0 vẫn phải là khoá dict-only, không phải văn xuôi", () => {
    const src = `setvar('好感度', 1); const x = getvar('好感度'); helper.setvar('好感度', 2);`;
    const { tokens, dataKeys } = ex(src, { 好感度: 'Hao Cam' });
    expect(tokens).toHaveLength(3);
    expect(tokens.every((t) => !isTranslatableToken(t) && t.translated === 'Hao Cam')).toBe(true);
    expect(dataKeys.find((d) => d.name === '好感度')?.count).toBe(3);
    const out = reinsertTranslations(src, tokens);
    expect(out).toContain(`setvar('Hao Cam', 1)`);
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it('định danh viết dạng \\uXXXX escape: thay TRỌN raw span, không cắt giữa escape', () => {
    const src = 'obj.\\u9b54\\u529b = 1;';
    const { tokens } = ex(src, { 魔力: 'Ma Lực' });
    const out = reinsertTranslations(src, tokens);
    expect(out).toBe(`obj['Ma Lực'] = 1;`);
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it('khoảng trắng giữa dấu chấm và tên bị NUỐT — không lọt vào trong nháy thành sai khoá', () => {
    for (const src of ['obj. 中文 = 1;', 'obj.\n  中文 = 1;']) {
      const { tokens } = ex(src, { 中文: 'Tiếng Trung' });
      const out = reinsertTranslations(src, tokens);
      expect(out).toBe(`obj['Tiếng Trung'] = 1;`);
      expect(jsParseErrorAny(out)).toBeNull();
    }
  });

  it('literal khổng lồ chứa sourcemap (sourcesContent) → giữ nguyên, không bóc đi dịch', () => {
    const body = JSON.stringify({ version: 3, sourcesContent: ['const 世界 = 1; // 中文注释'] });
    const src = `const map = '${body.replace(/'/g, "\\'")}${'x'.repeat(2100)}';`;
    const { tokens } = ex(src);
    expect(tokens).toHaveLength(0);
  });
});

describe('(bug 128) định danh trần — GIỮ NGUYÊN tuyệt đối, kể cả có trong dict', () => {
  it('const 配置 + tham chiếu 配置.x: tên biến không thành token, thuộc tính thì có', () => {
    const src = 'const 配置 = { 调试: 1 };\nif (配置.调试) { go(); }';
    const { tokens, keptIdentifiers } = ex(src, { 配置: 'Cấu hình', 调试: 'Gỡ lỗi' });
    expect(keptIdentifiers.map((k) => k.name)).toContain('配置');
    expect(tokens.some((t) => t.text === '配置')).toBe(false);       // khai báo + tham chiếu: cấm đụng
    const props = tokens.filter((t) => t.text === '调试');
    expect(props.length).toBe(2);                                    // object key + dot-notation
    const out = reinsertTranslations(src, tokens);
    expect(out).toContain('const 配置');                              // tên biến còn nguyên
    expect(jsParseErrorAny(out)).toBeNull();
  });

  it('destructuring + shorthand + tham số hàm đều được bảo vệ', () => {
    const src = 'const { 世界, 状态 } = data;\nfunction f(角色) { return { 世界, n: 角色 }; }';
    const { tokens, keptIdentifiers } = ex(src);
    const kept = keptIdentifiers.map((k) => k.name);
    expect(kept).toEqual(expect.arrayContaining(['世界', '状态', '角色']));
    expect(tokens.filter(isTranslatableToken)).toHaveLength(0);
  });

  it('obj[bienHan] computed member — điểm mù kinh điển của regex-lookback: biến trong ngoặc là THAM CHIẾU, không phải khoá', () => {
    const src = 'const 键名 = "x"; const v = obj[键名];';
    const { tokens, keptIdentifiers } = ex(src);
    expect(keptIdentifiers.map((k) => k.name)).toContain('键名');
    expect(tokens.some((t) => t.text === '键名')).toBe(false);
  });
});

describe('regex literal — vùng của pass alternation, extractor không đụng', () => {
  it('/秋青子/ không sinh token, có mặt trong regexRanges', () => {
    const { tokens, regexRanges } = ex('const re = /秋青子\\s*[:：]/g;');
    expect(tokens).toHaveLength(0);
    expect(regexRanges).toHaveLength(1);
  });
});

describe('(Hạng mục B) coverage Từ Điển', () => {
  it('khoá thiếu bị liệt kê đích danh; target rỗng coi như thiếu; đụng độ target bị bắt', () => {
    const { dataKeys } = ex('t.生命.x = o.武力 + p["智谋"] + _.get(s, "政治.魅力");');
    const cov = checkDictCoverage(dataKeys, [
      { source: '生命', target: 'Sinh mệnh' },
      { source: '武力', target: '' },              // rỗng = thiếu
      { source: '智谋', target: 'Trí mưu' },
      { source: '政治', target: 'Trí mưu' },       // đụng độ với 智谋
      { source: '魅力', target: 'Mị lực' },
    ]);
    expect(cov.total).toBe(5);
    expect(cov.missing.map((m) => m.name)).toEqual(['武力']);
    expect(cov.emptyTargets).toEqual(['武力']);
    expect(cov.collisions).toEqual([{ target: 'Trí mưu', sources: expect.arrayContaining(['智谋', '政治']) }]);
  });

  it('stripAsciiAffixes: dạng user nhập vào Từ Điển', () => {
    expect(stripAsciiAffixes('_开场标识')).toBe('开场标识');
    expect(stripAsciiAffixes('AP上限2')).toBe('上限');
  });
});
