/**
 * src/utils/chunkDoctor.ts — (bug 193) CHẨN ĐOÁN & SỬA THEO TỪNG CHUNK.
 * ─────────────────────────────────────────────────────────────────────────────
 * Yêu cầu user: "sau khi đã dịch chunk 1 lần thì phải xác định chunk nào đã dịch 100%, chunk
 * nào còn chữ hán, bị lỗi, mất ký tự so với chunk gốc… khi dịch lại phải tra xét giữa bản raw
 * và bản dịch lỗi ở đâu, ƯU TIÊN SỬA LỖI chứ không phải dịch lại 100% một cách máy móc."
 *
 * Trước bản này, guard per-chunk trong translateText chỉ soi 2 thứ (EJS marker + code vỡ) và
 * retry là gửi lại Y NGUYÊN prompt cũ — model sai lần một thì thường sai y hệt lần hai, còn
 * chunk sót chữ Hán / cắt cụt ở văn xuôi thì lọt hẳn, phải đợi vòng quét TOÀN ENTRY sau khi
 * ghép (một call khổng lồ, dễ cụt). Module này gom mọi phép đo về MỘT bảng chẩn đoán:
 *
 *   diagnoseChunk()            — soi 1 chunk trên 6 mặt: rỗng, CJK sót (miễn trừ URL), cắt
 *                                cụt/phình (ngưỡng theo mật độ Hán của gốc — bug 144), EJS
 *                                marker, cấu trúc code, và VI PHẠM TỪ ĐIỂN MVU (biến Hán chưa
 *                                thay + sai hoa/thường).
 *   buildChunkRepairInstruction() — lượt SỬA có chẩn đoán: gửi raw + bản dịch lỗi + danh sách
 *                                lỗi đích danh + ngữ cảnh lân cận trong RAW LỚN (đuôi chunk
 *                                trước / đầu chunk sau / mở đầu entry) để model hiểu phần này
 *                                phụ trách mảng nào, rồi CHỈ sửa chỗ sai.
 *   filterDictForChunk()       — chỉ bơm những biến THẬT SỰ xuất hiện trong chunk (dict vài
 *                                trăm dòng nhân N chunk là đốt token vô ích + loãng lệnh).
 *   applyDictCasing()          — máy ép hoa/thường theo từ điển NGAY TỪNG CHUNK (đồng biến
 *                                100% không chờ vòng cuối toàn entry).
 *
 * KHÔNG import từ apiClient/mvuSync/residualCjkScan — giữ module thuần để test được và để
 * apiClient import vào mà không tạo vòng (mvuSync + residualCjkScan đều đã import apiClient).
 */
import { stripUrlsForCjkCheck, HAN_RE_G } from './cjk';
import { expectedRatioRange } from './chunkAudit';

export type ChunkProblemKind =
  | 'missing'    // rỗng — phần này sẽ biến mất khi ghép
  | 'cjk'        // còn chữ Hán đáng kể so với gốc
  | 'truncated'  // ngắn bất thường ⇒ mất ký tự / cắt cụt
  | 'inflated'   // dài bất thường ⇒ nghi lặp / bịa thêm
  | 'ejs'        // rơi/đúp khối <%…%> hoặc token mask EJS
  | 'code'       // code vỡ: cụt / lệch ngoặc / backtick lẻ
  | 'mvu-han'    // biến trong từ điển MVU vẫn còn nguyên chữ Hán
  | 'mvu-case';  // biến đã dịch nhưng SAI HOA/THƯỜNG so với từ điển

export interface ChunkProblem {
  kind: ChunkProblemKind;
  detail: string;
  samples?: string[];
}

/** Lỗi CẤU TRÚC — loại mà giữ bản dịch hỏng còn nguy hiểm hơn giữ nguyên bản gốc (vỡ JS). */
export function hasStructuralProblem(problems: ChunkProblem[]): boolean {
  return problems.some(p => p.kind === 'ejs' || p.kind === 'code');
}

// ─────────────────────── phép đo cấu trúc (thuần, dùng chung) ───────────────────────

const EJS_TOKEN_RE = /\{\{__ejs_\d+__\}\}/g;

export function hasEjsBlocks(s: string): boolean {
  return /<%/.test(s) || EJS_TOKEN_RE.test(s);
}

