/**
 * SchemaVarTable — (bug 148-2) BẢNG BIẾN của "Xem trước & Tinh chỉnh".
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "tu sửa thành 1 bộ khung có tiêu đề cố định trên cùng cho mỗi cột, danh sách biến liệt
 * kê bên dưới theo hàng — mỗi ô hiển thị đúng dạng nhập liệu tương ứng với Type đã chọn của
 * hàng đó, thay vì để trống nghĩa như hiện tại."
 *
 * 5 cột cố định: Tên biến · Kiểu · Phạm vi/Giá trị hợp lệ · Mặc định · Ghi chú quy tắc.
 * Ô ở cột 3 và 4 ĐỔI THEO TYPE của chính hàng đó:
 *   number  → 2 ô Min/Max        · ô nhập số
 *   string  → ô liệt kê enum      · dropdown theo enum (nếu có) hoặc ô nhập chữ
 *   boolean → ẩn cột 3            · dropdown true/false
 *   object  → ẩn cột 3            · (nhóm — không có giá trị riêng)
 *   array   → ẩn cột 3            · [] rỗng, kèm BẢNG CON định nghĩa cấu trúc 1 phần tử
 *   record  → ẩn cột 3            · {} rỗng, kèm BẢNG CON định nghĩa cấu trúc 1 mục
 * Bảng con dùng LẠI CHÍNH component này (đệ quy) nên trường con cũng có đủ 5 cột.
 *
 * Trường con được lưu thành children với path chứa "/_child/" — đúng quy ước schemaInferencer
 * đã dùng cho record, nay dùng chung cho cả array.
 */
import { Trash2, Plus, CornerDownRight } from 'lucide-react';
import type { MVUZODField } from '../../types/mvuzod.types';

export type VarType = MVUZODField['type'];

/** Một hàng biến trong bảng (phẳng theo cấp — cấp con nằm trong `children`). */
export interface VarRow {
  path: string;
  label: string;
  type: VarType;
  min?: number;
  max?: number;
  /** Chuỗi enum ngăn bởi dấu phẩy (chỉ dùng cho string). */
  enumValues?: string;
  defaultValue: string;
  /** Ghi chú/ràng buộc riêng — vào constraints.checkRules. */
  rule: string;
  /** Cấu trúc phần tử (array) / cấu trúc một mục (record). */
  children?: VarRow[];
}

export const TYPE_OPTIONS: Array<{ value: VarType; label: string; hint: string }> = [
  { value: 'number', label: 'Number', hint: 'Số — có thể đặt Min/Max' },
  { value: 'string', label: 'String', hint: 'Chuỗi — để trống enum là chuỗi tự do' },
  { value: 'boolean', label: 'Boolean', hint: 'Đúng/Sai' },
  { value: 'object', label: 'Object', hint: 'Nhóm cố định: số lượng và tên các trường biết trước' },
  { value: 'array', label: 'Array', hint: 'Danh sách: số phần tử thay đổi khi chơi, tra theo thứ tự (Kho Đồ, kỹ năng đã mở)' },
  { value: 'record', label: 'Record', hint: 'Từ điển: tên khoá sinh động khi chơi, tra nhanh theo tên (Quan hệ NPC)' },
];

/** Type nào KHÔNG có cột "Phạm vi" ở hàng cha. */
export const HIDES_RANGE = new Set<VarType>(['boolean', 'object', 'array', 'record']);
/** Type nào có BẢNG CON định nghĩa cấu trúc. */
export const HAS_SUBTABLE = new Set<VarType>(['array', 'record']);

/** Nhãn cột — dùng chung cho bảng chính và bảng con. */
const COLS = ['Tên biến', 'Kiểu dữ liệu', 'Phạm vi / Giá trị hợp lệ', 'Giá trị mặc định', 'Ghi chú / quy tắc riêng'];

