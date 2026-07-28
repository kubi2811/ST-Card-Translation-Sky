/**
 * src/lib/ejs/ejsTestMode.ts — (Goal 28/07) TEST MODE: thử điều kiện kích hoạt NGAY TRONG TOOL.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "AI tự đề xuất giá trị thích hợp cho từng cái nó làm để mình nhập vào rồi xem thử
 * Entry nào sẽ kích hoạt/không kích hoạt theo điều kiện vừa tạo — kiểm tra ngay trong tool
 * mà không cần ra chat thật."
 *
 * Hai nửa, đều TẤT ĐỊNH (không tốn call AI):
 *   1. proposeTestValues — đọc code controller vừa sinh, bóc các phép so sánh với biến
 *      (qua khai báo `var _x = getvar('path')`), đề xuất bộ giá trị NGAY TẠI MỐC và LỆCH MỐC
 *      để user thử cả hai phía ranh giới. Giá trị đề xuất đến từ chính điều kiện AI viết ra.
 *   2. simulateActivation — chạy THẬT phần JS trong scriptlet (bóc bằng đúng máy trạng thái
 *      lint của extension) trong sandbox với getvar/activewi/getwi giả, ghi lại entry nào
 *      được bật; entry keyword thì so keys với đoạn chat mẫu; constant luôn bật; disabled
 *      chỉ bật khi có controller gọi tên.
 */
import { ejsToLintableJs } from './stptApi';
import { extractVarDecls } from './ejsCollision';
import type { LorebookEntry } from '../../types';
import { detectActivationMode } from './ejsPlanModel';

// ═══ 1. Đề xuất giá trị thử ═════════════════════════════════════════════════

export interface TestVarProposal {
  /** Đường dẫn biến (như trong getvar). */
  path: string;
  /** Các giá trị đáng thử — lấy từ chính các mốc so sánh trong code. */
  values: Array<string | number | boolean>;
  /** Mốc gốc trong code để user hiểu vì sao đề xuất ("_x >= 3", "_x === 'Kim Đan'"…). */
  fromConditions: string[];
}

const NUM_CMP_RE = (v: string) => new RegExp(`(?<![\\w$])${v}\\s*(===|==|>=|<=|>|<|!==|!=)\\s*(-?\\d+(?:\\.\\d+)?)`, 'g');
const STR_CMP_RE = (v: string) => new RegExp(`(?<![\\w$])${v}\\s*(?:===|==|!==|!=)\\s*(['"\`])([^'"\`]+)\\1`, 'g');