/** Khối <%…%> và token mask {{__ejs_N__}} phải giữ ĐỦ và ĐÚNG bộ sau khi dịch. */
export function ejsBlocksIntact(orig: string, trans: string): boolean {
  const openO = (orig.match(/<%/g) ?? []).length;
  const closeO = (orig.match(/%>/g) ?? []).length;
  const openT = (trans.match(/<%/g) ?? []).length;
  const closeT = (trans.match(/%>/g) ?? []).length;
  if (openO !== openT || closeO !== closeT) return false;
  const toksO = (orig.match(EJS_TOKEN_RE) ?? []).sort();
  const toksT = (trans.match(EJS_TOKEN_RE) ?? []).sort();
  if (toksO.length !== toksT.length) return false;
  return toksO.every((t, i) => t === toksT[i]);
}

/** Chunk "nặng code": đủ nhiều dòng mang ký tự cú pháp — cùng ngưỡng với isCodeChunk cũ. */
export function looksLikeCodeChunk(s: string): boolean {
  let codeLines = 0;
  for (const line of s.split('\n')) {
    if (/[;{}()=]/.test(line)) codeLines++;
    if (codeLines >= 5) return true;
  }
  return false;
}

const balanceDelta = (s: string, open: string, close: string): number =>
  (s.split(open).length - 1) - (s.split(close).length - 1);

/** Code vỡ sau dịch — 3 lớp như guard cũ trong apiClient: cụt / lệch cân bằng ngoặc / backtick lẻ. */
export function codeStructureBroken(orig: string, trans: string): string | null {
  if (trans.length < orig.length * 0.55) {
    return `cụt: ${trans.length}/${orig.length} ký tự`;
  }
  for (const [open, close, label] of [['{', '}', '{}'], ['(', ')', '()'], ['[', ']', '[]']] as const) {
    if (balanceDelta(orig, open, close) !== balanceDelta(trans, open, close)) {
      return `lệch cân bằng ${label}`;
    }
  }
  const btOrig = (orig.match(/`/g) ?? []).length;
  const btTrans = (trans.match(/`/g) ?? []).length;
  if (btOrig % 2 === 0 && btTrans % 2 === 1) return 'backtick lẻ (vỡ template literal)';
  return null;
}

// ─────────────────────────── phép đo CJK ───────────────────────────

/** Đếm chữ Hán NGOÀI URL/link — CJK trong link là cố ý, dịch là gãy link (bug residualCjkScan). */
export function countHanNoUrl(text: string): number {
  return (stripUrlsForCjkCheck(text).match(HAN_RE_G) ?? []).length;
}

/** Nhặt vài mẫu đoạn còn chữ Hán (kèm ngữ cảnh 2 bên) — để nói cho model biết SÓT Ở ĐÂU. */
export function extractHanSamples(text: string, maxSamples = 5, pad = 24): string[] {
  const stripped = stripUrlsForCjkCheck(text);
  const out: string[] = [];
  const re = new RegExp(HAN_RE_G.source, 'g');
  // Bản KHÔNG cờ /g để test từng ký tự — regex /g giữ lastIndex qua các lần .test() nên dùng
  // thẳng HAN_RE_G ở đây sẽ trả kết quả so le (bẫy kinh điển).
  const singleHan = new RegExp(HAN_RE_G.source);
  let m: RegExpExecArray | null;
  let lastEnd = -1;
  while ((m = re.exec(stripped)) !== null && out.length < maxSamples) {
    if (m.index < lastEnd) continue;   // gộp các chữ Hán dính chùm vào một mẫu
    const from = Math.max(0, m.index - pad);
    // nuốt trọn cụm Hán liên tiếp
    let end = m.index;
    while (end < stripped.length && singleHan.test(stripped[end])) end++;
    const to = Math.min(stripped.length, end + pad);
    out.push(stripped.slice(from, to).replace(/\s+/g, ' ').trim());
    lastEnd = to;
    re.lastIndex = Math.max(re.lastIndex, end);
  }
  return out;
}

// ─────────────────────────── từ điển MVU theo chunk ───────────────────────────

/**
 * Chỉ giữ những cặp (Hán → Việt) mà KEY thật sự xuất hiện trong chunk gốc.
 * Trả undefined khi không còn cặp nào — call site giữ nguyên hành vi "không có dict".
 */
export function filterDictForChunk(
  dict: Record<string, string> | undefined,
  rawChunk: string,
): Record<string, string> | undefined {
  if (!dict) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [han, viet] of Object.entries(dict)) {
    if (han && rawChunk.includes(han)) { out[han] = viet; n++; }
  }
  return n > 0 ? out : undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * (bug 207/L6) Chỉ soi/ép hoa-thường những tên biến ĐỦ ĐẶC TRƯNG. Giá trị từ điển kiểu "Cấp",
 * "Tiền" là từ tiếng Việt thường gặp trong văn xuôi — khớp case-insensitive vào chữ thường giữa
 * câu rồi báo "sai hoa/thường" (hoặc tệ hơn: applyDictCasing SỬA cả văn xuôi thành "Cấp") là
 * báo oan hàng loạt. Biến nhiều từ ("Hảo Cảm") hoặc một từ dài mới đáng tin để so.
 */
