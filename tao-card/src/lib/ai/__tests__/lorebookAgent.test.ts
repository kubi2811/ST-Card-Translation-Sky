// (Goal 102) Miền Lorebook — kế hoạch tiêu-đề-trước, validator bám schema (#48), sửa hội tụ.
import { describe, it, expect } from 'vitest';
import {
  parseLorebookPlan, buildBucketTopicPrompt, validateLorebookRun,
  autofixLorebookKeys, fixSchemaMissEntries, collectSchemaLeafNames,
  type LorebookPlan,
} from '../lorebookAgent';
import type { LorebookEntry } from '../../../types';
import type { MVUZODSchema } from '../../../types/mvuzod.types';
import type { AgentCallFn } from '../goalAgent';

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    { path: '/NPC', type: 'object', label: 'NPC', constraints: {}, defaultValue: {},
      children: [
        { path: '/NPC/Võ Lực', type: 'number', label: 'Võ Lực', constraints: {}, defaultValue: 50 },
        { path: '/NPC/Trí Lực', type: 'number', label: 'Trí Lực', constraints: {}, defaultValue: 50 },
      ] },
  ],
} as unknown as MVUZODSchema;

const PLAN_JSON = JSON.stringify({
  scope: 'Lorebook tu tiên',
  config: { totalEntries: 4, minEntries: 3, entriesPerBatch: 2, tokensPerEntry: 200, cardType: 'multi', useWebSearch: false },
  buckets: [
    { group: 'worldview', label: 'Thế giới quan', titles: ['Đại Lục Huyền Thiên'] },
    { group: 'npc', label: 'NPC', titles: ['Trưởng lão Hàn Nguyệt', 'Đệ tử Lâm Phong'] },
    { group: 'scene', label: 'Cảnh vật', titles: ['Bí cảnh Kim Đan'] },
  ],
  notes: ['ghi chú thử'],
});

const entry = (over: Partial<LorebookEntry>): LorebookEntry => ({
  id: 1, keys: ['test'], secondary_keys: [], comment: 'X', content: 'nội dung dài đủ dùng cho test entry này',
  constant: false, selective: true, insertion_order: 100, enabled: true, position: 'after_char',
  use_regex: false, extensions: {} as LorebookEntry['extensions'], ...over,
});

describe('parseLorebookPlan', () => {
  it('parse đủ buckets + config kẹp biên + steps hiển thị theo nhóm', () => {
    const p = parseLorebookPlan(PLAN_JSON);
    expect(p.buckets).toHaveLength(3);
    expect(p.config.totalEntries).toBe(4);
    expect(p.config.cardType).toBe('multi');
    expect(p.steps).toHaveLength(3);
    expect(p.steps[1].title).toContain('NPC (2 entry)');
    expect(p.estCalls).toBe(1 + Math.ceil(4 / 2));
  });

  it('config AI trả bậy (totalEntries=99999, tokensPerEntry=5) bị kẹp về biên an toàn', () => {
    const raw = JSON.parse(PLAN_JSON);
    raw.config.totalEntries = 99999;
    raw.config.tokensPerEntry = 5;
    const p = parseLorebookPlan(JSON.stringify(raw));
    expect(p.config.totalEntries).toBeLessThanOrEqual(200);
    expect(p.config.tokensPerEntry).toBeGreaterThanOrEqual(80);
  });

  it('không có tiêu đề nào → báo lỗi rõ', () => {
    expect(() => parseLorebookPlan(JSON.stringify({ scope: 's', buckets: [] }))).toThrow(/tiêu đề/);
  });
});

describe('buildBucketTopicPrompt — xương sống chống trùng đa luồng', () => {
  it('đánh số TOÀN CỤC qua mọi bucket (danh sách mà chỉ thị chia-luồng modulo lên)', () => {
    const p = parseLorebookPlan(PLAN_JSON);
    const prompt = buildBucketTopicPrompt('yêu cầu gốc', p);
    expect(prompt).toContain('1. [Thế giới quan] Đại Lục Huyền Thiên');
    expect(prompt).toContain('2. [NPC] Trưởng lão Hàn Nguyệt');
    expect(prompt).toContain('4. [Cảnh vật] Bí cảnh Kim Đan');
    expect(prompt).toContain('DANH SÁCH THỰC THỂ BẮT BUỘC PHỦ');
  });

  it('tài liệu nguồn được nhúng nhưng cắt trần (không phình prompt mỗi batch)', () => {
    const p = parseLorebookPlan(PLAN_JSON);
    const doc = 'x'.repeat(50000);
    const prompt = buildBucketTopicPrompt('g', p, doc);
    expect(prompt).toContain('TÀI LIỆU NGUỒN');
    expect(prompt.length).toBeLessThan(20000);
    expect(prompt).toContain('đã cắt bớt');
  });
});

