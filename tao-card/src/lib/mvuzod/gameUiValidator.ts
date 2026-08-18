/**
 * src/lib/mvuzod/gameUiValidator.ts — "Cơ chế regex XỊN" cho Game UI Studio
 * ──────────────────────────────────────────────────────────────────────────────
 * Chuỗi kiểm DETERMINISTIC chạy sau mỗi lần AI ghi regex. Kết quả (issues, tiếng Việt +
 * gợi ý sửa) được bơm NGƯỢC cho AI tự sửa ở vòng sau → regex được CHỨNG MINH match
 * trước khi giao cho user, không còn cảnh "nhìn đẹp mà không ăn".
 *
 * THUẦN (không đụng DOM/AI) để test được. Phần "render thật" (V3) do component chạy iframe;
 * validator chỉ trả HTML-đã-thế qua buildRenderableHtml().
 *
 *   V1 — Cú pháp: findRegex compile được, JS trong replaceString parse sạch, field enum đúng.
 *   V2 — MATCH THẬT: findRegex phải match sampleOutput + đủ mọi nhóm $1..$9 mà replaceString dùng.
 *   V4 — KHỚP SCHEMA: biến MVU trong replaceString phải tồn tại trong schema (chống bịa biến).
 */

import { isJsSyntaxOk, extractScriptBodies } from '../scriptSafety';
import { autoFixGameHtml } from './gameHtmlFixer';
import type { RegexScript } from '../../types/regex.types';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';

export type DraftScript = Omit<RegexScript, 'id'>;

export interface ValidationIssue {
  level: 'error' | 'warn';
  code:
    | 'REGEX_SYNTAX' | 'SCRIPT_SYNTAX' | 'PLACEMENT' | 'MEANINGLESS_FLAGS' | 'HTML_QUALITY'
    | 'NO_SAMPLE' | 'NO_MATCH' | 'MISSING_GROUP' | 'UNKNOWN_VAR' | 'NO_VAR_BOUND' | 'EDIT_MISMATCH';
  message: string;      // tiếng Việt, kèm gợi ý sửa
  scriptIndex?: number; // script nào trong regexDraft
}

export interface ValidationReport {
  ok: boolean;          // true = không còn issue mức 'error'
  issues: ValidationIssue[];
}

/** Tách "/pattern/flags" (hoặc plain literal) → RegExp. Trả null nếu cú pháp sai. */
export function parseFindRegex(findRegex: string): { re: RegExp; source: string; flags: string } | null {
  if (!findRegex) return null;
  const m = findRegex.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
  const source = m ? m[1] : findRegex;
  const flags = m ? m[2] : '';
  try {
    return { re: new RegExp(source, flags), source, flags };
  } catch {
    return null;
  }
}

/** Các nhóm $1..$9 mà replaceString THAM CHIẾU (bỏ $$ escape). */
function referencedGroups(replaceString: string): number[] {
  const out = new Set<number>();
  const re = /\$(\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(replaceString)) !== null) {
    // Bỏ qua "$$1" (escape của ký tự $)
    if (replaceString[m.index - 1] === '$') continue;
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 9) out.add(n);
  }
  return [...out];
}

