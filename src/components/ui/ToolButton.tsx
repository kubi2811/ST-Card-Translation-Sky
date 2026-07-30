/**
 * ToolButton — (bug 165) Nút mở công cụ, dùng chung.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thay cho việc App.tsx copy-paste ba lần cùng một khối `style={{...}}` kèm
 * `onMouseOver`/`onMouseOut` tự viết tay chỉ để đổi màu viền — mỗi nút một màu, sửa một nút là lệch
 * hai nút kia. Bug 165 yêu cầu đúng việc này: một component nhận (icon, label, accent, onClick).
 *
 * Hover/focus xử bằng CSS variable đặt trên chính element (không cần class toàn cục), nên vẫn giữ
 * được yêu cầu "dùng lại 100% CSS variables đã có, không hardcode màu mới" — màu accent do nơi gọi
 * truyền vào (#f97316 Regex, #a855f7 Trợ lý AI, #38bdf8 So sánh card).
 */
import { useState, type ReactNode } from 'react';

export interface ToolButtonProps {
  label: string;
  icon?: ReactNode;
  /** Màu nhấn — dùng cho chữ và viền lúc hover. */
  accent?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** 'full' = nút full-width trong sidebar; 'chip' = nút gọn nằm trong một hàng công cụ. */
  variant?: 'full' | 'chip';
}

export default function ToolButton({
  label, icon, accent = 'var(--accent-primary)', onClick, disabled, title, variant = 'chip',
}: ToolButtonProps) {
  const [hover, setHover] = useState(false);
  const full = variant === 'full';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        width: full ? '100%' : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        padding: full ? '10px' : '7px 11px',
        background: 'var(--bg-elevated)',
        border: `1px solid ${hover && !disabled ? accent : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)',
        color: accent,
        fontWeight: 600,
        fontSize: full ? '0.85rem' : '0.72rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.2s',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
