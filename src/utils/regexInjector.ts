// ═══════════════════════════════════════════════════════════════════════════════
// Regex Injection Engine — Smart code insertion into replaceString
// ═══════════════════════════════════════════════════════════════════════════════
//
// SillyTavern regex replaceString can contain:
//  1. Pure HTML (spans, divs, CSS)
//  2. <script>...</script> blocks with JS/jQuery
//  3. EJS template blocks (<% ... %> / <%= ... %>)
//  4. Regex capture groups ($1, $2, $&)
//  5. Inline event handlers (onclick, onload, etc.)
//  6. <style>...</style> blocks
//
// This engine safely injects code into the correct location without
// breaking existing syntax.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Zone {
  start: number;
  end: number;
  content: string;
  tag?: string;
}

export interface FunctionInfo {
  name: string;
  start: number;
  end: number;
  body: string;
}

export interface ReplaceStringStructure {
  /** HTML tag zones (non-script, non-style) */
  htmlZones: Zone[];
  /** <script>...</script> block zones */
  scriptZones: Zone[];
  /** <style>...</style> block zones */
  styleZones: Zone[];
  /** EJS template blocks <% ... %> */
  ejsBlocks: Zone[];
  /** Regex capture groups found ($1, $2, $&, etc.) */
  captureGroups: string[];
  /** Named functions found in script zones */
  functions: FunctionInfo[];
  /** jQuery document.ready blocks */
  jqueryReadyBlocks: Zone[];
  /** Whether the replaceString has any executable JS */
  hasScript: boolean;
  /** Whether the replaceString has CSS */
  hasStyle: boolean;
  /** Whether the replaceString uses EJS */
  hasEjs: boolean;
  /** Total character count */
  totalLength: number;
}

export type InjectionPosition =
  | 'auto'
  | 'before_script_end'
  | 'after_style'
  | 'before_closing_div'
  | 'end_of_script'
  | 'new_script_block'
  | 'append';

export interface InjectionResult {
  result: string;
  success: boolean;
  error?: string;
  /** Where the code was actually injected */
  injectedAt?: string;
}

export interface PatchResult {
  result: string;
  matchCount: number;
  success: boolean;
}

export interface SyntaxValidation {
  valid: boolean;
  errors: { line: number; message: string; context?: string }[];
}

// ─── Analyze ReplaceString ────────────────────────────────────────────────────

/**
 * Parse and analyze the structure of a replaceString to understand its
 * component zones (HTML, scripts, styles, EJS, etc.)
 */
export function analyzeReplaceString(replaceString: string): ReplaceStringStructure {
  const structure: ReplaceStringStructure = {
    htmlZones: [],
    scriptZones: [],
    styleZones: [],
    ejsBlocks: [],
    captureGroups: [],
    functions: [],
    jqueryReadyBlocks: [],
    hasScript: false,
    hasStyle: false,
    hasEjs: false,
    totalLength: replaceString.length,
  };

  // Extract <script>...</script> blocks
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(replaceString)) !== null) {
    structure.scriptZones.push({
      start: m.index,
      end: m.index + m[0].length,
      content: m[1],
    });
    structure.hasScript = true;

    // Find functions within this script block
    const funcRe = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let fm: RegExpExecArray | null;
    const scriptContent = m[1];
    while ((fm = funcRe.exec(scriptContent)) !== null) {
      // Find the matching closing brace (simple bracket counting)
      const funcStart = m.index + m[0].indexOf(scriptContent) + fm.index;
      const closeBrace = findMatchingBrace(replaceString, funcStart + fm[0].length - 1);
      if (closeBrace !== -1) {
        structure.functions.push({
          name: fm[1],
          start: funcStart,
          end: closeBrace + 1,
          body: replaceString.slice(funcStart, closeBrace + 1),
        });
      }
    }

    // Find jQuery ready blocks
    const jqRe = /\$\s*\(\s*(?:document|function)/g;
    let jm: RegExpExecArray | null;
    while ((jm = jqRe.exec(scriptContent)) !== null) {
      const readyStart = m.index + m[0].indexOf(scriptContent) + jm.index;
      structure.jqueryReadyBlocks.push({
        start: readyStart,
        end: readyStart + 50, // Approximate — just marking presence
        content: scriptContent.slice(jm.index, jm.index + 80),
      });
    }
  }

  // Extract <style>...</style> blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(replaceString)) !== null) {
    structure.styleZones.push({
      start: m.index,
      end: m.index + m[0].length,
      content: m[1],
    });
    structure.hasStyle = true;
  }

  // Extract EJS blocks <% ... %> and <%= ... %>
  const ejsRe = /<%[=-]?([\s\S]*?)%>/g;
  while ((m = ejsRe.exec(replaceString)) !== null) {
    structure.ejsBlocks.push({
      start: m.index,
      end: m.index + m[0].length,
      content: m[1],
    });
    structure.hasEjs = true;
  }

  // Extract capture groups
  const captureRe = /\$([0-9&])/g;
  while ((m = captureRe.exec(replaceString)) !== null) {
    const group = `$${m[1]}`;
    if (!structure.captureGroups.includes(group)) {
      structure.captureGroups.push(group);
    }
  }

  return structure;
}

