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

/* ═══════════════════════════════════════════════════════════════════════════
 * (bugNeedFix/185) ĐŨA THẦN 3 CHẾ ĐỘ.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "bây giờ khi click vô thì có các lựa chọn" — ngoài Sắp xếp & Chuẩn hoá (bug 137) thêm
 * Phác thảo Thế giới và Làm giàu & Hoàn thiện. Hai chế độ mới ĐƯỢC PHÉP thêm nội dung, nhưng
 * ba luật chung thì không đổi:
 *   • KHÔNG được làm rơi ý gốc — verifyIdeaPolish vẫn canh đủ tên riêng + con số của bản gốc
 *     (nó chỉ đòi cái CŨ còn nguyên, không cấm cái MỚI, nên dùng chung cho cả ba chế độ);
 *   • phần AI tự thêm phải PHÂN BIỆT ĐƯỢC với ý gốc — bắt buộc đánh dấu "✚" từng dòng thêm,
 *     vì trộn lẫn rồi thì user hết đường biết đâu là ý mình;
 *   • cùng khuôn JSON {polishedIdea, suggestedRules} — parse/verify/UI đi chung một đường.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WandMode = 'polish' | 'world' | 'enrich';

export const WAND_MODES: Array<{ id: WandMode; icon: string; label: string; desc: string }> = [
  {
    id: 'polish', icon: '🪄', label: 'Sắp xếp & Chuẩn hoá ý tưởng',
    desc: 'Giữ 1:1 toàn bộ ý gốc, chỉ tổ chức lại cho rõ ràng + tự rút quy tắc vào ô "Yêu cầu/Quy tắc cho AI". Không thêm, không bớt.',
  },
  {
    id: 'world', icon: '🌍', label: 'Phác thảo Thế giới',
    desc: 'Từ ý tưởng thế giới sơ khai, AI tự xác định còn thiếu mảng nào (địa lý, phe phái, hệ sức mạnh…) và bổ sung có chừng mực. Phần AI thêm được đánh dấu ✚.',
  },
  {
    id: 'enrich', icon: '✨', label: 'Làm giàu & Hoàn thiện ý tưởng',
    desc: 'Giữ đúng tinh thần gốc, đào sâu phần đang sơ sài (mô tả, bối cảnh, chiều sâu nhân vật). Phần đã đủ thì không thêm thừa. Phần AI thêm được đánh dấu ✚.',
  },
];

/** Khối luật chung nối vào MỌI chế độ — thích nghi theo nội dung, không áp khuôn cứng. */
const WAND_COMMON = `
LUẬT CHUNG (mọi chế độ):
• Thích nghi với TỪNG ý tưởng: đọc xem người dùng đang tổ chức kiểu gì, thế giới thuộc thể loại
  nào, rồi chọn cách phân tích/sắp xếp/mở rộng cho khớp — KHÔNG áp một template cố định.
• Ưu tiên ngữ cảnh và dữ liệu hiện có của người dùng hơn mọi khuôn mẫu bạn quen dùng.
• TUYỆT ĐỐI không đổi tên riêng, không đổi con số, không làm rơi bất kỳ ý nào của bản gốc,
  không đổi ý nghĩa hoặc phá logic người dùng đã đặt.
• Trả về DUY NHẤT JSON: {"polishedIdea": "...", "suggestedRules": ["...", "..."]}`;

const WAND_WORLD_SYSTEM = `Bạn là người xây dựng thế giới (worldbuilder) cho card SillyTavern. Người dùng
đưa một Ý TƯỞNG THẾ GIỚI còn nhỏ hoặc sơ khai. Việc của bạn:

1. "polishedIdea" — PHÁT TRIỂN thành bản phác thảo thế giới có cấu trúc:
   • GIỮ NGUYÊN VẸN mọi thiết lập gốc: từng tên riêng, con số, quy luật người dùng đã nêu phải
     còn nguyên văn. Không biến đổi bản chất thế giới.
   • TỰ XÁC ĐỊNH thế giới đang thiếu thành phần nào trong số: địa lý & khu vực, xã hội & văn hoá,
     lịch sử, phe phái & tổ chức, hệ thống sức mạnh, chủng tộc & sinh vật, quy luật đặc biệt —
     và CHỈ bổ sung những mảng phù hợp với ý gốc, ở mức phác thảo hợp lý (không viết tiểu thuyết).
   • Mảng nào ý gốc đã đủ thì để yên. Phần mới phải logic, liên kết với nhau và KHÔNG mâu thuẫn
     với bất kỳ thông tin nào người dùng đã cung cấp.
   • ĐÁNH DẤU PHÂN BIỆT: mỗi dòng/gạch đầu dòng do bạn TỰ THÊM phải mở đầu bằng "✚ ". Ý gốc của
     người dùng (dù đã diễn đạt lại chỗ đứng) thì KHÔNG mang dấu này. Người dùng phải nhìn phát
     biết ngay đâu là ý mình, đâu là đề xuất của bạn.
   • Trình bày bằng tiêu đề "## …" + gạch đầu dòng.

2. "suggestedRules" — quy tắc/ràng buộc rút từ thế giới SAU khi phác thảo (kể cả phần mới thêm),
   3-8 gạch đầu dòng; quy tắc đến từ phần bạn tự thêm thì cũng mở đầu bằng "✚ ".
${WAND_COMMON}`;

