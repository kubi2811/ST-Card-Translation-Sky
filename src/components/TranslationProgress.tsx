import { useRef, useEffect, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT, useUi } from '../i18n/useLocale';
import type { LogFilter, LogEntry, LogPhase } from '../types/card';
import ActiveCallsPanel from './ActiveCallsPanel';
import {
  Play,
  Pause,
  Square,
  Clock,
  Timer,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  Filter,
  Trash2,
  Ban,
  Wand2,
  AlertTriangle,
  FileText,
  BookPlus,
} from 'lucide-react';

// ═══════════════════════════════════════════════
// Shared components
// ═══════════════════════════════════════════════

function MiniStat({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color }}>
      {icon}
      <span style={{ fontWeight: 600 }}>{value}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

/** Live count-up timer: how long since translation started (wall-clock).
 *  Ticks every second while translating/paused; freezes when done/cancelled. */
function ElapsedTime({ color = 'var(--text-secondary)' }: { color?: string }) {
  const { startTime, phase } = useStore();
  const ui = useUi();
  const [, tick] = useState(0);
  useEffect(() => {
    if (phase !== 'translating' && phase !== 'paused') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (!startTime) return null;
  const totalSec = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const label = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }} title={ui.tpElapsedTitle}>
      <Timer size={12} /> {ui.tpElapsed}{label}
    </span>
  );
}

