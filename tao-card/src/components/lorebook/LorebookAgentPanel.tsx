/**
 * LorebookAgentPanel — (Goal 102.1) Tầng 1 của Lorebook: "Yêu cầu → Tạo", AI tự quyết.
 * ─────────────────────────────────────────────────────────────────────────────
 * User gõ yêu cầu (+ dán tài liệu nếu có) → agent lên kế hoạch: TỰ QUYẾT số entry, độ dài,
 * loại thẻ, và LIỆT KÊ SẴN TIÊU ĐỀ từng entry (xương sống chống trùng khi chạy đa luồng) →
 * user duyệt → chạy bằng engine batch có sẵn (pool nhiều key song song + dedup + sinh bù) →
 * kiểm tự động (key sạch + entry nhân vật bám schema #48) → sửa máy móc/AI hội tụ → Hoàn tác được.
 * Các panel chỉnh tay cũ vẫn nguyên trong tầng "Nâng cao".
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Bot, Loader2, Play, X, Undo2, AlertTriangle, Check, ListChecks,
  Square, RotateCcw, FileText, ChevronDown, Pause,
} from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useBatchRunStore } from '../../store/batchRunStore';
import { callAI } from '../../lib/ai/client';
import { planGoal, type AgentCallFn, type AgentIssue } from '../../lib/ai/goalAgent';
import {
  buildLorebookPlanMessages, parseLorebookPlan, buildBucketTopicPrompt,
  validateLorebookRun, autofixLorebookKeys, fixSchemaMissEntries,
  type LorebookPlan,
} from '../../lib/ai/lorebookAgent';
import { runBatchGeneration, type BatchGenConfig } from '../../lib/ai/batchGenerator';
import { buildSchemaContextForBatch } from '../../lib/mvuzod/schemaContextBuilder';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { ChatMessage, LorebookEntry } from '../../types';

type Phase = 'idle' | 'planning' | 'review' | 'running' | 'done';

export function LorebookAgentPanel() {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const isRunning = useBatchRunStore(s => s.isRunning);
  const isPaused = useBatchRunStore(s => s.isPaused);
  const logs = useBatchRunStore(s => s.logs);
  const progress = useBatchRunStore(s => s.progress);

  const schema: MVUZODSchema | null = useMemo(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown> | undefined;
    return ((ext?.mvuzod as Record<string, unknown>)?.schema as MVUZODSchema) ?? null;
  }, [card.data.extensions]);

  const [goal, setGoal] = useState('');
  const [docText, setDocText] = useState('');
  const [showDoc, setShowDoc] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<LorebookPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<AgentIssue[]>([]);
  const [createdIds, setCreatedIds] = useState<number[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  const makeCall = useCallback((signal?: AbortSignal): AgentCallFn => {
    return async (messages: ChatMessage[], opts) => {
      const profile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!profile?.apiKey) throw new Error('Chưa cấu hình API — vào Cài đặt thêm profile trước.');
      const res = await callAI({
        profile,
        params: {
          ...params,
          ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
          useJsonResponseFormat: true,
          stream: false,
        },
        messages, signal, label: opts?.label ?? 'Lorebook Agent',
      });
      return res.text;
    };
  }, []);

  // ─── Pha 1: kế hoạch ───
  const handlePlan = useCallback(async () => {
    setPhase('planning');
    setError(null); setPlan(null); setIssues([]); setSummary(null); setCreatedIds([]);
    const ac = new AbortController();
    useBatchRunStore.setState({ abort: ac, stopped: false });
    try {
      // Miền lorebook chỉ dùng khung goalAgent cho pha PLAN (duyệt trước khi tiêu call);
      // pha chạy giao engine batch vì nó song song hoá tốt hơn vòng step tuần tự.
      const domain = {
        name: 'Lorebook Agent',
        buildPlanMessages: (g: string) => buildLorebookPlanMessages(g, { card, schema, docText }),
        parsePlan: parseLorebookPlan,
        buildStepMessages: () => [], parseStepOutput: () => null as never,
        validate: () => [], buildFixMessages: () => [], parseFixOutput: () => null as never,
        itemKey: () => '',
      };
      const p = await planGoal(goal, domain, makeCall(ac.signal), ac.signal) as LorebookPlan;
      setPlan(p);
      setPhase('review');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { setPhase('idle'); return; }
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }, [goal, docText, card, schema, makeCall]);

  // ─── Pha 2: chạy engine + kiểm + sửa ───
  const handleRun = useCallback(async () => {
    if (!plan) return;
    const profile = useSettingsStore.getState().getActiveProfile();
    if (!profile?.apiKey) { setError('Chưa cấu hình API — vào Cài đặt thêm profile trước.'); return; }

    setPhase('running');
    setError(null); setIssues([]); setSummary(null);
    const run = useBatchRunStore.getState();
    run.beginRun();
    run.setIsRunning(true);
    const ac = new AbortController();
    useBatchRunStore.setState({ abort: ac, stopped: false, isPaused: false });
    const addLog = useBatchRunStore.getState().addLog;

    const newIds: number[] = [];
    try {
      const config: BatchGenConfig = {
        topicPrompt: buildBucketTopicPrompt(goal, plan, docText),
        useCardContext: true,
        useWebSearch: plan.config.useWebSearch,
        totalEntries: plan.config.totalEntries,
        minEntries: plan.config.minEntries,
        entriesPerBatch: plan.config.entriesPerBatch,
        defaultPosition: 1,
        insertionOrderMode: 'same',
        insertionOrderStart: 100,
        maxRetriesPerBatch: 2,
        maxConsecutiveErrors: 3,
        cardType: plan.config.cardType,
        autoConfig: true,          // AI tự quyết constant/position/order… từng entry
        tokensPerEntry: plan.config.tokensPerEntry,
        schemaContext: schema ? buildSchemaContextForBatch(schema) : undefined,
      };

      await runBatchGeneration(config, {
        card: structuredClone(useCardStore.getState().card),
        profile,
        generationParams: useSettingsStore.getState().generationParams,
        get paused() { return useBatchRunStore.getState().isPaused; },
        get stopped() { return useBatchRunStore.getState().stopped; },
        get signal() { return useBatchRunStore.getState().abort?.signal; },
        log: addLog,
        onProgress: useBatchRunStore.getState().setProgress,
        appendEntry: (entry: LorebookEntry) => { addEntry(entry); newIds.push(entry.id); },
      });

      // ─── Kiểm tự động sau chạy (102.3) ───
      const stopped = useBatchRunStore.getState().stopped;
      const allEntries = useCardStore.getState().card.data.character_book?.entries ?? [];
      const newEntries = allEntries.filter(e => newIds.includes(e.id));
      let found = validateLorebookRun({ newEntries, schema, plan });

      if (found.length) {
        addLog(`\n🔎 Kiểm tự động: ${found.length} vấn đề — sửa máy móc trước, AI sau.`);
        // Sửa máy móc: dọn key _/- (miễn phí)
        const keyFix = autofixLorebookKeys(newEntries, found);
        for (const p2 of keyFix.patches) useCardStore.getState().updateEntry(p2.id, { keys: p2.keys });
        for (const f of keyFix.fixed) addLog(`🔧 ${f}`);
        // Sửa AI: entry nhân vật thiếu chỉ số schema (giới hạn 8, hội tụ — bản sửa tệ là bỏ)
        if (schema && !stopped && found.some(i => i.code === 'lb-schema-miss')) {
          const patches = await fixSchemaMissEntries(newEntries, found, schema, makeCall(ac.signal),
            { signal: ac.signal, log: addLog });
          for (const p3 of patches) useCardStore.getState().updateEntry(p3.id, { content: p3.content });
        }
        // Re-validate để báo đúng phần còn lại
        const after = useCardStore.getState().card.data.character_book?.entries ?? [];
        found = validateLorebookRun({ newEntries: after.filter(e => newIds.includes(e.id)), schema, plan });
      }

      setIssues(found);
      setCreatedIds(newIds);
      setSummary(`${stopped ? '⏹ Đã dừng — ' : ''}Đã tạo ${newIds.length}/${plan.config.totalEntries} entry` +
        (found.length ? `; còn ${found.filter(i => i.level === 'error').length} vấn đề (xem dưới).` : '; kiểm tự động sạch.'));
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreatedIds(newIds);
      setPhase(newIds.length ? 'done' : 'review');
    } finally {
      useBatchRunStore.getState().setIsRunning(false);
    }
  }, [plan, goal, docText, schema, addEntry, makeCall]);

  const handleStop = useCallback(() => {
    const st = useBatchRunStore.getState();
    st.setStopped(true);
    st.abort?.abort();
  }, []);

  const handlePauseToggle = useCallback(() => {
    const st = useBatchRunStore.getState();
    st.setPaused(!st.isPaused);
  }, []);

  const handleUndo = useCallback(() => {
    const st = useCardStore.getState();
    for (const id of createdIds) st.deleteEntry(id);
    setCreatedIds([]);
    setSummary('↩️ Đã hoàn tác: xoá toàn bộ entry vừa tạo.');
  }, [createdIds]);

  const handleReset = useCallback(() => {
    setPhase('idle'); setPlan(null); setError(null); setIssues([]);
    setSummary(null); setCreatedIds([]);
  }, []);

  const busy = phase === 'planning' || phase === 'running';
  const totalTitles = plan ? plan.buckets.reduce((s, b) => s + b.titles.length, 0) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-4 p-5">
      {/* Ô yêu cầu */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Bạn muốn lorebook như thế nào?</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Chỉ cần mô tả bằng lời thường — AI tự quyết số entry, độ dài, phân loại, và liệt kê sẵn
          danh sách tiêu đề để các luồng chạy song song không giẫm nhau. Bạn duyệt kế hoạch rồi mới chạy.
          {schema ? ' Card có MVUZOD schema → entry nhân vật sẽ bị ép gán chỉ số theo schema.' : ''}
        </p>
        <textarea
          value={goal} onChange={e => setGoal(e.target.value)} disabled={busy} rows={3}
          placeholder={'Ví dụ: "Tạo lorebook thế giới tu tiên cho thẻ này: môn phái, trưởng lão, bí cảnh, tông môn đối địch. Ưu tiên NPC có quan hệ trực tiếp với nhân vật chính."'}
          className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y placeholder:text-muted-foreground/40"
        />
        {/* Tài liệu nguồn (tuỳ chọn) — agent tự quyết trích gì */}
        <button onClick={() => setShowDoc(!showDoc)}
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <FileText className="w-3.5 h-3.5" />
          Dán tài liệu nguồn (tuỳ chọn){docText.trim() ? ` — ${docText.length.toLocaleString()} ký tự` : ''}
          <ChevronDown className={`w-3 h-3 transition-transform ${showDoc ? '' : '-rotate-90'}`} />
        </button>
        {showDoc && (
          <textarea
            value={docText} onChange={e => setDocText(e.target.value)} disabled={busy} rows={5}
            placeholder="Dán truyện/tư liệu/wiki vào đây — AI tự quyết trích thực thể nào để tạo entry gì, bạn không phải chọn."
            className="w-full px-3 py-2 text-[11px] rounded-lg border border-border bg-background font-mono
              focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y placeholder:text-muted-foreground/40"
          />
        )}
        <div className="flex gap-2">
          <button onClick={handlePlan} disabled={busy || isRunning || (!goal.trim() && !docText.trim())}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
              bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {phase === 'planning'
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang lên kế hoạch…</>
              : <><ListChecks className="w-3.5 h-3.5" /> Lên kế hoạch</>}
          </button>
          {busy && (
            <button onClick={handleStop}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
              <Square className="w-3 h-3" /> Dừng
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Kế hoạch chờ duyệt */}
      {plan && phase !== 'idle' && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <ListChecks className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Kế hoạch của AI</span>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {totalTitles} entry · ~{plan.estCalls} call AI
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{plan.scope}</p>
          {/* (bug 196) User: "cần cho người dùng có thể tự điều chỉnh". Trước đây mấy con số này
              chỉ là nhãn CHỈ ĐỌC — AI quyết sao thì chịu vậy, muốn entry dài hơn hay nhiều entry
              hơn thì không có đường nào ngoài viết lại lời yêu cầu rồi lập kế hoạch lại từ đầu. */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <label className="px-2 py-0.5 rounded bg-muted/40 flex items-center gap-1">
              token/entry
              <input
                type="number" min={80} max={6000} step={50}
                value={plan.config.tokensPerEntry}
                onChange={(e) => setPlan({
                  ...plan,
                  config: { ...plan.config, tokensPerEntry: Math.max(80, Math.min(6000, parseInt(e.target.value) || 250)) },
                })}
                disabled={phase === 'running'}
                className="w-16 bg-transparent border-b border-border/60 text-right font-medium text-amber-400 focus:outline-none focus:border-primary"
              />
            </label>
            <label className="px-2 py-0.5 rounded bg-muted/40 flex items-center gap-1">
              tối thiểu
              <input
                type="number" min={0} max={300} step={5}
                value={plan.config.minEntries}
                onChange={(e) => setPlan({
                  ...plan,
                  config: { ...plan.config, minEntries: Math.max(0, Math.min(300, parseInt(e.target.value) || 0)) },
                })}
                disabled={phase === 'running'}
                className="w-14 bg-transparent border-b border-border/60 text-right font-medium text-amber-400 focus:outline-none focus:border-primary"
              />
              entry
            </label>
            <span className="px-2 py-0.5 rounded bg-muted/40">{plan.config.cardType === 'single' ? 'Thẻ đơn' : 'Nhiều nhân vật'}</span>
            <span className="px-2 py-0.5 rounded bg-muted/40">lô {plan.config.entriesPerBatch} entry</span>
          </div>
          {plan.config.tokensPerEntry >= 1500 && (
            <p className="text-[10px] text-amber-400/90">
              💡 Entry dài {plan.config.tokensPerEntry} token: tool sẽ tự rút số entry mỗi lô và nâng trần
              output cho vừa, nên số lượt gọi AI sẽ tăng lên. Nếu vẫn hụt độ dài, nâng trần output của
              model trong Cài đặt.
            </p>
          )}
          <ol className="space-y-1.5">
            {plan.steps.map((s, i) => (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted/40 flex items-center justify-center text-[10px] font-semibold">{i + 1}</span>
                <div className="min-w-0">
                  <span className="font-medium">{s.title}</span>
                  {s.detail && <p className="text-[10px] text-muted-foreground truncate" title={s.detail}>{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
          {plan.notes?.length ? (
            <div className="text-[10px] text-amber-400/90 space-y-0.5">
              {plan.notes.map((n, i) => <p key={i}>💡 {n}</p>)}
            </div>
          ) : null}
          {phase === 'review' && (
            <div className="flex gap-2 pt-1">
              <button onClick={handleRun} disabled={isRunning}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                  bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                <Play className="w-3.5 h-3.5" /> Duyệt & chạy
              </button>
              <button onClick={handleReset}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3 h-3" /> Huỷ
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tiến trình chạy */}
      {(phase === 'running' || (phase === 'done' && logs.length > 0)) && (
        <div className="rounded-xl border border-border bg-background/60 p-3 space-y-2">
          {progress && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Math.round((progress.created / Math.max(1, progress.total)) * 100))}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{progress.created}/{progress.total}</span>
              {phase === 'running' && (
                <button onClick={handlePauseToggle} title={isPaused ? 'Chạy tiếp' : 'Tạm dừng'}
                  className="p-1 rounded text-muted-foreground hover:text-foreground">
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          )}
          <div className="max-h-44 overflow-y-auto scrollbar-thin space-y-0.5">
            {logs.slice(-80).map((line, i) => (
              <p key={i} className={`text-[10px] font-mono ${line.includes('✅') ? 'text-emerald-400/80' : line.includes('⚠️') || line.includes('❌') ? 'text-amber-400/80' : 'text-muted-foreground'}`}>{line}</p>
            ))}
            {phase === 'running' && (
              <p className="text-[10px] font-mono text-primary flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> đang chạy…
              </p>
            )}
          </div>
        </div>
      )}

      {/* Kết quả */}
      {phase === 'done' && summary && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            {issues.filter(i => i.level === 'error').length === 0
              ? <Check className="w-4 h-4 text-green-400" />
              : <AlertTriangle className="w-4 h-4 text-amber-400" />}
            <span className="text-sm font-semibold flex-1">{summary}</span>
            {createdIds.length > 0 && (
              <button onClick={handleUndo}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-amber-400 hover:bg-amber-500/10 transition-colors">
                <Undo2 className="w-3 h-3" /> Hoàn tác tất cả
              </button>
            )}
          </div>
          {issues.length > 0 && (
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5 space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
              {issues.map((iss, i) => (
                <p key={i} className="text-[9px] text-amber-400/80">
                  {iss.level === 'error' ? '🔴' : '🟡'} [{iss.code}] {iss.where ? `${iss.where}: ` : ''}{iss.message}
                </p>
              ))}
            </div>
          )}
          <button onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
            <RotateCcw className="w-3 h-3" /> Yêu cầu mới
          </button>
        </div>
      )}
    </div>
  );
}
