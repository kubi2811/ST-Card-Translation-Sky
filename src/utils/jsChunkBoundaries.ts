// ═══════════════════════════════════════════════════════════════════════════════
// (bug 203) CẮT FIELD JAVASCRIPT THEO CÂY CÚ PHÁP — không phải theo đếm ngoặc.
// ═══════════════════════════════════════════════════════════════════════════════
// Bệnh đo được trên chính schema user gửi (bug/203/message.txt, 29.700 ký tự):
//
//   chunk #0 kết thúc ngay sau `const escapeRegExp = text =>`   ← treo lửng dấu mũi tên
//   chunk #1 kết thúc giữa một object literal, sâu 1 ngoặc nhọn + 2 ngoặc tròn
//
// Nghĩa là MỖI mảnh gửi cho AI đều là một mẩu JS KHÔNG tự đứng được. AI buộc phải đoán,
// và chỉ cần nó đóng hộ một dấu ngoặc hay bỏ một dấu phẩy là bản ghép vỡ cú pháp — đúng
// dòng log user chụp: "Script vỡ cú pháp sau dịch … dòng ~641: Unexpected token". Dịch lại
// thì vẫn cắt y chỗ cũ nên vẫn vỡ y hệt: vòng lặp mà user thấy.
//
// Vì sao cái chốt an toàn cũ (isSafeBoundary) không chặn được? Nó ĐẾM NGOẶC trong cửa sổ
// 10.000 ký tự cuối và chấp nhận "lệch tối đa 2". Ba lỗ hổng cùng lúc:
//   • đếm trong cửa sổ trượt ⇒ độ sâu chỉ là tương đối, file 30K thì mất dấu hoàn toàn;
//   • cho phép sâu tới 2 ⇒ đứng giữa object lồng object vẫn bị coi là "an toàn";
//   • đếm cả ngoặc nằm trong chuỗi và regex (`/[.*+?^${}()|[\]\\]/`) ⇒ số đếm vô nghĩa.
// Và kể cả khi ngoặc CÂN BẰNG thật thì vị trí vẫn có thể ở giữa câu lệnh — ngay sau `=>`
// là ví dụ: cân bằng tuyệt đối, mà cắt vào đó là chết.
//
// Cách chữa: hỏi thẳng bộ phân tích cú pháp. Chỉ cắt ở RANH GIỚI GIỮA HAI NÚT ANH EM
// (hai câu lệnh cấp cao nhất; nếu một câu lệnh vẫn quá dài thì giữa hai thuộc tính của
// object bên trong nó, v.v.). Không bao giờ cắt vào giữa một nút.
import { parse as acornParse } from 'acorn';
import { hasRealJsSignal } from './scriptSafety';

interface Node {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

/** Phân tích cả hai kiểu (module rồi script). Cố ý KHÔNG khử macro `<user>`: khử là lệch
 *  offset, mà ở đây offset chính là thứ ta cần chính xác tuyệt đối. Không parse được thì
 *  trả null và người gọi quay về đường cắt cũ. */
function parseProgram(code: string): Node | null {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return acornParse(code, {
        ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true, allowSuperOutsideMethod: true, allowHashBang: true,
      }) as unknown as Node;
    } catch { /* thử kiểu kế */ }
  }
  return null;
}

const asNode = (v: unknown): Node | null =>
  v && typeof v === 'object' && typeof (v as Node).start === 'number' ? (v as Node) : null;

const nodeList = (v: unknown): Node[] =>
  Array.isArray(v) ? v.map(asNode).filter((n): n is Node => n !== null) : [];

/**
 * Các nút con mà cắt GIỮA chúng là an toàn về cú pháp.
 * Trả null nghĩa là "nút này không chia nhỏ được nữa" — thà để một mảnh quá khổ còn hơn
 * cắt vào giữa nó. Chuỗi/template/regex không có mặt ở đây: không bao giờ cắt vào trong.
 */
function splittableChildren(node: Node): Node[] | null {
  switch (node.type) {
    case 'Program':
    case 'BlockStatement':
    case 'ClassBody':
    case 'StaticBlock':
      return nodeList(node.body);
    case 'ObjectExpression':
      return nodeList(node.properties);
    case 'ArrayExpression':
      return nodeList(node.elements);
    case 'CallExpression':
    case 'NewExpression': {
      const args = nodeList(node.arguments);
      return args.length ? args : null;
    }
    case 'VariableDeclaration': {
      const decls = nodeList(node.declarations);
      return decls.length ? decls : null;
    }
    case 'SwitchStatement':
      return nodeList(node.cases);
    case 'SwitchCase':
      return nodeList(node.consequent);
    default:
      return null;
  }
}

/** Nút "một con duy nhất" — đi xuyên qua để tới chỗ thật sự chia được (vd `const X = z.object({…})`). */
function passThrough(node: Node): Node | null {
  switch (node.type) {
    case 'ExpressionStatement': return asNode(node.expression);
    case 'VariableDeclarator': return asNode(node.init);
    case 'Property': return asNode(node.value);
    case 'MemberExpression': return asNode(node.object);
    case 'AwaitExpression':
    case 'UnaryExpression':
    case 'SpreadElement':
    case 'ReturnStatement':
      return asNode(node.argument);
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'FunctionDeclaration':
      return asNode(node.body);
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      return asNode(node.declaration);
    case 'ChainExpression':
      return asNode(node.expression);
    case 'TSAsExpression':
      return asNode(node.expression);
    default:
      return null;
  }
}

