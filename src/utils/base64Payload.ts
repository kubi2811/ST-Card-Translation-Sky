/**
 * src/utils/base64Payload.ts — (việc 233) TÀI LIỆU BỊ NHÚNG DƯỚI DẠNG BASE64 TRONG SCRIPT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Một số thẻ nhét NGUYÊN một tài liệu thứ hai (cả trang HTML/Vue/JS) vào một chuỗi base64 duy
 * nhất gán cho biến trong script:
 *     const b64 = 'PCFkb2N0eXBlIGh0bWw+…';        // phone_app.html
 *     const EMBEDDED_HTML_B64 = 'PGhlYWQ+PG1ldGE…';
 * Giải ra là một trang HTML đầy đủ, có chữ Hán mà NGƯỜI CHƠI NHÌN THẤY.
 *
 * ═══ ĐO TRÊN HAI FILE THẬT USER GỬI (bug/233) ═══
 *                          chữ Hán thấy được   chữ Hán ẨN trong base64
 *   Script.txt                     2.505              10.819   (81% tổng số)
 *   Lời Chào Gắn Kết.txt           2.762               3.346   (55% tổng số)
 *
 * Nên nếu để nguyên khối base64 thì thẻ trông như "đã dịch xong" trong khi giao diện điện thoại
 * trong thẻ vẫn hiện tiếng Trung nguyên bản.
 *
 * ═══ VÀ CÒN TỆ HƠN THẾ: HIỆN TẠI KHỐI ĐÓ ĐANG ĐƯỢC GỬI THẲNG CHO AI ═══
 * Không lớp che nào của đường ống chạm tới nó: `maskUrls` chỉ bắt data-URI nằm trong src=/href=/
 * url(), còn đây là chuỗi trần gán cho biến. Đo được với cỡ mảnh 9000 của field code-heavy:
 *   Script.txt            43 mảnh, trong đó 35 mảnh CHỨA base64 → ~77.500 token vào + bấy nhiêu ra
 *   Lời Chào Gắn Kết      22 mảnh, trong đó 16 mảnh CHỨA base64 → ~34.000 token vào + bấy nhiêu ra
 * Tức mỗi lượt dịch đốt hơn 220.000 token chỉ để bắt AI chép lại y nguyên một chuỗi vô nghĩa qua
 * 51 lượt gọi khác nhau — và chỉ cần MỘT ký tự sai ở bất kỳ mảnh nào là hỏng cả ứng dụng nhúng.
 *
 * ═══ VÌ SAO GIẢI MÃ BẰNG CODE, KHÔNG NHỜ AI ═══
 * Chỉ dẫn của User viết cho một AI dịch ("mentally decode… re-encode"). Với một CÔNG CỤ thì đó là
 * cách tệ nhất: mọi lỗi [FATAL] mà chính chỉ dẫn liệt kê — sai padding '=', chèn xuống dòng, lẫn
 * khoảng trắng — đều là hệ quả trực tiếp của việc bắt mô hình tự mã hoá 200KB văn bản. Ở đây
 * TOOL làm phần base64 (tất định, khép kín, có test), AI chỉ nhìn thấy VĂN BẢN ĐÃ GIẢI. Nhờ vậy
 * cả nhóm lỗi đó biến mất về mặt cấu trúc chứ không phải nhờ mô hình cẩn thận.
 */

/** Ba nhóm của RULE C15 — nhầm nhóm là hỏng thẻ, nên mỗi nhóm có lý do riêng ghi trong `why`. */
export type Base64Kind =
  /** (a) Token do script tổng lắp thay lúc dựng — KHÔNG phải dữ liệu mã hoá. Giữ nguyên tuyệt đối. */
  | 'placeholder'
  /** (b) Base64 thật nhưng giải ra là NHỊ PHÂN (ảnh/font/âm thanh). Giữ nguyên tuyệt đối. */
  | 'binary'
  /** (c) Base64 giải ra là VĂN BẢN/mã nguồn đọc được — nhóm duy nhất được dịch. */
  | 'text';

