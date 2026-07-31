/**
 * simulateCard.ts — (bugNeedFix/98) BƯỚC MÔ PHỎNG trước khi coi là xong.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "chỉ tạo từ đầu đến cuối mà không có các bước kiểm tra chéo … sửa tay rất cực, thậm chí
 * không biết sửa". Các phép kiểm cũ đều là kiểm TĨNH (có entry chưa, regex compile chưa). Cái
 * chúng không trả lời được là câu hỏi thật sự: *nạp biến khởi tạo lên rồi thì mọi thứ có khớp
 * nhau không* — schema đòi biến A mà initvar chỉ có biến B, EJS đọc biến C chẳng ai khai báo.
 *
 * Ở đây chạy thật một vòng đời rút gọn của card:
 *   1. Đọc [initvar] → dựng stat_data (chấp cả JSON lẫn YAML — bản cũ chỉ chịu JSON nên với thẻ
 *      do chính app sinh, vốn xuất YAML, phép kiểm sâu nhất bị BỎ QUA im lặng).
 *   2. Đối chiếu 2 chiều với schema: biến schema có mà initvar thiếu / initvar có mà schema không
 *      biết (chính là lớp lỗi "4 hệ tên biến không giao nhau").
 *   3. Giả lập Opening Form ghi từng biến lá rồi đọc lại (runFormCycle) — bấm có ăn không.
 *   4. Chạy lệnh trong khối <UpdateVariable> của entry [mvu_update] lên stat_data — lệnh có tác
 *      dụng thật hay chỉ trỏ vào đường dẫn không tồn tại.
 *   5. Soi mọi tham chiếu biến trong EJS/status bar: biến đó có trong stat_data mô phỏng không.
 *
 * Toàn bộ chạy bằng code, không gọi mạng, nên bấm lại bao nhiêu lần cũng được.
 */
import { applyMvuCommands, parseMvuCommands, runFormCycle, readMvuVar } from './mvuHarness';
import { normalizeMVUZODSchema } from './normalizeSchema';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { checkHtmlScripts } from '../scriptSafety';
import { parseYamlScalar } from './yamlScalars';

export interface SimIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface SimulateResult {
  ok: boolean;
  issues: SimIssue[];
  /** stat_data sau khi nạp initvar — để UI cho user xem tận mắt. */
  statData: Record<string, unknown>;
  stats: {
    initVars: number;
    schemaLeaves: number;
    missingInInit: number;
    extraInInit: number;
    formWritesOk: number;
    formWritesFail: number;
    updateOpsApplied: number;
    ejsRefsChecked: number;
    ejsRefsMissing: number;
  };
}

