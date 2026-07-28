/**
 * src/lib/mvuzod/cardQualityAudit.ts — (bug 135) SOÁT CHẤT LƯỢNG CARD MVU/EJS.
 * ─────────────────────────────────────────────────────────────────────────────
 * User đưa 2 card MVU thật (bug/135) nhờ Claude Web chấm, rồi dặn: "hãy xem xét, NÂNG CẤP, MỞ
 * RỘNG và toàn diện cho app Tạo Card, không chỉ ở các lỗi mà Claude Web đưa mà bản chỉ sửa mấy
 * cái đó" — tức đừng vá từng ca, hãy dựng phép kiểm cho cả LỚP lỗi đó.
 *
 * Điểm chung của mọi lỗi trong hai card: chúng đều IM LẶNG. Card mở ra nhìn đủ, báo cáo xanh,
 * nhưng vào chơi thì cơ chế không chạy — vì không ai đối chiếu chéo giữa các phần với nhau:
 *
 *   • EJS so `'Chưa rõ'` trong khi enum schema chỉ có `'Chưa thức tỉnh'` (đo được trên Card 1:
 *     nhánh chiến đấu theo Phả Hệ KHÔNG BAO GIỜ đúng) — không ai so chuỗi trong code với enum.
 *   • 3 entry Lễ Hội của Card 2: tắt + không keys + không constant ⇒ không đường nào kích hoạt,
 *     lore nằm chết trong file.
 *   • 5 entry tắt mà không khối EJS nào gọi tên ⇒ cùng loại chết, chỉ khác đường.
 *   • Entry "Danh sách biến" (constant, gửi MỌI lượt) lại chứa ví dụ <UpdateVariable> giá trị
 *     cứng ⇒ AI đọc nhầm ví dụ thành trạng thái thật ngay từ lượt đầu.
 *   • Biến số khai defaultValue kiểu chuỗi ⇒ so sánh số hoá so chuỗi, "9" > "10".
 *   • Nhiều entry cùng (order, position) ⇒ thứ tự nạp không xác định, lần chạy khác nhau khác kết quả.
 *
 * Mỗi phép kiểm ở đây đều TẤT ĐỊNH và nêu rõ hậu quả trong game, để người dùng biết vì sao đáng sửa.
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import type { LorebookEntry } from '../../types';

export interface AuditIssue {
  level: 'error' | 'warning';
  code:
    | 'ejs-enum-mismatch' | 'ejs-enum-coverage' | 'dead-entry' | 'orphan-disabled'
    | 'number-default-string' | 'order-position-clash' | 'varlist-example-content';
  message: string;
  where?: string;
  /** Máy sửa được không — quyết định có đưa vào tiến trình Vá lỗi hay phải để AI/user. */
  autofixable: boolean;
}

export interface AuditInput {
  entries: LorebookEntry[];
  schema?: MVUZODSchema | null;
}

// ─── Trợ giúp ────────────────────────────────────────────────────────────────

const isEjs = (c: string) => c.includes('@@preprocessing') || c.includes('<%');

/** Bỏ dấu + hạ thường — để so "Sơ Thức" với "sơ thức" là một. */
export function foldVi(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .trim().toLowerCase();
}

/** Mọi field lá của schema, kèm tên lá để so với tên biến trong code. */
export function collectLeafFields(schema: MVUZODSchema | null | undefined): MVUZODField[] {
  const out: MVUZODField[] = [];
  const walk = (fs: MVUZODField[] | undefined) => {
    for (const f of fs ?? []) {
      if (Array.isArray(f.children) && f.children.length) walk(f.children);
      else out.push(f);
    }
  };
  walk(schema?.fields);
  return out;
}

const leafName = (f: { path?: string; label?: string }) =>
  String(f.path ?? '').split('/').filter(Boolean).pop() || String(f.label ?? '');

/**
 * Các chuỗi mà một đoạn code EJS đem SO SÁNH (`=== 'x'`, `!= "y"`, `includes('z')`).
 * Chỉ lấy chuỗi trong phép so — chuỗi để in ra màn hình không liên quan.
 */
