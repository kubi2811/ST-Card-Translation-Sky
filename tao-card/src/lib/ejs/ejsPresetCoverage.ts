/**
 * src/lib/ejs/ejsPresetCoverage.ts — (bugNeedFix/168 mục 2 & 3) ĐỐI CHIẾU PRESET ↔ KẾ HOẠCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User báo hai chuyện, mà soi ra thì cùng một gốc:
 *   • mục 2 — "nhãn tên Preset chỉ hiện ở 2-3 dòng, phần lớn dòng không có nhãn nào cả";
 *   • mục 3 — "đợt chạy Áp dụng tất cả mới thấy khoảng 13/19 Preset trong kết quả".
 *
 * Gốc chung: gói tổng dựng goal có sẵn dấu `[preset: id]` ở đầu MỖI mục (19 mục), nhưng
 *   ① prompt chưa bao giờ dạy AI đọc dấu đó và khai lại — nên nhãn phải đoán bằng suy luận
 *     phía client, mà bảng suy luận chỉ phủ nổi 4/19 loại việc;
 *   ② KHÔNG có một dòng code nào đối chiếu "goal đã yêu cầu 19 việc" với "kế hoạch trả về mấy
 *     dòng" — AI làm được bao nhiêu thì lấy bấy nhiêu, im lặng. Khối càng về cuối một prompt
 *     11k ký tự càng dễ rơi, và không có gì đỏ lên.
 *
 * File này là phần LOGIC THUẦN của việc đối chiếu, tách khỏi React để test được không cần AI.
 *
 * MỘT ĐIỂM PHẢI NÓI RÕ ĐỂ KHỎI ĐẾM NHẦM: 3 trong 19 preset (Tiết kiệm token, NPC theo từ khoá,
 * Tách entry gộp) về bản chất KHÔNG sinh khối EJS nào — chúng đổi chế độ kích hoạt hoặc tách
 * entry. Ai đếm "preset đã áp" bằng cách đếm entry chứa `<%` sẽ tự động hụt đúng 3 cái. Vì thế
 * báo cáo ở đây tách hai loại bằng chứng: sinh khối EJS, và đổi cấu hình/cấu trúc.
 */
import type { EjsPlanRow } from './ejsPlanModel';
import { QUICK_PRESETS } from './ejsQuickPresets';

/** Dấu gói tổng in vào goal cho từng mục: "━━ 3. TÁCH ENTRY GỘP [preset: split-bloated] ━━". */
const PRESET_MARK_RE = /\[preset:\s*([a-z0-9-]+)\s*\]/gi;
/** Dấu mục ĐÃ XÉT NHƯNG KHÔNG ÁP: "[preset-skip: split-bloated] Tách entry gộp — bỏ vì …". */
const PRESET_SKIP_RE = /\[preset-skip:\s*([a-z0-9-]+)\s*\][^\n]*/gi;

