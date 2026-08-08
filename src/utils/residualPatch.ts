/**
 * src/utils/residualPatch.ts — (bug 226) VÁ ĐÚNG CHỖ CÒN CHỮ HÁN, KHÔNG DỊCH LẠI CẢ ENTRY.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "các vùng lỗi phân bố đồng đều ở 21 chunk, vì vậy AI bắt buộc phải call dịch lại 21
 * chunk. Nhưng nên có một quy trình quét và dò nhanh khi rà những lỗi dưới 1k chữ Hán, gộp
 * chung lại thành 1 khối, dịch cả khối đó rồi phân phối về lại địa chỉ ban đầu — nhớ địa chỉ
 * gốc của từng lỗi sẽ nhanh và tiết kiệm api hơn nhiều lần."
 *
 * Đúng, và đây là chỗ bộ dò cũ hụt. `findResidualCjkChunks` (bug 219) đã tiến bộ hơn bản 207 —
 * nó bắt được cell chỉ còn vài chữ Hán thay vì đòi >35%. Nhưng ĐƠN VỊ nó làm việc vẫn là CẢ
 * CELL: cell nào còn dù một chữ Hán thì cell đó phải dịch lại nguyên. Khi 150 chữ Hán sót rải
 * đều trên 21 cell, cả 21 cell đều "có Hán" ⇒ 21 lượt gọi API, mỗi lượt gửi đi hơn chục nghìn
 * ký tự, để sửa trung bình bảy chữ. Gần bằng dịch lại từ đầu, đúng như user tả.
 *
 * Module này đổi đơn vị làm việc từ CELL sang VÙNG:
 *   1. quét bản dịch, khoanh từng cụm chữ Hán còn sót kèm ĐỊA CHỈ chính xác (cell nào, từ ký
 *      tự nào đến ký tự nào);
 *   2. gom mọi vùng của mọi mục vào MỘT khối đánh số, gửi đi trong MỘT lượt;
 *   3. trả kết quả về đúng địa chỉ cũ — thay từ CUỐI lên ĐẦU để offset phía trước không xê dịch.
 * 150 chữ Hán rải trên 21 cell: 1 lượt gọi thay vì 21.
 *
 * Ba điều kiện an toàn, vì vá tại chỗ nguy hiểm hơn dịch lại cả khối:
 *   • Offset phải TUYỆT ĐỐI đúng ⇒ bộ lọc link/CSS ở đây che bằng khoảng trắng CÙNG ĐỘ DÀI,
 *     không cắt bỏ như `stripUrlsForCjkCheck` (cắt là mọi offset phía sau lệch, vá vào giữa
 *     câu người khác).
 *   • Mảnh trả về phải qua cửa kiểm mới được dán: còn Hán, phình/teo bất thường, hay rỗng thì
 *     GIỮ NGUYÊN mảnh cũ. Vá hụt một vùng chỉ là vùng đó chưa sạch; dán bừa là hỏng bản dịch
 *     đang tốt.
 *   • Chỉ dùng cho lỗi NHỎ (mặc định ≤1000 chữ Hán). Sót nhiều nghĩa là cả cell dịch hỏng chứ
 *     không phải sót lẻ — lúc ấy dịch lại cell là đúng việc, và đường cũ vẫn còn nguyên.
 */
import { HAN_RE_G } from './cjk';

/** Địa chỉ một vùng cần vá. `chunk = -1` ⇒ vá thẳng trên bản dịch (mục không chia chunk). */
export interface PatchAddress {
  chunk: number;
  start: number;
  end: number;      // exclusive
}

export interface ResidualSpan extends PatchAddress {
  /** Đoạn hiện tại — chính là thứ sẽ bị thay. */
  text: string;
  /** Ngữ cảnh hai bên, CHỈ để AI hiểu, không bị thay. */
  before: string;
  after: string;
  han: number;
}

export interface FieldResidualPlan {
  path: string;
  label: string;
  spans: ResidualSpan[];
  totalHan: number;
}

export interface ScanSpanOptions {
  /** Hai cụm Hán cách nhau ≤ ngần này ký tự thì gộp làm một vùng. */
  mergeGap?: number;
  /** Trần độ dài một vùng — dài quá thì đó là cả đoạn chưa dịch, không phải lỗi lẻ. */
  maxSpanLen?: number;
  /** Số ký tự ngữ cảnh lấy mỗi bên. */
  contextPad?: number;
}

const DEFAULTS = { mergeGap: 12, maxSpanLen: 400, contextPad: 120 };

