/**
 * tokenBudget.ts — (bug 194/196) NGÂN SÁCH TOKEN CHO MỖI ENTRY LOREBOOK: ĐO THẬT, KHÔNG ƯỚC.
 * ─────────────────────────────────────────────────────────────────────────────
 * User (bug 194): "phần lorebook và chức năng nâng cao, AI sinh theo batch LUÔN LUÔN không sinh
 * đủ số token đã đặt cho mỗi entry — nó luôn chỉ có một nửa số token yêu cầu."
 *
 * Đo lại bằng chính bộ đếm token (gpt-tokenizer, vốn đã có trong dự án):
 *   • Văn xuôi lore tiếng Việt : 3.35 ký tự/token
 *   • Entry lorebook thật (thẻ bug/174, 30 entry): 2.98 ký tự/token
 *   ⇒ hằng số 3.5 mà tool đang dùng KHÔNG phải thủ phạm — nó chỉ lạc quan chút ít.
 *
 * Thủ phạm thật là hai chỗ khác:
 *
 *  1. KHÔNG BAO GIỜ ĐẾM TOKEN THẬT. Tool chỉ đếm ký tự rồi nhân chia, và không hề báo cho user
 *     con số thực tế. Thiếu hụt vì thế vô hình với chính cái tool đang hứa hẹn con số đó.
 *
 *  2. LÔ QUÁ TO SO VỚI TRẦN OUTPUT. `max_tokens` là một con số cố định trong Settings (mặc định
 *     4096) chứ không suy ra từ `tokensPerEntry × số entry mỗi lô`. Khi tổng nhu cầu của lô chạm
 *     trần, mô hình KHÔNG báo lỗi — nó tự nén mỗi entry ngắn lại cho đủ chỗ. Đây là kiểu hỏng
 *     im lặng đúng nghĩa: không cắt giữa chừng, không cảnh báo, chỉ là mọi entry đều ngắn.
 *     Với yêu cầu 3000-5000 token/entry của bug 196 thì một lô 6 entry cần ~30.000 token output —
 *     gấp bảy lần trần mặc định, không cách nào ra đủ.
 *
 * ─── (User 2026) BỎ HẲN SÀN ĐỘ DÀI ──────────────────────────────────────────
 * Bản trước dựng thêm một SÀN CHẤP NHẬN (85% ngân sách): prompt doạ "ngắn hơn sẽ bị loại", entry
 * dưới sàn thì bị bắt viết lại, dưới 45% thì bị vứt và ghi nợ sinh bù. User báo chính cái sàn đó
 * phản tác dụng: mô hình học được rằng chạm mốc là xong nên viết vừa đủ tới đó rồi dừng, còn hai
 * cơ chế "cứu" kia biến mỗi entry hụt thành thêm vài lời gọi AI — thành một vòng lặp không dứt.
 *
 * Nay ngân sách token chỉ còn là ĐỊNH HƯỚNG ĐỘ CHI TIẾT trong lời nhắc, không phải hạn ngạch:
 * không sàn, không loại entry vì ngắn, không tự động bắt viết lại. Phần ĐO vẫn giữ nguyên — nó là
 * thứ duy nhất cho user biết thực tế ra bao nhiêu token, và nó không hề ép mô hình điều gì.
 */
import { encode } from 'gpt-tokenizer';

/**
 * Ký tự tiếng Việt trên mỗi token — ĐO chứ không đoán (xem docblock trên).
 * Lấy 3.0 (sát số đo của entry thật) để phần ước lượng hiển thị không hứa quá tay.
 */
export const VI_CHARS_PER_TOKEN = 3.0;

/** Đếm token THẬT. Có sự cố với tokenizer thì lùi về ước lượng theo ký tự, không bao giờ ném lỗi. */
export function countTokens(text: string): number {
  const s = String(text ?? '');
  if (!s) return 0;
  try {
    return encode(s).length;
  } catch {
    return Math.round(s.length / VI_CHARS_PER_TOKEN);
  }
}

export interface EntryBudgetCheck {
  /** Số token đo được của nội dung. */
  actual: number;
  /** Ngân sách người dùng đặt (0 = không đặt). */
  target: number;
  /** actual / target — 1 khi không đặt ngân sách. */
  ratio: number;
}

/**
 * ĐO độ dài một entry so với ngân sách. THUẦN ĐO ĐẠC — không phán đạt/không đạt, vì không còn
 * sàn nào để phán (xem docblock). Kết quả chỉ dùng để báo cáo cho user.
 */
