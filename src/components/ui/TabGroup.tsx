/**
 * TabGroup — (bug 165) Tab ngang cho cột nội dung chính.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vấn đề bug 165 nêu: sau khi có card, cột phải render ĐỒNG THỜI và luôn mở CardPreview →
 * TranslationProgress → GlossaryViz → FieldEditor (2069 dòng) → VerifyPanel (1297) → ExportPanel
 * (975) — khoảng 5400 dòng UI trong một cột cuộn duy nhất, không có thứ tự ưu tiên nào.
 *
 * Hai điều component này phải làm đúng, không thì đại tu gây hại hơn lợi:
 *   1. CHỈ MOUNT tab đang active. Đó là toàn bộ lý do làm tab: panel không xem thì đừng chạy. Mỗi
 *      panel vẫn tự bọc <Suspense> của nó ở ngoài như cũ — component này KHÔNG đụng vào lazy/warmup.
 *   2. ĐIỀU HƯỚNG ĐƯỢC BẰNG CODE (`activeId` + `onChange`). Cần cho việc "nhảy tới trường": tín hiệu
 *      nhảy tới VerifyPanel/ExportPanel phải bật đúng tab TRƯỚC khi cuộn, không thì phần tử chưa có
 *      trong DOM và lệnh nhảy im lặng thất bại.
 *
 * Thanh tab cuộn ngang được (`overflow-x: auto`) để ở mobile không vỡ layout.
 */
import type { ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Chip nhỏ bên phải nhãn (vd số lỗi cần xem). */
  badge?: ReactNode;
  /** Nội dung — hàm để KHÔNG dựng element của tab đang ẩn. */
  render: () => ReactNode;
}

export interface TabGroupProps {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
}

export default function TabGroup({ tabs, activeId, onChange }: TabGroupProps) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px',
          borderBottom: '1px solid var(--border-subtle)', marginBottom: '14px',
          scrollbarWidth: 'thin',
        }}
      >
        {tabs.map((tb) => {
          const on = tb.id === active?.id;
          return (
            <button
              key={tb.id}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(tb.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
                padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: '0.78rem', fontWeight: on ? 700 : 500,
                background: 'transparent', border: 'none',
                // Gạch dưới thay vì viền quanh: đổi tab không làm layout nhảy.
                borderBottom: `2px solid ${on ? 'var(--accent-primary)' : 'transparent'}`,
                color: on ? 'var(--accent-primary)' : 'var(--text-muted)',
                marginBottom: '-1px',
              }}
            >
              {tb.icon}
              {tb.label}
              {tb.badge != null && tb.badge}
            </button>
          );
        })}
      </div>
      {/* Chỉ nội dung tab active được dựng — đây là mục đích chính của việc chia tab. */}
      {active?.render()}
    </div>
  );
}
