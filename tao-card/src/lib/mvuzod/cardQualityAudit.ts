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
import { FactIndex } from '../wikiImport/factIndex';

export interface AuditIssue {
  level: 'error' | 'warning';
  code:
    | 'ejs-enum-mismatch' | 'ejs-enum-coverage' | 'dead-entry' | 'orphan-disabled'
    | 'number-default-string' | 'order-position-clash' | 'varlist-example-content'
    // (bug 148) đo được trên card v3 thật của user:
    | 'ejs-missing-statdata' | 'ejs-nonascii-var' | 'duplicate-entry-content'
    // (bug 148-2) cấu trúc Object/Array/Record
    | 'struct-no-child' | 'record-duplicate-key' | 'struct-bad-default';
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

  /* 1b. (bug 148) getvar QUÊN TIỀN TỐ `stat_data.` — lỗi IM LẶNG nguy hiểm nhất nhóm này.
     Đo trên card v3 thật của user: entry "[EJS] Inject Bối Cảnh Hệ Thống" có 6 lời gọi thiếu
     tiền tố, trong khi 2 entry EJS còn lại CÙNG CARD viết đúng. Thiếu tiền tố thì getvar không
     tìm thấy biến, LUÔN trả giá trị mặc định — cơ chế vẫn chạy, không lỗi đỏ, chỉ là mọi lượt
     chat đều nhận cùng một thông tin sai (Ngày 1, Máu 100…) bất kể người chơi đang ở đâu.
     Máy sửa được: biến có thật trong schema thì chỉ việc thêm tiền tố. */
  for (const e of ejsEntries) {
    const code = String(e.content ?? '');
    const where = String(e.comment || `#${e.id}`);
    const leafNames = new Set(leaves.map(f => foldVi(leafName(f))));
    const bad: string[] = [];
    for (const m of code.matchAll(/\bgetvar\s*\(\s*(['"`])([^'"`]+)\1/g)) {
      const path = m[2];
      if (/^stat_data\b/.test(path)) continue;
      // Chỉ tính là LỖI khi đoạn cuối path trùng một biến CÓ THẬT trong schema — nếu không,
      // đó có thể là biến chat/global hợp lệ (getvar cũng đọc được kho biến khác).
      const tail = path.split('.').filter(Boolean).pop() ?? '';
      if (leaves.length === 0 || leafNames.has(foldVi(tail))) bad.push(path);
    }
    for (const path of [...new Set(bad)]) {
      issues.push({
        level: 'error',
        code: 'ejs-missing-statdata',
        message: `EJS đọc biến "${path}" nhưng THIẾU tiền tố "stat_data." — getvar sẽ không tìm thấy biến và luôn trả giá trị mặc định, nên khối này báo cùng một thông tin sai ở mọi lượt chat (không hề có lỗi đỏ). Sửa thành "stat_data.${path}".`,
        where,
        autofixable: true,
      });
    }

    /* 1c. (bug 148) Tên biến JS có DẤU TIẾNG VIỆT (`_nhân_vật_vp_hiện_tại`) — engine JS hiện đại
       chấp nhận, nhưng lệch hẳn quy ước ASCII của phần còn lại và dễ vỡ khi qua tầng xử lý
       chuỗi/minify. Cảnh báo, máy đổi được sang ASCII. */
    for (const m of code.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$À-ỹ][\w$À-ỹ]*)/g)) {
      if (!/[^\x00-\x7F]/.test(m[1])) continue;
      issues.push({
        level: 'warning',
        code: 'ejs-nonascii-var',
        message: `Tên biến "${m[1]}" có dấu tiếng Việt — lệch quy ước ASCII của các khối EJS khác và dễ vỡ khi đi qua tầng xử lý chuỗi. Nên đổi sang tên ASCII ngắn gọn.`,
        where,
        autofixable: true,
      });
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

  /* 7b. (bug 148-2) CẤU TRÚC Object / Array / Record — 3 kiểu mới cần kiểm riêng.
     • array/record KHÔNG khai cấu trúc con ⇒ Zod chỉ dựng được mảng chuỗi / từ điển chuỗi,
       AI trong game không biết mỗi phần tử gồm những trường gì.
     • defaultValue sai kiểu (array mà mặc định là object, record mà khai sẵn khoá) ⇒ ngay lượt
       đầu MVU đã đọc ra thứ khác kiểu.
     • record KHAI SẴN TÊN KHOÁ trong mặc định — đúng lỗi đặc thù user nêu: tên khoá phải sinh
       khi chơi, khai sẵn là mặc định đè lên dữ liệu thật. */
  {
    const walkStruct = (fs: MVUZODField[] | undefined) => {
      for (const f of fs ?? []) {
        const name = leafName(f);
        const where = String(f.path ?? name);
        const kids = (f.children ?? []).filter(c => c.path.includes('/_child/'));

        if (f.type === 'array' || f.type === 'record') {
          if (kids.length === 0) {
            issues.push({
              level: 'warning',
              code: 'struct-no-child',
              message: `Biến "${name}" kiểu ${f.type} nhưng chưa khai cấu trúc ${f.type === 'array' ? 'một phần tử' : 'một mục'} — schema chỉ dựng được ${f.type === 'array' ? 'mảng chuỗi' : 'từ điển chuỗi'}, AI trong game không biết mỗi ${f.type === 'array' ? 'phần tử' : 'mục'} gồm những trường nào.`,
              where, autofixable: false,
            });
          }
          const dv = f.defaultValue;
          if (f.type === 'array' && dv !== undefined && !Array.isArray(dv)) {
            issues.push({
              level: 'error', code: 'struct-bad-default',
              message: `Biến "${name}" kiểu array nhưng giá trị mặc định không phải danh sách — MVU sẽ đọc ra kiểu khác ngay lượt đầu.`,
              where, autofixable: true,
            });
          }
          if (f.type === 'record') {
            if (dv !== undefined && (Array.isArray(dv) || typeof dv !== 'object')) {
              issues.push({
                level: 'error', code: 'struct-bad-default',
                message: `Biến "${name}" kiểu record nhưng giá trị mặc định không phải từ điển — phải là {} rỗng.`,
                where, autofixable: true,
              });
            } else if (dv && typeof dv === 'object' && Object.keys(dv as object).length > 0) {
              issues.push({
                level: 'warning', code: 'record-duplicate-key',
                message: `Biến "${name}" kiểu record KHAI SẴN ${Object.keys(dv as object).length} tên khoá trong giá trị mặc định (${Object.keys(dv as object).slice(0, 3).join(', ')}) — tên khoá của record phải sinh ra khi chơi; khai sẵn khiến mỗi lần khởi tạo lại đè lên dữ liệu thật. Để {} rỗng.`,
                where, autofixable: true,
              });
            }
          }
          // Trùng TÊN TRƯỜNG CON trong cùng cấu trúc — record/array chỉ giữ được một.
          const seenKid = new Set<string>();
          for (const k of kids) {
            const kn = foldVi(leafName(k));
            if (seenKid.has(kn)) {
              issues.push({
                level: 'error', code: 'record-duplicate-key',
                message: `Cấu trúc của "${name}" có HAI trường con trùng tên "${leafName(k)}" — chỉ một cái sống sót, dữ liệu trường kia mất im lặng.`,
                where, autofixable: false,
              });
            }
            seenKid.add(kn);
          }
        }
        walkStruct(f.children);
      }
    };
    walkStruct(input.schema?.fields);
  }

  /* 8. (bug 148) TRÙNG NỘI DUNG GIỮA CÁC ENTRY — Claude Web gọi đúng tên: "lỗi tái diễn xuyên
     suốt các bản card, đáng đưa vào feedback như một vấn đề mang tính hệ thống của Auto
     Creator, không phải lỗi riêng lẻ từng card". Đo trên card v3: entry 8 và 15 cùng mô tả cơ
     chế VP/Shard Collapse và CHIA CHUNG từ khoá ⇒ mỗi lần nhắc VP là gửi 2 bản gần giống nhau.
     Hai điều kiện phải CÙNG đúng mới báo (một mình mỗi cái đều dễ báo oan):
       • nội dung gần nhau về nghĩa (FactIndex — bắt cả khi diễn đạt khác);
       • có ÍT NHẤT một từ khoá dùng chung ⇒ chắc chắn kích hoạt đồng thời, tốn token thật.  */
  {
    const idx = new FactIndex();
    const list = entries
      .filter(e => String(e.content ?? '').trim().length >= 120)   // entry ngắn không đáng gộp
      .map(e => ({
        e,
        name: String(e.comment || `#${e.id}`),
        keys: new Set((e.keys ?? []).map(k => foldVi(String(k))).filter(k => k.length >= 2)),
      }));
    const reported = new Set<string>();
    for (const { e, name } of list) {
      const text = `${name}\n${String(e.content ?? '')}`;
      const hit = idx.isDuplicate(text, 0.45);
      if (hit.dup && hit.with) {
        const other = list.find(x => x.name === hit.with);
        const me = list.find(x => x.name === name)!;
        const shared = other ? [...me.keys].filter(k => other.keys.has(k)) : [];
        const pair = [name, hit.with].sort().join(' ⇄ ');
        if (shared.length > 0 && !reported.has(pair)) {
          reported.add(pair);
          issues.push({
            level: 'warning',
            code: 'duplicate-entry-content',
            message: `Entry "${name}" và "${hit.with}" nói gần như cùng một nội dung (${Math.round((hit.score ?? 0) * 100)}% giống) VÀ dùng chung từ khoá "${shared.slice(0, 3).join('", "')}" — mỗi lần nhắc tới là cả hai cùng bật, gửi hai bản mô tả trùng nhau cho AI. Nên gộp làm một, hoặc tách từ khoá cho rõ phạm vi.`,
            where: name,
            autofixable: false,   // gộp nội dung cần đọc hiểu — máy không được tự ý xoá lore
          });
        }
      }
      idx.add(name, text);
    }
  }

  return issues;
}
