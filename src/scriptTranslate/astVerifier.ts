// ─── (bug 187 — Hạng mục F) Verifier tự động sau "Dịch Script" ───
// Đóng gói 4 phép kiểm tra tĩnh đã dùng tay để đối chiếu World_Engine.js / World_Engine_vi.js
// (bugNeedFix/187) thành module chạy TỰ ĐỘNG ngay sau mỗi lần dịch, trước khi cho export:
//   1. So khớp số lượng node theo loại giữa AST gốc và AST dịch — lệch là cấu trúc bị thêm/bớt.
//   2. Duyệt song song hai AST: Identifier đổi tên (cấm), Literal số/bool đổi giá trị (cấm),
//      regex đổi không theo kiểu bọc alternation hợp lệ (cấm).
//   3. Đếm .join()/.split() với từng ký tự phân tách CJK — ký tự CHỨC NĂNG, lệch là dữ liệu
//      runtime không tách lại được dù cú pháp vẫn lành.
//   4. Phân loại CJK còn sót trong bản dịch thành các nhóm có nghĩa (Hạng mục C) thay vì một
//      con số gộp vô nghĩa.
//
// ĐIỂM SỐNG CÒN so với bản demo: pipeline đổi khoá theo Từ Điển là biến đổi HỢP LỆ làm AST
// đổi hình — `obj.键` → `obj['Tên']` biến Identifier thành Literal, `{键:1}` → `{'Tên':1}`
// cũng vậy. Đếm node thô sẽ báo đỏ MỖI LẦN từ điển hoạt động (báo động giả dạy người ta bỏ
// qua cảnh báo thật — bài học bug 154). Vì vậy mọi phép đếm/duyệt ở đây đều CHUẨN HOÁ qua
// đúng các biến đổi mà reinsert được phép làm, và những biến đổi đó được ghi lại thành danh
// sách "khoá đã đổi tên" để đối chiếu ngược với Từ Điển (Hạng mục B).
import * as acorn from 'acorn';
import { parseAnyAst, extractTokensAst, stripAsciiAffixes, type AnyNode } from './astExtract';

// ═══════════════════════════════════════════════════════════════════════════════
// Kiểu báo cáo
// ═══════════════════════════════════════════════════════════════════════════════

export interface DiffEntry {
  before: string;
  after: string;
  line: number;
}

export interface NodeCountDiff {
  type: string;
  before: number;
  after: number;
}

export interface KeyRename {
  from: string;
  to: string;
  count: number;
  /** Bản dịch này có ĐÚNG như Từ Điển không — false nghĩa là khoá bị đổi ngoài từ điển. */
  inDict: boolean;
}

export interface DelimiterDiff {
  delimiter: string;
  joinBefore: number;
  joinAfter: number;
  splitBefore: number;
  splitAfter: number;
}

/** Một chỗ CJK còn sót trong bản dịch — kèm dòng + ngữ cảnh để user nhảy thẳng tới. */
export interface CjkLeftover {
  text: string;
  line: number;
  context: string;
}

export interface CjkGroups {
  /** Ký tự CJK nằm trong nhánh (?:trung|việt) của regex — CỐ Ý giữ tương thích ngược, KHÔNG phải lỗi. */
  alternationChars: number;
  /** Regex còn cụm Hán CHƯA có nhánh Việt — sẽ không khớp output đã dịch. */
  regexNoAlt: CjkLeftover[];
  /** Khoá dữ liệu (object key / dot-notation / path) còn tiếng Trung — nguy hiểm, liên quan Từ Điển. */
  dataKey: CjkLeftover[];
  /** Văn xuôi/chuỗi thường chưa dịch — lỗi sót dịch thật sự. */
  prose: CjkLeftover[];
  /** Định danh trần giữ nguyên CÓ CHỦ ĐÍCH (bug 128) — trung tính. */
  keptIdentifiers: number;
}