interface Props {
  rows: VarRow[];
  onChange: (rows: VarRow[]) => void;
  /** Bảng con — thu nhỏ, không hiện lại tiêu đề to. */
  nested?: boolean;
}

export function SchemaVarTable({ rows, onChange, nested = false }: Props) {
  const patch = (i: number, p: Partial<VarRow>) => {
    const next = [...rows];
    next[i] = { ...next[i], ...p };
    onChange(next);
  };

  /** Đổi tên biến ⇒ đổi luôn đoạn cuối của path (path là danh tính thật của biến). */
  const rename = (i: number, name: string) => {
    const segs = rows[i].path.split('/');
    segs[segs.length - 1] = name;
    patch(i, { label: name, path: segs.join('/') });
  };

  /** Đổi type ⇒ dọn các ô không còn nghĩa, dựng sẵn bảng con khi cần. */
  const changeType = (i: number, type: VarType) => {
    const r = rows[i];
    const p: Partial<VarRow> = { type };
    if (type !== 'number') { p.min = undefined; p.max = undefined; }
    if (type !== 'string') p.enumValues = undefined;
    if (type === 'array') p.defaultValue = '[]';
    else if (type === 'record' || type === 'object') p.defaultValue = '{}';
    else if (type === 'boolean' && !['true', 'false'].includes(r.defaultValue)) p.defaultValue = 'false';
    else if (type === 'number' && !Number.isFinite(Number(r.defaultValue))) p.defaultValue = '0';
    if (HAS_SUBTABLE.has(type) && !(r.children?.length)) {
      p.children = [makeChild(r.path, type === 'array' ? 'Tên' : 'Mức độ')];
    }
    patch(i, p);
  };

  const addChild = (i: number) => {
    const r = rows[i];
    patch(i, { children: [...(r.children ?? []), makeChild(r.path, `Trường ${(r.children?.length ?? 0) + 1}`)] });
  };

  return (
    <div className={nested ? 'space-y-1' : 'space-y-1.5'}>
      {/* ── TIÊU ĐỀ CỐ ĐỊNH ── */}
      <div className={`grid grid-cols-12 gap-1.5 px-2 ${nested ? 'text-[9px]' : 'text-[10px] sticky top-0 z-10 bg-background/95 py-1'} uppercase tracking-wide text-muted-foreground`}>
        <span className="col-span-3">{COLS[0]}</span>
        <span className="col-span-2">{COLS[1]}</span>
        <span className="col-span-2">{COLS[2]}</span>
        <span className="col-span-2">{COLS[3]}</span>
        <span className="col-span-3">{COLS[4]}</span>
      </div>

      {rows.map((v, i) => {
        const enums = (v.enumValues ?? '').split(',').map(s => s.trim()).filter(Boolean);
        return (
          <div key={`${v.path}#${i}`} className={`rounded-lg border border-border ${nested ? 'p-1.5 bg-muted/10' : 'p-2'} space-y-1.5`}>
            <div className="grid grid-cols-12 gap-1.5 items-center text-[11px]">
              {/* 1 — Tên biến */}
              <div className="col-span-3 flex items-center gap-1">
                {nested && <CornerDownRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                <input className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-card" value={v.label} title={v.path}
                  onChange={e => rename(i, e.target.value)} />
              </div>

              {/* 2 — Kiểu dữ liệu */}
              <select className="col-span-2 px-1 py-1 rounded border border-border bg-card" value={v.type}
                title={TYPE_OPTIONS.find(t => t.value === v.type)?.hint}
                onChange={e => changeType(i, e.target.value as VarType)}>
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value} title={t.hint}>{t.label}</option>)}
              </select>

              {/* 3 — Phạm vi / giá trị hợp lệ */}
              {v.type === 'number' ? (
                <div className="col-span-2 flex gap-1">
                  <input className="w-1/2 px-1 py-1 rounded border border-border bg-card" placeholder="Min" value={v.min ?? ''}
                    onChange={e => patch(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  <input className="w-1/2 px-1 py-1 rounded border border-border bg-card" placeholder="Max" value={v.max ?? ''}
                    onChange={e => patch(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              ) : v.type === 'string' ? (
                <input className="col-span-2 px-1 py-1 rounded border border-border bg-card" placeholder="enum: A, B, C (trống = tự do)"
                  value={v.enumValues ?? ''} onChange={e => patch(i, { enumValues: e.target.value })} />
              ) : (
                <span className="col-span-2 text-[10px] text-muted-foreground/60 px-1">—</span>
              )}

              {/* 4 — Giá trị mặc định (đúng dạng nhập theo type) */}
              {v.type === 'boolean' ? (
                <select className="col-span-2 px-1 py-1 rounded border border-border bg-card" value={v.defaultValue === 'true' ? 'true' : 'false'}
                  onChange={e => patch(i, { defaultValue: e.target.value })}>
                  <option value="false">false</option><option value="true">true</option>
                </select>
              ) : v.type === 'string' && enums.length > 0 ? (
                <select className="col-span-2 px-1 py-1 rounded border border-border bg-card" value={v.defaultValue}
                  onChange={e => patch(i, { defaultValue: e.target.value })}>
                  {!enums.includes(v.defaultValue) && <option value={v.defaultValue}>{v.defaultValue || '(trống)'}</option>}
                  {enums.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              ) : v.type === 'array' || v.type === 'record' || v.type === 'object' ? (
                <input className="col-span-2 px-1 py-1 rounded border border-border bg-card font-mono text-[10px]"
                  value={v.defaultValue || (v.type === 'array' ? '[]' : '{}')}
                  title={v.type === 'array' ? 'Rỗng [] hoặc khai sẵn vài phần tử JSON' : 'Rỗng {} — khoá chỉ sinh khi chơi'}
                  onChange={e => patch(i, { defaultValue: e.target.value })} />
              ) : (
                <input className="col-span-2 px-1 py-1 rounded border border-border bg-card" type={v.type === 'number' ? 'number' : 'text'}
                  placeholder={v.type === 'number' ? '0' : 'mặc định'} value={v.defaultValue}
                  onChange={e => patch(i, { defaultValue: e.target.value })} />
              )}

              {/* 5 — Ghi chú / quy tắc riêng + nút xoá */}
              <div className="col-span-3 flex items-center gap-1">
                <input className="flex-1 min-w-0 px-1 py-1 rounded border border-border bg-card" placeholder="quy tắc riêng cho biến này…"
                  value={v.rule} onChange={e => patch(i, { rule: e.target.value })} />
                <button className="p-1 rounded text-red-400 hover:bg-red-500/10 shrink-0" title="Xoá biến này"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* ── BẢNG CON (array/record) — đệ quy chính bảng này ── */}
            {HAS_SUBTABLE.has(v.type) && (
              <div className="ml-3 pl-2 border-l-2 border-primary/30 space-y-1">
                <div className="text-[10px] text-primary/80">
                  {v.type === 'array'
                    ? 'Cấu trúc MỘT PHẦN TỬ của danh sách (số phần tử thay đổi khi chơi):'
                    : 'Cấu trúc MỘT MỤC (áp cho mọi tên khoá sẽ phát sinh khi chơi):'}
                </div>
                <SchemaVarTable nested rows={v.children ?? []} onChange={c => patch(i, { children: c })} />
                <button onClick={() => addChild(i)}
                  className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Thêm trường con
                </button>
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 && (
        <div className="text-[10px] text-muted-foreground text-center py-2">Chưa có trường nào.</div>
      )}
    </div>
  );
}

/** Dựng một trường con mới cho array/record — path theo quy ước "/_child/". */
export function makeChild(parentPath: string, name: string): VarRow {
  return {
    path: `${parentPath}/_child/${name}`,
    label: name,
    type: 'string',
    defaultValue: '',
    rule: '',
  };
}
