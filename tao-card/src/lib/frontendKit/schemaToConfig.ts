/**
 * schemaToConfig — từ schema MVUZOD ra cấu hình giao diện front-end (bug 192).
 * ─────────────────────────────────────────────────────────────────────────────
 * Đây là chỗ nối giữa Tạo Card và bộ front-end. Toàn bộ suy diễn ở đây bám vào schema
 * THẬT của thẻ, không bịa trường nào: sai một chữ hoa trong đường dẫn là lệnh cập nhật
 * biến của AI trượt êm, không lỗi, chỉ mất dữ liệu (xem bug 192 phần vá khối cập nhật).
 */
import type { MVUZODSchema, MVUZODField, InitVarConfig } from '../../types/mvuzod.types';
import type {
  StfeConfig, StfeFormField, StfePanel, StfePanelField, StfeHeaderSpec,
  FrontendKitOptions, StfeThemePreset,
} from './types';

/* ── đi trong schema ─────────────────────────────────────────────────────── */

export interface FlatField {
  /** JSON Pointer gốc trong schema: "/Nhân Vật/VP/Hiện Tại". */
  pointer: string;
  /** Đường dẫn kiểu chấm mà runtime dùng: "Nhân Vật.VP.Hiện Tại". */
  dotPath: string;
  label: string;
  type: MVUZODField['type'];
  enumValues?: string[];
  defaultValue: unknown;
  min?: number;
  max?: number;
  /** Nhóm cấp cao nhất, để xếp tab. */
  root: string;
  depth: number;
}

const segmentsOf = (pointer: string) => String(pointer || '').split('/').filter(Boolean);

/** Duyệt cây schema, trả về mọi trường LÁ vô hướng (bỏ qua bên trong mảng/record). */
export function flattenScalarFields(schema: MVUZODSchema | null): FlatField[] {
  const out: FlatField[] = [];
  const walk = (fields: MVUZODField[] | undefined) => {
    for (const f of fields || []) {
      const segs = segmentsOf(f.path);
      if (f.type === 'object' && f.children?.length) { walk(f.children); continue; }
      if (f.type === 'array' || f.type === 'record' || f.type === 'object') continue;
      out.push({
        pointer: f.path,
        dotPath: segs.join('.'),
        label: f.label || segs[segs.length - 1] || f.path,
        type: f.type,
        enumValues: f.constraints?.enumValues,
        defaultValue: f.defaultValue,
        min: f.constraints?.min,
        max: f.constraints?.max,
        root: segs[0] || '',
        depth: segs.length,
      });
    }
  };
  walk(schema?.fields);
  return out;
}

/** Các trường cấp cao nhất, giữ nguyên thứ tự schema — mỗi cái thành một tab. */
export function topLevelFields(schema: MVUZODSchema | null): MVUZODField[] {
  return (schema?.fields || []).filter((f) => segmentsOf(f.path).length === 1);
}

/* ── đoán cột cho danh sách ──────────────────────────────────────────────── */

const NAME_HINTS = ['tên', 'ten', 'name', 'tiêu đề', 'title', 'nhãn', 'label'];
const DESC_HINTS = ['mô tả', 'mo ta', 'desc', 'description', 'ghi chú', 'ghi chu', 'note'];
const QTY_HINTS = ['số lượng', 'so luong', 'qty', 'quantity', 'level', 'cấp', 'cap', 'mức độ', 'muc do'];

const norm = (s: string) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

