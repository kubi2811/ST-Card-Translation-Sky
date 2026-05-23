import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT } from '../i18n/useLocale';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FieldGroup, TranslationStatus } from '../types/card';
import { RotateCcw, AlertTriangle, CheckCircle2, Clock, ArrowLeftRight, BarChart3, Ban, Search, X, Copy, Check, Eye, Wand2, Zap } from 'lucide-react';

const getFieldBaseKey = (path: string) => {
  const lastPart = path.split('.').pop() || '';
  return lastPart.replace(/\[\d+\]$/, '');
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="btn btn-ghost btn-xs tooltip"
      data-tooltip={copied ? "Copied!" : "Copy"}
      style={{ padding: '2px 4px', height: 'auto', minHeight: 'auto', opacity: 0.6 }}
      title={copied ? "Copied!" : "Copy original text"}
    >
      {copied ? <Check size={12} color="var(--accent-success)" /> : <Copy size={12} />}
    </button>
  );
}

const TAB_IDS: (FieldGroup | 'all')[] = [
  'all', 'core', 'messages', 'lorebook', 'lorebook_keys', 'system', 'creator', 'regex', 'depth_prompt', 'tavern_helper',
];

function useTabLabels() {
  const t = useT();
  const map: Record<string, string> = {
    all: t.all,
    core: 'Core',
    messages: t.groupMessages.split(' ')[0],
    lorebook: 'Lorebook',
    lorebook_keys: 'Keys',
    system: 'System',
    creator: 'Creator',
    regex: 'Regex',
    depth_prompt: 'Depth',
    tavern_helper: 'TavernHelper',
  };
  return map;
}

/** Compute char ratio indicator */
function CharRatio({ original, translated }: { original: string; translated: string }) {
  if (!translated) return null;
  const ratio = translated.length / Math.max(original.length, 1);
  const pct = Math.round(ratio * 100);

  // Color based on ratio health
  let color = 'var(--accent-success)';
  let label = 'OK';
  if (ratio < 0.3) { color = 'var(--accent-danger)'; label = 'Short'; }
  else if (ratio < 0.6) { color = 'var(--accent-warning)'; label = 'Low'; }
  else if (ratio > 2.5) { color = 'var(--accent-warning)'; label = 'Long'; }

  return (
    <span
      title={`${translated.length}/${original.length} chars (${pct}%)`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '0.6rem',
        padding: '1px 5px',
        borderRadius: 'var(--radius-sm)',
        background: `${color}15`,
        color,
        fontWeight: 600,
        fontFamily: 'monospace',
      }}
    >
      <BarChart3 size={9} />
      {pct}%
      {ratio < 0.3 && <span style={{ fontSize: '0.55rem' }}>⚠ {label}</span>}
    </span>
  );
}

/** Simple inline diff view — highlights additions/deletions */
function DiffView({ original, translated }: { original: string; translated: string }) {
  if (!translated) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.75rem' }}>No translation</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', lineHeight: 1.5 }}>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', top: '-1px', left: 0,
          fontSize: '0.55rem', fontWeight: 700, color: 'var(--accent-danger)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Original
        </span>
        <div style={{ position: 'absolute', top: '0px', right: '4px', zIndex: 10 }}>
          <CopyButton text={original} />
        </div>
        <div
          style={{
            padding: '14px 8px 6px',
            background: 'rgba(255,82,82,0.04)',
            borderLeft: '2px solid var(--accent-danger)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '200px',
            overflowY: 'auto',
            color: 'var(--text-secondary)',
          }}
        >
          {original.length > 800 ? original.slice(0, 800) + '...' : original}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', top: '-1px', left: 0,
          fontSize: '0.55rem', fontWeight: 700, color: 'var(--accent-success)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Translated
        </span>
        <div
          style={{
            padding: '14px 8px 6px',
            background: 'rgba(76,175,80,0.04)',
            borderLeft: '2px solid var(--accent-success)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '200px',
            overflowY: 'auto',
            color: 'var(--text-primary)',
          }}
        >
          {translated.length > 800 ? translated.slice(0, 800) + '...' : translated}
        </div>
      </div>
    </div>
  );
}

