import { describe, expect, it } from 'vitest';
import {
  extractMappingFromTranslatedSchemas,
  sanitizeAutomaticSchemaMappings,
} from '../mvuSync';

describe('sanitizeAutomaticSchemaMappings — không biến hoán vị field thành bản dịch', () => {
  it('loại đúng ca B↔V, A↔M và generic Latin một ký tự', () => {
    expect(sanitizeAutomaticSchemaMappings({ B: 'V', V: 'B', A: 'M', M: 'A' }))
      .toEqual({ mapping: {}, removed: ['B', 'V', 'A', 'M'] });
  });

  it('loại cả chu kỳ dài nhưng giữ mapping dịch thật', () => {
    const out = sanitizeAutomaticSchemaMappings({
      Một: 'Hai', Hai: 'Ba', Ba: 'Một',
      年龄: 'Tuổi Tác', 姓名: 'Họ Tên',
    });
    expect(out.mapping).toEqual({ 年龄: 'Tuổi Tác', 姓名: 'Họ Tên' });
    expect(new Set(out.removed)).toEqual(new Set(['Một', 'Hai', 'Ba']));
  });
});

describe('extractMappingFromTranslatedSchemas — guard tích hợp', () => {
  const make = (original: string, translated: string) => {
    const path = 'data.extensions.tavern_helper.scripts[0].content';
    const card = {
      data: { extensions: { tavern_helper: { scripts: [{ content: original }] } } },
    } as never;
    const fields = [{ path, original, translated, status: 'done' }] as never;
    return extractMappingFromTranslatedSchemas(card, fields);
  };

  it('schema chỉ đổi thứ tự field không sinh B→V/V→B', () => {
    const original = `const schema = z.object({
      B: z.string(),
      V: z.string(),
      A: z.number(),
      M: z.number(),
    });`;
    const reordered = `const schema = z.object({
      V: z.string(),
      B: z.string(),
      M: z.number(),
      A: z.number(),
    });`;
    expect(make(original, reordered)).toEqual({});
  });

  it('vẫn giữ ánh xạ CJK→Việt hợp lệ', () => {
    const original = `const schema = z.object({
      年龄: z.number(),
      姓名: z.string(),
    });`;
    const translated = `const schema = z.object({
      'Tuổi Tác': z.number(),
      'Họ Tên': z.string(),
    });`;
    expect(make(original, translated)).toMatchObject({ 年龄: 'Tuổi Tác', 姓名: 'Họ Tên' });
  });
});
