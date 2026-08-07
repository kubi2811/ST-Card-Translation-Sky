/**
 * src/lib/mvuzod/schemaFixInstruction.ts — (bug 224) BIẾN BÁO CÁO "KIỂM SCHEMA" THÀNH CHỈ THỊ CHO AI.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "khi tạo schema và dùng chức năng kiểm thì không có nút gọi AI sửa hãy thêm".
 *
 * Bảng Kiểm schema (bug 216) đã chỉ ra chính xác cái gì hỏng, nhưng người dùng phải TỰ gõ lại
 * từng lỗi vào ô "AI chỉnh schema" mới sửa được — với 38 dòng cảnh báo thì không ai làm.
 * Hàm này dịch báo cáo thành MỘT chỉ thị gọn cho đúng bộ AI-sửa-schema đã có sẵn
 * (MVUZOD_SCHEMA_EDITOR_PROMPT → danh sách action add/edit/delete → người dùng xem rồi mới áp).
 *
 * Ba nguyên tắc, để AI không phá thẻ:
 *   1. GOM theo LOẠI lỗi, không đọc lại từng dòng — 20 biến thiếu min/max thì nói một câu kèm
 *      danh sách đường dẫn, prompt ngắn thì AI làm đúng hơn và rẻ hơn.
 *   2. NÓI RÕ CÁCH SỬA cho từng loại, vì mỗi loại có một cách sửa đúng khác nhau (thiếu min/max
 *      thì đặt khoảng hợp lý; trùng tên cùng cha thì ĐỔI TÊN chứ không xoá; container rỗng thì
 *      thêm biến con hoặc đổi kiểu).
 *   3. CẤM những việc phá dữ liệu: không xoá biến chỉ vì nó có cảnh báo, không đổi kiểu biến đang
 *      chạy được, không đổi tên biến KHÔNG bị báo trùng (đổi tên là đổi đường dẫn ⇒ initvar, quy
 *      tắc cập nhật, regex bảng trạng thái trỏ tới nó đều lệch hết).
 */

import type { SchemaHealthReport, HealthIssue } from './schemaHealth';

/** Cách sửa ĐÚNG cho từng mã lỗi — thứ AI không tự đoán được. */
const HOW_TO_FIX: Record<string, string> = {
  'empty-schema': 'Schema không có biến nào: hãy thêm bộ biến tối thiểu cho thể loại thẻ này.',
  'field-no-name': 'Đặt tên (label) tiếng Việt rõ nghĩa cho biến.',
  'field-no-type': 'Chọn kiểu dữ liệu đúng: string / number / boolean / object / array / record.',
  'number-no-range': 'Đặt min/max hợp lý theo ý nghĩa của biến (vd máu 0–100, cấp 1–99). ĐỪNG đổi kiểu.',
  'enum-empty': 'Điền danh sách giá trị chọn được, hoặc đổi thành string thường nếu không cần cố định.',
  'container-empty': 'Thêm biến con vào trong, hoặc đổi sang kiểu string/record nếu vốn không có cấu trúc con.',
  'duplicate-name': 'ĐỔI TÊN cho khác nhau (vd thêm phần bổ nghĩa). TUYỆT ĐỐI không xoá biến nào.',
  'too-deep': 'Làm phẳng bớt: gộp tầng trung gian không cần thiết, giữ tối đa 3–4 tầng.',
  'zod-throw': 'Sửa chỗ làm Zod code dựng thất bại (tên/kiểu/ràng buộc không hợp lệ).',
  'zod-empty': 'Sửa để schema dựng ra được Zod code.',
};

/** Bao nhiêu đường dẫn tối đa liệt kê cho MỘT loại lỗi — dài hơn thì AI đọc kém đi. */
const MAX_PATHS_PER_KIND = 12;

export interface FixInstructionResult {
  /** Chỉ thị để nhét vào ô "AI chỉnh schema". Rỗng nghĩa là không có gì cần sửa. */
  instruction: string;
  /** Số vấn đề được đưa vào chỉ thị (đã bỏ mức info). */
  count: number;
  /** Các mã lỗi có mặt — để UI nói "sẽ sửa 3 loại vấn đề". */
  codes: string[];
}

/**
 * Dựng chỉ thị sửa từ báo cáo. Chỉ lấy `error` + `warning`; `info` không phải lỗi.
 */
export function buildSchemaFixInstruction(report: SchemaHealthReport | null | undefined): FixInstructionResult {
  const issues: HealthIssue[] = (report?.issues ?? []).filter(i => i.level === 'error' || i.level === 'warning');
  if (issues.length === 0) return { instruction: '', count: 0, codes: [] };

  const byCode = new Map<string, HealthIssue[]>();
  for (const iss of issues) {
    const arr = byCode.get(iss.code) ?? [];
    arr.push(iss);
    byCode.set(iss.code, arr);
  }

  const lines: string[] = [
    'Bộ kiểm schema của tool vừa tìm ra những vấn đề dưới đây. Hãy sửa ĐÚNG những chỗ này.',
    '',
  ];

  let n = 1;
  for (const [code, list] of byCode) {
    const how = HOW_TO_FIX[code] ?? 'Sửa theo mô tả lỗi.';
    lines.push(`${n}. [${code}] ${list.length} chỗ — ${how}`);
    // Có path thì liệt kê path (chính xác hơn cho AI); không có thì lấy nguyên câu báo lỗi.
    const paths = list.map(i => i.path).filter((p): p is string => !!p);
    if (paths.length > 0) {
      const shown = paths.slice(0, MAX_PATHS_PER_KIND);
      lines.push(`   Biến: ${shown.map(p => `"${p}"`).join(', ')}${paths.length > shown.length ? ` … và ${paths.length - shown.length} biến nữa cùng loại` : ''}`);
    } else {
      for (const i of list.slice(0, 3)) lines.push(`   • ${i.message}`);
    }
    n++;
  }

  lines.push(
    '',
    'RÀNG BUỘC BẮT BUỘC:',
    '- KHÔNG xoá biến nào chỉ vì nó bị cảnh báo. Chỉ dùng op "delete" khi biến thật sự trùng lặp vô nghĩa.',
    '- KHÔNG đổi tên biến KHÔNG nằm trong danh sách trùng tên: đổi tên là đổi đường dẫn, làm lệch initvar, quy tắc cập nhật và regex bảng trạng thái đang trỏ tới nó.',
    '- KHÔNG đổi kiểu của biến đang hợp lệ.',
    '- Giữ nguyên tiếng Việt của các nhãn đã có.',
  );

  return { instruction: lines.join('\n'), count: issues.length, codes: [...byCode.keys()] };
}
