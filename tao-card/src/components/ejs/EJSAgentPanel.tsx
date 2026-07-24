/**
 * EJSAgentPanel — (Goal 101.2) Chế độ MẶC ĐỊNH của EJS Studio: AI tự quyết.
 * ─────────────────────────────────────────────────────────────────────────────
 * User gõ MỘT yêu cầu → agent lên kế hoạch (mấy khối EJS, mỗi khối làm gì, tốn mấy call)
 * → user duyệt → chạy → mọi code qua kiểm tự động (cú pháp + biến bám schema) + tự sửa
 * hội tụ → entry được tạo thẳng vào worldbook, có Hoàn tác. Studio 3 panel cũ vẫn còn
 * nguyên trong chế độ "Nâng cao".
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Bot, Loader2, Play, X, Undo2, AlertTriangle, Check, BookPlus,
  ListChecks, Square, RotateCcw,
} from 'lucide-react';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { ChatMessage, LorebookEntry } from '../../types';
import { DEFAULT_ENTRY_EXT } from '../../types/lorebook.types';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import { nextEntryId } from '../../lib/converters/cardDefaults';
import {
  planGoal, executeGoalPlan,
  type AgentCallFn, type AgentPlan, type GoalRunResult,
} from '../../lib/ai/goalAgent';
import { createEjsDomain, type EjsDraft } from '../../lib/ejs/ejsAgent';

type Phase = 'idle' | 'planning' | 'review' | 'running' | 'done';

interface UndoInfo {
  createdEntryIds: number[];
  disabledEntries: Map<number, boolean>;
}

interface EJSAgentPanelProps {
  schema: MVUZODSchema | null;
  /** Mở tab Nâng cao + nạp code vào editor để user chỉnh tay tiếp. */
  onOpenInEditor?: (code: string) => void;
}

