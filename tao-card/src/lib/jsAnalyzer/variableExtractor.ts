/**
 * src/lib/jsAnalyzer/variableExtractor.ts — Extract variable accesses from JS scripts
 * Spec 8C.2-8C.3: Detect this.variables reads/writes + getvar() calls
 * Uses regex-based extraction (no AST dependency) for browser use
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface VariableAccess {
  path: string;           // "this.variables.Người_Chơi.HP" or "stat_data.X.Y"
  jsonPointer: string;    // "/Người_Chơi/HP"
  operation: 'read' | 'write';
  line: number;
  source: 'this.variables' | 'getvar' | 'setvar';
}

export interface ScriptAnalysis {
  accesses: VariableAccess[];
  errors: string[];
  warnings: string[];
  imports: string[];
  functionCalls: string[];
}

export interface LinkedAccess {
  access: VariableAccess;
  schemaField: MVUZODField | null;
  issue?: string;
  suggestion?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT ANALYZER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze a TavernHelper JS script for variable accesses and potential issues.
 */
export function analyzeScript(code: string): ScriptAnalysis {
  const accesses: VariableAccess[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const imports: string[] = [];
  const functionCalls: string[] = [];
  const lines = code.split('\n');

  // Check for basic JS syntax issues
  const openBraces = (code.match(/{/g) ?? []).length;
  const closeBraces = (code.match(/}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Braces không cân: ${openBraces} mở, ${closeBraces} đóng`);
  }

  const openParens = (code.match(/\(/g) ?? []).length;
  const closeParens = (code.match(/\)/g) ?? []).length;
  if (openParens !== closeParens) {
    errors.push(`Parentheses không cân: ${openParens} mở, ${closeParens} đóng`);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ─── Extract imports ─────────────────────────────────────────
    const importMatch = line.match(/import\s+(?:.*\s+from\s+)?['"](.+)['"]/);
    if (importMatch) imports.push(importMatch[1]);

    // ─── Extract this.variables accesses ─────────────────────────
    // Write: this.variables.X.Y = ...
    const writeMatches = line.matchAll(/this\.variables\.([\w.\u00C0-\u024F\u1E00-\u1EFF]+)\s*=/g);
    for (const m of writeMatches) {
      accesses.push({
        path: `this.variables.${m[1]}`,
        jsonPointer: '/' + m[1].replace(/\./g, '/'),
        operation: 'write',
        line: lineNum,
        source: 'this.variables',
      });
    }

    // Read: ...this.variables.X.Y (not followed by =)
    const readMatches = line.matchAll(/this\.variables\.([\w.\u00C0-\u024F\u1E00-\u1EFF]+)(?!\s*=)/g);
    for (const m of readMatches) {
      accesses.push({
        path: `this.variables.${m[1]}`,
        jsonPointer: '/' + m[1].replace(/\./g, '/'),
        operation: 'read',
        line: lineNum,
        source: 'this.variables',
      });
    }

    // ─── Extract getvar() calls ──────────────────────────────────
    const getvarMatches = line.matchAll(/getvar\(\s*['"]([^'"]+)['"]/g);
    for (const m of getvarMatches) {
      const path = m[1];
      const pointer = path.startsWith('stat_data.')
        ? '/' + path.replace('stat_data.', '').replace(/\./g, '/')
        : '/' + path.replace(/\./g, '/');
      accesses.push({
        path,
        jsonPointer: pointer,
        operation: 'read',
        line: lineNum,
        source: 'getvar',
      });
    }

    // ─── Extract setvar() calls (write) ──────────────────────────
    const setvarMatches = line.matchAll(/setvar\(\s*['"]([^'"]+)['"]/g);
    for (const m of setvarMatches) {
      const path = m[1];
      const pointer = path.startsWith('stat_data.')
        ? '/' + path.replace('stat_data.', '').replace(/\./g, '/')
        : '/' + path.replace(/\./g, '/');
      accesses.push({
        path,
        jsonPointer: pointer,
        operation: 'write',
        line: lineNum,
        source: 'setvar',
      });
    }

    // ─── Extract function calls ──────────────────────────────────
    const fnMatches = line.matchAll(/\b(registerMvuSchema|on|activateEntry|setEntryContent|setEntryEnabled|getChatMessages)\s*\(/g);
    for (const m of fnMatches) {
      if (!functionCalls.includes(m[1])) functionCalls.push(m[1]);
    }
  }

  // Deduplicate accesses
  const seen = new Map<string, VariableAccess>();
  for (const a of accesses) {
    const key = `${a.jsonPointer}:${a.operation}:${a.source}`;
    if (!seen.has(key)) seen.set(key, a);
  }

  // Warnings
  if (code.includes('eval(')) warnings.push('Sử dụng eval() — có thể gây bảo mật');
  if (code.includes('document.') || code.includes('window.')) {
    warnings.push('Truy cập DOM/window — TavernHelper scripts chạy trong sandbox');
  }

  return {
    accesses: [...seen.values()],
    errors,
    warnings,
    imports,
    functionCalls,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA LINKER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Link variable accesses to schema fields.
 * Detects: missing fields, readOnly violations, unused fields.
 */
export function linkToSchema(
  accesses: VariableAccess[],
  schema: MVUZODSchema,
): LinkedAccess[] {
  const flat = flattenFields(schema.fields);
  const byPointer = new Map(flat.map(f => [f.path, f]));

  return accesses.map(a => {
    const field = byPointer.get(a.jsonPointer) ?? null;
    let issue: string | undefined;
    let suggestion: string | undefined;

    if (!field) {
      issue = 'missing_from_schema';
      suggestion = `Thêm field "${a.jsonPointer}" vào MVUZOD Schema`;
    } else if (a.operation === 'write' && field.constraints?.readOnly) {
      issue = 'read_only_but_written';
      suggestion = `Field "${a.jsonPointer}" là readOnly — không nên ghi`;
    }

    return { access: a, schemaField: field, issue, suggestion };
  });
}

/**
 * Find schema fields not accessed by any script.
 */
export function findUnusedFields(
  accesses: VariableAccess[],
  schema: MVUZODSchema,
): MVUZODField[] {
  const flat = flattenFields(schema.fields).filter(f => !f.children?.length);
  const usedPaths = new Set(accesses.map(a => a.jsonPointer));
  return flat.filter(f => !usedPaths.has(f.path));
}

/**
 * Build context injection for AI Copilot.
 */
export function buildScriptContext(
  scriptName: string,
  code: string,
  schema: MVUZODSchema,
): string {
  const analysis = analyzeScript(code);
  const linked = linkToSchema(analysis.accesses, schema);
  const issues = linked.filter(l => l.issue);
  const reads = analysis.accesses.filter(a => a.operation === 'read');
  const writes = analysis.accesses.filter(a => a.operation === 'write');

  return `=== PHÂN TÍCH JS SCRIPT: "${scriptName}" ===
Biến ĐỌC: ${reads.map(a => a.jsonPointer).join(', ') || 'không có'}
Biến GHI: ${writes.map(a => a.jsonPointer).join(', ') || 'không có'}
Vấn đề: ${issues.length > 0 ? issues.map(i => `${i.access.jsonPointer}: ${i.issue}`).join('; ') : 'không có'}
${analysis.errors.length > 0 ? `Lỗi parse: ${analysis.errors.join('; ')}` : ''}`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function flattenFields(fields: MVUZODField[], prefix = ''): MVUZODField[] {
  const result: MVUZODField[] = [];
  for (const f of fields) {
    const path = prefix + f.path;
    result.push({ ...f, path });
    if (f.children) result.push(...flattenFields(f.children, path));
  }
  return result;
}
