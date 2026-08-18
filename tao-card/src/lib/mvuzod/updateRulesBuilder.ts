/**
 * updateRulesBuilder.ts — (bugNeedFix/112) Dựng entry "[mvu_update] Quy tắc cập nhật biến".
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Auto Creator khi tạo Entry MVU Quy tắc cập nhật biến còn hơi chán, nên có cái cập nhật
 * được vào thanh trạng thái, có cái không."
 *
 * Đối chiếu HAI mẫu user gửi kèm:
 *
 *   • Bản Auto Creator sinh — văn xuôi tự do, nhắc tay đôi ba biến:
 *         "Điểm '/Chiến Đấu/VP Hiện Tại': DÙNG op 'delta' để trừ MẠNH…"
 *         "/Túi Đồ/* và /Trấn Minh/Điểm Cống Hiến : Dùng op 'delta'…"
 *     Biến nào được nhắc thì AI trong game biết đường cập nhật; biến nào không được nhắc thì
 *     đứng im mãi — đúng triệu chứng "có cái cập nhật được, có cái không". Nó còn viết đường dẫn
 *     kiểu `/Nhóm/Biến` và dùng dấu `*`, tức là gộp cả cụm chứ không nói rõ từng biến.
 *
 *   • Bản tự làm trong MVUZOD Studio — cây YAML phủ TỪNG biến, mỗi biến có type/range/format và
 *     vài gạch `check:` nói rõ khi nào tăng, khi nào giảm, ràng buộc gì.
 *
 * Gốc rễ: pipeline hỏi AI trả `updateRulesEntry` như một ô chữ tự do, không nêu định dạng, không
 * đòi phủ hết biến — nên chất lượng phụ thuộc hên xui. Trong khi bộ sinh tất định
 * `generateUpdateRulesEntry` vốn ra ĐÚNG format tốt lại chỉ điền được type/range/check khi schema
 * có sẵn các ràng buộc đó (schema do AI sinh thì hầu như không có).
 *
 * File này gộp hai đường: LẤY cây của AI làm nội dung chính (nó viết hay hơn máy), nhưng ĐI QUA
 * TỪNG LÁ của schema để bảo đảm không biến nào bị bỏ sót — thiếu chỗ nào thì tự sinh bù.
 */
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { parseInitVarYaml } from './simulateCard';

export interface LeafRule {
  /** Đường dẫn kiểu "Thế Giới.Ngày" (khớp cách MVU đọc biến). */
  path: string;
  type?: string;
  range?: string;
  format?: string;
  check: string[];
  /** Gạch check lấy được từ bài của AI hay do máy sinh bù. */
  source: 'ai' | 'synth';
}

export interface UpdateRulesResult {
  content: string;
  stats: {
    total: number;
    fromAi: number;
    synthesized: number;
    /** Biến mà AI hoàn toàn không nhắc tới — chính là nhóm "không cập nhật được". */
    missingFromAi: string[];
  };
}

/* ─── Đi hết lá của schema ─── */

function leafName(f: MVUZODField): string {
  return String(f.path || '').split('/').filter(Boolean).pop() ?? '';
}

interface Leaf { field: MVUZODField; path: string[] }

function collectLeaves(fields: MVUZODField[], prefix: string[] = []): Leaf[] {
  const out: Leaf[] = [];
  for (const f of fields ?? []) {
    const name = leafName(f);
    if (!name) continue;
    // Biến readonly (`_`) và ẩn (`$`) không dành cho AI cập nhật — đúng quy ước MVU.
    if (name.startsWith('_') || name.startsWith('$') || f.constraints?.readOnly) continue;
    const p = [...prefix, name];
    if (Array.isArray(f.children) && f.children.length && f.type === 'object') {
      out.push(...collectLeaves(f.children, p));
    } else {
      out.push({ field: f, path: p });
    }
  }
  return out;
}

/* ─── Mô tả kiểu / miền giá trị, suy từ schema ─── */

function describeType(f: MVUZODField): string | undefined {
  if (f.constraints?.updateType) return f.constraints.updateType.split('\n')[0];
  if (f.type === 'number') return 'number';
  if (f.type === 'boolean') return 'boolean';
  if (f.type === 'record') return 'record (túi khoá động)';
  if (f.type === 'array') return 'array';
  return undefined;
}

