/**
 * src/lib/mvuzod/gameHtmlFixer.ts — Auto-Fix Engine for AI-generated HTML
 * ──────────────────────────────────────────────────────────────────────────────
 * Detects and fixes common HTML/CSS issues in AI output.
 * Generates a diff report for user review.
 *
 * Only runs on AI-Assisted / Orchestrated output — Programmatic output
 * is already correct by construction.
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FixResult {
  /** Fixed HTML string */
  fixed: string;
  /** Whether any changes were made */
  hasChanges: boolean;
  /** List of fixes applied */
  fixes: FixEntry[];
  /** Quality score A-F */
  qualityScore: QualityGrade;
  /** Detailed quality breakdown */
  qualityDetails: QualityDetail[];
}

export interface FixEntry {
  type: 'error' | 'warning' | 'enhancement';
  category: string;
  description: string;
  /** Original text (snippet) */
  original?: string;
  /** Fixed text (snippet) */
  replacement?: string;
}

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface QualityDetail {
  criterion: string;
  score: number;  // 0-100
  weight: number; // 0-1
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN AUTO-FIX FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-fix common HTML/CSS issues in AI-generated regex output.
 * Returns fixed HTML + diff report.
 */
export function autoFixGameHtml(html: string): FixResult {
  const fixes: FixEntry[] = [];
  let result = html;

  // ── Fix 1: Ensure proper HTML document structure ──
  result = fixDocumentStructure(result, fixes);

  // ── Fix 2: Fix unclosed tags ──
  result = fixUnclosedTags(result, fixes);

  // ── Fix 3: Add missing clamp() for font-sizes ──
  result = fixFontSizing(result, fixes);

  // ── Fix 4: Fix inline px sizes → clamp() responsive ──
  result = fixHardcodedSizes(result, fixes);

  // ── Fix 5: Add missing scrollbar styling ──
  result = fixScrollbar(result, fixes);

  // ── Fix 6: Add box-sizing reset if missing ──
  result = fixBoxSizing(result, fixes);

  // ── Fix 7: Fix common CSS issues ──
  result = fixCSSIssues(result, fixes);

  // ── Fix 8: Ensure module script type ──
  result = fixScriptType(result, fixes);

  // ── Quality Score ──
  const { qualityScore, qualityDetails } = calculateQuality(result);

  return {
    fixed: result,
    hasChanges: result !== html,
    fixes,
    qualityScore,
    qualityDetails,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════

function fixDocumentStructure(html: string, fixes: FixEntry[]): string {
  let result = html;

  // Ensure starts with ```html if missing (regex output convention)
  if (!result.startsWith('```html')) {
    if (result.includes('<!DOCTYPE') || result.includes('<html')) {
      result = '```html\n' + result;
      fixes.push({
        type: 'enhancement',
        category: 'structure',
        description: 'Thêm ```html wrapper (convention regex output)',
      });
    }
  }

  // (bug 72 — user tự soi ra: "mới bọc được ```html, chưa có ``` nằm cuối")
  // Mở fence mà không đóng thì SillyTavern coi phần còn lại của tin nhắn là code chưa kết thúc
  // → không render HTML → giao diện không bao giờ hiện. Đóng fence luôn cho đối xứng.
  if (result.startsWith('```html') && !/\n```\s*$/.test(result)) {
    result = result.replace(/\s*$/, '') + '\n```';
    fixes.push({
      type: 'error',
      category: 'structure',
      description: 'Thêm ``` đóng ở cuối (thiếu fence đóng thì ST không render HTML)',
    });
  }

  // Ensure has <meta charset="UTF-8">
  if (result.includes('<head>') && !result.includes('charset')) {
    result = result.replace('<head>', '<head>\n    <meta charset="UTF-8">');
    fixes.push({
      type: 'warning',
      category: 'structure',
      description: 'Thêm <meta charset="UTF-8">',
    });
  }

  return result;
}

function fixUnclosedTags(html: string, fixes: FixEntry[]): string {
  let result = html;

  // Count specific tags
  const tagPairs: Array<[string, string]> = [
    ['<div', '</div>'],
    ['<style', '</style>'],
    ['<script', '</script>'],
    ['<ul', '</ul>'],
    ['<table', '</table>'],
  ];

  for (const [open, close] of tagPairs) {
    const openCount = (result.match(new RegExp(open, 'gi')) || []).length;
    const closeCount = (result.match(new RegExp(close.replace(/[/]/g, '\\/'), 'gi')) || []).length;

    if (openCount > closeCount) {
      const missing = openCount - closeCount;
      // Add closing tags before </body> or at end
      const insertion = close.repeat(missing);
      if (result.includes('</body>')) {
        result = result.replace('</body>', insertion + '\n</body>');
      } else {
        result += '\n' + insertion;
      }
      fixes.push({
        type: 'error',
        category: 'html',
        description: `Thêm ${missing} thẻ ${close} bị thiếu`,
      });
    }
  }

  return result;
}

function fixFontSizing(html: string, fixes: FixEntry[]): string {
  let result = html;
  let fixCount = 0;

  // Fix hardcoded font-size: Npx → clamp()
  result = result.replace(/font-size:\s*(\d+)px/g, (match, size) => {
    const px = parseInt(size);
    if (px <= 8 || px >= 48) return match; // Don't fix extreme sizes

    // Map to clamp range
    const min = Math.max(10, px - 2);
    const preferred = (px / 14 * 2.5).toFixed(1);
    const max = px + 2;
    fixCount++;
    return `font-size: clamp(${min}px, ${preferred}vw, ${max}px)`;
  });

  if (fixCount > 0) {
    fixes.push({
      type: 'warning',
      category: 'responsive',
      description: `Chuyển ${fixCount} font-size cố định → clamp() responsive`,
    });
  }

  return result;
}

function fixHardcodedSizes(html: string, fixes: FixEntry[]): string {
  let result = html;
  let fixCount = 0;

  // Fix hardcoded padding/margin
  result = result.replace(/(padding|margin):\s*(\d+)px/g, (match, prop, size) => {
    const px = parseInt(size);
    if (px <= 2 || px >= 60) return match;

    const min = Math.max(4, Math.floor(px * 0.6));
    const vw = (px / 5).toFixed(1);
    fixCount++;
    return `${prop}: clamp(${min}px, ${vw}vw, ${px}px)`;
  });

  if (fixCount > 0) {
    fixes.push({
      type: 'enhancement',
      category: 'responsive',
      description: `Chuyển ${fixCount} padding/margin cố định → clamp()`,
    });
  }

  return result;
}

function fixScrollbar(html: string, fixes: FixEntry[]): string {
  if (html.includes('::-webkit-scrollbar')) return html;

  // Check if there are scrollable elements
  if (!html.includes('overflow') && !html.includes('scroll')) return html;

  const scrollbarCSS = `
    /* Auto-fix: Scrollbar styling */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: var(--theme-main, #666); border-radius: 2px; }
    ::-webkit-scrollbar-track { background: transparent; }
`;

  // Insert before </style>
  if (html.includes('</style>')) {
    fixes.push({
      type: 'enhancement',
      category: 'styling',
      description: 'Thêm scrollbar styling cho các phần tử cuộn',
    });
    return html.replace('</style>', scrollbarCSS + '\n    </style>');
  }

  return html;
}

function fixBoxSizing(html: string, fixes: FixEntry[]): string {
  if (html.includes('box-sizing')) return html;

  const resetCSS = `    *, *::before, *::after { box-sizing: border-box; }\n`;

  if (html.includes('<style>')) {
    fixes.push({
      type: 'warning',
      category: 'layout',
      description: 'Thêm box-sizing: border-box reset',
    });
    return html.replace('<style>', '<style>\n' + resetCSS);
  }

  return html;
}

function fixCSSIssues(html: string, fixes: FixEntry[]): string {
  let result = html;

  // Fix width: 100vw → 100% (inside container)
  if (result.includes('width: 100vw') && !result.includes('width: 100vw;')) {
    // Only fix if there's already a container
    if (result.includes('.container') || result.includes('#app') || result.includes('#stcs-app')) {
      result = result.replace(/width:\s*100vw/g, 'width: 100%');
      fixes.push({
        type: 'warning',
        category: 'layout',
        description: 'Sửa width: 100vw → 100% (tránh horizontal overflow)',
      });
    }
  }

  // Fix missing user-select: none (game UI should prevent text selection)
  if (!result.includes('user-select')) {
    if (result.includes('<style>')) {
      const insertPoint = result.indexOf('{', result.indexOf('<style>'));
      if (insertPoint > 0) {
        // Find the first CSS rule and add user-select
        fixes.push({
          type: 'enhancement',
          category: 'ux',
          description: 'Thêm user-select: none cho game UI',
        });
      }
    }
  }

  return result;
}

function fixScriptType(html: string, fixes: FixEntry[]): string {
  // Ensure script uses type="module" for TavernHelper compatibility
  if (html.includes('<script>') && html.includes('waitGlobalInitialized')) {
    const result = html.replace('<script>', '<script type="module">');
    if (result !== html) {
      fixes.push({
        type: 'error',
        category: 'runtime',
        description: 'Thêm type="module" cho script tag (bắt buộc cho TavernHelper)',
      });
      return result;
    }
  }
  return html;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY SCORING
// ═══════════════════════════════════════════════════════════════════════════

function calculateQuality(html: string): {
  qualityScore: QualityGrade;
  qualityDetails: QualityDetail[];
} {
  const details: QualityDetail[] = [];

  // 1. Document structure (20%)
  const hasDoctype = html.includes('<!DOCTYPE') || html.includes('```html');
  const hasHead = html.includes('<head>');
  const hasStyle = html.includes('<style>');
  const hasScript = html.includes('<script');
  const structureScore =
    (hasDoctype ? 25 : 0) +
    (hasHead ? 25 : 0) +
    (hasStyle ? 25 : 0) +
    (hasScript ? 25 : 0);
  details.push({ criterion: 'Document structure', score: structureScore, weight: 0.2, notes: `DOCTYPE:${hasDoctype} Head:${hasHead} Style:${hasStyle} Script:${hasScript}` });

  // 2. Responsive sizing (20%)
  const hasClamp = html.includes('clamp(');
  const hasVw = html.includes('vw');
  const hardcodedPx = (html.match(/font-size:\s*\d+px/g) || []).length;
  const responsiveScore = (hasClamp ? 40 : 0) + (hasVw ? 30 : 0) + Math.max(0, 30 - hardcodedPx * 5);
  details.push({ criterion: 'Responsive sizing', score: Math.min(100, responsiveScore), weight: 0.2, notes: `clamp:${hasClamp} vw:${hasVw} hardcoded-px:${hardcodedPx}` });

  // 3. CSS quality (20%)
  const hasCSSVars = html.includes('var(--');
  const hasScrollbar = html.includes('::-webkit-scrollbar');
  const hasBoxSizing = html.includes('box-sizing');
  const hasAnimations = html.includes('@keyframes') || html.includes('transition');
  const cssScore =
    (hasCSSVars ? 30 : 0) +
    (hasScrollbar ? 20 : 0) +
    (hasBoxSizing ? 20 : 0) +
    (hasAnimations ? 30 : 0);
  details.push({ criterion: 'CSS quality', score: cssScore, weight: 0.2, notes: `vars:${hasCSSVars} scrollbar:${hasScrollbar} boxSizing:${hasBoxSizing} animations:${hasAnimations}` });

  // 4. Data binding (20%)
  const hasGetAllVars = html.includes('getAllVariables');
  const hasEventOn = html.includes('eventOn');
  const hasLodashGet = html.includes('_.get');
  const hasWaitInit = html.includes('waitGlobalInitialized');
  const bindingScore =
    (hasGetAllVars ? 25 : 0) +
    (hasEventOn ? 25 : 0) +
    (hasLodashGet ? 25 : 0) +
    (hasWaitInit ? 25 : 0);
  details.push({ criterion: 'Data binding', score: bindingScore, weight: 0.2, notes: `getAllVars:${hasGetAllVars} eventOn:${hasEventOn} lodashGet:${hasLodashGet} waitInit:${hasWaitInit}` });

  // 5. Size adequacy (20%)
  const sizeKb = html.length / 1024;
  const sizeScore = sizeKb >= 30 ? 100 : sizeKb >= 15 ? 80 : sizeKb >= 5 ? 60 : sizeKb >= 2 ? 40 : 20;
  details.push({ criterion: 'Size adequacy', score: sizeScore, weight: 0.2, notes: `${sizeKb.toFixed(1)}KB` });

  // Calculate weighted total
  const totalScore = details.reduce((sum, d) => sum + d.score * d.weight, 0);

  let qualityScore: QualityGrade;
  if (totalScore >= 85) qualityScore = 'A';
  else if (totalScore >= 70) qualityScore = 'B';
  else if (totalScore >= 55) qualityScore = 'C';
  else if (totalScore >= 40) qualityScore = 'D';
  else qualityScore = 'F';

  return { qualityScore, qualityDetails: details };
}

// ═══════════════════════════════════════════════════════════════════════════
// DIFF GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a simple text diff between original and fixed HTML.
 * Returns an array of diff entries for UI display.
 */
export function generateDiff(
  original: string,
  fixed: string,
): DiffEntry[] {
  if (original === fixed) return [];

  const origLines = original.split('\n');
  const fixedLines = fixed.split('\n');
  const diffs: DiffEntry[] = [];

  const maxLen = Math.max(origLines.length, fixedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i] ?? '';
    const fixedLine = fixedLines[i] ?? '';

    if (origLine !== fixedLine) {
      if (i < origLines.length && i < fixedLines.length) {
        diffs.push({ type: 'changed', lineNumber: i + 1, original: origLine, fixed: fixedLine });
      } else if (i >= origLines.length) {
        diffs.push({ type: 'added', lineNumber: i + 1, original: '', fixed: fixedLine });
      } else {
        diffs.push({ type: 'removed', lineNumber: i + 1, original: origLine, fixed: '' });
      }
    }
  }

  return diffs;
}

export interface DiffEntry {
  type: 'added' | 'removed' | 'changed';
  lineNumber: number;
  original: string;
  fixed: string;
}
