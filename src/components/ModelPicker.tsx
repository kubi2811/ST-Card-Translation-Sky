import { useState } from 'react';

const MANUAL = '\x00__manual__'; // sentinel option: chuyển sang nhập tay

/**
 * (User yêu cầu 2026) Ô chọn Model dạng PICKLIST đúng nghĩa — thay `<input list=datalist>` (bị hành
 * xử như ô SEARCH: pick "flash" xong mở lại chỉ còn model chứa "flash"). `<select>` LUÔN xổ ĐỦ danh
 * sách model đã Load, không lọc theo text. Có mục "✏️ Nhập thủ công…" cho proxy/local không trả /models.
 */
export default function ModelPicker({
  value, onChange, models, placeholder, className, style, onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  models: string[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onFocus?: () => void;
}) {
  // Vào chế độ nhập tay khi: user chọn "Nhập thủ công", hoặc value hiện tại là model LẠ (không có
  // trong danh sách đã Load) — để không mất giá trị custom đã lưu.
  const valueIsCustom = !!value && models.length > 0 && !models.includes(value);
  const [manual, setManual] = useState(valueIsCustom);

  if (manual) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          style={{ ...style, flex: 1 }}
          autoFocus
        />
        {models.length > 0 && (
          <button
            type="button"
            onClick={() => setManual(false)}
            title="Chọn lại từ danh sách đã Load"
            style={{ flexShrink: 0, padding: '4px 7px', fontSize: '0.72rem', cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}
          >
            ↩
          </button>
        )}
      </div>
    );
  }

  // Danh sách hiển thị: value hiện tại (nếu chưa có) đứng đầu để hiện đúng lựa chọn + toàn bộ model.
  const options = [...new Set([...(value ? [value] : []), ...models])];

  return (
    <select
      className={className}
      value={value}
      onChange={(e) => {
        if (e.target.value === MANUAL) { setManual(true); return; }
        onChange(e.target.value);
      }}
      onFocus={onFocus}
      style={{ ...style, cursor: 'pointer' }}
    >
      {!value && <option value="" disabled>{placeholder || '— chọn model —'}</option>}
      {options.map((m) => <option key={m} value={m}>{m}</option>)}
      <option value={MANUAL}>✏️ Nhập thủ công…</option>
    </select>
  );
}
