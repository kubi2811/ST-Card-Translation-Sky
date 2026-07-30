/**
 * (bugNeedFix/168 mục 2 & 3) Nhãn preset trên MỌI dòng + phủ đủ 19/19 preset.
 *
 * Hai thứ được kiểm ở đây là hai thứ user báo hỏng:
 *   • kế hoạch thiếu preset mà KHÔNG có cảnh báo nào;
 *   • dòng kế hoạch trắng nhãn mà không nói vì sao.
 */
import { describe, it, expect } from 'vitest';
import {
  extractRequestedPresets, extractDeclaredSkips, buildPresetCoverage, presetLabelFor,
} from '../ejsPresetCoverage';
import { attributePlanRows } from '../ejsPresetAttribution';
import { QUICK_PRESETS, individualPresets, type PresetCardContext } from '../ejsQuickPresets';
import type { EjsPlanRow } from '../ejsPlanModel';
import type { LorebookEntry } from '../../../types';

function row(over: Partial<EjsPlanRow> = {}): EjsPlanRow {
  return {
    id: 'r1', action: 'create_ejs', target: 'lorebook', name: 'Entry A',
    currentMode: null, proposedMode: null, proposal: 'p', reason: 'r', requirement: 'req',
    ...over,
  } as EjsPlanRow;
}

function entry(over: Record<string, unknown> = {}): LorebookEntry {
  return {
    id: 1, uid: 1, comment: 'Entry A', content: 'nội dung lore', keys: [],
    constant: true, disable: false, order: 100,
    ...over,
  } as unknown as LorebookEntry;
}

/** Goal thật do preset gói tổng dựng ra — không mô phỏng lại bằng tay. */
function fullSuiteGoal(ctx?: Partial<PresetCardContext>): string {
  const full = QUICK_PRESETS.find(p => p.id === 'full-suite')!;
  return full.build({
    schema: null,
    entries: [entry(), entry({ id: 2, uid: 2, comment: 'Entry B', constant: false, keys: ['b'] })],
    regexScripts: [], tavernScripts: [],
    ...ctx,
  }).goal;
}

describe('extractRequestedPresets — đọc dấu [preset: …] trong yêu cầu', () => {
  it('gói tổng phải kể tên ĐỦ 19 preset lẻ, dù áp hay bỏ (user đếm ra chỉ 13)', () => {
    const goal = fullSuiteGoal();
    const seen = [...extractRequestedPresets(goal), ...extractDeclaredSkips(goal).keys()];
    const all = individualPresets().map(p => p.id);
    expect(seen.sort()).toEqual(all.sort());
    expect(seen.length).toBe(19);
  });

  it('preset bị chặn KHÔNG được biến mất — phải nằm ở [preset-skip: …] kèm lý do', () => {
    // Card không có regex nào ⇒ preset orch-postfix bị chặn ("chưa có regex nào để bật").
    const skips = extractDeclaredSkips(fullSuiteGoal({ regexScripts: [] }));
    expect(skips.size).toBeGreaterThan(0);
    for (const line of skips.values()) expect(line).toMatch(/bỏ vì .+/);
  });

  it('yêu cầu user tự gõ thì không có preset nào — không được bịa ra', () => {
    expect(extractRequestedPresets('Tạo cho tôi một thanh trạng thái')).toEqual([]);
  });

  it('không đếm trùng khi một mã xuất hiện nhiều lần', () => {
    expect(extractRequestedPresets('[preset: ui-hud] … [preset: ui-hud]')).toEqual(['ui-hud']);
  });
});

