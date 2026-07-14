// ═══════════════════════════════════════════════════════════════════════════════
// SỨC KHOẺ THẺ — quét nhanh bản dịch TRƯỚC KHI XUẤT để bắt lỗi "chết người" mà bảng
// trạng thái trường (done/error) KHÔNG thấy: <script> vỡ cú pháp (nút bấm liệt trong
// SillyTavern), chữ Hán còn sót trong field code, trường lỗi/chưa dịch.
//
// Thuần tuý (không gọi API, không đụng store) → dễ test + dùng lại cho báo cáo dịch.
// Tái dùng `checkCodeFieldForCjk` (mvuValidator) cho CJK-trong-code, acorn cho parse JS.
// ═══════════════════════════════════════════════════════════════════════════════
import { checkCodeFieldForCjk } from './mvuValidator';
import { extractScriptBodies, isJsSyntaxOk, isLikelyJsScript, jsParseErrorAny } from './scriptSafety';
import type { TranslationField, GlossaryEntry } from '../types/card';

/** Ideograph CJK (Trung/Nhật/Hàn) — dùng để phát hiện chữ chưa dịch còn sót. */
const CJK_IDEOGRAPH = /[一-鿿㐀-䶿぀-ヿ가-힯]/g;

export type HealthSeverity = 'error' | 'warning' | 'info';
export type HealthKind =
  | 'field_error'        // trường dịch lỗi
  | 'field_pending'      // trường chưa dịch xong
  | 'broken_script'      // <script> gốc lành mà bản dịch vỡ cú pháp → nút bấm liệt
  | 'source_script_broken' // script GỐC đã vỡ SẴN (card import bị lỗi từ trước, không phải do dịch)
  | 'residual_cjk_code'  // chữ Hán còn trong field code (json_patch/initvar/controller)
  | 'residual_cjk_text'  // chữ Hán còn sót trong văn bản đã "done" (có thể là tên riêng cố ý)
  | 'glossary_unapplied';// thuật ngữ trong Từ điển vẫn còn NGUYÊN GỐC trong bản dịch (dịch chưa nhất quán)

export interface HealthIssue {
  severity: HealthSeverity;
  kind: HealthKind;
  label: string;
  path: string;
  detail: string;
}

export interface HealthReport {
  counts: {
    total: number;
    done: number;
    error: number;
    pending: number;
    skipped: number;
    brokenScripts: number;
    residualCjkCode: number;
    residualCjkText: number;
    glossaryUnapplied: number;
  };
  issues: HealthIssue[];
  /** true = không còn vấn đề mức 'error' → an toàn để xuất. */
  ok: boolean;
}

/** Bao nhiêu ký tự CJK còn sót trong 1 field 'done' thì mới coi là đáng chú ý (giảm nhiễu
 *  tên riêng để nguyên có chủ đích). */
const RESIDUAL_TEXT_THRESHOLD = 3;

const CODE_ENTRY_TYPES = new Set(['json_patch', 'initvar', 'controller']);

/** Quét toàn bộ trường → báo cáo sức khoẻ (đếm + danh sách vấn đề đã sắp theo mức độ).
 *  `glossary` (tuỳ chọn) = Từ điển thuật ngữ đang dùng → kiểm bản dịch có ÁP đúng chưa
 *  (tên riêng/thuật ngữ còn nguyên gốc = dịch thiếu nhất quán). Tái dùng chính glossary mà
 *  engine đã bơm vào mỗi call — không dựng từ điển mới. */