export function EJSAgentPanel({ schema, onOpenInEditor }: EJSAgentPanelProps) {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const entries = useMemo(() => card.data.character_book?.entries ?? [], [card.data.character_book?.entries]);
  const characterName = card.data.name || 'Character';

  const [goal, setGoal] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<GoalRunResult<EjsDraft> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoInfo, setUndoInfo] = useState<UndoInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Adapter callAI thật → AgentCallFn của khung goalAgent.
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
          useJsonResponseFormat: true,
          stream: false,
        },
        messages,
        signal,
        label: opts?.label ?? 'EJS Agent',
      });
      return res.text;
    };
  }, []);

  const domain = useMemo(
    () => createEjsDomain({ schema, entries, characterName }),
    [schema, entries, characterName],
  );

  // ─── Pha 1: lên kế hoạch ───
  const handlePlan = useCallback(async () => {
    setPhase('planning');
    setError(null);
    setPlan(null);
    setResult(null);
    setProgress([]);
    setUndoInfo(null);
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

  // ─── Pha 2: chạy sau duyệt ───
  const handleRun = useCallback(async () => {
    if (!plan) return;
    setPhase('running');
    setError(null);
    setProgress([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await executeGoalPlan(plan, domain, makeCall(ac.signal), {
        signal: ac.signal,
        onProgress: (ev) => setProgress(prev => [...prev, ev.text]),
      });
      setResult(r);

      // Áp kết quả vào card: tạo entry EJS + áp entryActions (disable), có snapshot hoàn tác.
      const createdIds: number[] = [];
      const disabled = new Map<number, boolean>();
      if (r.items.length && r.ok) {
        const state = useCardStore.getState();
        let curEntries = state.card.data.character_book?.entries ?? [];
        for (const d of r.items) {
          const newId = nextEntryId(curEntries);
          const newEntry: LorebookEntry = {
            id: newId,
            keys: ['@@ejs'],
            secondary_keys: [],
            comment: d.entryComment,
            content: d.code,
            constant: true,
            selective: false,
            insertion_order: 100,
            enabled: true,
            position: 'before_char',
            use_regex: false,
            extensions: {
              ...DEFAULT_ENTRY_EXT,
              position: 4, depth: 4, display_index: newId,
              exclude_recursion: true, prevent_recursion: true,
            },
          };
          addEntry(newEntry);
          createdIds.push(newId);
          curEntries = [...curEntries, newEntry];

          // Strategy getwi: entry được load động phải TẮT sẵn trong worldbook.
          for (const action of d.entryActions) {
            if (action.action !== 'disable') continue;
            const target = curEntries.find(e => e.comment === action.comment);
            if (target && !disabled.has(target.id)) {
              disabled.set(target.id, target.enabled);
              useCardStore.getState().updateEntry(target.id, { enabled: false });
            }
          }
        }
        setUndoInfo({ createdEntryIds: createdIds, disabledEntries: disabled });
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
  }, [plan, domain, makeCall, addEntry]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleUndo = useCallback(() => {
    if (!undoInfo) return;
    const st = useCardStore.getState();
    for (const id of undoInfo.createdEntryIds) st.deleteEntry(id);
    for (const [id, wasEnabled] of undoInfo.disabledEntries) st.updateEntry(id, { enabled: wasEnabled });
    setUndoInfo(null);
    setResult(null);
    setPhase('review');
    setProgress(prev => [...prev, '↩️ Đã hoàn tác: xoá entry vừa tạo + bật lại entry bị tắt.']);
  }, [undoInfo]);

  const handleReset = useCallback(() => {
    setPhase('idle'); setPlan(null); setResult(null); setError(null);
    setProgress([]); setUndoInfo(null);
  }, []);

  const busy = phase === 'planning' || phase === 'running';

  return (
    <div className="max-w-2xl mx-auto space-y-4 p-4">
      {/* Ô yêu cầu */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold">Bạn muốn EJS làm gì?</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mô tả bằng lời thường — AI tự quyết cần mấy khối EJS, đặt entry nào, rồi trình kế hoạch
          cho bạn duyệt trước khi chạy. Mọi code sinh ra đều qua kiểm tự động (cú pháp + biến phải
          có trong MVUZOD schema) và tự sửa nếu lỗi.
        </p>
        <textarea
          value={goal}
          onChange={e => setGoal(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder={'Ví dụ: "Làm bộ điều khiển bật/tắt entry theo Cảnh Giới của người chơi — Luyện Khí thì chỉ hiện entry cơ bản, Kim Đan trở lên mở thêm bí cảnh."'}
          className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-emerald-500/30 resize-y placeholder:text-muted-foreground/40"
        />
        <div className="flex gap-2">
          <button
            onClick={handlePlan}
            disabled={busy || !goal.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
              bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
              text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
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
        {!schema && (
          <p className="text-[10px] text-amber-400/90">
            ⚠️ Card chưa có MVUZOD schema — code vẫn sinh được nhưng không kiểm chéo được biến.
            Nên tạo schema ở tab MVUZOD trước để agent bám đúng biến.
          </p>
        )}
      </div>

      {/* Lỗi */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Kế hoạch chờ duyệt */}
      {plan && phase !== 'idle' && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Kế hoạch của AI</span>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              ~{plan.estCalls} call AI (+ tối đa 3 vòng sửa nếu lỗi)
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{plan.scope}</p>
          <ol className="space-y-1.5">
            {plan.steps.map((s, i) => (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted/40 flex items-center justify-center text-[10px] font-semibold">{i + 1}</span>
                <div>
                  <span className="font-medium">{s.title}</span>
                  {s.detail && <p className="text-[10px] text-muted-foreground">{s.detail}</p>}
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
              <button onClick={handleRun}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                  bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
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

      {/* Tiến trình */}
      {progress.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3 max-h-44 overflow-y-auto scrollbar-thin space-y-1">
          {progress.map((line, i) => (
            <p key={i} className="text-[10px] font-mono text-muted-foreground">{line}</p>
          ))}
          {phase === 'running' && (
            <p className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> đang chạy…
            </p>
          )}
        </div>
      )}

      {/* Kết quả */}
      {result && phase === 'done' && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            {result.ok
              ? <Check className="w-4 h-4 text-green-400" />
              : <AlertTriangle className="w-4 h-4 text-amber-400" />}
            <span className="text-sm font-semibold">
              {result.ok ? 'Hoàn thành — đã tạo entry vào worldbook' : 'Xong nhưng còn lỗi chưa tự sửa được'}
            </span>
            {undoInfo && (
              <button onClick={handleUndo}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-amber-400 hover:bg-amber-500/10 transition-colors">
                <Undo2 className="w-3 h-3" /> Hoàn tác tất cả
              </button>
            )}
          </div>

          {result.items.map((d) => (
            <div key={d.stepId + d.entryComment} className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex items-center gap-2">
                <BookPlus className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-[11px] font-medium truncate flex-1">{d.entryComment}</span>
                <span className="text-[9px] text-muted-foreground">{d.strategy}</span>
                {onOpenInEditor && (
                  <button onClick={() => onOpenInEditor(d.code)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                    Mở editor
                  </button>
                )}
              </div>
              {d.explanation && <p className="px-3 py-1.5 text-[10px] text-muted-foreground">{d.explanation}</p>}
              <pre className="px-3 py-2 text-[9px] font-mono leading-relaxed overflow-x-auto max-h-40 overflow-y-auto scrollbar-thin bg-background/50">
                {d.code}
              </pre>
            </div>
          ))}

          {result.issues.length > 0 && (
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5 space-y-1">
              <p className="text-[10px] font-medium text-amber-400">Kiểm tự động còn ghi nhận:</p>
              {result.issues.map((iss, i) => (
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
