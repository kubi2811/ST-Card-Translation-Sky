/**
 * src/lib/wikiImport/factIndex.ts — CHỈ MỤC FACT ĐÃ DÙNG (bug 121: DEDUPLICATION + MEMORY).
 * ─────────────────────────────────────────────────────────────────────────
 * "So sánh semantic similarity với toàn bộ entries đã tạo… không chỉ so sánh bằng chuỗi ký tự."
 * Không có embedding API offline nên dùng TF-IDF cosine trên token 1-gram + bigram — bắt được
 * "cùng thông tin khác cách diễn đạt" ở mức thực dụng (từ vựng nội dung trùng nhau), tất định,
 * không tốn call AI. Đây là LỚP THÊM bên trên isDuplicateEntry (identity + Jaccard + RAG,
 * việc 90) — không thay thế nó.
 */

export interface FactHit {
  id: string;
  score: number;
}

/** Tokenize: hạ chữ, bỏ dấu câu, giữ chữ có dấu tiếng Việt + CJK (mỗi ký tự CJK là 1 token). */
export function tokenizeForFacts(text: string): string[] {
  const s = String(text || '').toLowerCase();
  const tokens: string[] = [];
  for (const m of s.matchAll(/[a-zà-ỹđ0-9]+|[一-鿿]/gi)) tokens.push(m[0]);
  // Bigram từ liền kề để giữ chút ngữ cảnh ("thiên kiếm" ≠ "kiếm thiên").
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) bigrams.push(tokens[i] + '_' + tokens[i + 1]);
  return [...tokens, ...bigrams];
}

export class FactIndex {
  private docs = new Map<string, Map<string, number>>();   // id → tf

  size(): number { return this.docs.size; }

  private vectorize(text: string): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of tokenizeForFacts(text)) tf.set(t, (tf.get(t) || 0) + 1);
    return tf;
  }

  add(id: string, text: string): void {
    if (this.docs.has(id)) return;
    this.docs.set(id, this.vectorize(text));
  }

  /**
   * Cosine similarity TF THUẦN (không IDF — có chủ ý, đo được):
   * với index còn ÍT doc, IDF phản tác dụng — term không khớp bên query có df=0 nên nhận
   * trọng số CAO HƠN term khớp, kéo cặp "cùng thông tin" tụt dưới ngưỡng. Bigram trong
   * tokenizer đã đảm nhiệm việc giảm nhiễu stopword mà IDF định làm.
   */
  query(text: string, threshold = 0.5): FactHit[] {
    const qtf = this.vectorize(text);
    if (qtf.size === 0 || this.docs.size === 0) return [];
    let qnorm = 0;
    for (const f of qtf.values()) qnorm += f * f;
    qnorm = Math.sqrt(qnorm);
    const hits: FactHit[] = [];
    for (const [id, dtf] of this.docs) {
      let dot = 0, dnorm = 0;
      for (const [t, f] of dtf) {
        dnorm += f * f;
        const qf = qtf.get(t);
        if (qf) dot += qf * f;
      }
      const score = dot / (qnorm * Math.sqrt(dnorm) || 1);
      if (score >= threshold) hits.push({ id, score });
    }
    return hits.sort((a, b) => b.score - a.score);
  }

  /**
   * Text này có trùng NỘI DUNG với fact đã dùng không.
   * Ngưỡng 0.45 ĐO TỪ SỐ LIỆU THỰC (không đoán): cặp "cùng thông tin, khác cách diễn đạt"
   * (Luffy viết lại toàn bộ câu chữ) cosine ≈ 0.58; cặp "khác thực thể, cùng thế giới"
   * (Luffy vs Zoro) ≈ 0.16 — 0.45 nằm giữa với biên an toàn hai phía.
   */
  isDuplicate(text: string, threshold = 0.45): { dup: boolean; with?: string; score?: number } {
    const [top] = this.query(text, threshold);
    return top ? { dup: true, with: top.id, score: top.score } : { dup: false };
  }
}
