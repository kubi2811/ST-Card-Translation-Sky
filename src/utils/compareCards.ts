/**
 * src/utils/compareCards.ts — Gióng hàng & nhóm entry của nhiều card để SO SÁNH (thuần, có test).
 * ──────────────────────────────────────────────────────────────────────────────
 * 3 card là 3 phiên bản của cùng 1 card → dùng `TranslationField.path` làm KHÓA gióng hàng.
 * Union path của mọi slot đã nạp, gom theo FieldGroup (thứ tự DEFAULT_FIELD_GROUPS), sort ổn định.
 */
import type { FieldGroup, TranslationField } from '../types/card';
import { DEFAULT_FIELD_GROUPS } from './cardFields';

export interface CompareEntry {
  path: string;
  label: string;
  group: FieldGroup;
}
export interface CompareGroup {
  group: FieldGroup;
  label: string;
  entries: CompareEntry[];
}

/** Nhãn tiếng Việt cho từng nhóm (fallback về label gốc nếu thiếu). */
const GROUP_LABEL_VI: Partial<Record<FieldGroup, string>> = {
  core: 'Cốt lõi (tên, mô tả, tính cách, bối cảnh)',
  messages: 'Lời mở đầu & hội thoại mẫu',
  system: 'System Prompt',
  creator: 'Ghi chú tác giả',
  lorebook: 'Lorebook (nội dung entry)',
  lorebook_keys: 'Từ khoá Lorebook',
  depth_prompt: 'Depth Prompt',
  tavern_helper: 'Script TavernHelper (MVU…)',
  regex: 'Regex Scripts',
};

/** Thứ tự nhóm theo DEFAULT_FIELD_GROUPS (ổn định, dễ đọc). */
const GROUP_ORDER: FieldGroup[] = DEFAULT_FIELD_GROUPS.map((g) => g.id);

/** So path kiểu tự nhiên để `entries[2]` đứng trước `entries[10]`. */
function comparePathNatural(a: string, b: string): number {
  const ax = a.replace(/\[(\d+)\]/g, (_, n) => `[${String(n).padStart(6, '0')}]`);
  const bx = b.replace(/\[(\d+)\]/g, (_, n) => `[${String(n).padStart(6, '0')}]`);
  return ax < bx ? -1 : ax > bx ? 1 : 0;
}

/**
 * Union tất cả path của các slot, gom theo nhóm. Giữ label+group của lần GẶP ĐẦU (ưu tiên slot trái).
 * @param perSlotFields mảng field của từng slot đã nạp (bỏ qua slot rỗng trước khi gọi, hoặc truyền []).
 */
export function buildCompareGroups(perSlotFields: TranslationField[][]): CompareGroup[] {
  const byPath = new Map<string, CompareEntry>();
  for (const fields of perSlotFields) {
    for (const f of fields) {
      if (!byPath.has(f.path)) {
        byPath.set(f.path, { path: f.path, label: f.label, group: f.group });
      }
    }
  }

  const groupsMap = new Map<FieldGroup, CompareEntry[]>();
  for (const entry of byPath.values()) {
    const arr = groupsMap.get(entry.group) || [];
    arr.push(entry);
    groupsMap.set(entry.group, arr);
  }

  const out: CompareGroup[] = [];
  // Nhóm theo thứ tự chuẩn trước…
  for (const g of GROUP_ORDER) {
    const entries = groupsMap.get(g);
    if (entries && entries.length) {
      entries.sort((a, b) => comparePathNatural(a.path, b.path));
      out.push({ group: g, label: GROUP_LABEL_VI[g] || g, entries });
      groupsMap.delete(g);
    }
  }
  // …rồi mọi nhóm lạ còn sót (an toàn nếu FieldGroup mở rộng về sau).
  for (const [g, entries] of groupsMap) {
    entries.sort((a, b) => comparePathNatural(a.path, b.path));
    out.push({ group: g, label: GROUP_LABEL_VI[g] || g, entries });
  }
  return out;
}

