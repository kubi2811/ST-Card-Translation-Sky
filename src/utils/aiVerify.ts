import { compareInitvarKeys } from './initvarKeyCollision';
import { countCjkText } from './cjk';
import { fandomNameOverride } from './fandomMode';
import type { CharacterCard, ProxySettings, TranslationField } from '../types/card';
import { detectStructuralTruncation, callProvider, computePoolConcurrency } from './apiClient';
// (bugNeedFix/177) Dò lỗi phải chạy đa luồng như mọi luồng khác — xem ghi chú ở verifyConcurrency().
import { runWorkerPool } from './runWorkerPool';

/**
 * (bugNeedFix/177) SỐ LUỒNG CHO CÁC LƯỢT "DÒ LỖI"/"SỬA LỖI" BẰNG AI.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "phần dò lỗi cho phép chạy nhiều luồng chứ không phải từng luồng 1, hiện nay dò lỗi chỉ
 * chạy 1 luồng, cậu áp dụng hệ thống đa luồng cũ của chúng ta đi." Ảnh chụp cho thấy "Luồng đang
 * chạy: 1" trong khi cùng thẻ đó lúc dịch đạt cao điểm 11 luồng.
 *
 * Đúng: bốn vòng dò/sửa trong file này đều là `for` tuần tự `await` từng call một. Chúng KHÔNG bị
 * chặn bởi RPM — chỉ là chưa bao giờ được nối vào pool. Hạ tầng đã có sẵn và đã chạy tốt ở luồng
 * dịch: computePoolConcurrency (ngân sách RPM thật của mọi provider/key) + runWorkerPool (worker
 * xong là kéo việc kế, không đợi cả đợt).
 *
 * Trần RPM KHÔNG tăng: mỗi call vẫn đi qua pickLane/waitForRateLimitModel của apiClient như cũ.
 * Ở đây chỉ bỏ phần NGỒI CHỜ vô ích giữa các call.
 */
function verifyConcurrency(config: ProxySettings): number {
  // Tối thiểu 2 để kể cả cấu hình 1 key cũng không lùi về đúng hành vi tuần tự cũ.
  return Math.max(2, computePoolConcurrency(config));
}

/* ═══ Template-literal interpolation check (sửa bug #2) ═══
 * Trích các block `${...}` CÂN BẰNG NGOẶC (chịu được lồng nhau `${ `${x}` }`), rồi CHỈ soi những
 * biến JS THUẦN (định danh / thuộc tính / index số / gọi rỗng — không literal, không toán tử, không
 * chữ Hán, không HTML). Trả về danh sách biến thuần ở GỐC bị MẤT HẲN khỏi bản dịch (nghi vỡ code).
 * KHÔNG ghép cặp đoán mò như bản cũ (cũ lấy `${...}` bất kỳ ở bản dịch rồi bảo "gốc X dịch thành Y"
 * dù không liên quan), KHÔNG đụng chuỗi literal ('怪物'→'Quái Vật' là đúng) hay biến MVU đổi tên
 * (类型→Loại — covariance lo). */
export function extractBalancedInterpolations(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1, j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      if (depth === 0) { out.push(text.slice(i, j)); i = j - 1; }
    }
  }
  return out;
}

/** Biến JS THUẦN: `foo`, `obj.prop`, `arr[0]`, `obj.fn()` — KHÔNG toán tử/nháy/khoảng trắng-chữ/Hán. */
export function isPureCodeInterpolation(inner: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\]|\(\))*$/.test(inner.trim());
}

/** Biến JS thuần ở GỐC bị mất hẳn khỏi bản dịch → nghi bị xoá/đổi nhầm (chỉ đây mới đáng cảnh báo). */
export function findMissingCodeInterpolations(orig: string, translated: string): string[] {
  const missing: string[] = [];
  for (const expr of new Set(extractBalancedInterpolations(orig))) {
    const inner = expr.slice(2, -1).trim();
    if (!isPureCodeInterpolation(inner)) continue;      // bỏ literal / ternary / HTML / biến-Hán
    if (!translated.includes(inner)) missing.push(expr); // biến thuần biến mất → nghi vỡ
  }
  return missing;
}

/* ═══ Types ═══ */

export interface VerifyIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  location: string;       // e.g. "lorebook[3].content", "regex[0].replaceString"
  description: string;    // what's wrong
  original: string;       // snippet from original
  current: string;        // snippet from translated
  suggestion: string;     // AI-suggested fix
  autoFixable: boolean;   // can be auto-fixed
  fixPath?: string;       // JSON path for auto-fix
  fixValue?: string;      // replacement value for auto-fix
}

export interface VerifyResult {
  totalIssues: number;
  errors: number;
  warnings: number;
  info: number;
  issues: VerifyIssue[];
  summary: string;
}

/* ═══ AI Fix Report — transparency on what was accepted/rejected ═══ */

export interface AIFixReportEntry {
  path: string;
  label: string;
  status: 'accepted' | 'rejected' | 'error';
  reason?: string;
  round: number;
  issuesBefore: number;
  issuesAfter: number;
}

export interface AIFixReport {
  fixes: { path: string; fixedText: string }[];
  report: AIFixReportEntry[];
  roundsCompleted: number;
  totalAccepted: number;
  totalRejected: number;
  totalErrors: number;
}

/* ═══ Extract all system references from a card ═══ */

interface SystemReference {
  type: 'variable' | 'macro' | 'data-var' | 'zod-field' | 'ejs' | 'css-class' | 'css-id' | 'function';
  name: string;
  source: string; // where it was found
}

/**
 * Deep-scan a card for all system-level references that must stay consistent:
 * - {{getvar::XXX}}, {{setvar::XXX}}, {{getglobalvar::XXX}}, etc.
 * - data-var="XXX" attributes
 * - Zod schema field names (z.object({ field: ... }))
 * - .prefault() / .default() values
 * - EJS templates (<%=, <%, %>)
 * - CSS class/id references in regex HTML
 * - SillyTavern macros: {{char}}, {{user}}, {{random}}, etc.
 */
