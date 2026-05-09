/**
 * MVU Variable Integrity Validator
 * 
 * Validates that MVU/Zod variables are correctly replaced in translated text.
 * Runs after each field is translated to catch:
 * 1. Original variable names still present (should have been translated)
 * 2. Expected translated names missing (AI forgot to include)
 * 3. Structural integrity (YAML format, macro syntax preserved)
 * 4. [MVU-ZOD] Zod schema conformance for state objects
 * 5. [MVU-ZOD] JSON Patch path validity
 */

import type { z } from 'zod';
import type { DetectedZodSchema, MvuZodValidationReport, JsonPatchOp } from '../types/mvuZodTypes';
import { buildRuntimeSchema, validateStateAgainstSchema } from './zodSchemaEngine';
import { extractJsonPatches, validatePatchAgainstSchema } from './jsonPatchValidator';

export interface MvuValidationResult {
  valid: boolean;
  /** Original keys still found in translated text (should have been replaced) */
  unreplaced: string[];
  /** Translated keys found (correctly replaced) */
  replaced: string[];
  /** Warnings (non-critical issues) */
  warnings: string[];
  /** Summary message */
  summary: string;
  /** [MVU-ZOD] Schema validation errors */
  zodErrors?: { field: string; expected: string; received: string }[];
  /** [MVU-ZOD] JSON Patch validation errors */
  patchErrors?: { path: string; reason: string }[];
  /** [MVU-ZOD] Whether schema validation passed */
  schemaValid?: boolean;
}

/**
 * Validate that MVU variables are correctly replaced in the translated text.
 * 
 * @param original - Original (untranslated) text
 * @param translated - Translated text
 * @param dictionary - MVU dictionary (original → translated key names)
 * @param fieldType - Type of field for context-specific checks
 */
