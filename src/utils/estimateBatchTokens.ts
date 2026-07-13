/**
 * estimateBatchTokens.ts — Ước lượng tải token cho chế độ "gộp nhiều entry / 1 lần gọi".
 * ───────────────────────────────────────────────────────────────────────────────────
 * User có thể nhập N entry / batch. Trước khi chạy cần cảnh báo nếu N khiến 1 lô quá lớn,
 * vượt trần OUTPUT token của Gemini (bottleneck là output — bản dịch giãn dài hơn nguồn).
 *
 * Hằng số ước lượng (thô, thiên về AN TOÀN — thà cảnh báo sớm):
 *  - Giãn nở zh→vi ≈ 2.8× ký tự (Hán 1 ký tự → Việt ~2.8 ký tự).
 *  - Token Việt (output) ≈ 1 token / 2.5 ký tự.
 *  ⇒ estOutputTokens ≈ srcChars × 2.8 / 2.5 ≈ srcChars × 1.12.
 *  - Token nguồn CJK (input) ≈ 0.6 token / ký tự (Gemini đếm Hán khá tốn).
 *
 * `splitLorebookBatches` ở pipeline vẫn TỰ chia nhỏ lô nếu vượt maxBatchChars/softCharCap,
 * nên đây là ước lượng CẢNH BÁO (không phải chặn cứng) + gợi ý batchSize an toàn.
 */

export const CHAR_EXPANSION_ZH_VI = 2.8;
export const CHARS_PER_TOKEN_OUT = 2.5;
export const TOKENS_PER_CHAR_IN = 0.6;

export type BatchLoadVerdict = 'safe' | 'warn' | 'danger';

export interface BatchLoadEstimate {
  entryCount: number;
  batchSize: number;
  /** Tổng ký tự nguồn của lô NẶNG NHẤT (top-batchSize entry dài nhất). */
  worstBatchChars: number;
  estInputTokens: number;
  estOutputTokens: number;
  /** Trần output token của model (proxy.maxTokens). */
  outputLimit: number;
  /** estOutputTokens / outputLimit. */
  ratio: number;
  verdict: BatchLoadVerdict;
  /** batchSize lớn nhất mà lô nặng nhất vẫn ≤ ~60% trần output. */
  recommendedBatchSize: number;
}

/**
 * @param originalTexts văn bản NGUỒN của các entry sẽ dịch (chỉ những entry pending là đủ).
 * @param batchSize số entry gộp / lô user chọn.
 * @param outputLimit trần output token của model (mặc định 65536 — flash/pro gemini).
 */
export function estimateLorebookBatchLoad(
  originalTexts: string[],
  batchSize: number,
  outputLimit = 65536,
): BatchLoadEstimate {
  const size = Math.max(1, Math.floor(batchSize) || 1);
  const lens = originalTexts.map(t => (t || '').length).filter(n => n > 0).sort((a, b) => b - a);
  const entryCount = lens.length;

  // Lô nặng nhất = tổng top-`size` entry dài nhất (kịch bản xấu nhất khi gộp).
  const worstBatchChars = lens.slice(0, size).reduce((s, n) => s + n, 0);

  const estOutputTokens = Math.round(worstBatchChars * CHAR_EXPANSION_ZH_VI / CHARS_PER_TOKEN_OUT);
  const estInputTokens = Math.round(worstBatchChars * TOKENS_PER_CHAR_IN);
  const limit = Math.max(1, outputLimit || 65536);
  const ratio = estOutputTokens / limit;

  let verdict: BatchLoadVerdict = 'safe';
  if (ratio > 0.9) verdict = 'danger';
  else if (ratio > 0.6) verdict = 'warn';

  // Gợi ý batchSize an toàn: tích lũy các entry dài nhất tới khi output ≈ 60% trần.
  const safeOutTokens = 0.6 * limit;
  let acc = 0;
  let recommended = 0;
  for (const len of lens) {
    const nextOut = (acc + len) * CHAR_EXPANSION_ZH_VI / CHARS_PER_TOKEN_OUT;
    if (nextOut > safeOutTokens) break;
    acc += len;
    recommended++;
  }
  recommended = Math.max(1, Math.min(recommended, size, 50));

  return {
    entryCount,
    batchSize: size,
    worstBatchChars,
    estInputTokens,
    estOutputTokens,
    outputLimit: limit,
    ratio,
    verdict,
    recommendedBatchSize: recommended,
  };
}
