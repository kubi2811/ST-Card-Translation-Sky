/**
 * src/utils/formatTagSync.ts — GIỮ MỐC ĐỊNH DẠNG GIỮA findRegex VÀ NỘI DUNG THẺ.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 23/07 — việc 83) Nhiều thẻ bắt AI xuất ra theo một khuôn cố định:
 *     <hồ sơ nhân vật>
 *     (cấu trúc yaml)
 *     </hồ sơ nhân vật>
 * rồi có regex bám đúng cái mốc đó để làm đẹp. Mốc này xuất hiện ở HAI NƠI:
 *   - trong VĂN BẢN của thẻ (chỗ dạy AI phải xuất ra như vậy), và
 *   - trong `findRegex` của script làm đẹp.
 *
 * Hai nơi đó được dịch bởi HAI lượt gọi AI khác nhau, ngữ cảnh khác nhau → ra hai chữ khác
 * nhau là chuyện thường. Regex hết khớp, phần làm đẹp im lặng không chạy. Loại thẻ này thường
 * KHÔNG phải MVU/EJS nên hai chiến lược B và C đều tắt — không có bộ nào canh giúp, user chỉ
 * phát hiện sau khi dịch xong rồi phải sửa tay cho khớp lại.
 *
 * ─── TÍN HIỆU ĐÁNG TIN ───
 * "Mốc trong findRegex không có trong văn bản thẻ" là tín hiệu SAI: rất nhiều mốc hợp lệ vốn
 * không nằm trong thẻ (`<StatusPlaceHolderImpl/>` do MVU chèn lúc chạy; `<thinking>`,
 * `<UpdateVariable>` do preset/model tự sinh). Đo thử trên 9 thẻ mẫu thì kiểu bắt đó báo oan
 * tới 19/19 script ở một thẻ.
 *
 * Nên bộ này so BẢN GỐC với BẢN DỊCH — thứ mà app dịch luôn có sẵn cả hai:
 *   1. Lấy mốc trong findRegex GỐC, chỉ giữ mốc nào CŨNG có trong văn bản GỐC.
 *      (Đó là bằng chứng chính thẻ này dạy AI xuất ra mốc đó — lọc sạch nhiễu.)
 *   2. Xem văn bản đã dịch gọi mốc đó là gì, và findRegex đã dịch gọi nó là gì.
 *   3. Hai bên khác nhau ⇒ LỖI. Lấy bản trong VĂN BẢN làm chuẩn, vì AI viết theo lời dặn
 *      trong văn bản chứ không đọc regex.
 * Cách này không báo oan: mốc nào không đổi ở cả hai bên thì không sinh ra việc gì.
 */

/** Hình dạng mốc — chỉ ghép mốc cùng hình dạng với nhau khi dóng hàng. */
export type TagShape = 'angle' | 'square' | 'cjk';

export interface FormatTag {
  /** Tên bên trong mốc, vd `hồ sơ nhân vật`. */
  name: string;
  shape: TagShape;
}

export interface TagMismatch {
  /** Field của script regex bị lệch. */
  path: string;
  label: string;
  /** Mốc ở bản gốc. */
  original: string;
  /** findRegex sau khi dịch đang bám mốc nào. */
  inRegex: string;
  /** Văn bản sau khi dịch thực sự dùng mốc nào — đây mới là thứ AI xuất ra. */
  inText: string;
  /** findRegex đã sửa để bám đúng văn bản. */
  fixedFindRegex: string;
}

/* ────────────────────────── BÓC MỐC ────────────────────────── */

/** Ký tự/cụm là cú pháp regex chứ không phải chữ nghĩa — thấy là loại. */
const REGEX_NOISE = /[\\^$|?*+(){}]|\[|\]/;