export interface SimulateInput {
  /** Nội dung entry [initvar] (JSON hoặc YAML, có thể còn cả nhãn [initvar]). */
  initVarContent: string;
  schema?: MVUZODSchema | null;
  /** Nội dung các entry [mvu_update] — lấy khối <UpdateVariable> bên trong. */
  updateContents?: string[];
  /** Nội dung EJS / replaceString của status bar — nơi biến được ĐỌC. */
  readerSources?: Array<{ name: string; content: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// YAML (tập con) → object
// ═══════════════════════════════════════════════════════════════════════════

/**
 * (bug 174) Phân giải scalar phải GIỐNG HỆT engine, không phải "gần giống".
 * Bản cũ ở đây chỉ nhận `null` chữ thường và `true/false` chữ thường; `Null` viết hoa thì nó
 * trả về CHUỖI "Null" trong khi YAML thật đọc ra rỗng. Thẻ user (bug 174) khai đúng
 * `'Phả Hệ': Null` ⇒ mô phỏng của tool xanh mượt, còn vào SillyTavern thì Zod đỏ ngay vì enum
 * không có null. Nay dùng chung bộ luật với bên ghi — xem yamlScalars.ts.
 */
const parseScalar = parseYamlScalar;

/**
 * Đọc YAML dạng mà MVU/[initvar] dùng: map lồng theo thụt lề, list `- item`, scalar đơn giản.
 * Cố tình KHÔNG dùng thư viện YAML đầy đủ — chỉ cần đúng tập con này, và không thêm phụ thuộc.
 */
export function parseInitVarYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  // Mỗi mức thụt lề giữ container đang mở + chỗ nó được gắn vào cha (để có thể đổi map ⇄ list).
  const stack: Array<{
    indent: number; node: Record<string, unknown>; lastKey?: string;
    parent?: Record<string, unknown>; parentKey?: string;
  }> = [{ indent: -1, node: root }];

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const noComment = rawLine.replace(/\s+#.*$/, '');
    if (!noComment.trim()) continue;
    const indent = noComment.length - noComment.trimStart().length;
    const line = noComment.trim();
    if (line === '---' || line === '...') continue;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];

    // Phần tử mảng. Hai kiểu thụt lề đều hợp lệ trong YAML:
    //   a:            a:
    //     - x         - x
    // Kiểu trên: `a:` đã mở một map con rỗng ⇒ đổi map con đó thành mảng.
    // Kiểu dưới: item nằm ngang hàng ⇒ gắn vào khoá vừa đọc của chính container này.
    if (line.startsWith('- ')) {
      const item = parseScalar(line.slice(2));
      const isEmptyMap = Object.keys(top.node).length === 0;
      if (top.parent && top.parentKey !== undefined && (isEmptyMap || Array.isArray(top.parent[top.parentKey]))) {
        const cur = top.parent[top.parentKey];
        const arr = Array.isArray(cur) ? cur : [];
        arr.push(item);
        top.parent[top.parentKey] = arr;
      } else if (top.lastKey) {
        const cur = top.node[top.lastKey];
        const arr = Array.isArray(cur) ? cur : [];
        arr.push(item);
        top.node[top.lastKey] = arr;
      }
      continue;
    }

    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim().replace(/^["']|["']$/g, '');
    const rest = m[2].trim();

    if (rest === '') {
      // Mở một map con — nhưng cũng có thể là key rỗng nếu dòng sau thụt bằng/ít hơn.
      const child: Record<string, unknown> = {};
      top.node[key] = child;
      top.lastKey = key;
      stack.push({ indent, node: child, parent: top.node, parentKey: key });
    } else {
      top.node[key] = parseScalar(rest);
      top.lastKey = key;
    }
  }

  return root;
}

/* ═══════════════════════════════════════════════════════════════════════════
   (bugNeedFix/111) DÒNG NHÃN VĂN XUÔI Ở ĐẦU [initvar] — LỖI NUỐT BIẾN
   ─────────────────────────────────────────────────────────────────────────
   Người dùng báo: entry [initvar] mở đầu bằng dòng chữ "[InitVar] Vui lòng không mở", và trong
   trình quản lý biến, biến lớn đầu tiên ("Thế Giới") BIẾN MẤT — thay vào đó là một biến tên
   "[ InitVar ]" ôm hết mấy biến con của nó.

   Đối chiếu source MagVarUpdate (util/common.ts → parseString):
       const json_first = /^[[{]/s.test(content.trimStart());
       if (json_first) throw …            // ← BỎ QUA YAML luôn
       … JSON5.parse → JSON.parse(jsonrepair(content))
   Nội dung bắt đầu bằng "[" khiến MVU tưởng đây là JSON: nó KHÔNG thèm chạy YAML nữa mà đẩy
   thẳng qua `jsonrepair` — bộ này cố "sửa" một khối YAML thành JSON nên băm nát cây biến. Đó
   chính xác là cái tên "[ InitVar ]" lạ hoắc mà user nhìn thấy.

   Kết luận (khớp cách chữa của cộng đồng — "xoá chữ initvar vui lòng không mở đi"):
   nội dung [initvar] phải BẮT ĐẦU THẲNG bằng cây biến, không dòng nhãn/lời dặn nào ở trên.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Một dòng có phải "khoá:" hợp lệ của YAML không (khoá có thể bọc nháy). */
function isYamlMappingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('#') || t === '---') return false;
  return /^(?:'[^']+'|"[^"]+"|[^:#]+?)\s*:(?:\s|$)/.test(t);
}

export interface InitVarPreambleResult {
  content: string;
  /** Các dòng nhãn đã bị bỏ — để log cho user biết mình vừa xoá cái gì. */
  removed: string[];
}

/**
 * Bỏ mọi dòng nhãn/lời dặn nằm TRƯỚC cây biến của [initvar].
 * Chỉ cắt phần ĐẦU và chỉ cắt những dòng KHÔNG phải "khoá:" — thân biến không bị đụng.
 * Nội dung vốn là JSON thuần (`{…}`) thì giữ nguyên: MVU đọc JSON được.
 */
