/**
 * src/lib/tokenBudget/tctrlGenerator.ts — Generate @@TCTRL EJS entries
 * 
 * Phase 3: Gọi AI sinh EJS controller code cho mỗi nhóm.
 * Fallback: template có sẵn nếu AI fail.
 */

import type { LorebookEntry } from '../../types/lorebook.types';
import type { ChatMessage } from '../../types';
import { callAI } from '../ai/client';
import { DEFAULT_ENTRY_EXT } from '../../types/lorebook.types';
import type { TctrlAnalysis, TctrlGroup } from './groupBuilder';
import type { AnalyzedEntry, TctrlProgress, TctrlRunContext } from './tokenAnalyzer';
import { STPT_API_PROMPT_BLOCK, validateWorldbookEjs, activationLine } from '../ejs/stptApi';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface TctrlEntry {
  comment: string;
  content: string;
  keys: string[];
  constant: boolean;
  position: number;
  depth: number;
  order: number;
}

export interface TctrlGenerationResult {
  entries: TctrlEntry[];
  configPatches: ConfigPatch[];
  summary: TctrlSummary;
}

export interface ConfigPatch {
  entryId: number;
  patches: Partial<{
    extensions: Partial<LorebookEntry['extensions']>;
    enabled: boolean;
    constant: boolean;
    insertion_order: number;
  }>;
  reason: string;
}