function pushTag(out: FormatTag[], seen: Set<string>, name: string, shape: TagShape) {
  const n = name.trim();
  if (n.length < 2 || n.length > 60) return;
  if (REGEX_NOISE.test(n)) return;          // `\s\S`, `\1`, `(a|b)`… không phải mốc
  if (/^\d+$/.test(n)) return;              // số thuần
  const key = `${shape}::${n}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ name: n, shape });
}

/**
 * Bóc mốc từ một chuỗi bất kỳ (văn bản thẻ hoặc thân regex).
 * Giữ THỨ TỰ xuất hiện lần đầu — dóng hàng gốc↔dịch dựa vào thứ tự này.
 */
export function extractFormatTags(text: string): FormatTag[] {
  const out: FormatTag[] = [];
  const seen = new Set<string>();
  const s = String(text || '');

  // <tên>, </tên>, <tên/>
  for (const m of s.matchAll(/<\/?\s*([^<>\/\r\n]{2,60}?)\s*\/?>/g)) pushTag(out, seen, m[1], 'angle');
  // 【tên】「tên」『tên』《tên》
  for (const m of s.matchAll(/[【「『《]\s*([^【】「」『』《》\r\n]{2,60}?)\s*[】」』》]/g)) pushTag(out, seen, m[1], 'cjk');
  // [tên] — dễ đụng cú pháp regex nhất nên lọc kỹ ở pushTag
  for (const m of s.matchAll(/\[\s*([^\[\]\r\n]{2,60}?)\s*\]/g)) pushTag(out, seen, m[1], 'square');

  return out;
}

/** Bỏ vỏ `/.../flags` và bỏ dấu escape để đọc được phần chữ nghĩa bên trong regex. */
export function unwrapRegexBody(findRegex: string): string {
  let s = String(findRegex || '');
  const m = s.match(/^\/([\s\S]*)\/([gimsuyd]*)$/);
  if (m) s = m[1];
  return s.replace(/\\([[\]().*+?^$|/\\{}])/g, '$1');
}

/** Mốc nằm trong một findRegex. */
export function extractRegexTags(findRegex: string): FormatTag[] {
  return extractFormatTags(unwrapRegexBody(findRegex));
}

/* ────────────────────────── DÓNG HÀNG GỐC ↔ DỊCH ────────────────────────── */

const keyOf = (t: FormatTag) => `${t.shape}::${t.name}`;

/**
 * Dóng mốc bản gốc với mốc bản dịch trong CÙNG một field, theo thứ tự xuất hiện và cùng hình dạng.
 * Chỉ ghép khi hai bên có SỐ LƯỢNG mốc bằng nhau trong cùng hình dạng — lệch số lượng nghĩa là
 * AI đã thêm/bớt mốc, ghép bừa lúc đó sẽ ra ánh xạ sai còn tệ hơn không ghép.
 */
export function alignTags(
  originalText: string,
  translatedText: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const o = extractFormatTags(originalText);
  const t = extractFormatTags(translatedText);

  for (const shape of ['angle', 'cjk', 'square'] as TagShape[]) {
    const os = o.filter(x => x.shape === shape);
    const ts = t.filter(x => x.shape === shape);
    if (os.length === 0 || os.length !== ts.length) continue;
    for (let i = 0; i < os.length; i++) {
      if (os[i].name === ts[i].name) continue;   // không đổi thì chẳng có gì để ghi
      map.set(keyOf(os[i]), ts[i].name);
    }
  }
  return map;
}

export interface FieldPair {
  path: string;
  label: string;
  group: string;
  status: string;
  original: string;
  translated?: string;
}

/** Nhóm field được coi là VĂN BẢN dạy AI xuất định dạng. */
const TEXT_GROUPS = new Set(['core', 'lorebook', 'creator', 'messages', 'greetings']);

/**
 * Bảng "mốc gốc → mốc mà VĂN BẢN đã dịch đang dùng", gộp từ mọi field văn bản.
 * Mốc nào ra nhiều bản dịch khác nhau ở các field khác nhau thì lấy bản PHỔ BIẾN NHẤT —
 * đó là bản AI sẽ xuất ra nhiều nhất, và cũng là bản đáng để regex bám vào.
 */
export function buildTextTagMap(fields: FieldPair[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();

  for (const f of fields || []) {
    if (f.status !== 'done' || typeof f.translated !== 'string' || !f.translated) continue;
    if (f.group === 'regex') continue;                      // regex không phải "văn bản dạy AI"
    if (!TEXT_GROUPS.has(f.group) && f.group !== 'tavern_helper') continue;
    for (const [k, v] of alignTags(f.original || '', f.translated)) {
      if (!votes.has(k)) votes.set(k, new Map());
      const inner = votes.get(k)!;
      inner.set(v, (inner.get(v) || 0) + 1);
    }
  }

  const map = new Map<string, string>();
  for (const [k, inner] of votes) {
    let best = '', bestN = 0;
    for (const [v, n] of [...inner].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (n > bestN) { best = v; bestN = n; }
    }
    if (best) map.set(k, best);
  }
  return map;
}

/** Mốc nào THỰC SỰ có trong văn bản GỐC — bằng chứng chính thẻ này dạy AI xuất ra nó. */
export function collectAnchoredTags(fields: FieldPair[]): Set<string> {
  const out = new Set<string>();
  for (const f of fields || []) {
    if (f.group === 'regex') continue;
    if (!TEXT_GROUPS.has(f.group) && f.group !== 'tavern_helper') continue;
    for (const t of extractFormatTags(f.original || '')) out.add(keyOf(t));
  }
  return out;
}

/* ────────────────────────── SOI & VÁ ────────────────────────── */

/** Thay tên mốc bên trong findRegex, giữ nguyên vỏ regex và dấu escape xung quanh. */
export function replaceTagInRegex(findRegex: string, from: string, to: string): string {
  if (!from || from === to) return findRegex;
  // Thay mọi lần xuất hiện của đúng chuỗi tên đó. Tên mốc là chữ nghĩa (đã lọc hết ký tự
  // cú pháp regex ở pushTag) nên thay thẳng không đụng vào cấu trúc regex.
  return String(findRegex || '').split(from).join(to);
}

/**
 * Soi những script regex bám mốc KHÁC với mốc mà văn bản đã dịch đang dùng.
 * Chỉ xét mốc có neo trong văn bản gốc ⇒ không báo oan cho `<StatusPlaceHolderImpl/>`,
 * `<UpdateVariable>`, `<thinking>`… những thứ vốn không nằm trong thẻ.
 */
export function findFormatTagMismatches(fields: FieldPair[]): TagMismatch[] {
  const textMap = buildTextTagMap(fields);
  if (textMap.size === 0) return [];
  const anchored = collectAnchoredTags(fields);
  const out: TagMismatch[] = [];

  for (const f of fields || []) {
    if (f.group !== 'regex') continue;
    if (!f.path.includes('findRegex')) continue;
    if (f.status !== 'done' || typeof f.translated !== 'string' || !f.translated) continue;

    const origTags = extractRegexTags(f.original || '');
    const transTags = extractRegexTags(f.translated);
    if (origTags.length === 0) continue;

    for (let i = 0; i < origTags.length; i++) {
      const ot = origTags[i];
      const k = keyOf(ot);
      if (!anchored.has(k)) continue;              // mốc không do thẻ dạy ra ⇒ không phải việc ở đây
      const wantedByText = textMap.get(k);
      if (!wantedByText) continue;                 // văn bản không đổi mốc này ⇒ regex cũng nên giữ nguyên

      // findRegex đang bám gì? Dóng theo thứ tự + cùng hình dạng.
      const sameShapeOrig = origTags.filter(x => x.shape === ot.shape);
      const sameShapeTrans = transTags.filter(x => x.shape === ot.shape);
      const idx = sameShapeOrig.findIndex(x => x.name === ot.name);
      const usedByRegex = (sameShapeOrig.length === sameShapeTrans.length && idx >= 0)
        ? sameShapeTrans[idx].name
        : ot.name;                                  // không dóng được ⇒ coi như chưa đổi

      if (usedByRegex === wantedByText) continue;   // đã khớp, không có việc gì

      out.push({
        path: f.path,
        label: f.label,
        original: ot.name,
        inRegex: usedByRegex,
        inText: wantedByText,
        fixedFindRegex: replaceTagInRegex(f.translated, usedByRegex, wantedByText),
      });
    }
  }
  return out;
}

/**
 * Vá: ép findRegex bám đúng mốc mà văn bản đã dịch dùng.
 * VĂN BẢN thắng vì AI viết theo lời dặn trong văn bản, nó không đọc regex.
 */
export function enforceFormatTagSync(fields: FieldPair[]): {
  fixes: { path: string; label: string; from: string; to: string; findRegex: string }[];
} {
  const mismatches = findFormatTagMismatches(fields);
  const byPath = new Map<string, { path: string; label: string; from: string; to: string; findRegex: string }>();

  for (const m of mismatches) {
    // Một findRegex có thể lệch nhiều mốc → dồn các lần thay vào cùng một chuỗi.
    const prev = byPath.get(m.path);
    const base = prev ? prev.findRegex : m.fixedFindRegex;
    byPath.set(m.path, {
      path: m.path,
      label: m.label,
      from: m.inRegex,
      to: m.inText,
      findRegex: prev ? replaceTagInRegex(base, m.inRegex, m.inText) : base,
    });
  }
  return { fixes: [...byPath.values()] };
}

/**
 * Khối luật bơm vào prompt khi dịch field regex: liệt kê mốc mà VĂN BẢN đã dịch đang dùng,
 * để AI dịch findRegex theo đúng chữ đó ngay từ đầu thay vì để bước vá dọn sau.
 */
export function buildFormatTagPromptBlock(textMap: Map<string, string>): string {
  if (!textMap || textMap.size === 0) return '';
  const rows = [...textMap].slice(0, 60).map(([k, v]) => {
    const name = k.split('::')[1] ?? k;
    return `  "${name}" → "${v}"`;
  });
  return [
    '',
    '=== MỐC ĐỊNH DẠNG PHẢI KHỚP VỚI NỘI DUNG THẺ (BẮT BUỘC) ===',
    'Thẻ này bắt AI xuất ra theo khuôn cố định (vd <hồ sơ nhân vật>…</hồ sơ nhân vật>) và regex',
    'bám đúng mốc đó để làm đẹp. Phần văn bản dạy AI xuất ra đã được dịch thành:',
    ...rows,
    'Trong regex, PHẢI dùng ĐÚNG bản bên phải — sai một chữ là regex không khớp và phần làm đẹp',
    'im lặng không chạy. Giữ nguyên cấu trúc regex, dấu escape và cờ (/gsi…); chỉ đổi phần chữ.',
  ].join('\n');
}