export interface AstVerifyReport {
  /** 'ast' = đủ 4 phép kiểm; 'text-only' = một bên không parse được, chỉ chạy kiểm text. */
  mode: 'ast' | 'text-only';
  parseErrorOriginal?: string;
  parseErrorTranslated?: string;
  /** Kiểm 1 — lệch số node theo loại (đã chuẩn hoá qua biến đổi khoá hợp lệ). */
  nodeCountDiffs: NodeCountDiff[];
  /** Node lệch LOẠI tại cùng vị trí cây (nặng hơn lệch đếm — trỏ được đúng chỗ). */
  structuralDiffs: DiffEntry[];
  /** Kiểm 2a — định danh TRẦN bị đổi tên (tuyệt đối cấm). */
  identDiffs: DiffEntry[];
  /** Kiểm 2b — Literal số/boolean bị đổi giá trị. */
  literalDiffs: DiffEntry[];
  /** Kiểm 2c — regex đổi pattern/flags KHÔNG theo kiểu alternation hợp lệ. */
  regexDiffs: DiffEntry[];
  /** Regex được nâng cấp alternation HỢP LỆ (thông tin, không phải lỗi). */
  regexUpgrades: number;
  /** Khoá dữ liệu đã đổi tên (qua mọi dạng: dot→bracket, quote-wrap, thay nội dung chuỗi). */
  keyRenames: KeyRename[];
  /**
   * (bug 200 — Mục 1.1) Khoá đổi tên NHƯNG VẪN LÀ IDENTIFIER TRẦN (`{二:1}` → `{Hai:2}` thay vì
   * `{'Hai':2}`) — vi phạm bất biến Hạng mục H "khoá đã dịch luôn là chuỗi có nháy". Khác hẳn
   * Identifier→Literal (an toàn tuyệt đối): dạng này chỉ sống khi bản dịch TÌNH CỜ hợp lệ làm
   * identifier, dựa vào may rủi cú pháp. Có phần tử ở đây là CHẶN CỨNG, không phải rename thường.
   */
  unsafeKeyRenames: DiffEntry[];
  /** Số khoá đổi tên KHÔNG khớp Từ Điển — dấu hiệu đổi ngoài kiểm soát. */
  renamesOffDict: number;
  /** Kiểm 3 — lệch số lần join/split theo ký tự phân tách CJK. */
  delimiterDiffs: DelimiterDiff[];
  /** Kiểm 4 — phân loại CJK còn sót (Hạng mục C). */
  cjkGroups: CjkGroups;
  hardFail: boolean;
  hardFailReasons: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tiện ích
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_LIST = 200; // trần mỗi danh sách mẫu — đủ soát tay, không phình report MB

class LineIndex {
  private starts: number[] = [0];
  constructor(src: string) {
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') this.starts.push(i + 1);
  }
  lineOf(pos: number): number {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
}

const ctxAt = (src: string, pos: number, len = 0): string =>
  src.slice(Math.max(0, pos - 30), Math.min(src.length, pos + Math.max(len, 1) + 30)).replace(/\s+/g, ' ').trim();

const isStrLit = (n: AnyNode | undefined): boolean =>
  !!n && n.type === 'Literal' && typeof n.value === 'string';

const CJK_ANY = /[一-鿿㐀-䶿぀-ヿ가-힯]/;

// ═══════════════════════════════════════════════════════════════════════════════
// Kiểm 1 — đếm node CHUẨN HOÁ
// ═══════════════════════════════════════════════════════════════════════════════

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'regex']);

/**
 * Đếm số node theo loại, với hai vị trí được ĐỔI TÊN LOẠI để trung hoà biến đổi khoá hợp lệ:
 *   • property của MemberExpression (Identifier hoặc Literal chuỗi) → 'MemberProp'
 *     (dot→bracket đổi Identifier thành Literal nhưng cả hai cùng đếm vào MemberProp);
 *   • key của Property không-computed (Identifier hoặc Literal chuỗi) → 'PropKey'.
 * Mọi node khác đếm theo type thật. Thêm/bớt statement thật sự vẫn lệch như thường.
 */
