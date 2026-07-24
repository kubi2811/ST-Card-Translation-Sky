import { describe, it, expect } from 'vitest';
import { buildMvuOutputBlock, checkMvuOutputContract, MVU_WORKING_CARD_EXAMPLE, MVU_TAGS } from '../mvuReference';
import { generateOutputFormatEntry, generateEmphasisEntry } from '../scriptGenerator';
import type { MVUZODSchema } from '../../../types';

/**
 * (User 23/07 — việc 87) "Auto Creator tạo xong vẫn còn bị lỗi đỏ của MVU."
 *
 * Soi ra phần lớn KHÔNG phải lỗi AI mà là BỘ SINH TẤT ĐỊNH của tool xuất sai:
 *     <UpdateVariable>
 *     [ {"op":"replace",...} ]        ← mảng JSON ĐỂ TRẦN
 *     </UpdateVariable>
 * MVU đọc mảng lệnh BÊN TRONG <JSONPatch>; để trần là parse không ra. Nên MỌI thẻ Auto Creator
 * tạo đều dính ❌ "Khối <UpdateVariable> THIẾU thẻ con <Analysis>/<JSONPatch>" — AI không hề có
 * cơ hội làm đúng. Đối chiếu thẻ thật đang chạy được trong bug/ để lấy đúng cấu trúc.
 */

const schema = {
  fields: [{
    path: '/Thế Giới', name: 'Thế Giới', type: 'object', constraints: {},
    children: [
      { path: '/Thế Giới/Ngày', name: 'Ngày', type: 'number', constraints: {} },
      { path: '/Thế Giới/Thời Tiết', name: 'Thời Tiết', type: 'string', constraints: {} },
    ],
  }],
} as unknown as MVUZODSchema;

describe('buildMvuOutputBlock — khuôn lấy từ thẻ thật', () => {
  it('có đủ ba thẻ, mảng lệnh nằm TRONG <JSONPatch>', () => {
    const b = buildMvuOutputBlock(['{"op":"replace","path":"/Thế Giới/Ngày","value":2}']);
    expect(b).toContain(`<${MVU_TAGS.root}>`);
    expect(b).toContain(`<${MVU_TAGS.analysis}>`);
    expect(b).toContain(`<${MVU_TAGS.patch}>`);
    // Mảng phải đứng SAU thẻ mở <JSONPatch>, không được để trần ngay sau <UpdateVariable>
    expect(b.indexOf('[')).toBeGreaterThan(b.indexOf(`<${MVU_TAGS.patch}>`));
  });

  it('không truyền lệnh mẫu nào → vẫn ra khối hợp lệ', () => {
    expect(checkMvuOutputContract(buildMvuOutputBlock([])).ok).toBe(true);
  });
});

describe('checkMvuOutputContract — bộ sinh và bộ kiểm dùng CHUNG một định nghĩa', () => {
  it('đủ ba thẻ → đạt', () => {
    expect(checkMvuOutputContract('<UpdateVariable><Analysis>x</Analysis><JSONPatch>[]</JSONPatch></UpdateVariable>').ok).toBe(true);
  });

  it('ĐÚNG BUG CŨ: mảng để trần trong <UpdateVariable> → trượt, chỉ rõ thiếu gì', () => {
    const r = checkMvuOutputContract('<UpdateVariable>\n[{"op":"replace"}]\n</UpdateVariable>');
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['Analysis', 'JSONPatch']);
  });

  it('không có khối nào → trượt cả ba', () => {
    expect(checkMvuOutputContract('chỉ là văn bản thường').missing).toHaveLength(3);
  });

  it('chuỗi rỗng/không phải chuỗi → không nổ', () => {
    expect(checkMvuOutputContract('').ok).toBe(false);
    expect(checkMvuOutputContract(undefined as unknown as string).ok).toBe(false);
  });
});

