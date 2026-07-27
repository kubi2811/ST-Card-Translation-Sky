/**
 * (bugNeedFix/125) Test bám đúng hai lỗi đỏ user gặp khi chơi thẻ có "EJS điều khiển":
 *   1) setEntryEnabled is not defined
 *   2) Unexpected token '<' while compiling ejs … at line: 1, column: 1
 *
 * Chiến lược: tái tạo NGUYÊN hình dạng code mà bản cũ sinh ra, chứng minh bộ kiểm bắt được;
 * rồi chạy chính generator hiện tại trên nhiều hình dạng nhóm và đòi hỏi TẤT CẢ đều sạch.
 */
import { describe, it, expect } from 'vitest';
import { validateWorldbookEjs, ejsToLintableJs, activationLine } from '../../ejs/stptApi';
import { __testables } from '../tctrlGenerator';

const { generateFallbackGateKeeper, generateFallbackGroupController } = __testables;

// ── Hình dạng code bản CŨ sinh ra (lấy từ git HEAD trước fix) ────────────────
// Nhánh getwi: mở <%_ → đóng _%> → MỞ LẠI <%_ mà không đóng → thẻ <%# kế tiếp lọt vào JS.
const OLD_GETWI_SHAPE = [
  '@@preprocessing',
  '<%# @@TCTRL::Group_0 — Nhân vật phụ Controller — DO NOT READ %>',
  '<%_',
  '// ═══ GROUP: Nhân vật phụ ═══',
  '// --- Entries điều khiển bằng biến (1) ---',
  '_%>',
  "<%_ if (_quan_he >= 3) { _%>",
  "<%- await getwi(null, 'NPC: Lâm Uyển') %>",
  '<%_ } _%>',
  '<%_',
  '<%# Load entries quan trọng (1) %>',
  "<%- await getwi(null, 'Thiết lập thế giới') %>",
].join('\n');

// Nhánh normal bản cũ: gọi API không tồn tại.
const OLD_NORMAL_SHAPE = [
  '@@preprocessing',
  '<%# @@TCTRL::Group_1 — DO NOT READ %>',
  '<%_',
  "setEntryEnabled('NPC: Lâm Uyển', _quan_he >= 3); // ~420 tokens",
  '_%>',
].join('\n');

describe('bug 125 — bằng chứng lỗi của bản cũ', () => {
  it("khối <%_ mở lại không đóng → ký tự '<' lọt vào JS (đúng lỗi Unexpected token '<')", () => {
    const { js } = ejsToLintableJs(OLD_GETWI_SHAPE);
    // Vì đang trong scriptlet hở, thẻ <%# kế tiếp bị TRẢ NGUYÊN thay vì xoá thành khoảng trắng.
    // Extension không báo "thiếu thẻ đóng" — nó để acorn vấp đúng ký tự '<' này.
    expect(js).toContain('<%#');

    const res = validateWorldbookEjs(OLD_GETWI_SHAPE);
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/không parse được/);
    expect(res.problems.join(' ')).toMatch(/Unexpected token/);
  });

  it('khối mở rồi bỏ hở tới cuối entry cũng bị bắt', () => {
    const code = '@@preprocessing\n<%_\nvar x = 1;';
    const res = validateWorldbookEjs(code);
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toContain('chưa đóng');
  });

  it('setEntryEnabled bị loại — API không tồn tại trong ST-Prompt-template', () => {
    const res = validateWorldbookEjs(OLD_NORMAL_SHAPE);
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toContain('setEntryEnabled');
  });

  it('các API bịa khác cũng bị loại', () => {
    for (const fn of ['activateEntry', 'enableWorldInfo', 'disableWorldInfo', 'setEntryContent']) {
      const code = `@@preprocessing\n<%_\n${fn}('X', true);\n_%>`;
      expect(validateWorldbookEjs(code).ok).toBe(false);
    }
  });

  it('thiếu await ở activewi/getwi bị bắt', () => {
    const code = "@@preprocessing\n<%_\nactivewi('NPC: A');\n_%>";
    const res = validateWorldbookEjs(code);
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toContain('thiếu await');
  });
});

