/**
 * src/lib/ejs/ejsPlanGroups.ts — (Goal 28/07) GOM CÁC MỤC KẾ HOẠCH THÀNH NHÓM LIÊN QUAN.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: các mục trong bảng kế hoạch nên được gói thành nhóm theo mức độ liên quan. ĐÚNG BA
 * tiêu chí để chung nhóm:
 *   1. Cùng đọc/ghi chung một biến MVU.
 *   2. Có entry gọi getwi()/activewi() tới entry kia (phụ thuộc trực tiếp).
 *   3. Cùng nằm trong một chuỗi if/else-if (đổi ranh giới cái này ảnh hưởng cái kia).
 * Ngoài ba trường hợp trên → nhóm độc lập (nhóm 1 phần tử).
 *
 * "Từ chối cả nhóm" chỉ được ảnh hưởng trong nhóm — bảo đảm bằng cấu trúc: union-find cho ra
 * các nhóm RỜI NHAU (disjoint), UI từ chối nhóm = từ chối đúng tập rowIds của nhóm đó.
 * Trong nhóm vẫn giữ nút Đồng ý/Từ chối từng dòng — nhóm chỉ là lớp gom bên ngoài.
 *
 * Toàn bộ tất định: máy đo từ kế hoạch + nội dung entry thật, không tốn call AI nào.
 */
import type { LorebookEntry } from '../../types';
import type { EjsPlanRow } from './ejsPlanModel';

export interface PlanGroup {
  id: string;
  /** Nhãn nói VÌ SAO các mục này chung nhóm — user đọc để hiểu ranh giới ảnh hưởng. */
  label: string;
  rowIds: string[];
  /** Lý do gộp chi tiết (mỗi cạnh một dòng) — hiện tooltip/phụ đề. */
  reasons: string[];
}

// ── Bóc dữ kiện từ code/nội dung ────────────────────────────────────────────

/** Chuẩn hoá đường dẫn biến để so: bỏ tiền tố stat_data., hạ thường. */
function normVar(p: string): string {
  return String(p || '').replace(/^stat_data\./, '').trim().toLowerCase();
}

/** Mọi đường dẫn biến mà một đoạn code ĐỌC (getvar) hoặc GHI (setvar/incvar/decvar). */
export function extractVarPaths(code: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:getvar|setvar|incvar|decvar|getMessageVar|setMessageVar)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(code || ''))) !== null) out.add(normVar(m[1]));
  return [...out];
}

/** Mọi TÊN ENTRY mà code tham chiếu qua getwi/activewi (mọi biến thể chữ ký). */
export function extractEntryRefs(code: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:getwi|getWorldInfo|activewi|activateWorldInfo)\s*\(\s*([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(code || ''))) !== null) {
    // Chữ ký thật: getwi(null,'tên') | getwi('tên') | activewi('tên', true) | activewi('sách','tên',true)
    const strings = [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map(s => s[1]);
    if (!strings.length) continue;
    // Tham số tên entry là CHUỖI CUỐI CÙNG không phải boolean — 2 chuỗi thì chuỗi sau là entry.
    out.add(strings[strings.length - 1].trim().toLowerCase());
  }
  return [...out];
}

/**
 * Các CHUỖI if/else-if trong một khối code: mỗi chuỗi trả về tập tên entry được activewi
 * bên trong nó. Đổi ranh giới một nhánh ảnh hưởng nhánh kề — nên mọi entry trong cùng chuỗi
 * phải về chung nhóm.
 */
export function extractIfElseChains(code: string): string[][] {
  const src = String(code || '');
  const chains: string[][] = [];
  // Một chuỗi = `if (...) {...}` theo sau bởi ÍT NHẤT một `else if (...) {...}`.
  const re = /if\s*\([^)]*\)\s*\{[^{}]*\}(?:\s*else\s+if\s*\([^)]*\)\s*\{[^{}]*\})+(?:\s*else\s*\{[^{}]*\})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const names = extractEntryRefs(m[0]);
    if (names.length >= 2) chains.push(names);
  }
  return chains;
}

// ── Union-find ──────────────────────────────────────────────────────────────

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ── Gom nhóm ────────────────────────────────────────────────────────────────

/**
 * Dữ kiện của MỘT dòng kế hoạch dùng để so liên quan: biến + tham chiếu entry.
 * Với dòng trỏ entry có sẵn, đọc thêm từ NỘI DUNG THẬT của entry đó (varsUsed AI khai
 * thường thiếu).
 */
