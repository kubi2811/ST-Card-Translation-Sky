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
  it('translator bị CHẶN action xoá regex (ngoài whitelist)', () => {
    const r = validateAgentAction('translator', 'DELETE_REGEX', { scriptIndex: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ngoài phạm vi');
  });
  it('codefixer được EDIT_REGEX nhưng params sai schema (thiếu field) → CHẶN', () => {
    expect(validateAgentAction('codefixer', 'EDIT_REGEX', { scriptIndex: 0, field: 'findRegex', newValue: 'x' }).ok).toBe(true);
    const bad = validateAgentAction('codefixer', 'EDIT_REGEX', { scriptIndex: -1, field: 'findRegex', newValue: 'x' });
    expect(bad.ok).toBe(false);
  });
  it('general đủ quyền như cũ (zero regression); action lạ vẫn bị chặn', () => {
    expect(AGENT_DEFS.general.allowedActions.length).toBeGreaterThanOrEqual(11);
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
