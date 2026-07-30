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

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === '{}') return {};
  if (s === '[]') return [];
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return s;
}

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

export function schemaLeafPaths(schema: MVUZODSchema): Array<{ path: string; value: unknown; type: MVUZODField['type'] }> {
  const out: Array<{ path: string; value: unknown; type: MVUZODField['type'] }> = [];
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
      if (f.type === 'array') out.push({ path: p, value: f.defaultValue, type: f.type });
      else if (kids.length) walk(kids, p);
      else out.push({ path: p, value: f.defaultValue, type: f.type });
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

/** Biến mà một đoạn EJS / status bar ĐỌC: getvar('a.b'), stat_data.a.b, stat_data['a b']. */
export function extractReadPaths(source: string): string[] {
  const found = new Set<string>();
  const push = (p?: string) => {
    const v = (p || '').trim().replace(/^stat_data\./, '');
    if (v && !/^\d+$/.test(v)) found.add(v);
  };
  for (const m of source.matchAll(/getvar\(\s*['"]([^'"]+)['"]/g)) push(m[1]);
  for (const m of source.matchAll(/_\.get\(\s*[\w$.]*\s*,\s*['"]([^'"]+)['"]/g)) push(m[1]);
  for (const m of source.matchAll(/stat_data\s*((?:\.[\p{L}\p{N}_$]+|\[\s*['"][^'"]+['"]\s*\])+)/gu)) {
    const chain = m[1]
      .replace(/\[\s*['"]([^'"]+)['"]\s*\]/g, '.$1')
      .replace(/^\./, '');
    push(chain);
  }
  return [...found];
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

  /* ─── 3. Chạy thật lệnh trong <UpdateVariable> ─── */
  const updates = (input.updateContents ?? []).filter(c => /<UpdateVariable>/i.test(c));
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
    if (applied === 0) {
      issues.push({ level: 'warning', code: 'sim-update-noop',
        message: 'Khối <UpdateVariable> mẫu không đổi được biến nào khi chạy thử — thường là do lệnh trỏ vào đường dẫn không tồn tại trong initvar.' });
    }
    if (badPaths.length) {
      issues.push({ level: 'error', code: 'sim-update-bad-path',
        message: `${badPaths.length} lệnh cập nhật trỏ vào biến không có thật: ${badPaths.slice(0, 4).join(' · ')}` });
    }
  }

  /* ─── 4. EJS / status bar đọc biến có tồn tại không ─── */
  for (const src of input.readerSources ?? []) {
    const paths = extractReadPaths(src.content);
    stats.ejsRefsChecked += paths.length;
    const missing = paths.filter((p) => readMvuVar(statData, p, undefined) === undefined);
    if (missing.length) {
      stats.ejsRefsMissing += missing.length;
      issues.push({ level: 'error', code: 'sim-reader-missing-var',
        message: `"${src.name}" đọc ${missing.length} biến không có trong stat_data mô phỏng — chỗ đó sẽ hiện rỗng/undefined: ${missing.slice(0, 5).join(' · ')}` });
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
