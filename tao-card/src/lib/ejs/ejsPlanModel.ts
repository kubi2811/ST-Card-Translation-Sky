/**
 * src/lib/ejs/ejsPlanModel.ts — (bug 126) MÔ HÌNH KẾ HOẠCH EJS THEO TỪNG ENTRY.
 * ─────────────────────────────────────────────────────────────────────────────
 * User test "Bạn muốn EJS làm gì?" và báo: kế hoạch AI trả về "khá sơ sài và không thực hiện
 * được tất cả yêu cầu". Đọc code cũ thì rõ vì sao — kế hoạch chỉ có `scope` (vài câu văn xuôi)
 * và một danh sách bước tự do; KHÔNG chỗ nào bắt AI nói nó sẽ đụng vào ENTRY NÀO, entry đó
 * đang kích hoạt kiểu gì, đổi sang kiểu gì, vì sao. User không có gì để duyệt ngoài đoạn tóm
 * tắt, nên chỉ có thể "đồng ý cả cục" hoặc bỏ.
 *
 * File này định nghĩa hợp đồng dữ liệu mới: mỗi việc AI định làm là MỘT DÒNG có đủ
 *   (đối tượng, chế độ kích hoạt hiện tại, đề xuất, lý do)
 * để bảng kế hoạch duyệt được từng dòng, và để bước sinh code sau đó bám đúng dòng đã duyệt.
 *
 * Hai quyết định đáng nói:
 *
 * • KHÔNG chỉ giới hạn ở lorebook entry. User muốn AI xử lý được cả Character Definition, nên
 *   `target` có thêm 'character' — description/personality/scenario cũng chạy EJS được vì
 *   ST-Prompt-template xử lý macro trên toàn prompt, không riêng worldbook.
 *
 * • Phân loại kích hoạt lấy đúng ba nhóm user mô tả, và đây là phần tiết kiệm token thật sự:
 *   Auto Creator vốn để hầu hết entry ở Constant, tức nhồi vào mọi lượt chat.
 */
import type { LorebookEntry } from '../../types';

/** Chế độ kích hoạt của một entry — vừa là hiện trạng, vừa là đề xuất. */
export type ActivationMode =
  /** Luôn nhồi vào mọi lượt (constant=true). Tốn token nhất. */
  | 'constant'
  /** Kích hoạt khi chat nhắc tới từ khoá (keys). */
  | 'keyword'
  /** Entry tắt sẵn, controller EJS bật khi biến MVU đạt điều kiện. */
  | 'conditional'
  /** Tắt hẳn, không tham gia. */
  | 'disabled';

export const ACTIVATION_LABEL: Record<ActivationMode, string> = {
  constant: 'Luôn bật (Constant)',
  keyword: 'Theo từ khoá',
  conditional: 'Theo điều kiện biến',
  disabled: 'Tắt',
};

/** Loại việc AI định làm. */
export type PlanAction =
  | 'create_ejs'        // tạo entry EJS mới (controller, hiển thị biến…)
  | 'reclassify'        // đổi chế độ kích hoạt của entry sẵn có
  | 'edit_content'      // sửa nội dung entry sẵn có
  | 'edit_character'    // sửa trường Character Definition
  | 'split_entry';      // (Goal 28/07) tách 1 entry gộp thành nhiều entry độc lập

export type PlanTarget = 'lorebook' | 'character';

/** (Goal 28/07) MỘT entry con khi tách — khai TRƯỚC trong kế hoạch để user duyệt. */
export interface SplitPart {
  /** Tên entry mới. */
  name: string;
  /** Chế độ kích hoạt của entry mới. */
  mode: ActivationMode;
  /** Điều kiện/thời điểm kích hoạt — user đọc để duyệt ("tháng 3", "khi tới Vọng Nguyệt Lâu"…). */
  criterion: string;
}

