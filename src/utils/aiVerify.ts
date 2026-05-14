import type { CharacterCard, ProxySettings, TranslationField } from '../types/card';

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

  // Check each source location
  for (const [source, origList] of origBySource) {
    const transList = transBySource.get(source) || [];
    const transNames = new Set(transList.map(r => r.name));

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

  return issues;
}

/* ═══ Field-level verification (per-field checks on TranslationField[]) ═══ */

export interface FieldIssue extends VerifyIssue {
  fieldPath: string;
  category: 'residual_source' | 'html_broken' | 'bracket_mismatch' | 'macro_damaged' | 'json_broken' | 'mvu_inconsistent' | 'length_anomaly' | 'empty_translation' | 'regex_broken' | 'code_splice';
}

/** Count CJK characters in text */
function countCJK(text: string): number {
  return (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || []).length;
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

      for (const m of origSet) {
        if (!transSet.has(m)) {
          // Check if this macro was MVU-remapped in translation
          const varMatch = m.match(/\{\{(getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/);
          if (varMatch) {
            const varName = varMatch[2].trim();
            // Forward lookup: original var → mapped name
            const mappedName = mvuDictionary[varName];
            if (mappedName && transSet.has(m.replace(varName, mappedName))) continue;
            // Reverse lookup: check if any MVU mapping covers this macro
            const reverseMapped = Object.entries(mvuDictionary).find(([, v]) => v === varName)?.[0];
            if (reverseMapped && transSet.has(m.replace(varName, reverseMapped))) continue;
            // Partial match: check if translation has same macro type with any MVU-known variable
            const macroType = varMatch[1];
            const hasAnyMVUVariant = [...transSet].some(tm => {
              const tmMatch = tm.match(new RegExp(`\\{\\{${macroType}::([^:}]+)`));
              if (!tmMatch) return false;
              const tmVar = tmMatch[1].trim();
              return Object.keys(mvuDictionary).includes(tmVar) || Object.values(mvuDictionary).includes(tmVar);
            });
            if (hasAnyMVUVariant) continue;
          }
          missingMacros.push(m);
        }
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
      if (ratio < 0.15) {
        issues.push({
          id: crypto.randomUUID(), fieldPath: field.path,
          severity: 'error', category: 'length_anomaly',
          location: field.label,
          description: `Translation is suspiciously short: ${trans.length} chars vs ${orig.length} original (${Math.round(ratio * 100)}%).`,
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
    }

    // ─── 7. MVU variable consistency ───
    if (Object.keys(mvuDictionary).length > 0 && (field.group === 'tavern_helper' || field.group === 'lorebook' || field.group === 'regex')) {
      for (const [origVar, transVar] of Object.entries(mvuDictionary)) {
        if (!origVar || !transVar || origVar === transVar) continue;
        // If original has this variable and translation still has the original name (not renamed)
        if (orig.includes(origVar) && currentAutoFix.includes(origVar) && !currentAutoFix.includes(transVar)) {
          currentAutoFix = currentAutoFix.split(origVar).join(transVar);
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
        let braceDepth = 0;
        for (const ch of currentAutoFix) {
          if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth--;
        }
        if (braceDepth !== 0) {
          issues.push({
            id: crypto.randomUUID(), fieldPath: field.path,
            severity: 'error', category: 'code_splice',
            location: field.label,
            description: `Code structure corrupted: ${totalFuncOpens} function(s) detected but brace depth is ${braceDepth} (should be 0). Translation may have broken a function body.`,
            original: `Functions: ${totalFuncOpens}, expected braceDepth: 0`,
            current: `braceDepth: ${braceDepth}`,
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
  const url = config.proxyUrl.replace(/\/+$/, '');
  let apiUrl: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: any;

  if (config.provider === 'anthropic') {
    apiUrl = url + '/messages';
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = { model: config.model, max_tokens: config.maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }], temperature: 0.1 };
  } else if (config.provider === 'google') {
    apiUrl = `${url}/models/${config.model}:generateContent?key=${config.apiKey}`;
    body = { system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: 'user', parts: [{ text: userPrompt }] }], generationConfig: { maxOutputTokens: config.maxTokens, temperature: 0.1 }, safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }] };
  } else {
    apiUrl = url + '/chat/completions';
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
    body = { model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: config.maxTokens, temperature: 0.1 };
  }

  const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error(`API ${res.status}: ${e.slice(0, 200)}`); }
  const json = await res.json();

  if (config.provider === 'anthropic') return json.content?.[0]?.text || '';
  if (config.provider === 'google') return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return json.choices?.[0]?.message?.content || '';
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
  // 1. Length ratio check: fix shouldn't be drastically different from current
  const lengthRatio = fixedText.length / currentTranslation.length;
  if (lengthRatio < 0.4) {
    return { valid: false, reason: `Fix too short: ${fixedText.length} vs ${currentTranslation.length} chars (${(lengthRatio * 100).toFixed(0)}%)` };
  }
  if (lengthRatio > 3.0) {
    return { valid: false, reason: `Fix too long: ${fixedText.length} vs ${currentTranslation.length} chars (${(lengthRatio * 100).toFixed(0)}%)` };
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
        return { valid: false, reason: `Fix lost standard macro: ${m}` };
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
      return { valid: false, reason: `Fix lost too many macros: ${fixMacros.length} vs ${origMacros.length} original` };
    }
  }

  // 3. Regex preservation check: if original was a regex literal, the fix must also be a regex literal
  if (field.label.includes('findRegex')) {
    if (/^\/[\s\S]+\/[a-z]*$/i.test(original)) {
      if (!/^\/[\s\S]+\/[a-z]*$/i.test(fixedText)) {
        return { valid: false, reason: `Fix failed to restore regex boundary slashes (/.../).` };
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
      return { valid: false, reason: `Fix broke ${pair} bracket balance: original ${origBalance}, fix ${fixBalance}` };
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
    return { valid: false, reason: `Fix worsened severity score: ${scoreBefore} → ${scoreAfter} (tolerance: ${tolerance}, errors×3 + warnings×1)` };
  }
  if (issuesAfter.length > issuesBefore.length + Math.max(2, Math.ceil(initialIssueCount / 3))) {
    return { valid: false, reason: `Fix increased total issues: ${issuesBefore.length} → ${issuesAfter.length}` };
  }

  return { valid: true };
}

/* ═══ Build category-aware fix prompt ═══ */

function buildFixPrompt(
  issueList: (FieldIssue | VerifyIssue)[],
  field: TranslationField,
  targetLang: string,
  mvuBlock: string,
  roundInfo?: { round: number; prevFixFeedback?: string }
): { system: string; user: string } {
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
${categoryHints ? '\n' + categoryHints : ''}${mvuBlock}${roundNote}`;

  const user = `Fix this ${targetLang} translation. ONLY fix the listed issues.

ORIGINAL:
${field.original.slice(0, 6000)}

CURRENT TRANSLATION:
${field.translated.slice(0, 6000)}

ISSUES TO FIX:
${issueDesc}

Return the corrected translation (fix ONLY the issues above, change nothing else):`;

  return { system, user };
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

    for (const [path, { issueList, field: origField }] of fieldsToFix) {
      if (signal?.aborted) break;
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
          continue;
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
          continue;
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

      const { system, user } = buildFixPrompt(
        currentIssueList, workingField, targetLang, mvuBlock,
        { round, prevFixFeedback: prevFeedback }
      );

      const issuesBefore = verifyFields([workingField], mvuDictionary, sourceLang);
      const initialIssueCount = currentIssueList.length;

      try {
        let fixed = await callLLM(config, system, user, signal);
        
        // Strip markdown code fences if present anywhere
        const mdMatch = fixed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
        if (mdMatch) fixed = mdMatch[1].trim();
        else fixed = fixed.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();

        if (!fixed || fixed.length < Math.max(10, effectiveTranslation.length * 0.3)) {
          report.push({
            path, label: origField.label, status: 'rejected', round,
            reason: `Empty or too short response (${fixed?.length || 0} chars)`,
            issuesBefore: issuesBefore.length, issuesAfter: issuesBefore.length,
          });
          done++;
          onProgress?.(done, fieldsToFix.size, origField.label, round);
          continue;
        }

        // Multi-layer validation — pass initialIssueCount for tolerance
        const validation = validateFixQuality(
          origField.original, effectiveTranslation, fixed, mvuDictionary, sourceLang, workingField, initialIssueCount
        );

        if (!validation.valid) {
          report.push({
            path, label: origField.label, status: 'rejected', round,
            reason: validation.reason || 'Quality check failed',
            issuesBefore: issuesBefore.length, issuesAfter: issuesBefore.length,
          });
          done++;
          onProgress?.(done, fieldsToFix.size, origField.label, round);
          continue;
        }

        // Count issues after fix
        const mockAfter = { ...workingField, translated: fixed };
        const issuesAfter = verifyFields([mockAfter], mvuDictionary, sourceLang);

        // Accept if this is the best result so far
        const currentBest = bestFixes.get(path);
        if (!currentBest || issuesAfter.length < currentBest.issuesAfter) {
          bestFixes.set(path, { fixedText: fixed, issuesAfter: issuesAfter.length, round });
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
    }

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

  const systemPrompt = `You fix ONE SPECIFIC translation error in a SillyTavern character card field.
Return ONLY the corrected translated text. No explanations, no markdown code fences.

RULES:
- Fix ONLY the ONE issue described below. Change NOTHING else.
- Preserve ALL {{macros}}, HTML tags, brackets, code blocks exactly.
- Output length must be very close to input length.
${categoryHint ? '\n' + categoryHint : ''}${mvuBlock}`;

  const userPrompt = `Fix this ONE issue in the ${targetLang} translation.

ISSUE: [${issue.severity}/${issue.category}] ${issue.description}
${issue.original ? `Original snippet: "${issue.original}"` : ''}
${issue.suggestion ? `Hint: ${issue.suggestion}` : ''}

ORIGINAL TEXT:
${field.original.slice(0, 6000)}

CURRENT TRANSLATION:
${field.translated.slice(0, 6000)}

Return the corrected translation:`;

  try {
    let fixed = await callLLM(config, systemPrompt, userPrompt, signal);
    
    // Strip markdown code fences if present anywhere
    const mdMatch = fixed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (mdMatch) fixed = mdMatch[1].trim();
    else fixed = fixed.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();

    if (!fixed || fixed.length < Math.max(10, field.translated.length * 0.3)) {
      return { success: false, reason: 'AI returned empty or truncated result' };
    }

    // Validate quality
    const validation = validateFixQuality(
      field.original, field.translated, fixed, mvuDictionary, sourceLang, field, 1
    );

    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    // Specific check: did this particular issue get resolved?
    const mockBefore = { ...field, translated: field.translated };
    const mockAfter = { ...field, translated: fixed };
    const issuesBefore = verifyFields([mockBefore], mvuDictionary, sourceLang);
    const issuesAfter = verifyFields([mockAfter], mvuDictionary, sourceLang);

    // Check if the specific category was reduced
    const catBefore = issuesBefore.filter(i => i.category === issue.category).length;
    const catAfter = issuesAfter.filter(i => i.category === issue.category).length;

    if (catAfter >= catBefore && issuesAfter.length >= issuesBefore.length) {
      return { success: false, reason: `Issue not resolved (${issue.category}: ${catBefore} → ${catAfter})` };
    }

    return { success: true, fixedText: fixed };
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : String(err) };
  }
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
    // Import callProvider dynamically to avoid circular dependencies
    const url = config.proxyUrl.replace(/\/+$/, '');
    let apiUrl: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: any;

    if (config.provider === 'anthropic') {
      apiUrl = url + '/messages';
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = {
        model: config.model,
        max_tokens: config.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.2,
      };
    } else if (config.provider === 'google') {
      apiUrl = `${url}/models/${config.model}:generateContent?key=${config.apiKey}`;
      body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: config.maxTokens, temperature: 0.2 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      };
    } else {
      apiUrl = url + '/chat/completions';
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
      body = {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: config.maxTokens,
        temperature: 0.2,
      };
    }

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = await res.json();

    // Extract text from response
    let responseText = '';
    if (config.provider === 'anthropic') {
      responseText = json.content?.[0]?.text || '';
    } else if (config.provider === 'google') {
      responseText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      responseText = json.choices?.[0]?.message?.content || '';
    }

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
