// (bugNeedFix/96) "AI Sinh Theo Batch" báo "AI trả về không phải JSON array" hàng loạt.
// Gốc: prompt đòi MẢNG entry, nhưng nếu provider bật chế độ bắt-buộc-JSON-object thì mảng ở
// cấp cao nhất bị CẤM ⇒ model trả object/NDJSON ⇒ tool coi như hỏng và bỏ cả lô.
import { describe, it, expect } from 'vitest';
import { tryExtractJsonArray } from '../batchGenerator';

const ENTRY = {
  comment: 'Thanh Vân Tông',
  keys: ['Thanh Vân', 'tông môn'],
  content: 'Tông môn lớn nhất Đông Vực, cai quản ba ngọn núi và bảy tuyến bí cảnh.',
};

describe('Dạng chuẩn vẫn đọc được như cũ', () => {
  it('mảng JSON trần', () => {
    expect(tryExtractJsonArray(JSON.stringify([ENTRY]))?.length).toBe(1);
  });

  it('mảng trong code fence ```json', () => {
    expect(tryExtractJsonArray('```json\n' + JSON.stringify([ENTRY]) + '\n```')?.length).toBe(1);
  });

  it('object bọc { entries: [...] }', () => {
    expect(tryExtractJsonArray(JSON.stringify({ entries: [ENTRY, ENTRY] }))?.length).toBe(2);
  });
});

describe('CHÍNH CA BUG 96: các dạng model trả khi bị ép JSON object', () => {
  it('MỘT entry trần (không bọc mảng) → nhận, không còn báo "không phải JSON array"', () => {
    const r = tryExtractJsonArray(JSON.stringify(ENTRY));
    expect(r).not.toBeNull();
    expect(r!.length).toBe(1);
    expect(r![0].comment).toBe('Thanh Vân Tông');
  });

  it('NDJSON — mỗi dòng một entry', () => {
    const nd = [JSON.stringify(ENTRY), JSON.stringify({ ...ENTRY, comment: 'Bí cảnh Kim Đan' })].join('\n');
    const r = tryExtractJsonArray(nd);
    expect(r?.length).toBe(2);
    expect(r!.map(e => e.comment)).toContain('Bí cảnh Kim Đan');
  });

  it('mảng bị CẮT CỤT giữa chừng (chạm giới hạn token) → cứu được phần entry hoàn chỉnh', () => {
    const cut = '[' + JSON.stringify(ENTRY) + ',' + JSON.stringify(ENTRY).slice(0, 40);
    const r = tryExtractJsonArray(cut);
    expect(r?.length).toBe(1);
  });

  it('có lời dẫn của model trước mảng → vẫn bóc được', () => {
    const r = tryExtractJsonArray('Đây là các entry bạn yêu cầu:\n' + JSON.stringify([ENTRY]));
    expect(r?.length).toBe(1);
  });
});

describe('Không nhận bừa rác', () => {
  it('văn xuôi thuần → null (để pipeline biết mà thử lại)', () => {
    expect(tryExtractJsonArray('Xin lỗi, tôi không thể tạo nội dung này.')).toBeNull();
  });

  it('object KHÔNG phải entry (thiếu comment/keys/content) → null', () => {
    expect(tryExtractJsonArray(JSON.stringify({ status: 'ok', count: 3 }))).toBeNull();
  });

  it('entry thiếu keys → bị loại, không lọt vào card', () => {
    expect(tryExtractJsonArray(JSON.stringify([{ comment: 'X', content: 'y' }]))).toBeNull();
  });
});
