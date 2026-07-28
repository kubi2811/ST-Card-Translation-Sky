/**
 * src/lib/ejs/ejsRefIntegrity.ts — (Goal 28/07) THAM CHIẾU getwi()/activewi() KHÔNG ĐƯỢC GÃY.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Sau khi chạy xong, tự động kiểm tra toàn bộ getwi()/tham chiếu trong Lorebook còn
 * trỏ đúng tới Entry tồn tại hay không, báo lỗi nếu có Entry nào bị gãy tham chiếu (do đổi
 * tên, xóa, hoặc tách Entry) và vá lại."
 *
 * Nguyên tắc vá: CHỈ vá khi có căn cứ chắc —
 *   1. Có MAPPING tường minh (entry bị tách/đổi tên trong lượt chạy này): tên cũ → tên mới.
 *      Tách 1 → N thì getwi phải trả ĐỦ nội dung như cũ (nối các phần), activewi phải bật
 *      đủ các phần — giữ đúng ngữ nghĩa trước khi tách.
 *   2. Khớp không phân biệt hoa-thường/khoảng trắng với đúng MỘT entry đang tồn tại.
 *   Ngoài hai ca đó: KHÔNG đoán mò — báo lỗi rõ tên nào gãy, ở entry nào, để user xử.
 */

export interface NamedBlock {
  name: string;
  code: string;
}

export interface BrokenRef {
  /** Entry chứa lời gọi. */
  from: string;
  /** Tên entry được tham chiếu nhưng không tồn tại. */
  ref: string;
  kind: 'getwi' | 'activewi';
}

const REF_RE = /\b(getwi|getWorldInfo|activewi|activateWorldInfo)\s*\(\s*([^)]*)\)/g;

/** Bóc (kind, tên entry) từ một lời gọi — tên là CHUỖI CUỐI trong tham số. */
function refOfCall(fn: string, args: string): { kind: BrokenRef['kind']; name: string } | null {
  const strings = [...args.matchAll(/['"`]([^'"`]+)['"`]/g)].map(s => s[1]);
  if (!strings.length) return null;
  return {
    kind: fn.startsWith('get') ? 'getwi' : 'activewi',
    name: strings[strings.length - 1].trim(),
  };
}

function normName(s: string): string {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Quét mọi tham chiếu getwi/activewi trong các khối, trả về những cái trỏ vào hư không. */
export function scanBrokenRefs(blocks: NamedBlock[], existingNames: string[]): BrokenRef[] {
  const names = new Set(existingNames.map(normName));
  const out: BrokenRef[] = [];
  for (const b of blocks) {
    let m: RegExpExecArray | null;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(String(b.code || ''))) !== null) {
      const r = refOfCall(m[1], m[2]);
      if (!r) continue;
      if (!names.has(normName(r.name))) out.push({ from: b.name, ref: r.name, kind: r.kind });
    }
  }
  return out;
}

export interface RefPatchResult {
  code: string;
  /** Mô tả từng chỗ đã vá — hiện cho user. */
  changes: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Vá tham chiếu theo mapping tên cũ → các tên mới (1 phần = đổi tên; nhiều phần = entry bị tách).
 *  • getwi(null,'Cũ')      → ((await …'Mới 1') + '\n' + (await …'Mới 2')): đọc đủ nội dung như cũ.
 *  • activewi('Cũ', true)  → (activewi từng phần, nối bằng toán tử phẩy): bật đủ các phần,
 *    vẫn là MỘT biểu thức nên đứng được trong if không ngoặc.
 * Lời gọi đã có await bên ngoài giữ nguyên await đó; các phần bên trong tự mang await.
 */
export function rewriteRefs(code: string, mapping: Map<string, string[]>): RefPatchResult {
  let out = String(code || '');
  const changes: string[] = [];

  for (const [oldName, newNames] of mapping) {
    if (!newNames.length) continue;
    const q = (n: string) => n.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    // getwi / getWorldInfo — mọi chữ ký có tên cũ là CHUỖI CUỐI trong ngoặc.
    out = out.replace(
      new RegExp(`(await\\s+)?\\b(getwi|getWorldInfo)\\s*\\(([^)]*?)(['"\`])${esc(oldName)}\\4\\s*\\)`, 'g'),
      (_all, _aw: string | undefined, fn: string, pre: string) => {
        if (newNames.length === 1) {
          changes.push(`getwi "${oldName}" → "${newNames[0]}"`);
          return `${_aw ?? ''}${fn}(${pre}'${q(newNames[0])}')`;
        }
        changes.push(`getwi "${oldName}" → nối nội dung ${newNames.length} phần (${newNames.join(', ')})`);
        // Bọc từng phần trong (await …) rồi cộng chuỗi — một biểu thức duy nhất.
        return '(' + newNames.map(n => `(await ${fn}(${pre}'${q(n)}'))`).join(" + '\\n' + ") + ')';
      },
    );

    // activewi / activateWorldInfo.
    out = out.replace(
      new RegExp(`(await\\s+)?\\b(activewi|activateWorldInfo)\\s*\\(([^)]*?)(['"\`])${esc(oldName)}\\4([^)]*)\\)`, 'g'),
      (_all, _aw: string | undefined, fn: string, pre: string, _q2: string, post: string) => {
        if (newNames.length === 1) {
          changes.push(`activewi "${oldName}" → "${newNames[0]}"`);
          return `${_aw ?? ''}${fn}(${pre}'${q(newNames[0])}'${post})`;
        }
        changes.push(`activewi "${oldName}" → bật lần lượt ${newNames.length} phần (${newNames.join(', ')})`);
        return '(' + newNames.map(n => `await ${fn}(${pre}'${q(n)}'${post})`).join(', ') + ')';
      },
    );
  }

  return { code: out, changes };
}

/**
 * Vá theo khớp gần: tên gãy trùng (bỏ hoa-thường/khoảng trắng thừa) với đúng MỘT entry tồn
 * tại thì sửa về tên chuẩn. Nhiều ứng viên hay không có → KHÔNG vá (đoán mò còn tệ hơn gãy).
 */
export function fuzzyRepairMapping(broken: BrokenRef[], existingNames: string[]): Map<string, string[]> {
  const byNorm = new Map<string, string[]>();
  for (const n of existingNames) {
    const k = normName(n);
    byNorm.set(k, [...(byNorm.get(k) ?? []), n]);
  }
  const map = new Map<string, string[]>();
  for (const b of broken) {
    const cands = byNorm.get(normName(b.ref)) ?? [];
    if (cands.length === 1 && cands[0] !== b.ref) map.set(b.ref, [cands[0]]);
  }
  return map;
}