export function extractSystemReferences(card: CharacterCard): SystemReference[] {
  const refs: SystemReference[] = [];
  const data = card.data;
  if (!data) return refs;

  const scan = (text: string, source: string) => {
    if (!text || typeof text !== 'string') return;

    // {{getvar::XXX}} / {{setvar::XXX::value}} / {{getglobalvar::XXX}}
    const varMacroRegex = /\{\{(getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/g;
    let m;
    while ((m = varMacroRegex.exec(text)) !== null) {
      refs.push({ type: 'variable', name: m[2].trim(), source });
    }

    // data-var="XXX"
    const dataVarRegex = /data-var\s*=\s*["']([^"']+)["']/g;
    while ((m = dataVarRegex.exec(text)) !== null) {
      refs.push({ type: 'data-var', name: m[1], source });
    }

    // Zod fields: z.object({ field_name: z.XXX() })
    const zodFieldRegex = /(\w+)\s*:\s*z\.\w+/g;
    while ((m = zodFieldRegex.exec(text)) !== null) {
      if (!['z', 'const', 'let', 'var', 'return', 'export', 'import', 'function'].includes(m[1])) {
        refs.push({ type: 'zod-field', name: m[1], source });
      }
    }

    // .prefault("XXX") or .default("XXX")
    const prefaultRegex = /\.(?:prefault|default)\s*\(\s*["']([^"']+)["']/g;
    while ((m = prefaultRegex.exec(text)) !== null) {
      refs.push({ type: 'zod-field', name: `prefault:${m[1]}`, source });
    }

    // EJS templates: <%= ... %>, <% ... %>
    const ejsRegex = /<%[=-]?\s*([\s\S]*?)%>/g;
    while ((m = ejsRegex.exec(text)) !== null) {
      refs.push({ type: 'ejs', name: m[1].trim().slice(0, 80), source });
    }

    // Standard SillyTavern macros (should NEVER be translated)
    const stMacroRegex = /\{\{(char|user|random|roll|time|date|idle_duration|input|lastMessage|lastMessageId|newline|trim|noop|original|personality|scenario|persona|mesExamples|description|charFirstMes|charJailbreak|sysPrompt|worldInfo|lorebook|inventory)\}\}/gi;
    while ((m = stMacroRegex.exec(text)) !== null) {
      refs.push({ type: 'macro', name: `{{${m[1]}}}`, source });
    }

    // CSS IDs: id="XXX" or id='XXX'
    const cssIdRegex = /\bid\s*=\s*["']([^"']+)["']/g;
    while ((m = cssIdRegex.exec(text)) !== null) {
      refs.push({ type: 'css-id', name: m[1], source });
    }

    // Function calls that look like API: executeSlashCommands, triggerGroupMessage, etc.
    const funcRegex = /\b(executeSlashCommands|triggerGroupMessage|setVariable|getVariable|sendMessage|fetch)\s*\(/g;
    while ((m = funcRegex.exec(text)) !== null) {
      refs.push({ type: 'function', name: m[1], source });
    }
  };

  // Scan lorebook entries
  if (data.character_book?.entries) {
    data.character_book.entries.forEach((entry, i) => {
      scan(entry.content, `lorebook[${i}].content`);
      if (entry.name) scan(entry.name, `lorebook[${i}].name`);
    });
  }

  // Scan regex scripts
  if (data.extensions?.regex_scripts) {
    data.extensions.regex_scripts.forEach((script, i) => {
      if (typeof script.findRegex === 'string') scan(script.findRegex, `regex[${i}].findRegex`);
      scan(script.replaceString, `regex[${i}].replaceString`);
      if (script.trimStrings) {
        script.trimStrings.forEach((ts, j) => scan(ts, `regex[${i}].trimStrings[${j}]`));
      }
    });
  }

  // Scan TavernHelper scripts
  const thRaw = data.extensions?.tavern_helper as any;
  const thScriptsForVerify: any[] = [];
  if (Array.isArray(thRaw)) {
    // Tuple format: [ ["scripts", [{content:...}, ...]] ]
    for (const item of thRaw) {
      if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
        thScriptsForVerify.push(...item[1].filter((s: any) => s?.content));
      } else if (item && typeof item === 'object' && !Array.isArray(item) && (item as any).content) {
        thScriptsForVerify.push(item);
      }
    }
  } else if (thRaw?.scripts && Array.isArray(thRaw.scripts)) {
    thScriptsForVerify.push(...thRaw.scripts.filter((s: any) => s?.content));
  }
  thScriptsForVerify.forEach((script: any, i: number) => {
    scan(script.content, `tavernHelper[${i}].content`);
  });
  const thLegacy = data.extensions?.TavernHelper_scripts as any[];
  if (Array.isArray(thLegacy)) {
    thLegacy.forEach((script: any, i: number) => {
      scan(script.content, `tavernHelper_legacy[${i}].content`);
    });
  }

  // Scan system prompt & description (for macros)
  scan(data.system_prompt || '', 'system_prompt');
  scan(data.description || '', 'description');
  scan(data.first_mes || '', 'first_mes');
  scan(data.mes_example || '', 'mes_example');

  // Deduplicate
  const seen = new Set<string>();
  return refs.filter(r => {
    const key = `${r.type}:${r.name}:${r.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ═══ Quick local verification (no AI needed) ═══ */

/** (User 2026) Chuẩn hoá 1 EJS expression để so CẤU TRÚC: thay NỘI DUNG mọi chuỗi '…'/"…"/`…` thành
 *  rỗng + gộp khoảng trắng. Dùng để "Nghiệm thu" không báo SAI khi tên biến/chuỗi so sánh bên trong
 *  EJS đã được DỊCH có chủ ý (Chiến lược B/C) — expression khác card gốc nhưng KHÔNG mất/vỡ. */
export function normalizeEjsExpr(name: string): string {
  return (name || '').replace(/(['"`])(?:[^'"`\\]|\\.)*?\1/g, (_m, q) => `${q}${q}`).replace(/\s+/g, ' ').trim();
}

export function quickVerify(
  originalCard: CharacterCard,
  translatedCard: CharacterCard
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const origRefs = extractSystemReferences(originalCard);
  const transRefs = extractSystemReferences(translatedCard);

  // Build maps
  const origBySource = new Map<string, SystemReference[]>();
  for (const r of origRefs) {
    if (!origBySource.has(r.source)) origBySource.set(r.source, []);
    origBySource.get(r.source)!.push(r);
  }
  const transBySource = new Map<string, SystemReference[]>();
  for (const r of transRefs) {
    if (!transBySource.has(r.source)) transBySource.set(r.source, []);
    transBySource.get(r.source)!.push(r);
  }

  const normEjs = normalizeEjsExpr; // (User 2026) so cấu trúc EJS, bỏ nội dung chuỗi đã dịch

  // Check each source location
  for (const [source, origList] of origBySource) {
    const transList = transBySource.get(source) || [];
    const transNames = new Set(transList.map(r => r.name));
    // Tập EJS expression của bản dịch ở dạng CHUẨN HOÁ (bỏ nội dung chuỗi) — để bắt "cùng cấu trúc".
    const transEjsNorm = new Set(transList.filter(r => r.type === 'ejs').map(r => normEjs(r.name)));
    // (User 2026) SỐ khối EJS gốc vs dịch của field này — tín hiệu GỐC "có mất code hay không".
    // Nếu số khối KHÔNG giảm ⇒ không mất khối nào ⇒ mọi "expression khác" chỉ là do CHUỖI được dịch
    // / định dạng đổi (Chiến lược B/C) ⇒ KHÔNG báo "missing" (chống dương-tính-giả hàng loạt).
    const origEjsCount = origList.filter(r => r.type === 'ejs').length;
    const transEjsCount = transList.filter(r => r.type === 'ejs').length;
    const ejsBlockLost = transEjsCount < origEjsCount;

    for (const ref of origList) {
      // Check if a variable/macro/data-var reference is missing in the translation
      if (!transNames.has(ref.name)) {
        // For macros, this is always an error (they should never change)
        if (ref.type === 'macro') {
          issues.push({
            id: crypto.randomUUID(),
            severity: 'error',
            location: source,
            description: `Missing SillyTavern macro: ${ref.name} was in original but not found in translation`,
            original: ref.name,
            current: '(missing)',
            suggestion: `Restore ${ref.name} in the translated text`,
            autoFixable: false,
          });
        }
        // For variables, check if dictionary mapping exists (Strategy B might have renamed it)
        else if (ref.type === 'variable' || ref.type === 'data-var') {
          issues.push({
            id: crypto.randomUUID(),
            severity: 'warning',
            location: source,
            description: `Variable "${ref.name}" not found in translation. It may have been renamed by Strategy B or accidentally translated.`,
            original: ref.name,
            current: '(missing or renamed)',
            suggestion: `Verify variable "${ref.name}" exists or is correctly mapped in MVU dictionary`,
            autoFixable: false,
          });
        }
        // Zod fields
        else if (ref.type === 'zod-field') {
          issues.push({
            id: crypto.randomUUID(),
            severity: 'error',
            location: source,
            description: `Zod schema field "${ref.name}" missing in translation. This will break the card's state management.`,
            original: ref.name,
            current: '(missing)',
            suggestion: `Restore Zod field "${ref.name}" in the schema definition`,
            autoFixable: false,
          });
        }
        // EJS templates
        else if (ref.type === 'ejs') {
          // (User 2026) Chỉ báo THIẾU khi field NÀY THỰC SỰ MẤT khối EJS (số khối dịch < gốc) VÀ cấu
          // trúc expression cũng biến mất. Field cùng số khối → code còn đủ, khác biệt chỉ do chuỗi đã
          // dịch/định dạng → KHÔNG báo (nếu không "Nghiệm thu" ra hàng chục lỗi ma như user gặp).
          if (ejsBlockLost && !transEjsNorm.has(normEjs(ref.name))) {
            issues.push({
              id: crypto.randomUUID(),
              severity: 'error',
              location: source,
              description: `EJS template expression missing: <% ${ref.name.slice(0, 40)} %>`,
              original: `<% ${ref.name} %>`,
              current: '(missing)',
              suggestion: `Restore the EJS template expression`,
              autoFixable: false,
            });
          }
        }
      }
    }
  }

  // (User 22/07 — bug 77) TRÙNG KHOÁ trong [initvar] sau khi dịch — lỗi LÀM MẤT DỮ LIỆU.
  //
  // Hai chữ Hán khác nhau dịch ra cùng một từ ⇒ hai khoá YAML anh em trùng tên ⇒ node sau đè
  // node trước ⇒ stat_data mất hẳn một field ⇒ mọi lệnh JSONPatch trỏ vào đó thất bại ⇒ MVU
  // báo "变量更新失败". Đo trên thẻ thật (bugNeedFix/1): initvar gốc 36 khoá distinct, bản dịch
  // còn 35 — 口 và 臀 cùng ra "Miệng" (臀 đúng ra là "Mông").
  //
  // Không tự sửa được: máy không biết 臀 phải là "Mông", đoán bừa thì hỏng nặng hơn. Việc của
  // phép kiểm này là CHẶN thẻ hỏng lọt ra ngoài và chỉ đúng chỗ để user gọi AI dịch lại.
  const initvarOf = (c: CharacterCard): string => {
    for (const e of (c?.data?.character_book?.entries ?? [])) {
      const cm = String((e as { comment?: string })?.comment ?? '');
      const ct = String((e as { content?: string })?.content ?? '');
      if (/initvar/i.test(cm) || cm.includes('初始化') || ct.includes('[initvar]')) return ct;
    }
    return '';
  };
  const origInit = initvarOf(originalCard);
  const transInit = initvarOf(translatedCard);
  if (origInit && transInit) {
    const col = compareInitvarKeys(origInit, transInit);
    for (const c of col.introduced) {
      issues.push({
        id: `initvar-dup-${c.name}`,
        severity: 'error',
        location: `lorebook[initvar]${c.parentPath ? ' → ' + c.parentPath.replace(/ /g, '/') : ''}`,
        description:
          `Tên biến "${c.name}" bị ${c.count} biến khác nhau cùng dùng (dòng ${c.lines.join(', ')}). ` +
          `Hai khoá trùng tên thì cái sau đè cái trước — thẻ MẤT HẲN một biến, vào game MVU sẽ báo "变量更新失败".`,
        original: '(mỗi biến một tên riêng)',
        current: c.name,
        suggestion: `Mở entry [initvar], sửa một trong ${c.count} chỗ thành tên khác (đối chiếu chữ Hán gốc để dịch đúng), hoặc gọi AI dịch lại riêng entry này.`,
        autoFixable: false,
      });
    }
    if (col.lostFields > 0 && col.introduced.length === 0) {
      issues.push({
        id: 'initvar-lost-fields',
        severity: 'error',
        location: 'lorebook[initvar]',
        description: `Bản dịch mất ${col.lostFields} biến so với bản gốc (gốc ${col.origDistinct} → dịch ${col.transDistinct}).`,
        original: `${col.origDistinct} biến`,
        current: `${col.transDistinct} biến`,
        suggestion: 'Đối chiếu entry [initvar] bản gốc với bản dịch, tìm biến bị mất rồi bổ sung lại.',
        autoFixable: false,
      });
    }
  }

  return issues;
}

/* ═══ Field-level verification (per-field checks on TranslationField[]) ═══ */

export interface FieldIssue extends VerifyIssue {
  fieldPath: string;
  category: 'residual_source' | 'html_broken' | 'bracket_mismatch' | 'macro_damaged' | 'json_broken' | 'mvu_inconsistent' | 'length_anomaly' | 'empty_translation' | 'regex_broken' | 'code_splice' | 'structural_truncation' | 'css_class_sync' | 'function_signature' | 'template_literal_content' | 'key_collision';
}

/** \u0110\u1ebfm CH\u1eee ngu\u1ed3n ch\u01b0a d\u1ecbch: ch\u1ec9 ideograph H\u00e1n + kana Nh\u1eadt + hangul H\u00e0n.
 * (S\u1eeda bug #2) B\u1ea3n c\u0169 \u0111\u1ebfm c\u1ea3 d\u1ea3i d\u1ea5u c\u00e2u CJK `\u3000-\u303f` (\u3001\u3002\u300a\u300b\u300c\u300d\u3010\u3011\u2026) v\u00e0 fullwidth
 * `\uff00-\uffef` \u2192 check "c\u00f2n ti\u1ebfng Trung" b\u00e1o OAN cho \u3010\u3011/d\u1ea5u c\u00e2u gi\u1eef nguy\u00ean (kh\u00f4ng ph\u1ea3i ch\u1eef ch\u01b0a
 * d\u1ecbch). Nay ch\u1ec9 \u0111\u1ebfm K\u00dd T\u1ef0 V\u0102N B\u1ea2N th\u1eadt; th\u00eam kana/hangul cho card ngu\u1ed3n Nh\u1eadt/H\u00e0n. */
export function countCJK(text: string): number {
  // (Audit dot 3) regex gom ve utils/cjk.ts (CJK_TEXT_RE_G) - semantics giu nguyen fix bug #2.
  return countCjkText(text);
}

/** Count HTML and EJS tags */
function countHtmlTags(text: string): { open: number; close: number; selfClose: number; ejs: number } {
  // Strip EJS tags first so they aren't counted as HTML tags by accident
  const ejsCount = (text.match(/<%[=-]?[\s\S]*?%>/g) || []).length;
  const noEjs = text.replace(/<%[=-]?[\s\S]*?%>/g, '');
  
  const open = (noEjs.match(/<[a-zA-Z][^/>]*>/gi) || []).length;
  const close = (noEjs.match(/<\/[a-zA-Z][^>]*>/gi) || []).length;
  const selfClose = (noEjs.match(/<[a-zA-Z][^>]*\/>/gi) || []).length;
  return { open, close, selfClose, ejs: ejsCount };
}

/** Count bracket pairs */
function countBrackets(text: string): Record<string, [number, number]> {
  return {
    '()': [(text.match(/\(/g) || []).length, (text.match(/\)/g) || []).length],
    '{}': [(text.match(/\{/g) || []).length, (text.match(/\}/g) || []).length],
    '[]': [(text.match(/\[/g) || []).length, (text.match(/\]/g) || []).length],
    '<% %>': [(text.match(/<%/g) || []).length, (text.match(/%>/g) || []).length],
  };
}

/** Fix bracket balance in translation by restoring missing brackets from original context */
function fixBracketBalance(orig: string, trans: string, openBr: string, closeBr: string): string {
  const escOpen = openBr.replace(/[[\]{}()]/g, '\\$&');
  const escClose = closeBr.replace(/[[\]{}()]/g, '\\$&');
  const origOpenCount = (orig.match(new RegExp(escOpen, 'g')) || []).length;
  const origCloseCount = (orig.match(new RegExp(escClose, 'g')) || []).length;
  let transOpenCount = (trans.match(new RegExp(escOpen, 'g')) || []).length;
  let transCloseCount = (trans.match(new RegExp(escClose, 'g')) || []).length;

  let fixed = trans;

  // Add missing brackets by finding their context in original
  const addMissing = (bracket: string, origCount: number, transCount: number) => {
    if (origCount <= transCount) return;
    const needed = origCount - transCount;
    let added = 0;
    const escBr = bracket.replace(/[[\]{}()]/g, '\\$&');

    // Find all positions of this bracket in original
    for (let i = 0; i < orig.length && added < needed; i++) {
      if (orig[i] !== bracket) continue;

      // Get context before the bracket
      const before = orig.slice(Math.max(0, i - 20), i);
      // Try to find this context in the translation
      for (let ctxLen = Math.min(before.length, 15); ctxLen >= 3; ctxLen--) {
        const snippet = before.slice(-ctxLen);
        const idx = fixed.indexOf(snippet);
        if (idx !== -1) {
          const insertPos = idx + snippet.length;
          // Only insert if bracket is not already there
          if (fixed[insertPos] !== bracket) {
            fixed = fixed.slice(0, insertPos) + bracket + fixed.slice(insertPos);
            added++;
          }
          break;
        }
      }
    }

    // Fallback: if context matching didn't find all, try after-context
    if (added < needed) {
      for (let i = 0; i < orig.length && added < needed; i++) {
        if (orig[i] !== bracket) continue;
        const after = orig.slice(i + 1, Math.min(orig.length, i + 21));
        for (let ctxLen = Math.min(after.length, 15); ctxLen >= 3; ctxLen--) {
          const snippet = after.slice(0, ctxLen);
          const idx = fixed.indexOf(snippet);
          if (idx !== -1 && idx > 0) {
            if (fixed[idx - 1] !== bracket) {
              fixed = fixed.slice(0, idx) + bracket + fixed.slice(idx);
              added++;
            }
            break;
          }
        }
      }
    }
  };

  addMissing(openBr, origOpenCount, transOpenCount);
  addMissing(closeBr, origCloseCount, transCloseCount);

  // Remove extra brackets (translation has more than original)
  const removeExtra = (bracket: string, origCount: number, transCount: number) => {
    if (transCount <= origCount) return;
    let toRemove = transCount - origCount;
    const escBr = bracket.replace(/[[\]{}()]/g, '\\$&');
    // Remove from end first (usually trailing extras)
    while (toRemove > 0) {
      const lastIdx = fixed.lastIndexOf(bracket);
      if (lastIdx === -1) break;
      // Check if this bracket position exists in original context
      const afterInFixed = fixed.slice(lastIdx + 1, lastIdx + 10);
      const beforeInFixed = fixed.slice(Math.max(0, lastIdx - 10), lastIdx);
      // Only remove if context suggests it's extra (not in original at similar position)
      const contextInOrig = orig.indexOf(beforeInFixed + bracket);
      if (contextInOrig === -1) {
        fixed = fixed.slice(0, lastIdx) + fixed.slice(lastIdx + 1);
        toRemove--;
      } else {
        break; // Don't remove brackets that have matching context in original
      }
    }
  };

  // Recount after additions
  transOpenCount = (fixed.match(new RegExp(escOpen, 'g')) || []).length;
  transCloseCount = (fixed.match(new RegExp(escClose, 'g')) || []).length;
  removeExtra(openBr, origOpenCount, transOpenCount);
  removeExtra(closeBr, origCloseCount, transCloseCount);

  return fixed;
}

/** Extract all {{macro::xxx}} patterns */
function extractMacros(text: string): string[] {
  return (text.match(/\{\{[^}]+\}\}/g) || []);
}

/**
 * (Bug 70) Thay tên biến MVU AN TOÀN — KHÔNG cắn vào giữa định danh JS.
 *
 * Bản cũ dùng `text.split(from).join(to)` trần. Thẻ có biến MVU tên 1 chữ như "B" thì
 * `getElement**B**yId` → `getElementTuổiyId`: code hỏng thật (nếu user bấm Fix), và bước
 * đếm API ngay sau đó thấy 0 lần ⇒ báo lỗi giả "appears 5x but only 0x".
 *
 * Quy tắc: tên ASCII chỉ được thay khi ĐỨNG RIÊNG (hai đầu không phải ký tự định danh).
 * Tên CJK thay trực tiếp (không có khái niệm word-boundary), nhưng caller phải xếp key
 * DÀI trước để 好感度 không bị 好感 ăn mất một nửa.
 */
export function replaceVarSafe(text: string, from: string, to: string): string {
  if (!from || !to || from === to) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/[一-鿿㐀-䶿぀-ヿ가-힯]/.test(from)) {
    return text.split(from).join(to);
  }
  return text.replace(new RegExp(`(?<![A-Za-z0-9_$])${esc}(?![A-Za-z0-9_$])`, 'g'), to);
}

/** Cặp [từ, sang] xếp theo tên nguồn DÀI trước — chống key ngắn ăn mất key dài. */
export function sortedVarPairs(dict: Record<string, string>): Array<[string, string]> {
  return Object.entries(dict)
    .filter(([k, v]) => k && v && k !== v)
    .sort((a, b) => b[0].length - a[0].length);
}

/** Check if text looks like it contains JSON */
function hasJsonContent(text: string): boolean {
  return /^\s*[\[{]/.test(text.trim()) && /[\]}]\s*$/.test(text.trim());
}

/** Verify all translated fields for common errors */
export function verifyFields(
  fields: TranslationField[],
  mvuDictionary: Record<string, string> = {},
  sourceLang = 'Chinese'
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const isCJKSource = /chinese|中文|japanese|日本語|korean|한국어/i.test(sourceLang) || sourceLang === 'auto';

  for (const field of fields) {
    if (field.status !== 'done' || !field.translated) continue;
    const orig = field.original;
    const trans = field.translated;
    let currentAutoFix = trans;

    // ─── 1. Residual source text (untranslated CJK left behind) ───
    if (isCJKSource && orig.length > 10) {
      const origCJK = countCJK(orig);
      const transCJK = countCJK(trans);
      // Aggressive detection: even a few remaining CJK chars is suspicious
      // Ratio-based: >5% of original CJK count remaining = warning, >30% = error
      // Absolute-based: >3 CJK chars in translation = warning regardless of ratio
      if (origCJK > 3 && transCJK > 0) {
        const ratio = transCJK / origCJK;
        const shouldFlag = ratio > 0.05 || transCJK > 3;
        if (shouldFlag) {
          const severity = ratio > 0.3 ? 'error' : (ratio > 0.15 || transCJK > 10) ? 'warning' : 'info';
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity,
            category: 'residual_source',
            location: field.label,
            description: `${transCJK} CJK characters remain (${Math.round(ratio * 100)}% of original ${origCJK}). Chinese text may not be fully translated.`,
            original: orig.slice(0, 100),
            current: trans.slice(0, 100),
            suggestion: 'Re-translate this field to ensure ALL source Chinese text is converted to the target language.',
            autoFixable: false,
          });
        }
      }
    }

    // ─── 2. HTML tag & EJS balance (for regex/tavern_helper fields) ───
    if ((field.group === 'regex' || field.group === 'tavern_helper' || field.group === 'lorebook') && (/<[a-zA-Z]/i.test(orig) || /<%/.test(orig))) {
      const origTags = countHtmlTags(orig);
      const transTags = countHtmlTags(trans);
      
      // EJS tags mismatch is fatal for Tavern Helper
      if (origTags.ejs !== transTags.ejs) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'error', category: 'html_broken',
          location: field.label,
          description: `EJS tag mismatch: original has ${origTags.ejs} EJS blocks, translation has ${transTags.ejs}. This breaks Javascript execution.`,
          original: `EJS blocks: ${origTags.ejs}`,
          current: `EJS blocks: ${transTags.ejs}`,
          suggestion: 'Check translated text for broken <% or %> tags.',
          autoFixable: false,
        });
      }

      const origNet = origTags.open - origTags.close;
      const transNet = transTags.open - transTags.close;
      if (Math.abs(origNet - transNet) > 1 || Math.abs(origTags.open - transTags.open) > 2) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'error', category: 'html_broken',
          location: field.label,
          description: `HTML tag mismatch: original has ${origTags.open} open / ${origTags.close} close tags, translation has ${transTags.open} / ${transTags.close}.`,
          original: `Open: ${origTags.open}, Close: ${origTags.close}`,
          current: `Open: ${transTags.open}, Close: ${transTags.close}`,
          suggestion: 'Check translated HTML for missing or extra tags.',
          autoFixable: false,
        });
      }
    }

    // ─── 3. Regex Script Validity (findRegex) ───
    if (field.label.includes('findRegex')) {
      const origMatch = orig.match(/^\/([\s\S]+)\/([a-z]*)$/i);
      if (origMatch) {
        const transMatch = currentAutoFix.match(/^\/([\s\S]+)\/([a-z]*)$/i);
        if (!transMatch) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'regex_broken',
            location: field.label,
            description: `findRegex lost its boundary slashes. Original was a valid regex pattern (/.../).`,
            original: orig,
            current: currentAutoFix,
            suggestion: 'Restore the surrounding / / slashes and flags to make it a valid regex pattern.',
            autoFixable: false,
          });
        }
      }
    }

    // ─── 4. Bracket mismatch (for code-heavy fields) ───
    if (field.group === 'tavern_helper' || field.group === 'lorebook' || field.group === 'regex') {
      const origBrackets = countBrackets(orig);
      const transBrackets = countBrackets(currentAutoFix);
      let bracketFixedTrans: string | null = null;

      for (const [pair, [origOpen, origClose]] of Object.entries(origBrackets)) {
        const [transOpen, transClose] = transBrackets[pair];
        const origDiff = origOpen - origClose;
        const transDiff = transOpen - transClose;
        if (Math.abs(origDiff - transDiff) > 1) {
          // Try auto-fix: restore brackets from original context
          if (!bracketFixedTrans) bracketFixedTrans = currentAutoFix;
          bracketFixedTrans = fixBracketBalance(orig, bracketFixedTrans, pair[0], pair[1]);

          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'warning', category: 'bracket_mismatch',
            location: field.label,
            description: `Bracket ${pair} mismatch: original balance ${origDiff >= 0 ? '+' : ''}${origDiff}, translation balance ${transDiff >= 0 ? '+' : ''}${transDiff}.`,
            original: `${pair[0]}:${origOpen} ${pair[1]}:${origClose}`,
            current: `${pair[0]}:${transOpen} ${pair[1]}:${transClose}`,
            suggestion: `Check ${pair} brackets in the translation.`,
            autoFixable: true, // will be updated below
            fixPath: field.path,
            fixValue: '', // placeholder, updated below
          });
        }
      }

      // Update bracket issues with computed fix
      if (bracketFixedTrans && bracketFixedTrans !== currentAutoFix) {
        currentAutoFix = bracketFixedTrans;
        for (const iss of issues) {
          if (iss.category === 'bracket_mismatch' && iss.fixPath === field.path) {
            iss.fixValue = currentAutoFix;
          }
        }
      } else {
        // No fix computed — mark as not auto-fixable
        for (const iss of issues) {
          if (iss.category === 'bracket_mismatch' && iss.fixPath === field.path) {
            iss.autoFixable = false;
            iss.fixPath = undefined;
          }
        }
      }
    }

    // ─── 5. SillyTavern macro damage ───
    const origMacros = extractMacros(orig);
    const transMacros = extractMacros(currentAutoFix);
    if (origMacros.length > 0) {
      const origSet = new Set(origMacros);
      const transSet = new Set(transMacros);

      // Collect missing macros (in orig, not in trans) and extra macros (in trans, not in orig)
      const missingMacros: string[] = [];
      const extraMacros: string[] = [];

      // (User 2026 — bugNeedFix/38) PHÂN LOẠI macro để hết báo "macro damaged" GIẢ:
      //  • FUNCTIONAL — macro LỆNH: có "::" (getvar/format_message_variable/BẤT KỲ loại) hoặc ruột là
      //    1 token ASCII ({{char}}, {{user}}, {{roll:d6}}). Phải giữ CẤU TRÚC; riêng ARG được phép đổi
      //    theo từ điển MVU — kể cả PATH CHẤM nhiều đoạn (stat_data.交互记录.换装状态): map TỪNG ĐOẠN.
      //  • PLACEHOLDER — ruột là CHỮ hiển thị ({{时间/地点/是否亲密中}}: có CJK/khoảng trắng/diacritics,
      //    KHÔNG "::") → DỊCH ruột là ĐÚNG YÊU CẦU, không được đòi nguyên văn; chỉ lỗi thật khi bản dịch
      //    MẤT placeholder (tổng số {{…}} loại này giảm).
      const isFunctionalMacro = (mm: string) => {
        const inner = mm.slice(2, -2).trim();
        if (inner.includes('::')) return true;
        return /^[A-Za-z0-9_.:\-]+$/.test(inner); // 1 token ASCII thuần ({{char}}, {{roll:d6}}…)
      };
      const mapSegments = (arg: string, dict: Record<string, string>) =>
        arg.split('.').map(seg => dict[seg.trim()] ?? seg).join('.');
      const reverseDict: Record<string, string> = {};
      for (const [k, v] of Object.entries(mvuDictionary)) { if (v && v !== k) reverseDict[v] = k; }
      const splitTypeArg = (mm: string): { type: string; arg: string } | null => {
        const inner = mm.slice(2, -2);
        const idx = inner.indexOf('::');
        if (idx === -1) return null;
        return { type: inner.slice(0, idx).trim(), arg: inner.slice(idx + 2).trim() };
      };
      const countType = (list: string[], type: string) =>
        list.filter(x => splitTypeArg(x)?.type === type).length;
      const macroHasCjk = (s: string) => /[぀-ヿ㐀-䶿一-鿿가-힯]/.test(s);

      for (const m of origSet) {
        if (transSet.has(m)) continue;
        if (!isFunctionalMacro(m)) continue; // placeholder → kiểm theo ĐẾM bên dưới
        const ta = splitTypeArg(m);
        if (ta) {
          // Macro lệnh BẤT KỲ loại: coi là CÒN NGUYÊN nếu bản dịch có macro CÙNG type với arg = nguyên
          // văn / map XUÔI theo dict / map NGƯỢC về đúng arg gốc (map từng đoạn path chấm).
          const matched = [...transSet].some(tm => {
            const tt = splitTypeArg(tm);
            if (!tt || tt.type !== ta.type) return false;
            return tt.arg === ta.arg ||
              tt.arg === mapSegments(ta.arg, mvuDictionary) ||
              mapSegments(tt.arg, reverseDict) === ta.arg;
          });
          if (matched) continue;
          // Arg chứa CJK (tên biến Trung được DỊCH nhưng lệch dict) + bản dịch vẫn ĐỦ SỐ macro cùng
          // type → cấu trúc còn nguyên, chỉ là biến thể dịch (mvu_inconsistent lo phần tên) — không
          // phải "damaged".
          if (macroHasCjk(ta.arg) && countType(transMacros, ta.type) >= countType(origMacros, ta.type)) continue;
        }
        missingMacros.push(m);
      }

      // PLACEHOLDER: ghép cặp gốc↔bản dịch theo thứ tự xuất hiện; chỉ phần THIẾU HỤT là mất thật.
      const origPh = origMacros.filter(mm => !isFunctionalMacro(mm) && !transSet.has(mm));
      const transPh = transMacros.filter(mm => !isFunctionalMacro(mm) && !origSet.has(mm));
      if (origPh.length > transPh.length) {
        for (const m of origPh.slice(transPh.length)) missingMacros.push(m);
      }

      for (const m of transSet) {
        if (!origSet.has(m)) {
          const varMatch = m.match(/\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/);
          const varName = varMatch?.[1]?.trim();
          const isKnownMapping = varName && (
            Object.values(mvuDictionary).includes(varName) ||
            Object.keys(mvuDictionary).includes(varName)
          );
          if (!isKnownMapping) {
            extraMacros.push(m);
          }
        }
      }

      // Compute auto-fix for missing macros
      let fixedTrans: string | null = null;
      if (missingMacros.length > 0) {
        fixedTrans = currentAutoFix;

        // Phase 0: Semantic recovery for common system macros and MVU dictionary
        const commonMistakes: Record<string, string[]> = {
          '{{char}}': ['{{nhân vật}}', '{{character}}', '{{nhan vat}}', '{{bot}}'],
          '{{user}}': ['{{người dùng}}', '{{người chơi}}', '{{player}}'],
          '{{original}}': ['{{bản gốc}}', '{{gốc}}']
        };

        let remainingMissing = [...missingMacros];
        let remainingExtra = [...extraMacros];

        for (const missing of [...remainingMissing]) {
          // 1. Try common mistakes
          let recovered = false;
          if (commonMistakes[missing]) {
            for (const mistake of commonMistakes[missing]) {
              if (fixedTrans.includes(mistake)) {
                fixedTrans = fixedTrans.replace(mistake, missing);
                remainingExtra = remainingExtra.filter(e => e !== mistake);
                remainingMissing = remainingMissing.filter(m => m !== missing);
                recovered = true;
                break;
              }
            }
          }
          if (recovered) continue;

          // 2. Try MVU reverse lookup if it's a getvar/setvar macro
          const varMatch = missing.match(/\{\{(getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/);
          if (varMatch) {
            const macroType = varMatch[1];
            const originalVar = varMatch[2].trim();
            // What should it have been translated to?
            const expectedMapped = mvuDictionary[originalVar] || Object.keys(mvuDictionary).find(k => mvuDictionary[k] === originalVar);
            
            // Did the AI mistakenly translate it to something else? We look at extraMacros for the same macroType
            for (const extra of remainingExtra) {
              const extraMatch = extra.match(new RegExp(`\\{\\{${macroType}::([^:}]+)`));
              if (extraMatch) {
                // If the extra macro isn't a known MVU variable, the AI probably hallucinated its translation
                const extraVar = extraMatch[1].trim();
                const isKnown = mvuDictionary[extraVar] || Object.values(mvuDictionary).includes(extraVar);
                if (!isKnown) {
                  fixedTrans = fixedTrans.replace(extra, missing);
                  remainingExtra = remainingExtra.filter(e => e !== extra);
                  remainingMissing = remainingMissing.filter(m => m !== missing);
                  recovered = true;
                  break;
                }
              }
            }
          }
        }

        // Phase 1: Replace extra (translated) macros with missing (original) macros
        if (remainingExtra.length > 0) {
          if (origMacros.length === transMacros.length) {
            for (let i = 0; i < origMacros.length; i++) {
              const om = origMacros[i], tm = transMacros[i];
              if (om !== tm && !origSet.has(tm) && remainingExtra.includes(tm)) {
                fixedTrans = fixedTrans.replace(tm, om);
              }
            }
          } else {
            const sortByPos = (arr: string[], text: string) =>
              [...arr].sort((a, b) => text.indexOf(a) - text.indexOf(b));
            const sortedMissing = sortByPos(remainingMissing, orig);
            const sortedExtra = sortByPos(remainingExtra, currentAutoFix);
            const n = Math.min(sortedMissing.length, sortedExtra.length);
            for (let i = 0; i < n; i++) {
              fixedTrans = fixedTrans!.replace(sortedExtra[i], sortedMissing[i]);
            }
          }
        }

        // Phase 2: Find bare macro content (braces stripped) and re-wrap with {{}}
        const stillMissing2 = remainingMissing.filter(m => !fixedTrans!.includes(m));
        for (const m of stillMissing2) {
          const bare = m.slice(2, -2); // strip {{ and }}
          if (bare && fixedTrans!.includes(bare) && !fixedTrans!.includes(`{{${bare}}}`)) {
            fixedTrans = fixedTrans!.replace(bare, m);
          }
        }

        // Phase 3: Insert completely missing macros at approximate position
        const stillMissing3 = stillMissing2.filter(m => !fixedTrans!.includes(m));
        for (const m of stillMissing3) {
          const posInOrig = orig.indexOf(m);
          if (posInOrig === -1) continue;
          // Find surrounding context in original (up to 30 chars before)
          const beforeCtx = orig.slice(Math.max(0, posInOrig - 30), posInOrig);
          // Look for the last matching snippet in translated text
          let bestPos = -1;
          // Try progressively shorter context snippets
          for (let len = Math.min(beforeCtx.length, 20); len >= 5; len--) {
            const snippet = beforeCtx.slice(-len);
            const idx = fixedTrans!.indexOf(snippet);
            if (idx !== -1) {
              bestPos = idx + snippet.length;
              break;
            }
          }
          if (bestPos !== -1) {
            // Insert macro at the found position
            fixedTrans = fixedTrans!.slice(0, bestPos) + m + fixedTrans!.slice(bestPos);
          } else {
            // Fallback: insert at proportional position
            const ratio = posInOrig / orig.length;
            const insertPos = Math.round(ratio * fixedTrans!.length);
            // Find nearest whitespace or newline to insert cleanly
            let cleanPos = insertPos;
            for (let d = 0; d < 20; d++) {
              if (cleanPos + d < fixedTrans!.length && /[\s\n]/.test(fixedTrans![cleanPos + d])) {
                cleanPos = cleanPos + d + 1;
                break;
              }
              if (cleanPos - d >= 0 && /[\s\n]/.test(fixedTrans![cleanPos - d])) {
                cleanPos = cleanPos - d + 1;
                break;
              }
            }
            fixedTrans = fixedTrans!.slice(0, cleanPos) + m + fixedTrans!.slice(cleanPos);
          }
        }

        if (fixedTrans === currentAutoFix) fixedTrans = null; // no actual change
        else currentAutoFix = fixedTrans!;
      }

      // Create issues for missing macros (auto-fixable if we computed a fix)
      for (const m of missingMacros) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'error', category: 'macro_damaged',
          location: field.label,
          description: `Macro "${m}" from original is missing or damaged in translation.`,
          original: m,
          current: '(missing)',
          suggestion: `Restore macro "${m}" in the translated text.`,
          autoFixable: fixedTrans !== null,
          fixPath: fixedTrans !== null ? field.path : undefined,
          fixValue: fixedTrans ? currentAutoFix : undefined,
        });
      }

      // Create issues for extra macros (warnings, not auto-fixable individually)
      for (const m of extraMacros) {
        if (/\{\{(getvar|setvar|addvar|getglobalvar|setglobalvar)::/.test(m)) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'warning', category: 'macro_damaged',
            location: field.label,
            description: `New/unexpected macro "${m}" in translation that wasn't in original.`,
            original: '(not present)',
            current: m,
            suggestion: 'Verify this macro is intentional (MVU rename) or accidental.',
            autoFixable: fixedTrans !== null,
            fixPath: fixedTrans !== null ? field.path : undefined,
            fixValue: fixedTrans ? currentAutoFix : undefined,
          });
        }
      }
    }

    // ─── 5. JSON structure broken ───
    if (hasJsonContent(orig)) {
      let origIsValidJson = false;
      try { JSON.parse(orig); origIsValidJson = true; } catch { /* original wasn't valid JSON, skip check */ }
      if (origIsValidJson) {
        try {
          JSON.parse(currentAutoFix);
        } catch (e) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'json_broken',
            location: field.label,
            description: `Translation broke JSON structure: ${e instanceof Error ? e.message : String(e)}`,
            original: orig.slice(0, 80),
            current: currentAutoFix.slice(0, 80),
            suggestion: 'The translated content is no longer valid JSON. Fix the structure.',
            autoFixable: false,
          });
        }
      }
    }

    // ─── 6. Length anomaly ───
    if (orig.length > 20) {
      const ratio = trans.length / orig.length;
      const isCodeHeavy = field.group === 'regex' || field.group === 'tavern_helper' || field.path.toLowerCase().includes('regex') || field.path.toLowerCase().includes('code') || field.path.toLowerCase().includes('script') || field.path.toLowerCase().includes('helper');
      const minRatio = isCodeHeavy ? 0.8 : 0.15;
      
      if (ratio < minRatio) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'error', category: 'length_anomaly',
          location: field.label,
          description: isCodeHeavy
            ? `Code/Regex translation is suspiciously short: ${trans.length} chars vs ${orig.length} original (${Math.round(ratio * 100)}%). Expected at least 80% length preservation.`
            : `Translation is suspiciously short: ${trans.length} chars vs ${orig.length} original (${Math.round(ratio * 100)}%).`,
          original: `${orig.length} chars`,
          current: `${trans.length} chars (${Math.round(ratio * 100)}%)`,
          suggestion: 'Translation may be truncated or incomplete. Consider re-translating.',
          autoFixable: false,
        });
      } else if (ratio > 5) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'warning', category: 'length_anomaly',
          location: field.label,
          description: `Translation is unusually long: ${trans.length} chars vs ${orig.length} original (${Math.round(ratio * 100)}%).`,
          original: `${orig.length} chars`,
          current: `${trans.length} chars`,
          suggestion: 'Translation may contain duplicate content or excessive explanations.',
          autoFixable: false,
        });
      }

      // Structural truncation check for code-heavy fields
      if (isCodeHeavy) {
        const structuralCheck = detectStructuralTruncation(orig, trans);
        if (structuralCheck.isTruncated) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'structural_truncation',
            location: field.label,
            description: `Translation has structural truncation: ${structuralCheck.reason}`,
            original: orig.slice(-100),
            current: trans.slice(-100),
            suggestion: 'Translation is missing closing tags/brackets or ends mid-word. Re-translate this field.',
            autoFixable: false,
          });
        }
      }
    }

    // ─── 7. MVU variable consistency ───
    if (Object.keys(mvuDictionary).length > 0 && (field.group === 'tavern_helper' || field.group === 'lorebook' || field.group === 'regex')) {
      for (const [origVar, transVar] of sortedVarPairs(mvuDictionary)) {
        // (Bug 70) Chỉ tính là "chưa đổi tên" khi tên biến ĐỨNG RIÊNG trong bản dịch —
        // trước đây includes() trần khiến biến tên "B" khớp cả chữ B trong getElementById.
        const stillHasOld = replaceVarSafe(currentAutoFix, origVar, ' ') !== currentAutoFix;
        if (orig.includes(origVar) && stillHasOld && !currentAutoFix.includes(transVar)) {
          currentAutoFix = replaceVarSafe(currentAutoFix, origVar, transVar);
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'warning', category: 'mvu_inconsistent',
            location: field.label,
            description: `MVU variable "${origVar}" should be renamed to "${transVar}" but original name still appears in translation.`,
            original: origVar,
            current: origVar,
            suggestion: `Replace "${origVar}" with "${transVar}" in the translated text.`,
            autoFixable: true,
            fixPath: field.path,
            fixValue: currentAutoFix,
          });
        }
      }
    }

    // ─── 8. Template literal / backtick balance (B1 verification) ───
    if (field.group === 'tavern_helper' || field.group === 'lorebook' || field.group === 'regex') {
      const origBackticks = (orig.match(/(?<!\\)`/g) || []).length;
      const transBackticks = (currentAutoFix.match(/(?<!\\)`/g) || []).length;
      
      if (origBackticks > 0 && origBackticks % 2 === 0 && transBackticks % 2 !== 0) {
        // B1 auto-fix attempt: if exactly 1 backtick missing, try to restore it
        if (origBackticks - transBackticks === 1) {
          // Find template literal patterns in original and check corresponding positions in translation
          const origPositions: number[] = [];
          for (let bi = 0; bi < orig.length; bi++) {
            if (orig[bi] === '`' && (bi === 0 || orig[bi - 1] !== '\\')) origPositions.push(bi);
          }
          const transPositions: number[] = [];
          for (let bi = 0; bi < currentAutoFix.length; bi++) {
            if (currentAutoFix[bi] === '`' && (bi === 0 || currentAutoFix[bi - 1] !== '\\')) transPositions.push(bi);
          }
          // Simple heuristic: if translation is shorter by 1 backtick, append one at the end of the last template literal context
          if (transPositions.length > 0 && transPositions.length % 2 !== 0) {
            // Find the nearest newline or end-of-line after the last backtick
            const lastBacktickPos = transPositions[transPositions.length - 1];
            const nextNewline = currentAutoFix.indexOf('\n', lastBacktickPos);
            const insertPos = nextNewline > lastBacktickPos ? nextNewline : currentAutoFix.length;
            currentAutoFix = currentAutoFix.slice(0, insertPos) + '`' + currentAutoFix.slice(insertPos);
            issues.push({
              id: crypto.randomUUID(), fieldPath: field.path,
              severity: 'warning', category: 'bracket_mismatch',
              location: field.label,
              description: `Template literal auto-fixed: restored missing backtick (${origBackticks} → ${transBackticks} → ${origBackticks}).`,
              original: `Backticks: ${origBackticks}`,
              current: `Backticks: ${origBackticks} (fixed)`,
              suggestion: 'Backtick was auto-restored. Verify template literal is correctly closed.',
              autoFixable: true,
              fixPath: field.path,
              fixValue: currentAutoFix,
            });
          }
        } else {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'bracket_mismatch',
            location: field.label,
            description: `Template literal broken: original has ${origBackticks} backticks (balanced), translation has ${transBackticks} (unbalanced). This will cause a JS syntax error.`,
            original: `Backticks: ${origBackticks}`,
            current: `Backticks: ${transBackticks}`,
            suggestion: 'Check translated text for missing or extra backtick (`) characters in template literals.',
            autoFixable: false,
          });
        }
      } else if (origBackticks > 0 && Math.abs(origBackticks - transBackticks) > 2) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'warning', category: 'bracket_mismatch',
          location: field.label,
          description: `Backtick count changed significantly: ${origBackticks} → ${transBackticks}. Template literals may be damaged.`,
          original: `Backticks: ${origBackticks}`,
          current: `Backticks: ${transBackticks}`,
          suggestion: 'Verify template literal expressions are intact.',
          autoFixable: false,
        });
      }
    }

    // ─── 9. Code splice detection (B8 verification) ───
    if (field.group === 'tavern_helper' || field.group === 'lorebook' || field.group === 'regex') {
      // Check for unmatched function bodies
      const funcKeywords = (currentAutoFix.match(/\bfunction\s*\w*\s*\(/g) || []).length;
      const arrowFuncs = (currentAutoFix.match(/=>\s*\{/g) || []).length;
      const totalFuncOpens = funcKeywords + arrowFuncs;
      
      if (totalFuncOpens > 0) {
        // (Sửa bug #2) So ĐỘ SÂU NGOẶC với GỐC, KHÔNG phải với 0. replaceString/template fragment
        // vốn có thể lệch ngoặc (do ${...} nội suy, hoặc dấu } nằm trong chuỗi/regex) — gốc lệch -1
        // thì bản dịch giữ -1 là ĐÚNG, không phải "vỡ code". Chỉ báo khi bản dịch lệch KHÁC gốc.
        const braceDepthOf = (s: string): number => {
          let d = 0;
          for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d--; }
          return d;
        };
        const braceDepth = braceDepthOf(currentAutoFix);
        const origBraceDepth = braceDepthOf(orig);
        if (braceDepth !== origBraceDepth) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'code_splice',
            location: field.label,
            description: `Cấu trúc ngoặc { } lệch so với gốc: gốc cân bằng ${origBraceDepth}, bản dịch ${braceDepth}. Bản dịch có thể làm vỡ thân hàm.`,
            original: `braceDepth gốc: ${origBraceDepth}`,
            current: `braceDepth dịch: ${braceDepth}`,
            suggestion: 'The translation has mismatched curly braces { }. Check that function bodies are intact.',
            autoFixable: false,
          });
        }
      }

      // Check for broken <script> or <style> tags
      const scriptOpens = (currentAutoFix.match(/<script[\s>]/gi) || []).length;
      const scriptCloses = (currentAutoFix.match(/<\/script>/gi) || []).length;
      if (scriptOpens !== scriptCloses) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'error', category: 'code_splice',
          location: field.label,
          description: `<script> tag mismatch: ${scriptOpens} opening vs ${scriptCloses} closing tags.`,
          original: `<script>: ${scriptOpens} open, ${scriptCloses} close`,
          current: 'Mismatched',
          suggestion: 'The translation has broken <script> tags. Ensure all <script> tags are properly closed.',
          autoFixable: false,
        });
      }
    }

    // ─── 10. EJS path sync verification (B6 verification) ───
    if ((field.group === 'tavern_helper' || field.group === 'lorebook') && Object.keys(mvuDictionary).length > 0) {
      // Extract getvar/setvar paths from translation
      const ejsPathRegex = /(?:getvar|setvar)\s*\(\s*['"]([^'"]+)['"]/g;
      let pathMatch;
      while ((pathMatch = ejsPathRegex.exec(currentAutoFix)) !== null) {
        const path = pathMatch[1];
        // Check each segment of dotted path for untranslated CJK
        const segments = path.split('.');
        for (const seg of segments) {
          if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(seg)) {
            // This segment still has CJK — check if it's in the MVU dictionary
            if (mvuDictionary[seg]) {
              currentAutoFix = currentAutoFix.split(seg).join(mvuDictionary[seg]);
              issues.push({
                id: crypto.randomUUID(), fieldPath: field.path,
                severity: 'warning', category: 'mvu_inconsistent',
                location: field.label,
                description: `EJS path segment "${seg}" in getvar/setvar still CJK. Auto-replaced with "${mvuDictionary[seg]}" from MVU dictionary.`,
                original: seg,
                current: mvuDictionary[seg],
                suggestion: `Applied MVU dictionary: "${seg}" → "${mvuDictionary[seg]}"`,
                autoFixable: true,
                fixPath: field.path,
                fixValue: currentAutoFix,
              });
            } else {
              issues.push({
                id: crypto.randomUUID(), fieldPath: field.path,
                severity: 'warning', category: 'residual_source',
                location: field.label,
                description: `EJS path segment "${seg}" in getvar/setvar still contains CJK but no MVU dictionary entry found.`,
                original: seg,
                current: seg,
                suggestion: `Add "${seg}" to the MVU dictionary and re-translate.`,
                autoFixable: false,
              });
            }
          }
        }
      }
    }

    // ─── 11. CSS class/ID sync (B9 verification) ───
    if (field.group === 'regex' || field.group === 'tavern_helper') {
      // Extract CSS classes and IDs from HTML in original
      const origClasses = new Set((orig.match(/class\s*=\s*["']([^"']+)["']/g) || []).flatMap(m => {
        const val = m.match(/["']([^"']+)["']/)?.[1] || '';
        return val.split(/\s+/);
      }));
      const transClasses = new Set((trans.match(/class\s*=\s*["']([^"']+)["']/g) || []).flatMap(m => {
        const val = m.match(/["']([^"']+)["']/)?.[1] || '';
        return val.split(/\s+/);
      }));
      const origIds = new Set((orig.match(/\bid\s*=\s*["']([^"']+)["']/g) || []).map(m => m.match(/["']([^"']+)["']/)?.[1] || ''));
      const transIds = new Set((trans.match(/\bid\s*=\s*["']([^"']+)["']/g) || []).map(m => m.match(/["']([^"']+)["']/)?.[1] || ''));

      // ─── (bug 171 mục 2) SELECTOR CSS BỊ VỠ VÌ DỊCH — mất màu mà không sập script ───
      // Bằng chứng user: `.q-普通 { … }` dịch thành `.q-Phổ Thông { … }`. Trình duyệt đọc đó là HAI
      // selector (`.q-Phổ` rồi hậu duệ `Thông`) nên luật CSS không bao giờ khớp — toàn bộ màu phẩm
      // chất biến mất. Không có lỗi nào báo vì script vẫn chạy bình thường.
      // Chốt cũ chỉ so thuộc tính class="…", KHÔNG soi selector trong khối CSS, nên ca này lọt hẳn.
      // Chỉ soi phần trong <style>…</style>: ở ngoài đó không có gì bảo đảm dấu `{` là mở khối CSS.
      // Nếu bản gốc không có <style> thì bỏ qua hẳn — không có gì để đối chiếu, báo bừa còn tệ hơn sót.
      {
        const cssOf = (s: string) =>
          [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
            .map((m) => m[1])
            .join('\n')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const cssOrig = cssOf(orig);
        const cssTrans = cssOf(trans);
        const badSel = new Set<string>();
        if (cssOrig && cssTrans) {
          // Phần selector của một luật = đoạn trước `{`, tính từ `}` của luật liền trước.
          for (const m of cssTrans.matchAll(/(^|\})([^{}]+)\{/g)) {
            for (const raw of m[2].split(',')) {
              const sel = raw.trim();
              if (!sel || sel.startsWith('@')) continue;          // @media/@keyframes: không phải selector
              if (!/^[.#a-zA-Z][^{}$<%()]*$/.test(sel)) continue; // né chuỗi ghép động `${…}` và rác
              if (!/[.#]/.test(sel)) continue;                    // chỉ quan tâm class/id — thứ bị dịch
              if (cssOrig.includes(sel)) continue;                // y như gốc thì không phải do dịch
              // Dấu cách ở giữa = trình duyệt tách thành nhiều selector. Dấu tiếng Việt = tên class
              // không còn khớp chuỗi được ghép lúc chạy.
              if (/\s/.test(sel) || /[À-ỹĐđ]/.test(sel)) badSel.add(sel);
            }
          }
        }
        for (const sel of badSel) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'css_class_sync',
            location: field.label,
            description: `Selector CSS "${sel}" chứa dấu cách/dấu tiếng Việt sau khi dịch — trình duyệt hiểu thành nhiều selector rời, luật CSS không bao giờ khớp nên phần giao diện đó MẤT MÀU (script vẫn chạy, không có lỗi đỏ).`,
            original: sel.split(/\s+/)[0],
            current: sel,
            suggestion: 'Tên class phải là slug không dấu, không cách (vd .q-pho-thong). Nếu class được ghép lúc chạy từ dữ liệu (class="q-${q}") thì phải slug hoá ở CẢ ba chỗ: selector CSS, chỗ ghép class, và giá trị trong stat_data — sửa một chỗ là vẫn không khớp.',
            autoFixable: false,
          });
        }
      }

      // CSS classes should NOT be translated
      // (bug 213) Trước đây class gốc bị mất được GHÉP MÒ với class mới ĐẦU TIÊN BẤT KỲ rồi báo
      // 'X was translated to Y'. Class mới đó thường chẳng liên quan gì (thứ tự trong Set là ngẫu
      // nhiên theo văn bản), nên câu mô tả sai sự thật và đi thẳng vào prompt aiFix — AI bị dặn
      // "sửa" một cặp không tồn tại. Đây đúng anti-pattern mà bản vá bug #2 đã xoá ở check #13
      // nhưng còn sót nguyên ở đây. Nhánh CSS ID ngay bên dưới vốn đã làm đúng: báo mất, không
      // đoán nó thành cái gì.
      for (const cls of origClasses) {
        if (cls && !transClasses.has(cls) && cls.length > 2) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'css_class_sync',
            location: field.label,
            description: `CSS class "${cls}" biến mất khỏi bản dịch (bị dịch hoặc bị đổi tên). CSS class KHÔNG được dịch — mọi tham chiếu JS/CSS sẽ gãy.`,
            original: cls,
            current: '(mất hoặc bị đổi tên)',
            suggestion: `Khôi phục CSS class "${cls}" đúng nguyên văn — không dịch tên class.`,
            autoFixable: false,
          });
        }
      }
      // CSS IDs should NOT be translated
      for (const id of origIds) {
        if (id && !transIds.has(id) && id.length > 2) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'css_class_sync',
            location: field.label,
            description: `CSS ID "${id}" missing in translation. CSS IDs must NOT be translated.`,
            original: id,
            current: '(missing or renamed)',
            suggestion: `Restore CSS ID "${id}" in translated HTML.`,
            autoFixable: false,
          });
        }
      }
    }

    // ─── 12. Function/API signature preservation (B10 verification) ───
    if (field.group === 'tavern_helper' || field.group === 'regex' || field.group === 'lorebook') {
      // Extract function definitions and calls
      const funcDefRegex = /\bfunction\s+(\w+)\s*\(/g;
      const origFuncDefs: string[] = [];
      let fm;
      while ((fm = funcDefRegex.exec(orig)) !== null) origFuncDefs.push(fm[1]);
      
      if (origFuncDefs.length > 0) {
        const transFuncDefRegex = /\bfunction\s+(\w+)\s*\(/g;
        const transFuncDefs: string[] = [];
        while ((fm = transFuncDefRegex.exec(trans)) !== null) transFuncDefs.push(fm[1]);
        
        for (const fn of origFuncDefs) {
          if (!transFuncDefs.includes(fn)) {
            issues.push({
              id: crypto.randomUUID(), fieldPath: field.path,
              severity: 'error', category: 'function_signature',
              location: field.label,
              description: `Function "${fn}" was renamed or deleted in translation. Function names must NOT be translated.`,
              original: `function ${fn}(...)`,
              current: '(missing or renamed)',
              suggestion: `Restore function name "${fn}" — JavaScript identifiers must not change.`,
              autoFixable: false,
            });
          }
        }
      }

      // Check API calls (common SillyTavern APIs)
      const apiCalls = ['executeSlashCommands', 'triggerGroupMessage', 'setVariable', 'getVariable',
        'sendMessage', 'fetch', 'addEventListener', 'querySelector', 'querySelectorAll',
        'getElementById', 'getElementsByClassName', 'createElement', 'appendChild'];
      for (const api of apiCalls) {
        const origCount = (orig.match(new RegExp(`\\b${api}\\b`, 'g')) || []).length;
        const transCount = (trans.match(new RegExp(`\\b${api}\\b`, 'g')) || []).length;
        if (origCount > 0 && transCount < origCount) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'function_signature',
            location: field.label,
            description: `API call "${api}" appears ${origCount}x in original but only ${transCount}x in translation. API names must NOT be translated.`,
            original: `${api}: ${origCount}x`,
            current: `${api}: ${transCount}x`,
            suggestion: `Restore all "${api}" calls — these are JavaScript API names.`,
            autoFixable: false,
          });
        }
      }
    }

    // ─── 13. Template literal interpolation: chỉ bắt BIẾN JS THUẦN bị mất ───
    // (Sửa bug #2) Bản CŨ sai nặng: (a) regex `\${[^}]+}` KHÔNG parse được `${}` lồng nhau
    // (template literal HTML phức tạp) nên trích cụt/sai; (b) "ghép mò" — lấy BẤT KỲ `${...}` nào
    // ở bản dịch không trùng gốc rồi báo "gốc X đã dịch thành Y" dù X,Y chẳng liên quan; (c) không
    // phân biệt CHUỖI literal ('怪物'→'Quái Vật' là ĐÚNG) với biến MVU đổi tên có chủ đích
    // (类型→Loại) → báo lỗi oan tràn lan cho thứ không cần/không phải "chưa dịch".
    // Bản MỚI: trích `${...}` CÂN BẰNG NGOẶC, và CHỈ soi biến JS THUẦN (định danh/thuộc tính, không
    // literal, không ternary, không Hán, không HTML). Nếu 1 biến thuần ASCII ở gốc biến MẤT HẲN khỏi
    // bản dịch → cảnh báo (warning). Tuyệt đối KHÔNG ghép cặp đoán mò, KHÔNG động tới chuỗi literal
    // hay biến MVU đổi tên (đã có covariance lo).
    if (field.group === 'tavern_helper' || field.group === 'regex' || field.group === 'lorebook') {
      for (const expr of findMissingCodeInterpolations(orig, trans)) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'warning', category: 'template_literal_content',
          location: field.label,
          description: `Biến JS ${expr} trong template literal không còn thấy ở bản dịch — kiểm tra xem có bị xoá/đổi nhầm không.`,
          original: expr,
          current: '(missing)',
          suggestion: `Giữ nguyên ${expr} — đây là mã JavaScript, không dịch.`,
          autoFixable: false,
        });
      }
    }

    // ─── 14. JavaScript/JSON Object Key Collision check ───
    if (field.group === 'regex' || field.group === 'tavern_helper') {
      const extractObjectKeys = (text: string): string[] => {
        const keys: string[] = [];
        // Matches quoted keys like 'key': or "key": or `key`:
        const regex = /(['"`])(.*?)\1\s*:/g;
        let m;
        while ((m = regex.exec(text)) !== null) {
          keys.push(m[2].trim());
        }
        return keys;
      };

      const origKeys = extractObjectKeys(orig);
      const transKeys = extractObjectKeys(currentAutoFix);

      if (origKeys.length > 0 && origKeys.length === transKeys.length) {
        const keyMap = new Map<string, string>(); // origKey -> transKey
        const reverseKeyMap = new Map<string, string>(); // transKey -> origKey
        let collisionFound = false;
        let duplicateOrigKey: string | null = null;
        let duplicateTransKey: string | null = null;
        let originalCollidingKey: string | null = null;

        for (let i = 0; i < origKeys.length; i++) {
          const ok = origKeys[i];
          const tk = transKeys[i];
          
          if (keyMap.has(ok)) {
            // Original key already mapped
            continue;
          } else {
            keyMap.set(ok, tk);
            if (reverseKeyMap.has(tk)) {
              // COLLISION! Different original keys map to the same translated key!
              collisionFound = true;
              duplicateOrigKey = ok;
              originalCollidingKey = reverseKeyMap.get(tk)!;
              duplicateTransKey = tk;
              break;
            } else {
              reverseKeyMap.set(tk, ok);
            }
          }
        }

        if (collisionFound) {
          issues.push({
            id: crypto.randomUUID(),
            fieldPath: field.path,
            severity: 'error',
            category: 'key_collision',
            location: field.label,
            description: `Object key collision in JavaScript: Both original keys "${originalCollidingKey}" and "${duplicateOrigKey}" were translated to the same key "${duplicateTransKey}". This will overwrite properties and corrupt card logic.`,
            original: `Keys: "${originalCollidingKey}", "${duplicateOrigKey}"`,
            current: `Key: "${duplicateTransKey}"`,
            suggestion: `Ensure different original keys translate to unique Vietnamese keys (e.g., "${originalCollidingKey}" -> "Tiền Tần" and "${duplicateOrigKey}" -> "Tiền Yên").`,
            autoFixable: false,
          });
        }
      }
    }
  }

  return issues;
}

