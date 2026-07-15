import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cleanTranslationResponse } from '../apiClient';

/**
 * (User 2026 — bug 21: lorebook "SEX NOTE" dịch xong MẤT TRỌN KHÚC ĐẦU)
 * Gốc rễ: heuristic chống ảo giác "gốc → dịch" (Pattern 1 trong cleanTranslationResponse) có 2 lỗ:
 * 1) Bản GỐC có sẵn dấu → trong nội dung ("1. 写下名字+回想容貌 → 40秒倒计时开始") — bản dịch giữ →
 *    là ĐÚNG, nhưng heuristic vẫn split cả bản dịch tại đó.
 * 2) calculateOverlap mù CJK: split(/\W+/) vứt sạch chữ Hán → bản gốc Trung chỉ còn vài token ASCII
 *    (rule_name, sex, note, version, rule_type, play) — đều được GIỮ NGUYÊN trong bản dịch (YAML key
 *    + tên riêng) → overlap = 1.0 → nửa TRÁI (cả khúc đầu bản dịch) bị vứt như thể là "echo bản gốc".
 * Fixture = ĐÚNG nội dung entry của user (bugNeedFix/21/lorebook.txt).
 */

const ORIGINAL = readFileSync(join(__dirname, 'fixtures', 'lorebook-sexnote-bug21.txt'), 'utf8');

// Bản dịch mô phỏng: giữ YAML key ASCII + "SEX NOTE" + dòng mũi tên — đúng dạng AI trả về thật
const TRANSLATED = `rule_name: Quy tắc SEX NOTE Ghi Chú Tình Ái
version: 1
rule_type: quy tắc hiển thị
- Loại: quy tắc hiển thị
    Định nghĩa: chữ quy tắc viết rõ trên sổ, người giữ sổ đọc trực tiếp được
Phạm vi áp dụng:
  - Đối tượng: người nhặt và giữ SEX NOTE, cùng người bị viết tên
Mô tả cốt lõi: "SEX NOTE là cuốn sổ đen của Dâm Thần rơi xuống nhân gian"
Điểm chính:
  - Điều kiện vận hành: |
      Điều kiện kích hoạt: viết tên thật + hồi tưởng dung mạo, thiếu một là không được.
  - Cách vận hành: |
  Quy trình cơ bản:
  1. Viết tên + hồi tưởng dung mạo → Bắt đầu đếm ngược 40 giây
  2. Sau 40 giây, mục tiêu đến bên người sở hữu cuốn sổ
  3. Mục tiêu và người sở hữu thực hiện hành vi, mặc định một lần
  4. Kết thúc thì quy trình chấm dứt
Bổ sung:
  - Ngoại lệ: |
      Nghẹt thở play (trước khi chết) vẫn được tính là hợp lệ.`;

describe('cleanTranslationResponse — bug 21: gốc có dấu → không được cắt bản dịch', () => {
  it('BUG THẬT (fixture user): bản dịch giữ TRỌN khúc đầu, không bị vứt nửa trái tại →', () => {
    expect(ORIGINAL.length).toBeLessThan(2000);      // điều kiện kích hoạt Pattern 1 cũ
    expect(ORIGINAL).toContain('→');                  // gốc CÓ mũi tên trong nội dung
    const out = cleanTranslationResponse(ORIGINAL, TRANSLATED, false, false);
    // Khúc đầu phải còn NGUYÊN (bug cũ: out bắt đầu từ "Bắt đầu đếm ngược 40 giây")
    expect(out.startsWith('rule_name:')).toBe(true);
    expect(out).toContain('version: 1');
    expect(out).toContain('Điều kiện vận hành');
    // Dòng mũi tên giữ nguyên cả 2 vế
    expect(out).toContain('1. Viết tên + hồi tưởng dung mạo → Bắt đầu đếm ngược 40 giây');
  });

  it('heuristic VẪN cắt được ảo giác thật: gốc KHÔNG có →, AI trả "echo Trung → bản dịch"', () => {
    const orig = '她是一个温柔的女孩，喜欢在雨天读书，性格安静内向。';
    const halluc = `她是一个温柔的女孩，喜欢在雨天读书，性格安静内向。 → Cô ấy là một cô gái dịu dàng, thích đọc sách ngày mưa, tính cách trầm lặng hướng nội.`;
    const out = cleanTranslationResponse(orig, halluc, false, false);
    expect(out).toBe('Cô ấy là một cô gái dịu dàng, thích đọc sách ngày mưa, tính cách trầm lặng hướng nội.');
  });

  it('cắt theo DÒNG chỉ khi vế trái là echo CJK; dòng thuần Việt có → giữ nguyên', () => {
    const orig = '好感度提升。\n信任度下降。\n关系变化。';
    const resp = [
      '好感度提升。 → Độ hảo cảm tăng lên.',
      'Tiến trình: Luyện Khí → Trúc Cơ', // dòng dịch thuần Việt có → là NỘI DUNG
      '关系变化。 → Quan hệ thay đổi.',
    ].join('\n');
    const out = cleanTranslationResponse(orig, resp, false, false);
    expect(out).toContain('Độ hảo cảm tăng lên.');
    expect(out).toContain('Quan hệ thay đổi.');
    expect(out).toContain('Tiến trình: Luyện Khí → Trúc Cơ'); // KHÔNG bị cắt còn "Trúc Cơ"
    expect(out).not.toContain('好感度');
  });

  it('Pattern 2 (`x` → `y`): gốc có mũi tên ⇒ bỏ qua, giữ nguyên cặp backtick trong bản dịch', () => {
    const orig = '流程: 写名字 → 等待\n`阶段` 说明';
    const trans = 'Quy trình: viết tên → chờ đợi\n`Giai đoạn` → `chú thích`';
    const out = cleanTranslationResponse(orig, trans, false, false);
    expect(out).toContain('`Giai đoạn` → `chú thích`');
  });

  it('chunked part (isChunkedPart=true) không bao giờ bị cắt theo mũi tên (hành vi cũ giữ nguyên)', () => {
    const orig = '任务 A'.repeat(10);
    const trans = 'Nhiệm vụ A → làm xong việc';
    expect(cleanTranslationResponse(orig, trans, false, true)).toContain('→');
  });
});
