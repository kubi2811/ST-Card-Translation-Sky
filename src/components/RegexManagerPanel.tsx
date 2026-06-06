import React, { useState, useMemo, useCallback } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT } from '../i18n/useLocale';
import { X, Regex, Languages, Save, Check, Loader2, Sparkles } from 'lucide-react';
import type { RegexScript } from '../types/card';
import AiCompanionPanel from './AiCompanionPanel';

/* ════════════════════════════════════════════════════════════════════
   HELPER: Render fully interactive HTML preview with jQuery & ST CSS
   ════════════════════════════════════════════════════════════════════ */
const renderSafeHtml = (htmlContent: string) => {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <style>
          body {
            margin: 0;
            padding: 12px 16px;
            background: #0f0f12;
            color: #e8e6f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 0.9rem;
            line-height: 1.7;
          }
          /* Custom SillyTavern Chat Bubble CSS */
          .chinh_van {
            border-left: 3px solid #6366f1;
            padding-left: 10px;
            margin: 4px 0;
            color: #c7d2fe;
          }
          .thoai {
            color: #67e8f9;
            font-style: italic;
          }
          .hanhdong {
            color: #fbbf24;
            font-style: italic;
            font-family: monospace;
          }
          .suy_nghi {
            color: #c084fc;
            font-style: italic;
            opacity: 0.85;
          }
          .regex-error {
            color: #f06a6a;
            font-family: monospace;
            font-size: 0.8rem;
            padding: 4px 8px;
            background: rgba(240, 106, 106, 0.1);
            border-radius: 4px;
          }
          
          /* Native ST/Tavern accordion details */
          .section {
            border-bottom: 1px solid #2a2a3e;
            margin-bottom: 6px;
          }
          .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            background: #16161e;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.85rem;
            color: #a09cb5;
            transition: background 0.15s;
          }
          .section-header:hover {
            background: #2a2a3e;
            color: #e8e6f0;
          }
          .section-content {
            padding: 12px 14px;
            font-size: 0.82rem;
            color: #e8e6f0;
          }
          .hidden {
            display: none !important;
          }
          .divider {
            height: 1px;
            background: #2a2a3e;
            margin: 8px 0;
          }
          ul.scroll-list {
            list-style: none;
            padding: 0;
            margin: 0;
            overflow-y: auto;
          }
          li.list-item {
            display: flex;
            justify-content: space-between;
            padding: 6px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.03);
          }
          .badge {
            font-size: 0.7rem;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 99px;
            background: rgba(160,156,181,0.1);
            color: #a09cb5;
            margin-left: 6px;
          }
        </style>
      </head>
      <body>
        <div class="st-preview">
          ${htmlContent}
        </div>
        
        <script>
          // Automatic accordion toggler fallback for ST-style script accordions
          $(document).ready(function() {
            // Bind section togglers
            $(document).on('click', '.section-header', function() {
              $(this).toggleClass('collapsed');
              $(this).next('.section-content').toggleClass('hidden');
            });
            
            // Log interaction
            console.log('ST Accoridon and Event fallback binders executed.');
          });
        </script>
      </body>
    </html>
  `;
};

/* ════════════════════════════════════════════════════════════════════
   TYPES
   ════════════════════════════════════════════════════════════════════ */
interface RegexFieldRow {
  scriptIndex: number;
  scriptName: string;
  fieldKey: 'scriptName' | 'findRegex' | 'replaceString' | 'trimStrings';
  subIndex?: number;           // for trimStrings array items
  original: string;
  translated: string;
  status: 'pending' | 'translating' | 'done' | 'error';
  error?: string;
}

/* ════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════ */
export default function RegexManagerPanel({ onClose, isFullscreen }: { onClose: () => void; isFullscreen?: boolean }) {
  const t = useT();
  const { card, updateCard, addToast, fields, updateField, phase } = useStore();
  const { retranslateField, cancelTranslation } = useTranslation();

  // ─── Regex scripts from card ───
  const scripts: RegexScript[] = useMemo(
    () => card?.data?.extensions?.regex_scripts || [],
    [card]
  );

  // ─── State ───
  const [selectedScriptIdx, setSelectedScriptIdx] = useState<number>(0);
  const [showAiChat, setShowAiChat] = useState(false);

  // ─── Build field rows from store fields (reactive to translation progress) ───
  const fieldRows = useMemo((): (RegexFieldRow & { path: string })[] => {
    const regexFields = fields.filter(f => f.group === 'regex');
    return regexFields.map(f => {
      const match = f.path.match(/data\.extensions\.regex_scripts\[(\d+)\]\.(\w+)(?:\[(\d+)\])?/);
      if (!match) return null;

      const scriptIdx = parseInt(match[1]);
      const fieldKey = match[2] as 'scriptName' | 'findRegex' | 'replaceString' | 'trimStrings';
      const subIdx = match[3] !== undefined ? parseInt(match[3]) : undefined;
      const script = scripts[scriptIdx];
      const scriptName = script?.scriptName || `Script ${scriptIdx + 1}`;

      return {
        scriptIndex: scriptIdx,
        scriptName,
        fieldKey,
        subIndex: subIdx,
        original: f.original,
        translated: f.translated || '',
        status: f.status === 'ignored' || f.status === 'skipped' ? 'pending' : (f.status as any),
        error: f.error,
        path: f.path,
      };
    }).filter(Boolean) as (RegexFieldRow & { path: string })[];
  }, [fields, scripts]);

  const isTranslating = phase === 'translating';

  // ─── Translate all fields ───
  const handleTranslateAll = async () => {
    const pendingRegexFields = fields.filter(f => f.group === 'regex' && f.status !== 'done');
    if (pendingRegexFields.length === 0) {
      addToast('info', 'Không có trường regex nào cần dịch hoặc tất cả đã dịch xong');
      return;
    }

    addToast('info', `Bắt đầu dịch ${pendingRegexFields.length} trường regex...`);
    for (const f of pendingRegexFields) {
      try {
        await retranslateField(f.path);
      } catch (err) {
        console.error(`Failed to translate ${f.path}:`, err);
      }
    }
  };

  // ─── Apply translations back to card ───
  const handleApplyToCard = () => {
    if (!card) return;
    const newCard = JSON.parse(JSON.stringify(card));
    const regexScripts = newCard.data?.extensions?.regex_scripts;
    if (!regexScripts) return;

    let applied = 0;
    fieldRows.forEach(row => {
      if (row.status !== 'done' || !row.translated.trim()) return;
      const script = regexScripts[row.scriptIndex];
      if (!script) return;

      if (row.fieldKey === 'replaceString') {
        script.replaceString = row.translated;
        applied++;
      } else if (row.fieldKey === 'scriptName') {
        script.scriptName = row.translated;
        applied++;
      } else if (row.fieldKey === 'findRegex') {
        script.findRegex = row.translated;
        applied++;
      } else if (row.fieldKey === 'trimStrings' && row.subIndex !== undefined) {
        if (script.trimStrings && script.trimStrings[row.subIndex] !== undefined) {
          script.trimStrings[row.subIndex] = row.translated;
          applied++;
        }
      }
    });

    updateCard(newCard);
    addToast('success', `Đã áp dụng ${applied} bản dịch regex vào card`);
  };

  // ─── Cancel translation ───
  const handleCancel = () => {
    cancelTranslation();
  };



  // ─── Stats ───
  const doneCount = fieldRows.filter(r => r.status === 'done').length;
  const errorCount = fieldRows.filter(r => r.status === 'error').length;
  const totalCount = fieldRows.length;

  return (
    <div className={isFullscreen ? "regex-fullscreen-container" : "regex-modal-overlay"} onClick={isFullscreen ? undefined : onClose}>
      <div className={isFullscreen ? "regex-fullscreen-main" : "regex-modal"} onClick={e => e.stopPropagation()}>
        {/* ══════ LEFT SIDEBAR ══════ */}
        <div className="regex-sidebar">
          {/* Header */}
          <div style={{
            padding: '16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, #f97316, #ef4444)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Regex size={14} color="white" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Regex Manager</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                {scripts.length} script{scripts.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: '4px',
            }}>
              <X size={16} />
            </button>
          </div>

          {/* Script list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {scripts.length === 0 ? (
              <div style={{
                padding: '20px 12px', textAlign: 'center',
                color: 'var(--text-muted)', fontSize: '0.75rem',
              }}>
                Card không có regex scripts
              </div>
            ) : (
              scripts.map((script, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedScriptIdx(idx)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    marginBottom: '2px',
                    background: selectedScriptIdx === idx ? 'var(--bg-hover)' : 'transparent',
                    border: selectedScriptIdx === idx ? '1px solid var(--border-default)' : '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    color: selectedScriptIdx === idx ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '0.78rem',
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <Regex size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {script.scriptName || `Script ${idx + 1}`}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Bottom stats */}
          {totalCount > 0 && (
            <div style={{
              padding: '10px 12px',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>{doneCount}/{totalCount} đã dịch</span>
              {errorCount > 0 && <span style={{ color: 'var(--accent-danger)' }}>{errorCount} lỗi</span>}
            </div>
          )}

          {/* AI Chat button */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            <button
              onClick={() => setShowAiChat(true)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(168, 85, 247, 0.1)',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                borderRadius: 'var(--radius-sm)',
                color: '#c084fc',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontSize: '0.78rem',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.3)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(168, 85, 247, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.2)';
              }}
            >
              <Sparkles size={12} style={{ flexShrink: 0 }} />
              <span>Trợ lý AI</span>
            </button>
          </div>
        </div>

        {/* ══════ RIGHT MAIN ══════ */}
        <div className="regex-main">
          {/* Header */}
          <div style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Languages size={14} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Dịch Regex</span>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {isTranslating ? (
                <button className="btn btn-danger btn-sm" onClick={handleCancel}>
                  <X size={12} /> Hủy
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleTranslateAll} disabled={scripts.length === 0}>
                  <Languages size={12} /> Dịch tất cả
                </button>
              )}
              {doneCount > 0 && !isTranslating && (
                <button className="btn btn-secondary btn-sm" onClick={handleApplyToCard}>
                  <Save size={12} /> Áp dụng vào Card
                </button>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAiChat(true)}
                style={{
                  color: '#c084fc',
                  borderColor: 'rgba(168, 85, 247, 0.3)',
                  background: 'rgba(168, 85, 247, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Sparkles size={12} /> Trợ lý AI
              </button>
            </div>
          </div>

          {/* ─── Content ─── */}
          <div className="regex-main-scroll">
            {scripts.length > 0 && fieldRows.length === 0 && (
              <div style={{
                padding: '12px 20px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderBottom: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                fontSize: '0.78rem',
                textAlign: 'center',
              }}>
                ⚠️ Nhóm trường "Regex Scripts" đang bị tắt trong Cấu hình dịch thuật. Vui lòng bật lên để dịch Regex.
              </div>
            )}
            <FieldsTab
              scripts={scripts}
              selectedScriptIdx={selectedScriptIdx}
              fieldRows={fieldRows}
              updateField={updateField}
              isTranslating={isTranslating}
            />
          </div>
        {showAiChat && (
          <AiCompanionPanel onClose={() => setShowAiChat(false)} />
        )}
      </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 1: Fields — list translatable regex fields
   ════════════════════════════════════════════════════════════════════ */
function FieldsTab({
  scripts,
  selectedScriptIdx,
  fieldRows,
  updateField,
  isTranslating,
}: {
  scripts: RegexScript[];
  selectedScriptIdx: number;
  fieldRows: (RegexFieldRow & { path: string })[];
  updateField: (path: string, update: any) => void;
  isTranslating: boolean;
}) {
  const selectedScript = scripts[selectedScriptIdx];
  if (!selectedScript) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        <Regex size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
        <div style={{ fontSize: '0.85rem' }}>Chọn một regex script từ sidebar</div>
      </div>
    );
  }

  // Filter rows for this script
  const scriptRows = fieldRows.filter(r => r.scriptIndex === selectedScriptIdx);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Script info header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
          {selectedScript.scriptName || `Script ${selectedScriptIdx + 1}`}
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.72rem' }}>
          <DetailBadge label="findRegex" value={selectedScript.findRegex || '—'} />
          <DetailBadge label="replaceString" value={(selectedScript.replaceString || '').slice(0, 60) + ((selectedScript.replaceString || '').length > 60 ? '...' : '')} />
          {selectedScript.trimStrings?.length ? (
            <DetailBadge label="trimStrings" value={`${selectedScript.trimStrings.length} items`} />
          ) : null}
        </div>
      </div>

      {/* Field rows */}
      {scriptRows.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '30px',
          color: 'var(--text-muted)', fontSize: '0.8rem',
        }}>
          Script này không có trường cần dịch (chỉ có findRegex pattern — không dịch)
        </div>
      ) : (
        scriptRows.map((row, rIdx) => {
          const globalIdx = fieldRows.findIndex(
            r => r.scriptIndex === row.scriptIndex && r.fieldKey === row.fieldKey && r.subIndex === row.subIndex
          );
          return (
            <div key={rIdx} style={{
              padding: '12px 14px',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${
                row.status === 'error' ? 'rgba(240,106,106,0.3)' :
                row.status === 'done' ? 'rgba(106,240,138,0.2)' :
                row.status === 'translating' ? 'rgba(124,106,240,0.3)' :
                'var(--border-subtle)'
              }`,
              transition: 'border-color 0.2s',
            }}>
              {/* Field header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '8px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <code style={{
                    fontSize: '0.7rem', color: 'var(--accent-secondary)',
                    background: 'var(--bg-elevated)', padding: '2px 6px',
                    borderRadius: '3px', fontFamily: 'var(--font-mono)',
                  }}>
                    {row.fieldKey}{row.subIndex !== undefined ? `[${row.subIndex}]` : ''}
                  </code>
                  {row.status === 'done' && <Check size={12} style={{ color: 'var(--accent-success)' }} />}
                  {row.status === 'translating' && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />}
                  {row.status === 'error' && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--accent-danger)' }}>
                      {row.error?.slice(0, 40)}
                    </span>
                  )}
                </div>
              </div>

              {/* Original */}
              <div style={{ marginBottom: '6px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Original:</div>
                <pre style={{
                  fontSize: '0.78rem', color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  maxHeight: '120px', overflowY: 'auto',
                  background: 'var(--bg-secondary)', padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
                  margin: 0,
                }}>
                  {row.original || '(trống)'}
                </pre>
              </div>

              {/* Translated */}
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Translated:</div>
                <textarea
                  value={row.translated}
                  onChange={(e) => {
                    updateField(row.path, {
                      translated: e.target.value,
                      status: e.target.value.trim() ? 'done' : 'pending'
                    });
                  }}
                  disabled={isTranslating}
                  style={{
                    width: '100%', minHeight: '50px',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem', resize: 'vertical', outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  placeholder="Bản dịch sẽ xuất hiện ở đây..."
                />
              </div>

              {/* HTML Preview for replaceString */}
              {row.fieldKey === 'replaceString' && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Xem trước giao diện (Gốc & Dịch):</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Original Preview:</div>
                      <iframe
                        title="Original Preview"
                        srcDoc={renderSafeHtml((row.original || '').replace(/\$[0-9&]+/g, 'Nội dung mẫu'))}
                        sandbox="allow-scripts"
                        style={{
                          width: '100%',
                          height: '240px',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          background: '#0f0f12',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Translated Preview:</div>
                      <iframe
                        title="Translated Preview"
                        srcDoc={renderSafeHtml((row.translated || row.original || '').replace(/\$[0-9&]+/g, 'Nội dung mẫu'))}
                        sandbox="allow-scripts"
                        style={{
                          width: '100%',
                          height: '240px',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          background: '#0f0f12',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function DetailBadge({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: 'var(--bg-elevated)', padding: '2px 8px',
      borderRadius: '4px', fontFamily: 'var(--font-mono)',
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </span>
  );
}
