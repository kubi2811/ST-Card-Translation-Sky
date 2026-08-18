/**
 * injectMvuSystemEntry — một cửa duy nhất để MVUZOD Studio ghi entry hệ thống vào thẻ.
 *
 * Ba thứ phải đúng, và cả ba đều từng sai:
 *  1. Bấm lại là CẬP NHẬT chứ không đẻ thêm. Tab Update dò entry cũ bằng so sánh chuỗi tuyệt đối,
 *     mà tab Biến số lại đặt tên khác ("… - <tên nhân vật>") ⇒ mỗi tab một entry quy tắc, nội dung
 *     đá nhau (cùng bệnh với bug 236).
 *  2. [initvar] phải ghi ra ở trạng thái TẮT — engine chỉ đọc nó làm template khi enabled=false,
 *     và ST đọc cờ `disable` chứ không đọc `enabled`, thiếu là nhập thẻ vào thấy entry đang bật.
 *  3. Vị trí phải theo đặc tả chuẩn. Bản cũ ghi positionExt=0 kèm depth=4 (depth bị bỏ qua) và
 *     role=1 (=user) cho entry lẽ ra phải là system.
 */
import { describe, it, expect } from 'vitest';
import { injectMvuSystemEntry } from '../injectSystemEntry';
import { useCardStore } from '../../../store/cardStore';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA = {
  version: '1.0',
  fields: [
    {
      path: '/Thế Giới', type: 'object', label: 'Thế Giới', defaultValue: {}, constraints: {},
      children: [
        { path: '/Thế Giới/Thời Gian', type: 'string', label: 'Thời Gian', defaultValue: 'Sáng', constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

const entriesNow = () => useCardStore.getState().card.data.character_book?.entries ?? [];

describe('injectMvuSystemEntry', () => {
  it('bấm lần hai thì cập nhật đúng entry cũ, không mọc bản trùng', () => {
    const a = injectMvuSystemEntry('update_rules', 'nội dung 1', SCHEMA);
    expect(a.level).toBe('success');
    const dem1 = entriesNow().filter(e => /\[mvu_update\].*quy tắc/i.test(e.comment)).length;

    const b = injectMvuSystemEntry('update_rules', 'nội dung 2', SCHEMA);
    const dem2 = entriesNow().filter(e => /\[mvu_update\].*quy tắc/i.test(e.comment)).length;

    expect(dem1).toBe(1);
    expect(dem2).toBe(1);
    expect(b.entryId).toBe(a.entryId);
    expect(entriesNow().find(e => e.id === a.entryId)?.content).toBe('nội dung 2');
  });

  it('[initvar] ghi ra ở trạng thái TẮT — cả enabled lẫn disable', () => {
    const r = injectMvuSystemEntry('initvar', 'Thế Giới:\n  Thời Gian: Sáng', SCHEMA);
    const e = entriesNow().find(x => x.id === r.entryId)!;
    expect(e.enabled).toBe(false);
    expect(e.disable).toBe(true);
  });

  it('Danh sách biến vào đúng @D0, role system, order 200', () => {
    const r = injectMvuSystemEntry('varlist', 'bảng biến', SCHEMA);
    const e = entriesNow().find(x => x.id === r.entryId)!;
    expect(e.extensions.position).toBe(4);   // @depth
    expect(e.extensions.depth).toBe(0);
    expect(e.extensions.role).toBe(0);       // system
    expect(e.insertion_order).toBe(200);
  });
});
