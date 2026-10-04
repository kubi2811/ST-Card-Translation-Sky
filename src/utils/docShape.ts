/**
 * src/utils/docShape.ts — (bug 253) VĂN BẢN NÀY LÀ CODE HAY LÀ TÀI LIỆU VIẾT BẰNG VĂN XUÔI?
 * ─────────────────────────────────────────────────────────────────────────────
 * User (PhatSiz) gửi bộ "raw + sai + đúng" của một entry [mvu_update] loại controller: một bản
 * hướng dẫn định dạng biến viết bằng markdown — 9 mục văn xuôi tiếng Trung, xen vài ví dụ JSON và
 * code `…` nội dòng. Tool dịch ra:
 *   "Thẻ lớp ngoài `<UpdateVariable>` Bắt đầu、`</UpdateVariable>` Kết thúc(Phân biệt…)",
 *   "| op Cách viết | … | value Loại |", "2026Năm3Tháng15Ngày", "20 Dưới Tuổi"…
 * Đó là dấu vân tay của đường SURGICAL: tách từng cụm chữ Hán nằm giữa các mẩu code rồi dịch RIÊNG
 * từng cụm — không đảo được trật tự từ, viết hoa đầu mỗi cụm, giữ nguyên dấu câu tiếng Trung
 * (、，（）), ghép số với chữ không dấu cách. Surgical sinh ra để giữ 100% CODE (regex, script,
 * [initvar]); với một tài liệu mà phần lớn là câu văn thì nó phá câu văn.
 *
 * Trước bản này, MỌI entry loại controller / mvu_logic và mọi text có ``` đều bị ép đi surgical.
 * Hàm này đo hình dạng văn bản để đường dịch chọn đúng: tài liệu văn xuôi ⇒ đường dịch thường (có che
 * code, có từ điển MVU, có kiểm cấu trúc); code thật ⇒ vẫn surgical như cũ.
 */

const HAN_RE = /[一-鿿㐀-䶿]/g;

function countHan(s: string): number {
  return (s.match(HAN_RE) || []).length;
}

export interface DocShape {
  /** Chữ Hán trong toàn văn bản. */
  totalHan: number;
  /** Chữ Hán nằm trong phần VĂN XUÔI (đã bỏ code fence, code nội dòng, thẻ, dòng JSON/YAML-dữ-liệu). */
  proseHan: number;
  /** Số dòng văn xuôi có dấu câu tiếng Trung (。，；：！？、) — câu văn thật. */
  proseSentences: number;
  /** Có code thực thi (script, EJS) — có thì KHÔNG bao giờ coi là văn xuôi. */
  hasExecutableCode: boolean;
}

export function measureDocShape(text: string): DocShape {
  const src = String(text || '');
  const hasExecutableCode = /<script[\s>]/i.test(src) || /<%[\s\S]*?%>/.test(src)
    || /\b(?:function\s*\w*\s*\(|=>\s*\{|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)/.test(src);
  const prose = src
    .replace(/```[\s\S]*?```/g, '\n')          // khối code fence
    .replace(/`[^`\n]*`/g, ' ')                  // code nội dòng
    .replace(/<\/?[A-Za-z][^<>\n]*>/g, ' ')      // thẻ HTML/XML (<UpdateVariable>, <JSONPatch>…)
    .split('\n')
    // Dòng dữ liệu: JSON patch / mảng / object, hoặc cặp YAML "khoá: giá trị" không có câu văn.
    .filter(l => !/^\s*[[{"]/.test(l) && !/^\s*[\]}]/.test(l))
    .join('\n');
  const proseSentences = prose.split('\n').filter(l => countHan(l) >= 4 && /[。，；：！？、]/.test(l)).length;
  return { totalHan: countHan(src), proseHan: countHan(prose), proseSentences, hasExecutableCode };
}

/**
 * Tài liệu viết bằng văn xuôi (có xen ví dụ code) — nên dịch như văn bản, KHÔNG tách từng cụm chữ.
 * Ngưỡng cố ý chặt để không kéo nhầm code thật ra khỏi surgical:
 *   • không có code thực thi (script / EJS / khai báo JS);
 *   • phần văn xuôi có ≥ 150 chữ Hán và chiếm ≥ 45% tổng chữ Hán (ví dụ JSON / bảng tên khoá trong
 *     tài liệu cũng chứa nhiều chữ Hán — file thật của bug 253 là 57%);
 *   • có ≥ 5 dòng câu văn thật (có dấu câu tiếng Trung).
 */
export function isProseDominantDoc(text: string): boolean {
  const s = measureDocShape(text);
  if (s.hasExecutableCode) return false;
  if (s.totalHan === 0) return false;
  return s.proseHan >= 150 && s.proseHan / s.totalHan >= 0.45 && s.proseSentences >= 5;
}
