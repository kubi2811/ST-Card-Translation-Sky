/**
 * src/lib/mvuzod/turnSimulator.ts — (bug 224) MÔ PHỎNG NHIỀU LƯỢT CHƠI TRÊN SCHEMA.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "đại tu lại các tab đang khá vô dụng như Playground, Patch…".
 *
 * Tab Patch đã sửa xong (mẫu dựng từ schema thật). Nhưng Playground thì VỐN TRÙNG Patch: nó có
 * đúng hai panel, panel thứ hai cũng là "dán patch rồi áp" — làm lại việc của tab Patch, chỉ
 * khác chỗ ngồi. Thêm một bản sao thì không "đại tu" được gì.
 *
 * Thứ CÒN THIẾU trong cả hai tab là câu hỏi thật của người làm thẻ MVU: "chạy vài lượt liên tiếp
 * thì trạng thái có còn đúng không?". Một patch lẻ luôn trông ổn; hỏng chỉ lộ ra khi cộng dồn:
 *   • `delta` cộng máu mãi thành vượt max, hoặc trừ xuống âm — mà MVU KHÔNG tự kẹp biên;
 *   • lượt sau ghi vào đường dẫn mà lượt trước đã `remove`;
 *   • AI bịa đường dẫn không có trong schema (MVU lặng lẽ bỏ qua, chỉ số đứng yên);
 *   • mảng bị `insert` không giới hạn, phình mãi cho tới lúc ngốn hết ngữ cảnh.
 * Module này chạy tuần tự nhiều khối `<UpdateVariable>` từ trạng thái đầu và soi ĐÚNG bốn thứ
 * đó sau MỖI lượt, nên tab Playground trở thành thứ Patch không làm được.
 *
 * Hàm THUẦN, không đụng React/store — test được và dùng lại được ở chỗ khác.
 */

import type { MVUZODSchema, MVUZODField, JSONPatchOp } from '../../types/mvuzod.types';
import { extractPatches } from './patchExtractor';
import { applyPatches } from './jsonPatchEngine';

export interface SimIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface SimTurn {
  /** Lượt thứ mấy (1-based) — hiện cho user đếm. */
  turn: number;
  /** Số thao tác bóc được từ khối của lượt này. */
  opsFound: number;
  /** Số thao tác MVU áp được thật. */
  opsApplied: number;
  /** Lỗi/cảnh báo phát sinh Ở LƯỢT NÀY (không lặp lại của lượt trước). */
  issues: SimIssue[];
  /** Trạng thái SAU lượt này. */
  state: Record<string, unknown>;
}

export interface SimResult {
  turns: SimTurn[];
  /** Trạng thái cuối cùng. */
  finalState: Record<string, unknown>;
  /** Tổng lỗi + cảnh báo của cả phiên. */
  totalIssues: number;
}

/** Bảng tra ràng buộc theo đường dẫn JSON Pointer, để soi biên sau mỗi lượt. */
interface LeafSpec {
  type: string;
  min?: number;
  max?: number;
  label: string;
}

function collectSpecs(fields: MVUZODField[] | undefined, base = '', out = new Map<string, LeafSpec>()): Map<string, LeafSpec> {
  for (const f of fields ?? []) {
    const name = f.label || f.path || '';
    if (!name) continue;
    const path = `${base}/${name}`;
    const kids = (f as unknown as { children?: MVUZODField[] }).children;
    if (kids?.length) {
      collectSpecs(kids, path, out);
    } else {
      const c = (f as unknown as { constraints?: { min?: number; max?: number } }).constraints;
      out.set(path, { type: String(f.type || 'string'), min: c?.min, max: c?.max, label: name });
    }
  }
  return out;
}

