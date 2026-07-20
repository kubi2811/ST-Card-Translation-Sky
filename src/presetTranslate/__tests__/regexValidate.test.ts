// (User 20/07) Phase C: regex 'auto' (CJK ⊆ dict) thay + compile check; 'manual' giữ nguyên.
// validatePreset = hàng rào cuối: field đóng băng / identifier / subtree không đụng.
import { describe, it, expect } from 'vitest';
import { decideRegex, transformRegex, splitStRegex } from '../regexScriptPass';
import { validatePreset } from '../validatePreset';
import { emptyPresetDict } from '../types';
import type { STPreset, PresetPromptEntry } from '../../types/card';

const DICT = { ...emptyPresetDict(), tags: { 状态面板: 'Bảng trạng thái', 正文: 'Chính văn' } };

describe('decideRegex — auto khi CJK được dict phủ TRỌN, manual khi có cụm lạ', () => {
  it('regex tag thuần → auto (đúng nhóm 9 regex sample được dịch)', () => {
    expect(decideRegex('<状态面板>[\\s\\S]*?</状态面板>', DICT)).toBe('auto');
    expect(decideRegex('### 正文', DICT)).toBe('auto');
    // Cụm ghép từ 2 key liền nhau vẫn coi là phủ trọn
    expect(decideRegex('正文状态面板', DICT)).toBe('auto');
  });

  it('blocklist văn phong (từ lạ) → manual (đúng nhóm 27 sample giữ nguyên)', () => {
    expect(decideRegex('死死[的地]?|一抹|极其', DICT)).toBe('manual');
  });

  it('không CJK → none', () => {
    expect(decideRegex('^\\s+', DICT)).toBe('none');
  });
});

describe('splitStRegex + transformRegex', () => {
  it('dạng /body/flags giữ flags; body trần giữ trần', () => {
    expect(splitStRegex('/abc/gi')).toEqual({ body: 'abc', flags: 'gi', wrapped: true });
    expect(splitStRegex('abc')).toEqual({ body: 'abc', flags: '', wrapped: false });
  });

  it('thay tag trong regex + vẫn compile', () => {
    const r = transformRegex('/<状态面板>[\\s\\S]*?<\\/状态面板>/g', DICT);
    expect(r.changed).toBe(true);
    expect(r.findRegex).toBe('/<Bảng trạng thái>[\\s\\S]*?<\\/Bảng trạng thái>/g');
    const m = splitStRegex(r.findRegex);
    expect(() => new RegExp(m.body, m.flags)).not.toThrow();
  });

  it('bản dịch làm regex vỡ → hoàn nguyên', () => {
    const badDict = { ...emptyPresetDict(), tags: { 正文: 'Chính (văn' } }; // ( lẻ → vỡ
    const r = transformRegex('(?:正文)', badDict);
    expect(r.reverted).toBe(true);
    expect(r.findRegex).toBe('(?:正文)');
  });
});

// ─── validatePreset ───
const mkPreset = (): STPreset => ({
  temperature: 1,
  prompts: [
    { identifier: 'a', name: '主提示', enabled: true, role: 'system', content: '{{setvar::美型化::on}} 内容 {{getvar::美型化}}', injection_depth: 4, marker: false } as PresetPromptEntry,
    { identifier: 'b', name: 'Chat History', enabled: false, role: 'system', content: '', marker: true } as PresetPromptEntry,
  ],
  prompt_order: [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }],
} as STPreset);

describe('validatePreset', () => {
  it('bản dịch chuẩn (chỉ name/content đổi, macro rename nguyên tử) → sạch', () => {
    const orig = mkPreset();
    const tr = mkPreset();
    tr.prompts![0].name = 'Prompt chính';
    tr.prompts![0].content = '{{setvar::beautify::on}} nội dung {{getvar::beautify}}';
    const v = validatePreset(orig, tr, { 美型化: 'beautify' });
    expect(v.structureOk).toBe(true);
    expect(v.macroParityOk).toBe(true);
  });

  it('đổi field đóng băng (enabled / injection_depth) → bắt', () => {
    const orig = mkPreset();
    const tr = mkPreset();
    tr.prompts![0].enabled = false;
    tr.prompts![1].injection_depth = 99;
    const v = validatePreset(orig, tr, {});
    expect(v.structureOk).toBe(false);
    expect(v.structureErrors.join(' ')).toContain('enabled');
  });

  it('hoán vị identifier / sửa field ngoài vùng cho phép → bắt', () => {
    const orig = mkPreset();
    const tr = mkPreset();
    [tr.prompts![0], tr.prompts![1]] = [tr.prompts![1], tr.prompts![0]];
    expect(validatePreset(orig, tr, {}).structureOk).toBe(false);

    const tr2 = mkPreset();
    (tr2 as { temperature?: number }).temperature = 0.5; // subtree không đụng bị đổi
    expect(validatePreset(mkPreset(), tr2, {}).structureOk).toBe(false);
  });

  it('macro rename nửa vời → báo qua macroParity', () => {
    const orig = mkPreset();
    const tr = mkPreset();
    tr.prompts![0].content = '{{setvar::beautify::on}} nội dung {{getvar::美型化}}';
    const v = validatePreset(orig, tr, { 美型化: 'beautify' });
    expect(v.macroParityOk).toBe(false);
  });
});
