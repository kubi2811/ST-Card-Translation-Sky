// ─── Đếm & đối chiếu macro {{...}} (pure — hàng rào bảo vệ số 1 của Dịch Preset) ───
// Preset sống nhờ dây biến {{setvar::X}} ↔ {{getvar::X}}: dịch xong mà lệch 1 cái là
// preset chạy sai âm thầm. Mẫu thật giữ đúng 342/342 setvar + 290/290 getvar sau dịch.
// validateMacroParity đối chiếu TỪNG TÊN BIẾN (qua bảng đổi tên nếu có) chứ không chỉ tổng.

export interface MacroCounts {
  total: number;
  setvar: Map<string, number>;
  getvar: Map<string, number>;
  /** Số macro chú thích {{//...}} — syntax giữ, phần chữ được phép dịch */
  comments: number;
  braceBalanced: boolean;
}

const SETVAR_RE = /\{\{setvar::([^:}]+)/g;
const GETVAR_RE = /\{\{getvar::([^:}]+)/g;
const COMMENT_RE = /\{\{\/\//g;
const ANY_MACRO_RE = /\{\{/g;

export function countMacros(text: string): MacroCounts {
  const setvar = new Map<string, number>();
  const getvar = new Map<string, number>();
  for (const m of text.matchAll(SETVAR_RE)) setvar.set(m[1], (setvar.get(m[1]) || 0) + 1);
  for (const m of text.matchAll(GETVAR_RE)) getvar.set(m[1], (getvar.get(m[1]) || 0) + 1);
  const comments = [...text.matchAll(COMMENT_RE)].length;
  const open = [...text.matchAll(ANY_MACRO_RE)].length;
  const close = [...text.matchAll(/\}\}/g)].length;
  return { total: open, setvar, getvar, comments, braceBalanced: open === close };
}

export interface MacroParityIssue {
  kind: 'setvar' | 'getvar' | 'comment' | 'brace';
  name?: string;
  before: number;
  after: number;
}

/**
 * Đối chiếu macro TRƯỚC/SAU dịch. renameMap = bảng đổi tên biến deterministic
 * (vd 美型化 → beautify): tên biến trong `before` được ánh xạ trước khi so.
 */
export function validateMacroParity(
  before: string,
  after: string,
  renameMap: Record<string, string> = {},
): MacroParityIssue[] {
  const a = countMacros(before);
  const b = countMacros(after);
  const issues: MacroParityIssue[] = [];

  const compare = (kind: 'setvar' | 'getvar', mapA: Map<string, number>, mapB: Map<string, number>) => {
    for (const [name, cnt] of mapA) {
      const expected = renameMap[name] || name;
      const got = mapB.get(expected) || 0;
      if (got !== cnt) issues.push({ kind, name: expected, before: cnt, after: got });
    }
    // Biến MỚI xuất hiện sau dịch (AI bịa) cũng là lỗi
    const legit = new Set([...mapA.keys()].map((n) => renameMap[n] || n));
    for (const [name, cnt] of mapB) {
      if (!legit.has(name)) issues.push({ kind, name, before: 0, after: cnt });
    }
  };
  compare('setvar', a.setvar, b.setvar);
  compare('getvar', a.getvar, b.getvar);

  if (a.comments !== b.comments) issues.push({ kind: 'comment', before: a.comments, after: b.comments });
  if (!b.braceBalanced) issues.push({ kind: 'brace', before: 0, after: 0 });
  return issues;
}