// ─── Find Safe Injection Point ────────────────────────────────────────────────

/**
 * Determine the safest insertion point for new code within a replaceString.
 */
export function findSafeInjectionPoint(
  replaceString: string,
  structure: ReplaceStringStructure,
  position: InjectionPosition = 'auto',
): { index: number; wrapInScript: boolean; label: string } {
  if (position === 'auto') {
    // Strategy: prefer existing script zones
    if (structure.scriptZones.length > 0) {
      // Insert before </script> of the last script block
      const lastScript = structure.scriptZones[structure.scriptZones.length - 1];
      const closeTagIndex = replaceString.lastIndexOf('</script>');
      if (closeTagIndex !== -1) {
        return { index: closeTagIndex, wrapInScript: false, label: 'trước </script> cuối' };
      }
      return { index: lastScript.end, wrapInScript: true, label: 'sau script block cuối' };
    }

    // No script zones — need to create a new <script> block
    // Best place: before last closing div, or at the end
    const lastDivClose = replaceString.lastIndexOf('</div>');
    if (lastDivClose !== -1) {
      return { index: lastDivClose, wrapInScript: true, label: 'trước </div> cuối (trong script mới)' };
    }

    // Just append at end
    return { index: replaceString.length, wrapInScript: true, label: 'cuối replaceString (trong script mới)' };
  }

  switch (position) {
    case 'before_script_end': {
      const idx = replaceString.lastIndexOf('</script>');
      if (idx !== -1) return { index: idx, wrapInScript: false, label: 'trước </script>' };
      return { index: replaceString.length, wrapInScript: true, label: 'cuối (auto-wrap)' };
    }
    case 'end_of_script': {
      if (structure.scriptZones.length > 0) {
        const last = structure.scriptZones[structure.scriptZones.length - 1];
        return { index: last.end, wrapInScript: true, label: 'sau script block cuối' };
      }
      return { index: replaceString.length, wrapInScript: true, label: 'cuối (auto-wrap)' };
    }
    case 'after_style': {
      if (structure.styleZones.length > 0) {
        const last = structure.styleZones[structure.styleZones.length - 1];
        return { index: last.end, wrapInScript: true, label: 'sau style block cuối' };
      }
      return { index: replaceString.length, wrapInScript: true, label: 'cuối (auto-wrap)' };
    }
    case 'before_closing_div': {
      const idx = replaceString.lastIndexOf('</div>');
      if (idx !== -1) return { index: idx, wrapInScript: true, label: 'trước </div> cuối' };
      return { index: replaceString.length, wrapInScript: true, label: 'cuối (fallback)' };
    }
    case 'new_script_block':
      return { index: replaceString.length, wrapInScript: true, label: 'script block mới ở cuối' };
    case 'append':
    default:
      return { index: replaceString.length, wrapInScript: false, label: 'cuối replaceString' };
  }
}

// ─── Inject Function ──────────────────────────────────────────────────────────

/**
 * Inject a function/code snippet into a replaceString at the safest location.
 */