/** Apply auto-fix to a field issue */
export function applyAutoFix(issue: FieldIssue, fields: TranslationField[]): TranslationField[] {
  if (!issue.autoFixable || !issue.fixPath || !issue.fixValue) return fields;
  return fields.map(f => {
    if (f.path === issue.fixPath) {
      return { ...f, translated: issue.fixValue! };
    }
    return f;
  });
}

/* ═══ Reusable LLM API call ═══ */

async function callLLM(config: ProxySettings, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
  return await callProvider(config, systemPrompt, userPrompt, signal);
}

/* ═══ Map card-level issue location to field path ═══ */

function locationToFieldPath(location: string, fields: TranslationField[]): string | null {
  const lb = location.match(/lorebook\[(\d+)\]\.(\w+)/);
  if (lb) { const p = `data.character_book.entries[${lb[1]}].${lb[2]}`; return fields.find(f => f.path === p) ? p : null; }
  const rx = location.match(/regex\[(\d+)\]\.(\w+)/);
  if (rx) { const p = `data.extensions.regex_scripts[${rx[1]}].${rx[2]}`; return fields.find(f => f.path === p) ? p : null; }
  const th = location.match(/tavernHelper\[(\d+)\]\.(\w+)/);
  if (th) { const p = `data.extensions.tavern_helper.scripts[${th[1]}].${th[2]}`; return fields.find(f => f.path === p) ? p : null; }
  const direct: Record<string, string> = { system_prompt: 'data.system_prompt', description: 'data.description', first_mes: 'data.first_mes', mes_example: 'data.mes_example' };
  if (direct[location]) return fields.find(f => f.path === direct[location]) ? direct[location] : null;
  return fields.find(f => f.path === location)?.path || fields.find(f => f.label === location)?.path || null;
}