export function isDistinctiveVarName(viet: string): boolean {
  return viet.includes(' ') ? viet.trim().length >= 5 : viet.length >= 6;
}

/**
 * Soi vi phạm từ điển trong MỘT chunk:
 *  - biến Hán (có trong raw + có trong dict) mà bản dịch VẪN còn nguyên → 'mvu-han';
 *  - bản dịch chứa tên biến ĐÚNG CHỮ nhưng SAI HOA/THƯỜNG so với từ điển → 'mvu-case'.
 * Đây chính là chỗ "đồng biến 100%" chết âm thầm: getvar('Hảo Cảm') ≠ getvar('hảo cảm').
 */
export function mvuChunkViolations(
  rawChunk: string,
  out: string,
  dict: Record<string, string> | undefined,
): ChunkProblem[] {
  if (!dict) return [];
  const hanLeft: string[] = [];
  const caseWrong: string[] = [];
  for (const [han, viet] of Object.entries(dict)) {
    if (!han || !viet || !rawChunk.includes(han)) continue;
    if (out.includes(han)) { hanLeft.push(`${han} → phải thành "${viet}"`); continue; }
    // tìm mọi biến thể sai case của `viet` trong bản dịch — CHỈ với tên đủ đặc trưng (L6)
    if (isDistinctiveVarName(viet) && viet.toLowerCase() !== viet.toUpperCase()) { // có chữ cái để so case
      const re = new RegExp(escapeRe(viet), 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) {
        if (m[0] !== viet) { caseWrong.push(`"${m[0]}" → phải viết đúng "${viet}"`); break; }
      }
    }
    if (hanLeft.length + caseWrong.length >= 12) break; // đủ để chẩn đoán, khỏi liệt kê cả trăm
  }
  const problems: ChunkProblem[] = [];
  if (hanLeft.length) {
    problems.push({
      kind: 'mvu-han',
      detail: `${hanLeft.length} biến trong từ điển MVU vẫn còn nguyên chữ Hán.`,
      samples: hanLeft.slice(0, 6),
    });
  }
  if (caseWrong.length) {
    problems.push({
      kind: 'mvu-case',
      detail: `${caseWrong.length} biến dịch đúng chữ nhưng SAI HOA/THƯỜNG so với từ điển.`,
      samples: caseWrong.slice(0, 6),
    });
  }
  return problems;
}

/**
 * Máy ép hoa/thường + separator nhẹ theo từ điển, chạy NGAY trên từng chunk (bản gọn của
 * enforceVariableCasing bên mvuSync — không import để tránh vòng; bản đầy đủ vẫn chạy ở vòng
 * cuối toàn entry như cũ, đây là lớp chặn sớm để chunk sau/ngữ cảnh sau không học theo cái sai).
 */
export function applyDictCasing(
  out: string,
  dict: Record<string, string>,
): { text: string; fixes: number } {
  let text = out;
  let fixes = 0;
  for (const viet of Object.values(dict)) {
    if (!viet || viet.length < 2 || viet.toLowerCase() === viet.toUpperCase()) continue;
    // (bug 207/L6) Từ ngắn thường gặp trong văn xuôi thì KHÔNG ép — ép là sửa nhầm cả câu văn.
    if (!isDistinctiveVarName(viet)) continue;
    const re = new RegExp(escapeRe(viet), 'gi');
    text = text.replace(re, (m) => {
      if (m === viet) return m;
      fixes++;
      return viet;
    });
  }
  return { text, fixes };
}

// ─────────────────────────── chẩn đoán tổng hợp ───────────────────────────

export interface DiagnoseOptions {
  /** Từ điển MVU ĐÃ LỌC theo chunk (filterDictForChunk) — undefined = bỏ kiểm MVU. */
  dict?: Record<string, string>;
}

/**
 * Soi MỘT chunk trên mọi mặt đo được. Trả [] = chunk đã dịch 100% theo mọi thước máy có.
 * Chỉ dùng dấu hiệu ĐO ĐƯỢC — không đoán mò nội dung (đoán mò là việc của lượt sửa AI).
 */