/** MỘT DÒNG trong bảng kế hoạch — đơn vị user duyệt/từ chối. */
export interface EjsPlanRow {
  id: string;
  action: PlanAction;
  target: PlanTarget;
  /** Tên entry (comment) hoặc tên trường character ('description', 'personality'…). */
  name: string;
  /** Chế độ kích hoạt HIỆN TẠI — máy tự đo từ card, không tin AI khai. */
  currentMode: ActivationMode | null;
  /** Chế độ AI ĐỀ XUẤT. */
  proposedMode: ActivationMode | null;
  /** AI định làm gì với dòng này (user đọc để duyệt). */
  proposal: string;
  /** Vì sao — bắt buộc, đây là thứ user cần để quyết định. */
  reason: string;
  /** Chỉ dẫn cụ thể cho bước sinh code (không hiện trong bảng, dùng nội bộ). */
  requirement: string;
  /** Biến MVU mà dòng này định đọc (để bắt xung đột giữa các dòng). */
  varsUsed?: string[];
  /** Ước lượng token tiết kiệm được mỗi lượt nếu áp dòng này (constant → có điều kiện). */
  tokensSaved?: number;
  /** (Goal 28/07) action='split_entry': các entry con sẽ tách ra — hiện trong bảng để duyệt TRƯỚC. */
  splitInto?: SplitPart[];
  /**
   * (Goal 28/07) Ước token TĂNG/GIẢM mỗi lượt nếu áp dòng này (âm = tiết kiệm).
   * Là ƯỚC LƯỢNG tất định từ dữ liệu đo được, hiện trong bảng để user thấy hiệu quả trước khi duyệt.
   */
  tokensDelta?: number;
  /**
   * (bug 162 mục 3.1) PRESET NÀO sinh ra dòng này.
   * User: "bảng chỉ hiện mũi tên 'Luôn bật → Theo từ khoá' hoặc nhãn 'Tách'/'Tạo mới' — không ghi
   * rõ mục đó đang áp Preset Nhanh nào trong 19 preset, phải tự đoán qua icon hay nội dung lý do".
   * Đúng: bảng vốn không mang thông tin này. `presetId` để đối chiếu máy, `presetTitle` để hiện nhãn.
   */
  presetId?: string;
  presetTitle?: string;
}