export function checkEntryBudget(content: string, tokensPerEntry: number): EntryBudgetCheck {
  const target = Math.max(0, Math.round(tokensPerEntry || 0));
  const actual = countTokens(content);
  if (target <= 0) return { actual, target: 0, ratio: 1 };
  return { actual, target, ratio: actual / target };
}

export interface BatchPlan {
  /** Số entry nên hỏi trong MỘT lô để output không chạm trần. */
  entriesPerBatch: number;
  /** `max_tokens` cần cấp cho lời gọi này. */
  maxTokens: number;
  /** Có phải đã phải rút lô so với ý muốn ban đầu không (để nói cho user biết). */
  reduced: boolean;
}

/** Chi phí bao bì JSON cho mỗi entry: comment + keys + dấu ngoặc + escape. Đo áng chừng, dư ra chút. */
const JSON_OVERHEAD_PER_ENTRY = 60;
/** Chừa chỗ cho phần mở đầu/kết thúc mảng và sai số của tokenizer. */
const BATCH_FIXED_OVERHEAD = 200;

/**
 * (bug 194-3 / 196) Suy ra CỠ LÔ và `max_tokens` từ chính ngân sách token — thay vì để một con số
 * cố định trong Settings quyết định hộ.
 *
 * Nguyên tắc: một lô phải LỌT trần output, nếu không mô hình sẽ tự nén cho vừa và mọi entry đều
 * ngắn. Trần dùng được lấy theo khả năng model (`modelMaxOutput`), không phải theo `max_tokens`
 * user đang để — vì chính con số đó là thứ đang bóp nghẹt kết quả.
 */
export function planBatch(
  tokensPerEntry: number,
  wantedPerBatch: number,
  modelMaxOutput: number,
): BatchPlan {
  const per = Math.max(1, Math.round(tokensPerEntry || 250)) + JSON_OVERHEAD_PER_ENTRY;
  const ceiling = Math.max(1024, Math.round(modelMaxOutput || 8192));
  const want = Math.max(1, Math.round(wantedPerBatch || 5));

  // Chừa 20% biên an toàn: mô hình hay viết dôi, và tokenizer của provider khác gpt-tokenizer.
  const usable = Math.floor(ceiling * 0.8) - BATCH_FIXED_OVERHEAD;
  const fit = Math.max(1, Math.floor(usable / per));
  const entriesPerBatch = Math.min(want, fit);
  const maxTokens = Math.min(ceiling, entriesPerBatch * per + BATCH_FIXED_OVERHEAD);

  return { entriesPerBatch, maxTokens, reduced: entriesPerBatch < want };
}

/**
 * Chỉ thị độ dài đưa cho AI. Nói bằng BA cách vì mô hình không tự đếm được token của chính nó:
 * số token (để khớp ngôn ngữ của user), số ký tự (đo được), và CẤU TRÚC (số đoạn) — cái cuối là
 * thứ mô hình bám theo tốt nhất trong thực tế.
 *
 * (User 2026) Nói bằng giọng ĐỊNH HƯỚNG, tuyệt đối không đặt sàn và không doạ loại bài: hễ nêu
 * một con số tối thiểu là mô hình viết vừa chạm con số đó rồi dừng — đúng thứ user đang than.
 */
export function buildLengthDirective(tokensPerEntry: number): string {
  const t = Math.max(0, Math.round(tokensPerEntry || 0));
  if (t <= 0) return '';
  const chars = Math.round(t * VI_CHARS_PER_TOKEN);
  // ~55 token mỗi đoạn văn xuôi tiếng Việt cỡ 3-4 câu.
  const paras = Math.max(1, Math.round(t / 55));
  return `

### 📏 ĐỘ CHI TIẾT MONG MUỐN CỦA MỖI content
- Cỡ tham chiếu: ~${t} token ≈ ${chars} ký tự tiếng Việt, tức khoảng ${paras} đoạn.
- Con số trên tả ĐỘ SÂU cần có, không phải hạn ngạch phải lấp cho đủ rồi dừng bút. Cứ viết cho
  TRỌN thực thể đang tả: nguồn gốc, quan hệ, hệ quả, chi tiết cảm quan, ví dụ cụ thể, mâu thuẫn
  nội tại. Còn ý đáng viết thì viết tiếp, hết ý thì dừng.
- TUYỆT ĐỐI không nhồi chữ rỗng, không lặp ý, không viết lan man chỉ để cho dài.`;
}