/**
 * Các giá trị của cùng 1 entry giữa các slot có KHÁC nhau không?
 * undefined = slot thiếu entry đó. Bỏ qua slot undefined; nếu còn ≤1 giá trị thực → coi như không khác.
 */
export function valuesDiffer(values: (string | undefined)[]): boolean {
  const present = values.filter((v): v is string => v !== undefined);
  if (present.length <= 1) return false;
  const first = present[0];
  return present.some((v) => v !== first);
}

/**
 * Chuẩn hoá TỐI THIỂU trước khi so "tác giả có đổi entry không": chỉ gộp CRLF→LF.
 * CỐ Ý bảo thủ — KHÔNG trim/nuốt khoảng trắng: thà báo "đổi" nhầm (dịch lại, chỉ tốn thời gian)
 * còn hơn báo "không đổi" nhầm (tái dùng bản dịch cũ cho nội dung đã thay → SAI bản dịch).
 */
function normLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

export interface MergePlan {
  /** path → bản dịch cũ (từ Card Đã Dịch) để tái dùng vì entry KHÔNG đổi. */
  reused: Map<string, string>;
  /** path mới/đổi → cần dịch (giữ nguyên ngữ ở Final). */
  changed: Set<string>;
  /**
   * (chế độ 2 card) path ĐƯỢC tái dùng nhưng NGHI tác giả đã sửa nội dung — suy ra từ tỉ lệ độ dài
   * bản dịch/bản gốc lệch bất thường. Luôn RỖNG ở chế độ 3 card (ở đó biết chắc, không phải đoán).
   * Đây là tập con của `reused`: mặc định vẫn tái dùng, chỉ tô vàng để user tự quyết.
   */
  suspect: Set<string>;
  /** '3card' = chính xác (có bản gốc cũ làm mốc) · '2card' = suy đoán. */
  mode: '3card' | '2card';
  counts: { reused: number; changed: number; suspect: number; total: number };
}

/* ─── Gióng entry theo NỘI DUNG (cho 2 card CÙNG ngôn ngữ) ─── */

/** Khoá tra theo nội dung: kèm TÊN FIELD để `content` không khớp nhầm sang `comment`. */
function valueKey(path: string, value: string): string {
  const field = /\.entries\[\d+\]\.(.+)$/.exec(path)?.[1] ?? path;
  return `${field}${normLineEndings(value)}`;
}

/**
 * Index nội dung → path. Nội dung TRÙNG NHAU giữa nhiều entry thì bỏ hẳn khỏi index (không biết
 * chọn cái nào, khớp bừa là gán nhầm bản dịch) — những entry đó sẽ rơi về so theo path.
 */
function buildValueIndex(byPath: Map<string, string>): Map<string, string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const [path, value] of byPath) {
    if (!value) continue;
    const k = valueKey(path, value);
    if (seen.has(k)) { dup.add(k); continue; }
    seen.set(k, path);
  }
  for (const d of dup) seen.delete(d);
  return seen;
}

/* ─── Gióng entry theo KEY HÁN (dùng khi 2 card KHÁC ngôn ngữ) ─── */

const CJK_RE = /[㐀-鿿]/;

/**
 * Danh tính ổn định của một entry lorebook = TẬP KEY TIẾNG TRUNG của nó (sort, join).
 *
 * Vì sao không dùng index: gióng bằng `path` (`…entries[12].content`) thì tác giả chèn MỘT entry
 * vào giữa là mọi entry phía sau lệch số → bị coi là "đã đổi" → dịch lại thừa hàng loạt.
 * Vì sao key Hán đáng tin: chế độ xuất key mặc định là "Merge" (giữ key gốc + THÊM key dịch), nên
 * bản đã dịch vẫn còn nguyên key Hán. Đo trên thẻ thật (689 entry): 636/636 entry có key Hán đều
 * giữ đủ — khớp 100%.
 *
 * Trả '' khi entry không có key Hán → người gọi tự lùi về khớp theo path.
 */
