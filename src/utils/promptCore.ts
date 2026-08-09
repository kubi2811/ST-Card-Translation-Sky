/**
 * src/utils/promptCore.ts — (bug 218) SYSTEM PROMPT CORE.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Trợ Lý A.I có System Prompt Core chưa? Nếu có thì hiển thị icon sát bên icon Ký Ức,
 * nếu chưa có thì thêm vào."
 *
 * Chưa có. Trước bản này system prompt được ghép bằng một template literal nằm giữa hàm gửi tin
 * (AiCompanionPanel), trộn lẫn sáu nguồn khác nhau vào một chuỗi. Hệ quả thực tế:
 *
 *   • KHÔNG AI NHÌN THẤY prompt cuối cùng. Trợ Lý cư xử lạ thì không có cách nào biết vì tầng
 *     nào — persona? RAG? chỉ thị người dùng? Chỉ đoán.
 *   • KHÔNG TẮT ĐƯỢC TỪNG PHẦN. Muốn thử "bỏ RAG ra xem có đỡ lan man không" là phải sửa code.
 *   • KHÔNG BIẾT PHẦN NÀO ĂN TOKEN. Prompt phình tới mức đẩy câu hỏi hiện tại ra khỏi cửa sổ
 *     ngữ cảnh mà không ai hay.
 *   • THỨ TỰ CHỈ LÀ TÌNH CỜ. Với LLM, đặt trước hay sau có sức nặng khác nhau — thứ tự đó đáng
 *     được nói ra và chỉnh được, không phải là hệ quả của việc ai viết dòng nào trước.
 *
 * Nay prompt là một danh sách TẦNG có thứ tự, mỗi tầng bật/tắt và xem được. Ghép chỉ còn là nối
 * các tầng đang bật. Tách hẳn khỏi React nên test được, và cũng để panel với hàm gửi tin dùng
 * CHUNG một phép ghép — panel hiện đúng cái sẽ gửi đi, không phải bản mô phỏng gần đúng.
 */

/** Khoá tầng — cố định để lưu lại thiết lập của người dùng qua các phiên. */
export type LayerId =
  | 'core'        // lõi bất biến: Trợ Lý là ai, kỷ luật dữ liệu lớn, luật an toàn
  | 'persona'     // persona sub-agent do orchestrator chọn
  | 'nsfw'        // cờ R18
  | 'skills'      // kỹ năng khớp câu hỏi (bug 218 — skillStore)
  | 'memory'      // ký ức dài hạn + RAG
  | 'chats'       // các cuộc trò chuyện người dùng chọn cho AI nhớ (bug 218)
  | 'context'     // danh sách tài liệu/thẻ đang mở
  | 'directive';  // Prompt Chỉ Thị của người dùng

export interface PromptLayer {
  id: LayerId;
  /** Nhãn tiếng Việt hiện trong panel. */
  label: string;
  /** Vì sao tầng này tồn tại — hiện dưới nhãn để người dùng biết tắt đi thì mất gì. */
  why: string;
  /** Nội dung tầng ở lượt này; rỗng nghĩa là lượt này không có gì để nói. */
  content: string;
  enabled: boolean;
  /** Tầng KHOÁ không cho tắt — tắt là Trợ Lý mất luôn luật an toàn và kỷ luật dữ liệu. */
  locked?: boolean;
}

/**
 * THỨ TỰ MẶC ĐỊNH, và vì sao lại là thứ tự này.
 *
 * Lõi trước để mọi thứ sau nằm trong khuôn nó. Dữ liệu (kỹ năng → ký ức → chat cũ → ngữ cảnh)
 * nằm giữa. CHỈ THỊ NGƯỜI DÙNG ĐẶT CUỐI CÙNG — chốt này có từ bug 146 và giữ nguyên: với LLM,
 * cái đọc sau cùng có sức nặng lớn nhất, mà chỉ thị người dùng phải thắng mọi hướng dẫn ở trên.
 */
export const DEFAULT_LAYER_ORDER: LayerId[] = [
  'core', 'persona', 'nsfw', 'skills', 'memory', 'chats', 'context', 'directive',
];

export const LAYER_META: Record<LayerId, { label: string; why: string; locked?: boolean }> = {
  core: {
    label: 'Lõi hệ thống',
    why: 'Trợ Lý là ai, được/không được làm gì, kỷ luật xử lý dữ liệu lớn. Không tắt được.',
    locked: true,
  },
  persona: {
    label: 'Vai chuyên trách',
    why: 'Bộ định tuyến chọn vai hợp yêu cầu (dịch, MVU, regex…). Tắt thì Trợ Lý về vai chung.',
  },
  nsfw: {
    label: 'Cho phép R18',
    why: 'Chỉ hiện khi bạn bật chế độ R18 ở phần cài đặt.',
  },
  skills: {
    label: 'Kỹ năng khớp yêu cầu',
    why: 'Kỹ năng trong kho có từ khoá trùng câu bạn vừa gõ. Tắt thì kho skill không tác dụng.',
  },
  memory: {
    label: 'Ký ức & tra cứu',
    why: 'Ký ức dài hạn và đoạn tài liệu tìm được. Tắt thì Trợ Lý chỉ biết những gì trong lượt này.',
  },
  chats: {
    label: 'Hội thoại đã chọn nhớ',
    why: 'Các cuộc trò chuyện cũ bạn tick cho Trợ Lý nhớ. Bỏ tick là tầng này rỗng.',
  },
  context: {
    label: 'Tài liệu & thẻ đang mở',
    why: 'Danh sách file đính kèm và thẻ hiện tại.',
  },
  directive: {
    label: 'Prompt Chỉ Thị của bạn',
    why: 'Đặt CUỐI CÙNG có chủ ý — vị trí này thắng mọi hướng dẫn phía trên.',
  },
};

