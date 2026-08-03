// ─── (bug 200 — Hạng mục G) Chuẩn hoá dấu câu CJK cosmetic — theo TỪNG VỊ TRÍ ───
// Sau khi A-F đã lo cấu trúc và nội dung Hán tự, lớp cuối cùng user NHÌN THẤY nhiều nhất là
// dấu câu toàn giác còn sót trong câu văn đã dịch: fixture Status Bar 1.7.5 còn 1108 dấu `。`,
// 38 cặp 「」, 33 dấu `？` — file càng nhiều văn xuôi (thẻ nhân vật nhúng JSON) tỷ lệ càng lớn.
//
// Nguyên tắc sống còn (v3 Hạng mục G): phân loại theo TỪNG VỊ TRÍ, không theo loại ký tự.
// Cùng một ký tự `、` có thể là delimiter dữ liệu ở `.split('、')` (đụng vào là dữ liệu runtime
// không tách lại được) và là dấu phẩy văn xuôi ở chỗ khác. Vì vậy đi bằng AST:
//   • CHỈ chuẩn hoá trong: comment + string literal ở thế VĂN XUÔI.
//   • GIỮ NGUYÊN tuyệt đối: regex literal (không phải string nên tự né), khoá object/bracket,
//     đường dẫn dữ liệu, đối số của split/join/replace/includes/RegExp…, chuỗi KHÔNG có chữ
//     (delimiter trần như '、'), và chuỗi sourcemap khổng lồ.
//   • Bảng đổi chỉ gồm ánh xạ KHÔNG lưỡng nghĩa; dấu nháy đổi sang nháy CONG (“”‘’) chứ không
//     bao giờ sang nháy thẳng ASCII — nháy thẳng có thể đóng sớm chuỗi đang bao (bài học 161).
// Đây là bước hoàn thiện MỀM: đếm và báo, không chặn export.
import {
  parseAnyAst, walkWithParent, dataCallKeyArgIndex, looksLikeDataPath, type AnyNode,
} from './astExtract';

/** Ánh xạ một-một, không lưỡng nghĩa. KHÔNG có `·` (tên riêng "Anna·Koopman" dùng nó làm cấu trúc). */
const PUNCT_MAP: Record<string, string> = {
  '。': '. ', '，': ', ', '：': ': ', '；': '; ', '！': '! ', '？': '? ', '、': ', ',
  '（': ' (', '）': ') ', '【': '[', '】': ']', '〔': '[', '〕': ']',
  '「': '“', '」': '”', '『': '‘', '』': '’', '《': '“', '》': '”',
  '～': '~', '　': ' ',
};
const PUNCT_CHARS = new Set(Object.keys(PUNCT_MAP));
const HAS_LETTER = /[\p{L}]/u;

export interface PunctNormalizeResult {
  code: string;
  /** Số KÝ TỰ đã chuẩn hoá (ở vị trí văn xuôi). */
  normalized: number;
  /** Số ký tự trong nhóm trên được GIỮ NGUYÊN vì vị trí là chức năng (delimiter/khoá/path/regex-arg). */
  keptFunctional: number;
}

/** Đổi dấu trong MỘT đoạn văn xuôi; dọn khoảng trắng đôi do ánh xạ '. ' sinh ra cạnh khoảng trắng sẵn có. */
function swapProse(text: string): { out: string; count: number } {
  let count = 0;
  let out = '';
  for (const ch of text) {
    const rep = PUNCT_MAP[ch];
    if (rep !== undefined) { out += rep; count++; }
    else out += ch;
  }
  if (count > 0) {
    out = out
      .replace(/ {2,}/g, ' ')          // '。 ' + khoảng trắng sẵn → 1 khoảng
      .replace(/ +([)\].,:;!?])/g, '$1') // khoảng trắng mồ côi trước dấu đóng
      .replace(/([([‘“]) +/g, '$1');
    // Mép zone: ánh xạ '。'→'. ' ở cuối chuỗi đẻ ra khoảng trắng đuôi — chỉ cắt khi bản gốc
    // KHÔNG có sẵn khoảng trắng ở mép (có sẵn thì đó là chủ đích của người viết).
    if (!/^\s/.test(text)) out = out.replace(/^ +/, '');
    if (!/\s$/.test(text)) out = out.replace(/ +$/, '');
  }
  return { out, count };
}

