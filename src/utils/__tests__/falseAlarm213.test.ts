/**
 * (bug 213 — Đợt 2: HẾT BÁO OAN / KẸT VÒNG)
 *
 * Bốn chốt an toàn đang bắn nhầm vào chính công việc đúng. Báo động giả nguy hiểm không kém
 * lỗi thật: nó dạy user bỏ qua cảnh báo (bài học bug 154), và với vòng quét-sửa thì nó làm
 * user bấm mãi không sạch (họ bug 197/198).
 *
 *   #4  aiRegexProcess GĐ3 đòi ngoặc cân TUYỆT ĐỐI, trong khi chính file này đã học được ở chốt
 *       code_splice rằng replaceString/fragment hợp lệ VỐN lệch ngoặc so với 0. Bản AI sửa đúng
 *       bị bác "Validate thất bại — giữ bản cũ", vòng sau lại ra y hệt lỗi đó.
 *   #4b GĐ4 "kiểm coverage" là check chết: `covered` dựng từ chính `chunks`, mà mọi field đều có
 *       ít nhất 1 chunk → `missed` luôn rỗng. Chỉ tạo cảm giác an toàn giả.
 *   #6  validatePreset quên mask replaceString trong khi pipeline CÓ sửa nó (việc 118) → dịch
 *       HTML regex thành công là validate đỏ.
 *   #6b validateMvuVariables dùng includes() trần → key CJK ngắn báo "unreplaced" oan.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateMvuVariables, containsStandalone } from '../mvuValidator';
import { validatePreset } from '../../presetTranslate/validatePreset';
import type { STPreset } from '../../presetTranslate/types';

const aiVerifySrc = readFileSync(new URL('../aiVerify.ts', import.meta.url), 'utf-8');
const masterPromptSrc = readFileSync(new URL('../masterPrompt.ts', import.meta.url), 'utf-8');

/* ═════════════ #4 — độ lệch ngoặc so với GỐC, không so với 0 ═════════════ */

describe('#4 — validate ngoặc của vòng quét+sửa regex', () => {
  // Chép đúng phép so trong aiVerify để khoá hành vi.
  const delta = (s: string, o: string, c: string) => s.split(o).length - s.split(c).length;
  const matchesOrig = (fixed: string, orig: string, o: string, c: string) =>
    Math.abs(delta(fixed, o, c) - delta(orig, o, c)) <= 1;

  it('replaceString hợp lệ vốn LỆCH ngoặc so với 0 — không được coi là vỡ code', () => {
    // Fragment thật: dấu } của ${...} và } trong chuỗi làm số ngoặc không bao giờ cân về 0.
    const orig = '<div class="box">${data.名前}</div><span>}</span>';
    const fixed = '<div class="box">${data.Tên}</div><span>}</span>';
    // Luật CŨ (cân tuyệt đối) sẽ bác bản sửa đúng này:
    const oldRule = (s: string) => s.split('{').length === s.split('}').length;
    expect(oldRule(fixed)).toBe(false);
    // Luật MỚI nhận đúng, vì bản sửa giữ nguyên độ lệch của gốc:
    expect(matchesOrig(fixed, orig, '{', '}')).toBe(true);
  });

  it('vẫn bắt được bản sửa làm VỠ ngoặc thật', () => {
    // Dung sai ±1 (bằng chốt anh em ở aiFixRegexFields) — mất/thừa 1 dấu là biên độ bình thường
    // khi dịch; từ 2 dấu trở lên mới coi là vỡ cấu trúc.
    const orig = 'function f() { if (x) { return 1; } }';
    expect(matchesOrig('function f() { if (x) { return 1;', orig, '{', '}')).toBe(false);      // mất 2
    expect(matchesOrig('function f() { if (x) { return 1; } } } }', orig, '{', '}')).toBe(false); // thừa 2
    expect(matchesOrig('function f() { if (x) { return 1; } }', orig, '{', '}')).toBe(true);   // y hệt gốc
  });

  it('dung sai ±1 khớp với chốt tương đương ở aiFixRegexFields', () => {
    const orig = 'a { b } c';                                          // độ lệch gốc = 0
    expect(matchesOrig('a { b } c { ', orig, '{', '}')).toBe(true);     // lệch 1 → tha
    expect(matchesOrig('a { b } c { { ', orig, '{', '}')).toBe(false);  // lệch 2 → bác
  });

  it('code đã bỏ hẳn hàm cân-tuyệt-đối, dùng phép so với gốc', () => {
    expect(aiVerifySrc).not.toMatch(/const _balanced = /);
    expect(aiVerifySrc).toMatch(/_bracketMatchesOrig\(fixed, field\.original, '\{', '\}'\)/);
    expect(aiVerifySrc).toMatch(/_bracketMatchesOrig\(fixed, field\.original, '\[', '\]'\)/);
    expect(aiVerifySrc).toMatch(/_bracketMatchesOrig\(fixed, field\.original, '\(', '\)'\)/);
  });
});