export function injectFunction(
  replaceString: string,
  functionCode: string,
  options: {
    position?: InjectionPosition;
    wrapInScript?: boolean;
    validateSyntax?: boolean;
  } = {},
): InjectionResult {
  const { position = 'auto', validateSyntax = true } = options;

  if (!functionCode || !functionCode.trim()) {
    return { result: replaceString, success: false, error: 'Không có code để inject' };
  }

  const structure = analyzeReplaceString(replaceString);
  const injection = findSafeInjectionPoint(replaceString, structure, position);

  // Prepare the code to inject
  let codeToInject = functionCode.trim();

  // Ensure code ends with semicolon/newline
  if (!codeToInject.endsWith(';') && !codeToInject.endsWith('}') && !codeToInject.endsWith('\n')) {
    codeToInject += ';';
  }

  // Wrap in <script> if needed
  if (injection.wrapInScript) {
    codeToInject = `\n<script>\n${codeToInject}\n</script>`;
  } else {
    // Add separator newline when injecting inside existing script
    codeToInject = `\n\n${codeToInject}\n`;
  }

  // Perform injection
  const before = replaceString.slice(0, injection.index);
  const after = replaceString.slice(injection.index);
  const result = before + codeToInject + after;

  // Validate syntax if requested
  if (validateSyntax) {
    const validation = validateReplaceStringSyntax(result);
    if (!validation.valid) {
      const errorSummary = validation.errors.map(e => e.message).join('; ');
      return {
        result: replaceString, // Return original, not the broken version
        success: false,
        error: `Syntax check thất bại sau inject: ${errorSummary}`,
      };
    }
  }

  return {
    result,
    success: true,
    injectedAt: injection.label,
  };
}

// ─── Patch ReplaceString ──────────────────────────────────────────────────────

/**
 * Find and replace text within a replaceString.
 */
export function patchReplaceString(
  replaceString: string,
  find: string,
  replace: string,
): PatchResult {
  if (!find) {
    return { result: replaceString, matchCount: 0, success: false };
  }

  // Count matches
  const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = replaceString.match(new RegExp(escapedFind, 'g'));
  const matchCount = matches ? matches.length : 0;

  if (matchCount === 0) {
    return { result: replaceString, matchCount: 0, success: false };
  }

  // Replace first occurrence (safest default)
  // (bug 213) PHẢI dùng callback. `replace` là ĐOẠN CODE cần chèn; nếu nó chứa `$&`, `$'`, "$`"
  // hay `$1` — chuyện rất thường gặp trong replaceString của regex script, vì đó chính là cú pháp
  // tham chiếu nhóm bắt — thì String.replace sẽ DIỄN GIẢI chúng thành pattern thay thế và chèn
  // vào nội dung khác hẳn thứ ta định chèn, âm thầm.
  const result = replaceString.replace(find, () => replace);

  return { result, matchCount, success: true };
}

// ─── Validate Syntax ──────────────────────────────────────────────────────────

/**
 * Validate JavaScript syntax within <script> blocks of a replaceString.
 * Uses try/catch with new Function() for basic syntax checking.
 */
export function validateReplaceStringSyntax(replaceString: string): SyntaxValidation {
  const errors: { line: number; message: string; context?: string }[] = [];

  // Extract all script content
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let scriptIndex = 0;

  while ((m = scriptRe.exec(replaceString)) !== null) {
    const scriptContent = m[1].trim();
    if (!scriptContent) continue;

    scriptIndex++;

    // (bug 213) EJS phải được xử lý TRƯỚC TIÊN. Script trong replaceString rất hay có thẻ EJS,
    // mà mấy thẻ đó không phải JS hợp lệ đứng một mình → new Function() luôn ném SyntaxError →
    // injectFunction bác cả bản chèn ĐÚNG. Đó là báo động giả chặn oan chính tính năng của mình.
    //
    //  · Thẻ XUẤT `<%= %>` / `<%- %>` nằm ở vị trí BIỂU THỨC → thay bằng một literal là parse được.
    //  · Thẻ ĐIỀU KHIỂN `<% if … { %> … <% } %>` thì KHÔNG: bỏ nó đi là mất luôn thân lệnh, thay
    //    bằng literal là dính hai biểu thức cạnh nhau. Không có cách nào parse tử tế, nên với khối
    //    đó ta BỎ QUA kiểm cú pháp thay vì báo bừa — thà không kết luận còn hơn kết luận sai.
    const ejsStripped = scriptContent.replace(/<%[=-]([\s\S]*?)%>/g, '"__EJS__"');
    if (/<%[\s\S]*?%>/.test(ejsStripped)) continue;   // còn thẻ điều khiển → không kết luận được

    // Replace common ST/jQuery patterns that would fail in strict JS parse
    const sanitized = ejsStripped
      // Replace capture group references
      .replace(/\$(\d+)/g, '"__CAPTURE_$1__"')
      .replace(/\$&/g, '"__CAPTURE_FULL__"')
      // Replace common template literals that aren't valid standalone JS
      .replace(/\{\{[^}]+\}\}/g, '"__TEMPLATE__"');

    try {
      // Use Function constructor for syntax check only (never executed)
      new Function(sanitized);
    } catch (err: any) {
      // Extract line number from error if available
      const lineMatch = err.message?.match(/line (\d+)/i);
      const line = lineMatch ? parseInt(lineMatch[1]) : 0;

      errors.push({
        line,
        message: `Script block #${scriptIndex}: ${err.message}`,
        context: scriptContent.slice(0, 100),
      });
    }
  }

  // Check for unmatched HTML tags (basic)
  const openTags = (replaceString.match(/<(?!\/|!|br|hr|img|input|meta|link)[a-z][^>]*(?<!\/)\s*>/gi) || []).length;
  const closeTags = (replaceString.match(/<\/[a-z]+>/gi) || []).length;
  if (Math.abs(openTags - closeTags) > 2) {
    errors.push({
      line: 0,
      message: `HTML tag mismatch: ${openTags} mở vs ${closeTags} đóng (chênh lệch ${Math.abs(openTags - closeTags)})`,
    });
  }

  return { valid: errors.length === 0, errors };
}