// LƯU Ý UNICODE: tên biến MVU trong card Việt/Trung là "Máu", "Người Chơi", "Thế Giới"…
// `\w` chỉ khớp [A-Za-z0-9_] nên {{getvar::Máu}} trước đây chỉ bắt được "M" rồi đứt ở "á"
// → so khớp schema luôn trượt → báo biến bịa oan (hoặc bỏ lọt biến bịa thật).
// Nay dùng lớp ký tự Unicode và cho phép khoảng trắng trong tên biến.
function normalizeVarPath(raw: string): string {
  return raw
    .trim()
    .replace(/^stat_data[./]/i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\//g, '.')
    .replace(/\.+/g, '.')
    .toLowerCase();
}

/** Rút các đường dẫn biến MVU mà replaceString tham chiếu. Giữ CẢ đường dẫn thay vì chỉ leaf:
 * `Player.CurrentVP` không được phép qua kiểm chỉ vì schema có một `CurrentVP` ở nhánh khác. */
function referencedVars(replaceString: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const v = normalizeVarPath(raw);
    // stat_data là container gốc của MVU, không phải một field do người dùng khai báo.
    if (v && v !== 'stat_data') out.add(v);
  };
  const scanOne = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(replaceString)) !== null) add(m[1] || '');
  };

  scanOne(/getvar::([^}\n|]+)/g);                         // {{getvar::Tên Biến}}
  scanOne(/mvuGet\([^,]+,\s*['"]([^'"]+)['"]/g);         // mvuGet(d, 'A.B')
  scanOne(/_\.get\([^,]+,\s*['"]([^'"]+)['"]/g);        // _.get(d, 'A.B')

  // _.get(d, ['A', 'B']) — đây là dạng mà chính bộ Tạo nhanh sinh ra.
  const arrayGet = /_\.get\([^,]+,\s*\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrayGet.exec(replaceString)) !== null) {
    const keys = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (keys[0]?.toLowerCase() === 'stat_data') keys.shift();
    if (keys.length) add(keys.join('.'));
  }

  // stat_data.foo.bar / stat_data['foo']['bar'] / d?.['foo']?.['bar'].
  const dotPath = /stat_data((?:\??\.[\p{L}\p{N}_$-]+)+)/gu;
  while ((m = dotPath.exec(replaceString)) !== null) add(m[1].replace(/\?\./g, '.'));
  const bracketPath = /(?:stat_data|\bd)((?:\??\[['"][^'"]+['"]\])+)/g;
  while ((m = bracketPath.exec(replaceString)) !== null) {
    const keys = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (keys.length) add(keys.join('.'));
  }
  return [...out];
}

/** Gom tên biến THẬT từ path schema. `label` chỉ là chữ hiển thị, không phải key dữ liệu. */
export function collectSchemaVarNames(schema?: MVUZODSchema | null): string[] {
  const out = new Set<string>();
  const walk = (fields?: MVUZODField[]) => {
    for (const f of fields || []) {
      const parts = (f.path || '').split('/').filter(Boolean);
      const leaf = parts.at(-1);
      if (leaf) out.add(leaf);
      if (parts.length) {
        out.add(parts.join('.'));
        out.add(parts.join('/'));
      }
      if (f.children?.length) walk(f.children);
    }
  };
  walk(schema?.fields);
  return [...out];
}

/**
 * Gom tên biến từ INITVAR (giá trị khởi tạo thật lúc chạy).
 *
 * Vì sao cần: UI phải ĐỒNG BIẾN với CẢ schema LẪN initvar. Trước đây chỉ đối chiếu schema
 * nên biến chỉ có trong initvar bị coi là "bịa" (cảnh báo oan), còn biến AI tự nghĩ ra thì
 * lọt lưới — sinh ra "bảng không ăn biến".
 */
export function collectInitVarNames(initVarConfig?: { entries?: { data?: Record<string, unknown> }[] } | null): string[] {
  const out = new Set<string>();
  const walk = (obj: unknown, prefix: string) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      // MVU hay kèm meta dạng [value, "mô tả"] — bỏ khoá meta nội bộ
      if (k.startsWith('$')) continue;
      out.add(k);                                   // leaf name
      const path = prefix ? `${prefix}.${k}` : k;
      out.add(path);                                // full path
      out.add(path.replace(/\./g, '/'));            // slash path (schema dùng /)
      walk(v, path);
    }
  };
  for (const e of initVarConfig?.entries || []) walk(e.data, '');
  return [...out];
}

/** Đưa 1 đoạn sampleOutput quanh chỗ gần khớp để AI thấy vì sao trượt. */
function sampleHint(sampleOutput: string): string {
  const s = sampleOutput.trim();
  return s.length > 220 ? s.slice(0, 220) + '…' : s;
}

