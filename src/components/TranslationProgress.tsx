import { useRef, useEffect, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT } from '../i18n/useLocale';
import type { LogFilter } from '../types/card';
import {
  Play,
  Pause,
  Square,
  Clock,
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

function LogPanel({ logEndRef }: { logEndRef: React.RefObject<HTMLDivElement | null> }) {
  const { logs, logFilter } = useStore();
  if (logs.length === 0) return null;
  return (
    <div>
      <LogFilterBar />
      <div className="log-panel">
        {logs
          .filter((log) => logFilter === 'all' || log.level === logFilter)
          .map((log) => (
            <div key={log.id} className={`log-entry log-${log.level}`}>
              <span style={{ flexShrink: 0 }}>
                {log.level === 'success' && '[✓]'}
                {log.level === 'error' && '[✗]'}
                {log.level === 'warning' && '[!]'}
                {log.level === 'active' && '[~]'}
                {log.level === 'info' && '[i]'}
                {log.level === 'retry' && '[↻]'}
              </span>
              <span>{log.message}</span>
            </div>
          ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MOD MODE PANEL
// ═══════════════════════════════════════════════

function ModModePanel() {
  const { fields, phase, logs, startTime, translationConfig } = useStore();
  const { applyModToAllFields, continueMod, retryAllErrors, cancelTranslation, pauseTranslation, resumeTranslation, generateModLorebook } = useTranslation();
  const t = useT();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState<number | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

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
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
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
              Mod tiếp
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

      {/* Logs */}
      <LogPanel logEndRef={logEndRef} />
    </div>
  );
}

// ═══════════════════════════════════════════════
// TRANSLATION PANEL (original)
// ═══════════════════════════════════════════════

function TranslationPanel() {
  const { fields, phase, logs, startTime, translationConfig } = useStore();
  const { startTranslation, continueTranslation, pauseTranslation, resumeTranslation, cancelTranslation, retryAllErrors } = useTranslation();
  const t = useT();
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

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
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} /> {t.eta}: {getETA()}
            </span>
            <span>~{estimatedTokens.toLocaleString()} {t.tokens}</span>
          </div>
        )}
      </div>

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
            <button className="btn btn-secondary" onClick={() => startTranslation()}>
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

      {/* Logs */}
      <LogPanel logEndRef={logEndRef} />
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
