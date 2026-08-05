import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { CheckCircle2, X } from 'lucide-react';
import { jumpToAnchor } from './ui/panelNav';

const HIDE_KEY = 'st_posttranslate_guide_hidden';

/**
 * (User yêu cầu 2026) Popup HƯỚNG DẪN sau khi dịch xong: báo cho dịch giả biết nên bấm gì tiếp
 * theo cho FRIENDLY hơn — thứ tự khuyên dùng: 🩺 Sức khoẻ thẻ (non-AI) → 🔗 Đồng nhất biến MVU
 * (thẻ cũ) → 🤖 AI Verify (CHỈ khi lỗi ngữ nghĩa). Nút mỗi bước tự cuộn tới đúng panel + nháy sáng.
 * Hiện 1 lần mỗi lần dịch xong (translateGuideSeed bump); có "Đừng hiện lại" lưu localStorage.
 */
export default function PostTranslateGuideModal() {
  const translateGuideSeed = useStore((s) => s.translateGuideSeed);
  const dismissTranslateGuide = useStore((s) => s.dismissTranslateGuide);
  const ui = useUi() as Record<string, string>;

  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (!translateGuideSeed) return; // 0 = chưa dịch lần nào
    try { if (localStorage.getItem(HIDE_KEY) === '1') return; } catch { /* ignore */ }
    setOpen(true);
    setArmed(false);
    setDontShow(false);
    const t = setTimeout(() => setArmed(true), 350); // chặn click-through + fade-in mượt
    return () => clearTimeout(t);
  }, [translateGuideSeed]);

  if (!open) return null;

  const close = () => {
    if (dontShow) { try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* ignore */ } }
    setOpen(false);
    // (bug 213) Xoá dấu ở STORE, không chỉ ở state cục bộ — nếu không thì vào/ra Regex Manager
    // fullscreen (App return sớm ⇒ modal unmount/remount) là popup bật lại với seed cũ.
    dismissTranslateGuide();
  };

  // Cuộn tới panel đích + nháy sáng viền để user thấy ngay nút cần bấm nằm đâu.
  // (bug 165) Chuyển sang jumpToAnchor: sau đại tu, VerifyPanel/ExportPanel nằm trong TAB nên panel
  // không active KHÔNG có trong DOM — `getElementById` trả null và lệnh nhảy im lặng không làm gì.
  // jumpToAnchor bật đúng tab trước rồi mới cuộn (và chờ cả trường hợp chunk lazy chưa về).
  const jumpTo = (id: string) => {
    close();
    jumpToAnchor(id);
  };

  const steps: Array<{
    title: string; badge: string; desc: string; badgeColor: string;
    btn?: string; onClick?: () => void;
  }> = [
    {
      title: ui.ptgStep1Title, badge: ui.ptgStep1Badge, desc: ui.ptgStep1Desc,
      badgeColor: '#4ade80', btn: ui.ptgStep1Btn, onClick: () => jumpTo('export-panel-anchor'),
    },
    {
      title: ui.ptgStep2Title, badge: ui.ptgStep2Badge, desc: ui.ptgStep2Desc,
      badgeColor: '#818cf8',
    },
    {
      title: ui.ptgStep3Title, badge: ui.ptgStep3Badge, desc: ui.ptgStep3Desc,
      badgeColor: '#fbbf24', btn: ui.ptgStep3Btn, onClick: () => jumpTo('verify-panel-anchor'),
    },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: armed ? 'auto' : 'none',
    }}>
      <div style={{
        width: 'min(540px, 94vw)', maxHeight: '88vh', overflowY: 'auto',
        background: 'var(--bg-secondary)', border: '1px solid var(--accent-success, #22c55e)',
        borderRadius: 'var(--radius-md)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        padding: '18px 20px', opacity: armed ? 1 : 0.92, transition: 'opacity 0.2s',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <CheckCircle2 size={20} style={{ color: 'var(--accent-success, #22c55e)' }} />
          <span style={{ fontWeight: 700, fontSize: '1rem', flex: 1 }}>{ui.ptgTitle}</span>
          <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Trấn an: đã tự đồng nhất biến */}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
          {ui.ptgReassure}
        </div>

        {/* 3 bước khuyên dùng */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '10px 12px',
              borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                background: 'rgba(124,106,240,0.14)', color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 700,
              }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{s.title}</span>
                  <span style={{
                    fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px',
                    padding: '1px 6px', borderRadius: 8, color: s.badgeColor,
                    background: `${s.badgeColor}1a`, border: `1px solid ${s.badgeColor}33`,
                  }}>{s.badge}</span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{s.desc}</div>
                {s.btn && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={s.onClick}
                    style={{ marginTop: 8, padding: '4px 10px', fontSize: '0.72rem' }}
                  >
                    {s.btn} →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer: đừng hiện lại + đã hiểu */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
            {ui.ptgDontShow}
          </label>
          <button className="btn btn-primary btn-sm" onClick={close}>
            ✅ {ui.ptgGotIt}
          </button>
        </div>
      </div>
    </div>
  );
}
