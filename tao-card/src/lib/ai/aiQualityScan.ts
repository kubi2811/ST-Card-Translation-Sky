/**
 * aiQualityScan.ts — AI QUÉT LỖI LOREBOOK (bug #7)
 *
 * Bổ sung cho các bộ kiểm bằng HÀM (qualityChecker + worldbookHealthCheck): những lỗi mà
 * hàm không bắt được — mâu thuẫn nội dung giữa các entry, thông tin phi logic, entry sơ sài,
 * keys không khớp nội dung… — cần AI đọc hiểu mới thấy. Gộp chung một chỗ với kiểm-bằng-hàm
 * để dịch giả/người làm card có 1 nơi "phân tích & chất lượng" duy nhất.
 */
import { callAI } from './client';
import type { ProxyProfile, GenerationParams, LorebookEntry } from '../../types';

export type AiScanSeverity = 'error' | 'warning' | 'info';

export interface AiScanIssue {
  /** comment của entry liên quan (khớp để nhảy tới) — có thể rỗng nếu là lỗi toàn cục */
  comment: string;
  severity: AiScanSeverity;
  issue: string;
  suggestion?: string;
}

const SYSTEM = `Bạn là chuyên gia kiểm định chất lượng Lorebook (World Info) cho thẻ nhân vật SillyTavern.
Người dùng gửi danh sách entry (comment + keys + content). Nhiệm vụ: TÌM LỖI mà công cụ tự động khó thấy:
- MÂU THUẪN nội dung giữa các entry (một chỗ nói X, chỗ khác nói ngược lại).
- Thông tin PHI LOGIC / sai lệch bối cảnh.
- Entry SƠ SÀI, tóm tắt hời hợt, thiếu chi tiết đáng lẽ phải có.
- KEYS không khớp / không đại diện cho nội dung (kích hoạt sai).
- Trùng lặp ý nghĩa giữa các entry.

QUY TẮC:
1. CHỈ báo lỗi THỰC SỰ đáng sửa. Không bịa, không báo lỗi vụn vặt. Entry tốt thì bỏ qua.
2. Mỗi lỗi gắn "comment" = comment của entry liên quan (chép ĐÚNG nguyên văn); lỗi giữa nhiều entry thì chọn 1 entry chính.
3. severity: "error" (hỏng/mâu thuẫn nặng), "warning" (nên sửa), "info" (gợi ý).
4. Viết "issue" và "suggestion" bằng tiếng Việt, ngắn gọn.
5. CHỈ trả về MẢNG JSON thuần, KHÔNG markdown, KHÔNG giải thích:
[{"comment":"...","severity":"warning","issue":"...","suggestion":"..."}]
Nếu không tìm thấy lỗi nào: trả về [].`;

function buildUserMessage(entries: LorebookEntry[]): string {
  // Cắt content mỗi entry để tiết kiệm token nhưng vẫn đủ ngữ cảnh
  const lines = entries.map((e, i) => {
    const content = (e.content || '').slice(0, 800);
    return `### Entry ${i + 1}\ncomment: ${e.comment}\nkeys: ${(e.keys || []).join(', ')}\ncontent: ${content}`;
  });
  return `Kiểm tra ${entries.length} entry Lorebook dưới đây, báo lỗi theo đúng format JSON đã yêu cầu:\n\n${lines.join('\n\n')}`;
}

/** Parse mảng issue từ text AI (chịu được cắt cụt/rác bao quanh). */
export function parseScanIssues(text: string): AiScanIssue[] {
  const t = (text || '').trim();
  const tryArr = (s: string): AiScanIssue[] | null => {
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return normalize(p);
    } catch { /* ignore */ }
    return null;
  };
  // 1) parse thẳng
  let r = tryArr(t);
  if (r) return r;
  // 2) code fence
  const fence = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) { r = tryArr(fence[1].trim()); if (r) return r; }
  // 3) [ đầu … ] cuối
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a !== -1 && b > a) { r = tryArr(t.substring(a, b + 1)); if (r) return r; }
  // 4) cứu vớt object {...} rời (mảng bị cắt cụt)
  const objs: unknown[] = [];
  let i = 0;
  while (i < t.length) {
    if (t[i] !== '{') { i++; continue; }
    let d = 0, s = false, esc = false, end = -1;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { if (s) esc = true; continue; }
      if (c === '"') { s = !s; continue; }
      if (s) continue;
      if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = j; break; } }
    }
    if (end === -1) break;
    try { objs.push(JSON.parse(t.substring(i, end + 1))); } catch { /* skip */ }
    i = end + 1;
  }
  return normalize(objs);
}

function normalize(arr: unknown[]): AiScanIssue[] {
  const out: AiScanIssue[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.issue !== 'string' || !o.issue.trim()) continue;
    const sev = o.severity === 'error' || o.severity === 'info' ? o.severity : 'warning';
    out.push({
      comment: typeof o.comment === 'string' ? o.comment : '',
      severity: sev,
      issue: o.issue.trim(),
      suggestion: typeof o.suggestion === 'string' && o.suggestion.trim() ? o.suggestion.trim() : undefined,
    });
  }
  return out;
}

export async function runAiQualityScan(
  entries: LorebookEntry[],
  profile: ProxyProfile,
  params: GenerationParams,
  signal?: AbortSignal,
): Promise<AiScanIssue[]> {
  if (entries.length === 0) return [];
  const raw = await callAI({
    profile, params, signal,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserMessage(entries) },
    ],
  });
  return parseScanIssues(raw.text);
}