// ─── CSS Injection Helper ─────────────────────────────────────────────────────

/**
 * Inject CSS rules into existing <style> block or create a new one.
 */
export function injectCSS(
  replaceString: string,
  cssCode: string,
): InjectionResult {
  const structure = analyzeReplaceString(replaceString);

  if (structure.styleZones.length > 0) {
    // Inject before </style> of the last style block
    const closeIdx = replaceString.lastIndexOf('</style>');
    if (closeIdx !== -1) {
      const before = replaceString.slice(0, closeIdx);
      const after = replaceString.slice(closeIdx);
      return {
        result: before + '\n' + cssCode.trim() + '\n' + after,
        success: true,
        injectedAt: 'trước </style> cuối',
      };
    }
  }

  // No style block — create new one
  // Best place: before first <script> or at the beginning
  if (structure.scriptZones.length > 0) {
    const firstScript = structure.scriptZones[0];
    const before = replaceString.slice(0, firstScript.start);
    const after = replaceString.slice(firstScript.start);
    return {
      result: before + `<style>\n${cssCode.trim()}\n</style>\n` + after,
      success: true,
      injectedAt: 'style block mới trước script đầu tiên',
    };
  }

  // Prepend style block
  return {
    result: `<style>\n${cssCode.trim()}\n</style>\n` + replaceString,
    success: true,
    injectedAt: 'style block mới ở đầu',
  };
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Find the matching closing brace for an opening brace at the given position.
 */
function findMatchingBrace(str: string, openPos: number): number {
  let depth = 1;
  let i = openPos + 1;
  let inString = false;
  let stringChar = '';

  while (i < str.length && depth > 0) {
    const ch = str[i];

    // Handle string literals
    if (inString) {
      if (ch === stringChar && str[i - 1] !== '\\') {
        inString = false;
      }
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
    }
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

/**
 * Get a concise structure summary for display in UI.
 */
export function getStructureSummary(structure: ReplaceStringStructure): string {
  const parts: string[] = [];
  if (structure.scriptZones.length > 0) parts.push(`${structure.scriptZones.length} script block(s)`);
  if (structure.styleZones.length > 0) parts.push(`${structure.styleZones.length} style block(s)`);
  if (structure.ejsBlocks.length > 0) parts.push(`${structure.ejsBlocks.length} EJS block(s)`);
  if (structure.functions.length > 0) parts.push(`${structure.functions.length} function(s): ${structure.functions.map(f => f.name).join(', ')}`);
  if (structure.captureGroups.length > 0) parts.push(`Captures: ${structure.captureGroups.join(', ')}`);
  if (structure.jqueryReadyBlocks.length > 0) parts.push('jQuery ready');
  return parts.join(' | ') || 'Plain text/HTML';
}
