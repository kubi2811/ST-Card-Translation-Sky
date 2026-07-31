/**
 * src/utils/aiEntryRepair.ts — (bugNeedFix/170) SỬA MỘT ENTRY LỖI BẰNG AI, CÓ CHỐT CHẶN.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "sau khi dịch xong có lỗi, ở phần kiểm tra lỗi hãy thêm nút chỉnh sửa bằng AI kế bên.
 * AI sẽ quét lại toàn bộ entry, bản dịch và bản raw để tìm ra chính xác lỗi là gì, kết hợp với
 * schema và initvar của lorebook để chỉnh sửa entry đó lại cho đúng. Nhất là phải kết hợp kỹ
 * cấu hình ejs và các biến."
 *
 * Vì sao cần: bộ kiểm hiện có (cardHealth) CHỈ BÁO — nó nói "script vỡ cú pháp", "còn chữ Hán
 * trong code", rồi để user tự mở field ra sửa tay. Với entry EJS/MVU thì sửa tay gần như bất khả:
 * lỗi thường là một tên biến bị dịch lệch, mà biết tên nào đúng thì phải tra [initvar] ở entry
 * KHÁC. Nút "dịch lại" cũng không giải được — dịch lại là chạy lại đúng con đường đã sinh ra lỗi.
 *
 * Ba tầng ở file này, tầng nào cũng chạy được KHÔNG cần AI (trừ tầng gọi):
 *   1. collectRepairContext — gom SỰ THẬT quanh entry: bản gốc, bản dịch, [initvar] của card
 *      (đường dẫn biến THẬT), các biến mà EJS trong entry đang đọc, macro, và lỗi máy đã bắt.
 *   2. buildRepairMessages — prompt bắt AI CHẨN ĐOÁN trước rồi mới sửa, và cấm đổi tên biến
 *      sang thứ không có trong [initvar].
 *   3. verifyRepair — CHỐT CHẶN tất định: bản sửa phải parse được, không được làm rơi khối EJS
 *      /macro, không được đẻ ra biến lạ, không được ngắn đi bất thường. Không đạt thì GIỮ BẢN CŨ
 *      và nói rõ vì sao — thà không sửa còn hơn sửa hỏng thêm.
 */
import type { TranslationField } from '../types/card';
import { jsParseErrorAny } from './scriptSafety';
import { segmentEjs } from './ejsSegmenter';
import { restoreMacros } from './macroGuard';

/* ═══ 1. GOM SỰ THẬT ══════════════════════════════════════════════════════ */

export interface RepairContext {
  path: string;
  label: string;
  entryType?: string;
  original: string;
  translated: string;
  /** Đường dẫn biến THẬT lấy từ [initvar] của card — nguồn duy nhất để đối chiếu tên biến. */
  initvarPaths: string[];
  /** Biến mà EJS trong bản dịch đang đọc (getvar/setvar). */
  varsRead: string[];
  /** Biến EJS đọc nhưng KHÔNG có trong [initvar] — gần như luôn là gốc lỗi. */
  unknownVars: string[];
  /** Macro {{...}} có trong bản gốc. */
  macrosOriginal: string[];
  /** Macro có trong bản dịch — thiếu so với gốc là dấu hiệu dịch làm rơi. */
  macrosTranslated: string[];
  /** Lỗi máy tự bắt được (cú pháp JS, lệch số khối EJS…). */
  machineFindings: string[];
}