/* ═══ Category-specific fix hints for AI prompts ═══ */

const CATEGORY_FIX_HINTS: Record<string, string> = {
  key_collision: `KEY COLLISION FIX RULES:
- Identify the colliding keys mentioned in the issue.
- Assign UNIQUE translated names to each original key (e.g. if both "前秦" and "前燕" were translated to "Tiền Yên", change one of them to "Tiền Tần" and the other to "Tiền Yên").
- Never map two different CJK keys to the same translated key inside the same JS object.`,

  macro_damaged: `MACRO FIX RULES:
- Restore missing {{macros}} EXACTLY as they appear in the ORIGINAL text
- Do NOT translate macro content (e.g. {{getvar::好感度}} must stay as-is or use MVU dictionary mapping)
- Common macros: {{char}}, {{user}}, {{getvar::X}}, {{setvar::X::V}}, {{random}}, {{roll}}
- If a macro was partially translated (e.g. "{{nhận biến::X}}"), restore it to original syntax`,

  bracket_mismatch: `BRACKET FIX RULES:
- Count ALL brackets in ORIGINAL: (), {}, []
- Your output MUST have the EXACT same count of each bracket type
- Do NOT add or remove brackets — match the original exactly
- Pay special attention to nested brackets in code blocks`,

  html_broken: `HTML FIX RULES:
- Every opening tag must have a matching closing tag (or be self-closing)
- Preserve ALL attributes: class, id, data-var, style, etc.
- Do NOT translate attribute values (class names, ids, data-var values)
- Keep the exact same HTML structure as the ORIGINAL`,

  residual_source: `TRANSLATION FIX RULES:
- Translate ALL remaining source language text to the target language
- Do NOT leave any untranslated Chinese/Japanese/Korean characters
- Keep all code, macros, HTML, and technical identifiers unchanged
- Only translate natural language text portions`,

  json_broken: `JSON FIX RULES:
- The output MUST be valid JSON
- Preserve all JSON keys exactly (do NOT translate keys)
- Only translate string values that contain natural language
- Ensure proper escaping of quotes and special characters`,

  mvu_inconsistent: `MVU VARIABLE FIX RULES:
- Replace original variable names with their MVU dictionary translations
- Apply the replacement EVERYWHERE: data-var attributes, {{getvar::}}, {{setvar::}}, YAML keys, etc.
- Use EXACTLY the dictionary mapping — do NOT invent your own translations`,

  length_anomaly: `LENGTH FIX RULES:
- If too short: the translation is likely truncated, restore the missing content
- If too long: remove duplicate or excessive content
- The output length should be proportional to the original`,

  regex_broken: `REGEX FIX RULES:
- The output MUST be a valid Javascript Regular Expression literal
- It MUST start with a slash (/) and end with a slash (/), optionally followed by flags (e.g. /g, /i, /s)
- If the ORIGINAL regex had boundary slashes, the TRANSLATION must have exactly matching boundary slashes
- DO NOT wrap the regex in quotes or markdown (no backticks)
- Only translate the natural language (e.g. Chinese) text inside the regex pattern`,

  code_splice: `CODE STRUCTURE FIX RULES:
- Count ALL curly braces { } in the ORIGINAL — your output MUST have the EXACT same count
- Do NOT break function bodies: every function() { must have its matching }
- Do NOT break script/style blocks: every opening tag must have a matching closing tag
- Preserve ALL arrow functions: () => { ... } must remain intact
- If template literals (backticks) are broken, restore the missing backtick`,

  css_class_sync: `CSS CLASS/ID FIX RULES:
- CSS class names and IDs must NEVER be translated
- Restore the original class="..." and id="..." attribute values exactly
- If JS code references a class/ID (e.g. querySelector('.stat-bar')), it must match the HTML class/ID`,

  function_signature: `FUNCTION NAME FIX RULES:
- JavaScript function names must NEVER be translated
- Restore function names exactly as in the ORIGINAL: function myFunc() { ... }
- API calls (fetch, addEventListener, querySelector, etc.) must NEVER be translated
- Variable names declared with const/let/var must NEVER be translated`,

  template_literal_content: `TEMPLATE LITERAL FIX RULES:
- JavaScript expressions inside \${...} must NEVER be translated
- These are code expressions, not text: \${variable}, \${obj.property}, \${fn()}
- Only translate the text OUTSIDE of \${...} interpolations
- Restore any \${...} expressions that were accidentally translated or removed`,
};

/* ═══ Validate fix quality — multi-layer checks ═══ */

