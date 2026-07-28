// (bug 132) Hai nửa của cùng một vấn đề "regex trong app này có hai nguồn sự thật":
//   A. <AI_ACTION> ghi regex — ghi vào bản GỐC nên vô hình rồi bị ghi đè ⇒ ĐÃ GỠ.
//   B. Bản DỊCH regex (fields) + regex đã ghi vào thẻ KHÔNG được lưu xuống đĩa ⇒ nhập lại thẻ
//      là quay về nguyên bản. Test khoá lại cả hai.
import { describe, it, expect } from 'vitest';
import { parseAiActions, executeAction, isRemovedRegexAction, REMOVED_REGEX_ACTIONS } from '../aiActions';
import { buildProgressSnapshot } from '../../store';
import type { CharacterCard } from '../../types/card';

const CARD = {
  data: {
    name: 'Test',
    extensions: {
      regex_scripts: [
        { scriptName: 'Tô màu hội thoại', findRegex: '/a/g', replaceString: '<b>x</b>', placement: ['1'] },
      ],
    },
    character_book: { entries: [] },
  },
} as unknown as CharacterCard;

describe('(bug 132A) nhóm action ghi regex đã bị gỡ — không chạy, nhưng KHÔNG im lặng', () => {
  it('parse: action ghi regex bị loại khỏi hàng thực thi', () => {
    const raw = 'Tôi sẽ sửa regex cho bạn.\n\n<AI_ACTION>\n' +
      '{"action":"EDIT_REGEX","params":{"scriptIndex":0,"field":"replaceString","newValue":"<i>y</i>"}}\n' +
      '</AI_ACTION>';
    const { actions } = parseAiActions(raw);
    expect(actions).toHaveLength(0);
  });

  it('parse: người dùng được BÁO RÕ AI vừa định làm gì + chỉ đường sang tab Regex', () => {
    const raw = '<AI_ACTION>{"action":"INJECT_FUNCTION","params":{"scriptIndex":0,"functionCode":"function f(){}"}}</AI_ACTION>';
    const { textContent } = parseAiActions(raw);
    expect(textContent).toContain('INJECT_FUNCTION');
    expect(textContent).toContain('đã được gỡ');
    expect(textContent).toContain('Regex');   // chỉ đúng chỗ người dùng nên làm
  });

  it('action KHÔNG đụng regex vẫn chạy bình thường (không gỡ nhầm)', () => {
    const raw = '<AI_ACTION>{"action":"CREATE_ENTRY","params":{"keys":["a"],"content":"nội dung"}}</AI_ACTION>';
    const { actions } = parseAiActions(raw);
    expect(actions.map(a => a.action)).toEqual(['CREATE_ENTRY']);
  });

  it('VIEW_FULL_REGEX (chỉ ĐỌC) được giữ và vẫn trả về nội dung đầy đủ', () => {
    const { actions } = parseAiActions('<AI_ACTION>{"action":"VIEW_FULL_REGEX","params":{"scriptIndex":0}}</AI_ACTION>');
    expect(actions).toHaveLength(1);
    const r = executeAction(actions[0], CARD);
    expect(r.success).toBe(true);
    expect(r.viewContent).toContain('Tô màu hội thoại');
    expect(r.viewContent).toContain('<b>x</b>');
    expect(r.newCard, 'chỉ đọc thì KHÔNG được sinh card mới').toBeUndefined();
  });

  it('chốt chặn cuối: lọt vào executeAction cũng KHÔNG sửa được thẻ, và nói rõ lý do', () => {
    for (const name of REMOVED_REGEX_ACTIONS) {
      expect(isRemovedRegexAction(name)).toBe(true);
      const r = executeAction({ action: name as never, params: { scriptIndex: 0 } }, CARD);
      expect(r.success, `${name} không được phép thành công`).toBe(false);
      expect(r.newCard, `${name} không được sinh card mới`).toBeUndefined();
      expect(r.message).toContain('đã được gỡ');
    }
    // Thẻ gốc nguyên vẹn.
    expect(CARD.data!.extensions!.regex_scripts![0].replaceString).toBe('<b>x</b>');
  });
});

describe('(bug 132B) tiến trình regex phải xuống đĩa — snapshot mang cả bản dịch lẫn thẻ', () => {
  const mkState = (over: Record<string, unknown> = {}) => ({
    cardFileName: 'card.png',
    contentType: 'card',
    phase: 'idle',
    currentFieldIndex: 0,
    fields: [
      { path: 'data.extensions.regex_scripts[0].replaceString', group: 'regex', original: '<b>x</b>', translated: '<b>đã dịch</b>', status: 'done', label: 'r0' },
    ],
    mvuKeyMetadata: {},
    card: CARD,
    translationConfig: { mvuDictionary: {}, ejsEntryNameDict: {}, ejsKeywordDict: {} },
    ...over,
  }) as never;

  it('snapshot chứa field regex ĐÃ DỊCH (nửa hiển thị ở tab Regex)', () => {
    const snap = buildProgressSnapshot(mkState()) as { fields: Array<{ group: string; translated: string }> };
    const regexField = snap.fields.find(f => f.group === 'regex');
    expect(regexField?.translated).toBe('<b>đã dịch</b>');
  });

  it('snapshot chứa regex_scripts CỦA THẺ (nửa "áp vào card" / bật-tắt) — trước đây thiếu hẳn', () => {
    const snap = buildProgressSnapshot(mkState()) as { regexScripts: Array<{ scriptName: string }> | null };
    expect(Array.isArray(snap.regexScripts)).toBe(true);
    expect(snap.regexScripts![0].scriptName).toBe('Tô màu hội thoại');
  });

  it('thẻ chưa có regex_scripts → regexScripts là null, không nổ', () => {
    const bare = { data: { name: 'x' } } as unknown as CharacterCard;
    const snap = buildProgressSnapshot(mkState({ card: bare })) as { regexScripts: unknown };
    expect(snap.regexScripts).toBeNull();
  });
});
