/**
 * (User 23/07 — Chiến lược A) Panel bật/tắt dịch skill Mythic (Auto Database).
 *
 * Panel chỉ có ý nghĩa với card Mythic, nên nó TỰ DÒ: thẻ không phải Mythic thì nói thẳng là
 * không cần bật, khỏi để user loay hoay với một tuỳ chọn vô dụng.
 *
 * Cảnh báo quan trọng nhất panel này đưa ra: những entry KHÔNG ghi sẵn `eras` phải suy thời đại
 * từ TỪ KHOÁ trong tiêu đề — dịch tiêu đề đi là Agent loại bỏ entry hoàn toàn. Số lượng entry
 * như vậy được đếm và hiện ngay để user biết trước khi chạy.
 */
import { useMemo } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { Brain, AlertTriangle } from 'lucide-react';
import {
  detectMythicCard, titleTranslationIsSafe, extractMythicFields, parseMythicComment,
} from '../utils/mythicSkill';

export default function MythicPanel() {
  const card = useStore((s) => s.card);
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const ui = useUi();

  const info = useMemo(() => {
    if (!card) return null;
    const d = detectMythicCard(card);
    if (!d.isMythic) return { ...d, fields: 0, unsafeTitles: 0 };
    const entries = card.data?.character_book?.entries ?? [];
    let unsafeTitles = 0;
    for (const e of entries) {
      const cm = String((e as { comment?: string })?.comment ?? '');
      // Marker chính xác: content thật có token luật chơi như NO_WEAK_START, so '_START' trần là nhầm.
      if (parseMythicComment(cm).blocks.length > 0 && !titleTranslationIsSafe(cm)) unsafeTitles++;
    }
    return { ...d, fields: extractMythicFields(card).length, unsafeTitles };
  }, [card]);

  if (!card || !info) return null;

  // Thẻ thường: nói một câu rồi thôi, không bày tuỳ chọn gây rối.
  if (!info.isMythic) {
    return (
      <div style={{
        marginBottom: '16px', padding: '10px 12px', fontSize: '0.72rem', lineHeight: 1.6,
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        background: 'var(--bg-secondary)', color: 'var(--text-muted)',
      }}>
        {ui.msMythicNotDetected}
      </div>
    );
  }

  const on = translationConfig.enableMythicSync;

  return (
    <div style={{
      marginBottom: '16px', border: `1px solid ${on ? 'rgba(168,85,247,0.35)' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', overflow: 'hidden',
    }}>
      <div style={{
        padding: '11px 14px', display: 'flex', alignItems: 'center', gap: '8px',
        borderBottom: '1px solid var(--border-subtle)',
        background: on ? 'rgba(168,85,247,0.07)' : 'transparent',
      }}>
        <Brain size={16} color={on ? '#c084fc' : 'var(--text-muted)'} />
        <span style={{ fontWeight: 600, fontSize: '0.85rem', flex: 1 }}>{ui.msMythicTitle}</span>
        <span style={{
          fontSize: '0.68rem', padding: '2px 8px', borderRadius: '99px',
          background: 'rgba(168,85,247,0.12)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)',
        }}>
          {info.skillEntries}/{info.totalEntries}
        </span>
      </div>

      <div style={{ padding: '12px 14px' }}>
        <label
          title={ui.msMythicTip}
          style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => setTranslationConfig({ enableMythicSync: e.target.checked })}
            style={{ marginTop: '3px', accentColor: '#a855f7', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.76rem', lineHeight: 1.55 }}>
            <b style={{ color: on ? '#c084fc' : 'var(--text-primary)' }}>{ui.msMythicToggle}</b>
            <br />
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
              {fmt(ui.msMythicDetected, { skills: info.skillEntries, total: info.totalEntries })}
              {info.fields > 0 && ` (${info.fields} field)`}
            </span>
          </span>
        </label>

        {/* Cảnh báo era: dịch tiêu đề những entry này là Agent loại bỏ chúng hoàn toàn. */}
        {on && info.unsafeTitles > 0 && (
          <div
            title={ui.msMythicUnsafeTip}
            style={{
              marginTop: '10px', padding: '8px 10px', fontSize: '0.7rem', lineHeight: 1.55,
              display: 'flex', gap: '7px', alignItems: 'flex-start',
              background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.32)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
            }}
          >
            <AlertTriangle size={13} color="#fbbf24" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{fmt(ui.msMythicUnsafeTitle, { count: info.unsafeTitles })}</span>
          </div>
        )}
      </div>
    </div>
  );
}