const WAND_ENRICH_SYSTEM = `Bạn là biên tập viên phát triển nội dung cho card SillyTavern. Người dùng đưa
một Ý TƯỞNG đã có hồn nhưng còn mỏng. Việc của bạn:

1. "polishedIdea" — LÀM GIÀU ý tưởng mà không đổi hướng:
   • GIỮ NGUYÊN ý tưởng và thông điệp cốt lõi: mọi tên riêng, con số, thiết lập, tình tiết gốc
     phải còn nguyên văn. Tuyệt đối không lái ý tưởng sang hướng khác.
   • TỰ NHẬN DIỆN phần nào đang quá sơ sài để đào sâu (thêm mô tả, bối cảnh, ví dụ, chiều sâu
     nhân vật, yếu tố phụ phù hợp) và phần nào ĐÃ ĐỦ để KHÔNG thêm thừa. Mục tiêu: phiên bản
     hoàn thiện hơn nhưng đúng tinh thần ban đầu — không phải phiên bản dài hơn.
   • ĐÁNH DẤU PHÂN BIỆT: mỗi dòng/gạch đầu dòng do bạn TỰ THÊM phải mở đầu bằng "✚ ". Ý gốc
     không mang dấu này.
   • Trình bày bằng tiêu đề "## …" + gạch đầu dòng.

2. "suggestedRules" — quy tắc giữ giọng/không khí rút từ bản đã làm giàu, 3-8 gạch đầu dòng;
   quy tắc đến từ phần bạn tự thêm thì mở đầu bằng "✚ ".
${WAND_COMMON}`;

const WAND_SYSTEM: Record<WandMode, string> = {
  polish: IDEA_POLISH_SYSTEM + WAND_COMMON,
  world: WAND_WORLD_SYSTEM,
  enrich: WAND_ENRICH_SYSTEM,
};

const WAND_TASK_LINE: Record<WandMode, string> = {
  polish: 'Ý TƯỞNG GỐC (giữ 1-1 về ý, chỉ sắp xếp lại):',
  world: 'Ý TƯỞNG THẾ GIỚI GỐC (giữ nguyên vẹn, phác thảo thêm phần còn thiếu, đánh dấu ✚ phần bạn thêm):',
  enrich: 'Ý TƯỞNG GỐC (giữ đúng tinh thần, đào sâu phần sơ sài, đánh dấu ✚ phần bạn thêm):',
};

export interface WandMessageOpts {
  droppedLastTime?: string[];
  /** (bug 185) Ngữ cảnh học từ các lần dùng trước — xem wandMemory.ts. Rỗng = bỏ qua. */
  styleContext?: string;
}

export function buildWandMessages(mode: WandMode, idea: string, opts: WandMessageOpts = {}): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: 'system', content: WAND_SYSTEM[mode] },
  ];
  // Ngữ cảnh người dùng đặt TRƯỚC ý tưởng: nó là nền để đọc ý tưởng, không phải nội dung.
  if (opts.styleContext?.trim()) {
    msgs.push({ role: 'user', content: opts.styleContext.trim() });
  }
  msgs.push({ role: 'user', content: `${WAND_TASK_LINE[mode]}\n${'─'.repeat(30)}\n${idea}` });
  // (bugNeedFix/145) Lượt trước rơi mất chi tiết thì NÓI ĐÍCH DANH rồi cho làm lại, thay vì
  // bắt user tự "bấm thử lại" mà lần sau cũng hỏng y hệt vì AI không biết mình sai ở đâu.
  if (opts.droppedLastTime && opts.droppedLastTime.length > 0) {
    msgs.push({
      role: 'user',
      content: `LẦN TRƯỚC BẠN LÀM RƠI những chi tiết sau — chúng CÓ trong ý tưởng gốc nhưng KHÔNG có trong bản bạn trả về:\n`
        + opts.droppedLastTime.map(t => `  • ${t}`).join('\n')
        + `\n\nLàm lại, giữ NGUYÊN VĂN từng chi tiết trên. Không được bỏ, không được viết khác đi.`,
    });
  }
  return msgs;
}

/** (bug 137) Giữ tên cũ cho chỗ gọi/test hiện có — nay là chế độ 'polish' của đũa thần 3 chế độ. */
export function buildIdeaPolishMessages(idea: string, droppedLastTime?: string[]): ChatMessage[] {
  return buildWandMessages('polish', idea, { droppedLastTime });
}

