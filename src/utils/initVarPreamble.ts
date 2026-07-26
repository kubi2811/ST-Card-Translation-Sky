/**
 * src/utils/initVarPreamble.ts — (bugNeedFix/111) Dòng nhãn nằm TRƯỚC cây biến trong [initvar].
 * ─────────────────────────────────────────────────────────────────────────────
 * TRIỆU CHỨNG (user báo): entry [initvar] mở đầu bằng dòng chữ "[InitVar] Vui lòng không mở".
 * Vào trình quản lý biến thì biến lớn đầu tiên ("Thế Giới") BIẾN MẤT — thay vào đó là một biến
 * tên "[ InitVar ]" ôm hết đám biến con của nó.
 *
 * GỐC RỄ (đối chiếu source MagVarUpdate — util/common.ts):
 *     export function parseString(content) {
 *       const json_first = /^[[{]/s.test(content.trimStart());
 *       if (json_first) throw …            // ← BỎ QUA YAML
 *       return YAML.parseDocument(content).toJS();
 *     } catch { … JSON5.parse … JSON.parse(jsonrepair(content)) }
 *
 * MVU đọc TRỌN nội dung entry, không hề bỏ dòng nào. Nên:
 *   • dòng chữ ở đầu bị YAML hiểu thành một khoá → nuốt biến lớn đầu tiên;
 *   • nếu dòng đó bắt đầu bằng "[" (đúng ca "[InitVar] …") thì tệ hơn nhiều: parseString tưởng
 *     nội dung là JSON nên KHÔNG chạy YAML nữa, đẩy thẳng qua `jsonrepair` — bộ này cố vá một
 *     khối YAML thành JSON và băm nát cả cây biến.
 *
 * CÁCH CHỮA (khớp hướng dẫn của cộng đồng — "xoá chữ initvar vui lòng không mở đi"):
 * nội dung [initvar] phải BẮT ĐẦU THẲNG bằng cây biến. Lời dặn thuộc về TÊN entry, không phải
 * nội dung. File này lo phần phát hiện + cắt bỏ, dùng cho cả lúc dịch lẫn lúc quét sức khoẻ thẻ.
 */

/** Một dòng có phải "khoá:" hợp lệ của YAML không (khoá có thể bọc nháy). */
function isYamlMappingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('#') || t === '---') return false;
  return /^(?:'[^']+'|"[^"]+"|[^:#]+?)\s*:(?:\s|$)/.test(t);
}

export interface InitVarPreambleResult {
  content: string;
  /** Các dòng đã cắt — để báo cho user biết mình vừa bỏ cái gì, không âm thầm xoá dữ liệu. */
  removed: string[];
}

/**
 * Cắt mọi dòng nhãn/lời dặn nằm TRƯỚC cây biến. Chỉ đụng phần ĐẦU và chỉ cắt dòng KHÔNG phải
 * "khoá:" — thân biến không bao giờ bị chạm. Nội dung vốn là JSON thuần thì giữ nguyên.
 */
export function stripInitVarPreamble(content: string): InitVarPreambleResult {
  const raw = String(content || '');
  if (!raw.trim()) return { content: raw, removed: [] };

  const trimmedAll = raw.trim();
  if (trimmedAll.startsWith('{')) {
    try { JSON.parse(trimmedAll); return { content: raw, removed: [] }; } catch { /* không phải JSON */ }
  }

  const lines = raw.split(/\r?\n/);
  const removed: string[] = [];
  const kept: string[] = [];   // comment YAML (#) và dòng trống — YAML bỏ qua, GIỮ chứ không cắt
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#') || t === '---') { kept.push(lines[i]); i++; continue; }
    if (isYamlMappingLine(t)) break;
    removed.push(t);
    i++;
  }
  if (removed.length === 0) return { content: raw, removed: [] };
  return { content: [...kept, ...lines.slice(i)].join('\n').replace(/^\s*\n/, ''), removed };
}

/** Entry này có phải entry khởi tạo biến không (theo comment hoặc nội dung). */
export function isInitVarEntryText(comment: string, content: string): boolean {
  return /\[initvar\]/i.test(String(comment || '')) || /\[initvar\]/i.test(String(content || ''));
}

/**
 * Kiểm + vá nội dung một entry [initvar]. Giữ lại nhãn `[initvar]` nếu nó đứng riêng một dòng
 * đầu — nhiều thẻ dùng nhãn đó để engine nhận diện, và bản thân nó cũng nằm ở comment.
 *
 * Trả về `null` khi không có gì phải sửa.
 */
export function repairInitVarContent(content: string): { content: string; removed: string[] } | null {
  const raw = String(content || '');
  // Bỏ nhãn [initvar] ra khỏi phép soi (nó không phải cây biến, nhưng cũng không phải "rác").
  const noLabel = raw.replace(/\[initvar\]/gi, '');
  const pre = stripInitVarPreamble(noLabel);
  if (pre.removed.length === 0) return null;
  return { content: pre.content, removed: pre.removed };
}
