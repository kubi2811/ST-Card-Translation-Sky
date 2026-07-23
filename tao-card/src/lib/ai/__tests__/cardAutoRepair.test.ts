import { describe, it, expect } from 'vitest';
import {
  repairInitvarEnabled,
  repairUnclosedFence,
  repairModuleHandlers,
  repairDataVarCasing,
  repairMissingAnchors,
  repairAnchorClash,
  autoRepairCard,
} from '../cardAutoRepair';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from '../../mvuzod/regexAnchors';
import type { CharacterCardV3, LorebookEntry } from '../../../types';

/**
 * (User 22/07 — việc 82) Kiểm tra tổng thể xong hiện ra một đống lỗi mà user phải tự sửa tay.
 * Phần lớn trong số đó là lỗi CƠ HỌC — biết chính xác phải sửa thế nào. Bộ này vá tất định,
 * không gọi AI, chạy lại bao nhiêu lần cũng ra cùng kết quả.
 */

const FENCE = '`'.repeat(3);

const entry = (o: Partial<LorebookEntry>): LorebookEntry => ({
  id: 1, keys: [], content: '', comment: '', enabled: true, constant: false,
  insertion_order: 100, selective: false, position: 'before_char', ...o,
} as LorebookEntry);

const mkCard = (o: Record<string, unknown> = {}): CharacterCardV3 => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'Nhân vật', description: 'Mô tả đủ dài để không bị coi là thiếu',
    first_mes: 'Xin chào', personality: '', scenario: '', mes_example: '',
    creator_notes: '', system_prompt: '', post_history_instructions: '',
    tags: [], creator: '', character_version: '', alternate_greetings: [],
    extensions: { regex_scripts: [] },
    ...o,
  },
} as unknown as CharacterCardV3);

describe('repairInitvarEnabled — entry khởi tạo biến phải TẮT', () => {
  it('entry [initvar] đang bật → tắt (lỗi im lặng gây "变量更新失败")', () => {
    const r = repairInitvarEnabled([entry({ comment: '[initvar] Khởi tạo', content: '[initvar]\nx: 1', enabled: true })]);
    expect((r.entries[0] as { enabled?: boolean }).enabled).toBe(false);
    expect(r.fixed[0].id).toBe('initvar_enabled');
  });

  it('entry [initvar] đã tắt sẵn → không đụng vào', () => {
    const r = repairInitvarEnabled([entry({ content: '[initvar]', enabled: false })]);
    expect(r.fixed).toHaveLength(0);
  });

  it('entry thường đang bật → KHÔNG bị tắt oan', () => {
    const r = repairInitvarEnabled([entry({ comment: 'Bối cảnh', content: 'Nội dung thường', enabled: true })]);
    expect(r.fixed).toHaveLength(0);
    expect((r.entries[0] as { enabled?: boolean }).enabled).toBe(true);
  });
});

describe('repairUnclosedFence — thiếu fence đóng thì ST không render', () => {
  it('mở ```html mà thiếu fence đóng → thêm vào cuối', () => {
    const r = repairUnclosedFence([{ scriptName: 'UI', replaceString: FENCE + 'html\n<div>a</div>' }]);
    expect(r.scripts[0].replaceString!.endsWith('\n' + FENCE)).toBe(true);
    expect(r.fixed[0].id).toBe('unclosed_fence');
  });

  it('đã đóng fence đúng → không đụng', () => {
    const src = FENCE + 'html\n<div>a</div>\n' + FENCE;
    const r = repairUnclosedFence([{ replaceString: src }]);
    expect(r.scripts[0].replaceString).toBe(src);
    expect(r.fixed).toHaveLength(0);
  });

  it('script không mở fence → bỏ qua', () => {
    const r = repairUnclosedFence([{ replaceString: '<div>a</div>' }]);
    expect(r.fixed).toHaveLength(0);
  });
});

