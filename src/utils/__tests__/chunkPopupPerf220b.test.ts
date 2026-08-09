/**
 * (bug 220b) MỞ BẢNG CHUNK CỦA ENTRY LỚN LÀM TREO HẲN TRÌNH DUYỆT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Đo được trên chính entry TavernHelper 716.283 ký tự chia 74 phần: bấm "Xem chi tiết chunk"
 * thì tiến trình vẽ đứng hình, `navigate` hết 300 giây vẫn không phản hồi, phải giết tab.
 *
 * Hai nguồn gây ra, cả hai đều tỉ lệ thuận với cỡ entry nên chỉ lộ ra ở entry khổng lồ:
 *
 *   1. Popup vẽ CẢ 74 chunk cùng lúc, mỗi chunk hai ô `white-space: pre-wrap` chứa nguyên văn
 *      ~9.700 ký tự gốc + ~9.700 ký tự dịch ⇒ ~1,4 triệu ký tự chữ đơn cách phải dàn dòng
 *      trong một nhịp vẽ.
 *   2. `auditChunks` — quét regex CJK trên cả gốc lẫn dịch của từng chunk — chạy TRẦN trong
 *      thân component, tức mỗi lần store nhúc nhích là quét lại 1,4 MB. Trong lúc dịch thì cứ
 *      mỗi chunk xong là một lần.
 *
 * Test này khoá cả hai bằng cách đọc mã nguồn: không dựng nổi DOM 74 chunk trong vitest mà
 * không tái hiện đúng cái treo cần tránh.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../components/FieldEditor.tsx', import.meta.url), 'utf-8')
  .replace(/\r\n/g, '\n');

/** Thân popup — từ chỗ khai báo renderDetailsList tới hết portal. */
const popup = src.slice(src.indexOf('const renderDetailsList ='), src.indexOf("), document.body);"));

describe('(bug 220b) phép soi chunk phải được nhớ lại, không quét mỗi lần vẽ', () => {
  it('auditChunks nằm trong useMemo', () => {
    const i = src.indexOf('auditChunks(');
    expect(i, 'không tìm thấy lời gọi auditChunks').toBeGreaterThan(0);
    const before = src.slice(Math.max(0, i - 400), i);
    expect(before, 'auditChunks đang chạy trần trong thân component').toContain('useMemo(');
  });

  it('chỉ có ĐÚNG MỘT lời gọi auditChunks trong component', () => {
    expect([...src.matchAll(/auditChunks\(/g)].length).toBe(1);
  });

  it('chữ ký phụ thuộc dùng ĐỘ DÀI ô, không nhét cả mảng chuỗi vào deps', () => {
    // Nhét thẳng field.completedChunks vào deps là vô dụng: mảng đổi tham chiếu mỗi lần cập
    // nhật nên memo không bao giờ trúng.
    expect(src).toContain('const doneSig =');
    expect(src).toContain('const rawSig =');
    expect(src).toMatch(/\[field\.path, totalChunks, rawSig, doneSig\]/);
  });

  it('issueByIndex cũng được nhớ lại', () => {
    expect(src).toMatch(/const issueByIndex = useMemo\(/);
  });
});

describe('(bug 220b) popup chỉ vẽ một trang, mỗi ô cắt bớt', () => {
  it('KHÔNG còn vẽ toàn bộ totalChunks trong popup', () => {
    expect(popup).not.toMatch(/Array\.from\(\{ length: totalChunks \}\)\.map/);
  });

  it('có phân trang thật: cỡ trang, lát cắt, và số trang', () => {
    expect(popup).toContain('const PAGE_SIZE =');
    expect(popup).toMatch(/listIdx\.slice\(page \* PAGE_SIZE/);
    expect(popup).toContain('const pageCount =');
  });

  it('trang hiện tại luôn bị kẹp trong khoảng hợp lệ', () => {
    // Lọc "chỉ chunk có vấn đề" làm số trang tụt xuống; nếu không kẹp thì đang đứng trang 7 mà
    // lọc còn 1 trang là popup trắng trơn.
    expect(popup).toMatch(/Math\.min\(Math\.max\(0, chunkPage\), pageCount - 1\)/);
  });

  it('ô xem trước cắt ở PREVIEW_CHARS, mở đủ theo TỪNG ô', () => {
    expect(popup).toContain('const PREVIEW_CHARS =');
    expect(popup).toMatch(/text\.slice\(0, PREVIEW_CHARS\)/);
    expect(popup).toContain('setOpenCells(');
  });

  it('có bộ lọc chỉ hiện chunk có vấn đề, và lọc thì về trang đầu', () => {
    expect(popup).toContain('onlyIssues');
    expect(popup).toMatch(/setOnlyIssues\(e\.target\.checked\); setChunkPage\(0\);/);
  });

  it('cắt bớt KHÔNG làm mất đường lấy toàn văn', () => {
    // Nút chép gốc / chép dịch / tải JSON vẫn nhận biến đầy đủ, không nhận bản đã cắt.
    expect(popup).toMatch(/copyText\(raw,/);
    expect(popup).toMatch(/copyText\(trans,/);
    expect(popup).toMatch(/downloadChunk\(idx\)/);
  });
});

describe('(bug 220b) popup vẫn phải đi qua portal ra body', () => {
  it('giữ nguyên bài học bug 220: fixed trong cây có transform thì vô nghĩa', () => {
    expect(popup).toContain('createPortal(');
    expect(src).toContain("), document.body);");
  });
});
