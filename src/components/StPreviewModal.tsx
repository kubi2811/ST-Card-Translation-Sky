import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useUi } from '../i18n/useLocale';
import { X, Eye } from 'lucide-react';
import { extractRegexScripts, substituteMacros, applyDisplayRegex, buildPreviewHtml } from '../utils/stPreview';

/**
 * 👁 XEM NHƯ SILLYTAVERN — modal render TĨNH tin nhắn mở đầu (first_mes / greeting) sau khi
 * áp macro {{user}}/{{char}} + các regex script HIỂN THỊ của card, trong iframe sandbox
 * (script KHÔNG chạy — chỉ xem khung HTML/CSS có vỡ không, không cần import vào ST).
 * Toggle Gốc/Đã dịch để so trước–sau; card đã dịch lấy qua getExportCard (đúng bản sẽ xuất).
 */
export default function StPreviewModal({ onClose }: { onClose: () => void }) {
  const { card } = useStore();
  const { getExportCard } = useTranslation();
  const ui = useUi() as Record<string, string>;

  const [side, setSide] = useState<'translated' | 'original'>('translated');
  const [msgIdx, setMsgIdx] = useState(0); // 0 = first_mes, 1.. = alternate_greetings[i-1]

  const exportCard = useMemo(() => {
    try { return getExportCard(); } catch { return null; }
    // getExportCard đọc fields từ store — memo theo lần mở modal là đủ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!card) return null;
  const activeCard: any = (side === 'translated' && exportCard) ? exportCard : card;
  const data = activeCard.data || activeCard;

  const messages: { label: string; text: string }[] = [
    { label: ui.spFirstMes, text: data.first_mes || '' },
    ...((data.alternate_greetings || []) as string[]).map((g, i) => ({
      label: `${ui.spGreeting} ${i + 1}`, text: g,
    })),
  ];
  const current = messages[Math.min(msgIdx, messages.length - 1)];

  const charName = data.name || 'Char';
  const scripts = extractRegexScripts(activeCard);
  const withMacros = substituteMacros(current.text, { user: 'User', char: charName });
  const { text: rendered, applied } = applyDisplayRegex(withMacros, scripts);
  const srcDoc = buildPreviewHtml(rendered, charName);

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px', fontSize: '0.72rem', fontWeight: active ? 700 : 400, cursor: 'pointer',
    color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
    background: active ? 'rgba(124,106,240,0.12)' : 'transparent',
    border: active ? '1px solid rgba(124,106,240,0.35)' : '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 'min(940px, 94vw)', height: 'min(84vh, 760px)', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-secondary)', border: '1px solid var(--accent-secondary)',
        borderRadius: 'var(--radius-md)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: '14px 16px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Eye size={16} style={{ color: 'var(--accent-secondary)' }} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', flex: 1 }}>{ui.spTitle}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={tabBtn(side === 'original')} onClick={() => setSide('original')}>{ui.spOriginal}</button>
            <button style={tabBtn(side === 'translated')} onClick={() => setSide('translated')}>{ui.spTranslated}</button>
          </div>
          <select
            className="input"
            value={msgIdx}
            onChange={(e) => setMsgIdx(Number(e.target.value))}
            style={{ fontSize: '0.72rem', padding: '4px 8px', maxWidth: 210 }}
          >
            {messages.map((m, i) => <option key={i} value={i}>{m.label}</option>)}
          </select>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Ghi chú render tĩnh + regex đã áp */}
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          {ui.spStaticNote}
          {applied.length > 0 && <> · {ui.spApplied} {applied.slice(0, 5).join(', ')}{applied.length > 5 ? '…' : ''}</>}
        </div>

        {/* iframe sandbox — không allow-scripts: script trong card bị chặn tuyệt đối */}
        <iframe
          title="SillyTavern preview"
          sandbox=""
          srcDoc={srcDoc}
          style={{ flex: 1, width: '100%', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: '#1e1e2e' }}
        />
      </div>
    </div>
  );
}