export function diagnoseChunk(rawChunk: string, out: string, opts: DiagnoseOptions = {}): ChunkProblem[] {
  if (!out.trim()) {
    return [{ kind: 'missing', detail: 'Bản dịch rỗng — phần này sẽ biến mất khi ghép.' }];
  }
  const problems: ChunkProblem[] = [];

  // 1) EJS + code — lỗi cấu trúc, nặng nhất.
  if (hasEjsBlocks(rawChunk) && !ejsBlocksIntact(rawChunk, out)) {
    problems.push({ kind: 'ejs', detail: 'Khối <%…%> / token EJS bị rơi hoặc đúp so với gốc.' });
  }
  if (looksLikeCodeChunk(rawChunk)) {
    const broken = codeStructureBroken(rawChunk, out);
    if (broken) problems.push({ kind: 'code', detail: `Code vỡ sau dịch: ${broken}.` });
  }

  // 2) CJK sót — chunk "còn chữ hán".
  // (bug 207/L6) Bản đầu dùng ngưỡng TUYỆT ĐỐI `outHan >= 10` — với chunk CODE 12k của script
  // Trung (hàng trăm chữ Hán gốc), AI cố ý giữ 10 chữ hợp lệ (khoá getvar/getwi, tên entry
  // lorebook, comment kỹ thuật) là đã "1,25% sót" mà vẫn bị chẩn "chưa dịch trọn" → MỌI chunk
  // tốn 1 lượt sửa vô ích, nhân 21 chunk nhân số vòng retry = chính cơn "treo vô hạn" user báo.
  // Nay chia hai lớp: giữ-nguyên-cả-mảng (tỉ lệ >30%, mọi loại chunk) và sót rải rác — chunk
  // VĂN XUÔI siết chặt (≥10 chữ và >5%), chunk CODE/EJS nới hẳn (≥60 chữ VÀ >15%) vì chữ Hán
  // hợp lệ trong code là chuyện thường.
  const srcHan = countHanNoUrl(rawChunk);
  const outHan = countHanNoUrl(out);
  const codeLike = looksLikeCodeChunk(rawChunk) || hasEjsBlocks(rawChunk);
  const heavyResidue = outHan / srcHan > 0.3;
  // Văn xuôi giữ ngưỡng tuyệt đối ≥10 (văn xuôi không có lý do chính đáng để giữ chữ Hán —
  // URL đã miễn trừ); chỉ CODE mới được nới, vì chữ Hán trong code thường là khoá hợp lệ.
  const scatteredResidue = codeLike
    ? (outHan >= 60 && outHan / srcHan > 0.15)
    : outHan >= 10;
  if (srcHan >= 10 && (heavyResidue || scatteredResidue)) {
    problems.push({
      kind: 'cjk',
      detail: `Còn ${outHan} chữ Hán (gốc ${srcHan}) ngoài URL — chunk chưa được dịch trọn.`,
      samples: extractHanSamples(out),
    });
  }

  // 3) Mất ký tự / phình — ngưỡng theo mật độ Hán của gốc (bug 144), chỉ áp cho phần không phải code
  //    (code đã có thước 0.55 riêng chính xác hơn ở trên).
  if (!looksLikeCodeChunk(rawChunk) && rawChunk.trim()) {
    const range = expectedRatioRange(rawChunk);
    const ratio = out.length / rawChunk.length;
    if (ratio < range.min) {
      problems.push({ kind: 'truncated', detail: `Bản dịch chỉ bằng ${Math.round(ratio * 100)}% độ dài gốc — nghi mất ký tự / cắt cụt.` });
    } else if (ratio > range.max) {
      problems.push({ kind: 'inflated', detail: `Bản dịch dài gấp ${ratio.toFixed(1)} lần gốc — nghi lặp đoạn / bịa thêm.` });
    }
  }

  // 4) Từ điển MVU — đồng biến 100%.
  problems.push(...mvuChunkViolations(rawChunk, out, opts.dict));

  return problems;
}

/** Câu tóm tắt một dòng cho log. */
export function summarizeChunkProblems(problems: ChunkProblem[]): string {
  if (problems.length === 0) return 'sạch 100%';
  const label: Record<ChunkProblemKind, string> = {
    missing: 'rỗng', cjk: 'còn chữ Hán', truncated: 'nghi mất ký tự', inflated: 'nghi lặp/thừa',
    ejs: 'EJS lệch', code: 'code vỡ', 'mvu-han': 'biến MVU chưa dịch', 'mvu-case': 'biến MVU sai hoa/thường',
  };
  return problems.map(p => label[p.kind]).join(' + ');
}

// ─────────────────────────── lượt SỬA có chẩn đoán ───────────────────────────

