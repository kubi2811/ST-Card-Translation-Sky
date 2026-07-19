import { useStore } from '../store';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useT, useUi } from '../i18n/useLocale';
import { Eye, ChevronDown, ChevronRight, Languages, BookOpen } from 'lucide-react';
import { useState, useMemo } from 'react';
import StPreviewModal from './StPreviewModal';

/* ─── Map field paths to translated values ─── */
function useTranslatedFields(): Map<string, string> {
  // (bugNeedFix/39) throttle: trước đây mỗi updateField dựng lại Map trên 605 field + re-render preview.
  const fields = useThrottledStore((s) => s.fields, 250);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fields) {
      if (f.status === 'done' && f.translated) {
        map.set(f.path, f.translated);
      }
    }
    return map;
  }, [fields]);
}

export default function CardPreview() {
  const card = useStore((s) => s.card);
  const contentType = useStore((s) => s.contentType);
  const t = useT();
  const ui = useUi() as Record<string, string>;
  const translated = useTranslatedFields();
  const [showStPreview, setShowStPreview] = useState(false);
  if (!card) return null;

  const isWorldbook = contentType === 'worldbook';
  const hasTranslations = translated.size > 0;

  // Helper: get translated text or original
  const tv = (dataPath: string, rootPath: string, original?: string) => {
    return translated.get(dataPath) || translated.get(rootPath) || original || '';
  };

  return (
    <div className="card fade-in" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {isWorldbook ? (
            <BookOpen size={18} style={{ color: 'var(--accent-secondary)' }} />
          ) : (
            <Eye size={18} style={{ color: 'var(--accent-secondary)' }} />
          )}
          {isWorldbook ? t.worldbookMode : t.cardPreview}
        </h3>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isWorldbook && (
            <button
              onClick={() => setShowStPreview(true)}
              title={ui.spBtnHint}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '0.68rem', fontWeight: 600, padding: '3px 10px', cursor: 'pointer',
                background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.4)',
                borderRadius: 'var(--radius-sm)', color: 'var(--accent-secondary)',
              }}
            >
              <Eye size={11} /> {ui.spBtn}
            </button>
          )}
          {hasTranslations && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '0.65rem', padding: '2px 8px',
              background: 'rgba(124,106,240,0.1)', borderRadius: 'var(--radius-sm)',
              color: 'var(--accent-primary)', fontWeight: 600,
            }}>
              <Languages size={10} /> Translated
            </span>
          )}
        </span>
      </div>

      {showStPreview && <StPreviewModal onClose={() => setShowStPreview(false)} />}

      {isWorldbook ? (
        <WorldbookPreview card={card} translated={translated} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <PreviewField label="Name" value={tv('data.name', 'name', card.data?.name || card.name)} />
          <PreviewField label="Description" value={tv('data.description', 'description', card.data?.description || card.description)} truncate />
          <PreviewField label="Personality" value={tv('data.personality', 'personality', card.data?.personality || card.personality)} truncate />
          <PreviewField label="Scenario" value={tv('data.scenario', 'scenario', card.data?.scenario || card.scenario)} truncate />
          <PreviewField label="First Message" value={tv('data.first_mes', 'first_mes', card.data?.first_mes || card.first_mes)} truncate />
          {(translated.has('data.system_prompt') || card.data?.system_prompt) && (
            <PreviewField label="System Prompt" value={tv('data.system_prompt', 'system_prompt', card.data?.system_prompt)} truncate />
          )}
          {card.data?.alternate_greetings && card.data.alternate_greetings.length > 0 && (
            <PreviewField
              label={`Alt Greetings (${card.data.alternate_greetings.length})`}
              value={translated.get('data.alternate_greetings[0]') || card.data.alternate_greetings[0]}
              truncate
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Worldbook Preview: shows first N entries ─── */
function WorldbookPreview({ card, translated }: { card: any; translated: Map<string, string> }) {
  const entries = card.data?.character_book?.entries || [];
  const [showAll, setShowAll] = useState(false);
  const maxPreview = 5;
  const displayEntries = showAll ? entries : entries.slice(0, maxPreview);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {displayEntries.map((entry: any, i: number) => {
        const name = translated.get(`data.character_book.entries[${i}].name`) || entry.name || `Entry ${i}`;
        const content = translated.get(`data.character_book.entries[${i}].content`) || entry.content || '';
        const keys = entry.keys?.join(', ') || '';

        return (
          <div
            key={i}
            style={{
              padding: '8px 10px',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '3px',
            }}>
              <span style={{
                fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-secondary)',
              }}>
                #{i} {name}
              </span>
              {keys && (
                <span style={{
                  fontSize: '0.6rem', color: 'var(--text-muted)',
                  maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  🔑 {keys}
                </span>
              )}
            </div>
            <div style={{
              fontSize: '0.75rem', color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {content.slice(0, 150) || '(empty)'}
            </div>
          </div>
        );
      })}

      {entries.length > maxPreview && (
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => setShowAll(!showAll)}
          style={{ alignSelf: 'center', fontSize: '0.7rem', marginTop: '4px' }}
        >
          {showAll ? (
            <><ChevronDown size={12} /> Show less</>
          ) : (
            <><ChevronRight size={12} /> Show all {entries.length} entries</>
          )}
        </button>
      )}
    </div>
  );
}

function PreviewField({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value?: string;
  truncate?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!value || value.trim() === '') return null;

  const isLong = truncate && value.length > 200;
  const displayText = isLong && !expanded ? value.slice(0, 200) + '...' : value;

  return (
    <div
      style={{
        padding: '8px 10px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          color: 'var(--accent-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {label}
        {isLong && (
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setExpanded(!expanded)}
            style={{ fontSize: '0.65rem', padding: '1px 4px' }}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {expanded ? 'Less' : 'More'}
          </button>
        )}
      </div>
      <div
        style={{
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.5,
          maxHeight: expanded ? 'none' : '120px',
          overflow: 'hidden',
        }}
      >
        {displayText}
      </div>
    </div>
  );
}
