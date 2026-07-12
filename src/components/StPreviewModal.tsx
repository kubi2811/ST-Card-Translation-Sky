import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useUi } from '../i18n/useLocale';
import { X, Eye, AlertTriangle } from 'lucide-react';
import { extractRegexScripts, substituteMacros, applyDisplayRegex, buildPreviewHtml, extractInitvarText } from '../utils/stPreview';

/**
 * 👁 XEM NHƯ SILLYTAVERN — modal render tin nhắn mở đầu (first_mes / greeting) sau khi
 * áp macro {{user}}/{{char}} + các regex script HIỂN THỊ của card.
 * - Mặc định: render TĨNH trong iframe sandbox rỗng (script card KHÔNG chạy — an toàn tuyệt đối).
 * - 🧪 Chạy script (thử nghiệm): iframe sandbox="allow-scripts" (vẫn KHÔNG same-origin — script
 *   bị nhốt origin riêng) + shim môi trường TavernHelper/MVU với DATA TEST từ entry [initvar]
 *   → thanh trạng thái/game UI script-driven tự đổ số; lỗi script hiện ngay dưới (bắt biến vỡ).
 * Toggle Gốc/Đã dịch để so trước–sau; card đã dịch lấy qua getExportCard (đúng bản sẽ xuất).
 */
export default function StPreviewModal({ onClose }: { onClose: () => void }) {
  const { card } = useStore();
  const { getExportCard } = useTranslation();
  const ui = useUi() as Record<string, string>;

  const [side, setSide] = useState<'translated' | 'original'>('translated');
  const [msgIdx, setMsgIdx] = useState(0); // 0 = first_mes, 1.. = alternate_greetings[i-1]
  const [runScripts, setRunScripts] = useState(false);
  const [scriptErrors, setScriptErrors] = useState<string[]>([]);

  const exportCard = useMemo(() => {
    try { return getExportCard(); } catch { return null; }
    // getExportCard đọc fields từ store — memo theo lần mở modal là đủ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nhận lỗi script từ iframe (shim postMessage) — công cụ soi "biến bị dịch vỡ"
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const err = (ev.data && ev.data.__stPreviewError) as string | undefined;
      if (err) setScriptErrors(prev => (prev.includes(err) || prev.length >= 20) ? prev : [...prev, err]);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Đổi bản xem/tin nhắn/chế độ → xoá lỗi cũ
  useEffect(() => { setScriptErrors([]); }, [side, msgIdx, runScripts]);

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
  const srcDoc = buildPreviewHtml(rendered, charName, {
    runScripts,
    initvarText: runScripts ? extractInitvarText(activeCard) : null,
  });

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
          <label
            title={ui.spRunScriptsHint}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.7rem',
              fontWeight: 600, padding: '3px 8px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${runScripts ? 'rgba(251,191,36,0.6)' : 'var(--border-subtle)'}`,
              color: runScripts ? '#fbbf24' : 'var(--text-muted)',
              background: runScripts ? 'rgba(251,191,36,0.08)' : 'transparent',
            }}
          >
            <input type="checkbox" checked={runScripts} onChange={(e) => setRunScripts(e.target.checked)} style={{ margin: 0 }} />
            {ui.spRunScripts}
          </label>
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

        {/* Ghi chú chế độ + regex đã áp */}
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          {runScripts ? ui.spScriptNote : ui.spStaticNote}
          {applied.length > 0 && <> · {ui.spApplied} {applied.slice(0, 5).join(', ')}{applied.length > 5 ? '…' : ''}</>}
        </div>

        {/* Lỗi script từ iframe — bắt biến/hàm bị dịch vỡ */}
        {runScripts && scriptErrors.length > 0 && (
          <div style={{
            marginBottom: 8, padding: '6px 10px', maxHeight: 90, overflow: 'auto',
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)',
            borderRadius: 'var(--radius-sm)', fontSize: '0.66rem', color: 'var(--text-secondary)',
          }}>
            <b style={{ color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={11} /> {ui.spScriptErrors} ({scriptErrors.length})
            </b>
            {scriptErrors.map((e, i) => <div key={i} style={{ fontFamily: 'monospace' }}>{e}</div>)}
          </div>
        )}

        {/* iframe: mặc định sandbox rỗng (script chặn tuyệt đối); 🧪 → allow-scripts nhưng vẫn
            KHÔNG allow-same-origin: script card bị nhốt origin riêng, không đụng được app/LS. */}
        <iframe
          key={`${side}-${msgIdx}-${runScripts ? 's' : 'n'}`}
          title="SillyTavern preview"
          sandbox={runScripts ? 'allow-scripts' : ''}
          srcDoc={srcDoc}
          style={{ flex: 1, width: '100%', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: '#1e1e2e' }}
        />
      </div>
    </div>
  );
}
