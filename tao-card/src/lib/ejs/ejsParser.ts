/**
 * src/lib/ejs/ejsParser.ts — EJS Template Parser & Validator
 * Spec 8B.3: Parse @@preprocessing entries, validate getvar calls, check tag balance
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { validateWorldbookEjs } from './stptApi';

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface EJSToken {
  type: 'literal' | 'expression' | 'raw_expression' | 'statement' | 'comment' | 'directive';
  value: string;
  line: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  getvarCalls: GetvarCall[];
  tokenCount: number;
}

export interface GetvarCall {
  path: string;
  defaults: string | null;
  line: number;
  inSchema: boolean | null; // null if no schema provided
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse EJS template content into tokens.
 * Handles @@preprocessing directive, <%_ _%> whitespace slurp, and all tag types.
 */
export function parseEJS(template: string): EJSToken[] {
  const tokens: EJSToken[] = [];
  let pos = 0, line = 1;

  // Handle @@preprocessing directive
  if (template.startsWith('@@')) {
    const firstLine = template.split('\n')[0];
    tokens.push({ type: 'directive', value: firstLine.trim(), line: 1 });
    pos = firstLine.length + 1;
    line = 2;
  }

  while (pos < template.length) {
    const openIdx = template.indexOf('<%', pos);
    if (openIdx === -1) {
      const remaining = template.slice(pos);
      if (remaining.trim()) {
        tokens.push({ type: 'literal', value: remaining, line });
      }
      break;
    }

    // Literal before tag
    if (openIdx > pos) {
      const lit = template.slice(pos, openIdx);
      tokens.push({ type: 'literal', value: lit, line });
      line += (lit.match(/\n/g) ?? []).length;
    }

    // Detect <%_ (whitespace-slurp open)
    let tagStart = openIdx + 2;
    const isSlurpOpen = template[tagStart] === '_';
    if (isSlurpOpen) tagStart++;

    // Find closing %>
    const closeRaw = template.indexOf('%>', tagStart);
    if (closeRaw === -1) {
      // Unclosed tag — treat rest as literal
      tokens.push({ type: 'literal', value: template.slice(openIdx), line });
      break;
    }

    const isSlurpClose = template[closeRaw - 1] === '_';
    const closeIdx = isSlurpClose ? closeRaw - 1 : closeRaw;

    // Determine tag type from first char after <%
    const firstChar = template[openIdx + 2];
    let inner: string;
    let type: EJSToken['type'];

    if (isSlurpOpen) {
      inner = template.slice(tagStart, closeIdx).trim();
      type = 'statement';
    } else if (firstChar === '=') {
      inner = template.slice(tagStart + 1, closeIdx).trim();
      type = 'expression';
    } else if (firstChar === '-') {
      inner = template.slice(tagStart + 1, closeIdx).trim();
      type = 'raw_expression';
    } else if (firstChar === '#') {
      inner = template.slice(tagStart + 1, closeIdx).trim();
      type = 'comment';
    } else {
      inner = template.slice(tagStart, closeIdx).trim();
      type = 'statement';
    }

    tokens.push({ type, value: inner, line });

    // Update line count
    line += (template.slice(openIdx, closeRaw + 2).match(/\n/g) ?? []).length;
    pos = closeRaw + 2;

    // Skip newline after _%>
    if (isSlurpClose && template[pos] === '\n') pos++;
  }

  return tokens;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate @@preprocessing entry content.
 * Checks: directive presence, tag balance, getvar path validity, schema matching.
 */
export function validateEJSEntry(content: string, schema?: MVUZODSchema): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tokens = parseEJS(content);
  const getvarCalls: GetvarCall[] = [];

  // Check directive
  if (!content.startsWith('@@preprocessing')) {
    warnings.push('Entry không có @@preprocessing — sẽ không được xử lý như EJS');
  }

  // (bugNeedFix/125) Đếm thô <% và %> KHÔNG đủ. Ca làm vỡ thẻ của user cân bằng số lượng nhưng
  // vẫn sai cấu trúc: một khối <%_ mở lại mà không đóng khiến thẻ kế tiếp lọt vào JS, extension
  // báo "Unexpected token '<'". validateWorldbookEjs dựng lại đúng máy trạng thái lint() của
  // ST-Prompt-template (kèm chặn API bịa như setEntryEnabled) nên bắt được cả hai kiểu lỗi đó.
  for (const p of validateWorldbookEjs(content).problems) {
    errors.push(p);
  }

  // Extract getvar calls
  const getvarRegex = /getvar\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{\s*defaults\s*:\s*['"]?([^'"}\s]*)['"]?\s*\})?\s*\)/g;
  let lineNum = 1;
  for (const line of content.split('\n')) {
    let match;
    const lineRegex = new RegExp(getvarRegex.source, 'g');
    while ((match = lineRegex.exec(line)) !== null) {
      const path = match[1];
      const defaults = match[2] ?? null;

      // Check key prefix
      if (!path.startsWith('stat_data.') && !path.startsWith('stat_data[')) {
        warnings.push(`getvar('${path}'): key không bắt đầu bằng 'stat_data.' — có thể sai`);
      }

      // CHƯA BÓC CẶP: MVU lưu biến dạng [giá_trị, "mô tả"] hoặc giá trị trần, getvar trả về
      // NGUYÊN thứ đang nằm trong stat_data. Thẻ nhập từ ngoài hay dùng cặp ⇒ Number(cặp) = NaN
      // và mọi so sánh số trượt lặng lẽ. Chỉ nhắc, không chặn: thẻ do tool sinh xuất giá trị
      // trần nên bản không bọc vẫn chạy được.
      if (!/\[\s*\]\s*\.concat\s*\(\s*$|castArray\s*\(\s*$/.test(line.slice(0, match.index))) {
        warnings.push(
          `getvar('${path}') chưa bóc cặp [giá trị, "mô tả"] — thẻ dùng dạng cặp sẽ ra NaN/dính mô tả. `
          + `Bọc lại: [].concat(getvar('${path}'${defaults !== null ? `, { defaults: … }` : ''}))[0]`,
        );
      }

      // Check against schema
      let inSchema: boolean | null = null;
      if (schema && path.startsWith('stat_data.')) {
        const schemaPath = '/' + path.replace('stat_data.', '').replace(/\./g, '/');
        inSchema = !!findSchemaField(schema, schemaPath);
        if (!inSchema) {
          warnings.push(`getvar path '${path.replace('stat_data.', '')}' không tìm thấy trong schema`);
        }
      }

      getvarCalls.push({ path, defaults, line: lineNum, inSchema });
    }
    lineNum++;
  }

  // Check for common mistakes
  if (content.includes('this.variables')) {
    errors.push('Sử dụng this.variables — KHÔNG ĐÚNG trong @@preprocessing. Dùng getvar() thay thế.');
  }

  if (content.includes('<%= ') && content.startsWith('@@preprocessing')) {
    warnings.push('Dùng <%= %> trong @@preprocessing — output sẽ không hiển thị (preprocessing chỉ thực thi logic)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    getvarCalls,
    tokenCount: tokens.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function findSchemaField(schema: MVUZODSchema, path: string): MVUZODField | null {
  const segments = path.split('/').filter(Boolean);
  let fields = schema.fields;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const field = fields.find(f => {
      const fieldName = f.path.split('/').pop();
      return fieldName === seg;
    });
    if (!field) return null;
    if (i === segments.length - 1) return field;
    if (field.children) {
      fields = field.children;
    } else {
      return null;
    }
  }

  return null;
}

/**
 * Check if content is an EJS @@preprocessing entry.
 */
export function isPreprocessingEntry(content: string): boolean {
  return content.trimStart().startsWith('@@preprocessing');
}

/**
 * Generate getvar() call string for a schema field path.
 */
export function generateGetvarCall(fieldPath: string, defaultValue: unknown): string {
  const dotPath = 'stat_data' + fieldPath.replace(/\//g, '.');
  const defaultStr = typeof defaultValue === 'string' ? `'${defaultValue}'`
    : typeof defaultValue === 'number' ? String(defaultValue)
    : JSON.stringify(defaultValue);
  // `[].concat(...)[0]` bóc cặp [giá_trị, "mô tả"] mà MVU dùng cho biến có mô tả; giá trị trần
  // đi qua vẫn nguyên. Thiếu nó thì thẻ nhập từ ngoài cho ra NaN / dính cả câu mô tả.
  return `[].concat(getvar('${dotPath}', { defaults: ${defaultStr} }))[0]`;
}

/**
 * Flatten schema fields into a list of paths with metadata.
 */
export function flattenSchemaForPanel(fields: MVUZODField[], prefix = ''): Array<{
  path: string;
  fullPath: string;
  type: string;
  defaultValue: unknown;
  depth: number;
}> {
  const result: Array<{ path: string; fullPath: string; type: string; defaultValue: unknown; depth: number }> = [];
  for (const field of fields) {
    const name = field.path.split('/').pop() ?? field.path;
    const fullPath = prefix + field.path;
    const depth = fullPath.split('/').filter(Boolean).length - 1;
    result.push({ path: name, fullPath, type: field.type, defaultValue: field.defaultValue, depth });
    if (field.children) {
      result.push(...flattenSchemaForPanel(field.children, fullPath));
    }
  }
  return result;
}
