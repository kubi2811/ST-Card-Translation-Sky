/**
 * src/lib/ai/ideaPolish.ts — (bug 137) CÂY ĐŨA THẦN cho ô "Ý tưởng của bạn".
 * ─────────────────────────────────────────────────────────────────────────────
 * User: gõ ý tưởng lộn xộn dồn một đoạn dài → bấm đũa thần → AI TÁCH VÀ SẮP XẾP lại thành các
 * đoạn rõ ràng rồi điền lại vào chính ô đó; đồng thời TỰ XÂY quy tắc/ràng buộc phù hợp với thế
 * giới đó điền vào ô "Yêu cầu/Quy tắc cho AI".
 *
 * Nguyên tắc BẮT BUỘC (lời user): "chỉ được sắp xếp lại cấu trúc câu chữ... TUYỆT ĐỐI KHÔNG
 * được thêm, bớt, hay biến đổi ý nghĩa. Nội dung sau khi xử lý phải tương ứng 1-1 với nội dung
 * gốc, chỉ khác về cách trình bày."
 *
 * "1-1 về ý" không đo bằng máy được, nhưng phần ĐO ĐƯỢC thì phải đo: mọi CON SỐ và mọi TÊN
 * RIÊNG trong bản gốc phải còn nguyên trong bản đã sắp xếp. AI làm rơi dù chỉ một cái là loại
 * bản đó và giữ nguyên văn của user — thà không giúp còn hơn lặng lẽ đổi ý người ta.
 */

import type { ChatMessage } from '../../types';

export const IDEA_POLISH_SYSTEM = `Bạn là biên tập viên cấu trúc văn bản. Người dùng đưa một đoạn Ý TƯỞNG
tạo card SillyTavern viết lộn xộn. Việc của bạn có ĐÚNG HAI phần:

1. "polishedIdea" — SẮP XẾP LẠI ý tưởng cho dễ đọc:
   • Tách thành các phần có tiêu đề ngắn (## Nhân vật chính, ## Thế giới & bối cảnh, ## Hệ thống
     sức mạnh/chỉ số, ## Cốt truyện & mở đầu, ## Phong cách & giọng văn, ## Khác — CHỈ dùng phần
     nào ý tưởng thật sự có nội dung).
   • Trong mỗi phần: gạch đầu dòng, mỗi ý một dòng, giữ NGUYÊN từ ngữ của người dùng tối đa.
   • TUYỆT ĐỐI KHÔNG thêm chi tiết mới, KHÔNG bỏ chi tiết nào, KHÔNG "làm hay" nội dung, KHÔNG
     đổi tên riêng, KHÔNG đổi con số. Mọi ý trong bản gốc phải tìm lại được trong bản mới (1-1).
     Câu tối nghĩa thì GIỮ NGUYÊN CÂU ĐÓ, không tự diễn dịch.

2. "suggestedRules" — RÚT quy tắc/ràng buộc cho AI tạo card, SUY TRỰC TIẾP từ những gì ý tưởng
   đã nói (không bịa thêm thiết lập mới): xưng hô/giọng văn nếu ý tưởng có nêu, ranh giới thế
   giới ("chỉ dùng địa danh đã nêu", "hệ sức mạnh theo đúng các cấp X/Y/Z đã liệt kê"), điều
   ý tưởng cấm hoặc nhấn mạnh. 3-8 gạch đầu dòng, mỗi dòng một quy tắc, kèm nguồn gốc ngắn
   trong ngoặc (vd "(từ đoạn mô tả cảnh giới)"). Không đủ căn cứ thì trả MẢNG RỖNG.

Trả về DUY NHẤT JSON: {"polishedIdea": "...", "suggestedRules": ["...", "..."]}`;

export function buildIdeaPolishMessages(idea: string): ChatMessage[] {
  return [
    { role: 'system', content: IDEA_POLISH_SYSTEM },
    { role: 'user', content: `Ý TƯỞNG GỐC (giữ 1-1 về ý, chỉ sắp xếp lại):\n${'─'.repeat(30)}\n${idea}` },
  ];
}