/**
 * Che link/đường dẫn bằng khoảng trắng CÙNG ĐỘ DÀI — giữ nguyên mọi offset.
 *
 * Dùng đúng bộ mẫu của `stripUrlsForCjkCheck` (nguồn chung, sửa một chỗ là cả tool hưởng), chỉ
 * khác cách thay: bản kia cắt bỏ nên chuỗi ngắn lại, ở đây cắt là hỏng địa chỉ.
 */
export function maskUrlsKeepingOffsets(text: string): string {
  const blank = (m: string) => ' '.repeat(m.length);
  let s = String(text || '');
  s = s.replace(/(?:https?|ftp):\/\/[^\s'"<>(){}\\]+|\/\/[a-zA-Z0-9][^\s'"<>(){}\\]*/gi, blank);
  s = s.replace(/(?:src|href|action|data-src|data-href|poster|srcset)\s*=\s*(?:"[^"]*"|'[^']*')/gi, blank);
  s = s.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)/gi, blank);
  s = s.replace(/(?:import|require)\s*\(\s*(?:[`'"][^`'"]*[`'"]|`[^`]*`)\s*\)/gi, blank);
  s = s.replace(/data:[a-zA-Z0-9+/.-]+;[^\s'"<>)]+/gi, blank);
  s = s.replace(/(?:\.\.?\/)[^\s'"<>(){}\\]+/g, blank);
  // Link markdown: chỉ che phần URL trong ngoặc tròn, giữ nguyên nhãn để còn dịch được.
  s = s.replace(/(!?\[[^\]]*\])\(([^)]+)\)/g, (_m, label: string, url: string) => `${label}(${' '.repeat(url.length)})`);
  return s;
}

/** Giá trị CSS được CHỦ Ý giữ tiếng Trung (font-family…) — che luôn, cùng độ dài. */
export function maskCssKeepingOffsets(text: string): string {
  return String(text || '').replace(
    /(font-family|content)\s*:\s*([^;}\n]*)/gi,
    (_m, prop: string, val: string) => `${prop}:${' '.repeat(val.length + 1)}`,
  );
}

/**
 * Khoanh các vùng còn chữ Hán trong MỘT đoạn văn bản.
 *
 * Vùng được cắt ĐÚNG từ chữ Hán đầu tới chữ Hán cuối của cụm — không nong ra hai bên. Ngữ cảnh
 * đưa riêng cho AI đọc. Nong vùng thay thế ra là mời AI viết lại cả câu đang đúng, mà mỗi câu
 * viết lại là một cơ hội làm hỏng thứ đang chạy được.
 */
export function findResidualSpans(
  text: string,
  chunkIndex = -1,
  opts: ScanSpanOptions = {},
): ResidualSpan[] {
  const { mergeGap, maxSpanLen, contextPad } = { ...DEFAULTS, ...opts };
  const src = String(text || '');
  if (!src) return [];

  const masked = maskCssKeepingOffsets(maskUrlsKeepingOffsets(src));
  if (masked.length !== src.length) return [];   // che sai độ dài ⇒ địa chỉ không tin được nữa

  const positions: number[] = [];
  HAN_RE_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HAN_RE_G.exec(masked)) !== null) positions.push(m.index);
  if (!positions.length) return [];

  const clusters: Array<{ start: number; end: number }> = [];
  for (const p of positions) {
    const last = clusters[clusters.length - 1];
    if (last && p - last.end <= mergeGap && p + 1 - last.start <= maxSpanLen) last.end = p + 1;
    else clusters.push({ start: p, end: p + 1 });
  }

  return clusters.map((c) => ({
    chunk: chunkIndex,
    start: c.start,
    end: c.end,
    text: src.slice(c.start, c.end),
    before: src.slice(Math.max(0, c.start - contextPad), c.start),
    after: src.slice(c.end, Math.min(src.length, c.end + contextPad)),
    han: (masked.slice(c.start, c.end).match(HAN_RE_G) || []).length,
  })).filter((s) => s.han > 0);
}

/** Mục cần vá — khai hẹp để test khỏi phải dựng cả TranslationField. */
export interface PatchableField {
  path: string;
  label: string;
  translated?: string;
  completedChunks?: string[];
  rawChunks?: string[];
}

/**
 * Khoanh vùng cho MỘT mục. Có chunk thì quét theo từng cell (địa chỉ gắn số cell), để vá xong
 * cả `completedChunks` lẫn bản ghép đều đúng — vá mỗi bản ghép thì lần "Ghép lại" sau là mất.
 */
export function planFieldResidualPatch(
  field: PatchableField,
  opts: ScanSpanOptions = {},
): FieldResidualPlan | null {
  const cells = field.completedChunks;
  const spans: ResidualSpan[] = [];

  if (cells?.length && cells.every((c) => typeof c === 'string')) {
    for (let i = 0; i < cells.length; i++) spans.push(...findResidualSpans(cells[i], i, opts));
  } else if (field.translated) {
    spans.push(...findResidualSpans(field.translated, -1, opts));
  }

  if (!spans.length) return null;
  return {
    path: field.path,
    label: field.label,
    spans,
    totalHan: spans.reduce((s, x) => s + x.han, 0),
  };
}

/* ─────────────────────────── Gói lượt gọi AI ─────────────────────────── */

export interface PatchJobItem {
  /** Số hiệu trong lượt gọi — AI trả về theo đúng số này. */
  id: number;
  path: string;
  label: string;
  span: ResidualSpan;
}

/** Trải kế hoạch của nhiều mục thành một danh sách đánh số liên tục. */
export function buildPatchJob(plans: FieldResidualPlan[]): PatchJobItem[] {
  const out: PatchJobItem[] = [];
  let id = 1;
  for (const p of plans) for (const span of p.spans) out.push({ id: id++, path: p.path, label: p.label, span });
  return out;
}

/**
 * Prompt cho lượt vá gộp.
 *
 * Dùng thẻ XML chứ không phải JSON: mảnh cần dịch thường CHÍNH LÀ code, dấu nháy và dấu chéo
 * ngược trong đó làm JSON vỡ liên tục (bài học từ bug 96). Thẻ có số hiệu thì cắt bằng regex
 * là xong, và AI trả thiếu một mảnh cũng không kéo sập cả lượt.
 */
export function buildResidualPatchPrompt(items: PatchJobItem[], targetLanguage: string): string {
  const blocks = items.map((it) => [
    `<m id="${it.id}">`,
    `<ctx>${it.span.before}⟦${it.span.text}⟧${it.span.after}</ctx>`,
    `<txt>${it.span.text}</txt>`,
    '</m>',
  ].join('\n')).join('\n');

  return [
    `Bản dịch của một thẻ nhân vật còn sót vài mẩu chưa dịch. Dưới đây là ${items.length} mẩu,`,
    `mỗi mẩu kèm ngữ cảnh xung quanh để bạn hiểu đúng nghĩa.`,
    '',
    'LUẬT:',
    `1. Chỉ dịch phần trong <txt> sang ${targetLanguage}. Phần <ctx> CHỈ để đọc hiểu, đừng dịch nó.`,
    '   Trong <ctx>, chính mẩu cần dịch được đánh dấu bằng cặp ⟦ ⟧.',
    '2. Trả về ĐÚNG số lượng mẩu, đúng số hiệu, theo mẫu: <m id="1">bản dịch</m>',
    '3. GIỮ NGUYÊN mọi thứ không phải văn xuôi: tên biến, khoá JSON, thẻ HTML, cú pháp EJS,',
    '   dấu ngoặc, dấu nháy, xuống dòng, khoảng trắng ở hai đầu mẩu. Mẩu được dán TRỞ LẠI đúng',
    '   vị trí cũ trong file, nên thừa hay thiếu một dấu nháy là vỡ cả script.',
    '4. Mẩu nào vốn KHÔNG nên dịch (tên riêng cố ý giữ, mã, đường dẫn) thì trả lại y nguyên.',
    '5. Không giải thích, không thêm chữ nào ngoài các thẻ <m>.',
    '',
    blocks,
  ].join('\n');
}

/** Bóc các mảnh đã dịch từ câu trả lời. Trả map id → text; thiếu mảnh nào thì không có khoá đó. */
export function parseResidualPatchReply(reply: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /<m\s+id\s*=\s*["']?(\d+)["']?\s*>([\s\S]*?)<\/m>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(reply || ''))) !== null) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && !out.has(id)) out.set(id, m[2]);
  }
  return out;
}

export interface AcceptOptions {
  /** Bản dịch dài gấp quá ngần này lần bản gốc ⇒ AI đang kể lể, không phải dịch. */
  maxGrow?: number;
  /** Ngắn hơn ngần này lần ⇒ bị cắt cụt. */
  minShrink?: number;
}

/**
 * Cửa kiểm trước khi dán. Trả lý do từ chối (chuỗi) hoặc null nếu nhận.
 *
 * Nguyên tắc: vá hụt thì vùng đó vẫn còn Hán và lượt sau xử tiếp; dán bừa thì bản dịch đang
 * tốt bị hỏng và không có đường lùi. Nên mọi ca nghi ngờ đều từ chối.
 */
export function rejectReason(
  original: string,
  candidate: string,
  opts: AcceptOptions = {},
): string | null {
  const { maxGrow = 6, minShrink = 0.2 } = opts;
  if (candidate == null) return 'AI không trả mẩu này';
  if (!candidate.trim() && original.trim()) return 'trả về rỗng';
  const stillHan = (maskUrlsKeepingOffsets(candidate).match(HAN_RE_G) || []).length;
  const srcHan = (maskUrlsKeepingOffsets(original).match(HAN_RE_G) || []).length;
  if (srcHan > 0 && stillHan >= srcHan) return 'vẫn còn nguyên chữ Hán';
  if (candidate.length > original.length * maxGrow + 40) return 'dài bất thường';
  if (original.length > 20 && candidate.length < original.length * minShrink) return 'ngắn bất thường';
  return null;
}

export interface ApplyResult {
  translated?: string;
  completedChunks?: string[];
  applied: number;
  rejected: Array<{ id: number; why: string }>;
}

/**
 * Dán các mảnh đã duyệt về đúng địa chỉ.
 *
 * Thay từ CUỐI lên ĐẦU trong mỗi cell: thay từ đầu xuống thì mảnh sau dài/ngắn hơn mảnh trước
 * là mọi offset phía sau lệch hết, và vá vào giữa câu người khác — lỗi lặng lẽ nhất có thể.
 */
export function applyResidualPatches(
  field: PatchableField,
  items: PatchJobItem[],
  replies: Map<number, string>,
  joinChunks: (cells: string[], original?: string) => string,
  opts: AcceptOptions = {},
): ApplyResult {
  const mine = items.filter((it) => it.path === field.path);
  const rejected: Array<{ id: number; why: string }> = [];
  let applied = 0;

  const accepted = mine.filter((it) => {
    const cand = replies.get(it.id);
    const why = cand === undefined ? 'AI không trả mẩu này' : rejectReason(it.span.text, cand, opts);
    if (why) { rejected.push({ id: it.id, why }); return false; }
    return true;
  });

  const patchOne = (text: string, spans: PatchJobItem[]): string => {
    let out = text;
    // Cuối → đầu.
    for (const it of [...spans].sort((a, b) => b.span.start - a.span.start)) {
      // Chốt cuối: đoạn ở địa chỉ đó phải còn ĐÚNG như lúc quét. Lệch nghĩa là văn bản đã đổi
      // giữa chừng (user sửa tay, lượt khác ghi đè) — bỏ qua chứ không dán đè.
      if (out.slice(it.span.start, it.span.end) !== it.span.text) {
        rejected.push({ id: it.id, why: 'văn bản đã thay đổi kể từ lúc quét' });
        continue;
      }
      out = out.slice(0, it.span.start) + (replies.get(it.id) ?? it.span.text) + out.slice(it.span.end);
      applied++;
    }
    return out;
  };

  const cells = field.completedChunks;
  if (cells?.length && accepted.some((it) => it.span.chunk >= 0)) {
    const next = [...cells];
    const byChunk = new Map<number, PatchJobItem[]>();
    for (const it of accepted) {
      if (it.span.chunk < 0 || it.span.chunk >= next.length) continue;
      const list = byChunk.get(it.span.chunk) ?? [];
      list.push(it);
      byChunk.set(it.span.chunk, list);
    }
    for (const [idx, list] of byChunk) next[idx] = patchOne(next[idx] ?? '', list);
    return { completedChunks: next, translated: joinChunks(next), applied, rejected };
  }

  return {
    translated: patchOne(field.translated ?? '', accepted.filter((it) => it.span.chunk < 0)),
    applied,
    rejected,
  };
}

export interface EligibilityOptions {
  /** Trần tổng chữ Hán còn sót. Trên mức này là hỏng cả mảng, dịch lại cell đúng hơn. */
  maxHan?: number;
  /** Trần số vùng trong một lượt gọi. */
  maxSpans?: number;
}

/**
 * Ca này có đáng đi đường vá gộp không? Trả lý do từ chối, hoặc null nếu đi được.
 * Từ chối thì caller giữ nguyên đường cũ (dịch lại từng cell) — không bao giờ tệ hơn hiện trạng.
 */
export function patchEligibility(
  plans: FieldResidualPlan[],
  opts: EligibilityOptions = {},
): string | null {
  const { maxHan = 1000, maxSpans = 80 } = opts;
  if (!plans.length) return 'không còn chữ Hán nào';
  const totalHan = plans.reduce((s, p) => s + p.totalHan, 0);
  const totalSpans = plans.reduce((s, p) => s + p.spans.length, 0);
  if (totalHan > maxHan) return `còn ${totalHan} chữ Hán (quá ${maxHan}) — dịch lại từng phần đúng hơn`;
  if (totalSpans > maxSpans) return `có ${totalSpans} vùng rời (quá ${maxSpans}) — dịch lại từng phần đúng hơn`;
  return null;
}
