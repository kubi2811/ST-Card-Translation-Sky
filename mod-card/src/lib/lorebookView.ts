/**
 * src/lib/lorebookView.ts — XEM & SO SÁNH ENTRY LOREBOOK SAU KHI MOD.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 23/07 — việc 88) "Thêm chức năng xem các entry trong lorebook sau khi mod card xong."
 *
 * Trước đây mod xong chỉ có hai khối JSON thô trước/sau — muốn biết entry nào vừa bị sửa thì
 * phải tự dò trong hàng nghìn dòng JSON. Nên ở đây không chỉ LIỆT KÊ mà còn SO entry theo
 * entry: cái nào thêm, cái nào mất, cái nào đổi nội dung, đổi bao nhiêu ký tự.
 *
 * Thuần hàm, không đụng React/DOM — để soi được bằng script và tái dùng ở chỗ khác.
 */

import type { CardV3 } from '@/types/card';

export interface LorebookRow {
  index: number;
  /** Tiêu đề entry — SillyTavern hiển thị `comment`; `name` chỉ vài card mới có. */
  name: string;
  keys: string[];
  enabled: boolean;
  constant: boolean;
  chars: number;
  preview: string;
  /** So với bản trước khi mod. */
  status: 'added' | 'removed' | 'changed' | 'same';
  /** Số ký tự chênh so với bản trước (âm = bị cắt bớt). */
  delta: number;
}

interface RawEntry {
  comment?: string;
  name?: string;
  keys?: unknown;
  content?: string;
  enabled?: boolean;
  disable?: boolean;
  constant?: boolean;
}

function entriesOf(card: CardV3 | null | undefined): RawEntry[] {
  const d = ((card as unknown as { data?: Record<string, unknown> })?.data ?? card ?? {}) as Record<string, unknown>;
  const book = d.character_book as { entries?: RawEntry[] } | undefined;
  return Array.isArray(book?.entries) ? book!.entries! : [];
}

function titleOf(e: RawEntry, i: number): string {
  const t = String(e.comment || e.name || '').trim();
  return t || `Entry #${i}`;
}

function keysOf(e: RawEntry): string[] {
  if (!Array.isArray(e.keys)) return [];
  return e.keys.map(k => String(k)).filter(Boolean);
}

/** Entry đang bật? ST dùng cả `enabled: false` lẫn `disable: true` tuỳ phiên bản. */
function isEnabled(e: RawEntry): boolean {
  return e.enabled !== false && e.disable !== true;
}

function preview(content: string, max = 160): string {
  const s = String(content || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Liệt kê entry của bản ĐÃ MOD, kèm trạng thái so với bản gốc.
 *
 * Ghép cặp theo TIÊU ĐỀ chứ không theo chỉ số: mod có thể chèn/xoá entry làm lệch hết chỉ số,
 * ghép theo chỉ số sẽ báo nhầm hàng loạt "đã đổi" trong khi thực ra chỉ dịch chỗ.
 */
export function listLorebookEntries(after: CardV3 | null, before?: CardV3 | null): LorebookRow[] {
  const beforeEntries = entriesOf(before);
  const byTitle = new Map<string, RawEntry>();
  beforeEntries.forEach((e, i) => {
    const t = titleOf(e, i);
    if (!byTitle.has(t)) byTitle.set(t, e);
  });

  return entriesOf(after).map((e, i) => {
    const content = String(e.content || '');
    const name = titleOf(e, i);
    const old = before ? byTitle.get(name) : undefined;
    const oldContent = old ? String(old.content || '') : '';

    let status: LorebookRow['status'] = 'same';
    if (!before) status = 'same';
    else if (!old) status = 'added';
    else if (oldContent !== content) status = 'changed';

    return {
      index: i,
      name,
      keys: keysOf(e),
      enabled: isEnabled(e),
      constant: e.constant === true,
      chars: content.length,
      preview: preview(content),
      status,
      delta: old ? content.length - oldContent.length : content.length,
    };
  });
}

/** Entry có ở bản gốc mà biến mất ở bản đã mod — thứ dễ mất mà không ai để ý nhất. */
export function findRemovedEntries(after: CardV3 | null, before?: CardV3 | null): LorebookRow[] {
  if (!before) return [];
  const afterTitles = new Set(entriesOf(after).map((e, i) => titleOf(e, i)));
  return entriesOf(before)
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => !afterTitles.has(titleOf(e, i)))
    .map(({ e, i }) => {
      const content = String(e.content || '');
      return {
        index: i,
        name: titleOf(e, i),
        keys: keysOf(e),
        enabled: isEnabled(e),
        constant: e.constant === true,
        chars: content.length,
        preview: preview(content),
        status: 'removed' as const,
        delta: -content.length,
      };
    });
}

/** Tổng kết một dòng cho phần đầu bảng. */
export function summarizeLorebook(rows: LorebookRow[], removed: LorebookRow[]) {
  return {
    total: rows.length,
    enabled: rows.filter(r => r.enabled).length,
    added: rows.filter(r => r.status === 'added').length,
    changed: rows.filter(r => r.status === 'changed').length,
    removed: removed.length,
    chars: rows.reduce((n, r) => n + r.chars, 0),
  };
}
