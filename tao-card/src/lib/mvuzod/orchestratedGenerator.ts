/**
 * src/lib/mvuzod/orchestratedGenerator.ts — Orchestrated Multi-Call Generator
 * ──────────────────────────────────────────────────────────────────────────────
 * 3-phase approach: Plan → Execute (parallel) → Assemble
 *
 * Ensures consistency across AI calls by:
 * 1. Phase 1: AI creates a Blueprint (shared CSS + section plan)
 * 2. Phase 2: Each section call receives the Blueprint as contract
 * 3. Phase 3: TypeScript assembles all sections into one HTML document
 */

import type { MVUZODSchema } from '../../types/mvuzod.types';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from './regexAnchors';
import type { RegexScript } from '../../types/regex.types';
import type { ProxyProfile, GenerationParams, ChatMessage } from '../../types';
import { callAI } from '../ai/client';
import {
  type BlueprintPlan,
  type BlueprintSection,
  type SectionResult,
  ORCHESTRATED_BLUEPRINT_SYSTEM_PROMPT,
  ORCHESTRATED_SECTION_SYSTEM_PROMPT,
  buildBlueprintUserPrompt,
  buildSectionUserPrompt,
} from '../../prompts/gameRegexPrompt';
import { assembleHtmlDocument } from './gameHtmlTemplates';

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type OrchestratedComponent = 'status_bar' | 'opening_form' | 'game_screen' | 'full_set';

