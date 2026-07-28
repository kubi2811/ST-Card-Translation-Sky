/**
 * src/lib/ai/cardTuning.ts — (bug 141) "XEM TRƯỚC & TINH CHỈNH" trước khi tạo card.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: nút "Bắt đầu tạo card" nên đi sau một bước xem trước gồm:
 *   Bước 1 — xem + CHỈNH schema MVU mà AI định dùng (đổi tên, đổi phạm vi, xoá bớt, thêm ràng
 *            buộc riêng từng biến) ngay tại chỗ, kèm ô "copilot mini" nhờ AI sửa giùm + nút reset.
 *   Bước 2 — hệ thống dựng sẵn 3 phương án giao diện (Opening Form + Status Bar) TỪ schema đã
 *            chỉnh để so sánh, chọn 1.
 *   Bước 3 — Bắt đầu tạo Card: card phải áp dụng ĐÚNG 100% schema + giao diện đã chốt.
 *
 * File này là phần LOGIC THUẦN (test được): dựng/tuning state, khoá schema vào pipeline,
 * dựng 3 phương án theme. Phần màn hình nằm ở components/autocreator/PreviewTunerModal.tsx.
 */

import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { CardTuning } from '../../types/autoCreator.types';
import { normalizeMVUZODSchema } from '../mvuzod/normalizeSchema';
import { schemaToZodCode } from '../mvuzod/schemaInferencer';
import { buildProgrammaticRegex } from '../mvuzod/programmaticRegexBuilder';
import { THEME_PRESETS } from '../mvuzod/gameHtmlTemplates';

/** Chữ ký ý tưởng — tuning sinh từ ý tưởng nào thì chỉ dùng cho đúng ý tưởng đó. */
export function ideaSignature(idea: string): string {
  const t = String(idea ?? '').trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return `${t.length}:${h}`;
}

export function makeTuning(schema: MVUZODSchema, idea: string): CardTuning {
  const clean = normalizeMVUZODSchema(schema);
  return {
    schema: clean,
    originalSchema: JSON.parse(JSON.stringify(clean)) as MVUZODSchema,
    themeId: undefined,
    step: 1,
    confirmed: false,
    ideaSig: ideaSignature(idea),
  };
}

/**
 * Tuning còn DÙNG ĐƯỢC cho lần chạy này không: phải đã xác nhận, có schema, và ý tưởng
 * KHÔNG đổi từ lúc duyệt (ý tưởng đổi thì schema đã duyệt nói về một thế giới khác).
 */
export function tuningUsable(tuning: CardTuning | undefined, idea: string): boolean {
  return !!tuning
    && tuning.confirmed
    && Array.isArray(tuning.schema?.fields)
    && tuning.schema.fields.length > 0
    && tuning.ideaSig === ideaSignature(idea);
}

/**
 * Schema user sửa xong có còn HỢP LỆ không — chốt chặn cho cả sửa tay lẫn copilot mini.
 * "trừ khi người dùng sửa Schema quá phi logic" (lời user): đo được là (1) dựng được Zod code,
 * (2) còn ít nhất 1 field, (3) không hai lá trùng tên trong cùng nhóm (normalize đã dựng cây).
 */
export function validateTunedSchema(raw: unknown): { ok: boolean; schema: MVUZODSchema; problems: string[] } {
  const problems: string[] = [];
  const schema = normalizeMVUZODSchema(raw);
  if (schema.fields.length === 0) problems.push('Schema không còn field nào — card MVU cần ít nhất một biến.');
  try {
    schemaToZodCode(schema, 'Preview');
  } catch (e) {
    problems.push(`Schema không dựng được Zod code: ${e instanceof Error ? e.message : String(e)}`);
  }
  const seen = new Set<string>();
  const walk = (fs: MVUZODSchema['fields'], prefix: string) => {
    for (const f of fs) {
      const name = String(f.path ?? '').split('/').filter(Boolean).pop() ?? '';
      const key = `${prefix}/${name}`.toLowerCase();
      if (f.children?.length) { walk(f.children, key); continue; }
      if (seen.has(key)) problems.push(`Hai biến trùng tên "${name}" trong cùng nhóm — MVU chỉ giữ được một.`);
      seen.add(key);
    }
  };
  walk(schema.fields, '');
  return { ok: problems.length === 0, schema, problems };
}

/** MỘT phương án giao diện ở Bước 2. */
export interface ThemeChoice {
  themeId: string;
  label: string;
  /** HTML preview đầy đủ (Opening Form + Status Bar) — đổ vào iframe srcdoc. */
  previewHtml: string;
}

/** Nhãn hiện cho user — THEME_PRESETS chỉ có id máy. */
const THEME_LABELS: Record<string, string> = {
  three_kingdoms: 'Cổ phong / Tam quốc',
  ancient_egypt: 'Huyền bí / Ai Cập',
  fantasy_medieval: 'Fantasy trung cổ',
  scifi_cyberpunk: 'Sci-fi / Cyberpunk',
};

/**
 * (Bước 2) Dựng 3 phương án giao diện TỪ schema đã chỉnh — thuần máy (buildProgrammaticRegex),
 * không tốn call AI nào, nên đổi schema ở Bước 1 là 3 phương án đổi theo ngay.
 */
export function buildThemeChoices(schema: MVUZODSchema, gameName: string, count = 3): ThemeChoice[] {
  const ids = Object.keys(THEME_PRESETS).slice(0, Math.max(2, count));
  const out: ThemeChoice[] = [];
  for (const themeId of ids) {
    try {
      const built = buildProgrammaticRegex({
        schema: normalizeMVUZODSchema(schema),
        component: 'full_set',
        themeId,
        gameName,
      });
      out.push({ themeId, label: THEME_LABELS[themeId] ?? themeId, previewHtml: built.previewHtml });
    } catch { /* theme lỗi thì bỏ phương án đó, không chặn các phương án còn lại */ }
  }
  return out;
}

/**
 * (Bước 3 — "áp dụng đúng 100%") ÉP kết quả bước mvuzod dùng NGUYÊN schema đã duyệt.
 * AI vẫn sinh initvar/quy tắc/danh sách biến (việc cần sáng tác), nhưng schema thì KHÔNG
 * được khác một ly so với bản user đã chốt.
 */
export function applyLockedSchema<T extends { schema?: unknown }>(result: T, tuning: CardTuning): T {
  return { ...result, schema: JSON.parse(JSON.stringify(tuning.schema)) };
}

/** Khối prompt "schema đã khoá" — nối vào buildMvuzodPrompt khi tuning được dùng. */
export function lockedSchemaBlock(schema: MVUZODSchema): string {
  return `
═══ ⚠️ SCHEMA ĐÃ ĐƯỢC NGƯỜI DÙNG DUYỆT — KHOÁ CỨNG ═══
Người dùng đã xem trước và TỰ TAY tinh chỉnh schema dưới đây. Bạn PHẢI dùng NGUYÊN VĂN nó:
- KHÔNG thêm field, KHÔNG bớt field, KHÔNG đổi path/type/label/constraints/defaultValue.
- "initVarEntry", "updateRulesEntry", "varListEntry" phải khớp ĐÚNG từng biến của schema này
  (tên biến, kiểu, miền giá trị, enum) — không nhắc tới biến nào ngoài nó.
- Field có "checkRules" là RÀNG BUỘC RIÊNG người dùng viết cho biến đó — đưa nguyên văn vào
  quy tắc cập nhật của biến tương ứng.
- Trường "schema" trong JSON trả về: chép lại nguyên văn schema này.

SCHEMA ĐÃ DUYỆT:
${JSON.stringify(schema, null, 1)}
`;
}
