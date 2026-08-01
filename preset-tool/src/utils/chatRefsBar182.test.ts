/**
 * (bugNeedFix/182) "Đề xuất cho phép hạ cái đống học từ mẫu và các preset ví dụ xuống,
 * UI như này che hết cái chat rồi."
 * ─────────────────────────────────────────────────────────────────────────────
 * Khối "Học từ mẫu" (bug 169) và dải "Nạp preset mẫu" (bug 139) là hai khối RIÊNG nằm chồng
 * nhau ngay trên ô nhập, mỗi khối lại tự xuống dòng theo số chip. Ảnh user gửi: 3 preset mẫu +
 * 5 file thư viện = 6 hàng chip, chat chỉ còn một mẩu.
 *
 * ChatWindow là JSX và repo này không có jsdom, nên kiểm bằng cách đọc chính mã nguồn —
 * đủ để CHỐT mấy điều dễ vô tình làm hỏng lại sau này:
 *   1. mặc định ĐÓNG (mở sẵn là quay về đúng cảnh user than);
 *   2. chip chỉ vẽ khi đang MỞ (đóng mà vẫn vẽ thì thu gọn vô nghĩa);
 *   3. mở ra vẫn có TRẦN chiều cao + cuộn riêng (20 preset không được đẩy chat đi lần nữa);
 *   4. lúc đóng vẫn nạp được file và vẫn thấy cảnh báo "thiếu N nhóm" — thu gọn là giấu chỗ
 *      chiếm chỗ, không phải giấu việc cần làm.
 */
import { describe, it, expect } from 'vitest';
// Đọc mã nguồn bằng `?raw` của Vite chứ không phải node:fs — tsconfig.app của app này chỉ khai
// `types: ["vite/client"]`, nên `node:fs` không có kiểu và `npm run build` (tsc -b) sẽ đỏ.
import RAW from '../components/ChatWindow.tsx?raw';

// Repo checkout ra CRLF; trong JS dấu `.` KHÔNG khớp `\r`, nên regex nhiều dòng sẽ trượt oan
// nếu không chuẩn hoá trước (bài học từ appLayout165).
const SRC = RAW.replace(/\r\n/g, '\n');

describe('Thanh "Nguồn tham khảo" — thu gọn (bug 182)', () => {
  it('mặc định ĐÓNG và nhớ lựa chọn của user', () => {
    expect(SRC).toContain("usePersistedState('pt.chat.refsOpen', false)");
  });

  it('chỉ có MỘT thanh, không còn hai khối chồng nhau', () => {
    // Trước: hai <div className="px-4 py-1.5 border-t …"> liền nhau (exemplars + thư viện).
    const strips = SRC.match(/className="px-4 py-1\.5 border-t border-theme-border/g) ?? [];
    expect(strips).toHaveLength(0);
    expect(SRC).toContain('📚 Nguồn tham khảo');
  });

  it('danh sách chip nằm TRONG nhánh đang mở', () => {
    const open = SRC.indexOf('{refsOpen && (');
    expect(open).toBeGreaterThan(0);
    const body = SRC.slice(open);
    // Cả chip preset mẫu (📘) lẫn chip thư viện (📌/📄) đều phải nằm sau cổng refsOpen.
    expect(body).toContain('📘 {p.name}');
    expect(body).toContain('🎓 Học từ mẫu');
    expect(body).toContain("{p.pinned ? '📌' : '📄'}");
    // …và không có bản sao nào lọt ra ngoài cổng.
    const before = SRC.slice(0, open);
    expect(before).not.toContain('📘 {p.name}');
    expect(before).not.toContain("{p.pinned ? '📌' : '📄'}");
  });

  it('mở ra vẫn bị chặn trần chiều cao + cuộn riêng', () => {
    const open = SRC.indexOf('{refsOpen && (');
    expect(SRC.slice(open, open + 400)).toMatch(/max-h-\d+[\s\S]*overflow-y-auto/);
  });

  it('lúc đóng vẫn nạp được file: nút nạp và vùng thả nằm NGOÀI nhánh mở', () => {
    const open = SRC.indexOf('{refsOpen && (');
    const before = SRC.slice(0, open);
    expect(before).toContain('onDrop=');
    expect(before).toContain('t.plImportBtn');
    // Thả/nạp file thì tự mở ra để user thấy ngay thứ vừa thêm.
    expect(before).toContain('setRefsOpen(true)');
  });

  it('cảnh báo "thiếu N nhóm" vẫn hiện khi đang đóng', () => {
    const open = SRC.indexOf('{refsOpen && (');
    expect(SRC.slice(0, open)).toContain('thiếu {gap.missingGroups.length} nhóm');
  });

  it('thu gọn KHÔNG cắt ngữ cảnh gửi cho AI', () => {
    // buildExemplarContext/buildPresetLibraryContext phải chạy từ dữ liệu, tuyệt đối không
    // phụ thuộc refsOpen — nếu không thì "hạ xuống cho đỡ vướng" hoá ra là tắt tính năng.
    const sendBlock = SRC.slice(SRC.indexOf('const handleSend'), SRC.indexOf('const handlePrefill'));
    expect(sendBlock).toContain('buildExemplarContext(exemplars');
    expect(sendBlock).toContain('buildPresetLibraryContext(presetLib');
    expect(sendBlock).not.toContain('refsOpen');
  });
});