export function proposeTestValues(codes: string[]): TestVarProposal[] {
  const byPath = new Map<string, { values: Set<string | number | boolean>; conds: Set<string> }>();
  const bucket = (path: string) => {
    if (!byPath.has(path)) byPath.set(path, { values: new Set(), conds: new Set() });
    return byPath.get(path)!;
  };

  for (const code of codes) {
    const src = String(code || '');
    // getvar trực tiếp trong so sánh cũng bắt: coi cả `getvar('p')` như một "tên biến".
    const decls = extractVarDecls(src).filter(d => d.source);
    const aliases: Array<{ token: string; path: string }> = [
      ...decls.map(d => ({ token: d.varName, path: d.source })),
      ...[...src.matchAll(/getvar\s*\(\s*['"`]([^'"`]+)['"`][^)]*\)/g)]
        .map(m => ({ token: m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), path: m[1] })),
    ];

    for (const { token, path } of aliases) {
      // decls là identifier trần; alias getvar(...) đã được escape sẵn khi dựng.
      let m: RegExpExecArray | null;
      const nre = NUM_CMP_RE(token);
      while ((m = nre.exec(src)) !== null) {
        const b = bucket(path);
        const n = Number(m[2]);
        // Tại mốc + hai phía ranh giới — thử được cả nhánh đúng lẫn nhánh sai.
        b.values.add(n);
        b.values.add(n - 1);
        b.values.add(n + 1);
        b.conds.add(m[0].trim());
      }
      const sre = STR_CMP_RE(token);
      while ((m = sre.exec(src)) !== null) {
        const b = bucket(path);
        b.values.add(m[2]);
        b.conds.add(m[0].trim());
      }
      // Điều kiện boolean trần `if (_x)` — đề xuất true/false.
      if (/^[A-Za-z_$][\w$]*$/.test(token)) {
        const bre = new RegExp(`if\\s*\\(\\s*!?${token}\\s*\\)`, 'g');
        if (bre.test(src)) {
          const b = bucket(path);
          b.values.add(true);
          b.values.add(false);
          b.conds.add(`if (${token})`);
        }
      }
    }
  }

  return [...byPath.entries()].map(([path, v]) => ({
    path,
    values: [...v.values],
    fromConditions: [...v.conds].slice(0, 6),
  }));
}

// ═══ 2. Mô phỏng kích hoạt ══════════════════════════════════════════════════

export interface SimEntryResult {
  entry: string;
  activated: boolean;
  /** Vì sao — user đọc hiểu ngay. */
  via: string;
}

export interface SimulationReport {
  results: SimEntryResult[];
  /** Lỗi runtime khi chạy controller (nếu có) — code lỗi là phát hiện quý, không nuốt. */
  errors: string[];
  /** Đường dẫn biến controller ĐỌC nhưng user chưa nhập giá trị. */
  missingVars: string[];
}

/** Lấy giá trị theo đường dẫn 'a.b.c' trong object giá trị test (hỗ trợ cả khoá phẳng). */
function lookupVar(values: Record<string, unknown>, path: string): unknown {
  if (path in values) return values[path];
  const noPrefix = path.replace(/^stat_data\./, '');
  if (noPrefix in values) return values[noPrefix];
  // MVU hay lồng [value, "desc"] — không mô phỏng sâu, chỉ khớp khoá phẳng.
  return undefined;
}

/**
 * Chạy các khối controller trong sandbox + phân loại kích hoạt cho TOÀN BỘ entry.
 * `sampleText` — đoạn chat mẫu để so keys của entry keyword (rỗng = không entry keyword nào khớp).
 */
export async function simulateActivation(
  controllerCodes: Array<{ name: string; code: string }>,
  entries: Array<Pick<LorebookEntry, 'id' | 'comment' | 'content' | 'enabled' | 'constant' | 'keys'>>,
  varValues: Record<string, unknown>,
  sampleText = '',
): Promise<SimulationReport> {
  const activated = new Set<string>();
  const errors: string[] = [];
  const missing = new Set<string>();
  const pending: Promise<unknown>[] = [];

  for (const c of controllerCodes) {
    const { js } = ejsToLintableJs(String(c.code || ''));
    if (!js.trim()) continue;

    const getvar = (path: string, opts?: { defaults?: unknown }) => {
      const v = lookupVar(varValues, String(path));
      if (v === undefined) {
        missing.add(String(path));
        return opts?.defaults;
      }
      return v;
    };
    const record = (...args: unknown[]) => {
      const strings = args.filter((a): a is string => typeof a === 'string');
      if (strings.length) activated.add(strings[strings.length - 1].trim().toLowerCase());
      return Promise.resolve(true);
    };
    const noop = () => undefined;
    const sandbox: Record<string, unknown> = {
      getvar,
      getGlobalVar: getvar, getMessageVar: getvar,
      setvar: noop, incvar: noop, decvar: noop, setGlobalVar: noop, setMessageVar: noop,
      activewi: record, activateWorldInfo: record,
      activateWorldInfoByKeywords: (kws: unknown) => {
        // Bật entry tắt có key khớp — mô phỏng đúng ngữ nghĩa extension.
        const list = Array.isArray(kws) ? kws.map(String) : [String(kws)];
        for (const e of entries) {
          if (e.enabled) continue;
          if ((e.keys ?? []).some(k => list.some(w => String(k).toLowerCase().includes(w.toLowerCase())))) {
            activated.add(String(e.comment || `#${e.id}`).trim().toLowerCase());
          }
        }
        return Promise.resolve(true);
      },
      getwi: () => Promise.resolve(''), getWorldInfo: () => Promise.resolve(''),
      getWorldInfoData: () => Promise.resolve(null), getEnabledWorldInfoEntries: () => Promise.resolve([]),
      getChatMessage: () => Promise.resolve(''), getChatMessages: () => Promise.resolve([]),
      matchChatMessages: () => Promise.resolve(false),
      injectPrompt: noop, define: noop, evalTemplate: () => Promise.resolve(''),
      selectActivatedEntries: noop, activateRegex: noop,
      console: { log: noop, warn: noop, error: noop },
    };

    try {
      const keys = Object.keys(sandbox);
      // Async để await trong scriptlet chạy được. Phần code SAU await đầu tiên chạy ở
      // microtask — phải chờ hết mới tổng kết, nếu không sẽ sót activewi thứ hai trở đi.
      const fn = new Function(...keys, `return (async () => {\n${js}\n})();`);
      const p = (fn(...keys.map(k => sandbox[k])) as Promise<unknown>)
        .catch(e => errors.push(`"${c.name}": ${e instanceof Error ? e.message : String(e)}`));
      pending.push(p);
    } catch (e) {
      errors.push(`"${c.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await Promise.all(pending);

  const text = sampleText.toLowerCase();
  const results: SimEntryResult[] = entries.map(e => {
    const name = String(e.comment || `#${e.id}`);
    const mode = detectActivationMode(e as LorebookEntry);
    if (activated.has(name.trim().toLowerCase())) {
      return { entry: name, activated: true, via: 'controller EJS gọi activewi với giá trị đang thử' };
    }
    if (mode === 'constant') return { entry: name, activated: true, via: 'Luôn bật (Constant)' };
    if (mode === 'keyword') {
      const hit = (e.keys ?? []).find(k => String(k).trim() && text.includes(String(k).toLowerCase()));
      return hit
        ? { entry: name, activated: true, via: `từ khoá "${hit}" khớp đoạn chat mẫu` }
        : { entry: name, activated: false, via: sampleText ? 'không từ khoá nào khớp đoạn chat mẫu' : 'chờ từ khoá (chưa nhập đoạn chat mẫu)' };
    }
    if (mode === 'disabled' || mode === 'conditional') {
      return { entry: name, activated: false, via: 'đang tắt và không controller nào bật với giá trị đang thử' };
    }
    return { entry: name, activated: false, via: 'không kích hoạt' };
  });

  return { results, errors, missingVars: [...missing] };
}
