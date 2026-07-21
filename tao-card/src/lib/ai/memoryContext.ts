import type { MemoryEntry, MemoryScope } from '../../store/memoryStore';

const SCOPE_LABEL: Record<MemoryScope, string> = {
  global: 'Thói quen của user (áp dụng cho mọi thẻ)',
  project: 'Về thẻ đang làm',
  session: 'Trong phiên này',
};

const SCOPE_ORDER: MemoryScope[] = ['global', 'project', 'session'];

/** Id phiên hiện tại — sinh mới mỗi lần nạp app, để ký ức scope 'session' không rò sang phiên/thẻ khác.
 *  (Trước đây hằng 'current' khiến mọi phiên dùng chung một id → session hoá ra là global.) */
const SESSION_ID = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function getSessionId(): string {
  return SESSION_ID;
}

/**
 * Dựng khối "ĐIỀU ĐÃ BIẾT" để chèn vào system prompt.
 * Tách bạch theo scope để truy vết được câu trả lời chịu ảnh hưởng của ký ức nào.
 * Trả chuỗi RỖNG khi không có gì — tránh tốn token cho khối trống.
 *
 * `sortByRecent`: bật khi danh sách KHÔNG đến từ tìm kiếm (query rỗng → store trả theo thứ tự
 * chèn). Không bật thì `.slice(topN)` sẽ vớ đúng topN ký ức CŨ NHẤT và bỏ im lặng mục vừa thêm.
 * Khi có kết quả tìm kiếm thì để false, vì thứ tự đó đã là thứ tự liên quan.
 */
export function buildMemoryBlock(memories: MemoryEntry[], topN = 12, sortByRecent = false): string {
  const enabled = memories.filter((m) => !m.disabled);
  const ordered = sortByRecent ? [...enabled].sort((a, b) => b.updatedAt - a.updatedAt) : enabled;
  const active = ordered.slice(0, topN);
  if (active.length === 0) return '';

  const lines: string[] = ['=== ĐIỀU ĐÃ BIẾT (ký ức đã được user duyệt) ==='];
  for (const scope of SCOPE_ORDER) {
    const group = active.filter((m) => m.scope === scope);
    if (group.length === 0) continue;
    lines.push(`\n[${SCOPE_LABEL[scope]}]`);
    for (const m of group) lines.push(`- ${m.key}: ${m.value}`);
  }
  lines.push('\nDùng thông tin trên khi liên quan. Nếu mâu thuẫn với điều user vừa nói, ƯU TIÊN điều user vừa nói.');
  return lines.join('\n');
}