export interface TctrlSummary {
  tctrlEntriesAdded: number;
  entriesDisabled: number;
  entriesConfigChanged: number;
  tokensBefore: number;
  tokensAfterEstimate: number;
  apiCalls: number;
  totalTime: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI PROMPT
// ═══════════════════════════════════════════════════════════════════════════

// (bugNeedFix/125) Prompt cũ dạy `setEntryEnabled(comment, bool)` — API KHÔNG TỒN TẠI trong
// ST-Prompt-template. Mọi controller sinh ra chết ngay khi chơi: "setEntryEnabled is not
// defined". Nay dạy đúng mô hình thật của extension: entry điều khiển TẮT SẴN, controller BẬT
// có điều kiện bằng `await activewi(...)`; muốn tắt tĩnh thì tắt bằng cấu hình, không viết code.
const TCTRL_SYSTEM_PROMPT = `Bạn là chuyên gia viết EJS preprocessing cho SillyTavern (extension ST-Prompt-template).
Nhiệm vụ: Sinh code EJS @@preprocessing để kiểm soát worldbook entries.

${STPT_API_PROMPT_BLOCK}

Hàm bổ trợ có thật khác: YAML.stringify(obj), _.random(min, max), Mvu.getMvuData({type:'message', message_id:'latest'}).

2 STRATEGIES:
🅰️ KÍCH HOẠT CÓ ĐIỀU KIỆN (card nhỏ, <50 entries/group):
  Entries điều khiển ĐÃ TẮT SẴN (tool tắt trong cấu hình). Controller bật khi điều kiện đúng:
  <%_
  if (_bien === 'giá trị') { await activewi('Comment entry'); }
  _%>

🅱️ GETWI LOADING (card lớn, >50 entries/group):
  Entries ĐÃ TẮT SẴN. Controller load thẳng NỘI DUNG khi cần:
  <%- await getwi(null, 'Comment entry') %>

QUY TẮC:
1. Mở đầu bằng @@preprocessing
2. Dòng đầu code: <%# @@TCTRL — AUTO TOKEN CONTROLLER — DO NOT READ %>
3. Dùng <%_ _%> (whitespace slurp); mở <%_ và đóng _%> mỗi cái một dòng riêng
4. Dùng var (KHÔNG let/const — do EJS scoping)
5. activewi()/getwi() PHẢI có await — chúng là async
6. Chú thích trong scriptlet CHỈ dùng /* ... */ — TUYỆT ĐỐI KHÔNG dùng // (code bị dồn một dòng là // nuốt hết phần sau, vỡ compile)
7. Tên entry trong activewi/getwi dùng CHÍNH XÁC comment text của entry
8. KHÔNG bao giờ viết setEntryEnabled/activateEntry/enableWorldInfo — không tồn tại

CHỈ trả về code EJS. KHÔNG markdown, KHÔNG giải thích.`;

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE FALLBACKS (khi AI fail)
// ═══════════════════════════════════════════════════════════════════════════

function generateFallbackGateKeeper(analysis: TctrlAnalysis): string {
  const lines = [
    '@@preprocessing',
    '<%# @@TCTRL::GateKeeper_Main — AUTO TOKEN CONTROLLER — DO NOT READ %>',
    '<%_',
    // (bugNeedFix/125) Chú thích trong scriptlet CHỈ dùng dạng khối /* */ — code AI/máy sinh hay
    // bị dồn về một dòng, chú thích // khi đó nuốt luôn phần code phía sau và EJS vỡ compile
    // ("Unexpected token '<'").
    `/* ═══ AUTO TOKEN CONTROLLER (Generated) ═══`,
    ` * Total entries: ${analysis.totalEntries}`,
    ` * Total tokens: ~${analysis.totalTokens.toLocaleString()}`,
    ` * Budget: ${analysis.effectiveBudget.toLocaleString()} tokens (${Math.round(analysis.effectiveBudget / analysis.totalTokens * 100)}% of total)`,
    ` * Groups: ${analysis.groups.length} */`,
    '',
  ];

  // Variable declarations
  if (analysis.variables.length > 0) {
    const mvuzodVars = analysis.variables.filter(v => v.source === 'mvuzod');
    const autoVars = analysis.variables.filter(v => v.source === 'auto');

    if (mvuzodVars.length > 0) {
      lines.push('/* Biến từ MVUZOD schema */');
      for (const v of mvuzodVars) {
        const safeName = '_' + v.name.replace(/[^a-zA-Z0-9_]/g, '_');
        const defaultVal = v.type === 'number' ? v.defaultValue : `'${v.defaultValue}'`;
        lines.push(`if (typeof ${safeName} === 'undefined') var ${safeName} = getvar('${v.getvarPath}', { defaults: ${defaultVal} });`);
      }
      lines.push('');
    }

    if (autoVars.length > 0) {
      lines.push('/* Biến auto-detect (@@tctrl) */');
      for (const v of autoVars) {
        const safeName = '_' + v.name.replace(/[^a-zA-Z0-9_]/g, '_');
        const defaultVal = v.type === 'number' ? v.defaultValue : v.type === 'boolean' ? v.defaultValue : `'${v.defaultValue}'`;
        lines.push(`if (typeof ${safeName} === 'undefined') var ${safeName} = getvar('${v.getvarPath}', { defaults: ${defaultVal} });`);
      }
      lines.push('');
    }
  }

  // Overview of groups
  for (const group of analysis.groups) {
    lines.push(`/* ${group.name}: ${group.entries.length} entries, ~${group.totalTokens.toLocaleString()} tokens [${group.strategy}] */`);
  }

  lines.push('', '/* Controller is active — individual group controllers handle specifics. */', '_%>');
  return lines.join('\n');
}

function generateFallbackGroupController(
  group: TctrlGroup,
  entriesInGroup: Array<{ id: number; comment: string; priority: string; tokens: number; controlHint?: AnalyzedEntry['controlHint'] }>,
): string {
  const lines = [
    '@@preprocessing',
    `<%# @@TCTRL::Group_${group.id} — ${group.name} Controller — DO NOT READ %>`,
    '<%_',
    `/* GROUP: ${group.name}`,
    ` * Entries: ${group.entries.length} | Tokens: ~${group.totalTokens.toLocaleString()} | Budget: ~${group.budgetAllocation.toLocaleString()}`,
    ` * Strategy: ${group.strategy} */`,
    '',
  ];

  if (group.strategy === 'constant') {
    lines.push('/* Constant group — tất cả entries luôn bật, không cần kiểm soát. */');
    lines.push('_%>');
    return lines.join('\n');
  }

  const variableControlled = entriesInGroup.filter(e => e.controlHint);
  const otherEntries = entriesInGroup.filter(e => !e.controlHint);

  if (group.strategy === 'getwi') {
    /* GETWI: entries đã disabled (configOptimizer), controller load NỘI DUNG khi cần. */
    lines.push('/* GETWI LOADING — entries đã tắt trong cấu hình, load nội dung khi cần */');

    if (variableControlled.length > 0) {
      lines.push(`/* Entries điều khiển bằng biến (${variableControlled.length}) */`);
      lines.push('_%>');
      for (const entry of variableControlled) {
        if (!entry.comment || !entry.controlHint) continue;
        const safeName = '_' + entry.controlHint.variableName.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`<%_ if (${safeName} ${entry.controlHint.condition}) { _%>`);
        lines.push(`<%- await getwi(null, '${entry.comment.replace(/'/g, "\\'")}') %>`);
        lines.push('<%_ } _%>');
      }
    } else {
      lines.push('_%>');
    }

    const highEntries = otherEntries.filter(e => e.priority === 'high' || e.priority === 'critical');
    if (highEntries.length > 0) {
      lines.push(`<%# Load entries quan trọng (${highEntries.length}) %>`);
      for (const entry of highEntries) {
        if (entry.comment) {
          lines.push(`<%- await getwi(null, '${entry.comment.replace(/'/g, "\\'")}') %>`);
        }
      }
    }

    const conditionalEntries = otherEntries.filter(e => e.priority === 'medium' || e.priority === 'low');
    if (conditionalEntries.length > 0) {
      lines.push(`<%# Load ${conditionalEntries.length} entries theo context chat %>`);
      for (const entry of conditionalEntries.slice(0, 50)) {
        if (!entry.comment) continue;
        const keyword = entry.comment.replace(/^[^:]+:\s*/, '').split(/[,\s]+/)[0];
        if (keyword.length >= 2) {
          lines.push(`<%_ if (matchChatMessages(['${keyword.replace(/'/g, "\\'")}'])) { _%>`);
          lines.push(`<%- await getwi(null, '${entry.comment.replace(/'/g, "\\'")}') %>`);
          lines.push('<%_ } _%>');
        }
      }
    }
    return lines.join('\n');
  }

