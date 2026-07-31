/**
 * (bug 173) "Sau khi fix bug 168, xuất hiện một đống lỗi đỏ."
 * ─────────────────────────────────────────────────────────────────────────────
 * Ảnh user gửi: bốn thẻ đỏ "EJS Error … Basic mode regexes must have a string replace value", và
 * khối sinh ra ghi rõ nguồn: "/* Theo yêu cầu preset 19: Dùng activateRegex để bật regex xử lý hậu
 * kỳ *\/ activateRegex('Format Fixer');".
 *
 * Truy ra: "preset 19" là orch-postfix — preset TRƯỚC ĐÂY KHÔNG NẰM trong gói tổng, và chính bản vá
 * bug 162 của tôi đã đưa đủ 19 preset vào gói. Nên đây là hệ quả của bản vá đó lộ ra một lỗ hổng có
 * sẵn trong orch-postfix chứ không phải lỗi mới của bug 168.
 *
 * Lỗ hổng: chốt chặn của orch-postfix chỉ hỏi "thẻ CÓ regex nào không", không hỏi "regex đó có BẬT
 * ĐƯỢC không". SillyTavern từ chối bật regex ở chế độ cơ bản mà replaceString rỗng — nên khối EJS
 * chạy là ném lỗi đỏ, mỗi lượt chat một lần.
 */
import { describe, it, expect } from 'vitest';
import { QUICK_PRESETS, activatableRegexNames, type PresetCardContext } from '../ejsQuickPresets';
import { DEFAULT_ENTRY_EXT, type LorebookEntry } from '../../../types/lorebook.types';

const entry = (name: string): LorebookEntry => ({
  uid: 1, comment: name, content: 'nội dung dài để preset có việc mà làm. '.repeat(5),
  keys: [name], key: [name], keysecondary: [], constant: false, enabled: true, disable: false,
  order: 100, position: 0, depth: 4, probability: 100, useProbability: true,
  selective: true, addMemo: true, excludeRecursion: true, preventRecursion: true,
  extensions: { ...DEFAULT_ENTRY_EXT },
} as unknown as LorebookEntry);

const ctxWith = (regexScripts: PresetCardContext['regexScripts']): PresetCardContext => ({
  schema: { fields: [{ path: 'Máu', type: 'number' }] } as unknown as PresetCardContext['schema'],
  entries: [entry('Thế giới')],
  regexScripts,
  tavernScripts: [],
});

const postfix = QUICK_PRESETS.find((p) => p.id === 'orch-postfix')!;

describe('(bug 173) chỉ coi là bật được khi regex thật sự bật được', () => {
  it('regex có replaceString → bật được', () => {
    expect(activatableRegexNames([{ scriptName: 'Format Fixer', replaceString: '$1' }])).toEqual(['Format Fixer']);
  });

  it('replaceString RỖNG → KHÔNG bật được (đúng ca ST báo lỗi)', () => {
    expect(activatableRegexNames([{ scriptName: 'Format Fixer', replaceString: '' }])).toEqual([]);
    expect(activatableRegexNames([{ scriptName: 'Format Fixer' }])).toEqual([]);
  });

  it('regex không có tên thì bỏ — activateRegex cần đúng tên để gọi', () => {
    expect(activatableRegexNames([{ replaceString: 'x' }])).toEqual([]);
  });
});

describe('(bug 173) orch-postfix không được sinh lệnh bật regex hỏng', () => {
  it('thẻ CÓ regex nhưng KHÔNG cái nào bật được → chặn, kèm lý do đúng', () => {
    const r = postfix.build(ctxWith([{ scriptName: 'Format Fixer', replaceString: '' }]));
    expect(r.blockers.length, 'bản cũ thấy "có regex" là cho chạy → sinh ra lệnh ném lỗi').toBeGreaterThan(0);
    expect(r.blockers[0]).toMatch(/replaceString|giá trị thay thế/i);
  });

  it('thẻ không có regex nào → vẫn chặn như cũ', () => {
    expect(postfix.build(ctxWith([])).blockers.length).toBeGreaterThan(0);
  });

  it('có regex bật được → chạy, và NÊU ĐÍCH DANH tên hợp lệ cho AI', () => {
    const r = postfix.build(ctxWith([
      { scriptName: 'Format Fixer', replaceString: '$1' },
      { scriptName: 'Regex Hỏng', replaceString: '' },
    ]));
    expect(r.blockers).toEqual([]);
    expect(r.goal, 'phải liệt kê tên bật được').toContain('Format Fixer');
    expect(r.goal, 'KHÔNG được mời AI bật regex hỏng').not.toContain('Regex Hỏng');
    expect(r.goal, 'phải cấm bịa tên').toMatch(/không.*(bịa|tự nghĩ|tên khác)/i);
  });
});
