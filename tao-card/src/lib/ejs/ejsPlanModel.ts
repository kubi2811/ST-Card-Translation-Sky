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
  | 'edit_character';   // sửa trường Character Definition

export type PlanTarget = 'lorebook' | 'character';

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
  const wantConditional = rowsAccepted
    .filter(r => r.target === 'lorebook' && r.proposedMode === 'conditional')
    .map(r => r.name);
  if (!wantConditional.length) return [];

  const allCode = generatedCode.join('\n');
  return wantConditional.filter(name => {
    // Controller nào bật entry này cũng phải nhắc đúng tên nó trong lời gọi activewi/getwi.
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(?:activewi|activateWorldInfo|getwi)\\s*\\([^)]*${esc}`, 'i').test(allCode);
  });
}