export function entryIdentity(valueByPath: Map<string, string>, path: string): string {
  const m = /^(.*\.entries\[\d+\])\./.exec(path);
  if (!m) return '';
  const keysRaw = valueByPath.get(`${m[1]}.keys`) ?? valueByPath.get(`${m[1]}.key`);
  if (!keysRaw) return '';
  const han = keysRaw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s && CJK_RE.test(s));
  if (han.length === 0) return '';
  // Thêm hậu tố tên field để `content` không khớp nhầm với `comment` của cùng entry.
  const field = path.slice(m[0].length);
  return `${[...new Set(han)].sort().join(' ')}::${field}`;
}

/** Index danh tính → path, để tra ngược sang card khác. Bỏ qua danh tính trùng (không tin được). */
function buildIdentityIndex(valueByPath: Map<string, string>): Map<string, string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const path of valueByPath.keys()) {
    const id = entryIdentity(valueByPath, path);
    if (!id) continue;
    if (seen.has(id)) { dup.add(id); continue; }
    seen.set(id, path);
  }
  for (const d of dup) seen.delete(d);
  return seen;
}

/**
 * Tìm path tương ứng ở card khác: ưu tiên danh tính key Hán, lùi về chính path đó.
 *
 * Chỗ dễ sai (test đã bắt): khi entry CÓ danh tính mà tra không ra ở card kia thì TUYỆT ĐỐI
 * không được lùi về path — index lúc đó đã lệch do tác giả chèn entry, lùi về path là khớp
 * nhầm sang entry hàng xóm và tái dùng bản dịch của người khác. Tra không ra = entry MỚI.
 * Chỉ lùi về path khi card kia không hề có danh tính nào (không dùng được lối khớp này).
 */
function resolvePath(
  path: string,
  srcByPath: Map<string, string>,
  dstByPath: Map<string, string>,
  dstIndex: Map<string, string>,
): string | undefined {
  const id = entryIdentity(srcByPath, path);
  if (id) {
    const hit = dstIndex.get(id);
    if (hit !== undefined) return hit;
    // Card kia có dùng danh tính → tra trượt nghĩa là entry mới, không khớp bừa theo path.
    if (dstIndex.size > 0) return undefined;
  }
  return dstByPath.has(path) ? path : undefined;
}

/**
 * "Gộp thông minh": so Card Raw (gốc CŨ) vs Card Final (gốc MỚI) theo TỪNG entry.
 *  - KHÔNG đổi + có bản dịch cũ (Card Đã Dịch) → TÁI DÙNG bản dịch đó.
 *  - Mới / đổi / không có bản dịch cũ → CẦN DỊCH (giữ nguyên ngữ).
 * Duyệt theo tập path của Card Final (đó là card đích sẽ xuất ra).
 * @param rawByPath   Card Raw   (gốc cũ)
 * @param dichByPath  Card Đã Dịch (bản dịch cũ, khớp Raw theo path)
 * @param finalByPath Card Final (gốc mới)
 */