function pickByHint(keys: string[], hints: string[]): string | undefined {
  for (const h of hints) {
    const hit = keys.find((k) => norm(k) === norm(h));
    if (hit) return hit;
  }
  for (const h of hints) {
    const hit = keys.find((k) => norm(k).includes(norm(h)));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Lấy tên các trường con của một phần tử mảng. Schema mô tả mảng bằng `children`
 * (kiểu phần tử) hoặc bằng `defaultValue` là mảng mẫu — đọc cả hai.
 */
function itemKeysOf(field: MVUZODField): string[] {
  const fromChildren = (field.children || []).map((c) => segmentsOf(c.path).pop() || '').filter(Boolean);
  if (fromChildren.length) return fromChildren;
  const sample = Array.isArray(field.defaultValue) ? field.defaultValue[0] : null;
  if (sample && typeof sample === 'object') return Object.keys(sample as Record<string, unknown>);
  return [];
}

/* ── sinh các mảnh cấu hình ──────────────────────────────────────────────── */

const EMOJI_BY_INDEX = ['🧬', '🎒', '⚡', '🤝', '🌍', '💠', '📦', '🗺️', '🏅', '🔮'];

export function buildPanels(schema: MVUZODSchema | null): StfePanel[] {
  const panels: StfePanel[] = [{ id: 'chat', label: '📜 Nhật ký', type: 'chat' }];
  const scalars = flattenScalarFields(schema);

  topLevelFields(schema).forEach((f, i) => {
    const root = segmentsOf(f.path)[0];
    const emoji = EMOJI_BY_INDEX[i % EMOJI_BY_INDEX.length];
    const id = 'p' + i;

    if (f.type === 'array') {
      const keys = itemKeysOf(f);
      const nameKey = pickByHint(keys, NAME_HINTS) || keys[0] || 'Tên';
      const descKey = pickByHint(keys, DESC_HINTS);
      const tagKey = pickByHint(keys, QTY_HINTS);
      const rest = keys.filter((k) => k !== nameKey && k !== descKey && k !== tagKey);
      panels.push({
        id, label: `${emoji} ${f.label || root}`, type: 'list',
        path: root,
        name: nameKey,
        ...(tagKey ? { tag: tagKey } : {}),
        ...(descKey ? { desc: descKey } : {}),
        note: rest.slice(0, 3).map((k) => ({ k, p: k })),
        empty: `Chưa có ${String(f.label || root).toLowerCase()}.`,
      });
      return;
    }

    const fields: StfePanelField[] = scalars
      .filter((s) => s.root === root)
      .map((s) => ({
        k: s.label,
        p: s.dotPath,
        ...(s.type === 'string' ? { hideEmpty: false } : {}),
      }));
    if (!fields.length) return;
    panels.push({ id, label: `${emoji} ${f.label || root}`, type: 'fields', fields });
  });

  return panels;
}

/**
 * Bảng đường dẫn hợp lệ gửi kèm mỗi lượt.
 *
 * Đo được khi chạy thật: không đưa bảng này thì mô hình bịa ra đường dẫn (`/Thời gian`),
 * MVU lặng lẽ bỏ qua, và người chơi chỉ thấy chỉ số không nhúc nhích. Đưa bảng vào rẻ hơn
 * nhiều so với đi dò tìm về sau.
 */
export function buildPathTable(schema: MVUZODSchema | null): string[] {
  const lines: string[] = [];
  const scalars = flattenScalarFields(schema);

  topLevelFields(schema).forEach((f) => {
    const root = segmentsOf(f.path)[0];
    if (f.type === 'array') {
      const keys = itemKeysOf(f);
      lines.push(`/${root}/- (thêm mới) hoặc /${root}/<số> (sửa)`
        + (keys.length ? ` — mỗi mục đủ các trường: ${keys.join(', ')}` : ''));
      return;
    }
    const paths = scalars.filter((s) => s.root === root).map((s) => s.pointer);
    if (paths.length) lines.push(paths.join(' · '));
  });

  if (lines.length) {
    lines.push('Số thì dùng delta để cộng trừ. Thêm phần tử vào danh sách thì dùng dấu gạch'
      + ' ngang làm chỉ số. Không có đường dẫn nào khác ngoài bảng trên.');
  }
  return lines;
}

export function buildFormFields(schema: MVUZODSchema | null, wantedDotPaths: string[]): StfeFormField[] {
  const byPath = new Map(flattenScalarFields(schema).map((f) => [f.dotPath, f]));
  const out: StfeFormField[] = [];
  wantedDotPaths.forEach((p, i) => {
    const f = byPath.get(p);
    if (!f) return;
    const key = 'f' + i;
    if (f.enumValues?.length) {
      out.push({
        key, label: f.label, type: 'select', path: f.dotPath,
        value: String(f.defaultValue ?? f.enumValues[0]), options: f.enumValues,
      });
    } else if (f.type === 'number') {
      out.push({
        key, label: f.label, type: 'number', path: f.dotPath,
        value: Number(f.defaultValue ?? 0),
        ...(f.min !== undefined ? { min: f.min } : {}),
        ...(f.max !== undefined ? { max: f.max } : {}),
      });
    } else {
      out.push({
        key, label: f.label, type: 'text', path: f.dotPath,
        value: String(f.defaultValue ?? ''),
        placeholder: `Nhập ${String(f.label).toLowerCase()}…`,
      });
    }
  });
  return out;
}

export function buildHeaderSpec(
  schema: MVUZODSchema | null,
  opts: Pick<FrontendKitOptions, 'namePath' | 'chipPaths' | 'bars'>,
): StfeHeaderSpec {
  const byPath = new Map(flattenScalarFields(schema).map((f) => [f.dotPath, f]));
  return {
    namePath: opts.namePath,
    chips: opts.chipPaths
      .filter((p) => byPath.has(p))
      .map((p) => ({ k: byPath.get(p)!.label, tpl: `{${p}}` })),
    money: [],
    bars: opts.bars
      .filter((b) => byPath.has(b.cur) && byPath.has(b.max))
      .map((b) => ({ ...b, color: 'linear-gradient(90deg,var(--fe-accent),var(--fe-accent-2))' })),
  };
}

/** Trạng thái khởi đầu — lấy từ InitVar đang chọn, đó mới là nguồn sự thật của thẻ. */
export function buildDefaultStat(
  schema: MVUZODSchema | null,
  initVar: InitVarConfig | null,
): Record<string, unknown> {
  const active = initVar?.entries?.find((e) => e.id === initVar.activeEntryId)
    ?? initVar?.entries?.find((e) => e.isDefault)
    ?? initVar?.entries?.[0];
  if (active?.data && Object.keys(active.data).length) return JSON.parse(JSON.stringify(active.data));

  // Chưa dựng InitVar thì dựng tạm từ defaultValue của schema — vẫn hơn là để rỗng, vì
  // rỗng nghĩa là mọi mảng không tồn tại và lệnh insert của AI sẽ trượt (xem bug 192).
  const stat: Record<string, unknown> = {};
  const put = (dot: string, v: unknown) => {
    const parts = dot.split('.');
    let cur = stat as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = v;
  };
  flattenScalarFields(schema).forEach((f) => put(f.dotPath, f.defaultValue ?? (f.type === 'number' ? 0 : '')));
  topLevelFields(schema).forEach((f) => {
    if (f.type === 'array') stat[segmentsOf(f.path)[0]] = Array.isArray(f.defaultValue) ? f.defaultValue : [];
    if (f.type === 'record') stat[segmentsOf(f.path)[0]] = f.defaultValue ?? {};
  });
  return stat;
}

/* ── bảng màu ────────────────────────────────────────────────────────────── */

export const THEME_PRESETS: StfeThemePreset[] = [
  {
    id: 'veil', label: 'Veil — xanh lam công nghệ',
    vars: { '--fe-accent': '#4dd6c1', '--fe-accent-2': '#7aa2ff', '--fe-bg': '#0a1119', '--fe-bg-soft': '#0f1b28', '--fe-panel': '#13202f', '--fe-panel-2': '#182b3f', '--fe-line': '#26405c' },
  },
  {
    id: 'ember', label: 'Ember — đỏ lửa',
    vars: { '--fe-accent': '#f0a35e', '--fe-accent-2': '#e0655c', '--fe-bg': '#170f0c', '--fe-bg-soft': '#221512', '--fe-panel': '#2a1a15', '--fe-panel-2': '#38221b', '--fe-line': '#5a3626' },
  },
  {
    id: 'jade', label: 'Jade — lục tiên hiệp',
    vars: { '--fe-accent': '#7fd6a0', '--fe-accent-2': '#c9e58a', '--fe-bg': '#0b150f', '--fe-bg-soft': '#111f17', '--fe-panel': '#15271c', '--fe-panel-2': '#1d3526', '--fe-line': '#2f5340' },
  },
  {
    id: 'parchment', label: 'Giấy cũ — cổ điển',
    vars: { '--fe-accent': '#8b5e34', '--fe-accent-2': '#a8763f', '--fe-bg': '#f3e7d0', '--fe-bg-soft': '#e9dcc2', '--fe-panel': '#e2d3b5', '--fe-panel-2': '#d8c6a3', '--fe-line': '#b9a179', '--fe-text': '#3c2f22', '--fe-text-dim': '#6b5842' },
  },
  {
    id: 'void', label: 'Hư không — tím tối',
    vars: { '--fe-accent': '#b592ff', '--fe-accent-2': '#66d9e8', '--fe-bg': '#0d0a16', '--fe-bg-soft': '#151024', '--fe-panel': '#1b1430', '--fe-panel-2': '#251b40', '--fe-line': '#3d2f63' },
  },
];

/* ── ghép lại thành cấu hình hoàn chỉnh ──────────────────────────────────── */

export function buildStfeConfig(
  schema: MVUZODSchema | null,
  initVar: InitVarConfig | null,
  opts: FrontendKitOptions,
): StfeConfig {
  const theme = THEME_PRESETS.find((t) => t.id === opts.themeId) ?? THEME_PRESETS[0];
  return {
    id: (opts.bootTag || 'card').toLowerCase().replace(/[^a-z0-9]/g, '') || 'card',
    title: opts.title,
    subtitle: opts.subtitle,
    updateTag: opts.updateTag,
    bootTag: opts.bootTag,
    historyTurns: opts.historyTurns,
    maxStoredTurns: 400,
    maxSnapshots: 6,
    theme: theme.vars,
    defaultStat: buildDefaultStat(schema, initVar),
    form: buildFormFields(schema, opts.formPaths),
    derive: opts.derive || [],
    scenarios: opts.scenarios,
    ...(opts.scenarioPath ? { scenarioPath: opts.scenarioPath } : {}),
    freeNote: {
      label: 'Ghi chú / yêu cầu riêng cho Quản Trò',
      placeholder: 'VD: giọng kể lạnh, ít hài; muốn có một NPC đồng hành…',
    },
    headerSpec: buildHeaderSpec(schema, opts),
    panels: buildPanels(schema),
    pathTable: buildPathTable(schema),
    quickActions: opts.quickActions,
    ...(opts.openingExtra ? { openingExtra: opts.openingExtra } : {}),
  };
}

/**
 * Tuần tự hoá cấu hình thành mã nguồn nhúng được.
 *
 * Dùng `JSON.stringify` chứ không tự ghép chuỗi: cấu hình chứa đầy chữ tiếng Việt và dấu
 * nháy của người dùng, ghép tay là vỡ. Và vì runtime đã có sẵn bản tổng quát chạy bằng dữ
 * liệu, ở đây không phải sinh một dòng logic nào.
 */
export function serializeConfig(config: StfeConfig): string {
  return '/* Cấu hình do Tạo Card sinh ra — sửa trong tab Front-End, đừng sửa tay ở đây. */\n'
    + 'window.STFE_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n';
}

/* ── gợi ý mặc định cho tab Front-End ────────────────────────────────────── */

/** Dò thẻ cập nhật biến THẬT của thẻ. Không thấy thì trả về mặc định của MVU. */
export function detectUpdateTag(sources: string[]): string {
  const joined = sources.filter(Boolean).join('\n');
  const counts = new Map<string, number>();
  for (const m of joined.matchAll(/<\/([A-Za-z_][\w]{2,40})>/g)) {
    const tag = m[1];
    if (/^(p|div|span|b|i|q|br|li|ul|ol|td|tr|th|code|pre|em|strong|thinking|think|reasoning|analysis|analyze|jsonpatch|gametxt|content|action)$/i.test(tag)) continue;
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  if (counts.has('UpdateVariable')) return 'UpdateVariable';
  let best = 'UpdateVariable';
  let bestN = 0;
  counts.forEach((n, tag) => { if (n > bestN) { bestN = n; best = tag; } });
  return best;
}

/** Chọn sẵn những trường hợp lý cho biểu mẫu khởi tạo: chuỗi/enum/số ở nhóm đầu tiên. */
export function suggestFormPaths(schema: MVUZODSchema | null, limit = 8): string[] {
  const scalars = flattenScalarFields(schema);
  const scored = scalars
    .filter((f) => f.type !== 'boolean')
    .map((f) => {
      let score = 0;
      if (f.enumValues?.length) score += 3;
      if (NAME_HINTS.some((h) => norm(f.label) === norm(h))) score += 5;
      if (f.type === 'string') score += 1;
      if (f.depth <= 2) score += 1;
      // Chỉ số động (hiện tại/tối đa) thuộc về thanh đầu, không phải bảng khai báo.
      if (/hiện tại|hien tai|current|tối đa|toi da|max/i.test(f.label)) score -= 4;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.f.dotPath);
}

/** Cặp "hiện tại / tối đa" nằm chung một cha → gợi ý làm thanh chỉ số. */
export function suggestBars(schema: MVUZODSchema | null): { label: string; cur: string; max: string }[] {
  const scalars = flattenScalarFields(schema).filter((f) => f.type === 'number');
  const out: { label: string; cur: string; max: string }[] = [];
  const parentOf = (p: string) => p.split('.').slice(0, -1).join('.');
  const groups = new Map<string, FlatField[]>();
  scalars.forEach((f) => {
    const k = parentOf(f.dotPath);
    if (!k) return;
    groups.set(k, [...(groups.get(k) || []), f]);
  });
  groups.forEach((fields, parent) => {
    const cur = fields.find((f) => /hiện tại|hien tai|current|now/i.test(f.label));
    const max = fields.find((f) => /tối đa|toi da|max|cap$/i.test(f.label));
    if (cur && max) out.push({ label: parent.split('.').pop() || parent, cur: cur.dotPath, max: max.dotPath });
  });
  return out;
}

/** Trường tên nhân vật để hiện ở thanh đầu. */
export function suggestNamePath(schema: MVUZODSchema | null): string {
  const scalars = flattenScalarFields(schema).filter((f) => f.type === 'string');
  const exact = scalars.find((f) => NAME_HINTS.some((h) => norm(f.label) === norm(h)));
  return (exact ?? scalars[0])?.dotPath ?? '';
}

/** Trường tóm tắt bối cảnh, để màn khởi tạo ghi câu mở màn vào. */
export function suggestScenarioPath(schema: MVUZODSchema | null): string {
  const scalars = flattenScalarFields(schema).filter((f) => f.type === 'string');
  const hit = scalars.find((f) => /bối cảnh|boi canh|scene|context|situation/i.test(f.label));
  return hit?.dotPath ?? '';
}

/** Chip mặc định: các trường chuỗi/enum ngắn không nằm trên biểu mẫu và không phải bar. */
export function suggestChipPaths(schema: MVUZODSchema | null, limit = 6): string[] {
  const bars = new Set(suggestBars(schema).flatMap((b) => [b.cur, b.max]));
  return flattenScalarFields(schema)
    .filter((f) => !bars.has(f.dotPath))
    .filter((f) => f.type === 'string' || f.type === 'number' || !!f.enumValues?.length)
    .slice(0, limit)
    .map((f) => f.dotPath);
}
