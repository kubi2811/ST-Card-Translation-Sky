/**
 * (bugNeedFix/144) Soi & ghép lại chunk cho entry lớn. Bám đúng 3 than phiền đo được của user:
 * ghép xong bị thiếu chunk, không biết chunk nào lỗi, không ghép lại được thủ công.
 */
import { describe, it, expect } from 'vitest';
import { auditChunks, joinChunks, summarizeAudit } from '../chunkAudit';

const vi = (n: number) => 'Đây là một đoạn văn tiếng Việt đã dịch. '.repeat(n);
const zh = (n: number) => '这是一段中文原文内容需要翻译。'.repeat(n);

describe('auditChunks — chỉ đích danh chunk hỏng', () => {
  it('mọi chunk lành thì không báo gì', () => {
    const raw = [zh(5), zh(5), zh(5)];
    const done = [vi(5), vi(5), vi(5)];
    const a = auditChunks(raw, done);
    expect(a.issues).toEqual([]);
    expect(a.okCount).toBe(3);
    expect(summarizeAudit(a)).toContain('Đủ và sạch');
  });

  it('CHÍNH CA: chunk rỗng bị bắt — đây là thứ làm "ghép xong thiếu"', () => {
    const raw = [zh(5), zh(5), zh(5)];
    const done = [vi(5), '', vi(5)];
    const a = auditChunks(raw, done);
    expect(a.suspectIndices).toEqual([1]);
    expect(a.issues[0].kind).toBe('missing');
    expect(summarizeAudit(a)).toContain('chunk số 2');
  });

  it('chunk thiếu hẳn (undefined) cũng bị bắt', () => {
    const a = auditChunks([zh(5), zh(5)], [vi(5)]);
    expect(a.suspectIndices).toEqual([1]);
  });

  it('chunk còn nguyên tiếng Trung = chưa dịch', () => {
    const raw = [zh(10), zh(10)];
    const done = [vi(10), zh(10)];   // chunk 2 bị chép nguyên bản gốc
    const a = auditChunks(raw, done);
    expect(a.suspectIndices).toEqual([1]);
    expect(a.issues[0].kind).toBe('untranslated');
  });

  it('chunk bị cắt cụt bị bắt', () => {
    const a = auditChunks([zh(20)], ['Ngắn ngủn.']);
    expect(a.issues[0].kind).toBe('too-short');
  });

  it('chunk phình bất thường bị bắt', () => {
    const a = auditChunks([zh(3)], [vi(40)]);   // gấp ~35 lần
    expect(a.issues[0].kind).toBe('too-long');
  });

  it('KHÔNG báo oan: Trung→Việt vốn dài gấp ~2,7 lần là bình thường', () => {
    // Một chữ Hán gánh nguyên một từ, nên bản dịch nở ra là đương nhiên. Ngưỡng cố định
    // kiểu "quá 2,5 lần là bất thường" sẽ bắt oan CHUNK NÀO CŨNG lỗi ⇒ nút soi thành vô dụng.
    const a = auditChunks([zh(10)], [vi(10)]);
    expect(a.issues).toEqual([]);
  });

  it('ngưỡng siết lại khi gốc KHÔNG phải chữ Hán', () => {
    const en = 'This is an English sentence that should stay about the same length. '.repeat(5);
    expect(auditChunks([en], [en + en + en]).issues[0].kind).toBe('too-long');
    expect(auditChunks([en], [en]).issues).toEqual([]);
  });

  it('mỗi chunk chỉ bị kể một lần dù dính nhiều dấu hiệu', () => {
    const a = auditChunks([zh(10), zh(10)], ['', '']);
    expect(a.suspectIndices).toEqual([0, 1]);
    expect(a.issues).toHaveLength(2);
  });
});

describe('joinChunks — ghép đúng quy tắc engine', () => {
  it('văn xuôi: cách một dòng trống', () => {
    expect(joinChunks(['A', 'B'], 'văn xuôi bình thường')).toBe('A\n\nB');
  });

  it('HTML: nối liền, không chèn ký tự lạ vào giữa thẻ', () => {
    const src = '<div class="a">nội dung</div>';
    expect(joinChunks(['<div>', '</div>'], src)).toBe('<div></div>');
  });

  it('code nặng: nối liền', () => {
    const src = 'const a=1;'.repeat(30) + ' function f(){ return 1; }';
    expect(joinChunks(['const a=1;', 'const b=2;'], src)).toBe('const a=1;const b=2;');
  });

  it('ghép lại từ đủ chunk cho ra đúng toàn văn', () => {
    const parts = ['Phần một.', 'Phần hai.', 'Phần ba.'];
    expect(joinChunks(parts, 'văn xuôi')).toBe('Phần một.\n\nPhần hai.\n\nPhần ba.');
  });
});
