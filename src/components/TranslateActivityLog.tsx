/**
 * (bug 240) Nhật ký tiến độ của MỘT lượt dịch, vẽ ngay trong panel — thay cho việc phải mở F12.
 * Đọc từ utils/translateActivity (sống ngoài React), nên đóng/mở panel vẫn còn nguyên.
 */
import { useMemo } from 'react';
import { useTranslateActivity } from '../utils/translateActivity';
import type { TranslateProgressEvent } from '../utils/apiClient';
import { useUi } from '../i18n/useLocale';

const COLOR: Record<TranslateProgressEvent['level'], string> = {
  info: 'var(--text-secondary)',
  success: 'var(--accent-success, #4ade80)',
  warning: 'var(--accent-warning, #f59e0b)',
  error: 'var(--accent-danger, #f87171)',
};

function hhmmss(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

interface Props {
  /** Lấy mọi field có tên BẮT ĐẦU bằng chuỗi này (một lượt có thể gồm nhiều fieldName con). */
  fieldPrefix: string;
  /** Số dòng hiển thị (mới nhất ở dưới). */
  max?: number;
  /** Ẩn hẳn các dòng tiến độ từng cụm chữ cho gọn. */
  hideSurgicalTicks?: boolean;
}

export default function TranslateActivityLog({ fieldPrefix, max = 60, hideSurgicalTicks }: Props) {
  const ui = useUi();
  const byField = useTranslateActivity(s => s.byField);
  const events = useMemo(() => {
    const all: TranslateProgressEvent[] = [];
    for (const [name, list] of Object.entries(byField)) {
      if (name.startsWith(fieldPrefix)) all.push(...list);
    }
    all.sort((a, b) => a.at - b.at);
    let filtered = all;
    if (hideSurgicalTicks) {
      // Mỗi field chỉ giữ dòng "cụm chữ" MỚI NHẤT — đủ biết đang tới đâu, khỏi ngập 10 dòng/phần.
      const lastSurgical = new Map<string, TranslateProgressEvent>();
      for (const e of all) if (e.kind === 'surgical') lastSurgical.set(e.fieldName, e);
      filtered = all.filter(e => e.kind !== 'surgical' || lastSurgical.get(e.fieldName) === e);
    }
    return filtered.slice(-max);
  }, [byField, fieldPrefix, max, hideSurgicalTicks]);

  if (events.length === 0) {
    return (
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
        {ui.alEmpty}
      </div>
    );
  }
  return (
    <div style={{
      maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
      fontFamily: 'monospace', fontSize: '0.66rem', lineHeight: 1.5,
      background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px',
    }}>
      {events.map((e, i) => (
        <div key={`${e.at}-${i}`} style={{ color: COLOR[e.level] }}>
          <span style={{ color: 'var(--text-muted)' }}>{hhmmss(e.at)}</span>{' '}
          {(() => {
            // Phần đuôi sau tiền tố (vd "phần 2/3"). Dấu "· replaceString" chỉ là nhãn cho engine
            // (xem engineFieldName) — không có nghĩa gì với người dùng nên bỏ đi.
            const sub = e.fieldName.slice(fieldPrefix.length).replace(/·?\s*replaceString/g, '').trim();
            return sub ? <span style={{ color: 'var(--text-muted)' }}>[{sub}] </span> : null;
          })()}
          {e.message}
        </div>
      ))}
    </div>
  );
}
