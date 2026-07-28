// (bug 134) "Batch X — không đọc được JSON" liên tục ở Auto Creator.
// Log user gửi: «[ { "keys": [ "7 Phả Hệ Shard", … ], "content": "<System>\n**7 Phả Hệ Sha…»
// Dựng lại đúng các dạng phản hồi sinh ra dòng log đó. Ba dạng từng làm cả lô bị vứt:
//   B. entry JSON HỢP LỆ nhưng thiếu "comment"  (luật cũ đòi đủ comment+keys+content)
//   C. output bị CẮT giữa entry DUY NHẤT       (salvage cũ bỏ hẳn object cuối chưa đóng)
//   E. model dùng "name"/"title" thay "comment"
import { describe, it, expect } from 'vitest';
import { tryExtractJsonArray, looksTruncated } from '../batchGenerator';

const LONG = 'Ignis: hệ hoả, thân nhiệt cao, kháng lửa. Glacis: hệ băng, chịu lạnh cực hạn. '.repeat(6);

describe('(bug 134) bóc JSON của batch lorebook — không vứt cả lô vì thiếu nhãn hay bị cắt', () => {
  it('entry đủ comment/keys/content (đối chứng) — bóc bình thường', () => {
    const raw = JSON.stringify([{ comment: '7 Phả Hệ Shard', keys: ['Phả Hệ', 'Ignis'], content: LONG }]);
    const got = tryExtractJsonArray(raw)!;
    expect(got).toHaveLength(1);
    expect(got[0].comment).toBe('7 Phả Hệ Shard');
  });

  it('THIẾU "comment" → suy nhãn từ keys[0], giữ nguyên nội dung (ca trong log của user)', () => {
    const raw = JSON.stringify([{ keys: ['7 Phả Hệ Shard', 'Ignis', 'Glacis'], content: `<System>\n**7 Phả Hệ**\n${LONG}` }]);
    const got = tryExtractJsonArray(raw)!;
    expect(got).toHaveLength(1);
    expect(got[0].comment).toBe('7 Phả Hệ Shard');
    expect(got[0].keys).toContain('Ignis');
    expect(got[0].content).toContain('Phả Hệ');
  });

  it('THIẾU cả comment lẫn keys → nhãn suy từ dòng đầu content, key dùng chính nhãn đó', () => {
    const got = tryExtractJsonArray(JSON.stringify([{ content: `**Hội Đồng Ánh Sáng**\n${LONG}` }]))!;
    expect(got).toHaveLength(1);
    expect(got[0].comment).toBe('Hội Đồng Ánh Sáng');
    expect(got[0].keys).toEqual(['Hội Đồng Ánh Sáng']);
  });

  it('dùng "name"/"title" thay cho "comment" — vẫn nhận', () => {
    expect(tryExtractJsonArray(JSON.stringify([{ name: 'Shard Lai', keys: ['Lai'], content: LONG }]))![0].comment).toBe('Shard Lai');
    expect(tryExtractJsonArray(JSON.stringify([{ title: 'Umbra', keys: ['Umbra'], content: LONG }]))![0].comment).toBe('Umbra');
  });

  it('output BỊ CẮT giữa entry DUY NHẤT → vá đuôi, cứu được phần nội dung đã nhận', () => {
    const raw = `[\n  {\n    "keys": ["7 Phả Hệ Shard", "Ignis"],\n    "content": "<System>\\n**7 Phả Hệ**\\n${LONG}`;
    const got = tryExtractJsonArray(raw)!;
    expect(got).toHaveLength(1);
    expect(got[0].content).toContain('Ignis: hệ hoả');
    expect(got[0].comment).toBe('7 Phả Hệ Shard');
  });

  it('bị cắt sau vài entry hoàn chỉnh → giữ entry đủ + cứu thêm entry dở', () => {
    const full = (n: number) => `{"comment":"Entry ${n}","keys":["k${n}"],"content":"${LONG}"}`;
    const raw = `[${full(1)},${full(2)},{"comment":"Entry 3","keys":["k3"],"content":"${LONG.slice(0, 200)}`;
    const got = tryExtractJsonArray(raw)!;
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.map(e => e.comment)).toEqual(expect.arrayContaining(['Entry 1', 'Entry 2']));
  });

  it('cắt ngay giữa dấu escape (`…\\`) không làm hỏng chuỗi khi vá', () => {
    const raw = `[{"comment":"A","keys":["a"],"content":"${LONG}\\`;
    const got = tryExtractJsonArray(raw);
    expect(got).not.toBeNull();
    expect(got![0].content).toContain('Ignis');
  });

  it('KHÔNG nhận bừa: mảng chuỗi, object rác, content quá ngắn đều bị loại', () => {
    expect(tryExtractJsonArray(JSON.stringify(['a', 'b', 'c']))).toBeNull();
    expect(tryExtractJsonArray(JSON.stringify([{ foo: 1, bar: 2 }]))).toBeNull();
    expect(tryExtractJsonArray(JSON.stringify([{ comment: 'X', keys: ['x'], content: 'ngắn' }]))).toBeNull();
    expect(tryExtractJsonArray('xin chào, đây không phải JSON')).toBeNull();
  });

  it('looksTruncated: nhận diện bị cắt bằng CẤU TRÚC, không cần finishReason', () => {
    expect(looksTruncated('[{"a":1}]')).toBe(false);
    expect(looksTruncated('[{"a":1}')).toBe(true);          // thiếu ]
    expect(looksTruncated('[{"content":"đang viết dở')).toBe(true);   // chuỗi chưa đóng
    expect(looksTruncated('')).toBe(false);
  });
});
