/**
 * Zod Schema Engine — MVU-ZOD Architecture
 * 
 * Extracts, parses, and validates Zod schemas from card TavernHelper scripts.
 * Uses pattern matching (NOT eval) for security — never executes card code.
 */

import { z } from 'zod';
import type { CharacterCard } from '../types/card';
import type {
  DetectedZodSchema, ZodFieldDef, ZodFieldType, ZodConstraints,
  SchemaTranslationResult,
} from '../types/mvuZodTypes';

/* ═══════════════════════════════════════════════════════════════
   EXTRACT — Find z.object({...}) blocks in TavernHelper scripts
   ═══════════════════════════════════════════════════════════════ */

/**
 * Scan all TavernHelper scripts in a card and extract Zod schema source blocks.
 */
export function extractZodSchemas(card: CharacterCard): DetectedZodSchema[] {
  const schemas: DetectedZodSchema[] = [];
  const data = card.data;
  if (!data) return schemas;

  const allScripts: { content: string; index: number }[] = [];

  // TavernHelper — support all formats
  const thRaw = data.extensions?.tavern_helper as any;
  if (Array.isArray(thRaw)) {
    // Tuple format: [ ["scripts", [{content:...}, ...]] ]
    for (const item of thRaw) {
      if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
        (item[1] as any[]).forEach((s: any, i: number) => { if (s?.content) allScripts.push({ content: s.content, index: i }); });
      } else if (item && typeof item === 'object' && !Array.isArray(item) && (item as any).content) {
        allScripts.push({ content: (item as any).content, index: allScripts.length });
      }
    }
  } else if (thRaw?.scripts && Array.isArray(thRaw.scripts)) {
    // V2 object format: { scripts: [...] }
    thRaw.scripts.forEach((s: any, i: number) => { if (s.content) allScripts.push({ content: s.content, index: i }); });
  }
  // Legacy TavernHelper
  const legacy = data.extensions?.TavernHelper_scripts as { content: string }[] | undefined;
  if (Array.isArray(legacy)) {
    legacy.forEach((s, i) => { if (s.content) allScripts.push({ content: s.content, index: 1000 + i }); });
  }

  // Regex Scripts
  const regexScripts = data.extensions?.regex_scripts as { replaceString?: string }[] | undefined;
  if (Array.isArray(regexScripts)) {
    regexScripts.forEach((s, i) => { if (s.replaceString) allScripts.push({ content: s.replaceString, index: 2000 + i }); });
  }

  // Lorebook / Worldbook Entries
  const entries = data.character_book?.entries;
  if (Array.isArray(entries)) {
    entries.forEach((e, i) => { if (e.content) allScripts.push({ content: e.content, index: 3000 + i }); });
  }

  for (const script of allScripts) {
    // Find z.object({...}) blocks using balanced brace matching
    const objectBlocks = extractZodObjectBlocks(script.content);
    for (const block of objectBlocks) {
      try {
        const fields = parseZodFields(block);
        schemas.push({
          rawSource: block,
          fields,
          scriptIndex: script.index,
          compiled: true,
        });
      } catch (err) {
        schemas.push({
          rawSource: block,
          fields: [],
          scriptIndex: script.index,
          compiled: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return schemas;
}

/**
 * Extract z.object({...}) source blocks using balanced brace matching.
 */
export function extractZodObjectBlocks(source: string): string[] {
  const blocks: string[] = [];
  const regex = /(?:z|Zod)\.object\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    // Handle the opening { inside the (
    while (i < source.length && source[i] !== '{') i++;
    if (i >= source.length) continue;
    i++; // skip {
    const bodyStart = i;
    depth = 1;

    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      // Skip string literals
      if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
        const quote = source[i];
        i++;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === '\\') i++; // skip escaped
          i++;
        }
      }
      i++;
    }

    if (depth === 0) {
      const bodyEnd = i - 1; // before closing }
      blocks.push(source.slice(bodyStart, bodyEnd));
    }
  }

  return blocks;
}

/* ═══════════════════════════════════════════════════════════════
   PARSE — Convert raw Zod source text into ZodFieldDef[]
   ═══════════════════════════════════════════════════════════════ */

/**
 * Parse a Zod object body into field definitions.
 * Handles: z.string(), z.number(), z.boolean(), z.enum([...]),
 *          z.array(), z.object(), .optional(), .nullable(),
 *          .default(), .describe(), .min(), .max()
 */
