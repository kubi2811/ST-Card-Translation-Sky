/**
 * SchemaBuilder — Thay thế SchemaWizard hoàn toàn.
 * Tham khảo spec MVU_ZOD (enterprise20020924-web/-):
 *   - Schema = z.object({ ... }) code thực
 *   - Prefix _ (readonly), $ (hidden)
 *   - z.coerce.number(), z.string().prefault(), z.record(), z.partialRecord()
 *   - Object-level .transform() (takeRight, pickBy)
 *
 * Kiến trúc: 2-panel layout
 *   Left:  Schema Tree + Source selection
 *   Right: Field Detail Editor + Actions + Live Zod Code Preview
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Trash2, ChevronRight, ChevronDown, Wand2,
  FileJson, Copy, CheckCircle, AlertTriangle, EyeOff,
  Lock, FolderPlus, Upload,
  Code, Layers, Scan, RotateCcw,
  Zap, ListOrdered, LayoutList, Square,
  Lightbulb, Brain, Loader2, Sparkles,
} from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import type { MVUZODSchema, MVUZODField, MVUZODConstraints } from '../../types/mvuzod.types';
import type { LorebookEntry, CardExtensions } from '../../types';
import { MVUZOD_TEMPLATES, type MVUZODTemplate } from '../../lib/mvuzod/templateLibrary';
import { analyzeLorebookForSchema, buildMinimalSchemaFromReport, parseSchemaInferenceResponse, assertUsableSchema, schemaToZodCode } from '../../lib/mvuzod/schemaInferencer';
import { checkSchemaHealth, summarizeHealth } from '../../lib/mvuzod/schemaHealth';
import { parseZodCodeToSchema, isMvuSchemaScript } from '../../lib/mvuzod/zodCodeParser';
import { mergeInferredSchemas } from '../../lib/mvuzod/mergeInferredSchemas';
import { buildMVUZODScripts } from '../../lib/mvuzod/tavernScriptBuilder';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import { MVUZOD_SCHEMA_INFERENCE_PROMPT, MVUZOD_IDEA_TO_SCHEMA_PROMPT, MVUZOD_EXPAND_VARIABLES_PROMPT, MVUZOD_SCHEMA_EDITOR_PROMPT } from '../../prompts/modeMVUZOD';
import type { ChatMessage } from '../../types';
import { cn } from '../../lib/utils';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * (bugNeedFix/99) Đã đọc được schema từ chỗ text hiện có chưa? Dùng để DỪNG SỚM chuỗi "viết tiếp
 * phần còn thiếu": nhiều provider trả finishReason='length' dù JSON đã đóng đủ ngoặc, nên vòng cũ
 * cứ gọi thêm 3 lượt nữa cho một kết quả vốn đã dùng được.
 */
function canParseSchema(text: string): boolean {
  if (!text.trim()) return false;
  try {
    const p = parseSchemaInferenceResponse(text);
    return !!p.proposedSchema?.fields?.length;
  } catch { return false; }
}

/**
 * Extract MVUZODSchema from various JSON formats:
 * 1. Direct: { fields: [...] }
 * 2. Wrapped: { schema: { fields: [...] } }
 * 3. MVUZOD wrapper: { mvuzod: { schema: { fields: [...] } } }
 * 4. Full card V3: { data: { extensions: { mvuzod: { schema: { fields: [...] } } } } }
 * 5. State values JSON: { "Group": { "key": value, ... }, ... } → auto-infer schema
 */
function extractSchemaFromJson(parsed: Record<string, unknown>): MVUZODSchema | null {
  // 1. Direct schema
  if (Array.isArray(parsed.fields)) return parsed as unknown as MVUZODSchema;
  // 2. Wrapped { schema: { fields } }
  const s1 = parsed.schema as Record<string, unknown> | undefined;
  if (s1 && Array.isArray(s1.fields)) return s1 as unknown as MVUZODSchema;
  // 3. { mvuzod: { schema: { fields } } }
  const m1 = parsed.mvuzod as Record<string, unknown> | undefined;
  if (m1?.schema && Array.isArray((m1.schema as Record<string, unknown>).fields)) {
    return m1.schema as unknown as MVUZODSchema;
  }
  // 4. Full card V3: { data: { extensions: { mvuzod: { schema: { fields } } } } }
  const data = parsed.data as Record<string, unknown> | undefined;
  const ext = data?.extensions as Record<string, unknown> | undefined;
  const m2 = ext?.mvuzod as Record<string, unknown> | undefined;
  if (m2?.schema && Array.isArray((m2.schema as Record<string, unknown>).fields)) {
    return m2.schema as unknown as MVUZODSchema;
  }
  // 5. Auto-infer schema from state values JSON (e.g. {"Group": {"key": value}})
  // Heuristic: a plain object with string keys whose values are objects/primitives
  const keys = Object.keys(parsed);
  if (keys.length > 0 && !parsed.spec && !parsed.data && !parsed.entries) {
    const fields = inferFieldsFromState(parsed, '');
    if (fields.length > 0) {
      return { version: '1.0', fields };
    }
  }
  return null;
}

// ─── Sanitize mixed JS/JSON content to extract pure JSON ────────────────
/**
 * Extract JSON object from mixed content that may contain JS code.
 * Handles: import statements, export/const/var wrappers,
 * function call wrappers (e.g. registerMvuSchema({...})), and JS comments.
 */
function sanitizeJsonInput(raw: string): string {
  let input = raw.trim();
  if (!input) throw new Error('Nội dung trống.');

  // If it already starts with { — likely pure JSON, return quickly
  if (input.startsWith('{')) {
    return extractMatchedBraces(input);
  }

  // 1. Strip import lines: import { ... } from '...'; or import '...';
  input = input.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]*['"]\s*;?\s*$/gm, '');
  input = input.replace(/^\s*import\s+['"][^'"]*['"]\s*;?\s*$/gm, '');

  // 2. Strip export wrappers
  input = input.replace(/^\s*export\s+default\s+/m, '');
  input = input.replace(/^\s*module\.exports\s*=\s*/m, '');

  // 3. Strip const/let/var assignment
  input = input.replace(/^\s*(?:const|let|var)\s+\w+\s*=\s*/m, '');

  // 4. Strip function call wrapper: funcName({ ... }) → { ... }
  input = input.trim();
  const fnCallMatch = input.match(/^\w+\s*\(\s*/);
  if (fnCallMatch) {
    input = input.substring(fnCallMatch[0].length);
    // Remove trailing ); or )
    input = input.replace(/\s*\)\s*;?\s*$/, '');
  }

  // 5. Strip JS-style comments
  input = input.replace(/\/\/.*$/gm, '');
  input = input.replace(/\/\*[\s\S]*?\*\//g, '');

  input = input.trim();

  // 6. Find JSON object
  const firstBrace = input.indexOf('{');
  if (firstBrace === -1) {
    throw new Error(`Không tìm thấy JSON object trong nội dung.\nNội dung bắt đầu bằng: "${raw.trim().slice(0, 80)}..."`);
  }
  if (firstBrace > 0) {
    input = input.substring(firstBrace);
  }

  return extractMatchedBraces(input);
}

/**
 * Nhận diện + parse MỌI kiểu nội dung schema mà user dán/import:
 *  - Zod schema JS (mvu_zod native: `import { registerMvuSchema }...; export const Schema = z.object({...})`)
 *    → dùng parseZodCodeToSchema (JSON.parse KHÔNG xử lý được `z.object(`/`z.enum(` → đây là lỗi user gặp).
 *  - JSON thuần / state JSON / card V3 → sanitize + JSON.parse + extractSchemaFromJson.
 * Trả MVUZODSchema hợp lệ hoặc null.
 */
function parseSchemaInputText(raw: string, sourceName = ''): MVUZODSchema | null {
  const text = (raw || '').trim();
  if (!text) throw new Error('Nội dung trống.');
  const looksZod = isMvuSchemaScript(sourceName, text) || /\bz\s*\.\s*object\s*\(/.test(text) || /registerMvuSchema/.test(text);
  if (looksZod) {
    const s = parseZodCodeToSchema(text);
    if (s && s.fields && s.fields.length) return s;
    // Nếu parse Zod thất bại, thử tiếp đường JSON bên dưới (không chặn cứng).
  }
  const parsed = JSON.parse(sanitizeJsonInput(text));
  return extractSchemaFromJson(parsed);
}

/** Find the matching closing } for the opening { at position 0 */
function extractMatchedBraces(input: string): string {
  let openBraces = 0;
  let inStr = false;
  let esc = false;
  let endIdx = -1;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
    } else {
      if (ch === '"') { inStr = true; }
      else if (ch === '{') { openBraces++; }
      else if (ch === '}') {
        openBraces--;
        if (openBraces === 0) { endIdx = i; break; }
      }
    }
  }
  if (endIdx !== -1) {
    return input.substring(0, endIdx + 1);
  }
  return input;
}

// ─── Smart Constraint Detection Helpers for Auto-Infer from State JSON ───
// Keywords for stat-like fields (expect 0~100 range)
const INFER_STAT_KW = [
  'quyền lực', 'trung thành', 'sĩ khí', 'kỷ luật', 'uy tín', 'danh tiếng',
  'sức mạnh', 'sức hút', 'học thức', 'ngoại giao', 'kinh tế', 'chỉ huy',
  'mưu', 'kỹ năng', 'thực chiến', 'thái độ', 'mức độ', 'maat',
  '好感', '信赖', '忠诚', 'loyalty', 'morale', 'reputation', 'prestige',
  'strength', 'charisma', 'intelligence', 'diplomacy', 'tài chỉ huy',
  'mưu hèn kế bẩn', 'ngoại giao cá nhân',
];
// Keywords for resource/quantity fields (min: 0, no upper cap)
const INFER_RESOURCE_KW = [
  'vàng', 'ngân khố', 'dân số', 'quân lực', 'quân số', 'thu nhập', 'chi phí',
  'lương thảo', 'hao phí', 'bảo trì', 'bộ binh', 'kỵ binh', 'cung thủ',
  'kỵ sĩ', 'thủy quân', 'lính', 'khí cụ', 'tổng số quân', 'tổn thất',
  'kho lương', 'gold', 'army', 'troops', 'population', 'treasury',
  '金币', '军队', '人口', 'số địch', 'kỵ binh hạng nặng', 'kỵ binh hạng nhẹ',
  'lính giáo dài', 'lính đánh thuê', 'quân số phe', 'tổn thất phe',
];
// Keywords for HP-like fields (clamp to [0, defaultValue])
const INFER_HP_KW = ['hp', 'sinh lực', '生命', 'health', 'hitpoint'];
// Parent paths that suggest children are stats (0-100)
const INFER_STAT_PARENT_KW = [
  'nhân vật', 'chỉ số', 'stats', 'player', 'người chơi', 'pharaoh',
  'nhân vật chính',
];

// ─── Enum detection patterns ───────────────────────────────────────────
interface InferEnumPattern {
  keywords: string[];
  values: string[];
}
interface InferContextEnumPattern extends InferEnumPattern {
  parentKeywords: string[];
}

