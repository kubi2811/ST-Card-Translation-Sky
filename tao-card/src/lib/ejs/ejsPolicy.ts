/**
 * src/lib/ejs/ejsPolicy.ts — (bug 126) BIẾN KẾ HOẠCH EJS ĐÃ DUYỆT THÀNH CHÍNH SÁCH CHO AUTO CREATOR.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Thêm cả nút áp dụng vào Auto Creator — lưu ý tính năng này chỉ thực hiện khi Card đã
 * tạo xong … khi bấm nút áp dụng vào Auto Creator thì ở mục Auto Creator cần có thông báo để
 * người dùng biết tính năng này đã áp dụng."
 *
 * Điểm phải nghĩ kỹ: kế hoạch EJS gắn với MỘT card cụ thể — nó nhắc đích danh "NPC: Lâm Uyển",
 * "Cảnh giới tu luyện". Bê nguyên tên entry sang Auto Creator là vô nghĩa, vì card sau sẽ có
 * tên khác hoàn toàn. Cái đáng mang sang là CÁCH LÀM: tỉ lệ Constant nên giữ bao nhiêu, loại
 * entry nào hạ xuống từ khoá, loại nào gắn biến. Nên hàm này CHƯNG CẤT kế hoạch thành chỉ dẫn
 * dạng nguyên tắc, có dẫn vài ví dụ thật từ card nguồn để Auto Creator hiểu ý — chứ không chép
 * danh sách tên.
 *
 * Vì sao không ghi vào `stepConfigs.lorebook.promptOverride`: nút "Áp dụng sang Auto Creator"
 * của AI Sinh Theo Batch đã chiếm chỗ đó. Ghi chung là cái sau xoá cái trước, user bấm cả hai
 * thì mất một. Chính sách EJS nằm ở field riêng `appliedEjsPolicy` để hai đường cộng hưởng.
 */
import type { AppliedEjsPolicy } from '../../types';
import { ACTIVATION_LABEL, type EjsPlanRow, type EjsRichPlan } from './ejsPlanModel';

export function buildEjsPolicy(
  plan: EjsRichPlan,
  acceptedIds: Set<string>,
  sourceCard: string,
  goal: string,
  now: string,
): AppliedEjsPolicy {
  const rows = plan.rows.filter(r => acceptedIds.has(r.id));

  const reclassify = rows.filter(r => r.action === 'reclassify');
  const createEjs = rows.filter(r => r.action === 'create_ejs');
  const character = rows.filter(r => r.target === 'character');
  const tokensSaved = rows.reduce((s, r) => s + (r.tokensSaved ?? 0), 0);

  return {
    appliedAt: now,
    sourceCard,
    goal: goal.trim(),
    rowCount: rows.length,
    summary: {
      reclassify: reclassify.length,
      createEjs: createEjs.length,
      character: character.length,
      tokensSaved,
    },
    directive: buildDirective(rows, goal),
  };
}

/** Nhóm các dòng đổi chế độ theo (từ → sang) để rút ra nguyên tắc thay vì liệt kê tên. */
function groupReclassify(rows: EjsPlanRow[]): Map<string, EjsPlanRow[]> {
  const g = new Map<string, EjsPlanRow[]>();
  for (const r of rows) {
    if (!r.currentMode || !r.proposedMode || r.currentMode === r.proposedMode) continue;
    const k = `${r.currentMode}→${r.proposedMode}`;
    g.set(k, [...(g.get(k) ?? []), r]);
  }
  return g;
}

function buildDirective(rows: EjsPlanRow[], goal: string): string {
  if (!rows.length) return '';

  const parts: string[] = [
    'CHÍNH SÁCH EJS / KÍCH HOẠT ENTRY (áp từ EJS Studio — làm theo cách này cho card mới):',
  ];

  const groups = groupReclassify(rows);
  if (groups.size) {
    parts.push('', 'Cách đặt chế độ kích hoạt cho entry lorebook:');
    for (const [key, list] of groups) {
      const [from, to] = key.split('→') as [keyof typeof ACTIVATION_LABEL, keyof typeof ACTIVATION_LABEL];
      // Lấy 2 lý do thật từ card nguồn làm ví dụ — Auto Creator suy ra tiêu chí, không chép tên.
      const why = list.slice(0, 2).map(r => r.reason).filter(Boolean);
      parts.push(
        `- Entry thuộc diện "${ACTIVATION_LABEL[from]}" mà đúng ra chỉ cần "${ACTIVATION_LABEL[to]}" thì đặt luôn là ${ACTIVATION_LABEL[to]} ngay từ đầu (${list.length} trường hợp ở card nguồn).`,
        ...why.map(w => `  Ví dụ tiêu chí: ${w}`),
      );
    }
  }

  const hasConditional = rows.some(r => r.proposedMode === 'conditional');
  if (hasConditional) {
    parts.push(
      '',
      'Entry gắn với biến MVU: để entry TẮT sẵn (enabled=false) và tạo một entry EJS @@preprocessing',
      'bật nó có điều kiện bằng await activewi(tên entry, true). TUYỆT ĐỐI không dùng setEntryEnabled',
      '— hàm đó không tồn tại trong ST-Prompt-template.',
    );
  }

  const created = rows.filter(r => r.action === 'create_ejs');
  if (created.length) {
    parts.push('', `Các khối EJS nên có (${created.length} khối ở card nguồn):`);
    for (const r of created.slice(0, 6)) {
      parts.push(`- ${r.proposal}${r.reason ? ` — ${r.reason}` : ''}`);
    }
    parts.push(
      'Mỗi khối một tên entry riêng; biến đọc từ hai đường dẫn khác nhau PHẢI đặt hai tên khác nhau',
      '(mọi khối @@preprocessing chạy chung một context, trùng tên là bật nhầm entry mà không báo lỗi).',
    );
  }

  const charRows = rows.filter(r => r.target === 'character');
  if (charRows.length) {
    parts.push('', 'Character Definition:', ...charRows.slice(0, 4).map(r => `- ${r.name}: ${r.proposal}`));
  }

  if (goal.trim()) {
    parts.push('', `Ý định gốc của user khi lập chính sách này: ${goal.trim().split('\n')[0]}`);
  }

  return parts.join('\n');
}

/**
 * Card đã "tạo xong" chưa — điều kiện user đặt cho nút áp dụng.
 * Cố tình đo bằng dấu hiệu thật của một card dùng được, không dựa vào cờ nào cả: có tên, có
 * phần mô tả/lời mở đầu, và có lorebook. Thiếu bất kỳ cái nào thì chính sách chưng cất ra sẽ
 * mỏng và dạy Auto Creator sai.
 */
export function isCardReadyForPolicy(card: {
  data?: { name?: string; description?: string; first_mes?: string; character_book?: { entries?: unknown[] } };
}): { ready: boolean; missing: string[] } {
  const d = card?.data ?? {};
  const missing: string[] = [];
  if (!String(d.name ?? '').trim()) missing.push('tên nhân vật');
  if (!String(d.description ?? '').trim() && !String(d.first_mes ?? '').trim()) {
    missing.push('phần mô tả hoặc lời mở đầu');
  }
  if (!(d.character_book?.entries ?? []).length) missing.push('lorebook (chưa có entry nào)');
  return { ready: missing.length === 0, missing };
}