/**
 * (bugNeedFix/145) SỐ THỨ TỰ MỤC LỤC KHÔNG PHẢI LÀ NỘI DUNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * Đây là gốc bệnh làm đũa thần KHÔNG BAO GIỜ chạy được. Người ta viết ý tưởng theo dàn ý
 * đánh số — "1.", "2.1 Đại lục…", "2.2 Cảnh giới…" — mà việc của đũa thần đúng là XOÁ những
 * số đó đi để thay bằng tiêu đề "## …". Bản gốc coi "2.1"/"2.2" là CON SỐ NỘI DUNG cần giữ
 * 1-1, nên lần nào cũng báo "AI làm rơi chi tiết (2.1, 2.2, 2.3, 2.4…)" rồi vứt kết quả —
 * user không bao giờ nhận được bản sắp xếp lẫn bộ quy tắc rút ra.
 *
 * Phân biệt: số ĐÁNH DẤU MỤC nằm ở ĐẦU DÒNG và theo sau là dấu phân cách/khoảng trắng
 * ("2.1 Đại lục", "3) Cốt truyện", "4. Kết"). Số NỘI DUNG nằm giữa câu ("100 linh thạch",
 * "5 tông môn") — những cái này vẫn phải giữ nguyên và vẫn được đo.
 */
export function isOutlineNumber(text: string, index: number, token: string): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const before = text.slice(lineStart, index);
  // Chỉ chấp nhận bullet/khoảng trắng trước số → số này mở đầu một mục.
  if (!/^[\s>*\-–—•+#]*$/.test(before)) return false;
  const after = text.slice(index + token.length);
  // Theo sau là dấu kết thúc số mục rồi tới chữ, hoặc hết dòng.
  return /^[.)\]:、]?[ \t]/.test(after) || /^[.)\]:、]?$/.test(after) || /^[.)\]:、]?\r?\n/.test(after);
}

/** Bóc TÊN RIÊNG (cụm chữ hoa liền nhau) + CON SỐ — phần "1-1" đo được bằng máy. */
export function extractAnchorTokens(text: string): string[] {
  const out = new Set<string>();
  // Số (kể cả 3.5, 1000000) — bỏ số quá ngắn đứng trong từ.
  // (bugNeedFix/145) Bỏ qua số đánh dấu mục lục: chúng là ĐỊNH DẠNG, không phải nội dung,
  // và đũa thần được giao nhiệm vụ thay chúng bằng tiêu đề "## …".
  for (const m of text.matchAll(/(?<![\w.])\d+(?:[.,]\d+)*(?![\w])/g)) {
    if (isOutlineNumber(text, m.index ?? 0, m[0])) continue;
    out.add(m[0]);
  }
  // Cụm viết hoa (tên riêng): 1-4 từ bắt đầu bằng chữ hoa liền nhau, bỏ từ đầu câu đơn lẻ
  // phổ biến bằng cách đòi cụm ≥ 2 từ HOẶC từ đơn dài ≥ 4 ký tự có mặt ≥ 2 lần.
  //
  // (bugNeedFix/145) Từ đơn viết hoa còn phải xuất hiện GIỮA CÂU ít nhất một lần mới tính là
  // tên riêng. Tiếng Việt viết hoa đầu câu và đầu mục theo ngữ pháp, nên "Nhân" trong
  // "Nhân vật chính" hay "Cảnh" trong "Cảnh giới:" bị đếm thành tên riêng rồi bắt AI phải
  // giữ y nguyên — trong khi đũa thần có quyền viết lại tiêu đề. Tên riêng thật (Lâm Uyển,
  // Thiên Nam) hầu như luôn có lần nằm giữa câu.
  const single = new Map<string, number>();
  const singleMidSentence = new Set<string>();
  for (const m of text.matchAll(/\p{Lu}[\p{L}\p{N}]*(?:[ ]\p{Lu}[\p{L}\p{N}]*){0,3}/gu)) {
    const t = m[0].trim();
    if (t.split(' ').length >= 2) { out.add(t); continue; }
    if (t.length < 4) continue;
    single.set(t, (single.get(t) ?? 0) + 1);
    const idx = m.index ?? 0;
    const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
    const before = text.slice(lineStart, idx);
    // Đầu dòng / sau bullet / sau số mục / sau dấu chấm câu ⇒ viết hoa do ngữ pháp, không tính.
    const isSentenceStart = /^[\s>*\-–—•+#]*(?:\d+(?:[.,]\d+)*[.)\]:、]?[ \t]*)?$/.test(before)
      || /[.!?;:][ \t]*$/.test(before);
    if (!isSentenceStart) singleMidSentence.add(t);
  }
  for (const [t, n] of single) if (n >= 2 && singleMidSentence.has(t)) out.add(t);
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
