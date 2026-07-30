/**
 * (bug 162 mục 3.1) Nhãn preset trong bảng kế hoạch — THÀ TRỐNG CHỨ KHÔNG SAI.
 */
import { describe, it, expect } from 'vitest';
import { attributePlanRows, inferPresetFromRow } from '../ejsPresetAttribution';
import type { EjsPlanRow } from '../ejsPlanModel';

const row = (over: Partial<EjsPlanRow>): EjsPlanRow => ({
  id: 'r1', action: 'reclassify', target: 'lorebook', name: 'Entry X',
  currentMode: 'constant', proposedMode: 'keyword',
  proposal: 'p', reason: 'r', requirement: 'q', ...over,
});

describe('chạy MỘT preset lẻ → mọi dòng gắn đúng preset đó', () => {
  it('không suy luận, gán thẳng', () => {
    const out = attributePlanRows([row({}), row({ id: 'r2', action: 'create_ejs' })], ['ui-hud']);
    expect(out.every((r) => r.presetId === 'ui-hud')).toBe(true);
    expect(out[0].presetTitle, 'phải là tên hiển thị, không phải id').toBeTruthy();
    expect(out[0].presetTitle).not.toBe('ui-hud');
  });
});

describe('gói tổng → suy từ loại thay đổi', () => {
  it('tách entry → preset tách entry gộp', () => {
    expect(inferPresetFromRow(row({ action: 'split_entry' }))).toBe('split-bloated');
  });

  it('Luôn bật → Theo từ khoá = tiết kiệm token', () => {
    expect(inferPresetFromRow(row({ currentMode: 'constant', proposedMode: 'keyword' }))).toBe('save-tokens');
  });

  it('chưa có key → Theo từ khoá = chỉnh từ khoá NPC', () => {
    expect(inferPresetFromRow(row({ currentMode: 'conditional', proposedMode: 'keyword' }))).toBe('keyword-npc');
  });

  it('chuyển sang tắt sẵn / có điều kiện = lore theo tiến trình', () => {
    expect(inferPresetFromRow(row({ proposedMode: 'conditional' }))).toBe('conditional-lore');
    expect(inferPresetFromRow(row({ proposedMode: 'disabled' }))).toBe('conditional-lore');
  });

  it('TẠO KHỐI EJS thì KHÔNG đoán — quá nhiều preset cùng tạo khối', () => {
    expect(inferPresetFromRow(row({ action: 'create_ejs' }))).toBeNull();
    expect(inferPresetFromRow(row({ action: 'edit_content' }))).toBeNull();
  });

  it('gói tổng: dòng không suy được thì để TRỐNG, không gắn bừa', () => {
    const out = attributePlanRows([row({ action: 'create_ejs' })], ['full-suite']);
    expect(out[0].presetId).toBeUndefined();
    expect(out[0].presetTitle).toBeUndefined();
  });
});

describe('chọn NHIỀU preset lẻ', () => {
  it('loại thay đổi thuộc preset đã chọn → gắn', () => {
    const out = attributePlanRows([row({ action: 'split_entry' })], ['split-bloated', 'ui-hud']);
    expect(out[0].presetId).toBe('split-bloated');
  });

  it('loại thay đổi KHÔNG thuộc preset nào đã chọn → để trống, không nói sai việc đang chạy', () => {
    const out = attributePlanRows([row({ action: 'split_entry' })], ['ui-hud', 'ui-panel']);
    expect(out[0].presetId).toBeUndefined();
  });
});

describe('không chọn preset nào (user tự gõ goal)', () => {
  it('vẫn suy được loại thay đổi rõ ràng', () => {
    const out = attributePlanRows([row({ action: 'split_entry' })], []);
    expect(out[0].presetId).toBe('split-bloated');
  });
});
