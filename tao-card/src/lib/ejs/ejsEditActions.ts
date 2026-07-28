/**
 * src/lib/ejs/ejsEditActions.ts — (bugNeedFix/147) THỰC THI hai hành động vốn KHÔNG có đường ghi.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bảng kế hoạch của EJS Studio cho phép AI đề xuất 5 loại hành động, nhưng chỉ 3 loại có code
 * thi hành (đổi chế độ kích hoạt, tách entry, tạo khối EJS). Hai loại còn lại —
 *   • `edit_content`   : sửa NỘI DUNG một entry lorebook có sẵn
 *   • `edit_character` : sửa một trường Character Definition (description/personality/scenario…)
 * — rơi thẳng vào bước sinh khối EJS mới, nên kết quả là **tạo thêm một entry lạ** còn entry gốc
 * và phần mô tả nhân vật thì không đổi một chữ. User duyệt xong, thấy báo hoàn thành, mở thẻ ra
 * thì chẳng có gì thay đổi — đúng mục 1 trong "Prompt cải thiện EJS".
 *
 * Đây cũng là thứ user xin ở bug 126: "Cho phép AI xử lý luôn cả Character Definition, không chỉ
 * giới hạn ở Lorebook/entry."
 *
 * NGUYÊN TẮC AN TOÀN (vì đây là sửa ĐÈ lên văn bản người ta đã viết, không phải thêm mới):
 *   1. Bản mới phải giữ mọi TÊN RIÊNG và CON SỐ của bản cũ — mất là từ chối, giữ nguyên bản cũ.
 *      (Cùng một chốt đã dùng cho đũa thần ở bugNeedFix/145 — sửa văn mà làm rơi dữ kiện là hỏng.)
 *   2. Không cho phép rút ngắn quá tay: dưới 50% độ dài cũ là nghi cắt mất nội dung.
 *   3. Không đụng tới khối EJS/macro sẵn có trong văn bản (đếm phải khớp).
 * Mọi vi phạm đều TRẢ VỀ LÝ DO để hiện cho user, không sửa lén.
 */
import type { ChatMessage } from '../../types';
import { extractAnchorTokens } from '../ai/ideaPolish';

/** Trường Character Definition mà AI được phép sửa. */
export const EDITABLE_CHARACTER_FIELDS = [
  'description', 'personality', 'scenario', 'mes_example', 'system_prompt', 'first_mes',
] as const;
export type EditableCharacterField = typeof EDITABLE_CHARACTER_FIELDS[number];

const FIELD_LABEL: Record<string, string> = {
  description: 'Mô tả nhân vật',
  personality: 'Tính cách',
  scenario: 'Bối cảnh',
  mes_example: 'Ví dụ hội thoại',
  system_prompt: 'System prompt',
  first_mes: 'Lời chào đầu',
};

/** Tên trường AI khai → khoá thật trong card.data. Không khớp thì null (báo lỗi, không đoán). */
export function resolveCharacterField(name: string): EditableCharacterField | null {
  const k = String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const direct = EDITABLE_CHARACTER_FIELDS.find(f => f === k);
  if (direct) return direct;
  const byLabel: Record<string, EditableCharacterField> = {
    'mô_tả': 'description', 'mô_tả_nhân_vật': 'description', 'char_description': 'description',
    'tính_cách': 'personality', 'bối_cảnh': 'scenario',
    'ví_dụ_hội_thoại': 'mes_example', 'lời_chào': 'first_mes', 'lời_chào_đầu': 'first_mes',
    'system': 'system_prompt',
  };
  return byLabel[k] ?? null;
}

export function characterFieldLabel(f: string): string {
  return FIELD_LABEL[f] ?? f;
}

const EDIT_SYSTEM = `Bạn là biên tập viên nội dung thẻ nhân vật SillyTavern.
Người dùng đưa một đoạn văn bản HIỆN CÓ và một yêu cầu chỉnh sửa. Việc của bạn là trả về bản
ĐÃ SỬA của chính đoạn đó.

QUY TẮC BẮT BUỘC:
- Chỉ sửa đúng phần được yêu cầu. Phần không bị nhắc tới phải GIỮ NGUYÊN VĂN.
- TUYỆT ĐỐI không bỏ tên riêng, con số, hay dữ kiện nào đang có — trừ khi yêu cầu nói thẳng là bỏ.
- Giữ nguyên mọi khối code EJS (<% … %>), macro ({{…}}) và thẻ XML đang có, kể cả vị trí.
- Không thêm lời dẫn, không giải thích, không bọc trong dấu nháy hay khối mã.

Trả về DUY NHẤT nội dung mới, không kèm gì khác.`;

export function buildEditMessages(current: string, requirement: string, what: string): ChatMessage[] {
  return [
    { role: 'system', content: EDIT_SYSTEM },
    {
      role: 'user',
      content: `ĐANG SỬA: ${what}\n\nYÊU CẦU:\n${requirement}\n\n`
        + `NỘI DUNG HIỆN CÓ (giữ nguyên phần không bị nhắc tới):\n${'─'.repeat(30)}\n${current}`,
    },
  ];
}

/** Bóc phần văn bản thuần từ phản hồi AI (nó hay bọc ```). */
export function parseEditResponse(raw: string): string {
  let t = String(raw ?? '').trim();
  const fence = t.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) t = fence[1];
  return t.trim();
}

export interface EditCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Chốt chặn trước khi GHI ĐÈ. Sửa văn bản người ta đã viết là thao tác phá huỷ — thà từ chối
 * còn hơn lặng lẽ làm rơi nội dung của họ.
 */
export function verifyEdit(before: string, after: string): EditCheck {
  const problems: string[] = [];
  const a = String(before ?? '');
  const b = String(after ?? '');

  if (!b.trim()) {
    return { ok: false, problems: ['AI trả về nội dung rỗng.'] };
  }
  if (b.trim() === a.trim()) {
    return { ok: false, problems: ['AI trả về y hệt bản cũ — không có gì để ghi.'] };
  }
  if (a.length > 200 && b.length < a.length * 0.5) {
    problems.push(`Bản mới chỉ dài bằng ${Math.round(b.length / a.length * 100)}% bản cũ — nghi bị cắt mất nội dung.`);
  }

  // Dữ kiện đo được: tên riêng + con số phải còn nguyên (cùng chốt với đũa thần bug 145).
  const dropped = extractAnchorTokens(a).filter(tok => {
    if (/^\d/.test(tok)) {
      const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`(?<![\\d.,])${esc}(?![\\d.,])`).test(b);
    }
    return !b.toLowerCase().includes(tok.toLowerCase());
  });
  if (dropped.length > 0) {
    problems.push(`Làm rơi ${dropped.length} chi tiết: ${dropped.slice(0, 5).join(', ')}${dropped.length > 5 ? '…' : ''}`);
  }

  // Khối EJS / macro phải còn đủ — sửa văn mà nuốt mất code là làm chết thẻ.
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  if (count(a, /<%/g) !== count(b, /<%/g)) {
    problems.push(`Số khối EJS đổi (${count(a, /<%/g)} → ${count(b, /<%/g)}) — không được đụng vào code.`);
  }
  if (count(a, /\{\{/g) !== count(b, /\{\{/g)) {
    problems.push(`Số macro {{…}} đổi (${count(a, /\{\{/g)} → ${count(b, /\{\{/g)}) — không được đụng vào macro.`);
  }

  return { ok: problems.length === 0, problems };
}