function LogFilterBar() {
  const { logFilter, setLogFilter, logs, clearLogs } = useStore();
  const t = useT();
  const LOG_FILTERS: { value: LogFilter; label: string; color: string }[] = [
    { value: 'all', label: t.all, color: 'var(--text-secondary)' },
    { value: 'success', label: `✓ ${t.done}`, color: 'var(--accent-success)' },
    { value: 'error', label: `✗ ${t.error}`, color: 'var(--accent-danger)' },
    { value: 'retry', label: `↻ ${t.retry}`, color: '#ffb74d' },
    { value: 'warning', label: `! ${t.warn}`, color: 'var(--accent-warning)' },
    { value: 'active', label: `~ ${t.active}`, color: 'var(--accent-info)' },
    { value: 'info', label: `i ${t.info}`, color: 'var(--text-muted)' },
  ];
  return (
    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
      <Filter size={12} style={{ color: 'var(--text-muted)', marginRight: '2px' }} />
      {LOG_FILTERS.map((f) => {
        const count = f.value === 'all' ? logs.length : logs.filter((l) => l.level === f.value).length;
        return (
          <button
            key={f.value}
            onClick={() => setLogFilter(f.value)}
            style={{
              padding: '2px 8px', fontSize: '0.65rem',
              fontWeight: logFilter === f.value ? 700 : 400,
              border: `1px solid ${logFilter === f.value ? f.color : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-sm)',
              background: logFilter === f.value ? 'rgba(124,106,240,0.1)' : 'transparent',
              color: f.color, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {f.label} ({count})
          </button>
        );
      })}
      <button
        onClick={clearLogs}
        style={{
          marginLeft: 'auto', padding: '2px 8px', fontSize: '0.65rem',
          border: '1px solid var(--accent-danger)', borderRadius: 'var(--radius-sm)',
          background: 'transparent', color: 'var(--accent-danger)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '3px',
        }}
      >
        <Trash2 size={10} /> {t.clear}
      </button>
    </div>
  );
}

/** Nhãn nhóm log: giữ ở module scope nên chỉ lưu KEY, tra `ui` lúc render. */
const PHASE_LABEL_KEY: Record<LogPhase, 'tpPhasePrepare' | 'tpPhaseTranslate' | 'tpPhaseVerify' | 'tpPhaseOther'> = {
  prepare: 'tpPhasePrepare',
  translate: 'tpPhaseTranslate',
  verify: 'tpPhaseVerify',
  other: 'tpPhaseOther',
};

function LevelTag({ level }: { level: LogEntry['level'] }) {
  return (
    <span style={{ flexShrink: 0 }}>
      {level === 'success' && '[✓]'}
      {level === 'error' && '[✗]'}
      {level === 'warning' && '[!]'}
      {level === 'active' && '[~]'}
      {level === 'info' && '[i]'}
      {level === 'retry' && '[↻]'}
    </span>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  return (
    <div className={`log-entry log-${log.level}`}>
      <LevelTag level={log.level} />
      <span>{log.message}</span>
    </div>
  );
}

function LogPanel() {
  const { logs, logFilter } = useStore();
  const ui = useUi();
  const [collapsed, setCollapsed] = useState<Set<LogPhase>>(() => new Set());
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // có đang "dính đáy" không (user đang xem dòng mới nhất)

  // (Sửa) Auto-cuộn CHỈ TRONG hộp log — KHÔNG đụng scroll trang. Trước đây dùng
  // logEndRef.scrollIntoView() nên trình duyệt kéo CẢ TRANG xuống để lộ hộp log mỗi khi
  // dịch xong 1 entry (thêm 1 dòng log) → view giật xuống Field Editor. Nay chỉ set
  // scrollTop của hộp, và chỉ khi user đang ở gần đáy (cuộn lên đọc lịch sử thì không giật).
  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [logs.length, logFilter]);

  if (logs.length === 0) return null;

  const filteredLogs = logs.filter((log) => logFilter === 'all' || log.level === logFilter);
  const visibleLogs = filteredLogs.slice(-300);
  const isTruncated = filteredLogs.length > 300;

  // Gom các dòng LIỀN NHAU cùng giai đoạn thành 1 nhóm gấp/mở được.
  const groups: { phase: LogPhase; logs: LogEntry[] }[] = [];
  for (const log of visibleLogs) {
    const phase: LogPhase = log.phase || 'other';
    const last = groups[groups.length - 1];
    if (last && last.phase === phase) last.logs.push(log);
    else groups.push({ phase, logs: [log] });
  }
  // Chỉ hiện tiêu đề nhóm khi thực sự có nhiều giai đoạn (ca đơn giản → phẳng như cũ).
  const distinctPhases = new Set(groups.map((g) => g.phase));
  const showGroups = distinctPhases.size > 1;

  const toggle = (p: LogPhase) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });

  return (
    <div>
      <LogFilterBar />
      <div
        className="log-panel"
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          // "dính đáy" nếu còn cách đáy < 40px; user cuộn lên đọc → tạm ngừng auto-cuộn.
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {isTruncated && (
          <div style={{
            fontSize: '0.68rem',
            color: 'var(--text-muted)',
            padding: '6px 8px',
            textAlign: 'center',
            borderBottom: '1px dashed var(--border-subtle)',
            marginBottom: '6px',
            fontStyle: 'italic',
            background: 'rgba(255,255,255,0.01)',
          }}>
            Showing last 300 logs (total: {filteredLogs.length})
          </div>
        )}

        {showGroups
          ? groups.map((g, gi) => {
              const isCol = collapsed.has(g.phase);
              return (
                <div key={gi}>
                  <div
                    onClick={() => toggle(g.phase)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '3px 6px', margin: '2px 0',
                      fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                      color: 'var(--text-secondary)',
                      background: 'rgba(124,106,240,0.06)',
                      borderRadius: 'var(--radius-sm)',
                      position: 'sticky', top: 0,
                    }}
                    title={isCol ? ui.tpExpandGroup : ui.tpCollapseGroup}
                  >
                    <span style={{ width: 10 }}>{isCol ? '▸' : '▾'}</span>
                    <span>{ui[PHASE_LABEL_KEY[g.phase]]}</span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({g.logs.length})</span>
                  </div>
                  {!isCol && g.logs.map((log) => <LogRow key={log.id} log={log} />)}
                </div>
              );
            })
          : visibleLogs.map((log) => <LogRow key={log.id} log={log} />)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MOD MODE PANEL
// ═══════════════════════════════════════════════

function ModModePanel() {
  const { fields, phase, logs, startTime, translationConfig } = useStore();
  const ui = useUi();
  const { applyModToAllFields, continueMod, retryAllErrors, cancelTranslation, pauseTranslation, resumeTranslation, generateModLorebook } = useTranslation();
  const t = useT();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState<number | null>(null);

  const totalFields = fields.length;
  const doneFields = fields.filter((f) => f.status === 'done').length;
  const errorFields = fields.filter((f) => f.status === 'error').length;
  const skippedFields = fields.filter((f) => f.status === 'skipped').length;
  const ignoredFields = fields.filter((f) => f.status === 'ignored').length;
  const translatingFields = fields.filter((f) => f.status === 'translating').length;
  const progress = totalFields > 0 ? ((doneFields + skippedFields + ignoredFields) / totalFields) * 100 : 0;

  const isTranslating = phase === 'translating';
  const isPaused = phase === 'paused';
  const isIdle = phase === 'idle';
  const isCancelled = phase === 'cancelled';
  const isDone = phase === 'done';
  const hasInstructions = Boolean(translationConfig.modInstructions?.trim());

  const getETA = () => {
    if (!startTime || doneFields === 0) return '--';
    const elapsed = Date.now() - startTime;
    const avg = elapsed / doneFields;
    const remaining = avg * (totalFields - doneFields - errorFields - skippedFields - ignoredFields);
    return remaining < 60000 ? `${Math.ceil(remaining / 1000)}s` : `${Math.ceil(remaining / 60000)}m`;
  };

  const modAccent = '#9b59b6';
  const modAccentLight = 'rgba(155, 89, 182, 0.12)';
  const modGradient = 'linear-gradient(135deg, #9b59b6, #8e44ad)';

  return (
    <div
      className="card fade-in"
      style={{
        padding: '20px',
        borderLeft: `3px solid ${modAccent}`,
        background: `linear-gradient(135deg, rgba(155,89,182,0.03) 0%, transparent 50%)`,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
            background: modGradient, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Wand2 size={15} color="white" />
          </div>
          <span style={{ color: modAccent }}>{t.modPanel}</span>
        </h3>
        {isTranslating && (
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)', flexWrap: 'wrap', alignItems: 'center' }}>
            <ElapsedTime color={modAccent} />
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} /> {t.eta}: {getETA()}
            </span>
          </div>
        )}
      </div>

      {/* Instructions preview */}
      {hasInstructions ? (
        <div style={{
          padding: '10px 14px', marginBottom: '16px',
          background: modAccentLight, borderRadius: 'var(--radius-sm)',
          border: `1px solid rgba(155,89,182,0.2)`,
          fontSize: '0.78rem', lineHeight: 1.5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <FileText size={12} style={{ color: modAccent }} />
            <span style={{ fontWeight: 600, fontSize: '0.7rem', color: modAccent, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {t.modCurrentInstruction}
            </span>
          </div>
          <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'auto' }}>
            {translationConfig.modInstructions!.length > 200
              ? translationConfig.modInstructions!.slice(0, 200) + '...'
              : translationConfig.modInstructions}
          </div>
        </div>
      ) : (
        <div style={{
          padding: '12px 14px', marginBottom: '16px',
          background: 'rgba(255,180,0,0.06)', borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(255,180,0,0.2)',
          display: 'flex', alignItems: 'center', gap: '8px',
          fontSize: '0.78rem', color: 'var(--accent-warning)',
        }}>
          <AlertTriangle size={14} />
          {t.modNoInstructionsWarning}
        </div>
      )}

      {/* Progress bar */}
      {totalFields > 0 && (doneFields > 0 || isTranslating || translatingFields > 0) && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {doneFields + skippedFields + ignoredFields} / {totalFields} {t.fields}
            </span>
            <span style={{ fontWeight: 600, color: modAccent }}>{progress.toFixed(0)}%</span>
          </div>
          <div className="progress-track">
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: modGradient,
                borderRadius: 'inherit',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          {errorFields > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--accent-danger)', marginTop: '4px' }}>
              {errorFields} {t.error.toLowerCase()}
              {(() => {
                const resumable = fields.filter(f => f.status === 'error' && f.completedChunks && f.completedChunks.length > 0);
                if (resumable.length > 0) {
                  return <span style={{ color: 'var(--accent-info)', marginLeft: '8px' }}>
                    ({resumable.length} resumable)
                  </span>;
                }
                return null;
              })()}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {totalFields > 0 && (doneFields > 0 || errorFields > 0 || isTranslating) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <MiniStat icon={<Wand2 size={12} />} value={doneFields} label={t.modded} color={modAccent} />
          {skippedFields > 0 && (
            <MiniStat icon={<CheckCircle2 size={12} />} value={skippedFields} label={t.skipped} color="var(--accent-warning)" />
          )}
          <MiniStat icon={<XCircle size={12} />} value={errorFields} label={t.error} color="var(--accent-danger)" />
          <MiniStat
            icon={<Loader2 size={12} />}
            value={totalFields - doneFields - errorFields - skippedFields - ignoredFields}
            label={t.remaining}
            color="var(--text-muted)"
          />
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {isIdle && (
          <button
            onClick={() => applyModToAllFields(false)}
            disabled={!hasInstructions}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600,
              border: 'none', borderRadius: 'var(--radius-sm)',
              background: hasInstructions ? modGradient : 'var(--bg-secondary)',
              color: hasInstructions ? 'white' : 'var(--text-muted)',
              cursor: hasInstructions ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              opacity: hasInstructions ? 1 : 0.5,
              boxShadow: hasInstructions ? '0 2px 8px rgba(155,89,182,0.3)' : 'none',
            }}
          >
            <Wand2 size={16} />
            {t.modApplyAll}
          </button>
        )}
        {(isCancelled || isDone) && (
          <>
            <button
              onClick={() => continueMod()}
              disabled={!hasInstructions}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600,
                border: 'none', borderRadius: 'var(--radius-sm)',
                background: hasInstructions ? modGradient : 'var(--bg-secondary)',
                color: hasInstructions ? 'white' : 'var(--text-muted)',
                cursor: hasInstructions ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                opacity: hasInstructions ? 1 : 0.5,
                boxShadow: hasInstructions ? '0 2px 8px rgba(155,89,182,0.3)' : 'none',
              }}
            >
              <Play size={16} />
              {ui.tpModContinue}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => applyModToAllFields(false)}
              disabled={!hasInstructions}
            >
              <RotateCcw size={14} />
              {t.modApplyAll}
            </button>
          </>
        )}
        {!isTranslating && !isPaused && errorFields > 0 && (
          <button
            className="btn btn-secondary"
            onClick={retryAllErrors}
            style={{ borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)' }}
          >
            <RotateCcw size={14} />
            {t.modRetryErrors} ({errorFields})
          </button>
        )}
        {(isTranslating || isPaused) && (
          <>
            {isTranslating && (
              <button className="btn btn-secondary" onClick={pauseTranslation}
                style={{ borderColor: modAccent, color: modAccent }}>
                <Pause size={14} /> {t.pause}
              </button>
            )}
            {isPaused && (
              <button
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600,
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  background: modGradient, color: 'white', cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(155,89,182,0.3)',
                }}
                onClick={resumeTranslation}
              >
                <Play size={14} /> {t.resume}
              </button>
            )}
            <button className="btn btn-danger" onClick={cancelTranslation}>
              <Square size={14} /> {t.cancel}
            </button>
          </>
        )}
      </div>

      {/* Generate Lorebook */}
      {(isDone || isCancelled) && hasInstructions && !isGenerating && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            padding: '12px 14px',
            background: 'rgba(52, 152, 219, 0.06)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(52, 152, 219, 0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookPlus size={16} style={{ color: '#3498db' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3498db' }}>
                  {t.modGenerateLorebook}
                </span>
              </div>
              {generatedCount !== null && (
                <span style={{ fontSize: '0.7rem', color: 'var(--accent-success)', fontWeight: 500 }}>
                  {t.modGenerateSuccess.replace('{count}', String(generatedCount))}
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.4 }}>
              {t.modGenerateLorebookDesc}
            </p>
            <button
              onClick={async () => {
                setIsGenerating(true);
                setGeneratedCount(null);
                try {
                  const count = await generateModLorebook();
                  setGeneratedCount(count);
                } finally {
                  setIsGenerating(false);
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '7px 16px', fontSize: '0.8rem', fontWeight: 600,
                border: 'none', borderRadius: 'var(--radius-sm)',
                background: 'linear-gradient(135deg, #3498db, #2980b9)',
                color: 'white', cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 2px 8px rgba(52,152,219,0.3)',
              }}
            >
              <BookPlus size={14} />
              {t.modGenerateLorebook}
            </button>
          </div>
        </div>
      )}

      {/* Generating state */}
      {isGenerating && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 14px', marginBottom: '16px',
          background: 'rgba(52, 152, 219, 0.08)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(52, 152, 219, 0.25)',
          fontSize: '0.8rem', color: '#3498db',
        }}>
          <Loader2 size={16} className="spin" />
          {t.modGenerating}
        </div>
      )}

      {/* MVU Conversion Progress */}
      {useStore().mvuConversionProgress && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 14px', marginBottom: '16px',
          background: 'rgba(230, 126, 34, 0.08)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(230, 126, 34, 0.25)',
          fontSize: '0.8rem', color: '#e67e22',
        }}>
          <Loader2 size={16} className="spin" />
          {useStore().mvuConversionProgress}
        </div>
      )}

      {/* Logs */}
      <LogPanel />
    </div>
  );
}

// ═══════════════════════════════════════════════
// TRANSLATION PANEL (original)
// ═══════════════════════════════════════════════

function TranslationPanel() {
  const { fields, phase, logs, startTime, translationConfig, preprocessProgress, deleteCurrentCardCache } = useStore();
  const ui = useUi();
  const { startTranslation, continueTranslation, pauseTranslation, resumeTranslation, cancelTranslation, retryAllErrors, prepareFields } = useTranslation();
  const t = useT();

  const totalFields = fields.length;
  const doneFields = fields.filter((f) => f.status === 'done').length;
  const errorFields = fields.filter((f) => f.status === 'error').length;
  const skippedFields = fields.filter((f) => f.status === 'skipped').length;
  const ignoredFields = fields.filter((f) => f.status === 'ignored').length;
  const progress = totalFields > 0 ? ((doneFields + skippedFields + ignoredFields) / totalFields) * 100 : 0;

  const isIdle = phase === 'idle';
  const isTranslating = phase === 'translating';
  const isPaused = phase === 'paused';
  const isDone = phase === 'done';
  const isCancelled = phase === 'cancelled';

  const getETA = () => {
    if (!startTime || doneFields === 0) return '--';
    const elapsed = Date.now() - startTime;
    const avg = elapsed / doneFields;
    const remaining = avg * (totalFields - doneFields - errorFields - skippedFields - ignoredFields);
    return remaining < 60000 ? `${Math.ceil(remaining / 1000)}s` : `${Math.ceil(remaining / 60000)}m`;
  };

  const totalChars = fields.reduce((sum, f) => sum + f.original.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  return (
    <div className="card fade-in" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={18} style={{ color: 'var(--accent-primary)' }} />
          {t.translation}
        </h3>
        {totalFields > 0 && (
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)', flexWrap: 'wrap', alignItems: 'center' }}>
            <ElapsedTime />
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} /> {t.eta}: {getETA()}
            </span>
            <span>~{estimatedTokens.toLocaleString()} {t.tokens}</span>
          </div>
        )}
      </div>

      {/* Pre-processing progress bar (Strategy B variable translation, etc.) — shown
          BEFORE the main field loop starts, so the user can see those long steps progress */}
      {phase === 'translating' && preprocessProgress && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          background: 'rgba(124,106,240,0.06)',
          border: '1px solid rgba(124,106,240,0.2)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
            <span style={{ color: 'var(--accent-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Loader2 size={12} className="spin" /> {preprocessProgress.label}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--accent-secondary)' }}>
              {preprocessProgress.current} / {preprocessProgress.total}
              {' '}({preprocessProgress.total > 0 ? Math.round((preprocessProgress.current / preprocessProgress.total) * 100) : 0}%)
            </span>
          </div>
          <div className="progress-track">
            <div
              style={{
                width: `${preprocessProgress.total > 0 ? (preprocessProgress.current / preprocessProgress.total) * 100 : 0}%`,
                height: '100%',
                background: 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))',
                borderRadius: 'inherit',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {ui.tpPreprocessHint}
          </div>
        </div>
      )}

      {/* Live AI call monitor — model / entry / threads / combined RPM */}
      <ActiveCallsPanel />

      {/* Progress bar */}
      {totalFields > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {doneFields + skippedFields + ignoredFields} / {totalFields} {t.fields}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{progress.toFixed(0)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          {errorFields > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--accent-danger)', marginTop: '4px' }}>
              {errorFields} {t.error.toLowerCase()}
              {(() => {
                const resumable = fields.filter(f => f.status === 'error' && f.completedChunks && f.completedChunks.length > 0);
                if (resumable.length > 0) {
                  return <span style={{ color: 'var(--accent-info)', marginLeft: '8px' }}>
                    ({resumable.length} resumable)
                  </span>;
                }
                return null;
              })()}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {totalFields > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <MiniStat icon={<CheckCircle2 size={12} />} value={doneFields} label={t.done} color="var(--accent-success)" />
          {skippedFields > 0 && (
            <MiniStat icon={<CheckCircle2 size={12} />} value={skippedFields} label={t.skipped} color="var(--accent-warning)" />
          )}
          {ignoredFields > 0 && (
            <MiniStat icon={<Ban size={12} />} value={ignoredFields} label={t.ignored || 'Ignored'} color="var(--text-muted)" />
          )}
          <MiniStat icon={<XCircle size={12} />} value={errorFields} label={t.error} color="var(--accent-danger)" />
          <MiniStat icon={<Loader2 size={12} />} value={totalFields - doneFields - errorFields - skippedFields - ignoredFields} label={t.remaining} color="var(--text-muted)" />
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {isIdle && (
          <button className="btn btn-primary" onClick={() => startTranslation()}>
            <Play size={14} /> {t.startTranslation}
          </button>
        )}
        {isIdle && totalFields === 0 && (
          <button
            className="btn btn-secondary"
            onClick={() => prepareFields(false)}
            title={ui.tpListFieldsTitle}
          >
            <FileText size={14} /> {ui.tpListFields}
          </button>
        )}
        {(isCancelled || isDone) && (
          <>
            <button className="btn btn-primary" onClick={() => continueTranslation()}>
              <Play size={14} /> {t.continueTranslation}
            </button>
            {errorFields > 0 && (
              <button className="btn btn-secondary" onClick={retryAllErrors} style={{ borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)' }}>
                <RotateCcw size={14} /> Retry {errorFields} Error{errorFields > 1 ? 's' : ''}
              </button>
            )}
            <button
              className="btn btn-secondary"
              title="Xoá TOÀN BỘ bản dịch cũ của thẻ này (cả cache trên đĩa + từ điển biến MVU) rồi dịch lại từ đầu."
              onClick={async () => {
                // (Fix) Trước đây nút này chỉ gọi startTranslation() — mà prepareFields GIỮ field đã
                // done + cache đĩa tự khôi phục ⇒ hoá ra là "Continue" trá hình, dịch tiếp từ chỗ cũ.
                // Nay: xác nhận → xoá sạch bản dịch + cache + từ điển MVU → dịch lại TỪ ĐẦU thật sự.
                const okToWipe = window.confirm(
                  'Dịch lại TỪ ĐẦU sẽ XOÁ toàn bộ bản dịch hiện có của thẻ này (kể cả tiến trình đã lưu). Tiếp tục?'
                );
                if (!okToWipe) return;
                await deleteCurrentCardCache();
                // freshStart=true ⇒ prepareFields BỎ QUA fields cũ (không đọc store, tránh stale
                // closure) → dịch lại TỪ ĐẦU thật sự, không báo "all already translated".
                startTranslation(false, true);
              }}
            >
              <RotateCcw size={14} /> {t.retranslateAll}
            </button>
          </>
        )}
        {isTranslating && (
          <button className="btn btn-secondary" onClick={pauseTranslation}>
            <Pause size={14} /> {t.pause}
          </button>
        )}
        {isPaused && (
          <button className="btn btn-primary" onClick={resumeTranslation}>
            <Play size={14} /> {t.resume}
          </button>
        )}
        {(isTranslating || isPaused) && (
          <button className="btn btn-danger" onClick={cancelTranslation}>
            <Square size={14} /> {t.cancel}
          </button>
        )}

      </div>

      {/* Gợi ý: bỏ dịch từng trường trước khi bắt đầu */}
      {isIdle && totalFields > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '14px', padding: '8px 10px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 'var(--radius-sm)' }}>
          <Ban size={13} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
          <span>{ui.tpManualHint1} <b>{ui.tpManualHint2}</b> {ui.tpManualHint3} <b>{t.fieldEditor}</b> {ui.tpManualHint4}</span>
        </div>
      )}

      {/* Logs */}
      <LogPanel />
    </div>
  );
}

// ═══════════════════════════════════════════════
// Main export — switches between modes
// ═══════════════════════════════════════════════

export default function TranslationProgress() {
  const { card, translationConfig } = useStore();
  if (!card) return null;

  const isModMode = translationConfig.enableModMode;
  return isModMode ? <ModModePanel /> : <TranslationPanel />;
}