export interface OrchestratedOptions {
  schema: MVUZODSchema;
  component: OrchestratedComponent;
  profile: ProxyProfile;
  params: GenerationParams;
  gameName?: string;
  themeHint?: string;
  /** Callback for progress updates */
  onProgress?: (status: OrchestratedProgress) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface OrchestratedProgress {
  phase: 'planning' | 'generating' | 'assembling' | 'done' | 'error';
  message: string;
  /** Sections completed / total */
  sectionsCompleted?: number;
  sectionsTotal?: number;
  /** Per-section status */
  sectionStatuses?: SectionStatus[];
  /** Blueprint (available after Phase 1) */
  blueprint?: BlueprintPlan;
}

export interface SectionStatus {
  id: string;
  name: string;
  status: 'pending' | 'generating' | 'done' | 'failed' | 'fallback';
  size?: number;
  duration?: number;
  error?: string;
}

export interface OrchestratedResult {
  scripts: Omit<RegexScript, 'id'>[];
  totalSize: number;
  fieldsRendered: number;
  previewHtml: string;
  blueprint: BlueprintPlan;
  sectionStatuses: SectionStatus[];
  /** Total AI calls made */
  totalCalls: number;
  /** Total tokens consumed */
  totalTokens: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate regex scripts using orchestrated multi-call approach.
 * 3 phases: Plan → Execute parallel → Assemble
 */
export async function generateOrchestrated(
  options: OrchestratedOptions,
): Promise<OrchestratedResult> {
  const { schema, component, profile, params, gameName, themeHint, onProgress, signal } = options;
  let totalCalls = 0;
  let totalTokens = 0;

  // ═══ PHASE 1: PLANNING ═══
  onProgress?.({
    phase: 'planning',
    message: '📋 Phase 1: AI đang lập kế hoạch (Blueprint)...',
  });

  const blueprint = await generateBlueprint(
    schema,
    component,
    profile,
    params,
    gameName,
    themeHint,
    signal,
  );
  totalCalls++;
  // Rough token estimate for blueprint
  totalTokens += Math.ceil(JSON.stringify(blueprint).length / 4);

  const sectionStatuses: SectionStatus[] = blueprint.sections.map(s => ({
    id: s.id,
    name: s.name,
    status: 'pending' as const,
  }));

  onProgress?.({
    phase: 'planning',
    message: `✅ Blueprint hoàn thành: ${blueprint.sections.length} sections, ~${blueprint.meta.estimatedTotalSize}`,
    blueprint,
    sectionStatuses,
    sectionsTotal: blueprint.sections.length,
    sectionsCompleted: 0,
  });

  // ═══ PHASE 2: PARALLEL SECTION GENERATION ═══
  onProgress?.({
    phase: 'generating',
    message: `⚡ Phase 2: Sinh ${blueprint.sections.length} sections song song...`,
    sectionStatuses,
    sectionsTotal: blueprint.sections.length,
    sectionsCompleted: 0,
  });

  const sectionResults = new Map<string, SectionResult>();
  let completedCount = 0;

  // Generate all sections in parallel with rate limiting
  const sectionPromises = blueprint.sections.map(async (section, idx) => {
    // Update status to generating
    sectionStatuses[idx].status = 'generating';
    const startTime = Date.now();

    try {
      const result = await generateSection(
        blueprint,
        section,
        schema,
        profile,
        params,
        signal,
      );

      totalCalls++;
      sectionStatuses[idx].status = 'done';
      sectionStatuses[idx].size = result.html.length + result.js.length;
      sectionStatuses[idx].duration = Date.now() - startTime;

      sectionResults.set(section.id, result);
      completedCount++;

      // Estimate tokens used
      totalTokens += Math.ceil((result.html.length + result.js.length) / 4);

      onProgress?.({
        phase: 'generating',
        message: `✅ "${section.name}" hoàn thành (${formatSize(sectionStatuses[idx].size!)} — ${((sectionStatuses[idx].duration!) / 1000).toFixed(1)}s)`,
        sectionStatuses: [...sectionStatuses],
        sectionsTotal: blueprint.sections.length,
        sectionsCompleted: completedCount,
      });
    } catch (err) {
      sectionStatuses[idx].status = 'failed';
      sectionStatuses[idx].error = err instanceof Error ? err.message : String(err);
      sectionStatuses[idx].duration = Date.now() - startTime;

      console.warn(`[Orchestrated] Section "${section.name}" failed:`, err);

      // Fallback: build programmatic placeholder
      try {
        const fallbackResult = buildFallbackSection(section);
        sectionResults.set(section.id, fallbackResult);
        sectionStatuses[idx].status = 'fallback';
        sectionStatuses[idx].size = fallbackResult.html.length;
        completedCount++;

        onProgress?.({
          phase: 'generating',
          message: `⚠️ "${section.name}" fallback (programmatic)`,
          sectionStatuses: [...sectionStatuses],
          sectionsTotal: blueprint.sections.length,
          sectionsCompleted: completedCount,
        });
      } catch {
        console.error(`[Orchestrated] Fallback also failed for "${section.name}"`);
      }
    }
  });

  await Promise.allSettled(sectionPromises);

  // ═══ PHASE 3: ASSEMBLY ═══
  onProgress?.({
    phase: 'assembling',
    message: `🔧 Phase 3: Lắp ráp ${sectionResults.size}/${blueprint.sections.length} sections...`,
    sectionStatuses,
    sectionsTotal: blueprint.sections.length,
    sectionsCompleted: completedCount,
  });

  const { fullHtml, fieldsRendered } = assembleOrchestrated(blueprint, sectionResults);

  // Build regex scripts
  const scripts = buildRegexScripts(fullHtml, component);

  const result: OrchestratedResult = {
    scripts,
    totalSize: fullHtml.length,
    fieldsRendered,
    previewHtml: fullHtml,
    blueprint,
    sectionStatuses,
    totalCalls,
    totalTokens,
  };

  onProgress?.({
    phase: 'done',
    message: `✅ Hoàn thành! ${scripts.length} scripts, ${formatSize(fullHtml.length)}, ${totalCalls} lượt AI, ~${totalTokens} tokens`,
    sectionStatuses,
    sectionsTotal: blueprint.sections.length,
    sectionsCompleted: completedCount,
    blueprint,
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: BLUEPRINT PLANNING
// ═══════════════════════════════════════════════════════════════════════════

async function generateBlueprint(
  schema: MVUZODSchema,
  component: OrchestratedComponent,
  profile: ProxyProfile,
  params: GenerationParams,
  gameName?: string,
  themeHint?: string,
  signal?: AbortSignal,
): Promise<BlueprintPlan> {
  const userPrompt = buildBlueprintUserPrompt(
    schema,
    component,
    gameName,
    themeHint,
  );

  const response = await callAI({
    profile,
    params: {
      ...params,
      max_tokens: 30000,
      temperature: 0.3,
      useJsonResponseFormat: true,
    },
    messages: [
      { role: 'system', content: ORCHESTRATED_BLUEPRINT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    signal,
  });

  const blueprint = parseBlueprint(response.text);

  // Validate blueprint
  if (!blueprint.sections || blueprint.sections.length === 0) {
    throw new Error('Blueprint không có sections nào');
  }
  if (!blueprint.sharedCSS || blueprint.sharedCSS.length < 100) {
    throw new Error('Blueprint thiếu sharedCSS');
  }
  if (!blueprint.assemblyOrder || blueprint.assemblyOrder.length === 0) {
    // Auto-fill from sections
    blueprint.assemblyOrder = blueprint.sections.map(s => s.id);
  }

  return blueprint;
}

function parseBlueprint(text: string): BlueprintPlan {
  const trimmed = text.trim();

  // Try direct parse
  try {
    return JSON.parse(trimmed) as BlueprintPlan;
  } catch {
    // ignore
  }

  // Try extract JSON from fenced block
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as BlueprintPlan;
    } catch {
      // ignore
    }
  }

  // Try extract first JSON object
  const objMatch = trimmed.match(/\{[\s\S]+\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as BlueprintPlan;
    } catch {
      // Try fixing common issues
      const fixed = objMatch[0]
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/'/g, '"');
      try {
        return JSON.parse(fixed) as BlueprintPlan;
      } catch {
        // ignore
      }
    }
  }

  throw new Error(`Không thể parse Blueprint JSON từ AI response (${trimmed.length} chars)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: SECTION GENERATION
// ═══════════════════════════════════════════════════════════════════════════

async function generateSection(
  blueprint: BlueprintPlan,
  section: BlueprintSection,
  schema: MVUZODSchema,
  profile: ProxyProfile,
  params: GenerationParams,
  signal?: AbortSignal,
): Promise<SectionResult> {
  const userPrompt = buildSectionUserPrompt(blueprint, section, schema);

  // Multi-call continuation for truncated sections
  const chunks: string[] = [];
  let isTruncated = true;
  let callCount = 0;
  const maxCalls = 4;

  let currentMessages: ChatMessage[] = [
    { role: 'system', content: ORCHESTRATED_SECTION_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  while (isTruncated && callCount < maxCalls) {
    callCount++;

    const response = await callAI({
      profile,
      params: {
        ...params,
        max_tokens: 30000,
        temperature: 0.2,
        useJsonResponseFormat: true,
      },
      messages: currentMessages,
      signal,
    });

    chunks.push(response.text);
    isTruncated = ['MAX_TOKENS', 'max_tokens', 'length'].includes(response.finishReason || '');

    if (isTruncated && response.text.trim()) {
      const lastChars = response.text.trim().slice(-80);
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.text },
        {
          role: 'user',
          content: `JSON bị cắt. Section "${section.name}". Tiếp tục ĐÚNG vị trí bị cắt.\nPhần cuối: ...${lastChars}\nTIẾP TỤC NGAY — KHÔNG viết lại.`,
        },
      ];
    } else {
      isTruncated = false;
    }
  }

  const fullText = chunks.length > 1 ? repairConcatenatedText(chunks) : chunks[0];
  return parseSectionResult(fullText, section.id);
}

function parseSectionResult(text: string, expectedId: string): SectionResult {
  const trimmed = text.trim();

  // Try multiple parsing strategies
  const strategies: Array<() => unknown> = [
    () => JSON.parse(trimmed),
    () => {
      const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
      if (!fence) throw new Error('No fence');
      return JSON.parse(fence[1].trim());
    },
    () => {
      const obj = trimmed.match(/\{[\s\S]+\}/);
      if (!obj) throw new Error('No obj');
      return JSON.parse(obj[0]);
    },
    () => {
      const obj = trimmed.match(/\{[\s\S]+\}/);
      if (!obj) throw new Error('No obj');
      return JSON.parse(obj[0].replace(/,\s*([}\]])/g, '$1'));
    },
  ];

  for (const strategy of strategies) {
    try {
      const parsed = strategy() as Record<string, unknown>;
      return {
        sectionId: String(parsed.sectionId ?? expectedId),
        html: String(parsed.html ?? ''),
        js: String(parsed.js ?? ''),
      };
    } catch {
      // next
    }
  }

  // Last resort: treat entire text as HTML
  console.warn(`[Orchestrated] Could not parse section "${expectedId}" as JSON, using as raw HTML`);
  return {
    sectionId: expectedId,
    html: `<!-- Failed to parse section ${expectedId} -->\n<div id="${expectedId}" class="stcs-panel"><div class="stcs-panel-content">${escapeHtml(trimmed.slice(0, 500))}...</div></div>`,
    js: '',
  };
}

function repairConcatenatedText(chunks: string[]): string {
  // Simple concatenation — for JSON responses split across calls
  let combined = chunks.join('');

  // Try to find a complete JSON object
  const firstBrace = combined.indexOf('{');
  const lastBrace = combined.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    combined = combined.slice(firstBrace, lastBrace + 1);
  }

  return combined;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════════

function assembleOrchestrated(
  blueprint: BlueprintPlan,
  sectionResults: Map<string, SectionResult>,
): { fullHtml: string; fieldsRendered: number } {
  // Build HTML body in assembly order
  let bodyHtml = '';
  let fieldsRendered = 0;

  const orderedIds = blueprint.assemblyOrder.length > 0
    ? blueprint.assemblyOrder
    : blueprint.sections.map(s => s.id);

  for (const sectionId of orderedIds) {
    const result = sectionResults.get(sectionId);
    if (!result) {
      bodyHtml += `\n<!-- Missing section: ${sectionId} -->\n`;
      continue;
    }

    bodyHtml += `\n<!-- ═══ ${sectionId} ═══ -->\n${result.html}\n`;

    // Count fields from blueprint
    const sectionPlan = blueprint.sections.find(s => s.id === sectionId);
    if (sectionPlan) {
      fieldsRendered += sectionPlan.fieldsToRender.length;
    }
  }

  // Collect section-specific JS
  let sectionJS = '';
  for (const sectionId of orderedIds) {
    const result = sectionResults.get(sectionId);
    if (result?.js) {
      sectionJS += `\n// ═══ ${sectionId} ═══\n${result.js}\n`;
    }
  }

  // Build populate + init wrapper
  const populateCalls = orderedIds
    .filter(id => sectionResults.get(id)?.js)
    .map(id => {
      const fnName = `populate_${id.replace(/-/g, '_')}`;
      return `    if (typeof ${fnName} === 'function') ${fnName}(d);`;
    })
    .join('\n');

  const initJS = `
${blueprint.sharedJS || ''}

${sectionJS}

    function populateAllSections() {
        var all = getAllVariables();
        var d = _.get(all, ['stat_data'], {});
${populateCalls}
    }

    async function init() {
        await waitGlobalInitialized('Mvu');
        populateAllSections();
        eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, populateAllSections);
    }

    $(errorCatched(init));
`;

  // Detect font import from CSS
  const fontImportMatch = blueprint.sharedCSS.match(/@import\s+url\(['"]([^'"]+)['"]\)/);
  const fontImport = fontImportMatch?.[1];

  // Remove @import from CSS (it'll be in <link> tag)
  const cleanCSS = fontImport
    ? blueprint.sharedCSS.replace(/@import\s+url\([^)]+\)\s*;?\s*/g, '')
    : blueprint.sharedCSS;

  const fullHtml = assembleHtmlDocument(cleanCSS, bodyHtml, initJS, fontImport);

  return { fullHtml, fieldsRendered };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function buildFallbackSection(section: BlueprintSection): SectionResult {
  // Simple fallback HTML when AI fails
  const fieldsHtml = section.fieldsToRender
    .map(f => `<div class="stcs-data-item"><span class="stcs-data-label">${f}</span><span class="stcs-data-value" id="${section.id}-${sanitize(f)}">—</span></div>`)
    .join('\n');

  return {
    sectionId: section.id,
    html: `<div class="stcs-panel" id="${section.id}">` +
      `<div class="stcs-panel-header"><span>${section.name}</span></div>` +
      `<div class="stcs-panel-content"><div class="stcs-grid-2">${fieldsHtml}</div></div>` +
      `</div>`,
    js: '',
  };
}

function buildRegexScripts(
  fullHtml: string,
  component: OrchestratedComponent,
): Omit<RegexScript, 'id'>[] {
  const scripts: Omit<RegexScript, 'id'>[] = [];

  if (component === 'opening_form') {
    // MỖI giao diện cần ĐỦ MỘT CẶP: 1 script ẩn mỏ neo khỏi prompt + 1 script render ra màn hình.
    // Trước đây opening_form CHỈ có vế render ⇒ mỏ neo lọt vào prompt gửi AI mỗi lượt.
    scripts.push(
      {
        scriptName: '[AI] Ẩn Opening Form',
        findRegex: OPENING_FORM_ANCHOR,
        replaceString: '',
        trimStrings: [],
        placement: [1],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      },
      {
        // Mỏ neo RIÊNG, không dùng chung với Status Bar (trước đây trùng nên 2 script đè nhau).
        // Thẻ này do card tự đặt trong First Message / Alternate Greetings.
        scriptName: '[Render] Opening Form (Orchestrated)',
        findRegex: OPENING_FORM_ANCHOR,
        replaceString: fullHtml,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 1,
        minDepth: 0,
        maxDepth: 0,
      },
    );
  } else {
    // Status bar, game screen, full set
    scripts.push(
      {
        scriptName: '[AI] Ẩn StatusPlaceHolder',
        findRegex: STATUS_BAR_ANCHOR,
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      },
      {
        scriptName: `[Render] ${component === 'game_screen' ? 'Game Screen' : 'Status Bar'} (Orchestrated)`,
        findRegex: STATUS_BAR_ANCHOR,
        replaceString: fullHtml,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 1,
        minDepth: null,
        maxDepth: null,
      },
    );
  }

  return scripts;
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
