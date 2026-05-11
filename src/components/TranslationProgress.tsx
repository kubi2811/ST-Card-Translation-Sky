import { useRef, useEffect } from 'react';
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
  Wrench,
} from 'lucide-react';

export default function TranslationProgress() {
  const { fields, phase, logs, logFilter, startTime, card, clearLogs, translationConfig } = useStore();
  const { startTranslation, continueTranslation, pauseTranslation, resumeTranslation, cancelTranslation, retryAllErrors, applyModToAllFields } = useTranslation();
  const t = useT();
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  if (!card) return null;

  const totalFields = fields.length;
  const doneFields = fields.filter((f) => f.status === 'done').length;
  const errorFields = fields.filter((f) => f.status === 'error').length;
  const skippedFields = fields.filter((f) => f.status === 'skipped').length;
  const ignoredFields = fields.filter((f) => f.status === 'ignored').length;
  const progress = totalFields > 0 ? ((doneFields + skippedFields + ignoredFields) / totalFields) * 100 : 0;

  // Estimated time remaining
  const getETA = () => {
    if (!startTime || doneFields === 0) return '--';
    const elapsed = Date.now() - startTime;
    const avgPerField = elapsed / doneFields;
    const remaining = avgPerField * (totalFields - doneFields - errorFields - skippedFields - ignoredFields);
    if (remaining < 60000) return `${Math.ceil(remaining / 1000)}s`;
    return `${Math.ceil(remaining / 60000)}m`;
  };

  // Estimated tokens
  const totalChars = fields.reduce((sum, f) => sum + f.original.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  const isIdle = phase === 'idle';
  const isTranslating = phase === 'translating';
  const isPaused = phase === 'paused';
  const isDone = phase === 'done';
  const isCancelled = phase === 'cancelled';

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
            <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
              {progress.toFixed(0)}%
            </span>
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

      {/* Stats row */}
      {totalFields > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            flexWrap: 'wrap',
          }}
        >
          <MiniStat icon={<CheckCircle2 size={12} />} value={doneFields} label={t.done} color="var(--accent-success)" />
          {skippedFields > 0 && (
            <MiniStat icon={<CheckCircle2 size={12} />} value={skippedFields} label={t.skipped} color="var(--accent-warning)" />
          )}
          {ignoredFields > 0 && (
            <MiniStat icon={<Ban size={12} />} value={ignoredFields} label={t.ignored || 'Ignored'} color="var(--text-muted)" />
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
          <button className="btn btn-primary" onClick={() => startTranslation()}>
            <Play size={14} />
            {t.startTranslation}
          </button>
        )}
        {(isCancelled || isDone) && (
          <>
            <button className="btn btn-primary" onClick={() => continueTranslation()}>
              <Play size={14} />
              {t.continueTranslation}
            </button>
            {errorFields > 0 && (
              <button
                className="btn btn-secondary"
                onClick={retryAllErrors}
                style={{ borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)' }}
              >
                <RotateCcw size={14} />
                Retry {errorFields} Error{errorFields > 1 ? 's' : ''}
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
        {/* Apply Mod Button — visible when mod mode is enabled */}
        {translationConfig.enableModMode && translationConfig.modInstructions?.trim() && !isTranslating && !isPaused && (
          <button
            className="btn btn-secondary"
            onClick={applyModToAllFields}
            style={{
              borderColor: '#9b59b6',
              color: '#9b59b6',
              background: 'rgba(155, 89, 182, 0.08)',
            }}
          >
            <Wrench size={14} />
            {t.applyMod}
          </button>
        )}
      </div>

      {/* Log panel */}
      {logs.length > 0 && (
        <div>
          {/* Log filter bar */}
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
      )}
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 10px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.75rem',
        color,
      }}
    >
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
    <div
      style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '6px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <Filter size={12} style={{ color: 'var(--text-muted)', marginRight: '2px' }} />
      {LOG_FILTERS.map((f) => {
        const count = f.value === 'all' ? logs.length : logs.filter((l) => l.level === f.value).length;
        return (
          <button
            key={f.value}
            onClick={() => setLogFilter(f.value)}
            style={{
              padding: '2px 8px',
              fontSize: '0.65rem',
              fontWeight: logFilter === f.value ? 700 : 400,
              border: `1px solid ${logFilter === f.value ? f.color : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-sm)',
              background: logFilter === f.value ? 'rgba(124,106,240,0.1)' : 'transparent',
              color: f.color,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {f.label} ({count})
          </button>
        );
      })}
      <button
        onClick={clearLogs}
        style={{
          marginLeft: 'auto',
          padding: '2px 8px',
          fontSize: '0.65rem',
          border: '1px solid var(--accent-danger)',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--accent-danger)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
        }}
      >
        <Trash2 size={10} /> {t.clear}
      </button>
    </div>
  );
}
