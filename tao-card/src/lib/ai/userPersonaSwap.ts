/**
 * userPersonaSwap.ts — (bugNeedFix/105) "Nhân vật thành {{user}}" phải THẬT SỰ thành {{user}}.
 * ─────────────────────────────────────────────────────────────────────────────
 * Trước đây tính năng này chỉ là MỘT DÒNG DẶN trong prompt. Dặn không phải là bảo đảm: bằng chứng
 * của user cho thấy thẻ sinh ra vẫn kể "Triệu Hy Ngạn vừa đạp xe về… chạm mặt {{user}} cũng vừa
 * bước ra sân" — tức model coi Triệu Hy Ngạn và {{user}} là HAI người, đúng cái nó được yêu cầu
 * gộp làm một. Người dùng thì thấy tên nhân vật mình vẫn nằm đó còn {{user}} thành vai quần chúng.
 *
 * Ở đây làm phần chắc chắn: sau khi AI trả bài, QUÉT LẠI bằng code và thay mọi lần nhắc tên đó
 * (cùng biệt danh) bằng {{user}}. Không phụ thuộc model có nghe lời hay không.
 */

/** Bỏ dấu để so khớp rộng hơn một chút (Triệu Hy Ngạn ↔ Trieu Hy Ngan). */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Chữ cái theo nghĩa rộng (có dấu tiếng Việt, CJK, Hangul…). Dùng thay `\b` vì `\b` của JS chỉ
 * biết [A-Za-z0-9_] nên "Ngạn" đứng cạnh chữ có dấu sẽ khớp sai chỗ.
 */
const LETTER = '\\p{L}\\p{N}';

export interface SwapResult {
  text: string;
  /** Số lần thay được — để log cho user thấy tính năng có chạy. */
  count: number;
}

/**
 * Thay tên + biệt danh bằng `{{user}}` trong một đoạn văn.
 * Ưu tiên chuỗi DÀI trước (tên đầy đủ trước biệt danh) để không cắt vụn tên.
 */
export function swapNameToUser(text: string, name: string, aliases: string[] = []): SwapResult {
  if (!text || !name?.trim()) return { text, count: 0 };

  const targets = [name, ...aliases]
    .map(s => (s || '').trim())
    .filter(s => s.length >= 2)                    // 1 ký tự thì thay bừa rất nguy hiểm
    .sort((a, b) => b.length - a.length);
  if (targets.length === 0) return { text, count: 0 };

  let out = text;
  let count = 0;
  for (const t of targets) {
    for (const variant of new Set([t, stripDiacritics(t)])) {
      const re = new RegExp(`(?<![${LETTER}])${escapeRe(variant)}(?![${LETTER}])`, 'gu');
      out = out.replace(re, () => { count++; return '{{user}}'; });
    }
  }

  // Dọn hệ quả văn phong sau khi thay: "của {{user}}" thì giữ, nhưng "{{user}} {{user}}" (tên đầy
  // đủ + biệt danh đứng cạnh nhau) thì gộp lại một.
  out = out.replace(/(\{\{user\}\})(\s*\1)+/g, '$1');
  return { text: out, count };
}

export interface StoryCardLike {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  worldEntries: Array<{ keys: string[]; content: string }>;
  raw?: string;
}

export interface CardSwapReport {
  /** Tổng số lần thay trên toàn thẻ. */
  count: number;
  /** Trường nào còn sót tên (để bắt AI viết lại đúng chỗ đó). */
  leftovers: string[];
}

/**
 * Áp swap lên TOÀN BỘ thẻ vừa sinh (kể cả keys của lore entry — người chơi gõ tên đó thì entry
 * cũng phải bật, mà tên đó giờ là {{user}} nên key theo tên cũ chỉ tổ nhiễu).
 */
export function applyUserPersonaSwap<T extends StoryCardLike>(
  card: T,
  userName: string,
  aliases: string[] = [],
): { card: T; report: CardSwapReport } {
  if (!userName?.trim()) return { card, report: { count: 0, leftovers: [] } };

  let count = 0;
  const swap = (s: string) => {
    const r = swapNameToUser(s || '', userName, aliases);
    count += r.count;
    return r.text;
  };

  const next: T = {
    ...card,
    description: swap(card.description),
    personality: swap(card.personality),
    scenario: swap(card.scenario),
    firstMes: swap(card.firstMes),
    worldEntries: (card.worldEntries || []).map(e => ({
      keys: (e.keys || [])
        .map(k => swapNameToUser(k, userName, aliases).text)
        // Key thành đúng "{{user}}" thì vô nghĩa (macro không phải từ khoá người chơi gõ) — bỏ.
        .filter(k => k.trim() && k.trim() !== '{{user}}'),
      content: swap(e.content),
    })),
  };

  // TÊN THẺ thì KHÔNG thay: thẻ là của nhân vật khác, tên nó không thể là {{user}}. Nếu tên thẻ
  // trùng người chơi thì đó là mâu thuẫn cấu hình — báo ra ngoài để UI chặn, chứ không tự sửa.
  const leftovers: string[] = [];
  const stillThere = (label: string, s: string) => {
    if (swapNameToUser(s || '', userName, aliases).count > 0) leftovers.push(label);
  };
  stillThere('Mô tả', next.description);
  stillThere('Tính cách', next.personality);
  stillThere('Bối cảnh', next.scenario);
  stillThere('Lời mở đầu', next.firstMes);

  return { card: next, report: { count, leftovers } };
}

/**
 * Nhân vật mục tiêu của thẻ có TRÙNG người được gán làm {{user}} không?
 * Trùng = mâu thuẫn: không thể làm thẻ nhân vật cho chính người chơi (thẻ sẽ tự nói chuyện với
 * chính mình). Đây đúng là tình huống trong bằng chứng bug 105.
 */
export function isSameAsUserPersona(targetName: string, userName: string, aliases: string[] = []): boolean {
  const norm = (s: string) => stripDiacritics((s || '').trim().toLowerCase());
  const t = norm(targetName);
  if (!t || !norm(userName)) return false;
  return [userName, ...aliases].some(a => norm(a) === t);
}
