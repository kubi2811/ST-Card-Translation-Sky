/**
 * src/utils/macroGuard.ts — (bugNeedFix/180) MACRO {{…}} PHẢI VỀ NGUYÊN VẸN.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Lỗi {{user}} bị dịch thành chữ tiếng Trung gì đó — tất cả entry có chữ {{user}} không
 * dịch lại thành {{user}} như lúc ban đầu mà thành {{tiếng Trung}} gì đó."
 * Bằng chứng: 尚未认识{{user}}。 → chưa quen biết{{基础信息}}.  (lặp ở lorebook 33, 53, 56…)
 *
 * VÌ SAO LỌT: macro là thứ SillyTavern khớp NGUYÊN VĂN lúc chạy — {{user}} sai một chữ là thẻ
 * hiện ra chữ thừa thay vì tên người chơi. Nhưng trong toàn tuyến dịch, không có lớp nào GIỮ nó:
 *   • bộ dịch phẫu thuật (surgical) chỉ đụng cụm chữ Hán — {{user}} là ASCII nên nó không quản;
 *   • pass "macro covariance" của MVU chỉ khớp dạng {{getvar::KEY}}, không khớp {{user}} trần;
 *   • prompt CÓ dặn "giữ nguyên placeholder", nhưng dặn là dặn — model vẫn đổi, và đổi im lặng.
 * Nghĩa là chỗ này chỉ dựa vào lời dặn. Với thứ hỏng-là-hỏng-hẳn như macro thì phải có chốt máy.
 *
 * NGUYÊN TẮC Ở ĐÂY: bản dịch KHÔNG được phép đổi RUỘT của macro. Ghép cặp macro theo THỨ TỰ
 * xuất hiện; cặp nào lệch tên thì trả lại đúng tên gốc. Chỉ sửa khi ghép cặp CHẮC CHẮN (số macro
 * hai bên bằng nhau) — lệch số thì KHÔNG đoán, chỉ báo, vì đoán sai còn tệ hơn.
 */

/** Một macro tìm thấy trong văn bản. */
export interface FoundMacro {
  /** Nguyên văn kể cả hai cặp ngoặc, vd "{{user}}". */
  raw: string;
  /** Ruột bên trong, vd "user" hoặc "getvar::好感度". */
  inner: string;
  start: number;
  end: number;
}

/** Macro rỗng/quá dài thì không phải macro thật — bỏ qua cho khỏi bắt nhầm CSS `{{…}}` của code. */
const MACRO_RE = /\{\{([^{}\r\n]{1,120})\}\}/g;