export interface Base64Payload {
  /** Chuỗi base64 nguyên bản (KHÔNG gồm dấu nháy bao quanh). */
  raw: string;
  /** Vị trí trong text gốc. */
  start: number;
  end: number;
  kind: Base64Kind;
  /** Lý do phân loại — hiện thẳng trong log để người dùng kiểm được quyết định của tool. */
  why: string;
  /** Chỉ với kind='text'. */
  decoded?: string;
  /** Tên biến/mime gần nhất bên trái — để gọi tên payload trong log. */
  label?: string;
}

/**
 * Ngưỡng độ dài. Chỉ dẫn nói "typically 200+ char". Dưới ngưỡng này thì lợi ích (dịch được vài
 * chữ) không đáng rủi ro (bắt nhầm một chuỗi hash/ID trông giống base64).
 */
export const MIN_PAYLOAD_LEN = 200;

/** Số tầng lồng nhau tối đa — chỉ dẫn chốt 3, sâu hơn thì coi như nhóm (b) cho an toàn. */
export const MAX_NESTING = 3;

const B64_RUN = /[A-Za-z0-9+/]{200,}={0,2}/g;

/* ── Chuyển đổi không phụ thuộc môi trường (trình duyệt lẫn Node đều có atob/btoa) ── */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;   // gọi fromCharCode với cả triệu tham số là tràn stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Giải base64 → UTF-8, NGHIÊM NGẶT. Trả null khi bất kỳ điều kiện nào sau đây hỏng:
 *   • không phải base64 hợp lệ;
 *   • byte giải ra KHÔNG phải UTF-8 đúng chuẩn (`fatal: true` ném lỗi thay vì trả về ký tự thay thế);
 *   • MÃ HOÁ LẠI KHÔNG RA ĐÚNG CHUỖI CŨ.
 *
 * Điều kiện cuối là chốt chặn quan trọng nhất: nếu bản gốc dùng base64 phi chuẩn (có xuống dòng,
 * dùng bảng chữ URL-safe, padding lạ) thì ta KHÔNG thể mã hoá lại ra đúng dạng đó, nên đụng vào
 * là làm hỏng. Thà bỏ qua một payload còn hơn hỏng thẻ.
 */
