/**
 * src/lib/worldbook/entryGroupAnalyzer.ts
 *
 * Smart Entry Analyzer — Phân tích & nhóm entries cho EJS Controller generation.
 * Phát hiện prefix patterns, nhóm entries theo era/category, và đề xuất strategy.
 */

import type { LorebookEntry } from '../../types';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface EntryGroup {
  /** Tên nhóm hiển thị (ví dụ: "Đấu 1", "NPC Đấu 2") */
  groupName: string;
  /** Regex pattern phát hiện được */
  pattern: string;
  /** Entries thuộc nhóm này */
  entries: LorebookEntry[];
  /** Schema field path liên quan (ví dụ "/Thời đại hiện tại") */
  schemaField?: string;
  /** Giá trị enum tương ứng (ví dụ "Đấu 1") */
  enumValue?: string;
  /** Sub-groups (ví dụ: NPC, Location, Event bên trong era) */
  subgroups?: EntryGroup[];
}

// (bugNeedFix/125) Doi ten tu 'setEntryEnabled' -> 'activate'. Ham setEntryEnabled KHONG ton
// tai trong ST-Prompt-template; extension chi cho KICH HOAT entry dang tat bang
// await activewi('ten entry', true). Ten cu day ca AI lan nguoi doc code di sai duong.
export type EjsStrategy = 'activate' | 'getwi';

