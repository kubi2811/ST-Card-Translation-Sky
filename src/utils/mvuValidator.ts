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
  const originalMacros = (original.match(/\{\{(?:getvar|setvar|addvar)::([^}]+)\}\}/g) || []).length;
  const translatedMacros = (translated.match(/\{\{(?:getvar|setvar|addvar)::([^}]+)\}\}/g) || []).length;
  if (originalMacros > 0 && translatedMacros === 0) {
    result.warnings.push(`All ${originalMacros} macros disappeared from translation`);
    result.valid = false;
  } else if (Math.abs(originalMacros - translatedMacros) > 2) {
    result.warnings.push(`Macro count changed significantly: ${originalMacros} → ${translatedMacros}`);
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

  for (const key of sortedKeys) {
    const replacement = dictionary[key];
    if (!replacement || key === replacement) continue;

    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Replace in macros specifically FIRST
    // This catches {{getvar::key}} and {{setvar::key::val}} specifically
    const macroRegex = new RegExp(`(\\{\\{(?:getvar|setvar|addvar)::)${escaped}(\\}\\}|::)`, 'g');
    fixed = fixed.replace(macroRegex, `$1${replacement}$2`);

    // Replace standalone occurrences
    const isAscii = /^[a-zA-Z0-9_]+$/.test(key);
    const regex = isAscii
      ? new RegExp(`\\b${escaped}\\b`, 'g')
      : new RegExp(escaped, 'g');

    fixed = fixed.replace(regex, replacement);
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
  const macros = translated.match(/\{\{(?:getvar|setvar|addvar)::([^}]+?)(?:\}\}|::)/g) || [];
  
  for (const macro of macros) {
    // Extract the variable name
    const match = macro.match(/\{\{(?:getvar|setvar|addvar)::([^}]+?)(?:\}\}|::)/);
    if (!match) continue;
    
    const varName = match[1];
    
    // Check if the varName is an ORIGINAL key in the dictionary that should have been translated
    if (dictionary[varName] && dictionary[varName] !== varName) {
      errors.push(`Macro ${macro} uses original key "${varName}" instead of translated "${dictionary[varName]}"`);
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
