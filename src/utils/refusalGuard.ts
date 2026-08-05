/**
 * src/utils/refusalGuard.ts — (bug 214) NHẬN DIỆN LỜI TỪ CHỐI CỦA AI, đừng ghép nó vào thẻ.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ca thật user báo: dịch thẻ 18+ nặng, một đoạn bị Google chặn và API trả về HTTP 200 kèm nội dung
 *
 *     "The prompt could not be submitted. The prompt contains sensitive words that violate
 *      Google's [Generative AI Prohibited Use policy](…). Try rephrasing the prompt."
 *
 * Đây KHÔNG phải lỗi mạng, cũng không phải khối `promptFeedback.blockReason` / `finishReason:
 * SAFETY` có cấu trúc (hai cái đó apiClient đã bắt từ lâu) — nó là một phản hồi "thành công" mà
 * nội dung lại là lời từ chối. Engine không có cách nào biết, nên nhận luôn làm bản dịch.
 *
 * Và vì entry lớn được cắt thành nhiều chunk dịch song song rồi GHÉP LẠI, hậu quả đúng như user
 * mô tả: chunk 1 bị từ chối, các chunk sau dịch ngon, ghép hết vào nhau ⇒ entry trong thẻ mở đầu
 * bằng câu tiếng Anh của Google rồi mới tới nội dung tiếng Việt. Không lỗi đỏ, không cảnh báo,
 * "lâu lâu cũng không để ý".
 *
 * Bộ này chạy trên TỪNG CHUNK ngay khi nhận phản hồi, trước mọi bước ghép.
 *
 * ── Vì sao không sợ báo oan ──
 * Chốt hai lớp: phải khớp một mẫu từ chối ĐÃ BIẾT, VÀ phản hồi phải "trông như một lời từ chối"
 * chứ không phải một bản dịch có nhắc tới chính sách:
 *   · lời từ chối luôn NGẮN (vài trăm ký tự) trong khi bản dịch của chunk phải dài xấp xỉ bản gốc;
 *   · nếu phản hồi dài thì mẫu phải nằm ngay ĐẦU (AI từ chối trước rồi mới nói thêm).
 * Một thẻ có nội dung bàn về "content policy" nằm giữa bài sẽ không bị bắt.
 */

export type RefusalSource = 'google' | 'openai' | 'anthropic' | 'generic';

export interface RefusalMatch {
  /** Đoạn văn bản khớp — để in ra cho user thấy đúng thứ AI trả về. */
  matched: string;
  /** Đoán nhà cung cấp, chỉ để viết thông báo cho dễ hiểu. */
  source: RefusalSource;
}

interface Pattern { re: RegExp; source: RefusalSource }

/**
 * Các mẫu ĐÃ BIẾT. Cố ý viết hẹp và bám câu chữ đặc trưng — thà bỏ lọt một biến thể lạ (user vẫn
 * thấy nó qua lớp kiểm chữ Hán sót / độ dài) còn hơn bắt oan một bản dịch thật rồi chặn cả lượt.
 */