export interface EntryAnalysis {
  /** Nhóm entries phát hiện được */
  groups: EntryGroup[];
  /** Entries constant/system (luôn bật, không toggle) */
  alwaysOnEntries: LorebookEntry[];
  /** Entries có thể bật/tắt */
  toggleableEntries: LorebookEntry[];
  /** Entries NPC (có prefix [NPC ...]) */
  npcEntries: LorebookEntry[];
  /** Entries EJS hiện có (@@preprocessing) */
  ejsEntries: LorebookEntry[];
  /** Entries không match pattern nào */
  ungroupedEntries: LorebookEntry[];
  /** Biến schema nên dùng làm điều kiện chính */
  suggestedControlVar: string;
  /** Mức độ phức tạp */
  complexity: 'simple' | 'medium' | 'complex';
  /** Strategy đề xuất */
  recommendedStrategy: EjsStrategy;
  /** NPC → aliases mapping (nếu có) */
  npcAliasMap: Record<string, string[]>;
  /** Keyword → entry comments mapping */
  keywordEntryMap: Record<string, string[]>;
  /** Compressed summary text cho AI prompt */
  promptSummary: string;
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** System entry prefixes that should never be toggled */
const SYSTEM_PREFIXES = ['[mvu_update]', '[initvar]', '[GENERATE]', '[RENDER]', '@INJECT', 'EJS:'];

/** NPC entry pattern: [NPC xxx] or [NPC xxx] Name */
const NPC_PATTERN = /^\[NPC\s+(.+?)\]\s*/i;

/** Common prefix patterns to detect (era-based, category-based) */
const COMMON_PREFIX_SEPARATORS = [':', '：', ' - ', '—', '–'];

// ─── MAIN FUNCTION ──────────────────────────────────────────────────────────

/**
 * Phân tích toàn bộ entries trong worldbook, phát hiện patterns,
 * nhóm entries, và đề xuất strategy cho EJS Controller.
 */
export function analyzeEntryGroups(
  entries: LorebookEntry[],
  schema: MVUZODSchema | null,
): EntryAnalysis {
  // 1. Classify entries
  const classified = classifyEntries(entries);

  // 2. Detect prefix patterns in toggleable entries
  const prefixGroups = detectPrefixGroups(classified.toggleable);

  // 3. Map schema enum fields to entry groups
  const enrichedGroups = schema
    ? mapSchemaToGroups(prefixGroups, schema)
    : prefixGroups;

  // 4. Build NPC alias map
  const npcAliasMap = buildNpcAliasMap(classified.npc);

  // 5. Build keyword → entry mapping
  const keywordEntryMap = buildKeywordEntryMap(classified.toggleable);

  // 6. Find ungrouped entries
  const groupedIds = new Set(enrichedGroups.flatMap(g => g.entries.map(e => e.id)));
  const ungrouped = classified.toggleable.filter(e => !groupedIds.has(e.id));

  // 7. Determine complexity & strategy
  const totalToggleable = classified.toggleable.length;
  const complexity: EntryAnalysis['complexity'] =
    totalToggleable < 30 ? 'simple' :
    totalToggleable < 100 ? 'medium' : 'complex';

  const recommendedStrategy: EjsStrategy =
    totalToggleable >= 50 ? 'getwi' : 'activate';

  // 8. Find best control variable
  const suggestedControlVar = findBestControlVar(enrichedGroups, schema);

  // 9. Build compressed summary for AI prompt
  const promptSummary = buildPromptSummary(
    enrichedGroups,
    classified,
    complexity,
    recommendedStrategy,
    suggestedControlVar,
  );

  return {
    groups: enrichedGroups,
    alwaysOnEntries: classified.alwaysOn,
    toggleableEntries: classified.toggleable,
    npcEntries: classified.npc,
    ejsEntries: classified.ejs,
    ungroupedEntries: ungrouped,
    suggestedControlVar,
    complexity,
    recommendedStrategy,
    npcAliasMap,
    keywordEntryMap,
    promptSummary,
  };
}

// ─── STEP 1: CLASSIFY ENTRIES ───────────────────────────────────────────────

interface ClassifiedEntries {
  alwaysOn: LorebookEntry[];
  toggleable: LorebookEntry[];
  npc: LorebookEntry[];
  ejs: LorebookEntry[];
}

function classifyEntries(entries: LorebookEntry[]): ClassifiedEntries {
  const alwaysOn: LorebookEntry[] = [];
  const toggleable: LorebookEntry[] = [];
  const npc: LorebookEntry[] = [];
  const ejs: LorebookEntry[] = [];

  for (const entry of entries) {
    const comment = (entry.comment || '').trim();
    const content = (entry.content || '').trimStart();

    // EJS entries (@@preprocessing)
    if (content.startsWith('@@preprocessing')) {
      ejs.push(entry);
      continue;
    }

    // System entries (MVU, initvar, etc.)
    if (isSystemEntry(comment)) {
      alwaysOn.push(entry);
      continue;
    }

    // Constant entries (blue lamp) that aren't system
    if (entry.constant) {
      alwaysOn.push(entry);
      continue;
    }

    // NPC entries
    if (NPC_PATTERN.test(comment)) {
      npc.push(entry);
      toggleable.push(entry); // NPCs are also toggleable
      continue;
    }

    // Everything else is toggleable
    toggleable.push(entry);
  }

  return { alwaysOn, toggleable, npc, ejs };
}

function isSystemEntry(comment: string): boolean {
  const lower = comment.toLowerCase();
  return SYSTEM_PREFIXES.some(prefix => lower.startsWith(prefix.toLowerCase()));
}

// ─── STEP 2: DETECT PREFIX GROUPS ───────────────────────────────────────────

function detectPrefixGroups(entries: LorebookEntry[]): EntryGroup[] {
  // Count prefix occurrences
  const prefixCounts = new Map<string, LorebookEntry[]>();

  for (const entry of entries) {
    const comment = (entry.comment || '').trim();
    if (!comment) continue;

    // Try each separator to find prefix
    for (const sep of COMMON_PREFIX_SEPARATORS) {
      const sepIdx = comment.indexOf(sep);
      if (sepIdx > 0 && sepIdx < 30) {
        const prefix = comment.substring(0, sepIdx).trim();
        if (prefix.length >= 2) {
          const existing = prefixCounts.get(prefix) || [];
          existing.push(entry);
          prefixCounts.set(prefix, existing);
        }
        break; // Use first matching separator
      }
    }

    // Also check for bracket prefix: [NPC Đấu 1] Name
    const bracketMatch = comment.match(/^\[(.+?)\]/);
    if (bracketMatch) {
      const prefix = bracketMatch[1].trim();
      const existing = prefixCounts.get(`[${prefix}]`) || [];
      existing.push(entry);
      prefixCounts.set(`[${prefix}]`, existing);
    }
  }

  // Filter: only keep prefixes with >= 3 entries (meaningful groups)
  const groups: EntryGroup[] = [];
  for (const [prefix, groupEntries] of prefixCounts) {
    if (groupEntries.length >= 3) {
      groups.push({
        groupName: prefix,
        pattern: prefix,
        entries: groupEntries,
      });
    }
  }

  // Sort by number of entries (largest first)
  groups.sort((a, b) => b.entries.length - a.entries.length);

  // Deduplicate: if an entry appears in multiple groups, keep it in the largest
  const assignedIds = new Set<number>();
  for (const group of groups) {
    group.entries = group.entries.filter(e => {
      if (assignedIds.has(e.id)) return false;
      assignedIds.add(e.id);
      return true;
    });
  }

  // Remove empty groups after dedup
  return groups.filter(g => g.entries.length >= 2);
}

// ─── STEP 3: MAP SCHEMA ENUM TO GROUPS ──────────────────────────────────────

function mapSchemaToGroups(groups: EntryGroup[], schema: MVUZODSchema): EntryGroup[] {
  const enumFields = collectLeafFields(schema.fields)
    .filter(f => f.constraints?.enumValues?.length);

  for (const group of groups) {
    // Try to match group name with enum values
    for (const field of enumFields) {
      const enumVals = field.constraints.enumValues ?? [];
      for (const val of enumVals) {
        if (
          group.groupName === val ||
          group.groupName.includes(val) ||
          val.includes(group.groupName)
        ) {
          group.schemaField = field.path;
          group.enumValue = val;
          break;
        }
      }
      if (group.schemaField) break;
    }
  }

  return groups;
}

// ─── STEP 4: BUILD NPC ALIAS MAP ────────────────────────────────────────────

function buildNpcAliasMap(npcEntries: LorebookEntry[]): Record<string, string[]> {
  const aliasMap: Record<string, string[]> = {};

  for (const entry of npcEntries) {
    const comment = (entry.comment || '').trim();
    const match = comment.match(NPC_PATTERN);
    if (!match) continue;

    // Extract NPC name (after the [NPC xxx] prefix)
    const npcName = comment.replace(NPC_PATTERN, '').trim();
    if (!npcName) continue;

    // Extract group info (era) from the prefix
    const era = match[1].trim();
    const key = `${era}/${npcName}`;

    // Build aliases from entry keys
    const aliases = entry.keys
      .filter(k => k && k !== '@@ejs' && !k.startsWith('@@'))
      .map(k => k.trim())
      .filter(Boolean);

    // Add the NPC name itself
    if (!aliases.includes(npcName)) {
      aliases.unshift(npcName);
    }

    aliasMap[key] = aliases;
  }

  return aliasMap;
}

// ─── STEP 5: BUILD KEYWORD → ENTRY MAP ─────────────────────────────────────

function buildKeywordEntryMap(entries: LorebookEntry[]): Record<string, string[]> {
  const kwMap: Record<string, string[]> = {};

  for (const entry of entries) {
    const comment = (entry.comment || '').trim();
    if (!comment) continue;

    // Use entry keys as keywords
    for (const key of entry.keys) {
      const k = key.trim();
      if (!k || k.startsWith('@@') || k.length < 2) continue;

      if (!kwMap[k]) kwMap[k] = [];
      if (!kwMap[k].includes(comment)) {
        kwMap[k].push(comment);
      }
    }
  }

  // Filter: only keep keywords that map to 1-5 entries (too many = too generic)
  const filtered: Record<string, string[]> = {};
  for (const [kw, comments] of Object.entries(kwMap)) {
    if (comments.length >= 1 && comments.length <= 5) {
      filtered[kw] = comments;
    }
  }

  return filtered;
}

// ─── STEP 6: FIND BEST CONTROL VARIABLE ─────────────────────────────────────

function findBestControlVar(groups: EntryGroup[], schema: MVUZODSchema | null): string {
  // If any group has a schemaField mapping, use it
  const fieldsUsed = groups.filter(g => g.schemaField).map(g => g.schemaField!);
  if (fieldsUsed.length > 0) {
    // Return the most frequently mapped field
    const counts = new Map<string, number>();
    for (const f of fieldsUsed) {
      counts.set(f, (counts.get(f) || 0) + 1);
    }
    let best = '';
    let bestCount = 0;
    for (const [f, c] of counts) {
      if (c > bestCount) { best = f; bestCount = c; }
    }
    return best;
  }

  // Fallback: look for common era/state field names in schema
  if (schema) {
    const allFields = collectLeafFields(schema.fields);
    const eraField = allFields.find(f =>
      f.label.includes('Thời đại') ||
      f.label.includes('Era') ||
      f.label.includes('时代') ||
      f.label.includes('Phase') ||
      f.label.includes('Giai đoạn') ||
      (f.constraints?.enumValues?.length && f.constraints.enumValues.length >= 2)
    );
    if (eraField) return eraField.path;
  }

  return '';
}

// ─── STEP 7: BUILD PROMPT SUMMARY ───────────────────────────────────────────

function buildPromptSummary(
  groups: EntryGroup[],
  classified: ClassifiedEntries,
  complexity: EntryAnalysis['complexity'],
  strategy: EjsStrategy,
  controlVar: string,
): string {
  const lines: string[] = [];

  lines.push(`=== PHÂN TÍCH ENTRIES (${classified.toggleable.length} toggleable, ${classified.alwaysOn.length} constant, ${classified.ejs.length} EJS) ===`);
  lines.push(`Complexity: ${complexity} | Đề xuất strategy: ${strategy}`);

  if (controlVar) {
    lines.push(`Biến điều khiển chính: ${controlVar}`);
  }

  // Groups summary (compressed)
  if (groups.length > 0) {
    lines.push('');
    lines.push('--- NHÓM ENTRIES PHÁT HIỆN ĐƯỢC ---');
    for (const g of groups) {
      const sampleComments = g.entries.slice(0, 5).map(e => `"${e.comment}"`).join(', ');
      const enabledCount = g.entries.filter(e => e.enabled).length;
      const disabledCount = g.entries.length - enabledCount;
      const schemaInfo = g.schemaField ? ` → schema: ${g.schemaField}` : '';
      const enumInfo = g.enumValue ? ` (enum: "${g.enumValue}")` : '';
      lines.push(`  📁 "${g.groupName}" (${g.entries.length} entries, ${enabledCount} bật / ${disabledCount} tắt)${schemaInfo}${enumInfo}`);
      lines.push(`     Samples: ${sampleComments}${g.entries.length > 5 ? `, ... +${g.entries.length - 5} more` : ''}`);
    }
  }

  // NPC entries
  if (classified.npc.length > 0) {
    lines.push('');
    lines.push(`--- NPC ENTRIES (${classified.npc.length}) ---`);
    const npcByEra = new Map<string, string[]>();
    for (const entry of classified.npc) {
      const match = (entry.comment || '').match(NPC_PATTERN);
      if (match) {
        const era = match[1].trim();
        const name = (entry.comment || '').replace(NPC_PATTERN, '').trim();
        const list = npcByEra.get(era) || [];
        list.push(name);
        npcByEra.set(era, list);
      }
    }
    for (const [era, names] of npcByEra) {
      lines.push(`  [NPC ${era}]: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` ... +${names.length - 8} more` : ''}`);
    }
  }

  // Always-on entries
  if (classified.alwaysOn.length > 0) {
    lines.push('');
    lines.push(`--- ENTRIES LUÔN BẬT (${classified.alwaysOn.length}) — KHÔNG toggle ---`);
    for (const e of classified.alwaysOn.slice(0, 10)) {
      lines.push(`  🔵 "${e.comment}" (${e.constant ? 'constant' : 'system'})`);
    }
    if (classified.alwaysOn.length > 10) {
      lines.push(`  ... +${classified.alwaysOn.length - 10} more`);
    }
  }

  // Strategy-specific guidance
  lines.push('');
  if (strategy === 'getwi') {
    lines.push('--- STRATEGY: getwi() LOADING ---');
    lines.push('Entries sẽ được DISABLE và chỉ load qua await getwi(null, "comment") khi cần.');
    lines.push('Pattern: đọc biến → xác định era/context → load entries tương ứng bằng getwi()');
    lines.push('NPC: scan chat messages → tìm NPC được nhắc → load NPC entry bằng getwi()');
  } else {
    lines.push('--- STRATEGY: KICH HOAT CO DIEU KIEN (await activewi) ---');
    lines.push('Entries giữ nguyên trạng thái, EJS controller bật/tắt chúng theo điều kiện.');
    lines.push('Pattern: entry de TAT san → doc bien → if (dieu kien) { await activewi("comment", true); }');
  }

  // Full entry list for getwi strategy (AI needs exact comments)
  if (strategy === 'getwi' && classified.toggleable.length <= 200) {
    lines.push('');
    lines.push('--- DANH SÁCH ENTRIES CÓ THỂ LOAD (comment chính xác) ---');
    for (const e of classified.toggleable) {
      const status = e.enabled ? '🟢' : '🔴';
      lines.push(`  ${status} "${e.comment}"`);
    }
  }

  return lines.join('\n');
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function collectLeafFields(fields: MVUZODField[]): MVUZODField[] {
  const result: MVUZODField[] = [];
  function collect(ff: MVUZODField[]) {
    for (const f of ff) {
      if (f.children?.length) collect(f.children);
      else result.push(f);
    }
  }
  collect(fields);
  return result;
}
