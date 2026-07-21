/**
 * src/lib/export/cardPackager.ts — Complete Card Export Pipeline
 *
 * Orchestrates the full export process:
 * 1. Validate card completeness
 * 2. Inject MVUZOD system worldbook entries
 * 3. Inject regex patterns
 * 4. Inject Tavern Helper scripts
 * 5. Sync mirror fields
 * 6. Package as JSON and/or PNG
 *
 * This is the single entry point for "export complete card" workflow.
 */

import type { CharacterCardV3 } from '../../types/card.types';
import type { RegexScript, RegexPlacement } from '../../types/regex.types';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import { syncMirrorFields } from '../converters/cardDefaults';
import { syncEmbeddedWorldLink } from '../converters/worldLink';
import { exportCardV3, exportCardV2Compat } from '../converters/lorebookConvert';
import { writeCharaToPng, getDefaultCardPng, convertToPngBuffer } from '../converters/pngMetadata';
import { generateRegexPatterns, type GeneratedRegex } from '../mvuzod/scriptGenerator';
import { buildMVUImportScript, buildSchemaScript } from '../mvuzod/tavernScriptBuilder';
import {
  generateWorldbookEntries,
  applyGeneratedEntries,
  findExistingMVUZODEntries,
} from './worldbookGenerator';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ExportFormat = 'json' | 'png' | 'both';

export interface PackageOptions {
  /** Export format */
  format: ExportFormat;
  /** Inject MVUZOD worldbook entries */
  injectWorldbook: boolean;
  /** Inject MVUZOD regex patterns */
  injectRegex: boolean;
  /** Inject Tavern Helper scripts (MVU import + schema) */
  injectScripts: boolean;
  /** Replace existing system entries during injection */
  replaceExisting: boolean;
  /** Custom initvar values */
  initVarValues?: Record<string, unknown>;
  /** Which system entries to inject (default: all) */
  includeEntries?: string[];
}

export const DEFAULT_PACKAGE_OPTIONS: PackageOptions = {
  format: 'both',
  injectWorldbook: true,
  injectRegex: true,
  injectScripts: true,
  replaceExisting: true,
};

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  field: string;
  message: string;
}