const PATTERNS: Pattern[] = [
  // ── Google / Gemini và các proxy của nó (đúng ca user gặp) ──
  { re: /the prompt could not be submitted/i, source: 'google' },
  { re: /generative[\s-]?ai prohibited use policy/i, source: 'google' },
  { re: /policies\.google\.com\/terms\/generative-ai/i, source: 'google' },
  { re: /prompt contains? sensitive words/i, source: 'google' },
  { re: /try rephrasing the prompt/i, source: 'google' },
  { re: /\bblocked by (?:the )?safety (?:filter|settings)/i, source: 'google' },

  // ── OpenAI ──
  { re: /content[_\s]policy[_\s]violation/i, source: 'openai' },
  { re: /violates? (?:our|the|openai'?s) (?:content|usage) polic/i, source: 'openai' },
  { re: /this request (?:has been|was) (?:blocked|rejected) (?:by|due to)/i, source: 'openai' },

  // ── Anthropic ──
  { re: /\bI (?:can(?:'|’)?t|cannot|won(?:'|’)?t) help (?:you )?with (?:that|this)/i, source: 'anthropic' },
  { re: /\bI(?:'|’)?m not able to (?:help|assist) with (?:that|this)/i, source: 'anthropic' },

  // ── Câu từ chối chung của mọi model ──
  { re: /\bI(?:'|’)?m sorry,?\s*but I (?:can(?:'|’)?t|cannot|am unable to)/i, source: 'generic' },
  { re: /\bI (?:can(?:'|’)?t|cannot) (?:assist|comply) with (?:that|this)/i, source: 'generic' },
  { re: /\bas an AI(?: language)? model,? I (?:can(?:'|’)?t|cannot|am unable)/i, source: 'generic' },
  { re: /\bI (?:must|have to) (?:decline|refuse)\b/i, source: 'generic' },
];

/** Lời từ chối dài nhất mà ta còn coi là "một lời từ chối" chứ không phải bản dịch. */
const REFUSAL_MAX_CHARS = 1500;
/** Nếu phản hồi dài hơn thế, mẫu phải nằm trong khoảng đầu này mới tính. */
const HEAD_WINDOW = 300;

export interface DetectRefusalOptions {
  /**
   * Độ dài đoạn GỐC mà lượt gọi này đáng lẽ phải dịch ra. Có nó thì bắt chắc tay hơn nhiều: phản
   * hồi ngắn hơn hẳn bản gốc + khớp mẫu ⇒ gần như chắc chắn là từ chối.
   */
  sourceLength?: number;
}

/**
 * Trả về mẫu khớp nếu `text` là một lời TỪ CHỐI, hoặc null nếu trông như nội dung thật.
 * Hàm thuần, không ném.
 */
export function detectRefusal(text: string, opts: DetectRefusalOptions = {}): RefusalMatch | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const { re, source } of PATTERNS) {
    const m = re.exec(trimmed);
    if (!m) continue;

    const looksShort = trimmed.length <= REFUSAL_MAX_CHARS;
    const atHead = m.index <= HEAD_WINDOW;
    // Phản hồi ngắn hơn hẳn bản gốc là dấu hiệu mạnh: dịch thật không bao giờ teo đi như vậy.
    const muchShorterThanSource = !!opts.sourceLength && trimmed.length < opts.sourceLength * 0.3;

    if (looksShort || atHead || muchShorterThanSource) {
      return { matched: m[0], source };
    }
  }
  return null;
}

/** Câu thông báo cho user — nói rõ AI đã từ chối chứ không phải tool hỏng. */
export function refusalMessage(match: RefusalMatch, label: string): string {
  const who = match.source === 'google' ? 'Google/Gemini'
    : match.source === 'openai' ? 'OpenAI'
    : match.source === 'anthropic' ? 'Anthropic'
    : 'Nhà cung cấp AI';
  return `🚫 ${label}: ${who} TỪ CHỐI dịch đoạn này (nội dung 18+/nhạy cảm) — “${match.matched}”. `
    + `Bản gốc được giữ nguyên, KHÔNG ghép câu từ chối vào thẻ.`;
}

/**
 * Lỗi ném ra khi phát hiện từ chối. Có kiểu riêng để tầng trên phân biệt được với lỗi mạng —
 * lỗi mạng thì thử lại có ích, còn từ chối thì thử lại y hệt chỉ tốn tiền: phải ĐỔI CÁCH (bật
 * jailbreak, đổi model, cắt nhỏ hơn) hoặc báo cho user biết mà xử lý tay.
 */
export class RefusalError extends Error {
  readonly match: RefusalMatch;
  constructor(match: RefusalMatch, label?: string) {
    super(`AI_REFUSAL: ${match.matched}${label ? ` (${label})` : ''}`);
    this.name = 'RefusalError';
    this.match = match;
  }
}

export const isRefusalError = (e: unknown): e is RefusalError =>
  e instanceof RefusalError || (e instanceof Error && e.message.startsWith('AI_REFUSAL:'));