  /* ═══ NORMAL STRATEGY — (bugNeedFix/125) MÔ HÌNH KÍCH HOẠT, không còn setEntryEnabled ═══
   *
   * Bản cũ giả định "entries đang bật, controller TẮT theo điều kiện" và gọi
   * setEntryEnabled(comment, bool). ST-Prompt-template KHÔNG có API tắt entry từ EJS —
   * chạy là "setEntryEnabled is not defined", đúng chuỗi lỗi đỏ user chụp.
   *
   * Mô hình thật (đối chiếu source extension): entry điều khiển phải TẮT SẴN trong cấu hình
   * (configOptimizer lo việc đó), controller BẬT nó cho lượt sinh hiện tại bằng
   * `await activewi('comment')` khi điều kiện đúng. Entry cần tắt VĨNH VIỄN (priority LOW,
   * dead, duplicate) thì tắt thẳng bằng cấu hình — không cần một dòng code nào. */
  if (variableControlled.length > 0) {
    lines.push(`/* Bật có điều kiện ${variableControlled.length} entries (đã tắt sẵn trong cấu hình) */`);
    for (const entry of variableControlled) {
      if (!entry.comment || !entry.controlHint) continue;
      const safeName = '_' + entry.controlHint.variableName.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(activationLine(entry.comment, `${safeName} ${entry.controlHint.condition}`) + ` /* ~${entry.tokens} tokens */`);
    }
  } else {
    lines.push('/* Nhóm này không có entry điều khiển bằng biến — entries LOW đã tắt bằng cấu hình. */');
  }

  lines.push('_%>');
  return lines.join('\n');
}

