/**
 * ─── P1 Roadmap Trợ Lý AI — Semantic Chunker ───
 * Chẻ văn bản thành chunk 400–1600 ký tự cho RAG, theo RANH GIỚI NGỮ NGHĨA:
 * ưu tiên ranh giới đoạn (\n\n) → câu (.。!?…) → dòng; khối code fence ```...``` giữ NGUYÊN
 * 1 chunk (không cắt giữa code — cùng triết lý ejsSegmenter/isSafeBoundary của luồng dịch).
 * Bảo toàn 100%: ghép các chunk == văn bản gốc (chuẩn attachmentParts, test khoá).
 */

export interface SemanticChunk {
  text: string;
  index: number;      // thứ tự trong văn bản gốc (0-based)
  isCode: boolean;    // khối code fence nguyên vẹn
}

const MAX_CHUNK = 1600;
const MIN_CHUNK = 400;

/** Ranh giới câu đa ngôn ngữ (vi/zh/en) — sau các dấu kết câu + xuống dòng. */
const SENTENCE_END_RE = /[.。．!！?？…»”"']\s+|\n/g;

function splitLongText(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK) {
    // tìm ranh giới câu cuối cùng trong cửa sổ; lùi tối đa về MIN_CHUNK
    let cut = -1;
    SENTENCE_END_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END_RE.exec(rest)) !== null) {
      const end = m.index + m[0].length;
      if (end > MAX_CHUNK) break;
      if (end >= MIN_CHUNK) cut = end;
      else cut = Math.max(cut, end); // câu ngắn: vẫn ghi nhận, phòng không có ranh giới nào ≥ MIN
    }
    if (cut <= 0) cut = MAX_CHUNK; // không có ranh giới nào → cắt cứng
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Chẻ `text` thành chunk ngữ nghĩa. Thứ tự + nội dung bảo toàn: join('') == text.
 */
export function chunkSemantic(text: string): SemanticChunk[] {
  if (!text) return [];
  // Tách khối code fence ra trước (giữ nguyên vẹn) — fence phải ở ĐẦU DÒNG (chuẩn bug 21 chatMarkdown)
  const parts: { text: string; isCode: boolean }[] = [];
  const fenceRe = /^```[\w+-]*[ \t]*\r?\n[\s\S]*?^```[ \t]*$\n?/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), isCode: false });
    parts.push({ text: m[0], isCode: true });
    last = fenceRe.lastIndex;
  }
  if (last < text.length) parts.push({ text: text.slice(last), isCode: false });

  const chunks: SemanticChunk[] = [];
  for (const part of parts) {
    if (part.isCode) {
      chunks.push({ text: part.text, index: chunks.length, isCode: true });
      continue;
    }
    // Prose: gom theo ĐOẠN trước, đoạn quá dài mới chẻ theo câu
    const paragraphs = part.text.split(/(?<=\n\n)/); // giữ nguyên ký tự phân đoạn (bảo toàn join)
    let buf = '';
    const flush = () => {
      if (buf) { for (const piece of splitLongText(buf)) chunks.push({ text: piece, index: chunks.length, isCode: false }); buf = ''; }
    };
    for (const p of paragraphs) {
      if (buf.length + p.length > MAX_CHUNK && buf.length >= MIN_CHUNK) flush();
      buf += p;
    }
    flush();
  }
  return chunks;
}