function SurgicalResultBadge({ result }: { result?: { type: 'success' | 'fallback', info?: string } }) {
  if (!result) return null;

  if (result.type === 'success') {
    return (
      <span style={{ 
        fontSize: '0.55rem', padding: '1px 4px', 
        background: 'rgba(76,175,80,0.15)', color: '#4caf50', 
        borderRadius: '3px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px',
        border: '1px solid rgba(76,175,80,0.3)'
      }} title={result.info}>
        <Check size={9} /> SURGICAL
      </span>
    );
  }

  return (
    <span style={{ 
      fontSize: '0.55rem', padding: '1px 4px', 
      background: 'rgba(255,152,0,0.15)', color: '#ff9800', 
      borderRadius: '3px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px',
      border: '1px solid rgba(255,152,0,0.3)'
    }} title={result.info || 'Structural check failed, used standard translation.'}>
      <AlertTriangle size={9} /> FALLBACK
    </span>
  );
}

/** Live HTML/Regex Preview Pane — renders translated HTML in a sandboxed iframe */
function HtmlPreviewPane({ html }: { html: string }) {
  const srcdoc = useMemo(() => {
    // Wrap in a basic document with dark bg and common ST CSS vars
    return `<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Tahoma, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #e0e0e0;
    background: #1a1a2e;
    padding: 12px;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #444; padding: 4px 8px; }
  a { color: #82b1ff; }
</style>
</head>
<body>
${html}
</body>
</html>`;
  }, [html]);

  return (
    <div style={{
      marginTop: '6px',
      border: '1px solid rgba(124,106,240,0.2)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      background: '#1a1a2e',
    }}>
      <div style={{
        padding: '3px 8px',
        fontSize: '0.6rem',
        fontWeight: 600,
        color: 'var(--accent-primary)',
        background: 'rgba(124,106,240,0.06)',
        borderBottom: '1px solid rgba(124,106,240,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        <Eye size={10} />
        HTML Preview (sandboxed)
      </div>
      <iframe
        srcDoc={srcdoc}
        sandbox="allow-same-origin"
        style={{
          width: '100%',
          minHeight: '120px',
          maxHeight: '400px',
          border: 'none',
          display: 'block',
        }}
        title="HTML Preview"
      />
    </div>
  );
}

/** Toggle wrapper for HtmlPreviewPane — shows an eye button to expand/collapse */
function HtmlPreviewToggle({ html }: { html: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginTop: '4px' }}>
      <button
        onClick={() => setShow(p => !p)}
        className="btn btn-ghost btn-xs"
        style={{
          padding: '2px 8px',
          fontSize: '0.62rem',
          color: show ? 'var(--accent-primary)' : 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: show ? 1 : 0.7,
        }}
      >
        <Eye size={11} />
        {show ? 'Hide Preview' : 'Preview HTML'}
      </button>
      {show && <HtmlPreviewPane html={html} />}
    </div>
  );
}

