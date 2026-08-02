// ─── (bug 187 — Hạng mục A) Lõi trích token CJK dựa trên AST THẬT ───
// Thay cơ chế "soi regex vài ký tự lân cận" (nguồn của chuỗi bugfix #151→#154→#160→#161→#171)
// bằng phân loại theo LOẠI NODE acorn: một chuỗi là "văn xuôi cần dịch" hay "khoá dữ liệu phải
// giữ/đổi-theo-từ-điển" được quyết định bởi VỊ TRÍ CỦA NÓ TRONG CÂY CÚ PHÁP, không phải bởi
// việc nó "trông giống câu văn hay không".
//
// Nguyên tắc giữ nguyên từ các bugfix cũ (mục 5 của đề bài — không được phá):
//   • Định danh trần (const 配置, tham chiếu biến) KHÔNG BAO GIỜ dịch (bug 128) — kể cả có
//     trong từ điển, vì đổi một chỗ mà không đổi mọi tham chiếu là SyntaxError/lệch scope.
//   • Khoá dữ liệu (object key / dot-notation / obj['键'] / chuỗi đường dẫn 'a.b.c') CHỈ đổi
//     theo Từ Điển user đã chốt, không bao giờ hỏi AI (bug 151/154).
//   • Regex literal không đụng — pass alternation riêng lo (giữ nhánh Hán, thêm nhánh Việt).
//   • Token phải cân ngoặc toàn giác (bug 178), giữ nguyên tiền tố ASCII của khoá (bug 151),
//     khoá trộn CJK+ASCII là MỘT token (bug 171), biết dấu nháy đang bao chuỗi (bug 161).
//
// Cùng một bộ phân loại này được dùng LẦN HAI trên bản dịch (Hạng mục C/F): token sót lại
// thuộc loại nào thì báo cáo đúng nhóm đó — "khoá dữ liệu còn Hán" tách khỏi "văn xuôi sót".
import * as acorn from 'acorn';
import { firstUnbalancedBracket, type CJKToken } from '../utils/surgical';

// ═══════════════════════════════════════════════════════════════════════════════
// Kiểu dữ liệu
// ═══════════════════════════════════════════════════════════════════════════════

/** Node acorn nhìn qua lăng kính "đủ dùng" — không kéo @types/estree vào chỉ để walk. */
export interface AnyNode {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

export type DataKeyKind = 'objectKey' | 'dotNotation' | 'bracketKey' | 'pathSeg';

/** Một khoá dữ liệu CJK tìm thấy trong script — đơn vị của phép kiểm coverage (Hạng mục B). */
export interface DataKeyInfo {
  /** Phần Hán thuần (đã bỏ tiền/hậu tố ASCII) — đúng dạng user nhập vào Từ Điển. */
  name: string;
  kind: DataKeyKind;
  count: number;
  /** Vị trí xuất hiện đầu tiên — để UI trỏ user tới đúng chỗ. */
  firstAt: number;
}

/** Định danh trần chứa CJK được GIỮ NGUYÊN có chủ đích (bug 128) — báo cáo, không phải lỗi. */
export interface KeptIdentifier {
  name: string;
  count: number;
  firstAt: number;
}

export interface AstExtractResult {
  tokens: CJKToken[];
  dataKeys: DataKeyInfo[];
  keptIdentifiers: KeptIdentifier[];
  /** Khoảng [start,end) của các regex literal — CJK trong đó do pass alternation xử lý. */
  regexRanges: Array<[number, number]>;
  sourceType: 'module' | 'script';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parse
// ═══════════════════════════════════════════════════════════════════════════════

export interface ParsedAst {
  ast: AnyNode;
  comments: Array<{ start: number; end: number; text: string; block: boolean }>;
  sourceType: 'module' | 'script';
}

/** Parse thử module trước (bundle TavernHelper hay có import/export), rớt thì script. */
export function parseAnyAst(code: string): ParsedAst | null {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      const comments: ParsedAst['comments'] = [];
      const ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType,
        allowReturnOutsideFunction: sourceType === 'script',
        onComment: (block, text, start, end) => comments.push({ block, text, start, end }),
      }) as unknown as AnyNode;
      return { ast, comments, sourceType };
    } catch { /* thử kiểu sau */ }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hằng dùng chung (cùng bảng chữ với surgical.ts — hai bên phải nhìn CJK giống nhau)