describe('validateLorebookRun — kiểm sau chạy (102.3 / #48)', () => {
  const plan = parseLorebookPlan(PLAN_JSON) as LorebookPlan;

  it('entry NPC có gán chỉ số schema + key sạch → không lỗi', () => {
    const e = entry({ comment: 'Trưởng lão Hàn Nguyệt', keys: ['Hàn Nguyệt', 'trưởng lão'],
      content: 'Hàn Nguyệt: Võ Lực: 87, Trí Lực: 92. Trưởng lão hộ pháp.' });
    expect(validateLorebookRun({ newEntries: [e], schema: SCHEMA, plan })).toEqual([]);
  });

  it('CHÍNH NỢ #48: entry NPC KHÔNG gán chỉ số schema nào → error lb-schema-miss', () => {
    const e = entry({ comment: 'Trưởng lão Hàn Nguyệt', content: 'Một trưởng lão bí ẩn, rất mạnh mẽ và lạnh lùng.' });
    const issues = validateLorebookRun({ newEntries: [e], schema: SCHEMA, plan });
    expect(issues.some(i => i.code === 'lb-schema-miss' && i.level === 'error')).toBe(true);
  });

  it('entry CẢNH VẬT không gán chỉ số → KHÔNG bắt oan (chỉ soi bucket nhân vật)', () => {
    const e = entry({ comment: 'Bí cảnh Kim Đan', content: 'Bí cảnh cổ xưa chỉ mở cho tu sĩ Kim Đan.' });
    expect(validateLorebookRun({ newEntries: [e], schema: SCHEMA, plan })).toEqual([]);
  });

  it('key nối chữ bằng _ → error lb-key-style + sửa máy móc dọn được', () => {
    const e = entry({ id: 7, comment: 'Trưởng lão Hàn Nguyệt', keys: ['hàn_nguyệt', 'trưởng lão'],
      content: 'Võ Lực: 80.' });
    const issues = validateLorebookRun({ newEntries: [e], schema: SCHEMA, plan });
    expect(issues.some(i => i.code === 'lb-key-style')).toBe(true);
    const fix = autofixLorebookKeys([e], issues);
    expect(fix.patches).toHaveLength(1);
    expect(fix.patches[0].keys.every(k => !/\p{L}_\p{L}/u.test(k))).toBe(true);
  });

  it('không schema → không đòi chỉ số', () => {
    const e = entry({ comment: 'Trưởng lão Hàn Nguyệt', content: 'Mô tả thường.' });
    expect(validateLorebookRun({ newEntries: [e], schema: null, plan })).toEqual([]);
  });
});

describe('fixSchemaMissEntries — vòng sửa AI hội tụ (luật #42)', () => {
  const plan = parseLorebookPlan(PLAN_JSON) as LorebookPlan;
  const bad = entry({ id: 3, comment: 'Trưởng lão Hàn Nguyệt', content: 'Trưởng lão hộ pháp của Huyền Thiên Tông, tính lạnh lùng.' });
  const issues = validateLorebookRun({ newEntries: [bad], schema: SCHEMA, plan });

  it('bản sửa CÓ chỉ số + không mất nội dung → nhận', async () => {
    const call: AgentCallFn = async () => JSON.stringify({
      content: 'Trưởng lão hộ pháp của Huyền Thiên Tông, tính lạnh lùng. Võ Lực: 88, Trí Lực: 90.',
    });
    const patches = await fixSchemaMissEntries([bad], issues, SCHEMA, call);
    expect(patches).toHaveLength(1);
    expect(patches[0].content).toContain('Võ Lực');
  });

  it('bản sửa TỆ HƠN (mất nội dung / vẫn thiếu chỉ số) → BỎ, giữ bản gốc', async () => {
    const callMat: AgentCallFn = async () => JSON.stringify({ content: 'Võ Lực: 88' }); // cụt lủn — mất nội dung
    expect(await fixSchemaMissEntries([bad], issues, SCHEMA, callMat)).toEqual([]);
    const callThieu: AgentCallFn = async () => JSON.stringify({ content: bad.content + ' Rất mạnh, chỉ số cao ngất.' }); // vẫn không gán biến schema
    expect(await fixSchemaMissEntries([bad], issues, SCHEMA, callThieu)).toEqual([]);
  });
});

describe('collectSchemaLeafNames', () => {
  it('lấy đúng tên biến lá', () => {
    expect(collectSchemaLeafNames(SCHEMA)).toEqual(['Võ Lực', 'Trí Lực']);
    expect(collectSchemaLeafNames(null)).toEqual([]);
  });
});