export function parseZodFields(objectBody: string): ZodFieldDef[] {
  const fields: ZodFieldDef[] = [];

  // Match field patterns: key: z.type(...)...
  // Supports both unquoted and quoted keys
  const fieldRegex = /(?:["']([^"']+)["']|(\w[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]*(?:\s+\w[\w\u4e00-\u9fff]*)*))[\s]*:[\s]*(z\.[^\n,]+?)(?=,\s*(?:["']\w|[\w\u4e00-\u9fff][\w\u4e00-\u9fff]*\s*:)|,?\s*$)/gm;

  // Simpler line-by-line approach for reliability
  const lines = objectBody.split('\n');
  const mergedLines: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    // Detect if this line starts a new field (key: z.something)
    const newFieldMatch = /^(?:["'][^"']+["']|[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+)\s*:\s*(?:z|Zod)\./.test(trimmed);
    
    if (newFieldMatch) {
      mergedLines.push(trimmed);
    } else if (mergedLines.length > 0) {
      // It's a continuation of the previous field (e.g. .describe("..."))
      mergedLines[mergedLines.length - 1] += ' ' + trimmed;
    }
  }

  for (const line of mergedLines) {
    // Match: key: z.something(...)
    // Using (?:z|Zod)\. to support alternative import names
    const lineMatch = line.match(
      /^(?:["']([^"']+)["']|([\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+))\s*:\s*((?:z|Zod)\..+?)(?:,\s*(?:\/\/.*)?)?$/
    );
    if (!lineMatch) continue;

    const name = lineMatch[1] || lineMatch[2];
    const zodExpr = lineMatch[3];
    if (!name || !zodExpr) continue;

    try {
      const field = parseZodExpression(name, zodExpr);
      fields.push(field);
    } catch {
      // Best-effort: add as unknown type
      fields.push({
        name,
        type: 'unknown',
        isOptional: zodExpr.includes('.optional()'),
        isNullable: zodExpr.includes('.nullable()'),
        description: extractDescribe(zodExpr),
      });
    }
  }

  return fields;
}

/**
 * Parse a single Zod expression chain like "z.string().min(1).describe('...')"
 */
function parseZodExpression(name: string, expr: string): ZodFieldDef {
  const field: ZodFieldDef = {
    name,
    type: 'unknown',
    isOptional: false,
    isNullable: false,
  };

  // Detect base type
  if (/^(?:z|Zod)\.string\b/.test(expr)) field.type = 'string';
  else if (/^(?:z|Zod)\.number\b/.test(expr)) field.type = 'number';
  else if (/^(?:z|Zod)\.boolean\b/.test(expr)) field.type = 'boolean';
  else if (/^(?:z|Zod)\.enum\b/.test(expr)) {
    field.type = 'enum';
    const enumMatch = expr.match(/(?:z|Zod)\.enum\(\s*\[([^\]]+)\]/);
    if (enumMatch) {
      field.constraints = {
        enumValues: enumMatch[1].split(',').map(v => v.trim().replace(/^["']|["']$/g, '')),
      };
    }
  }
  else if (/^(?:z|Zod)\.literal\b/.test(expr)) {
    field.type = 'literal';
    const litMatch = expr.match(/(?:z|Zod)\.literal\(\s*(.+?)\s*\)/);
    if (litMatch) {
      field.constraints = { literalValue: parseLiteralValue(litMatch[1]) };
    }
  }
  else if (/^(?:z|Zod)\.array\b/.test(expr)) {
    field.type = 'array';
    const itemMatch = expr.match(/(?:z|Zod)\.array\(\s*(?:z|Zod)\.(\w+)/);
    if (itemMatch) {
      field.constraints = { arrayItemType: itemMatch[1] as ZodFieldType };
    }
  }
  else if (/^(?:z|Zod)\.object\b/.test(expr)) {
    field.type = 'object';
    // Nested objects: extract body and recurse
    const bodyMatch = expr.match(/(?:z|Zod)\.object\(\s*\{([\s\S]*)\}\s*\)/);
    if (bodyMatch) {
      field.children = parseZodFields(bodyMatch[1]);
    }
  }
  else if (/^(?:z|Zod)\.union\b/.test(expr)) field.type = 'union';

  // Chain modifiers
  field.isOptional = expr.includes('.optional()');
  field.isNullable = expr.includes('.nullable()');
  field.description = extractDescribe(expr);

  // Constraints
  const minMatch = expr.match(/\.min\(\s*(\d+)\s*\)/);
  const maxMatch = expr.match(/\.max\(\s*(\d+)\s*\)/);
  if (minMatch || maxMatch) {
    field.constraints = {
      ...field.constraints,
      ...(minMatch ? { min: parseInt(minMatch[1]) } : {}),
      ...(maxMatch ? { max: parseInt(maxMatch[1]) } : {}),
    };
  }

  // Default value
  const defaultMatch = expr.match(/\.default\(\s*(.+?)\s*\)/);
  if (defaultMatch) {
    field.defaultValue = parseLiteralValue(defaultMatch[1]);
  }

  return field;
}

/** Extract .describe('...') value */
function extractDescribe(expr: string): string | undefined {
  const match = expr.match(/\.describe\(\s*["'`]([^"'`]+)["'`]\s*\)/);
  return match ? match[1] : undefined;
}

/** Parse a JS literal value string */
function parseLiteralValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  if (/^["'`](.*)["'`]$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

/* ═══════════════════════════════════════════════════════════════
   BUILD — Construct runtime Zod schema from parsed fields
   ═══════════════════════════════════════════════════════════════ */

/**
 * Build an actual z.ZodObject from parsed field definitions.
 * Used for runtime validation of AI output.
 */
export function buildRuntimeSchema(fields: ZodFieldDef[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let zodType = buildFieldType(field);
    if (field.isNullable) zodType = zodType.nullable();
    if (field.isOptional) zodType = zodType.optional();
    shape[field.translatedName || field.name] = zodType;
  }

  return z.object(shape);
}

function buildFieldType(field: ZodFieldDef): z.ZodTypeAny {
  switch (field.type) {
    case 'string': {
      let s = z.string();
      if (field.constraints?.min !== undefined) s = s.min(field.constraints.min);
      if (field.constraints?.max !== undefined) s = s.max(field.constraints.max);
      return s;
    }
    case 'number': {
      let n = z.number();
      if (field.constraints?.min !== undefined) n = n.min(field.constraints.min);
      if (field.constraints?.max !== undefined) n = n.max(field.constraints.max);
      return n;
    }
    case 'boolean':
      return z.boolean();
    case 'enum':
      if (field.constraints?.enumValues && field.constraints.enumValues.length > 0) {
        return z.enum(field.constraints.enumValues as [string, ...string[]]);
      }
      return z.string();
    case 'array':
      return z.array(z.unknown());
    case 'object':
      if (field.children && field.children.length > 0) {
        return buildRuntimeSchema(field.children);
      }
      return z.record(z.string(), z.unknown());
    case 'literal':
      if (field.constraints?.literalValue !== undefined) {
        return z.literal(field.constraints.literalValue as string);
      }
      return z.unknown();
    default:
      return z.unknown();
  }
}

/* ═══════════════════════════════════════════════════════════════
   VALIDATE — Check a state object against a compiled schema
   ═══════════════════════════════════════════════════════════════ */

export interface ZodValidationResult {
  valid: boolean;
  errors: { field: string; expected: string; received: string }[];
}

/**
 * Validate a JSON state object against a compiled Zod schema.
 */
export function validateStateAgainstSchema(
  state: Record<string, unknown>,
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>
): ZodValidationResult {
  const result = schema.safeParse(state);
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map(issue => ({
    field: issue.path.join('.'),
    expected: issue.message,
    received: String((state as any)[issue.path[0]] ?? 'undefined'),
  }));

  return { valid: false, errors };
}

/* ═══════════════════════════════════════════════════════════════
   TRANSLATE — Apply dictionary to schema field names
   ═══════════════════════════════════════════════════════════════ */

/**
 * Translate Zod schema field names using the MVU dictionary.
 * Returns both translated source code and the field mapping.
 */
export function translateSchemaFields(
  schema: DetectedZodSchema,
  dictionary: Record<string, string>
): SchemaTranslationResult {
  const fieldMapping: Record<string, string> = {};
  const unmappedFields: string[] = [];
  let translatedSource = schema.rawSource;

  // Sort by length descending to avoid partial replacements
  const entries = Object.entries(dictionary)
    .filter(([k, v]) => k && v && k !== v)
    .sort((a, b) => b[0].length - a[0].length);

  for (const field of schema.fields) {
    const translated = dictionary[field.name];
    if (translated && translated !== field.name) {
      fieldMapping[field.name] = translated;
      field.translatedName = translated;

      // Replace in source — both quoted and unquoted keys
      const escaped = field.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      translatedSource = translatedSource.replace(
        new RegExp(`(["']?)${escaped}(["']?)(\\s*:)`, 'g'),
        `$1${translated}$2$3`
      );
    } else if (!translated) {
      unmappedFields.push(field.name);
    }
  }

  return {
    originalSource: schema.rawSource,
    translatedSource,
    fieldMapping,
    unmappedFields,
  };
}

/**
 * Get all unique field names across all schemas in a card.
 */
export function getAllSchemaFieldNames(schemas: DetectedZodSchema[]): string[] {
  const names = new Set<string>();
  const collectFields = (fields: ZodFieldDef[]) => {
    for (const f of fields) {
      names.add(f.name);
      if (f.children) collectFields(f.children);
    }
  };
  for (const schema of schemas) collectFields(schema.fields);
  return [...names];
}
