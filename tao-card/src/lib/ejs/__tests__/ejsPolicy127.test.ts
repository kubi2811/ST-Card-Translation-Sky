/**
 * (bug 127) Rà soát lại bug 126: khả thi, có chỗ nào vỡ, có mâu thuẫn/xung đột không, và
 * "sử dụng EJS Studio phần AI tự quyết vào Auto Creator có bị lỗi hay xung đột với AI Sinh
 * Theo Batch không".
 *
 * Rà soát tìm ra HAI vấn đề thật, cả hai đều được khoá bằng test dưới đây:
 *
 *  A. XUNG ĐỘT GHI ĐÈ với "AI Sinh Theo Batch". Cả hai tính năng đều có nút "Áp dụng sang
 *     Auto Creator". Batch ghi vào `stepConfigs.lorebook` (kể cả `promptOverride`). Nếu EJS
 *     Studio cũng ghi vào đó thì bấm nút này sẽ xoá cấu hình của nút kia — user bấm cả hai mà
 *     chỉ một cái sống. Đã tách sang field riêng `appliedEjsPolicy`; test dưới chứng minh hai
 *     đường cùng tồn tại.
 *
 *  B. MÂU THUẪN NỘI BỘ của chính cơ chế phân loại (do bug 126 mang vào). Chuyển entry sang
 *     "kích hoạt theo điều kiện" nghĩa là TẮT nó và giao cho controller EJS bật lại. Nếu
 *     controller không được tạo — user từ chối dòng đó, hoặc AI quên — entry chết vĩnh viễn,
 *     KHÔNG có lỗi đỏ nào: lore chỉ lặng lẽ biến mất. Nay bắt ở cả hai chỗ.
 */
import { describe, it, expect } from 'vitest';
import { buildEjsPolicy, isCardReadyForPolicy } from '../ejsPolicy';
import { findOrphanConditionalEntries, type EjsPlanRow, type EjsRichPlan } from '../ejsPlanModel';
import { useAutoCreatorStore } from '../../../store/autoCreatorStore';

function row(p: Partial<EjsPlanRow> & { id: string; name: string }): EjsPlanRow {
  return {
    id: p.id, name: p.name,
    action: p.action ?? 'reclassify',
    target: p.target ?? 'lorebook',
    currentMode: p.currentMode ?? 'constant',
    proposedMode: p.proposedMode ?? 'keyword',
    proposal: p.proposal ?? 'đổi chế độ',
    reason: p.reason ?? 'không phải quy tắc bắt buộc',
    requirement: p.requirement ?? '',
    tokensSaved: p.tokensSaved,
  };
}

const plan = (rows: EjsPlanRow[]): EjsRichPlan => ({
  scope: 'tối ưu token', rows, notes: [], warnings: [], estCalls: 1,
});

