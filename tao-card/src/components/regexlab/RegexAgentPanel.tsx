/**
 * RegexAgentPanel — (Goal 103.1) Drawer "Sinh AI" của Regex Lab.
 * ─────────────────────────────────────────────────────────────────────────────
 * User mô tả nhu cầu ("ẩn khối thinking", "render bảng trạng thái"…) → agent lên kế hoạch
 * (mỗi bước = 1 script) → duyệt → sinh qua khung goalAgent: mọi regex bị ép compile +
 * kiểm replaceString + CHẠY THỬ trên sample của Lab, lỗi thì AI tự sửa hội tụ (luật #42).
 * Script qua kiểm mới được ghi vào card, kèm Hoàn tác.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Wand2, Loader2, Play, X, Undo2, AlertTriangle, Check, ListChecks,
  Square, RotateCcw,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import {
  planGoal, executeGoalPlan,
  type AgentCallFn, type AgentPlan, type GoalRunResult,
} from '../../lib/ai/goalAgent';
import { createRegexDomain, type RegexDraft } from '../../lib/ai/regexAgent';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { ChatMessage } from '../../types';

type Phase = 'idle' | 'planning' | 'review' | 'running' | 'done';

interface RegexAgentPanelProps {
  schema: MVUZODSchema | null;
  sampleText: string;
  onClose: () => void;
  /** Chọn script vừa tạo trong list của Lab để user xem preview ngay. */
  onCreated?: (firstId: string) => void;
}

