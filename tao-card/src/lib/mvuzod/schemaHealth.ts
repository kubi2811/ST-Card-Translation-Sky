/**
 * schemaHealth.ts — (bug 216) KIỂM TRA SCHEMA MVUZOD CÓ THẬT SỰ CHẠY ĐƯỢC KHÔNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "sửa cho tab mvuzod tạo được các card mvuzod của sillytavern mà không bị lỗi CŨNG NHƯ
 * THÊM CƠ CHẾ KIỂM TRA XEM NÓ CÓ HOẠT ĐỘNG KHÔNG".
 *
 * Vì sao cần: tab MVUZOD trước đây ghi thẳng schema vào thẻ rồi hiện badge "Schema loaded" mà
 * chẳng kiểm gì. Schema 0 biến, schema không dựng nổi Zod code, tên biến trùng nhau, kiểu số mà
 * thiếu min/max… đều lọt hết — chỉ tới lúc chơi thật trong SillyTavern mới lộ.
 *
 * Đường Auto Creator vốn có `verifyMvuzodResult` chặn hai lỗi nặng nhất (schema rỗng, không dựng
 * được Zod). Bộ này rút đúng phép kiểm đó ra thành hàm THUẦN dùng chung, cộng thêm vài phép kiểm
 * mà kinh nghiệm các bug trước cho thấy là hay hỏng.
 *
 * Nguyên tắc: chỉ báo cái ĐO ĐƯỢC. Không đoán, không "cảnh báo cho có".
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { normalizeMVUZODSchema } from './normalizeSchema';
import { schemaToZodCode } from './schemaInferencer';

export type HealthLevel = 'error' | 'warning' | 'info';

export interface HealthIssue {
  level: HealthLevel;
  /** Mã ngắn để test bám vào, không phụ thuộc câu chữ. */
  code: string;
  message: string;
  /** Đường dẫn biến liên quan (nếu có). */
  path?: string;
}

export interface SchemaHealthReport {
  /** Không có lỗi mức `error` → schema dùng được. */
  ok: boolean;
  issues: HealthIssue[];
  stats: {
    totalFields: number;
    /** Đếm cả biến lồng trong `children`. */
    totalLeaves: number;
    maxDepth: number;
    zodCodeChars: number;
  };
}

/** Duyệt toàn bộ cây biến, kể cả nhánh con. */
function walk(
  fields: MVUZODField[] | undefined,
  visit: (f: MVUZODField, path: string, depth: number) => void,
  base = '',
  depth = 1,
): void {
  for (const f of fields ?? []) {
    const path = base ? `${base}.${f.label || f.path || '?'}` : (f.label || f.path || '?');
    visit(f, path, depth);
    const kids = (f as unknown as { children?: MVUZODField[] }).children;
    if (kids?.length) walk(kids, visit, path, depth + 1);
  }
}

/**
 * Chấm sức khoẻ một schema. KHÔNG BAO GIỜ ném — mọi hỏng hóc đều trả về dưới dạng issue, để UI
 * hiển thị được thay vì nổ trắng màn hình.
 */