describe('A. EJS Studio ↔ AI Sinh Theo Batch — hai nút áp dụng KHÔNG được xoá nhau', () => {
  it('Batch ghi stepConfigs.lorebook, EJS ghi appliedEjsPolicy — cùng tồn tại', () => {
    const store = useAutoCreatorStore.getState();

    // 1) "AI Sinh Theo Batch" áp cấu hình của nó (đúng những field panel đó ghi).
    store.updateStepConfig('lorebook', {
      totalEntries: 45,
      entriesPerBatch: 5,
      concurrentBatches: 3,
      promptOverride: 'Prompt riêng của Batch',
      promptMode: 'append',
    });

    // 2) EJS Studio áp chính sách của nó.
    const p = buildEjsPolicy(
      plan([
        row({ id: 'r1', name: 'NPC: Lâm Uyển', proposedMode: 'keyword', tokensSaved: 150 }),
        row({ id: 'r2', name: 'Bộ điều khiển cảnh giới', action: 'create_ejs', currentMode: null, proposedMode: null, requirement: 'sinh controller' }),
      ]),
      new Set(['r1', 'r2']), 'Thiên Ý', 'tiết kiệm token', '2026-07-27T00:00:00.000Z',
    );
    useAutoCreatorStore.getState().applyEjsPolicy(p);

    // 3) Cả hai vẫn còn nguyên — đây chính là điều 127 hỏi.
    const cfg = useAutoCreatorStore.getState().config;
    expect(cfg.stepConfigs.lorebook.promptOverride).toBe('Prompt riêng của Batch');
    expect(cfg.stepConfigs.lorebook.totalEntries).toBe(45);
    expect(cfg.appliedEjsPolicy?.rowCount).toBe(2);
    expect(cfg.appliedEjsPolicy?.sourceCard).toBe('Thiên Ý');
  });

  it('gỡ chính sách EJS không đụng tới cấu hình của Batch', () => {
    useAutoCreatorStore.getState().clearEjsPolicy();
    const cfg = useAutoCreatorStore.getState().config;
    expect(cfg.appliedEjsPolicy).toBeUndefined();
    expect(cfg.stepConfigs.lorebook.promptOverride).toBe('Prompt riêng của Batch');
  });

  it('chính sách chưng cất thành NGUYÊN TẮC, không chép tên entry của card nguồn', () => {
    const p = buildEjsPolicy(
      plan([row({ id: 'r1', name: 'NPC: Lâm Uyển', proposedMode: 'keyword' })]),
      new Set(['r1']), 'Thiên Ý', 'x', '2026-07-27T00:00:00.000Z',
    );
    // Tên entry của card cũ mà lọt sang là vô nghĩa với card mới.
    expect(p.directive).not.toContain('Lâm Uyển');
    expect(p.directive).toContain('Theo từ khoá');
  });

  it('chính sách có dòng "conditional" phải dặn dùng activewi và cấm setEntryEnabled', () => {
    const p = buildEjsPolicy(
      plan([row({ id: 'r1', name: 'Cảnh giới', proposedMode: 'conditional' })]),
      new Set(['r1']), 'X', 'y', '2026-07-27T00:00:00.000Z',
    );
    expect(p.directive).toContain('activewi');
    expect(p.directive).toContain('setEntryEnabled');   // nêu để CẤM
  });
});

describe('A2. nút áp dụng chỉ bật khi card đã tạo xong (điều kiện user đặt)', () => {
  it('card trống → chưa sẵn sàng, nêu rõ thiếu gì', () => {
    const r = isCardReadyForPolicy({ data: {} });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('tên nhân vật');
    expect(r.missing.join(' ')).toContain('lorebook');
  });

  it('card đủ tên + mô tả + lorebook → sẵn sàng', () => {
    const r = isCardReadyForPolicy({
      data: { name: 'Thiên Ý', description: 'abc', character_book: { entries: [{}] } },
    });
    expect(r).toEqual({ ready: true, missing: [] });
  });
});

describe('B. MÂU THUẪN: entry tắt để chờ điều kiện mà không controller nào bật', () => {
  const rows = [
    row({ id: 'r1', name: 'Bí cảnh Kim Đan', proposedMode: 'conditional' }),
    row({ id: 'r2', name: 'Hầm mộ cổ', proposedMode: 'conditional' }),
  ];

  it('không có code nào gọi activewi cho chúng → báo cả hai là mồ côi', () => {
    expect(findOrphanConditionalEntries(rows, [])).toEqual(['Bí cảnh Kim Đan', 'Hầm mộ cổ']);
  });

  it('controller bật đúng một entry → chỉ entry còn lại là mồ côi', () => {
    const code = ["@@preprocessing\n<%_ if (_cg === 'Kim Đan') { await activewi('Bí cảnh Kim Đan', true); } _%>"];
    expect(findOrphanConditionalEntries(rows, code)).toEqual(['Hầm mộ cổ']);
  });

  it('getwi cũng tính là có người dùng tới entry đó', () => {
    const code = ["<%- await getwi(null, 'Hầm mộ cổ') %>"];
    expect(findOrphanConditionalEntries([rows[1]], code)).toEqual([]);
  });

  it('tên entry chứa ký tự đặc biệt của regex không làm hàm nổ', () => {
    const r = [row({ id: 'r9', name: 'Bí cảnh (tầng 1) [ẩn]', proposedMode: 'conditional' })];
    expect(() => findOrphanConditionalEntries(r, [])).not.toThrow();
    expect(findOrphanConditionalEntries(r, ["await activewi('Bí cảnh (tầng 1) [ẩn]', true);"])).toEqual([]);
  });

  it('dòng không phải conditional thì không bị soi', () => {
    expect(findOrphanConditionalEntries([row({ id: 'r1', name: 'A', proposedMode: 'keyword' })], [])).toEqual([]);
  });
});