const GETVAR_RE = /\b(?:getvar|setvar)\s*\(\s*(['"])([^'"]+)\1/g;
const MACRO_RE = /\{\{[^}]{1,80}\}\}/g;
const EJS_OPEN_RE = /<%/g;

/** Bóc mọi đường dẫn lá từ một object initvar đã parse. */
export function flattenPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return prefix ? [prefix] : [];
  if (Array.isArray(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenPaths(v, p));
    else out.push(p);
  }
  return out;
}

/**
 * Đọc [initvar] của card → danh sách đường dẫn biến THẬT.
 * MVU đặt biến dưới `stat_data`, và EJS đọc bằng getvar('stat_data.<đường dẫn>') — nên thêm cả
 * hai dạng (có và không tiền tố) để đối chiếu không bị lệch chỉ vì thiếu tiền tố.
 */
export function readInitvarPaths(fields: TranslationField[]): string[] {
  const src = fields.filter(f => f.entryType === 'initvar' || /\[initvar\]/i.test(f.label));
  const out = new Set<string>();
  for (const f of src) {
    const text = (f.translated || f.original || '').trim();
    // Nội dung [initvar] thường là JSON/JSON5 nằm sau một dòng nhãn văn xuôi.
    const start = text.search(/[[{]/);
    if (start < 0) continue;
    try {
      const parsed: unknown = JSON.parse(text.slice(start));
      for (const p of flattenPaths(parsed)) {
        out.add(p);
        if (!p.startsWith('stat_data.')) out.add(`stat_data.${p}`);
      }
    } catch { /* không parse được thì thôi — KHÔNG đoán, chỗ này sai là hỏng cả bản sửa */ }
  }
  return [...out];
}

function uniq(xs: string[]): string[] { return [...new Set(xs)]; }

export function collectRepairContext(
  field: TranslationField,
  allFields: TranslationField[],
  extraFindings: string[] = [],
): RepairContext {
  const original = field.original ?? '';
  const translated = field.translated ?? '';
  const initvarPaths = readInitvarPaths(allFields);

  const varsRead = uniq([...translated.matchAll(GETVAR_RE)].map(m => m[2]));
  // Chỉ coi là "biến lạ" khi card CÓ [initvar] để đối chiếu. Card không có thì im lặng còn hơn
  // báo cả trăm biến lạ do không có gì để so.
  const unknownVars = initvarPaths.length
    ? varsRead.filter(v => !initvarPaths.includes(v) && !initvarPaths.includes(`stat_data.${v}`))
    : [];

  const macrosOriginal = uniq(original.match(MACRO_RE) ?? []);
  const macrosTranslated = uniq(translated.match(MACRO_RE) ?? []);

  const findings: string[] = [...extraFindings];
  if (field.error) findings.push(`Engine dịch báo lỗi: ${field.error}`);

  const jsErr = jsParseErrorAny(translated);
  if (jsErr) findings.push(`Bản dịch vỡ cú pháp JS: ${jsErr.msg} (dòng ${jsErr.line})`);
  const jsErrSrc = jsParseErrorAny(original);
  if (jsErr && jsErrSrc) {
    findings.push('LƯU Ý: bản GỐC cũng đã vỡ cú pháp sẵn — lỗi này không do dịch gây ra, đừng "sửa" theo hướng đổi logic.');
  }

  const openO = (original.match(EJS_OPEN_RE) ?? []).length;
  const openT = (translated.match(EJS_OPEN_RE) ?? []).length;
  if (openO !== openT) findings.push(`Số khối EJS lệch: bản gốc ${openO} khối "<%", bản dịch ${openT}.`);

  const lostMacros = macrosOriginal.filter(m => !macrosTranslated.includes(m));
  if (lostMacros.length) findings.push(`Bản dịch làm RƠI macro: ${lostMacros.join(', ')}.`);

  if (unknownVars.length) {
    findings.push(`Biến EJS đang đọc KHÔNG có trong [initvar]: ${unknownVars.join(', ')}. Đây thường là tên biến bị dịch lệch.`);
  }

  return {
    path: field.path, label: field.label, entryType: field.entryType,
    original, translated, initvarPaths, varsRead, unknownVars,
    macrosOriginal, macrosTranslated, machineFindings: findings,
  };
}

/* ═══ 2. PROMPT ═══════════════════════════════════════════════════════════ */

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

const SYSTEM = `Bạn là kỹ sư sửa thẻ SillyTavern. Nhiệm vụ: một entry đã được dịch sang tiếng Việt và
đang LỖI. Hãy tìm ra ĐÍCH DANH lỗi rồi trả về bản đã sửa.

QUY TẮC BẤT DI BẤT DỊCH
1. Đây là việc SỬA LỖI, KHÔNG phải dịch lại. Giữ nguyên mọi câu chữ tiếng Việt đã đúng — chỉ
   đụng đúng phần gây lỗi. Trả về bản viết lại toàn bộ từ đầu là sai yêu cầu.
2. TÊN BIẾN, KHOÁ JSON, tên hàm, tên entry: chỉ được dùng những đường dẫn CÓ THẬT trong khối
   "BIẾN THẬT" bên dưới. Cấm bịa tên mới, cấm dịch tên biến, cấm đổi hoa thường.
3. Macro {{...}}, khối <% %>, thẻ HTML, dấu ngoặc: bản sửa phải có ĐỦ như bản gốc. Thiếu một cái
   là hỏng thẻ khi chơi.
4. So với BẢN GỐC để biết cái gì vốn có; so với BẢN DỊCH để biết cái gì đã sai lệch.
5. Nếu lỗi vốn CÓ SẴN trong bản gốc (không do dịch), nói rõ và chỉ sửa tối thiểu cho chạy được,
   KHÔNG đổi logic của tác giả.

TRẢ VỀ ĐÚNG KHUÔN NÀY, không thêm lời dẫn:
<chan_doan>một đoạn ngắn: lỗi là gì, ở đâu, vì sao xảy ra</chan_doan>
<da_sua>toàn bộ nội dung entry sau khi sửa</da_sua>
<thay_doi>liệt kê từng thay đổi, mỗi dòng một cái</thay_doi>`;

/** Cắt bớt cho vừa context nhưng giữ nguyên hai đầu — lỗi hay nằm ở rìa. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return `${s.slice(0, half)}\n…(cắt ${s.length - max} ký tự giữa)…\n${s.slice(-half)}`;
}

export function buildRepairMessages(ctx: RepairContext, userNote = ''): ChatMsg[] {
  const parts: string[] = [
    `═══ ENTRY ĐANG LỖI ═══`,
    `Tên: ${ctx.label}`,
    `Đường dẫn: ${ctx.path}${ctx.entryType ? ` (loại: ${ctx.entryType})` : ''}`,
    '',
    '═══ MÁY ĐÃ BẮT ĐƯỢC ═══',
    ctx.machineFindings.length
      ? ctx.machineFindings.map((f, i) => `${i + 1}. ${f}`).join('\n')
      : '(máy không bắt được lỗi cú pháp nào — lỗi có thể thuộc về nội dung/ngữ nghĩa, hãy tự soi)',
    '',
  ];

  if (ctx.initvarPaths.length) {
    parts.push(
      '═══ BIẾN THẬT (lấy từ [initvar] của chính thẻ này) ═══',
      'CHỈ được dùng những đường dẫn dưới đây. Không có trong danh sách = không tồn tại.',
      ctx.initvarPaths.slice(0, 200).join('\n'),
      ctx.initvarPaths.length > 200 ? `…(còn ${ctx.initvarPaths.length - 200} đường dẫn nữa)` : '',
      '',
    );
  } else {
    parts.push(
      '═══ BIẾN THẬT ═══',
      'Thẻ này KHÔNG có entry [initvar] đọc được, nên không có danh sách biến để đối chiếu.',
      'Vì vậy: TUYỆT ĐỐI giữ nguyên mọi tên biến đang có trong bản dịch, chỉ sửa phần cú pháp.',
      '',
    );
  }

  if (ctx.macrosOriginal.length) {
    parts.push(`═══ MACRO PHẢI GIỮ ĐỦ ═══\n${ctx.macrosOriginal.join(' ')}`, '');
  }

  parts.push(
    '═══ BẢN GỐC (trước khi dịch) ═══',
    clip(ctx.original, 24_000),
    '',
    '═══ BẢN DỊCH ĐANG LỖI ═══',
    clip(ctx.translated, 24_000),
  );
  if (userNote.trim()) parts.push('', `═══ GHI CHÚ CỦA NGƯỜI DÙNG ═══\n${userNote.trim()}`);

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: parts.filter(Boolean).join('\n') },
  ];
}

/* ═══ 3. ĐỌC ĐÁP ÁN + CHỐT CHẶN ═══════════════════════════════════════════ */

export interface RepairResult {
  diagnosis: string;
  fixed: string;
  changes: string[];
}

function tag(raw: string, name: string): string | null {
  const m = raw.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

export function parseRepairResponse(raw: string): RepairResult | null {
  const fixed = tag(raw, 'da_sua');
  if (fixed === null) return null;
  const changes = (tag(raw, 'thay_doi') ?? '')
    .split('\n').map(s => s.replace(/^[-*•\d.\s]+/, '').trim()).filter(Boolean);
  return {
    diagnosis: tag(raw, 'chan_doan') ?? '(AI không nêu chẩn đoán)',
    fixed, changes,
  };
}

export interface VerifyVerdict {
  ok: boolean;
  /** Vì sao từ chối — luôn có chữ khi ok=false, để user biết chuyện gì xảy ra. */
  reasons: string[];
  /** Điều bản sửa làm được (hiện cho user thấy nó thật sự tốt hơn, không phải lời hứa). */
  improvements: string[];
}

/**
 * CHỐT CHẶN. Bản sửa chỉ được nhận khi KHÔNG làm hỏng thêm thứ gì đo được.
 * Nguyên tắc: thà giữ bản lỗi cũ (user còn biết mình đang lỗi) hơn là ghi đè một bản trông sạch
 * mà đã rơi mất macro hoặc đổi tên biến sang thứ không tồn tại — loại hỏng đó chỉ lộ ra lúc chơi.
 */
export function verifyRepair(ctx: RepairContext, fixed: string): VerifyVerdict {
  const reasons: string[] = [];
  const improvements: string[] = [];

  if (!fixed.trim()) return { ok: false, reasons: ['AI trả về nội dung rỗng.'], improvements: [] };

  // (a) Không được teo đi bất thường — dấu hiệu AI tóm tắt thay vì sửa.
  const ratio = fixed.length / Math.max(1, ctx.translated.length);
  if (ratio < 0.6) {
    reasons.push(`Bản sửa ngắn hơn hẳn bản cũ (${Math.round(ratio * 100)}%) — nhiều khả năng AI tóm tắt thay vì sửa.`);
  }

  // (b0) (bugNeedFix/180) Macro không được ĐỔI RUỘT. Kiểm này khác kiểm "thiếu macro" bên dưới:
  // {{user}} thành {{基础信息}} thì SỐ macro vẫn đủ, chỉ ruột sai — đếm số không bao giờ thấy.
  {
    const mg = restoreMacros(ctx.original, fixed);
    if (mg.fixes.length > 0) {
      reasons.push(
        `Bản sửa đổi tên macro: ${mg.fixes.map(f => `{{${f.wrong}}} (đúng ra {{${f.right}}})`).join(', ')}.`,
      );
    }
  }

  // (b) Macro phải đủ như BẢN GỐC.
  const macrosNow = uniq(fixed.match(MACRO_RE) ?? []);
  const stillLost = ctx.macrosOriginal.filter(m => !macrosNow.includes(m));
  if (stillLost.length) {
    reasons.push(`Vẫn thiếu macro so với bản gốc: ${stillLost.join(', ')}.`);
  } else if (ctx.macrosOriginal.length > ctx.macrosTranslated.length) {
    improvements.push(`Đã khôi phục ${ctx.macrosOriginal.length - ctx.macrosTranslated.length} macro bị rơi.`);
  }

  // (c) Số khối EJS phải khớp bản gốc.
  const openO = (ctx.original.match(EJS_OPEN_RE) ?? []).length;
  const openF = (fixed.match(EJS_OPEN_RE) ?? []).length;
  if (openO !== openF) {
    reasons.push(`Số khối EJS vẫn lệch bản gốc (gốc ${openO}, bản sửa ${openF}).`);
  } else if (openO !== (ctx.translated.match(EJS_OPEN_RE) ?? []).length) {
    improvements.push('Đã trả lại đúng số khối EJS như bản gốc.');
  }

  // (d) Không được đẻ ra biến KHÔNG có trong [initvar]. Chỉ kiểm khi có [initvar] để so.
  if (ctx.initvarPaths.length) {
    const varsNow = uniq([...fixed.matchAll(GETVAR_RE)].map(m => m[2]));
    const badNow = varsNow.filter(v => !ctx.initvarPaths.includes(v) && !ctx.initvarPaths.includes(`stat_data.${v}`));
    // Biến lạ VỐN ĐÃ CÓ trước khi sửa thì không tính là tội của bản sửa — nhưng biến lạ MỚI thì có.
    const newlyBad = badNow.filter(v => !ctx.unknownVars.includes(v));
    if (newlyBad.length) {
      reasons.push(`Bản sửa tạo ra biến KHÔNG có trong [initvar]: ${newlyBad.join(', ')}.`);
    }
    const healed = ctx.unknownVars.filter(v => !badNow.includes(v));
    if (healed.length) improvements.push(`Đã sửa ${healed.length} tên biến về đúng [initvar]: ${healed.join(', ')}.`);
  }

  // (e) Cú pháp JS: bản sửa không được vỡ nếu bản GỐC lành.
  const errFixed = jsParseErrorAny(fixed);
  const errSrc = jsParseErrorAny(ctx.original);
  if (errFixed && !errSrc) {
    reasons.push(`Bản sửa vẫn vỡ cú pháp JS: ${errFixed.msg} (dòng ${errFixed.line}).`);
  } else if (!errFixed && jsParseErrorAny(ctx.translated)) {
    improvements.push('Đã sửa xong lỗi cú pháp JS.');
  }

  // (f) Khối code EJS phải cân — dùng chính bộ tách của app, không đếm tay.
  try {
    const segs = segmentEjs(fixed);
    if (segs.length === 0 && openF > 0) reasons.push('Không tách được khối EJS trong bản sửa — cấu trúc <% %> có thể chưa đóng.');
  } catch (e) {
    reasons.push(`Bản sửa làm bộ tách EJS lỗi: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { ok: reasons.length === 0, reasons, improvements };
}

/** Câu tóm tắt hiện cho user sau một lượt sửa — nói thật, không hứa suông. */
export function summarizeRepair(v: VerifyVerdict, r: RepairResult): string {
  if (!v.ok) {
    return `Chưa nhận bản sửa (giữ nguyên bản cũ). Lý do: ${v.reasons.join(' ')}`;
  }
  const gains = v.improvements.length ? ` ${v.improvements.join(' ')}` : '';
  const n = r.changes.length;
  return `Đã áp bản sửa${n ? ` (${n} thay đổi)` : ''}.${gains}`;
}
