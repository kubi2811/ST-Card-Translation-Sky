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

/**
 * Nút "đi xuyên qua" — nơi tiếp theo đáng nhìn khi bản thân nút này không chia được.
 *
 * (bug 203, vòng 2) PHẢI có CallExpression → callee. Thiếu nó thì cả họ thẻ Zod bị bỏ sót:
 * `export const Schema = z.object({…53K…}).prefault({});` có nút ngoài cùng là lời gọi
 * `.prefault({})` với đối số là object RỖNG. Đi vào đối số là vào ngõ cụt, còn 53K nằm trong
 * CALLEE thì không bao giờ được ngó tới. Đo trên samples/Europe_1351_Card: kế hoạch cắt ra
 * đúng một mảnh 53.038 ký tự — gấp 5,9 lần hạn mức thật của field code (9.000) ⇒ chắc chắn
 * chạm trần token, AI cắt cụt, vỡ cú pháp. Tức là còn tệ hơn đường cắt cũ.
 */
function passThrough(node: Node): Node[] {
  switch (node.type) {
    case 'ExpressionStatement': return [asNode(node.expression)].filter(Boolean) as Node[];
    case 'VariableDeclarator': return [asNode(node.init)].filter(Boolean) as Node[];
    case 'Property': return [asNode(node.value)].filter(Boolean) as Node[];
    case 'MemberExpression': return [asNode(node.object)].filter(Boolean) as Node[];
    case 'CallExpression':
    case 'NewExpression':
      return [asNode(node.callee)].filter(Boolean) as Node[];
    case 'AwaitExpression':
    case 'UnaryExpression':
    case 'SpreadElement':
    case 'ReturnStatement':
      return [asNode(node.argument)].filter(Boolean) as Node[];
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'FunctionDeclaration':
      return [asNode(node.body)].filter(Boolean) as Node[];
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      return [asNode(node.declaration)].filter(Boolean) as Node[];
    case 'ChainExpression':
    case 'TSAsExpression':
      return [asNode(node.expression)].filter(Boolean) as Node[];
    case 'ClassDeclaration':
    case 'ClassExpression':
      return [asNode(node.body)].filter(Boolean) as Node[];
    case 'IfStatement':
      return [asNode(node.consequent), asNode(node.alternate)].filter(Boolean) as Node[];
    case 'ForStatement':
    case 'ForOfStatement':
    case 'ForInStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'LabeledStatement':
      return [asNode(node.body)].filter(Boolean) as Node[];
    case 'TryStatement':
      return [asNode(node.block), asNode(node.handler), asNode(node.finalizer)].filter(Boolean) as Node[];
    case 'CatchClause':
      return [asNode(node.body)].filter(Boolean) as Node[];
    case 'AssignmentExpression':
      return [asNode(node.right)].filter(Boolean) as Node[];
    case 'LogicalExpression':
    case 'BinaryExpression':
      return [asNode(node.left), asNode(node.right)].filter(Boolean) as Node[];
    case 'ConditionalExpression':
      return [asNode(node.consequent), asNode(node.alternate)].filter(Boolean) as Node[];
    default:
      return [];
  }
}

const span = (n: Node): number => n.end - n.start;
const coverage = (list: Node[]): number => list.reduce((s, n) => s + span(n), 0);

/**
 * Tìm danh sách con chia được gần nhất.
 *
 * (bug 203, vòng 2) Luôn ĐI THEO NHÁNH LỚN NHẤT, không theo nhánh đầu tiên. Bản đầu lấy "con
 * duy nhất" nên với `.prefault({})` nó đi vào cái object rỗng rồi bó tay; và khi có ≥2 con thì
 * nó nhận ngay, nên `z.object({…30K…}).refine(fn, msg)` chỉ thu được mốc cắt giữa hai đối số
 * tí hon, còn khối 30K vẫn nguyên khối.
 */
function resolveChildren(node: Node, guard = 0): Node[] | null {
  if (guard > 24) return null;
  const direct = splittableChildren(node) || [];
  const alts = passThrough(node);

  // Danh sách con phủ được phần lớn nút ⇒ cắt giữa chúng là hợp lý nhất.
  if (direct.length >= 2 && coverage(direct) >= span(node) * 0.5) return direct;

  const biggestAlt = alts.length ? alts.reduce((a, b) => (span(b) > span(a) ? b : a)) : null;
  if (direct.length >= 2) {
    // Con thì nhiều nhưng bé tí (đối số của .refine…): nhánh xuyên qua lớn hơn thì đi tiếp.
    if (biggestAlt && span(biggestAlt) > coverage(direct)) {
      const deeper = resolveChildren(biggestAlt, guard + 1);
      if (deeper) return deeper;
    }
    return direct;
  }

  const cands = [...direct, ...alts];
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (span(b) > span(a) ? b : a));
  if (span(best) === 0 || (best.start === node.start && best.end === node.end && best.type === node.type)) return null;
  return resolveChildren(best, guard + 1);
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
  // (bug 203, vòng 2) XẢ nốt mốc còn treo. Thiếu dòng này thì phần ĐUÔI gộp cả đoạn đáng lẽ
  // phải cắt: đo được một mảnh 18.071 ký tự với hạn mức 15.000.
  if (best > last) cuts.push(best);
  if (!cuts.length) return null;

  // Đuôi vụn thì nhập lại vào mảnh trước — mỗi mảnh là MỘT LƯỢT GỌI API, không việc gì phải
  // tốn một lượt cho 46 ký tự (đo được đúng con số đó ở lần chạy thật). Chỉ nhập khi mảnh
  // gộp vẫn nằm trong hạn mức.
  const TINY = Math.max(500, Math.floor(maxChars * 0.05));
  const lastCut = cuts[cuts.length - 1];
  const prevCut = cuts.length >= 2 ? cuts[cuts.length - 2] : 0;
  if (code.length - lastCut < TINY && code.length - prevCut <= maxChars) cuts.pop();
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
