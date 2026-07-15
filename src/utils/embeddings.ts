/**
 * ─── P1 Roadmap Trợ Lý AI — Embedder ───
 * Chiến lược 2 đường (roadmap mục 5):
 * - `HashEmbedder` (MẶC ĐỊNH): vector hoá bằng feature-hashing n-gram ký tự — offline, 0 tải model,
 *   0 tốn quota, deterministic. Chất lượng đủ cho NEAR-MATCH (đúng bài Translation Memory của CAT
 *   tool: câu gần giống câu đã dịch) và cho re-call trong corpus 1 user. KHÔNG phải semantic thật —
 *   nâng cấp lên ApiEmbedder/WASM khi cần (interface đã chốt, thay adapter là xong).
 * - `ApiEmbedder` (tuỳ chọn, P5): gọi endpoint embeddings của provider qua pool key sẵn có.
 *
 * n-gram 2+3 ký tự hoạt động tốt với CJK (mỗi chữ Hán mang nghĩa → bigram ~ từ ghép) lẫn tiếng
 * Việt (âm tiết ngắn). Vector chuẩn hoá L2 → cosine = dot product.
 */

export const EMBED_DIMS = 512;
export const HASH_EMBEDDER_ID = 'hash-v1';

/** FNV-1a 32-bit — nhanh, phân bố đủ đều cho feature hashing. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalizeForEmbed(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Vector hoá 1 chuỗi: n-gram 2+3 ký tự → hash vào EMBED_DIMS chiều → L2 normalize. */
export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIMS);
  const s = normalizeForEmbed(text);
  if (!s) return v;
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= s.length; i++) {
      const gram = s.slice(i, i + n);
      const h = fnv1a(gram);
      // sign hashing (giảm bias): bit thấp quyết định dấu
      const sign = (h & 1) === 1 ? 1 : -1;
      v[(h >>> 1) % EMBED_DIMS] += sign;
    }
  }
  // L2 normalize → cosine = dot
  let norm = 0;
  for (let i = 0; i < EMBED_DIMS; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIMS; i++) v[i] /= norm;
  return v;
}

export interface Embedder {
  id: string;
  dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const hashEmbedder: Embedder = {
  id: HASH_EMBEDDER_ID,
  dims: EMBED_DIMS,
  async embed(texts) { return texts.map(hashEmbed); },
};

/** cosine của 2 vector ĐÃ chuẩn hoá L2 = dot product. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