export function stripInitVarPreamble(content: string): InitVarPreambleResult {
  const raw = String(content || '');
  if (!raw.trim()) return { content: raw, removed: [] };

  // JSON thật thì để yên.
  const trimmedAll = raw.trim();
  if (trimmedAll.startsWith('{')) {
    try { JSON.parse(trimmedAll); return { content: raw, removed: [] }; } catch { /* không phải JSON */ }
  }

  const lines = raw.split(/\r?\n/);
  const removed: string[] = [];
  const kept: string[] = [];   // comment YAML (#) và dòng trống — YAML bỏ qua, GIỮ chứ không cắt
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#') || t === '---') { kept.push(lines[i]); i++; continue; }
    if (isYamlMappingLine(t)) break;           // gặp cây biến ⇒ dừng
    removed.push(t);
    i++;
  }
  if (removed.length === 0) return { content: raw, removed: [] };

  return { content: [...kept, ...lines.slice(i)].join('\n').replace(/^\s*\n/, ''), removed };
}

/** Đọc initvar bất kể JSON hay YAML. */
export function parseInitVar(content: string): Record<string, unknown> {
  // (bugNeedFix/111) Bỏ nhãn "[initvar]" và mọi dòng lời dặn ở đầu TRƯỚC khi đọc — đọc y như
  // MVU sẽ đọc sau khi thẻ được sửa đúng chuẩn.
  const noLabel = String(content || '').replace(/\[initvar\]/gi, '');
  const raw = stripInitVarPreamble(noLabel).content.trim();
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch { /* không phải JSON — thử YAML */ }
  return parseInitVarYaml(raw);
}

// ═══════════════════════════════════════════════════════════════════════════
// Đường dẫn lá
// ═══════════════════════════════════════════════════════════════════════════

export function schemaLeafPaths(
  schema: MVUZODSchema,
): Array<{ path: string; value: unknown; type: MVUZODField['type']; constraints?: MVUZODField['constraints'] }> {
  const out: Array<{ path: string; value: unknown; type: MVUZODField['type']; constraints?: MVUZODField['constraints'] }> = [];
  const walk = (fields: MVUZODField[], prefix: string) => {
    for (const f of fields ?? []) {
      const name = String(f.path || '').split('/').filter(Boolean).pop() ?? '';
      if (!name) continue;
      const p = prefix ? `${prefix}.${name}` : name;
      // (bug 155) array/record: children "_child" là KHAI CẤU TRÚC một phần tử, KHÔNG phải biến
      // có thật lúc khởi tạo. `Kho Đồ: []` rỗng thì đương nhiên chưa có `Kho Đồ.Tên` — phần tử
      // chỉ sinh ra khi chơi. Trước bug 148-2 hai kiểu này không có children nên rơi vào nhánh
      // dưới và được miễn; thêm `_child` vào là bộ kiểm đi xuyên rồi đòi cho bằng được ⇒ báo oan
      // "4 biến schema KHÔNG có trong initvar", mà lại là loại "Vá lỗi" không sửa nổi vì chẳng
      // có gì để sửa. Nay chính THÙNG CHỨA là lá: thiếu `Kho Đồ` mới là lỗi thật, và sửa được.
      // `record` là túi khoá động (NPC theo tên…) — không đòi initvar liệt kê sẵn, kể cả chính
      // cái túi. `array` thì NGƯỢC LẠI: phải khai `Kho Đồ: []`, vì EJS `forEach` trên `undefined`
      // là crash và lệnh insert `/-` cần mảng tồn tại sẵn.
      const kids = (f.children ?? []).filter(c => !String(c.path || '').includes('/_child/'));
      if (f.type === 'record') continue;
      if (f.type === 'array') out.push({ path: p, value: f.defaultValue, type: f.type, constraints: f.constraints });
      else if (kids.length) walk(kids, p);
      else out.push({ path: p, value: f.defaultValue, type: f.type, constraints: f.constraints });
    }
  };
  walk(schema.fields ?? [], '');
  return out;
}

function objectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return prefix ? [prefix] : [];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([k, v]) => objectLeafPaths(v, prefix ? `${prefix}.${k}` : k));
}

export interface ReadRef {
  /** Đường dẫn đã bỏ tiền tố `stat_data.` */
  path: string;
  /** Có neo vào stat_data không. `getvar('temp_x')` là biến chat thường — KHÔNG neo. */
  scoped: boolean;
}

