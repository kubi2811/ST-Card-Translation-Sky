import { describe, it, expect } from 'vitest';
import { isDuplicateEntry } from '../deduplicator';
import { TFIDFIndex } from '../../rag/tfidfIndexer';
import type { LorebookEntry, AIGeneratedEntry } from '../../../types';

/**
 * (User 23/07 — việc 90) "Khi nhiều luồng song song chạy cùng lúc, dễ xảy ra tình huống trùng
 * lặp entry, một nhân vật lại được tạo tới 3 entry có nội dung y hệt nhau."
 *
 * Các batch trong cùng một vòng chạy SONG SONG và đều nhận CÙNG ngữ cảnh thẻ (trạng thái trước
 * vòng), nên chẳng batch nào biết anh em đang viết gì → ba batch cùng chọn một nhân vật là
 * chuyện bình thường. Bộ lọc trùng là chốt chặn duy nhất, và test này đo xem nó có chặn nổi
 * không với dữ liệu ĐÚNG KIỂU AI sinh ra: cùng một nhân vật, key hơi khác, văn phong khác.
 */

const entry = (o: Partial<LorebookEntry>): LorebookEntry => ({
  id: 1, keys: [], secondary_keys: [], comment: '', content: '',
  constant: false, selective: true, insertion_order: 100, enabled: true,
  position: 'before_char', extensions: {},
  ...o,
} as unknown as LorebookEntry);

const ai = (o: Partial<AIGeneratedEntry>): AIGeneratedEntry => ({
  comment: '', keys: [], content: '', ...o,
} as AIGeneratedEntry);

describe('bộ lọc trùng khi nhiều luồng cùng viết về MỘT nhân vật', () => {
  it('cùng tên entry, key lệch nhẹ, văn phong khác → PHẢI coi là trùng', () => {
    const existing = [entry({
      id: 1,
      comment: 'Lý Tiêu Dao',
      keys: ['Lý Tiêu Dao'],
      content: 'Lý Tiêu Dao là đại đệ tử của Thiên Kiếm Tông. Hắn nổi tiếng vì thiên phú kiếm đạo hiếm có, tính tình lạnh lùng ít nói nhưng trọng nghĩa khí với đồng môn.',
    })];
    const index = new TFIDFIndex();
    index.indexWithSource(existing);

    // Batch song song khác viết lại CHÍNH nhân vật đó, chữ nghĩa khác đi
    const fromOtherBatch = ai({
      comment: 'Lý Tiêu Dao',
      keys: ['Lý Tiêu Dao', 'Tiêu Dao'],
      content: 'Là người đứng đầu hàng đệ tử của tông môn Thiên Kiếm, chàng thanh niên này sở hữu tư chất kiếm thuật thuộc hàng trăm năm có một. Vẻ ngoài lãnh đạm khiến nhiều người e dè, song chàng luôn hết lòng vì huynh đệ.',
    });

    const r = isDuplicateEntry(fromOtherBatch, existing, index);
    expect(r.isDuplicate).toBe(true);
  });

  it('tên entry KHÁC HẲN nhưng cùng nhân vật (biệt danh) → vẫn nên chặn qua key trùng trọn vẹn', () => {
    const existing = [entry({ id: 1, comment: 'Lý Tiêu Dao', keys: ['Lý Tiêu Dao'], content: 'Nội dung A dài vừa đủ để có bigram.' })];
    const index = new TFIDFIndex();
    index.indexWithSource(existing);
    const r = isDuplicateEntry(
      ai({ comment: 'Đại sư huynh Thiên Kiếm Tông', keys: ['Lý Tiêu Dao'], content: 'Nội dung B khác hẳn về câu chữ.' }),
      existing, index,
    );
    expect(r.isDuplicate).toBe(true);
  });

  it('hai NHÂN VẬT KHÁC NHAU trong cùng thế giới → KHÔNG được chặn oan', () => {
    const existing = [entry({
      id: 1, comment: 'Lý Tiêu Dao', keys: ['Lý Tiêu Dao'],
      content: 'Lý Tiêu Dao là đại đệ tử của Thiên Kiếm Tông, thiên phú kiếm đạo hiếm có, tính lạnh lùng.',
    })];
    const index = new TFIDFIndex();
    index.indexWithSource(existing);
    const r = isDuplicateEntry(
      ai({
        comment: 'Vương Thanh Hà', keys: ['Vương Thanh Hà'],
        content: 'Vương Thanh Hà là nhị đệ tử của Thiên Kiếm Tông, sở trường về trận pháp, tính tình hoạt bát vui vẻ.',
      }),
      existing, index,
    );
    expect(r.isDuplicate).toBe(false);
  });

  it('AI thêm tiền tố phân loại ("Nhân vật: X") → vẫn nhận ra cùng một thực thể', () => {
    const existing = [entry({ id: 1, comment: 'Lý Tiêu Dao', keys: ['Lý Tiêu Dao'], content: 'Nội dung gốc về nhân vật này.' })];
    const r = isDuplicateEntry(
      ai({ comment: '[NPC] Lý Tiêu Dao', keys: ['Tiêu Dao huynh'], content: 'Một cách viết hoàn toàn khác về cùng người.' }),
      existing, new TFIDFIndex(),
    );
    expect(r.isDuplicate).toBe(true);
    expect(r.reason).toBe('identity');
  });

  it('tên chỉ khác hoa/thường và dấu câu → vẫn là một', () => {
    const existing = [entry({ id: 1, comment: 'Thiên Kiếm Tông', keys: ['Thiên Kiếm Tông'], content: 'Môn phái lớn.' })];
    const r = isDuplicateEntry(
      ai({ comment: 'thiên kiếm tông.', keys: ['tông môn'], content: 'Cách viết khác hẳn.' }),
      existing, new TFIDFIndex(),
    );
    expect(r.isDuplicate).toBe(true);
  });

  it('tên NGẮN trùng nhau nhưng là hai thực thể khác → không chặn oan qua luật "tên nằm trong key"', () => {
    const existing = [entry({ id: 1, comment: 'Đao', keys: ['vũ khí', 'binh khí'], content: 'Vũ khí phổ thông trong thế giới.' })];
    const r = isDuplicateEntry(
      ai({ comment: 'Thương', keys: ['đao', 'giáo'], content: 'Một loại binh khí dài, khác hẳn đao.' }),
      existing, new TFIDFIndex(),
    );
    // "đao" chỉ 3 ký tự < ngưỡng 4 nên không được dùng làm bằng chứng danh tính
    expect(r.reason).not.toBe('identity');
  });

  it('nội dung Y HỆT nhau → chặn được (ca dễ nhất)', () => {
    const content = 'Một đoạn nội dung đủ dài để sinh ra bigram và bị bắt trùng bởi lớp vân tay nội dung.';
    const existing = [entry({ id: 1, comment: 'A', keys: ['a'], content })];
    const r = isDuplicateEntry(ai({ comment: 'B', keys: ['b'], content }), existing, new TFIDFIndex());
    expect(r.isDuplicate).toBe(true);
  });
});
