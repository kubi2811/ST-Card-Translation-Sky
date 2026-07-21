import type { MemoryEntry, MemoryScope } from '../../store/memoryStore';

const SCOPE_LABEL: Record<MemoryScope, string> = {
  global: 'Thói quen của user (áp dụng cho mọi thẻ)',
  project: 'Về thẻ đang làm',
  session: 'Trong phiên này',
};

const SCOPE_ORDER: MemoryScope[] = ['global', 'project', 'session'];

/**
 * Dựng khối "ĐIỀU ĐÃ BIẾT" để chèn vào system prompt.
 * Tách bạch theo scope để truy vết được câu trả lời chịu ảnh hưởng của ký ức nào.
 * Trả chuỗi RỖNG khi không có gì — tránh tốn token cho khối trống.
 */
export function buildMemoryBlock(memories: MemoryEntry[], topN = 12): string {
  const active = memories.filter((m) => !m.disabled).slice(0, topN);
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