/** Kế hoạch đầy đủ — thay cho AgentPlan văn xuôi của bản cũ. */
export interface EjsRichPlan {
  scope: string;
  rows: EjsPlanRow[];
  notes: string[];
  /** Cảnh báo máy tự phát hiện (card đã có thanh trạng thái, thiếu schema…). */
  warnings: string[];
  estCalls: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ĐO HIỆN TRẠNG TỪ CARD (không hỏi AI — AI hay khai sai)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chế độ kích hoạt THỰC TẾ của một entry.
 * Thứ tự xét quan trọng: entry tắt thì mọi cấu hình khác vô nghĩa; constant nuốt keyword.
 */
export function detectActivationMode(entry: LorebookEntry): ActivationMode {
  if (!entry.enabled) return 'disabled';
  if (entry.constant) return 'constant';
  if ((entry.keys ?? []).some(k => String(k).trim())) return 'keyword';
  // Bật, không constant, không key → thực chất không bao giờ tự kích hoạt được;
  // chỉ có controller EJS gọi activewi mới dùng tới. Xếp vào 'conditional'.
  return 'conditional';
}

/** Ước lượng token của một entry (≈4 ký tự/token cho văn Việt/Anh, CJK dày hơn). */
export function estimateEntryTokens(entry: LorebookEntry): number {
  const text = String(entry.content ?? '');
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  return Math.round(cjk + (text.length - cjk) / 4);
}

// ═══════════════════════════════════════════════════════════════════════════
// (Goal 28/07) ENTRY MVU — KHÔNG áp "Tiết kiệm Token" vào đây
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Entry thuộc BỘ MÁY MVU/EJS của card: [initvar], quy tắc cập nhật, danh sách biến, khối EJS,
 * entry chứa <UpdateVariable>. Hạ cấp/tắt chúng để "tiết kiệm token" là phá hệ biến của card
 * (initvar tắt là đúng chuẩn nhưng đổi chế độ nó vẫn là phá; quy tắc cập nhật mà kích hoạt
 * theo từ khoá thì AI trong game không còn biết cách cập nhật biến). User dặn thẳng:
 * "Tính năng Tiết kiệm Token không nên áp dụng vào các entry MVU".
 */
const MVU_NAME_HINT =
  /(\[initvar\]|initvar|update\s*rules?|quy\s*t[aắ]c\s*c[aậ]p\s*nh[aậ]t|variable\s*list|danh\s*s[aá]ch\s*bi[eế]n|update\s*variable|变量|更新规则|初始化)/i;

export function isMvuCriticalEntry(entry: LorebookEntry): boolean {
  const name = String(entry.comment ?? '');
  if (MVU_NAME_HINT.test(name)) return true;
  const body = String(entry.content ?? '');
  // Khối EJS (@@preprocessing / thẻ <% %>) là code chạy, không phải lore để hạ cấp.
  if (body.includes('@@preprocessing') || body.includes('<%')) return true;
  // Entry dạy định dạng <UpdateVariable> hoặc khởi tạo stat_data.
  if (/<\/?UpdateVariable>|<\/?JSONPatch>/i.test(body)) return true;
  if (/\bstat_data\b/.test(body) && /(_.set\(|"op"\s*:|'op'\s*:)/.test(body)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// (Goal 28/07) ƯỚC TOKEN TĂNG/GIẢM CHO TỪNG DÒNG KẾ HOẠCH
// ═══════════════════════════════════════════════════════════════════════════

/** Khối controller EJS chạy ngầm — chi phí prompt nhỏ, lấy ước lượng cố định. */
export const EJS_BLOCK_OVERHEAD_TOKENS = 40;

/**
 * Ước token TĂNG/GIẢM mỗi lượt của một dòng kế hoạch (âm = tiết kiệm). Chỉ là ước lượng
 * tất định từ dữ liệu đo được — nêu rõ trong UI, không hứa con số chính xác:
 *  • reclassify RỜI constant  → −token(entry): entry không còn bị nhồi mọi lượt.
 *  • reclassify VỀ constant   → +token(entry).
 *  • split_entry (gốc constant, N phần) → −token×(N−1)/N: coi như trung bình 1 phần kích hoạt.
 *  • create_ejs → +EJS_BLOCK_OVERHEAD_TOKENS.
 *  • edit_content / edit_character → 0 (chưa biết nội dung mới dài bao nhiêu).
 */
export function estimateRowTokensDelta(
  row: Pick<EjsPlanRow, 'action' | 'currentMode' | 'proposedMode' | 'splitInto'>,
  existing: LorebookEntry | undefined,
): number {
  const tokens = existing ? estimateEntryTokens(existing) : 0;
  switch (row.action) {
    case 'reclassify': {
      if (!existing || !row.proposedMode || row.proposedMode === row.currentMode) return 0;
      if (row.currentMode === 'constant' && row.proposedMode !== 'constant') return -tokens;
      if (row.currentMode !== 'constant' && row.proposedMode === 'constant') return tokens;
      return 0;
    }
    case 'split_entry': {
      const n = row.splitInto?.length ?? 0;
      if (!existing || n < 2) return 0;
      if (row.currentMode === 'constant') return -Math.round((tokens * (n - 1)) / n);
      return 0; // gốc đã kích hoạt có điều kiện — tách không đổi tổng lượng nạp
    }
    case 'create_ejs':
      return EJS_BLOCK_OVERHEAD_TOKENS;
    default:
      return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHÁT HIỆN THANH TRẠNG THÁI CÓ SẴN (user tự làm) — tránh AI tạo trùng
// ═══════════════════════════════════════════════════════════════════════════

export interface ExistingUiReport {
  /** Card đã có giao diện thanh trạng thái do người dùng/công cụ khác làm. */
  hasStatusUi: boolean;
  /** Chỗ tìm thấy — hiện cho user và bơm vào prompt để AI biết mà tránh. */
  places: string[];
}

/**
 * Dò xem card ĐÃ CÓ thanh trạng thái/bảng hiển thị biến hay chưa.
 *
 * User nêu đúng vấn đề: "card đã có sẵn UI thanh trạng thái riêng (do người dùng tự làm),
 * tránh việc tự tạo thêm giao diện trùng lặp". Không có cờ nào đánh dấu việc đó, nên phải
 * suy từ dấu vết thật: entry/regex chứa HTML dựng bảng + đọc biến, hoặc script TavernHelper
 * render trạng thái. Dò rộng còn hơn để AI đẻ thêm một thanh nữa chồng lên.
 */
export function detectExistingStatusUi(
  entries: LorebookEntry[],
  regexScripts: Array<{ scriptName?: string; replaceString?: string }> = [],
  tavernScripts: Array<{ name?: string; content?: string }> = [],
): ExistingUiReport {
  const places: string[] = [];
  const NAME_HINT = /(thanh\s*tr[aạ]ng\s*th[aá]i|status\s*bar|statusbar|bảng\s*tr[aạ]ng\s*th[aá]i|状态栏|状态面板|panel)/i;
  // Dấu vết UI thật: có khung HTML + có đọc biến. Chỉ một trong hai thì chưa chắc.
  const hasHtmlFrame = (s: string) => /<(div|table|details|progress|span)\b/i.test(s);
  const readsVars = (s: string) => /getvar\s*\(|stat_data|getMvuData|\{\{get(global)?var/i.test(s);

  for (const e of entries) {
    const body = String(e.content ?? '');
    const named = NAME_HINT.test(String(e.comment ?? ''));
    if (named || (hasHtmlFrame(body) && readsVars(body))) {
      places.push(`Lorebook entry "${e.comment || `#${e.id}`}"`);
    }
  }
  for (const r of regexScripts) {
    const body = String(r.replaceString ?? '');
    if (NAME_HINT.test(String(r.scriptName ?? '')) || (hasHtmlFrame(body) && readsVars(body))) {
      places.push(`Regex script "${r.scriptName || '(không tên)'}"`);
    }
  }
  for (const s of tavernScripts) {
    const body = String(s.content ?? '');
    if (NAME_HINT.test(String(s.name ?? '')) || (hasHtmlFrame(body) && readsVars(body))) {
      places.push(`Script TavernHelper "${s.name || '(không tên)'}"`);
    }
  }

  return { hasStatusUi: places.length > 0, places: [...new Set(places)].slice(0, 12) };
}

// ═══════════════════════════════════════════════════════════════════════════
// GỢI Ý PHÂN LOẠI TẤT ĐỊNH — máy làm được phần nào thì đừng bắt AI đoán
// ═══════════════════════════════════════════════════════════════════════════

/** Entry mà AI BẮT BUỘC phải biết mọi lượt — giữ Constant dù có tốn token. */
const MUST_KNOW_HINT =
  /(quy\s*t[aắ]c|nội\s*quy|xưng\s*hô|lu[aậ]t|thi[eế]t\s*l[aậ]p|世界观|规则|设定|system|core|b[aắ]t\s*bu[oộ]c|định\s*dạng|format|output)/i;

export interface ReclassifySuggestion {
  entryId: number;
  name: string;
  currentMode: ActivationMode;
  suggested: ActivationMode;
  reason: string;
  tokensSaved: number;
}

/**
 * Rà các entry đang Constant và gợi ý chuyển sang từ khoá / điều kiện.
 *
 * Đây là phần MÁY làm chắc tay hơn AI: hiện trạng và số token là dữ kiện đo được, chỉ phần
 * "entry này có buộc phải biết mọi lượt không" mới cần suy đoán. Máy chạy trước để AI có
 * bảng nền, khỏi phải bịa hiện trạng — và để user vẫn thấy đề xuất kể cả khi AI trả về sơ sài.
 *
 * Ba nhóm đúng như user mô tả:
 *   - buộc biết mọi lượt (quy tắc xưng hô, thiết lập thế giới)  → giữ constant
 *   - chỉ đúng khi một biến MVU đạt điều kiện                    → conditional
 *   - chỉ liên quan khi hội thoại nhắc tới, không gắn biến nào   → keyword
 */
export function suggestReclassification(
  entries: LorebookEntry[],
  schemaLeafNames: string[] = [],
): ReclassifySuggestion[] {
  const out: ReclassifySuggestion[] = [];
  const leaves = schemaLeafNames.map(n => n.toLowerCase()).filter(n => n.length >= 2);

  // Thanh trạng thái/giao diện của chính card thì KHÔNG đề xuất hạ cấp.
  // Bắt được khi chạy thử: entry "Thanh trạng thái của tôi" đọc getvar nên khớp luật "gắn biến
  // MVU" và bị đề xuất chuyển sang kích hoạt theo điều kiện — tức bảo user tắt đi giao diện họ
  // tự làm. Vô lý, và mâu thuẫn với chính cơ chế detectExistingStatusUi vốn sinh ra để bảo vệ nó.
  const uiPlaces = new Set(detectExistingStatusUi(entries).places);
  const isUiEntry = (e: LorebookEntry) => uiPlaces.has(`Lorebook entry "${e.comment || `#${e.id}`}"`);

  for (const e of entries) {
    if (detectActivationMode(e) !== 'constant') continue;
    if (isUiEntry(e)) continue;
    // (Goal 28/07) Entry thuộc bộ máy MVU/EJS: không bao giờ đề xuất hạ cấp để tiết kiệm token.
    if (isMvuCriticalEntry(e)) continue;
    const name = e.comment || `#${e.id}`;
    const tokens = estimateEntryTokens(e);

    if (MUST_KNOW_HINT.test(name)) {
      continue; // giữ constant — không đề xuất gì để bảng khỏi loãng
    }

    const body = `${name}\n${String(e.content ?? '')}`.toLowerCase();
    const hit = leaves.find(v => body.includes(v));
    if (hit) {
      out.push({
        entryId: e.id, name, currentMode: 'constant', suggested: 'conditional',
        reason: `Nội dung gắn với biến MVU "${hit}" — chỉ đúng khi biến đó đạt điều kiện, không cần nhồi mọi lượt.`,
        tokensSaved: tokens,
      });
      continue;
    }

    out.push({
      entryId: e.id, name, currentMode: 'constant',
      suggested: (e.keys ?? []).some(k => String(k).trim()) ? 'keyword' : 'keyword',
      reason: 'Không gắn biến nào và không phải quy tắc bắt buộc — chỉ cần hiện khi hội thoại nhắc tới.',
      tokensSaved: tokens,
    });
  }

  // Nặng token trước — user duyệt được cái đáng tiền nhất trong vài dòng đầu.
  return out.sort((a, b) => b.tokensSaved - a.tokensSaved);
}

// ═══════════════════════════════════════════════════════════════════════════
// (bug 127) ENTRY "TẮT SẴN" MÀ KHÔNG AI BẬT = ENTRY CHẾT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chuyển một entry sang chế độ "kích hoạt theo điều kiện" nghĩa là TẮT nó đi và giao cho một
 * controller EJS bật lại bằng `await activewi(tên, true)`. Nếu controller đó không tồn tại —
 * user từ chối dòng tạo controller, hoặc AI quên sinh — thì entry vĩnh viễn không bao giờ xuất
 * hiện. Không có lỗi đỏ nào cả: lore chỉ lặng lẽ biến mất khỏi mọi lượt chat.
 *
 * Đây là mâu thuẫn nội bộ của chính cơ chế phân loại, nên phải kiểm chủ động ở hai chỗ:
 * lúc trình kế hoạch (cảnh báo sớm) và sau khi chạy (đối chiếu code thật sinh ra).
 */
export function findOrphanConditionalEntries(
  rowsAccepted: EjsPlanRow[],
  generatedCode: string[],
): string[] {
  // (bug 162 mục 3.7) TÍNH CẢ 'disabled', KHÔNG CHỈ 'conditional'.
  // Bằng chứng user: "Cấp Hiệu Trấn Minh" và "Shard Collapse Mechanic" bị chuyển hẳn sang TẮT THỦ
  // CÔNG rồi dựa vào activewi để cưỡng bức bật. Chốt chặn cũ chỉ soi proposedMode === 'conditional'
  // nên hai entry đó lọt hoàn toàn — không controller nào bật thì lore mất sạch mà không lỗi nào
  // báo, đúng loại "cơ chế bị vô hiệu âm thầm" mà user đã gặp trước đây.
  const wantConditional = rowsAccepted
    .filter(r => r.target === 'lorebook' && (r.proposedMode === 'conditional' || r.proposedMode === 'disabled'))
    .map(r => r.name);
  if (!wantConditional.length) return [];

  const allCode = generatedCode.join('\n');
  return wantConditional.filter(name => {
    // Controller nào bật entry này cũng phải nhắc đúng tên nó trong lời gọi activewi/getwi.
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(?:activewi|activateWorldInfo|getwi)\\s*\\([^)]*${esc}`, 'i').test(allCode);
  });
}

/**
 * (bug 162 mục 3.7) Entry bị TẮT TAY mà trông vào activewi để bật — cần user xác nhận MỘT LẦN
 * trong chat thật.
 *
 * Nói thẳng giới hạn: tool kiểm được "có controller gọi activewi đúng tên entry đó hay không"
 * (findOrphanConditionalEntries ở trên), nhưng KHÔNG kiểm được "activewi có thắng nổi cờ tắt tay
 * trong SillyTavern hay không" — đó là hành vi runtime của SillyTavern, chỉ chat thật mới trả lời
 * được. Bịa ra một câu "đã kiểm, ổn" thì tệ hơn im lặng.
 * Nên trả về danh sách entry rơi vào diện đó kèm hướng dẫn kiểm cụ thể, để user xác nhận một lần
 * rồi yên tâm về sau.
 */
export function entriesNeedingLiveActivationCheck(rowsAccepted: EjsPlanRow[]): string[] {
  return rowsAccepted
    .filter(r => r.target === 'lorebook' && r.proposedMode === 'disabled')
    .map(r => r.name);
}

/** Hướng dẫn kiểm — cụ thể tới mức bấm theo được, không nói chung chung. */
export function liveActivationCheckHint(names: string[]): string[] {
  if (!names.length) return [];
  return [
    `⚠️ ${names.length} entry được đặt TẮT TAY và trông vào activewi để bật: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}.`,
    'Tool đã kiểm có controller gọi đúng tên chúng, NHƯNG việc "activewi có thắng được cờ tắt tay" là hành vi của SillyTavern — chỉ chat thật mới xác nhận được. Kiểm một lần rồi khỏi lo về sau:',
    `1. Nạp thẻ vào SillyTavern, mở panel World Info và xác nhận các entry trên đang ở trạng thái tắt (đèn xám).`,
    `2. Chat một câu tạo ra đúng điều kiện mà controller đang chờ (ví dụ đưa biến tới mốc mà nó kiểm).`,
    `3. Mở lại World Info: entry phải sáng lên trong lượt đó. Nếu KHÔNG sáng thì activewi không thắng cờ tắt tay — lúc đó hãy chuyển các entry này sang "kích hoạt theo từ khoá" thay vì tắt tay.`,
  ];
}