// ═══════════════════════════════════════════════════════════════════════════════

const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3040-\\u30ff\\uac00-\\ud7af\\uff65-\\uffdc';
const CPUNCT = '\\u2013\\u2014\\u2018-\\u201d\\u2026\\u3001\\u3002\\u3008-\\u3011\\u3014-\\u301b\\uff01\\uff08\\uff09\\uff0c\\uff0e\\uff1a\\uff1b\\uff1f\\uff5e';
const HAS_IDEOGRAPH = /[一-鿿㐀-䶿぀-ヿ가-힯]/;
const CJK_LETTER = /[一-鿿㐀-䶿぀-ヿ가-힯]/;
/** Run văn xuôi: cụm CJK nối qua dấu câu toàn giác/số — y hệt bộ gom của surgical. */
const PROSE_RUN_RE = new RegExp(`[${CJK}]+(?:[${CPUNCT} \\t0-9.\\-_%]+[${CJK}]+)*`, 'g');
/** Một đoạn của đường dẫn dữ liệu: cho tiền/hậu tố ASCII, PHẢI có chữ Hán, không khoảng trắng. */
const PATH_SEG_RE = /^[\w$]*[一-鿿㐀-䶿぀-ヿ가-힯][\w$一-鿿㐀-䶿぀-ヿ가-힯]*$/;
/** URL/data-URI bên trong chuỗi — CJK trong đường dẫn file tuyệt đối không được dịch. */
const URL_RE = /(?:https?|ftp):\/\/[^\s'"<>(){}\]]+|data:[a-zA-Z0-9+/.-]+;[^\s'"<>)]+|(?:\.\.?\/)[^\s'"<>(){}\]]+/g;

/** Bỏ tiền/hậu tố ASCII của một tên khoá — dạng Hán thuần user nhập vào Từ Điển. */
export const stripAsciiAffixes = (name: string): string =>
  name.replace(/^[\w$]+/, '').replace(/[\w$]+$/, '');

/**
 * Chuỗi có PHẢI đường dẫn dữ liệu không ('世界运转.天气', '军事.各营._编制').
 * Chuẩn kế thừa từ bug 151/154: 2-6 đoạn, mỗi đoạn ≤14 ký tự có chữ Hán, không bắt đầu bằng số
 * — đủ hẹp để văn xuôi "3.5 mét" hay "1. Mục lục" không lọt.
 */
export function looksLikeDataPath(s: string): boolean {
  if (!s.includes('.')) return false;
  const seg = s.split('.');
  return (
    seg.length >= 2 && seg.length <= 6 &&
    seg.every((p) => p.length >= 1 && p.length <= 14 && PATH_SEG_RE.test(p) && !/^[0-9]/.test(p))
  );
}

/**
 * Callee có phải hàm truy cập dữ liệu không, và KHOÁ nằm ở tham số thứ mấy.
 * (review 187) Bản đầu đòi arg ≥ 1 cho MỌI hàm — nhưng getvar('key')/setvar('key', v) để khoá
 * ở arg 0, nên chính dạng phổ biến nhất lại lọt lưới và bị coi là văn xuôi gửi AI.
 * Trả về chỉ số arg chứa khoá, hoặc null nếu không phải hàm dữ liệu.
 */
function dataCallKeyArgIndex(callee: AnyNode | undefined): number | null {
  if (!callee) return null;
  const VAR_FN = /^(?:get|set|add|inc|dec|insert)(?:Global|Local|Message)?[Vv]ar(?:iables?)?$/;
  if (callee.type === 'MemberExpression') {
    const prop = callee.property as AnyNode | undefined;
    const name = prop?.type === 'Identifier' ? String(prop.name) : '';
    if (['get', 'set', 'unset', 'has'].includes(name)) return 1;  // _.get(obj, 'path')
    if (VAR_FN.test(name)) return 0;                              // helper.getvar('key')
    return null;
  }
  if (callee.type === 'Identifier') {
    return VAR_FN.test(String(callee.name)) ? 0 : null;           // getvar('key')
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Walk có cha (parent) — phân loại theo vị trí node
// ═══════════════════════════════════════════════════════════════════════════════

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'regex']);

