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
