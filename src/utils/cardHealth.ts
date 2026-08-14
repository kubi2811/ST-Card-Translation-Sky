// ═══════════════════════════════════════════════════════════════════════════════
// SỨC KHOẺ THẺ — quét nhanh bản dịch TRƯỚC KHI XUẤT để bắt lỗi "chết người" mà bảng
// trạng thái trường (done/error) KHÔNG thấy: <script> vỡ cú pháp (nút bấm liệt trong
// SillyTavern), chữ Hán còn sót trong field code, trường lỗi/chưa dịch.
//
// Thuần tuý (không gọi API, không đụng store) → dễ test + dùng lại cho báo cáo dịch.
// Tái dùng `checkCodeFieldForCjk` (mvuValidator) cho CJK-trong-code, acorn cho parse JS.
// ═══════════════════════════════════════════════════════════════════════════════
import { checkCodeFieldForCjk } from './mvuValidator';
import { restoreMacros } from './macroGuard';
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
  | 'empty_bracket'      // (bugNeedFix/178) 【nhãn】 ở gốc thành 【】 RỖNG ở bản dịch — mất chữ
  | 'macro_renamed'      // (bugNeedFix/180) {{user}} bị đổi ruột thành thứ khác — thẻ hiện sai khi chơi
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
    /** (bugNeedFix/178) Số chỗ 【…】 bị rỗng ruột sau dịch. */
    emptyBrackets: number;
    /** (bugNeedFix/180) Số macro {{…}} bị đổi ruột sau dịch. */
    renamedMacros: number;
    glossaryUnapplied: number;
  };
  issues: HealthIssue[];
  /** true = không còn vấn đề mức 'error' → an toàn để xuất. */
  ok: boolean;
}

/** Bao nhiêu ký tự CJK còn sót trong 1 field 'done' thì mới coi là đáng chú ý (giảm nhiễu
 *  tên riêng để nguyên có chủ đích). */
// (bug 234) Hạ từ 3 xuống 1. Ngưỡng 3 nghĩa là "sót 1-2 chữ Hán thì không báo" — mà "<道具>" và
// "骇爪" đều đúng 2 chữ, tức đúng ca user báo. Bộ quét chuẩn của app (residualCjkScan) dùng 1.
const RESIDUAL_TEXT_THRESHOLD = 1;

const CODE_ENTRY_TYPES = new Set(['json_patch', 'initvar', 'controller']);

/** Quét toàn bộ trường → báo cáo sức khoẻ (đếm + danh sách vấn đề đã sắp theo mức độ).
 *  `glossary` (tuỳ chọn) = Từ điển thuật ngữ đang dùng → kiểm bản dịch có ÁP đúng chưa
 *  (tên riêng/thuật ngữ còn nguyên gốc = dịch thiếu nhất quán). Tái dùng chính glossary mà
 *  engine đã bơm vào mỗi call — không dựng từ điển mới. */
/**
 * (bugNeedFix/178) Đếm những cặp ngoặc BỊ RỖNG RUỘT sau khi dịch.
 * ─────────────────────────────────────────────────────────────────────────────
 * Chỉ báo khi CHẮC CHẮN là mất chữ: bản dịch có cặp ngoặc rỗng (hoặc chỉ còn khoảng trắng) mà
 * bản GỐC lại KHÔNG hề có cặp rỗng nào cùng loại. Gốc vốn đã có 【】 rỗng (một số thẻ dùng làm ô
 * điền) thì im lặng — không phải lỗi do dịch, báo là báo oan.
 */
export function countEmptiedBrackets(original: string, translated: string): string[] {
  if (!original || !translated) return [];
  const PAIRS: Array<[string, string]> = [
    ['【', '】'], ['（', '）'], ['《', '》'], ['「', '」'], ['『', '』'], ['〔', '〕'], ['〖', '〗'],
  ];
  const out: string[] = [];
  for (const [open, close] of PAIRS) {
    const emptyRe = new RegExp(`${open}\\s*${close}`, 'g');
    const inOrig = (original.match(emptyRe) ?? []).length;
    const inTrans = (translated.match(emptyRe) ?? []).length;
    if (inTrans <= inOrig) continue;   // không nhiều hơn gốc ⇒ không phải do dịch

    // Cặp có RUỘT ở bản gốc — lấy vài cái đầu làm bằng chứng cho user đối chiếu.
    const filledRe = new RegExp(`${open}\\s*([^${open}${close}\\r\\n]{1,40}?)\\s*${close}`, 'g');
    const labels = [...original.matchAll(filledRe)].map(m => `${open}${m[1]}${close}`);
    const n = inTrans - inOrig;
    for (let i = 0; i < n; i++) out.push(labels[i] ?? `${open}…${close}`);
  }
  return out;
}