function describeRange(f: MVUZODField): string | undefined {
  const c = f.constraints ?? {};
  if (c.updateRange) return c.updateRange;
  if (c.clamp) return `${c.clamp[0]}~${c.clamp[1]}`;
  if (typeof c.min === 'number' && typeof c.max === 'number') return `${c.min}~${c.max}`;
  if (typeof c.min === 'number') return `${c.min}~Infinity`;
  if (typeof c.max === 'number') return `-Infinity~${c.max}`;
  // Số không khai biên: mặc định không âm — hợp với hầu hết chỉ số trong thẻ (máu, tiền, điểm).
  if (f.type === 'number') return '0~Infinity';
  return undefined;
}

function describeFormat(f: MVUZODField): string | undefined {
  const c = f.constraints ?? {};
  if (c.updateFormat) return c.updateFormat;
  if (c.enumValues?.length) return `Enum: ${c.enumValues.join(', ')}`;
  return undefined;
}

/**
 * Sinh bù gạch `check:` cho biến mà AI bỏ quên. Không cố viết hay — cốt để MỌI biến đều có
 * hướng dẫn cập nhật, vì biến không có dòng nào là biến sẽ đứng im suốt ván chơi.
 */
export function synthCheck(f: MVUZODField, pathText: string): string[] {
  const c = f.constraints ?? {};
  const desc = (f.description || '').trim();
  const label = (f.label || leafName(f)).trim();
  const out: string[] = [];

  if (desc) out.push(desc.replace(/\s+/g, ' '));

  if (f.type === 'number') {
    out.push(`Dùng op 'delta' để cộng/trừ ${label} theo đúng diễn biến trong lượt (hành động, tiêu hao, phần thưởng); không tự nhảy số khi không có sự kiện tương ứng`);
    const range = describeRange(f);
    if (range) out.push(`Luôn giữ trong khoảng ${range}; chạm biên thì mô tả hệ quả trong truyện thay vì vượt biên`);
  } else if (c.enumValues?.length) {
    out.push(`Dùng op 'replace' và CHỈ chọn một trong các giá trị: ${c.enumValues.join(', ')}`);
    out.push(`Chỉ đổi ${label} khi trong lượt có sự kiện làm nó đổi thật, không đổi tuỳ hứng`);
  } else if (f.type === 'boolean') {
    out.push(`Dùng op 'replace' đặt true/false cho ${label} khi điều kiện bật/tắt xảy ra rõ ràng trong lượt`);
  } else if (f.type === 'record') {
    out.push(`Dùng op 'insert' để thêm mục mới vào ${label}, op 'delete' khi mục đó mất đi`);
    out.push(`Khoá của mục phải là tên/định danh xuất hiện trong truyện, không tự đặt khoá vô nghĩa`);
  } else if (f.type === 'array') {
    out.push(`Dùng op 'insert' để thêm phần tử vào ${label}, op 'delete' để bỏ phần tử không còn đúng`);
  } else {
    out.push(`Dùng op 'replace' cập nhật ${label} khi nội dung của nó thay đổi trong lượt`);
    out.push(`Giữ nguyên nếu lượt này không có gì tác động tới ${pathText}`);
  }
  return out.filter(Boolean);
}

/* ─── Bóc cây quy tắc mà AI trả về ─── */

/** Chuẩn hoá một nút thành LeafRule (nếu nó thật sự là nút lá có nội dung quy tắc). */
function nodeToRule(node: unknown, path: string[]): LeafRule | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const o = node as Record<string, unknown>;
  const rawCheck = o.check ?? o.checks ?? o.rules;
  const check = Array.isArray(rawCheck)
    ? rawCheck.map(v => String(v).trim()).filter(Boolean)
    : typeof rawCheck === 'string' && rawCheck.trim() ? [rawCheck.trim()] : [];
  const type = o.type !== undefined ? String(o.type) : undefined;
  const range = o.range !== undefined ? String(o.range) : undefined;
  const format = o.format !== undefined ? String(o.format) : undefined;
  if (check.length === 0 && !type && !range && !format) return null;
  return { path: path.join('.'), type, range, format, check, source: 'ai' };
}

/**
 * Đọc bài của AI thành bảng tra "đường dẫn biến → quy tắc".
 * Chấp cả cây có bọc `Quy tắc cập nhật biến:` lẫn cây trần.
 */
