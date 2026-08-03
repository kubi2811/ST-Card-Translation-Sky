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
 * Thủ phạm thật là ba chỗ khác:
 *
 *  1. SÀN CHẤP NHẬN ĐẶT Ở 60%. Bộ kiểm cũ nhận mọi entry dài ≥ `tokensPerEntry × 3.5 × 0.6`,
 *     trong khi prompt lại hứa với AI là "không được ngắn hơn 70%". Mô hình ngôn ngữ vốn luôn
 *     viết hụt so với yêu cầu độ dài, nên kết quả dồn hết xuống sát sàn — user đo ra "một nửa".
 *     Không có bất kỳ cơ chế nào kéo nó lên.
 *
 *  2. KHÔNG BAO GIỜ ĐẾM TOKEN THẬT. Tool chỉ đếm ký tự rồi nhân chia, và không hề báo cho user
 *     con số thực tế. Thiếu hụt vì thế vô hình với chính cái tool đang hứa hẹn con số đó.
 *
 *  3. LÔ QUÁ TO SO VỚI TRẦN OUTPUT. `max_tokens` là một con số cố định trong Settings (mặc định
 *     4096) chứ không suy ra từ `tokensPerEntry × số entry mỗi lô`. Khi tổng nhu cầu của lô chạm
 *     trần, mô hình KHÔNG báo lỗi — nó tự nén mỗi entry ngắn lại cho đủ chỗ. Đây là kiểu hỏng
 *     im lặng đúng nghĩa: không cắt giữa chừng, không cảnh báo, chỉ là mọi entry đều ngắn.
 *     Với yêu cầu 3000-5000 token/entry của bug 196 thì một lô 6 entry cần ~30.000 token output —
 *     gấp bảy lần trần mặc định, không cách nào ra đủ.
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
  /** Ngân sách người dùng đặt. */
  target: number;
  /** actual / target. */
  ratio: number;
  /** Đạt sàn chưa. */
  ok: boolean;
  /** Ngắn tới mức vô dụng — không đáng nới thêm, nên bỏ và sinh lại. */
  hopeless: boolean;
}

/**
 * Sàn chấp nhận. 0.85 chứ không phải 0.6: hứa với user bao nhiêu thì phải giao gần bấy nhiêu.
 * Dưới sàn nhưng còn khá (≥ 0.45) thì NỚI THÊM cho đủ — rẻ và chắc ăn hơn sinh lại từ đầu.
 * Dưới 0.45 là mô hình hiểu sai đề, nới cũng không cứu được, sinh lại thì hơn.
 */
export const ENTRY_MIN_RATIO = 0.85;
export const ENTRY_HOPELESS_RATIO = 0.45;

export function checkEntryBudget(content: string, tokensPerEntry: number): EntryBudgetCheck {
  const target = Math.max(0, Math.round(tokensPerEntry || 0));
  const actual = countTokens(content);
  if (target <= 0) return { actual, target: 0, ratio: 1, ok: true, hopeless: false };
  const ratio = actual / target;
  return {
    actual, target, ratio,
    ok: ratio >= ENTRY_MIN_RATIO,
    hopeless: ratio < ENTRY_HOPELESS_RATIO,
  };
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
 */
export function buildLengthDirective(tokensPerEntry: number): string {
  const t = Math.max(0, Math.round(tokensPerEntry || 0));
  if (t <= 0) return '';
  const chars = Math.round(t * VI_CHARS_PER_TOKEN);
  const minChars = Math.round(chars * ENTRY_MIN_RATIO);
  // ~55 token mỗi đoạn văn xuôi tiếng Việt cỡ 3-4 câu.
  const paras = Math.max(1, Math.round(t / 55));
  const sentences = Math.max(3, Math.round(t / 18));
  return `

### 📏 ĐỘ DÀI BẮT BUỘC CỦA MỖI content
- Mục tiêu: ~${t} token ≈ ${chars} ký tự tiếng Việt.
- SÀN CỨNG: không dưới ${minChars} ký tự. Entry ngắn hơn sẽ bị loại và bắt viết lại.
- Về cấu trúc: khoảng ${paras} đoạn, tổng cộng tối thiểu ${sentences} câu hoàn chỉnh.
- Viết hụt là lỗi NẶNG hơn viết dôi. Thiếu ý thì đào sâu thêm: nguồn gốc, quan hệ, hệ quả, chi
  tiết cảm quan, ví dụ cụ thể, mâu thuẫn nội tại — TUYỆT ĐỐI không nhồi chữ rỗng hay lặp ý.`;
}

/** Lời nhắc NỚI THÊM cho một entry còn thiếu độ dài — rẻ và chắc hơn sinh lại từ đầu. */
export function buildExpandPrompt(
  comment: string,
  content: string,
  tokensPerEntry: number,
  actualTokens: number,
): string {
  const need = Math.max(1, Math.round(tokensPerEntry - actualTokens));
  return `Entry "${comment}" hiện mới ${actualTokens} token, còn thiếu khoảng ${need} token so với yêu cầu ${tokensPerEntry}.

NỘI DUNG HIỆN CÓ:
"""
${content}
"""

Hãy VIẾT LẠI entry này cho ĐỦ ĐỘ DÀI:
- GIỮ NGUYÊN mọi thông tin đã có, không được bỏ bớt hay diễn đạt lại cho ngắn đi.
- BỔ SUNG chiều sâu: nguồn gốc, bối cảnh, quan hệ với thực thể khác, hệ quả, chi tiết cảm quan,
  ví dụ cụ thể, mâu thuẫn/điểm yếu.
- TUYỆT ĐỐI không nhồi chữ rỗng, không lặp lại ý đã viết, không thêm lời dẫn kiểu "dưới đây là".
- CHỈ trả về phần nội dung mới, dạng văn bản thuần, không JSON, không markdown, không tiêu đề.`;
}