export function scanFieldsHealth(fields: TranslationField[], glossary?: GlossaryEntry[]): HealthReport {
  const issues: HealthIssue[] = [];
  let brokenScripts = 0, residualCjkCode = 0, residualCjkText = 0, glossaryUnapplied = 0;
  let done = 0, error = 0, pending = 0, skipped = 0;

  // Chỉ giữ mục từ điển hợp lệ (source≠target, đủ dài để không báo nhầm 1 ký tự).
  const activeGlossary = (glossary || []).filter(
    (g) => g.source?.trim() && g.target?.trim() && g.source.trim() !== g.target.trim() && g.source.trim().length >= 2
  );

  for (const f of fields) {
    if (f.status === 'done') done++;
    else if (f.status === 'error') error++;
    else if (f.status === 'pending' || f.status === 'translating') pending++;
    else if (f.status === 'skipped' || f.status === 'ignored') skipped++;

    if (f.status === 'error') {
      issues.push({ severity: 'error', kind: 'field_error', label: f.label, path: f.path,
        detail: f.error || 'Dịch lỗi.' });
    } else if (f.status === 'pending' || f.status === 'translating') {
      issues.push({ severity: 'warning', kind: 'field_pending', label: f.label, path: f.path,
        detail: 'Chưa dịch xong.' });
    }

    // ─── (User 2026 — bug script 71K cụt đuôi) SCRIPT JS TRẦN (TavernHelper, không có <script> tag) ───
    // Chạy TRƯỚC gate `!trans` để card VỪA IMPORT (chưa dịch) cũng được soi: script GỐC đã vỡ sẵn
    // (import card lỗi từ trước) → báo ngay kèm SỐ DÒNG, khỏi đợi dịch xong mới biết.
    const orig = f.original || '';
    if (isLikelyJsScript(orig)) {
      const origErr = jsParseErrorAny(orig);
      if (origErr === null) {
        if (f.translated && f.translated !== orig) {
          const tErr = jsParseErrorAny(f.translated);
          if (tErr) {
            brokenScripts++;
            issues.push({ severity: 'error', kind: 'broken_script', label: f.label, path: f.path,
              detail: `Script vỡ cú pháp JS SAU DỊCH (dòng ~${tErr.line}: ${tErr.msg.slice(0, 70)}) — script sẽ liệt trong SillyTavern. Gốc lành → có thể khôi phục bằng nút Sửa nhanh.` });
          }
        }
      } else if (f.group === 'tavern_helper') {
        issues.push({ severity: 'warning', kind: 'source_script_broken', label: f.label, path: f.path,
          detail: `Script GỐC đã vỡ cú pháp SẴN (dòng ~${origErr.line}: ${origErr.msg.slice(0, 70)}) — lỗi có từ trước khi dịch (card nguồn hỏng/cụt). Cần bản gốc lành để khôi phục.` });
      }
    }

    const trans = f.translated;
    if (!trans) continue;

    // ─── <script> vỡ cú pháp DO DỊCH (gốc lành → bản dịch vỡ) ───
    if (trans.includes('<script') && orig.includes('<script')) {
      const ob = extractScriptBodies(orig);
      const tb = extractScriptBodies(trans);
      if (ob.length === tb.length) {
        for (let i = 0; i < tb.length; i++) {
          if (isJsSyntaxOk(ob[i]) && !isJsSyntaxOk(tb[i])) {
            brokenScripts++;
            issues.push({ severity: 'error', kind: 'broken_script', label: f.label, path: f.path,
              detail: `Script #${i + 1} vỡ cú pháp JS (nút bấm sẽ liệt trong SillyTavern).` });
          }
        }
      }
    }

    // ─── Chữ Hán còn trong field CODE (json_patch/initvar/controller) ───
    if (f.entryType && CODE_ENTRY_TYPES.has(f.entryType)) {
      const chk = checkCodeFieldForCjk(trans, f.entryType);
      if (!chk.valid) {
        residualCjkCode++;
        issues.push({ severity: 'error', kind: 'residual_cjk_code', label: f.label, path: f.path,
          detail: `Còn chữ Hán trong code: "…${chk.residual}…"` });
      }
    } else if (f.status === 'done') {
      // ─── Chữ Hán còn sót trong VĂN BẢN đã done (info: có thể tên riêng cố ý) ───
      const matches = trans.match(CJK_IDEOGRAPH);
      if (matches && matches.length >= RESIDUAL_TEXT_THRESHOLD) {
        residualCjkText++;
        issues.push({ severity: 'info', kind: 'residual_cjk_text', label: f.label, path: f.path,
          detail: `Còn ${matches.length} ký tự Hán chưa dịch (kiểm tra xem có phải tên riêng giữ nguyên không).` });
      }
    }

    // ─── Thuật ngữ trong Từ điển VẪN CÒN NGUYÊN GỐC trong bản dịch (dịch chưa nhất quán) ───
    if (activeGlossary.length && f.status === 'done' && trans) {
      const missed = activeGlossary.filter((g) => trans.includes(g.source.trim()));
      if (missed.length > 0) {
        glossaryUnapplied++;
        const list = missed.slice(0, 6).map((g) => `"${g.source.trim()}"→"${g.target.trim()}"`).join(', ');
        issues.push({ severity: 'warning', kind: 'glossary_unapplied', label: f.label, path: f.path,
          detail: `Thuật ngữ chưa được áp bản dịch: ${list}${missed.length > 6 ? '…' : ''}` });
      }
    }
  }

  // Sắp xếp: error → warning → info (để danh sách hiển thị cái quan trọng trước).
  const rank: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    counts: { total: fields.length, done, error, pending, skipped, brokenScripts, residualCjkCode, residualCjkText, glossaryUnapplied },
    issues,
    ok: !issues.some((i) => i.severity === 'error'),
  };
}

/** Dựng "báo cáo dịch" dạng Markdown (tải về được) — tổng quan + danh sách vấn đề. */
export function buildTranslationReport(
  fields: TranslationField[],
  cardName: string,
  report?: HealthReport,
  glossary?: GlossaryEntry[]
): string {
  const h = report ?? scanFieldsHealth(fields, glossary);
  const c = h.counts;
  const now = new Date().toLocaleString('vi-VN');
  const lines: string[] = [];
  lines.push(`# Báo cáo dịch — ${cardName}`);
  lines.push(`*Tạo lúc: ${now}*`);
  lines.push('');
  lines.push('## Tổng quan');
  lines.push(`- Tổng số trường: **${c.total}**`);
  lines.push(`- Đã dịch: **${c.done}** · Lỗi: **${c.error}** · Chưa xong: **${c.pending}** · Bỏ qua/tự dịch: **${c.skipped}**`);
  lines.push('');
  lines.push('## Sức khoẻ thẻ');
  lines.push(`- Script vỡ cú pháp: **${c.brokenScripts}**`);
  lines.push(`- Chữ Hán còn trong field code: **${c.residualCjkCode}**`);
  lines.push(`- Trường còn chữ Hán (văn bản): **${c.residualCjkText}**`);
  lines.push(`- Thuật ngữ chưa áp bản dịch: **${c.glossaryUnapplied}**`);
  lines.push(`- Trạng thái: ${h.ok ? '✅ **An toàn để xuất**' : '⚠️ **Còn vấn đề nặng — nên sửa trước khi xuất**'}`);

  const bySev = (s: HealthSeverity) => h.issues.filter((i) => i.severity === s);
  const section = (title: string, arr: HealthIssue[]) => {
    if (arr.length === 0) return;
    lines.push('');
    lines.push(`## ${title} (${arr.length})`);
    for (const i of arr) lines.push(`- **${i.label}** \`${i.path}\` — ${i.detail}`);
  };
  section('❌ Lỗi nặng (nên sửa trước khi xuất)', bySev('error'));
  section('⚠️ Cảnh báo', bySev('warning'));
  section('ℹ️ Ghi chú', bySev('info'));

  return lines.join('\n');
}