/* (bugNeedFix/125) generateFallbackPriorityGate ĐÃ BỎ.
 * Nó từng sinh một entry EJS gọi setEntryEnabled(x, false) cho từng entry chết/trùng — API
 * không tồn tại nên entry đó vừa vô dụng vừa nổ lỗi đỏ mỗi lượt chat. Việc tắt tĩnh vốn là
 * việc của CẤU HÌNH: optimizeConfigs() đã patch enabled=false cho dead/duplicate entries rồi,
 * không cần (và không thể) làm bằng code EJS. */

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GENERATION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseEjsResponse(text: string): string {
  // Remove markdown code fences if present
  let code = text.trim();
  const fenceMatch = code.match(/```(?:ejs|javascript|js)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) code = fenceMatch[1].trim();

  // Validate it starts with @@preprocessing
  if (!code.startsWith('@@preprocessing')) {
    // Try to find it
    const idx = code.indexOf('@@preprocessing');
    if (idx >= 0) code = code.slice(idx);
    else throw new Error('Response does not contain @@preprocessing');
  }

  return code;
}

export async function generateTctrlEntries(
  analysis: TctrlAnalysis,
  analyzedEntries: AnalyzedEntry[],
  ctx: TctrlRunContext,
  progressBase: Partial<TctrlProgress>,
): Promise<TctrlGenerationResult> {
  const tctrlEntries: TctrlEntry[] = [];
  const configPatches: ConfigPatch[] = [];
  let apiCalls = 0;
  const startedAt = Date.now();

  // Determine TCTRL entries to generate

  const controllableCount = analysis.groups.filter(g => (g.strategy === 'normal' || g.strategy === 'getwi') && g.entries.length > 0).length;
  // (bugNeedFix/125) Bỏ PriorityGate: tắt tĩnh dead/duplicate là việc của cấu hình
  // (optimizeConfigs đã patch enabled=false), EJS không có API tắt entry.
  const tctrlTotal = 1 + controllableCount; // GateKeeper + per-group
  let tctrlGenerated = 0;

  const updateProgress = () => {
    ctx.onProgress({
      ...progressBase as TctrlProgress,
      phase: 'generate',
      tctrlGenerated,
      tctrlTotal,
      apiCalls: (progressBase.apiCalls ?? 0) + apiCalls,
    });
  };

  ctx.log(`\n🤖 PHASE 3: Sinh ${tctrlTotal} @@TCTRL entries...`);

  // 1. GateKeeper_Main
  ctx.log('📡 Sinh @@TCTRL::GateKeeper_Main...');
  const gateKeeperCode = await tryGenerateWithAI(
    ctx,
    `Sinh EJS @@preprocessing cho CONTROLLER CHÍNH (GateKeeper).
Thông tin card:
- Tổng: ${analysis.totalEntries} entries, ~${analysis.totalTokens.toLocaleString()} tokens
- Budget: ${analysis.effectiveBudget.toLocaleString()} tokens
- Groups: ${analysis.groups.map(g => `${g.name} (${g.entries.length} entries, ~${g.totalTokens.toLocaleString()} tokens, ${g.strategy})`).join('; ')}
${analysis.variables.length > 0 ? `
BIẾN ĐIỀU KHIỂN đã phát hiện:
${analysis.variables.map(v => `- ${v.name} (${v.source}): getvar('${v.getvarPath}') default='${v.defaultValue}' → ${v.affectedEntries.length} entries`).join('\n')}

Sinh var declarations dùng getvar() cho mỗi biến. VD:
if (typeof _location === 'undefined') var _location = getvar('${analysis.variables[0]?.getvarPath ?? 'stat_data.@@tctrl.x'}', { defaults: '' });` : ''}

Comment entry: @@TCTRL::GateKeeper_Main
Mục đích: Overview controller + khai báo biến. KHÔNG disable entries (các group controllers sẽ làm việc đó).`,
    () => generateFallbackGateKeeper(analysis),
  );
  apiCalls++;
  tctrlGenerated++;
  updateProgress();

  tctrlEntries.push({
    comment: '@@TCTRL::GateKeeper_Main',
    content: gateKeeperCode,
    keys: ['@@tctrl'],
    constant: true,
    position: 4,
    depth: 0,
    order: 999,
  });
  ctx.log('✅ @@TCTRL::GateKeeper_Main');

  // 2. Per-group controllers (for normal AND getwi groups)
  const controllableGroups = analysis.groups.filter(g => (g.strategy === 'normal' || g.strategy === 'getwi') && g.entries.length > 0);
  for (const group of controllableGroups) {
    if (ctx.stopped) break;
    while (ctx.paused) await sleep(300);

    const entriesInGroup = group.entries.map(id => {
      const ae = analyzedEntries.find(e => e.entryId === id);
      return {
        id,
        comment: ae?.comment ?? `Entry #${id}`,
        priority: ae?.priority ?? 'medium',
        tokens: ae?.tokenEstimate ?? 0,
        controlHint: ae?.controlHint,
      };
    });

    // Find variables relevant to this group
    const groupVars = analysis.variables.filter(v =>
      v.affectedEntries.some(eid => group.entries.includes(eid))
    );

    ctx.log(`📡 Sinh @@TCTRL::Group_${group.id} [${group.strategy}]...`);

    // Strategy-specific prompt
    const strategyInstructions = group.strategy === 'getwi'
      ? `
STRATEGY: GETWI LOADING (entries ĐÃ DISABLED)
- KHÔNG dùng setEntryEnabled — entries đã bị tắt hết
- Load nội dung bằng: <%- await getwi(null, 'comment entry') %>
- Entries HIGH/CRITICAL → load trực tiếp (luôn hiện)
- Entries MEDIUM/LOW → load CÓ ĐIỀU KIỆN:
  + Nếu có biến → if (biến === giá trị) { getwi }
  + Nếu không có biến → if (matchChatMessages(['keyword'])) { getwi }
- Wrap mỗi getwi trong <%_ if (...) { _%> ... <%_ } _%>
- Comment text trong getwi PHẢI chính xác: await getwi(null, 'CHÍNH XÁC comment')`
      : `
STRATEGY: KÍCH HOẠT CÓ ĐIỀU KIỆN (entries điều khiển ĐÃ TẮT SẴN trong cấu hình)
- Entries có biến → bật khi điều kiện đúng: if (_location === 'X') { await activewi('comment'); }
- Entries priority LOW không có biến → KHÔNG viết gì (đã tắt bằng cấu hình)
- Entries priority MEDIUM/HIGH/CRITICAL không có biến → KHÔNG viết gì (vẫn đang bật, hoạt động như thường)
- TUYỆT ĐỐI không viết setEntryEnabled — API không tồn tại`;

    const groupCode = await tryGenerateWithAI(
      ctx,
      `Sinh EJS @@preprocessing cho GROUP CONTROLLER.
Group: "${group.name}"
- ${group.entries.length} entries, ~${group.totalTokens.toLocaleString()} tokens
- Budget: ~${group.budgetAllocation.toLocaleString()} tokens
${strategyInstructions}

Entries trong nhóm (top 30):
${entriesInGroup.slice(0, 30).map(e => `- [id=${e.id}] "${e.comment}" priority:${e.priority} ~${e.tokens}tokens`).join('\n')}
${entriesInGroup.length > 30 ? `\n... và ${entriesInGroup.length - 30} entries nữa` : ''}

Comment entry: @@TCTRL::Group_${group.id}
${groupVars.length > 0 ? `
BIẾN CÓ SẴN (đã khai báo ở GateKeeper):
${groupVars.map(v => `- _${v.name} ← getvar('${v.getvarPath}')`).join('\n')}
` : ''}`,
      () => generateFallbackGroupController(group, entriesInGroup),
    );
    apiCalls++;
    tctrlGenerated++;
    updateProgress();

    tctrlEntries.push({
      comment: `@@TCTRL::Group_${group.id}`,
      content: groupCode,
      keys: ['@@tctrl'],
      constant: true,
      position: 4,
      depth: 0,
      order: 998 - group.hierarchy,
    });
    ctx.log(`✅ @@TCTRL::Group_${group.id} [${group.strategy}]`);
  }

  // 3. (bugNeedFix/125) PriorityGate đã bỏ — dead/duplicate entries được tắt bằng config patch
  //    trong optimizeConfigs; EJS không có API tắt entry nên entry PriorityGate cũ chỉ nổ lỗi đỏ.

  // 4. Schema init entry (only for auto-detected variables, not MVUZOD)
  const autoVars = analysis.variables.filter(v => v.source === 'auto');
  if (autoVars.length > 0 && !ctx.stopped) {
    ctx.log('📡 Sinh @@TCTRL::Schema (init biến auto-detect)...');
    const schemaInitLines = [
      '@@preprocessing',
      '<%# @@TCTRL::Schema — Auto Variable Init — DO NOT READ %>',
      '<%_',
      '/* @@TCTRL SCHEMA — biến điều khiển entries (auto-detect).',
      ' * AI: cập nhật các biến này mỗi lượt dựa trên context chat. */',
      `if (typeof getvar('stat_data.@@tctrl') === 'undefined') {`,
      `  setvar('stat_data.@@tctrl', {`,
    ];
    for (const v of autoVars) {
      const val = v.type === 'number' ? v.defaultValue
               : v.type === 'boolean' ? v.defaultValue
               : `'${v.defaultValue}'`;
      schemaInitLines.push(`    ${v.name}: ${val},`);
    }
    schemaInitLines.push('  });', '}', '_%>');

    tctrlEntries.push({
      comment: '@@TCTRL::Schema',
      content: schemaInitLines.join('\n'),
      keys: ['@@tctrl'],
      constant: true,
      position: 4,
      depth: 0,
      order: 1000, // Before GateKeeper
    });
    ctx.log(`✅ @@TCTRL::Schema (${autoVars.length} biến auto)`);
  }

  // Build summary
  const summary: TctrlSummary = {
    tctrlEntriesAdded: tctrlEntries.length,
    entriesDisabled: analysis.deadEntries.length + analysis.duplicates.length,
    entriesConfigChanged: configPatches.length,
    tokensBefore: analysis.totalTokens,
    tokensAfterEstimate: Math.max(0, analysis.totalTokens
      - analysis.deadEntries.reduce((s, e) => s + e.tokenEstimate, 0)
      - analysis.duplicates.length * 200 // rough estimate per duplicate
    ),
    apiCalls,
    totalTime: Date.now() - startedAt,
  };

  ctx.log(`\n📊 Phase 3 hoàn thành: ${tctrlEntries.length} @@TCTRL entries, ${apiCalls} API calls`);

  return { entries: tctrlEntries, configPatches, summary };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Try AI with fallback