export function extractComparedStrings(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/[!=]==?\s*(['"`])([^'"`]{1,60})\1/g)) out.add(m[2]);
  for (const m of code.matchAll(/(['"`])([^'"`]{1,60})\1\s*[!=]==?/g)) out.add(m[2]);
  for (const m of code.matchAll(/\.includes\s*\(\s*(['"`])([^'"`]{1,60})\1/g)) out.add(m[2]);
  return [...out];
}

/**
 * NỐI CHÍNH XÁC "chuỗi so sánh ↔ biến enum" — bám theo KHAI BÁO BIẾN chứ không đoán qua tên:
 *   var phaHe = getvar('stat_data.Người Chơi.Phả Hệ');   →  phaHe thuộc lá "Phả Hệ"
 *   if (phaHe !== 'Chưa rõ') …                            →  'Chưa rõ' được so với "Phả Hệ"
 * (Đo trên Card 1 thật: entry chỉ so DUY NHẤT giá trị sai, nên mọi cách nối lỏng hơn —
 *  "có ít nhất một chuỗi khớp enum thì mới tin" — đều bỏ lọt đúng ca cần bắt nhất.)
 */
export function extractEnumComparisons(
  code: string,
  enumLeaves: MVUZODField[],
): Map<MVUZODField, string[]> {
  const byLeafName = new Map(enumLeaves.map(f => [foldVi(leafName(f)), f]));
  const leafOfPath = (p: string): MVUZODField | undefined =>
    byLeafName.get(foldVi(String(p).split(/[./]/).filter(Boolean).pop() ?? ''));

  // 1. Tên biến JS → lá enum (qua đường dẫn getvar).
  const varToLeaf = new Map<string, MVUZODField>();
  for (const m of code.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?getvar\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    const leaf = leafOfPath(m[2]);
    if (leaf) varToLeaf.set(m[1], leaf);
  }

  const out = new Map<MVUZODField, string[]>();
  const add = (leaf: MVUZODField, s: string) => {
    if (/^\s*$/.test(s)) return;   // so với chuỗi rỗng là kiểm "chưa có giá trị" — hợp lệ
    out.set(leaf, [...(out.get(leaf) ?? []), s]);
  };

  // 2. So sánh qua biến trung gian: `phaHe !== 'x'` và `'x' === phaHe`.
  for (const [name, leaf] of varToLeaf) {
    for (const m of code.matchAll(new RegExp(`(?<![\\w$])${name}\\s*[!=]==?\\s*(['"\`])([^'"\`]{1,60})\\1`, 'g'))) add(leaf, m[2]);
    for (const m of code.matchAll(new RegExp(`(['"\`])([^'"\`]{1,60})\\1\\s*[!=]==?\\s*${name}(?![\\w$])`, 'g'))) add(leaf, m[2]);
  }
  // 3. So sánh trực tiếp: `getvar('…Phả Hệ…') === 'x'`.
  for (const m of code.matchAll(/getvar\s*\(\s*['"`]([^'"`]+)['"`][^)]*\)\s*[!=]==?\s*(['"`])([^'"`]{1,60})\2/g)) {
    const leaf = leafOfPath(m[1]);
    if (leaf) add(leaf, m[3]);
  }
  return out;
}

/** Gợi ý giá trị enum gần nhất: khớp bỏ dấu, chứa nhau, hoặc chung TỪ ĐẦU ("Chưa rõ" → "Chưa thức tỉnh"). */
export function nearestEnumValue(bad: string, values: string[]): string | undefined {
  const fb = foldVi(bad);
  const exact = values.find(v => foldVi(v) === fb);
  if (exact) return exact;
  const contains = values.find(v => foldVi(v).includes(fb) || fb.includes(foldVi(v)));
  if (contains) return contains;
  const firstWord = fb.split(/\s+/)[0];
  if (!firstWord) return undefined;
  const sameStart = values.filter(v => foldVi(v).split(/\s+/)[0] === firstWord);
  return sameStart.length === 1 ? sameStart[0] : undefined;
}

// ─── Bộ kiểm ─────────────────────────────────────────────────────────────────

export function auditCardQuality(input: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const entries = input.entries ?? [];
  const leaves = collectLeafFields(input.schema);
  const enumLeaves = leaves.filter(f => (f.constraints?.enumValues?.length ?? 0) > 0);
  const ejsEntries = entries.filter(e => isEjs(String(e.content ?? '')));
  const allEjsCode = ejsEntries.map(e => String(e.content ?? '')).join('\n');

  /* 1+2. EJS so chuỗi với biến enum — sai giá trị (lỗi) hoặc bỏ sót nhánh (cảnh báo).
     Đây chính là ca Card 1: `=== 'Chưa rõ'` mà enum Phả Hệ không hề có giá trị đó, nên nhánh
     chiến đấu theo Phả Hệ không bao giờ chạy — mà chẳng có lỗi đỏ nào. */
  for (const e of ejsEntries) {
    const code = String(e.content ?? '');
    const where = String(e.comment || `#${e.id}`);

    for (const [f, compared] of extractEnumComparisons(code, enumLeaves)) {
      const values = f.constraints!.enumValues!;
      const folded = new Set(values.map(foldVi));

      for (const bad of compared.filter(s => !folded.has(foldVi(s)))) {
        const near = nearestEnumValue(bad, values);
        issues.push({
          level: 'error',
          code: 'ejs-enum-mismatch',
          message: `EJS so sánh "${bad}" với biến "${leafName(f)}" nhưng giá trị đó KHÔNG có trong enum `
            + `(${values.join(' / ')})${near ? ` — có lẽ định viết "${near}"` : ''}. Nhánh này không bao giờ đúng, cơ chế gắn với nó chết im lặng.`,
          where,
          autofixable: !!near,
        });
      }

      const hits = compared.filter(s => folded.has(foldVi(s)));
      const missingBranches = values.filter(v => !compared.some(s => foldVi(s) === foldVi(v)));
      // Chỉ nhắc khi đã phủ được PHẦN LỚN — thiếu 1-2 nhánh mới là "quên", thiếu hết là cố ý
      // (so một giá trị để làm cờ điều kiện là cách dùng bình thường, không phải phân nhánh).
      if (missingBranches.length > 0 && hits.length >= Math.max(2, values.length - missingBranches.length)) {
        issues.push({
          level: 'warning',
          code: 'ejs-enum-coverage',
          message: `EJS phân nhánh theo "${leafName(f)}" nhưng bỏ sót giá trị: ${missingBranches.join(', ')} — người chơi rơi vào các trạng thái đó sẽ không có nhánh nào xử lý.`,
          where,
          autofixable: false,
        });
      }
    }
  }

  /* 3+4. Entry KHÔNG CÓ ĐƯỜNG NÀO KÍCH HOẠT — lore nằm chết trong file.
     Card 2 có đúng 3 entry Lễ Hội như vậy. [initvar] được miễn: tắt là ĐÚNG chuẩn MVU. */
  for (const e of entries) {
    const name = String(e.comment || `#${e.id}`);
    // [initvar] nhận diện qua CẢ tên lẫn nội dung — đúng cách buildFinalCheckReport tìm nó.
    // Chỉ soi tên thì entry khai [initvar] trong content bị coi là "chết", bị bật lên, rồi
    // phép vá initvar lại tắt xuống — hai phép vá giằng co không bao giờ hội tụ.
    if (/\[initvar\]|initvar/i.test(name) || /\[initvar\]/i.test(String(e.content ?? ''))) continue;
    const enabled = e.enabled !== false && (e as { disable?: boolean }).disable !== true;
    const hasKeys = (e.keys ?? []).some(k => String(k).trim());
    const constant = e.constant === true;
    const activatedByEjs = allEjsCode.includes(name);

    if (!enabled && !hasKeys && !constant && !activatedByEjs) {
      issues.push({
        level: 'error',
        code: 'dead-entry',
        message: `Entry "${name}" TẮT + không có từ khoá + không constant + không khối EJS nào bật ⇒ không đường nào kích hoạt được. Nội dung này sẽ không bao giờ tới tay AI.`,
        where: name,
        autofixable: true,   // đặt keys từ chính tên entry là cứu được, không phải xoá
      });
    } else if (!enabled && !constant && !activatedByEjs && hasKeys) {
      issues.push({
        level: 'warning',
        code: 'orphan-disabled',
        message: `Entry "${name}" đang TẮT và không khối EJS nào gọi tên nó — dù có từ khoá, entry tắt thì SillyTavern không quét. Bật lên hoặc thêm controller EJS gọi activewi.`,
        where: name,
        autofixable: false,
      });
    }
  }

  /* 5. Biến SỐ khai giá trị mặc định kiểu CHUỖI — so sánh sẽ so theo chữ ("9" > "10"). */
  for (const f of leaves) {
    if (f.type !== 'number') continue;
    if (typeof f.defaultValue === 'string' && f.defaultValue.trim() !== '') {
      issues.push({
        level: 'error',
        code: 'number-default-string',
        message: `Biến số "${leafName(f)}" có giá trị mặc định kiểu CHUỖI ("${f.defaultValue}") — mọi phép so sánh sẽ so theo chữ ("9" > "10"), điều kiện trong EJS/quy tắc sẽ sai.`,
        where: String(f.path ?? leafName(f)),
        autofixable: true,
      });
    }
  }

  /* 6. Nhiều entry cùng (thứ tự nạp, vị trí chèn) — thứ tự hiển thị không xác định. */
  {
    const byKey = new Map<string, string[]>();
    for (const e of entries) {
      if (e.enabled === false) continue;
      const pos = (e as { extensions?: { position?: number } }).extensions?.position ?? e.position;
      const key = `${e.insertion_order ?? 100}|${pos ?? '?'}`;
      byKey.set(key, [...(byKey.get(key) ?? []), String(e.comment || `#${e.id}`)]);
    }
    for (const [key, names] of byKey) {
      if (names.length < 2) continue;
      const [order, pos] = key.split('|');
      issues.push({
        level: 'warning',
        code: 'order-position-clash',
        message: `${names.length} entry cùng thứ tự nạp ${order} tại vị trí ${pos} (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}) — thứ tự giữa chúng không xác định, mỗi lần chạy có thể khác nhau.`,
        autofixable: true,   // giãn order ra là hết, không đụng nội dung
      });
    }
  }

  /* 7. Entry "danh sách biến"/bảng trạng thái (constant — gửi MỌI lượt) mà lại chứa VÍ DỤ
     <UpdateVariable> với giá trị cứng. Card 2 dính đúng ca này: AI đọc ví dụ tưởng là trạng
     thái thật ngay từ lượt đầu. */
  for (const e of entries) {
    const name = String(e.comment || `#${e.id}`);
    const content = String(e.content ?? '');
    const isVarList = /danh\s*s[aá]ch\s*bi[eế]n|b[aả]ng\s*bi[eế]n|variable\s*list|变量列表/i.test(name);
    if (!isVarList || e.constant !== true) continue;
    if (/<UpdateVariable>/i.test(content) && /_\.set\s*\(|"op"\s*:|'op'\s*:/.test(content)) {
      issues.push({
        level: 'error',
        code: 'varlist-example-content',
        message: `Entry "${name}" là bảng biến gửi MỌI lượt nhưng nội dung lại là VÍ DỤ khối <UpdateVariable> với giá trị cứng — AI sẽ đọc ví dụ đó như trạng thái thật ngay từ lượt đầu. Nội dung phải là bảng đọc biến hiện tại, ví dụ định dạng để ở entry quy tắc.`,
        where: name,
        autofixable: false,   // phải sinh lại nội dung — máy không bịa được
      });
    }
  }

  return issues;
}