/** Đọc giá trị theo JSON Pointer (/A/B). Trả undefined nếu đường dẫn không tới đâu. */
function readPointer(state: Record<string, unknown>, pointer: string): unknown {
  const parts = pointer.split('/').filter(Boolean);
  let cur: unknown = state;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Ngưỡng mảng phình — quá đây thì bảng trạng thái/ngữ cảnh bắt đầu bị ngốn. */
const ARRAY_BLOAT = 50;

/**
 * Soi trạng thái SAU một lượt: biên số, mảng phình, kiểu lệch.
 * Chỉ báo những chỗ ĐỔI trong lượt này (dựa vào danh sách op) — không thì mỗi lượt lại in lại
 * cùng một cảnh báo và bảng kết quả thành vô nghĩa.
 */
export function auditStateAfterTurn(
  state: Record<string, unknown>,
  ops: JSONPatchOp[],
  specs: Map<string, LeafSpec>,
): SimIssue[] {
  const issues: SimIssue[] = [];
  const touched = new Set<string>();
  for (const op of ops) {
    const p = 'path' in op ? String(op.path) : '';
    if (p) touched.add(p.replace(/\/-$/, ''));
  }

  for (const pointer of touched) {
    const spec = specs.get(pointer);
    if (!spec) {
      // MVU lặng lẽ bỏ qua đường dẫn không có trong schema — user chỉ thấy "chỉ số không nhúc nhích".
      issues.push({
        level: 'error', path: pointer,
        message: `Đường dẫn "${pointer}" KHÔNG có trong schema — MVU sẽ lặng lẽ bỏ qua, chỉ số không đổi.`,
      });
      continue;
    }
    const value = readPointer(state, pointer);

    if (spec.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.push({ level: 'error', path: pointer, message: `"${spec.label}" phải là số nhưng đang là ${typeof value}.` });
      } else {
        // MVU KHÔNG tự kẹp biên: delta cộng mãi là vượt max, trừ mãi là âm.
        if (spec.max !== undefined && value > spec.max) {
          issues.push({ level: 'error', path: pointer, message: `"${spec.label}" = ${value} VƯỢT max ${spec.max} — MVU không tự kẹp, giá trị này sẽ đi thẳng vào thẻ.` });
        }
        if (spec.min !== undefined && value < spec.min) {
          issues.push({ level: 'error', path: pointer, message: `"${spec.label}" = ${value} DƯỚI min ${spec.min}.` });
        }
      }
    }

    if (spec.type === 'array' && Array.isArray(value) && value.length > ARRAY_BLOAT) {
      issues.push({
        level: 'warning', path: pointer,
        message: `"${spec.label}" đã ${value.length} phần tử — mảng chỉ insert mà không bao giờ remove sẽ phình mãi và ngốn hết ngữ cảnh. Cân nhắc quy tắc cắt bớt.`,
      });
    }

    if (spec.type === 'boolean' && value !== undefined && typeof value !== 'boolean') {
      issues.push({ level: 'error', path: pointer, message: `"${spec.label}" phải là true/false nhưng đang là ${typeof value}.` });
    }
  }

  return issues;
}

/**
 * Chạy tuần tự nhiều lượt. Mỗi phần tử `rawTurns` là văn bản một lượt AI (có thể là cả đoạn kể
 * kèm khối `<UpdateVariable>` — patchExtractor tự bóc). Lượt không có thao tác nào vẫn được ghi
 * lại để user thấy "lượt này AI không cập nhật gì".
 */
export function simulateTurns(
  schema: MVUZODSchema | null | undefined,
  initialState: Record<string, unknown>,
  rawTurns: string[],
  mode: 'strict' | 'lenient' = 'lenient',
): SimResult {
  const specs = collectSpecs(schema?.fields);
  const turns: SimTurn[] = [];
  let state = structuredClone(initialState);

  rawTurns.forEach((raw, i) => {
    const { ops } = extractPatches(raw ?? '');
    if (ops.length === 0) {
      turns.push({ turn: i + 1, opsFound: 0, opsApplied: 0, issues: [], state: structuredClone(state) });
      return;
    }

    const issues: SimIssue[] = [];
    if (schema) {
      const r = applyPatches(state, ops, schema, mode);
      state = r.newState;
      for (const e of r.errors) {
        issues.push({ level: 'error', path: e.path, message: `${e.op}: ${e.reason}` });
      }
      issues.push(...auditStateAfterTurn(state, ops, specs));
      turns.push({ turn: i + 1, opsFound: ops.length, opsApplied: r.appliedOps, issues, state: structuredClone(state) });
    } else {
      turns.push({
        turn: i + 1, opsFound: ops.length, opsApplied: 0,
        issues: [{ level: 'error', path: '', message: 'Chưa có schema — không áp được thao tác nào.' }],
        state: structuredClone(state),
      });
    }
  });

  return {
    turns,
    finalState: state,
    totalIssues: turns.reduce((s, t) => s + t.issues.length, 0),
  };
}

/** Tách văn bản nhiều lượt: ngăn nhau bằng dòng `---` (dễ gõ, dễ đọc). */
export function splitTurns(text: string): string[] {
  return String(text ?? '')
    .split(/^\s*---+\s*$/m)
    .map(s => s.trim())
    .filter(Boolean);
}