/** Live Regex Match Simulator */
function RegexSimulatorPane({ regexStr }: { regexStr: string }) {
  const [testText, setTestText] = useState('');
  
  // Parse regex safely
  const parsedRegex = useMemo(() => {
    if (!regexStr) return null;
    try {
      let pattern = regexStr;
      let flags = 'g';
      // SillyTavern format: /pattern/flags
      const match = regexStr.match(/^\/(.+)\/([gimsuy]*)$/);
      if (match) {
        pattern = match[1];
        flags = match[2];
        if (!flags.includes('g')) flags += 'g'; // Force global to find all matches
      } else {
        // If it doesn't have slashes, just treat as raw string
      }
      return new RegExp(pattern, flags);
    } catch (e) {
      return null; // Invalid regex
    }
  }, [regexStr]);

  const highlightedElements = useMemo(() => {
    if (!testText) return null;
    if (!parsedRegex) return <span style={{color: 'var(--accent-danger)'}}>Invalid Regular Expression</span>;

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    
    parsedRegex.lastIndex = 0; // reset
    let match;
    let key = 0;
    let iterations = 0;
    
    while ((match = parsedRegex.exec(testText)) !== null) {
      iterations++;
      if (iterations > 1000) break; // Infinite loop safety
      
      const start = match.index;
      const end = parsedRegex.lastIndex;
      
      // Zero-length match prevention
      if (start === end) {
        parsedRegex.lastIndex++;
        continue;
      }

      if (start > lastIndex) {
        elements.push(<span key={key++}>{testText.slice(lastIndex, start)}</span>);
      }
      
      elements.push(
        <mark key={key++} style={{ 
          background: 'rgba(236,72,153,0.3)', 
          color: '#ff9ecd', 
          borderRadius: '2px',
          padding: '0 2px'
        }} title="Matched segment">
          {testText.slice(start, end)}
        </mark>
      );
      
      lastIndex = end;
    }
    
    if (lastIndex < testText.length) {
      elements.push(<span key={key++}>{testText.slice(lastIndex)}</span>);
    }
    
    if (elements.length === 1 && typeof elements[0] === 'object' && 'type' in (elements[0] as any) && (elements[0] as any).type === 'span') {
      return <span style={{color: 'var(--text-muted)'}}>No matches found.</span>;
    }
    
    return elements;
  }, [testText, parsedRegex]);

  return (
    <div style={{
      marginTop: '6px',
      border: '1px solid rgba(236,72,153,0.2)',
      borderRadius: 'var(--radius-md)',
      padding: '8px',
      background: '#1a1a2e',
    }}>
      <div style={{
        fontSize: '0.6rem',
        fontWeight: 600,
        color: '#f472b6',
        marginBottom: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        <Search size={10} />
        Regex Match Simulator
      </div>
      <textarea
        value={testText}
        onChange={e => setTestText(e.target.value)}
        placeholder="Paste narrative text here to simulate what this regex will match/eat..."
        style={{
          width: '100%',
          minHeight: '60px',
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--text-primary)',
          padding: '6px',
          borderRadius: '4px',
          fontSize: '0.8rem',
          resize: 'vertical',
          marginBottom: '8px'
        }}
      />
      {testText && (
        <div style={{
          padding: '8px',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '4px',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '150px',
          overflowY: 'auto'
        }}>
          {highlightedElements}
        </div>
      )}
    </div>
  );
}

/** Toggle wrapper for RegexSimulatorPane */
function RegexSimulatorToggle({ regexStr }: { regexStr: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginTop: '4px' }}>
      <button
        onClick={() => setShow(p => !p)}
        className="btn btn-ghost btn-xs"
        style={{
          padding: '2px 8px',
          fontSize: '0.62rem',
          color: show ? '#f472b6' : 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: show ? 1 : 0.7,
        }}
      >
        <Search size={11} />
        {show ? 'Hide Simulator' : 'Test Regex Match'}
      </button>
      {show && <RegexSimulatorPane regexStr={regexStr} />}
    </div>
  );
}

