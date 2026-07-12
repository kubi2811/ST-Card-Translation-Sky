import { useEffect, useState } from 'react';

/**
 * Ô nhập NHIỀU API key (mỗi dòng / dấu phẩy 1 key) — fix bug "không Enter xuống dòng được".
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Bug cũ: textarea là controlled với value = keys.filter(Boolean).join('\n') và onChange cũng
 * filter(Boolean) → bấm Enter tạo dòng TRỐNG → bị filter mất → React render lại đúng chuỗi cũ
 * ⇒ dấu xuống dòng biến mất ngay lập tức, không gõ được key thứ 2.
 * Fix: giữ RAW TEXT trong state cục bộ (draft) — user gõ gì thấy nấy (kể cả dòng trống dở tay),
 * mỗi keystroke vẫn parse ra danh sách key sạch đẩy lên store. Khi store đổi từ bên ngoài
 * (Reset API, nạp settings…) thì đồng bộ lại draft.
 */
export default function KeysTextarea({
  keys,
  onKeys,
  rows = 2,
  placeholder,
  style,
  className,
}: {
  /** Danh sách key hiện tại từ store (đã sạch). */
  keys: string[];
  /** Nhận danh sách key sạch mỗi khi user gõ. */
  onKeys: (keys: string[]) => void;
  rows?: number;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const clean = keys.filter(k => k && k.trim());
  const storeJoined = clean.join('\n');
  const [draft, setDraft] = useState(storeJoined);

  const parse = (raw: string) => raw.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);

  // Store đổi từ bên ngoài (reset/import) → draft cũ không còn khớp → đồng bộ lại.
  // Khi user đang gõ thì parse(draft) luôn khớp store (vừa đẩy lên) → không bị ghi đè.
  useEffect(() => {
    if (parse(draft).join('\n') !== storeJoined) setDraft(storeJoined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeJoined]);

  return (
    <textarea
      className={className}
      rows={rows}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onKeys(parse(e.target.value));
      }}
      placeholder={placeholder}
      style={style}
      spellCheck={false}
    />
  );
}