describe('bug 125 — code hợp lệ phải được chấp nhận', () => {
  it('mẫu kích hoạt có điều kiện đúng chuẩn', () => {
    const code = [
      '@@preprocessing',
      '<%# @@TCTRL::Group_0 — DO NOT READ %>',
      '<%_',
      "if (typeof _quan_he === 'undefined') var _quan_he = getvar('stat_data.quan he', { defaults: 0 });",
      activationLine('NPC: Lâm Uyển', '_quan_he >= 3'),
      '_%>',
    ].join('\n');
    expect(validateWorldbookEjs(code)).toEqual({ ok: true, problems: [] });
  });

  it('mẫu getwi có điều kiện đúng chuẩn', () => {
    const code = [
      '@@preprocessing',
      '<%# @@TCTRL::Group_0 — DO NOT READ %>',
      "<%_ if (matchChatMessages(['Lâm Uyển'])) { _%>",
      "<%- await getwi(null, 'NPC: Lâm Uyển') %>",
      '<%_ } _%>',
    ].join('\n');
    expect(validateWorldbookEjs(code)).toEqual({ ok: true, problems: [] });
  });

  it('chú thích // có xuống dòng vẫn hợp lệ (không bắt oan)', () => {
    const code = '@@preprocessing\n<%_\n// ghi chú\nvar x = 1;\n_%>';
    expect(validateWorldbookEjs(code).ok).toBe(true);
  });
});

// ── Generator hiện tại phải sạch trên MỌI hình dạng nhóm ─────────────────────
function mkGroup(id: number, strategy: 'constant' | 'normal' | 'getwi') {
  return {
    id, name: `Nhóm ${id}`, strategy, hierarchy: 1,
    entries: [1, 2, 3], totalTokens: 3000, budgetAllocation: 1500,
  } as never;
}

function mkEntries(withHint: boolean, priority: string) {
  return [1, 2, 3].map(i => ({
    id: i,
    comment: `NPC: Nhân vật ${i} 'có nháy'`,
    priority,
    tokens: 300,
    controlHint: withHint
      ? { variableName: 'quan he', condition: ">= 3", entryId: i, source: 'mvuzod' }
      : undefined,
  })) as never[];
}

describe('bug 125 — generator hiện tại sinh EJS luôn hợp lệ', () => {
  const cases: Array<[string, 'constant' | 'normal' | 'getwi', boolean, string]> = [
    ['constant', 'constant', false, 'medium'],
    ['normal + có biến', 'normal', true, 'medium'],
    ['normal + KHÔNG biến', 'normal', false, 'low'],
    ['getwi + có biến', 'getwi', true, 'medium'],
    ['getwi + KHÔNG biến (ca làm vỡ bản cũ)', 'getwi', false, 'low'],
    ['getwi + KHÔNG biến + high', 'getwi', false, 'high'],
  ];

  for (const [label, strategy, withHint, priority] of cases) {
    it(`group controller — ${label}`, () => {
      const code = generateFallbackGroupController(mkGroup(0, strategy), mkEntries(withHint, priority));
      const res = validateWorldbookEjs(code);
      expect(res.problems).toEqual([]);
      expect(code).not.toContain('setEntryEnabled');
    });
  }

  it('gate keeper', () => {
    const analysis = {
      totalEntries: 120, totalTokens: 60000, effectiveBudget: 20000,
      groups: [mkGroup(0, 'normal'), mkGroup(1, 'getwi')],
      variables: [
        { name: 'quan he', source: 'mvuzod', type: 'number', defaultValue: 0, getvarPath: 'stat_data.quan he', affectedEntries: [1] },
        { name: 'khu vuc', source: 'auto', type: 'string', defaultValue: 'thanh pho', getvarPath: 'stat_data.@@tctrl.khu vuc', affectedEntries: [2] },
      ],
      deadEntries: [], duplicates: [],
    } as never;
    const res = validateWorldbookEjs(generateFallbackGateKeeper(analysis));
    expect(res.problems).toEqual([]);
  });
});