export interface PackageResult {
  /** The packaged card (with injections applied) */
  card: CharacterCardV3;
  /** Validation issues found */
  validation: ValidationIssue[];
  /** What was injected */
  injections: string[];
  /** JSON blob (if format includes json) */
  jsonBlob?: Blob;
  /** PNG blob (if format includes png) */
  pngBlob?: Blob;
  /** Suggested filename (without extension) */
  filename: string;
  /** Total size in bytes */
  totalSize: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate card completeness before export.
 * Returns issues but never blocks export (all issues are warnings/info).
 */
export function validateCardForExport(
  card: CharacterCardV3,
  schema: MVUZODSchema | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Basic fields
  if (!card.data.name || card.data.name === 'New Character') {
    issues.push({ severity: 'warning', field: 'name', message: 'Tên nhân vật chưa đặt (vẫn là mặc định)' });
  }
  if (!card.data.description || card.data.description.length < 20) {
    issues.push({ severity: 'warning', field: 'description', message: 'Mô tả nhân vật quá ngắn hoặc trống' });
  }
  if (!card.data.first_mes || card.data.first_mes.length < 10) {
    issues.push({ severity: 'warning', field: 'first_mes', message: 'Tin nhắn mở đầu quá ngắn hoặc trống' });
  }

  // Lorebook
  const entries = card.data.character_book?.entries ?? [];
  if (entries.length === 0) {
    issues.push({ severity: 'info', field: 'lorebook', message: 'Lorebook trống — card sẽ không có world info' });
  }

  // MVUZOD specific
  if (schema) {
    if (schema.fields.length === 0) {
      issues.push({ severity: 'warning', field: 'mvuzod_schema', message: 'MVUZOD Schema không có field nào' });
    }

    // Check if system entries already exist
    const existing = findExistingMVUZODEntries(entries);
    const existingCount = Object.values(existing).flat().length;
    if (existingCount > 0) {
      issues.push({
        severity: 'info',
        field: 'mvuzod_entries',
        message: `Đã có ${existingCount} entries MVUZOD — sẽ được thay thế khi inject`,
      });
    }
  } else {
    issues.push({ severity: 'info', field: 'mvuzod', message: 'Không có MVUZOD Schema — bỏ qua injection biến số' });
  }

  // Token budget estimate
  const totalContent = [
    card.data.description,
    card.data.personality,
    card.data.scenario,
    card.data.system_prompt,
    card.data.post_history_instructions,
    card.data.first_mes,
    ...entries.map(e => e.content),
  ].join('\n');

  const estimatedTokens = Math.ceil(totalContent.length / 4);
  if (estimatedTokens > 30000) {
    issues.push({
      severity: 'warning',
      field: 'tokens',
      message: `Ước tính ~${estimatedTokens.toLocaleString()} tokens — có thể vượt context window`,
    });
  } else if (estimatedTokens > 15000) {
    issues.push({
      severity: 'info',
      field: 'tokens',
      message: `Ước tính ~${estimatedTokens.toLocaleString()} tokens`,
    });
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════
// PACKAGING ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Package a complete card for export.
 * This is the main entry point for the export pipeline.
 */
export async function packageCard(
  card: CharacterCardV3,
  schema: MVUZODSchema | null,
  options: PackageOptions = DEFAULT_PACKAGE_OPTIONS,
): Promise<PackageResult> {
  // Work on a deep clone to avoid mutating the original
  const exportCard = structuredClone(card);
  const injections: string[] = [];

  // Ensure character_book exists
  if (!exportCard.data.character_book) {
    exportCard.data.character_book = { name: exportCard.data.name, entries: [] };
  }

  // ─── Step 1: Inject MVUZOD Worldbook Entries ──────────────────────────
  if (options.injectWorldbook && schema && schema.fields.length > 0) {
    const existingEntries = exportCard.data.character_book.entries;
    const generated = generateWorldbookEntries(schema, existingEntries, {
      include: options.includeEntries,
      replaceExisting: options.replaceExisting,
      initVarValues: options.initVarValues,
    });

    exportCard.data.character_book.entries = applyGeneratedEntries(existingEntries, generated);
    injections.push(`Worldbook: ${generated.entries.length} system entries injected`);

    if (generated.replacedEntryIds.length > 0) {
      injections.push(`Worldbook: ${generated.replacedEntryIds.length} existing entries replaced`);
    }
  }

  // ─── Step 2: Inject Regex Patterns ────────────────────────────────────
  if (options.injectRegex && schema) {
    const patterns = generateRegexPatterns();
    const existingRegex = exportCard.data.extensions.regex_scripts ?? [];
    const injectedRegex = mergeRegexPatterns(existingRegex, patterns);
    exportCard.data.extensions.regex_scripts = injectedRegex;
    injections.push(`Regex: ${patterns.length} patterns injected`);
  }

  // ─── Step 3: Inject Tavern Helper Scripts ─────────────────────────────
  // (Fix bug #11) build*Script nay tra ve TavernHelperScript DAY DU field (type/id/info/button/data).
  // Thay-hoac-them CA HAI script (MVU + Schema): neu card da co script cu (co the do ban export loi
  // truoc do, thieu id/type) thi GHI DE bang ban dung + GIU nguyen id cu → khong tao trung, khong
  // vo TavernHelper khi load vao SillyTavern.
  if (options.injectScripts && schema && schema.fields?.length) {
    const newScripts = [...(exportCard.data.extensions.tavern_helper?.scripts ?? [])];

    const mvuIdx = newScripts.findIndex(s => s.name === 'MVU');
    const mvuImport = buildMVUImportScript();
    if (mvuIdx >= 0) {
      newScripts[mvuIdx] = { ...mvuImport, id: newScripts[mvuIdx].id };
      injections.push('Script: MVU Import script updated');
    } else {
      newScripts.push(mvuImport);
      injections.push('Script: MVU Import script injected');
    }

    const schemaScript = buildSchemaScript(schema, exportCard.data.name);
    const schemaIdx = newScripts.findIndex(s => s.name.startsWith('Cấu trúc biến'));
    if (schemaIdx >= 0) {
      newScripts[schemaIdx] = { ...schemaScript, id: newScripts[schemaIdx].id };
      injections.push('Script: Schema script updated');
    } else {
      newScripts.push(schemaScript);
      injections.push('Script: Schema script injected');
    }

    exportCard.data.extensions.tavern_helper = {
      scripts: newScripts,
      variables: exportCard.data.extensions.tavern_helper?.variables ?? {},
    };
  }

  // ─── Step 4: Sync Mirror Fields ───────────────────────────────────────
  const finalCard = syncMirrorFields(exportCard);

  // ─── Step 4b: Nối lorebook nhúng vào nhân vật ─────────────────────────
  // (bug 73) SillyTavern buộc nhân vật với world qua data.extensions.world — app này trước
  // giờ chưa từng ghi field đó, nên import xong lorebook nằm rời, user phải tự vào
  // "More… → Import Card Lore" rồi tự gắn. Thêm nữa, tên sách hay dính giá trị chung chung
  // ('New Character', 'Imported Lorebook'…) khiến card sau ghi đè world của card trước.
  const link = syncEmbeddedWorldLink(finalCard, card);
  if (link.relinkedWorld) {
    injections.push(
      `World: nối lorebook vào nhân vật (World = "${link.worldName}")` +
      (link.renamedBook ? ' — sách chưa có tên riêng nên đã tự đặt' : ''),
    );
  }

  // ─── Step 5: Validate ─────────────────────────────────────────────────
  const validation = validateCardForExport(finalCard, schema);

  // ─── Step 6: Generate output blobs ────────────────────────────────────
  const safeName = finalCard.data.name.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF_-]/g, '_') || 'card';
  let jsonBlob: Blob | undefined;
  let pngBlob: Blob | undefined;
  let totalSize = 0;

  if (options.format === 'json' || options.format === 'both') {
    const jsonStr = exportCardV3(finalCard);
    jsonBlob = new Blob([jsonStr], { type: 'application/json' });
    totalSize += jsonBlob.size;
  }

  if (options.format === 'png' || options.format === 'both') {
    const v3Json = exportCardV3(finalCard);
    const v2Json = exportCardV2Compat(finalCard);
    let pngBuffer: ArrayBuffer;

    if (finalCard.avatar && finalCard.avatar.startsWith('data:image/')) {
      pngBuffer = await convertToPngBuffer(finalCard.avatar);
    } else {
      pngBuffer = await getDefaultCardPng(finalCard.data.name);
    }

    const outputBuffer = writeCharaToPng(pngBuffer, v3Json, v2Json);
    pngBlob = new Blob([outputBuffer], { type: 'image/png' });
    totalSize += pngBlob.size;
  }

  return {
    card: finalCard,
    validation,
    injections,
    jsonBlob,
    pngBlob,
    filename: safeName,
    totalSize,
  };
}

/**
 * Download blobs from a PackageResult.
 */
export function downloadPackageResult(result: PackageResult): void {
  if (result.jsonBlob) {
    downloadBlob(result.jsonBlob, `${result.filename}_v3.json`);
  }
  if (result.pngBlob) {
    downloadBlob(result.pngBlob, `${result.filename}.png`);
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge generated regex patterns with existing ones (dedup by name).
 */
function mergeRegexPatterns(
  existing: RegexScript[],
  generated: GeneratedRegex[],
): RegexScript[] {
  const result = [...existing];
  const existingNames = new Set(existing.map(r => r.scriptName));

  for (const gen of generated) {
    if (existingNames.has(gen.name)) {
      // Update existing
      const idx = result.findIndex(r => r.scriptName === gen.name);
      if (idx >= 0) {
        result[idx] = {
          ...result[idx],
          findRegex: gen.findRegex,
          replaceString: gen.replaceString,
        };
      }
    } else {
      // Add new
      result.push({
        id: crypto.randomUUID?.() ?? `regex_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        scriptName: gen.name,
        findRegex: gen.findRegex,
        replaceString: gen.replaceString,
        trimStrings: [],
        placement: [gen.scope === 'ai_output' ? 1 : gen.scope === 'user_input' ? 0 : 1] as unknown as RegexPlacement[],
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      });
    }
  }

  return result;
}