export function planMerge(
  rawByPath: Map<string, string>,
  dichByPath: Map<string, string>,
  finalByPath: Map<string, string>,
): MergePlan {
  const reused = new Map<string, string>();
  const changed = new Set<string>();
  // Card Raw và Card Final CÙNG NGÔN NGỮ → khớp thẳng bằng NỘI DUNG là chính xác tuyệt đối và
  // miễn nhiễm với việc tác giả chèn entry (không cần đoán qua key). Còn Card Đã Dịch vốn được
  // dịch RA TỪ Card Raw nên cùng chỉ số với nó → tra bản dịch bằng chính path bên Raw.
  const rawByValue = buildValueIndex(rawByPath);
  // Căn hàng entry Raw↔Final bằng NỘI DUNG (cùng ngôn ngữ nên tuyệt đối chính xác), để những
  // field khác trong cùng entry (keys, comment…) cũng tra đúng chỗ dù entry đã dời chỉ số.
  const entryMap = alignEntries(rawByPath, finalByPath, entryContentIdentity);

  for (const [path, finalVal] of finalByPath) {
    let rawPath: string | undefined;
    // 1. Thử đúng path (đường nhanh, khi tác giả không chèn gì phía trước).
    const atSamePath = rawByPath.get(path);
    if (atSamePath !== undefined && normLineEndings(atSamePath) === normLineEndings(finalVal)) {
      rawPath = path;
    } else {
      // 2. Nội dung y hệt nhưng đã dời chỗ → tra bằng chính nội dung.
      rawPath = rawByValue.get(valueKey(path, finalVal));
      // 3. Field phụ (keys/comment) của một entry đã căn được: tra theo chỉ số entry tương ứng,
      //    rồi vẫn PHẢI so nội dung — khác nội dung là tác giả có sửa, phải dịch lại.
      if (rawPath === undefined) {
        const nIdx = entryIdxOf(path);
        const oIdx = nIdx === null ? undefined : entryMap.get(nIdx);
        if (oIdx !== undefined) {
          const cand = path.replace(`.entries[${nIdx}].`, `.entries[${oIdx}].`);
          const candVal = rawByPath.get(cand);
          if (candVal !== undefined && normLineEndings(candVal) === normLineEndings(finalVal)) rawPath = cand;
        }
      }
    }

    const dichVal = rawPath === undefined ? undefined : dichByPath.get(rawPath);
    if (rawPath !== undefined && dichVal !== undefined && dichVal.trim() !== '') {
      reused.set(path, dichVal);
    } else {
      changed.add(path);
    }
  }

  return {
    reused, changed, suspect: new Set<string>(), mode: '3card',
    counts: { reused: reused.size, changed: changed.size, suspect: 0, total: finalByPath.size },
  };
}

/* ─── Căn hàng ENTRY giữa 2 card khác ngôn ngữ ─── */

const entryIdxOf = (path: string): number | null => {
  const m = /\.entries\[(\d+)\]\./.exec(path);
  return m ? Number(m[1]) : null;
};

/** Danh tính key Hán của MỘT entry (không kèm tên field) — dùng làm mốc căn hàng. */
function entryKeyIdentity(byPath: Map<string, string>, idx: number): string {
  for (const suffix of ['keys', 'key']) {
    for (const [path, val] of byPath) {
      if (!path.endsWith(`.entries[${idx}].${suffix}`)) continue;
      const han = val.split(/[,，]/).map((s) => s.trim()).filter((s) => s && CJK_RE.test(s));
      if (han.length) return [...new Set(han)].sort().join(' ');
    }
  }
  return '';
}

/** Danh tính theo NỘI DUNG entry — chỉ dùng khi 2 card CÙNG ngôn ngữ (Raw vs Final). Chính xác tuyệt đối. */
function entryContentIdentity(byPath: Map<string, string>, idx: number): string {
  for (const [path, val] of byPath) {
    if (path.endsWith(`.entries[${idx}].content`) && val) return normLineEndings(val);
  }
  return '';
}

/**
 * Căn hàng entry của bản ĐÃ DỊCH (cũ) với bản GỐC MỚI, trả về `idx mới → idx cũ`.
 *
 * Hai card khác ngôn ngữ nên không so nội dung được. Cách làm:
 *  1. Lấy các entry có KEY HÁN trùng nhau làm MỐC (neo) — đây là phần chắc chắn.
 *  2. Những entry KHÔNG có key Hán thì căn theo VỊ TRÍ GIỮA HAI MỐC: nếu khoảng giữa hai mốc
 *     liên tiếp có số entry chưa khớp BẰNG NHAU ở cả hai bên thì ghép chúng theo đúng thứ tự.
 *     Số lượng lệch nhau (tác giả thêm/bớt ngay trong khoảng đó) thì bỏ, không đoán bừa.
 *
 * Nhờ bước 2, thẻ có ~1/3 entry thiếu key Hán vẫn căn được, thay vì bị coi là entry mới hết.
 */
