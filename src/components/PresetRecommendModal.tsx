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
  // (bugNeedFix/39) selector hẹp — trước đây subscribe toàn store, re-render theo mọi set() lúc dịch.
  const card = useStore((s) => s.card);
  const cardFileName = useStore((s) => s.cardFileName);
  const presetRecommendCard = useStore((s) => s.presetRecommendCard);
  const presetRecommendSeed = useStore((s) => s.presetRecommendSeed);
  const translationConfig = useStore((s) => s.translationConfig);
  const ui = useUi() as Record<string, string>;
  const applyPreset = usePresetApply();
  // (bug 143) Cờ "đã đóng" nằm ở STORE, không phải state cục bộ — xem chú thích ở
  // store.dismissPresetRecommend. Component này bị unmount mỗi khi mở Regex Manager toàn màn
  // hình, nên cờ cục bộ luôn về false và popup nhảy ra lại mỗi lần thoát.
  const dismissPresetRecommend = useStore((s) => s.dismissPresetRecommend);

  // (Fix click-through) Popup mount NGAY trong change-handler của file input. Nếu user
  // DOUBLE-CLICK chọn file trong hộp thoại, cú click thứ 2 rơi xuống trang ngay đúng lúc
  // popup vừa hiện — trúng nút giữa màn hình → popup "tự bấm" rồi biến mất. Khoá tương tác
  // ~450ms đầu (pointer-events: none) để cú click trễ đó rơi vào khoảng trống vô hại.
  const [armed, setArmed] = useState(false);

  const rec = useMemo(() => (card ? recommendPreset(card) : null), [card]);

  // Mỗi lần IMPORT mới (seed bump từ FileUpload) → cho phép popup hiện lại + khoá tương tác lại
  // từ đầu. Popup KHÔNG còn tự suy từ trạng thái field nữa (tái dùng bản dịch phiên bản v1.75
  // đánh dấu field 'done' làm bản cũ tưởng "đang dở việc" → tự tắt). Giờ chỉ hiện/tắt theo trigger.
  useEffect(() => {
    if (!presetRecommendSeed) return;
    setArmed(false);
    const t = setTimeout(() => setArmed(true), 450);
    return () => clearTimeout(t);
  }, [presetRecommendSeed]);

  // Chỉ hiện cho ĐÚNG card mà FileUpload đã trigger (phòng khi card đổi mà chưa import lại).
  const show = !!presetRecommendCard && presetRecommendCard === cardFileName;
  if (!card || !rec || !show || translationConfig.enableModMode) return null;

  const presetName = ui[PRESET_LABEL_KEY[rec.preset]];
  const reason = ui[REASON_KEY[rec.reason]];
  const close = () => dismissPresetRecommend();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: armed ? 'auto' : 'none', // chặn click-through 450ms đầu
    }}>
      <div style={{
        width: 'min(480px, 92vw)', background: 'var(--bg-secondary)',
        border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-md)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: '18px 20px',
        opacity: armed ? 1 : 0.92, transition: 'opacity 0.2s',
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