/** Bóc TÊN RIÊNG (cụm chữ hoa liền nhau) + CON SỐ — phần "1-1" đo được bằng máy. */
export function extractAnchorTokens(text: string): string[] {
  const out = new Set<string>();
  // Số (kể cả 3.5, 1000000) — bỏ số quá ngắn đứng trong từ.
  for (const m of text.matchAll(/(?<![\w.])\d+(?:[.,]\d+)?(?![\w])/g)) out.add(m[0]);
  // Cụm viết hoa (tên riêng): 1-4 từ bắt đầu bằng chữ hoa liền nhau, bỏ từ đầu câu đơn lẻ
  // phổ biến bằng cách đòi cụm ≥ 2 từ HOẶC từ đơn dài ≥ 4 ký tự có mặt ≥ 2 lần.
  const single = new Map<string, number>();
  for (const m of text.matchAll(/\p{Lu}[\p{L}\p{N}]*(?:[ ]\p{Lu}[\p{L}\p{N}]*){0,3}/gu)) {
    const t = m[0].trim();
    if (t.split(' ').length >= 2) out.add(t);
    else if (t.length >= 4) single.set(t, (single.get(t) ?? 0) + 1);
  }
  for (const [t, n] of single) if (n >= 2) out.add(t);
  return [...out];
}

export interface IdeaPolishResult {
  polishedIdea: string;
  suggestedRules: string[];
  /** Token neo bị rơi (nếu có) — có là bản polish bị TỪ CHỐI ở verifyIdeaPolish. */
  droppedTokens: string[];
}

export function parseIdeaPolishResponse(raw: string): { polishedIdea: string; suggestedRules: string[] } {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON.');
  const p = JSON.parse(m[0]) as { polishedIdea?: string; suggestedRules?: unknown };
  const polishedIdea = String(p.polishedIdea ?? '').trim();
  if (!polishedIdea) throw new Error('AI không trả về polishedIdea.');
  const suggestedRules = Array.isArray(p.suggestedRules)
    ? p.suggestedRules.map(String).map(s => s.trim()).filter(Boolean).slice(0, 10)
    : [];
  return { polishedIdea, suggestedRules };
}

/**
 * Chốt chặn 1-1: mọi token neo (tên riêng, con số) của bản gốc phải còn trong bản polish.
 * Rơi token ⇒ TỪ CHỐI (trả droppedTokens để UI nói rõ vì sao giữ nguyên văn gốc).
 */
export function verifyIdeaPolish(original: string, polished: string): { ok: boolean; dropped: string[] } {
  const anchors = extractAnchorTokens(original);
  const hay = polished.toLowerCase();
  const dropped = anchors.filter(t => {
    // Token SỐ phải khớp theo ranh giới: "100" nằm trong "1000" KHÔNG tính là còn —
    // đổi 100 linh thạch thành 1000 chính là đổi ý người dùng.
    if (/^\d/.test(t)) {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`(?<![\\d.,])${esc}(?![\\d.,])`).test(polished);
    }
    return !hay.includes(t.toLowerCase());
  });
  return { ok: dropped.length === 0, dropped };
}

/**
 * (bug 137) Ý tưởng đã qua đũa thần có cấu trúc `## Phần` + gạch đầu dòng. Khối chỉ dẫn này
 * được nối vào các prompt đọc ý tưởng để AI tận dụng cấu trúc đó thay vì đọc như văn xuôi.
 */
export const POLISHED_IDEA_READING_HINT = `
LƯU Ý ĐỌC Ý TƯỞNG: nếu ý tưởng được chia phần bằng tiêu đề "## …" và gạch đầu dòng thì đó là
bản đã sắp xếp — mỗi phần ứng thẳng với việc của bạn (## Nhân vật chính → hồ sơ nhân vật,
## Thế giới & bối cảnh → lorebook, ## Hệ thống sức mạnh/chỉ số → schema biến, ## Cốt truyện &
mở đầu → first message/bối cảnh mở đầu, ## Phong cách & giọng văn → văn phong). Bám đúng phần
liên quan, KHÔNG bịa thêm ngoài những gì các phần đã nêu.`;
