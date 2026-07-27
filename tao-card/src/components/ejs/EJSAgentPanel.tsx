/**
 * EJSAgentPanel — (Goal 101.2) Chế độ MẶC ĐỊNH của EJS Studio: AI tự quyết.
 * ─────────────────────────────────────────────────────────────────────────────
 * User gõ MỘT yêu cầu → agent lên kế hoạch → user duyệt → chạy → mọi code qua kiểm tự động
 * + tự sửa hội tụ → entry được tạo thẳng vào worldbook, có Hoàn tác. Studio 3 panel cũ vẫn
 * còn nguyên trong chế độ "Nâng cao".
 *
 * ═══ (bug 126) ĐẠI TU ═══
 * User test rồi báo kế hoạch "khá sơ sài và không thực hiện được tất cả yêu cầu". Bản cũ chỉ
 * hiện `scope` (vài câu) + danh sách bước, nên user chỉ duyệt được CẢ CỤC. Nay:
 *   • BẢNG KẾ HOẠCH từng dòng: đối tượng, chế độ kích hoạt hiện tại (MÁY đo từ card, không
 *     phải AI khai), đề xuất, lý do — và nút Đồng ý / Từ chối RIÊNG từng dòng.
 *   • Dòng chỉ đổi chế độ kích hoạt được máy áp thẳng, KHÔNG tốn call AI nào.
 *   • Preset Nhanh cho người mới, mỗi cái nêu công dụng và tự bám ngữ cảnh card thật.
 *   • State nằm ở store nên đổi tab không mất kế hoạch (lên kế hoạch = một call tính tiền),
 *     kèm nút "Làm lại từ đầu" khi user muốn xoá sạch.
 *   • Nút áp chính sách sang Auto Creator, chỉ bật khi card đã tạo xong.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Bot, Loader2, Play, Undo2, AlertTriangle, Check, X, BookPlus,
  ListChecks, Square, RotateCcw, Wand2, Info, ArrowRight,
} from 'lucide-react';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { ChatMessage, LorebookEntry } from '../../types';
import { DEFAULT_ENTRY_EXT } from '../../types/lorebook.types';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useToastStore } from '../../store/toastStore';
import { useAutoCreatorStore } from '../../store/autoCreatorStore';
import { useEjsStudioStore } from '../../store/ejsStudioStore';
import { callAI } from '../../lib/ai/client';
import { nextEntryId } from '../../lib/converters/cardDefaults';
import { executeGoalPlan, type AgentCallFn, type GoalRunResult } from '../../lib/ai/goalAgent';
import {
  createEjsDomain, planEjsRich, buildAgentPlanFromRows,
  type EjsDraft, type EjsAgentContext,
} from '../../lib/ejs/ejsAgent';
import { ACTIVATION_LABEL, findOrphanConditionalEntries, type EjsPlanRow } from '../../lib/ejs/ejsPlanModel';
import { QUICK_PRESETS } from '../../lib/ejs/ejsQuickPresets';
import { buildEjsPolicy, isCardReadyForPolicy } from '../../lib/ejs/ejsPolicy';

interface EJSAgentPanelProps {
  schema: MVUZODSchema | null;
  /** Mở tab Nâng cao + nạp code vào editor để user chỉnh tay tiếp. */
  onOpenInEditor?: (code: string) => void;
}

const ACTION_LABEL: Record<EjsPlanRow['action'], string> = {
  create_ejs: 'Tạo khối EJS',
  reclassify: 'Đổi chế độ kích hoạt',
  edit_content: 'Sửa nội dung',
  edit_character: 'Sửa Character Definition',
};

