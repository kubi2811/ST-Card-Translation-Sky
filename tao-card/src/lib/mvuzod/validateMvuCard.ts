/**
 * validateMvuCard.ts — (Goal 100.4) BỘ KIỂM HỢP NHẤT cho card MVU, dùng CHUNG mọi nơi.
 * ─────────────────────────────────────────────────────────────────────────────
 * Trước đây mỗi nơi kiểm một kiểu: gameUiValidator kiểm regex/UI, final_check nhờ AI review,
 * QualityCheck quét riêng — và không nơi nào kiểm ĐÚNG hợp đồng engine (bug 75: khen "card
 * đã chơi được" trong khi form bấm không ăn). Suite này gom về MỘT cửa, mọi luật đối chiếu
 * từ source MagVarUpdate thật (mvuReference.ts — Goal 100.1) + harness (mvuHarness.ts — 100.2).
 *
 * Mức lỗi:
 *   error   — card SẼ hỏng trong SillyTavern (initvar bật, thiếu đường ghi biến, sai phương ngữ…)
 *   warning — chạy được nhưng có mùi (thiếu entry quy tắc, biến không khớp schema…)
 */
import {
  MVU_ENTRY_MARKERS, MVU_TAGS, isMvuUpdateBlockAccepted,
} from './mvuReference';
import { checkFormWritePath } from './mvuHarness';

export interface MvuCardIssue {
  level: 'error' | 'warning';
  /** Mã ổn định để autofix/goalAgent (Phase 101+) nhắm đúng lỗi mà sửa. */
  code: string;
  message: string;
  /** Vị trí (comment entry / tên script) để user nhảy tới. */
  where?: string;
}

export interface MvuCardReport {
  ok: boolean;
  errors: MvuCardIssue[];
  warnings: MvuCardIssue[];
  /** Thống kê nhanh cho UI/log. */
  stats: { initvarEntries: number; updateEntries: number; formScripts: number };
}

interface EntryLike {
  comment?: string;
  content?: string;
  enabled?: boolean;
  constant?: boolean;
  [k: string]: unknown;
}
interface ScriptLike {
  scriptName?: string;
  replaceString?: string;
  [k: string]: unknown;
}

export interface MvuCardInput {
  /** entries của character_book (hoặc worldbook đã convert). */
  entries: EntryLike[];
  /** regex_scripts (nơi Opening Form/Status Bar sống trong replaceString). */
  regexScripts?: ScriptLike[];
}

export function validateMvuCard(card: MvuCardInput): MvuCardReport {
  const errors: MvuCardIssue[] = [];
  const warnings: MvuCardIssue[] = [];
  const entries = Array.isArray(card.entries) ? card.entries : [];
  const scripts = Array.isArray(card.regexScripts) ? card.regexScripts : [];

  /* ─── 1. Entry [initvar] ─── */
  const initvars = entries.filter((e) => MVU_ENTRY_MARKERS.initvar.test(String(e.comment ?? '')));
  if (initvars.length === 0) {
    errors.push({ level: 'error', code: 'initvar-missing',
      message: 'Không có entry [initvar] — MVU không có gì để khởi tạo biến, card vào game là chết.' });
  }
  for (const e of initvars) {
    const where = String(e.comment ?? '[initvar]');
    // Engine chỉ nhận entry initvar khi nó TẮT (enabled=false) — bật lên là 变量更新失败.
    if (e.enabled !== false) {
      errors.push({ level: 'error', code: 'initvar-enabled',
        message: 'Entry [initvar] đang BẬT — engine chỉ đọc nó làm template khi enabled=false.', where });
    }
    const content = String(e.content ?? '').trim();
    if (!content) {
      errors.push({ level: 'error', code: 'initvar-empty', message: 'Entry [initvar] rỗng.', where });
    } else if (/^\S+\/\S+\s*:/m.test(content)) {
      // Khoá phẳng "Player/Name:" — MVU đọc thành MỘT khoá tên có dấu / (bug 78a).
      errors.push({ level: 'error', code: 'initvar-flat-keys',
        message: 'Initvar dùng khoá PHẲNG dạng "A/B:" thay vì cây — MVU sẽ coi cả chuỗi là MỘT tên biến. Chạy nestFlatInitvarKeys để dựng lại cây.', where });
    }
  }

  /* ─── 2. Entry [mvu_update] — khối <UpdateVariable> ─── */
  const updates = entries.filter((e) => MVU_ENTRY_MARKERS.update.test(String(e.comment ?? '')));
  if (updates.length === 0) {
    warnings.push({ level: 'warning', code: 'update-missing',
      message: 'Không có entry [mvu_update] — model chính/phụ không được dạy cách xuất biến; thường vẫn cần ít nhất một entry định dạng đầu ra.' });
  }
  for (const e of updates) {
    const where = String(e.comment ?? '[mvu_update]');
    const content = String(e.content ?? '');
    const hasBlock = new RegExp(`<${MVU_TAGS.root}>`, 'i').test(content);
    if (!hasBlock) continue; // entry quy tắc thuần chữ — hợp lệ
    // Chuẩn NHẬN của engine: một trong HAI phương ngữ (JSON Patch hoặc _.set) là đủ —
    // trước đây tool chỉ biết JSONPatch nên bắt lỗi oan card dùng _.set.
    if (!isMvuUpdateBlockAccepted(content)) {
      errors.push({ level: 'error', code: 'update-block-invalid',
        message: `Khối <${MVU_TAGS.root}> không chứa phương ngữ hợp lệ nào (JSON Patch hoặc lệnh _.set) — đúng lỗi "其内的更新命令无效" của engine.`, where });
    }
  }

  /* ─── 3. Đường ghi biến của Opening Form (bug #162) ─── */
  const formScripts = scripts.filter((s) => {
    const src = String(s.replaceString ?? '');
    // Nhận diện form: có collectFormData/onConfirm hoặc input + nút xác nhận.
    return /collectFormData|onConfirm/.test(src);
  });
  for (const s of formScripts) {
    const check = checkFormWritePath(String(s.replaceString ?? ''));
    for (const p of check.problems) {
      errors.push({ level: 'error', code: 'form-write-path',
        message: `Opening Form ghi biến sai đường: ${p}`, where: String(s.scriptName ?? 'form') });
    }
  }

  return {
    ok: errors.length === 0,
    errors, warnings,
    stats: { initvarEntries: initvars.length, updateEntries: updates.length, formScripts: formScripts.length },
  };
}