export function countNodesNormalized(ast: AnyNode): Record<string, number> {
  const counts: Record<string, number> = {};
  const bump = (t: string) => { counts[t] = (counts[t] || 0) + 1; };
  (function walk(node: AnyNode, parent: AnyNode | null): void {
    let label = node.type;
    if (parent?.type === 'MemberExpression' && parent.property === node &&
        (node.type === 'Identifier' || isStrLit(node))) label = 'MemberProp';
    else if (parent?.type === 'Property' && parent.key === node && !parent.computed &&
        (node.type === 'Identifier' || isStrLit(node))) label = 'PropKey';
    bump(label);
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && typeof (c as AnyNode).type === 'string') walk(c as AnyNode, node);
      } else if (v && typeof v === 'object' && typeof (v as AnyNode).type === 'string') {
        walk(v as AnyNode, node);
      }
    }
  })(ast, null);
  return counts;
}

export function diffNodeCounts(astA: AnyNode, astB: AnyNode): NodeCountDiff[] {
  const a = countNodesNormalized(astA);
  const b = countNodesNormalized(astB);
  const out: NodeCountDiff[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ca = a[k] || 0, cb = b[k] || 0;
    if (ca !== cb) out.push({ type: k, before: ca, after: cb });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Kiểm 2 — duyệt song song
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Regex đổi pattern có phải kiểu nâng cấp alternation hợp lệ không: bóc mọi `(?:cũ|mới)`
 * về `cũ`, lặp tới khi ổn định — kết quả phải Y HỆT pattern gốc. (Cùng thuật toán đã
 * xác nhận 5/5 thay đổi của cặp World Engine là hợp lệ.)
 */
export function isValidAlternationUpgrade(before: string, after: string): boolean {
  // (review 187) DFS bóc TỪNG group MỘT. Bóc global cả loạt là sai hai chiều: pattern gốc có
  // thể tự chứa alternation ((?:foo|bar)汉 → bọc thành (?:foo|bar)(?:汉|viet); bóc loạt cho ra
  // foo汉 ≠ gốc → báo oan chặn export). Chỉ group có NHÁNH ĐẦU chứa CJK mới là ứng viên —
  // pipeline chỉ bọc quanh run CJK nên nhánh đầu của group nó thêm luôn là chữ Hán.
  if (after === before) return true;
  const CAND = /\(\?:([^|()]*[一-鿿㐀-䶿぀-ヿ가-힯][^|()]*)\|[^()]*?\)/g;
  const seen = new Set<string>();
  const stack = [after];
  let steps = 0;
  while (stack.length && steps++ < 500) {
    const cur = stack.pop()!;
    CAND.lastIndex = 0;
    for (let m = CAND.exec(cur); m; m = CAND.exec(cur)) {
      const next = cur.slice(0, m.index) + m[1] + cur.slice(m.index + m[0].length);
      if (next === before) return true;
      // Bóc chỉ làm ngắn đi — ngắn hơn đích là nhánh chết, cắt luôn.
      if (next.length >= before.length && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

interface ParallelDiffs {
  structuralDiffs: DiffEntry[];
  identDiffs: DiffEntry[];
  literalDiffs: DiffEntry[];
  regexDiffs: DiffEntry[];
  regexUpgrades: number;
  renames: Map<string, { to: Map<string, number> }>;
  /** (bug 200) Identifier→Identifier ở thế khoá — xem AstVerifyReport.unsafeKeyRenames. */
  unsafeKeyRenames: DiffEntry[];
}

/** Vị trí node có phải "thế khoá" không (đổi tên ở đó là biến đổi khoá, không phải đổi định danh). */
const inKeyPos = (parent: AnyNode | null, node: AnyNode): boolean =>
  (parent?.type === 'MemberExpression' && parent.property === node) ||
  (parent?.type === 'Property' && parent.key === node && !parent.computed);

export function walkParallelDiff(astA: AnyNode, astB: AnyNode, srcA: string): ParallelDiffs {
  const lineIdx = new LineIndex(srcA);
  const d: ParallelDiffs = {
    structuralDiffs: [], identDiffs: [], literalDiffs: [], regexDiffs: [],
    regexUpgrades: 0, renames: new Map(), unsafeKeyRenames: [],
  };
  const rename = (from: string, to: string): void => {
    const cur = d.renames.get(from) ?? { to: new Map<string, number>() };
    cur.to.set(to, (cur.to.get(to) ?? 0) + 1);
    d.renames.set(from, cur);
  };
  const push = (list: DiffEntry[], before: string, after: string, pos: number): void => {
    if (list.length < MAX_LIST) list.push({ before, after, line: lineIdx.lineOf(pos) });
  };

  function walk(a: AnyNode | undefined, b: AnyNode | undefined, pa: AnyNode | null): void {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return;

    if (a.type !== b.type) {
      // Biến đổi khoá hợp lệ: Identifier → Literal chuỗi ở thế khoá (quote-wrap / dot→bracket).
      if (a.type === 'Identifier' && isStrLit(b) && inKeyPos(pa, a)) {
        rename(String(a.name), String(b.value));
        return;
      }
      push(d.structuralDiffs, a.type, b.type, a.start);
      return;
    }

    switch (a.type) {
      case 'MemberExpression': {
        // dot→bracket: computed false→true kèm Identifier→Literal là hợp lệ, ghi rename.
        if (a.computed !== b.computed) {
          const ap = a.property as AnyNode, bp = b.property as AnyNode;
          if (!a.computed && b.computed && ap?.type === 'Identifier' && isStrLit(bp)) {
            rename(String(ap.name), String(bp.value));
            walk(a.object as AnyNode, b.object as AnyNode, a);
            return;
          }
          push(d.structuralDiffs, `MemberExpression(computed=${a.computed})`, `MemberExpression(computed=${b.computed})`, a.start);
          return;
        }
        break;
      }
      case 'Identifier': {
        if (a.name !== b.name) {
          if (inKeyPos(pa, a)) {
            // (bug 200 — Mục 1.1) KHÔNG tương đương với Identifier→Literal ở nhánh a.type !==
            // b.type phía trên: ở đây bản dịch vẫn là identifier TRẦN — reinsert đã quên bọc
            // nháy. `{Hai:2}` tình cờ parse được, nhưng "Anna-Maria" hay "2Xu" thì vỡ/đổi nghĩa
            // — cùng một lỗi gốc, chỉ khác độ may. Vẫn ghi rename (để đối chiếu Từ Điển) NHƯNG
            // đồng thời báo unsafe để hardFail — trước đây gộp chung nên bug thật lọt cổng QA.
            rename(String(a.name), String(b.name));
            push(d.unsafeKeyRenames, String(a.name), String(b.name), a.start);
          }
          else push(d.identDiffs, String(a.name), String(b.name), a.start);
        }
        return; // lá
      }
      case 'Literal': {
        const ar = (a as { regex?: { pattern: string; flags: string } }).regex;
        const br = (b as { regex?: { pattern: string; flags: string } }).regex;
        if (ar && br) {
          if (ar.pattern !== br.pattern || ar.flags !== br.flags) {
            if (ar.flags === br.flags && isValidAlternationUpgrade(ar.pattern, br.pattern)) d.regexUpgrades++;
            else push(d.regexDiffs, `/${ar.pattern}/${ar.flags}`, `/${br.pattern}/${br.flags}`, a.start);
          }
          return;
        }
        if (typeof a.value === 'number' || typeof a.value === 'boolean' || a.value === null) {
          if (a.value !== b.value) push(d.literalDiffs, String(a.value), String(b.value), a.start);
          return;
        }
        if (typeof a.value === 'string' && typeof b.value === 'string') {
          // Chuỗi ở thế khoá đổi nội dung = đổi khoá → ghi rename (chỉ khi nguồn có CJK —
          // khoá ASCII đổi là chuyện khác, structural check các tầng khác lo).
          if (a.value !== b.value && inKeyPos(pa, a) && CJK_ANY.test(a.value)) {
            rename(a.value, String(b.value));
          }
          return; // chuỗi văn xuôi đổi là VIỆC của bản dịch — không soi ở đây
        }
        return;
      }
    }

    for (const k of Object.keys(a)) {
      if (SKIP_KEYS.has(k)) continue;
      const va = a[k], vb = b[k];
      if (Array.isArray(va) && Array.isArray(vb)) {
        if (va.length !== vb.length) {
          push(d.structuralDiffs, `${a.type}.${k}[${va.length}]`, `${a.type}.${k}[${vb.length}]`, a.start);
        }
        const n = Math.min(va.length, vb.length);
        for (let i = 0; i < n; i++) {
          const ca = va[i], cb = vb[i];
          if (ca && typeof ca === 'object' && typeof (ca as AnyNode).type === 'string') {
            walk(ca as AnyNode, cb as AnyNode, a);
          }
        }
      } else if (va && typeof va === 'object' && typeof (va as AnyNode).type === 'string') {
        walk(va as AnyNode, vb as AnyNode, a);
      }
    }
  }

  walk(astA, astB, null);
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Kiểm 3 — delimiter join/split
// ═══════════════════════════════════════════════════════════════════════════════

const DELIMS = ['、', '｜', '；', '：', '，', '。', '／', '·'];

export function diffDelimiterUsage(srcA: string, srcB: string): DelimiterDiff[] {
  const out: DelimiterDiff[] = [];
  for (const dch of DELIMS) {
    const esc = dch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (src: string, method: string): number =>
      (src.match(new RegExp(`\\.${method}\\(\\s*["'\`]${esc}["'\`]`, 'g')) || []).length;
    const joinBefore = count(srcA, 'join'), joinAfter = count(srcB, 'join');
    const splitBefore = count(srcA, 'split'), splitAfter = count(srcB, 'split');
    if (joinBefore !== joinAfter || splitBefore !== splitAfter) {
      out.push({ delimiter: dch, joinBefore, joinAfter, splitBefore, splitAfter });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Kiểm 4 — phân loại CJK còn sót (Hạng mục C)
// ═══════════════════════════════════════════════════════════════════════════════

const CJK_RUN_G = /[一-鿿㐀-䶿぀-ヿ가-힯]+/g;

/** Run CJK trong THÂN regex có nằm trong nhánh (?:…|…) không — bọc alternation là cố ý, hợp lệ. */
function isInsideAlternation(body: string, runStart: number, runEnd: number): boolean {
  // Tìm `(?:` gần nhất phía trước mà chưa đóng, và `|` xuất hiện trong cùng nhóm.
  const before = body.slice(Math.max(0, runStart - 400), runStart);
  const after = body.slice(runEnd, Math.min(body.length, runEnd + 400));
  const openIdx = before.lastIndexOf('(?:');
  if (openIdx === -1) return false;
  const sinceOpen = before.slice(openIdx);
  if (sinceOpen.includes(')')) return false; // nhóm đã đóng trước run
  return sinceOpen.includes('|') || /^[^()]*\|/.test(after);
}

/**
 * Phân loại toàn bộ CJK còn lại trong bản dịch bằng CHÍNH bộ phân loại AST của extractor
 * (Hạng mục A) — cùng một thước đo cho "cần dịch gì" và "còn sót gì".
 * Trả null khi bản dịch không parse được (caller rơi về heuristic text).
 */
export function classifyRemainingCjk(translated: string): CjkGroups | null {
  const ex = extractTokensAst(translated);
  if (!ex) return null;
  const lineIdx = new LineIndex(translated);
  const groups: CjkGroups = {
    alternationChars: 0, regexNoAlt: [], dataKey: [], prose: [],
    keptIdentifiers: 0,
  };
  const leftover = (t: { text: string; start: number }): CjkLeftover => ({
    text: t.text,
    line: lineIdx.lineOf(t.start),
    context: ctxAt(translated, t.start, t.text.length),
  });

  for (const t of ex.tokens) {
    if (!CJK_ANY.test(t.text)) continue;
    const isKey = t.isObjectKey || t.isDotNotation || (t.isIdentifier && !t.isCssClass && !t.isHtmlAttr);
    const bucket = isKey ? groups.dataKey : groups.prose;
    if (bucket.length < MAX_LIST) bucket.push(leftover(t));
  }
  for (const k of ex.keptIdentifiers) {
    if (CJK_ANY.test(k.name)) groups.keptIdentifiers += k.count;
  }
  for (const [rs, re] of ex.regexRanges) {
    const body = translated.slice(rs, re);
    CJK_RUN_G.lastIndex = 0;
    for (let m = CJK_RUN_G.exec(body); m; m = CJK_RUN_G.exec(body)) {
      if (isInsideAlternation(body, m.index, m.index + m[0].length)) {
        groups.alternationChars += m[0].length;
      } else if (groups.regexNoAlt.length < MAX_LIST) {
        groups.regexNoAlt.push({
          text: m[0],
          line: lineIdx.lineOf(rs + m.index),
          context: ctxAt(translated, rs + m.index, m[0].length),
        });
      }
    }
  }
  return groups;
}

/** Fallback khi bản dịch không parse được: phân loại bằng heuristic lân cận (bản demo). */
function classifyRemainingCjkText(src: string): CjkGroups {
  const lineIdx = new LineIndex(src);
  const groups: CjkGroups = { alternationChars: 0, regexNoAlt: [], dataKey: [], prose: [], keptIdentifiers: 0 };
  CJK_RUN_G.lastIndex = 0;
  for (let m = CJK_RUN_G.exec(src); m; m = CJK_RUN_G.exec(src)) {
    const before = src.slice(Math.max(0, m.index - 30), m.index);
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const item: CjkLeftover = { text: m[0], line: lineIdx.lineOf(m.index), context: ctxAt(src, m.index, m[0].length) };
    if (/\(\?:[^)]*$/.test(before) || /^[^)]*\|[^)]*\)/.test(after)) groups.alternationChars += m[0].length;
    else if (/[.?]\s*$/.test(before) || /\[["']$/.test(before)) { if (groups.dataKey.length < MAX_LIST) groups.dataKey.push(item); }
    else if (groups.prose.length < MAX_LIST) groups.prose.push(item);
  }
  return groups;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tổng hợp
// ═══════════════════════════════════════════════════════════════════════════════

/** parseAnyAst đã fail cả 2 kiểu — parse lại kiểu 'script' chỉ để lấy message dễ đọc. */
const parseErrMsg = (code: string): string => {
  try {
    acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
    return 'không rõ';
  } catch (e) {
    return (e as Error)?.message || String(e);
  }
};

/**
 * Chạy trọn 4 phép kiểm trên (gốc, dịch). `dict` = Từ Điển đã dùng (nguồn→đích) để đối chiếu
 * các khoá bị đổi tên: đổi ĐÚNG theo từ điển là hợp lệ, đổi khác đi là ngoài kiểm soát.
 */
export function verifyTranslationAst(
  original: string,
  translated: string,
  dict?: Record<string, string>,
): AstVerifyReport {
  const pa = parseAnyAst(original);
  const pb = parseAnyAst(translated);

  const report: AstVerifyReport = {
    mode: pa && pb ? 'ast' : 'text-only',
    nodeCountDiffs: [], structuralDiffs: [], identDiffs: [], literalDiffs: [], regexDiffs: [],
    regexUpgrades: 0, keyRenames: [], renamesOffDict: 0, unsafeKeyRenames: [],
    delimiterDiffs: diffDelimiterUsage(original, translated),
    cjkGroups: { alternationChars: 0, regexNoAlt: [], dataKey: [], prose: [], keptIdentifiers: 0 },
    hardFail: false, hardFailReasons: [],
  };
  if (!pa) report.parseErrorOriginal = parseErrMsg(original);
  if (!pb) report.parseErrorTranslated = parseErrMsg(translated);

  if (pa && pb) {
    report.nodeCountDiffs = diffNodeCounts(pa.ast, pb.ast);
    const d = walkParallelDiff(pa.ast, pb.ast, original);
    report.structuralDiffs = d.structuralDiffs;
    report.identDiffs = d.identDiffs;
    report.literalDiffs = d.literalDiffs;
    report.regexDiffs = d.regexDiffs;
    report.regexUpgrades = d.regexUpgrades;
    report.unsafeKeyRenames = d.unsafeKeyRenames;

    // Đối chiếu rename với Từ Điển — dùng ĐÚNG phép tra của extractor (astExtract.pushKeyToken):
    // tên đầy đủ thắng trước, tra core thì ghép lại hậu tố ASCII, tiền tố do reinsert tự ghép.
    // Khoá `_魔力值2` với dict{魔力值:Mana} → bản dịch hợp lệ là `_Mana2`, không phải `Mana`.
    for (const [from, { to }] of d.renames) {
      const asciiPrefix = /^[\w$]+/.exec(from)?.[0] ?? '';
      const afterPrefix = from.slice(asciiPrefix.length);
      const core = stripAsciiAffixes(from) || afterPrefix;
      const trailing = afterPrefix.slice(core.length);
      const exact = dict?.[afterPrefix] ?? dict?.[from];
      const coreHit = dict?.[core];
      const want = exact ?? (coreHit !== undefined ? coreHit + trailing : undefined);
      for (const [toName, count] of to) {
        const ok = want !== undefined && (toName === want || toName === asciiPrefix + want);
        if (!ok) report.renamesOffDict++;
        if (report.keyRenames.length < MAX_LIST) report.keyRenames.push({ from, to: toName, count, inDict: ok });
      }
    }
  }

  report.cjkGroups = (pb ? classifyRemainingCjk(translated) : null) ?? classifyRemainingCjkText(translated);

  // (review 187) Mục identity trong Từ Điển (nguồn = đích) nghĩa là user CHỐT GIỮ khoá đó —
  // khoá còn Hán vì user muốn thế, xếp vào nhóm "giữ chủ đích" trung tính chứ không sơn đỏ
  // chặn export rồi khuyên họ "thêm vào Từ Điển" (họ thêm rồi!).
  if (dict) {
    let keptByChoice = 0;
    report.cjkGroups.dataKey = report.cjkGroups.dataKey.filter((d) => {
      const core = stripAsciiAffixes(d.text) || d.text;
      const identity = dict[d.text] === d.text || dict[core] === core;
      if (identity) keptByChoice++;
      return !identity;
    });
    report.cjkGroups.keptIdentifiers += keptByChoice;
  }

  // ── Chốt hardFail — đúng danh sách "chặn cứng" của đề bài ──
  const R = report.hardFailReasons;
  if (pa && !pb) R.push(`Bản dịch KHÔNG parse được (gốc parse tốt) — lỗi do quá trình dịch: ${report.parseErrorTranslated}`);
  if (report.structuralDiffs.length) R.push(`Cấu trúc code bị đổi tại ${report.structuralDiffs.length} vị trí (thêm/bớt/đổi loại node)`);
  if (report.nodeCountDiffs.length) R.push(`Số lượng node theo loại lệch ở ${report.nodeCountDiffs.length} loại (${report.nodeCountDiffs.slice(0, 3).map((x) => `${x.type}: ${x.before}→${x.after}`).join(', ')}${report.nodeCountDiffs.length > 3 ? ', …' : ''})`);
  if (report.identDiffs.length) R.push(`${report.identDiffs.length} định danh (tên biến/hàm) bị đổi tên — tuyệt đối cấm`);
  if (report.unsafeKeyRenames.length) R.push(`${report.unsafeKeyRenames.length} khoá dịch KHÔNG được bọc nháy (vẫn là identifier trần, vd ${report.unsafeKeyRenames.slice(0, 3).map((x) => `${x.before}→${x.after}`).join(', ')}) — vi phạm bất biến "khoá đã dịch luôn là chuỗi có nháy"`);
  if (report.literalDiffs.length) R.push(`${report.literalDiffs.length} literal số/boolean bị đổi giá trị`);
  if (report.regexDiffs.length) R.push(`${report.regexDiffs.length} regex bị đổi KHÔNG theo kiểu bọc (?:trung|việt) hợp lệ`);
  if (report.delimiterDiffs.length) R.push(`Ký tự phân tách dữ liệu trong .join()/.split() bị lệch (${report.delimiterDiffs.map((x) => x.delimiter).join(' ')})`);
  report.hardFail = R.length > 0;
  return report;
}
