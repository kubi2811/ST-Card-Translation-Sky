/**
 * ─── P2 Roadmap Trợ Lý AI — LoopController (vòng lặp sinh phản hồi) ───
 * Xem docs/ROADMAP_TRO_LY_AI.md mục 4. Nâng continuation loop cũ lên:
 * 1) PHÁT HIỆN CẮT DỞ: fence/XML/ngoặc lệch (port từ checkResponseCut) + kết thúc GIỮA CÂU.
 * 2) MỎ NEO ĐUÔI: vòng sau chỉ gửi ~800 ký tự đuôi thay vì TOÀN BỘ nội dung đã sinh
 *    (trước đây mỗi vòng gửi lại cả bài → phình token theo cấp số cộng).
 * 3) KHỬ LẶP KHI GHÉP: AI hay viết lại vài câu cuối dù bị cấm — dò overlap suffix(đã có) ↔
 *    prefix(mới), cắt phần trùng trước khi nối.
 * 4) DỪNG RÕ RÀNG: hết cắt dở / đủ số vòng / quá ngân sách thời gian / DẬM CHÂN (2 vòng liền
 *    không thêm được nội dung mới) — chống lặp vô hạn đốt quota.
 */

export interface LoopBudget {
  maxRounds: number;   // mặc định 8
  maxMs: number;       // tổng thời gian cho các vòng viết tiếp
}

export const DEFAULT_LOOP_BUDGET: LoopBudget = { maxRounds: 8, maxMs: 5 * 60_000 };

/** Đuôi mỏ neo gửi cho vòng sau. */
export const TAIL_ANCHOR_CHARS = 800;

/** Overlap tối đa cần dò (AI hiếm khi lặp lại hơn ~500 ký tự). */
const MAX_OVERLAP = 500;
const MIN_OVERLAP = 20;

/* ─── 1) Phát hiện phản hồi bị cắt dở ─── */

export function detectCut(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // codeblock markdown lẻ
  const backticks = (trimmed.match(/```/g) || []).length;
  if (backticks % 2 !== 0) return true;

  // XML tag mở mà chưa đóng (các tag app dùng)
  for (const tag of ['Variable_rules', 'thought_process', 'translation', 'AI_ACTION']) {
    const open = (trimmed.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    const close = (trimmed.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open > close) return true;
  }

  // ngoặc nhọn/vuông lệch NHIỀU (1-2 cái lệch có thể là văn bản thường)
  const openBraces = (trimmed.match(/\{/g) || []).length;
  const closeBraces = (trimmed.match(/\}/g) || []).length;
  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/\]/g) || []).length;
  if (openBraces - closeBraces >= 2 || openBrackets - closeBrackets >= 2) return true;

  // kết thúc GIỮA CÂU: ký tự cuối không phải dấu kết câu/đóng khối — dấu hiệu bị cắt token.
  // Chỉ tính khi nội dung đủ dài (câu trả lời ngắn kiểu "OK" không áp dụng).
  if (trimmed.length > 400) {
    const lastChar = trimmed[trimmed.length - 1];
    const sentenceEnders = /[.。．!！?？…»”"'`)\]}>|:：;；\-*_~✅✓]/;
    if (!sentenceEnders.test(lastChar) && !/[\d]/.test(lastChar)) return true;
  }

  return false;
}

/* ─── 2+3) Ghép đoạn viết tiếp, khử phần AI lỡ lặp lại ─── */

export interface StitchResult {
  stitched: string;
  /** Số ký tự trùng đã cắt khỏi đầu đoạn mới. */
  overlapCut: number;
  /** Nội dung MỚI thực sự được thêm (sau khi khử lặp). */
  addedChars: number;
}

/** Dò overlap: suffix của `existing` == prefix của `continuation` (thử raw rồi trim). */
export function findOverlap(existing: string, continuation: string): number {
  const maxL = Math.min(MAX_OVERLAP, existing.length, continuation.length);
  for (let L = maxL; L >= MIN_OVERLAP; L--) {
    const suffix = existing.slice(-L);
    if (continuation.startsWith(suffix)) return L;
  }
  // thử bản nới lỏng khoảng trắng đầu (AI hay thêm \n trước khi lặp)
  const contTrim = continuation.replace(/^\s+/, '');
  const lead = continuation.length - contTrim.length;
  if (lead > 0) {
    for (let L = Math.min(MAX_OVERLAP, existing.length, contTrim.length); L >= MIN_OVERLAP; L--) {
      if (contTrim.startsWith(existing.slice(-L))) return L + lead;
    }
  }
  return 0;
}

export function stitchContinuation(existing: string, continuation: string): StitchResult {
  if (!continuation) return { stitched: existing, overlapCut: 0, addedChars: 0 };
  const overlap = findOverlap(existing, continuation);
  const fresh = continuation.slice(overlap);
  return { stitched: existing + fresh, overlapCut: overlap, addedChars: fresh.trim().length };
}

/* ─── Prompt viết tiếp: chỉ gửi ĐUÔI mỏ neo (không gửi cả bài) ─── */

export function buildContinuationPrompt(baseUserPrompt: string, fullSoFar: string, round: number): string {
  const tail = fullSoFar.slice(-TAIL_ANCHOR_CHARS);
  return `${baseUserPrompt}

[TIẾP TỤC PHẢN HỒI BỊ CẮT — vòng ${round}]
Phản hồi trước đó của bạn bị ngắt giữa chừng do giới hạn token. Đây là ĐOẠN CUỐI CÙNG bạn đã viết (chỉ trích phần đuôi làm mỏ neo):
"""
${tail}
"""
Hãy viết TIẾP ngay sau ký tự cuối cùng của đoạn trên — đúng mạch, đúng văn phong, thống nhất thuật ngữ với phần đã viết. TUYỆT ĐỐI KHÔNG lặp lại bất kỳ chữ nào của đoạn mỏ neo, KHÔNG mở đầu bằng lời dẫn ("Tiếp theo là…"), bắt đầu thẳng từ chữ bị cắt dở.`;
}

/* ─── 4) Điều kiện dừng ─── */

export interface LoopState {
  round: number;
  startedAt: number;
  stalls: number;      // số vòng liên tiếp không thêm nội dung mới đáng kể
}

export type LoopStopReason = 'complete' | 'max_rounds' | 'budget' | 'stalled' | null;

/** Quyết định sau mỗi vòng: null = tiếp tục; ngược lại = dừng với lý do. */
export function shouldStop(
  text: string, state: LoopState, budget: LoopBudget = DEFAULT_LOOP_BUDGET, now = Date.now(),
): LoopStopReason {
  if (!detectCut(text)) return 'complete';
  if (state.round >= budget.maxRounds) return 'max_rounds';
  if (now - state.startedAt > budget.maxMs) return 'budget';
  if (state.stalls >= 2) return 'stalled';
  return null;
}

/** Ngưỡng "vòng này có thêm nội dung thật không" — dưới ngưỡng tính là dậm chân. */
export const STALL_MIN_ADDED = 40;
