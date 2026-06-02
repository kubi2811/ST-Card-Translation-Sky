import { useState, useMemo } from 'react';
import { useStore } from '../store';
import { buildUnifiedRAGContextWithDebug, type RAGDebugInfo } from '../utils/ragContext';
import type { TranslationField } from '../types/card';

interface RAGDebugPanelProps {
  field: TranslationField;
  onClose: () => void;
}

export default function RAGDebugPanel({ field, onClose }: RAGDebugPanelProps) {
  const { fields, translationConfig } = useStore();
  const [showFullContext, setShowFullContext] = useState(false);

  const result = useMemo(() => {
    return buildUnifiedRAGContextWithDebug({
      currentField: field,
      allFields: fields,
      glossary: translationConfig.glossary,
      mvuDictionary: translationConfig.enableMvuSync ? translationConfig.mvuDictionary : undefined,
      customSchema: translationConfig.customSchema,
      maxFields: translationConfig.ragMaxFields,
      maxChars: translationConfig.ragMaxChars,
    });
  }, [field, fields, translationConfig]);

  const debug = result.debugInfo;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-primary, #1a1a2e)',
        border: '1px solid var(--border-subtle, #333)',
        borderRadius: '12px',
        maxWidth: '700px',
        width: '100%',
        maxHeight: '80vh',
        overflow: 'auto',
        padding: '20px',
        color: 'var(--text-primary, #eee)',
        fontSize: '0.82rem',
        lineHeight: '1.5',
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>🧠 RAG Debug — {field.label}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >✕</button>
        </div>

        {/* Budget Summary */}
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '12px',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--accent-primary, #88f)' }}>📊 Budget</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '0.78rem' }}>
            <span>Characters: {debug.budgetUsed.chars.toLocaleString()} / {debug.budgetUsed.maxChars.toLocaleString()}</span>
            <span>Fields: {debug.budgetUsed.fields} / {debug.budgetUsed.maxFields}</span>
            <span>TF-IDF terms: {debug.tfidfTermCount.toLocaleString()}</span>
            <span>Compute: {debug.computeTimeMs}ms</span>
          </div>
          <div style={{
            marginTop: '6px',
            height: '4px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, (debug.budgetUsed.chars / debug.budgetUsed.maxChars) * 100)}%`,
              background: debug.budgetUsed.chars > debug.budgetUsed.maxChars * 0.9 ? '#f44' : '#4f4',
              borderRadius: '2px',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {/* Selected Fields */}
        {debug.selectedFields.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--accent-primary, #88f)' }}>
              📋 Selected Fields ({debug.selectedFields.length})
            </div>
            <div style={{ fontSize: '0.75rem' }}>
              {debug.selectedFields.map((sf, i) => (
                <div key={i} style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '3px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <span style={{
                    background: sf.tier === 'must-include' ? '#2a5' : sf.tier === 'high-priority' ? '#e93' : '#66f',
                    color: '#fff',
                    padding: '1px 6px',
                    borderRadius: '3px',
                    fontSize: '0.68rem',
                    whiteSpace: 'nowrap',
                  }}>{sf.tier}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sf.label}
                  </span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {sf.score.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Glossary Hits */}
        {debug.glossaryHits.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--accent-primary, #88f)' }}>
              📖 Glossary Hits ({debug.glossaryHits.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', fontSize: '0.72rem' }}>
              {debug.glossaryHits.map((gh, i) => (
                <span key={i} style={{
                  background: gh.matchType === 'exact' ? 'rgba(0,200,0,0.2)' :
                    gh.matchType === 'substring' ? 'rgba(200,150,0,0.2)' :
                    gh.matchType === 'group' ? 'rgba(100,100,255,0.2)' :
                    gh.matchType === 'reverse' ? 'rgba(200,0,200,0.2)' :
                    'rgba(255,255,255,0.05)',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}>
                  {gh.matchType === 'exact' ? '⚡' :
                   gh.matchType === 'substring' ? '📎' :
                   gh.matchType === 'group' ? '🔗' :
                   gh.matchType === 'reverse' ? '🔄' : '📋'}{' '}
                  {gh.term}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Full Context Toggle */}
        <div>
          <button
            onClick={() => setShowFullContext(!showFullContext)}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.78rem',
              width: '100%',
              textAlign: 'left',
            }}
          >
            {showFullContext ? '▼' : '▶'} Full RAG Context ({result.contextString.length.toLocaleString()} chars)
          </button>
          {showFullContext && (
            <pre style={{
              marginTop: '8px',
              background: 'rgba(0,0,0,0.3)',
              padding: '10px',
              borderRadius: '6px',
              fontSize: '0.7rem',
              lineHeight: '1.4',
              maxHeight: '300px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-secondary, #aaa)',
            }}>
              {result.contextString || '(empty — no context generated)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