/** Bóc danh sách preset mà YÊU CẦU đã đặt hàng, theo đúng thứ tự xuất hiện. */
export function extractRequestedPresets(goal: string): string[] {
  const out: string[] = [];
  for (const m of String(goal ?? '').matchAll(PRESET_MARK_RE)) {
    const id = m[1].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Bóc các mục gói tổng đã XÉT RỒI QUYẾT ĐỊNH KHÔNG ÁP, kèm lý do.
 * Đây là phần trước đây rơi mất hoàn toàn khỏi yêu cầu, khiến 19 mục co lại còn 13 mà không ai
 * nói vì sao. Trả về map id → nguyên văn dòng khai báo (đã có sẵn lý do trong đó).
 */
export function extractDeclaredSkips(goal: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of String(goal ?? '').matchAll(PRESET_SKIP_RE)) {
    out.set(m[1].toLowerCase(), m[0].trim());
  }
  return out;
}

export type PresetStatus =
  /** Có ít nhất một dòng kế hoạch mang nhãn preset này. */
  | 'covered'
  /** Yêu cầu có đặt hàng nhưng AI không trả về dòng nào — đây là ca user gặp. */
  | 'missing'
  /** AI cố ý bỏ và ĐÃ nêu lý do trong notes. */
  | 'skipped-explained';

export interface PresetCoverageRow {
  presetId: string;
  title: string;
  status: PresetStatus;
  /** Số dòng kế hoạch quy về preset này. */
  rowCount: number;
  /** Loại bằng chứng: preset này để lại dấu bằng khối EJS hay bằng đổi cấu hình. */
  evidence: 'ejs-block' | 'config-change' | 'unknown';
  /** Vì sao vắng mặt / bị bỏ — luôn có chữ, không bao giờ để trống. */
  note: string;
}

export interface PresetCoverageReport {
  requested: number;
  covered: number;
  missing: number;
  rows: PresetCoverageRow[];
  /** Câu cảnh báo đưa vào plan.notes để user thấy ngay ở bảng kế hoạch. */
  warnings: string[];
}

/**
 * Preset chỉ đổi cấu hình/cấu trúc, KHÔNG sinh khối EJS. Đếm chúng bằng entry `<%` là sai.
 * Danh sách bám theo hành vi thật của từng preset trong ejsQuickPresets.ts.
 */
const CONFIG_ONLY_PRESETS = new Set(['save-tokens', 'keyword-npc', 'split-bloated']);

function titleOf(id: string): string {
  return QUICK_PRESETS.find(p => p.id === id)?.title ?? id;
}

/** Lý do vắng mặt có nêu trong notes của AI không (AI được yêu cầu ghi "[preset: x] bỏ vì …"). */
function findSkipNote(notes: string[], presetId: string): string | null {
  const re = new RegExp(`\\[preset:\\s*${presetId}\\s*\\]`, 'i');
  const hit = notes.find(n => re.test(n));
  return hit ? hit.trim() : null;
}

/**
 * Đối chiếu goal (đã đặt hàng những preset nào) với kế hoạch AI trả về.
 * Trả bảng 19 dòng — mỗi preset một trạng thái, KHÔNG cái nào bị bỏ trống không giải thích.
 */
export function buildPresetCoverage(
  goal: string,
  rows: EjsPlanRow[],
  notes: string[] = [],
): PresetCoverageReport {
  const requested = extractRequestedPresets(goal);
  const declaredSkips = extractDeclaredSkips(goal);
  if (requested.length === 0 && declaredSkips.size === 0) {
    return { requested: 0, covered: 0, missing: 0, rows: [], warnings: [] };
  }

  const countByPreset = new Map<string, number>();
  for (const r of rows) {
    const pid = (r.presetId ?? '').toLowerCase();
    if (!pid) continue;
    countByPreset.set(pid, (countByPreset.get(pid) ?? 0) + 1);
  }

  const out: PresetCoverageRow[] = [];
  const warnings: string[] = [];

  for (const id of requested) {
    const n = countByPreset.get(id) ?? 0;
    const title = titleOf(id);
    const evidence: PresetCoverageRow['evidence'] =
      CONFIG_ONLY_PRESETS.has(id) ? 'config-change' : 'ejs-block';

    if (n > 0) {
      out.push({
        presetId: id, title, status: 'covered', rowCount: n, evidence,
        note: evidence === 'config-change'
          ? `${n} dòng — preset này đổi cấu hình/tách entry, KHÔNG sinh khối EJS (đừng tìm dấu <% để đếm nó).`
          : `${n} dòng.`,
      });
      continue;
    }

    const skip = findSkipNote(notes, id);
    if (skip) {
      out.push({
        presetId: id, title, status: 'skipped-explained', rowCount: 0, evidence,
        note: skip,
      });
      continue;
    }

    out.push({
      presetId: id, title, status: 'missing', rowCount: 0, evidence,
      note: 'Yêu cầu có đặt hàng nhưng kế hoạch KHÔNG có dòng nào cho preset này, và AI cũng không nêu lý do bỏ.',
    });
    warnings.push(
      `⚠️ Gói tổng đã yêu cầu "${title}" nhưng kế hoạch không có dòng nào cho nó — `
      + `bấm "Lên kế hoạch" lại, hoặc thêm yêu cầu riêng cho mục này.`,
    );
  }

  // Mục gói tổng đã xét rồi quyết định không áp — vẫn phải có mặt trong báo cáo, kèm lý do.
  for (const [id, line] of declaredSkips) {
    if (requested.includes(id)) continue; // vừa đặt hàng vừa khai bỏ thì lấy phần đặt hàng.
    out.push({
      presetId: id, title: titleOf(id), status: 'skipped-explained', rowCount: 0,
      evidence: CONFIG_ONLY_PRESETS.has(id) ? 'config-change' : 'ejs-block',
      note: line,
    });
  }

  const covered = out.filter(r => r.status === 'covered').length;
  const missing = out.filter(r => r.status === 'missing').length;
  if (missing > 0) {
    warnings.unshift(
      `Kế hoạch mới phủ ${covered}/${requested.length} preset đã đặt hàng — ${missing} preset vắng mặt không lý do.`,
    );
  }
  return { requested: requested.length, covered, missing, rows: out, warnings };
}

/**
 * (mục 2) Nhãn hiển thị cho MỘT dòng kế hoạch — không bao giờ trả chuỗi rỗng.
 * User: "nếu không thể xác định chắc chắn preset nào thì phải nói rõ lý do không gán được,
 * không được để trống không giải thích."
 */
export function presetLabelFor(row: EjsPlanRow, requestedCount: number): { text: string; unknown: boolean } {
  if (row.presetTitle) return { text: row.presetTitle, unknown: false };
  if (row.presetId) return { text: titleOf(row.presetId), unknown: false };
  if (requestedCount === 0) {
    return { text: 'Yêu cầu tự gõ (không dùng preset)', unknown: true };
  }
  return {
    text: 'Chưa rõ preset — AI không khai và máy không suy được',
    unknown: true,
  };
}
