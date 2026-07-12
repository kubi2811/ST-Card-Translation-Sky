import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { recommendPreset } from '../utils/presetRecommend';
import { usePresetApply } from '../hooks/usePresetApply';
import { Sparkles, X } from 'lucide-react';

const PRESET_LABEL_KEY = { light: 'tcPresetLight', full: 'tcPresetFull', turbo: 'tcPresetTurbo' } as const;
const REASON_KEY = { mvu: 'tcRecMvu', script: 'tcRecScript', big: 'tcRecBig', small: 'tcRecSmall' } as const;

/**
 * Popup GỢI Ý CẤU HÌNH sau khi import card: app đã phân tích card (recommendPreset) → hỏi user
 * "dùng cấu hình gợi ý không?". Bấm ✅ = áp preset khuyên dùng ngay (usePresetApply — cùng logic
 * với 3 nút preset); bấm "Giữ cấu hình hiện tại" = đóng popup, không đổi gì.
 * Chỉ hiện 1 lần cho mỗi lần nạp card MỚI (card khôi phục từ cache có tiến trình → không hiện).
 */
export default function PresetRecommendModal() {
  const { card, cardFileName, fields, translationConfig } = useStore();
  const ui = useUi() as Record<string, string>;
  const applyPreset = usePresetApply();
  const [dismissedFor, setDismissedFor] = useState<string>('');

  const rec = useMemo(() => (card ? recommendPreset(card) : null), [card]);

  // Card khôi phục từ cache (đã có field done) → user đang dở việc, đừng quấy rầy.
  const hasProgress = fields.some(f => f.status === 'done' || f.status === 'error');

  // Đổi card mới → cho phép popup hiện lại.
  useEffect(() => { setDismissedFor(''); }, [cardFileName]);

  if (!card || !rec || hasProgress || dismissedFor === cardFileName || translationConfig.enableModMode) return null;

  const presetName = ui[PRESET_LABEL_KEY[rec.preset]];
  const reason = ui[REASON_KEY[rec.reason]];
  const close = () => setDismissedFor(cardFileName);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 'min(480px, 92vw)', background: 'var(--bg-secondary)',
        border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-md)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: '18px 20px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Sparkles size={18} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontWeight: 700, fontSize: '0.95rem', flex: 1 }}>{ui.prmTitle}</span>
          <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Preset được khuyên */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10,
          padding: '6px 12px', borderRadius: 'var(--radius-sm)', fontWeight: 700,
          background: 'rgba(124,106,240,0.14)', border: '1px solid var(--accent-primary)',
        }}>
          ★ {presetName}
        </div>

        {/* Vì sao */}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
          {reason}
        </div>

        {/* 2 nút */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" onClick={close}>
            {ui.prmKeep}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { applyPreset(rec.preset); close(); }}
          >
            ✅ {ui.prmUse}
          </button>
        </div>
      </div>
    </div>
  );
}
