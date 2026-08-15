/**
 * (bug 236) "AI DÙNG ACTION LẠ VÀ BỊ CHẶN".
 * ─────────────────────────────────────────────────────────────────────────────
 * User gửi ảnh: trợ lý bị chặn với "Action lạ: VIEW_FULL_ENTRY", nó xin lỗi ("có vẻ tôi đã định
 * dạng sai khối lệnh"), gửi lại — và bị chặn y hệt. Lặp mãi, người dùng phải nhảy vào.
 *
 * GỐC RỄ: có HAI danh sách action phải khớp nhau mà KHÔNG GÌ BẮT chúng khớp.
 *   • `allowedActions` của từng sub-agent — VIEW_FULL_ENTRY CÓ trong cả bốn.
 *   • `ACTION_SCHEMAS` — VIEW_FULL_ENTRY KHÔNG có.
 * Cổng whitelist cho qua, tới cổng schema thì `schema` là undefined ⇒ trả "Action lạ". Tức là
 * VIEW_FULL_ENTRY bị chặn 100% số lần, ở CẢ BỐN sub-agent, kể từ khi lớp orchestrator ra đời —
 * cả tính năng "đọc trọn entry" của bug 166-2 chưa từng chạy được lần nào.
 *
 * Và chính app lại đang IN VÀO NGỮ CẢNH câu "dùng VIEW_FULL_ENTRY với entryIndex=… để đọc trọn"
 * ở mỗi entry bị cắt. App dạy một đằng, chặn một nẻo — trợ lý làm đúng lời dặn rồi bị phạt.
 *
 * Test khoá ba tầng: (1) bất biến hai-danh-sách-phải-khớp, (2) VIEW_FULL_ENTRY chạy được,
 * (3) câu từ chối phải DẠY được cách sửa — đây mới là thứ cắt vòng lặp.
 */
import { describe, it, expect } from 'vitest';
import {
  validateAgentAction, isEngineAction, ALL_ACTIONS, AGENT_DEFS,
  type AgentId,
} from '../agentOrchestrator';

const AGENTS = Object.keys(AGENT_DEFS) as AgentId[];

describe('(bug 236) bất biến: whitelist và bảng schema phải khớp nhau', () => {
  /**
   * Đây là test QUAN TRỌNG NHẤT của bug này. Bản thân lỗi chỉ là thiếu một dòng; thứ để nó sống
   * sót được là không ai kiểm hai danh sách có khớp không. Kiểu `Record<EngineAction, …>` đã bắt
   * lỗi ở tầng biên dịch, test này là lưới thứ hai và nói rõ VÌ SAO cho người đọc sau.
   */
  it('MỌI action nằm trong whitelist của một sub-agent đều phải qua được cổng schema', () => {
    const okParams: Record<string, Record<string, unknown>> = {
      CREATE_ENTRY: { keys: ['a'], content: 'x' },
      EDIT_ENTRY: { entryIndex: 0, field: 'content', newValue: 'x' },
      DELETE_ENTRY: { entryIndex: 0 },
      CREATE_TAVERN_HELPER: { name: 'n', content: 'c' },
      VIEW_FULL_REGEX: { scriptIndex: 0 },
      VIEW_FULL_ENTRY: { entryIndex: 0 },
      RUN_SCRIPT: { code: '1' },
    };
    for (const agent of AGENTS) {
      for (const action of AGENT_DEFS[agent].allowedActions) {
        const r = validateAgentAction(agent, action, okParams[action]);
        expect(r.ok, `${agent} / ${action}: ${r.reason}`).toBe(true);
      }
    }
  });

  it('mọi action trong whitelist đều phải là action engine thật sự cài đặt', () => {
    for (const agent of AGENTS) {
      for (const action of AGENT_DEFS[agent].allowedActions) {
        expect(isEngineAction(action), `${agent} / ${action}`).toBe(true);
      }
    }
  });
});

describe('(bug 236) VIEW_FULL_ENTRY — action trong ảnh user gửi', () => {
  it('chạy được ở CẢ BỐN sub-agent (trước đây bị chặn 100%)', () => {
    for (const agent of AGENTS) {
      expect(validateAgentAction(agent, 'VIEW_FULL_ENTRY', { entryIndex: 35 }).ok, agent).toBe(true);
    }
  });

  it('nhận cả cách gọi theo TÊN entry — executor vốn đã hỗ trợ', () => {
    expect(validateAgentAction('general', 'VIEW_FULL_ENTRY', { name: 'Chiến đấu' }).ok).toBe(true);
  });

  it('thiếu cả entryIndex lẫn name thì chặn, và nói rõ cần gì', () => {
    const r = validateAgentAction('general', 'VIEW_FULL_ENTRY', {});
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/entryIndex/);
    expect(r.reason).toMatch(/name/);
  });

  it('entryIndex âm vẫn bị chặn — schema không nới lỏng thành vô dụng', () => {
    expect(validateAgentAction('general', 'VIEW_FULL_ENTRY', { entryIndex: -1 }).ok).toBe(false);
  });
});

describe('(bug 236) câu từ chối phải DẠY được cách sửa — đây là thứ cắt vòng lặp', () => {
  it('action engine KHÔNG có ⇒ liệt kê action hợp lệ, không nói cụt "Action lạ"', () => {
    const r = validateAgentAction('general', 'DOC_TOAN_BO_THE', {});
    expect(r.ok).toBe(false);
    // Phải kèm đường đi tiếp: danh sách thật để trợ lý chọn lại.
    for (const a of ALL_ACTIONS) expect(r.reason).toContain(a);
  });

  it('action có thật nhưng ngoài quyền ⇒ nói rõ sub-agent nào đang chạy + quyền của nó', () => {
    // translator không được xoá entry.
    const r = validateAgentAction('translator', 'DELETE_ENTRY', { entryIndex: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Translator/);
    expect(r.reason).toMatch(/EDIT_ENTRY/);          // liệt kê quyền thực có
    expect(r.reason).not.toMatch(/Action lạ/);        // KHÔNG được nói là action lạ
  });

  it('sai tham số ⇒ chỉ đích danh tham số hỏng VÀ nêu tham số bắt buộc', () => {
    const r = validateAgentAction('general', 'EDIT_ENTRY', { entryIndex: 'ba' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/entryIndex/);
    expect(r.reason).toMatch(/Cần:/);
  });

  it('ba nhánh từ chối phải PHÂN BIỆT ĐƯỢC với nhau — nếu không trợ lý chữa sai bệnh', () => {
    const laA = validateAgentAction('general', 'KHONG_CO_THAT', {}).reason || '';
    const ngoaiQuyen = validateAgentAction('translator', 'DELETE_ENTRY', { entryIndex: 0 }).reason || '';
    const saiThamSo = validateAgentAction('general', 'DELETE_ENTRY', {}).reason || '';
    expect(new Set([laA, ngoaiQuyen, saiThamSo]).size).toBe(3);
    expect(laA).toMatch(/Engine không có/);
    expect(ngoaiQuyen).toMatch(/ngoài quyền/);
    expect(saiThamSo).toMatch(/sai tham số/);
  });
});
