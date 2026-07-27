/**
 * src/presetTranslate/presetLabelSync.ts — ĐỒNG BỘ NHÃN VĂN BẢN GIỮA PROMPT VÀ REGEX CỦA PRESET.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 27/07 — việc 118) Preset dạy AI xuất theo khuôn có NHÃN:
 *     {{setvar::options_fmt::<options>
 *     >选项一：{hành động...}
 *     >选项二：{...}}}
 * và có regex bám đúng nhãn đó để làm đẹp:
 *     <options>\s*?>选项一：\s*([^>]+?)\s*?>选项二：...
 *
 * Pipeline dịch prompt → "Lựa chọn 1:", nhưng regex pass chỉ biết thay TAG/VAR theo từ điển;
 * nhãn văn bản không phải tag nên `decideRegex` trả 'manual' và bỏ qua NGUYÊN script. Kết quả
 * đúng như user báo: AI xuất "Lựa chọn 1:" mà regex vẫn rình "选项一：" — không bao giờ khớp.
 *
 * Nguồn ánh xạ đáng tin nhất là CHÍNH cặp prompt trước/sau dịch (ghép theo identifier).
 * Không đoán, không gọi AI.
 *
 * ═══ (bug 124) VÌ SAO LẦN 118 CHƯA DỨT ĐIỂM ═══
 * User báo lại "vẫn còn lỗi". Đo trên preset thật trong repo (三人逆行 v11 ↔ bản dịch,
 * 253 prompt / 36 regex) ra hai lỗ đúng chỗ:
 *
 *   1. GHÉP "TẤT CẢ HOẶC KHÔNG" LÀM MẤT 42% DỮ LIỆU. Bản cũ đòi số nhãn hai bên BẰNG NHAU,
 *      lệch một cái là bỏ nguyên prompt. Đo thật: 89/213 cặp prompt bị bỏ vì lý do này —
 *      chỉ cần bản dịch thêm/bớt đúng một dấu hai chấm ở đâu đó là toàn bộ nhãn còn lại
 *      của prompt đó mất trắng. Nay thay bằng NEO: những nhãn giống hệt nhau hai bên
 *      (số, ký hiệu, chữ chưa dịch) làm mốc; chỉ các đoạn GIỮA hai mốc mới phải bằng nhau
 *      mới ghép. Lệch ở một đoạn thì chỉ mất đoạn đó, phần còn lại vẫn học được.
 *
 *   2. CHỈ HỌC NHÃN DẠNG "NHÃN:", MÙ VỚI THẺ GIẢ. Preset thật bọc khối bằng thẻ tự chế
 *      (<状态面板>…</状态面板>, <诗词意境>…) và regex bám đúng tên thẻ đó. Đo thật: 22 tên thẻ
 *      chứa chữ Hán trong prompt gốc, 3/36 regex bám vào chúng — cơ chế cũ không có đường
 *      nào học được vì chúng không kết thúc bằng dấu hai chấm. Ảnh user gửi ở bug 124 cũng
 *      là ca này: nhãn nằm trong <summary>…</summary> của khối <details>.
 *
 * Nay bóc ba LOẠI nhãn (dòng có dấu hai chấm / tên thẻ giả / chữ trong thẻ inline), căn theo
 * neo riêng cho từng loại, rồi gộp thành một bảng.
 */

const HAN_RE = /[一-鿿㐀-䶿]/;

export interface PromptLike {
  identifier?: string;
  content?: string;
}

/** Loại nhãn — quyết định chuỗi nào được đem đi thay trong regex. */
export type LabelKind = 'line' | 'tag' | 'inline';

export interface LabelToken {
  kind: LabelKind;
  /** Phần chữ nghĩa dùng để so khớp/đối chiếu hai bên. */
  label: string;
  /** Chuỗi THẬT đem đi thay (nhãn dòng gồm cả dấu hai chấm, thẻ/inline thì chỉ tên). */
  unit: string;
}

/**
 * Trích các NHÃN ĐẦU DÒNG dạng `>NHÃN：` / `NHÃN:` theo thứ tự xuất hiện.
 * Nhãn = chuỗi ngắn (≤30 ký tự) đứng đầu dòng (cho phép `>`/`-`/`•`/số thứ tự đằng trước),
 * kết thúc bằng dấu hai chấm (cả ： fullwidth lẫn : thường).
 */
export function extractLineLabels(text: string): string[] {
  return extractLineLabelTokens(text).map(t => t.label);
}

/**
 * Như trên nhưng giữ cả DẤU HAI CHẤM đi kèm. Chi tiết này ăn tiền: preset gốc dùng `：`
 * fullwidth (>选项一：) còn bản dịch dùng `:` thường (>Lựa chọn 1: ) — chỉ thay nhãn mà giữ
 * dấu cũ thì regex thành ">Lựa chọn 1：" vẫn trượt đầu ra thật của AI. Test trên dữ liệu
 * bug/118 bắt được đúng ca này.
 */