export function EJSAgentPanel({ schema, onOpenInEditor }: EJSAgentPanelProps) {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const entries = useMemo(() => card.data.character_book?.entries ?? [], [card.data.character_book?.entries]);
  const characterName = card.data.name || 'Character';

  const st = useEjsStudioStore();
  const abortRef = useRef<AbortController | null>(null);

  // Đổi card → kế hoạch cũ trỏ vào entry của card khác nên phải bỏ (xem ejsStudioStore).
  const cardKey = card.data.name || '(chưa đặt tên)';
  const ensureCard = st.ensureCard;
  useEffect(() => { ensureCard(cardKey); }, [cardKey, ensureCard]);

  const ctx = useMemo<EjsAgentContext>(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown> | undefined;
    const regexScripts = (ext?.regex_scripts as Array<{ scriptName?: string; replaceString?: string }>) ?? [];
    const th = ext?.tavern_helper as { scripts?: Array<{ name?: string; content?: string }> } | undefined;
    return {
      schema, entries, characterName,
      characterFields: {
        description: card.data.description,
        personality: card.data.personality,
        scenario: card.data.scenario,
        first_mes: card.data.first_mes,
      },
      regexScripts,
      tavernScripts: th?.scripts ?? [],
    };
  }, [schema, entries, characterName, card.data]);

  const domain = useMemo(() => createEjsDomain(ctx), [ctx]);

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
        messages, signal, label: opts?.label ?? 'EJS Agent',
      });
      return res.text;
    };
  }, []);

  // Preset Nhanh — dựng lại theo ngữ cảnh card thật mỗi khi card đổi.
  const presets = useMemo(
    () => QUICK_PRESETS.map(p => ({
      preset: p,
      built: p.build({ schema, entries, regexScripts: ctx.regexScripts, tavernScripts: ctx.tavernScripts }),
    })),
    [schema, entries, ctx.regexScripts, ctx.tavernScripts],
  );

  // ─── Pha 1: lên kế hoạch ───
  const handlePlan = useCallback(async () => {
    const s = useEjsStudioStore.getState();
    s.setPhase('planning');
    s.setError(null);
    s.setProgress([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const p = await planEjsRich(s.goal, ctx, makeCall(ac.signal), ac.signal);
      s.setPlan(p, cardKey);
      s.setPhase('review');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { s.setPhase('idle'); return; }
      s.setError(e instanceof Error ? e.message : String(e));
      s.setPhase('idle');
    }
  }, [ctx, makeCall, cardKey]);

  // ─── Pha 2: chạy các dòng ĐÃ DUYỆT ───
  const handleRun = useCallback(async () => {
    const s = useEjsStudioStore.getState();
    const plan = s.plan;
    if (!plan) return;
    const accepted = s.acceptedIds();
    s.setPhase('running');
    s.setError(null);
    s.setProgress([]);
    const ac = new AbortController();
    abortRef.current = ac;

    // Snapshot hoàn tác — chụp TRƯỚC khi đụng vào bất cứ thứ gì, kể cả khi chạy dở bị dừng.
    const changed: Array<{ id: number; enabled: boolean; constant: boolean; keys: string[] }> = [];
    const createdIds: number[] = [];
    const snap = (e: LorebookEntry) => {
      if (changed.some(c => c.id === e.id)) return;
      changed.push({ id: e.id, enabled: e.enabled, constant: e.constant, keys: [...(e.keys ?? [])] });
    };

    try {
      // 2a. Dòng "đổi chế độ kích hoạt" là thao tác CẤU HÌNH thuần — máy làm thẳng, 0 call AI.
      const byName = new Map(entries.map(e => [String(e.comment || `#${e.id}`).trim().toLowerCase(), e]));
      let reclassified = 0;
      for (const r of plan.rows) {
        if (!accepted.has(r.id) || r.action !== 'reclassify' || r.target !== 'lorebook') continue;
        const target = byName.get(r.name.trim().toLowerCase());
        if (!target || !r.proposedMode) continue;
        snap(target);
        // 'conditional' = entry TẮT sẵn, chờ controller EJS gọi activewi bật lên (xem stptApi).
        const patch =
          r.proposedMode === 'constant' ? { constant: true, enabled: true }
          : r.proposedMode === 'keyword' ? { constant: false, enabled: true }
          : r.proposedMode === 'conditional' ? { constant: false, enabled: false }
          : { enabled: false };
        useCardStore.getState().updateEntry(target.id, patch);
        reclassified++;
        s.pushProgress(`⚙️ "${r.name}" → ${ACTIVATION_LABEL[r.proposedMode]}`);
      }
      if (reclassified) s.pushProgress(`✅ Đổi chế độ kích hoạt cho ${reclassified} entry (không tốn call AI).`);

      // 2b. Dòng cần sinh code → khung goalAgent (kiểm + tự sửa hội tụ).
      const agentPlan = buildAgentPlanFromRows(plan, accepted);
      if (agentPlan.steps.length) {
        const r: GoalRunResult<EjsDraft> = await executeGoalPlan(agentPlan, domain, makeCall(ac.signal), {
          signal: ac.signal,
          onProgress: (ev) => useEjsStudioStore.getState().pushProgress(ev.text),
        });
        s.setDrafts(r.items);

        if (r.items.length && r.ok) {
          let cur = useCardStore.getState().card.data.character_book?.entries ?? [];
          for (const d of r.items) {
            const newId = nextEntryId(cur);
            const newEntry: LorebookEntry = {
              id: newId, keys: ['@@ejs'], secondary_keys: [], comment: d.entryComment,
              content: d.code, constant: true, selective: false, insertion_order: 100,
              enabled: true, position: 'before_char', use_regex: false,
              extensions: {
                ...DEFAULT_ENTRY_EXT, position: 4, depth: 4, display_index: newId,
                exclude_recursion: true, prevent_recursion: true,
              },
            };
            addEntry(newEntry);
            createdIds.push(newId);
            cur = [...cur, newEntry];

            for (const action of d.entryActions) {
              if (action.action !== 'disable') continue;
              const target = cur.find(e => e.comment === action.comment);
              if (target) {
                snap(target);
                useCardStore.getState().updateEntry(target.id, { enabled: false });
              }
            }
          }
        }
        if (!r.ok) {
          s.pushProgress('⚠️ Còn lỗi chưa tự sửa được — xem danh sách bên dưới, entry KHÔNG được ghi vào card.');
        }
      } else if (!reclassified) {
        s.pushProgress('⚠️ Không có mục nào được duyệt — không có gì để chạy.');
      }

      // (bug 127) Chốt cuối: entry vừa bị TẮT để "kích hoạt theo điều kiện" mà không controller
      // nào gọi activewi cho nó thì nó chết hẳn — lore biến mất khỏi mọi lượt chat mà không có
      // lỗi đỏ nào. Đây là mâu thuẫn nội bộ của chính cơ chế phân loại, phải nói thẳng ra.
      const orphans = findOrphanConditionalEntries(
        plan.rows.filter(r => accepted.has(r.id)),
        useEjsStudioStore.getState().drafts.map(d => d.code),
      );
      if (orphans.length) {
        s.pushProgress(
          `⚠️ ${orphans.length} entry đã bị tắt để chờ điều kiện nhưng CHƯA có khối EJS nào bật chúng lên: ` +
          `${orphans.join(', ')}. Chúng sẽ không bao giờ xuất hiện — hãy bấm Hoàn tác, hoặc chạy thêm một ` +
          `lượt yêu cầu AI tạo controller bật đúng các entry này.`,
        );
      }

      s.setUndo({ createdEntryIds: createdIds, changedEntries: changed });
      s.setPhase('done');
    } catch (e) {
      // Dừng giữa chừng vẫn phải giữ snapshot, nếu không user mất đường lùi.
      s.setUndo({ createdEntryIds: createdIds, changedEntries: changed });
      if (e instanceof DOMException && e.name === 'AbortError') {
        s.pushProgress('⏹ Đã dừng theo yêu cầu.');
        s.setPhase('review');
        return;
      }
      s.setError(e instanceof Error ? e.message : String(e));
      s.setPhase('review');
    }
  }, [domain, makeCall, addEntry, entries]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleUndo = useCallback(() => {
    const s = useEjsStudioStore.getState();
    const u = s.undo;
    if (!u) return;
    const cs = useCardStore.getState();
    for (const id of u.createdEntryIds) cs.deleteEntry(id);
    for (const c of u.changedEntries) cs.updateEntry(c.id, { enabled: c.enabled, constant: c.constant, keys: c.keys });
    s.setUndo(null);
    s.resetRunOnly();
    s.pushProgress('↩️ Đã hoàn tác: xoá entry vừa tạo + trả entry bị đổi về trạng thái cũ.');
  }, []);

  // ─── Áp chính sách sang Auto Creator ───
  const readiness = useMemo(() => isCardReadyForPolicy(card), [card]);
  const handleApplyToAutoCreator = useCallback(() => {
    const s = useEjsStudioStore.getState();
    if (!s.plan) return;
    const policy = buildEjsPolicy(s.plan, s.acceptedIds(), characterName, s.goal, new Date().toISOString());
    if (!policy.directive.trim()) {
      useToastStore.getState().error('Kế hoạch chưa có mục nào đủ dữ kiện để rút thành chính sách.');
      return;
    }
    useAutoCreatorStore.getState().applyEjsPolicy(policy);
    useToastStore.getState().success(`Đã áp ${policy.rowCount} mục sang Auto Creator — mở tab Auto Creator sẽ thấy thông báo.`);
  }, [characterName]);

  const busy = st.phase === 'planning' || st.phase === 'running';
  const rows = st.plan?.rows ?? [];
  const acceptedCount = rows.filter(r => st.decisions[r.id] !== 'rejected').length;

  return (
    <div className="max-w-4xl mx-auto space-y-4 p-4">
      {/* ═══ Ô yêu cầu + Preset Nhanh ═══ */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold">Bạn muốn EJS làm gì?</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mô tả bằng lời thường — AI tự quyết cần làm những gì, rồi trình <b>bảng kế hoạch từng mục</b> để
          bạn duyệt hoặc từ chối riêng từng mục trước khi chạy. Chưa quen EJS thì bấm một Preset Nhanh bên dưới.
        </p>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Preset nhanh</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {presets.map(({ preset, built }) => {
              const blocked = built.blockers.length > 0;
              return (
                <button
                  key={preset.id}
                  disabled={busy || blocked}
                  onClick={() => st.setGoal(built.goal)}
                  title={blocked ? built.blockers.join('\n') : built.notes.join('\n')}
                  className={`text-left p-2 rounded-lg border transition-colors ${
                    blocked
                      ? 'border-border/40 bg-muted/10 opacity-50 cursor-not-allowed'
                      : 'border-border hover:border-emerald-500/40 hover:bg-emerald-500/5'
                  }`}
                >
                  <div className="text-xs font-medium flex items-center gap-1.5">
                    <span>{preset.icon}</span>{preset.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{preset.effect}</div>
                  {blocked
                    ? <div className="text-[10px] text-amber-400/90 mt-1">⚠️ {built.blockers[0]}</div>
                    : built.notes[0] ? <div className="text-[10px] text-sky-400/80 mt-1">ℹ️ {built.notes[0]}</div> : null}
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          value={st.goal}
          onChange={e => st.setGoal(e.target.value)}
          disabled={busy}
          rows={4}
          placeholder={'Ví dụ: "Làm bộ điều khiển bật/tắt entry theo Cảnh Giới của người chơi — Luyện Khí thì chỉ hiện entry cơ bản, Kim Đan trở lên mở thêm bí cảnh."'}
          className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-emerald-500/30 resize-y placeholder:text-muted-foreground/40"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handlePlan}
            disabled={busy || !st.goal.trim()}
            className="flex-1 min-w-[180px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
              bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
              text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {st.phase === 'planning'
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang lên kế hoạch…</>
              : <><ListChecks className="w-3.5 h-3.5" /> Lên kế hoạch</>}
          </button>
          {busy && (
            <button onClick={handleStop}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
              <Square className="w-3 h-3" /> Dừng
            </button>
          )}
          {(st.plan || st.goal) && !busy && (
            <button onClick={st.reset}
              title="Xoá kế hoạch và ô yêu cầu, làm lại từ đầu"
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors">
              <RotateCcw className="w-3 h-3" /> Làm lại từ đầu
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

      {st.error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{st.error}</p>
        </div>
      )}

      {/* ═══ Bảng kế hoạch — duyệt từng dòng ═══ */}
      {st.plan && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Kế hoạch — {rows.length} mục</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  ~{st.plan.estCalls} call AI
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{st.plan.scope}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => st.setAllDecisions('accepted')}
                className="px-2 py-1 rounded text-[10px] border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                Chọn hết
              </button>
              <button onClick={() => st.setAllDecisions('rejected')}
                className="px-2 py-1 rounded text-[10px] border border-border text-muted-foreground hover:bg-muted transition-colors">
                Bỏ hết
              </button>
            </div>
          </div>

          {st.plan.warnings.map((w, i) => (
            <div key={`w${i}`} className="text-[11px] text-amber-400/90 flex gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {w}
            </div>
          ))}
          {st.plan.notes.map((n, i) => (
            <div key={`n${i}`} className="text-[11px] text-sky-400/80 flex gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> {n}
            </div>
          ))}

          <div className="space-y-1.5">
            {rows.map(r => {
              const rejected = st.decisions[r.id] === 'rejected';
              return (
                <div key={r.id}
                  className={`rounded-lg border p-2.5 transition-colors ${
                    rejected ? 'border-border/40 bg-muted/10 opacity-50' : 'border-border bg-background/60'
                  }`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/15 text-purple-300">
                          {ACTION_LABEL[r.action]}
                        </span>
                        {r.target === 'character' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-500/15 text-orange-300">
                            Character Definition
                          </span>
                        )}
                        <span className="text-xs font-medium truncate">{r.name}</span>
                      </div>

                      {(r.currentMode || r.proposedMode) && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span className="text-muted-foreground">
                            {r.currentMode ? ACTIVATION_LABEL[r.currentMode] : '(entry mới)'}
                          </span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground/60" />
                          <span className="text-emerald-400">
                            {r.proposedMode ? ACTIVATION_LABEL[r.proposedMode] : 'giữ nguyên'}
                          </span>
                          {r.tokensSaved ? (
                            <span className="text-amber-400/80">· tiết kiệm ~{r.tokensSaved} token/lượt</span>
                          ) : null}
                        </div>
                      )}

                      <div className="text-[11px]">{r.proposal}</div>
                      <div className="text-[10px] text-muted-foreground">Lý do: {r.reason}</div>
                    </div>

                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={() => st.setDecision(r.id, 'accepted')} title="Đồng ý mục này"
                        className={`p-1.5 rounded border transition-colors ${
                          !rejected ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                                    : 'border-border text-muted-foreground hover:bg-muted'
                        }`}>
                        <Check className="w-3 h-3" />
                      </button>
                      <button onClick={() => st.setDecision(r.id, 'rejected')} title="Từ chối mục này"
                        className={`p-1.5 rounded border transition-colors ${
                          rejected ? 'border-red-500/50 bg-red-500/15 text-red-400'
                                   : 'border-border text-muted-foreground hover:bg-muted'
                        }`}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="text-xs text-muted-foreground py-4 text-center">
                AI không đưa ra mục nào. Thử diễn đạt yêu cầu cụ thể hơn, hoặc bấm một Preset Nhanh.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={handleRun}
              disabled={busy || acceptedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium
                bg-primary text-primary-foreground hover:bg-primary/90
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {st.phase === 'running'
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang chạy…</>
                : <><Play className="w-3.5 h-3.5" /> Chạy {acceptedCount}/{rows.length} mục đã duyệt</>}
            </button>

            <button
              onClick={handleApplyToAutoCreator}
              disabled={!readiness.ready || rows.length === 0}
              title={readiness.ready
                ? 'Rút kế hoạch này thành chính sách để Auto Creator làm theo khi tạo card mới'
                : `Card chưa tạo xong — còn thiếu: ${readiness.missing.join(', ')}`}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border
                border-purple-500/50 bg-purple-600/15 text-purple-300 hover:bg-purple-600/25
                disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Wand2 className="w-3.5 h-3.5" /> Áp dụng sang Auto Creator
            </button>
          </div>
          {!readiness.ready && (
            <p className="text-[10px] text-muted-foreground">
              Nút áp dụng sang Auto Creator chỉ bật khi card đã tạo xong — hiện còn thiếu: {readiness.missing.join(', ')}.
            </p>
          )}
        </div>
      )}

      {/* ═══ Tiến trình ═══ */}
      {st.progress.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3 max-h-52 overflow-y-auto scrollbar-thin space-y-1">
          {st.progress.map((line, i) => (
            <p key={i} className="text-[10px] font-mono text-muted-foreground">{line}</p>
          ))}
          {st.phase === 'running' && (
            <p className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> đang chạy…
            </p>
          )}
        </div>
      )}

      {/* ═══ Kết quả ═══ */}
      {st.phase === 'done' && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold">Hoàn thành</span>
            {st.undo && (
              <button onClick={handleUndo}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-amber-400 hover:bg-amber-500/10 transition-colors">
                <Undo2 className="w-3 h-3" /> Hoàn tác tất cả
              </button>
            )}
          </div>

          {st.drafts.map(d => (
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
        </div>
      )}
    </div>
  );
}