describe('repairModuleHandlers — nút bấm không chạy vì hàm kẹt trong module', () => {
  it('hàm khai báo trong module, gọi từ onclick= → gán ra window', () => {
    const rep = `<button onclick="doIt()">X</button><script type="module">function doIt(){}</script>`;
    const r = repairModuleHandlers([{ scriptName: 'Form', findRegex: OPENING_FORM_ANCHOR, replaceString: rep }]);
    expect(r.scripts[0].replaceString).toContain('window.doIt = doIt;');
    expect(r.scripts[0].replaceString!.indexOf('window.doIt')).toBeLessThan(
      r.scripts[0].replaceString!.toLowerCase().lastIndexOf('</script>'),
    );
    expect(r.fixed[0].id).toBe('module_handler');
  });

  it('đã gán window rồi → không gán lần hai', () => {
    const rep = `<button onclick="doIt()">X</button><script type="module">function doIt(){}\nwindow.doIt = doIt;</script>`;
    const r = repairModuleHandlers([{ replaceString: rep }]);
    expect(r.fixed).toHaveLength(0);
  });

  it('hàm KHÔNG khai báo trong script này → KHÔNG gán bừa (gán bừa tạo lỗi mới)', () => {
    const rep = `<button onclick="khongCo()">X</button><script type="module">const a = 1;</script>`;
    const r = repairModuleHandlers([{ replaceString: rep }]);
    expect(r.fixed).toHaveLength(0);
    expect(r.scripts[0].replaceString).not.toContain('window.khongCo');
  });

  it('script thường (không phải module) → không cần vá', () => {
    const rep = `<button onclick="doIt()">X</button><script>function doIt(){}</script>`;
    const r = repairModuleHandlers([{ replaceString: rep }]);
    expect(r.fixed).toHaveLength(0);
  });

  it('vá được nhiều hàm cùng lúc', () => {
    const rep = `<b onclick="a()"></b><b onchange="b()"></b><script type="module">function a(){};const b = () => {}</script>`;
    const r = repairModuleHandlers([{ replaceString: rep }]);
    expect(r.scripts[0].replaceString).toContain('window.a = a;');
    expect(r.scripts[0].replaceString).toContain('window.b = b;');
  });
});

describe('repairDataVarCasing — data-var lệch tên thì UI hiện trống', () => {
  const vars = ['Cảnh Giới', 'Máu'];

  it('lệch hoa/thường → sửa về đúng tên schema', () => {
    const r = repairDataVarCasing([{ replaceString: '<span data-var="cảnh giới"></span>' }], vars);
    expect(r.scripts[0].replaceString).toContain('data-var="Cảnh Giới"');
    expect(r.fixed[0].id).toBe('data_var_mismatch');
  });

  it('lệch dấu gạch dưới → sửa về đúng tên schema', () => {
    const r = repairDataVarCasing([{ replaceString: "<span data-var='Cảnh_Giới'></span>" }], vars);
    expect(r.scripts[0].replaceString).toContain("data-var='Cảnh Giới'");
  });

  it('đã đúng → không đụng', () => {
    const src = '<span data-var="Máu"></span>';
    const r = repairDataVarCasing([{ replaceString: src }], vars);
    expect(r.scripts[0].replaceString).toBe(src);
    expect(r.fixed).toHaveLength(0);
  });

  it('tên sai HẲN → không đoán bừa, đẩy vào unresolved', () => {
    const r = repairDataVarCasing([{ replaceString: '<span data-var="LinhThach"></span>' }], vars);
    expect(r.fixed).toHaveLength(0);
    expect(r.unresolved).toContain('LinhThach');
  });

  it('hai biến schema lỏng-trùng nhau → không dám đoán', () => {
    const r = repairDataVarCasing([{ replaceString: '<span data-var="mau"></span>' }], ['Máu', 'M_a_u', 'mau']);
    // 'mau' khớp chính xác một biến có thật ⇒ không phải lỗi
    expect(r.fixed).toHaveLength(0);
  });
});

describe('repairAnchorClash — hai script cùng bám 1 mỏ neo thì chỉ cái đầu chạy', () => {
  it('tắt script render trùng phía sau, giữ cái đầu', () => {
    const r = repairAnchorClash([
      { scriptName: 'A', findRegex: STATUS_BAR_ANCHOR, replaceString: 'x' },
      { scriptName: 'B', findRegex: STATUS_BAR_ANCHOR, replaceString: 'y' },
    ]);
    expect(r.scripts[0].disabled).toBeUndefined();
    expect(r.scripts[1].disabled).toBe(true);
    expect(r.fixed).toHaveLength(1);
  });

  it('vế ẩn (promptOnly) không tranh chỗ render → không bị tắt', () => {
    const r = repairAnchorClash([
      { findRegex: STATUS_BAR_ANCHOR, promptOnly: true },
      { findRegex: STATUS_BAR_ANCHOR, markdownOnly: true },
    ]);
    expect(r.fixed).toHaveLength(0);
  });

  it('mỗi mỏ neo một script → không đụng', () => {
    const r = repairAnchorClash([
      { findRegex: STATUS_BAR_ANCHOR }, { findRegex: OPENING_FORM_ANCHOR },
    ]);
    expect(r.fixed).toHaveLength(0);
  });
});

