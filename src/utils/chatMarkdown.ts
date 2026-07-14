/**
 * ─── Tách phản hồi Trợ Lý AI thành khối VĂN BẢN / KHỐI CODE ───
 *
 * (User 2026 — "code bị văng ra ngoài khung") BUG CŨ: regex /```(\w*)\n([\s\S]*?)```/ đóng fence ở
 * BẤT KỲ dấu ``` nào, KỂ CẢ dấu nằm GIỮA DÒNG bên trong code. Mà trợ lý rất hay viết đúng loại code
 * xử lý markdown:
 *     const jsonStr = text.replace(/^```json/i, '').replace(/```$/, '');
 * → fence bị đóng SỚM ngay tại dấu ``` trong chuỗi ⇒ NỬA SAU của code rớt ra ngoài, bị render như
 * VĂN BẢN TRẦN (không khung, không wrap) ⇒ tràn khỏi bong bóng chat, đè sang cột bên phải.
 *
 * QUY TẮC ĐÚNG (chuẩn markdown): fence mở/đóng phải nằm ĐẦU DÒNG. Dấu ``` giữa dòng chỉ là ký tự
 * bình thường trong code. Ngoài ra fence MỞ mà chưa đóng (câu trả lời còn đang viết dở / bị cắt) vẫn
 * phải hiện trong KHUNG CODE, không được đổ ra text trần.
 */
export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string };

const FENCE_RE = /^```([\w+-]*)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
const DANGLING_FENCE_RE = /^```([\w+-]*)[ \t]*\r?\n([\s\S]*)$/m;

export function splitChatBlocks(content: string): ChatBlock[] {
  if (!content) return [];
  const blocks: ChatBlock[] = [];
  const re = new RegExp(FENCE_RE.source, FENCE_RE.flags);
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const before = content.slice(lastIndex, m.index);
    if (before.trim()) blocks.push({ type: 'text', text: before });
    blocks.push({ type: 'code', language: m[1] || 'text', code: m[2] });
    lastIndex = re.lastIndex;
  }

  let rest = content.slice(lastIndex);
  // Fence MỞ nhưng chưa có fence ĐÓNG → vẫn hiển thị trong khung code (đang stream / bị cắt token).
  const dangling = rest.match(DANGLING_FENCE_RE);
  if (dangling && dangling.index !== undefined) {
    const before = rest.slice(0, dangling.index);
    if (before.trim()) blocks.push({ type: 'text', text: before });
    blocks.push({ type: 'code', language: dangling[1] || 'text', code: dangling[2] });
    rest = '';
  }
  if (rest.trim()) blocks.push({ type: 'text', text: rest });

  return blocks;
}
