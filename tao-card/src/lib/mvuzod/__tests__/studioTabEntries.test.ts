/**
 * Hai tab "Biến số" và "Update" của MVUZOD Studio từng có bộ sinh RIÊNG, lệch hẳn với bộ mà Auto
 * Creator/Export Wizard dùng. Test này khoá lại đúng những chỗ đã hỏng:
 *
 *  1. Entry quy tắc do tab Biến số sinh nhét mảng JSON ĐỂ TRẦN vào <UpdateVariable> — thiếu cả
 *     <Analysis> lẫn <JSONPatch>, đúng lỗi "其内的更新命令无效" của engine (việc 87).
 *  2. Quy tắc cập nhật bỏ trống mọi lá string/boolean (chỉ ra dòng `Tên:` trơ trọi) — biến không
 *     có luật là biến đứng im cả ván (bugNeedFix/112).
 *  3. Danh sách biến chỉ đi một tầng, biến lồng sâu không bao giờ được liệt kê.
 *  4. Đường dẫn biến thiếu tiền tố `stat_data.` (và bản getvar còn thừa một dấu chấm ở đầu).
 *  5. Tên entry mỗi tab một kiểu ⇒ dò trùng trượt ⇒ thẻ mọc hai entry cùng loại sống song song.
 */
import { describe, it, expect } from 'vitest';
import type { MVUZODSchema } from '../../../types/mvuzod.types';
import type { LorebookEntry } from '../../../types/lorebook.types';
import {
  generateUpdateRulesEntry,
  generateOutputFormatEntry,
  generateVariableListEntry,
  generateEmphasisEntry,
} from '../scriptGenerator';
import { checkMvuOutputContract, checkMvuPatchOps } from '../mvuReference';
import { validateMvuCard } from '../validateMvuCard';
import { findExistingMVUZODEntries } from '../../export/worldbookGenerator';
import { VARLIST_TEMPLATES, dotPath } from '../varListTemplates';