describe('repairMissingAnchors — thiếu mỏ neo thì giao diện không có chỗ bám', () => {
  it('chèn mỏ neo vào first_mes', () => {
    const r = repairMissingAnchors(mkCard({ first_mes: 'Chào bạn' }), [STATUS_BAR_ANCHOR]);
    expect(r.card.data.first_mes).toContain(STATUS_BAR_ANCHOR);
    expect(r.fixed[0].id).toBe('missing_anchor');
  });

  it('chèn vào cả lời chào phụ', () => {
    const r = repairMissingAnchors(mkCard({ alternate_greetings: ['Chào 1', 'Chào 2'] }), [STATUS_BAR_ANCHOR]);
    expect(r.card.data.alternate_greetings!.every((g: string) => g.includes(STATUS_BAR_ANCHOR))).toBe(true);
  });

  it('đã có mỏ neo → không chèn lần hai', () => {
    const r = repairMissingAnchors(mkCard({ first_mes: 'Chào\n' + STATUS_BAR_ANCHOR }), [STATUS_BAR_ANCHOR]);
    expect(r.fixed).toHaveLength(0);
  });

  it('không có mỏ neo nào cần chèn → trả nguyên card', () => {
    expect(repairMissingAnchors(mkCard(), []).fixed).toHaveLength(0);
  });
});

describe('autoRepairCard — chạy cả lượt', () => {
  it('vá nhiều lỗi cùng lúc và KHÔNG sửa vào card gốc', () => {
    const card = mkCard({
      first_mes: 'Chào bạn',
      character_book: { name: 'LB', entries: [entry({ comment: '[initvar]', content: '[initvar]\nx: 1', enabled: true })] },
      extensions: {
        regex_scripts: [
          { scriptName: 'UI', findRegex: STATUS_BAR_ANCHOR, replaceString: FENCE + 'html\n<div data-var="cảnh giới"></div>' },
        ],
      },
    });
    const before = JSON.stringify(card);
    const r = autoRepairCard(card, { fields: [{ path: '/Cảnh Giới', name: 'Cảnh Giới', type: 'string' }] } as never);

    expect(JSON.stringify(card)).toBe(before);          // card gốc không bị đụng
    expect(r.fixed.map(f => f.id)).toContain('initvar_enabled');
    expect(r.fixed.map(f => f.id)).toContain('unclosed_fence');
    expect(r.fixed.map(f => f.id)).toContain('missing_anchor');
    expect(r.card.data.first_mes).toContain(STATUS_BAR_ANCHOR);
  });

  it('card đã sạch → không vá gì, không báo cần AI', () => {
    const card = mkCard({
      first_mes: 'Chào bạn',
      character_book: { name: 'LB', entries: [entry({ comment: 'Bối cảnh', content: 'Nội dung' })] },
    });
    const r = autoRepairCard(card, null);
    expect(r.fixed).toHaveLength(0);
    expect(r.needsAi).toHaveLength(0);
  });

  it('lỗi cần SÁNG TÁC nội dung → đẩy sang needsAi chứ không bịa', () => {
    const r = autoRepairCard(mkCard({ name: '', description: '', first_mes: '' }), null);
    expect(r.needsAi.join(' ')).toMatch(/tên/i);
    expect(r.needsAi.join(' ')).toMatch(/mô tả/i);
    expect(r.needsAi.join(' ')).toMatch(/first message/i);
  });

  it('KHÔNG chèn mỏ neo mà chẳng script nào bám vào', () => {
    const r = autoRepairCard(mkCard({ first_mes: 'Chào' }), null);
    expect(r.card.data.first_mes).not.toContain(STATUS_BAR_ANCHOR);
  });

  it('chạy hai lần liên tiếp → lần hai không còn gì để vá (tất định, hội tụ)', () => {
    const card = mkCard({
      first_mes: 'Chào',
      character_book: { name: 'LB', entries: [entry({ content: '[initvar]', enabled: true })] },
      extensions: { regex_scripts: [{ findRegex: STATUS_BAR_ANCHOR, replaceString: FENCE + 'html\n<b>x</b>' }] },
    });
    const first = autoRepairCard(card, null);
    expect(first.fixed.length).toBeGreaterThan(0);
    const second = autoRepairCard(first.card, null);
    expect(second.fixed).toHaveLength(0);
  });
});
