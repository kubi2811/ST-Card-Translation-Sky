/**
 * ─── P1 Roadmap Trợ Lý AI — RAG Engine (hybrid + citation) ───
 * Truy xuất: EXACT GLOSSARY (ưu tiên tuyệt đối — thuật ngữ bắt buộc không được "gần đúng")
 *          + KEYWORD (từ khoá giao nhau)
 *          + VECTOR (cosine hash-embed)
 * → gộp điểm → top-K kèm NHÃN NGUỒN (source grounding) để AI trích dẫn được.
 *
 * Index sống trong RAM (Float32Array liền khối); persist qua memoryStore.vectors (write-back).
 * Brute-force cosine đủ nhanh cho corpus 1-user (điều kiện nâng cấp HNSW: >100k chunk — roadmap P5).
 */
import type { MemoryRecord } from './memoryStore';
import { hashEmbed, dot, EMBED_DIMS } from './embeddings';

export interface RagHit {
  record: MemoryRecord;
  score: number;
  via: ('exact' | 'keyword' | 'vector')[];
  /** Nhãn nguồn hiển thị/ghim vào prompt: "lore.json (PHẦN 2/9) › lorebook[4].content" */
  sourceLabel: string;
}

export function sourceLabelOf(m: MemoryRecord): string {
  const s = m.source;
  const bits: string[] = [];
  if (s.fileName) bits.push(s.part ? `${s.fileName} (${s.part})` : s.fileName);
  if (s.path) bits.push(s.path);
  if (bits.length === 0) bits.push(s.origin);
  return bits.join(' › ');
}

/** Tách từ khoá truy vấn: từ ≥2 ký tự, cả CJK (cắt bigram) lẫn Latin. */
export function extractKeywords(q: string): string[] {
  const out = new Set<string>();
  const norm = q.toLowerCase();
  // Latin/Việt: theo word boundary
  for (const w of norm.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 2 && !/^[0-9]+$/.test(w)) out.add(w);
  }
  // CJK: bigram trượt
  const cjk = norm.match(/[一-鿿]{2,}/g) || [];
  for (const run of cjk) {
    for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

export class RagIndex {
  private records = new Map<string, MemoryRecord>();
  private vecs = new Map<string, Float32Array>();

  size(): number { return this.records.size; }

  add(rec: MemoryRecord, vec?: Float32Array): void {
    this.records.set(rec.id, rec);
    this.vecs.set(rec.id, vec ?? hashEmbed(rec.text));
  }

  remove(id: string): void {
    this.records.delete(id);
    this.vecs.delete(id);
  }

  clear(): void { this.records.clear(); this.vecs.clear(); }

  getVec(id: string): Float32Array | undefined { return this.vecs.get(id); }

  /**
   * Truy vấn hybrid. `cardKey` lọc ký ức theo card đang mở (ký ức chung cardKey rỗng luôn qua).
   */
  query(q: string, opts: { topK?: number; cardKey?: string; minScore?: number } = {}): RagHit[] {
    const topK = opts.topK ?? 5;
    const minScore = opts.minScore ?? 0.12;
    if (!q.trim() || this.records.size === 0) return [];

    const qVec = hashEmbed(q);
    const qKeywords = extractKeywords(q);
    const qNorm = q.toLowerCase().trim();

    const hits: RagHit[] = [];
    for (const rec of this.records.values()) {
      if (opts.cardKey !== undefined && rec.cardKey && rec.cardKey !== opts.cardKey) continue;

      const via: RagHit['via'] = [];
      let score = 0;

      // 1) EXACT: truy vấn chứa THUẬT NGỮ NGUỒN của glossary/tm ("青龙 → Thanh Long" → vế trước
      // mũi tên) hoặc glossary chứa nguyên cụm truy vấn → ưu tiên tuyệt đối (thuật ngữ bắt buộc
      // không được "gần đúng").
      if ((rec.kind === 'glossary' || rec.kind === 'tm')) {
        const t = rec.text.toLowerCase();
        const srcTerm = t.split(/→|->|[:：]/)[0].trim();
        if ((srcTerm.length >= 2 && qNorm.includes(srcTerm)) || t.includes(qNorm)) {
          score += 10; via.push('exact');
        }
      }

      // 2) KEYWORD: tỉ lệ từ khoá truy vấn xuất hiện trong text
      if (qKeywords.length > 0) {
        const t = rec.text.toLowerCase();
        let hit = 0;
        for (const kw of qKeywords) if (t.includes(kw)) hit++;
        const kwScore = hit / qKeywords.length;
        if (kwScore > 0.15) { score += kwScore; via.push('keyword'); }
      }

      // 3) VECTOR: cosine (vector đã L2-normalize)
      const v = this.vecs.get(rec.id);
      if (v) {
        const cos = dot(qVec, v);
        if (cos > 0.2) { score += cos; via.push('vector'); }
      }

      if (via.length > 0 && score >= minScore) {
        hits.push({ record: rec, score, via, sourceLabel: sourceLabelOf(rec) });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }
}

/** Dựng block ngữ cảnh RAG nhét vào prompt — mỗi mục kèm nhãn nguồn để AI trích dẫn. */
export function buildRagContextBlock(hits: RagHit[], maxChars = 6000): string {
  if (hits.length === 0) return '';
  const lines: string[] = ['[TRÍ NHỚ/TÀI LIỆU LIÊN QUAN — khi dùng thông tin nào PHẢI ghi kèm nhãn nguồn của nó, dạng (nguồn: …)]'];
  let used = 0;
  for (const h of hits) {
    const body = h.record.text.length > 1500 ? h.record.text.slice(0, 1500) + '…' : h.record.text;
    const entry = `• (nguồn: ${h.sourceLabel})\n${body}`;
    if (used + entry.length > maxChars) break;
    lines.push(entry);
    used += entry.length;
  }
  return lines.length > 1 ? lines.join('\n\n') : '';
}

/* dims export để nơi khác kiểm tương thích embedder */
export const RAG_EMBED_DIMS = EMBED_DIMS;
