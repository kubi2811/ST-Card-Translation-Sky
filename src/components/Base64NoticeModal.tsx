/**
 * (việc 233 — yêu cầu của user) BÁO NGAY LÚC NHẬP THẺ khi thẻ có tài liệu bị nhúng dạng base64.
 *
 * User: "import card vào dịch nếu bị mã hoá thì có popup thông báo hoặc có ghi ở đâu đó loại card
 * là bị mã hoá. còn tool dịch xử lý được không hay sao thì show lên luôn."
 *
 * Popup này trả lời đúng ba câu, không vòng vo:
 *   1. Thẻ này có gì bị mã hoá — bao nhiêu khối, nằm ở field nào.
 *   2. Tool xử lý được tới đâu — khối nào sẽ dịch, khối nào giữ nguyên VÀ VÌ SAO.
 *   3. Nếu không có tính năng này thì mất gì — số chữ Hán đang bị giấu.
 */
import { useState } from 'react';
import { FileLock2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import { fmt } from '../i18n';
import { useUi } from '../i18n/useLocale';

export default function Base64NoticeModal() {
  const ui = useUi();
  const report = useStore((s) => s.base64Report);
  const seen = useStore((s) => s.base64NoticeSeen);
  const setSeen = useStore((s) => s.setBase64NoticeSeen);
  const [showAll, setShowAll] = useState(false);

  if (!report || seen || report.total === 0) return null;

  const close = () => setSeen(true);
  const rows = showAll ? report.items : report.items.slice(0, 8);

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 100%)', maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '16px 24px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <FileLock2 size={20} style={{ color: '#fbbf24' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>{ui.b64Title}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{ui.b64Subtitle}</div>
          </div>
          <button onClick={close} className="btn btn-ghost" style={{ minHeight: 32 }} title={ui.b64Close}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', fontSize: '0.875rem', lineHeight: 1.6 }}>
          {/* Ba con số trả lời đúng câu "tool xử lý được không" */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            <Stat value={report.translatable} label={ui.b64StatTranslatable} color="var(--accent-success)" />
            <Stat value={report.keptVerbatim} label={ui.b64StatKept} color="var(--text-muted)" />
            <Stat value={report.hiddenCjk} label={ui.b64StatHidden} color="#fbbf24" />
          </div>

          <p style={{ marginBottom: 12 }}>
            {report.translatable > 0 ? ui.b64CanHandle : ui.b64NothingToDo}
          </p>
          {report.maskedChars > 0 && (
            <p style={{ marginBottom: 20, color: 'var(--text-secondary)' }}>
              {fmt(ui.b64Saving, { chars: report.maskedChars.toLocaleString('vi-VN') })}
            </p>
          )}

          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {rows.map((it, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', gap: 12, padding: '12px 16px', alignItems: 'flex-start',
                  borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  background: i % 2 ? 'var(--bg-primary)' : 'transparent',
                }}
              >
                <span
                  style={{
                    flexShrink: 0, fontSize: '0.8125rem', fontWeight: 700, padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: it.kind === 'text' ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)',
                    color: it.kind === 'text' ? 'var(--accent-success)' : 'var(--text-muted)',
                  }}
                >
                  {it.kind === 'text' ? ui.b64KindText : it.kind === 'binary' ? ui.b64KindBinary : ui.b64KindPlaceholder}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                    {it.fieldLabel} · <b>{it.label}</b>
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    {it.why}
                    {it.kind === 'text' && ` — ${it.decodedChars.toLocaleString('vi-VN')} ${ui.b64Chars}, ${it.cjk.toLocaleString('vi-VN')} ${ui.b64CjkChars}`}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {report.items.length > 8 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="btn btn-ghost"
              style={{ marginTop: 12, minHeight: 32, fontSize: '0.875rem' }}
            >
              {showAll ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {showAll ? ui.b64ShowLess : fmt(ui.b64ShowAll, { n: report.items.length })}
            </button>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={close} className="btn btn-primary" style={{ minHeight: 36 }}>
            {ui.b64Got}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '12px 8px', borderRadius: 'var(--radius-md)',
      background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
    }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color, lineHeight: 1.2 }}>
        {value.toLocaleString('vi-VN')}
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}
