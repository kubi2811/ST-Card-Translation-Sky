// (bug 236, gốc rễ) "ACTION LẠ" KHÔNG PHẢI LÀ MỘT CA HIẾM — NÓ LÀ HỆ QUẢ CỦA BA DANH SÁCH LỆCH NHAU.
//
// Trước bản vá này, cùng một khái niệm "action" tồn tại ở ba chỗ, không chỗ nào biết chỗ nào:
//   1. union `AIAction` trong `types/aiAgent.types.ts` — 11 action, payload dẹt;
//   2. union `AIAction` trong `lib/ai/copilotTypes.ts`  — 15 action, payload lồng trong `data`;
//   3. một CHUỖI liệt kê trong `copilotPrompts.ts`      — 11 tên, thiếu 4 tool thật sự chạy được.
// AI chỉ đọc được (3). Nó không biết `create_tavern_script` tồn tại, và khi nó tự nghĩ ra một tên
// ngoài danh sách thì action đó chui tới `executeAction`, không khớp case nào, IM LẶNG không làm gì
// — trong khi vòng lặp vẫn báo về "applied successfully". AI tin là xong, không thấy kết quả, hỏi
// lại: vòng lặp không có lối ra.
//
// Test này khoá lại ba mối nối: một nguồn tên duy nhất, lời nhắc sinh ra từ chính nguồn đó, và tên
// lạ bị chặn NGAY CỬA VÀO kèm phản hồi trung thực.
import { describe, it, expect } from 'vitest';
import { AI_ACTION_TYPES, normalizeActionType } from '../../../types/aiAgent.types';
import { parseAIResponseJSON } from '../jsonExtract';
import { buildCopilotSystemPrompt } from '../copilotPrompts';
import { createEmptyCard } from '../../converters/cardDefaults';

const json = (obj: unknown) => JSON.stringify(obj);

describe('(bug 236) một danh sách action duy nhất', () => {
  it('không có tên trùng, và đủ các tool thật sự chạy được', () => {
    expect(new Set(AI_ACTION_TYPES).size).toBe(AI_ACTION_TYPES.length);
    for (const must of ['create_tavern_script', 'generate_game_ui', 'save_memory', 'tool_call']) {
      expect(AI_ACTION_TYPES, `${must} chạy được nhưng AI không được cho biết`).toContain(must);
    }
  });

  it('lời nhắc gửi cho AI liệt kê ĐÚNG danh sách đó — không chép tay', () => {
    const prompt = buildCopilotSystemPrompt('genesis', createEmptyCard(), '');
    for (const t of AI_ACTION_TYPES) {
      expect(prompt, `lời nhắc thiếu ${t}`).toContain(t);
    }
  });
});

describe('(bug 236) normalizeActionType — cửa duy nhất phán tên', () => {
  it('tên chuẩn đi qua nguyên vẹn', () => {
    expect(normalizeActionType('create_entry')).toBe('create_entry');
    expect(normalizeActionType('  tool_call  ')).toBe('tool_call');
  });

  it('tên đời cũ được quy về tên chuẩn, không cần rải case khắp nơi', () => {
    expect(normalizeActionType('add_regex')).toBe('add_regex_script');
    expect(normalizeActionType('update_regex')).toBe('update_regex_script');
    expect(normalizeActionType('delete_regex')).toBe('delete_regex_script');
  });

  it('tên không tồn tại trả về null — kể cả rác', () => {
    expect(normalizeActionType('VIEW_FULL_ENTRY')).toBeNull();
    expect(normalizeActionType('')).toBeNull();
    expect(normalizeActionType(undefined as unknown as string)).toBeNull();
  });
});

describe('(bug 236) action lạ bị chặn ở cửa vào và được báo THẬT', () => {
  it('đúng ca của bug: VIEW_FULL_ENTRY bị loại, không lọt xuống lớp áp dụng', () => {
    const r = parseAIResponseJSON(json({
      message: 'Để tôi xem entry đó',
      status: 'CONTINUE',
      actions: [{ type: 'VIEW_FULL_ENTRY', data: { id: 3 } }],
    }));
    expect(r.actions, 'action không tồn tại mà vẫn lọt xuống là quay lại đúng bug cũ').toHaveLength(0);
    expect(r.droppedActionTypes).toEqual(['VIEW_FULL_ENTRY']);
  });

  it('action hợp lệ đi cùng action lạ thì phần hợp lệ vẫn chạy', () => {
    const r = parseAIResponseJSON(json({
      message: '',
      status: 'DONE',
      actions: [
        { type: 'create_entry', data: { comment: 'A', keys: ['a'], content: 'x' } },
        { type: 'TELEPORT', data: {} },
      ],
    }));
    expect(r.actions.map(a => a.type)).toEqual(['create_entry']);
    expect(r.droppedActionTypes).toEqual(['TELEPORT']);
  });

  it('tên đời cũ KHÔNG bị coi là lạ — nó được đổi sang tên chuẩn', () => {
    const r = parseAIResponseJSON(json({
      message: '', status: 'DONE',
      actions: [{ type: 'add_regex', data: { scriptName: 'x' } }],
    }));
    expect(r.actions.map(a => a.type)).toEqual(['add_regex_script']);
    expect(r.droppedActionTypes).toBeUndefined();
  });

  it('không có action lạ thì KHÔNG gắn cờ — vòng lặp khỏi nhắc thừa', () => {
    const r = parseAIResponseJSON(json({
      message: 'xong', status: 'DONE',
      actions: [{ type: 'continue_signal', data: { reason: 'còn việc' } }],
    }));
    expect(r.droppedActionTypes).toBeUndefined();
  });
});
