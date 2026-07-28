/**
 * (bugNeedFix/147) User: "MỌI preset con + Preset Áp dụng TẤT CẢ phải hoạt động thật 100% —
 * viết bộ test case thực tế (card mẫu tối thiểu có schema MVU + vài entry giả lập), chạy từng
 * preset qua bộ test đó."
 *
 * Test này chạy TOÀN BỘ preset trên hai loại thẻ mẫu (có schema / không schema) và đòi hỏi:
 *   • Preset chạy được thì phải sinh ra YÊU CẦU CÓ NỘI DUNG (không rỗng).
 *   • Preset không chạy được thì phải NÓI RÕ VÌ SAO — chặn im lặng chính là thứ khiến user
 *     tưởng "bấm rồi mà chẳng thấy gì".
 *   • Không preset nào được dạy API bịa (bài học bug 125).
 * Kèm test cho hai hành động sửa nội dung vốn KHÔNG có đường ghi (mục 1 của bug 147).
 */
import { describe, it, expect } from 'vitest';
import { QUICK_PRESETS, PRESET_GROUP_LABEL } from '../ejsQuickPresets';
import { STPT_FORBIDDEN_FNS } from '../stptApi';
import {
  verifyEdit, parseEditResponse, resolveCharacterField, buildEditMessages,
} from '../ejsEditActions';
import type { MVUZODSchema } from '../../../types/mvuzod.types';
import type { LorebookEntry } from '../../../types';
import { DEFAULT_ENTRY_EXT } from '../../../types/lorebook.types';

const mkEntry = (id: number, comment: string, content: string): LorebookEntry => ({
  id, keys: [], secondary_keys: [], comment, content,
  constant: true, selective: false, insertion_order: 100, enabled: true,
  position: 'before_char', use_regex: false,
  extensions: { ...DEFAULT_ENTRY_EXT, display_index: id },
});

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    { path: '/Nhân vật/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 0, max: 100 } },
    { path: '/Nhân vật/Thiện cảm', type: 'number', label: 'Thiện cảm', defaultValue: 0, constraints: { min: 0, max: 100 } },
    { path: '/Thế giới/Khu vực', type: 'string', label: 'Khu vực', defaultValue: 'Làng', constraints: {} },
  ],
};

const ENTRIES: LorebookEntry[] = [
  mkEntry(1, 'Thiết lập thế giới', 'Đại lục Thiên Nam có năm tông môn.'),
  mkEntry(2, 'NPC: Lâm Uyển', 'Sư tỷ của nhân vật chính. '.repeat(30)),
  mkEntry(3, 'Quy tắc xưng hô', 'Gọi nhau bằng sư huynh/sư muội.'),
  mkEntry(4, '[initvar]', 'Nhân vật:\n  HP: 100'),
];

const CTX_FULL = {
  schema: SCHEMA, entries: ENTRIES,
  regexScripts: [{ scriptName: 'Status Bar', replaceString: '<div id="stcs-app">x</div>' }],
  tavernScripts: [],
};
const CTX_BARE = { schema: null, entries: ENTRIES, regexScripts: [], tavernScripts: [] };

