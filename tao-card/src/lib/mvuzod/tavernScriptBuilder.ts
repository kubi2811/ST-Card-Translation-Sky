/**
 * src/lib/mvuzod/tavernScriptBuilder.ts — Build TavernHelper Scripts for MVUZOD
 * Spec 9C Bước 5: MVU Import script + Schema registration script
 */

import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { TavernHelperScript } from '../../types/tavernHelper.types';
import { schemaToZodCode } from './schemaInferencer';

export type { TavernHelperScript };

// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT 1 — MVU IMPORT
// ═══════════════════════════════════════════════════════════════════════════

/** uuid v4 an toàn cho cả môi trường không có crypto.randomUUID (test/node cũ). */
function newScriptId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `th_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Build the MVU import script (required for MVUZOD to work).
 * (Fix bug #11) PHẢI trả về TavernHelperScript ĐẦY ĐỦ field — trước đây thiếu `type`, `id`,
 * `info`, `button`, `data` nên khi export card + load vào SillyTavern thì TavernHelper báo lỗi
 * (script không có id/type). Xuất JSON V3 thô (không inject) thì không dính vì không thêm script.
 */
export function buildMVUImportScript(): TavernHelperScript {
  return {
    type: 'script',
    enabled: true,
    name: 'MVU',
    id: newScriptId(),
    content: MVU_BUNDLE_IMPORT,
    info: '',
    // (bugNeedFix/97) PHẢI bật `button` — bundle MVU tự đăng ký 6 nút qua getButtonEvent
    // (Xử lý lại biến / Đọc lại biến khởi tạo / Chụp ảnh tầng / Diễn lại tầng / Thử lại phân
    // tích mô hình phụ / Xoá biến tầng cũ). Trước đây ta ghi `enabled: false` nên trong 酒馆助手
    // công tắc "按钮" tắt sẵn, người chơi mở thẻ ra không thấy nút nào và tưởng MVU hỏng.
    // Mặc định của chính TavernHelper cho field này cũng là true.
    button: { enabled: true, buttons: [] },
    data: {},
  };
}

export const MVU_BUNDLE_IMPORT =
  `import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';`;

// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT 2 — SCHEMA REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/** Dòng import bắt buộc để `registerMvuSchema` tồn tại trong script 酒馆助手. */
export const MVU_ZOD_IMPORT =
  `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';`;

/**
 * (bugNeedFix/97) Bọc code Zod trần thành script CHẠY ĐƯỢC trong 酒馆助手.
 *
 * Trước đây script "Cấu trúc biến …" chỉ chứa `export const Schema = z.object({…})` — không có
 * dòng import, cũng không có lệnh đăng ký. Nghĩa là schema được khai báo rồi… nằm im: MVU không
 * bao giờ biết tới nó, nên mọi ràng buộc/prefault trong schema đều vô tác dụng và người dùng phải
 * tự dán thêm phần import + `registerMvuSchema` bằng tay.
 *
 * Hàm này idempotent: code đã có sẵn import/đăng ký thì giữ nguyên, không bọc chồng.
 */
export function wrapSchemaCodeForTavernHelper(zodCode: string): string {
  const code = (zodCode || '').trim();
  const hasImport = /registerMvuSchema\s*}?\s*from\s*['"]/.test(code) || code.includes(MVU_ZOD_IMPORT);
  const hasRegister = /registerMvuSchema\s*\(\s*Schema\s*\)/.test(code);

  const parts: string[] = [];
  if (!hasImport) parts.push(MVU_ZOD_IMPORT, '');
  parts.push(code);
  if (!hasRegister) parts.push('', '$(() => {', '  registerMvuSchema(Schema);', '});');
  return parts.join('\n');
}

/**
 * Build the schema registration script with Zod code.
 */
export function buildSchemaScript(schema: MVUZODSchema, cardName: string): TavernHelperScript {
  return {
    type: 'script',
    enabled: true,
    name: `Cấu trúc biến ${cardName}`,
    id: newScriptId(),
    content: wrapSchemaCodeForTavernHelper(schemaToZodCode(schema, cardName)),
    info: '',
    // (bugNeedFix/97) đồng bộ với script MVU: để đúng mặc định của TavernHelper.
    button: { enabled: true, buttons: [] },
    data: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build both TavernHelper scripts needed for MVUZOD.
 */
export function buildMVUZODScripts(
  schema: MVUZODSchema,
  cardName: string,
): TavernHelperScript[] {
  return [
    buildMVUImportScript(),
    buildSchemaScript(schema, cardName),
  ];
}

/**
 * Check if card already has MVU scripts (by name).
 */
export function findExistingMVUScripts(
  scripts: Array<{ name: string; id?: string }>,
): { mvu: boolean; schema: boolean } {
  return {
    mvu: scripts.some(s => s.name === 'MVU'),
    schema: scripts.some(s => s.name.startsWith('Cấu trúc biến')),
  };
}