// ═══════════════════════════════════════════════════════════════════════════

async function tryGenerateWithAI(
  ctx: TctrlRunContext,
  userPrompt: string,
  fallback: () => string,
  maxRetries = 2,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: TCTRL_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      const response = await callAI({
        profile: ctx.profile,
        params: ctx.generationParams,
        messages,
      });

      const code = parseEjsResponse(response.text);
      // (bugNeedFix/125) CHỐT CHẶN: AI trả gì cũng lưu chính là cách các entry gọi
      // setEntryEnabled (API bịa) và chú thích // (vỡ compile khi mất xuống dòng) lọt vào thẻ
      // của user. Không qua kiểm thì coi như AI fail — thử lại, hết lượt thì dùng template
      // tất định vốn luôn hợp lệ.
      const check = validateWorldbookEjs(code);
      if (!check.ok) {
        throw new Error(`EJS không hợp lệ: ${check.problems.join(' | ')}`);
      }
      return code;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        ctx.log(`⚠️ Retry ${attempt + 1}: ${msg}`);
        await sleep(2000);
      } else {
        ctx.log(`⚠️ AI fail — dùng template fallback: ${msg}`);
        return fallback();
      }
    }
  }
  return fallback(); // Should not reach here
}

// ═══════════════════════════════════════════════════════════════════════════
// MATERIALIZE — Convert TctrlEntry to LorebookEntry
// ═══════════════════════════════════════════════════════════════════════════

export function materializeTctrlEntry(tctrl: TctrlEntry, id: number): LorebookEntry {
  return {
    id,
    keys: tctrl.keys,
    secondary_keys: [],
    comment: tctrl.comment,
    content: tctrl.content,
    constant: tctrl.constant,
    selective: false,
    insertion_order: tctrl.order,
    enabled: true,
    position: 'before_char',
    use_regex: false,
    extensions: {
      ...DEFAULT_ENTRY_EXT,
      position: tctrl.position as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
      depth: tctrl.depth,
      exclude_recursion: true,
      prevent_recursion: true,
      scan_depth: null,
      ignore_budget: true,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// (bugNeedFix/125) Lộ template fallback cho test — chúng phải LUÔN sinh EJS hợp lệ,
// vì đây là thứ được ghi vào thẻ khi AI fail hoặc trả code không qua kiểm.
// ═══════════════════════════════════════════════════════════════════════════
export const __testables = {
  generateFallbackGateKeeper,
  generateFallbackGroupController,
};
