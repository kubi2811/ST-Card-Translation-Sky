/**
 * CollapsibleSection — (bug 165) Khối co giãn dùng chung cho sidebar.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vấn đề bug 165 nêu: sidebar xếp chồng dọc liên tục (ProxyConfig 746 dòng → FileUpload 386 →
 * PresetImportPanel 342 → TranslateConfig 1520 → 3 nút), người dùng phải cuộn rất dài chỉ để tới phần
 * cấu hình dịch. Đây là component để gói từng giai đoạn lại, và là NGUỒN DUY NHẤT cho style khối co
 * giãn — thay cho việc mỗi nơi tự viết `style={{...}}` + onMouseOver/onMouseOut.
 *
 * `summary` là điểm quan trọng: panel đã xong việc thì thu lại thành MỘT DÒNG tóm tắt (vd
 * "✓ Đã cấu hình · gemini-3-pro") chứ không mở toang chiếm chỗ vĩnh viễn.
 *
 * Chỉ dùng CSS variables có sẵn trong index.css, không thêm màu mới.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleSectionProps {
  /** Nhãn khối — phải là chuỗi đã qua i18n, component không tự dịch. */
  title: string;
  /** Số thứ tự bước (1,2,3…) — hiện thành chip nhỏ, giúp thấy rõ luồng thao tác. */
  step?: number;
  /** Icon bên trái nhãn. */
  icon?: ReactNode;
  /** Mặc định mở hay đóng. */
  defaultOpen?: boolean;
  /** Dòng tóm tắt hiện khi ĐANG ĐÓNG (trạng thái "đã xong việc"). */
  summary?: ReactNode;
  /** Màu nhấn của khối (mặc định accent-primary). */
  accent?: string;
  children: ReactNode;
}

export default function CollapsibleSection({
  title, step, icon, defaultOpen = true, summary, accent = 'var(--accent-primary)', children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
          padding: '11px 20px', background: 'transparent', border: 'none',
          color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              : <ChevronRight size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />}
        {step !== undefined && (
          <span
            style={{
              flexShrink: 0, width: '18px', height: '18px', borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.62rem', fontWeight: 700,
              background: `color-mix(in srgb, ${accent} 20%, transparent)`, color: accent,
            }}
          >{step}</span>
        )}
        {icon && <span style={{ flexShrink: 0, display: 'flex', color: accent }}>{icon}</span>}
        <span style={{ fontSize: '0.82rem', fontWeight: 600, flexShrink: 0 }}>{title}</span>
        {/* Tóm tắt chỉ hiện khi đóng — mở rồi thì nội dung thật đã nói đủ, nhắc lại là nhiễu. */}
        {!open && summary != null && (
          <span
            style={{
              marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
            }}
          >{summary}</span>
        )}
      </button>
      {open && <div style={{ paddingBottom: '4px' }}>{children}</div>}
    </div>
  );
}