/** Schema BA TẦNG, cố tình có lá string/boolean trần để bắt ca "biến trống rỗng". */
const SCHEMA = {
  version: '1.0',
  fields: [
    {
      path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        {
          path: '/Người Chơi/Chỉ Số', type: 'object', label: 'Chỉ Số', defaultValue: {}, constraints: {},
          children: [
            { path: '/Người Chơi/Chỉ Số/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { clamp: [0, 100] } },
          ],
        },
        { path: '/Người Chơi/Cảnh Giới', type: 'string', label: 'Cảnh Giới', defaultValue: 'Luyện Khí', constraints: {} },
        { path: '/Người Chơi/Đang Chiến Đấu', type: 'boolean', label: 'Đang Chiến Đấu', defaultValue: false, constraints: {} },
      ],
    },
    {
      path: '/Thế Giới', type: 'object', label: 'Thế Giới', defaultValue: {}, constraints: {},
      children: [
        { path: '/Thế Giới/Ngày', type: 'number', label: 'Ngày', defaultValue: 1, constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

/** `& Record<string, unknown>` để dùng được cho cả validateMvuCard (EntryLike có index signature)
 *  lẫn findExistingMVUZODEntries (đòi LorebookEntry). */
const entry = (o: Partial<LorebookEntry>): LorebookEntry & Record<string, unknown> => ({
  id: 1, keys: [], secondary_keys: [], comment: '', content: '', constant: true, selective: false,
  insertion_order: 100, enabled: true, position: 'before_char', use_regex: false,
  extensions: {} as LorebookEntry['extensions'], ...o,
} as LorebookEntry & Record<string, unknown>);

describe('tab Update — quy tắc cập nhật phủ đủ mọi biến', () => {
  const yaml = generateUpdateRulesEntry(SCHEMA);

  it('không còn lá nào trơ trọi mỗi cái tên', () => {
    const lines = yaml.split('\n');
    const bare: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const name = lines[i].match(/^(\s+)([^\s#][^:]*):\s*$/);
      if (!name) continue;
      const indent = name[1].length;
      const next = lines[i + 1] ?? '';
      const nextIndent = next.match(/^\s*/)?.[0].length ?? 0;
      // Lá hợp lệ phải có ÍT NHẤT một dòng con (type/range/check) sâu hơn nó.
      if (!next.trim() || nextIndent <= indent) bare.push(name[2]);
    }
    expect(bare).toEqual([]);
  });

  it('lá string/boolean cũng có check — chính là nhóm trước đây bị bỏ trắng', () => {
    expect(yaml).toMatch(/Cảnh Giới:\s*\n\s+check:/);
    expect(yaml).toMatch(/Đang Chiến Đấu:\s*\n\s+check:/);
  });
});

describe('tab Update — định dạng đầu ra đúng hợp đồng engine', () => {
  it('đủ <UpdateVariable> + <Analysis> + <JSONPatch>', () => {
    expect(checkMvuOutputContract(generateOutputFormatEntry(SCHEMA))).toEqual({ ok: true, missing: [] });
    expect(checkMvuOutputContract(generateEmphasisEntry())).toEqual({ ok: true, missing: [] });
  });

  it('không dạy op nào ngoài tập MVU nhận (không có "add" của RFC 6902)', () => {
    expect(checkMvuPatchOps(generateOutputFormatEntry(SCHEMA)).bad).toEqual([]);
  });

  it('bộ kiểm thẻ không còn báo update-block-invalid', () => {
    const report = validateMvuCard({
      entries: [
        entry({ id: 1, comment: '[initvar] Khởi tạo biến - đừng mở', content: 'Người Chơi:\n  Cảnh Giới: Luyện Khí', enabled: false }),
        entry({ id: 2, comment: '[mvu_update] Quy tắc cập nhật biến', content: generateUpdateRulesEntry(SCHEMA) }),
        entry({ id: 3, comment: '[mvu_update] Định dạng đầu ra biến', content: generateOutputFormatEntry(SCHEMA) }),
        entry({ id: 4, comment: '[mvu_update] Nhấn mạnh định dạng đầu ra biến', content: generateEmphasisEntry() }),
      ],
    });
    expect(report.errors).toEqual([]);
  });
});

describe('tab Update — danh sách biến đi hết mọi tầng', () => {
  const yaml = generateVariableListEntry(SCHEMA, 'selective');

  it('xuống tới lá tầng 3', () => {
    expect(yaml).toContain('{{format_message_variable::stat_data.Người Chơi.Chỉ Số.HP}}');
  });

  it('mọi macro đều có tiền tố stat_data.', () => {
    const thieu = [...yaml.matchAll(/\{\{format_message_variable::([^}]+)\}\}/g)]
      .map(m => m[1])
      .filter(p => !p.startsWith('stat_data.') && p !== 'stat_data');
    expect(thieu).toEqual([]);
  });
});

describe('tab Biến số — khuôn in biến', () => {
  const field = { path: '/Người Chơi/HP', type: 'number', label: 'HP', defaultValue: 0, constraints: {} } as never;

  it('dotPath bỏ dấu gạch đầu, không để lại dấu chấm thừa', () => {
    expect(dotPath(field)).toBe('Người Chơi.HP');
  });

  it('cả ba khuôn đều đọc từ stat_data', () => {
    for (const tpl of VARLIST_TEMPLATES) {
      const out = tpl.injectionTemplate(field);
      expect(out, tpl.id).toContain('stat_data');
      expect(out, tpl.id).not.toContain("'.Người Chơi");
      expect(out, tpl.id).not.toContain('::Người Chơi');
    }
  });

  it('khuôn EJS bóc cặp [giá trị, "mô tả"] chứ không in cả cặp', () => {
    for (const tpl of VARLIST_TEMPLATES.filter(t => t.id.startsWith('ejs'))) {
      expect(tpl.injectionTemplate(field), tpl.id).toContain('[].concat');
    }
  });

  it('bóc cặp chạy ĐÚNG trên cả cặp lẫn giá trị trần', () => {
    // Chạy thật đúng biểu thức được nhúng vào thẻ, trên dữ liệu đúng định dạng MVU.
    const unwrap = (v: unknown) => (new Function('v', 'return [].concat(v)[0];') as (x: unknown) => unknown)(v);
    expect(unwrap(['Luyện Khí', 'cảnh giới hiện tại'])).toBe('Luyện Khí');
    expect(unwrap(100)).toBe(100);
    expect(unwrap('Sáng')).toBe('Sáng');
  });
});

describe('dò entry cũ — bấm lại là cập nhật, không đẻ thêm bản trùng', () => {
  it('nhận ra cả mấy tên mà bản cũ của hai tab đã lỡ sinh ra', () => {
    const found = findExistingMVUZODEntries([
      entry({ id: 1, comment: '[mvu_update]Quy tắc cập nhật biến' }),          // tab Update bản cũ
      entry({ id: 2, comment: '[VariableList] Biến số - Tiêu Viêm' }),          // tab Biến số bản cũ
      entry({ id: 3, comment: '[initvar]Khởi tạo biến (Tắt)' }),                // tab InitVar bản cũ
      entry({ id: 4, comment: '[mvu_update] Định dạng đầu ra biến' }),
    ]);
    expect(found.update_rules).toContain(1);
    expect(found.varlist).toContain(2);
    expect(found.initvar).toContain(3);
    expect(found.output_format).toContain(4);
  });
});
