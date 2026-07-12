/**
 * QualityHubPanel — "Phân tích & Chất lượng" (gộp bug #7)
 *
 * Gộp 3 lớp kiểm tra vào MỘT chỗ (trước đây rải 2 nơi: tab Chất lượng + panel Sức khoẻ trong
 * tab Entries):
 *   1. 🤖 AI QUÉT LỖI — đọc hiểu để bắt mâu thuẫn / phi logic / entry sơ sài / keys lệch.
 *   2. 🩺 Sức khoẻ cấu hình (hàm) — WorldbookHealthPanel.
 *   3. 🛡️ Chất lượng nội dung (hàm) — QualityCheckPanel.
 * Vừa dùng HÀM (nhanh, chắc, offline) vừa dùng AI (bắt lỗi ngữ nghĩa) như yêu cầu.
 */
import { useMemo, useState } from 'react';
import { Bot, Loader2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { runAiQualityScan, type AiScanIssue } from '../../lib/ai/aiQualityScan';
import { WorldbookHealthPanel } from './WorldbookHealthPanel';
import { QualityCheckPanel } from './QualityCheckPanel';
import { t as ui, fmt } from '../../i18n';

const SEV_META: Record<AiScanIssue['severity'], { icon: React.ReactNode; cls: string }> = {
  error: { icon: <XCircle className="w-3.5 h-3.5" />, cls: 'text-red-500' },
  warning: { icon: <AlertTriangle className="w-3.5 h-3.5" />, cls: 'text-amber-500' },
  info: { icon: <Info className="w-3.5 h-3.5" />, cls: 'text-blue-500' },
};

function AiScanSection() {
  const card = useCardStore(s => s.card);
  const settings = useSettingsStore();
  const entries = useMemo(() => card.data.character_book?.entries ?? [], [card.data.character_book?.entries]);
  const activeProfile = useMemo(
    () => settings.profiles.find(p => p.id === settings.activeProfileId),
    [settings.profiles, settings.activeProfileId],
  );

  const [running, setRunning] = useState(false);
  const [issues, setIssues] = useState<AiScanIssue[] | null>(null);
  const [err, setErr] = useState('');
  const [ctrl, setCtrl] = useState<AbortController | null>(null);

  const run = async () => {
    if (!activeProfile) { setErr(ui.qhNoProfile); return; }
    if (entries.length === 0) { setErr(ui.qhNoEntries); return; }
    setErr(''); setIssues(null); setRunning(true);
    const ac = new AbortController();
    setCtrl(ac);
    try {
      const res = await runAiQualityScan(entries, activeProfile, settings.generationParams, ac.signal);
      setIssues(res);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(e?.message || String(e));
    } finally {
      setRunning(false); setCtrl(null);
    }
  };

  const errors = issues?.filter(i => i.severity === 'error').length ?? 0;
  const warnings = issues?.filter(i => i.severity === 'warning').length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="w-4 h-4 text-primary" />
          {ui.qhAiTitle}
        </div>
        {running ? (
          <button onClick={() => ctrl?.abort()} className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted">
            {ui.qhStop}
          </button>
        ) : (
          <button onClick={run} disabled={entries.length === 0}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5" /> {ui.qhAiRun}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-2">{ui.qhAiDesc}</p>

      {running && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {fmt(ui.qhScanning, { count: entries.length })}
        </div>
      )}
      {err && <div className="text-xs text-red-500 py-1">{err}</div>}

      {issues && (
        issues.length === 0 ? (
          <div className="text-xs text-emerald-500 py-1">{ui.qhClean}</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-1.5">
              {fmt(ui.qhFound, { total: issues.length, errors, warnings })}
            </div>
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto scrollbar-thin">
              {issues.map((iss, i) => {
                const m = SEV_META[iss.severity];
                return (
                  <div key={i} className="text-xs rounded-md border border-border/60 bg-background/40 p-2">
                    <div className={`flex items-start gap-1.5 font-medium ${m.cls}`}>
                      {m.icon}
                      <span className="text-foreground">
                        {iss.comment && <span className="text-muted-foreground">[{iss.comment}] </span>}
                        {iss.issue}
                      </span>
                    </div>
                    {iss.suggestion && (
                      <div className="mt-1 pl-5 text-muted-foreground">💡 {iss.suggestion}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )
      )}
    </div>
  );
}

export function QualityHubPanel() {
  return (
    <div className="p-4 space-y-4">
      <AiScanSection />
      <WorldbookHealthPanel />
      <QualityCheckPanel />
    </div>
  );
}
