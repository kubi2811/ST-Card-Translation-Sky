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
    content: `import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';`,
    info: '',
    button: { enabled: false, buttons: [] },
    data: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT 2 — SCHEMA REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the schema registration script with Zod code.
 */
export function buildSchemaScript(schema: MVUZODSchema, cardName: string): TavernHelperScript {
  return {
    type: 'script',
    enabled: true,
    name: `Cấu trúc biến ${cardName}`,
    id: newScriptId(),
    content: schemaToZodCode(schema, cardName),
    info: '',
    button: { enabled: false, buttons: [] },
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
