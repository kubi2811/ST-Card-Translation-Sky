/**
 * chunkAdvice.ts — (bug 163) ĐỀ XUẤT SỐ ĐOẠN QUÉT khi user nạp truyện.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao cần: mặc định 12 đoạn × 40.000 ký tự = 480.000 ký tự. Với một bộ truyện dài 11 triệu ký
 * tự thì đó là **4%** — và không có chỗ nào nói ra. User đặt mốc "thế giới rộng thì phải trên 500
 * entry" rồi không hiểu vì sao mãi không đạt, trong khi lý do chỉ là app chưa đọc tới.
 *
 * Các con số dưới đây KHÔNG phải phỏng đoán — đo trên truyện thật (11.056.048 ký tự), API thật,
 * model chính gemini-3.1-pro-preview + model phụ gemini-3-flash-preview:
 *      24 đoạn (960k ký tự,  8,7% truyện) → 2.747 dữ kiện → 371 entry · ~27 phút · 217 lượt AI
 *      48 đoạn (1,92M ký tự,  17% truyện) → 4.720 dữ kiện → 551 entry · ~55 phút · 390 lượt AI
 * ⇒ xấp xỉ 11–12 entry mỗi đoạn, và chi phí tăng gần như tuyến tính theo số đoạn.
 *
 * Hàm thuần, không đụng UI → test được thẳng.
 */

/** Số đoạn tối đa cho phép đề xuất. Trên mức này thời gian chạy thành hàng giờ, lợi bất cập hại. */
export const MAX_ADVISED_CHUNKS = 48;
/**
 * Ước lượng entry theo số đoạn. KHÔNG tuyến tính — đây là điều số đo cho thấy:
 *   24 đoạn → 371 entry (15,5 entry/đoạn)
 *   48 đoạn → 551 entry (11,5 entry/đoạn)
 * Đọc thêm truyện thì entry vẫn tăng, nhưng tăng CHẬM dần: chủ đề bắt đầu lặp lại và khâu khử
 * trùng lặp gỡ đi nhiều hơn. Nhân tuyến tính 11,5/đoạn sẽ nói dối user ở cả hai đầu (thấp ở mức
 * 24, cao ở mức 100). Nên khớp một đường luỹ thừa `k · n^p` đi qua ĐÚNG hai điểm đo được:
 *   p = log2(551/371) ≈ 0,571   ·   k = 371 / 24^p ≈ 60,5
 */
export const FIT_K = 60.5;
export const FIT_P = 0.571;
export function estimateEntries(chunks: number): number {
  if (chunks <= 0) return 0;
  return Math.round(FIT_K * Math.pow(chunks, FIT_P));
}

export interface ChunkAdvice {
  /** Số đoạn cần để đọc HẾT truyện. */
  needed: number;
  /** Số đoạn nên dùng (đã chặn trần). */
  recommended: number;
  /** % truyện được đọc với cấu hình HIỆN TẠI. */
  currentCoverage: number;
  /** % truyện được đọc nếu nhận đề xuất. */
  advisedCoverage: number;
  /** Ước lượng entry với cấu hình hiện tại / với đề xuất. */
  currentEntries: number;
  advisedEntries: number;
  /** Có nên hiện lời khuyên không — chỉ khi đề xuất thật sự cao hơn mức đang đặt. */
  shouldAdvise: boolean;
  /** Đọc hết truyện rồi thì không cần khuyên gì. */
  alreadyFull: boolean;
}

export function adviseChunks(storyLen: number, chunkSize: number, maxChunks: number): ChunkAdvice {
  const size = chunkSize > 0 ? chunkSize : 40000;
  const needed = Math.max(1, Math.ceil(storyLen / size));
  const recommended = Math.min(needed, MAX_ADVISED_CHUNKS);
  const pct = (n: number) => (storyLen <= 0 ? 0 : Math.min(100, Math.round((n * size * 100) / storyLen)));
  // Chặn theo `needed`: đặt 100 đoạn cho truyện chỉ cần 5 đoạn thì entry không tăng thêm.
  const est = (n: number) => estimateEntries(Math.min(n, needed));
  return {
    needed,
    recommended,
    currentCoverage: pct(maxChunks),
    advisedCoverage: pct(recommended),
    currentEntries: est(maxChunks),
    advisedEntries: est(recommended),
    alreadyFull: maxChunks >= needed,
    shouldAdvise: recommended > maxChunks,
  };
}

/**
 * Lời giải thích cho user — nói SỰ THẬT gồm cả cái giá phải trả, không chỉ dụ bấm nút.
 * Trả về từng đoạn để UI tự dựng, không nhúng HTML.
 */
export function adviceText(a: ChunkAdvice, storyLen: number, currentChunks: number): string[] {
  if (!a.shouldAdvise) return [];
  // Đo thật: 48 đoạn ≈ 55 phút. Quy đổi tuyến tính, đủ để user hình dung cái giá.
  const dur = (chunks: number) => {
    const mins = Math.max(1, Math.round((chunks / 48) * 55));
    return mins >= 60 ? `~${(mins / 60).toFixed(1)} giờ` : `~${mins} phút`;
  };
  const out = [
    `Truyện của bạn dài ${storyLen.toLocaleString()} ký tự — cần ${a.needed} đoạn mới đọc hết.`,
    `Đang đặt ${currentChunks} đoạn, tức app chỉ đọc ${a.currentCoverage}% truyện. Phần còn lại không được nhìn tới, nên lore ở nửa sau sẽ không có entry nào — và app không có cách nào biết để báo cho bạn.`,
    `Nâng lên ${a.recommended} đoạn thì đọc được ${a.advisedCoverage}% truyện.`,
    `Ước lượng entry: khoảng ${a.currentEntries} → ${a.advisedEntries}. Con số này đo trên truyện thật, không phải phỏng đoán: 24 đoạn ra 371 entry, 48 đoạn ra 551 entry.`,
    `Cái giá phải trả: thời gian chạy ${dur(currentChunks)} → ${dur(a.recommended)}, số lượt gọi API tăng tương ứng.`,
    `Không mất gì nếu đổi ý: đổi lại bất cứ lúc nào ở ô "Số đoạn quét tối đa", và quá trình quét có tạm dừng/tiếp tục nên dừng giữa chừng không mất việc đã làm.`,
  ];
  if (a.needed > MAX_ADVISED_CHUNKS) {
    out.push(`Truyện này quá dài để đọc trọn (cần ${a.needed} đoạn). Muốn phủ nhiều hơn mà không tăng số lượt gọi thì tăng "Kích thước mỗi đoạn" thay vì tăng số đoạn.`);
  }
  return out;
}