export function validateMvuVariables(
  original: string,
  translated: string,
  dictionary: Record<string, string>,
  fieldType?: 'initvar' | 'mvu_logic' | 'rules' | 'narrative' | 'controller' | 'tavern_helper' | 'regex'
): MvuValidationResult {
  const result: MvuValidationResult = {
    valid: true,
    unreplaced: [],
    replaced: [],
    warnings: [],
    summary: '',
  };

  if (!translated || !dictionary || Object.keys(dictionary).length === 0) {
    result.summary = 'No dictionary to validate against';
    return result;
  }

  const entries = Object.entries(dictionary).filter(([k, v]) => k && v && k !== v);
  if (entries.length === 0) {
    result.summary = 'Dictionary has no translatable entries';
    return result;
  }

  const isCodeField = fieldType === 'initvar' || fieldType === 'mvu_logic' || 
                      fieldType === 'tavern_helper' || fieldType === 'regex' || fieldType === 'controller';

  for (const [originalKey, translatedKey] of entries) {
    // Check if original key was present in the source text
    const originalHadKey = original.includes(originalKey);
    if (!originalHadKey) continue; // Key wasn't in original, skip

    // Check if original key is STILL in translated text (bad — should be replaced)
    const translatedStillHasOriginal = translated.includes(originalKey);
    
    // Check if translated key is in the output (good — was replaced)
    const translatedHasNewKey = translated.includes(translatedKey);

    if (translatedStillHasOriginal && !translatedHasNewKey) {
      // Original key present but translated key absent → unreplaced
      result.unreplaced.push(originalKey);
      result.valid = false;
    } else if (translatedHasNewKey) {
      result.replaced.push(originalKey);
    } else if (!translatedStillHasOriginal && !translatedHasNewKey) {
      // Neither found — variable might have been removed entirely
      if (isCodeField) {
        result.warnings.push(`Variable "${originalKey}" disappeared from translation`);
      }
    }

    // Edge case: both original AND translated present (partial replacement)
    if (translatedStillHasOriginal && translatedHasNewKey) {
      result.warnings.push(`Variable "${originalKey}" partially replaced — both original and translated versions present`);
    }
  }

  // ─── Structural checks for specific field types ───
  if (fieldType === 'initvar') {
    // Check YAML structure preservation
    const originalLineCount = original.split('\n').length;
    const translatedLineCount = translated.split('\n').length;
    if (Math.abs(originalLineCount - translatedLineCount) > originalLineCount * 0.3) {
      result.warnings.push(`YAML structure may be broken: ${originalLineCount} → ${translatedLineCount} lines`);
    }
  }

  // ─── Check macro syntax integrity ───
  const originalMacros = (original.match(/\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^}]+)(?:\}\}|::)/g) || []).length;
  const translatedMacros = (translated.match(/\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^}]+)(?:\}\}|::)/g) || []).length;
  if (originalMacros > 0 && translatedMacros === 0) {
    result.warnings.push(`All ${originalMacros} macros disappeared from translation`);
    result.valid = false;
  } else if (Math.abs(originalMacros - translatedMacros) > 2) {
    result.warnings.push(`Macro count changed significantly: ${originalMacros} → ${translatedMacros}`);
  }

  // ─── Check EJS syntax integrity ───
  const originalEjs = (original.match(/(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(/g) || []).length;
  const translatedEjs = (translated.match(/(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(/g) || []).length;
  if (originalEjs > 0 && translatedEjs === 0) {
    result.warnings.push(`All ${originalEjs} EJS function calls disappeared from translation`);
    result.valid = false;
  } else if (Math.abs(originalEjs - translatedEjs) > 2) {
    result.warnings.push(`EJS function call count changed significantly: ${originalEjs} → ${translatedEjs}`);
  }

  // Build summary
  const parts: string[] = [];
  if (result.replaced.length > 0) parts.push(`${result.replaced.length} ✅`);
  if (result.unreplaced.length > 0) parts.push(`${result.unreplaced.length} ❌`);
  if (result.warnings.length > 0) parts.push(`${result.warnings.length} ⚠️`);
  result.summary = parts.join(' | ') || 'OK';

  return result;
}

/**
 * Auto-fix unreplaced variables in translated text using the dictionary.
 * Only applies to code fields (not narrative) where aggressive replacement is safe.
 */
export function autoFixMvuVariables(
  translated: string,
  dictionary: Record<string, string>,
  unreplacedKeys: string[]
): string {
  if (unreplacedKeys.length === 0) return translated;

  let fixed = translated;
  // Sort by length descending to avoid partial replacements (e.g. replacing 'var' inside 'variable')
  const sortedKeys = [...unreplacedKeys].sort((a, b) => b.length - a.length);

  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CRITICAL: Escape `$` in replacement strings to prevent regex replacement pattern
  // interpretation. Without this, `$1`, `$&`, `$'` in translated names cause
  // the replacement to eat surrounding code characters like `{`, `$`.
  const safeReplacement = (str: string) => str.replace(/\$/g, '$$$$');

  for (const key of sortedKeys) {
    const replacement = dictionary[key];
    if (!replacement || key === replacement) continue;

    const escaped = escapeRegExp(key);
    const safeRepl = safeReplacement(replacement);
    
    // 1. Replace in macros: {{getvar::key}} and {{setvar::key::val}}
    const macroRegex = new RegExp(`(\\{\\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)${escaped}(\\}\\}|::)`, 'g');
    fixed = fixed.replace(macroRegex, `$1${safeRepl}$2`);

    // 2. Replace in EJS function calls: getvar('key') / setvar('key', ...)
    const ejsRegex = new RegExp(`((?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\\s*\\(\\s*['"])([^'"]+)(['"])`, 'g');
    fixed = fixed.replace(ejsRegex, (match, prefix, inner, suffix) => {
      const segmentRegex = new RegExp(`(^|\\.)(${escaped})(\\.|$)`, 'g');
      const newInner = inner.replace(segmentRegex, `$1${safeRepl}$3`);
      return `${prefix}${newInner}${suffix}`;
    });

    // 3. Replace in data-var attributes: data-var="key"
    const dataVarRegex = new RegExp(`(data-var\\s*=\\s*["'])${escaped}(["'])`, 'g');
    fixed = fixed.replace(dataVarRegex, `$1${safeRepl}$2`);

    // 4. Replace standalone occurrences
    const isAscii = /^[a-zA-Z0-9_]+$/.test(key);
    const regex = isAscii
      ? new RegExp(`\\b${escaped}\\b`, 'g')
      : new RegExp(escaped, 'g');

    fixed = fixed.replace(regex, safeRepl);
  }

  return fixed;
}

/**
 * Validates that getvar/setvar macros reference translated variable names.
 */
export function validateGetvarSetvarSync(
  translated: string, 
  dictionary: Record<string, string>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // 1. Check macro-style: {{getvar::key}} / {{setvar::key::val}}
  const macros = translated.match(/\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^}]+?)(?:\}\}|::)/g) || [];
  
  for (const macro of macros) {
    const match = macro.match(/\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^}]+?)(?:\}\}|::)/);
    if (!match) continue;
    
    const varName = match[1];
    if (dictionary[varName] && dictionary[varName] !== varName) {
      errors.push(`Macro ${macro} uses original key "${varName}" instead of translated "${dictionary[varName]}"`);
    }
  }
  
  // 2. Check EJS function-call style: getvar('key') / setvar('key', ...)
  const ejsCalls = translated.match(/(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(\s*['"]([^'"]+)['"]/g) || [];
  
  for (const call of ejsCalls) {
    const match = call.match(/(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(\s*['"]([^'"]+)['"]/);
    if (!match) continue;
    
    const varName = match[1];
    // For dotted paths like stat_data.原始.field, check each segment
    const segments = varName.split('.');
    for (const seg of segments) {
      if (dictionary[seg] && dictionary[seg] !== seg) {
        errors.push(`EJS call ${call.slice(0, 60)} uses original key "${seg}" instead of translated "${dictionary[seg]}"`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Final check for CJK residuals in pure code fields.
 */
export function checkCodeFieldForCjk(
  translated: string,
  fieldType?: string
): { valid: boolean; residual?: string } {
  if (fieldType !== 'json_patch' && fieldType !== 'initvar' && fieldType !== 'controller') {
    return { valid: true };
  }
  
  // Find Chinese characters
  const match = translated.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/);
  if (match) {
    const start = Math.max(0, match.index! - 10);
    const end = Math.min(translated.length, match.index! + 10);
    return { valid: false, residual: translated.slice(start, end) };
  }
  
  return { valid: true };
}

/**
 * Generate a final sync verification report comparing original and translated card.
 * Returns a summary of variable replacement status across all translated fields.
 */
export function generateSyncReport(
  fields: { original: string; translated: string; label: string; group: string; entryType?: string }[],
  dictionary: Record<string, string>
): { totalVars: number; replaced: number; unreplaced: number; warnings: string[]; details: string[] } {
  const entries = Object.entries(dictionary).filter(([k, v]) => k && v && k !== v);
  if (entries.length === 0) return { totalVars: 0, replaced: 0, unreplaced: 0, warnings: [], details: [] };

  const globalReplaced = new Set<string>();
  const globalUnreplaced = new Set<string>();
  const warnings: string[] = [];
  const details: string[] = [];

  for (const field of fields) {
    if (!field.translated) continue;

    const fieldType = (field.entryType || field.group) as any;
    const validation = validateMvuVariables(field.original, field.translated, dictionary, fieldType);

    for (const k of validation.replaced) globalReplaced.add(k);
    for (const k of validation.unreplaced) {
      globalUnreplaced.add(k);
      details.push(`❌ "${k}" unreplaced in ${field.label}`);
    }
    for (const w of validation.warnings) {
      warnings.push(`${field.label}: ${w}`);
    }
  }

  // Remove from unreplaced if it was replaced elsewhere
  for (const k of globalReplaced) {
    globalUnreplaced.delete(k);
  }

  return {
    totalVars: entries.length,
    replaced: globalReplaced.size,
    unreplaced: globalUnreplaced.size,
    warnings,
    details,
  };
}

/* ═══════════════════════════════════════════════════════════════
   MVU-ZOD Enhanced Validation
   ═══════════════════════════════════════════════════════════════ */

/**
 * Validate translated text containing JSON state against a compiled Zod schema.
 * Extracts JSON objects from the text, then validates each against the schema.
 */
export function validateWithZodSchema(
  translated: string,
  schemas: DetectedZodSchema[]
): { valid: boolean; errors: { field: string; expected: string; received: string }[] } {
  if (!translated || schemas.length === 0) {
    return { valid: true, errors: [] };
  }

  const allErrors: { field: string; expected: string; received: string }[] = [];

  // Try to extract JSON objects from the translated text
  const jsonObjects = extractJsonObjects(translated);

  for (const obj of jsonObjects) {
    for (const schema of schemas) {
      if (!schema.compiled || schema.fields.length === 0) continue;
      try {
        const runtimeSchema = buildRuntimeSchema(schema.fields);
        const result = validateStateAgainstSchema(obj, runtimeSchema);
        if (!result.valid) {
          allErrors.push(...result.errors);
        }
      } catch {
        // Schema compilation failed — skip
      }
    }
  }

  return { valid: allErrors.length === 0, errors: allErrors };
}

/**
 * Validate JSON Patch operations found in translated text.
 */
export function validateJsonPatchIntegrity(
  translated: string,
  schemas: DetectedZodSchema[],
  dictionary?: Record<string, string>
): { valid: boolean; errors: { path: string; reason: string }[]; autoFixable: boolean } {
  if (!translated || schemas.length === 0) {
    return { valid: true, errors: [], autoFixable: false };
  }

  const patchArrays = extractJsonPatches(translated);
  if (patchArrays.length === 0) return { valid: true, errors: [], autoFixable: false };

  const allErrors: { path: string; reason: string }[] = [];
  let isAutoFixable = false;

  for (const patches of patchArrays) {
    for (const schema of schemas) {
      if (!schema.compiled || schema.fields.length === 0) continue;
      try {
        const runtimeSchema = buildRuntimeSchema(schema.fields);
        const result = validatePatchAgainstSchema(patches, runtimeSchema);
        for (const invalid of result.invalidOps) {
          const path = invalid.op.path;
          let reason = invalid.reason;
          
          // Reverse check: did the AI translate the path?
          if (dictionary) {
            const topField = path.split('/').filter(Boolean)[0];
            if (topField) {
              const originalKey = Object.keys(dictionary).find(k => dictionary[k] === topField);
              if (originalKey && schema.fields && schema.fields.some(f => f.name === originalKey)) {
                reason = `Path "${path}" was translated. It should remain "${originalKey}" per Zod schema.`;
                isAutoFixable = true;
              }
            }
          }

          allErrors.push({ path, reason });
        }
      } catch { /* skip */ }
    }
  }

  return { valid: allErrors.length === 0, errors: allErrors, autoFixable: isAutoFixable };
}

/**
 * Build a comprehensive MVU-ZOD validation report for a translated card.
 */
export function buildMvuZodReport(
  fields: { original: string; translated: string; label: string; group: string; entryType?: string }[],
  dictionary: Record<string, string>,
  schemas: DetectedZodSchema[]
): MvuZodValidationReport {
  // Legacy variable sync report
  const syncReport = generateSyncReport(fields, dictionary);

  const report: MvuZodValidationReport = {
    valid: syncReport.unreplaced === 0,
    variableSync: {
      replaced: syncReport.replaced,
      unreplaced: syncReport.unreplaced,
      warnings: syncReport.warnings,
    },
    summary: '',
  };

  // Zod schema validation
  if (schemas.length > 0 && schemas.some(s => s.compiled)) {
    let schemasChecked = 0, passed = 0, failed = 0;
    const schemaErrors: { field: string; expected: string; received: string }[] = [];

    for (const field of fields) {
      if (!field.translated || (field.entryType !== 'initvar' && field.entryType !== 'json_patch')) continue;
      const result = validateWithZodSchema(field.translated, schemas);
      schemasChecked++;
      if (result.valid) passed++;
      else {
        failed++;
        schemaErrors.push(...result.errors);
      }
    }

    if (schemasChecked > 0) {
      report.schemaValidation = { schemasChecked, passed, failed, errors: schemaErrors };
      if (failed > 0) report.valid = false;
    }
  }

  // JSON Patch validation
  const patchFields = fields.filter(f => f.translated && f.entryType === 'json_patch');
  if (patchFields.length > 0 && schemas.length > 0) {
    let totalOps = 0, validOps = 0, invalidOps = 0;
    const patchErrors: { path: string; reason: string }[] = [];

    for (const field of patchFields) {
      const result = validateJsonPatchIntegrity(field.translated, schemas, dictionary);
      const patches = extractJsonPatches(field.translated);
      const opCount = patches.reduce((sum, p) => sum + p.length, 0);
      totalOps += opCount;
      if (result.valid) validOps += opCount;
      else {
        invalidOps += result.errors.length;
        validOps += opCount - result.errors.length;
        patchErrors.push(...result.errors);
      }
    }

    report.patchValidation = { totalOps, validOps, invalidOps, errors: patchErrors };
    if (invalidOps > 0) report.valid = false;
  }

  // Build summary
  const parts: string[] = [];
  parts.push(`Vars: ${syncReport.replaced}✅ ${syncReport.unreplaced}❌`);
  if (report.schemaValidation) {
    parts.push(`Schema: ${report.schemaValidation.passed}✅ ${report.schemaValidation.failed}❌`);
  }
  if (report.patchValidation) {
    parts.push(`Patch: ${report.patchValidation.validOps}✅ ${report.patchValidation.invalidOps}❌`);
  }
  report.summary = parts.join(' | ');

  return report;
}

/**
 * Extract JSON objects from text content.
 * Handles both standalone JSON and JSON embedded in YAML/text.
 */
function extractJsonObjects(text: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];

  // Strategy 1: Try parsing the entire text as JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      objects.push(parsed);
      return objects;
    }
  } catch { /* not pure JSON */ }

  // Strategy 2: Find JSON objects within text using brace matching
  const regex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        objects.push(parsed);
      }
    } catch { /* not valid JSON */ }
  }

  return objects;
}

/* ═══════════════════════════════════════════════════════════════
   CROSS-CHECK VALIDATION — HTML ↔ Initvar Synchronization
   ═══════════════════════════════════════════════════════════════ */

export interface CrossCheckResult {
  valid: boolean;
  /** Variables referenced in HTML but NOT found in Initvar/Dictionary */
  orphanVars: { varName: string; source: string; context: string }[];
  /** Variables correctly matched between HTML and Initvar */
  matchedVars: string[];
  /** Suggestions for fixing orphan variables */
  suggestions: { orphan: string; closest: string; similarity: number }[];
  /** Summary */
  summary: string;
}

/**
 * Extract all variable names REFERENCED in HTML/Regex replaceString fields.
 * Scans 3 patterns: data-var attributes, {{getvar::}} macros, getvar() EJS calls.
 */
function extractHtmlVarReferences(htmlText: string): { varName: string; context: string }[] {
  const refs: { varName: string; context: string }[] = [];
  if (!htmlText) return refs;
  const seen = new Set<string>();

  // 1. data-var="KEY"
  const dataVarRegex = /data-var\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = dataVarRegex.exec(htmlText)) !== null) {
    const v = match[1].trim();
    if (v && !seen.has(v)) { seen.add(v); refs.push({ varName: v, context: `data-var="${v}"` }); }
  }

  // 2. {{getvar::KEY}} / {{setvar::KEY::}} / {{addvar::KEY}}
  const macroRegex = /\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/g;
  while ((match = macroRegex.exec(htmlText)) !== null) {
    const v = match[1].trim();
    if (v && !seen.has(v)) { seen.add(v); refs.push({ varName: v, context: match[0] }); }
  }

  // 3. getvar('KEY') / setvar('KEY', ...) / getVariable("KEY")
  const ejsRegex = /(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(\s*['"]([^'"]+)['"]/g;
  while ((match = ejsRegex.exec(htmlText)) !== null) {
    const fullKey = match[1].trim();
    // For dotted paths like stat_data.X.Y, extract each segment
    const segments = fullKey.split('.');
    for (const seg of segments) {
      if (seg && !seen.has(seg) && seg.length > 1 && !/^\d+$/.test(seg)) {
        seen.add(seg);
        refs.push({ varName: seg, context: match[0] });
      }
    }
  }

  return refs;
}

/**
 * Extract all variable names DEFINED in Initvar fields.
 * Scans YAML keys and {{setvar::KEY::VALUE}} macros.
 */
function extractInitvarDefinitions(initvarText: string): Set<string> {
  const defs = new Set<string>();
  if (!initvarText) return defs;

  // YAML keys: "key:" at start of line (with optional quotes)
  const yamlKeyRegex = /^\s*(?:["']([^"':\n]+)["']|([^"':\s\n][^"':\n]*[^"':\s\n]|[^"':\s\n]))\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = yamlKeyRegex.exec(initvarText)) !== null) {
    const key = (match[1] || match[2])?.trim();
    if (key && !key.startsWith('[') && !key.startsWith('<') && !key.startsWith('#') && !key.startsWith('{')) {
      defs.add(key);
    }
  }

  // {{setvar::KEY::VALUE}} macros
  const macroRegex = /\{\{setvar::([^:}]+)/g;
  while ((match = macroRegex.exec(initvarText)) !== null) {
    const key = match[1].trim();
    if (key) defs.add(key);
  }

  return defs;
}

/**
 * Simple string similarity (Dice coefficient) for suggesting closest matches.
 */
function diceCoefficient(a: string, b: string): number {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return 1;
  if (la.length < 2 || lb.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < la.length - 1; i++) {
    const bi = la.substring(i, i + 2);
    bigrams.set(bi, (bigrams.get(bi) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < lb.length - 1; i++) {
    const bi = lb.substring(i, i + 2);
    const count = bigrams.get(bi) || 0;
    if (count > 0) { intersection++; bigrams.set(bi, count - 1); }
  }
  return (2 * intersection) / (la.length - 1 + lb.length - 1);
}

/**
 * Cross-check: Scan ALL variable names REFERENCED in HTML (replaceString)
 * and verify each exists in the Initvar definitions or Dictionary.
 * 
 * This catches the most critical error: a variable used in the HTML dashboard
 * that doesn't exist in Initvar → will show "undefined" at runtime.
 *
 * @param regexFields - Translated replaceString fields from regex scripts
 * @param initvarFields - Translated initvar lorebook entries  
 * @param dictionary - MVU variable dictionary (original → translated)
 */
export function crossCheckHtmlVsInitvar(
  regexFields: { translated: string; label: string }[],
  initvarFields: { translated: string; label: string }[],
  dictionary: Record<string, string>
): CrossCheckResult {
  const result: CrossCheckResult = {
    valid: true,
    orphanVars: [],
    matchedVars: [],
    suggestions: [],
    summary: '',
  };

  // Build the complete set of known variable names
  const knownVars = new Set<string>();

  // From Initvar fields (translated)
  for (const field of initvarFields) {
    if (!field.translated) continue;
    const defs = extractInitvarDefinitions(field.translated);
    for (const d of defs) knownVars.add(d);
  }

  // From Dictionary values (translated names)
  for (const v of Object.values(dictionary)) {
    if (v) knownVars.add(v);
  }
  // Also add dictionary keys (original names) as they may still be valid
  for (const k of Object.keys(dictionary)) {
    if (k) knownVars.add(k);
  }

  // Noise filter: skip very short or generic names
  const isNoise = (v: string) => v.length < 2 || /^\d+$/.test(v);

  // Scan all HTML/regex fields for variable references
  const allHtmlRefs: { varName: string; source: string; context: string }[] = [];
  for (const field of regexFields) {
    if (!field.translated) continue;
    const refs = extractHtmlVarReferences(field.translated);
    for (const ref of refs) {
      if (!isNoise(ref.varName)) {
        allHtmlRefs.push({ ...ref, source: field.label });
      }
    }
  }

  // Cross-check each reference
  const matched = new Set<string>();
  for (const ref of allHtmlRefs) {
    if (knownVars.has(ref.varName)) {
      matched.add(ref.varName);
    } else {
      // Orphan — this variable won't resolve at runtime
      result.orphanVars.push({
        varName: ref.varName,
        source: ref.source,
        context: ref.context,
      });
      result.valid = false;

      // Find closest match for suggestion
      let bestMatch = '', bestScore = 0;
      for (const known of knownVars) {
        const score = diceCoefficient(ref.varName, known);
        if (score > bestScore && score > 0.4) {
          bestScore = score;
          bestMatch = known;
        }
      }
      if (bestMatch) {
        result.suggestions.push({ orphan: ref.varName, closest: bestMatch, similarity: bestScore });
      }
    }
  }

  result.matchedVars = [...matched];

  // Build summary
  const parts: string[] = [];
  parts.push(`${result.matchedVars.length} ✅ matched`);
  if (result.orphanVars.length > 0) parts.push(`${result.orphanVars.length} ❌ orphan`);
  result.summary = parts.join(' | ');

  return result;
}

/* ═══════════════════════════════════════════════════════════════
   findRegex ↔ Narrative Tag Consistency Check
   ═══════════════════════════════════════════════════════════════ */

export interface FindRegexValidationResult {
  valid: boolean;
  /** Tags found in findRegex but NOT in any narrative field */
  missingTags: { tag: string; regexLabel: string }[];
  /** Tags that matched correctly */
  matchedTags: { tag: string; regexLabel: string; foundIn: string }[];
  /** Summary */
  summary: string;
}

/**
 * Validate that custom XML tags in findRegex (translated) actually exist
 * in narrative fields (first_mes, description, etc).
 * 
 * If findRegex uses `<Trạng thái>(.*?)</Trạng thái>` but no narrative field
 * contains `<Trạng thái>`, the regex will never match → dashboard won't display.
 *
 * @param regexFields - Translated regex entries with findRegex content
 * @param narrativeFields - Translated narrative fields to search for matching tags
 */
export function validateFindRegexVsNarrative(
  regexFields: { findRegex: string; label: string }[],
  narrativeFields: { translated: string; label: string }[]
): FindRegexValidationResult {
  const result: FindRegexValidationResult = {
    valid: true,
    missingTags: [],
    matchedTags: [],
    summary: '',
  };

  // Concatenate all narrative text for searching
  const allNarrative = narrativeFields
    .filter(f => f.translated)
    .map(f => ({ text: f.translated, label: f.label }));

  for (const regex of regexFields) {
    if (!regex.findRegex) continue;

    // Extract custom XML-like tags: <TagName> patterns
    // Matches tags like <Trạng thái>, <Stats>, etc. but NOT standard HTML
    const standardHtml = new Set([
      'div', 'span', 'p', 'br', 'hr', 'a', 'b', 'i', 'u', 'em', 'strong',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr',
      'td', 'th', 'thead', 'tbody', 'img', 'input', 'button', 'form', 'select',
      'option', 'textarea', 'label', 'style', 'script', 'link', 'meta', 'head',
      'body', 'html', 'section', 'article', 'nav', 'header', 'footer', 'main',
      'aside', 'details', 'summary', 'figure', 'figcaption', 'pre', 'code',
      'blockquote', 'small', 'sub', 'sup', 'mark', 'del', 'ins',
    ]);

    // Match opening tags in the findRegex pattern
    const tagRegex = /<([^\/\s>!?][^>]*?)>/g;
    let match: RegExpExecArray | null;
    const seenTags = new Set<string>();

    while ((match = tagRegex.exec(regex.findRegex)) !== null) {
      let tagName = match[1].trim();
      // Remove regex quantifiers/groups that might be captured
      tagName = tagName.replace(/[\\()+*?{}[\]|$.^]/g, '').trim();
      if (!tagName || tagName.length < 2) continue;

      const tagLower = tagName.toLowerCase();
      if (standardHtml.has(tagLower)) continue;
      if (seenTags.has(tagName)) continue;
      seenTags.add(tagName);

      // Search for this tag in narrative fields
      let found = false;
      for (const narr of allNarrative) {
        if (narr.text.includes(`<${tagName}>`)) {
          result.matchedTags.push({ tag: tagName, regexLabel: regex.label, foundIn: narr.label });
          found = true;
          break;
        }
      }

      if (!found) {
        result.missingTags.push({ tag: tagName, regexLabel: regex.label });
        result.valid = false;
      }
    }
  }

  // Build summary
  const parts: string[] = [];
  if (result.matchedTags.length > 0) parts.push(`${result.matchedTags.length} ✅`);
  if (result.missingTags.length > 0) parts.push(`${result.missingTags.length} ❌ missing`);
  result.summary = parts.join(' | ') || 'No custom tags found';

  return result;
}

/* ═══════════════════════════════════════════════════════════════
   EJS Entry Name ↔ Narrative Text Synchronization
   ═══════════════════════════════════════════════════════════════ */

export interface EntryNameSyncResult {
  valid: boolean;
  /** Entry names found in narrative text (correctly synchronized) */
  matchedNames: { originalName: string; translatedName: string; foundIn: string }[];
  /** Entry names NOT found in narrative text (EJS will fail) */
  missingNames: { originalName: string; translatedName: string; appearedInOriginal: string }[];
  /** Suggestions for fixing missing names */
  suggestions: { missingName: string; closest: string; similarity: number }[];
  /** Summary */
  summary: string;
}

/**
 * Build entry name dictionary from translated lorebook name fields.
 * Maps original entry name → translated entry name.
 * 
 * This dictionary is used for:
 * 1. Validation: checking translated names appear in narrative text
 * 2. Prompt injection: telling AI to use exact translated names
 * 3. Auto-fix: replacing original names in narrative text with translations
 */
export function buildEntryNameDictionary(
  fields: { path: string; original: string; translated: string; status: string }[]
): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const f of fields) {
    // Match lorebook[N].name fields
    if (
      f.status === 'done' &&
      f.translated &&
      f.translated.trim() &&
      /\.name$/.test(f.path) &&
      f.path.includes('character_book.entries[')
    ) {
      const orig = f.original.trim();
      const trans = f.translated.trim();
      // Only add if the name actually changed (was translated)
      if (orig && trans && orig !== trans) {
        dict[orig] = trans;
      }
    }
  }
  return dict;
}

/**
 * Validate that translated lorebook entry names appear in translated narrative text.
 * 
 * SillyTavern auto-loads lorebook entries when their EXACT NAME appears in
 * the main text (including EJS-rendered output). If a translated entry name
 * doesn't appear in the translated narrative, the entry will never be
 * triggered → card breaks.
 *
 * @param fields - All translation fields with their original and translated content
 */
export function validateEntryNameSync(
  fields: { path: string; label: string; group: string; original: string; translated: string; status: string }[]
): EntryNameSyncResult {
  const result: EntryNameSyncResult = {
    valid: true,
    matchedNames: [],
    missingNames: [],
    suggestions: [],
    summary: '',
  };

  // 1. Build entry name dictionary from lorebook name fields
  const entryNameDict = buildEntryNameDictionary(fields);
  const entryNames = Object.entries(entryNameDict);
  if (entryNames.length === 0) {
    result.summary = 'No translated entry names found';
    return result;
  }

  // 2. Collect all narrative text (original and translated)
  const narrativeGroups = new Set(['core', 'messages', 'system', 'depth_prompt', 'lorebook']);
  const narrativeOriginals: { text: string; label: string }[] = [];
  const narrativeTranslated: { text: string; label: string }[] = [];

  for (const f of fields) {
    if (!narrativeGroups.has(f.group)) continue;
    // Skip the name fields themselves and key fields
    if (f.path.endsWith('.name') && f.path.includes('character_book.entries[')) continue;
    if (f.path.endsWith('.keys') || f.path.endsWith('.secondary_keys')) continue;
    // Skip comment fields — they're metadata, not narrative
    if (f.path.endsWith('.comment')) continue;

    if (f.original && f.original.trim()) {
      narrativeOriginals.push({ text: f.original, label: f.label });
    }
    if (f.status === 'done' && f.translated && f.translated.trim()) {
      narrativeTranslated.push({ text: f.translated, label: f.label });
    }
  }

  // Concatenate all narrative text for faster searching
  const allOriginalText = narrativeOriginals.map(n => n.text).join('\n');
  const allTranslatedText = narrativeTranslated.map(n => n.text).join('\n');

  // 3. For each entry name: check if it appears in narrative text
  for (const [originalName, translatedName] of entryNames) {
    // Only check entries whose original name appears in the original narrative text
    if (!allOriginalText.includes(originalName)) continue;

    // Check if translated name appears in translated narrative text
    if (allTranslatedText.includes(translatedName)) {
      // Find which field it was found in
      const foundIn = narrativeTranslated.find(n => n.text.includes(translatedName))?.label || 'unknown';
      result.matchedNames.push({ originalName, translatedName, foundIn });
    } else {
      // Find which original field contained the original name
      const appearedIn = narrativeOriginals.find(n => n.text.includes(originalName))?.label || 'unknown';
      result.missingNames.push({
        originalName,
        translatedName,
        appearedInOriginal: appearedIn,
      });
      result.valid = false;

      // Try to find closest match in translated text for suggestion
      // Check if a partial or similar name exists
      const words = translatedName.split(/\s+/);
      if (words.length > 1) {
        // Try finding individual words
        const foundWords = words.filter(w => w.length > 1 && allTranslatedText.includes(w));
        if (foundWords.length > 0) {
          result.suggestions.push({
            missingName: translatedName,
            closest: `Partial match: "${foundWords.join(', ')}" found in text`,
            similarity: foundWords.length / words.length,
          });
        }
      }
    }
  }

  // 4. Build summary
  const parts: string[] = [];
  if (result.matchedNames.length > 0) parts.push(`${result.matchedNames.length} ✅ synced`);
  if (result.missingNames.length > 0) parts.push(`${result.missingNames.length} ❌ missing`);
  result.summary = parts.join(' | ') || 'No entry names in narrative text';

  return result;
}

/**
 * Auto-fix: replace original entry names still present in translated narrative text
 * with their translated equivalents from the entry name dictionary.
 * 
 * Use this when validation detects that original names weren't replaced in narrative text.
 */
export function autoFixEntryNames(
  translatedText: string,
  entryNameDict: Record<string, string>
): string {
  if (!translatedText || Object.keys(entryNameDict).length === 0) return translatedText;

  let fixed = translatedText;
  // Sort by length descending to avoid partial replacements
  const sortedEntries = Object.entries(entryNameDict)
    .filter(([k, v]) => k && v && k !== v)
    .sort(([a], [b]) => b.length - a.length);

  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeReplacement = (str: string) => str.replace(/\$/g, '$$$$');

  for (const [originalName, translatedName] of sortedEntries) {
    if (!fixed.includes(originalName)) continue;
    const regex = new RegExp(escapeRegExp(originalName), 'g');
    fixed = fixed.replace(regex, safeReplacement(translatedName));
  }

  return fixed;
}
