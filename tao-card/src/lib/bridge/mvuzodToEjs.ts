/**
 * src/lib/bridge/mvuzodToEjs.ts — Auto-generate EJS Templates from MVUZOD Schema
 *
 * Generates 4 types of EJS templates:
 * 1. Multi-phase Persona — Changes AI behavior based on numeric variable thresholds
 * 2. Variable Display — Shows current variable state in prompt
 * 3. Conditional Worldbook Controller — Kích hoạt entry (đang tắt) theo biến boolean/string
 * 4. Inject Prompt — Dynamic prompt injection based on variable values
 *
 * All generated templates use the `getvar('stat_data.X')` pattern
 * compatible with SillyTavern @@preprocessing pipeline.
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { activationLine } from '../ejs/stptApi';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EJSTemplateType = 'multi_phase' | 'variable_display' | 'conditional_wb' | 'inject_prompt';

export interface GeneratedEJSTemplate {
  /** Template type identifier */
  type: EJSTemplateType;
  /** Human-readable name */
  name: string;
  /** Description of what this template does */
  description: string;
  /** The generated EJS code */
  code: string;
  /** Which fields were used */
  fieldPaths: string[];
  /** Recommended worldbook entry settings */
  entryConfig: {
    comment: string;
    constant: boolean;
    position: 'before_char' | 'after_char';
    depth?: number;
    role?: 'system' | 'user' | null;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIELD HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getLeafFields(fields: MVUZODField[], prefix = ''): Array<MVUZODField & { dotPath: string; varName: string }> {
  const result: Array<MVUZODField & { dotPath: string; varName: string }> = [];
  for (const field of fields) {
    const name = field.path.split('/').filter(Boolean).pop() ?? field.path;
    const dotPath = prefix ? `${prefix}.${name}` : name;
    if (field.children?.length) {
      result.push(...getLeafFields(field.children, dotPath));
    } else {
      const varName = '_' + dotPath.replace(/[.\s/]/g, '_').replace(/[^\w\u00C0-\u024F\u1E00-\u1EFF]/g, '');
      result.push({ ...field, dotPath, varName });
    }
  }
  return result;
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE 1: MULTI-PHASE PERSONA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate multi-phase persona template from a numeric field.
 * Creates if/else branches based on thresholds.
 */
export function generateMultiPhasePersona(
  schema: MVUZODSchema,
  fieldPath?: string,
  options: {
    /** Number of phases (default: 3) */
    phases?: number;
    /** Custom threshold values */
    thresholds?: number[];
    /** Custom persona descriptions per phase */
    personas?: string[];
  } = {},
): GeneratedEJSTemplate | null {
  const leaves = getLeafFields(schema.fields);
  const numericFields = leaves.filter(f => f.type === 'number');
  if (numericFields.length === 0) return null;

  // Pick the target field
  const target = fieldPath
    ? numericFields.find(f => f.dotPath === fieldPath || f.path === fieldPath)
    : numericFields[0];
  if (!target) return null;

  const phases = options.phases ?? 3;
  const max = target.constraints?.max ?? target.constraints?.clamp?.[1] ?? 100;

  // Default thresholds: evenly split
  const thresholds = options.thresholds ?? Array.from(
    { length: phases - 1 },
    (_, i) => Math.round((max / phases) * (i + 1)),
  );

  // Default persona descriptions
  const defaultPersonas = [
    `{{char}} tỏ ra lạnh nhạt, dè dặt, không muốn nói chuyện nhiều`,
    `{{char}} đã bắt đầu quen thuộc, sẵn sàng trò chuyện thoải mái`,
    `{{char}} rất thân thiết, chia sẻ cả những điều riêng tư`,
  ];
  const personas = options.personas ?? defaultPersonas.slice(0, phases);

  const getvarPath = `stat_data.${target.dotPath}`;
  const defaultVal = target.defaultValue ?? 0;

  const lines: string[] = [
    '@@preprocessing',
    '<%_',
    `// Auto-generated: Multi-phase persona based on "${target.label}"`,
    `if (typeof ${target.varName} === 'undefined') var ${target.varName} = Number(getvar('${getvarPath}', { defaults: ${defaultVal} }));`,
    '',
  ];

  for (let i = 0; i < phases; i++) {
    const condition = i === 0
      ? `if (${target.varName} < ${thresholds[0]})`
      : i === phases - 1
        ? `} else`
        : `} else if (${target.varName} < ${thresholds[i]})`;
    lines.push(`${condition} {`);
    lines.push(`  print('【${personas[i] ?? `Phase ${i + 1}`}】');`);
  }

  lines.push('}');
  lines.push('_%>');

  return {
    type: 'multi_phase',
    name: `Multi-phase: ${target.label}`,
    description: `Thay đổi tính cách AI theo ${target.label} (${phases} giai đoạn)`,
    code: lines.join('\n'),
    fieldPaths: [target.path],
    entryConfig: {
      comment: `EJS: Persona theo ${target.label}`,
      constant: true,
      position: 'before_char',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE 2: VARIABLE DISPLAY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate variable display template.
 * Shows all variables in a formatted block for AI to read.
 */
export function generateVariableDisplay(
  schema: MVUZODSchema,
  options: {
    /** Fields to include (default: all non-hidden) */
    include?: string[];
    /** Title for the display block */
    title?: string;
  } = {},
): GeneratedEJSTemplate {
  const leaves = getLeafFields(schema.fields);
  const filtered = options.include
    ? leaves.filter(f => options.include!.includes(f.dotPath) || options.include!.includes(f.path))
    : leaves.filter(f => !f.constraints?.hidden);

  const title = options.title ?? 'Trạng thái hiện tại';

  const lines: string[] = [
    `[${title}]`,
  ];

  // Group by parent (first segment)
  const groups = new Map<string, typeof filtered>();
  for (const field of filtered) {
    const group = field.dotPath.includes('.')
      ? field.dotPath.split('.')[0]
      : '__root__';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(field);
  }

  for (const [group, fields] of groups) {
    if (group !== '__root__' && groups.size > 1) {
      // Find group label from schema
      const groupField = schema.fields.find(f => {
        const name = f.path.split('/').filter(Boolean).pop();
        return name === group;
      });
      lines.push(`【${groupField?.label ?? group}】`);
    }
    for (const field of fields) {
      const getvarPath = `stat_data.${field.dotPath}`;
      lines.push(`${field.label}: <%= getvar('${escapeQuotes(getvarPath)}') %>`);
    }
  }

  return {
    type: 'variable_display',
    name: 'Variable Display',
    description: `Hiển thị ${filtered.length} biến cho AI đọc`,
    code: lines.join('\n'),
    fieldPaths: filtered.map(f => f.path),
    entryConfig: {
      comment: `Danh sách biến (EJS Display)`,
      constant: true,
      position: 'before_char',
      depth: 1,
      role: 'system',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE 3: CONDITIONAL WORLDBOOK CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate conditional worldbook controller.
 * Toggles worldbook entries based on boolean or string variables.
 */
export function generateConditionalWB(
  schema: MVUZODSchema,
  mappings?: Array<{
    fieldPath: string;
    condition: 'true' | 'false' | string;
    entryComment: string;
  }>,
): GeneratedEJSTemplate | null {
  const leaves = getLeafFields(schema.fields);
  const toggleFields = leaves.filter(f => f.type === 'boolean' || f.type === 'string');
  if (toggleFields.length === 0) return null;

  // Auto-generate mappings if not provided
  const effectiveMappings = mappings ?? toggleFields.slice(0, 4).map(f => ({
    fieldPath: f.dotPath,
    condition: f.type === 'boolean' ? 'true' : (f.defaultValue as string ?? 'default'),
    entryComment: `WB: ${f.label}`,
  }));

  const lines: string[] = [
    '@@preprocessing',
    '<%_',
    '// Auto-generated: Conditional Worldbook Controller',
  ];

  // Declare variables
  for (const mapping of effectiveMappings) {
    const field = leaves.find(f => f.dotPath === mapping.fieldPath);
    if (!field) continue;

    const getvarPath = `stat_data.${field.dotPath}`;
    const defaultVal = field.type === 'boolean' ? 'false'
      : typeof field.defaultValue === 'string' ? `'${escapeQuotes(field.defaultValue)}'`
      : `'${mapping.condition}'`;

    lines.push(`if (typeof ${field.varName} === 'undefined') var ${field.varName} = ${
      field.type === 'boolean' ? `Boolean(getvar('${getvarPath}', { defaults: ${defaultVal} }))` :
      `getvar('${getvarPath}', { defaults: ${defaultVal} })`
    };`);
  }

  lines.push('');

  // (bugNeedFix/125) Trước đây sinh setEntryEnabled(comment, bool) — API KHÔNG tồn tại trong
  // ST-Prompt-template, chơi thẻ là "setEntryEnabled is not defined". Extension chỉ cho KÍCH
  // HOẠT entry đang tắt, nên các entry được map ở đây phải để enabled=false và ta bật chúng
  // có điều kiện. Xem lib/ejs/stptApi.ts để biết vì sao bắt buộc có tham số force.
  for (const mapping of effectiveMappings) {
    const field = leaves.find(f => f.dotPath === mapping.fieldPath);
    if (!field) continue;

    const condition = mapping.condition === 'true'
      ? field.varName
      : mapping.condition === 'false'
        ? `!${field.varName}`
        : `${field.varName} === '${escapeQuotes(mapping.condition)}'`;

    lines.push(activationLine(mapping.entryComment, condition));
  }

  lines.push('_%>');

  return {
    type: 'conditional_wb',
    name: 'Conditional Worldbook',
    description: `Kích hoạt ${effectiveMappings.length} entries theo biến (các entry này phải để TẮT sẵn)`,
    code: lines.join('\n'),
    fieldPaths: effectiveMappings.map(m => m.fieldPath),
    entryConfig: {
      comment: 'EJS: Kích hoạt Worldbook theo biến',
      constant: true,
      position: 'before_char',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE 4: INJECT PROMPT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate inject prompt template.
 * Dynamically injects prompts based on variable values.
 */
export function generateInjectPrompt(
  schema: MVUZODSchema,
  options: {
    /** Field to use for injection */
    fieldPath?: string;
    /** Prompt template with ${varName} interpolation */
    promptTemplate?: string;
    /** Injection position */
    position?: 'in_chat' | 'before_char' | 'after_char';
    /** Injection depth */
    depth?: number;
  } = {},
): GeneratedEJSTemplate | null {
  const leaves = getLeafFields(schema.fields);
  if (leaves.length === 0) return null;

  const target = options.fieldPath
    ? leaves.find(f => f.dotPath === options.fieldPath)
    : leaves.find(f => f.type === 'string') ?? leaves[0];
  if (!target) return null;

  const getvarPath = `stat_data.${target.dotPath}`;
  const defaultVal = target.defaultValue ?? (target.type === 'string' ? '' : 0);
  const defaultStr = typeof defaultVal === 'string' ? `'${escapeQuotes(defaultVal)}'` : String(defaultVal);

  const promptTemplate = options.promptTemplate ??
    `Hiện tại ${target.label} là \${${target.varName}}. Hãy điều chỉnh phản hồi phù hợp.`;

  const lines: string[] = [
    '@@preprocessing',
    '<%_',
    `// Auto-generated: Inject prompt based on "${target.label}"`,
    `if (typeof ${target.varName} === 'undefined') var ${target.varName} = getvar('${getvarPath}', { defaults: ${defaultStr} });`,
    '',
    // (bug 174) TRƯỚC ĐÂY sinh ra `injectPrompt({ text, position, depth })`. Chữ ký thật của
    // ST-Prompt-Template là injectPrompt(key, prompt, order, sticky, uid) — tham số VỊ TRÍ, không
    // hề có position/depth. Truyền object vào thì prompt = undefined: khối chạy trơn tru, không
    // lỗi đỏ, mà AI không nhận được chữ nào. Mọi thẻ tool sinh ra đều dính (thẻ bug/174 có 10 khối
    // chết vì lý do này). Nay in thẳng bằng print() — nội dung rơi đúng vị trí/độ sâu của chính
    // entry, không cần vế đọc thứ hai nên không thể thiếu nửa cặp.
    `print(\`${promptTemplate}\`);`,
    '_%>',
  ];

  return {
    type: 'inject_prompt',
    name: `Inject: ${target.label}`,
    description: `Inject prompt dựa trên giá trị ${target.label}`,
    code: lines.join('\n'),
    fieldPaths: [target.path],
    entryConfig: {
      comment: `EJS: Inject prompt — ${target.label}`,
      constant: true,
      position: 'before_char',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE ALL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate all available EJS templates from a schema.
 */
export function generateAllEJSTemplates(
  schema: MVUZODSchema,
): GeneratedEJSTemplate[] {
  const templates: GeneratedEJSTemplate[] = [];

  const multiPhase = generateMultiPhasePersona(schema);
  if (multiPhase) templates.push(multiPhase);

  templates.push(generateVariableDisplay(schema));

  const conditionalWB = generateConditionalWB(schema);
  if (conditionalWB) templates.push(conditionalWB);

  const injectPrompt = generateInjectPrompt(schema);
  if (injectPrompt) templates.push(injectPrompt);

  return templates;
}