const INFER_ENUM_PATTERNS: InferEnumPattern[] = [
  { keywords: ['mùa', 'season', '季节'], values: ['Mùa Xuân', 'Mùa Hè', 'Mùa Thu', 'Mùa Đông'] },
  { keywords: ['giới tính', 'gender', '性别'], values: ['Nam', 'Nữ', 'Chưa xác định'] },
  { keywords: ['mức thuế', 'tax level'], values: ['Rất thấp', 'Thấp', 'Vừa phải', 'Cao', 'Rất cao'] },
  { keywords: ['tình trạng hôn nhân'], values: ['Độc thân', 'Đã kết hôn', 'Góa', 'Ly hôn'] },
  { keywords: ['tôn giáo'], values: ['Đức Tin Bảy Mặt', 'Giáo phái R\'hllor', 'Cổ Thần', 'Thần Chìm', 'Không tôn giáo'] },
];

const INFER_CONTEXT_ENUM_PATTERNS: InferContextEnumPattern[] = [
  { keywords: ['kết quả'], parentKeywords: ['chiến', 'đấu', 'combat', 'battle', 'hỗn chiến'], values: ['Chưa bắt đầu', 'Đang diễn ra', 'Thắng lợi', 'Thất bại', 'Hòa'] },
  { keywords: ['giai đoạn'], parentKeywords: ['chiến', 'trận', 'battle'], values: ['Dàn trận', 'Giao chiến', 'Rút lui', 'Kết thúc'] },
  { keywords: ['quy mô'], parentKeywords: ['chiến', 'combat'], values: ['Không giao tranh', 'Đấu tay đôi', 'Hỗn chiến', 'Chiến tranh'] },
  { keywords: ['ưu thế', 'advantage'], parentKeywords: ['đấu', 'chiến', 'combat'], values: ['Cân bằng', 'Phe ta', 'Phe địch'] },
  { keywords: ['chiến thuật'], parentKeywords: ['chiến', 'trận', 'war'], values: ['Tấn công trực diện', 'Phục kích', 'Phòng thủ', 'Rút lui', 'Bao vây', 'Đột kích cánh'] },
  { keywords: ['loại cảnh'], parentKeywords: ['thế giới', 'world', 'trạng thái'], values: ['Tự do', 'Chiến đấu', 'Ngoại giao', 'Khám phá', 'Sự kiện'] },
  { keywords: ['thời tiết', 'weather'], parentKeywords: ['thế giới', 'world', 'trạng thái'], values: ['Quang đãng', 'Mưa', 'Bão', 'Tuyết', 'Sương mù', 'Nắng gắt'] },
  { keywords: ['mức độ báo động'], parentKeywords: ['đe dọa', 'threat'], values: ['Chưa có dấu hiệu', 'Tin đồn', 'Cảnh giác', 'Nguy hiểm', 'Khẩn cấp'] },
  { keywords: ['tình trạng bức tường'], parentKeywords: ['phương bắc', 'đe dọa'], values: ['Vững chắc', 'Hư hại nhẹ', 'Hư hại nặng', 'Sụp đổ'] },
];

// ─── Record describe detection ─────────────────────────────────────────
const INFER_RECORD_DESCRIBE: Array<{ keywords: string[]; describe: string }> = [
  { keywords: ['con cái', 'children'], describe: 'Tên con' },
  { keywords: ['chư hầu', 'vassal'], describe: 'Tên chư hầu' },
  { keywords: ['ưu điểm', 'advantage', 'perk'], describe: 'Tên ưu điểm' },
  { keywords: ['nhược điểm', 'weakness', 'flaw'], describe: 'Tên nhược điểm' },
  { keywords: ['đồng minh tham chiến'], describe: 'Tên / Số lượng' },
  { keywords: ['kẻ địch tham chiến'], describe: 'Tên / Số lượng' },
  { keywords: ['âm mưu', 'scheme', 'plot'], describe: 'Tên âm mưu' },
  { keywords: ['bí mật', 'secret'], describe: 'Tên bí mật' },
  { keywords: ['nhiệm vụ', 'quest', 'mission'], describe: 'Tên nhiệm vụ' },
  { keywords: ['quan hệ', 'relation'], describe: 'Tên gia tộc / Phe' },
  { keywords: ['cổ vật', 'artifact', 'relic'], describe: 'Tên cổ vật' },
  { keywords: ['valyrian'], describe: 'Tên vật phẩm Valyrian' },
  { keywords: ['rồng', 'dragon', '龙'], describe: 'Tên rồng' },
  { keywords: ['npc', 'hồ sơ', 'nhân vật phụ'], describe: 'Tên NPC' },
  { keywords: ['cờ sự kiện', 'event flag'], describe: 'Tên sự kiện' },
  { keywords: ['物品', 'inventory', 'hành trang', 'vật phẩm'], describe: 'Tên vật phẩm' },
  { keywords: ['quản lý rồng'], describe: 'Tên rồng' },
  { keywords: ['trang bị valyrian', 'cổ vật & trang bị'], describe: 'Tên vật phẩm' },
];

function inferNumberConstraints(key: string, value: number, parentPath: string): Partial<MVUZODConstraints> {
  const kl = key.toLowerCase();
  // HP-like fields: clamp [0, defaultValue]
  if (INFER_HP_KW.some(k => kl.includes(k))) {
    return { clamp: [0, value || 100], updateRange: `0~${value || 100}` };
  }
  // Stat-like fields (0-100 range)
  if (INFER_STAT_KW.some(k => kl.includes(k)) && value >= 0 && value <= 100) {
    return { clamp: [0, 100], updateRange: '0~100' };
  }
  // Resource/quantity fields (min: 0, no upper bound)
  if (INFER_RESOURCE_KW.some(k => kl.includes(k))) {
    return { min: 0 };
  }
  // Heuristic: value is 0-100 and parent path suggests a stats group
  if (value >= 0 && value <= 100) {
    const pl = parentPath.toLowerCase();
    if (INFER_STAT_PARENT_KW.some(p => pl.includes(p))) {
      return { clamp: [0, 100], updateRange: '0~100' };
    }
  }
  return {};
}

function inferStringConstraints(key: string, _value: string, parentPath: string): Partial<MVUZODConstraints> {
  const kl = key.toLowerCase();
  const pl = parentPath.toLowerCase();
  // Simple enum match (key alone is enough)
  for (const ep of INFER_ENUM_PATTERNS) {
    if (ep.keywords.some(k => kl.includes(k))) {
      return { enumValues: ep.values };
    }
  }
  // Context-aware enum match (key + parent path)
  for (const cep of INFER_CONTEXT_ENUM_PATTERNS) {
    if (cep.keywords.some(k => kl.includes(k)) && cep.parentKeywords.some(pk => pl.includes(pk))) {
      return { enumValues: cep.values };
    }
  }
  return {};
}

function inferRecordDescribe(key: string): Partial<MVUZODConstraints> {
  const kl = key.toLowerCase();
  for (const rd of INFER_RECORD_DESCRIBE) {
    if (rd.keywords.some(k => kl.includes(k))) {
      return { describe: rd.describe };
    }
  }
  return {};
}

/**
 * Recursively infer MVUZODField[] from a state JSON object.
 * Enhanced: auto-detects clamp, enums, readonly, hidden, record describes.
 * { "HP": 100 } → field { path: "/HP", type: "number", clamp: [0,100] }
 * { "Stats": { "HP": 100 } } → field { path: "/Stats", type: "object", children: [...] }
 */
