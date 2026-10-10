/**
 * src/utils/chunkEdges.ts — (bug 265) MÉP CHUNK CỦA CODE PHẢI KHỚP MÉP CHUNK GỐC.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: script tavernHelper 48 KB, khung chunk báo "Đủ và sạch 7/7", nhưng bản dịch bên ngoài vẫn
 * là nguyên văn tiếng Trung ("còn 663 chữ Hán"). Chạy lại đúng script đó: 7 chunk dịch tốt, bản
 * GHÉP thì vỡ cú pháp JS ⇒ chốt an toàn giữ bản gốc. Hai chỗ vỡ đều nằm ở MÉP chunk:
 *
 * 1. MẤT XUỐNG DÒNG. Bản dịch mỗi chunk bị cắt khoảng trắng hai đầu, mà chunk code/HTML được nối
 *    LIỀN (không chèn gì). Chunk kết thúc bằng dòng `// chú thích` + xuống dòng ⇒ mất xuống dòng
 *    ⇒ dòng code đầu chunk sau dính vào chú thích và biến mất:
 *        // …owns only its own host nodes.(function startFiveDomains() {
 *
 * 2. AI TỰ ĐÓNG TEMPLATE LITERAL. Khối CSS 12 KB nằm trong `…` dài hơn cỡ chunk nên phải cắt giữa;
 *    AI thấy chuỗi "chưa đóng" liền thêm dấu ` vào cuối chunk ⇒ chunk sau (phần CSS còn lại) rơi
 *    ra ngoài chuỗi: "Unexpected character '@'".
 *
 * Cả hai là bất biến đo được trên chunk GỐC, không cần AI ngoan: khoảng trắng hai đầu giữ y như
 * gốc; số dấu ` chỉ được thêm ở mép khi gốc cũng có ở đó.
 */

const countBackticks = (s: string) => (s.match(/`/g) ?? []).length;

/**
 * Khớp mép một chunk đã dịch theo chunk gốc. Chỉ dùng cho nội dung NỐI LIỀN (code / HTML) — văn
 * xuôi nối bằng dòng trống thì cắt khoảng trắng là đúng.
 */
export function fitChunkEdges(raw: string, out: string): string {
  if (!raw || !out || !out.trim()) return out;
  let body = out.trim();

  // (2) Dấu ` thừa ở mép: chỉ gỡ khi bản dịch nhiều hơn gốc và mép gốc KHÔNG có dấu đó.
  const rawTrim = raw.trim();
  let extra = countBackticks(body) - countBackticks(rawTrim);
  if (extra > 0 && body.endsWith('`') && !rawTrim.endsWith('`')) { body = body.slice(0, -1).trimEnd(); extra--; }
  if (extra > 0 && body.startsWith('`') && !rawTrim.startsWith('`')) { body = body.slice(1).trimStart(); }

  // (1) Khoảng trắng / xuống dòng hai đầu y như gốc.
  const lead = raw.match(/^\s*/)?.[0] ?? '';
  const trail = raw.match(/\s*$/)?.[0] ?? '';
  return lead + body + trail;
}

/** Nội dung này có được nối liền không — cùng luật với joinChunks / translateText. */
export function isGluedContent(originalText: string): boolean {
  const isHtml = /<[a-z][^>]*>/i.test(originalText) && /<\/[a-z]+>/i.test(originalText);
  const isCodeHeavy = /\b(function|const|let|var|=>|return)\b/.test(originalText)
    && (originalText.match(/[{};]/g) ?? []).length > 20;
  return isHtml || isCodeHeavy;
}

/** Khớp mép cả mảng ô theo ô gốc (dữ liệu chunk lưu từ bản cũ). */
export function fitCellsToRaw(done: (string | undefined)[], raw: string[] | undefined, originalText: string): (string | undefined)[] {
  if (!raw?.length || !isGluedContent(originalText)) return done;
  return done.map((c, i) => (c && raw[i] ? fitChunkEdges(raw[i], c) : c));
}