export function parseAiUpdateRules(text: string): Map<string, LeafRule> {
  const map = new Map<string, LeafRule>();
  const raw = String(text || '').trim();
  if (!raw) return map;

  let tree: Record<string, unknown>;
  try { tree = parseInitVarYaml(raw.replace(/^---\s*$/gm, '')); } catch { return map; }

  const roots = Object.keys(tree).length === 1 && /quy tắc|update rule/i.test(Object.keys(tree)[0])
    ? (tree[Object.keys(tree)[0]] as Record<string, unknown>) ?? {}
    : tree;

  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const rule = nodeToRule(node, path);
    if (rule && path.length > 0) { map.set(rule.path, rule); return; }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, [...path, k]);
    }
  };
  walk(roots, []);
  return map;
}

/* ─── Dựng entry ─── */

function renderRule(rule: LeafRule, indent: number): string[] {
  const p = '  '.repeat(indent);
  const out: string[] = [];
  if (rule.type) out.push(`${p}  type: ${rule.type}`);
  if (rule.range) out.push(`${p}  range: ${rule.range}`);
  if (rule.format) out.push(`${p}  format: ${rule.format}`);
  if (rule.check.length) {
    out.push(`${p}  check:`);
    for (const c of rule.check) out.push(`${p}    - ${c}`);
  }
  return out;
}

/**
 * Dựng nội dung entry, phủ ĐỦ mọi biến của schema.
 * `aiText` là bài AI viết (nếu có) — dùng làm nội dung chính vì nó bám cốt truyện; biến nào AI
 * bỏ quên thì máy sinh bù để không còn biến nào "đứng im".
 */
export function buildUpdateRulesEntry(schema: MVUZODSchema, aiText?: string): UpdateRulesResult {
  const leaves = collectLeaves(schema?.fields ?? []);
  const ai = parseAiUpdateRules(aiText || '');

  const rules: LeafRule[] = [];
  const missingFromAi: string[] = [];
  for (const leaf of leaves) {
    const key = leaf.path.join('.');
    const got = ai.get(key);
    if (got && got.check.length > 0) {
      rules.push({
        ...got,
        path: key,
        // Thiếu type/range/format thì lấp bằng thông tin có sẵn trong schema.
        type: got.type ?? describeType(leaf.field),
        range: got.range ?? describeRange(leaf.field),
        format: got.format ?? describeFormat(leaf.field),
      });
    } else {
      missingFromAi.push(key);
      rules.push({
        path: key,
        type: describeType(leaf.field),
        range: describeRange(leaf.field),
        format: describeFormat(leaf.field),
        check: synthCheck(leaf.field, key),
        source: 'synth',
      });
    }
  }

  // Dựng lại cây theo đúng thứ tự schema.
  const lines: string[] = ['---', 'Quy tắc cập nhật biến:'];
  const emitted = new Set<string>();
  for (const rule of rules) {
    const parts = rule.path.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const prefix = parts.slice(0, i + 1).join('.');
      if (emitted.has(prefix)) continue;
      emitted.add(prefix);
      lines.push(`${'  '.repeat(i + 1)}${parts[i]}:`);
    }
    const depth = parts.length;
    lines.push(`${'  '.repeat(depth)}${parts[depth - 1]}:`);
    lines.push(...renderRule(rule, depth));
  }

  return {
    content: lines.join('\n'),
    stats: {
      total: rules.length,
      fromAi: rules.filter(r => r.source === 'ai').length,
      synthesized: rules.filter(r => r.source === 'synth').length,
      missingFromAi,
    },
  };
}

/**
 * Soi một entry quy tắc CÓ SẴN xem thiếu biến nào của schema.
 * Dùng cho bước kiểm tổng thể: biến không có quy tắc = biến sẽ không bao giờ được cập nhật.
 */
export function findVarsMissingRules(schema: MVUZODSchema, rulesText: string): string[] {
  const leaves = collectLeaves(schema?.fields ?? []);
  const text = String(rulesText || '');
  const parsed = parseAiUpdateRules(text);
  return leaves
    .map(l => l.path.join('.'))
    .filter((p) => {
      if (parsed.has(p)) return false;
      // Bài viết dạng văn xuôi: coi là "có nhắc" nếu tên biến (lá) xuất hiện trong bài.
      const leafOnly = p.split('.').pop()!;
      return !text.includes(p) && !text.includes(p.replace(/\./g, '/')) && !text.includes(leafOnly);
    });
}
