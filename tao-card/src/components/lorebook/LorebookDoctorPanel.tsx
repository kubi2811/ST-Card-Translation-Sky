/**
 * LorebookDoctorPanel — (bug 191) tab "Phân tích & Chất lượng" HỢP NHẤT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thay cho 2 tab cũ (Phân tích = thuần máy offline; Phân tích & Chất lượng = 3 panel xếp chồng,
 * AI chỉ báo không sửa). Luồng mới đúng yêu cầu user: MỘT nút quét (máy chạy trước, AI đọc hiểu
 * sau) → MỘT danh sách lỗi chung → mỗi lỗi có nút "Sửa bằng AI" (nút chữ, không icon) + nút sửa
 * cả loạt. Kèm mục "Sắp xếp order & config bằng AI": AI phân loại, máy áp bảng chuẩn worldbook,
 * user duyệt danh sách thay đổi rồi mới áp.
 */
import { useMemo, useRef, useState } from 'react';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useToastStore } from '../../store/toastStore';
import { usePersistedState } from '../../lib/usePersistedState';
import type { LorebookEntry } from '../../types';
import type { CardType } from '../../lib/worldbook/worldbookConfig';
import { CARD_TYPE_LABELS } from '../../lib/worldbook/worldbookConfig';
import {
  collectMachineFindings, runDoctorAiScan, aiFixEntry, type DoctorIssue,
} from '../../lib/ai/lorebookDoctor';
import { arrangeLorebook, type ArrangeResult } from '../../lib/ai/lorebookArranger';
import { runPool } from '../../lib/ai/storyToCard';
import { computePoolConcurrency } from '../../lib/ai/client';
import { t as ui, fmt } from '../../i18n';

const SEV_STYLE: Record<DoctorIssue['severity'], string> = {
  error: 'text-red-400 border-red-500/40 bg-red-500/10',
  warning: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  info: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
};

