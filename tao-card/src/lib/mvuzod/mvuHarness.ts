/**
 * mvuHarness.ts — (Goal 100.2) GIẢ LẬP ĐỦ VÒNG ĐỜI BIẾN MVU, chạy được trong test/final_check.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vòng đời thật trong SillyTavern:  [initvar] → stat_data → Opening Form ghi qua
 * Mvu.parseMessage("_.set(...)") → stat_data ĐỔI → Status Bar đọc lại giá trị MỚI.
 *
 * Trước đây tool không có cách nào chứng minh "card chạy được" ngoài AI review — nên mới có
 * cảnh final_check khen "card đã chơi được" trong khi form bấm không ăn (bug 75/78/#162).
 * Harness này mô phỏng ĐÚNG hành vi engine (đối chiếu source MagVarUpdate,
 * bugNeedFix/mvu-reference/src/function/update_variables.ts):
 *   - lệnh `_.set/_.add/_.insert/_.delete` parse bằng máy đếm ngoặc (không phải regex thô,
 *     nên chuỗi lồng `_.set('a', ["x);"])` không làm gãy);
 *   - biến dạng cặp [giá_trị, "mô tả"] (ValueWithDescription): cập nhật GHI VÀO [0], giữ mô tả;
 *   - giá trị số: chuỗi số tự ép về number (mirror update_variables.ts:791);
 *   - `_.add` cộng dồn số; `_.set(path, old, new)` dạng 3 tham số lấy tham số CUỐI làm giá trị mới.
 *
 * KHÔNG phải bản cài lại đầy đủ engine — chỉ đủ tập lệnh mà generator của tool sinh ra,
 * để làm bài kiểm CHẤP NHẬN: form của card tự tạo phải làm biến đổi thật sự.
 */
import { MVU_DIALECT_RE } from './mvuReference';

/* ─── Đọc biến (mirror mvuGet nhúng trong UI — mvuRuntime.ts) ─── */

const isVWD = (v: unknown): v is [unknown, string] =>
  Array.isArray(v) && v.length === 2 && typeof v[1] === 'string';

/** Bóc cặp [giá_trị, "mô tả"] nếu có — giống engine variable_def.ts:isValueWithDescription. */
export function mvuLeaf(v: unknown): unknown {
  return isVWD(v) ? v[0] : v;
}

/** Đọc theo đường dẫn 'A.B.C' (tên biến tiếng Việt có dấu + khoảng trắng là hợp lệ). */
export function readMvuVar(statData: Record<string, unknown>, path: string, dflt?: unknown): unknown {
  let cur: unknown = statData;
  for (const part of String(path).split('.')) {
    if (cur === null || typeof cur !== 'object') return dflt;
    cur = (cur as Record<string, unknown>)[part];
  }
  const v = mvuLeaf(cur);
  return v === undefined || v === null ? dflt : v;
}

/* ─── Parse lệnh _.set(...) bằng máy đếm ngoặc ─── */

export interface MvuCommand {
  type: 'set' | 'insert' | 'delete' | 'add' | 'assign' | 'remove' | 'move';
  args: unknown[];
  raw: string;
}