export interface RepairPromptArgs {
  rawChunk: string;
  flawed: string;
  problems: ChunkProblem[];
  /** "fieldName [part X/N]" — cho model biết vị trí trong entry. */
  partLabel: string;
  /** Mở đầu RAW LỚN (chưa chunk) — ngữ cảnh toàn cục: entry này nói về mảng gì. */
  entryHead?: string;
  /** Đuôi RAW của chunk liền trước / đầu RAW của chunk liền sau — nối mạch tại ranh giới. */
  prevRawTail?: string;
  nextRawHead?: string;
  /** Từ điển đã lọc theo chunk — nhắc lại đúng các biến liên quan. */
  dict?: Record<string, string>;
}

/**
 * Dựng user-message cho lượt SỬA: đưa raw + bản dịch lỗi + chẩn đoán đích danh + ngữ cảnh từ
 * raw lớn, và ra lệnh SỬA ĐÚNG CHỖ — không dịch lại từ đầu. Vì sao không gửi lại prompt cũ:
 * model sai lần một với prompt đó thì lần hai thường sai y hệt; còn ép dịch lại 100% thì phần
 * ĐÃ ĐÚNG (thường là 95% chunk) bị xáo lại, sinh lỗi mới ở chỗ trước đó đang lành.
 */
export function buildChunkRepairInstruction(args: RepairPromptArgs): string {
  const parts: string[] = [];
  parts.push(`NHIỆM VỤ: SỬA BẢN DỊCH BỊ LỖI của đoạn "${args.partLabel}" — KHÔNG dịch lại từ đầu.`);
  parts.push(`Bản dịch dưới đây đã được máy đối chiếu với bản gốc và tìm ra các lỗi CỤ THỂ sau:
${args.problems.map((p, i) => `${i + 1}. [${p.kind}] ${p.detail}${p.samples?.length ? `\n   Vị trí/mẫu: ${p.samples.map(s => `«${s}»`).join(' · ')}` : ''}`).join('\n')}`);
  parts.push(`QUY TẮC SỬA (bắt buộc):
- GIỮ NGUYÊN mọi phần bản dịch đã đúng — chỉ đụng vào đúng những chỗ lỗi nêu trên.
- Lỗi "còn chữ Hán": dịch nốt đúng các cụm được chỉ; tên biến có trong TỪ ĐIỂN thì thay bằng đúng bản dịch trong từ điển, KHÔNG tự chế.
- Lỗi "biến MVU sai hoa/thường": chép lại tên biến ĐÚNG TỪNG KÝ TỰ như từ điển (Hảo Cảm ≠ hảo cảm).
- Lỗi "mất ký tự / cắt cụt": đối chiếu bản gốc, dịch bù ĐÚNG đoạn bị thiếu vào đúng vị trí.
- Lỗi "lặp/thừa": xoá phần lặp/bịa, bám sát bản gốc.
- Lỗi EJS/code: khôi phục đủ khối <%…%>, token {{__ejs_N__}}, cân bằng ngoặc/backtick y như gốc — phần code chỉ dịch chuỗi văn bản, không đổi cấu trúc.
- Không hiểu một đoạn vì thiếu ngữ cảnh ⇒ dùng NGỮ CẢNH TOÀN CỤC bên dưới để hiểu đoạn này phụ trách mảng nào rồi mới sửa.`);
  if (args.dict && Object.keys(args.dict).length > 0) {
    parts.push(`TỪ ĐIỂN BIẾN LIÊN QUAN TỚI ĐOẠN NÀY (bắt buộc dùng đúng từng ký tự):
${Object.entries(args.dict).map(([k, v]) => `  "${k}" → "${v}"`).join('\n')}`);
  }
  const ctx: string[] = [];
  if (args.entryHead?.trim()) ctx.push(`— Mở đầu của TOÀN ENTRY (raw lớn, để biết entry nói về gì):\n${args.entryHead}`);
  if (args.prevRawTail?.trim()) ctx.push(`— Đuôi RAW của đoạn LIỀN TRƯỚC:\n${args.prevRawTail}`);
  if (args.nextRawHead?.trim()) ctx.push(`— Đầu RAW của đoạn LIỀN SAU:\n${args.nextRawHead}`);
  if (ctx.length) parts.push(`NGỮ CẢNH TOÀN CỤC (chỉ để hiểu, KHÔNG dịch phần này):\n${ctx.join('\n\n')}`);
  parts.push(`=== BẢN GỐC CỦA ĐOẠN (đối chiếu) ===\n${args.rawChunk}`);
  parts.push(`=== BẢN DỊCH BỊ LỖI (sửa trên bản này) ===\n${args.flawed}`);
  parts.push(`CHỈ trả về TOÀN VĂN bản dịch ĐÃ SỬA của đoạn — không giải thích, không markdown fence, không lặp lại bản gốc.`);
  return parts.join('\n\n');
}
