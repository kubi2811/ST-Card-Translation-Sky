// (bug 141) "Xem trước & Tinh chỉnh" — logic thuần: khoá schema 100%, 3 phương án giao diện,
// validate schema user sửa, tuning hết giá trị khi ý tưởng đổi.
import { describe, it, expect } from 'vitest';
import {
  makeTuning, tuningUsable, validateTunedSchema, buildThemeChoices,
  applyLockedSchema, ideaSignature,
} from '../cardTuning';
import { buildMvuzodPrompt } from '../autoCreatorPrompts';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA = {
  version: '1.0',
  fields: [
    {
      path: '/Nhân vật', type: 'object', label: 'Nhân vật', defaultValue: {}, constraints: {},
      children: [
        { path: '/Nhân vật/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 0, max: 100 } },
        { path: '/Nhân vật/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

const IDEA = 'thế giới tu tiên, có HP và Tên';

describe('(bug 141) tuning lifecycle', () => {
  it('makeTuning giữ bản gốc riêng để Reset; chưa confirmed thì chưa dùng được', () => {
    const t = makeTuning(SCHEMA, IDEA);
    expect(t.confirmed).toBe(false);
    expect(tuningUsable(t, IDEA)).toBe(false);
    // originalSchema là BẢN SAO — sửa schema không lây sang bản gốc
    t.schema.fields[0].label = 'Đã sửa';
    expect(t.originalSchema.fields[0].label).toBe('Nhân vật');
  });

  it('confirmed + đúng ý tưởng → dùng được; Ý TƯỞNG ĐỔI → hết giá trị (schema nói về thế giới khác)', () => {
    const t = { ...makeTuning(SCHEMA, IDEA), confirmed: true };
    expect(tuningUsable(t, IDEA)).toBe(true);
    expect(tuningUsable(t, IDEA + ' thêm hệ ma pháp')).toBe(false);
    expect(ideaSignature(IDEA)).not.toBe(ideaSignature(IDEA + 'x'));
  });

  it('applyLockedSchema ÉP kết quả AI dùng nguyên schema đã duyệt — "áp dụng đúng 100%"', () => {
    const t = { ...makeTuning(SCHEMA, IDEA), confirmed: true };
    const aiResult = { schema: { version: '1.0', fields: [{ path: '/Khác', type: 'number' }] }, initVarEntry: 'x' };
    const locked = applyLockedSchema(aiResult, t);
    expect(JSON.stringify(locked.schema)).toBe(JSON.stringify(t.schema));
    expect(locked.initVarEntry).toBe('x');   // phần AI sáng tác vẫn giữ
  });
});

describe('(bug 141) validateTunedSchema — chặn "sửa quá phi logic"', () => {
  it('schema hợp lệ → ok; schema rỗng → báo', () => {
    expect(validateTunedSchema(SCHEMA).ok).toBe(true);
    const empty = validateTunedSchema({ version: '1.0', fields: [] });
    expect(empty.ok).toBe(false);
    expect(empty.problems.join(' ')).toContain('không còn field');
  });

  it('hai biến trùng tên trong cùng nhóm → báo', () => {
    const dup = validateTunedSchema({
      version: '1.0',
      fields: [
        { path: '/NV/HP', type: 'number', label: 'HP', defaultValue: 1, constraints: {} },
        { path: '/NV/HP', type: 'number', label: 'HP', defaultValue: 2, constraints: {} },
      ],
    });
    expect(dup.ok).toBe(false);
    expect(dup.problems.join(' ')).toContain('trùng tên');
  });
});

describe('(bug 141) 3 phương án giao diện — thuần máy từ schema đã chỉnh', () => {
  it('trả về 3 theme khác nhau, mỗi cái có preview HTML chứa form + status bar', () => {
    const choices = buildThemeChoices(SCHEMA, 'Game Thử', 3);
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map(c => c.themeId)).size).toBe(3);
    for (const c of choices) {
      expect(c.previewHtml).toContain('<!DOCTYPE');
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});

describe('(bug 141) prompt khoá schema', () => {
  const cfg = { autoDetect: true, createInitVar: true, createUpdateRules: true, createVarList: true } as never;

  it('có lockedSchema → prompt chứa khối KHOÁ CỨNG + nguyên văn schema', () => {
    const p = buildMvuzodPrompt(IDEA, '(ctx)', cfg, null, SCHEMA);
    expect(p).toContain('KHOÁ CỨNG');
    expect(p).toContain('KHÔNG thêm field');
    expect(p).toContain('/Nhân vật/HP');
  });

  it('không lockedSchema → prompt như cũ, không có khối khoá', () => {
    const p = buildMvuzodPrompt(IDEA, '(ctx)', cfg, null);
    expect(p).not.toContain('KHOÁ CỨNG');
  });
});