/** Khung bọc riêng của vài tầng — giữ đúng câu chữ đã dùng từ trước để không đổi hành vi. */
function wrap(id: LayerId, content: string): string {
  const c = content.trim();
  if (!c) return '';
  switch (id) {
    case 'nsfw':
      return '[CẦN CHÚ Ý: ĐÃ BẬT CHẾ ĐỘ R18/NSFW. Cho phép xử lý nội dung nhạy cảm người lớn nếu người dùng yêu cầu.]';
    case 'context':
      return `[DANH SÁCH TÀI LIỆU NGỮ CẢNH HIỆN TẠI]:\n${c}`;
    case 'directive':
      return '[📜 PROMPT CHỈ THỊ TỪ NGƯỜI DÙNG — TUÂN THỦ TUYỆT ĐỐI, ƯU TIÊN CAO HƠN MỌI HƯỚNG DẪN KHÁC Ở TRÊN. '
        + 'Nếu một yêu cầu trong hội thoại mâu thuẫn với chỉ thị này, PHẢI theo chỉ thị này và nói rõ cho người dùng biết lý do.]\n'
        + c;
    default:
      return c;
  }
}

export interface BuildLayersInput {
  core: string;
  persona?: string;
  nsfw?: boolean;
  skills?: string;
  memory?: string;
  chats?: string;
  context?: string;
  directive?: string;
  /** Tầng người dùng đã tắt (lưu qua các phiên). Tầng khoá bỏ qua danh sách này. */
  disabled?: LayerId[];
  /** Thứ tự người dùng tự sắp; thiếu tầng nào thì chèn theo thứ tự mặc định. */
  order?: LayerId[];
}

/** Dựng danh sách tầng cho MỘT lượt gửi. Không ném — thiếu gì thì tầng đó rỗng. */
export function buildLayers(input: BuildLayersInput): PromptLayer[] {
  const raw: Record<LayerId, string> = {
    core: input.core || '',
    persona: input.persona || '',
    nsfw: input.nsfw ? 'on' : '',
    skills: input.skills || '',
    memory: input.memory || '',
    chats: input.chats || '',
    context: input.context || '',
    directive: input.directive || '',
  };
  const off = new Set(input.disabled || []);
  const order = normalizeOrder(input.order);
  return order.map((id) => {
    const meta = LAYER_META[id];
    return {
      id,
      label: meta.label,
      why: meta.why,
      locked: meta.locked,
      content: wrap(id, raw[id]),
      // Tầng khoá luôn bật, kể cả khi thiết lập cũ lỡ ghi nó vào danh sách tắt.
      enabled: meta.locked ? true : !off.has(id),
    };
  });
}

/**
 * Chuẩn hoá thứ tự: giữ thứ tự người dùng đặt, bỏ khoá lạ/trùng, và BỔ SUNG tầng còn thiếu.
 *
 * Phần bổ sung là chốt chặn cho việc nâng cấp: thêm một tầng mới ở bản sau mà người dùng đang
 * có thiết lập cũ lưu trong máy thì tầng mới sẽ vắng mặt vĩnh viễn — im lặng và rất khó truy.
 */
export function normalizeOrder(order?: LayerId[]): LayerId[] {
  const seen = new Set<LayerId>();
  const out: LayerId[] = [];
  for (const id of order || []) {
    if (!LAYER_META[id] || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of DEFAULT_LAYER_ORDER) if (!seen.has(id)) out.push(id);
  return out;
}

/** Ghép các tầng đang bật và có nội dung. Đây là chuỗi THẬT gửi đi. */
export function composeSystemPrompt(layers: PromptLayer[]): string {
  return layers
    .filter((l) => l.enabled && l.content.trim())
    .map((l) => l.content.trim())
    .join('\n\n');
}

/**
 * Ước lượng token. CỐ Ý thô: mục đích là để người dùng thấy tầng nào đang ăn chỗ, không phải để
 * tính tiền. Tiếng Việt/Trung tốn token hơn tiếng Anh nhiều nên chia theo mật độ ký tự ngoài
 * ASCII — chia đều cho 4 như thói quen sẽ báo thấp hơn thực tế tới hai lần với prompt tiếng Việt.
 */
export function estimateTokens(text: string): number {
  const s = text || '';
  if (!s) return 0;
  let nonAscii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) nonAscii++;
  const ratio = nonAscii / s.length;
  const charsPerToken = 4 - 2.3 * ratio;   // ~4 cho ASCII thuần, ~1.7 cho CJK/Việt dày dấu
  return Math.ceil(s.length / Math.max(1, charsPerToken));
}

export interface LayerStat {
  id: LayerId;
  label: string;
  chars: number;
  tokens: number;
  /** Phần trăm token so với cả prompt — làm tròn, tổng có thể lệch 1%. */
  percent: number;
  enabled: boolean;
  empty: boolean;
}

/** Bảng số cho panel: tầng nào bao nhiêu ký tự / token / bao nhiêu phần trăm. */
export function layerStats(layers: PromptLayer[]): { rows: LayerStat[]; totalTokens: number; totalChars: number } {
  const rows = layers.map((l) => {
    const active = l.enabled && !!l.content.trim();
    const chars = active ? l.content.trim().length : 0;
    return { id: l.id, label: l.label, chars, tokens: estimateTokens(active ? l.content.trim() : ''), percent: 0, enabled: l.enabled, empty: !l.content.trim() };
  });
  const totalTokens = rows.reduce((n, r) => n + r.tokens, 0);
  const totalChars = rows.reduce((n, r) => n + r.chars, 0);
  for (const r of rows) r.percent = totalTokens ? Math.round((r.tokens / totalTokens) * 100) : 0;
  return { rows, totalTokens, totalChars };
}
