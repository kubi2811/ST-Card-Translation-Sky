/**
 * (bug 243 + 245) Trợ Lý AI — Pvkhoa.
 *  243 — trợ lý dùng action "lạ" rồi bị chặn; tạo action chỉnh sửa dù đã dặn chỉ tạo action đọc.
 *  245 — hỏi về lỗi regex, trợ lý đọc entry rồi quên câu hỏi đầu lượt, quay về chủ đề lượt trước.
 *
 * Phần React (handleSend) không test được trong vitest node; ở đây khoá phần LÕI quyết định:
 * nhận diện "chỉ đọc", phạm vi action từng lượt, câu chỉ dẫn gửi AI, và lớp chặn.
 */
import { describe, it, expect } from 'vitest';
import {
  detectReadOnly, scopeForTurn, allowedActionsFor, buildScopeInstruction, validateAgentAction,
  routeIntent, AGENT_DEFS,
} from '../agentOrchestrator';

describe('(bug 243) nhận ra câu dặn "chỉ đọc"', () => {
  it.each([
    'Kiểm tra giúp tôi lỗi lorebook, nhưng chỉ tạo action để đọc thôi',
    'chỉ đọc entry 10 rồi giải thích lỗi',
    'đừng sửa thẻ, chỉ phân tích',
    'không tạo action chỉnh sửa, tôi tự sửa',
    'Không được thay đổi entry nào hết',
    'read-only nhé',
    '只读，不要修改',
  ])('"%s" ⇒ chỉ đọc', (t) => {
    expect(detectReadOnly(t)).toBe(true);
  });

  it.each([
    'sửa lỗi lorebook #10 giúp tôi',
    'dịch entry 7 sang tiếng Việt',
    'kiểm tra và sửa các regex bị lỗi',
    'tạo entry mới về Ultramarines',
  ])('"%s" ⇒ KHÔNG chỉ đọc (không chặn oan)', (t) => {
    expect(detectReadOnly(t)).toBe(false);
  });
});

describe('(bug 243) phạm vi action từng lượt', () => {
  it('lượt chỉ đọc: chỉ còn VIEW_FULL_REGEX / VIEW_FULL_ENTRY, và AI được BÁO TRƯỚC', () => {
    const scope = scopeForTurn('sửa lỗi lorebook nhưng chỉ đọc thôi');
    expect(scope.readOnly).toBe(true);
    expect([...allowedActionsFor(scope)].sort()).toEqual(['VIEW_FULL_ENTRY', 'VIEW_FULL_REGEX']);
    const ins = buildScopeInstruction(scope);
    expect(ins).toMatch(/CHỈ ĐỌC/);
    expect(ins).toMatch(/EDIT_ENTRY/);   // nêu đích danh action bị cấm
  });

  it('lượt chỉ đọc: EDIT_ENTRY bị chặn với LÝ DO ĐÚNG (không phải "ngoài quyền sub-agent")', () => {
    const r = validateAgentAction('general', 'EDIT_ENTRY', { entryIndex: 1, field: 'content', newValue: 'x' }, { readOnly: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/CHỈ ĐỌC/);
    expect(r.reason).not.toMatch(/ngoài quyền/);
    expect(validateAgentAction('general', 'VIEW_FULL_ENTRY', { entryIndex: 1 }, { readOnly: true }).ok).toBe(true);
  });

  it('CodeFixer sửa được lỗi nằm trong ENTRY (trước đây EDIT_ENTRY bị chặn 100%)', () => {
    expect(routeIntent('sửa lỗi lorebook #10 thiếu dấu backtick')).toBe('codefixer');
    expect(AGENT_DEFS.codefixer.allowedActions).toContain('EDIT_ENTRY');
    expect(validateAgentAction('codefixer', 'EDIT_ENTRY', { entryIndex: 10, field: 'content', newValue: 'x' }).ok).toBe(true);
  });

  it('sub-agent hẹp được nói rõ action nào dùng được; general thì không chèn gì', () => {
    expect(buildScopeInstruction({ agentId: 'translator', readOnly: false })).toMatch(/Action được phép: EDIT_ENTRY/);
    expect(buildScopeInstruction({ agentId: 'general', readOnly: false })).toBe('');
  });
});

describe('(bug 243 + 245) lượt tự gửi tiếp KHÔNG được route lại theo nội dung vừa đọc', () => {
  it('nội dung đọc trọn chứa "REGEX SCRIPT", "script" ⇒ route lại sẽ ra CodeFixer — đó là lý do phải kế thừa', () => {
    const followUp = '[NỘI DUNG ĐẦY ĐỦ ĐÃ ĐỌC]:\n=== REGEX SCRIPT #0: "开局选人" ===\nfindRegex: <开局选人>';
    expect(routeIntent(followUp)).toBe('codefixer');
    // Câu gốc của người dùng là việc lorebook → không phải CodeFixer.
    expect(scopeForTurn('dịch các entry 7 tới 9 cho tôi').agentId).toBe('translator');
  });
});