describe('Preset Nhanh — mọi preset đều dùng được hoặc nói rõ vì sao không', () => {
  it('đủ số lượng và có preset gói tổng', () => {
    expect(QUICK_PRESETS.length).toBeGreaterThanOrEqual(20);
    expect(QUICK_PRESETS.some(p => p.id === 'full-suite')).toBe(true);
  });

  it('mỗi preset khai đủ nhãn hiển thị (icon, tiêu đề, 1 dòng ngắn, nhóm)', () => {
    for (const p of QUICK_PRESETS) {
      expect(p.icon, p.id).toBeTruthy();
      expect(p.title, p.id).toBeTruthy();
      expect(p.short, p.id).toBeTruthy();
      expect(p.short.length, `${p.id}: dòng ngắn phải THẬT ngắn để các thẻ cao đều nhau`).toBeLessThanOrEqual(80);
      expect(p.effect.length, `${p.id}: phần giải thích phải dài hơn dòng ngắn`).toBeGreaterThan(p.short.length);
      expect(PRESET_GROUP_LABEL[p.group], p.id).toBeTruthy();
    }
  });

  it('id không trùng nhau', () => {
    const ids = QUICK_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const ctxName of ['thẻ đủ schema', 'thẻ chưa có schema']) {
    const ctx = ctxName === 'thẻ đủ schema' ? CTX_FULL : CTX_BARE;
    describe(ctxName, () => {
      for (const p of QUICK_PRESETS) {
        it(`${p.id} — chạy được thì có yêu cầu, không thì có lý do`, () => {
          const r = p.build(ctx);
          expect(Array.isArray(r.blockers), p.id).toBe(true);
          if (r.blockers.length === 0) {
            expect(r.goal.trim().length, `${p.id}: preset dùng được nhưng yêu cầu rỗng`).toBeGreaterThan(40);
          } else {
            for (const b of r.blockers) {
              expect(b.trim().length, `${p.id}: lý do chặn không được để trống`).toBeGreaterThan(10);
            }
          }
        });
      }
    });
  }

  it('không preset nào dạy API không tồn tại (bài học bug 125)', () => {
    for (const p of QUICK_PRESETS) {
      const text = `${p.effect} ${p.short} ${p.build(CTX_FULL).goal}`;
      for (const fn of STPT_FORBIDDEN_FNS) {
        expect(text, `${p.id} nhắc tới ${fn}`).not.toContain(fn);
      }
    }
  });

  it('gói tổng nêu rõ khi thẻ đã có thanh trạng thái sẵn (không tạo trùng)', () => {
    const r = QUICK_PRESETS.find(p => p.id === 'full-suite')!.build(CTX_FULL);
    expect(`${r.goal} ${r.notes.join(' ')}`.toLowerCase()).toContain('thanh trạng thái');
  });
});

describe('Sửa nội dung / Character Definition — hai hành động trước đây KHÔNG ghi được gì', () => {
  it('nhận diện đúng tên trường nhân vật, kể cả tên tiếng Việt', () => {
    expect(resolveCharacterField('description')).toBe('description');
    expect(resolveCharacterField('Mô tả')).toBe('description');
    expect(resolveCharacterField('tính cách')).toBe('personality');
    expect(resolveCharacterField('không-phải-trường-nào')).toBeNull();
  });

  it('bóc được nội dung khi AI bọc trong khối mã', () => {
    expect(parseEditResponse('```\nNội dung mới\n```')).toBe('Nội dung mới');
    expect(parseEditResponse('  Nội dung thuần  ')).toBe('Nội dung thuần');
  });

  it('CHẶN khi bản sửa làm rơi tên riêng hoặc con số', () => {
    const before = 'Lâm Uyển là sư tỷ, tu vi Kim Đan, có 300 linh thạch.';
    const after = 'Cô ấy là sư tỷ, tu vi Kim Đan.';
    const r = verifyEdit(before, after);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('Làm rơi');
  });

  it('CHẶN khi bản sửa nuốt mất khối EJS hoặc macro', () => {
    const before = 'Xin chào {{user}}, <% if (x) { %>bí mật<% } %> hết.';
    expect(verifyEdit(before, 'Xin chào {{user}}, hết.').ok).toBe(false);
    expect(verifyEdit(before, 'Chào bạn nhé, <% if (x) { %>bí mật<% } %> xong.').ok).toBe(false);
  });

  it('CHẶN khi bản sửa ngắn bất thường (nghi cắt mất nội dung)', () => {
    const before = 'Đoạn mô tả rất dài về nhân vật. '.repeat(20);
    expect(verifyEdit(before, 'Ngắn.').ok).toBe(false);
  });

  it('CHẤP NHẬN bản sửa giữ đủ dữ kiện', () => {
    const before = 'Lâm Uyển là sư tỷ, tu vi Kim Đan, có 300 linh thạch.';
    const after = 'Lâm Uyển — sư tỷ đồng môn, đã đạt cảnh giới Kim Đan, trong người mang 300 linh thạch.';
    expect(verifyEdit(before, after)).toEqual({ ok: true, problems: [] });
  });

  it('CHẶN khi AI trả về y hệt bản cũ hoặc rỗng', () => {
    expect(verifyEdit('abc xyz', 'abc xyz').ok).toBe(false);
    expect(verifyEdit('abc xyz', '   ').ok).toBe(false);
  });

  it('prompt sửa có đủ nội dung hiện tại và yêu cầu', () => {
    const m = buildEditMessages('NỘI DUNG CŨ', 'làm ngắn lại', 'entry "X"');
    expect(m).toHaveLength(2);
    expect(m[1].content).toContain('NỘI DUNG CŨ');
    expect(m[1].content).toContain('làm ngắn lại');
  });
});