/**
 * Biến mà một đoạn EJS / status bar ĐỌC: getvar('stat_data.a.b'), _.get(d, 'a.b'),
 * stat_data.a.b, stat_data['a b'].
 *
 * (bug 174) Hai chỗ từng báo oan, nay chữa:
 *  • Bộ dò `stat_data.a.b` quét cả BÊN TRONG chuỗi đã lấy ở nhánh getvar. Tên biến MVU có dấu
 *    cách ("Người Chơi") nên nó cắt ngang ở khoảng trắng và đẻ ra một biến ma tên "Người". Nay
 *    xoá trắng nội dung mọi chuỗi nháy TRƯỚC khi quét kiểu-JS — trong code JS thật thì
 *    `stat_data.Người Chơi` là cú pháp không tồn tại, chỉ chuỗi mới viết được như vậy.
 *  • Không phân biệt biến MVU với biến chat thường. `getvar('temp_old_vp')` là biến tạm của
 *    chính khối EJS, không thuộc stat_data và không việc gì phải có trong [initvar].
 */
export function extractReadRefs(source: string): ReadRef[] {
  const found = new Map<string, ReadRef>();
  const push = (raw?: string, scopedByForm = false) => {
    const s = (raw || '').trim();
    const scoped = scopedByForm || /^stat_data\./.test(s);
    const v = s.replace(/^stat_data\./, '');
    if (!v || /^\d+$/.test(v)) return;
    const prev = found.get(v);
    if (!prev) found.set(v, { path: v, scoped });
    else if (scoped) prev.scoped = true;
  };
  for (const m of source.matchAll(/getvar\(\s*['"]([^'"]+)['"]/g)) push(m[1]);
  // `_.get(data, 'a.b')` luôn là đọc trên object dữ liệu MVU nên coi như đã neo.
  for (const m of source.matchAll(/_\.get\(\s*[\w$.]*\s*,\s*['"]([^'"]+)['"]/g)) push(m[1], true);

  const noStrings = source.replace(/'[^'\n]*'|"[^"\n]*"/g, (s) => s[0].repeat(s.length));
  for (const m of noStrings.matchAll(/stat_data\s*((?:\.[\p{L}\p{N}_$]+|\[\s*['"][^'"]+['"]\s*\])+)/gu)) {
    push(`stat_data.${m[1].replace(/\[\s*['"]([^'"]+)['"]\s*\]/g, '.$1').replace(/^\./, '')}`);
  }
  // `stat_data['Người Chơi']['Tên']` — nội dung trong ngoặc vừa bị xoá trắng ở trên nên phải quét
  // riêng trên bản gốc. BẮT BUỘC bắt đầu bằng `[`: nếu cho phép mở đầu bằng `.` thì nó lại ăn
  // luôn chuỗi `'stat_data.Người Chơi.Tên'` và cắt ra mảnh ma "Người" — đúng lỗi đang chữa.
  for (const m of source.matchAll(/stat_data\s*(\[\s*['"][^'"\n]+['"]\s*\](?:\[\s*['"][^'"\n]+['"]\s*\]|\.[\p{L}\p{N}_$]+)*)/gu)) {
    push(`stat_data.${m[1].replace(/\[\s*['"]([^'"]+)['"]\s*\]/g, '.$1').replace(/^\./, '')}`);
  }
  return [...found.values()];
}

/** Như trên nhưng chỉ lấy đường dẫn — giữ cho code cũ. */
export function extractReadPaths(source: string): string[] {
  return extractReadRefs(source).map(r => r.path);
}

// ═══════════════════════════════════════════════════════════════════════════
// MÔ PHỎNG
// ═══════════════════════════════════════════════════════════════════════════

export function simulateCard(input: SimulateInput): SimulateResult {
  const issues: SimIssue[] = [];
  const statData = parseInitVar(input.initVarContent);
  const initPaths = objectLeafPaths(statData);

  const stats: SimulateResult['stats'] = {
    initVars: initPaths.length,
    schemaLeaves: 0,
    missingInInit: 0,
    extraInInit: 0,
    formWritesOk: 0,
    formWritesFail: 0,
    updateOpsApplied: 0,
    ejsRefsChecked: 0,
    ejsRefsMissing: 0,
  };

  if (initPaths.length === 0) {
    issues.push({ level: 'error', code: 'sim-initvar-empty',
      message: 'Nạp [initvar] xong mà không ra biến nào — vào game stat_data rỗng, mọi thứ đọc biến đều trắng.' });
  }

  // (bugNeedFix/111) Dòng nhãn/lời dặn nằm trên cây biến — lỗi im lặng nguy hiểm: MVU vẫn nạp
  // được nhưng NUỐT MẤT biến lớn đầu tiên (bắt đầu bằng "[" là parseString bỏ qua YAML, chạy
  // jsonrepair và băm nát cây). Kiểm trên nội dung THÔ, sau khi chỉ bỏ mỗi nhãn [initvar].
  {
    const pre = stripInitVarPreamble(String(input.initVarContent || '').replace(/\[initvar\]/gi, ''));
    if (pre.removed.length > 0) {
      const first = pre.removed[0];
      issues.push({
        level: 'error', code: 'sim-initvar-preamble',
        message: `Entry [initvar] có ${pre.removed.length} dòng chữ nằm TRƯỚC cây biến (“${first.slice(0, 60)}”). `
          + 'MVU đọc cả nội dung như YAML nên dòng này bị hiểu thành một biến, nuốt luôn biến lớn đầu tiên; '
          + (/^\s*[[{]/.test(first)
            ? 'tệ hơn nữa, nội dung bắt đầu bằng “[” khiến MVU bỏ qua YAML và chạy bộ vá JSON, băm nát cả cây biến. '
            : '')
          + 'Xoá các dòng đó đi — nội dung phải bắt đầu thẳng bằng cây biến (lời dặn để ở TÊN entry).',
      });
    }
  }

  /* ─── 1. Đối chiếu 2 chiều initvar ↔ schema ─── */
  const schema = input.schema ? normalizeMVUZODSchema(input.schema) : null;
  if (schema?.fields?.length) {
    const leaves = schemaLeafPaths(schema);
    stats.schemaLeaves = leaves.length;
    const initSet = new Set(initPaths);
    // Prefix của mọi nhánh record/động để không báo oan.
    const missing = leaves.filter(l => !initSet.has(l.path));
    stats.missingInInit = missing.length;
    if (missing.length) {
      issues.push({ level: 'error', code: 'sim-missing-in-initvar',
        message: `${missing.length} biến schema KHÔNG có trong initvar — status bar/EJS đọc ra rỗng: ${missing.slice(0, 6).map(m => m.path).join(' · ')}${missing.length > 6 ? ' …' : ''}` });
    }
    const leafSet = new Set(leaves.map(l => l.path));
    // Biến initvar nằm dưới một nhánh record thì hợp lệ; chỉ báo khi cả prefix cũng lạ.
    const recordPrefixes: string[] = [];
    const collectRecords = (fields: MVUZODField[], prefix: string) => {
      for (const f of fields ?? []) {
        const name = String(f.path || '').split('/').filter(Boolean).pop() ?? '';
        const p = prefix ? `${prefix}.${name}` : name;
        if (f.type === 'record') recordPrefixes.push(p + '.');
        if (Array.isArray(f.children) && f.children.length) collectRecords(f.children, p);
      }
    };
    collectRecords(schema.fields, '');
    const extra = initPaths.filter(p => !leafSet.has(p) && !recordPrefixes.some(rp => p.startsWith(rp)));
    stats.extraInInit = extra.length;
    if (extra.length) {
      issues.push({ level: 'warning', code: 'sim-extra-in-initvar',
        message: `${extra.length} biến có trong initvar nhưng schema không khai báo — Zod sẽ bỏ qua/cắt mất: ${extra.slice(0, 6).join(' · ')}${extra.length > 6 ? ' …' : ''}` });
    }

    /* ─── 1b. (bug 174) GIÁ TRỊ initvar phải THOẢ ràng buộc schema ───
       Chạy đúng phép kiểm mà Zod sẽ chạy lúc SillyTavern nạp thẻ. Trước đây chỗ này chỉ so TÊN
       biến, nên thẻ có đủ 10/10 biến vẫn "xanh" trong khi vào game là đỏ ngay dòng đầu:
         [MVU zod] Invalid option: expected one of "Ignis"|…|"Null" → at ["Người Chơi"]["Phả Hệ"]
       Ca đó sinh từ `'Phả Hệ': Null` không nháy — YAML đọc ra rỗng, enum không nhận. Bắt được
       ở đây thì user thấy lỗi lúc còn đang làm thẻ, chứ không phải sau khi đã nhập vào ST. */
    // readMvuVar cố tình gộp null vào "không có" (tiện cho chỗ khác), mà ở đây null CHÍNH LÀ
    // thứ cần bắt — nên đọc thô, phân biệt rõ "chưa khai" với "khai bằng giá trị rỗng".
    const readRaw = (obj: unknown, path: string): unknown => {
      let cur: unknown = obj;
      for (const part of path.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
      }
      return cur;
    };

    for (const leaf of leaves) {
      const val = readRaw(statData, leaf.path);
      if (val === undefined) continue;                 // thiếu biến đã có chốt riêng ở trên
      if (leaf.type === 'array' || leaf.type === 'record' || leaf.type === 'object') continue;

      const enumValues = leaf.constraints?.enumValues ?? [];
      const say = (what: string, how: string) => issues.push({
        level: 'error', code: 'sim-initvar-value-invalid',
        message: `Biến "${leaf.path}" trong [initvar] ${what} — Zod sẽ chặn ngay lúc nhập thẻ vào SillyTavern ("变量初始化失败"), cả bộ biến không nạp được. ${how}`,
      });

      if (val === null) {
        // Gần như luôn là bẫy YAML: Null/null/NULL/~ để trần thì thành rỗng chứ không phải chữ.
        say('đang là RỖNG (null)',
          enumValues.length
            ? `Nếu ý là chuỗi "${enumValues.find(v => /^null$/i.test(v)) ?? enumValues[0]}" thì phải BỌC NHÁY: 'Phả Hệ': "${enumValues.find(v => /^null$/i.test(v)) ?? enumValues[0]}". YAML coi Null/null/NULL/~ để trần là giá trị rỗng.`
            : 'YAML coi Null/null/NULL/~ để trần là giá trị rỗng — bọc nháy nếu muốn giữ nguyên chữ.');
        continue;
      }
      if (enumValues.length && !enumValues.includes(String(val))) {
        say(`đang là "${String(val)}", không nằm trong danh sách cho phép`,
          `Chỉ được nhận một trong: ${enumValues.map(v => `"${v}"`).join(' | ')}.`);
        continue;
      }
      if (leaf.type === 'number' && typeof val !== 'number') {
        say(`đang là "${String(val)}" (không phải số)`, 'Schema khai kiểu number nên giá trị khởi tạo phải là số, viết trần không nháy.');
        continue;
      }
      if (leaf.type === 'boolean' && typeof val !== 'boolean') {
        say(`đang là "${String(val)}" (không phải boolean)`, 'Chỉ nhận true hoặc false, viết trần không nháy.');
        continue;
      }
      if (leaf.type === 'number' && typeof val === 'number') {
        const { min, max } = leaf.constraints ?? {};
        if (typeof min === 'number' && val < min) say(`đang là ${val}, nhỏ hơn mức tối thiểu ${min}`, 'Sửa lại giá trị khởi tạo cho nằm trong khoảng.');
        else if (typeof max === 'number' && val > max) say(`đang là ${val}, lớn hơn mức tối đa ${max}`, 'Sửa lại giá trị khởi tạo cho nằm trong khoảng.');
      }
    }

    /* ─── 1c. (bug 174) TÊN BIẾN DÍNH KHOẢNG TRẮNG THỪA ───
       Thẻ user có `'Điểm Công Trấn '` — dư một dấu cách ở cuối, và dư ở CẢ schema, Zod, initvar
       lẫn giao diện nên hiện tại vẫn chạy. Nhưng nó là mìn hẹn giờ: AI trong game viết
       `_.set('Người Chơi.Điểm Công Trấn', …)` (không dấu cách) là đẻ ra một biến MỚI nằm cạnh
       biến thật, thanh trạng thái đọc mãi ô cũ không bao giờ đổi. Chính bộ sinh quy tắc của tool
       cũng phải viết một dòng dặn "đích patch bắt buộc giữ khoảng trắng cuối" — dấu hiệu rõ ràng
       là tên biến này cần được cắt gọn ngay từ đầu. */
    {
      const bad = leaves.map(l => l.path.split('.').pop() ?? '').filter(n => n !== n.trim());
      if (bad.length) {
        issues.push({
          level: 'warning', code: 'sim-var-name-space',
          message: `${bad.length} tên biến có khoảng trắng thừa ở đầu/cuối (${bad.map(n => `"${n}"`).join(' · ')}). `
            + 'Hiện vẫn chạy vì mọi nơi đều dư giống nhau, nhưng chỉ cần AI viết lệnh cập nhật thiếu đúng dấu cách '
            + 'đó là một biến MỚI mọc ra bên cạnh, còn thanh trạng thái thì đọc mãi ô cũ. '
            + 'Đổi tên biến bỏ khoảng trắng ở CẢ schema, Zod, [initvar], quy tắc cập nhật và giao diện.',
        });
      }
    }

    /* ─── 2. Giả lập Opening Form: ghi từng biến lá rồi đọc lại ─── */
    const probe = leaves
      .filter(l => initSet.has(l.path) && l.value !== undefined && l.value !== null && typeof l.value !== 'object')
      .slice(0, 40);
    if (probe.length) {
      const cmds = probe
        .map(l => `_.set('${l.path.replace(/'/g, "\\'")}', ${JSON.stringify(l.value)});//sim`)
        .join('\n');
      const cycle = runFormCycle(JSON.stringify(statData), cmds, probe.map(l => ({ path: l.path, expect: l.value })));
      stats.formWritesFail = cycle.problems.length;
      stats.formWritesOk = probe.length - cycle.problems.length;
      if (!cycle.ok) {
        issues.push({ level: 'error', code: 'sim-form-write',
          message: `${cycle.problems.length}/${probe.length} biến ghi vào rồi đọc lại KHÔNG đúng — form sẽ "bấm mà không ăn": ${cycle.problems.slice(0, 3).join(' · ')}` });
      }
    }
  } else {
    issues.push({ level: 'info', code: 'sim-no-schema', message: 'Card không có schema MVU — bỏ qua đối chiếu schema.' });
  }

  /* ─── 3. Chạy thật lệnh trong <UpdateVariable> ───
     (bug 174) Entry "[mvu_update]Định dạng đầu ra biến" chứa KHUÔN MẪU cho AI điền —
     `{ "op": "replace", "path": "${/đường/dẫn/tới/biến}" }`. Đó là chỗ trống, không phải lệnh.
     Đem khuôn mẫu đi chạy thì đương nhiên không đổi được biến nào, rồi báo "khối UpdateVariable
     không đổi được biến nào" — một dòng đỏ vô nghĩa trên MỌI thẻ đúng chuẩn. */
  const isTemplateBlock = (c: string) => /\$\{[^}]*\}/.test(c) || /\$\([^)]*\)/.test(c);
  const updates = (input.updateContents ?? [])
    .filter(c => /<UpdateVariable>/i.test(c))
    .filter(c => !isTemplateBlock(c));
  if (updates.length) {
    const working = JSON.parse(JSON.stringify(statData)) as Record<string, unknown>;
    let applied = 0;
    const badPaths: string[] = [];
    for (const u of updates) {
      // Kiểm TRƯỚC khi áp: `_.set` (như lodash) tự tạo khoá lá còn thiếu, nên nếu chỉ nhìn kết
      // quả áp thì lệnh trỏ vào biến không tồn tại vẫn "thành công" — đúng cái bẫy làm biến mới
      // mọc ra ngoài schema, status bar không bao giờ đọc tới.
      for (const cmd of parseMvuCommands(u)) {
        const p = String(cmd.args[0] ?? '');
        if (p && readMvuVar(working, p, undefined) === undefined) {
          badPaths.push(`${cmd.type} "${p}" — biến này không có trong initvar`);
        }
      }
      const res = applyMvuCommands(working, u);
      applied += res.applied;
      for (const f of res.failed) badPaths.push(`${f.command.raw.slice(0, 60)} — ${f.reason}`);
    }
    stats.updateOpsApplied = applied;
    // (bug 174) Chỉ kêu "không đổi được biến nào" khi thật sự CÓ lệnh để chạy. Entry
    // "[mvu_update]Nhấn mạnh định dạng đầu ra" chỉ có `<UpdateVariable>\n...\n</UpdateVariable>`
    // — dấu ba chấm là chỗ trống nhắc AI, không phải lệnh. Đếm nó là "chạy thử thất bại" thì
    // MỌI thẻ đúng chuẩn đều dính một dòng cảnh báo vô nghĩa.
    const totalCmds = updates.reduce((n, u) => n + parseMvuCommands(u).length, 0);
    if (applied === 0 && totalCmds > 0) {
      issues.push({ level: 'warning', code: 'sim-update-noop',
        message: 'Khối <UpdateVariable> mẫu không đổi được biến nào khi chạy thử — thường là do lệnh trỏ vào đường dẫn không tồn tại trong initvar.' });
    }
    if (badPaths.length) {
      issues.push({ level: 'error', code: 'sim-update-bad-path',
        message: `${badPaths.length} lệnh cập nhật trỏ vào biến không có thật: ${badPaths.slice(0, 4).join(' · ')}` });
    }
  }

  /* ─── 4. EJS / status bar đọc biến có tồn tại không ─── */
  // (bug 174) Gốc của cây biến MVU ("Thế Giới", "Người Chơi"…) — để phân biệt "quên tiền tố
  // stat_data." (lỗi thật, đọc ra rỗng) với "biến chat tạm của chính khối EJS" (như temp_old_vp,
  // chẳng liên quan gì tới initvar). Bộ sinh EJS của tool luôn viết `stat_data.<đường dẫn>`
  // (bridge/mvuzodToEjs.ts) nên thiếu tiền tố là sai, không phải chuyện phong cách.
  const mvuRoots = new Set<string>(Object.keys(statData));
  for (const f of schema?.fields ?? []) {
    const n = String(f.path || '').split('/').filter(Boolean).pop();
    if (n) mvuRoots.add(n);
  }

  for (const src of input.readerSources ?? []) {
    const refs = extractReadRefs(src.content);
    stats.ejsRefsChecked += refs.length;

    const missing = refs
      .filter(r => r.scoped)
      .filter(r => readMvuVar(statData, r.path, undefined) === undefined)
      .map(r => r.path);
    if (missing.length) {
      stats.ejsRefsMissing += missing.length;
      issues.push({ level: 'error', code: 'sim-reader-missing-var',
        message: `"${src.name}" đọc ${missing.length} biến không có trong stat_data mô phỏng — chỗ đó sẽ hiện rỗng/undefined: ${missing.slice(0, 5).join(' · ')}` });
    }

    // Đọc ĐÚNG tên biến MVU nhưng QUÊN tiền tố: getvar('Người Chơi.Cảnh Giới') luôn trả rỗng vì
    // biến MVU nằm dưới stat_data. Rất dễ mắc và không có lỗi đỏ nào lúc chạy.
    const noPrefix = refs.filter(r => !r.scoped && mvuRoots.has(r.path.split('.')[0])).map(r => r.path);
    if (noPrefix.length) {
      issues.push({ level: 'error', code: 'sim-reader-missing-prefix',
        message: `"${src.name}" đọc ${noPrefix.length} biến MVU mà THIẾU tiền tố "stat_data." — getvar sẽ luôn trả về rỗng: ${noPrefix.slice(0, 5).map(p => `getvar('${p}') → getvar('stat_data.${p}')`).join(' · ')}` });
    }

    /* ─── (bug 159-6/7) <script> của giao diện có PARSE ĐƯỢC không, và có ID TRÙNG không ───
     * User: "Opening Form preview trong Regex Lab thì chạy, đưa vào SillyTavern thì bấm nút
     * không được", và chỉ xảy ra sau khi tự thêm biến mới vào schema.
     *
     * Hai lỗ hổng đứng sau chuyện đó:
     *   • `checkHtmlScripts` CHỈ được gọi trong panel preview, KHÔNG chạy trong pipeline hay
     *     bước kiểm tra tổng thể — nên giao diện vỡ JS vẫn vào thẻ mà không ai cảnh báo. Vỡ JS
     *     thì mọi hàm gắn vào onclick không tồn tại ⇒ bấm nút chẳng có gì xảy ra, đúng triệu
     *     chứng, mà lại không có lỗi đỏ nào.
     *   • ID trùng: sanitizeId cắt 30 ký tự và bỏ ký tự lạ, nên "Máu (HP)" với "Máu HP" ra cùng
     *     một id. getElementById lấy phần tử ĐẦU TIÊN ⇒ form đọc/ghi sai trường. Thêm biến mới
     *     là lúc dễ đụng nhất — khớp đúng mục 6.
     * Đặt phép kiểm ở đây vì đây là chỗ DUY NHẤT đã có sẵn nội dung giao diện lúc kiểm tổng thể. */
    const scr = checkHtmlScripts(src.content);
    if (scr.broken > 0) {
      issues.push({ level: 'error', code: 'sim-ui-script-broken',
        message: `"${src.name}" có ${scr.broken}/${scr.total} khối <script> VỠ CÚ PHÁP JS — trong SillyTavern sẽ không hàm nào chạy, bấm nút không phản ứng (preview có thể vẫn trông ổn).` });
    }
    const ids = [...src.content.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m => m[1]);
    const dupIds = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
    if (dupIds.length) {
      issues.push({ level: 'error', code: 'sim-ui-duplicate-id',
        message: `"${src.name}" có ${dupIds.length} id HTML bị TRÙNG — getElementById chỉ thấy phần tử đầu tiên nên form đọc/ghi sai ô: ${dupIds.slice(0, 5).join(' · ')}` });
    }
  }

  return {
    ok: issues.every(i => i.level !== 'error'),
    issues,
    statData,
    stats,
  };
}