function rowFacts(row: EjsPlanRow, byName: Map<string, LorebookEntry>) {
  const vars = new Set<string>((row.varsUsed ?? []).map(normVar).filter(Boolean));
  const refs = new Set<string>();
  const names = new Set<string>([row.name.trim().toLowerCase()]);
  for (const p of row.splitInto ?? []) names.add(p.name.trim().toLowerCase());

  const existing = row.target === 'lorebook' ? byName.get(row.name.trim().toLowerCase()) : undefined;
  if (existing) {
    for (const v of extractVarPaths(String(existing.content ?? ''))) vars.add(v);
    for (const r of extractEntryRefs(String(existing.content ?? ''))) refs.add(r);
  }
  // requirement của dòng create_ejs cũng hay nêu đích danh biến/entry sẽ đụng.
  for (const v of extractVarPaths(row.requirement)) vars.add(v);
  for (const r of extractEntryRefs(row.requirement)) refs.add(r);

  return { vars, refs, names };
}

export function groupPlanRows(rows: EjsPlanRow[], entries: LorebookEntry[]): PlanGroup[] {
  const byName = new Map<string, LorebookEntry>();
  for (const e of entries) byName.set(String(e.comment || `#${e.id}`).trim().toLowerCase(), e);

  const facts = new Map(rows.map(r => [r.id, rowFacts(r, byName)]));
  const uf = new UnionFind();
  for (const r of rows) uf.find(r.id);
  const reasonsByPair: string[] = [];
  const addReason = (a: string, b: string, why: string) => {
    uf.union(a, b);
    reasonsByPair.push(why);
  };

  const list = rows.map(r => ({ row: r, f: facts.get(r.id)! }));

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      // 1) Cùng đọc/ghi một biến MVU.
      const sharedVar = [...A.f.vars].find(v => B.f.vars.has(v));
      if (sharedVar) {
        addReason(A.row.id, B.row.id, `"${A.row.name}" và "${B.row.name}" cùng dùng biến ${sharedVar}`);
        continue;
      }
      // 2) getwi/activewi tới nhau (một trong hai chiều).
      const aRefsB = [...A.f.refs].some(r => B.f.names.has(r));
      const bRefsA = [...B.f.refs].some(r => A.f.names.has(r));
      if (aRefsB || bRefsA) {
        addReason(A.row.id, B.row.id, `"${aRefsB ? A.row.name : B.row.name}" tham chiếu (getwi/activewi) tới "${aRefsB ? B.row.name : A.row.name}"`);
      }
    }
  }

  // 3) Cùng chuỗi if/else-if trong một controller CÓ SẴN của card.
  for (const e of entries) {
    const body = String(e.content ?? '');
    if (!body.includes('<%')) continue;
    for (const chain of extractIfElseChains(body)) {
      const members = list.filter(({ f }) => chain.some(n => f.names.has(n)));
      for (let i = 1; i < members.length; i++) {
        addReason(
          members[0].row.id, members[i].row.id,
          `"${members[0].row.name}" và "${members[i].row.name}" cùng nằm trong một chuỗi if/else-if của "${e.comment || `#${e.id}`}"`,
        );
      }
    }
  }

  // Gom theo root — giữ THỨ TỰ dòng gốc trong từng nhóm và giữa các nhóm.
  const byRoot = new Map<string, string[]>();
  for (const r of rows) {
    const root = uf.find(r.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), r.id]);
  }

  const rowById = new Map(rows.map(r => [r.id, r]));
  const groups: PlanGroup[] = [];
  const seen = new Set<string>();
  let gi = 1;
  for (const r of rows) {
    const root = uf.find(r.id);
    if (seen.has(root)) continue;
    seen.add(root);
    const ids = byRoot.get(root)!;
    const members = ids.map(id => rowById.get(id)!);
    // Lý do của nhóm = các lý do có nhắc tới thành viên nhóm.
    const memberNames = new Set(members.map(m => m.name));
    const reasons = reasonsByPair.filter(why => [...memberNames].some(n => why.includes(`"${n}"`)));
    groups.push({
      id: `g${gi++}`,
      label: ids.length === 1
        ? members[0].name
        : `Nhóm liên quan (${ids.length} mục)`,
      rowIds: ids,
      reasons: [...new Set(reasons)].slice(0, 6),
    });
  }
  return groups;
}