export function RegexAgentPanel({ schema, sampleText, onClose, onCreated }: RegexAgentPanelProps) {
  const card = useCardStore(s => s.card);
  const updateCard = useCardStore(s => s.updateCard);
  const existingScripts = useMemo(
    () => card.data.extensions.regex_scripts.map(s => ({ scriptName: s.scriptName, findRegex: s.findRegex })),
    [card.data.extensions.regex_scripts],
  );

  const [goal, setGoal] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<GoalRunResult<RegexDraft> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const domain = useMemo(
    () => createRegexDomain({ schema, existingScripts, sampleText }),
    [schema, existingScripts, sampleText],
  );

  const makeCall = useCallback((signal: AbortSignal): AgentCallFn => {
    return async (messages: ChatMessage[], opts) => {
      const profile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!profile?.apiKey) throw new Error('Chưa cấu hình API — vào Cài đặt thêm profile trước.');
      const res = await callAI({
        profile,
        params: {
          ...params,
          ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
          useJsonResponseFormat: true, stream: false,
        },
        messages, signal, label: opts?.label ?? 'Regex Agent',
      });
      return res.text;
    };
  }, []);

  const handlePlan = useCallback(async () => {
    setPhase('planning');
    setError(null); setPlan(null); setResult(null); setProgress([]); setCreatedIds([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const p = await planGoal(goal.trim(), domain, makeCall(ac.signal), ac.signal);
      setPlan(p);
      setPhase('review');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { setPhase('idle'); return; }
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }, [goal, domain, makeCall]);

  const handleRun = useCallback(async () => {
    if (!plan) return;
    setPhase('running');
    setError(null); setProgress([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await executeGoalPlan(plan, domain, makeCall(ac.signal), {
        signal: ac.signal,
        onProgress: (ev) => setProgress(prev => [...prev, ev.text]),
      });
      setResult(r);
      // Chỉ ghi vào card khi TOÀN BỘ qua kiểm (compile + chạy thử) — không nhét regex hỏng.
      if (r.ok && r.items.length) {
        const ids: string[] = [];
        updateCard(c => {
          for (const d of r.items) {
            const id = uuidv4();
            c.data.extensions.regex_scripts.push({ ...d.script, id });
            ids.push(id);
          }
        });
        setCreatedIds(ids);
        if (ids.length) onCreated?.(ids[0]);
      }
      setPhase('done');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setProgress(prev => [...prev, '⏹ Đã dừng theo yêu cầu.']);
        setPhase('review');
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setPhase('review');
    }
  }, [plan, domain, makeCall, updateCard, onCreated]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleUndo = useCallback(() => {
    updateCard(c => {
      c.data.extensions.regex_scripts = c.data.extensions.regex_scripts.filter(s => !createdIds.includes(s.id));
    });
    setCreatedIds([]);
    setResult(null);
    setPhase('review');
  }, [createdIds, updateCard]);

  const busy = phase === 'planning' || phase === 'running';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-card border border-border rounded-xl w-full max-w-xl flex flex-col max-h-[85vh] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20 shrink-0">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Sinh Regex bằng AI</h3>
          </div>
          <button onClick={() => { if (!busy) onClose(); }} disabled={busy}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Mô tả bằng lời thường — AI tự quyết cần mấy script rồi trình kế hoạch. Mọi regex sinh ra
            đều bị ép <strong>compile + chạy thử thật</strong> trên sample của Lab trước khi vào card;
            lỗi thì AI tự sửa, không sửa nổi thì không ghi gì cả.
          </p>
          <textarea
            value={goal} onChange={e => setGoal(e.target.value)} disabled={busy} rows={3}
            placeholder={'Ví dụ: "Ẩn khối <details> thinking khỏi hiển thị" hoặc "Render khối <UpdateVariable> thành bảng trạng thái đẹp, ẩn JSON gốc".'}
            className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background
              focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y placeholder:text-muted-foreground/40"
          />
          <div className="flex gap-2">
            <button onClick={handlePlan} disabled={busy || !goal.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all">
              {phase === 'planning'
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang lên kế hoạch…</>
                : <><ListChecks className="w-3.5 h-3.5" /> Lên kế hoạch</>}
            </button>
            {busy && (
              <button onClick={handleStop}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20">
                <Square className="w-3 h-3" /> Dừng
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Kế hoạch */}
          {plan && phase !== 'idle' && (
            <div className="rounded-xl border border-border bg-background/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <ListChecks className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold">Kế hoạch</span>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {plan.steps.length} script · ~{plan.estCalls} call
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{plan.scope}</p>
              <ol className="space-y-1">
                {plan.steps.map((s, i) => (
                  <li key={s.id} className="flex items-start gap-2 text-[11px]">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-muted/40 flex items-center justify-center text-[9px] font-semibold">{i + 1}</span>
                    <div>
                      <span className="font-medium">{s.title}</span>
                      {s.detail && <p className="text-[10px] text-muted-foreground">{s.detail}</p>}
                    </div>
                  </li>
                ))}
              </ol>
              {plan.notes?.length ? plan.notes.map((n, i) => (
                <p key={i} className="text-[10px] text-amber-400/90">💡 {n}</p>
              )) : null}
              {phase === 'review' && (
                <div className="flex gap-2 pt-1">
                  <button onClick={handleRun}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                      bg-primary text-primary-foreground hover:bg-primary/90">
                    <Play className="w-3.5 h-3.5" /> Duyệt & chạy
                  </button>
                  <button onClick={() => { setPlan(null); setPhase('idle'); }}
                    className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground bg-muted/30">
                    Huỷ
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tiến trình */}
          {progress.length > 0 && phase !== 'done' && (
            <div className="rounded-lg border border-border bg-background/60 p-2.5 max-h-36 overflow-y-auto scrollbar-thin space-y-0.5">
              {progress.map((line, i) => (
                <p key={i} className="text-[10px] font-mono text-muted-foreground">{line}</p>
              ))}
              {phase === 'running' && (
                <p className="text-[10px] font-mono text-primary flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> đang chạy…
                </p>
              )}
            </div>
          )}

          {/* Kết quả */}
          {result && phase === 'done' && (
            <div className="rounded-xl border border-border bg-background/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                {result.ok
                  ? <Check className="w-4 h-4 text-green-400" />
                  : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                <span className="text-xs font-semibold flex-1">
                  {result.ok
                    ? `Đã thêm ${createdIds.length} script vào card — tất cả qua compile + chạy thử.`
                    : 'AI không sửa nổi hết lỗi — KHÔNG ghi gì vào card (xem lỗi dưới).'}
                </span>
                {createdIds.length > 0 && (
                  <button onClick={handleUndo}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-amber-400 hover:bg-amber-500/10">
                    <Undo2 className="w-3 h-3" /> Hoàn tác
                  </button>
                )}
              </div>
              {result.items.map((d) => (
                <div key={d.stepId} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-2.5 py-1.5 bg-muted/20 flex items-center gap-2">
                    <span className="text-[11px] font-medium truncate flex-1">{d.script.scriptName}</span>
                    <span className="text-[9px] text-muted-foreground">[{d.script.placement.join(',')}]{d.script.markdownOnly ? ' MD' : ''}</span>
                  </div>
                  <pre className="px-2.5 py-1.5 text-[9px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-20 overflow-y-auto scrollbar-thin">/{d.script.findRegex}/</pre>
                  {d.explanation && <p className="px-2.5 pb-1.5 text-[10px] text-muted-foreground">{d.explanation}</p>}
                </div>
              ))}
              {result.issues.length > 0 && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2 space-y-0.5 max-h-32 overflow-y-auto scrollbar-thin">
                  {result.issues.map((iss, i) => (
                    <p key={i} className="text-[9px] text-amber-400/80">
                      {iss.level === 'error' ? '🔴' : '🟡'} [{iss.code}] {iss.where ? `${iss.where}: ` : ''}{iss.message}
                    </p>
                  ))}
                </div>
              )}
              <button onClick={() => { setPhase('idle'); setPlan(null); setResult(null); setProgress([]); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-muted/30 text-muted-foreground hover:text-foreground">
                <RotateCcw className="w-3 h-3" /> Yêu cầu mới
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