function alignEntries(
  oldByPath: Map<string, string>,
  newByPath: Map<string, string>,
  identityOf: (byPath: Map<string, string>, idx: number) => string = entryKeyIdentity,
): Map<number, number> {
  const idxSet = (m: Map<string, string>) => {
    const s = new Set<number>();
    for (const p of m.keys()) { const i = entryIdxOf(p); if (i !== null) s.add(i); }
    return [...s].sort((a, b) => a - b);
  };
  const oldIdx = idxSet(oldByPath);
  const newIdx = idxSet(newByPath);

  // 1. Mốc: key Hán duy nhất ở CẢ HAI bên.
  const build = (m: Map<string, string>, list: number[]) => {
    const byId = new Map<string, number>(); const dup = new Set<string>();
    for (const i of list) {
      const id = identityOf(m, i);
      if (!id) continue;
      if (byId.has(id)) { dup.add(id); continue; }
      byId.set(id, i);
    }
    for (const d of dup) byId.delete(d);
    return byId;
  };
  const oldById = build(oldByPath, oldIdx);
  const newById = build(newByPath, newIdx);

  const map = new Map<number, number>();          // idx mới → idx cũ
  const anchors: { n: number; o: number }[] = [];
  for (const [id, n] of newById) {
    const o = oldById.get(id);
    if (o !== undefined) { map.set(n, o); anchors.push({ n, o }); }
  }
  anchors.sort((a, b) => a.n - b.n);

  // 2. Lấp khoảng giữa các mốc (kể cả đoạn đầu và đoạn cuối).
  const usedOld = new Set(anchors.map((a) => a.o));
  const between = (list: number[], lo: number, hi: number, skip: Set<number>) =>
    list.filter((i) => i > lo && i < hi && !skip.has(i));

  const bounds: { nLo: number; nHi: number; oLo: number; oHi: number }[] = [];
  const NEG = -1;
  const nMax = (newIdx[newIdx.length - 1] ?? -1) + 1;
  const oMax = (oldIdx[oldIdx.length - 1] ?? -1) + 1;
  let prev = { n: NEG, o: NEG };
  for (const a of anchors) { bounds.push({ nLo: prev.n, nHi: a.n, oLo: prev.o, oHi: a.o }); prev = a; }
  bounds.push({ nLo: prev.n, nHi: nMax, oLo: prev.o, oHi: oMax });

  for (const b of bounds) {
    const gapNew = between(newIdx, b.nLo, b.nHi, new Set(map.keys()));
    const gapOld = between(oldIdx, b.oLo, b.oHi, usedOld);
    if (gapNew.length === 0 || gapNew.length !== gapOld.length) continue; // lệch số → không đoán
    gapNew.forEach((n, k) => { map.set(n, gapOld[k]); usedOld.add(gapOld[k]); });
  }
  return map;
}

/* ─── Chế độ 2 card: chỉ có bản ĐÃ DỊCH cũ + bản GỐC mới ─── */

/** Mật độ CJK — dùng để biết một chuỗi "còn là tiếng Trung" hay đã dịch. */
function cjkRatio(s: string): number {
  const t = String(s ?? '');
  if (!t) return 0;
  const n = (t.match(/[㐀-鿿]/g) || []).length;
  return n / t.length;
}

/**
 * Tỉ lệ độ dài bản dịch / bản gốc mà ta coi là BÌNH THƯỜNG.
 * Đo thật trên 674 entry của thẻ Reborn (Trung→Việt): p5 = 2.36 · trung vị = 2.93 · p95 = 3.51.
 * Nới biên ra [2.0, 4.2] để không kêu oan quá nhiều.
 */
const RATIO_MIN = 2.0;
const RATIO_MAX = 4.2;
/** Chuỗi gốc phải đủ dài + đủ đậm CJK thì tỉ lệ mới có ý nghĩa thống kê. */
const SUSPECT_MIN_LEN = 200;
const SUSPECT_MIN_CJK = 0.3;