describe('#4b — GĐ4 coverage phải kiểm thật, không luôn-pass', () => {
  it('không còn dựng `covered` từ chính chunks (phép so luôn đúng)', () => {
    expect(aiVerifySrc).not.toMatch(/const covered = new Set\(chunks\.map\(c => c\.fieldPath\)\)/);
  });

  it('kiểm bất biến thật: ghép các chunk phải dựng lại nguyên văn field', () => {
    expect(aiVerifySrc).toMatch(/const origRebuilt = cs\.map\(c => c\.origChunk\)\.join\('\\n'\)/);
    expect(aiVerifySrc).toMatch(/const transRebuilt = cs\.map\(c => c\.transChunk\)\.join\('\\n'\)/);
    expect(aiVerifySrc).toMatch(/if \(origRebuilt !== f\.original \|\| transRebuilt !== \(f\.translated \|\| ''\)\)/);
  });

  it('field không có chunk nào vẫn được báo là CHƯA hề được quét', () => {
    expect(aiVerifySrc).toMatch(/KHÔNG hề được quét/);
  });
});

/* ═════════════ #6 — validatePreset phải mask replaceString ═════════════ */

const mkPreset = (regex: { scriptName: string; findRegex: string; replaceString: string; disabled?: boolean }[]): STPreset =>
  ({
    prompts: [{ identifier: 'p1', name: '主提示', content: '你好世界' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'p1', enabled: true }] }],
    extensions: { regex_scripts: regex.map((r, i) => ({ id: `r${i}`, ...r })) },
  } as unknown as STPreset);

describe('#6 — dịch replaceString không được bị báo "thay đổi ngoài field cho phép"', () => {
  it('CHỈ đổi replaceString (dịch khối HTML — việc 118) → KHÔNG bắn psTrVdOutside', () => {
    const orig = mkPreset([{ scriptName: '状态栏', findRegex: '/<状态>/g', replaceString: '<b>状态</b>' }]);
    const translated = mkPreset([{ scriptName: 'Thanh trạng thái', findRegex: '/<Trạng thái>/g', replaceString: '<b>Trạng thái</b>' }]);
    const res = validatePreset(orig, translated, {});
    expect(res.structureErrors.join('|')).not.toContain('psTrVdOutside');
  });

  it('vẫn bắt được thay đổi ở field THẬT SỰ ngoài vùng cho phép', () => {
    const orig = mkPreset([{ scriptName: 'A', findRegex: '/x/', replaceString: 'y' }]);
    // `disabled` không nằm trong danh sách được dịch → phải bị bắt
    const translated = mkPreset([{ scriptName: 'A', findRegex: '/x/', replaceString: 'y', disabled: true }]);
    expect(validatePreset(orig, translated, {}).structureErrors.join('|')).toContain('psTrVdOutside');
  });

  it('mask có xoá replaceString', () => {
    const src = readFileSync(new URL('../../presetTranslate/validatePreset.ts', import.meta.url), 'utf-8');
    expect(src).toMatch(/r\.scriptName = ''; r\.findRegex = ''; r\.replaceString = '';/);
  });

  it('thông báo lỗi liệt kê đủ danh sách field được dịch ở cả 3 ngôn ngữ', () => {
    for (const loc of ['en', 'vi', 'zh']) {
      const s = readFileSync(new URL(`../../i18n/ui/${loc}.ts`, import.meta.url), 'utf-8');
      const line = s.split('\n').find(l => l.includes('psTrVdOutside')) || '';
      expect(line).toContain('replaceString');
    }
  });
});

/* ═════════════ #6b — includes() trần báo oan với key ngắn ═════════════ */

