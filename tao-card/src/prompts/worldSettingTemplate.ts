/**
 * worldSettingTemplate.ts — (Tawa 2.0) ĐỊNH DẠNG NỘI DUNG XML+YAML CHO ENTRY BỐI CẢNH.
 * ─────────────────────────────────────────────────────────────────────────────
 * Port từ `WORLD_TEMPLATE` của Tawa Worldbuilder 2.0.
 *
 * Mặc định của tao-card là văn phong DATABASE (gạch đầu dòng / YAML phẳng) — gọn và hợp với entry
 * hồ sơ. Nhưng với thế giới nhiều tầng (vương quốc → phe phái → địa điểm → luật vận hành), danh
 * sách phẳng làm mất quan hệ cha-con: đọc xong không biết cái gì thuộc về cái gì.
 *
 * XML bọc ngoài (`<kingdom>`, `<system>`) cho model biết ĐÂY LÀ KHỐI GÌ, YAML bên trong giữ CẤU
 * TRÚC PHÂN CẤP. Đây là lựa chọn của user cho từng lượt sinh, không phải mặc định mới — entry hồ
 * sơ nhân vật vẫn hợp với văn phong database hơn.
 */

export type EntryContentFormat = 'default' | 'xml_yaml';

export const CONTENT_FORMAT_LABELS: Record<EntryContentFormat, string> = {
  default: 'Database / gạch đầu dòng (mặc định)',
  xml_yaml: 'XML + YAML phân cấp (thế giới nhiều tầng)',
};

const XML_YAML_DIRECTIVE = `

--- ĐỊNH DẠNG NỘI DUNG: XML + YAML PHÂN CẤP ---
Trường "content" của MỖI entry phải là một khối XML bọc ngoài, bên trong là YAML phân cấp.

LUẬT:
1. Thẻ XML đặt tên THEO NỘI DUNG, không dùng một thẻ chung chung cho mọi entry:
   <kingdom>, <faction>, <system>, <location>, <race>, <religion>, <timeline>, <organization>…
   Thẻ luôn có thuộc tính name="…".
2. Bên trong là YAML: khoá tiếng Việt, lồng bao nhiêu tầng tuỳ độ sâu thật của thông tin.
   Đoạn văn dài dùng khối \`|\` để giữ xuống dòng.
3. Các entry CÙNG LOẠI phải dùng CÙNG bộ khoá — có vậy người đọc (và AI) mới đối chiếu được
   giữa hai vương quốc, hai phe phái.
4. KHÔNG xuất chú thích hướng dẫn, KHÔNG xuất dấu ngoặc vuông mẫu, KHÔNG bọc markdown code fence.
5. Một entry = MỘT khối XML gốc. Không nhét hai vương quốc vào chung một entry.

MẪU (bám cấu trúc, KHÔNG chép chữ):
<kingdom name="Tên vương quốc">
  Tổng quan: |
    Vài câu định vị: nằm ở đâu, ai cai trị, đang ở thế nào.

  Lịch sử:
    - Tên thời kỳ: |
        Chuyện gì xảy ra, hệ quả còn lại tới hiện tại.

  Chính trị và xã hội:
    Thể chế: |
      Ai nắm quyền, quyền lực truyền thế nào.
    Tôn giáo: |
      Tín ngưỡng chính, ảnh hưởng lên đời sống.
    Giai tầng:
      - Tên giai tầng: Quyền lợi và ràng buộc.

  Địa điểm quan trọng:
    - Tên địa điểm: |
        Vai trò trong vương quốc, ai kiểm soát.

  Mâu thuẫn đang có: |
    Ai đối đầu ai, vì cái gì, đang tới đâu.
</kingdom>

<system name="Tên hệ thống">
  Cơ chế cốt lõi: |
    Vận hành thế nào, ai dùng được.

  Thuộc tính:
    Tên thuộc tính: Ý nghĩa và thang đo.

  Hạn chế và cái giá: |
    Dùng nhiều thì sao, giới hạn ở đâu — hệ thống không có cái giá là hệ thống hỏng.
</system>`;

/** Chỉ thị định dạng nội dung tiêm vào system prompt. Rỗng khi dùng định dạng mặc định. */
export function buildContentFormatDirective(format: EntryContentFormat | undefined): string {
  return format === 'xml_yaml' ? XML_YAML_DIRECTIVE : '';
}