export function decodeBase64Text(raw: string): string | null {
  if (!raw || raw.length < 8) return null;
  try {
    const bytes = base64ToBytes(raw);
    if (bytesToBase64(bytes) !== raw) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Mã hoá UTF-8 → base64 chuẩn: đúng bảng chữ, đúng padding '=', KHÔNG xuống dòng, không khoảng trắng. */
export function encodeBase64Text(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/* ── Phân loại ── */

/** Tên biến kiểu tài sản nhị phân — giải ra là rác, không được đụng. */
const BINARY_VAR_RE = /(icon|font|img|image|png|jpe?g|gif|webp|avif|audio|video|mp3|mp4|wav|ogg|woff2?|ttf|otf|blob|bin|buffer|zip|pdf)/i;

/** Mime cho biết nội dung là VĂN BẢN (những mime còn lại coi như nhị phân). */
const TEXT_MIME_RE = /^(text\/|application\/(json|javascript|xml|xhtml)|image\/svg\+xml)/i;

/**
 * Đầu bản GIẢI RA trông có ra mã nguồn/markup không.
 *
 * Chỉ dẫn liệt kê tiền tố base64 ("PCFE…", "eyJ"…), nhưng kiểm trên BẢN ĐÃ GIẢI thì chắc hơn hẳn:
 * không phụ thuộc vào việc chuỗi bắt đầu ở ranh giới 3-byte nào.
 */
const CODE_OPENER_RE = /^\s*(<!doctype|<!--|<html|<head|<body|<div|<script|<style|<svg|<\?xml|\{\s*"|\[\s*[{"]|import\s|export\s|const\s|let\s|var\s|function\s|class\s|\/\*|\/\/)/i;

/** Tỉ lệ ký tự in được — văn bản thật gần như 100%; nhị phân giải nhầm sẽ rất thấp. */
function printableRatio(s: string): number {
  if (!s) return 0;
  const bad = s.match(new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\uFFFD]', 'g'));
  return 1 - (bad ? bad.length / s.length : 0);
}

/**
 * Đây có phải TOKEN DỰNG-SẴN (nhóm a) không — thứ mà chỉ dẫn xếp vào loại [FATAL] nếu đụng vào.
 *
 * `__WN_PHONE_HTML_B64__` không lọt được bộ dò vì dấu `_` nằm ngoài bảng chữ base64 và token quá
 * ngắn. Nhưng vẫn phải canh: một token dài, viết HOA toàn bộ, hoặc nằm ngay cạnh `_`/`{{}}`/`${}`/
 * `%%` là dấu hiệu nó sẽ bị một script khác thay sau, không phải dữ liệu.
 */
function looksLikePlaceholder(text: string, start: number, end: number, raw: string): boolean {
  const before2 = text.slice(Math.max(0, start - 2), start);
  const after2 = text.slice(end, end + 2);
  if (before2.endsWith('_') || after2.startsWith('_')) return true;
  if (before2.endsWith('{{') || after2.startsWith('}}')) return true;
  if (before2.endsWith('${') || after2.startsWith('}')) return true;
  if (before2.endsWith('%') && after2.startsWith('%')) return true;
  // Toàn chữ HOA + số (không có chữ thường) — base64 thật của văn bản gần như luôn có chữ thường.
  if (!/[a-z]/.test(raw)) return true;
  return false;
}

/** Nhãn gọi tên payload trong log: tên biến gán, hoặc mime của data-URI. */
function labelFor(text: string, start: number): string | undefined {
  const before = text.slice(Math.max(0, start - 160), start);
  const dataUri = before.match(/data:([\w.+-]+\/[\w.+-]+)?;base64,\s*$/i);
  if (dataUri) return `data:${dataUri[1] || '?'}`;
  const assign = before.match(/([A-Za-z_$][\w$]*)\s*[:=]\s*['"`]\s*$/);
  if (assign) return assign[1];
  const comment = before.match(/([\w.\-/]+\.(?:html?|vue|js|json|css))[^\n]*$/i);
  if (comment) return comment[1];
  return undefined;
}

/**
 * Tìm và PHÂN LOẠI mọi khối base64 đủ dài trong một đoạn text.
 * Không bao giờ ném lỗi — đầu vào lạ thì trả mảng rỗng.
 */
export function findBase64Payloads(text: string): Base64Payload[] {
  if (!text || typeof text !== 'string' || text.length < MIN_PAYLOAD_LEN) return [];
  const out: Base64Payload[] = [];
  const re = new RegExp(B64_RUN.source, B64_RUN.flags);
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const label = labelFor(text, start);

    if (looksLikePlaceholder(text, start, end, raw)) {
      out.push({ raw, start, end, kind: 'placeholder', why: 'token do script tổng lắp thay lúc dựng — không phải dữ liệu mã hoá', label });
      continue;
    }

    // data-URI có mime nhị phân thì khỏi cần giải cũng biết.
    const before = text.slice(Math.max(0, start - 80), start);
    const mime = before.match(/data:([\w.+-]+\/[\w.+-]+)?;base64,\s*$/i)?.[1];
    if (mime && !TEXT_MIME_RE.test(mime)) {
      out.push({ raw, start, end, kind: 'binary', why: `data-URI mime "${mime}" là nhị phân`, label });
      continue;
    }
    if (!mime && label && BINARY_VAR_RE.test(label)) {
      out.push({ raw, start, end, kind: 'binary', why: `tên biến "${label}" báo hiệu tài sản nhị phân`, label });
      continue;
    }

    const decoded = decodeBase64Text(raw);
    if (decoded === null) {
      out.push({ raw, start, end, kind: 'binary', why: 'không giải ra UTF-8 hợp lệ, hoặc mã hoá lại không ra đúng chuỗi cũ', label });
      continue;
    }
    if (printableRatio(decoded) < 0.95) {
      out.push({ raw, start, end, kind: 'binary', why: 'giải ra chứa nhiều byte không in được — là nhị phân', label });
      continue;
    }
    if (!CODE_OPENER_RE.test(decoded)) {
      // Điều khoản RECOVERY của chỉ dẫn: không chắc chắn nhận ra mã/markup ở đầu thì lùi về nhóm
      // (b) và để nguyên. Bỏ sót một payload thì lần sau dịch lại được; hỏng thẻ thì không.
      out.push({ raw, start, end, kind: 'binary', why: 'đầu bản giải không ra mã/markup đọc được — để nguyên cho chắc', label });
      continue;
    }

    out.push({ raw, start, end, kind: 'text', why: 'giải ra là tài liệu văn bản/mã nguồn', decoded, label });
  }
  return out;
}

/* ── Báo cáo cho người dùng lúc nhập thẻ ── */

export interface Base64ReportItem {
  /** Nhãn field chứa payload (vd "tavernHelper[2].content"). */
  fieldLabel: string;
  /** Tên biến/mime của payload. */
  label: string;
  kind: Base64Kind;
  why: string;
  /** Số ký tự sau khi giải (0 với nhóm b/a). */
  decodedChars: number;
  /** Chữ Hán bên trong (0 với nhóm b/a). */
  cjk: number;
  /** Độ dài chuỗi base64 thô. */
  rawChars: number;
}

export interface Base64Report {
  /** Tổng số khối nhúng tìm thấy. */
  total: number;
  /** Số khối SẼ ĐƯỢC DỊCH (nhóm c). */
  translatable: number;
  /** Số khối giữ nguyên (nhóm a + b). */
  keptVerbatim: number;
  /** Tổng chữ Hán ĐANG BỊ GIẤU trong các khối dịch được. */
  hiddenCjk: number;
  /** Tổng ký tự base64 sẽ được che khỏi lượt gọi AI. */
  maskedChars: number;
  items: Base64ReportItem[];
}

/**
 * (việc 233 — yêu cầu của user) Quét TOÀN BỘ field của thẻ vừa nhập để trả lời đúng hai câu:
 * thẻ này có bị nhúng base64 không, và tool có xử lý được không.
 */
export function scanFieldsForPayloads(
  fields: Array<{ label?: string; path?: string; original?: string }>,
): Base64Report {
  const items: Base64ReportItem[] = [];
  let translatable = 0, keptVerbatim = 0, hiddenCjk = 0, maskedChars = 0;

  for (const f of fields) {
    const text = f?.original;
    if (!text || typeof text !== 'string' || text.length < MIN_PAYLOAD_LEN) continue;
    for (const p of findBase64Payloads(text)) {
      const cjk = p.kind === 'text' && p.decoded ? (p.decoded.match(/[一-鿿]/g) || []).length : 0;
      if (p.kind === 'text') { translatable++; hiddenCjk += cjk; } else { keptVerbatim++; }
      if (p.kind !== 'placeholder') maskedChars += p.raw.length;
      items.push({
        fieldLabel: f.label || f.path || '(không rõ)',
        label: p.label || '(không tên)',
        kind: p.kind,
        why: p.why,
        decodedChars: p.decoded?.length ?? 0,
        cjk,
        rawChars: p.raw.length,
      });
    }
  }

  return { total: items.length, translatable, keptVerbatim, hiddenCjk, maskedChars, items };
}

/**
 * (việc 233) Quét THẲNG trên thẻ, không đợi trích field.
 *
 * Thẻ nhỏ được parse ở luồng chính thì `fields` mãi tới lúc bắt đầu dịch mới có, nên nếu chỉ quét
 * theo field thì báo cáo sẽ trống đúng lúc người dùng cần nó nhất — ngay sau khi nhập thẻ. Đi
 * thẳng vào mọi chuỗi trong thẻ thì một chỗ móc là phủ mọi đường nhập.
 */
export function scanCardForPayloads(card: unknown): Base64Report {
  const found: Array<{ label: string; original: string }> = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 12 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (node.length >= MIN_PAYLOAD_LEN) found.push({ label: path, original: node });
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;   // thẻ lỗi có thể tự trỏ vòng — đừng đi mãi
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  try { walk(card, '', 0); } catch { /* thẻ lạ — báo cáo rỗng còn hơn chặn việc nhập thẻ */ }
  return scanFieldsForPayloads(found);
}

/** Đếm chữ Hán NẰM TRONG các payload nhóm (c) — phần mà bộ quét chữ Hán thường không nhìn thấy. */
export function countHiddenCjk(text: string): number {
  let n = 0;
  for (const p of findBase64Payloads(text)) {
    if (p.kind === 'text' && p.decoded) n += (p.decoded.match(/[\u4e00-\u9fff]/g) || []).length;
  }
  return n;
}

/* ── Che / gỡ che ── */

export interface Base64MaskMap {
  [placeholder: string]: Base64Payload;
}

/**
 * Thay MỌI khối base64 đủ dài bằng một ô giữ chỗ ngắn.
 *
 * Che CẢ nhóm (b): nhóm đó không được dịch, nhưng cũng chẳng có lý do gì phải bắt AI chép lại một
 * khối nhị phân dài hàng trăm nghìn ký tự — che đi là vừa tiết kiệm token vừa hết cửa bị chép sai.
 * Nhóm (a) thì KHÔNG che (và bộ dò cũng không bắt): nó là chuỗi thường, cứ để AI thấy như mọi
 * chuỗi khác, y như chỉ dẫn yêu cầu.
 */
export function maskBase64Payloads(text: string): { maskedText: string; map: Base64MaskMap } {
  const map: Base64MaskMap = {};
  const payloads = findBase64Payloads(text).filter(p => p.kind !== 'placeholder');
  if (payloads.length === 0) return { maskedText: text, map };

  let out = '';
  let cursor = 0;
  payloads.forEach((p, i) => {
    const ph = `__B64_PAYLOAD_${i}__`;
    map[ph] = p;
    out += text.slice(cursor, p.start) + ph;
    cursor = p.end;
  });
  out += text.slice(cursor);
  return { maskedText: out, map };
}

/**
 * Trả khối base64 về chỗ cũ.
 *
 * `resolve` cho caller quyết định nội dung: mặc định trả về ĐÚNG chuỗi gốc (không đổi một ký tự),
 * còn khi payload nhóm (c) đã dịch xong thì trả về bản đã mã hoá lại. Chỉ thay RUỘT chuỗi base64;
 * dấu nháy, tên biến và mọi thứ xung quanh không hề bị đụng vì chúng nằm ngoài vùng thay.
 */
export function unmaskBase64Payloads(
  text: string,
  map: Base64MaskMap,
  resolve?: (payload: Base64Payload, placeholder: string) => string | undefined,
): string {
  let out = text;
  for (const [ph, payload] of Object.entries(map)) {
    const replacement = resolve?.(payload, ph) ?? payload.raw;
    out = out.split(ph).join(replacement);
  }
  return out;
}

/**
 * (việc 233) Bản dịch của ruột payload có ĐÁNG NHẬN không.
 *
 * Cùng tinh thần với bộ chặn "dịch lại làm hỏng bản tốt" của bug 219: một payload đang chạy tốt
 * mà thay bằng bản cụt/rỗng là làm hỏng thứ vốn không hỏng. Không chắc thì giữ nguyên.
 */
export function judgeInnerPayload(original: string, translated: string): { ok: boolean; why: string } {
  const t = (translated || '').trim();
  if (!t) return { ok: false, why: 'bản dịch rỗng' };
  if (t.length < original.length * 0.5) {
    return { ok: false, why: `bản dịch cụt (${t.length}/${original.length} ký tự, dưới 50%)` };
  }
  if (t.includes('__B64_PAYLOAD_')) return { ok: false, why: 'còn sót ô giữ chỗ trong bản dịch' };
  return { ok: true, why: '' };
}
