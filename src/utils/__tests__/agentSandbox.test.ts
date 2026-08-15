// P4 roadmap — orchestrator (route + whitelist + zod) và QuickJS sandbox (escape test).
import { describe, it, expect } from 'vitest';
import { routeIntent, validateAgentAction, AGENT_DEFS } from '../agentOrchestrator';
import { runInSandbox } from '../scriptSandbox';

describe('routeIntent — heuristic, mơ hồ thì về general', () => {
  it('câu hỏi sửa regex/script → codefixer', () => {
    expect(routeIntent('sửa lỗi regex tô màu hội thoại giúp tôi')).toBe('codefixer');
    expect(routeIntent('script TavernHelper bị SyntaxError')).toBe('codefixer');
  });
  it('yêu cầu dịch → translator; lorebook → lorearchitect; tán gẫu → general', () => {
    expect(routeIntent('dịch entry này sang tiếng Việt')).toBe('translator');
    expect(routeIntent('tạo lorebook entry cho tông môn mới')).toBe('lorearchitect');
    expect(routeIntent('hôm nay tâm trạng tôi không tốt')).toBe('general');
  });
});

describe('validateAgentAction — whitelist + zod chặn action lệch chuẩn', () => {
  /**
   * (bug 236) CÂU TỪ CHỐI ĐỔI CHO ĐÚNG BỆNH. Trước đây mọi thứ không chạy được đều gom vào một
   * câu chung chung ("ngoài phạm vi" / "Action lạ"), nên trợ lý không phân biệt được "viết sai"
   * với "thứ này đã bị bỏ" và cứ thử lại mãi. DELETE_REGEX không phải bị hạn chế theo sub-agent —
   * nó đã bị GỠ HẲN ở bug 132, và câu báo phải nói đúng thế kèm đường đi tiếp.
   */
  it('translator bị CHẶN action xoá regex, và được nói rõ là action ĐÃ GỠ (không phải "action lạ")', () => {
    const r = validateAgentAction('translator', 'DELETE_REGEX', { scriptIndex: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/đã được GỠ/);
    expect(r.reason).toMatch(/tab "Regex"/);          // chỉ đường làm đúng
    expect(r.reason).not.toMatch(/Action lạ/);
  });
  // (bug 132) Nhóm action GHI regex đã gỡ khỏi engine — không agent nào còn quyền, kể cả
  // codefixer (trước đây nó được cấp đủ 5 action này) lẫn general.
  it('KHÔNG agent nào — kể cả codefixer/general — còn được dùng action ghi regex', () => {
    for (const act of ['CREATE_REGEX', 'EDIT_REGEX', 'PATCH_REGEX_REPLACE', 'INJECT_FUNCTION', 'DELETE_REGEX']) {
      for (const agent of ['codefixer', 'general', 'translator', 'lorearchitect'] as const) {
        expect(validateAgentAction(agent, act, { scriptIndex: 0, field: 'findRegex', newValue: 'x' }).ok,
          `${agent} vẫn còn quyền ${act}`).toBe(false);
      }
    }
  });
  it('VIEW_FULL_REGEX (chỉ đọc) được GIỮ cho codefixer', () => {
    expect(validateAgentAction('codefixer', 'VIEW_FULL_REGEX', { scriptIndex: 0 }).ok).toBe(true);
  });
  it('general vẫn đủ quyền phần còn lại; action lạ vẫn bị chặn', () => {
    expect(AGENT_DEFS.general.allowedActions).toEqual(
      expect.arrayContaining(['CREATE_ENTRY', 'EDIT_ENTRY', 'DELETE_ENTRY', 'CREATE_TAVERN_HELPER', 'VIEW_FULL_REGEX', 'RUN_SCRIPT']),
    );
    expect(validateAgentAction('general', 'EDIT_ENTRY', { entryIndex: 0, field: 'content', newValue: 'x' }).ok).toBe(true);
    expect(validateAgentAction('general', 'HACK_EVERYTHING', {}).ok).toBe(false);
  });
});

describe('runInSandbox — QuickJS: kín tuyệt đối + giới hạn tài nguyên', () => {
  it('chạy code thường: console.log + giá trị cuối', async () => {
    const r = await runInSandbox('console.log("xin chào"); 1 + 2');
    expect(r.ok).toBe(true);
    expect(r.output).toContain('xin chào');
    expect(r.output).toContain('3');
  });

  it('ESCAPE TEST: fetch / window / document / localStorage / XMLHttpRequest đều KHÔNG tồn tại', async () => {
    for (const g of ['fetch', 'window', 'document', 'localStorage', 'XMLHttpRequest', 'indexedDB']) {
      const r = await runInSandbox(`typeof ${g}`);
      expect(r.ok).toBe(true);
      expect(r.output.trim()).toBe('undefined');
    }
  });

  it('while(1) bị interrupt theo deadline — không treo app', async () => {
    const r = await runInSandbox('while(true) {}', { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.durationMs).toBeLessThan(5000);
  }, 10_000);

  it('input là BẢN SAO — sandbox sửa input không lan ra ngoài', async () => {
    const data = { name: 'Long Tộc', entries: [1, 2, 3] };
    const r = await runInSandbox('input.name = "HACKED"; input.entries.length', { input: data });
    expect(r.ok).toBe(true);
    expect(r.output.trim()).toBe('3');
    expect(data.name).toBe('Long Tộc'); // bản gốc nguyên vẹn
  });

  it('lỗi runtime trong script → báo lỗi gọn, không throw ra ngoài', async () => {
    const r = await runInSandbox('null.foo');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
