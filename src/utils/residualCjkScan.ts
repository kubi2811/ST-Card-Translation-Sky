/**
 * src/utils/residualCjkScan.ts — QUÉT CHỮ TRUNG CÒN SÓT SAU KHI DỊCH XONG.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 2026 — việc 80) Guard sẵn có trong vòng dịch chỉ chặn theo TỶ LỆ SỐNG SÓT
 * (`detectResidualCjk`: >35% chữ Hán còn lại VÀ nguồn phải có ≥20 chữ Hán) — nó sinh ra để bắt
 * ca "AI trả lại nguyên văn" chứ không phải để bắt dịch SÓT. Nên một field dịch được 90%,
 * còn lơ thơ vài chục chữ Hán rải rác, vẫn lọt qua và được đánh dấu 'done'.
 *
 * File này là bộ quét CUỐI: đếm CHÍNH XÁC số chữ Hán còn lại của từng field đã 'done',
 * rồi trả về danh sách field cần dịch lại kèm ĐOẠN CỤ THỂ còn sót để nhắc lại cho AI.
 *
 * KHÔNG ĐẾM (nếu đếm sẽ retry vô tận vì dịch xong vẫn còn):
 *  - LINK / URL / đường dẫn — user yêu cầu rõ: "không áp dụng quét tiếng trung đối với các link".
 *    CJK trong URL là cố ý (vd `import('https://cdn.com/骰子系统/stable.js')`), dịch là gãy link.
 *  - Giá trị CSS được CHỦ Ý giữ khi `cssCjkHandling: 'preserve'` (font-family: '微软雅黑'…) —
 *    dùng chung `maskCssCjkValues` với pipeline dịch nên hai bên không bao giờ lệch nhau.
 *  - Nhóm `lorebook_keys` ở chế độ gộp: key gốc được giữ lại CÓ CHỦ Ý.
 */

import { stripUrlsForCjkCheck, HAN_RE_G } from './cjk';
import { maskCssCjkValues } from './apiClient';

/** Field tối thiểu mà bộ quét cần — khai báo hẹp để test không phải dựng cả TranslationField. */
export interface ScannableField {
  path: string;
  label: string;
  group: string;
  status: string;
  original: string;
  translated?: string;
}

export interface ResidualCjkHit {
  path: string;
  label: string;
  group: string;
  /** Số chữ Hán còn lại SAU khi đã bỏ link + CSS giữ nguyên. */
  count: number;
  /** Vài đoạn cụ thể còn chữ Hán — nhét vào prompt để AI biết chỗ nào chưa dịch. */
  samples: string[];
}

export interface ScanOptions {
  /** Giống cờ `cssCjkHandling` của pipeline. 'preserve' ⇒ bỏ qua CJK trong giá trị CSS. */
  cssCjkHandling?: 'preserve' | 'translate';
  /** Bỏ qua nhóm keys lorebook (chế độ gộp cố ý giữ key gốc). Mặc định bật. */
  skipLorebookKeys?: boolean;
  /** Số chữ Hán tối thiểu mới coi là đáng dịch lại. Mặc định 1 — sót là bắt. */
  minCount?: number;
  /** Số đoạn mẫu lấy cho mỗi field. Mặc định 5. */
  maxSamples?: number;
}

/**
 * Bỏ mọi phần KHÔNG được tính là "chữ Trung chưa dịch": link và (tuỳ cờ) giá trị CSS giữ nguyên.
 * Tách riêng để test được và để bộ quét với pipeline dịch dùng CHUNG một định nghĩa.
 */
export function stripNonTranslatableForScan(
  text: string,
  cssCjkHandling: 'preserve' | 'translate' = 'preserve',
): string {
  if (!text) return '';
  // Bỏ CSS giữ nguyên TRƯỚC: maskCssCjkValues thay CJK bằng placeholder ASCII.
  let out = text;
  try {
    out = maskCssCjkValues(out, cssCjkHandling).maskedText;
  } catch {
    /* mask chỉ để giảm báo oan — hỏng thì cứ đếm nguyên bản */
  }
  // Rồi mới bỏ link/URL/đường dẫn.
  return stripUrlsForCjkCheck(out);
}

/** Đếm chữ Hán còn lại sau khi đã loại link + CSS giữ nguyên. */
export function countResidualHan(
  text: string,
  cssCjkHandling: 'preserve' | 'translate' = 'preserve',
): number {
  const cleaned = stripNonTranslatableForScan(text, cssCjkHandling);
  return (cleaned.match(HAN_RE_G) || []).length;
}