/** Tìm danh sách con chia được gần nhất, đi xuyên qua các nút một-con. */
function resolveChildren(node: Node, guard = 0): Node[] | null {
  if (guard > 24) return null;
  const direct = splittableChildren(node);
  if (direct && direct.length >= 2) return direct;
  // Một con duy nhất (VD `z.object({...})` → đối số duy nhất là object) → đi tiếp xuống.
  const only = direct && direct.length === 1 ? direct[0] : passThrough(node);
  if (only) return resolveChildren(only, guard + 1);
  return null;
}

/**
 * Gom các mốc cắt ứng viên: ranh giới giữa hai nút anh em, ưu tiên cấp cao nhất; chỉ đi
 * sâu vào những nút TỰ NÓ đã dài quá một mảnh.
 */
function collectCandidates(node: Node, maxChars: number, out: number[], depth = 0): void {
  if (depth > 12) return;
  const children = resolveChildren(node);
  if (!children || children.length < 2) return;
  for (let i = 1; i < children.length; i++) out.push(children[i].start);
  for (const child of children) {
    if (child.end - child.start > maxChars) collectCandidates(child, maxChars, out, depth + 1);
  }
}

export interface JsCutPlan {
  /** Vị trí cắt trong chuỗi GỐC, tăng dần. Rỗng = không cần cắt / không cắt được. */
  cuts: number[];
  /** Mảnh dài nhất sau khi cắt — để người gọi biết có mảnh nào quá khổ không. */
  maxPieceLen: number;
}

/**
 * Lập kế hoạch cắt cho một field JavaScript.
 * Trả null khi: không phải JS thật, không parse được, hoặc không tìm được mốc nào —
 * lúc đó người gọi dùng lại thuật toán cắt cũ (văn xuôi/HTML vẫn đi đường cũ y như trước).
 */
export function planJsChunkCuts(code: string, maxChars: number): JsCutPlan | null {
  if (!code || code.length <= maxChars) return null;
  /*
   * Cổng ở đây LỎNG HƠN cổng của chốt cú pháp, có chủ ý — vì cái giá của "nhận nhầm" khác hẳn:
   *   • chốt cú pháp nhận nhầm YAML là JS ⇒ bắt dịch lại vô ích (bugNeedFix/128, rất đắt);
   *   • bộ cắt nhận nhầm ⇒ chỉ là cắt ở ranh giới khác, mà ranh giới đó vẫn là giữa hai "câu
   *     lệnh" nên vẫn an toàn.
   * Nên KHÔNG dùng isLikelyJsScript (đòi ≥5 "dòng code"): một field JS THUẦN DỮ LIỆU như
   *   const BANG_TRA = { …800 dòng "khoá: 'giá trị'," … };
   * không đạt ngưỡng đó, mà lại đúng là loại field cần cắt theo cây nhất. Vẫn giữ hasRealJsSignal
   * để chặn YAML — YAML chữ Hán vô tình parse được như JS (mỗi dòng là labeled statement) nhưng
   * không bao giờ có từ khoá JS thật.
   */
  if (!hasRealJsSignal(code)) return null;

  const program = parseProgram(code);
  if (!program) return null;

  const candidates: number[] = [];
  collectCandidates(program, maxChars, candidates);
  if (!candidates.length) return null;

  const sorted = [...new Set(candidates)].filter((p) => p > 0 && p < code.length).sort((a, b) => a - b);
  if (!sorted.length) return null;

  // Xếp tham: lấy mốc XA NHẤT còn nằm trong hạn mức; không mốc nào vừa (một nút đơn lẻ đã
  // quá khổ) thì đành lấy mốc kế tiếp — mảnh quá khổ vẫn hơn mảnh vỡ cú pháp.
  const cuts: number[] = [];
  let last = 0;
  let best = -1;
  for (const pos of sorted) {
    if (pos - last <= maxChars) { best = pos; continue; }
    if (best > last) { cuts.push(best); last = best; best = -1; }
    if (pos - last <= maxChars) { best = pos; continue; }
    cuts.push(pos);
    last = pos;
    best = -1;
  }
  if (!cuts.length) return null;

  let maxPieceLen = 0;
  let prev = 0;
  for (const c of [...cuts, code.length]) {
    maxPieceLen = Math.max(maxPieceLen, c - prev);
    prev = c;
  }
  return { cuts, maxPieceLen };
}

/** Cắt chuỗi tại các mốc đã cho. Ghép lại phải ra ĐÚNG chuỗi gốc, không thêm bớt ký tự nào. */
export function sliceAtCuts(code: string, cuts: number[]): string[] {
  const out: string[] = [];
  let prev = 0;
  for (const c of cuts) {
    if (c <= prev || c >= code.length) continue;
    out.push(code.slice(prev, c));
    prev = c;
  }
  out.push(code.slice(prev));
  return out.filter((s) => s.length > 0);
}