export function findMacros(text: string): FoundMacro[] {
  const out: FoundMacro[] = [];
  if (!text) return out;
  for (const m of text.matchAll(MACRO_RE)) {
    out.push({ raw: m[0], inner: m[1], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/**
 * Macro CHUẨN của SillyTavern — ruột của chúng là từ khoá cố định, dịch là hỏng, không có ngoại lệ.
 * (Danh sách bám theo macro dựng sẵn của ST; macro do thẻ tự đặt không nằm ở đây và được xử theo
 * luật chung bên dưới.)
 */
export const STANDARD_MACROS = new Set([
  'user', 'char', 'persona', 'description', 'personality', 'scenario', 'system', 'original',
  'time', 'date', 'weekday', 'isotime', 'isodate', 'time_UTC', 'idle_duration',
  'random', 'roll', 'pick', 'input', 'lastMessage', 'lastUserMessage', 'lastCharMessage',
  'newline', 'trim', 'noop', 'model', 'group', 'groupNotMuted', 'mesExamples',
  'charPrompt', 'charJailbreak', 'charVersion', 'char_version', 'maxPrompt',
]);

/** So tên macro bỏ qua hoa/thường: ST chấp nhận {{User}} lẫn {{user}}. */
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Ruột macro này có phải thứ TUYỆT ĐỐI không được dịch không?
 *  • macro chuẩn của ST (user/char/…);
 *  • hoặc ruột thuần ASCII (tên máy đọc — kể cả macro riêng của thẻ như {{getvar::x}}, {{roll:d6}}).
 * Ruột có chữ Hán/Việt là nhãn do tác giả thẻ tự đặt bằng ngôn ngữ tự nhiên — cái đó DỊCH ĐƯỢC,
 * nên không đụng vào, tránh "sửa" mất công dịch đúng của người ta.
 */
export function isProtectedMacro(inner: string): boolean {
  const body = inner.trim();
  if (STANDARD_MACROS.has(norm(body))) return true;
  return /^[\x20-\x7E]+$/.test(body);
}

export interface MacroFix {
  /** Ruột SAI mà bản dịch đang dùng. */
  wrong: string;
  /** Ruột ĐÚNG lấy từ bản gốc. */
  right: string;
}

export interface MacroGuardResult {
  text: string;
  fixes: MacroFix[];
  /** Không ghép cặp chắc chắn được (lệch số macro) — chỉ báo, không tự sửa. */
  unresolved: string[];
}

/**
 * Trả macro về đúng nguyên văn của bản gốc.
 *
 * Ghép cặp theo THỨ TỰ XUẤT HIỆN — bản dịch giữ nguyên trình tự câu nên macro thứ i của bản dịch
 * ứng với macro thứ i của bản gốc. Chỉ sửa khi:
 *   1. hai bên CÙNG số macro (ghép cặp không mơ hồ), và
 *   2. macro gốc thuộc diện phải giữ nguyên (isProtectedMacro), và
 *   3. ruột thật sự khác nhau (khác mỗi hoa/thường thì cũng chuẩn hoá về bản gốc — ST khớp
 *      không phân biệt hoa thường, nhưng để y bản gốc thì người đọc đỡ hoang mang).
 */
export function restoreMacros(original: string, translated: string): MacroGuardResult {
  const fixes: MacroFix[] = [];
  const unresolved: string[] = [];
  if (!original || !translated) return { text: translated, fixes, unresolved };

  const src = findMacros(original);
  const dst = findMacros(translated);
  if (src.length === 0 || dst.length === 0) return { text: translated, fixes, unresolved };

  if (src.length !== dst.length) {
    // Lệch số macro ⇒ ghép cặp theo thứ tự là đoán mò, mà đoán sai còn tệ hơn để nguyên.
    // Nhưng vẫn phải NÓI RA: liệt kê macro BẮT BUỘC GIỮ ở bản gốc mà bản dịch không còn —
    // đó chính là thứ sẽ hỏng lúc chơi, và user cần biết để sửa tay.
    const dstNames = new Set(dst.map(m => norm(m.inner)));
    for (const s of src) {
      if (isProtectedMacro(s.inner) && !dstNames.has(norm(s.inner))) unresolved.push(s.raw);
    }
    return { text: translated, fixes, unresolved };
  }

  // Dựng lại chuỗi bằng cách ghép các đoạn — an toàn hơn replace() vì không có chuyện thay nhầm
  // một macro giống hệt ở chỗ khác.
  let out = '';
  let cursor = 0;
  for (let i = 0; i < dst.length; i++) {
    const d = dst[i];
    const s = src[i];
    out += translated.slice(cursor, d.start);
    if (s.inner !== d.inner && isProtectedMacro(s.inner)) {
      out += s.raw;
      fixes.push({ wrong: d.inner, right: s.inner });
    } else {
      out += d.raw;
    }
    cursor = d.end;
  }
  out += translated.slice(cursor);

  return { text: out, fixes, unresolved };
}

/**
 * (bugNeedFix/180) Macro KHÔNG được lọt vào từ điển/glossary.
 * ─────────────────────────────────────────────────────────────────────────────
 * Từ điển được bơm thẳng vào prompt dưới dạng "nguồn → đích" và model làm theo rất ngoan. Chỉ cần
 * MỘT mục rác dính macro (dù do quét tự động hay do user lỡ dán vào) là model đổi macro đó ở MỌI
 * entry — đúng cảnh "tất cả entry có {{user}}" mà user gặp. Chặn ngay từ cửa vào rẻ hơn nhiều so
 * với đi vá hậu quả ở từng entry.
 */
export function isMacroPollutedTerm(term: string): boolean {
  const t = String(term ?? '').trim();
  if (!t) return false;
  if (/\{\{|\}\}/.test(t)) return true;                 // dính ngoặc macro
  return STANDARD_MACROS.has(norm(t));                  // trần trụi đúng tên macro chuẩn
}

/** Lọc mọi cặp có dính macro ra khỏi một bảng nguồn→đích. Trả kèm danh sách đã loại để báo. */
export function stripMacroTermsFromDict<T extends Record<string, string>>(
  dict: T,
): { clean: Record<string, string>; removed: string[] } {
  const clean: Record<string, string> = {};
  const removed: string[] = [];
  for (const [k, v] of Object.entries(dict || {})) {
    if (isMacroPollutedTerm(k) || isMacroPollutedTerm(v)) { removed.push(`${k} → ${v}`); continue; }
    clean[k] = v;
  }
  return { clean, removed };
}