/**
 * "Gộp thông minh" khi CHỈ có 2 card: Card Đã Dịch (VI cũ) + Card Final (gốc MỚI).
 *
 * ĐIỂM MÙ CÓ THẬT, phải nói thẳng: không có bản gốc CŨ làm mốc thì KHÔNG cách nào biết chắc tác giả
 * có sửa nội dung một entry cũ hay không — so tiếng Việt với tiếng Trung chẳng cho tín hiệu bằng
 * nhau nào. Cái ta làm được:
 *   - entry MỚI (không tra ra bản dịch cũ)            → cần dịch, chắc chắn
 *   - entry bản dịch cũ VẪN đang là tiếng Trung        → cần dịch, chắc chắn
 *   - còn lại                                          → tái dùng, nhưng nếu tỉ lệ độ dài lệch khỏi
 *     dải bình thường thì đánh dấu `suspect` để user tự quyết (mặc định VẪN tái dùng).
 */
export function planMergeTwoCard(
  dichByPath: Map<string, string>,
  finalByPath: Map<string, string>,
): MergePlan {
  const reused = new Map<string, string>();
  const changed = new Set<string>();
  const suspect = new Set<string>();
  const dichIndex = buildIdentityIndex(dichByPath);
  const entryMap = alignEntries(dichByPath, finalByPath); // idx mới → idx cũ

  for (const [path, finalVal] of finalByPath) {
    // Ưu tiên bảng căn hàng entry (mốc key Hán + lấp khoảng theo vị trí), rồi mới tới cách cũ.
    let dichPath: string | undefined;
    const nIdx = entryIdxOf(path);
    if (nIdx !== null) {
      const oIdx = entryMap.get(nIdx);
      if (oIdx !== undefined) {
        const cand = path.replace(`.entries[${nIdx}].`, `.entries[${oIdx}].`);
        if (dichByPath.has(cand)) dichPath = cand;
      }
      // Entry không căn được → coi là MỚI, tuyệt đối không khớp bừa theo path đã lệch.
      if (dichPath === undefined && entryMap.size > 0) { changed.add(path); continue; }
    }
    if (dichPath === undefined) dichPath = resolvePath(path, finalByPath, dichByPath, dichIndex);
    const dichVal = dichPath === undefined ? undefined : dichByPath.get(dichPath);

    // 1. Không tra ra bản dịch cũ → entry MỚI.
    if (dichVal === undefined || dichVal.trim() === '') { changed.add(path); continue; }
    // 2. Bản "dịch" cũ vẫn đậm đặc tiếng Trung → thực ra chưa từng dịch.
    if (cjkRatio(dichVal) >= SUSPECT_MIN_CJK && cjkRatio(dichVal) >= cjkRatio(finalVal) * 0.8) {
      changed.add(path); continue;
    }

    reused.set(path, dichVal);

    // 3. Đánh hơi entry tác giả đã sửa: chỉ xét chuỗi đủ dài + gốc đủ đậm CJK.
    if (finalVal.length >= SUSPECT_MIN_LEN && cjkRatio(finalVal) >= SUSPECT_MIN_CJK) {
      const ratio = dichVal.length / finalVal.length;
      if (ratio < RATIO_MIN || ratio > RATIO_MAX) suspect.add(path);
    }
  }

  return {
    reused, changed, suspect, mode: '2card',
    counts: { reused: reused.size, changed: changed.size, suspect: suspect.size, total: finalByPath.size },
  };
}

/** Chuyển toàn bộ `suspect` sang diện cần dịch (nút "Đẩy hết sang dịch lại"). */
export function promoteSuspects(plan: MergePlan): MergePlan {
  const reused = new Map(plan.reused);
  const changed = new Set(plan.changed);
  for (const p of plan.suspect) { reused.delete(p); changed.add(p); }
  return {
    ...plan, reused, changed, suspect: new Set<string>(),
    counts: { ...plan.counts, reused: reused.size, changed: changed.size, suspect: 0 },
  };
}