describe('buildPresetCoverage — preset vắng mặt phải báo đỏ', () => {
  const goal = '━━ 1. A [preset: ui-hud] ━━\n━━ 2. B [preset: split-bloated] ━━';

  it('AI trả thiếu một mục và KHÔNG giải thích ⇒ missing + cảnh báo (ca user gặp)', () => {
    const rep = buildPresetCoverage(goal, [row({ presetId: 'ui-hud' })], []);
    expect(rep.requested).toBe(2);
    expect(rep.covered).toBe(1);
    expect(rep.missing).toBe(1);
    expect(rep.rows.find(r => r.presetId === 'split-bloated')?.status).toBe('missing');
    expect(rep.warnings.join('\n')).toMatch(/1\/2 preset/);
  });

  it('AI có ghi lý do bỏ trong notes ⇒ skipped-explained, KHÔNG báo đỏ', () => {
    const rep = buildPresetCoverage(goal, [row({ presetId: 'ui-hud' })], [
      '[preset: split-bloated] bỏ vì card không có entry nào gộp nhiều phần độc lập.',
    ]);
    expect(rep.missing).toBe(0);
    expect(rep.rows.find(r => r.presetId === 'split-bloated')?.status).toBe('skipped-explained');
    expect(rep.warnings).toEqual([]);
  });

  it('gói tổng: báo cáo luôn đủ 19 dòng và MỌI dòng đều có chữ giải thích', () => {
    const rep = buildPresetCoverage(fullSuiteGoal(), [], []);
    expect(rep.rows).toHaveLength(19);
    for (const r of rep.rows) expect(r.note.trim().length).toBeGreaterThan(10);
    // Chưa có dòng kế hoạch nào ⇒ mọi mục đặt hàng đều phải bị báo thiếu, không im lặng.
    expect(rep.missing).toBe(rep.requested);
    expect(rep.warnings.length).toBeGreaterThan(0);
  });

  it('3 preset chỉ đổi cấu hình được đánh dấu riêng — đếm chúng bằng khối EJS là sai', () => {
    const g = '[preset: save-tokens] [preset: keyword-npc] [preset: split-bloated] [preset: ui-hud]';
    const rep = buildPresetCoverage(g, [
      row({ id: 'a', presetId: 'save-tokens' }),
      row({ id: 'b', presetId: 'keyword-npc' }),
      row({ id: 'c', presetId: 'split-bloated' }),
      row({ id: 'd', presetId: 'ui-hud' }),
    ], []);
    const cfg = rep.rows.filter(r => r.evidence === 'config-change').map(r => r.presetId).sort();
    expect(cfg).toEqual(['keyword-npc', 'save-tokens', 'split-bloated']);
    expect(rep.rows.find(r => r.presetId === 'ui-hud')?.evidence).toBe('ejs-block');
  });

  it('yêu cầu không dùng preset ⇒ báo cáo rỗng, không cảnh báo vô cớ', () => {
    const rep = buildPresetCoverage('tự gõ tay', [row()], []);
    expect(rep.requested).toBe(0);
    expect(rep.warnings).toEqual([]);
  });
});

describe('attributePlanRows — lời AI khai phải thắng suy luận', () => {
  it('giữ nguyên presetId AI đã khai, kể cả loại thay đổi không suy được (gốc bug mục 2)', () => {
    // create_ejs vốn KHÔNG suy được preset nào ⇒ trước đây bị ghi đè thành trắng nhãn.
    const out = attributePlanRows([row({ action: 'create_ejs', presetId: 'ui-hud' })], ['full-suite']);
    expect(out[0].presetId).toBe('ui-hud');
    expect(out[0].presetTitle).toBeTruthy();
  });

  it('dòng chưa có nhãn vẫn được suy như cũ', () => {
    const out = attributePlanRows(
      [row({ action: 'split_entry', presetId: undefined })], ['full-suite'],
    );
    expect(out[0].presetId).toBe('split-bloated');
  });

  it('chạy một preset lẻ: dòng chưa nhãn thì gán preset đó', () => {
    const out = attributePlanRows([row({ presetId: undefined })], ['ui-hud']);
    expect(out[0].presetId).toBe('ui-hud');
  });
});

describe('presetLabelFor — không bao giờ để trống không giải thích', () => {
  it('không nhãn + có dùng preset ⇒ nói rõ vì sao không gán được', () => {
    const l = presetLabelFor(row({ presetId: undefined }), 19);
    expect(l.unknown).toBe(true);
    expect(l.text).toMatch(/Chưa rõ preset/);
  });

  it('không nhãn + user tự gõ ⇒ nói rõ là yêu cầu tự gõ, không phải lỗi', () => {
    const l = presetLabelFor(row({ presetId: undefined }), 0);
    expect(l.text).toMatch(/tự gõ/);
  });

  it('có nhãn ⇒ trả tên preset, unknown=false', () => {
    const l = presetLabelFor(row({ presetId: 'ui-hud', presetTitle: 'Thanh HUD' }), 19);
    expect(l).toEqual({ text: 'Thanh HUD', unknown: false });
  });
});
