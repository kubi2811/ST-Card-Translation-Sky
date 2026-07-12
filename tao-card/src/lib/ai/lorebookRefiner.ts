/**
 * src/lib/ai/lorebookRefiner.ts — AI Lorebook Refiner Engine
 * Pipeline 4 phases: Pre-Analysis → AI Analysis → Preview → Apply
 */

import type {
  RefinerConfig, RefinerAction, RefinerProgress, RefinerReport,
  RefinerActionType,
} from '../../types/lorebookRefiner.types';
import type { LorebookEntry } from '../../types/lorebook.types';
import type { CharacterCardV3, ProxyProfile, GenerationParams, ChatMessage } from '../../types';
import { callAI, computePoolConcurrency } from './client';
import { buildRefinerSystemPrompt, buildRefinerUserMessage } from './refinerPrompts';
import { checkWorldbookHealth } from '../worldbook/worldbookHealthCheck';
import { isDuplicateEntry } from './deduplicator';
import { TFIDFIndex } from '../rag/tfidfIndexer';
import { materializeEntry } from '../converters/cardDefaults';
import { isSystemEntry } from './refinerUtils';

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export interface RefinerContext {
  card: CharacterCardV3;
  profile: ProxyProfile;
  generationParams: GenerationParams;
  schemaContext?: string;

  // Control
  paused: boolean;
  stopped: boolean;
  /** Hủy call AI đang bay khi bấm Dừng hẳn (stopped chỉ chặn call KẾ TIẾP). */
  signal?: AbortSignal;

  // Callbacks
  log: (message: string) => void;
  onProgress: (progress: RefinerProgress) => void;
  onActionsReady: (actions: RefinerAction[]) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let actionIdCounter = 0;
function genActionId(): string {
  return `refact_${Date.now()}_${actionIdCounter++}`;
}

function tryExtractRefinerActions(text: string): Array<Record<string, unknown>> | null {
  // Try raw parse
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch { /* continue */ }

  // Try extracting from code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  // Try finding array in text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  return null;
}

const VALID_ACTION_TYPES: RefinerActionType[] = [
  'add_entry', 'rewrite_content', 'expand_content', 'fix_keys', 'fix_config',
  'fix_uid', 'merge_entries', 'delete_entry', 'fix_content_error',
];

function parseRawAction(raw: Record<string, unknown>): RefinerAction | null {
  const type = raw.type as string;
  if (!VALID_ACTION_TYPES.includes(type as RefinerActionType)) return null;

  // Validate required fields
  if (!raw.reason || typeof raw.reason !== 'string') return null;

  // add_entry requires newContent + newComment + newKeys
  if (type === 'add_entry') {
    if (!raw.newContent || !raw.newComment || !Array.isArray(raw.newKeys)) return null;
  }

  // rewrite_content / fix_content_error / expand_content requires newContent + targetEntryId
  if ((type === 'rewrite_content' || type === 'fix_content_error' || type === 'expand_content') && !raw.newContent) return null;

  // merge_entries requires mergeTargetId + mergedContent
  if (type === 'merge_entries' && (raw.mergeTargetId == null || !raw.mergedContent)) return null;

  return {
    id: genActionId(),
    type: type as RefinerActionType,
    targetEntryId: typeof raw.targetEntryId === 'number' ? raw.targetEntryId : undefined,
    targetComment: typeof raw.targetComment === 'string' ? raw.targetComment : undefined,
    reason: raw.reason as string,
    severity: (['critical', 'warning', 'suggestion'].includes(raw.severity as string)
      ? raw.severity : 'suggestion') as RefinerAction['severity'],
    newContent: typeof raw.newContent === 'string' ? raw.newContent : undefined,
    newKeys: Array.isArray(raw.newKeys) ? raw.newKeys.map(String) : undefined,
    newSecondaryKeys: Array.isArray(raw.newSecondaryKeys) ? raw.newSecondaryKeys.map(String) : undefined,
    newComment: typeof raw.newComment === 'string' ? raw.newComment : undefined,
    configPatch: raw.configPatch && typeof raw.configPatch === 'object'
      ? raw.configPatch as RefinerAction['configPatch']
      : undefined,
    newUid: typeof raw.newUid === 'number' ? raw.newUid : undefined,
    mergeTargetId: typeof raw.mergeTargetId === 'number' ? raw.mergeTargetId : undefined,
    mergeTargetComment: typeof raw.mergeTargetComment === 'string' ? raw.mergeTargetComment : undefined,
    mergedContent: typeof raw.mergedContent === 'string' ? raw.mergedContent : undefined,
    mergedKeys: Array.isArray(raw.mergedKeys) ? raw.mergedKeys.map(String) : undefined,
    replaceOriginal: typeof raw.replaceOriginal === 'boolean' ? raw.replaceOriginal : undefined,
    applied: false,
    skipped: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: PRE-ANALYSIS (Local — no AI needed)
// ═══════════════════════════════════════════════════════════════════════════

async function runPreAnalysis(
  entries: LorebookEntry[],
  config: RefinerConfig,
  log: (msg: string) => void,
): Promise<RefinerAction[]> {
  const actions: RefinerAction[] = [];

  // Filter out system entries — don't touch EJS/MVU entries
  const processableEntries = entries.filter(e => !isSystemEntry(e));

  // ── 1A. Fix duplicate UIDs ──
  if (config.fixDuplicateUids) {
    const seenIds = new Set<number>();
    let maxId = entries.length > 0 ? Math.max(...entries.map(e => e.id)) : 0;
    for (const entry of processableEntries) {
      if (seenIds.has(entry.id)) {
        maxId++;
        actions.push({
          id: genActionId(),
          type: 'fix_uid',
          targetEntryId: entry.id,
          targetComment: entry.comment,
          reason: `UID ${entry.id} bị trùng với entry khác. Gán UID mới: ${maxId}`,
          severity: 'critical',
          newUid: maxId,
          applied: false,
          skipped: false,
        });
      } else {
        seenIds.add(entry.id);
      }
    }
    if (actions.filter(a => a.type === 'fix_uid').length > 0) {
      log(`🆔 Phát hiện ${actions.filter(a => a.type === 'fix_uid').length} UID trùng`);
    }
  }

  // ── 1B. Health check issues → fix_config / fix_keys actions ──
  if (config.fixConfigIssues || config.fixKeywordIssues) {
    const healthReport = await checkWorldbookHealth(processableEntries, 'single');
    for (const item of healthReport.items) {
      if (!item.autoFixable || !item.fix) continue;

      // Map health check codes to refiner actions
      if (config.fixKeywordIssues && (item.code === 'FULLWIDTH_COMMA' || item.code === 'KEYWORD_SPACE')) {
        actions.push({
          id: genActionId(),
          type: 'fix_keys',
          targetEntryId: item.entryId,
          targetComment: item.comment,
          reason: item.message,
          severity: item.level === 'error' ? 'critical' : 'warning',
          newKeys: item.fix.keys,
          newSecondaryKeys: item.fix.secondary_keys,
          applied: false,
          skipped: false,
        });
      }

      if (config.fixConfigIssues && ['RECURSION_OFF', 'SINGLE_CARD_NOT_CONSTANT', 'POSITION_MISMATCH', 'D0_NOT_SYSTEM', 'DEPTH_NOT_ZERO', 'SCAN_DEPTH_NULL'].includes(item.code)) {
        const patch: Record<string, unknown> = {};
        if (item.fix.extensions) {
          Object.assign(patch, item.fix.extensions);
        }
        if (item.fix.constant !== undefined) patch.constant = item.fix.constant;
        if (item.fix.selective !== undefined) patch.selective = item.fix.selective;

        actions.push({
          id: genActionId(),
          type: 'fix_config',
          targetEntryId: item.entryId,
          targetComment: item.comment,
          reason: item.message,
          severity: item.level === 'error' ? 'critical' : 'warning',
          configPatch: patch as RefinerAction['configPatch'],
          applied: false,
          skipped: false,
        });
      }
    }

    const configFixes = actions.filter(a => a.type === 'fix_config').length;
    const keyFixes = actions.filter(a => a.type === 'fix_keys').length;
    if (configFixes > 0) log(`⚙️ Phát hiện ${configFixes} lỗi cấu hình`);
    if (keyFixes > 0) log(`🔑 Phát hiện ${keyFixes} lỗi keywords`);
  }

  return actions;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: AI ANALYSIS (Batch processing)
// ═══════════════════════════════════════════════════════════════════════════

async function runAIAnalysis(
  entries: LorebookEntry[],
  config: RefinerConfig,
  ctx: RefinerContext,
): Promise<RefinerAction[]> {
  const allActions: RefinerAction[] = [];

  // Determine which entries to process — exclude system entries
  const nonSystemEntries = entries.filter(e => !isSystemEntry(e));
  const entriesToProcess = config.maxEntriesToProcess > 0
    ? nonSystemEntries.slice(0, config.maxEntriesToProcess)
    : nonSystemEntries;

  // Split into batches
  const batches: LorebookEntry[][] = [];
  for (let i = 0; i < entriesToProcess.length; i += config.entriesPerBatch) {
    batches.push(entriesToProcess.slice(i, i + config.entriesPerBatch));
  }

  // If add_only mode and no entries or few entries, create a "virtual" batch
  if (config.operationMode === 'add_only' && batches.length === 0) {
    batches.push([]);
  }

  const totalBatches = batches.length;
  // (Fix bug #9-1) TÔN TRỌNG "số batch song song" user chỉnh (config.concurrentBatches). Trước đây
  // bị đổi thành computePoolConcurrency (Σ key×RPM) nên luôn = RPM (vd 5) bất kể user chỉnh. Nay
  // lấy giá trị user, chỉ chặn TRẦN bằng pool RPM (tránh 429) và tổng số batch.
  const poolCap = Math.max(1, computePoolConcurrency(ctx.profile));
  const userConcurrency = Math.max(1, config.concurrentBatches || 2);
  const concurrency = Math.max(1, Math.min(userConcurrency, poolCap, totalBatches));
  const profile = config.modelOverride
    ? { ...ctx.profile, selectedModel: config.modelOverride }
    : ctx.profile;

  ctx.log(`📡 Bắt đầu AI Analysis: ${totalBatches} batches (${concurrency} song song)`);

  const systemPrompt = buildRefinerSystemPrompt(config);

  // Process in rounds of `concurrency`
  for (let roundStart = 0; roundStart < totalBatches; roundStart += concurrency) {
    if (ctx.stopped) break;
    while (ctx.paused) { await sleep(300); }

    const roundEnd = Math.min(roundStart + concurrency, totalBatches);
    const roundIndices: number[] = [];
    for (let i = roundStart; i < roundEnd; i++) roundIndices.push(i);

    const tasks = roundIndices.map(i => ({
      batchIndex: i,
      batchEntries: batches[i],
      messages: [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: buildRefinerUserMessage(
            entries, batches[i], config,
            i + 1, totalBatches, ctx.schemaContext,
          ),
        },
      ] as ChatMessage[],
    }));

    // Execute concurrently
    const results = await Promise.all(tasks.map(async task => {
      if (ctx.stopped) return [];

      for (let attempt = 0; attempt <= 2; attempt++) {
        if (ctx.stopped) return [];
        // (Fix bug #9-2) Tạm dừng có tác dụng NGAY trong lúc chạy: giữ ở đây trước mỗi lượt gọi.
        while (ctx.paused && !ctx.stopped) await sleep(300);
        if (ctx.stopped) return [];
        try {
          ctx.log(`📡 Batch ${task.batchIndex + 1}/${totalBatches} — gọi AI${attempt > 0 ? ` (thử lại ${attempt})` : ''}...`);
          const raw = await callAI({ profile, params: ctx.generationParams, messages: task.messages, signal: ctx.signal });
          const parsed = tryExtractRefinerActions(raw.text);
          if (!parsed || parsed.length === 0) {
            ctx.log(`⚠️ Batch ${task.batchIndex + 1} — AI không trả về actions hợp lệ, thử lại...`);
            continue;
          }

          const actions: RefinerAction[] = [];
          for (const rawAction of parsed) {
            const action = parseRawAction(rawAction);
            if (action) actions.push(action);
          }

          ctx.log(`✅ Batch ${task.batchIndex + 1} — ${actions.length} actions`);
          return actions;
        } catch (err) {
          // Người dùng bấm "Dừng hẳn" → abort: thoát NGAY, không log lỗi oan, không thử lại.
          if (ctx.stopped || (err instanceof DOMException && err.name === 'AbortError')) return [];
          ctx.log(`⚠️ Batch ${task.batchIndex + 1} — lỗi: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      ctx.log(`❌ Batch ${task.batchIndex + 1} thất bại sau 3 lần thử.`);
      return [];
    }));

    for (const batchActions of results) {
      allActions.push(...batchActions);
    }

    ctx.onProgress({
      phase: 'ai_analysis',
      currentBatch: roundEnd,
      totalBatches,
      actionsFound: allActions.length,
      actionsApplied: 0,
      message: `Đã phân tích ${roundEnd}/${totalBatches} batches — ${allActions.length} actions`,
    });
  }

  return allActions;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: DEDUP NEW ENTRIES (for add_entry actions)
// ═══════════════════════════════════════════════════════════════════════════

function deduplicateNewEntries(
  actions: RefinerAction[],
  existingEntries: LorebookEntry[],
  log: (msg: string) => void,
): RefinerAction[] {
  const ragIndex = new TFIDFIndex();
  ragIndex.indexWithSource(existingEntries);

  return actions.filter(action => {
    if (action.type !== 'add_entry') return true;
    if (!action.newContent || !action.newKeys) return true;

    const dupCheck = isDuplicateEntry(
      {
        comment: action.newComment || '',
        keys: action.newKeys,
        content: action.newContent,
      },
      existingEntries,
      ragIndex,
    );

    if (dupCheck.isDuplicate) {
      log(`⏭️ Bỏ qua thêm "${action.newComment}" — trùng với "${dupCheck.conflictWith}" (${dupCheck.reason})`);
      return false;
    }
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: APPLY ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface ApplyContext {
  getEntries: () => LorebookEntry[];
  addEntry: (entry: LorebookEntry) => void;
  updateEntry: (id: number, patch: Partial<LorebookEntry>) => void;
  deleteEntry: (id: number) => void;
  getNextEntryId: () => number;
  log: (msg: string) => void;
}

export function applyRefinerActions(
  actions: RefinerAction[],
  ctx: ApplyContext,
): RefinerReport {
  const report: RefinerReport = {
    totalAnalyzed: 0,
    actionsProposed: actions.length,
    actionsApplied: 0,
    actionsSkipped: 0,
    uidFixed: 0,
    entriesAdded: 0,
    entriesModified: 0,
    entriesDeleted: 0,
    entriesMerged: 0,
    duration: 0,
  };

  const start = performance.now();

  // Sort by priority: fix_uid → fix_config → fix_keys → fix_content_error → rewrite_content → merge → delete → add
  const priorityOrder: RefinerActionType[] = [
    'fix_uid', 'fix_config', 'fix_keys', 'fix_content_error',
    'rewrite_content', 'expand_content', 'merge_entries', 'delete_entry', 'add_entry',
  ];

  const sorted = [...actions]
    .filter(a => !a.skipped)
    .sort((a, b) => {
      const pa = priorityOrder.indexOf(a.type);
      const pb = priorityOrder.indexOf(b.type);
      return pa - pb;
    });

  // Track deleted IDs to avoid applying actions on deleted entries
  const deletedIds = new Set<number>();

  for (const action of sorted) {
    if (action.skipped) continue;

    // Skip actions targeting deleted entries
    if (action.targetEntryId != null && deletedIds.has(action.targetEntryId)) {
      action.skipped = true;
      report.actionsSkipped++;
      continue;
    }

    try {
      switch (action.type) {
        case 'fix_uid': {
          if (action.targetEntryId != null && action.newUid != null) {
            const entries = ctx.getEntries();
            // Find ALL entries with this ID (there might be duplicates)
            const dupes = entries.filter(e => e.id === action.targetEntryId);
            if (dupes.length > 1) {
              // Fix only the second+ occurrence
              ctx.updateEntry(action.targetEntryId, {
                id: action.newUid,
                extensions: { ...dupes[1].extensions, display_index: action.newUid },
              } as Partial<LorebookEntry>);
              action.applied = true;
              report.uidFixed++;
              report.actionsApplied++;
              ctx.log(`🆔 Sửa UID: "${action.targetComment}" ${action.targetEntryId} → ${action.newUid}`);
            }
          }
          break;
        }

        case 'fix_config': {
          if (action.targetEntryId != null && action.configPatch) {
            const entries = ctx.getEntries();
            const entry = entries.find(e => e.id === action.targetEntryId);
            if (entry) {
              const patch: Partial<LorebookEntry> = {};
              const extPatch: Record<string, unknown> = {};

              if (action.configPatch.constant !== undefined) patch.constant = action.configPatch.constant;
              if (action.configPatch.selective !== undefined) patch.selective = action.configPatch.selective;
              if (action.configPatch.position !== undefined) extPatch.position = action.configPatch.position;
              if (action.configPatch.depth !== undefined) extPatch.depth = action.configPatch.depth;
              if (action.configPatch.role !== undefined) extPatch.role = action.configPatch.role;
              if (action.configPatch.insertion_order !== undefined) patch.insertion_order = action.configPatch.insertion_order;
              if (action.configPatch.scan_depth !== undefined) extPatch.scan_depth = action.configPatch.scan_depth;
              if (action.configPatch.exclude_recursion !== undefined) extPatch.exclude_recursion = action.configPatch.exclude_recursion;
              if (action.configPatch.prevent_recursion !== undefined) extPatch.prevent_recursion = action.configPatch.prevent_recursion;

              if (Object.keys(extPatch).length > 0) {
                patch.extensions = { ...entry.extensions, ...extPatch } as LorebookEntry['extensions'];
              }

              ctx.updateEntry(entry.id, patch);
              action.applied = true;
              report.entriesModified++;
              report.actionsApplied++;
              ctx.log(`⚙️ Sửa config: "${action.targetComment}"`);
            }
          }
          break;
        }

        case 'fix_keys': {
          if (action.targetEntryId != null) {
            const patch: Partial<LorebookEntry> = {};
            if (action.newKeys) patch.keys = action.newKeys;
            if (action.newSecondaryKeys) patch.secondary_keys = action.newSecondaryKeys;
            ctx.updateEntry(action.targetEntryId, patch);
            action.applied = true;
            report.entriesModified++;
            report.actionsApplied++;
            ctx.log(`🔑 Sửa keywords: "${action.targetComment}"`);
          }
          break;
        }

        case 'rewrite_content':
        case 'fix_content_error': {
          if (action.targetEntryId != null && action.newContent) {
            const patch: Partial<LorebookEntry> = { content: action.newContent };
            if (action.newKeys) patch.keys = action.newKeys;
            if (action.newComment) patch.comment = action.newComment;
            ctx.updateEntry(action.targetEntryId, patch);
            action.applied = true;
            report.entriesModified++;
            report.actionsApplied++;
            ctx.log(`✏️ Viết lại: "${action.targetComment}"`);
          }
          break;
        }

        case 'expand_content': {
          if (action.targetEntryId != null && action.newContent) {
            const entries = ctx.getEntries();
            const entry = entries.find(e => e.id === action.targetEntryId);
            if (entry) {
              let finalContent: string;
              if (action.replaceOriginal) {
                // Replace mode: AI đã sửa lỗi/macro + bổ sung → dùng toàn bộ newContent
                finalContent = action.newContent.trim();
              } else {
                // Append mode: Nối phần bổ sung vào cuối content cũ
                finalContent = entry.content.trimEnd() + '\n\n' + action.newContent.trim();
              }
              const patch: Partial<LorebookEntry> = { content: finalContent };
              if (action.newKeys) {
                // Merge new keys with existing, dedup
                const allKeys = [...new Set([...entry.keys, ...action.newKeys])];
                patch.keys = allKeys;
              }
              if (action.newComment) patch.comment = action.newComment;
              ctx.updateEntry(action.targetEntryId, patch);
              action.applied = true;
              report.entriesModified++;
              report.actionsApplied++;
              const mode = action.replaceOriginal ? 'sửa+bổ sung' : 'bổ sung';
              ctx.log(`📝 ${mode}: "${action.targetComment}" (+${Math.ceil(action.newContent.length / 4)} tokens)`);
            }
          }
          break;
        }

        case 'merge_entries': {
          if (action.targetEntryId != null && action.mergeTargetId != null && action.mergedContent) {
            // Update target with merged content
            const patch: Partial<LorebookEntry> = {
              content: action.mergedContent,
            };
            if (action.mergedKeys) patch.keys = action.mergedKeys;
            if (action.newComment) patch.comment = action.newComment;
            ctx.updateEntry(action.mergeTargetId, patch);

            // Delete source
            ctx.deleteEntry(action.targetEntryId);
            deletedIds.add(action.targetEntryId);

            action.applied = true;
            report.entriesMerged++;
            report.actionsApplied++;
            ctx.log(`🔗 Gộp: "${action.targetComment}" → "${action.mergeTargetComment}"`);
          }
          break;
        }

        case 'delete_entry': {
          if (action.targetEntryId != null) {
            ctx.deleteEntry(action.targetEntryId);
            deletedIds.add(action.targetEntryId);
            action.applied = true;
            report.entriesDeleted++;
            report.actionsApplied++;
            ctx.log(`🗑️ Xóa: "${action.targetComment}"`);
          }
          break;
        }

        case 'add_entry': {
          if (action.newContent && action.newComment && action.newKeys) {
            const id = ctx.getNextEntryId();
            const entry = materializeEntry(
              {
                comment: action.newComment,
                keys: action.newKeys,
                secondary_keys: action.newSecondaryKeys,
                content: action.newContent,
                constant: action.configPatch?.constant,
                selective: action.configPatch?.selective,
                position: action.configPatch?.position,
                depth: action.configPatch?.depth,
                role: action.configPatch?.role,
                insertion_order: action.configPatch?.insertion_order,
                scan_depth: action.configPatch?.scan_depth,
              },
              {},
              id,
            );
            ctx.addEntry(entry);
            action.applied = true;
            report.entriesAdded++;
            report.actionsApplied++;
            ctx.log(`➕ Thêm: "${action.newComment}" (${action.newKeys.join(', ')})`);
          }
          break;
        }
      }
    } catch (err) {
      ctx.log(`❌ Lỗi khi áp dụng ${action.type} cho "${action.targetComment}": ${err instanceof Error ? err.message : String(err)}`);
      action.skipped = true;
      report.actionsSkipped++;
    }
  }

  report.actionsSkipped += actions.filter(a => a.skipped && !a.applied).length;
  report.duration = Math.round(performance.now() - start);

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

export async function runRefinerPipeline(
  config: RefinerConfig,
  ctx: RefinerContext,
): Promise<{ actions: RefinerAction[]; localActions: RefinerAction[] }> {
  const entries = ctx.card.data.character_book?.entries ?? [];
  const startTime = performance.now();

  // Count and log system entries that will be skipped
  const systemEntries = entries.filter(e => isSystemEntry(e));
  const loreEntries = entries.filter(e => !isSystemEntry(e));

  ctx.log(`🚀 Bắt đầu AI Lorebook Refiner — ${entries.length} entries (${loreEntries.length} lore + ${systemEntries.length} system/EJS bỏ qua)`);
  ctx.log(`📋 Chế độ: ${config.operationMode} | Max tokens/entry: ${config.maxTokensPerEntry} | Batch: ${config.entriesPerBatch} × ${config.concurrentBatches} song song`);
  if (systemEntries.length > 0) {
    ctx.log(`⚠️ Bỏ qua ${systemEntries.length} entries hệ thống: ${systemEntries.map(e => `"${e.comment}"`).join(', ')}`);
  }

  // ── Phase 1: Pre-Analysis ──
  ctx.onProgress({
    phase: 'pre_analysis',
    currentBatch: 0,
    totalBatches: 0,
    actionsFound: 0,
    actionsApplied: 0,
    message: 'Đang phân tích cục bộ...',
  });

  const localActions = await runPreAnalysis(entries, config, ctx.log);
  ctx.log(`📊 Phase 1 hoàn thành: ${localActions.length} vấn đề cục bộ`);

  if (ctx.stopped) {
    ctx.onProgress({ phase: 'stopped', currentBatch: 0, totalBatches: 0, actionsFound: localActions.length, actionsApplied: 0, message: 'Đã dừng' });
    return { actions: [], localActions };
  }

  // ── Phase 2: AI Analysis ──
  ctx.onProgress({
    phase: 'ai_analysis',
    currentBatch: 0,
    totalBatches: Math.ceil((config.maxEntriesToProcess > 0 ? Math.min(entries.length, config.maxEntriesToProcess) : entries.length) / config.entriesPerBatch),
    actionsFound: localActions.length,
    actionsApplied: 0,
    message: 'Đang gọi AI phân tích...',
  });

  let aiActions = await runAIAnalysis(entries, config, ctx);

  if (ctx.stopped) {
    ctx.onProgress({ phase: 'stopped', currentBatch: 0, totalBatches: 0, actionsFound: localActions.length + aiActions.length, actionsApplied: 0, message: 'Đã dừng' });
    return { actions: aiActions, localActions };
  }

  // ── Phase 3: Dedup new entries ──
  const beforeDedup = aiActions.length;
  aiActions = deduplicateNewEntries(aiActions, entries, ctx.log);
  if (beforeDedup !== aiActions.length) {
    ctx.log(`🔄 Đã lọc ${beforeDedup - aiActions.length} entries trùng lặp`);
  }

  // ── Phase 3b: Auto-skip actions targeting system entries (safety net) ──
  const systemEntryIds = new Set(systemEntries.map(e => e.id));
  let systemSkipped = 0;
  for (const action of aiActions) {
    if (action.targetEntryId != null && systemEntryIds.has(action.targetEntryId)) {
      action.skipped = true;
      systemSkipped++;
    }
  }
  if (systemSkipped > 0) {
    ctx.log(`🛡️ Đã tự động bỏ qua ${systemSkipped} actions nhắm vào entries hệ thống`);
  }

  const allActions = [...localActions, ...aiActions];

  ctx.log(`\n📊 Tổng cộng: ${allActions.length} actions (${localActions.length} cục bộ + ${aiActions.length} AI)`);
  ctx.log(`⏱️ Phân tích hoàn thành trong ${Math.round((performance.now() - startTime) / 1000)}s`);

  // Notify ready for preview
  ctx.onActionsReady(allActions);
  ctx.onProgress({
    phase: 'preview',
    currentBatch: 0,
    totalBatches: 0,
    actionsFound: allActions.length,
    actionsApplied: 0,
    message: `${allActions.length} hành động đang chờ xem xét`,
  });

  return { actions: aiActions, localActions };
}
