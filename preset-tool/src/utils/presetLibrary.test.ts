// (bug 139) Thư viện preset mẫu — phân tích tất định, ngữ cảnh có ngân sách, cache theo chữ ký.
import { describe, it, expect } from 'vitest';
import {
  analyzePreset, makeImportedPreset, buildPresetLibraryContext, upsertPreset, contentSig,
} from './presetLibrary';

const ST_PRESET = JSON.stringify({
  temperature: 0.9, top_p: 0.95,
  prompts: [
    { name: 'Main Prompt', role: 'system', enabled: true },
    { name: 'NSFW Guard', role: 'system', enabled: false },
    { name: 'JB', role: 'user', enabled: true },
  ],
  prompt_order: [{ order: [1, 2, 3] }],
});

describe('(bug 139) analyzePreset — nhận diện cấu trúc, không gọi AI', () => {
  it('preset JSON SillyTavern: đếm prompt, nêu tên + vai trò, tham số, prompt tắt', () => {
    const { format, summary } = analyzePreset('a.json', ST_PRESET);
    expect(format).toBe('json');
    expect(summary).toContain('3 prompt');
    expect(summary).toContain('Main Prompt');
    expect(summary).toContain('1 prompt đang tắt');
    expect(summary).toContain('temperature=0.9');
    expect(summary).toContain('prompt_order');
  });

  it('YAML/text: liệt kê khoá cấp cao / heading', () => {
    const { format, summary } = analyzePreset('b.yaml', 'name: test\ntemperature: 0.7\nstyle: kiếm hiệp\nrules: cấm OOC');
    expect(format).toBe('yaml');
    expect(summary).toContain('name');
    expect(summary).toContain('temperature');
  });
});

describe('(bug 139) buildPresetLibraryContext — ngân sách thông minh', () => {
  const A = makeImportedPreset('Kiếm Hiệp.json', ST_PRESET);
  const B = makeImportedPreset('Học Đường.json', ST_PRESET.replace('0.9', '0.5'));

  it('preset được NHẮC TÊN → nguyên văn; không nhắc → chỉ tóm tắt + chỉ dẫn cách xem full', () => {
    const ctx = buildPresetLibraryContext([A, B], 'sửa preset Kiếm Hiệp cho đỡ lan man');
    expect(ctx).toContain('"Kiếm Hiệp" (json) — NGUYÊN VĂN');
    expect(ctx).toContain('"Học Đường" (json) — TÓM TẮT');
    expect(ctx).toContain('Nhắc tên "Học Đường"');
  });

  it('preset GHIM luôn đi nguyên văn dù không nhắc tên', () => {
    const pinned = { ...B, pinned: true };
    const ctx = buildPresetLibraryContext([A, pinned], 'tạo preset mới');
    expect(ctx).toContain('"Học Đường" (json, ghim) — NGUYÊN VĂN');
  });

  it('không có preset nào → chuỗi rỗng (không bơm rác vào chat)', () => {
    expect(buildPresetLibraryContext([], 'hello')).toBe('');
  });
});

describe('(bug 139) upsertPreset — cache theo chữ ký, chỉ cập nhật phần đổi', () => {
  it('cùng tên + nội dung Y HỆT → giữ nguyên list (không phân tích lại)', () => {
    const l1 = upsertPreset([], 'x.json', ST_PRESET);
    const l2 = upsertPreset(l1, 'x.json', ST_PRESET);
    expect(l2).toBe(l1);   // cùng reference — không có gì đổi
  });

  it('cùng tên + nội dung ĐỔI → thay tại chỗ, giữ id/pin/addedAt cũ', () => {
    const l1 = upsertPreset([], 'x.json', ST_PRESET).map(p => ({ ...p, pinned: true }));
    const l2 = upsertPreset(l1, 'x.json', ST_PRESET.replace('0.9', '1.1'));
    expect(l2).toHaveLength(1);
    expect(l2[0].id).toBe(l1[0].id);
    expect(l2[0].pinned).toBe(true);
    expect(l2[0].sig).not.toBe(l1[0].sig);
    expect(l2[0].summary).toContain('temperature=1.1');
  });

  it('contentSig phân biệt nội dung khác nhau', () => {
    expect(contentSig('a')).not.toBe(contentSig('b'));
  });
});