function walkWithParent(node: AnyNode, parent: AnyNode | null, cb: (n: AnyNode, p: AnyNode | null) => void): void {
  cb(node, parent);
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v) {
        if (c && typeof c === 'object' && typeof (c as AnyNode).type === 'string') {
          walkWithParent(c as AnyNode, node, cb);
        }
      }
    } else if (v && typeof v === 'object' && typeof (v as AnyNode).type === 'string') {
      walkWithParent(v as AnyNode, node, cb);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trích token
// ═══════════════════════════════════════════════════════════════════════════════

interface RawToken extends Omit<CJKToken, 'id'> { kind?: DataKeyKind }

/**
 * Bóc run văn xuôi trong một đoạn nội dung (thân chuỗi / quasi template / comment).
 * `offset` = vị trí của `content` trong code gốc. Có 3 lưới kế thừa:
 *   • bug 178 — token phải cân ngoặc toàn giác;
 *   • URL — CJK trong URL/đường dẫn file bị bỏ qua;
 *   • class=/id=/selector — chuỗi HTML/CSS nhúng: run ngay sau các mẫu đó là mã, không dịch.
 */
function extractProseRuns(
  content: string,
  offset: number,
  quote: "'" | '"' | undefined,
  out: RawToken[],
): void {
  if (!HAS_IDEOGRAPH.test(content)) return;

  const urlZones: Array<[number, number]> = [];
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(content); m; m = URL_RE.exec(content)) {
    urlZones.push([m.index, m.index + m[0].length]);
  }

  PROSE_RUN_RE.lastIndex = 0;
  for (let m = PROSE_RUN_RE.exec(content); m; m = PROSE_RUN_RE.exec(content)) {
    let text = m[0];
    let start = m.index;
    if (!HAS_IDEOGRAPH.test(text)) continue;
    if (urlZones.some(([s, e]) => start < e && start + text.length > s)) continue;

    // HTML attr nhúng trong chuỗi JS: class="中文" — dịch có dấu cách là selector chết.
    const before = content.slice(Math.max(0, start - 40), start);
    const isHtmlAttr = /(?:class|id|name|for|data-[a-zA-Z0-9_-]+)\s*=\s*["'][^"']*$/.test(before);
    // Selector '.中文'/'#中文'/'div.中文': dấu . hoặc # phải DÍNH LIỀN run, và ký tự trước dấu
    // không phải chữ số ("1. 中文" là văn xuôi đánh số) hay chữ Hán ("他说.中文" là văn xuôi).
    const prevPrev = before.slice(-2, -1);
    const isCssClass = !isHtmlAttr && /[.#]$/.test(before)
      && !/[0-9]/.test(prevPrev) && !CJK_LETTER.test(prevPrev);

    // (bug 178) Cắt ở dấu ngoặc lẻ đầu tiên — nửa cặp ngoặc không được rời nội dung.
    const cut = firstUnbalancedBracket(text);
    if (cut === 0) continue;
    if (cut > 0) text = text.slice(0, cut);

    out.push({
      text,
      start: offset + start,
      end: offset + start + text.length,
      isIdentifier: isHtmlAttr || isCssClass,
      isDotNotation: false,
      isObjectKey: false,
      isCssClass,
      isHtmlAttr,
      ...(quote ? { inStringQuote: quote } : {}),
    });
    // Phần sau dấu cắt để vòng exec sau quét tiếp
    if (cut > 0) PROSE_RUN_RE.lastIndex = m.index + cut + 1;
  }
}

/**
 * Trích token CJK từ script bằng AST. Trả null nếu code không parse được —
 * caller rơi về bộ trích regex cũ (extractCJKTokens) và báo rõ trong report.
 */
export function extractTokensAst(
  code: string,
  dict?: Record<string, string>,
): AstExtractResult | null {
  const parsed = parseAnyAst(code);
  if (!parsed) return null;

  const raw: RawToken[] = [];
  const dataKeyMap = new Map<string, DataKeyInfo>();
  const keptMap = new Map<string, KeptIdentifier>();
  const regexRanges: Array<[number, number]> = [];
  /** [start,end) đã phát token khoá — chuỗi path/key không được extractProseRuns quét lại. */
  const claimed: Array<[number, number]> = [];

  const noteDataKey = (name: string, kind: DataKeyKind, at: number): void => {
    const core = stripAsciiAffixes(name) || name;
    if (!CJK_LETTER.test(core)) return;
    const cur = dataKeyMap.get(core);
    if (cur) cur.count++;
    else dataKeyMap.set(core, { name: core, kind, count: 1, firstAt: at });
  };

  const noteKept = (name: string, at: number): void => {
    const cur = keptMap.get(name);
    if (cur) cur.count++;
    else keptMap.set(name, { name, count: 1, firstAt: at });
  };

  /** Token khoá từ MỘT tên (identifier hoặc nội dung chuỗi): bỏ tiền tố ASCII ra ngoài token
   *  (reinsert tự ghép lại — đúng khuôn bug 151), giữ ASCII giữa/cuối trong token (bug 171).
   *  `range` (tuỳ chọn) = vùng thay THẬT trên source khi nó KHÁC với vị trí tên cooked —
   *  dùng cho định danh viết bằng \uXXXX escape và khoảng trắng giữa dấu chấm với tên;
   *  khi đó vùng thay nuốt cả tiền tố nên bản dịch phải TỰ mang tiền tố theo. */
  const pushKeyToken = (
    fullName: string, fullStart: number, kind: DataKeyKind,
    flags: { isDotNotation?: boolean; isObjectKey?: boolean; inStringQuote?: "'" | '"' },
    range?: { start: number; end: number },
  ): void => {
    const prefix = /^[\w$]+/.exec(fullName)?.[0] ?? '';
    const text = fullName.slice(prefix.length);
    if (!CJK_LETTER.test(text)) return;
    const core = stripAsciiAffixes(fullName) || text;
    const trailing = text.slice(core.length);
    // (review 187) Thứ tự tra: TÊN ĐẦY ĐỦ trước — mục user nhập đích danh phải thắng; sau đó
    // mới tới phần Hán thuần và phải GHÉP LẠI hậu tố ASCII. Tra core mà nuốt hậu tố thì
    // 魔力值2 và 魔力值 cùng đổ về MỘT tên dịch: hai khoá khác nhau ghi/đọc chung một ô,
    // dữ liệu hỏng âm thầm — đúng lớp lỗi bug 151/171 cấm.
    const exact = dict?.[text] ?? dict?.[fullName];
    const coreHit = dict?.[core];
    const hit = exact ?? (coreHit !== undefined ? coreHit + trailing : undefined);
    // Mục identity (nguồn = đích) nghĩa là user CHỐT GIỮ nguyên khoá này — không thay gì.
    const translated = hit !== undefined && hit !== text ? hit : undefined;
    const start = range ? range.start : fullStart + prefix.length;
    const end = range ? range.end : fullStart + prefix.length + text.length;
    raw.push({
      text,
      start,
      end,
      isIdentifier: true,
      isDotNotation: !!flags.isDotNotation,
      isObjectKey: !!flags.isObjectKey,
      isCssClass: false,
      isHtmlAttr: false,
      kind,
      ...(flags.inStringQuote ? { inStringQuote: flags.inStringQuote } : {}),
      ...(translated ? { translated: range ? prefix + translated : translated, fromDictionary: true } : {}),
    });
    noteDataKey(fullName, kind, start);
    claimed.push(range ? [range.start, range.end] : [fullStart, fullStart + fullName.length]);
  };

  /** Chuỗi đường dẫn 'a.b.c' (trong nháy): mỗi đoạn một token dict-only, dấu chấm bất khả xâm. */
  const pushPathTokens = (content: string, contentStart: number, quote: "'" | '"' | undefined): void => {
    let pos = contentStart;
    for (const seg of content.split('.')) {
      if (CJK_LETTER.test(seg)) {
        pushKeyToken(seg, pos, 'pathSeg', { inStringQuote: quote });
      }
      pos += seg.length + 1;
    }
    claimed.push([contentStart, contentStart + content.length]);
  };

  walkWithParent(parsed.ast, null, (node, parent) => {
    // ── Regex literal: vùng cấm của extractor, pass alternation lo ──
    if (node.type === 'Literal' && (node as { regex?: unknown }).regex) {
      regexRanges.push([node.start, node.end]);
      return;
    }

    // ── Identifier chứa CJK ──
    if (node.type === 'Identifier' && CJK_LETTER.test(String(node.name ?? ''))) {
      const name = String(node.name);
      // (review 187) Định danh viết dạng \uXXXX escape (esbuild --charset=ascii): tên cooked
      // 2 ký tự nhưng raw chiếm 12 — đo vùng thay bằng độ dài cooked là cắt giữa escape,
      // rename xong ra `obj['X']9b54力` vỡ cú pháp. Escaped → thay TRỌN raw span của node.
      const escaped = code.slice(node.start, node.end) !== name;
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) {
        // obj.中文 — thuộc tính: đổi được (bracket-wrap), CHỈ theo từ điển.
        // (review 187) `obj. 中文` / `obj.\n中文`: khoảng trắng giữa dấu chấm và tên phải bị
        // NUỐT vào vùng thay — không thì reinsert nhét nó vào TRONG nháy ⇒ obj[' Tên'],
        // sai khoá âm thầm (hoặc vỡ cú pháp với xuống dòng).
        let wsStart = node.start;
        while (wsStart > 0 && /\s/.test(code[wsStart - 1])) wsStart--;
        if (escaped || wsStart < node.start) {
          pushKeyToken(name, node.start, 'dotNotation', { isDotNotation: true },
            { start: Math.min(wsStart, node.start), end: node.end });
        } else {
          pushKeyToken(name, node.start, 'dotNotation', { isDotNotation: true });
        }
      } else if (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) {
        // {中文: …} — khoá object: đổi được (quote-wrap), CHỈ theo từ điển.
        if (escaped) pushKeyToken(name, node.start, 'objectKey', { isObjectKey: true }, { start: node.start, end: node.end });
        else pushKeyToken(name, node.start, 'objectKey', { isObjectKey: true });
      } else {
        // Định danh trần (khai báo/tham chiếu/shorthand/param) — bug 128: GIỮ NGUYÊN tuyệt đối.
        noteKept(name, node.start);
        claimed.push([node.start, node.end]);
      }
      return;
    }

    // ── String literal ──
    if (node.type === 'Literal' && typeof node.value === 'string') {
      // (review 187) Literal khổng lồ chứa sourcemap nhúng (sourcesContent = source gốc làm
      // DATA) → giữ nguyên, không bóc đi dịch — tốn token mà runtime không dùng. Đường regex
      // cũ có zone này (collectProtectZones), đường AST phải giữ y hệt.
      if (node.end - node.start > 2000) {
        const head = code.slice(node.start, node.start + 4000);
        if (head.includes('sourcesContent') || head.includes('"version":3') || head.includes('\\"version\\":3')) return;
      }
      const q = code[node.start];
      const quote: "'" | '"' | undefined = q === "'" || q === '"' ? q : undefined;
      const contentStart = node.start + 1;
      const content = code.slice(contentStart, node.end - 1);
      const value = String(node.value);

      if (parent?.type === 'Property' && parent.key === node && !parent.computed) {
        // {'中文': …} — khoá đã có nháy sẵn: thay thẳng nội dung theo từ điển.
        if (CJK_LETTER.test(content)) {
          pushKeyToken(content, contentStart, 'objectKey', { isObjectKey: true, inStringQuote: quote });
        }
        return;
      }
      if (parent?.type === 'MemberExpression' && parent.property === node && parent.computed) {
        // obj['中文'] — khoá bracket: thay thẳng nội dung theo từ điển.
        if (CJK_LETTER.test(content)) {
          pushKeyToken(content, contentStart, 'bracketKey', { inStringQuote: quote });
        }
        return;
      }
      // '_.get(t, "a.b.c")' / getvar('key') hoặc chuỗi có DÁNG đường dẫn → tách đoạn, dict-only.
      // (review 187) Khoá phải nằm ĐÚNG vị trí arg của từng loại hàm: _.get để ở arg 1,
      // getvar/setvar để ở arg 0 — đòi arg ≥ 1 đồng loạt là chính getvar bị bỏ lưới.
      const keyArgIdx = parent?.type === 'CallExpression' && Array.isArray(parent.arguments)
        ? dataCallKeyArgIndex(parent.callee as AnyNode)
        : null;
      const inDataCall = keyArgIdx !== null && (parent!.arguments as AnyNode[]).indexOf(node) === keyArgIdx;
      if (looksLikeDataPath(value) || (inDataCall && PATH_SEG_RE.test(value))) {
        pushPathTokens(content, contentStart, quote);
        return;
      }
      // Còn lại: VĂN XUÔI — thứ duy nhất được gửi cho AI.
      extractProseRuns(content, contentStart, quote, raw);
      return;
    }

    // ── Template literal: chỉ phần quasi là văn xuôi; ${…} là code, walk tự xử ──
    if (node.type === 'TemplateElement') {
      const rawStr = code.slice(node.start, node.end);
      // Sourcemap nhúng trong template literal — cùng luật với string literal ở trên.
      if (rawStr.length > 2000) {
        const head = rawStr.slice(0, 4000);
        if (head.includes('sourcesContent') || head.includes('"version":3') || head.includes('\\"version\\":3')) return;
      }
      extractProseRuns(rawStr, node.start, undefined, raw);
      return;
    }
  });

  // ── Comment: văn xuôi thuần (marker // /* là ASCII nên regex tự né) ──
  for (const c of parsed.comments) {
    if (c.text.includes('sourceMappingURL=')) continue;
    extractProseRuns(code.slice(c.start, c.end), c.start, undefined, raw);
  }

  // Run văn xuôi có thể quét TRÙNG vùng đã phát token khoá/đường dẫn (chuỗi path cũng khớp
  // PROSE_RUN_RE)? Không — path/key string RETURN trước khi tới extractProseRuns. Nhưng cẩn
  // tắc: lọc mọi token văn xuôi giẫm lên vùng đã claim (định danh trần, khoá, path).
  const isProse = (t: RawToken) => !t.isIdentifier && !t.isObjectKey && !t.isDotNotation;
  const tokens = raw
    .filter((t) => !(isProse(t) && claimed.some(([s, e]) => t.start < e && t.end > s)))
    .sort((a, b) => a.start - b.start)
    .map((t, i) => {
      const { kind: _kind, ...rest } = t;
      return { id: i + 1, ...rest } as CJKToken;
    });

  return {
    tokens,
    dataKeys: [...dataKeyMap.values()].sort((a, b) => b.count - a.count),
    keptIdentifiers: [...keptMap.values()].sort((a, b) => b.count - a.count),
    regexRanges,
    sourceType: parsed.sourceType,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// (Hạng mục B) Coverage Từ Điển khoá
// ═══════════════════════════════════════════════════════════════════════════════

export interface DictCoverage {
  total: number;
  covered: number;
  /** Khoá dữ liệu CHƯA có bản dịch trong Từ Điển — phải chặn và liệt kê đích danh. */
  missing: DataKeyInfo[];
  /** Mục từ điển có source là khoá nhưng target rỗng — coi như thiếu. */
  emptyTargets: string[];
  /** ≥2 khoá nguồn khác nhau dịch ra CÙNG một tên — chỗ đọc/ghi sẽ tra nhầm nhau (bug 161). */
  collisions: Array<{ target: string; sources: string[] }>;
}

/** Đối chiếu danh sách khoá dữ liệu của script với Từ Điển user đang dùng. */
export function checkDictCoverage(
  dataKeys: DataKeyInfo[],
  glossary: Array<{ source: string; target: string }>,
): DictCoverage {
  const dict = new Map<string, string>();
  for (const g of glossary) {
    const s = g.source.trim();
    if (s) dict.set(s, g.target.trim());
  }
  const missing: DataKeyInfo[] = [];
  const emptyTargets: string[] = [];
  let covered = 0;
  for (const k of dataKeys) {
    const t = dict.get(k.name);
    if (t === undefined) missing.push(k);
    else if (!t) { emptyTargets.push(k.name); missing.push(k); }
    else covered++;
  }
  // Đụng độ: chỉ xét các target được DÙNG cho khoá dữ liệu của script này.
  const keyNames = new Set(dataKeys.map((k) => k.name));
  const byTarget = new Map<string, string[]>();
  for (const [s, t] of dict) {
    if (!t || !keyNames.has(s)) continue;
    const arr = byTarget.get(t) ?? [];
    arr.push(s);
    byTarget.set(t, arr);
  }
  const collisions = [...byTarget.entries()]
    .filter(([, ss]) => ss.length > 1)
    .map(([target, sources]) => ({ target, sources }));
  return { total: dataKeys.length, covered, missing, emptyTargets, collisions };
}