const countPunct = (text: string): number => {
  let n = 0;
  for (const ch of text) if (PUNCT_CHARS.has(ch)) n++;
  return n;
};

/** Đối số chuỗi của các hàm mà nội dung là DỮ LIỆU CHỨC NĂNG, không phải văn xuôi. */
const FUNCTIONAL_METHODS = new Set([
  'split', 'join', 'replace', 'replaceAll', 'includes', 'startsWith', 'endsWith',
  'indexOf', 'lastIndexOf', 'match', 'search', 'padStart', 'padEnd',
]);

function isFunctionalArg(parent: AnyNode | null, node: AnyNode): boolean {
  if (!parent) return false;
  if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && Array.isArray(parent.arguments)) {
    const callee = parent.callee as AnyNode | undefined;
    if (callee?.type === 'Identifier' && String(callee.name) === 'RegExp') return true;
    if (callee?.type === 'MemberExpression') {
      const prop = callee.property as AnyNode | undefined;
      const name = prop?.type === 'Identifier' ? String(prop.name) : '';
      if (FUNCTIONAL_METHODS.has(name)) return true;
    }
    // Đối số KHOÁ của hàm dữ liệu (_.get/getvar…) — là đường dẫn, không phải văn xuôi.
    const keyIdx = dataCallKeyArgIndex(callee);
    if (keyIdx !== null && (parent.arguments as AnyNode[]).indexOf(node) === keyIdx) return true;
  }
  return false;
}

/**
 * Chuẩn hoá dấu câu CJK cosmetic trên bản dịch. Không parse được → trả nguyên văn (0/0):
 * không có AST thì không định vị được "vị trí này là văn xuôi hay delimiter", mà đoán mò
 * đúng là cách quay lại thời regex-lookback.
 */
export function normalizeCjkPunctuation(code: string): PunctNormalizeResult {
  const parsed = parseAnyAst(code);
  if (!parsed) return { code, normalized: 0, keptFunctional: 0 };

  interface Zone { start: number; end: number; text: string }
  const proseZones: Zone[] = [];
  let keptFunctional = 0;

  walkWithParent(parsed.ast, null, (node, parent) => {
    if (node.type !== 'Literal' || typeof node.value !== 'string') return;
    const content = code.slice(node.start + 1, node.end - 1);
    if (!countPunct(content)) return;

    // Sourcemap khổng lồ — cùng luật với extractor: dữ liệu, không đụng.
    if (node.end - node.start > 2000) {
      const head = code.slice(node.start, node.start + 4000);
      if (head.includes('sourcesContent') || head.includes('"version":3') || head.includes('\\"version\\":3')) return;
    }

    const isKeyPos =
      (parent?.type === 'Property' && parent.key === node) ||
      (parent?.type === 'MemberExpression' && parent.property === node);
    const functional =
      isKeyPos || looksLikeDataPath(String(node.value)) || isFunctionalArg(parent, node)
      // Chuỗi KHÔNG có chữ nào (chỉ dấu/khoảng trắng) — gần như chắc chắn là delimiter
      // hoặc mảnh ghép nối chuỗi; '、' trần chính là ca v3 cảnh báo.
      || !HAS_LETTER.test(content);

    if (functional) keptFunctional += countPunct(content);
    else proseZones.push({ start: node.start + 1, end: node.end - 1, text: content });
  });

  for (const c of parsed.comments) {
    const text = code.slice(c.start, c.end);
    if (!countPunct(text)) continue;
    if (text.includes('sourceMappingURL=')) continue;
    proseZones.push({ start: c.start, end: c.end, text });
  }

  // Ghép phải-sang-trái để offset không lệch.
  proseZones.sort((a, b) => b.start - a.start);
  let out = code;
  let normalized = 0;
  for (const z of proseZones) {
    const { out: swapped, count } = swapProse(z.text);
    if (!count) continue;
    // Comment BLOCK: ánh xạ ／→/ có thể ghép với '*' sẵn có thành '*/' đóng sớm — bảng hiện
    // tại không đổi ／ nên không xảy ra, nhưng vẫn kiểm bất biến: không được sinh '*/' mới.
    if (z.text.startsWith('/*') && swapped.split('*/').length !== z.text.split('*/').length) continue;
    out = out.slice(0, z.start) + swapped + out.slice(z.end);
    normalized += count;
  }
  return { code: out, normalized, keptFunctional };
}
