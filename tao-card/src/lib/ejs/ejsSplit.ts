/**
 * src/lib/ejs/ejsSplit.ts — (Goal 28/07) TÁCH 1 ENTRY GỘP THÀNH NHIỀU ENTRY ĐỘC LẬP.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: entry Auto Creator hay gộp (ví dụ 15 sự kiện trong năm chung 1 entry) — AI được
 * quyền tách thành nhiều entry, MỖI entry kích hoạt đúng theo điều kiện riêng của nó.
 * Luật cứng từ user:
 *   • CHỈ tách khi các phần có điều kiện kích hoạt KHÁC NHAU và ĐỘC LẬP với nhau.
 *   • KHÔNG tách nội dung luôn đi cùng nhau.
 *   • Việc tách phải nằm TRONG BẢNG KẾ HOẠCH duyệt trước ("sẽ tách Entry X thành N entry:
 *     tên 1, tên 2…") — không tách ngầm rồi báo sau. (Phần đó nằm ở ejsAgent/parseRichPlan;
 *     file này là bước THỰC THI sau khi user đã duyệt dòng tách.)
 *   • Entry khác đang getwi() tới entry bị tách phải được vá tham chiếu — ejsRefIntegrity.
 *
 * Thực thi = 1 call AI trả JSON các entry con; validate tất định trước khi áp:
 * đủ ≥2 phần, nội dung không rỗng, và KHÔNG RƠI CHỮ — mọi dòng nội dung gốc phải xuất hiện
 * ở đúng một phần (cho phép AI thêm câu dẫn, nhưng không được bỏ dữ kiện).
 */
import type { ChatMessage, LorebookEntry } from '../../types';
import type { EjsPlanRow, ActivationMode } from './ejsPlanModel';

export interface SplitEntrySpec {
  comment: string;
  content: string;
  mode: ActivationMode;
  keys: string[];
}

export interface SplitResult {
  parts: SplitEntrySpec[];
  /** Cảnh báo validate (không chặn nhưng phải hiện cho user). */
  warnings: string[];
}

const SPLIT_SYSTEM = `Bạn là biên tập viên lorebook SillyTavern. Nhiệm vụ: TÁCH một entry đang gộp
nhiều phần thành các entry riêng, mỗi entry kích hoạt đúng điều kiện của nó.

LUẬT BẮT BUỘC:
1. CHỈ chia theo ranh giới điều kiện kích hoạt độc lập (mốc thời gian, địa điểm, giai đoạn…).
   Nội dung luôn đi cùng nhau thì GIỮ CHUNG một phần — thà ít phần mà đúng còn hơn chia vụn.
2. KHÔNG được làm rơi dữ kiện: mọi thông tin của entry gốc phải nằm trong đúng một phần.
   Được thêm 1-2 câu dẫn ngữ cảnh cho phần bị mất ngữ cảnh khi đứng riêng, không được bịa lore mới.
3. Mỗi phần chọn chế độ kích hoạt phù hợp:
   - "keyword": kèm mảng keys sát cách người chơi nhắc tới phần đó (tên riêng, mốc thời gian…).
   - "conditional": phần gắn với biến MVU — entry sẽ để TẮT sẵn chờ controller bật.
   - "constant": CHỈ khi phần đó buộc phải có mọi lượt (hiếm).
4. Tên các phần phải theo đúng danh sách kế hoạch đã duyệt nếu được cung cấp; thiếu tên thì tự đặt
   tên ngắn gọn theo nội dung, KHÔNG trùng nhau.

Trả về DUY NHẤT JSON:
{
  "parts": [
    { "comment": "Tên entry con", "content": "Nội dung phần này", "mode": "keyword"|"conditional"|"constant", "keys": ["từ khoá"] }
  ]
}`;

export function buildSplitMessages(entry: LorebookEntry, row: EjsPlanRow): ChatMessage[] {
  const planned = (row.splitInto ?? [])
    .map(p => `- "${p.name}" | ${p.mode} | điều kiện: ${p.criterion}`)
    .join('\n');
  return [
    { role: 'system', content: SPLIT_SYSTEM },
    {
      role: 'user',
      content: [
        `ENTRY GỐC "${entry.comment || `#${entry.id}`}" (keys hiện tại: ${(entry.keys ?? []).filter(Boolean).join(', ') || '(không)'}):`,
        '─'.repeat(40),
        String(entry.content ?? ''),
        '─'.repeat(40),
        planned ? `KẾ HOẠCH ĐÃ DUYỆT — tách thành các phần sau (bám đúng tên + điều kiện):\n${planned}` : '',
        row.requirement ? `CHỈ DẪN THÊM: ${row.requirement}` : '',
      ].filter(Boolean).join('\n'),
    },
  ];
}

const MODES: ActivationMode[] = ['constant', 'keyword', 'conditional', 'disabled'];

/** Chuẩn hoá dòng để so phủ dữ kiện: bỏ khoảng trắng thừa, hạ thường. */
function normLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function parseSplitResponse(raw: string, original: LorebookEntry, row: EjsPlanRow): SplitResult {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON khi tách entry.');
  const p = JSON.parse(m[0]) as { parts?: Array<Record<string, unknown>> };

  const parts: SplitEntrySpec[] = (p.parts ?? [])
    .filter(x => x && String(x.content ?? '').trim())
    .map((x, i) => ({
      comment: String(x.comment ?? '').trim() || row.splitInto?.[i]?.name || `${original.comment} (phần ${i + 1})`,
      content: String(x.content ?? '').trim(),
      mode: MODES.includes(x.mode as ActivationMode) ? (x.mode as ActivationMode) : (row.splitInto?.[i]?.mode ?? 'keyword'),
      keys: Array.isArray(x.keys) ? x.keys.map(String).filter(k => k.trim()) : [],
    }));

  if (parts.length < 2) {
    throw new Error(`Tách "${original.comment}" thất bại: AI trả về ${parts.length} phần (cần ≥ 2). Entry gốc được GIỮ NGUYÊN.`);
  }

  const warnings: string[] = [];
  // Không trùng tên giữa các phần.
  const seen = new Set<string>();
  for (const part of parts) {
    let name = part.comment, k = 2;
    while (seen.has(name.toLowerCase())) name = `${part.comment} (${k++})`;
    if (name !== part.comment) {
      warnings.push(`Hai phần trùng tên "${part.comment}" — đã tự đổi thành "${name}".`);
      part.comment = name;
    }
    seen.add(name.toLowerCase());
  }
  // Phần keyword mà không có key nào thì sẽ không bao giờ kích hoạt.
  for (const part of parts) {
    if (part.mode === 'keyword' && part.keys.length === 0) {
      warnings.push(`Phần "${part.comment}" kích hoạt theo từ khoá nhưng KHÔNG có key nào — sẽ không bao giờ hiện. Kiểm lại trước khi dùng.`);
    }
  }
  // KHÔNG RƠI CHỮ: mỗi dòng có nội dung của bản gốc phải xuất hiện trong một phần nào đó.
  const joined = normLine(parts.map(x => x.content).join('\n'));
  const lost = String(original.content ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 12)               // dòng quá ngắn (tiêu đề, gạch) không tính
    .filter(l => !joined.includes(normLine(l)));
  if (lost.length > 0) {
    warnings.push(
      `${lost.length} dòng của entry gốc KHÔNG thấy trong các phần đã tách (vd: "${lost[0].slice(0, 60)}…"). ` +
      'Entry gốc chỉ bị TẮT chứ không xoá — có thể bật lại nếu thiếu dữ kiện.',
    );
  }

  return { parts, warnings };
}