function inferFieldsFromState(obj: Record<string, unknown>, parentPath: string): MVUZODField[] {
  const fields: MVUZODField[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = `${parentPath}/${key}`;
    // Detect prefix conventions: _ = readonly, $ = hidden
    const isReadonly = key.startsWith('_');
    const isHidden = key.startsWith('$');
    const label = key.replace(/^[_$]+/, '');
    const baseConstraints: Partial<MVUZODConstraints> = {
      ...(isReadonly && { readOnly: true }),
      ...(isHidden && { hidden: true }),
    };

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const childObj = value as Record<string, unknown>;
      const childKeys = Object.keys(childObj);
      if (childKeys.length === 0) {
        // Empty object → record type with smart describe
        fields.push({
          path, type: 'record', label, defaultValue: {},
          constraints: { prefault: {}, ...baseConstraints, ...inferRecordDescribe(key) },
        });
      } else {
        // Non-empty object → recurse
        const children = inferFieldsFromState(childObj, path);
        fields.push({
          path, type: 'object', label, defaultValue: {},
          constraints: { ...baseConstraints },
          children,
        });
      }
    } else if (Array.isArray(value)) {
      fields.push({
        path, type: 'array', label, defaultValue: value,
        constraints: { prefault: value, ...baseConstraints },
      });
    } else if (typeof value === 'number') {
      const numConstraints = inferNumberConstraints(key, value, parentPath);
      fields.push({
        path, type: 'number', label, defaultValue: value,
        constraints: { coerce: true, prefault: value, ...baseConstraints, ...numConstraints },
      });
    } else if (typeof value === 'boolean') {
      fields.push({
        path, type: 'boolean', label, defaultValue: value,
        constraints: { prefault: value, ...baseConstraints },
      });
    } else {
      // string or other → string with smart enum detection
      const strVal = String(value ?? '');
      const strConstraints = inferStringConstraints(key, strVal, parentPath);
      fields.push({
        path, type: 'string', label, defaultValue: strVal,
        constraints: { prefault: strVal, ...baseConstraints, ...strConstraints },
      });
    }
  }
  return fields;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function SchemaBuilder() {
  const card = useCardStore(s => s.card);
  const setMvuzodSchema = useCardStore(s => s.setMvuzodSchema);
  const createSnapshot = useCardStore(s => s.createSnapshot);

  // Load schema from store (single source of truth)
  const schema: MVUZODSchema | null = useMemo(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown>;
    if (ext?.mvuzod) {
      return (ext.mvuzod as Record<string, unknown>).schema as MVUZODSchema ?? null;
    }
    return null;
  }, [card.data.extensions]);

  const [selectedFieldPath, setSelectedFieldPath] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(!schema);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Entries for lorebook-based analysis
  const entries = useMemo(
    () => card.data.character_book?.entries ?? [],
    [card.data.character_book?.entries],
  );

  // ─── Schema mutations ───────────────────────────────────────────────
  const updateSchema = useCallback((newSchema: MVUZODSchema) => {
    setMvuzodSchema(newSchema);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
  }, [setMvuzodSchema]);

  const handleApplyTemplate = useCallback(async (template: MVUZODTemplate) => {
    if (schema) {
      await createSnapshot('Trước khi áp dụng template');
    }
    updateSchema({ ...template.schema });
    setShowSource(false);
  }, [schema, createSnapshot, updateSchema]);

  const handleApplyInferredSchema = useCallback(async (inferred: MVUZODSchema) => {
    if (schema) {
      await createSnapshot('Trước khi áp dụng AI inference');
    }
    updateSchema(inferred);
    setShowSource(false);
  }, [schema, createSnapshot, updateSchema]);

  const handleCreateNew = useCallback(async () => {
    if (schema) {
      await createSnapshot('Trước khi tạo schema mới');
    }
    updateSchema({
      version: '1.0',
      fields: [
        {
          path: '/世界',
          type: 'object',
          label: '世界',
          defaultValue: {},
          constraints: {},
          children: [
            { path: '/世界/当前時間', type: 'string', label: '当前時間', defaultValue: '', constraints: { prefault: 'Chưa khởi tạo' } },
            { path: '/世界/当前地点', type: 'string', label: '当前地点', defaultValue: '', constraints: { prefault: 'Chưa khởi tạo' } },
          ],
        },
        {
          path: '/主角',
          type: 'object',
          label: '主角',
          defaultValue: {},
          constraints: {},
          children: [
            { path: '/主角/物品栏', type: 'record', label: '物品栏', defaultValue: {}, constraints: { describe: '物品名', transform: 'pickBy' } },
          ],
        },
      ],
    });
    setShowSource(false);
  }, [schema, createSnapshot, updateSchema]);

  // ─── Field operations ───────────────────────────────────────────────
  const updateField = useCallback((path: string, updated: MVUZODField) => {
    if (!schema) return;
    const newFields = updateFieldInTree(schema.fields, path, updated);
    updateSchema({ ...schema, fields: newFields });
  }, [schema, updateSchema]);

  const deleteField = useCallback(async (path: string) => {
    if (!schema) return;
    await createSnapshot('Xóa field');
    const newFields = deleteFieldFromTree(schema.fields, path);
    updateSchema({ ...schema, fields: newFields });
    if (selectedFieldPath === path) setSelectedFieldPath(null);
  }, [schema, createSnapshot, updateSchema, selectedFieldPath]);

  const addField = useCallback((parentPath: string | null, type: MVUZODField['type']) => {
    if (!schema) return;
    const newField: MVUZODField = {
      path: parentPath ? `${parentPath}/Mới` : '/Mới',
      type,
      label: 'Mới',
      defaultValue: type === 'number' ? 0 : type === 'boolean' ? false : type === 'object' || type === 'record' ? {} : '',
      constraints: {},
      ...(type === 'object' ? { children: [] } : {}),
    };
    if (parentPath) {
      const newFields = addChildToTree(schema.fields, parentPath, newField);
      updateSchema({ ...schema, fields: newFields });
    } else {
      updateSchema({ ...schema, fields: [...schema.fields, newField] });
    }
    setSelectedFieldPath(newField.path);
  }, [schema, updateSchema]);

  // ─── Scripts ────────────────────────────────────────────────────────

  const handleCreateScripts = useCallback(async () => {
    if (!schema) return;
    await createSnapshot('Trước khi tạo scripts');
    const scripts = buildMVUZODScripts(schema, card.data.name);
    // Inject scripts into card.data.extensions.tavern_helper.scripts
    useCardStore.getState().updateCard(c => {
      const ext = (c.data.extensions ?? {}) as unknown as Record<string, unknown>;
      const th = (ext.tavern_helper ?? {}) as Record<string, unknown>;
      const existing = (th.scripts ?? []) as Array<{ name: string; content: string; enabled: boolean }>;
      for (const script of scripts) {
        const idx = existing.findIndex(s => s.name === script.name);
        if (idx >= 0) {
          existing[idx] = script;
        } else {
          existing.push(script);
        }
      }
      th.scripts = existing;
      ext.tavern_helper = th;
      c.data.extensions = ext as unknown as CardExtensions;
    });
  }, [schema, card.data.name, createSnapshot]);

  // ─── Selected field ─────────────────────────────────────────────────
  const selectedField = useMemo(() => {
    if (!selectedFieldPath || !schema) return null;
    return findFieldByPath(schema.fields, selectedFieldPath);
  }, [selectedFieldPath, schema]);

  // ─── Zod code preview ──────────────────────────────────────────────
  const zodCode = useMemo(() => {
    if (!schema) return '';
    try { return schemaToZodCode(schema, card.data.name); } catch { return '// Lỗi tạo Zod code'; }
  }, [schema, card.data.name]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <button
          onClick={() => setShowSource(!showSource)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
            showSource ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          <Layers className="w-3.5 h-3.5" /> Nguồn
        </button>

        <button
          onClick={() => setShowCodePreview(!showCodePreview)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
            showCodePreview ? 'bg-violet-500/10 text-violet-400' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          <Code className="w-3.5 h-3.5" /> Zod Preview
        </button>

        <div className="flex-1" />

        {/* Save status indicator */}
        {saveStatus === 'saved' && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <CheckCircle className="w-3 h-3" /> Auto-saved
          </span>
        )}

        {schema && (
          <span className="text-[10px] text-muted-foreground">
            {countFields(schema.fields)} fields
          </span>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — Source or Tree */}
        <div className="w-1/2 border-r border-border overflow-y-auto">
          {showSource || !schema ? (
            <SchemaSourcePanel
              hasExistingSchema={!!schema}
              entries={entries}
              onApplyTemplate={handleApplyTemplate}
              onApplyInferred={handleApplyInferredSchema}
              onCreateNew={handleCreateNew}
            />
          ) : (
            <div className="p-3 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schema Tree</h3>
                <div className="flex gap-1">
                  {(['object', 'string', 'number', 'record'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => addField(null, t)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                      title={`Thêm ${t} gốc`}
                    >
                      +{t}
                    </button>
                  ))}
                </div>
              </div>
              {schema.fields.map(field => (
                <FieldTreeNode
                  key={field.path}
                  field={field}
                  depth={0}
                  selectedPath={selectedFieldPath}
                  onSelect={setSelectedFieldPath}
                  onDelete={deleteField}
                  onAddChild={(parentPath) => addField(parentPath, 'string')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right panel — Detail or Actions or Code */}
        <div className="w-1/2 overflow-y-auto">
          {showCodePreview && schema ? (
            <ZodCodePreview code={zodCode} />
          ) : selectedField && schema ? (
            <SchemaFieldDetail
              field={selectedField}
              onUpdate={(updated) => updateField(selectedFieldPath!, updated)}
              onDelete={() => deleteField(selectedFieldPath!)}
            />
          ) : schema ? (
            <ActionsPanel
              schema={schema}
              onCreateScripts={handleCreateScripts}
              onReset={() => { setShowSource(true); setSelectedFieldPath(null); }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              ← Chọn nguồn schema để bắt đầu
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA SOURCE PANEL
// ═══════════════════════════════════════════════════════════════════════════

function SchemaSourcePanel({
  hasExistingSchema,
  entries,
  onApplyTemplate,
  onApplyInferred,
  onCreateNew,
}: {
  hasExistingSchema: boolean;
  entries: Array<{ id: number; comment: string; content: string; keys: string[] }>;
  onApplyTemplate: (t: MVUZODTemplate) => void;
  onApplyInferred: (schema: MVUZODSchema) => Promise<void>;
  onCreateNew: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState('');
  const [showJsonImport, setShowJsonImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scan mode state
  type ScanMode = 'all' | 'single' | 'batch';
  const [scanMode, setScanMode] = useState<ScanMode>('all');
  const [batchSize, setBatchSize] = useState(5);
  const [parallelCount, setParallelCount] = useState(1);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; results: string[] } | null>(null);
  const cancelRef = useRef(false);
  // (bugNeedFix/99) Nút "Dừng quét" trước đây chỉ bật một lá cờ, mà lá cờ đó chỉ được đọc ở đầu mỗi
  // đợt sóng — đang treo giữa một call AI dài thì bấm bao nhiêu cũng không có gì xảy ra, user tưởng
  // nút chết. Nay mọi call đều nhận signal của controller này nên bấm là request đứt ngay.
  const abortRef = useRef<AbortController | null>(null);

  // (User 2026) CHỌN ENTRY RIÊNG LẺ để quét: card 100+ nhân vật thì quét cả 100 entry NPC vô nghĩa —
  // cho tick bỏ những entry không giúp gì cho schema. Mặc định quét TẤT CẢ (loại trừ theo id, entry
  // mới của card mới tự động được gồm).
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [showEntryPicker, setShowEntryPicker] = useState(false);
  const scanEntries = useMemo(() => entries.filter(e => !excludedIds.has(e.id)), [entries, excludedIds]);

  const entryCount = scanEntries.length;
  const canAnalyze = entryCount >= 1;

  // Core AI call for a subset of entries
  const callAIForEntries = useCallback(async (
    subset: typeof entries,
    label: string,
  ): Promise<string> => {
    const activeProfile = useSettingsStore.getState().getActiveProfile();
    const params = useSettingsStore.getState().generationParams;
    if (!activeProfile || !activeProfile.apiKey) {
      throw new Error('Chưa cấu hình API AI. Vào Settings → API Key.');
    }

    setLoadingStatus(`${label} — Gửi ${subset.length} entries tới ${activeProfile.label}...`);

    const formattedEntries = subset
      .map(e => `ID: ${e.id}\nComment: ${e.comment}\nKeys: ${e.keys.join(',')}\nContent:\n${e.content}`)
      .join('\n\n---\n\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: MVUZOD_SCHEMA_INFERENCE_PROMPT },
      { role: 'user', content: `Dưới đây là ${subset.length} entries:\n\n${formattedEntries}\n\nPhân tích và trả về JSON.` },
    ];

    let fullText = '';
    let isTruncated = true;
    let callCount = 0;
    let currentMessages = messages;

    while (isTruncated && callCount < 4) {
      // (bugNeedFix/99) Bấm "Dừng quét" giữa chuỗi gọi tiếp thì phải dừng NGAY, không đợi hết 4 lượt.
      if (cancelRef.current) break;
      callCount++;
      if (callCount > 1) setLoadingStatus(`${label} — Tiếp tục phản hồi (lượt ${callCount})...`);

      const response = await callAI({
        profile: activeProfile,
        params: { ...params, useJsonResponseFormat: true },
        messages: currentMessages,
        signal: abortRef.current?.signal,
      });

      fullText += response.text;
      isTruncated = ['MAX_TOKENS', 'max_tokens', 'length'].includes(response.finishReason || '');

      // Đã đọc được schema rồi thì thôi, đừng gọi tiếp cho tốn (finishReason đôi khi báo 'length'
      // dù JSON đã đóng đủ ngoặc).
      if (isTruncated && canParseSchema(fullText)) isTruncated = false;

      if (isTruncated && response.text.trim()) {
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: response.text },
          { role: 'user', content: 'Viết tiếp phần còn thiếu.' },
        ];
      } else {
        isTruncated = false;
      }
    }

    return fullText;
  }, []);

  /**
   * (bugNeedFix/99) Tổng hợp kết quả nhiều batch — KHÔNG gọi AI nữa.
   *
   * Bản cũ nhồi toàn bộ JSON của mọi batch vào một prompt ở chế độ bắt-buộc-JSON rồi nhờ AI merge.
   * Output gần như luôn chạm trần token ⇒ vòng "viết tiếp phần còn thiếu" gửi lại cả lịch sử đang
   * phình, tới 4 lượt, mỗi lượt một chậm — nhìn từ ngoài đúng như user tả: "cứ xong là lại gọi
   * tiếp rồi treo". Mà ở chế độ JSON-object mỗi lượt model buộc trả một object MỚI hoàn chỉnh, nên
   * nối các lượt lại cũng chẳng ra JSON hợp lệ: tốn 4 call to đùng rồi vẫn hỏng.
   *
   * Gộp schema là việc dữ liệu thuần (hợp nhất field theo path, gộp enum, giữ ràng buộc đầy đủ
   * nhất) nên làm bằng code: tức thì, miễn phí, không bao giờ treo.
   */
  const mergeSchemas = useCallback((partialResults: string[]): MVUZODSchema => {
    setLoadingStatus(`Tổng hợp ${partialResults.length} batch (không cần gọi AI)...`);
    const parsed = partialResults.map((raw) => {
      try { return parseSchemaInferenceResponse(raw).proposedSchema; } catch { return null; }
    });
    const merged = mergeInferredSchemas(parsed);
    if (merged.usedCount === 0) {
      throw new Error('Không batch nào trả về schema đọc được — thử giảm số entry mỗi batch rồi quét lại.');
    }
    const skipped = partialResults.length - merged.usedCount;
    setLoadingStatus(
      `Đã gộp ${merged.usedCount}/${partialResults.length} batch → ${merged.schema.fields.length} nhóm biến`
      + (merged.mergedPaths > 0 ? `, hợp nhất ${merged.mergedPaths} biến trùng` : '')
      + (skipped > 0 ? ` (bỏ qua ${skipped} batch lỗi)` : ''),
    );
    return merged.schema;
  }, []);

  const handleAIAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    cancelRef.current = false;
    abortRef.current = new AbortController();
    setScanProgress(null);
    setLoadingStatus('Đang kết nối AI...');

    try {
      let finalText: string;

      if (scanMode === 'all') {
        // ─── Mode 1: Quét tất cả (các entry ĐÃ CHỌN) cùng lúc ───
        finalText = await callAIForEntries(scanEntries, `Quét tất cả (${scanEntries.length})`);
      } else {
        // ─── Mode 2 & 3: Quét từng entry hoặc theo batch (trên các entry ĐÃ CHỌN) ───
        const chunkSize = scanMode === 'single' ? 1 : batchSize;
        const chunks: (typeof scanEntries)[] = [];
        for (let i = 0; i < scanEntries.length; i += chunkSize) {
          chunks.push(scanEntries.slice(i, i + chunkSize));
        }

        const concurrency = scanMode === 'single' ? parallelCount : parallelCount;
        const partialResults: (string | null)[] = new Array(chunks.length).fill(null);
        let completed = 0;
        setScanProgress({ current: 0, total: chunks.length, results: [] });

        // Process chunks with concurrency limit
        for (let wave = 0; wave < chunks.length; wave += concurrency) {
          if (cancelRef.current) break;

          const waveEnd = Math.min(wave + concurrency, chunks.length);
          const waveIndices = Array.from({ length: waveEnd - wave }, (_, k) => wave + k);

          setLoadingStatus(
            concurrency > 1
              ? `Song song ${waveIndices.length} batch (${wave + 1}–${waveEnd}/${chunks.length})...`
              : scanMode === 'single'
                ? `Entry ${wave + 1}/${chunks.length}: ${chunks[wave][0]?.comment || `ID ${chunks[wave][0]?.id}`}`
                : `Batch ${wave + 1}/${chunks.length} (${chunks[wave].length} entries)`
          );

          const wavePromises = waveIndices.map(async (idx) => {
            const chunk = chunks[idx];
            const label = scanMode === 'single'
              ? `Entry ${idx + 1}/${chunks.length}: ${chunk[0]?.comment || `ID ${chunk[0]?.id}`}`
              : `Batch ${idx + 1}/${chunks.length} (${chunk.length} entries)`;
            return { idx, result: await callAIForEntries(chunk, label) };
          });

          const settled = await Promise.allSettled(wavePromises);

          for (const outcome of settled) {
            if (outcome.status === 'fulfilled') {
              partialResults[outcome.value.idx] = outcome.value.result;
              completed++;
            } else {
              console.error('Batch failed:', outcome.reason);
              completed++;
            }
          }

          setScanProgress({
            current: completed,
            total: chunks.length,
            results: partialResults.filter((r): r is string => r !== null),
          });
        }

        // Handle cancel with partial results
        const validResults = partialResults.filter((r): r is string => r !== null);
        if (cancelRef.current) {
          // (bugNeedFix/99) Bấm Dừng mà đã quét được vài batch thì vẫn dùng phần đó — gộp bằng
          // code nên không phải chờ thêm một call AI nào nữa.
          if (validResults.length > 0) {
            await onApplyInferred(mergeSchemas(validResults));
            setLoadingStatus(`Đã dừng — vẫn giữ kết quả của ${validResults.length} batch đã xong.`);
          } else {
            setLoadingStatus('Đã hủy quét.');
          }
          return;
        }

        // Merge results if multiple batches
        if (validResults.length === 0) {
          throw new Error('Không có kết quả nào từ quét.');
        }
        await onApplyInferred(mergeSchemas(validResults));
        return;
      }

      setLoadingStatus('Phân tích phản hồi...');
      const parsed = parseSchemaInferenceResponse(finalText!);
      // (bug 216) Chốt CŨ `if (!parsed.proposedSchema)` là CHỐT CHẾT: normalizeMVUZODSchema không bao
      // giờ trả null, nên schema 0 biến vẫn lọt vào thẻ mà không báo gì — đúng triệu chứng user gặp.
      const usable = assertUsableSchema(parsed.proposedSchema, 'AI Inference');

      await onApplyInferred(usable);
    } catch (err) {
      // Bấm Dừng thì request bị abort — đó là ý user, không phải lỗi để đỏ màn hình.
      const msg = err instanceof Error ? err.message : String(err);
      if (cancelRef.current && /abort/i.test(msg)) setLoadingStatus('Đã dừng quét.');
      else setError(msg);
    } finally {
      setLoading(false);
      setLoadingStatus('');
      setScanProgress(null);
      cancelRef.current = false;
      abortRef.current = null;
    }
  }, [scanEntries, onApplyInferred, scanMode, batchSize, parallelCount, callAIForEntries, mergeSchemas]);

  const handleStaticAnalyze = useCallback(async () => {
    const report = analyzeLorebookForSchema(scanEntries as LorebookEntry[]);
    const minimal = buildMinimalSchemaFromReport(report);
    await onApplyInferred(minimal);
  }, [scanEntries, onApplyInferred]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    // (bugNeedFix/99) Cắt đứt luôn request đang bay. Trước đây chỉ bật cờ, mà cờ chỉ được đọc ở
    // đầu mỗi đợt sóng nên đang chờ một call dài thì bấm mãi không thấy gì.
    abortRef.current?.abort(new Error('Người dùng dừng quét'));
    setLoadingStatus('Đang dừng...');
  }, []);

  // ─── Idea-to-schema state & handler ───
  const [ideaText, setIdeaText] = useState('');
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaStatus, setIdeaStatus] = useState('');

  const IDEA_CHIPS = [
    { label: '⚔️ RPG chiến đấu', text: 'Game RPG chiến đấu với hệ thống HP, MP, cấp độ, kỹ năng, túi đồ, và NPC đồng hành' },
    { label: '🏔️ Tu tiên / Tu luyện', text: 'Card tu tiên tu luyện với cảnh giới, linh lực, kỹ pháp, đan dược, và hệ thống tông môn' },
    { label: '💕 Hẹn hò / Dating sim', text: 'Dating sim với nhiều NPC có cảm xúc, sự kiện hẹn hò, quà tặng, và nhiều route' },
    { label: '🏰 Chiến lược / Đế quốc', text: 'Game chiến lược đế quốc với tài nguyên (vàng/lương/quân), lãnh thổ, ngoại giao, và hội đồng' },
    { label: '🗡️ Dungeon Crawler', text: 'Dungeon crawler với HP, giáp, vũ khí, tầng, boss, bẫy, và kho báu' },
    { label: '🌸 Đời thường', text: 'Slice of life với tâm trạng, sức khỏe, tiền, công việc, mối quan hệ, và thời tiết' },
    { label: '🔍 Trinh thám', text: 'Trinh thám mystery với manh mối, nghi phạm, địa điểm điều tra, và timeline' },
    { label: '💰 Kinh tế', text: 'Kinh tế thương mại với vàng, hàng hóa, danh tiếng, hợp đồng, và thị trường' },
  ];

  const handleIdeaGenerate = useCallback(async () => {
    if (!ideaText.trim()) return;

    setIdeaLoading(true);
    setError(null);
    setIdeaStatus('Đang kết nối AI...');

    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;

      if (!activeProfile || !activeProfile.apiKey) {
        throw new Error('Chưa cấu hình API AI. Vào Settings → API Key.');
      }

      setIdeaStatus(`Đang gửi ý tưởng tới ${activeProfile.label}...`);

      const messages: ChatMessage[] = [
        { role: 'system', content: MVUZOD_IDEA_TO_SCHEMA_PROMPT },
        { role: 'user', content: `Ý TƯỞNG CỦA TÔI:\n\n${ideaText.trim()}\n\nHãy thiết kế MVUZOD schema phù hợp. Trả về JSON.` },
      ];

      let fullText = '';
      let isTruncated = true;
      let callCount = 0;
      let currentMessages = messages;

      while (isTruncated && callCount < 4) {
        callCount++;
        if (callCount > 1) setIdeaStatus(`Tiếp tục phản hồi (lượt ${callCount})...`);

        const response = await callAI({
          profile: activeProfile,
          params: { ...params, useJsonResponseFormat: true },
          messages: currentMessages,
        });

        fullText += response.text;
        isTruncated = ['MAX_TOKENS', 'max_tokens', 'length'].includes(response.finishReason || '');

        if (isTruncated && response.text.trim()) {
          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: response.text },
            { role: 'user', content: 'Viết tiếp phần còn thiếu.' },
          ];
        } else {
          isTruncated = false;
        }
      }

      setIdeaStatus('Phân tích phản hồi...');
      const parsed = parseSchemaInferenceResponse(fullText);
      // (bug 216) xem ghi chú ở handleAIAnalyze — chốt cũ không bao giờ kích hoạt được.
      const usable = assertUsableSchema(parsed.proposedSchema, 'AI Thiết kế Schema');

      await onApplyInferred(usable);
      setIdeaStatus('Tạo schema thành công!');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIdeaLoading(false);
      setTimeout(() => setIdeaStatus(''), 2000);
    }
  }, [ideaText, onApplyInferred]);

  const isAnyLoading = loading || ideaLoading;

  return (
    <div className="p-4 space-y-5">
      {hasExistingSchema && (
        <div className="rounded-lg p-3 border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          Đã có schema. Chọn nguồn mới sẽ <strong>ghi đè</strong> (có snapshot backup).
        </div>
      )}

      {/* Lorebook status + (User 2026) nút chọn entry riêng lẻ */}
      <div className={cn(
        'rounded-lg p-3 border',
        entryCount >= 20 ? 'bg-emerald-500/5 border-emerald-500/20' :
        entryCount >= 5 ? 'bg-amber-500/5 border-amber-500/20' :
        'bg-destructive/5 border-destructive/20',
      )}>
        <div className="flex items-center gap-2 text-xs">
          {entryCount >= 20 ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> :
           <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
          <span className="font-medium">
            {excludedIds.size > 0
              ? `${entryCount}/${entries.length} entries được chọn để quét`
              : `${entryCount} entries trong Lorebook`}
          </span>
          <button
            onClick={() => setShowEntryPicker(v => !v)}
            className="ml-auto px-2 py-0.5 rounded border border-border bg-background/60 text-[10px]
              text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors"
            title="Chọn entry nào được đưa vào quét (card nhiều NPC thì bỏ bớt entry nhân vật cho nhanh + đỡ nhiễu)"
          >
            🎯 Chọn entry {showEntryPicker ? '▴' : '▾'}
          </button>
        </div>

        {/* (User 2026) Danh sách tick chọn entry — card 100 NPC thì quét cả 100 entry nhân vật vừa
            chậm vừa vô ích cho schema; cho user tự chọn entry nào đáng quét. */}
        {showEntryPicker && (
          <div className="mt-2 border-t border-border/50 pt-2">
            <div className="flex items-center gap-2 mb-1.5">
              <button
                onClick={() => setExcludedIds(new Set())}
                className="px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-primary hover:border-primary/30"
              >Chọn hết</button>
              <button
                onClick={() => setExcludedIds(new Set(entries.map(e => e.id)))}
                className="px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-primary hover:border-primary/30"
              >Bỏ hết</button>
              <span className="text-[9px] text-muted-foreground ml-auto">
                {entryCount}/{entries.length} sẽ được quét
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
              {entries.map((e, i) => {
                const checked = !excludedIds.has(e.id);
                return (
                  <label
                    key={`${e.id}-${i}`}
                    className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-primary/5 cursor-pointer text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setExcludedIds(prev => {
                          const next = new Set(prev);
                          if (checked) next.add(e.id); else next.delete(e.id);
                          return next;
                        });
                      }}
                      className="accent-[var(--primary,#f59e0b)]"
                    />
                    <span className={cn('truncate', !checked && 'opacity-40 line-through')}>
                      {e.comment || e.keys.slice(0, 3).join(', ') || `Entry #${e.id}`}
                    </span>
                    <span className="ml-auto text-[9px] text-muted-foreground shrink-0">{(e.content || '').length.toLocaleString()} ký tự</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* AI Inference */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5 text-primary" /> Phân tích AI
        </h4>

        {error && (
          <div className="rounded-lg p-3 border border-destructive/20 bg-destructive/5 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Scan mode selector */}
        {!loading && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Chế độ quét</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { mode: 'all' as ScanMode, icon: Zap, label: 'Tất cả', desc: `Gửi ${entryCount} entries 1 lần` },
                { mode: 'single' as ScanMode, icon: ListOrdered, label: 'Từng entry', desc: 'Quét lần lượt từng cái' },
                { mode: 'batch' as ScanMode, icon: LayoutList, label: 'Theo batch', desc: `Quét mỗi lần N entries` },
              ]).map(({ mode, icon: Icon, label, desc }) => (
                <button
                  key={mode}
                  onClick={() => setScanMode(mode)}
                  className={cn(
                    'flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border text-center transition-all',
                    scanMode === mode
                      ? 'border-primary/50 bg-primary/10 text-primary shadow-sm shadow-primary/10'
                      : 'border-border bg-background/50 text-muted-foreground hover:border-primary/20 hover:bg-primary/5',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[11px] font-medium">{label}</span>
                  <span className="text-[8px] leading-tight opacity-70">{desc}</span>
                </button>
              ))}
            </div>

            {/* Batch size config */}
            {scanMode === 'batch' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/5">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">Số entries / batch:</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, entryCount)}
                  value={batchSize}
                  onChange={e => setBatchSize(Math.max(1, Math.min(entryCount, parseInt(e.target.value) || 1)))}
                  className="w-14 px-2 py-1 text-xs text-center rounded border border-border bg-background
                    focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <span className="text-[9px] text-muted-foreground">
                  = {Math.ceil(entryCount / batchSize)} batch{Math.ceil(entryCount / batchSize) > 1 ? 'es' : ''}
                </span>
              </div>
            )}

            {/* Parallel concurrency config — shown for batch & single modes */}
            {(scanMode === 'batch' || scanMode === 'single') && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-500/20 bg-violet-500/5">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">Song song:</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, scanMode === 'batch' ? Math.ceil(entryCount / batchSize) : entryCount)}
                  value={parallelCount}
                  onChange={e => {
                    const maxP = scanMode === 'batch' ? Math.ceil(entryCount / batchSize) : entryCount;
                    setParallelCount(Math.max(1, Math.min(maxP, parseInt(e.target.value) || 1)));
                  }}
                  className="w-14 px-2 py-1 text-xs text-center rounded border border-border bg-background
                    focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />
                <span className="text-[9px] text-muted-foreground">
                  {parallelCount === 1 ? 'tuần tự' : `${parallelCount} cùng lúc`}
                </span>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg p-4 border border-primary/20 bg-primary/5 flex flex-col items-center gap-3">
            <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-[10px] text-muted-foreground animate-pulse text-center">{loadingStatus}</p>

            {/* Progress bar for batch/single mode */}
            {scanProgress && (
              <div className="w-full space-y-1.5">
                <div className="w-full h-2 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500 ease-out"
                    style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>{scanProgress.current}/{scanProgress.total} {scanMode === 'single' ? 'entries' : 'batches'}</span>
                  <span>{Math.round((scanProgress.current / scanProgress.total) * 100)}%</span>
                </div>
              </div>
            )}

            {/* Cancel button */}
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/30 bg-destructive/10
                text-destructive text-[10px] font-medium hover:bg-destructive/20 transition-colors"
            >
              <Square className="w-3 h-3" /> Dừng quét
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={handleAIAnalyze} disabled={!canAnalyze}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium
                hover:bg-primary/90 disabled:opacity-50 transition-colors">
              <Scan className="w-3.5 h-3.5" />
              {scanMode === 'all' ? 'AI Inference' : scanMode === 'single' ? 'Quét từng entry' : `Quét batch (×${batchSize})`}
            </button>
            <button onClick={handleStaticAnalyze} disabled={!canAnalyze}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-medium
                hover:bg-muted/80 disabled:opacity-50 transition-colors">
              Phân tích tĩnh
            </button>
          </div>
        )}
      </div>

      {/* ─── Idea-to-schema ─── */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400" /> Tạo từ ý tưởng
        </h4>
        <p className="text-[10px] text-muted-foreground">
          Mô tả ý tưởng game/card — AI sẽ thiết kế schema phù hợp, không cần lorebook.
        </p>

        {/* Quick genre chips */}
        <div className="flex flex-wrap gap-1">
          {IDEA_CHIPS.map((chip) => (
            <button
              key={chip.label}
              onClick={() => setIdeaText(prev => prev ? `${prev}\n${chip.text}` : chip.text)}
              disabled={isAnyLoading}
              className="px-2 py-1 rounded-full text-[9px] border border-border bg-background/50
                hover:bg-amber-500/10 hover:border-amber-500/30 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Idea textarea */}
        <textarea
          value={ideaText}
          onChange={e => setIdeaText(e.target.value)}
          disabled={isAnyLoading}
          placeholder={`Mô tả chi tiết ý tưởng card của bạn. Ví dụ:

• Game tu tiên có 9 cảnh giới, hệ thống linh lực, kỹ pháp, đan dược
• Nhân vật chính có HP/MP, inventory, và NPC đồng hành
• Có hệ thống tông môn với ranking và nhiệm vụ
• Muốn track mối quan hệ với 5 NPC chính`}
          className="w-full px-3 py-2.5 text-xs rounded-lg border border-border bg-background
            placeholder:text-muted-foreground/40 resize-y
            focus:outline-none focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400/40 transition-all"
          rows={5}
        />

        {/* Generate button & status */}
        {ideaLoading ? (
          <div className="rounded-lg p-4 border border-amber-500/20 bg-amber-500/5 flex flex-col items-center gap-3">
            <div className="w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <p className="text-[10px] text-muted-foreground animate-pulse text-center">{ideaStatus}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleIdeaGenerate}
              disabled={!ideaText.trim() || isAnyLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500
                text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all
                shadow-sm shadow-amber-500/20"
            >
              <Brain className="w-3.5 h-3.5" /> AI Thiết kế Schema
            </button>
            {ideaStatus && (
              <span className="text-[10px] text-emerald-400">{ideaStatus}</span>
            )}
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-violet-400" /> Templates có sẵn
        </h4>
        <div className="grid grid-cols-2 gap-1.5">
          {MVUZOD_TEMPLATES.map(t => (
            <button key={t.id} onClick={() => onApplyTemplate(t)}
              className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-border bg-background/50
                hover:bg-primary/5 hover:border-primary/30 transition-colors text-left">
              <span className="text-base">{t.icon}</span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium truncate">{t.name}</p>
                <p className="text-[9px] text-muted-foreground truncate">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Create new / JSON import */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-emerald-400" /> Khác
        </h4>
        <div className="flex gap-2">
          <button onClick={onCreateNew}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs
              hover:bg-primary/5 hover:border-primary/30 transition-colors">
            <FolderPlus className="w-3.5 h-3.5" /> Tạo trống
          </button>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.js,.ts,.txt,application/json,text/javascript"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const rawText = await file.text();
                const schema: MVUZODSchema | null = parseSchemaInputText(rawText, file.name);
                if (!schema || !schema.fields) throw new Error(`File "${file.name}" không chứa schema hợp lệ.\nHỗ trợ: Zod schema (.js registerMvuSchema), schema JSON, state values JSON, {schema:{...}}, hoặc character card V3`);
                await onApplyInferred(schema);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : `File "${file.name}" không hợp lệ`);
              }
              e.target.value = '';
            }}
          />
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs
              hover:bg-primary/5 hover:border-primary/30 transition-colors">
            <Upload className="w-3.5 h-3.5" /> Import File JSON
          </button>
          <button onClick={() => setShowJsonImport(!showJsonImport)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
              showJsonImport ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border hover:bg-primary/5 hover:border-primary/30'
            }`}>
            <FileJson className="w-3.5 h-3.5" /> Paste JSON
          </button>
        </div>

        {showJsonImport && (
          <div className="space-y-1.5">
            <textarea
              value={jsonInput}
              onChange={e => setJsonInput(e.target.value)}
              placeholder={'Paste JSON hoặc Zod schema (.js) vào đây. Hỗ trợ:\n• Zod schema: import { registerMvuSchema }...; export const Schema = z.object({...})\n• State JSON: {"Nhân vật chính": {"HP": 100, ...}}\n• Schema: {"version":"1.0","fields":[...]}\n• Full card V3: {"data":{"extensions":{"mvuzod":...}}}'}
              rows={8}
              className="w-full px-3 py-2 text-[10px] font-mono rounded-lg border border-border bg-background
                focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    const schema: MVUZODSchema | null = parseSchemaInputText(jsonInput);
                    if (!schema || !schema.fields) throw new Error('Nội dung không chứa schema hợp lệ.\nHỗ trợ: Zod schema (registerMvuSchema / z.object), schema JSON, state values JSON, {schema:{...}}, hoặc character card V3');
                    await onApplyInferred(schema);
                    setShowJsonImport(false);
                    setJsonInput('');
                    setError(null);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'JSON không hợp lệ';
                    const preview = jsonInput.trim().slice(0, 80);
                    setError(`${msg}\n\nNội dung nhận được (80 ký tự đầu): "${preview}${jsonInput.length > 80 ? '...' : ''}"`);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
              >
                Áp dụng
              </button>
              <span className="text-[9px] text-muted-foreground">
                {jsonInput.length > 0 ? `${jsonInput.length.toLocaleString()} ký tự` : ''}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIELD TREE NODE
// ═══════════════════════════════════════════════════════════════════════════

function FieldTreeNode({
  field,
  depth,
  selectedPath,
  onSelect,
  onDelete,
  onAddChild,
}: {
  field: MVUZODField;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onAddChild: (parentPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = field.children && field.children.length > 0;
  const isObject = field.type === 'object';
  const name = field.path.split('/').pop() ?? field.path;
  const isSelected = selectedPath === field.path;
  const isReadonly = name.startsWith('_') || field.constraints?.readOnly;
  const isHidden = name.startsWith('$') || field.constraints?.hidden;

  const typeColor: Record<string, string> = {
    string: 'text-emerald-400', number: 'text-blue-400', boolean: 'text-amber-400',
    object: 'text-purple-400', record: 'text-orange-400', array: 'text-cyan-400',
  };

  return (
    <div style={{ marginLeft: depth * 12 }}>
      <div
        onClick={() => onSelect(field.path)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer group transition-colors text-xs',
          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50',
        )}
      >
        {hasChildren || isObject ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : <div className="w-3" />}

        <span className="font-medium flex-1 truncate">{name}</span>

        <span className={cn('text-[9px] font-mono', typeColor[field.type] ?? 'text-muted-foreground')}>
          {field.type}
        </span>

        {isReadonly && <Lock className="w-2.5 h-2.5 text-amber-400" />}
        {isHidden && <EyeOff className="w-2.5 h-2.5 text-muted-foreground" />}

        {field.constraints?.clamp && (
          <span className="text-[8px] text-blue-400">[{field.constraints?.clamp[0]},{field.constraints?.clamp[1]}]</span>
        )}

        {isObject && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(field.path); }}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onDelete(field.path); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && hasChildren && field.children!.map(child => (
        <FieldTreeNode
          key={child.path}
          field={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIELD DETAIL EDITOR
// ═══════════════════════════════════════════════════════════════════════════

function SchemaFieldDetail({
  field,
  onUpdate,
  onDelete,
}: {
  field: MVUZODField;
  onUpdate: (updated: MVUZODField) => void;
  onDelete: () => void;
}) {
  const name = field.path.split('/').pop() ?? field.path;

  const updateConstraint = useCallback(<K extends keyof MVUZODConstraints>(key: K, value: MVUZODConstraints[K]) => {
    onUpdate({ ...field, constraints: { ...field.constraints, [key]: value } });
  }, [field, onUpdate]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Code className="w-4 h-4 text-primary" />
          <span className="font-mono">{name}</span>
        </h3>
        <button onClick={onDelete} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
          <Trash2 className="w-3 h-3" /> Xóa
        </button>
      </div>

      {/* Basic */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Tên (label)</label>
          <input
            type="text" value={field.label}
            onChange={e => {
              const newLabel = e.target.value;
              const segments = field.path.split('/');
              segments[segments.length - 1] = newLabel;
              onUpdate({ ...field, label: newLabel, path: segments.join('/') });
            }}
            className="w-full mt-0.5 px-2 py-1.5 text-xs rounded-lg border border-border bg-background
              focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Type</label>
          <select
            value={field.type}
            onChange={e => {
              const newType = e.target.value as MVUZODField['type'];
              const updated = { ...field, type: newType };
              if (newType === 'object' && !updated.children) updated.children = [];
              onUpdate(updated);
            }}
            className="w-full mt-0.5 px-2 py-1.5 text-xs rounded-lg border border-border bg-background"
          >
            {['string', 'number', 'boolean', 'object', 'record', 'array'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Flags */}
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={!!field.constraints?.readOnly}
            onChange={e => updateConstraint('readOnly', e.target.checked || undefined)}
            className="rounded border-border"
          />
          <Lock className="w-3 h-3 text-amber-400" /> Readonly (_)
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={!!field.constraints?.hidden}
            onChange={e => updateConstraint('hidden', e.target.checked || undefined)}
            className="rounded border-border"
          />
          <EyeOff className="w-3 h-3 text-muted-foreground" /> Hidden ($)
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={!!field.constraints?.coerce}
            onChange={e => updateConstraint('coerce', e.target.checked || undefined)}
            className="rounded border-border"
          />
          Coerce
        </label>
      </div>

      {/* Prefault */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">Prefault (giá trị mặc định khi AI bỏ trống)</label>
        <input
          type="text"
          value={String(field.constraints?.prefault ?? '')}
          onChange={e => updateConstraint('prefault', e.target.value || undefined)}
          placeholder="z.string().prefault('...')"
          className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* Describe (for record keys) */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">Describe (mô tả key cho z.record)</label>
        <input
          type="text"
          value={field.constraints?.describe ?? ''}
          onChange={e => updateConstraint('describe', e.target.value || undefined)}
          placeholder="z.string().describe('物品名')"
          className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* Number: clamp */}
      {field.type === 'number' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground font-medium">Clamp Min</label>
            <input
              type="number"
              value={field.constraints?.clamp?.[0] ?? ''}
              onChange={e => {
                const min = Number(e.target.value);
                const max = field.constraints?.clamp?.[1] ?? 100;
                updateConstraint('clamp', [min, max]);
                updateConstraint('transform', 'clamp');
              }}
              className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg border border-border bg-background
                focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-medium">Clamp Max</label>
            <input
              type="number"
              value={field.constraints?.clamp?.[1] ?? ''}
              onChange={e => {
                const min = field.constraints?.clamp?.[0] ?? 0;
                const max = Number(e.target.value);
                updateConstraint('clamp', [min, max]);
                updateConstraint('transform', 'clamp');
              }}
              className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg border border-border bg-background
                focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>
      )}

      {/* Transform */}
      {(field.type === 'record' || field.type === 'array' || field.type === 'object') && (
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Transform (object/record level)</label>
          <select
            value={field.constraints?.transform ?? ''}
            onChange={e => updateConstraint('transform', e.target.value || undefined)}
            className="w-full mt-0.5 px-2 py-1.5 text-xs rounded-lg border border-border bg-background"
          >
            <option value="">Không</option>
            <option value="pickBy">pickBy — Xóa items không hợp lệ</option>
            <option value="takeRight">takeRight — Giữ N items cuối</option>
            <option value="custom">Custom expression</option>
          </select>
          {field.constraints?.transform === 'custom' && (
            <input
              type="text"
              value={field.constraints?.transformExpr ?? ''}
              onChange={e => updateConstraint('transformExpr', e.target.value)}
              placeholder="data => _.pickBy(data, ({ 数量 }) => 数量 > 0)"
              className="w-full mt-1 px-2 py-1.5 text-[10px] font-mono rounded-lg border border-border bg-background
                focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          )}
        </div>
      )}

      {/* Enum values */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">Enum Values (dùng cho z.enum / z.record key)</label>
        <input
          type="text"
          value={(field.constraints?.enumValues ?? []).join(', ')}
          onChange={e => {
            const vals = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            updateConstraint('enumValues', vals.length > 0 ? vals : undefined);
          }}
          placeholder="力量, 敏捷, 体質 (phân cách bằng dấu phẩy)"
          className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* Check Rules */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">
          Check Rules (hướng dẫn AI khi update biến này)
        </label>
        <div className="space-y-1 mt-1">
          {(field.constraints?.checkRules ?? []).map((rule, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground">•</span>
              <input
                type="text" value={rule}
                onChange={e => {
                  const rules = [...(field.constraints?.checkRules ?? [])];
                  rules[i] = e.target.value;
                  updateConstraint('checkRules', rules);
                }}
                className="flex-1 px-2 py-0.5 text-[10px] font-mono rounded border border-border bg-background
                  focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <button onClick={() => {
                const rules = (field.constraints?.checkRules ?? []).filter((_, j) => j !== i);
                updateConstraint('checkRules', rules.length ? rules : undefined);
              }} className="text-muted-foreground hover:text-destructive p-0.5">
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
          <button onClick={() => updateConstraint('checkRules', [...(field.constraints?.checkRules ?? []), ''])}
            className="text-[9px] text-primary hover:text-primary/80 flex items-center gap-0.5">
            <Plus className="w-2.5 h-2.5" /> Thêm rule
          </button>
        </div>
      </div>

      {/* Update Rules fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Update Range (cho biến số)</label>
          <input
            type="text"
            value={field.constraints?.updateRange ?? ''}
            onChange={e => updateConstraint('updateRange', e.target.value || undefined)}
            placeholder="0~100"
            className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg border border-border bg-background
              focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Format (định dạng)</label>
          <input
            type="text"
            value={field.constraints?.updateFormat ?? ''}
            onChange={e => updateConstraint('updateFormat', e.target.value || undefined)}
            placeholder="YYYY-MM-DD HH:MM"
            className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg border border-border bg-background
              focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS PANEL (when no field selected)
// ═══════════════════════════════════════════════════════════════════════════

function ActionsPanel({
  schema,
  onCreateScripts,
  onReset,
}: {
  schema: MVUZODSchema;
  onCreateScripts: () => void;
  onReset: () => void;
}) {
  const [scriptsCreated, setScriptsCreated] = useState(false);

  return (
    <div className="p-4 space-y-5">
      <h3 className="text-sm font-semibold">Actions</h3>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Fields" value={countFields(schema.fields)} />
        <StatCard label="Objects" value={schema.fields.filter(f => f.type === 'object').length} />
        <StatCard label="Records" value={countByType(schema.fields, 'record')} />
      </div>

      {/* Create Scripts */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Code className="w-3.5 h-3.5 text-violet-400" /> Tạo TavernHelper Scripts
        </h4>
        <p className="text-[10px] text-muted-foreground">
          MVU Import + Zod Schema Registration → inject vào card
        </p>
        {scriptsCreated ? (
          <p className="text-[10px] text-emerald-400 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Đã tạo scripts!
          </p>
        ) : (
          <button onClick={() => { onCreateScripts(); setScriptsCreated(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium
              hover:bg-violet-500/90 transition-colors">
            <Code className="w-3.5 h-3.5" /> Tạo Scripts
          </button>
        )}
      </div>

      {/* (bug 216) KIỂM SCHEMA — user xin "thêm cơ chế kiểm tra xem nó có hoạt động không".
          Trước đây tab ghi thẳng schema vào thẻ rồi hiện "Schema loaded", chẳng kiểm gì: schema
          0 biến, không dựng nổi Zod code, tên trùng nhau… đều lọt, tới lúc chơi thật mới lộ. */}
      <SchemaHealthPanel schema={schema} />

      {/* AI Expand Variables */}
      <AIExpandVariables schema={schema} />

      {/* Reset */}
      <button onClick={onReset}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground
          hover:text-foreground hover:bg-muted/50 transition-colors">
        <RotateCcw className="w-3.5 h-3.5" /> Chọn nguồn schema khác
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AI EXPAND VARIABLES (ADD / EDIT / DELETE)
// ═══════════════════════════════════════════════════════════════════════════

const EXPAND_CHIPS = [
  { label: '👥 +NPC Record', text: 'Thêm Record NPC mới với các trường: cấp bậc, chủng tộc, có mặt, quan hệ' },
  { label: '🎒 +Inventory', text: 'Thêm Record túi đồ/inventory với tên vật phẩm, số lượng, mô tả' },
  { label: '⚔️ +Stat số', text: 'Thêm stat số mới (HP, MP, Attack, Defense...) với clamp min/max' },
  { label: '🌟 +Kỹ năng', text: 'Thêm hệ thống kỹ năng với Record kỹ năng: tên, level, cooldown, mô tả' },
  { label: '💕 +Quan hệ', text: 'Thêm hệ thống quan hệ: thiện cảm (number 0-100), trạng thái, sự kiện' },
  { label: '🏠 +Địa điểm', text: 'Thêm hệ thống địa điểm với Record: tên, đã khám phá, mô tả, NPC có mặt' },
  { label: '📋 +Quest', text: 'Thêm hệ thống nhiệm vụ với Record quest: tên, trạng thái, phần thưởng, tiến độ' },
  { label: '⏰ +Thời gian', text: 'Thêm hệ thống thời gian: ngày, giờ, mùa, thời tiết' },
];

const EDIT_CHIPS = [
  { label: '🔧 Đổi type', text: 'Đổi kiểu dữ liệu của biến' },
  { label: '📏 Sửa range', text: 'Sửa lại min/max/clamp cho phù hợp' },
  { label: '🗑️ Dọn dẹp', text: 'Xóa các biến thừa, không dùng, hoặc trùng lặp' },
  { label: '📝 Đổi tên', text: 'Đổi tên (label) các biến cho nhất quán' },
  { label: '🔄 Tái cấu trúc', text: 'Tổ chức lại cấu trúc schema, gộp biến rải rác vào nhóm' },
  { label: '⚡ Tối ưu', text: 'Tối ưu schema: thêm constraints còn thiếu, sửa defaultValue sai' },
];

/** Typed AI actions */
interface SchemaAddAction {
  op: 'add';
  field: MVUZODField;
}
interface SchemaEditAction {
  op: 'edit';
  path: string;
  changes: Partial<Omit<MVUZODField, 'path' | 'children'>>;
}
interface SchemaDeleteAction {
  op: 'delete';
  path: string;
  reason: string;
}
type SchemaAction = SchemaAddAction | SchemaEditAction | SchemaDeleteAction;

type AIOperationMode = 'add' | 'edit' | 'smart';

/**
 * (bug 216) Bảng KIỂM SCHEMA — chạy đúng bộ chốt mà pipeline Auto Creator dùng để chặn schema
 * hỏng, cộng vài phép kiểm rút từ các bug cũ. Bấm một nút là biết schema có chạy được không,
 * thay vì phải xuất thẻ ra SillyTavern rồi mới phát hiện.
 */
function SchemaHealthPanel({ schema }: { schema: MVUZODSchema }) {
  const [report, setReport] = useState<import('../../lib/mvuzod/schemaHealth').SchemaHealthReport | null>(null);

  const run = () => setReport(checkSchemaHealth(schema));

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <h4 className="text-xs font-semibold flex items-center gap-1.5">
        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Kiểm schema
      </h4>
      <p className="text-[10px] text-muted-foreground">
        Soi schema có dựng được Zod code, có biến nào không, tên có trùng nhau không…
      </p>
      <button
        onClick={run}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-600/90 transition-colors"
      >
        <CheckCircle className="w-3.5 h-3.5" /> Kiểm ngay
      </button>

      {report && (
        <div className="space-y-1.5 pt-1">
          <p className={`text-[11px] font-medium ${report.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {summarizeHealth(report)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {report.stats.totalLeaves} biến · {report.stats.maxDepth} tầng · Zod {report.stats.zodCodeChars} ký tự
          </p>
          {report.issues.length > 0 && (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {report.issues.map((iss, i) => (
                <li
                  key={i}
                  className={`text-[10px] leading-snug ${iss.level === 'error' ? 'text-red-400' : iss.level === 'warning' ? 'text-amber-400' : 'text-muted-foreground'}`}
                >
                  {iss.level === 'error' ? '❌' : iss.level === 'warning' ? '⚠️' : 'ℹ️'} {iss.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AIExpandVariables({ schema }: { schema: MVUZODSchema }) {
  const [expandText, setExpandText] = useState('');
  const [mode, setMode] = useState<AIOperationMode>('smart');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setMvuzodSchema = useCardStore(s => s.setMvuzodSchema);
  const createSnapshot = useCardStore(s => s.createSnapshot);

  // Preview state
  const [pendingActions, setPendingActions] = useState<SchemaAction[]>([]);
  const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());
  const [reasoning, setReasoning] = useState('');

  const chips = mode === 'add' ? EXPAND_CHIPS : EDIT_CHIPS;

  // ─── Generate actions from AI ───
  const handleGenerate = useCallback(async () => {
    if (!expandText.trim()) return;
    setLoading(true);
    setError(null);
    setPendingActions([]);
    setSkippedIndices(new Set());
    setReasoning('');
    setStatus('Đang kết nối AI...');

    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!activeProfile?.apiKey) throw new Error('Chưa cấu hình API AI.');

      const schemaDesc = JSON.stringify(schema, null, 2);
      setStatus('Đang gửi schema + mô tả...');

      const isAddOnly = mode === 'add';
      const systemPrompt = isAddOnly ? MVUZOD_EXPAND_VARIABLES_PROMPT : MVUZOD_SCHEMA_EDITOR_PROMPT;

      const userContent = isAddOnly
        ? `SCHEMA HIỆN TẠI:\n${schemaDesc}\n\nYÊU CẦU THÊM BIẾN:\n${expandText.trim()}\n\nHãy thiết kế các fields mới cần thêm. Trả về JSON.`
        : `SCHEMA HIỆN TẠI:\n${schemaDesc}\n\nYÊU CẦU CHỈNH SỬA:\n${expandText.trim()}\n\nHãy phân tích và tạo danh sách actions (add/edit/delete). Trả về JSON.`;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

      const response = await callAI({
        profile: activeProfile,
        params: { ...params, useJsonResponseFormat: true },
        messages,
      });

      setStatus('Phân tích phản hồi...');
      const parsed = parseSchemaInferenceResponse(response.text);

      if (isAddOnly) {
        // Legacy add-only format: { newFields: [...] }
        const newFields = (parsed as Record<string, unknown>).newFields as MVUZODField[] | undefined;
        if (!newFields || !Array.isArray(newFields) || newFields.length === 0) {
          throw new Error('AI không trả về fields mới hợp lệ.');
        }
        const addActions: SchemaAction[] = newFields.map(f => ({ op: 'add' as const, field: f }));
        setPendingActions(addActions);
        setReasoning((parsed as Record<string, unknown>).reasoning as string || '');
        setStatus(`✅ AI đề xuất thêm ${newFields.length} biến. Xem trước bên dưới.`);
      } else {
        // New editor format: { actions: [...] }
        const actions = (parsed as Record<string, unknown>).actions as SchemaAction[] | undefined;
        if (!actions || !Array.isArray(actions) || actions.length === 0) {
          throw new Error('AI không trả về actions hợp lệ.');
        }
        // Validate and type-narrow actions
        const validActions: SchemaAction[] = actions.filter(a => {
          if (!a || typeof a !== 'object' || !('op' in a)) return false;
          if (a.op === 'add') return !!(a as SchemaAddAction).field;
          if (a.op === 'edit') return !!(a as SchemaEditAction).path && !!(a as SchemaEditAction).changes;
          if (a.op === 'delete') return !!(a as SchemaDeleteAction).path;
          return false;
        });
        if (validActions.length === 0) throw new Error('AI không trả về actions hợp lệ.');
        setPendingActions(validActions);
        setReasoning((parsed as Record<string, unknown>).reasoning as string || '');
        const adds = validActions.filter(a => a.op === 'add').length;
        const edits = validActions.filter(a => a.op === 'edit').length;
        const dels = validActions.filter(a => a.op === 'delete').length;
        setStatus(`✅ AI đề xuất: ${adds ? `+${adds} thêm` : ''} ${edits ? `✏️${edits} sửa` : ''} ${dels ? `🗑️${dels} xóa` : ''}`.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }, [expandText, mode, schema]);

  // ─── Apply approved actions ───
  const handleApply = useCallback(async () => {
    const actionsToApply = pendingActions.filter((_, i) => !skippedIndices.has(i));
    if (actionsToApply.length === 0) return;

    await createSnapshot('Trước khi AI chỉnh sửa schema');
    const updatedSchema = structuredClone(schema);

    let added = 0, edited = 0, deleted = 0;

    // Sort: delete → edit → add
    const sorted = [...actionsToApply].sort((a, b) => {
      const order = { delete: 0, edit: 1, add: 2 };
      return order[a.op] - order[b.op];
    });

    for (const action of sorted) {
      switch (action.op) {
        case 'delete': {
          const path = action.path;
          // Delete from root or nested
          updatedSchema.fields = deleteFieldFromTree(updatedSchema.fields, path);
          deleted++;
          break;
        }
        case 'edit': {
          const existing = findFieldByPath(updatedSchema.fields, action.path);
          if (existing) {
            const changes = action.changes;
            if (changes.type !== undefined) existing.type = changes.type as MVUZODField['type'];
            if (changes.label !== undefined) existing.label = changes.label as string;
            if (changes.defaultValue !== undefined) existing.defaultValue = changes.defaultValue;
            if (changes.constraints !== undefined) existing.constraints = { ...existing.constraints, ...(changes.constraints as MVUZODConstraints) };
            if (changes.description !== undefined) existing.description = changes.description as string;
            updatedSchema.fields = updateFieldInTree(updatedSchema.fields, action.path, existing);
            edited++;
          }
          break;
        }
        case 'add': {
          const newField = action.field;
          const parentPath = newField.path.split('/').slice(0, -1).join('/');
          let inserted = false;
          if (parentPath && parentPath !== '') {
            const parent = findFieldByPath(updatedSchema.fields, parentPath);
            if (parent && parent.children) {
              if (!parent.children.some(c => c.path === newField.path)) {
                parent.children.push(newField);
                inserted = true;
              }
            }
          }
          if (!inserted && !updatedSchema.fields.some(f => f.path === newField.path)) {
            updatedSchema.fields.push(newField);
          }
          added++;
          break;
        }
      }
    }

    setMvuzodSchema(updatedSchema);
    const parts = [];
    if (added) parts.push(`+${added} thêm`);
    if (edited) parts.push(`✏️${edited} sửa`);
    if (deleted) parts.push(`🗑️${deleted} xóa`);
    setStatus(`✅ Đã áp dụng: ${parts.join(', ')}`);
    setPendingActions([]);
    setSkippedIndices(new Set());
    setExpandText('');
    setTimeout(() => setStatus(''), 4000);
  }, [pendingActions, skippedIndices, schema, setMvuzodSchema, createSnapshot]);

  const toggleSkip = (index: number) => {
    setSkippedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const activeCount = pendingActions.length - skippedIndices.size;

  // ─── Mode colors ───
  const modeColors = {
    add: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', accent: 'text-emerald-400', btn: 'from-emerald-500 to-teal-500 shadow-emerald-500/20' },
    edit: { border: 'border-amber-500/20', bg: 'bg-amber-500/5', accent: 'text-amber-400', btn: 'from-amber-500 to-orange-500 shadow-amber-500/20' },
    smart: { border: 'border-violet-500/20', bg: 'bg-violet-500/5', accent: 'text-violet-400', btn: 'from-violet-500 to-purple-500 shadow-violet-500/20' },
  };
  const mc = modeColors[mode];

  return (
    <div className={`rounded-lg border ${mc.border} ${mc.bg} p-3 space-y-2.5`}>
      {/* Header */}
      <h4 className="text-xs font-semibold flex items-center gap-1.5">
        <Sparkles className={`w-3.5 h-3.5 ${mc.accent}`} /> AI Chỉnh sửa biến
      </h4>

      {/* Mode tabs */}
      <div className="flex gap-1">
        {([
          { key: 'add' as const, label: '➕ Thêm biến', desc: 'Chỉ thêm mới' },
          { key: 'edit' as const, label: '✏️ Sửa & Xóa', desc: 'Sửa/xóa biến đang có' },
          { key: 'smart' as const, label: '🧠 Thông minh', desc: 'AI tự quyết' },
        ]).map(m => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); setPendingActions([]); setSkippedIndices(new Set()); setError(null); }}
            disabled={loading}
            title={m.desc}
            className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
              mode === m.key
                ? `${modeColors[m.key].border} ${modeColors[m.key].bg} ${modeColors[m.key].accent} border-current`
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            } disabled:opacity-50`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {mode === 'add' && 'Mô tả biến muốn thêm — AI sẽ merge vào schema hiện tại (không ghi đè).'}
        {mode === 'edit' && 'Mô tả biến muốn sửa/xóa — AI sẽ tạo danh sách actions (edit/delete/add).'}
        {mode === 'smart' && 'Mô tả yêu cầu — AI tự quyết thêm/sửa/xóa biến phù hợp.'}
      </p>

      {/* Quick chips */}
      <div className="flex flex-wrap gap-1">
        {chips.map((chip) => (
          <button
            key={chip.label}
            onClick={() => setExpandText(prev => prev ? `${prev}\n${chip.text}` : chip.text)}
            disabled={loading}
            className="px-2 py-0.5 rounded-full text-[9px] border border-border bg-background/50
              hover:bg-muted/50 hover:border-muted-foreground/30 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        value={expandText}
        onChange={e => setExpandText(e.target.value)}
        disabled={loading}
        placeholder={
          mode === 'add'
            ? `VD: Thêm hệ thống kỹ năng gồm 3 slot, mỗi slot có:\n• Tên kỹ năng (string)\n• Level (number 1-10)\n• Cooldown (number 0-99)`
            : mode === 'edit'
              ? `VD: Đổi /Người chơi/HP từ number thành object { hiện tại, tối đa }\nXóa biến /Thời tiết vì không dùng\nThêm trường "Mana" vào /Người chơi`
              : `VD: Tái cấu trúc schema: gộp các stat số rải rác vào 1 object "Chỉ số", thêm hệ thống buff/debuff, xóa biến thừa`
        }
        className={`w-full px-3 py-2 text-xs rounded-lg border border-border bg-background
          placeholder:text-muted-foreground/40 resize-y
          focus:outline-none focus:ring-2 focus:ring-current/20 focus:border-current/40 transition-all ${mc.accent}`}
        rows={3}
      />

      {/* Action button */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className={`w-3.5 h-3.5 animate-spin ${mc.accent}`} />
          <span className="animate-pulse">{status}</span>
        </div>
      ) : pendingActions.length === 0 ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={!expandText.trim()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r ${mc.btn}
              text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed
              transition-all shadow-sm`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {mode === 'add' ? 'AI Thêm biến' : mode === 'edit' ? 'AI Sửa/Xóa biến' : 'AI Phân tích'}
          </button>
          {status && <span className={`text-[10px] ${mc.accent}`}>{status}</span>}
        </div>
      ) : null}

      {/* ─── Preview Panel ─── */}
      {pendingActions.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-border/50">
          {reasoning && (
            <p className="text-[10px] text-muted-foreground italic">
              💭 {reasoning}
            </p>
          )}

          <div className="text-[10px] text-muted-foreground flex items-center justify-between">
            <span>{activeCount}/{pendingActions.length} actions sẽ áp dụng</span>
            <div className="flex gap-1">
              <button
                onClick={() => setSkippedIndices(new Set())}
                className="text-[9px] text-blue-400 hover:underline"
              >Chọn tất cả</button>
              <span className="text-border">|</span>
              <button
                onClick={() => setSkippedIndices(new Set(pendingActions.map((_, i) => i)))}
                className="text-[9px] text-muted-foreground hover:underline"
              >Bỏ chọn tất cả</button>
            </div>
          </div>

          {/* Actions list */}
          <div className="max-h-64 overflow-y-auto space-y-1 scrollbar-thin">
            {pendingActions.map((action, idx) => {
              const skipped = skippedIndices.has(idx);
              const opColor = action.op === 'add' ? 'text-emerald-400' : action.op === 'edit' ? 'text-amber-400' : 'text-red-400';
              const opIcon = action.op === 'add' ? '➕' : action.op === 'edit' ? '✏️' : '🗑️';
              const opLabel = action.op === 'add' ? 'THÊM' : action.op === 'edit' ? 'SỬA' : 'XÓA';

              const path = action.op === 'add' ? action.field.path : action.path;
              const detail = action.op === 'add'
                ? `${action.field.type} — "${action.field.label}"`
                : action.op === 'edit'
                  ? `Sửa: ${Object.keys(action.changes).join(', ')}`
                  : (action.reason || '');

              return (
                <div
                  key={idx}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[10px] transition-all cursor-pointer ${
                    skipped
                      ? 'border-border/30 bg-muted/10 opacity-40'
                      : 'border-border/50 bg-background/50 hover:bg-muted/30'
                  }`}
                  onClick={() => toggleSkip(idx)}
                  title={skipped ? 'Click để chọn lại' : 'Click để bỏ qua'}
                >
                  <input
                    type="checkbox"
                    checked={!skipped}
                    onChange={() => toggleSkip(idx)}
                    className="settings-checkbox flex-shrink-0"
                  />
                  <span className={`font-mono font-bold ${opColor} flex-shrink-0`}>
                    {opIcon} {opLabel}
                  </span>
                  <code className="text-foreground/80 truncate flex-1">{path}</code>
                  {detail && <span className="text-muted-foreground truncate max-w-[150px]">{detail}</span>}
                </div>
              );
            })}
          </div>

          {/* Apply / Cancel */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleApply}
              disabled={activeCount === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r ${mc.btn}
                text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed
                transition-all shadow-sm`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Áp dụng {activeCount} action{activeCount > 1 ? 's' : ''}
            </button>
            <button
              onClick={() => { setPendingActions([]); setSkippedIndices(new Set()); setStatus(''); }}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground
                hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              Hủy
            </button>
            {status && <span className={`text-[10px] ${mc.accent}`}>{status}</span>}
          </div>
        </div>
      )}

      {error && (
        <p className="text-[10px] text-red-400 mt-1" title={error}>
          ❌ {error}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ZOD CODE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function ZodCodePreview({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const fullCode = `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

${code}

$(() => {
  registerMvuSchema(Schema);
});`;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold flex items-center gap-1.5">
          <Code className="w-3.5 h-3.5 text-violet-400" /> Zod Code Output
        </h3>
        <button
          onClick={() => {
            navigator.clipboard.writeText(fullCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Đã copy!' : 'Copy'}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-[#0d1117] p-3 overflow-x-auto">
        <pre className="text-[10px] font-mono text-emerald-300/90 whitespace-pre-wrap leading-relaxed">
          {fullCode}
        </pre>
      </div>

      <div className="rounded-lg bg-muted/20 border border-border p-3 space-y-1">
        <p className="text-[10px] text-muted-foreground">
          <strong>Cách dùng:</strong> Copy code này vào <strong>酒馆助手脚本库 → 角色脚本</strong>, đặt tên &quot;Cấu trúc biến&quot;.
        </p>
        <p className="text-[10px] text-muted-foreground">
          <code>z</code> (Zod 4) và <code>_</code> (Lodash) đã global — <strong>không cần import</strong>.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TREE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function findFieldByPath(fields: MVUZODField[], path: string): MVUZODField | null {
  for (const f of fields) {
    if (f.path === path) return f;
    if (f.children) {
      const found = findFieldByPath(f.children, path);
      if (found) return found;
    }
  }
  return null;
}

function updateFieldInTree(fields: MVUZODField[], path: string, updated: MVUZODField): MVUZODField[] {
  return fields.map(f => {
    if (f.path === path) return updated;
    if (f.children) return { ...f, children: updateFieldInTree(f.children, path, updated) };
    return f;
  });
}

function deleteFieldFromTree(fields: MVUZODField[], path: string): MVUZODField[] {
  return fields.filter(f => f.path !== path).map(f => {
    if (f.children) return { ...f, children: deleteFieldFromTree(f.children, path) };
    return f;
  });
}

function addChildToTree(fields: MVUZODField[], parentPath: string, child: MVUZODField): MVUZODField[] {
  return fields.map(f => {
    if (f.path === parentPath) {
      return { ...f, children: [...(f.children ?? []), child] };
    }
    if (f.children) return { ...f, children: addChildToTree(f.children, parentPath, child) };
    return f;
  });
}

function countFields(fields: MVUZODField[]): number {
  let count = 0;
  for (const f of fields) {
    count++;
    if (f.children) count += countFields(f.children);
  }
  return count;
}

function countByType(fields: MVUZODField[], type: string): number {
  let count = 0;
  for (const f of fields) {
    if (f.type === type) count++;
    if (f.children) count += countByType(f.children, type);
  }
  return count;
}
