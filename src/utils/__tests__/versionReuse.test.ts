import { describe, it, expect } from 'vitest';
import { applyVersionReuse, type VersionSnapshot } from '../versionReuse';
import type { TranslationField } from '../../types/card';

function mkField(partial: Partial<TranslationField>): TranslationField {
  return {
    path: 'data.description',
    label: 'Description',
    group: 'core',
    original: '',
    translated: '',
    status: 'pending',
    retries: 0,
    ...partial,
  } as TranslationField;
}

const snapV22: VersionSnapshot = {
  key: 'Tuhu_V2.2.png',
  savedAt: 100,
  fields: [
    mkField({ path: 'entries[5].content', group: 'lorebook', original: '青云宗的历史', translated: 'Lịch sử Thanh Vân Tông', status: 'done' }),
    mkField({ path: 'data.first_mes', group: 'messages', original: '你好', translated: 'Xin chào', status: 'done' }),
    mkField({ path: 'entries[6].content', group: 'lorebook', original: '还没翻译的', translated: '', status: 'pending' }),
  ],
  dicts: { mvuDictionary: { 好感度: 'Hảo_Cảm' } },
};

describe('applyVersionReuse', () => {
  it('bê bản dịch cũ khi trùng hệt nội dung + nhóm + loại; path KHÁC vẫn khớp (entry bị đảo thứ tự)', () => {
    const fields = [
      // path đổi (entry chèn thêm làm xô index) nhưng nội dung y nguyên → vẫn tái dùng
      mkField({ path: 'entries[9].content', group: 'lorebook', original: '青云宗的历史' }),
      mkField({ path: 'data.first_mes', group: 'messages', original: '你好' }),
      mkField({ path: 'entries[1].content', group: 'lorebook', original: '全新内容V2.3' }),
    ];
    const r = applyVersionReuse(fields, [snapV22]);
    expect(r.reused).toBe(2);
    expect(r.fields[0].status).toBe('done');
    expect(r.fields[0].translated).toBe('Lịch sử Thanh Vân Tông');
    expect(r.fields[0].reusedFrom).toBe('Tuhu_V2.2.png');
    expect(r.fields[1].status).toBe('done');
    // Nội dung mới → giữ pending, không đụng
    expect(r.fields[2].status).toBe('pending');
    expect(r.fields[2].translated).toBe('');
    expect(r.bySource['Tuhu_V2.2.png']).toBe(2);
    expect(r.topSource?.key).toBe('Tuhu_V2.2.png');
  });

  it('nội dung ĐỔI (dù path trùng) → không tái dùng', () => {
    const fields = [
      mkField({ path: 'entries[5].content', group: 'lorebook', original: '青云宗的历史（V2.3 修改版）' }),
    ];
    const r = applyVersionReuse(fields, [snapV22]);
    expect(r.reused).toBe(0);
    expect(r.fields[0].status).toBe('pending');
  });

  it('khác nhóm hoặc khác entryType → không tái dùng (tránh sai ngữ cảnh)', () => {
    const fields = [
      mkField({ group: 'regex', original: '青云宗的历史' }),                          // khác group
      mkField({ group: 'lorebook', original: '青云宗的历史', entryType: 'initvar' }), // khác entryType
    ];
    const r = applyVersionReuse(fields, [snapV22]);
    expect(r.reused).toBe(0);
  });

  it('field nguồn chưa done / không có bản dịch → không vào kho', () => {
    const fields = [mkField({ group: 'lorebook', original: '还没翻译的' })];
    const r = applyVersionReuse(fields, [snapV22]);
    expect(r.reused).toBe(0);
  });

  it('field đích không còn pending (done/ignored) → không đụng vào', () => {
    const fields = [
      mkField({ group: 'messages', original: '你好', status: 'done', translated: 'Bản user tự dịch' }),
      mkField({ group: 'lorebook', original: '青云宗的历史', status: 'ignored' }),
    ];
    const r = applyVersionReuse(fields, [snapV22]);
    expect(r.reused).toBe(0);
    expect(r.fields[0].translated).toBe('Bản user tự dịch');
    expect(r.fields[1].status).toBe('ignored');
  });

  it('2 cache cùng có 1 nội dung → cache đứng TRƯỚC (mới hơn) thắng', () => {
    const snapV23: VersionSnapshot = {
      key: 'Tuhu_V2.3.png',
      savedAt: 200,
      fields: [
        mkField({ group: 'messages', original: '你好', translated: 'Chào bạn (bản mới hơn)', status: 'done' }),
      ],
    };
    const fields = [mkField({ group: 'messages', original: '你好' })];
    const r = applyVersionReuse(fields, [snapV23, snapV22]); // caller sắp mới nhất trước
    expect(r.fields[0].translated).toBe('Chào bạn (bản mới hơn)');
    expect(r.fields[0].reusedFrom).toBe('Tuhu_V2.3.png');
  });

  it('original rỗng → bỏ qua cả 2 chiều', () => {
    const snap: VersionSnapshot = {
      key: 'x.png',
      fields: [mkField({ original: '', translated: 'rác', status: 'done' })],
    };
    const fields = [mkField({ original: '' })];
    const r = applyVersionReuse(fields, [snap]);
    expect(r.reused).toBe(0);
  });
});