export function LorebookDoctorPanel() {
  const card = useCardStore(s => s.card);
  const updateEntry = useCardStore(s => s.updateEntry);
  const entries = useMemo(() => card.data.character_book?.entries ?? [], [card]);
  const settings = useSettingsStore();
  const profile = settings.profiles.find(p => p.id === settings.activeProfileId);
  const toast = useToastStore();

  const [cardType, setCardType] = usePersistedState<CardType>('ld.cardType', 'single');
  const [scanning, setScanning] = useState(false);
  const [prog, setProg] = useState<{ d: number; t: number } | null>(null);
  const [issues, setIssues] = useState<DoctorIssue[] | null>(null);
  /** Trạng thái sửa theo entryId. */
  const [fixState, setFixState] = useState<Record<number, 'fixing' | 'fixed' | 'failed'>>({});
  const [fixingAll, setFixingAll] = useState(false);

  const [arranging, setArranging] = useState(false);
  const [arrProg, setArrProg] = useState<{ d: number; t: number } | null>(null);
  const [arrange, setArrange] = useState<ArrangeResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const stop = () => abortRef.current?.abort();
  const isAbort = (e: unknown) => (e instanceof DOMException && e.name === 'AbortError')
    || (e instanceof Error && /abort|cancel/i.test(e.message));

  // ─── Quét lỗi: máy trước (hiện ngay), AI sau ───
  const runScan = async () => {
    if (entries.length === 0) { toast.error(ui.ldNoEntries); return; }
    abortRef.current = new AbortController();
    setScanning(true); setProg(null); setFixState({});
    try {
      const machine = await collectMachineFindings(entries, cardType);
      setIssues(machine); // máy xong là thấy ngay, không bắt chờ AI
      if (!profile?.apiKey) {
        toast.info(ui.ldMachineOnly);
        return;
      }
      const ai = await runDoctorAiScan(entries, machine, profile, settings.generationParams, {
        signal: abortRef.current.signal,
        onProgress: (d, t) => setProg({ d, t }),
      });
      setIssues([...machine, ...ai]);
      toast.success(fmt(ui.ldScanDone, { n: machine.length + ai.length }));
    } catch (e) {
      if (isAbort(e)) toast.info(ui.ldScanStopped);
      else toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false); setProg(null);
    }
  };

  // ─── Sửa bằng AI ───
  const issuesByEntry = useMemo(() => {
    const m = new Map<number, DoctorIssue[]>();
    for (const i of issues ?? []) {
      if (i.entryId == null) continue;
      const list = m.get(i.entryId) ?? [];
      list.push(i);
      m.set(i.entryId, list);
    }
    return m;
  }, [issues]);

  const fixEntry = async (entryId: number, signal?: AbortSignal): Promise<boolean> => {
    const entry = (useCardStore.getState().card.data.character_book?.entries ?? []).find(e => e.id === entryId);
    const list = issuesByEntry.get(entryId);
    if (!entry || !list?.length || !profile?.apiKey) return false;
    setFixState(s => ({ ...s, [entryId]: 'fixing' }));
    try {
      const patch = await aiFixEntry(entry, list, profile, settings.generationParams, signal);
      if (!patch) {
        setFixState(s => ({ ...s, [entryId]: 'failed' }));
        return false;
      }
      const upd: Partial<LorebookEntry> = { comment: patch.comment, keys: patch.keys, content: patch.content };
      if (patch.secondary_keys) upd.secondary_keys = patch.secondary_keys;
      updateEntry(entryId, upd);
      setFixState(s => ({ ...s, [entryId]: 'fixed' }));
      return true;
    } catch (e) {
      if (isAbort(e)) throw e;
      setFixState(s => ({ ...s, [entryId]: 'failed' }));
      return false;
    }
  };

  const fixOne = async (entryId: number) => {
    abortRef.current = new AbortController();
    try {
      const ok = await fixEntry(entryId, abortRef.current.signal);
      if (ok) toast.success(ui.ldFixApplied);
      else toast.error(ui.ldFixFail);
    } catch { toast.info(ui.ldScanStopped); }
  };

  const fixAll = async () => {
    if (!profile?.apiKey) return;
    const targets = [...issuesByEntry.keys()].filter(id => fixState[id] !== 'fixed');
    if (targets.length === 0) return;
    abortRef.current = new AbortController();
    setFixingAll(true);
    let ok = 0;
    try {
      const conc = Math.max(1, Math.min(computePoolConcurrency(profile), targets.length));
      await runPool(targets, conc, async (id) => {
        if (abortRef.current?.signal.aborted) return;
        if (await fixEntry(id, abortRef.current?.signal)) ok++;
      });
      toast.success(fmt(ui.ldFixAllDone, { ok, total: targets.length }));
    } catch { toast.info(ui.ldScanStopped); }
    finally { setFixingAll(false); }
  };

  // ─── Sắp xếp order & config bằng AI ───
  const runArrange = async () => {
    if (!profile?.apiKey) { toast.error(ui.wsNoProfile); return; }
    if (entries.length === 0) { toast.error(ui.ldNoEntries); return; }
    abortRef.current = new AbortController();
    setArranging(true); setArrange(null); setArrProg(null);
    try {
      const res = await arrangeLorebook(entries, profile, settings.generationParams, {
        signal: abortRef.current.signal,
        onProgress: (d, t) => setArrProg({ d, t }),
      });
      setArrange(res);
      if (res.changes.length === 0) toast.success(ui.ldArrangeNoChange);
    } catch (e) {
      if (isAbort(e)) toast.info(ui.ldScanStopped);
      else toast.error(e instanceof Error ? e.message : String(e));
    } finally { setArranging(false); setArrProg(null); }
  };

  const applyArrange = () => {
    if (!arrange) return;
    for (const ch of arrange.changes) {
      const cur = (useCardStore.getState().card.data.character_book?.entries ?? []).find(e => e.id === ch.id);
      if (!cur) continue;
      updateEntry(ch.id, {
        constant: ch.patch.constant,
        selective: ch.patch.selective,
        insertion_order: ch.patch.insertion_order,
        position: ch.patch.position,
        extensions: {
          ...cur.extensions,
          position: ch.patch.ext.position,
          depth: ch.patch.ext.depth,
          role: ch.patch.ext.role,
        },
      });
    }
    toast.success(fmt(ui.ldArrangeApplied, { n: arrange.changes.length }));
    setArrange(null);
  };

  const sevCount = (sev: DoctorIssue['severity']) => (issues ?? []).filter(i => i.severity === sev).length;

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      {/* ─── Khối quét lỗi ─── */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{ui.ldTitle}</h3>
          <p className="text-xs text-muted-foreground mt-1">{ui.ldDesc}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs flex items-center gap-1.5">{ui.ldCardType}
            <select value={cardType} onChange={e => setCardType(e.target.value as CardType)}
              className="settings-input w-auto text-xs py-1" disabled={scanning}>
              {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map(t =>
                <option key={t} value={t}>{CARD_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          {!scanning ? (
            <button onClick={() => void runScan()}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-white"
              style={{ background: '#7c6af0', border: 'none', cursor: 'pointer' }}>
              {ui.ldScanBtn}
            </button>
          ) : (
            <button onClick={stop}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-white"
              style={{ background: '#f59e0b', border: 'none', cursor: 'pointer' }}>
              {ui.ldStop}{prog ? ` (${prog.d}/${prog.t})` : '…'}
            </button>
          )}
          {issues && issuesByEntry.size > 0 && profile?.apiKey && (
            <button onClick={() => void fixAll()} disabled={fixingAll || scanning}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: '#22c55e', border: 'none', cursor: 'pointer' }}>
              {fixingAll ? ui.ldFixing : fmt(ui.ldFixAllBtn, { n: issuesByEntry.size })}
            </button>
          )}
        </div>

        {issues && (
          <div className="text-xs text-muted-foreground">
            {fmt(ui.ldIssueCount, { total: issues.length, err: sevCount('error'), warn: sevCount('warning'), info: sevCount('info') })}
          </div>
        )}

        {issues && issues.length === 0 && (
          <div className="text-xs text-green-400">{ui.ldNoIssues}</div>
        )}

        {issues && issues.length > 0 && (
          <ul className="space-y-1.5" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {issues.map(i => {
              const state = i.entryId != null ? fixState[i.entryId] : undefined;
              return (
                <li key={i.key} className={`rounded-lg border p-2 text-xs flex items-start gap-2 ${state === 'fixed' ? 'opacity-50' : ''} border-border/60`}>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] shrink-0 ${SEV_STYLE[i.severity]}`}>
                    {i.severity === 'error' ? ui.ldSevError : i.severity === 'warning' ? ui.ldSevWarning : ui.ldSevInfo}
                  </span>
                  <span className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground shrink-0">
                    {i.source === 'machine' ? ui.ldSrcMachine : ui.ldSrcAi}
                  </span>
                  <div className="flex-1 min-w-0">
                    {i.comment && <div className="font-semibold truncate">{i.comment}</div>}
                    <div className="text-muted-foreground">{i.issue}</div>
                    {i.suggestion && <div className="text-sky-400/80 mt-0.5">→ {i.suggestion}</div>}
                  </div>
                  {i.entryId != null && profile?.apiKey && (
                    <button onClick={() => void fixOne(i.entryId!)}
                      disabled={state === 'fixing' || state === 'fixed' || fixingAll || scanning}
                      className="shrink-0 px-2 py-1 rounded border border-green-500/50 text-green-400 hover:bg-green-500/10 disabled:opacity-50 text-[11px]"
                      style={{ background: 'transparent', cursor: 'pointer' }}>
                      {state === 'fixing' ? ui.ldFixing : state === 'fixed' ? ui.ldFixed : state === 'failed' ? ui.ldFixRetry : ui.ldFixBtn}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ─── Khối sắp xếp order & config ─── */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{ui.ldArrangeTitle}</h3>
          <p className="text-xs text-muted-foreground mt-1">{ui.ldArrangeDesc}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!arranging ? (
            <button onClick={() => void runArrange()} disabled={scanning || fixingAll}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: '#7c6af0', border: 'none', cursor: 'pointer' }}>
              {ui.ldArrangeBtn}
            </button>
          ) : (
            <button onClick={stop}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-white"
              style={{ background: '#f59e0b', border: 'none', cursor: 'pointer' }}>
              {ui.ldStop}{arrProg ? ` (${arrProg.d}/${arrProg.t})` : '…'}
            </button>
          )}
          {arrange && arrange.changes.length > 0 && (
            <>
              <button onClick={applyArrange}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white"
                style={{ background: '#22c55e', border: 'none', cursor: 'pointer' }}>
                {fmt(ui.ldArrangeApply, { n: arrange.changes.length })}
              </button>
              <button onClick={() => setArrange(null)}
                className="px-3 py-1.5 rounded-md text-xs border border-border"
                style={{ background: 'transparent', cursor: 'pointer' }}>
                {ui.ldArrangeCancel}
              </button>
            </>
          )}
        </div>
        {arrange && (
          <div className="text-xs text-muted-foreground">
            {fmt(ui.ldArrangeSummary, { changes: arrange.changes.length, ok: arrange.okCount, skip: arrange.skipped.length })}
            {arrange.unclassified.length > 0 && ` · ${fmt(ui.ldArrangeUnclassified, { n: arrange.unclassified.length })}`}
          </div>
        )}
        {arrange && arrange.changes.length > 0 && (
          <ul className="space-y-1 text-xs" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {arrange.changes.map(ch => (
              <li key={ch.id} className="rounded border border-border/60 p-2">
                <span className="font-semibold">{ch.comment}</span>
                <span className="text-muted-foreground"> [{ch.cat}] — {ch.diffs.join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