describe('generateOutputFormatEntry — thứ Auto Creator thật sự nhét vào thẻ', () => {
  it('CHÍNH CA BUG: nội dung sinh ra phải QUA được phép kiểm của Kiểm tra tổng thể', () => {
    const out = generateOutputFormatEntry(schema);
    expect(checkMvuOutputContract(out).ok).toBe(true);
  });

  it('giữ nguyên tên biến tiếng Việt có dấu và khoảng trắng trong đường dẫn', () => {
    const out = generateOutputFormatEntry(schema);
    expect(out).toMatch(/\/Thế Giới\//);
    expect(out).not.toMatch(/\/the_gioi\//i);
  });

  it('vẫn dặn delta là số trần và không đụng field readonly', () => {
    const out = generateOutputFormatEntry(schema);
    expect(out).toMatch(/delta/);
    expect(out).toMatch(/readonly|_ \(readonly\)/);
  });

  it('schema rỗng → vẫn ra khối hợp lệ chứ không vỡ', () => {
    expect(checkMvuOutputContract(generateOutputFormatEntry({ fields: [] } as unknown as MVUZODSchema)).ok).toBe(true);
  });
});

describe('generateEmphasisEntry — entry ở D0, model đọc sau chót', () => {
  it('nhắc ĐỦ cấu trúc chứ không chỉ tên thẻ ngoài cùng', () => {
    expect(checkMvuOutputContract(generateEmphasisEntry()).ok).toBe(true);
  });

  it('nói rõ không có gì đổi thì xuất mảng rỗng TRONG JSONPatch', () => {
    expect(generateEmphasisEntry()).toContain('<JSONPatch>[]</JSONPatch>');
  });
});

describe('MVU_WORKING_CARD_EXAMPLE — mẫu dạy AI', () => {
  it('bản thân ví dụ phải đúng chuẩn, không dạy AI cái sai', () => {
    expect(checkMvuOutputContract(MVU_WORKING_CARD_EXAMPLE).ok).toBe(true);
  });

  it('dạy đúng ba điểm hay sai nhất: entry khởi tạo phải tắt, mảng trong JSONPatch, giữ tên biến', () => {
    expect(MVU_WORKING_CARD_EXAMPLE).toMatch(/enabled=false/);
    expect(MVU_WORKING_CARD_EXAMPLE).toMatch(/để trần/);
    expect(MVU_WORKING_CARD_EXAMPLE).toMatch(/snake_case/);
  });
});


/* ═══ (Goal 100.1) Hợp đồng đối chiếu từ SOURCE MVU thật (bugNeedFix/mvu-reference) ═══ */
import {
  MVU_ENTRY_MARKERS, MVU_DIALECT_RE, isMvuUpdateBlockAccepted, MVU_FRONTEND_API,
} from '../mvuReference';

describe('MVU_ENTRY_MARKERS — regex nguyên văn từ variable_def.ts của engine', () => {
  it('khớp không phân biệt hoa thường, ở bất kỳ đâu trong comment', () => {
    expect(MVU_ENTRY_MARKERS.update.test('abc [MVU_UPDATE] xyz')).toBe(true);
    expect(MVU_ENTRY_MARKERS.plot.test('[mvu_plot] đẩy cốt truyện')).toBe(true);
    expect(MVU_ENTRY_MARKERS.initvar.test('[InitVar] Vui lòng không mở')).toBe(true);
    expect(MVU_ENTRY_MARKERS.update.test('mvu update không ngoặc')).toBe(false);
  });
});

describe('isMvuUpdateBlockAccepted — chuẩn NHẬN của engine (2 phương ngữ đều hợp lệ)', () => {
  it('JSON Patch → nhận', () => {
    expect(isMvuUpdateBlockAccepted('<JSONPatch>[{"op":"replace"}]</JSONPatch>')).toBe(true);
    expect(isMvuUpdateBlockAccepted('json_patch: []')).toBe(true);
  });
  it('lệnh hàm _.set/_.add/_.insert → CŨNG nhận (trước đây tool bắt lỗi oan)', () => {
    expect(isMvuUpdateBlockAccepted("_.set('Người Chơi.Máu', 90);//trúng đòn")).toBe(true);
    expect(isMvuUpdateBlockAccepted("_.add('Thế Giới.Ngày', 1);")).toBe(true);
    expect(isMvuUpdateBlockAccepted("_.insert('Túi Đồ', 'thuốc');")).toBe(true);
  });
  it('không phương ngữ nào → từ chối (đúng lỗi 其内的更新命令无效)', () => {
    expect(isMvuUpdateBlockAccepted('chỉ có văn xuôi, không lệnh nào')).toBe(false);
    expect(isMvuUpdateBlockAccepted('')).toBe(false);
  });
  it('KHÔNG khớp nhầm code thường: _.setup() hay object.set() không phải lệnh MVU', () => {
    expect(isMvuUpdateBlockAccepted('_.setup(config)')).toBe(false);
    expect(isMvuUpdateBlockAccepted('store.set(1)')).toBe(false);
  });
});

describe('MVU_FRONTEND_API — lời giải bug #162, đối chiếu global/index.ts', () => {
  it('đúng tên đối tượng, chỗ gắn, event sẵn sàng', () => {
    expect(MVU_FRONTEND_API.globalObject).toBe('Mvu');
    expect(MVU_FRONTEND_API.attachedTo).toBe('window.parent');
    expect(MVU_FRONTEND_API.readyEvent).toBe('global_Mvu_initialized');
  });
  it('đúng bộ event mag_* nguyên văn từ variable_def.ts', () => {
    expect(MVU_FRONTEND_API.events.initialized).toBe('mag_variable_initialized');
    expect(MVU_FRONTEND_API.events.commandParsed).toBe('mag_command_parsed');
    expect(MVU_FRONTEND_API.events.updateEnded).toBe('mag_variable_update_ended');
    expect(MVU_FRONTEND_API.events.updateVariable).toBe('mag_update_variable');
  });
});

describe('MVU_DIALECT_RE.functionCall — máy trạng thái parse các lệnh này', () => {
  it('đủ 7 lệnh của engine', () => {
    for (const cmd of ['set', 'insert', 'delete', 'add', 'assign', 'remove', 'move']) {
      expect(MVU_DIALECT_RE.functionCall.test(`_.${cmd}('a', 1)`)).toBe(true);
    }
  });
});