export function extractLineLabelTokens(text: string): Array<{ label: string; colon: string }> {
  const out: Array<{ label: string; colon: string }> = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[>\-•*]?\s*([^：:{}<>\n]{1,30}?)\s*([：:])/);
    if (!m) continue;
    const label = m[1].trim();
    if (!label) continue;
    // Loại nhiễu: macro/cú pháp ({{setvar, http...) — nhãn thật là chữ nghĩa thuần.
    if (/[{}\\/=]|^https?$/i.test(label)) continue;
    out.push({ label, colon: m[2] });
  }
  return out;
}

/** Thẻ HTML thật — tên thẻ của chúng KHÔNG phải nhãn do preset đặt, đừng đụng vào. */
const REAL_HTML_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr', 'b', 'i', 'u', 'em', 'strong', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'img', 'pre', 'code',
  'details', 'summary', 'style', 'script', 'font', 'center', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'options', 'thinking', 'think',
]);

/**
 * Trích TÊN THẺ GIẢ do preset tự chế: `<状态面板>`, `</诗词意境>`.
 * Bỏ thẻ HTML thật, bỏ comment `<!-- ... -->`, bỏ thẻ có thuộc tính (đó là HTML thật).
 * Mỗi tên chỉ lấy MỘT lần theo lần xuất hiện đầu (thẻ mở và thẻ đóng là cùng một nhãn).
 */
