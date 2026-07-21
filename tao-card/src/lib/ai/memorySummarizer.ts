import type { ChatMessage } from '../../types';

/** Số lượt chat vượt mức này thì nén phần cũ lại. */
export const SUMMARIZE_THRESHOLD = 20;
/** Số lượt gần nhất luôn giữ nguyên văn (không nén). */
export const KEEP_RECENT = 6;

export interface SummarizeResult {
  summary: string;
  kept: ChatMessage[];
}

export function shouldSummarize(history: ChatMessage[]): boolean {
  return history.length >= SUMMARIZE_THRESHOLD;
}

/** Bản nén đang giữ: `coveredUpTo` lượt đầu đã được gói vào `summary`. */
export interface SummaryCache {
  coveredUpTo: number;
  summary: string;
}

/**
 * Ghép lịch sử gửi cho AI từ bản tóm lược + các lượt CHƯA được nén.
 *
 * Hai bẫy mà hàm này tồn tại để chặn:
 * 1. Tóm lược PHẢI đi dưới role 'user' với tiền tố [System: …]. Nếu dùng role 'system' thì
 *    client Claude/Gemini (chỉ lấy system message ĐẦU TIÊN rồi filter bỏ phần còn lại) sẽ
 *    vứt im lặng khối này — chat mất trí nhớ mà không báo lỗi gì.
 * 2. Phải cắt từ `coveredUpTo` của lịch sử HIỆN TẠI, không dùng lại mảng `kept` cũ — nếu không
 *    các lượt phát sinh sau lần nén sẽ rơi mất.
 */
export function buildCompressedHistory(history: ChatMessage[], cache: SummaryCache): ChatMessage[] {
  return [
    { role: 'user', content: `[System: TÓM LƯỢC PHẦN TRƯỚC CỦA HỘI THOẠI]\n${cache.summary}` } as ChatMessage,
    ...history.slice(cache.coveredUpTo),
  ];
}

/**
 * Nén phần đầu của lịch sử chat thành 1 đoạn tóm lược, giữ nguyên KEEP_RECENT lượt cuối.
 * Trả null khi chưa cần nén HOẶC khi gọi AI lỗi — người gọi cứ dùng lịch sử gốc, chat không đứt.
 */
export async function summarizeHistory(
  history: ChatMessage[],
  callAI: (prompt: string) => Promise<string>,
): Promise<SummarizeResult | null> {
  if (!shouldSummarize(history)) return null;

  const old = history.slice(0, history.length - KEEP_RECENT);
  const kept = history.slice(history.length - KEEP_RECENT);
  const transcript = old.map((m) => `${m.role}: ${m.content}`).join('\n');

  const prompt = `Tóm lược đoạn hội thoại sau thành 5-10 gạch đầu dòng ngắn, GIỮ LẠI: quyết định đã chốt, tên riêng, ràng buộc user đặt ra. BỎ: lời chào, câu xã giao, nội dung đã bị thay thế.\n\n${transcript}`;

  try {
    const summary = (await callAI(prompt)).trim();
    if (!summary) return null;
    return { summary, kept };
  } catch (e) {
    console.warn('[memory] nén chat lỗi, giữ nguyên lịch sử:', e);
    return null;
  }
}