function validateFixQuality(
  original: string,
  currentTranslation: string,
  fixedText: string,
  mvuDictionary: Record<string, string>,
  sourceLang: string,
  field: TranslationField,
  initialIssueCount = 0
): { valid: boolean; reason?: string } {
  // 0. (bug 213) Marker cắt cụt KHÔNG BAO GIỜ được phép chui vào thẻ. Khi field quá khổ,
  // prompt chỉ gửi một đoạn; nếu AI chép luôn cái marker "[... N chars truncated ...]" của
  // ta hoặc tự bịa marker tương tự thì bản sửa đó đang mô tả phần nó KHÔNG nhìn thấy.
  if (/\[\s*\.{3}\s*\d+\s*chars?(?:\s+truncated)?\s*\.{3}\s*\]/i.test(fixedText)) {
    return { valid: false, reason: 'Bản AI sửa chứa marker cắt cụt "[... N chars ...]" — AI đang chép lại phần nó không nhìn thấy, không áp dụng.' };
  }

  // 1. Length ratio check: fix shouldn't be drastically different from current
  const lengthRatio = fixedText.length / currentTranslation.length;
  if (lengthRatio < 0.4) {
    return { valid: false, reason: `Bản AI sửa bị NGẮN bất thường (${fixedText.length} vs ${currentTranslation.length} ký tự), nghi bị cắt cụt nên không áp dụng.` };
  }
  if (lengthRatio > 3.0) {
    return { valid: false, reason: `Bản AI sửa DÀI bất thường (${fixedText.length} vs ${currentTranslation.length} ký tự), nghi lặp/thừa nên không áp dụng.` };
  }

  // 2. Macro preservation: fix must keep all macros from original
  const origMacros = extractMacros(original);
  const fixMacros = extractMacros(fixedText);
  if (origMacros.length > 0) {
    const origSet = new Set(origMacros);
    const fixSet = new Set(fixMacros);
    // Check standard macros ({{char}}, {{user}}, etc.) — these MUST be preserved
    const stdMacroPattern = /^\{\{(char|user|random|roll|time|date|idle_duration|input|lastMessage|newline|trim|noop)\}\}$/i;
    for (const m of origSet) {
      if (stdMacroPattern.test(m) && !fixSet.has(m)) {
        return { valid: false, reason: `Bản AI sửa làm MẤT macro quan trọng "${m}" (vd {{user}}/{{char}}), không áp dụng.` };
      }
    }
    // For variable macros, allow MVU dictionary remapping
    for (const m of origSet) {
      if (!fixSet.has(m) && !stdMacroPattern.test(m)) {
        const varMatch = m.match(/\{\{(getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/);
        if (varMatch) {
          const varName = varMatch[2].trim();
          // Forward lookup
          const mapped = mvuDictionary[varName];
          if (mapped && fixSet.has(m.replace(varName, mapped))) continue;
          // Reverse lookup
          const reverseMapped = Object.entries(mvuDictionary).find(([, v]) => v === varName)?.[0];
          if (reverseMapped && fixSet.has(m.replace(varName, reverseMapped))) continue;
          // Partial match: same macro type with MVU-known variable
          const macroType = varMatch[1];
          const hasAnyMVUVariant = [...fixSet].some(fm => {
            const fmMatch = fm.match(new RegExp(`\\{\\{${macroType}::([^:}]+)`));
            if (!fmMatch) return false;
            const fmVar = fmMatch[1].trim();
            return Object.keys(mvuDictionary).includes(fmVar) || Object.values(mvuDictionary).includes(fmVar);
          });
          if (hasAnyMVUVariant) continue;
        }
        // Missing non-standard macro — warning but not necessarily invalid
      }
    }
    // Total macro count check: fix shouldn't have significantly fewer macros
    if (fixMacros.length < origMacros.length * 0.5) {
      return { valid: false, reason: `Bản AI sửa mất quá nhiều macro (còn ${fixMacros.length}/${origMacros.length}), không áp dụng.` };
    }
  }

  // 3. Regex preservation check: if original was a regex literal, the fix must also be a regex literal
  if (field.label.includes('findRegex')) {
    if (/^\/[\s\S]+\/[a-z]*$/i.test(original)) {
      if (!/^\/[\s\S]+\/[a-z]*$/i.test(fixedText)) {
        return { valid: false, reason: `Bản AI sửa làm hỏng cú pháp regex (mất dấu /.../), không áp dụng.` };
      }
    }
  }

  // 4. Bracket integrity: fix should match original bracket counts
  const origBrackets = countBrackets(original);
  const fixBrackets = countBrackets(fixedText);
  for (const [pair, [origOpen, origClose]] of Object.entries(origBrackets)) {
    const [fixOpen, fixClose] = fixBrackets[pair];
    const origBalance = origOpen - origClose;
    const fixBalance = fixOpen - fixClose;
    // Allow small deviation (±2) for complex fields
    if (Math.abs(origBalance - fixBalance) > 2) {
      return { valid: false, reason: `Bản AI sửa làm LỆCH ngoặc ${pair} (gốc ${origBalance}, sửa ${fixBalance}), nghi vỡ code nên không áp dụng.` };
    }
  }

  // 5. Issue regression check — weighted severity score with tolerance
  const mockBefore = { ...field, translated: currentTranslation };
  const mockAfter = { ...field, translated: fixedText };
  const issuesBefore = verifyFields([mockBefore], mvuDictionary, sourceLang);
  const issuesAfter = verifyFields([mockAfter], mvuDictionary, sourceLang);

  const scoreIssues = (list: typeof issuesBefore) =>
    list.reduce((s, i) => s + (i.severity === 'error' ? 3 : i.severity === 'warning' ? 1 : 0), 0);
  const scoreBefore = scoreIssues(issuesBefore);
  const scoreAfter = scoreIssues(issuesAfter);

  // When field was structurally clean (scoreBefore=0), issues were content-level
  // (VerifyIssues from AI verify, not FieldIssues from verifyFields).
  // Allow proportional structural cost: up to 1 warning per 2 issues being fixed.
  const tolerance = scoreBefore === 0
    ? Math.max(3, Math.ceil(initialIssueCount / 2))
    : 0;

  if (scoreAfter > scoreBefore + tolerance) {
    return { valid: false, reason: `Bản AI sửa lại còn NHIỀU LỖI HƠN bản gốc (điểm lỗi ${scoreBefore} → ${scoreAfter}, càng cao càng nhiều lỗi). KHÔNG áp dụng để không làm hỏng thẻ.` };
  }
  if (issuesAfter.length > issuesBefore.length + Math.max(2, Math.ceil(initialIssueCount / 3))) {
    return { valid: false, reason: `Bản AI sửa làm TĂNG số lỗi (${issuesBefore.length} → ${issuesAfter.length} chỗ), không áp dụng.` };
  }

  return { valid: true };
}

/* ═══ Smart truncate — keep context around issues ═══ */

function smartTruncate(text: string, maxChars: number, issuePositions?: number[]): string {
  if (text.length <= maxChars) return text;
  
  if (!issuePositions || issuePositions.length === 0) {
    // No issue positions — use head/tail split
    const headSize = Math.floor(maxChars * 0.4);
    const tailSize = Math.floor(maxChars * 0.4);
    const head = text.slice(0, headSize);
    const tail = text.slice(-tailSize);
    return head + `\n\n[... ${text.length - headSize - tailSize} chars truncated ...]\n\n` + tail;
  }
  
  // Build segments: head (20%) + issue contexts (60%) + tail (20%)
  const headSize = Math.floor(maxChars * 0.2);
  const tailSize = Math.floor(maxChars * 0.2);
  const contextBudget = maxChars - headSize - tailSize;
  const contextPerIssue = Math.floor(contextBudget / issuePositions.length);
  const contextRadius = Math.floor(contextPerIssue / 2);
  
  let result = text.slice(0, headSize);
  let lastEnd = headSize;
  
  // Sort issue positions
  const sorted = [...issuePositions].sort((a, b) => a - b);
  
  for (const pos of sorted) {
    const start = Math.max(lastEnd, pos - contextRadius);
    const end = Math.min(text.length, pos + contextRadius);
    if (start > lastEnd + 100) {
      result += `\n[...${start - lastEnd} chars...]\n`;
    }
    result += text.slice(start, end);
    lastEnd = end;
  }
  
  if (lastEnd < text.length - tailSize - 100) {
    result += `\n[...${text.length - tailSize - lastEnd} chars...]\n`;
  }
  result += text.slice(-tailSize);
  
  return result.slice(0, maxChars + 500); // allow slight overshoot for markers
}

/* ═══ (bug 213) Cửa sổ vá — không bao giờ để bản CẮT CỤT thay cả field ═══
 *
 * Trước đây field dài hơn hạn mức bị smartTruncate cắt thành đầu+đuôi kèm marker
 * "[... N chars truncated ...]" rồi gửi AI, NHƯNG bản AI trả về (viết dựa trên bản đã cắt)
 * lại được nhận làm bản dịch mới cho TOÀN field → khúc giữa bốc hơi vĩnh viễn và marker rác
 * chui thẳng vào thẻ xuất ra. Lớp chặn duy nhất là tỉ lệ độ dài ≥ 0.4 nên field cỡ 66K–160K
 * lọt qua trót lọt.
 *
 * Giờ field quá khổ chỉ gửi MỘT đoạn liền mạch (cửa sổ quanh chỗ lỗi), và bản sửa được ghép
 * trở lại đúng vị trí cũ: đầu + đoạn đã sửa + đuôi. Phần nằm ngoài cửa sổ không hề bị đụng,
 * nên không còn đường nào làm mất dữ liệu.
 */
export function pickFixWindow(text: string, anchors: number[], budget: number): { start: number; end: number } {
  if (text.length <= budget) return { start: 0, end: text.length };

  const valid = anchors.filter(a => a >= 0 && a < text.length).sort((a, b) => a - b);
  const center = valid.length > 0 ? valid[Math.floor(valid.length / 2)] : Math.floor(text.length / 2);

  let start = Math.max(0, center - Math.floor(budget / 2));
  let end = Math.min(text.length, start + budget);
  start = Math.max(0, end - budget);

  // Bám ranh giới dòng cho đoạn gọn gàng — chỉ co VÀO trong, không nới ra ngoài ngân sách.
  if (start > 0) {
    const nl = text.indexOf('\n', start);
    if (nl !== -1 && nl - start < 500) start = nl + 1;
  }
  if (end < text.length) {
    const nl = text.lastIndexOf('\n', end);
    if (nl > start && end - nl < 500) end = nl;
  }
  return { start, end };
}

/** Get dynamic content limit based on model name */
function getModelContentLimit(model: string): number {
  const m = model.toLowerCase();
  if (m.includes('gemini-2.5') || m.includes('gemini-2.0')) return 200000;
  if (m.includes('gemini')) return 120000;
  if (m.includes('claude-3.5') || m.includes('claude-3-5') || m.includes('claude-4')) return 150000;
  if (m.includes('claude')) return 100000;
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 80000;
  if (m.includes('deepseek')) return 60000;
  return 60000; // safe default for unknown models
}

/* ═══ Build category-aware fix prompt ═══ */

function buildFixPrompt(
  issueList: (FieldIssue | VerifyIssue)[],
  field: TranslationField,
  targetLang: string,
  mvuBlock: string,
  roundInfo?: { round: number; prevFixFeedback?: string },
  modelName?: string,
): { system: string; user: string; window?: { start: number; end: number } } {
  const issueDesc = issueList.map((i, idx) => {
    const cat = 'category' in i ? (i as FieldIssue).category : null;
    return `${idx + 1}. [${i.severity}${cat ? '/' + cat : ''}] ${i.description}${i.original ? ` | original: "${i.original}"` : ''}${i.suggestion ? ` | hint: ${i.suggestion}` : ''}`;
  }).join('\n');

  // Collect unique categories for category-specific hints
  const categories = new Set<string>();
  for (const i of issueList) {
    if ('category' in i) categories.add((i as FieldIssue).category);
  }
  const categoryHints = [...categories]
    .map(cat => CATEGORY_FIX_HINTS[cat])
    .filter(Boolean)
    .join('\n\n');

  const roundNote = roundInfo && roundInfo.round > 1
    ? `\n\nNOTE: This is fix attempt #${roundInfo.round}. Previous fix was rejected because: ${roundInfo.prevFixFeedback || 'validation failed'}. Please be more careful this time.`
    : '';

  // Dynamic content limit based on model
  const contentLimit = Math.floor(getModelContentLimit(modelName || 'unknown') / 3); // /3 because we send original + translation + system

  // Find issue positions in the text for windowing
  const issuePositions: number[] = [];
  for (const issue of issueList) {
    if (issue.original && issue.original.length > 3) {
      const pos = field.original.indexOf(issue.original);
      if (pos !== -1) issuePositions.push(pos);
    }
  }

  // (bug 213) Vị trí lỗi đo trên bản GỐC. Suy ra vị trí tương ứng bên bản dịch theo tỉ lệ độ dài
  // để hai cửa sổ nhìn CÙNG một khúc — trước đây offset của bản gốc được đem cắt thẳng bản dịch
  // nên hai bên lệch nhau, AI đối chiếu nhầm đoạn.
  const lenRatio = field.original.length > 0 ? field.translated.length / field.original.length : 1;
  const transAnchors = issuePositions.map(p => Math.round(p * lenRatio));

  const origWin = pickFixWindow(field.original, issuePositions, contentLimit);
  const transWin = pickFixWindow(field.translated, transAnchors, contentLimit);
  const origContent = field.original.slice(origWin.start, origWin.end);
  const transContent = field.translated.slice(transWin.start, transWin.end);
  const windowed = transWin.start > 0 || transWin.end < field.translated.length;

  const excerptRule = windowed
    ? `

⚠️ EXCERPT MODE — THIS FIELD IS TOO LARGE TO SEND IN FULL:
- The texts below are a CONTIGUOUS EXCERPT of a much larger field, cut at the exact boundaries shown.
- Return ONLY the corrected version of THIS EXCERPT: same starting words, same ending words, nothing before, nothing after.
- Do NOT write "..." , do NOT summarize, do NOT mention that text was omitted, do NOT try to reconstruct the parts you cannot see.
- The excerpt will be spliced back into the full field at its exact position, so its boundaries must stay intact.`
    : '';

  const system = `You fix SPECIFIC translation errors in SillyTavern character card fields.
Return ONLY the corrected translated text. No explanations, no markdown code fences, no extra text.

CRITICAL RULES:
- Fix ONLY the issues listed below. Do NOT modify any other part of the text.
- Preserve ALL {{macros}} exactly as in ORIGINAL (e.g. {{user}}, {{char}}, {{getvar::xxx}})
- Preserve ALL HTML tags, CSS classes/IDs, code blocks exactly
- Preserve ALL bracket patterns {} [] () — match the ORIGINAL count exactly
- Do NOT re-translate or rephrase parts that are already correctly translated
- Do NOT change variable names, function names, or technical identifiers
- Do NOT add or remove line breaks unless an issue specifically requires it
- The output length should be very close to the input translation length
${categoryHints ? '\n' + categoryHints : ''}${mvuBlock}${roundNote}${excerptRule}${fandomNameOverride()}`;

  const user = `Fix this ${targetLang} translation. ONLY fix the listed issues.

ORIGINAL${windowed ? ' (excerpt)' : ''}:
${origContent}

CURRENT TRANSLATION${windowed ? ' (excerpt — return exactly this range, corrected)' : ''}:
${transContent}

ISSUES TO FIX:
${issueDesc}

Return the corrected translation (fix ONLY the issues above, change nothing else):`;

  return { system, user, window: windowed ? transWin : undefined };
}

/* ═══ AI Fix Issues — multi-round LLM fix with quality validation ═══ */

export async function aiFixIssues(
  issues: (FieldIssue | VerifyIssue)[],
  fields: TranslationField[],
  config: ProxySettings,
  targetLang: string,
  onProgress?: (done: number, total: number, label: string, round?: number) => void,
  signal?: AbortSignal,
  mvuDictionary: Record<string, string> = {},
  sourceLang = 'Chinese',
  maxRounds = 3
): Promise<AIFixReport> {
  const report: AIFixReportEntry[] = [];
  const bestFixes = new Map<string, { fixedText: string; issuesAfter: number; round: number }>();

  // Group issues by field path
  const byField = new Map<string, { issueList: (FieldIssue | VerifyIssue)[]; field: TranslationField }>();
  for (const issue of issues) {
    let path = 'fieldPath' in issue ? (issue as FieldIssue).fieldPath : null;
    if (!path) path = locationToFieldPath(issue.location, fields);
    if (!path) continue;
    const field = fields.find(f => f.path === path);
    if (!field?.translated) continue;
    if (!byField.has(path)) byField.set(path, { issueList: [], field });
    byField.get(path)!.issueList.push(issue);
  }

  const total = byField.size;
  const mvuTerms = Object.entries(mvuDictionary).map(([k, v]) => `"${k}" → "${v}"`).slice(0, 50);
  const mvuBlock = mvuTerms.length > 0 ? `\nMVU DICTIONARY (these term pairs MUST be preserved exactly):\n${mvuTerms.join('\n')}` : '';

  // Track fields that still need fixing per round
  let fieldsToFix = new Map(byField);
  let roundsCompleted = 0;

  for (let round = 1; round <= maxRounds && fieldsToFix.size > 0; round++) {
    if (signal?.aborted) break;
    roundsCompleted = round;
    let done = 0;

    // (bugNeedFix/177) TRONG MỘT VÒNG, các field được sửa SONG SONG.
    // Các VÒNG vẫn tuần tự — vòng sau lấy bản sửa tốt nhất của vòng trước làm điểm xuất phát.
    // Nhưng trong cùng một vòng thì mỗi field độc lập hoàn toàn: không field nào đọc kết quả của
    // field khác, mỗi cái ghi vào bestFixes theo `path` riêng. Nên song song ở đây không đổi kết
    // quả, chỉ bỏ phần ngồi chờ giữa các call.
    const roundJobs = [...fieldsToFix.entries()];
    await runWorkerPool({
      total: roundJobs.length,
      concurrency: verifyConcurrency(config),
      shouldStop: () => !!signal?.aborted,
      runOne: async (ji: number) => {
      const [path, { issueList, field: origField }] = roundJobs[ji];
      if (signal?.aborted) return;
      onProgress?.(done, fieldsToFix.size, origField.label, round);

      // Use the best fix so far as the current translation for subsequent rounds
      const currentTranslation = bestFixes.has(path)
        ? bestFixes.get(path)!.fixedText
        : origField.translated;
      const workingField = { ...origField, translated: currentTranslation };

      // Re-verify current state to get accurate issue list for round > 1
      let currentIssueList = issueList;
      if (round > 1) {
        const recheck = verifyFields([workingField], mvuDictionary, sourceLang);
        if (recheck.length === 0) {
          // Already clean — skip
          done++;
          return;
        }
        currentIssueList = recheck;
      }

      // Pre-fix: apply cumulative auto-fixes computed in verifyFields
      let preFixedTranslation = currentTranslation;
      const fieldIssueList = currentIssueList as FieldIssue[];
      
      const autoFixes = fieldIssueList.filter(
        i => 'autoFixable' in i && i.autoFixable && i.fixValue
      );
      
      if (autoFixes.length > 0) {
        // Since verifyFields accumulates fixes sequentially into fixValue,
        // we can simply take the fixValue from the last auto-fixable issue.
        preFixedTranslation = autoFixes[autoFixes.length - 1].fixValue!;
      }

      if (preFixedTranslation !== currentTranslation) {
        const postAutoFix = { ...workingField, translated: preFixedTranslation };
        const remainingAfterAutoFix = verifyFields([postAutoFix], mvuDictionary, sourceLang);
        if (remainingAfterAutoFix.length === 0) {
          bestFixes.set(path, { fixedText: preFixedTranslation, issuesAfter: 0, round });
          report.push({
            path, label: origField.label, status: 'accepted', round,
            reason: 'All issues auto-fixed without LLM',
            issuesBefore: currentIssueList.length, issuesAfter: 0,
          });
          done++;
          onProgress?.(done, fieldsToFix.size, origField.label, round);
          return;
        }
        // Update baseline for LLM and validation
        workingField.translated = preFixedTranslation;
        currentIssueList = remainingAfterAutoFix;
      }

      // IMPORTANT: use the actual working translation as baseline for validation
      const effectiveTranslation = workingField.translated;

      const prevFeedback = round > 1 && report.length > 0
        ? report.filter(r => r.path === path && r.status === 'rejected').map(r => r.reason).pop()
        : undefined;

      const { system, user, window: fixWindow } = buildFixPrompt(
        currentIssueList, workingField, targetLang, mvuBlock,
        { round, prevFixFeedback: prevFeedback },
        config.model,
      );

      const issuesBefore = verifyFields([workingField], mvuDictionary, sourceLang);
      const initialIssueCount = currentIssueList.length;

      try {
        let fixed = await callLLM(config, system, user, signal);
        
        // Strip markdown code fences if present anywhere
        const mdMatch = fixed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
        if (mdMatch) fixed = mdMatch[1].trim();
        else fixed = fixed.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();

        // (bug 213) Khi gửi cửa sổ, ngưỡng "quá ngắn" phải đo theo CỬA SỔ chứ không phải cả field —
        // lấy cả field làm mốc thì bản sửa đúng của một đoạn nhỏ luôn bị coi là cụt.
        const expectedLen = fixWindow ? fixWindow.end - fixWindow.start : effectiveTranslation.length;
        if (!fixed || fixed.length < Math.max(10, expectedLen * 0.3)) {
          report.push({
            path, label: origField.label, status: 'rejected', round,
            reason: `Empty or too short response (${fixed?.length || 0} chars)`,
            issuesBefore: issuesBefore.length, issuesAfter: issuesBefore.length,
          });
          done++;
          onProgress?.(done, fieldsToFix.size, origField.label, round);
          return;
        }

        // (bug 213) Field quá khổ → AI chỉ nhìn thấy MỘT đoạn. Ghép đoạn đã sửa trở lại đúng chỗ
        // thay vì lấy nó làm cả field: đầu + đoạn sửa + đuôi. Mọi lớp kiểm bên dưới chạy trên bản
        // ĐẦY ĐỦ này, nên guard độ dài/macro/ngoặc vẫn soi được toàn field như trước.
        const fixedFull = fixWindow
          ? effectiveTranslation.slice(0, fixWindow.start) + fixed + effectiveTranslation.slice(fixWindow.end)
          : fixed;

        // Multi-layer validation — pass initialIssueCount for tolerance
        const validation = validateFixQuality(
          origField.original, effectiveTranslation, fixedFull, mvuDictionary, sourceLang, workingField, initialIssueCount
        );

        if (!validation.valid) {
          report.push({
            path, label: origField.label, status: 'rejected', round,
            reason: validation.reason || 'Quality check failed',
            issuesBefore: issuesBefore.length, issuesAfter: issuesBefore.length,
          });
          done++;
          onProgress?.(done, fieldsToFix.size, origField.label, round);
          return;
        }

        // Count issues after fix
        const mockAfter = { ...workingField, translated: fixedFull };
        const issuesAfter = verifyFields([mockAfter], mvuDictionary, sourceLang);

        // Accept if this is the best result so far
        const currentBest = bestFixes.get(path);
        if (!currentBest || issuesAfter.length < currentBest.issuesAfter) {
          bestFixes.set(path, { fixedText: fixedFull, issuesAfter: issuesAfter.length, round });
          report.push({
            path, label: origField.label, status: 'accepted', round,
            issuesBefore: issuesBefore.length, issuesAfter: issuesAfter.length,
          });
        } else {
          report.push({
            path, label: origField.label, status: 'rejected', round,
            reason: `Not better than round ${currentBest.round} (${issuesAfter.length} issues vs ${currentBest.issuesAfter})`,
            issuesBefore: issuesBefore.length, issuesAfter: issuesAfter.length,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.push({
          path, label: origField.label, status: 'error', round,
          reason: msg.slice(0, 150),
          issuesBefore: issuesBefore.length, issuesAfter: issuesBefore.length,
        });
      }

      done++;
      onProgress?.(done, fieldsToFix.size, origField.label, round);
      },
    });

    // Remove fields that are now clean (0 issues)
    const nextFieldsToFix = new Map<string, { issueList: (FieldIssue | VerifyIssue)[]; field: TranslationField }>();
    for (const [path, data] of fieldsToFix) {
      const best = bestFixes.get(path);
      if (best && best.issuesAfter > 0) {
        nextFieldsToFix.set(path, data);
      } else if (!best) {
        nextFieldsToFix.set(path, data);
      }
    }
    fieldsToFix = nextFieldsToFix;
  }

  // Build final results from best fixes
  const fixes = [...bestFixes.entries()].map(([path, { fixedText }]) => ({ path, fixedText }));

  return {
    fixes,
    report,
    roundsCompleted,
    totalAccepted: report.filter(r => r.status === 'accepted').length,
    totalRejected: report.filter(r => r.status === 'rejected').length,
    totalErrors: report.filter(r => r.status === 'error').length,
  };
}

/* ═══ AI Fix Single Issue — targeted fix for one specific issue ═══ */

export async function aiFixSingleIssue(
  issue: FieldIssue,
  fields: TranslationField[],
  config: ProxySettings,
  targetLang: string,
  signal?: AbortSignal,
  mvuDictionary: Record<string, string> = {},
  sourceLang = 'Chinese'
): Promise<{ success: boolean; fixedText?: string; reason?: string }> {
  const field = fields.find(f => f.path === issue.fieldPath);
  if (!field?.translated) return { success: false, reason: 'Field not found or empty' };

  const mvuTerms = Object.entries(mvuDictionary).map(([k, v]) => `"${k}" → "${v}"`).slice(0, 50);
  const mvuBlock = mvuTerms.length > 0 ? `\nMVU DICTIONARY:\n${mvuTerms.join('\n')}` : '';

  const categoryHint = CATEGORY_FIX_HINTS[issue.category] || '';

  // (bug 213) Cùng thuốc với aiFixIssues: field quá khổ thì chỉ gửi MỘT đoạn liền mạch quanh chỗ
  // lỗi rồi ghép lại đúng vị trí — không để bản dựa trên văn bản cắt cụt thay cả field.
  const singleLimit = Math.floor(getModelContentLimit(config.model) / 3);
  const anchorOrig = issue.original && issue.original.length > 3
    ? field.original.indexOf(issue.original)
    : -1;
  const singleRatio = field.original.length > 0 ? field.translated.length / field.original.length : 1;
  const origWin = pickFixWindow(field.original, anchorOrig >= 0 ? [anchorOrig] : [], singleLimit);
  const transWin = pickFixWindow(
    field.translated,
    anchorOrig >= 0 ? [Math.round(anchorOrig * singleRatio)] : [],
    singleLimit,
  );
  const windowed = transWin.start > 0 || transWin.end < field.translated.length;

  const systemPrompt = `You fix ONE SPECIFIC translation error in a SillyTavern character card field.
Return ONLY the corrected translated text. No explanations, no markdown code fences.

RULES:
- Fix ONLY the ONE issue described below. Change NOTHING else.
- Preserve ALL {{macros}}, HTML tags, brackets, code blocks exactly.
- Output length must be very close to input length.
${categoryHint ? '\n' + categoryHint : ''}${mvuBlock}${windowed ? `

⚠️ EXCERPT MODE — THIS FIELD IS TOO LARGE TO SEND IN FULL:
- The texts below are a CONTIGUOUS EXCERPT, cut at the exact boundaries shown.
- Return ONLY the corrected version of THIS EXCERPT: same starting words, same ending words.
- Do NOT write "...", do NOT summarize, do NOT mention omitted text, do NOT reconstruct what you cannot see.` : ''}${fandomNameOverride()}`;

  const userPrompt = `Fix this ONE issue in the ${targetLang} translation.

ISSUE: [${issue.severity}/${issue.category}] ${issue.description}
${issue.original ? `Original snippet: "${issue.original}"` : ''}
${issue.suggestion ? `Hint: ${issue.suggestion}` : ''}

ORIGINAL TEXT${windowed ? ' (excerpt)' : ''}:
${field.original.slice(origWin.start, origWin.end)}

CURRENT TRANSLATION${windowed ? ' (excerpt — return exactly this range, corrected)' : ''}:
${field.translated.slice(transWin.start, transWin.end)}

Return the corrected translation:`;

  try {
    let fixed = await callLLM(config, systemPrompt, userPrompt, signal);
    
    // Strip markdown code fences if present anywhere
    const mdMatch = fixed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (mdMatch) fixed = mdMatch[1].trim();
    else fixed = fixed.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();

    const expectedLen = windowed ? transWin.end - transWin.start : field.translated.length;
    if (!fixed || fixed.length < Math.max(10, expectedLen * 0.3)) {
      return { success: false, reason: 'AI returned empty or truncated result' };
    }

    // (bug 213) Ghép đoạn đã sửa về đúng vị trí trong field đầy đủ trước khi kiểm & trả về.
    const fixedFull = windowed
      ? field.translated.slice(0, transWin.start) + fixed + field.translated.slice(transWin.end)
      : fixed;

    // Validate quality
    const validation = validateFixQuality(
      field.original, field.translated, fixedFull, mvuDictionary, sourceLang, field, 1
    );

    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    // Specific check: did this particular issue get resolved?
    const mockBefore = { ...field, translated: field.translated };
    const mockAfter = { ...field, translated: fixedFull };
    const issuesBefore = verifyFields([mockBefore], mvuDictionary, sourceLang);
    const issuesAfter = verifyFields([mockAfter], mvuDictionary, sourceLang);

    // Check if the specific category was reduced
    const catBefore = issuesBefore.filter(i => i.category === issue.category).length;
    const catAfter = issuesAfter.filter(i => i.category === issue.category).length;

    if (catAfter >= catBefore && issuesAfter.length >= issuesBefore.length) {
      return { success: false, reason: `Issue not resolved (${issue.category}: ${catBefore} → ${catAfter})` };
    }

    return { success: true, fixedText: fixedFull };
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/* ═══ Streaming AI Deep Verify — section by section ═══ */

export interface StreamingVerifyProgress {
  currentSection: string;
  sectionIndex: number;
  totalSections: number;
  issuesSoFar: VerifyIssue[];
  status: 'scanning' | 'done' | 'cancelled';
  sectionResults: { name: string; status: 'ok' | 'issues' | 'error' | 'pending'; issueCount: number }[];
}

interface VerifySection {
  name: string;       // "regex[0] Display_System"
  origContent: string;
  transContent: string;
  type: 'regex' | 'tavern_helper' | 'lorebook' | 'core';
}

function buildVerifySections(
  originalCard: CharacterCard,
  translatedCard: CharacterCard,
): VerifySection[] {
  const sections: VerifySection[] = [];
  const origData = originalCard.data;
  const transData = translatedCard.data;
  if (!origData || !transData) return sections;

  // Regex scripts
  if (origData.extensions?.regex_scripts && transData.extensions?.regex_scripts) {
    const origRegex = origData.extensions.regex_scripts;
    const transRegex = transData.extensions.regex_scripts;
    for (let i = 0; i < Math.min(origRegex.length, transRegex.length); i++) {
      const hasContent = origRegex[i].replaceString?.length > 50 || origRegex[i].findRegex?.length > 20;
      if (hasContent) {
        let origContent = '';
        let transContent = '';
        if (origRegex[i].replaceString) {
          origContent += `=== replaceString ===\n${origRegex[i].replaceString}`;
          transContent += `=== replaceString ===\n${transRegex[i].replaceString || ''}`;
        }
        if (origRegex[i].findRegex) {
          origContent += `\n\n=== findRegex ===\n${origRegex[i].findRegex}`;
          transContent += `\n\n=== findRegex ===\n${transRegex[i].findRegex || ''}`;
        }
        if (origRegex[i].trimStrings?.length) {
          origContent += `\n\n=== trimStrings ===\n${(origRegex[i].trimStrings ?? []).join('\n---\n')}`;
          transContent += `\n\n=== trimStrings ===\n${(transRegex[i].trimStrings || []).join('\n---\n')}`;
        }
        sections.push({
          name: `regex[${i}] ${origRegex[i].scriptName || ''}`.trim(),
          origContent,
          transContent,
          type: 'regex',
        });
      }
    }
  }

  // TavernHelper scripts
  const extractTH = (ext: any): any[] => {
    const raw = ext?.tavern_helper;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) return item[1];
      }
      return raw.filter((s: any) => s && typeof s === 'object' && !Array.isArray(s));
    }
    return raw?.scripts || [];
  };
  const origTH = extractTH(origData.extensions);
  const transTH = extractTH(transData.extensions);
  for (let i = 0; i < Math.min(origTH.length, transTH.length); i++) {
    if (origTH[i]?.content?.length > 50) {
      sections.push({
        name: `tavernHelper[${i}] ${origTH[i].name || ''}`.trim(),
        origContent: origTH[i].content,
        transContent: transTH[i]?.content || '',
        type: 'tavern_helper',
      });
    }
  }

  // Lorebook entries (only code-heavy ones)
  if (origData.character_book?.entries && transData.character_book?.entries) {
    const origEntries = origData.character_book.entries;
    const transEntries = transData.character_book.entries;
    for (let i = 0; i < Math.min(origEntries.length, transEntries.length); i++) {
      const content = origEntries[i].content;
      if (content && content.length > 100 && /\{\{(get|set|add)(var|globalvar)::|z\.\w+|<script|function\s|=>\s*\{|class\s*=/.test(content)) {
        sections.push({
          name: `lorebook[${i}] ${origEntries[i].name || origEntries[i].comment || ''}`.trim(),
          origContent: content,
          transContent: transEntries[i]?.content || '',
          type: 'lorebook',
        });
      }
    }
  }

  // Core fields (grouped)
  const coreOrig: string[] = [];
  const coreTrans: string[] = [];
  const coreFields = [
    { key: 'system_prompt', orig: origData.system_prompt, trans: transData.system_prompt },
    { key: 'description', orig: origData.description, trans: transData.description },
    { key: 'first_mes', orig: origData.first_mes, trans: transData.first_mes },
    { key: 'mes_example', orig: origData.mes_example, trans: transData.mes_example },
  ];
  for (const cf of coreFields) {
    if (cf.orig && cf.orig.length > 50 && /\{\{|<[a-z]|function\s/.test(cf.orig)) {
      coreOrig.push(`=== ${cf.key} ===\n${cf.orig}`);
      coreTrans.push(`=== ${cf.key} ===\n${cf.trans || ''}`);
    }
  }
  if (coreOrig.length > 0) {
    sections.push({
      name: 'core (system_prompt, description, first_mes)',
      origContent: coreOrig.join('\n\n'),
      transContent: coreTrans.join('\n\n'),
      type: 'core',
    });
  }

  return sections;
}

export async function aiVerifyCardStreaming(
  originalCard: CharacterCard,
  translatedCard: CharacterCard,
  config: ProxySettings,
  targetLang: string,
  mvuDictionary: Record<string, string>,
  onProgress: (progress: StreamingVerifyProgress) => void,
  signal?: AbortSignal,
): Promise<VerifyResult> {
  // Step 1: Local verification first
  const localIssues = quickVerify(originalCard, translatedCard);
  const allIssues: VerifyIssue[] = [...localIssues];

  // Step 2: Build sections
  const sections = buildVerifySections(originalCard, translatedCard);
  
  if (sections.length === 0) {
    return {
      totalIssues: localIssues.length,
      errors: localIssues.filter(i => i.severity === 'error').length,
      warnings: localIssues.filter(i => i.severity === 'warning').length,
      info: 0,
      issues: localIssues,
      summary: localIssues.length === 0
        ? 'No code-heavy content found to verify. Card looks clean.'
        : `Found ${localIssues.length} issue(s) from local verification.`,
    };
  }

  const sectionResults: StreamingVerifyProgress['sectionResults'] = sections.map(s => ({
    name: s.name, status: 'pending' as const, issueCount: 0,
  }));

  // MVU context
  const mvuBlock = Object.keys(mvuDictionary).length > 0
    ? `\n\nMVU Variable Dictionary (Strategy B mappings):\n${Object.entries(mvuDictionary).map(([k, v]) => `  "${k}" → "${v}"`).join('\n')}`
    : '';

  // Content limit per section
  const modelLimit = getModelContentLimit(config.model);
  const sectionLimit = Math.floor(modelLimit / 2.5); // leave room for system prompt + response

  // ═══ (bugNeedFix/177) Step 3: quét CÁC SECTION SONG SONG ═══
  // Trước đây là `for` tuần tự: section sau chỉ bắt đầu khi section trước có phản hồi, nên thẻ
  // 20 section = 20 lượt chờ nối đuôi trong khi 10 luồng khác ngồi không.
  // Các section ĐỘC LẬP với nhau (mỗi cái một cặp gốc/dịch riêng, không dùng kết quả của nhau),
  // nên chạy song song không đổi kết quả — chỉ đổi thời gian.
  let doneCount = 0;
  await runWorkerPool({
    total: sections.length,
    concurrency: verifyConcurrency(config),
    shouldStop: () => !!signal?.aborted,
    runOne: async (i: number) => {
    const section = sections[i];
    onProgress({
      currentSection: section.name, sectionIndex: doneCount, totalSections: sections.length,
      issuesSoFar: allIssues, status: 'scanning', sectionResults,
    });

    // Build per-section prompt
    const origContent = section.origContent.length > sectionLimit
      ? smartTruncate(section.origContent, sectionLimit)
      : section.origContent;
    const transContent = section.transContent.length > sectionLimit
      ? smartTruncate(section.transContent, sectionLimit)
      : section.transContent;

    const systemPrompt = `You are a SillyTavern character card integrity auditor checking ONE SECTION of a translated card.
Compare ORIGINAL and TRANSLATED content, finding issues where translation broke functional elements.

CRITICAL ELEMENTS TO CHECK:
1. **SillyTavern Macros**: {{char}}, {{user}}, {{getvar::XXX}}, {{setvar::XXX::VALUE}} preserved EXACTLY
2. **Zod Schema Fields**: Field names, .prefault() values, schema structure
3. **EJS Templates**: <% %>, <%= %> blocks structurally preserved
4. **HTML data-var Attributes**: data-var="XXX" references valid variable names
5. **JavaScript Logic**: Function names, API calls, import statements NOT translated
6. **CSS Classes/IDs**: class="XXX" and id="XXX" NOT translated
7. **JSON Structure**: Embedded JSON remains valid
8. **Variable Consistency**: All MVU Dictionary mappings applied consistently
9. **Template Literals**: \${...} expressions NOT translated
10. **Length**: Translation should be similar length (especially for code-heavy content)
${mvuBlock}

RESPOND IN THIS EXACT JSON FORMAT (no markdown wrapping):
{
  "issues": [
    {
      "severity": "error|warning|info",
      "location": "${section.name}",
      "description": "Description of the issue",
      "original_snippet": "original code/text snippet",
      "translated_snippet": "current translated snippet",
      "suggested_fix": "what the translated snippet should be"
    }
  ],
  "summary": "One line summary for this section"
}

If everything is correct: {"issues": [], "summary": "Section verified OK."}`;

    const userPrompt = `Verify this section: **${section.name}** (${section.type})

ORIGINAL:
${origContent}

TRANSLATED:
${transContent}

Check ALL functional elements are preserved or correctly renamed per MVU Dictionary.`;

    try {
      const result = await callLLM(config, systemPrompt, userPrompt, signal);
      const parsed = parseAIVerifyResponse(result);
      
      // Add section name to issues that don't have it
      for (const issue of parsed.issues) {
        if (!issue.location || issue.location === 'unknown') {
          issue.location = section.name;
        }
      }

      allIssues.push(...parsed.issues);
      sectionResults[i] = {
        name: section.name,
        status: parsed.issues.length > 0 ? 'issues' : 'ok',
        issueCount: parsed.issues.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Bị huỷ thì đừng ghi "AI verification failed" — đó là user bấm dừng, không phải lỗi thẻ.
      if (signal?.aborted) return;

      sectionResults[i] = { name: section.name, status: 'error', issueCount: 0 };
      allIssues.push({
        id: crypto.randomUUID(),
        severity: 'info',
        location: section.name,
        description: `AI verification failed for this section: ${msg.slice(0, 150)}`,
        original: '', current: '', suggestion: '',
        autoFixable: false,
      });
    }

    // Tiến độ đếm theo SỐ VIỆC ĐÃ XONG, không theo chỉ số vòng lặp: chạy song song thì thứ tự
    // hoàn thành không còn trùng thứ tự phát việc, lấy `i` làm tiến độ sẽ nhảy giật lùi.
    doneCount++;
    onProgress({
      currentSection: section.name, sectionIndex: doneCount, totalSections: sections.length,
      issuesSoFar: allIssues, status: doneCount >= sections.length ? 'done' : 'scanning',
      sectionResults,
    });
    },
  });

  if (signal?.aborted) {
    onProgress({
      currentSection: '', sectionIndex: doneCount, totalSections: sections.length,
      issuesSoFar: allIssues, status: 'cancelled', sectionResults,
    });
  }

  return {
    totalIssues: allIssues.length,
    errors: allIssues.filter(i => i.severity === 'error').length,
    warnings: allIssues.filter(i => i.severity === 'warning').length,
    info: allIssues.filter(i => i.severity === 'info').length,
    issues: allIssues,
    summary: allIssues.length === 0
      ? `✅ All ${sections.length} sections verified. No issues found.`
      : `Scanned ${sections.length} sections. Found ${allIssues.length} issue(s).`,
  };
}

/* ═══ Regex-Only Scan & Fix ═══ */

export interface RegexScanProgress {
  currentRegex: string;
  regexIndex: number;
  totalRegex: number;
  issuesSoFar: VerifyIssue[];
  status: 'scanning' | 'fixing' | 'done' | 'cancelled';
  regexResults: { name: string; status: 'ok' | 'issues' | 'error' | 'pending'; issueCount: number }[];
}

export interface RegexFixResult {
  regexIndex: number;
  scriptName: string;
  fieldPath: string;
  fieldType: 'replaceString' | 'findRegex' | 'trimStrings';
  success: boolean;
  before: string;
  after: string;
  reason?: string;
}

/**
 * Scan all regex scripts for translation issues.
 * For each regex: sends FULL original + translated for AI comparison.
 * If a regex is too large, uses smartTruncate to stay within model limits.
 */
export async function aiRegexScan(
  fields: TranslationField[],
  config: ProxySettings,
  targetLang: string,
  mvuDictionary: Record<string, string>,
  sourceLang: string,
  onProgress: (progress: RegexScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ issues: VerifyIssue[]; regexResults: RegexScanProgress['regexResults'] }> {
  // Collect regex fields grouped by script index
  const regexScripts = new Map<number, { name: string; fields: TranslationField[] }>();
  for (const f of fields) {
    if (f.group !== 'regex' || !f.translated) continue;
    const idxMatch = f.path.match(/regex_scripts\[(\d+)\]/);
    if (!idxMatch) continue;
    const idx = parseInt(idxMatch[1]);
    if (!regexScripts.has(idx)) {
      const nameField = fields.find(nf => nf.path === `data.extensions.regex_scripts[${idx}].scriptName`);
      regexScripts.set(idx, { name: nameField?.translated || nameField?.original || `regex[${idx}]`, fields: [] });
    }
    regexScripts.get(idx)!.fields.push(f);
  }

  const scripts = [...regexScripts.entries()].sort((a, b) => a[0] - b[0]);
  const allIssues: VerifyIssue[] = [];
  const regexResults: RegexScanProgress['regexResults'] = scripts.map(([idx, s]) => ({
    name: `regex[${idx}] ${s.name}`, status: 'pending' as const, issueCount: 0,
  }));

  // Also run local verifyFields for regex fields only
  const regexFields = fields.filter(f => f.group === 'regex' && f.translated);
  const localIssues = verifyFields(regexFields, mvuDictionary, sourceLang);
  allIssues.push(...localIssues);

  const modelLimit = getModelContentLimit(config.model);
  const perRegexLimit = Math.floor(modelLimit / 2.5);

  const mvuBlock = Object.keys(mvuDictionary).length > 0
    ? `\n\nMVU Variable Dictionary:\n${Object.entries(mvuDictionary).map(([k, v]) => `  "${k}" → "${v}"`).join('\n')}`
    : '';

  // (bugNeedFix/177) Quét TỪNG SCRIPT REGEX SONG SONG — mỗi script là một cặp gốc/dịch độc lập.
  let scanDone = 0;
  await runWorkerPool({
    total: scripts.length,
    concurrency: verifyConcurrency(config),
    shouldStop: () => !!signal?.aborted,
    runOne: async (si: number) => {
    const [idx, script] = scripts[si];
    const label = `regex[${idx}] ${script.name}`;

    onProgress({
      currentRegex: label, regexIndex: scanDone, totalRegex: scripts.length,
      issuesSoFar: allIssues, status: 'scanning', regexResults,
    });

    // Build content for this regex
    let origBlock = '';
    let transBlock = '';
    for (const f of script.fields) {
      const fieldType = f.path.includes('replaceString') ? 'replaceString'
        : f.path.includes('findRegex') ? 'findRegex'
        : f.path.includes('trimStrings') ? 'trimStrings'
        : f.label;
      origBlock += `\n=== ${fieldType} ===\n${f.original}\n`;
      transBlock += `\n=== ${fieldType} ===\n${f.translated}\n`;
    }

    // Truncate if needed
    const origContent = origBlock.length > perRegexLimit ? smartTruncate(origBlock, perRegexLimit) : origBlock;
    const transContent = transBlock.length > perRegexLimit ? smartTruncate(transBlock, perRegexLimit) : transBlock;

    const systemPrompt = `You are a SillyTavern regex script translation auditor. You check ONE regex script's translation for errors.

REGEX-SPECIFIC RULES:
1. **replaceString** often contains HTML+CSS+JavaScript — these are the most critical fields
2. CSS class names, IDs (class="xxx", id="xxx") must NEVER be translated
3. JavaScript function names, variable names, API calls must NEVER be translated
4. HTML data-var attributes must NEVER be translated (or renamed per MVU dictionary)
5. {{macros}} like {{char}}, {{user}}, {{getvar::XXX}} must be preserved EXACTLY
6. Template literals \${...} content must NOT be translated
7. **findRegex** must remain a valid JavaScript regex literal (/pattern/flags)
8. Translation length should be similar to original (especially for code-heavy content)
9. Brackets {}, [], () must be balanced exactly as original
10. Only translate natural language text — leave ALL code/markup untouched
${mvuBlock}

RESPOND IN JSON (no markdown):
{
  "issues": [
    {
      "severity": "error|warning",
      "location": "${label}",
      "description": "What's wrong",
      "original_snippet": "snippet from original",
      "translated_snippet": "current translated snippet",
      "suggested_fix": "what it should be"
    }
  ],
  "summary": "One line"
}

If all OK: {"issues": [], "summary": "Regex translation verified OK."}`;

    const userPrompt = `Check this regex script translation: **${label}**

ORIGINAL:
${origContent}

TRANSLATED (${targetLang}):
${transContent}`;

    try {
      const result = await callLLM(config, systemPrompt, userPrompt, signal);
      const parsed = parseAIVerifyResponse(result);

      for (const issue of parsed.issues) {
        if (!issue.location || issue.location === 'unknown') issue.location = label;
      }

      allIssues.push(...parsed.issues);
      regexResults[si] = {
        name: label,
        status: parsed.issues.length > 0 ? 'issues' : 'ok',
        issueCount: parsed.issues.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (signal?.aborted) return;
      regexResults[si] = { name: label, status: 'error', issueCount: 0 };
      allIssues.push({
        id: crypto.randomUUID(), severity: 'info', location: label,
        description: `Scan failed: ${msg.slice(0, 150)}`,
        original: '', current: '', suggestion: '', autoFixable: false,
      });
    }

    scanDone++;
    onProgress({
      currentRegex: label, regexIndex: scanDone, totalRegex: scripts.length,
      issuesSoFar: allIssues, status: scanDone >= scripts.length ? 'done' : 'scanning',
      regexResults,
    });
    },
  });

  if (signal?.aborted) {
    onProgress({
      currentRegex: '', regexIndex: scanDone, totalRegex: scripts.length,
      issuesSoFar: allIssues, status: 'cancelled', regexResults,
    });
  }

  return { issues: allIssues, regexResults };
}

/**
 * Fix regex issues found by aiRegexScan.
 * Fixes each regex field one at a time with strict validation.
 */
export async function aiRegexFixAll(
  issues: VerifyIssue[],
  fields: TranslationField[],
  config: ProxySettings,
  targetLang: string,
  mvuDictionary: Record<string, string>,
  sourceLang: string,
  onProgress: (progress: { fixing: string; done: number; total: number; results: RegexFixResult[] }) => void,
  signal?: AbortSignal,
): Promise<RegexFixResult[]> {
  const results: RegexFixResult[] = [];

  // Group issues by regex index for context
  const regexFieldPaths = new Set<string>();
  for (const issue of issues) {
    // Find the field path from issue location
    const locMatch = issue.location.match(/regex\[(\d+)\]/);
    if (!locMatch) continue;
    const idx = parseInt(locMatch[1]);
    // Find all fields for this regex
    for (const f of fields) {
      if (f.group === 'regex' && f.path.includes(`regex_scripts[${idx}]`) && f.translated) {
        regexFieldPaths.add(f.path);
      }
    }
  }

  const fieldPaths = [...regexFieldPaths];
  const modelLimit = getModelContentLimit(config.model);
  const contentLimit = Math.floor(modelLimit / 3);

  const mvuTerms = Object.entries(mvuDictionary).map(([k, v]) => `"${k}" → "${v}"`).slice(0, 50);
  const mvuBlock = mvuTerms.length > 0 ? `\nMVU DICTIONARY:\n${mvuTerms.join('\n')}` : '';

  // (bugNeedFix/177) SỬA TỪNG FIELD REGEX SONG SONG. Mỗi field được sửa độc lập (kết quả ghi vào
  // `results`, không field nào đọc bản sửa của field khác), nên song song không đổi kết quả.
  let fixDone = 0;
  await runWorkerPool({
    total: fieldPaths.length,
    concurrency: verifyConcurrency(config),
    shouldStop: () => !!signal?.aborted,
    runOne: async (fi: number) => {
    const fieldPath = fieldPaths[fi];
    const field = fields.find(f => f.path === fieldPath);
    if (!field?.translated) { fixDone++; return; }

    const idxMatch = fieldPath.match(/regex_scripts\[(\d+)\]/);
    const regexIdx = idxMatch ? parseInt(idxMatch[1]) : -1;
    const fieldType = fieldPath.includes('replaceString') ? 'replaceString' as const
      : fieldPath.includes('findRegex') ? 'findRegex' as const
      : 'trimStrings' as const;
    const nameField = fields.find(nf => nf.path === `data.extensions.regex_scripts[${regexIdx}].scriptName`);
    const scriptName = nameField?.translated || nameField?.original || `regex[${regexIdx}]`;

    onProgress({ fixing: `${scriptName} → ${fieldType}`, done: fixDone, total: fieldPaths.length, results });
    // Chạy song song nên MỌI nhánh thoát đều phải báo tiến độ — đặt trong finally. Và mọi
    // `continue` cũ đổi thành `return`: đây giờ là callback của worker, không còn vòng lặp.
    try {

    // Collect relevant issues for this field
    const fieldIssues = issues.filter(i => {
      const loc = i.location || '';
      return loc.includes(`regex[${regexIdx}]`);
    });
    if (fieldIssues.length === 0) return;

    const issueDesc = fieldIssues.map((i, idx) =>
      `${idx + 1}. [${i.severity}] ${i.description}${i.original ? ` | original: "${i.original}"` : ''}${i.suggestion ? ` | fix: ${i.suggestion}` : ''}`
    ).join('\n');

    // (bug 213) Cửa sổ liền mạch + ghép lại đúng chỗ, thay cho đầu+đuôi kèm marker: bản AI viết
    // dựa trên văn bản đã cắt không được phép thay CẢ field.
    const rgAnchors: number[] = [];
    for (const i of fieldIssues) {
      if (i.original && i.original.length > 3) {
        const p = field.original.indexOf(i.original);
        if (p !== -1) rgAnchors.push(p);
      }
    }
    const rgRatio = field.original.length > 0 ? field.translated.length / field.original.length : 1;
    const rgOrigWin = pickFixWindow(field.original, rgAnchors, contentLimit);
    const rgTransWin = pickFixWindow(field.translated, rgAnchors.map(p => Math.round(p * rgRatio)), contentLimit);
    const rgWindowed = rgTransWin.start > 0 || rgTransWin.end < field.translated.length;
    const origContent = field.original.slice(rgOrigWin.start, rgOrigWin.end);
    const transContent = field.translated.slice(rgTransWin.start, rgTransWin.end);

    const systemPrompt = `You fix translation errors in a SillyTavern regex script field.
Return ONLY the corrected translated text. No explanations, no markdown code fences.${rgWindowed ? `

⚠️ EXCERPT MODE: the texts below are a CONTIGUOUS EXCERPT of a larger field. Return ONLY the corrected version of THIS EXCERPT — same start, same end. Never write "...", never mention omitted text.` : ''}

CRITICAL REGEX FIX RULES:
- Fix ONLY the issues listed. Do NOT modify anything else.
- NEVER translate: CSS class names, IDs, JS function names, variable names, API calls
- NEVER translate: HTML attributes (data-var, class, id, style values)
- NEVER translate: template literal expressions \${...}
- PRESERVE ALL {{macros}} exactly ({{char}}, {{user}}, {{getvar::xxx}}, etc.)
- PRESERVE exact bracket counts: {}, [], ()
- PRESERVE all HTML tag structure: every <tag> must have </tag>
- If field is findRegex: output MUST be a valid /regex/flags literal
- Output length MUST be similar to input length (±20%)
- Do NOT add markdown code fences (\`\`\`) to the output
${mvuBlock}`;

    const userPrompt = `Fix the listed issues in this ${fieldType} field of "${scriptName}".

ORIGINAL ${fieldType}:
${origContent}

CURRENT TRANSLATION (${targetLang}):
${transContent}

ISSUES TO FIX:
${issueDesc}

Return the corrected ${fieldType} (fix listed issues, change NOTHING else):`;

    try {
      let fixed = await callLLM(config, systemPrompt, userPrompt, signal);

      // Strip markdown fences
      const mdMatch = fixed.match(/```(?:html|javascript|json|regex)?\s*\n([\s\S]*?)\n```/);
      if (mdMatch) fixed = mdMatch[1].trim();
      else fixed = fixed.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();

      const rgExpectedLen = rgWindowed ? rgTransWin.end - rgTransWin.start : field.translated.length;
      if (!fixed || fixed.length < Math.max(10, rgExpectedLen * 0.3)) {
        results.push({
          regexIndex: regexIdx, scriptName, fieldPath, fieldType,
          success: false, before: field.translated, after: '',
          reason: `Empty or too short (${fixed?.length || 0} chars)`,
        });
        return;
      }

      // (bug 213) Ghép đoạn đã sửa về đúng vị trí — mọi lớp kiểm bên dưới soi bản ĐẦY ĐỦ.
      if (rgWindowed) {
        fixed = field.translated.slice(0, rgTransWin.start) + fixed + field.translated.slice(rgTransWin.end);
      }
      if (/\[\s*\.{3}\s*\d+\s*chars?(?:\s+truncated)?\s*\.{3}\s*\]/i.test(fixed)) {
        results.push({
          regexIndex: regexIdx, scriptName, fieldPath, fieldType,
          success: false, before: field.translated, after: fixed,
          reason: 'Bản sửa chứa marker cắt cụt "[... N chars ...]" — AI chép lại phần không nhìn thấy',
        });
        return;
      }

      // ─── Strict validation for regex fields ───
      const orig = field.original;
      const current = field.translated;

      // 1. Length check (±50% for regex, they can vary)
      const lengthRatio = fixed.length / current.length;
      if (lengthRatio < 0.4 || lengthRatio > 2.5) {
        results.push({
          regexIndex: regexIdx, scriptName, fieldPath, fieldType,
          success: false, before: current, after: fixed,
          reason: `Length ratio ${(lengthRatio * 100).toFixed(0)}% — too different`,
        });
        return;
      }

      // 2. Bracket balance must match original
      const origBr = countBrackets(orig);
      const fixBr = countBrackets(fixed);
      let bracketBroken = false;
      for (const [pair, [oOpen, oClose]] of Object.entries(origBr)) {
        const [fOpen, fClose] = fixBr[pair];
        if (Math.abs((oOpen - oClose) - (fOpen - fClose)) > 1) {
          bracketBroken = true;
          break;
        }
      }
      if (bracketBroken) {
        results.push({
          regexIndex: regexIdx, scriptName, fieldPath, fieldType,
          success: false, before: current, after: fixed,
          reason: 'Fix broke bracket balance',
        });
        return;
      }

      // 3. findRegex must remain a valid regex literal
      if (fieldType === 'findRegex' && /^\/[\s\S]+\/[a-z]*$/i.test(orig)) {
        if (!/^\/[\s\S]+\/[a-z]*$/i.test(fixed)) {
          results.push({
            regexIndex: regexIdx, scriptName, fieldPath, fieldType,
            success: false, before: current, after: fixed,
            reason: 'Fix broke regex literal format (/pattern/flags)',
          });
          return;
        }
      }

      // 4. Macro preservation
      const origMacros = extractMacros(orig);
      const fixMacros = extractMacros(fixed);
      const stdMacro = /^\{\{(char|user|random|roll|time|date|idle_duration|input|lastMessage|newline|trim|noop)\}\}$/i;
      let macroLost = false;
      for (const m of origMacros) {
        if (stdMacro.test(m) && !fixMacros.includes(m)) {
          macroLost = true;
          break;
        }
      }
      if (macroLost) {
        results.push({
          regexIndex: regexIdx, scriptName, fieldPath, fieldType,
          success: false, before: current, after: fixed,
          reason: 'Fix lost standard macros',
        });
        return;
      }

      // 5. Verify fix actually reduces issues
      const mockBefore = { ...field, translated: current };
      const mockAfter = { ...field, translated: fixed };
      const issuesBefore = verifyFields([mockBefore], mvuDictionary, sourceLang);
      const issuesAfter = verifyFields([mockAfter], mvuDictionary, sourceLang);
      const scoreBefore = issuesBefore.reduce((s, i) => s + (i.severity === 'error' ? 3 : 1), 0);
      const scoreAfter = issuesAfter.reduce((s, i) => s + (i.severity === 'error' ? 3 : 1), 0);

      if (scoreAfter > scoreBefore + 2) {
        results.push({
          regexIndex: regexIdx, scriptName, fieldPath, fieldType,
          success: false, before: current, after: fixed,
          reason: `Fix worsened issues: ${scoreBefore} → ${scoreAfter}`,
        });
        return;
      }

      // ✅ All validation passed
      results.push({
        regexIndex: regexIdx, scriptName, fieldPath, fieldType,
        success: true, before: current, after: fixed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Huỷ giữa chừng thì không ghi "sửa thất bại" — đó là user bấm dừng, không phải regex hỏng.
      if (signal?.aborted) return;
      results.push({
        regexIndex: regexIdx, scriptName, fieldPath, fieldType,
        success: false, before: field.translated, after: '',
        reason: msg.slice(0, 150),
      });
    }

    } finally {
      fixDone++;
      onProgress({ fixing: `${scriptName} → ${fieldType}`, done: fixDone, total: fieldPaths.length, results });
    }
    },
  });

  return results;
}

export async function aiVerifyCard(
  originalCard: CharacterCard,
  translatedCard: CharacterCard,
  config: ProxySettings,
  targetLang: string,
  mvuDictionary: Record<string, string>,
  signal?: AbortSignal
): Promise<VerifyResult> {
  // Step 1: Quick local verification
  const localIssues = quickVerify(originalCard, translatedCard);

  // Step 2: Extract key sections for AI analysis
  const origData = originalCard.data;
  const transData = translatedCard.data;
  if (!origData || !transData) {
    return {
      totalIssues: localIssues.length,
      errors: localIssues.filter(i => i.severity === 'error').length,
      warnings: localIssues.filter(i => i.severity === 'warning').length,
      info: 0,
      issues: localIssues,
      summary: 'No card data to verify',
    };
  }

  // Build context for AI
  const sections: string[] = [];

  // MVU Dictionary context
  if (Object.keys(mvuDictionary).length > 0) {
    sections.push(`## MVU Variable Dictionary (Strategy B mappings):\n${Object.entries(mvuDictionary).map(([k, v]) => `  "${k}" → "${v}"`).join('\n')}`);
  }

  // Compare lorebook entries (focus on code-heavy ones)
  if (origData.character_book?.entries && transData.character_book?.entries) {
    const origEntries = origData.character_book.entries;
    const transEntries = transData.character_book.entries;
    const limit = Math.min(origEntries.length, transEntries.length);

    for (let i = 0; i < limit; i++) {
      const orig = origEntries[i];
      const trans = transEntries[i];
      // Only include entries with code-like content (variables, JSON, code blocks)
      if (orig.content && /\{\{(get|set|add)(var|globalvar)::/.test(orig.content)) {
        sections.push(`## Lorebook[${i}] "${orig.name || orig.comment || ''}":\n### ORIGINAL:\n${orig.content.slice(0, 2000)}\n### TRANSLATED:\n${trans.content.slice(0, 2000)}`);
      }
    }
  }

  // Compare TavernHelper scripts (Zod, MVU) — support tuple format
  const extractTHScripts = (ext: any): any[] => {
    const raw = ext?.tavern_helper;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) return item[1];
      }
      return raw.filter((s: any) => s && typeof s === 'object' && !Array.isArray(s));
    }
    return raw?.scripts || [];
  };
  const origTH = extractTHScripts(origData.extensions);
  const transTH = extractTHScripts(transData.extensions);
  for (let i = 0; i < Math.min(origTH.length, transTH.length); i++) {
    sections.push(`## TavernHelper Script[${i}] "${origTH[i].name || ''}":\n### ORIGINAL:\n${origTH[i].content.slice(0, 3000)}\n### TRANSLATED:\n${transTH[i].content.slice(0, 3000)}`);
  }

  // Compare regex scripts
  if (origData.extensions?.regex_scripts && transData.extensions?.regex_scripts) {
    const origRegex = origData.extensions.regex_scripts;
    const transRegex = transData.extensions.regex_scripts;
    for (let i = 0; i < Math.min(origRegex.length, transRegex.length); i++) {
      if (origRegex[i].replaceString && /data-var|getvar|setvar|class=|id=/.test(origRegex[i].replaceString)) {
        let debugText = `## Regex[${i}] "${origRegex[i].scriptName}":\n### ORIGINAL replaceString:\n${origRegex[i].replaceString.slice(0, 2000)}\n### TRANSLATED replaceString:\n${transRegex[i].replaceString.slice(0, 2000)}`;
        if (origRegex[i].findRegex) {
           debugText += `\n### ORIGINAL findRegex:\n${origRegex[i].findRegex.slice(0, 2000)}\n### TRANSLATED findRegex:\n${transRegex[i].findRegex?.slice(0, 2000)}`;
        }
        sections.push(debugText);
      } else if (origRegex[i].findRegex && /data-var|getvar|setvar|class=|id=/.test(origRegex[i].findRegex)) {
        sections.push(`## Regex[${i}] "${origRegex[i].scriptName}":\n### ORIGINAL findRegex:\n${origRegex[i].findRegex.slice(0, 2000)}\n### TRANSLATED findRegex:\n${transRegex[i].findRegex?.slice(0, 2000)}`);
      }
    }
  }

  // If no sections to verify, return local issues only
  if (sections.length === 0) {
    return {
      totalIssues: localIssues.length,
      errors: localIssues.filter(i => i.severity === 'error').length,
      warnings: localIssues.filter(i => i.severity === 'warning').length,
      info: 0,
      issues: localIssues,
      summary: localIssues.length === 0
        ? 'No MVU/Zod content found to verify. Card looks clean.'
        : `Found ${localIssues.length} issue(s) from local verification.`,
    };
  }

  // Step 3: Call AI for deep analysis
  const systemPrompt = `You are a SillyTavern character card integrity auditor. Your job is to compare ORIGINAL and TRANSLATED sections of a card and find issues where the translation broke functional elements.

CRITICAL ELEMENTS TO CHECK:
1. **SillyTavern Macros**: {{char}}, {{user}}, {{getvar::XXX}}, {{setvar::XXX::VALUE}} must be preserved EXACTLY. The variable names inside may be renamed per the MVU Dictionary, but the macro syntax MUST be intact.
2. **Zod Schema Fields**: Field names in z.object({...}) definitions, .prefault() values, and schema structure must match exactly with the MVU Dictionary mappings.
3. **EJS Templates**: <% %>, <%= %> blocks must be structurally preserved.
4. **HTML data-var Attributes**: data-var="XXX" must reference valid variable names (original or dictionary-mapped).
5. **JavaScript Logic**: Function names, API calls, import statements, event handlers must NOT be translated.
6. **CSS Classes/IDs**: class="XXX" and id="XXX" must be consistent between regex HTML and the JS that references them.
7. **JSON Structure**: Any JSON embedded in lorebook content must remain valid JSON after translation.
8. **Variable Consistency**: If a variable is renamed via MVU Dictionary (e.g. "好感度" → "Hao_Cam"), ALL references across ALL sections must use the same new name.

RESPOND IN THIS EXACT JSON FORMAT (no markdown wrapping):
{
  "issues": [
    {
      "severity": "error|warning|info",
      "location": "lorebook[0].content",
      "description": "Description of the issue",
      "original_snippet": "original code/text snippet",
      "translated_snippet": "current translated snippet",
      "suggested_fix": "what the translated snippet should be"
    }
  ],
  "summary": "One paragraph summary of findings"
}

If everything is correct, return: {"issues": [], "summary": "All functional elements verified. No issues found."}`;

  const userPrompt = `Verify this translated ${targetLang} SillyTavern card. Check ALL functional elements (variables, macros, Zod fields, EJS, HTML attributes, JS code) are correctly preserved or properly renamed per the MVU Dictionary.

${sections.join('\n\n---\n\n')}`;

  try {
    // callProvider is statically imported at the top of this file (no circular
    // dependency: apiClient.ts does not import aiVerify.ts, directly or indirectly).
    const rotatedConfig = { ...config, temperature: 0.2 };
    const responseText = await callProvider(rotatedConfig, systemPrompt, userPrompt, signal);

    // Parse AI response
    const aiIssues = parseAIVerifyResponse(responseText);

    // Merge local + AI issues
    const allIssues = [...localIssues, ...aiIssues.issues];

    return {
      totalIssues: allIssues.length,
      errors: allIssues.filter(i => i.severity === 'error').length,
      warnings: allIssues.filter(i => i.severity === 'warning').length,
      info: allIssues.filter(i => i.severity === 'info').length,
      issues: allIssues,
      summary: aiIssues.summary || (allIssues.length === 0
        ? '✅ All functional elements verified. No issues found.'
        : `Found ${allIssues.length} issue(s). Review and fix before exporting.`),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Return local issues even if AI fails
    return {
      totalIssues: localIssues.length,
      errors: localIssues.filter(i => i.severity === 'error').length,
      warnings: localIssues.filter(i => i.severity === 'warning').length,
      info: 0,
      issues: localIssues,
      summary: `AI verification failed (${msg}). Showing ${localIssues.length} local issues only.`,
    };
  }
}

/* ═══ Parse AI verification response ═══ */

function parseAIVerifyResponse(text: string): { issues: VerifyIssue[]; summary: string } {
  try {
    // Try to extract JSON from response (may be wrapped in markdown)
    let jsonStr = text.trim();
    // Strip markdown code fence
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(jsonStr);
    const issues: VerifyIssue[] = (parsed.issues || []).map((ai: any) => ({
      id: crypto.randomUUID(),
      severity: ai.severity || 'warning',
      location: ai.location || 'unknown',
      description: ai.description || '',
      original: ai.original_snippet || '',
      current: ai.translated_snippet || '',
      suggestion: ai.suggested_fix || '',
      autoFixable: false,
    }));

    return { issues, summary: parsed.summary || '' };
  } catch {
    // If JSON parse fails, try to extract issues from free text
    return {
      issues: text.trim() ? [{
        id: crypto.randomUUID(),
        severity: 'info' as const,
        location: 'AI Response',
        description: text.slice(0, 500),
        original: '',
        current: '',
        suggestion: '',
        autoFixable: false,
      }] : [],
      summary: 'Could not parse AI response as structured JSON.',
    };
  }
}

/* ═══════════════════════════════════════════════════════════════
   REGEX — Pipeline GỘP Quét+Sửa: 4 giai đoạn, chunk deterministic, output XML
   GĐ1 Plan(thinking) → GĐ2 So sánh chunk (song song) → GĐ3 Sửa field lỗi → GĐ4 Kiểm coverage
   ═══════════════════════════════════════════════════════════════ */

export interface RegexProcessProgress {
  phase: 'plan' | 'compare' | 'fix' | 'coverage' | 'done' | 'cancelled';
  phaseLabel: string;
  done: number;
  total: number;
  issues: VerifyIssue[];
  fixes: RegexFixResult[];
}

interface RegexChunk {
  scriptIdx: number; scriptName: string; fieldPath: string;
  fieldType: string; part: number; totalParts: number; origChunk: string; transChunk: string;
}

const _rgTag = (text: string, name: string): string => {
  const closed = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(text);
  if (closed) return closed[1].replace(/^\n+|\n+$/g, '');
  const open = new RegExp(`<${name}>([\\s\\S]*)`, 'i').exec(text);
  return open ? open[1].replace(/^\n+/g, '').trim() : '';
};
const _rgAll = (text: string, name: string): string[] => {
  const out: string[] = []; const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi');
  let m: RegExpExecArray | null; while ((m = re.exec(text)) !== null) out.push(m[1].trim()); return out;
};
async function _rgPool<T>(items: T[], limit: number, fn: (it: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i]); }
  }));
}
/** Chia text thành ĐÚNG p phần theo ranh giới DÒNG (p phải ≤ số dòng để không có phần rỗng).
 *  Bảo đảm join('\n') == gốc (phủ hết, không sót/trùng). */
function _splitByLines(text: string, p: number): string[] {
  const lines = text.split('\n');
  const L = lines.length;
  if (p <= 1 || L <= 1) return [text];
  const parts: string[] = [];
  for (let k = 0; k < p; k++) {
    const start = Math.floor((k * L) / p);
    const end = Math.floor(((k + 1) * L) / p);
    parts.push(lines.slice(start, end).join('\n'));
  }
  return parts;
}
function _regexFieldType(path: string): string {
  return path.includes('replaceString') ? 'replaceString' : path.includes('findRegex') ? 'findRegex' : path.includes('trimStrings') ? 'trimStrings' : 'other';
}
function _regexIdxOf(path: string): number { const m = path.match(/regex_scripts\[(\d+)\]/); return m ? parseInt(m[1]) : -1; }

/** Chia field regex thành chunk deterministic (theo dòng, phủ HẾT — không sót/trùng). */
function chunkRegexFields(fields: TranslationField[]): { chunks: RegexChunk[]; regexFields: TranslationField[] } {
  const CHUNK = 6000;
  const regexFields = fields.filter(f => f.group === 'regex' && f.translated);
  const chunks: RegexChunk[] = [];
  for (const f of regexFields) {
    const scriptIdx = _regexIdxOf(f.path);
    const nameField = fields.find(nf => nf.path === `data.extensions.regex_scripts[${scriptIdx}].scriptName`);
    const scriptName = nameField?.translated || nameField?.original || `regex[${scriptIdx}]`;
    const fieldType = _regexFieldType(f.path);
    const pDesired = Math.max(1, Math.ceil(Math.max(f.original.length, f.translated.length) / CHUNK));
    // p ≤ số dòng của CẢ hai bản → orig & trans chia đúng p phần (căn nhau, không phần rỗng, phủ hết).
    const p = Math.max(1, Math.min(pDesired, f.original.split('\n').length, f.translated.split('\n').length));
    const oParts = _splitByLines(f.original, p);
    const tParts = _splitByLines(f.translated, p);
    const P = Math.min(oParts.length, tParts.length);
    for (let k = 0; k < P; k++) {
      chunks.push({ scriptIdx, scriptName, fieldPath: f.path, fieldType, part: k, totalParts: P, origChunk: oParts[k], transChunk: tParts[k] });
    }
  }
  return { chunks, regexFields };
}

function _regexSpecialSignals(regexFields: TranslationField[]): string {
  const sigs = new Set<string>();
  for (const f of regexFields) {
    const t = `${f.translated}\n${f.original}`;
    if (/\bnew Map\(|\.set\(|=>\s*\{|\[\s*\{/.test(t)) sigs.add('Map/object/arrow-fn');
    if (/[一-鿿]/.test(f.translated)) sigs.add('CÒN chữ Hán trong bản dịch');
    if (/<style|class=|id=|data-[a-z-]+=/.test(t)) sigs.add('HTML/CSS');
    if (/function |const |let |JSON\.|\.push\(/.test(t)) sigs.add('JavaScript');
    if (/\{\{[^}]+\}\}|getvar|setvar/.test(t)) sigs.add('macro/getvar');
  }
  return [...sigs].join('; ') || 'không phát hiện ca đặc biệt';
}

/**
 * (bug 213) Độ lệch ngoặc phải so với BẢN GỐC, không phải với 0.
 *
 * Chính file này đã học được bài đó ở chốt code_splice (xem comment "Sửa bug #2" phía trên):
 * replaceString / fragment template hợp lệ VỐN có thể lệch ngoặc — dấu `}` nằm trong chuỗi hoặc
 * regex, `${...}` nội suy… Gốc lệch -1 thì bản dịch giữ -1 là ĐÚNG.
 *
 * Nhưng bước validate của nút "1 nút quét+sửa regex" lại đòi cân bằng TUYỆT ĐỐI. Hậu quả đúng
 * bằng họ bug 197/198: bản AI sửa đúng (giữ nguyên độ lệch của gốc) bị bác "Validate thất bại —
 * giữ bản cũ", vòng quét sau lại tìm ra y hệt các lỗi đó, user bấm bao nhiêu lần cũng không sạch.
 *
 * Dung sai ±1 cho khớp với chốt tương đương ở aiFixRegexFields.
 */
const _bracketDelta = (s: string, o: string, c: string) => s.split(o).length - s.split(c).length;
const _bracketMatchesOrig = (fixed: string, orig: string, o: string, c: string) =>
  Math.abs(_bracketDelta(fixed, o, c) - _bracketDelta(orig, o, c)) <= 1;

/**
 * Pipeline GỘP quét+sửa regex (1 nút). Trả issues + fixes; áp fix qua callback applyFix.
 */
export async function aiRegexProcess(
  fields: TranslationField[],
  config: ProxySettings,
  targetLang: string,
  mvuDictionary: Record<string, string>,
  _sourceLang: string,
  applyFix: (fieldPath: string, newTranslated: string) => void,
  onProgress: (p: RegexProcessProgress) => void,
  signal?: AbortSignal,
): Promise<{ issues: VerifyIssue[]; fixes: RegexFixResult[]; planNotes: string }> {
  const { chunks, regexFields } = chunkRegexFields(fields);
  const issues: VerifyIssue[] = [];
  const fixes: RegexFixResult[] = [];
  let planNotes = '';
  const mvuBlock = Object.keys(mvuDictionary).length
    ? `\nMVU Dictionary:\n${Object.entries(mvuDictionary).slice(0, 50).map(([k, v]) => `  "${k}" → "${v}"`).join('\n')}` : '';

  if (regexFields.length === 0) {
    onProgress({ phase: 'done', phaseLabel: 'Không có regex đã dịch để xử lý.', done: 0, total: 0, issues, fixes });
    return { issues, fixes, planNotes };
  }

  // ── GĐ1: Plan + thinking ──
  onProgress({ phase: 'plan', phaseLabel: 'Giai đoạn 1: Quét + lập plan (thinking)…', done: 0, total: 1, issues, fixes });
  try {
    const sys = `Bạn là chuyên gia kiểm định bản dịch REGEX script SillyTavern (HTML/CSS/JS + macro). TƯ DUY trước rồi lập plan.
Xuất ĐÚNG XML (không markdown):
<thinking>Với các ca ĐẶC BIỆT (Map/object literal, CÒN chữ Hán trong bản dịch, code JS, macro {{...}}) thì kiểm & sửa thế nào để KHÔNG phá code/logic.</thinking>
<plan>Các LƯU Ý ngắn gọn (gạch đầu dòng) để áp khi so sánh gốc↔dịch từng chunk.</plan>`;
    const user = `Regex field đã dịch: ${regexFields.length} (chia ${chunks.length} chunk). Ngôn ngữ đích: ${targetLang}.
Tín hiệu ca đặc biệt: ${_regexSpecialSignals(regexFields)}.${mvuBlock}`;
    const resp = await callLLM(config, sys, user, signal);
    planNotes = (_rgTag(resp, 'plan') || _rgTag(resp, 'thinking') || '').slice(0, 2000);
  } catch (e) {
    if (signal?.aborted) { onProgress({ phase: 'cancelled', phaseLabel: 'Đã hủy.', done: 0, total: 0, issues, fixes }); return { issues, fixes, planNotes }; }
  }

  // ── GĐ2: So sánh chunk (song song) ──
  let cmpDone = 0;
  onProgress({ phase: 'compare', phaseLabel: `Giai đoạn 2: So sánh ${chunks.length} chunk…`, done: 0, total: chunks.length, issues, fixes });
  await _rgPool(chunks, 6, async (ch) => {
    if (signal?.aborted) return;
    const label = `regex[${ch.scriptIdx}] ${ch.scriptName}${ch.totalParts > 1 ? ` (phần ${ch.part + 1}/${ch.totalParts})` : ''}`;
    const sys = `Bạn kiểm bản dịch 1 ĐOẠN regex script. So GỐC ↔ DỊCH, chỉ liệt kê LỖI thật (không bịa).
LƯU Ý (plan): ${planNotes || '(không có)'}
Quy tắc: KHÔNG dịch class/id/tên hàm/biến JS, attribute HTML, \${...}, macro {{...}}; ngoặc {}[]() phải cân; findRegex phải là /…/flags; text tự nhiên KHÔNG còn chữ Hán.${mvuBlock}
Xuất ĐÚNG XML:
<issues><issue><sev>error|warning</sev><desc>lỗi gì</desc><snippet>đoạn dịch bị lỗi</snippet><fix>nên sửa thành gì</fix></issue></issues>
Nếu không lỗi: <issues></issues>`;
    const user = `Field: ${ch.fieldType} — ${label}\n\nGỐC:\n${ch.origChunk}\n\nDỊCH (${targetLang}):\n${ch.transChunk}`;
    try {
      const resp = await callLLM(config, sys, user, signal);
      for (const raw of _rgAll(_rgTag(resp, 'issues') || resp, 'issue')) {
        const sev = (_rgTag(raw, 'sev') || 'warning').toLowerCase().includes('err') ? 'error' : 'warning';
        issues.push({
          id: crypto.randomUUID(), severity: sev, location: label,
          description: _rgTag(raw, 'desc'), original: _rgTag(raw, 'snippet'), current: _rgTag(raw, 'snippet'),
          suggestion: _rgTag(raw, 'fix'), autoFixable: true, fixPath: ch.fieldPath,
        });
      }
    } catch (e) {
      if (!signal?.aborted) issues.push({ id: crypto.randomUUID(), severity: 'info', location: label, description: `So sánh lỗi: ${(e as Error)?.message?.slice(0, 120)}`, original: '', current: '', suggestion: '', autoFixable: false });
    }
    cmpDone++;
    onProgress({ phase: 'compare', phaseLabel: `Giai đoạn 2: So sánh ${cmpDone}/${chunks.length} chunk…`, done: cmpDone, total: chunks.length, issues: [...issues], fixes });
  });
  if (signal?.aborted) { onProgress({ phase: 'cancelled', phaseLabel: 'Đã hủy.', done: cmpDone, total: chunks.length, issues, fixes }); return { issues, fixes, planNotes }; }

  // ── GĐ3: Sửa field lỗi (song song, chỉ phần lỗi) ──
  const issuesByField = new Map<string, VerifyIssue[]>();
  for (const iss of issues) {
    if (!iss.fixPath || iss.severity === 'info') continue;
    if (!issuesByField.has(iss.fixPath)) issuesByField.set(iss.fixPath, []);
    issuesByField.get(iss.fixPath)!.push(iss);
  }
  const fixTargets = [...issuesByField.keys()];
  let fixDone = 0;
  onProgress({ phase: 'fix', phaseLabel: `Giai đoạn 3: Sửa ${fixTargets.length} field lỗi…`, done: 0, total: fixTargets.length, issues, fixes });
  await _rgPool(fixTargets, 4, async (fp) => {
    if (signal?.aborted) return;
    const field = fields.find(f => f.path === fp);
    if (!field?.translated) { fixDone++; return; }
    const fieldType = _regexFieldType(fp);
    const fIssues = issuesByField.get(fp)!;
    const issueDesc = fIssues.map((i, k) => `${k + 1}. [${i.severity}] ${i.description}${i.suggestion ? ` → ${i.suggestion}` : ''}`).join('\n');
    const sys = `Bạn SỬA lỗi bản dịch 1 field regex. CHỈ sửa các lỗi liệt kê, KHÔNG đổi gì khác.
KHÔNG dịch class/id/tên hàm/biến/attribute/\${...}/macro; giữ ngoặc cân; findRegex = /…/flags; xóa dấu thừa/format sai; bỏ chữ Hán sót trong text tự nhiên.${mvuBlock}
Xuất ĐÚNG XML, đặt TOÀN BỘ field đã sửa trong tag (không markdown, không escape):
<fixed>...toàn bộ field đã sửa...</fixed>`;
    const user = `Field ${fieldType} của "${field.label}".\n\nGỐC:\n${field.original}\n\nDỊCH HIỆN TẠI (${targetLang}):\n${field.translated}\n\nLỖI CẦN SỬA:\n${issueDesc}`;
    try {
      const resp = await callLLM(config, sys, user, signal);
      const fixed = _rgTag(resp, 'fixed');
      const cur = field.translated;
      const rIdx = _regexIdxOf(fp);
      if (!fixed) { fixDone++; return; }
      const ratio = fixed.length / Math.max(1, cur.length);
      const validRegex = fieldType !== 'findRegex' || /^\/[\s\S]*\/[a-z]*$/.test(fixed.trim());
      const ok = ratio >= 0.4 && ratio <= 2.5
        && _bracketMatchesOrig(fixed, field.original, '{', '}')
        && _bracketMatchesOrig(fixed, field.original, '[', ']')
        && _bracketMatchesOrig(fixed, field.original, '(', ')')
        && validRegex;
      if (ok && fixed !== cur) {
        applyFix(fp, fixed);
        fixes.push({ regexIndex: rIdx, scriptName: field.label, fieldPath: fp, fieldType: fieldType as RegexFixResult['fieldType'], success: true, before: cur, after: fixed, reason: `Đã sửa ${fIssues.length} lỗi` });
      } else {
        fixes.push({ regexIndex: rIdx, scriptName: field.label, fieldPath: fp, fieldType: fieldType as RegexFixResult['fieldType'], success: false, before: cur, after: fixed, reason: !ok ? 'Validate thất bại (ngoặc/độ dài/regex) — giữ bản cũ' : 'Không thay đổi' });
      }
    } catch { /* bỏ qua field lỗi call */ }
    fixDone++;
    onProgress({ phase: 'fix', phaseLabel: `Giai đoạn 3: Sửa ${fixDone}/${fixTargets.length} field…`, done: fixDone, total: fixTargets.length, issues, fixes: [...fixes] });
  });
  if (signal?.aborted) { onProgress({ phase: 'cancelled', phaseLabel: 'Đã hủy.', done: fixDone, total: fixTargets.length, issues, fixes }); return { issues, fixes, planNotes }; }

  // ── GĐ4: Kiểm mốc chunk / coverage ──
  // (bug 213) Trước đây `covered` dựng từ chính `chunks`, mà chunkRegexFields LUÔN tạo ≥1 chunk cho
  // mọi regex field → `missed` luôn rỗng, giai đoạn này chỉ tạo cảm giác an toàn giả. Giờ kiểm đúng
  // cái đáng lo: ghép các chunk lại có dựng đúng NGUYÊN VĂN field không (sót/trùng/lệch ký tự).
  onProgress({ phase: 'coverage', phaseLabel: 'Giai đoạn 4: Kiểm mốc chunk (coverage)…', done: 0, total: 1, issues, fixes });
  const chunksByField = new Map<string, RegexChunk[]>();
  for (const c of chunks) {
    if (!chunksByField.has(c.fieldPath)) chunksByField.set(c.fieldPath, []);
    chunksByField.get(c.fieldPath)!.push(c);
  }
  for (const f of regexFields) {
    const cs = (chunksByField.get(f.path) || []).sort((a, b) => a.part - b.part);
    if (cs.length === 0) {
      issues.push({ id: crypto.randomUUID(), severity: 'warning', location: 'coverage', description: `Field regex "${f.label}" không được chia chunk nào — KHÔNG hề được quét, cần kiểm tay.`, original: '', current: '', suggestion: '', autoFixable: false });
      continue;
    }
    const origRebuilt = cs.map(c => c.origChunk).join('\n');
    const transRebuilt = cs.map(c => c.transChunk).join('\n');
    if (origRebuilt !== f.original || transRebuilt !== (f.translated || '')) {
      issues.push({
        id: crypto.randomUUID(), severity: 'warning', location: 'coverage',
        description: `Chia chunk làm lệch nội dung "${f.label}" (ghép ${cs.length} phần lại không khớp nguyên văn: gốc ${origRebuilt.length}/${f.original.length} ký tự, dịch ${transRebuilt.length}/${(f.translated || '').length}) — có đoạn chưa được quét.`,
        original: '', current: '', suggestion: 'Kiểm tay field này, hoặc dịch lại rồi quét lại.', autoFixable: false,
      });
    }
  }

  onProgress({ phase: 'done', phaseLabel: `Xong: ${issues.filter(i => i.severity === 'error').length} lỗi, ${fixes.filter(f => f.success).length} field đã sửa.`, done: 1, total: 1, issues, fixes });
  return { issues, fixes, planNotes };
}