export function scanFieldsHealth(fields: TranslationField[], glossary?: GlossaryEntry[]): HealthReport {
  const issues: HealthIssue[] = [];
  let brokenScripts = 0, residualCjkCode = 0, residualCjkText = 0, glossaryUnapplied = 0;
  let emptyBrackets = 0;
  let renamedMacros = 0;
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
    } else if (f.status === 'done' || f.status === 'skipped') {
      /* ═══ (bug 234) HAI SỬA Ở ĐÂY ═══
       * 1. Quét CẢ 'skipped', không riêng 'done'. Field bị auto-bỏ-qua có `translated` chính là
       *    bản gốc tiếng Trung — nó là ca nặng nhất mà lại là ca duy nhất không được soi.
       * 2. Nâng từ 'info' lên 'warning'. Banner sức khoẻ thẻ chỉ đếm severity==='error'
       *    (ExportPanel: `errCount === 0` ⇒ "An toàn để xuất"), nên 80 entry còn tiếng Trung vẫn
       *    cho ra một banner XANH. 'warning' để chốt xuất thẻ ở ExportPanel nhìn thấy được.
       *    Vẫn KHÔNG dùng 'error': chữ Hán trong văn xuôi có thể là tên riêng người dùng cố ý
       *    giữ, không đáng chặn cứng — chỉ đáng nói to. */
      const matches = trans.match(CJK_IDEOGRAPH);
      if (matches && matches.length >= RESIDUAL_TEXT_THRESHOLD) {
        residualCjkText++;
        issues.push({ severity: 'warning', kind: 'residual_cjk_text', label: f.label, path: f.path,
          detail: `Còn ${matches.length} ký tự Hán chưa dịch`
            + (f.status === 'skipped' ? ' — mục này bị TỰ ĐỘNG BỎ QUA, chưa hề gửi cho AI lần nào.' : ' (kiểm tra xem có phải tên riêng giữ nguyên không).') });
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

    // ═══ (bugNeedFix/178) NGOẶC RỖNG RUỘT SAU DỊCH ═══
    // Gốc có 【消费监测】 mà bản dịch ra 【】 là MẤT CHỮ, nhưng không lỗi cú pháp nào báo, không
    // chữ Hán nào sót — mọi bộ kiểm hiện có đều thấy sạch. User chỉ phát hiện khi đọc bằng mắt,
    // và lần đó là "rất nhiều chỗ" trong một entry.
    // Nguyên nhân gốc đã chặn ở surgical.ts (token không còn mang ngoặc lẻ), nhưng model vẫn có
    // thể tự làm rơi chữ vì lý do khác, nên phải có người canh.
    // ═══ (bugNeedFix/180) MACRO BỊ ĐỔI RUỘT ═══
    // {{user}} thành {{基础信息}} thì SillyTavern không còn thay bằng tên người chơi nữa — nó in
    // nguyên cục chữ lạ ra màn hình. Không lỗi cú pháp, không chữ Hán "sót" theo nghĩa thông
    // thường, nên mọi bộ kiểm cũ đều thấy sạch; user chỉ biết khi đọc từng dòng bằng mắt.
    if (f.translated && f.translated !== f.original) {
      const mg = restoreMacros(f.original || '', f.translated);
      if (mg.fixes.length > 0) {
        renamedMacros += mg.fixes.length;
        issues.push({
          severity: 'error', kind: 'macro_renamed', label: f.label, path: f.path,
          detail: `${mg.fixes.length} macro bị đổi tên: `
            + mg.fixes.slice(0, 4).map(x => `{{${x.wrong}}} (đúng ra là {{${x.right}}})`).join(', ')
            + `${mg.fixes.length > 4 ? '…' : ''} — SillyTavern sẽ in nguyên chữ này ra thay vì thay giá trị.`,
        });
      }
    }

    const emptied = countEmptiedBrackets(f.original || '', f.translated || '');
    if (emptied.length > 0) {
      emptyBrackets += emptied.length;
      issues.push({
        severity: 'error', kind: 'empty_bracket', label: f.label, path: f.path,
        detail: `${emptied.length} chỗ ngoặc bị rỗng ruột sau dịch (bản gốc có chữ bên trong): `
          + `${emptied.slice(0, 4).join(', ')}${emptied.length > 4 ? '…' : ''} — nội dung trong ngoặc đã mất, cần dịch lại hoặc bấm Sửa bằng AI.`,
      });
    }
  }

  // Sắp xếp: error → warning → info (để danh sách hiển thị cái quan trọng trước).
  const rank: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    counts: { total: fields.length, done, error, pending, skipped, brokenScripts, residualCjkCode, residualCjkText, emptyBrackets, renamedMacros, glossaryUnapplied },
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
