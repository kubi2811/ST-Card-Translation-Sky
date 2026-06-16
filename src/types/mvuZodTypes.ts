/**
 * MVU-ZOD Architecture Types
 * Zod schema validation + JSON Patch (RFC 6902) support.
 */

/* ─── Zod Schema Detection ─── */

export interface DetectedZodSchema {
  rawSource: string;
  fields: ZodFieldDef[];
  scriptIndex: number;
  compiled: boolean;
  error?: string;
}

export interface ZodFieldDef {
  name: string;
  translatedName?: string;
  type: ZodFieldType;
  description?: string;
  defaultValue?: unknown;
  constraints?: ZodConstraints;
  isOptional: boolean;
  isNullable: boolean;
  children?: ZodFieldDef[];
}

export type ZodFieldType =
  | 'string' | 'number' | 'boolean' | 'enum'
  | 'array' | 'object' | 'record' | 'literal' | 'union' | 'unknown';

export interface ZodConstraints {
  min?: number;
  max?: number;
  enumValues?: string[];
  pattern?: string;
  literalValue?: unknown;
  arrayItemType?: ZodFieldType;
}

/* ─── JSON Patch (RFC 6902) ─── */

export interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace' | 'test' | 'move' | 'copy';
  path: string;
  value?: unknown;
  from?: string;
}

export interface PatchValidationResult {
  valid: boolean;
  validOps: JsonPatchOp[];
  invalidOps: { op: JsonPatchOp; reason: string }[];
  referencedFields: string[];
  warnings: string[];
}

export interface PatchApplyResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  changes: { path: string; from?: unknown; to?: unknown; op: string }[];
}

/* ─── Enhanced MVU Summary ─── */

export interface MvuZodSummary {
  isMvu: boolean;
  hasZodSchema: boolean;
  initvarCount: number;
  variableCount: number;
  regexDashboard: boolean;
  confidence: number;
  reasons: string[];
  zodSchemas: DetectedZodSchema[];
  jsonPatchEntries: number;
  zodFieldCount: number;
  schemaVersion?: string;
  supportsStructuredOutput: boolean;
}

export interface SchemaTranslationResult {
  originalSource: string;
  translatedSource: string;
  fieldMapping: Record<string, string>;
  unmappedFields: string[];
}

export interface MvuZodValidationReport {
  valid: boolean;
  variableSync: { replaced: number; unreplaced: number; warnings: string[] };
  schemaValidation?: {
    schemasChecked: number;
    passed: number;
    failed: number;
    errors: { field: string; expected: string; received: string }[];
  };
  patchValidation?: {
    totalOps: number;
    validOps: number;
    invalidOps: number;
    errors: { path: string; reason: string }[];
  };
  summary: string;
}