/** Virtualized Table View — only renders visible rows */
function VirtualTableView({
  fields,
  updateField,
  retranslateField,
  applyModToField,
  phase,
  t,
  modEnabled,
}: {
  fields: any[];
  updateField: (path: string, update: any) => void;
  retranslateField: (path: string) => void;
  applyModToField: (path: string) => void;
  phase: string;
  t: Record<string, string>;
  modEnabled: boolean;
}) {
  const { setFields, fields: allFields, addToast, locale } = useStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const activeFields = useMemo(() => fields.filter(f => f.status !== 'translating'), [fields]);
  const allChecked = useMemo(() => {
    if (activeFields.length === 0) return false;
    return activeFields.every(f => f.status !== 'ignored');
  }, [activeFields]);

  const someChecked = useMemo(() => {
    return activeFields.some(f => f.status !== 'ignored');
  }, [activeFields]);

  const isIndeterminate = someChecked && !allChecked;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleHeaderCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    const targetPaths = new Set(activeFields.map(f => f.path));
    const nextFields = allFields.map(f => {
      if (targetPaths.has(f.path)) {
        if (checked) {
          if (f.status === 'ignored') {
            const nextStatus: TranslationStatus = f.translated?.trim() ? 'done' : 'pending';
            return { ...f, status: nextStatus };
          }
        } else {
          if (f.status !== 'ignored') {
            const nextStatus: TranslationStatus = 'ignored';
            return { ...f, status: nextStatus };
          }
        }
      }
      return f;
    });
    setFields(nextFields);
  };

  const handleRowCheckboxChange = (field: any, checked: boolean) => {
    if (checked) {
      const nextStatus = field.translated?.trim() ? 'done' : 'pending';
      updateField(field.path, { status: nextStatus });
    } else {
      updateField(field.path, { status: 'ignored' });
    }
  };

  const virtualizer = useVirtualizer({
    count: fields.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 80, []),
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      style={{
        maxHeight: '600px',
        overflowY: 'auto',
        overflowX: 'auto',
      }}
    >
      {/* Sticky header */}
      <table className="field-table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: '180px' }}>
              <label className="checkbox-wrapper" style={{ display: 'inline-flex', cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  ref={headerCheckboxRef}
                  checked={allChecked}
                  onChange={handleHeaderCheckboxChange}
                  disabled={phase === 'translating' || activeFields.length === 0}
                />
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                  {t.field}
                </span>
              </label>
            </th>
            <th style={{ width: '40%' }}>{t.original}</th>
            <th>{modEnabled ? t.modResult : t.translated}</th>
            <th style={{ width: '100px', textAlign: 'center' }}>{t.actions}</th>
          </tr>
        </thead>
      </table>

      {/* Virtualized body */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const field = fields[virtualRow.index];
          return (
            <div
              key={field.path}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <table className="field-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <tbody>
                  <tr
                    className={field.status === 'error' ? 'field-error' : ''}
                    style={{
                      opacity: field.status === 'ignored' ? 0.5 : 1,
                      transition: 'opacity 0.2s ease',
                    }}
                  >
                    {/* Field name */}
                    <td style={{ width: '180px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '2px', flexShrink: 0 }}>
                          <label className="checkbox-wrapper" style={{ cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={field.status !== 'ignored'}
                              onChange={(e) => handleRowCheckboxChange(field, e.target.checked)}
                              disabled={phase === 'translating'}
                            />
                          </label>
                          {(() => {
                            const baseKey = getFieldBaseKey(field.path);
                            const matchingFields = allFields.filter(f => getFieldBaseKey(f.path) === baseKey && f.path !== field.path);
                            if (matchingFields.length === 0) return null;
                            return (
                              <button
                                className="btn btn-ghost tooltip"
                                data-tooltip={locale === 'vi' ? `Áp dụng trạng thái chọn cho tất cả ${baseKey}` : `Apply selection to all ${baseKey}`}
                                onClick={() => {
                                  const targetStatus = field.status;
                                  const nextFields = allFields.map(f => {
                                    if (getFieldBaseKey(f.path) === baseKey) {
                                      if (targetStatus === 'ignored') {
                                        return { ...f, status: 'ignored' as const };
                                      } else {
                                        const activeStatus = f.translated?.trim() ? 'done' as const : 'pending' as const;
                                        return { ...f, status: activeStatus };
                                      }
                                    }
                                    return f;
                                  });
                                  setFields(nextFields);
                                  addToast('success', locale === 'vi' 
                                    ? `Đã áp dụng chọn cho tất cả các trường ${baseKey}` 
                                    : `Applied selection to all ${baseKey} fields`
                                  );
                                }}
                                disabled={phase === 'translating'}
                                style={{ padding: '2px', height: '18px', width: '18px', minHeight: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', opacity: 0.8 }}
                                title={locale === 'vi' ? `Áp dụng trạng thái chọn cho tất cả ${baseKey}` : `Apply selection to all ${baseKey}`}
                              >
                                <Zap size={10} />
                              </button>
                            );
                          })()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            className="field-name"
                            style={{
                              textDecoration: field.status === 'ignored' ? 'line-through' : 'none',
                              color: field.status === 'ignored' ? 'var(--text-muted)' : 'var(--accent-secondary)',
                            }}
                          >
                            {field.label}
                          </div>
                      <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                        {field.entryType === 'json_patch' && (
                          <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(236,72,153,0.1)', color: '#f472b6', borderRadius: '3px', fontWeight: 600 }}>PATCH</span>
                        )}
                        <StatusBadge status={field.status} t={t} />
                        {field.surgicalResult && <SurgicalResultBadge result={field.surgicalResult} />}
                        <CharRatio original={field.original} translated={field.translated} />
                      </div>
                      {field.error && (
                        <div
                          style={{
                            fontSize: '0.65rem',
                            color: 'var(--accent-danger)',
                            marginTop: '4px',
                            wordBreak: 'break-word',
                          }}
                        >
                          {field.error}
                        </div>
                      )}
                      {field.completedChunks && field.completedChunks.length > 0 && field.totalChunks && (
                        <div
                          style={{
                            fontSize: '0.6rem',
                            color: 'var(--accent-info)',
                            marginTop: '3px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span style={{
                            padding: '1px 5px',
                            background: 'rgba(124,106,240,0.12)',
                            borderRadius: '3px',
                            fontWeight: 600,
                          }}>
                            ✓ {field.completedChunks.length}/{field.totalChunks} chunks
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            — retry resumes from chunk {field.completedChunks.length + 1}
                          </span>
                        </div>
                      )}
                        </div>
                      </div>
                    </td>

                    {/* Original */}
                    <td style={{ width: '40%' }}>
                      <div className="field-original" style={{ position: 'relative', paddingRight: '24px' }}>
                        <div style={{ position: 'absolute', top: '2px', right: '2px', zIndex: 10 }}>
                          <CopyButton text={field.original} />
                        </div>
                        {field.original.length > 500
                          ? field.original.slice(0, 500) + '...'
                          : field.original}
                      </div>
                    </td>

                    {/* Translated */}
                    <td className="field-translated">
                      <textarea
                        value={field.translated}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateField(field.path, {
                            translated: val,
                            status: val.trim() ? 'done' : 'pending',
                            error: undefined
                          });
                        }}
                        placeholder={field.status === 'pending' ? 'Not translated yet' : ''}
                        rows={Math.min(Math.max(field.original.split('\n').length, 2), 8)}
                      />
                      {/* Show Regex Simulator toggle for findRegex fields */}
                      {field.group === 'regex' && field.path.includes('findRegex') && (
                        <RegexSimulatorToggle regexStr={field.translated || field.original} />
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ width: '100px' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          className="btn btn-ghost btn-xs tooltip"
                          data-tooltip={t.ignored}
                          onClick={() => updateField(field.path, { status: field.status === 'ignored' ? 'pending' : 'ignored' })}
                          disabled={phase === 'translating'}
                          style={{ padding: '4px' }}
                        >
                          {field.status === 'ignored' ? <RotateCcw size={14} /> : <Ban size={14} />}
                        </button>
                        {modEnabled ? (
                          <>
                            <button
                              className="btn btn-ghost btn-xs tooltip"
                              data-tooltip={t.modField}
                              onClick={() => applyModToField(field.path)}
                              disabled={phase === 'translating'}
                              style={{ padding: '4px', color: '#9b59b6' }}
                            >
                              <Wand2 size={14} />
                            </button>
                            <button
                              className="btn btn-ghost btn-xs tooltip"
                              data-tooltip={t.retranslate}
                              onClick={() => retranslateField(field.path)}
                              disabled={phase === 'translating'}
                              style={{ padding: '4px', opacity: 0.5 }}
                            >
                              <RotateCcw size={14} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn btn-ghost btn-xs tooltip"
                            data-tooltip={t.retranslate}
                            onClick={() => retranslateField(field.path)}
                            disabled={phase === 'translating'}
                            style={{ padding: '4px' }}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Virtualized Diff View */
function VirtualDiffView({
  fields,
  updateField,
  retranslateField,
  applyModToField,
  phase,
  t,
  modEnabled,
}: {
  fields: any[];
  updateField: (path: string, update: any) => void;
  retranslateField: (path: string) => void;
  applyModToField: (path: string) => void;
  phase: string;
  t: Record<string, string>;
  modEnabled: boolean;
}) {
  const { setFields, fields: allFields, addToast, locale } = useStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const activeFields = useMemo(() => fields.filter(f => f.status !== 'translating'), [fields]);
  const allChecked = useMemo(() => {
    if (activeFields.length === 0) return false;
    return activeFields.every(f => f.status !== 'ignored');
  }, [activeFields]);

  const someChecked = useMemo(() => {
    return activeFields.some(f => f.status !== 'ignored');
  }, [activeFields]);

  const isIndeterminate = someChecked && !allChecked;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleHeaderCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    const targetPaths = new Set(activeFields.map(f => f.path));
    const nextFields = allFields.map(f => {
      if (targetPaths.has(f.path)) {
        if (checked) {
          if (f.status === 'ignored') {
            const nextStatus: TranslationStatus = f.translated?.trim() ? 'done' : 'pending';
            return { ...f, status: nextStatus };
          }
        } else {
          if (f.status !== 'ignored') {
            const nextStatus: TranslationStatus = 'ignored';
            return { ...f, status: nextStatus };
          }
        }
      }
      return f;
    });
    setFields(nextFields);
  };

  const handleRowCheckboxChange = (field: any, checked: boolean) => {
    if (checked) {
      const nextStatus = field.translated?.trim() ? 'done' : 'pending';
      updateField(field.path, { status: nextStatus });
    } else {
      updateField(field.path, { status: 'ignored' });
    }
  };

  const virtualizer = useVirtualizer({
    count: fields.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 160, []),
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      style={{ padding: '12px 20px', maxHeight: '700px', overflowY: 'auto' }}
    >
      {/* Bulk selection header for Diff View */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 8px 12px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: '12px',
      }}>
        <label className="checkbox-wrapper" style={{ display: 'inline-flex', cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            ref={headerCheckboxRef}
            checked={allChecked}
            onChange={handleHeaderCheckboxChange}
            disabled={phase === 'translating' || activeFields.length === 0}
          />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {allChecked ? 'Deselect All' : 'Select All'}
          </span>
        </label>
      </div>

      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const field = fields[virtualRow.index];
          return (
            <div
              key={field.path}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: '8px',
              }}
            >
              <div
                style={{
                  padding: '12px',
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${field.status === 'error' ? 'var(--accent-danger)' : 'var(--border-subtle)'}`,
                  opacity: field.status === 'ignored' ? 0.5 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: '8px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <label className="checkbox-wrapper" style={{ cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={field.status !== 'ignored'}
                          onChange={(e) => handleRowCheckboxChange(field, e.target.checked)}
                          disabled={phase === 'translating'}
                        />
                      </label>
                      {(() => {
                        const baseKey = getFieldBaseKey(field.path);
                        const matchingFields = allFields.filter(f => getFieldBaseKey(f.path) === baseKey && f.path !== field.path);
                        if (matchingFields.length === 0) return null;
                        return (
                          <button
                            className="btn btn-ghost tooltip"
                            data-tooltip={locale === 'vi' ? `Áp dụng trạng thái chọn cho tất cả ${baseKey}` : `Apply selection to all ${baseKey}`}
                            onClick={() => {
                              const targetStatus = field.status;
                              const nextFields = allFields.map(f => {
                                if (getFieldBaseKey(f.path) === baseKey) {
                                  if (targetStatus === 'ignored') {
                                    return { ...f, status: 'ignored' as const };
                                  } else {
                                    const activeStatus = f.translated?.trim() ? 'done' as const : 'pending' as const;
                                    return { ...f, status: activeStatus };
                                  }
                                }
                                return f;
                              });
                              setFields(nextFields);
                              addToast('success', locale === 'vi' 
                                ? `Đã áp dụng chọn cho tất cả các trường ${baseKey}` 
                                : `Applied selection to all ${baseKey} fields`
                              );
                            }}
                            disabled={phase === 'translating'}
                            style={{ padding: '2px', height: '18px', width: '18px', minHeight: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', opacity: 0.8 }}
                            title={locale === 'vi' ? `Áp dụng trạng thái chọn cho tất cả ${baseKey}` : `Apply selection to all ${baseKey}`}
                          >
                            <Zap size={10} />
                          </button>
                        );
                      })()}
                    </div>
                    <span style={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      textDecoration: field.status === 'ignored' ? 'line-through' : 'none',
                      color: field.status === 'ignored' ? 'var(--text-muted)' : 'var(--text-primary)',
                    }}>
                      {field.label}
                    </span>
                    {field.entryType === 'json_patch' && (
                      <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(236,72,153,0.1)', color: '#f472b6', borderRadius: '3px', fontWeight: 600 }}>PATCH</span>
                    )}
                    <StatusBadge status={field.status} t={t} />
                    <CharRatio original={field.original} translated={field.translated} />
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="btn btn-ghost btn-xs tooltip"
                      data-tooltip={t.ignored}
                      onClick={() => updateField(field.path, { status: field.status === 'ignored' ? 'pending' : 'ignored' })}
                      disabled={phase === 'translating'}
                      style={{ padding: '3px 6px' }}
                    >
                      {field.status === 'ignored' ? <RotateCcw size={12} /> : <Ban size={12} />}
                    </button>
                    {modEnabled ? (
                      <>
                        <button
                          className="btn btn-ghost btn-xs tooltip"
                          data-tooltip={t.modField}
                          onClick={() => applyModToField(field.path)}
                          disabled={phase === 'translating'}
                          style={{ padding: '3px 6px', color: '#9b59b6' }}
                        >
                          <Wand2 size={12} />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs tooltip"
                          data-tooltip={t.retranslate}
                          onClick={() => retranslateField(field.path)}
                          disabled={phase === 'translating'}
                          style={{ padding: '3px 6px', opacity: 0.5 }}
                        >
                          <RotateCcw size={12} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost btn-xs tooltip"
                        data-tooltip={t.retranslate}
                        onClick={() => retranslateField(field.path)}
                        disabled={phase === 'translating'}
                        style={{ padding: '3px 6px' }}
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <DiffView original={field.original} translated={field.translated} />
                {/* Show HTML preview toggle for regex fields */}
                {field.group === 'regex' && field.path.includes('replaceString') && field.translated && (
                  <HtmlPreviewToggle html={field.translated} />
                )}
                {/* Show Regex Simulator toggle for findRegex fields */}
                {field.group === 'regex' && field.path.includes('findRegex') && (
                  <RegexSimulatorToggle regexStr={field.translated || field.original} />
                )}
                {field.error && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--accent-danger)', marginTop: '6px' }}>
                    {field.error}
                  </div>
                )}
                {field.completedChunks && field.completedChunks.length > 0 && field.totalChunks && (
                  <div
                    style={{
                      fontSize: '0.6rem',
                      color: 'var(--accent-info)',
                      marginTop: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span style={{
                      padding: '1px 5px',
                      background: 'rgba(124,106,240,0.12)',
                      borderRadius: '3px',
                      fontWeight: 600,
                    }}>
                      ✓ {field.completedChunks.length}/{field.totalChunks} chunks
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      — retry resumes from chunk {field.completedChunks.length + 1}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FieldEditor() {
  const { fields, updateField, phase, translationConfig } = useStore();
  const { retranslateField, applyModToField } = useTranslation();
  const t = useT();
  const modEnabled = Boolean(translationConfig.enableModMode && translationConfig.modInstructions?.trim());
  const tabLabels = useTabLabels();
  const [activeTab, setActiveTab] = useState<FieldGroup | 'all'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'diff'>('table');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFields = useMemo(() => {
    let result = activeTab === 'all' ? fields : fields.filter((f) => f.group === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.original.toLowerCase().includes(q) ||
          f.translated.toLowerCase().includes(q) ||
          f.path.toLowerCase().includes(q)
      );
    }
    return result;
  }, [fields, activeTab, searchQuery]);

  // Count fields per tab
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: fields.length };
    for (const f of fields) {
      counts[f.group] = (counts[f.group] || 0) + 1;
    }
    return counts;
  }, [fields]);

  if (fields.length === 0) return null;

  return (
    <div className="card fade-in" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            {modEnabled && (
              <Wand2 size={16} style={{ color: '#9b59b6' }} />
            )}
            {modEnabled ? t.modFieldEditor : t.fieldEditor}
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              ({filteredFields.length} fields)
            </span>
          </h3>
          {/* Search box */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            flex: '0 1 260px',
            minWidth: '160px',
            transition: 'border-color 0.2s',
          }}>
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.search}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                outline: 'none',
                padding: '2px 0',
                minWidth: 0,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 0,
                  display: 'flex',
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {/* View mode toggle */}
          <div style={{
            display: 'flex', gap: '2px',
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px',
            border: '1px solid var(--border-subtle)',
          }}>
            <button
              onClick={() => setViewMode('table')}
              style={{
                padding: '3px 8px',
                fontSize: '0.7rem',
                fontWeight: viewMode === 'table' ? 600 : 400,
                background: viewMode === 'table' ? 'rgba(124,106,240,0.12)' : 'transparent',
                color: viewMode === 'table' ? 'var(--accent-primary)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('diff')}
              style={{
                padding: '3px 8px',
                fontSize: '0.7rem',
                fontWeight: viewMode === 'diff' ? 600 : 400,
                background: viewMode === 'diff' ? 'rgba(124,106,240,0.12)' : 'transparent',
                color: viewMode === 'diff' ? 'var(--accent-primary)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <ArrowLeftRight size={11} />
              Diff
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ overflowX: 'auto' }}>
          {TAB_IDS.map((tabId) => {
            const count = tabCounts[tabId] || 0;
            if (tabId !== 'all' && count === 0) return null;
            return (
              <button
                key={tabId}
                className={`tab ${activeTab === tabId ? 'tab-active' : ''}`}
                onClick={() => setActiveTab(tabId)}
              >
                {tabLabels[tabId] || tabId}
                {count > 0 && (
                  <span style={{ opacity: 0.7, marginLeft: '4px', fontSize: '0.7rem' }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Virtualized Diff View */}
      {viewMode === 'diff' && (
        <VirtualDiffView
          fields={filteredFields}
          updateField={updateField}
          retranslateField={retranslateField}
          applyModToField={applyModToField}
          phase={phase}
          t={t}
          modEnabled={modEnabled}
        />
      )}

      {/* Virtualized Table View */}
      {viewMode === 'table' && (
        <VirtualTableView
          fields={filteredFields}
          updateField={updateField}
          retranslateField={retranslateField}
          applyModToField={applyModToField}
          phase={phase}
          t={t}
          modEnabled={modEnabled}
        />
      )}
    </div>
  );
}

/** Status badge mini-component */
function StatusBadge({ status, t }: { status: string; t: Record<string, string> }) {
  if (status === 'done') {
    return (
      <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>
        <CheckCircle2 size={8} /> {t.done}
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="badge badge-warning" style={{ fontSize: '0.65rem', background: 'var(--accent-warning)', color: '#fff', border: 'none' }}>
        <CheckCircle2 size={8} /> Bỏ qua
      </span>
    );
  }
  if (status === 'ignored') {
    return (
      <span className="badge badge-neutral" style={{ fontSize: '0.65rem', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
        <Ban size={8} /> {t.ignored || 'Bỏ qua (không dịch)'}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>
        <AlertTriangle size={8} /> {t.error}
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>
        <Clock size={8} /> Pending
      </span>
    );
  }
  if (status === 'translating') {
    return (
      <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
        Translating...
      </span>
    );
  }
  return null;
}