/**
 * Cắt ra vài đoạn CÓ chữ Hán kèm ngữ cảnh hai bên — để nhét vào prompt dịch lại.
 * Gộp các chữ Hán gần nhau (cách ≤ 12 ký tự) vào cùng một đoạn cho gọn.
 */
export function extractCjkSamples(text: string, maxSamples = 5, pad = 24): string[] {
  const cleaned = stripNonTranslatableForScan(text);
  if (!cleaned) return [];

  const positions: number[] = [];
  HAN_RE_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HAN_RE_G.exec(cleaned)) !== null) positions.push(m.index);
  if (positions.length === 0) return [];

  // Gộp vị trí gần nhau thành cụm.
  const clusters: { start: number; end: number }[] = [];
  for (const p of positions) {
    const last = clusters[clusters.length - 1];
    if (last && p - last.end <= 12) last.end = p;
    else clusters.push({ start: p, end: p });
  }

  return clusters.slice(0, maxSamples).map(c => {
    const from = Math.max(0, c.start - pad);
    const to = Math.min(cleaned.length, c.end + pad + 1);
    const snippet = cleaned.slice(from, to).replace(/\s+/g, ' ').trim();
    return `${from > 0 ? '…' : ''}${snippet}${to < cleaned.length ? '…' : ''}`;
  });
}

/** Quét toàn bộ field đã dịch xong, trả về những field vẫn còn chữ Hán. */
export function scanFieldsForResidualCjk(
  fields: ScannableField[],
  opts: ScanOptions = {},
): ResidualCjkHit[] {
  const {
    cssCjkHandling = 'preserve',
    skipLorebookKeys = true,
    minCount = 1,
    maxSamples = 5,
  } = opts;

  const hits: ResidualCjkHit[] = [];
  for (const f of fields || []) {
    /* (bug 234) QUÉT CẢ FIELD 'skipped', KHÔNG CHỈ 'done'.
     * User: "lỗi tự động bỏ qua khi trường ngắn và có xen kẽ … không dịch mà xem nó như đã dịch."
     * Khi bộ dò ngôn ngữ đoán nhầm, prepareFields đặt status='skipped' VÀ gán translated = original
     * — tức cột BẢN DỊCH chứa nguyên văn tiếng Trung. Bản cũ bỏ ngay mọi field khác 'done' ở dòng
     * đầu, nên chính những field tệ nhất lại tàng hình với lưới cuối cùng; tệ hơn, sweep đếm được
     * 0 hit rồi in log MÀU XANH "sạch, không mục nào còn tiếng Trung".
     * 'ignored' thì KHÔNG quét: đó là user chủ động không dịch, còn tiếng Trung là đúng ý họ. */
    if (f.status !== 'done' && f.status !== 'skipped') continue;
    if (typeof f.translated !== 'string' || !f.translated) continue;
    if (skipLorebookKeys && f.group === 'lorebook_keys') continue;
    // Nguồn vốn không có chữ Hán thì bản dịch có chữ Hán cũng không phải "dịch sót".
    if (countResidualHan(f.original || '', cssCjkHandling) === 0) continue;

    const count = countResidualHan(f.translated, cssCjkHandling);
    if (count < minCount) continue;

    hits.push({
      path: f.path,
      label: f.label,
      group: f.group,
      count,
      samples: extractCjkSamples(f.translated, maxSamples),
    });
  }
  // Nhiều chữ sót nhất lên trước — để log cắt bớt vẫn thấy chỗ nặng nhất.
  return hits.sort((a, b) => b.count - a.count);
}

/**
 * Câu nhắc thêm vào prompt khi dịch lại — chỉ đích danh đoạn còn sót.
 * Dịch lại trơn (cùng prompt cũ) rất dễ ra đúng kết quả cũ; phải chỉ mặt chỗ hỏng.
 */
export function buildResidualRetryInstruction(hit: ResidualCjkHit): string {
  const list = hit.samples.map((s, idx) => `  ${idx + 1}. ${s}`).join('\n');
  return [
    '',
    '=== BẢN DỊCH TRƯỚC CỦA MỤC NÀY VẪN CÒN CHỮ TRUNG — DỊCH LẠI CHO HẾT ===',
    `Lượt trước còn sót ${hit.count} chữ Hán chưa dịch, cụ thể ở những chỗ sau:`,
    list,
    'YÊU CẦU: dịch HẾT, không được bỏ sót đoạn nào. Rà lại toàn bộ nội dung một lượt nữa',
    'trước khi trả lời, đảm bảo KHÔNG còn chữ Hán nào ngoài các trường hợp bắt buộc giữ:',
    'đường dẫn/URL, tên file, và giá trị CSS (font-family, content).',
  ].join('\n');
}