/**
 * Thế $1..$n bằng capture THẬT (match findRegex trên sampleOutput) vào replaceString → HTML để
 * component đưa vào iframe probe (V3). Trả null nếu không match được (không dựng preview được).
 */
export function buildRenderableHtml(script: DraftScript, sampleOutput: string): string | null {
  const parsed = parseFindRegex(script.findRegex);
  if (!parsed || !sampleOutput) return null;
  const m = sampleOutput.match(parsed.re);
  if (!m) return null;
  let html = script.replaceString;
  html = html.replace(/\$(\d)/g, (whole, d: string) => {
    const n = parseInt(d, 10);
    return m[n] != null ? m[n] : whole;
  });
  html = html.replace(/\{\{\s*match\s*\}\}/g, m[0]);
  return html;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
export function validateRegexDraft(
  scripts: DraftScript[],
  sampleOutput: string,
  schemaVarNames: string[] = [],
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const push = (level: ValidationIssue['level'], code: ValidationIssue['code'], message: string, scriptIndex?: number) =>
    issues.push({ level, code, message, scriptIndex });

  if (scripts.length === 0) {
    return { ok: false, issues: [{ level: 'error', code: 'NO_MATCH', message: 'Chưa có regex script nào — AI cần tạo ít nhất 1 script.' }] };
  }

  const schemaSet = new Set(schemaVarNames.map(normalizeVarPath));

  scripts.forEach((s, i) => {
    // ─── V1a: findRegex compile ───
    const parsed = parseFindRegex(s.findRegex);
    if (!parsed) {
      push('error', 'REGEX_SYNTAX', `Script #${i + 1} "${s.scriptName}": findRegex "${(s.findRegex || '').slice(0, 60)}" SAI cú pháp — không biên dịch được. Kiểm tra dấu ngoặc/escape hoặc dạng /pattern/flags.`, i);
    }

    // ─── V1b: JS trong replaceString ───
    for (const body of extractScriptBodies(s.replaceString || '')) {
      if (!isJsSyntaxOk(body)) {
        push('error', 'SCRIPT_SYNTAX', `Script #${i + 1} "${s.scriptName}": <script> trong replaceString VỠ cú pháp JS → nạp vào SillyTavern sẽ liệt nút. Sửa lại JS.`, i);
        break;
      }
    }

    // ─── V1c: chất lượng HTML (soft, chỉ WARN — replaceString thường là FRAGMENT widget nên
    //          không chấm điểm như 1 document đầy đủ; JS-parse ở V1b mới là chốt chặn cứng) ───
    if ((s.replaceString || '').includes('<')) {
      try {
        const q = autoFixGameHtml(s.replaceString).qualityScore;
        if (q === 'F') push('warn', 'HTML_QUALITY', `Script #${i + 1} "${s.scriptName}": cấu trúc HTML yếu (điểm F) — kiểm tra thẻ đóng/mở, nên có container bao ngoài.`, i);
      } catch { /* autoFixGameHtml choke trên placeholder → bỏ qua */ }
    }

    // ─── V1d: field enum ───
    const badPlace = (s.placement || []).filter((p) => p < 1 || p > 5);
    if (badPlace.length) push('error', 'PLACEMENT', `Script #${i + 1} "${s.scriptName}": placement ${JSON.stringify(badPlace)} không hợp lệ — chỉ được dùng 1..5 (2=AI Output dùng ~90% ca render widget).`, i);
    if ((s.placement || []).length === 0) push('error', 'PLACEMENT', `Script #${i + 1} "${s.scriptName}": placement RỖNG — phải có ít nhất 1 vị trí (thường là [2] = AI Output).`, i);
    if (s.markdownOnly && s.promptOnly) push('error', 'MEANINGLESS_FLAGS', `Script #${i + 1} "${s.scriptName}": markdownOnly=true VÀ promptOnly=true là VÔ NGHĨA. Render widget → dùng markdownOnly=true, promptOnly=false.`, i);

    // ─── V2: MATCH THẬT ───
    if (!sampleOutput || !sampleOutput.trim()) {
      push('warn', 'NO_SAMPLE', 'Chưa có <sample_output> — hãy cung cấp đoạn văn AI mẫu (có status block đúng format) để CHỨNG MINH regex match được.');
    } else if (parsed) {
      const m = sampleOutput.match(parsed.re);
      if (!m) {
        push('error', 'NO_MATCH', `Script #${i + 1} "${s.scriptName}": findRegex KHÔNG match sampleOutput → regex vô dụng. (Mẹo: status block nhiều dòng thường cần flag "s"/dotAll, vd /…/s). Sample đang có: "${sampleHint(sampleOutput)}"`, i);
      } else {
        for (const g of referencedGroups(s.replaceString || '')) {
          if (m[g] == null || m[g] === '') {
            push('error', 'MISSING_GROUP', `Script #${i + 1} "${s.scriptName}": replaceString dùng $${g} nhưng regex KHÔNG có nhóm capture #${g} (hoặc nhóm rỗng). Thêm ngoặc ( ) cho nhóm ${g} hoặc bỏ $${g}.`, i);
          }
        }
      }
    }

    // ─── V4: ĐỒNG BIẾN VỚI SCHEMA + INITVAR ───
    // Đây là chốt chặn cho lỗi "bảng không ăn biến": AI bịa tên biến không có thật thì
    // widget render ra ô trống/undefined. TRƯỚC ĐÂY chỉ là 'warn' nên report vẫn ok=true,
    // vòng tự sửa KHÔNG chạy và bản lỗi được báo "✅ qua kiểm". Nay là ERROR để AI phải sửa.
    if (schemaSet.size > 0) {
      const used = referencedVars(s.replaceString || '');
      for (const v of used) {
        if (!schemaSet.has(normalizeVarPath(v))) {
          push('error', 'UNKNOWN_VAR', `Script #${i + 1} "${s.scriptName}": tham chiếu biến "${v}" KHÔNG có trong schema/initvar → widget sẽ render ra rỗng (undefined). Phải dùng ĐÚNG tên biến đã khai báo, hoặc thêm biến đó vào schema trước.`, i);
        }
      }
      // Widget bám biến mà không tham chiếu biến nào = bảng chết (hardcode), không đồng biến.
      const hasOtherLiveInput = /\$[1-9]|\{\{\s*match\s*\}\}|insertOrAssignVariables|replaceMvuData|parseMessage/.test(s.replaceString || '');
      if (used.length === 0 && !hasOtherLiveInput && s.markdownOnly && !s.promptOnly && (s.replaceString || '').length > 200) {
        push('error', 'NO_VAR_BOUND', `Script #${i + 1} "${s.scriptName}": KHÔNG tham chiếu biến MVU nào (không có getvar::/stat_data/_.get/mvuGet) → bảng chỉ là chữ chết, số liệu sẽ không bao giờ đổi. Phải bind biến từ schema trước khi Apply.`, i);
      }
    }
  });

  return { ok: !issues.some((x) => x.level === 'error'), issues };
}

/** Serialize report thành XML để bơm ngược cho AI tự sửa (ẩn khỏi user). */
export function reportToXml(report: ValidationReport): string {
  const lines = ['<validation_report>'];
  for (const it of report.issues) {
    lines.push(`  <issue level="${it.level}" code="${it.code}"${it.scriptIndex != null ? ` script="${it.scriptIndex}"` : ''}>${escapeXml(it.message)}</issue>`);
  }
  lines.push(`  <verdict>${report.ok ? 'PASS' : 'FAIL — sửa các issue mức error rồi gửi lại (edit_component/set_regex)'}</verdict>`);
  lines.push('</validation_report>');
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