export function extractTagNames(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<\/?\s*([^<>/\s!][^<>]{0,28}?)\s*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const name = m[1].trim();
    if (!name) continue;
    if (REAL_HTML_TAGS.has(name.toLowerCase())) continue;
    if (/[{}="'\\/]/.test(name)) continue;       // có thuộc tính hoặc macro → không phải nhãn
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Thẻ inline mà phần chữ bên trong là NHÃN người đọc nhìn thấy (ảnh bug 124: <summary>). */
const INLINE_LABEL_TAGS = 'summary|b|strong|h1|h2|h3|h4|h5|h6|legend|th';

/**
 * Trích chữ hiển thị bên trong thẻ inline: `<summary>🌙 Lời thì thầm của Erii</summary>`.
 * Chỉ nhận chuỗi ngắn, không chứa thẻ con — nhãn thật thì ngắn, đoạn văn thì không phải nhãn.
 */
export function extractInlineLabels(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:${INLINE_LABEL_TAGS})\\b[^>]*>([^<>{}]{1,40})</(?:${INLINE_LABEL_TAGS})>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const label = m[1].trim();
    if (label) out.push(label);
  }
  return out;
}

/** Gom cả ba loại nhãn của một prompt, giữ thứ tự trong từng loại. */
export function extractAllLabelTokens(text: string): LabelToken[] {
  const out: LabelToken[] = [];
  for (const t of extractLineLabelTokens(text)) {
    out.push({ kind: 'line', label: t.label, unit: t.label + t.colon });
  }
  // Nhãn 1 ký tự bị loại: thẻ/inline thay TRẦN (không có dấu hai chấm làm mốc) nên một chữ Hán
  // đơn rất dễ ăn nhầm vào giữa từ khác trong HTML. Thà bỏ sót còn hơn thay bậy.
  for (const name of extractTagNames(text)) {
    if (name.length >= 2) out.push({ kind: 'tag', label: name, unit: name });
  }
  for (const label of extractInlineLabels(text)) {
    if (label.length >= 2) out.push({ kind: 'inline', label, unit: label });
  }
  return out;
}

/** So khớp "hai nhãn coi như giống nhau" khi tìm neo. */
function sameLabel(a: string, b: string): boolean {
  return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

/**
 * Ghép hai danh sách nhãn cùng loại thành các cặp (gốc → dịch).
 *
 * Bản cũ đòi hai bên bằng số lượng, lệch là bỏ cả prompt — mất 42% dữ liệu đo trên preset thật.
 * Nay dùng LCS lấy các nhãn GIỐNG HỆT hai bên làm NEO (số thứ tự, ký hiệu, chữ chưa dịch),
 * rồi chỉ ghép 1-1 trong từng đoạn giữa hai neo và chỉ khi đoạn đó cân số lượng. Lệch ở một
 * đoạn thì mất mỗi đoạn ấy — vẫn thận trọng, nhưng không còn ném đi phần đúng.
 */
export function alignTokens<T extends { label: string }>(zs: T[], vs: T[]): Array<[T, T]> {
  const n = zs.length, m = vs.length;
  if (n === 0 || m === 0) return [];

  // LCS theo quy hoạch động (danh sách nhãn của một prompt rất ngắn, chi phí không đáng kể).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = sameLabel(zs[i].label, vs[j].label)
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs: Array<[T, T]> = [];
  let i = 0, j = 0, zStart = 0, vStart = 0;

  // Mỗi khi gặp neo, đoạn tích luỹ phía trước là một "khối cần dịch" — ghép nếu cân.
  const flush = (zEnd: number, vEnd: number) => {
    const zLen = zEnd - zStart, vLen = vEnd - vStart;
    if (zLen > 0 && zLen === vLen) {
      for (let k = 0; k < zLen; k++) pairs.push([zs[zStart + k], vs[vStart + k]]);
    }
  };

  while (i < n && j < m) {
    if (sameLabel(zs[i].label, vs[j].label)) {
      flush(i, j);
      i++; j++;
      zStart = i; vStart = j;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  flush(n, m);
  return pairs;
}

/**
 * Dựng bảng "nhãn gốc → nhãn đã dịch" từ hai danh sách prompt (trước / sau dịch).
 * Ghép prompt theo identifier; trong từng cặp, căn nhãn theo neo (xem alignTokens).
 * Chỉ nhận nhãn gốc CÓ chữ Hán (thứ cần dịch) và bản dịch KHÔNG còn chữ Hán (đã dịch thật).
 * Nhiều prompt bất đồng → bản gặp nhiều nhất thắng.
 */
export function buildLabelMap(
  pristinePrompts: PromptLike[] | undefined,
  translatedPrompts: PromptLike[] | undefined,
): Record<string, string> {
  const votes = new Map<string, Map<string, number>>();
  const byId = new Map<string, PromptLike>();
  for (const p of translatedPrompts || []) {
    if (p?.identifier) byId.set(String(p.identifier), p);
  }

  const KINDS: LabelKind[] = ['line', 'tag', 'inline'];

  for (const zp of pristinePrompts || []) {
    if (!zp?.identifier || !zp.content) continue;
    const vp = byId.get(String(zp.identifier));
    if (!vp?.content || vp.content === zp.content) continue;

    const zAll = extractAllLabelTokens(zp.content);
    const vAll = extractAllLabelTokens(String(vp.content));

    // Căn riêng từng loại: nhãn dòng và tên thẻ có thứ tự độc lập nhau.
    for (const kind of KINDS) {
      const pairs = alignTokens(
        zAll.filter(t => t.kind === kind),
        vAll.filter(t => t.kind === kind),
      );
      for (const [z, v] of pairs) {
        const from = z.unit, to = v.unit;
        if (from === to) continue;
        if (!HAN_RE.test(z.label)) continue;  // nhãn gốc phải là thứ cần dịch
        if (HAN_RE.test(v.label)) continue;   // bản dịch còn chữ Hán = chưa dịch xong, đừng học
        if (!to.trim()) continue;
        if (!votes.has(from)) votes.set(from, new Map());
        const inner = votes.get(from)!;
        inner.set(to, (inner.get(to) || 0) + 1);
      }
    }
  }

  const map: Record<string, string> = {};
  for (const [from, inner] of votes) {
    let best = '', bestN = 0;
    for (const [to, n] of [...inner].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (n > bestN) { best = to; bestN = n; }
    }
    if (best) map[from] = best;
  }
  return map;
}

/** Escape một chuỗi chữ nghĩa để nhét an toàn vào THÂN regex. */
function escapeForRegexBody(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface LabelApplyResult {
  text: string;
  changed: boolean;
  /** true = đổi xong regex không compile được nên đã hoàn nguyên. */
  reverted: boolean;
  applied: string[];
}

/**
 * Áp bảng nhãn lên MỘT findRegex: thay nhãn gốc (chữ nghĩa thuần trong body) bằng bản dịch
 * ĐÃ ESCAPE. Đổi xong compile thử — fail thì hoàn nguyên, thà giữ regex cũ còn hơn phá nó.
 */
export function applyLabelMapToRegex(findRegex: string, map: Record<string, string>): LabelApplyResult {
  const src = String(findRegex || '');
  if (!src) return { text: src, changed: false, reverted: false, applied: [] };
  let out = src;
  const applied: string[] = [];
  // Nhãn dài thay trước để "选项一" không ăn mất một phần "选项一十".
  for (const from of Object.keys(map).sort((a, b) => b.length - a.length)) {
    if (!out.includes(from)) continue;
    out = out.split(from).join(escapeForRegexBody(map[from]));
    applied.push(from);
  }
  if (out === src) return { text: src, changed: false, reverted: false, applied: [] };

  // Compile check — tôn trọng vỏ /.../flags của SillyTavern.
  const m = out.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  try {
    if (m) void new RegExp(m[1], m[2]);
    else void new RegExp(out);
  } catch {
    return { text: src, changed: false, reverted: true, applied: [] };
  }
  return { text: out, changed: true, reverted: false, applied };
}

/** Áp bảng nhãn lên văn bản thường (replaceString/HTML) — thay trần, dài trước. */
export function applyLabelMapToText(text: string, map: Record<string, string>): { text: string; changed: boolean } {
  const src = String(text || '');
  let out = src;
  for (const from of Object.keys(map).sort((a, b) => b.length - a.length)) {
    if (!out.includes(from)) continue;
    out = out.split(from).join(map[from]);
  }
  return { text: out, changed: out !== src };
}
