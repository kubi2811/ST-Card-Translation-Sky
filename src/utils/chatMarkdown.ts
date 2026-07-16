/**
 * ─── Tách phản hồi Trợ Lý AI thành khối VĂN BẢN / KHỐI CODE ───
 *
 * Hai bug đã gặp, phải xử lý ĐỒNG THỜI:
 *
 * BUG A (2026, "code văng ra ngoài khung"): regex cũ /```(\w*)\n([\s\S]*?)```/ đóng fence ở BẤT KỲ
 *   dấu ``` nào, KỂ CẢ dấu GIỮA DÒNG bên trong code — mà trợ lý hay viết đúng loại code đó:
 *       const s = text.replace(/^```json/i, '').replace(/```$/, '');
 *   → fence đóng SỚM ⇒ nửa sau code rớt ra ngoài thành text trần.
 *
 * BUG B (2026, ảnh user: "...nhé! ✨ 🖼️ ```javascript\n<code>"): trợ lý mở fence NGAY GIỮA DÒNG
 *   (sau câu dẫn + emoji). Bản vá bug A ép fence phải ở ĐẦU DÒNG ⇒ fence mở giữa dòng KHÔNG được
 *   nhận ⇒ cả khối code đổ thành TEXT TRẦN (đúng lỗi user báo).
 *
 * QUY TẮC PHÂN BIỆT (nhận fence mở giữa dòng mà KHÔNG nhầm ``` trong code):
 *   Fence MỞ = ``` đứng ngay sau ĐẦU DÒNG hoặc KHOẢNG TRẮNG, theo sau là (tên ngôn ngữ tuỳ chọn +
 *   khoảng trắng) rồi XUỐNG DÒNG. Dấu ``` trong code (bug A) luôn đứng sau ký tự code như `/` `^` `"`
 *   và KHÔNG theo ngay sau bởi "lang + xuống dòng" ⇒ không khớp.
 *   Fence ĐÓNG = một dòng CHỈ gồm ``` (chuẩn markdown).
 *   Fence mở chưa đóng (đang stream / bị cắt) ⇒ vẫn hiện TRỌN trong khung code, không đổ ra text.
 */
export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string };

// Fence MỞ: đầu dòng HOẶC sau khoảng trắng (nhóm 1) + ``` + lang tuỳ chọn (nhóm 2) + \n.
const OPEN_FENCE_RE = /(^|[ \t])```([\w+-]*)[ \t]*\r?\n/gm;
// Fence ĐÓNG: một dòng chỉ có ``` (kèm khoảng trắng), kết bằng \n hoặc hết chuỗi.
const CLOSE_FENCE_RE = /^```[ \t]*(?:\r?\n|$)/m;

export function splitChatBlocks(content: string): ChatBlock[] {
  if (!content) return [];
  const blocks: ChatBlock[] = [];
  const openRe = new RegExp(OPEN_FENCE_RE.source, OPEN_FENCE_RE.flags);
  let pos = 0;
  let m: RegExpExecArray | null;

  while ((m = openRe.exec(content)) !== null) {
    // ``` bắt đầu ngay sau ký tự dẫn (đầu dòng → '' , hoặc 1 space/tab).
    const tickStart = m.index + m[1].length;
    if (tickStart < pos) continue; // fence này nằm trong code đã lấy ở vòng trước
    const codeStart = m.index + m[0].length; // sau dấu \n của dòng mở
    const lang = m[2] || 'text';

    const textBefore = content.slice(pos, tickStart);
    if (textBefore.trim()) blocks.push({ type: 'text', text: textBefore });

    // Tìm fence đóng kể từ codeStart.
    const closeRe = new RegExp(CLOSE_FENCE_RE.source, 'm');
    const rest = content.slice(codeStart);
    const closeM = closeRe.exec(rest);
    if (closeM) {
      blocks.push({ type: 'code', language: lang, code: rest.slice(0, closeM.index) });
      pos = codeStart + closeM.index + closeM[0].length;
    } else {
      // Chưa đóng → khối code kéo tới hết (đang stream / bị cắt token).
      blocks.push({ type: 'code', language: lang, code: rest });
      pos = content.length;
      break;
    }
    openRe.lastIndex = pos;
  }

  const tail = content.slice(pos);
  if (tail.trim()) blocks.push({ type: 'text', text: tail });
  return blocks;
}