describe('#6b — containsStandalone: key ngắn không ăn ké chỗ của key dài', () => {
  const KEYS = ['力', '能力', '好感', '好感度'];

  it('key ngắn nằm LỌT trong key dài → không tính là có mặt', () => {
    expect(containsStandalone('他的能力很强', '力', KEYS)).toBe(false);
    expect(containsStandalone('好感度上升', '好感', KEYS)).toBe(false);
  });

  it('key ngắn đứng một mình → vẫn tìm thấy', () => {
    expect(containsStandalone('力量与智慧', '力', KEYS)).toBe(true);
    expect(containsStandalone('她的好感很高', '好感', KEYS)).toBe(true);
  });

  it('key dài luôn tự tìm thấy chính nó', () => {
    expect(containsStandalone('好感度上升', '好感度', KEYS)).toBe(true);
    expect(containsStandalone('他的能力很强', '能力', KEYS)).toBe(true);
  });

  it('vừa lọt trong key dài vừa đứng riêng → vẫn tính là có mặt', () => {
    expect(containsStandalone('好感度上升，而好感也在变', '好感', KEYS)).toBe(true);
  });

  it('không có needle thì trả false, không nổ', () => {
    expect(containsStandalone('bất kỳ', '', KEYS)).toBe(false);
    expect(containsStandalone('', '力', KEYS)).toBe(false);
  });
});

describe('#6b — validateMvuVariables hết báo oan "unreplaced"', () => {
  const DICT = { '力': 'Lực', '能力': 'Năng Lực', '好感': 'Hảo Cảm', '好感度': 'Hảo Cảm Độ' };

  it('dịch ĐÚNG hết → không mục nào bị xếp vào unreplaced', () => {
    const original = '他的能力很强，好感度上升';
    const translated = 'Năng Lực của anh ấy rất mạnh, Hảo Cảm Độ tăng lên';
    const res = validateMvuVariables(original, translated, DICT, 'narrative');
    expect(res.unreplaced).toEqual([]);
    expect(res.valid).toBe(true);
  });

  it('LUẬT CŨ (includes trần) sẽ báo oan đúng ca trên — khoá lại để khỏi tái phát', () => {
    const original = '他的能力很强，好感度上升';
    const translated = 'Năng Lực của anh ấy rất mạnh, Hảo Cảm Độ tăng lên';
    // includes() trần: '力' vẫn "còn" trong bản gốc lẫn bản dịch? bản dịch không có Hán,
    // nhưng bản gốc có '力' lọt trong '能力' → key được đem đi xét, rồi '力'→'Lực' lọt trong
    // 'Năng Lực' làm kết quả nhiễu. Bản mới bỏ hẳn cặp này khỏi vòng xét.
    const res = validateMvuVariables(original, translated, DICT, 'narrative');
    expect(res.unreplaced).not.toContain('力');
    expect(res.unreplaced).not.toContain('好感');
  });

  it('CÒN SÓT thật thì vẫn phải bắt', () => {
    const original = '他的能力很强';
    const translated = 'Cái 能力 của anh ấy rất mạnh';
    const res = validateMvuVariables(original, translated, DICT, 'narrative');
    expect(res.unreplaced).toContain('能力');
    expect(res.valid).toBe(false);
  });

  it('có cả tên mới lẫn tên gốc vẫn phải đưa vào auto-fix', () => {
    const original = '年龄 được dùng ở hai vị trí: 年龄';
    const translated = 'Tuổi Tác được dùng ở hai vị trí: 年龄';
    const res = validateMvuVariables(original, translated, { 年龄: 'Tuổi Tác' }, 'mvu_logic');
    expect(res.unreplaced).toEqual(['年龄']);
    expect(res.replaced).toEqual(['年龄']);
    expect(res.valid).toBe(false);
    expect(res.warnings.some(w => /partially replaced/.test(w))).toBe(true);
  });
});

/* ═════════════ masterPrompt hết tự mâu thuẫn ═════════════ */

describe('masterPrompt — hai tầng phải nói cùng một điều về API TavernHelper', () => {
  it('Layer 1 không còn dạy sendMessage/executeSlashCommands là API thật', () => {
    const idxL1 = masterPromptSrc.indexOf('Common EJS API functions');
    const l1Block = masterPromptSrc.slice(idxL1, idxL1 + 400);
    expect(l1Block).not.toContain('executeSlashCommands()');
    expect(l1Block).not.toContain('sendMessage()');
  });

  it('Layer 2 (bản vá bug 164) vẫn giữ nguyên tuyên bố ngược lại', () => {
    expect(masterPromptSrc).toMatch(/there is NO setVariable\/getVariable\/sendMessage\/executeSlashCommands in this API/);
  });

  it('các API thật vẫn còn trong danh sách cấm dịch', () => {
    const idxL1 = masterPromptSrc.indexOf('Common EJS API functions');
    const l1Block = masterPromptSrc.slice(idxL1, idxL1 + 400);
    for (const fn of ['getvar', 'setvar', 'addvar', 'getglobalvar']) {
      expect(l1Block).toContain(fn);
    }
  });
});
