/**
 * GameFrontendPreview — AI-Powered Game Regex Script Generator
 * Gọi AI tạo Regex Scripts cho game UI, inject vào card.
 *
 * Flow: Chọn component → (tuỳ chọn nhập style) → AI tạo scripts → review → apply
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Gamepad2, Copy, Check,
  LayoutGrid, FormInput, Monitor, Layers,
  Wand2, Loader2, AlertTriangle, CheckCircle2,
  Plus, Trash2, ChevronDown, ChevronRight,
  Sparkles, XCircle, FileUp, X,
  Eye, Palette, Zap, Settings2,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { RegexScript, ChatMessage } from '../../types';
import { useCardStore } from '../../store/cardStore';
import { toIframeHtml } from '../../lib/ai/schemaPreviewData';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import { GAME_REGEX_SYSTEM_PROMPT, buildGameRegexUserPrompt } from '../../prompts/gameRegexPrompt';
import {
  parseGameRegexResponse,
  validateGameRegexScripts,
  repairConcatenatedJson,
  countScriptsInPartial,
  getExpectedScriptCount,
  type ValidationIssue,
} from '../../lib/mvuzod/gameRegexParser';
import { GameUIConfigPanel } from './GameUIConfigPanel';
import type { GameUIConfig } from '../../types/gameUiConfig.types';
import { DEFAULT_GAME_UI_CONFIG } from '../../lib/mvuzod/gameUiDefaults';
import { buildProgrammaticRegex, isProgrammaticComponent, formatBytes } from '../../lib/mvuzod/programmaticRegexBuilder';
import { generateOrchestrated, type OrchestratedProgress } from '../../lib/mvuzod/orchestratedGenerator';
import { autoFixGameHtml, type FixResult } from '../../lib/mvuzod/gameHtmlFixer';
import { checkHtmlScripts } from '../../lib/scriptSafety';
import { THEME_PRESETS, DEFAULT_THEME_ID } from '../../lib/mvuzod/gameHtmlTemplates';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type GameComponent = 'status_bar' | 'opening_form' | 'game_screen' | 'full_set' | 'free_form';

interface ComponentOption {
  id: GameComponent;
  label: string;
  icon: typeof LayoutGrid;
  desc: string;
}

const COMPONENTS: ComponentOption[] = [
  { id: 'status_bar', label: 'Status Bar', icon: LayoutGrid, desc: 'Regex render thanh trạng thái' },
  { id: 'opening_form', label: 'Opening Form', icon: FormInput, desc: 'Regex render form mở đầu' },
  { id: 'game_screen', label: 'Game Screen', icon: Monitor, desc: 'Regex render màn hình game' },
  { id: 'full_set', label: 'Bộ đầy đủ', icon: Layers, desc: 'Tạo tất cả + MVUZOD boilerplate' },
  { id: 'free_form', label: 'Tự do', icon: Wand2, desc: 'Viết mô tả tự do — AI tạo regex theo ý bạn' },
];

// Placement label map
const PLACEMENT_MAP: Record<number, string> = {
  1: 'User Input',
  2: 'AI Output',
  3: 'Slash',
  4: 'World Info',
  5: 'Reasoning',
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface GameFrontendPreviewProps {
  schema: MVUZODSchema | null;
}

export function GameFrontendPreview({ schema }: GameFrontendPreviewProps) {
  const updateCard = useCardStore(s => s.updateCard);
  const existingScripts = useCardStore(s => s.card.data.extensions.regex_scripts);

  // ─── State ───
  const [selectedComponent, setSelectedComponent] = useState<GameComponent>('status_bar');
  const [customInstructions, setCustomInstructions] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [uiConfig, setUIConfig] = useState<GameUIConfig>(DEFAULT_GAME_UI_CONFIG);
  const [referenceJson, setReferenceJson] = useState<string>('');
  const [referenceFileName, setReferenceFileName] = useState<string>('');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Results state
  const [generatedScripts, setGeneratedScripts] = useState<Omit<RegexScript, 'id'>[]>([]);
  const [explanation, setExplanation] = useState('');
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [applied, setApplied] = useState(false);

  // Preview expand state
  const [expandedScripts, setExpandedScripts] = useState<Set<number>>(new Set());

  // ── V5 New State ──
  const [selectedTheme, setSelectedTheme] = useState(DEFAULT_THEME_ID);
  const [generationMode, setGenerationMode] = useState<'auto' | 'programmatic' | 'orchestrated' | 'ai_single'>('auto');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [orchestratedProgress, setOrchestratedProgress] = useState<OrchestratedProgress | null>(null);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // Cảnh báo: <script> trong game HTML vỡ cú pháp JS (autoFixGameHtml chỉ sửa cấu trúc, không kiểm JS).
  const scriptWarn = useMemo(() => {
    if (!previewHtml) return null;
    // (bug 149) Dùng CHUNG hàm gỡ rào với PreviewTunerModal — bản cũ ở đây chỉ khớp đúng
    // "```html\n" nên rào có khoảng trắng đầu dòng hoặc CRLF là lọt.
    const html = toIframeHtml(previewHtml);
    const r = checkHtmlScripts(html);
    return r.broken > 0 ? r : null;
  }, [previewHtml]);


  // Existing game-related scripts
  const gameScripts = useMemo(() =>
    existingScripts.filter(s =>
      s.scriptName.startsWith('[Game]') ||
      s.scriptName.startsWith('[Render]') ||
      s.scriptName.startsWith('[AI]') ||
      s.scriptName.toLowerCase().includes('statusplaceholder') ||
      s.scriptName.toLowerCase().includes('updatevariable')
    ),
    [existingScripts]
  );

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ─── Generate Handler (V5: 3-mode) ───
  const handleGenerate = useCallback(async () => {
    if (!schema) return;

    setGenerating(true);
    setError(null);
    setGeneratedScripts([]);
    setExplanation('');
    setValidationIssues([]);
    setApplied(false);
    setPreviewHtml(null);
    setOrchestratedProgress(null);
    setFixResult(null);

    setLoadingStatus('Đang xác định chế độ tạo...');

    try {
      // ═══ Determine generation mode ═══
      const effectiveMode = generationMode === 'auto'
        ? (isProgrammaticComponent(selectedComponent) ? 'programmatic'
          : selectedComponent === 'free_form' ? 'ai_single'
          : 'orchestrated')
        : generationMode;

      // ═══ MODE 1: PROGRAMMATIC ═══
      if (effectiveMode === 'programmatic' && isProgrammaticComponent(selectedComponent)) {
        setLoadingStatus('⚡ Chế độ Programmatic — đang sinh từ template...');
        const result = buildProgrammaticRegex({
          schema,
          component: selectedComponent,
          themeId: selectedTheme,
          gameName: undefined,
        });

        setGeneratedScripts(result.scripts);
        setPreviewHtml(result.previewHtml);
        setExpandedScripts(new Set(result.scripts.map((_, i) => i)));
        setLoadingStatus(`✅ Tạo ${result.scripts.length} scripts (${formatBytes(result.totalSize)}) — ${result.fieldsRendered} fields — ~1 giây, $0 API`);
        setGenerating(false);
        return;
      }

      // ═══ MODE 2: ORCHESTRATED MULTI-CALL ═══
      if (effectiveMode === 'orchestrated') {
        const activeProfile = useSettingsStore.getState().getActiveProfile();
        const params = useSettingsStore.getState().generationParams;
        if (!activeProfile?.apiKey) throw new Error('Chưa cấu hình API AI.');

        setLoadingStatus('🔵 Chế độ Orchestrated — lập kế hoạch + sinh song song...');

        const result = await generateOrchestrated({
          schema,
          component: selectedComponent as 'status_bar' | 'opening_form' | 'game_screen' | 'full_set',
          profile: activeProfile,
          params,
          themeHint: THEME_PRESETS[selectedTheme]?.name,
          onProgress: (progress) => {
            setOrchestratedProgress(progress);
            setLoadingStatus(progress.message);
          },
        });

        // Auto-fix AI output
        const fixed = autoFixGameHtml(result.previewHtml);
        if (fixed.hasChanges) {
          setFixResult(fixed);

        }

        setGeneratedScripts(result.scripts);
        setPreviewHtml(fixed.hasChanges ? fixed.fixed : result.previewHtml);
        setExpandedScripts(new Set(result.scripts.map((_, i) => i)));
        setLoadingStatus(`✅ Orchestrated: ${result.scripts.length} scripts, ${formatBytes(result.totalSize)}, ${result.totalCalls} AI calls, ~${result.totalTokens} tokens`);
        setGenerating(false);
        return;
      }

      // ═══ MODE 3: AI SINGLE-CALL (existing flow, improved) ═══
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;

      if (!activeProfile || !activeProfile.apiKey) {
        throw new Error('Chưa cấu hình API AI. Vui lòng vào Settings để cấu hình API Key và Model.');
      }

      setLoadingStatus(`Đang kết nối ${activeProfile.label} (${activeProfile.selectedModel || 'Default'})...`);

      const userPrompt = buildGameRegexUserPrompt(
        selectedComponent,
        schema,
        existingScripts,
        customInstructions.trim() || undefined,
        uiConfig,
        referenceJson || undefined,
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: GAME_REGEX_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      setLoadingStatus('Đang gửi yêu cầu tới AI...');

      // Call AI with retry
      const MAX_RETRIES = 2;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        if (attempt > 1) {
          setLoadingStatus(`Phản hồi AI bị lỗi. Đang thử lại (lần ${attempt}/${MAX_RETRIES + 1})...`);
        }

        try {
          // ═══ PHASE 1: Multi-call continuation when truncated ═══
          const chunks: string[] = [];
          let isTruncated = true;
          let callCount = 0;
          const maxCalls = 8; // Increased from 3 → 8 for large full_set generations
          let currentMessages = [...messages];
          let totalOutputTokens = 0;

          while (isTruncated && callCount < maxCalls) {
            callCount++;
            const partialCount = countScriptsInPartial(chunks.join(''));
            if (callCount > 1) {
              setLoadingStatus(`⏳ Phản hồi bị cắt — đang yêu cầu AI viết tiếp (lượt ${callCount}/${maxCalls}) — đã nhận ~${partialCount} scripts...`);
            }

            // Ensure minimum 50k tokens for detailed regex output (status bar HTML + EJS can be very long)
            const minTokens = 50000;
            const effectiveMaxTokens = Math.max(params.max_tokens || 4096, minTokens);

            const response = await callAI({
              profile: activeProfile,
              params: {
                ...params,
                max_tokens: effectiveMaxTokens,
                temperature: attempt > 1 ? 0.3 : params.temperature,
                useJsonResponseFormat: true,
              },
              messages: currentMessages,
            });

            chunks.push(response.text);
            const reason = response.finishReason;
            const usage = response.usage;
            if (usage) totalOutputTokens += usage.completion_tokens ?? 0;

            const currentPartialCount = countScriptsInPartial(chunks.join(''));
            if (usage) {
              setLoadingStatus(`Lượt ${callCount}: ${usage.prompt_tokens}t in → ${usage.completion_tokens}t out (finish: ${reason ?? 'STOP'}) — ~${currentPartialCount} scripts`);
            }

            isTruncated = ['MAX_TOKENS', 'max_tokens', 'length'].includes(reason || '');

            if (isTruncated && response.text.trim()) {
              // Smart continuation prompt — include context about what we already have
              const lastChars = response.text.trim().slice(-80);
              currentMessages = [
                ...currentMessages,
                { role: 'assistant', content: response.text },
                { role: 'user', content: `JSON bị cắt giữa chừng. Đã nhận ~${currentPartialCount} scripts. Viết tiếp ĐÚNG vị trí bị cắt.\n\nPhần cuối bạn đã viết:\n...${lastChars}\n\nTIẾP TỤC NGAY SAU ĐÓ — KHÔNG viết lại phần đã có, KHÔNG thêm giải thích.` },
              ];
            } else {
              isTruncated = false;
            }
          }

          // ═══ PHASE 2: Repair & Parse ═══
          setLoadingStatus(`Đang sửa chữa và phân tích ${chunks.length} phần phản hồi (${totalOutputTokens} tokens)...`);

          const repairedText = chunks.length > 1
            ? repairConcatenatedJson(chunks)
            : chunks[0];

          const parsed = parseGameRegexResponse(repairedText);

          // ═══ PHASE 3: Post-generation recovery — only when response was truncated/broken ═══
          // This is a RECOVERY mechanism, not a "create more" mechanism.
          // Only triggers when: (1) response was multi-chunk (truncated), AND (2) parsing yielded fewer scripts than minimum
          // If AI completed normally in 1 chunk, it intentionally created that many scripts — don't ask for more.
          const allScripts = [...parsed.scripts];
          const expected = getExpectedScriptCount(selectedComponent);
          const wasTruncated = chunks.length > 1; // Response was cut and continued

          if (selectedComponent !== 'free_form' && allScripts.length < expected.min && wasTruncated) {
            setLoadingStatus(`⚠️ Response bị cắt, chỉ recover được ${allScripts.length}/${expected.min} scripts. Đang gọi AI bổ sung...`);

            const existingNames = allScripts.map(s => s.scriptName).join(', ');
            const supplementMessages: ChatMessage[] = [
              { role: 'system', content: GAME_REGEX_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
              { role: 'assistant', content: JSON.stringify({ scripts: allScripts, explanation: parsed.explanation }) },
              {
                role: 'user',
                content: `Phản hồi trước bị cắt giữa chừng. Bạn đã tạo ${allScripts.length} scripts: [${existingNames}].\n` +
                  `Thành phần "${selectedComponent}" cần TỐI THIỂU ${expected.min} scripts.\n` +
                  `Hãy tạo THÊM các scripts còn thiếu do bị cắt. CHỈ trả về JSON với scripts MỚI, KHÔNG lặp lại scripts đã có.\n` +
                  `Format: { "scripts": [...], "explanation": "..." }`,
              },
            ];

            // Up to 2 supplement calls
            for (let supCall = 0; supCall < 2 && allScripts.length < expected.min; supCall++) {
              try {
                const supChunks: string[] = [];
                let supTruncated = true;
                let supCallCount = 0;
                let supMessages = [...supplementMessages];

                while (supTruncated && supCallCount < 4) {
                  supCallCount++;
                  if (supCallCount > 1) {
                    setLoadingStatus(`🔄 Bổ sung lượt ${supCall + 1} — nối tiếp (${supCallCount}/4)...`);
                  }

                  const supResponse = await callAI({
                    profile: activeProfile,
                    params: { ...params, temperature: 0.3, useJsonResponseFormat: true },
                    messages: supMessages,
                  });

                  supChunks.push(supResponse.text);
                  supTruncated = ['MAX_TOKENS', 'max_tokens', 'length'].includes(supResponse.finishReason || '');

                  if (supTruncated && supResponse.text.trim()) {
                    const lastPart = supResponse.text.trim().slice(-80);
                    supMessages = [
                      ...supMessages,
                      { role: 'assistant', content: supResponse.text },
                      { role: 'user', content: `Tiếp tục JSON bị cắt. Phần cuối:\n...${lastPart}\nTIẾP TỤC NGAY — KHÔNG viết lại.` },
                    ];
                  } else {
                    supTruncated = false;
                  }
                }

                const supRepaired = supChunks.length > 1
                  ? repairConcatenatedJson(supChunks)
                  : supChunks[0];

                const supParsed = parseGameRegexResponse(supRepaired);

                // Merge — only add scripts with new names
                const existingNameSet = new Set(allScripts.map(s => s.scriptName));
                for (const script of supParsed.scripts) {
                  if (!existingNameSet.has(script.scriptName)) {
                    allScripts.push(script);
                    existingNameSet.add(script.scriptName);
                  }
                }

                setLoadingStatus(`✅ Bổ sung thành công — tổng cộng ${allScripts.length} scripts`);
              } catch {
                setLoadingStatus(`⚠️ Không thể bổ sung thêm scripts. Sử dụng ${allScripts.length} scripts đã có.`);
                break;
              }
            }
          }

          // ═══ PHASE 4: Validate & present results ═══
          const validation = validateGameRegexScripts(allScripts);

          setGeneratedScripts(allScripts);
          setExplanation(parsed.explanation);
          setValidationIssues(validation.issues);

          if (!validation.valid) {
            setLoadingStatus(`Tạo ${allScripts.length} scripts nhưng có ${validation.issues.filter(i => i.severity === 'error').length} lỗi cần xem xét.`);
          } else {
            setLoadingStatus(`✅ Tạo thành công ${allScripts.length} regex scripts! (${totalOutputTokens} tokens, ${callCount} lượt gọi)`);
          }

          // Expand all by default
          setExpandedScripts(new Set(allScripts.map((_, i) => i)));

          lastError = null;
          break; // Success
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (attempt > MAX_RETRIES) throw lastError;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoadingStatus('');
    } finally {
      setGenerating(false);
    }
  }, [schema, selectedComponent, existingScripts, customInstructions, uiConfig, referenceJson, generationMode, selectedTheme]);

  // ─── Apply Handler ───
  const handleApply = useCallback(() => {
    if (generatedScripts.length === 0) return;

    const scriptsWithIds: RegexScript[] = generatedScripts.map(s => ({
      ...s,
      id: uuidv4(),
    }));

    updateCard(c => {
      c.data.extensions.regex_scripts.push(...scriptsWithIds);
    });

    setApplied(true);
  }, [generatedScripts, updateCard]);

  // ─── Remove single script from generated list ───
  const handleRemoveGenerated = useCallback((index: number) => {
    setGeneratedScripts(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ─── Toggle expand ───
  const toggleExpand = useCallback((index: number) => {
    setExpandedScripts(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // ─── Copy handler ───
  const handleCopy = useCallback(async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // ─── Render ───
  if (!schema) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Gamepad2 className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">Cần tạo Schema trước</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3">
        <p className="text-xs text-violet-400">
          <strong>🤖 AI Regex Generator</strong> — Gọi AI tạo Regex Scripts render giao diện game.
          Scripts sẽ được thêm vào <code className="px-1 py-0.5 rounded bg-violet-500/10">Regex Lab</code> tab.
        </p>
      </div>

      {/* Component selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {COMPONENTS.map(comp => {
          const Icon = comp.icon;
          const isActive = selectedComponent === comp.id;
          return (
            <button
              key={comp.id}
              onClick={() => { setSelectedComponent(comp.id); setApplied(false); }}
              disabled={generating}
              className={`p-3 rounded-lg border transition-all text-left ${
                isActive
                  ? 'border-primary/40 bg-primary/5 shadow-sm shadow-primary/5'
                  : 'border-border hover:border-primary/20 hover:bg-muted/30'
              } ${generating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Icon className={`w-4 h-4 mb-1 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="text-xs font-medium">{comp.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{comp.desc}</div>
            </button>
          );
        })}
      </div>

      {/* V5: Theme Selector + Mode Selector */}
      <div className="flex flex-wrap gap-3">
        {/* Theme selector */}
        <div className="flex-1 min-w-[200px] space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Palette className="w-3 h-3" />
            <span>Theme</span>
          </div>
          <select
            value={selectedTheme}
            onChange={e => setSelectedTheme(e.target.value)}
            disabled={generating}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground"
          >
            {Object.values(THEME_PRESETS).map(t => (
              <option key={t.id} value={t.id}>{t.icon} {t.name} — {t.description}</option>
            ))}
          </select>
        </div>

        {/* Generation mode */}
        <div className="flex-1 min-w-[200px] space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Settings2 className="w-3 h-3" />
            <span>Chế độ tạo</span>
          </div>
          <select
            value={generationMode}
            onChange={e => setGenerationMode(e.target.value as typeof generationMode)}
            disabled={generating}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground"
          >
            <option value="auto">🔄 Auto (tự chọn tốt nhất)</option>
            <option value="programmatic">⚡ Programmatic (TypeScript, instant, $0)</option>
            <option value="orchestrated">🔵 Orchestrated (AI multi-call, song song)</option>
            <option value="ai_single">🟡 AI Single-Call (1 lượt AI)</option>
          </select>
        </div>
      </div>

      {/* Orchestrated progress tracker */}
      {orchestratedProgress && orchestratedProgress.phase !== 'done' && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
            <Zap className="w-3.5 h-3.5" />
            Orchestrated Generation
          </div>
          {orchestratedProgress.sectionStatuses?.map(s => (
            <div key={s.id} className="flex items-center gap-2 text-[10px] px-2 py-1 rounded bg-blue-500/5">
              <span className={`w-1.5 h-1.5 rounded-full ${
                s.status === 'done' ? 'bg-emerald-400' :
                s.status === 'generating' ? 'bg-blue-400 animate-pulse' :
                s.status === 'failed' ? 'bg-red-400' :
                s.status === 'fallback' ? 'bg-amber-400' :
                'bg-muted-foreground/30'
              }`} />
              <span className="flex-1 truncate">{s.name}</span>
              {s.status === 'done' && s.size && (
                <span className="text-muted-foreground">{formatBytes(s.size)} — {((s.duration ?? 0) / 1000).toFixed(1)}s</span>
              )}
              {s.status === 'generating' && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
              {s.status === 'failed' && <span className="text-red-400">✗</span>}
              {s.status === 'fallback' && <span className="text-amber-400">fallback</span>}
            </div>
          ))}
          {orchestratedProgress.sectionsTotal && (
            <div className="h-1.5 bg-blue-500/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${((orchestratedProgress.sectionsCompleted ?? 0) / orchestratedProgress.sectionsTotal) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ─── FREE-FORM: primary textarea ─── */}
      {selectedComponent === 'free_form' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-300">Mô tả Regex bạn muốn AI tạo</span>
            <span className="text-[10px] text-muted-foreground">(bắt buộc)</span>
          </div>
          <textarea
            value={customInstructions}
            onChange={e => setCustomInstructions(e.target.value)}
            disabled={generating}
            placeholder={`Mô tả chi tiết regex bạn muốn tạo. Ví dụ:

• Tạo regex wrap tất cả đoạn hội thoại trong thẻ <details> với summary là tên nhân vật
• Tạo regex render bảng skills dạng grid 3 cột với icon và level
• Tạo regex thay tag <battle> thành UI chiến đấu có HP bar, damage animation
• Tạo regex auto-add nhạc nền khi AI output có keyword "đêm trăng"
• Tạo bộ regex hoàn chỉnh cho giao diện tu tiên với nhiều trang

Bạn có thể viết tự do — AI sẽ tạo regex scripts theo mô tả.`}
            className="w-full px-3 py-3 text-xs rounded-lg border-2 border-amber-500/30 bg-amber-500/5
              placeholder:text-muted-foreground/40 resize-y
              focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/40 transition-all"
            rows={6}
          />
          {!customInstructions.trim() && (
            <p className="text-[10px] text-amber-500/70 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Cần nhập mô tả để AI biết tạo regex gì
            </p>
          )}
        </div>
      )}

      {/* UI Config Panel — always show for presets, collapsible for free_form */}
      {selectedComponent !== 'free_form' ? (
        <GameUIConfigPanel
          config={uiConfig}
          onChange={setUIConfig}
          disabled={generating}
        />
      ) : (
        <details className="group">
          <summary className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors select-none">
            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
            <Sparkles className="w-3 h-3" />
            Cấu hình UI nâng cao (tuỳ chọn)
          </summary>
          <div className="mt-2">
            <GameUIConfigPanel
              config={uiConfig}
              onChange={setUIConfig}
              disabled={generating}
            />
          </div>
        </details>
      )}

      {/* Custom instructions toggle + input — only for non-free_form modes */}
      {selectedComponent !== 'free_form' && (
        <div className="space-y-2">
          <button
            onClick={() => setShowCustomInput(!showCustomInput)}
            disabled={generating}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCustomInput ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Sparkles className="w-3 h-3" />
            Yêu cầu bổ sung (ghi đè / mô tả thêm cho AI)
          </button>

          {showCustomInput && (
            <textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              disabled={generating}
              placeholder="Ví dụ: Thêm hiệu ứng đặc biệt cho NPC boss, đổi màu nền khi HP thấp, thêm nhạc nền..."
              className="w-full px-3 py-2.5 text-xs rounded-lg border border-border bg-background
                placeholder:text-muted-foreground/50 resize-none
                focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
              rows={3}
            />
          )}
        </div>
      )}

      {/* JSON Reference File Upload */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <FileUp className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-medium text-cyan-300">File JSON tham khảo</span>
          <span className="text-[10px] text-muted-foreground">(tuỳ chọn)</span>
        </div>

        {referenceJson ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
            <FileUp className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] text-cyan-300 truncate flex-1">{referenceFileName}</span>
            <span className="text-[9px] text-muted-foreground">
              {(referenceJson.length / 1024).toFixed(1)} KB
            </span>
            <button
              onClick={() => { setReferenceJson(''); setReferenceFileName(''); }}
              disabled={generating}
              className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
              title="Xóa file tham khảo"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <label className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed
            border-border/50 hover:border-cyan-500/30 hover:bg-cyan-500/5
            text-muted-foreground hover:text-cyan-400 transition-all cursor-pointer
            ${generating ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <FileUp className="w-4 h-4" />
            <span className="text-[11px]">Chọn file .json để gửi kèm cho AI tham khảo</span>
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              disabled={generating}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  // Validate JSON
                  JSON.parse(text);
                  setReferenceJson(text);
                  setReferenceFileName(file.name);
                } catch {
                  setReferenceJson(text => text); // keep old
                  setError(`File "${file.name}" không phải JSON hợp lệ.`);
                }
                e.target.value = ''; // reset input
              }}
            />
          </label>
        )}

        {referenceJson && (
          <p className="text-[10px] text-muted-foreground/60 ml-5">
            AI sẽ tham khảo cấu trúc, style và pattern từ file này khi tạo regex scripts
          </p>
        )}
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerate}
          disabled={generating || (selectedComponent === 'free_form' && !customInstructions.trim())}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
            generating || (selectedComponent === 'free_form' && !customInstructions.trim())
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:opacity-90 shadow-lg shadow-violet-500/20'
          }`}
        >
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wand2 className="w-4 h-4" />
          )}
          {generating ? 'Đang tạo...' : `Tạo Regex Scripts — ${COMPONENTS.find(c => c.id === selectedComponent)?.label}`}
        </button>

        {loadingStatus && (
          <span className="text-[10px] text-muted-foreground/80 flex-1 truncate">
            {loadingStatus}
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-red-400">Lỗi tạo scripts</p>
            <p className="text-[11px] text-red-400/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Generated scripts preview */}
      {generatedScripts.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="px-4 py-2.5 bg-muted/20 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-medium">
                {generatedScripts.length} Regex Scripts đã tạo
              </span>
              {explanation && (
                <span className="text-[10px] text-muted-foreground ml-2">— {explanation}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(JSON.stringify(generatedScripts, null, 2), 'all-scripts')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  copiedId === 'all-scripts'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                }`}
              >
                {copiedId === 'all-scripts' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedId === 'all-scripts' ? 'Đã copy!' : 'Copy JSON'}
              </button>
            </div>
          </div>

          {/* Validation warnings */}
          {validationIssues.length > 0 && (
            <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/10">
              {validationIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] py-0.5">
                  {issue.severity === 'error' ? (
                    <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <span className={issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
                    Script [{issue.index}] {issue.field}: {issue.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* V5: Iframe Preview + Quality Badge + Diff */}
          {previewHtml && (
            <div className="px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                    showPreview
                      ? 'bg-violet-500/20 text-violet-400'
                      : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  {showPreview ? 'Ẩn Preview' : 'Iframe Preview'}
                </button>

                <span className="text-[9px] text-muted-foreground">
                  {formatBytes(previewHtml.length)}
                </span>

                {/* Cảnh báo script vỡ cú pháp JS */}
                {scriptWarn && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-red-500/20 text-red-400"
                    title="Script JS trong game HTML bị vỡ cú pháp — nạp vào SillyTavern dễ lỗi. Kiểm tra lại code."
                  >
                    ⚠️ {scriptWarn.broken}/{scriptWarn.total} script vỡ JS
                  </span>
                )}

                {/* Quality badge */}
                {fixResult && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                    fixResult.qualityScore === 'A' ? 'bg-emerald-500/20 text-emerald-400' :
                    fixResult.qualityScore === 'B' ? 'bg-blue-500/20 text-blue-400' :
                    fixResult.qualityScore === 'C' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>
                    Quality: {fixResult.qualityScore}
                  </span>
                )}

                {/* Fix count badge */}
                {fixResult && fixResult.fixes.length > 0 && (
                  <button
                    onClick={() => setShowDiff(!showDiff)}
                    className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full transition-colors ${
                      showDiff
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-muted text-muted-foreground hover:text-amber-400'
                    }`}
                  >
                    🔧 {fixResult.fixes.length} auto-fix
                  </button>
                )}
              </div>

              {/* Iframe */}
              {showPreview && (
                <div className="mt-2 rounded-lg border border-border overflow-hidden bg-white">
                  <iframe
                    srcDoc={previewHtml.replace(/^```html\n/, '').replace(/```$/, '')}
                    sandbox="allow-scripts"
                    title="Game UI Preview"
                    className="w-full border-0"
                    style={{ height: '400px', minHeight: '200px' }}
                  />
                </div>
              )}

              {/* Diff panel */}
              {showDiff && fixResult && (
                <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 max-h-[200px] overflow-y-auto">
                  <div className="text-[9px] text-amber-400 font-medium mb-1">Auto-fix changes:</div>
                  {fixResult.fixes.map((fix, i) => (
                    <div key={i} className="text-[9px] py-0.5 flex items-start gap-1.5">
                      <span className={
                        fix.type === 'error' ? 'text-red-400' :
                        fix.type === 'warning' ? 'text-amber-400' :
                        'text-blue-400'
                      }>
                        {fix.type === 'error' ? '🔴' : fix.type === 'warning' ? '🟡' : '🔵'}
                      </span>
                      <span className="text-muted-foreground">
                        [{fix.category}] {fix.description}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Script list */}
          <div className="divide-y divide-border/50">
            {generatedScripts.map((script, index) => {
              const isExpanded = expandedScripts.has(index);
              const mode = script.markdownOnly ? '🎨 Render' : script.promptOnly ? '🤖 AI-only' : '↔️ Both';
              const hasError = validationIssues.some(i => i.index === index && i.severity === 'error');

              return (
                <div key={index} className={`${hasError ? 'bg-red-500/5' : ''}`}>
                  {/* Script header */}
                  <div
                    onClick={() => toggleExpand(index)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpand(index);
                      }
                    }}
                    className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-muted/20 transition-colors text-left cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}

                    <span className="text-xs font-medium flex-1 truncate">{script.scriptName}</span>

                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {mode}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                      {script.placement.map(p => PLACEMENT_MAP[p] ?? p).join(', ')}
                    </span>

                    <button
                      onClick={e => { e.stopPropagation(); handleRemoveGenerated(index); }}
                      className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                      title="Bỏ script này"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-2">
                      {/* findRegex */}
                      <div className="rounded-lg bg-muted/30 p-2.5">
                        <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider mb-1">findRegex</div>
                        <code className="text-[11px] font-mono text-emerald-400 break-all">
                          {script.findRegex}
                        </code>
                      </div>

                      {/* replaceString */}
                      <div className="rounded-lg bg-muted/30 p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">replaceString</div>
                          <button
                            onClick={() => handleCopy(script.replaceString, `replace-${index}`)}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                              copiedId === `replace-${index}`
                                ? 'text-emerald-400'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {copiedId === `replace-${index}` ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                          </button>
                        </div>
                        <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto scrollbar-thin">
                          {script.replaceString || '(rỗng — xóa nội dung match)'}
                        </pre>
                      </div>

                      {/* Flags */}
                      <div className="flex flex-wrap gap-1.5">
                        {script.markdownOnly && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400">markdownOnly</span>
                        )}
                        {script.promptOnly && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">promptOnly</span>
                        )}
                        {script.runOnEdit && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">runOnEdit</span>
                        )}
                        {script.substituteRegex > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">
                            substitute={script.substituteRegex === 1 ? 'Raw' : 'Escaped'}
                          </span>
                        )}
                        {script.minDepth !== null && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                            depth: {script.minDepth}~{script.maxDepth ?? '∞'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Apply button */}
          <div className="px-4 py-3 bg-muted/10 border-t border-border flex items-center justify-between">
            {applied ? (
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-medium">
                  Đã thêm {generatedScripts.length} scripts vào card! Xem ở tab Regex Lab.
                </span>
              </div>
            ) : (
              <>
                <span className="text-[10px] text-muted-foreground">
                  {generatedScripts.length} scripts sẽ được thêm vào regex_scripts
                </span>
                <button
                  onClick={handleApply}
                  disabled={validationIssues.some(i => i.severity === 'error')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    validationIssues.some(i => i.severity === 'error')
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 shadow-md shadow-emerald-500/20'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Áp dụng vào Card
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Existing game scripts section */}
      {gameScripts.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/20 border-b border-border">
            <div className="flex items-center gap-1.5">
              <Gamepad2 className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium">
                Game Scripts đã có ({gameScripts.length})
              </span>
              <span className="text-[10px] text-muted-foreground ml-1">
                — Chỉnh sửa chi tiết ở tab Regex Lab
              </span>
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {gameScripts.map(script => {
              const mode = script.markdownOnly ? '🎨' : script.promptOnly ? '🤖' : '↔️';
              return (
                <div key={script.id} className="px-4 py-2 flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${script.disabled ? 'bg-red-400' : 'bg-emerald-400'}`} />
                  <span className="text-[11px] font-medium truncate flex-1">{script.scriptName}</span>
                  <span className="text-[9px] text-muted-foreground">{mode}</span>
                  <code className="text-[9px] text-muted-foreground/60 font-mono truncate max-w-[200px]">
                    {script.findRegex.slice(0, 40)}{script.findRegex.length > 40 ? '…' : ''}
                  </code>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