export function checkSchemaHealth(input: MVUZODSchema | null | undefined): SchemaHealthReport {
  const issues: HealthIssue[] = [];
  const schema = normalizeMVUZODSchema(input);

  let totalLeaves = 0;
  let maxDepth = 0;
  const seen = new Map<string, number>();

  walk(schema.fields, (f, path, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = (f as unknown as { children?: MVUZODField[] }).children;
    if (!kids?.length) totalLeaves++;

    const key = (f.label || f.path || '').trim().toLowerCase();
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);

    if (!f.label && !f.path) {
      issues.push({ level: 'error', code: 'field-no-name', message: `Có biến KHÔNG CÓ TÊN (ở ${path}) — SillyTavern sẽ không đọc được.`, path });
    }
    if (!f.type) {
      issues.push({ level: 'error', code: 'field-no-type', message: `Biến "${path}" thiếu KIỂU dữ liệu.`, path });
    }
    // Kiểu số không có trần: dạng lỗi từng gặp ở bug 113 — giá trị chạy lố rồi bị cắt, mất dữ liệu thật.
    if (f.type === 'number') {
      const c = (f as unknown as { constraints?: { min?: number; max?: number } }).constraints;
      if (!c || (c.min === undefined && c.max === undefined)) {
        issues.push({ level: 'warning', code: 'number-no-range', message: `Biến số "${path}" chưa đặt min/max — nên đặt để AI không cho giá trị chạy lung tung.`, path });
      }
    }
    // Biến chuỗi có khai báo `enumValues` (danh sách chọn) mà để rỗng thì AI không biết chọn gì.
    if (f.type === 'string') {
      const c = (f as unknown as { constraints?: { enumValues?: unknown[] } }).constraints;
      if (c && 'enumValues' in c && (!Array.isArray(c.enumValues) || c.enumValues.length === 0)) {
        issues.push({ level: 'error', code: 'enum-empty', message: `Biến "${path}" khai báo danh sách chọn nhưng KHÔNG có giá trị nào.`, path });
      }
    }
    // `object`/`record` mà không có nhánh con thì rỗng ruột — AI không có gì để ghi vào.
    if ((f.type === 'object' || f.type === 'record') && !kids?.length) {
      issues.push({ level: 'warning', code: 'container-empty', message: `Biến "${path}" kiểu ${f.type} nhưng không có biến con nào bên trong.`, path });
    }
  });

  // ─── Chốt 1: schema rỗng (đây chính là ca làm user tưởng tab hỏng) ───
  if (!schema.fields || schema.fields.length === 0) {
    issues.push({
      level: 'error', code: 'empty-schema',
      message: 'Schema KHÔNG CÓ BIẾN NÀO. Thẻ sẽ không có trạng thái gì để theo dõi — hãy sinh lại hoặc thêm biến bằng tay.',
    });
  }

  // ─── Chốt 2: tên biến trùng nhau ───
  for (const [name, count] of seen) {
    if (count > 1) {
      issues.push({ level: 'warning', code: 'duplicate-name', message: `Tên biến "${name}" xuất hiện ${count} lần — dễ ghi đè nhau lúc chạy.` });
    }
  }

  // ─── Chốt 3: dựng được Zod code không (phép kiểm mà pipeline dùng để chặn) ───
  let zodCodeChars = 0;
  try {
    const code = schemaToZodCode(schema, 'HealthCheck');
    zodCodeChars = code.length;
    if (!code.trim()) {
      issues.push({ level: 'error', code: 'zod-empty', message: 'Không dựng được Zod code từ schema này.' });
    }
  } catch (e) {
    issues.push({
      level: 'error', code: 'zod-throw',
      message: `Dựng Zod code THẤT BẠI: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (maxDepth > 4) {
    issues.push({ level: 'warning', code: 'too-deep', message: `Cây biến sâu ${maxDepth} tầng — quá sâu thì AI hay cập nhật nhầm nhánh.` });
  }

  return {
    ok: !issues.some(i => i.level === 'error'),
    issues,
    stats: { totalFields: schema.fields?.length ?? 0, totalLeaves, maxDepth, zodCodeChars },
  };
}

/** Tóm tắt một dòng cho toast/log. */
export function summarizeHealth(r: SchemaHealthReport): string {
  const errs = r.issues.filter(i => i.level === 'error').length;
  const warns = r.issues.filter(i => i.level === 'warning').length;
  if (r.ok && warns === 0) return `✅ Schema chạy được — ${r.stats.totalLeaves} biến, sâu ${r.stats.maxDepth} tầng.`;
  if (r.ok) return `✅ Schema chạy được (${r.stats.totalLeaves} biến) — ${warns} cảnh báo nên xem.`;
  return `❌ Schema CHƯA dùng được: ${errs} lỗi${warns ? `, ${warns} cảnh báo` : ''}.`;
}