/** Tách một literal JS đơn giản (chuỗi nháy đơn/kép, số, true/false/null, mảng/object JSON). */
function parseLiteral(src: string): unknown {
  const s = src.trim();
  if (/^'.*'$/s.test(s)) return s.slice(1, -1).replace(/\\'/g, "'");
  if (/^".*"$/s.test(s)) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  try { return JSON.parse(s); } catch { return s; }
}

/** Tách danh sách tham số ở TẦNG NGOÀI CÙNG (không cắt phẩy nằm trong chuỗi/mảng lồng). */
function splitTopLevelArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (c === quote && inner[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Parse mọi lệnh `_.cmd(...)` trong một đoạn text — máy đếm ngoặc như engine
 * (update_variables.ts:269-380), nên `_.set('a', ["x);"])` vẫn ra đúng MỘT lệnh.
 */
export function parseMvuCommands(text: string): MvuCommand[] {
  const out: MvuCommand[] = [];
  const src = String(text || '');
  const re = /_\.(set|insert|delete|add|assign|remove|move)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    // Đếm ngoặc tới khi cân bằng — bỏ qua ngoặc nằm trong chuỗi.
    let depth = 0, quote: string | null = null, end = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
      if (c === "'" || c === '"') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue; // ngoặc không đóng — bỏ lệnh hỏng
    const inner = src.slice(open + 1, end);
    out.push({
      type: m[1] as MvuCommand['type'],
      args: splitTopLevelArgs(inner).map(parseLiteral),
      raw: src.slice(m.index, end + 1),
    });
    re.lastIndex = end + 1;
  }
  return out;
}

/* ─── Áp lệnh vào stat_data (mirror hành vi ghi của engine) ─── */

function writeAtPath(statData: Record<string, unknown>, path: string, write: (parent: Record<string, unknown>, key: string) => void): boolean {
  const parts = String(path).split('.');
  let cur: Record<string, unknown> = statData;
  for (let i = 0; i < parts.length - 1; i++) {
    const nxt = cur[parts[i]];
    if (nxt === null || typeof nxt !== 'object') return false;
    cur = nxt as Record<string, unknown>;
  }
  write(cur, parts[parts.length - 1]);
  return true;
}

/** Ghi một giá trị: nếu ô hiện tại là cặp [v, "mô tả"] thì chỉ thay [0]; chuỗi số ép number. */
function setValue(parent: Record<string, unknown>, key: string, value: unknown): void {
  const old = parent[key];
  const coerced = typeof old === 'number' || (isVWD(old) && typeof old[0] === 'number')
    ? (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value)
    : value;
  if (isVWD(old)) old[0] = coerced;
  else parent[key] = coerced;
}

export interface ApplyResult {
  applied: number;
  failed: { command: MvuCommand; reason: string }[];
}

/** Áp danh sách lệnh vào stat_data (đột biến tại chỗ như engine). */
export function applyMvuCommands(statData: Record<string, unknown>, text: string): ApplyResult {
  const commands = parseMvuCommands(text);
  const failed: ApplyResult['failed'] = [];
  let applied = 0;

  for (const cmd of commands) {
    const path = String(cmd.args[0] ?? '');
    if (!path) { failed.push({ command: cmd, reason: 'thiếu path' }); continue; }
    let ok = false;
    switch (cmd.type) {
      case 'set': {
        // _.set(path, new) hoặc _.set(path, old, new) — giá trị mới là tham số CUỐI.
        const value = cmd.args[cmd.args.length - 1];
        ok = writeAtPath(statData, path, (p, k) => setValue(p, k, value));
        break;
      }
      case 'add': {
        ok = writeAtPath(statData, path, (p, k) => {
          const cur = Number(mvuLeaf(p[k]));
          const delta = Number(cmd.args[1]);
          if (Number.isFinite(cur) && Number.isFinite(delta)) setValue(p, k, cur + delta);
        });
        break;
      }
      case 'insert':
      case 'assign': {
        ok = writeAtPath(statData, path, (p, k) => {
          const target = mvuLeaf(p[k]);
          const value = cmd.args[cmd.args.length - 1];
          if (Array.isArray(target)) {
            if (cmd.args.length >= 3 && typeof cmd.args[1] === 'number') target.splice(cmd.args[1] as number, 0, value);
            else target.push(value);
          } else if (target && typeof target === 'object' && cmd.args.length >= 3) {
            (target as Record<string, unknown>)[String(cmd.args[1])] = value;
          }
        });
        break;
      }
      case 'delete':
      case 'remove': {
        ok = writeAtPath(statData, path, (p, k) => {
          const target = mvuLeaf(p[k]);
          if (cmd.args.length >= 2 && Array.isArray(target)) {
            const idx = typeof cmd.args[1] === 'number' ? (cmd.args[1] as number) : target.indexOf(cmd.args[1]);
            if (idx >= 0) target.splice(idx, 1);
          } else if (cmd.args.length >= 2 && target && typeof target === 'object') {
            delete (target as Record<string, unknown>)[String(cmd.args[1])];
          } else {
            delete p[k];
          }
        });
        break;
      }
      case 'move':
        ok = false; failed.push({ command: cmd, reason: 'harness chưa mô phỏng _.move' });
        continue;
    }
    if (ok) applied++;
    else failed.push({ command: cmd, reason: 'path không tồn tại trong stat_data' });
  }
  return { applied, failed };
}

/* ─── Bài kiểm ĐỦ VÒNG: initvar → form ghi → status bar đọc ─── */

export interface FormCycleCheck {
  ok: boolean;
  problems: string[];
  /** Giá trị đọc lại được sau khi ghi (path → giá trị) — để test assert cụ thể. */
  after: Record<string, unknown>;
}

/**
 * Chạy trọn vòng đời trên dữ liệu thuần:
 *  1. `initvarJson` (JSON — tập con hợp lệ của những gì parseString engine nhận) → stat_data.
 *  2. Áp `formCommands` (chuỗi `_.set(...)` mà Opening Form sinh ra khi bấm Xác nhận).
 *  3. Đọc lại từng path trong `reads` như Status Bar sẽ đọc — giá trị phải ĐÃ ĐỔI.
 */
export function runFormCycle(
  initvarJson: string,
  formCommands: string,
  reads: { path: string; expect: unknown }[],
): FormCycleCheck {
  const problems: string[] = [];
  let statData: Record<string, unknown>;
  try {
    statData = JSON.parse(initvarJson);
  } catch (e) {
    return { ok: false, problems: [`initvar không parse được: ${e instanceof Error ? e.message : e}`], after: {} };
  }

  const res = applyMvuCommands(statData, formCommands);
  for (const f of res.failed) problems.push(`lệnh thất bại: ${f.command.raw} — ${f.reason}`);
  if (res.applied === 0 && reads.length > 0) problems.push('không lệnh nào được áp — form ghi không ăn');

  const after: Record<string, unknown> = {};
  for (const r of reads) {
    const got = readMvuVar(statData, r.path);
    after[r.path] = got;
    if (got !== r.expect) problems.push(`đọc lại "${r.path}" ra ${JSON.stringify(got)}, muốn ${JSON.stringify(r.expect)}`);
  }
  return { ok: problems.length === 0, problems, after };
}

/* ─── Kiểm SCRIPT form sinh ra có đi đúng đường ghi không ─── */

export interface FormScriptCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Soi mã Opening Form đã sinh: PHẢI ghi qua API Mvu (parseMessage + replaceMvuData),
 * TUYỆT ĐỐI không còn /setvar (kho biến chat của ST — ghi vào đấy stat_data đứng im, bug #162).
 */
export function checkFormWritePath(script: string): FormScriptCheck {
  const s = String(script || '');
  const problems: string[] = [];
  if (/\/setvar\b/.test(s)) problems.push('còn /setvar — ghi vào kho biến chat của ST, stat_data không đổi (bug #162)');
  if (!/parseMessage/.test(s)) problems.push('thiếu Mvu.parseMessage — không có đường ghi biến MVU');
  if (!/replaceMvuData/.test(s)) problems.push('thiếu Mvu.replaceMvuData — parse xong không ghi lại');
  if (!MVU_DIALECT_RE.functionCall.test(s)) problems.push('không sinh lệnh _.set nào — form không có gì để ghi');

  /* ─── (bugNeedFix/114) Ba phép kiểm mới ─── */

  // 1. LỆCH ID: bảng mappings phải trỏ vào ID THẬT của thẻ input (có hậu tố). Đây là gốc rễ
  //    bug 114 — id trần thì `data[m.inputId]` luôn undefined, không ghi được biến nào.
  const mapIds = [...s.matchAll(/"inputId"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  if (mapIds.length > 0) {
    const bare = mapIds.filter(id => !/-(?:slider|input|cards|check|select|textarea)$/.test(id));
    if (bare.length > 0) {
      problems.push(
        `${bare.length}/${mapIds.length} mục trong bảng mappings dùng id TRẦN (${bare.slice(0, 3).join(', ')}` +
        `${bare.length > 3 ? '…' : ''}) — thẻ input thật có hậu tố (-slider/-input/-cards/-check), ` +
        'nên tra ra undefined và không ghi được biến nào (bug 114)',
      );
    }
  }

  // 2. THU THIẾU LOẠI INPUT: form có thanh trượt / checkbox / lưới thẻ mà collectFormData không
  //    quét tới thì mấy field đó không bao giờ có giá trị.
  if (/collectFormData/.test(s)) {
    if (/type=range|type="range"/.test(s) && !/input\[type=range\]/.test(s)) {
      problems.push('form có thanh trượt nhưng collectFormData không quét input[type=range] — giá trị chưa động vào sẽ bị bỏ');
    }
    if (/type=checkbox|type="checkbox"/.test(s) && !/input\[type=checkbox\]/.test(s)) {
      problems.push('form có checkbox nhưng collectFormData không quét input[type=checkbox]');
    }
    if (/stcs-card-grid/.test(s) && !/\.stcs-card-grid/.test(s.replace(/id="[^"]*"/g, ''))) {
      problems.push('form có lưới thẻ lựa chọn nhưng collectFormData không đọc thẻ .selected');
    }
  }

  // 3. THẤT BẠI IM LẶNG: không thu được gì thì phải BÁO, không được `return` êm.
  if (/if\s*\(\s*!\s*cmds\.length\s*\)\s*return\s*;/.test(s)) {
    problems.push('khi không thu được giá trị nào thì hàm thoát IM LẶNG — user tưởng đã lưu (bug 114). Phải log + toast lỗi');
  }

  return { ok: problems.length === 0, problems };
}
