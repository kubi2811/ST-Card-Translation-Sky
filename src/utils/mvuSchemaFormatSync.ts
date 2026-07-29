/**
 * mvuSchemaFormatSync.ts — (bug 156) ĐỐI CHIẾU SCHEMA ↔ HƯỚNG DẪN ĐỊNH DẠNG BIẾN sau khi dịch.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "thêm chức năng check xem sau khi dịch thì schema và phần hướng dẫn cập nhật định dạng
 * biến có trùng và đúng với nhau không".
 *
 * Một card MVU có HAI nơi cùng nói về một bộ biến:
 *   1. script zod  — `registerMvuSchema({ 'Thiên Tuyển Giả': z.object({ … }) })` : biến CÓ THẬT;
 *   2. entry [mvu_update] "Định Dạng Xuất Biến" — mục `valid_paths` liệt kê `/Thiên Tuyển Giả/…`
 *      để dạy AI được phép ghi vào đường nào.
 *
 * Dịch xong mà hai bên lệch nhau thì KHÔNG CÓ LỖI NÀO BÁO, nhưng hỏng cả hai chiều:
 *   • tên chỉ có ở hướng dẫn  → AI xuất JSONPatch trỏ vào đường không tồn tại, MVU bỏ lệnh,
 *     người chơi thấy chỉ số đứng im mà không hiểu vì sao;
 *   • tên chỉ có ở schema     → AI không hề biết biến đó tồn tại nên không bao giờ cập nhật,
 *     biến nằm chết ở giá trị khởi tạo suốt ván chơi.
 * Đây đúng loại hỏng âm thầm mà bộ dịch dễ gây ra nhất: hai file, hai lượt dịch, đổi tên một bên.
 */

/** Bỏ dấu tiếng Việt + gộp khoảng trắng + thường hoá — để so tên mà không bắt bẻ dấu/hoa thường. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Ghi chú kiểu bám sau tên trong hướng dẫn: `Tuổi Tác(number)`, `Cấp Độ(enum:D~S)`. */
const stripAnno = (s: string) => s.replace(/\([^)]*\)/g, '').trim();

/**
 * Tên biến GỐC (cấp cao nhất) khai trong script zod.
 * Bắt `'Tên': z.` và `"Tên": z.` — dạng registerMvuSchema dùng.
 */
export function extractZodRootNames(script: string): string[] {
  const src = String(script || '');
  // Gốc = object ngoài cùng của `z.object({ … })`. Phải đếm ĐỘ SÂU NGOẶC chứ không bắt mẫu
  // `'X': z.` — card thật khai trường con bằng helper (`safeString('')`) nên mẫu đó vô tình
  // chỉ khớp cấp gốc, nhưng chỉ cần một card viết `'Họ Tên': z.string()` là nó vơ luôn cấp con.
  // Gốc = ĐÚNG cái object được ĐĂNG KÝ, không phải `z.object` đầu tiên gặp trong file.
  // Card thật khai một loạt schema con trước (`const relicSchema = z.object({…})`) rồi mới tới
  // `const Schema = z.object({…})` và `registerMvuSchema(Schema)`. Neo vào cái đầu tiên là đi
  // lạc vào schema con và trả về toàn tên trường của một phần tử.
  let anchor = -1;
  const reg = /registerMvuSchema\s*\(\s*([A-Za-z_$][\w$]*|\{)/.exec(src);
  if (reg) {
    if (reg[1] === '{') {
      anchor = src.indexOf('{', reg.index);
    } else {
      const decl = new RegExp(`(?:const|let|var)\\s+${reg[1]}\\s*=\\s*z\\s*\\.\\s*object\\s*\\(\\s*\\{`).exec(src);
      if (decl) anchor = src.indexOf('{', decl.index + decl[0].length - 1);
    }
  }
  // Không tìm được đường đăng ký (script cắt khúc, dạng lạ) → lùi về `z.object({` CUỐI CÙNG:
  // schema thường ghép từ dưới lên nên cái ngoài cùng đứng sau các schema con.
  if (anchor < 0) {
    const all = [...src.matchAll(/z\s*\.\s*object\s*\(\s*\{/g)];
    if (!all.length) return [];
    anchor = src.indexOf('{', all[all.length - 1].index);
  }
  let i = anchor;
  if (i < 0) return [];

  const out = new Set<string>();
  let depth = 0;
  let inStr: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      // Chuỗi ở NGAY cấp 1 và theo sau là dấu hai chấm ⇒ tên biến gốc.
      const close = (() => {
        for (let j = i + 1; j < src.length; j++) {
          if (src[j] === '\\') { j++; continue; }
          if (src[j] === c) return j;
        }
        return -1;
      })();
      if (depth === 1 && close > i && /^\s*:/.test(src.slice(close + 1, close + 6))) {
        const n = src.slice(i + 1, close).trim();
        if (n) out.add(n);
      }
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return [...out];
}

/**
 * Đoạn đầu của mọi đường dẫn `/X/...` trong hướng dẫn định dạng.
 * Bỏ qua mẫu giữ chỗ (`${/path/to/variable}`) và các thẻ XML (`</Analysis>`).
 */
export function extractGuidePathRoots(guide: string): string[] {
  const out = new Set<string>();
  const text = String(guide || '')
    .replace(/\$\{[^}]*\}/g, '')       // ${/path/to/variable} là ví dụ, không phải biến thật
    .replace(/<\/?[A-Za-z][^>\n]*>/g, ''); // thẻ <Analysis> </JSONPatch> …
  for (const m of text.matchAll(/(?:^|[\s'"`([])\/([^/\n{}'"`,\]]{1,60})\//gm)) {
    const n = stripAnno(m[1]);
    if (n && !/^(path|to)$/i.test(n)) out.add(n);
  }
  return [...out];
}

export interface SchemaFormatSyncResult {
  ok: boolean;
  /** Có trong hướng dẫn mà schema KHÔNG khai — AI sẽ ghi vào đường không tồn tại. */
  onlyInGuide: string[];
  /** Schema có mà hướng dẫn KHÔNG nhắc — AI không biết nên không bao giờ cập nhật. */
  onlyInSchema: string[];
  matched: number;
  /** Không đủ dữ liệu để kết luận (thiếu hẳn script zod hoặc entry hướng dẫn). */
  skipped: boolean;
  summary: string;
}

/**
 * So tên biến gốc giữa hai bên. So theo dạng ĐÃ BỎ DẤU: bản dịch hay lệch nhau ở dấu hoặc
 * hoa/thường (`Túi Đồ` ↔ `Túi đồ`) — lệch kiểu đó MVU vẫn khớp nên báo lỗi là làm phiền;
 * còn lệch hẳn tên mới là thứ cần báo.
 */
export function checkSchemaVsUpdateFormat(
  zodScript: string,
  updateGuide: string,
): SchemaFormatSyncResult {
  const schemaNames = extractZodRootNames(zodScript);
  const guideNames = extractGuidePathRoots(updateGuide);

  if (schemaNames.length === 0 || guideNames.length === 0) {
    return {
      ok: true, onlyInGuide: [], onlyInSchema: [], matched: 0, skipped: true,
      summary: schemaNames.length === 0
        ? 'Không tìm thấy schema zod — bỏ qua phép đối chiếu.'
        : 'Không tìm thấy đường dẫn nào trong hướng dẫn định dạng — bỏ qua phép đối chiếu.',
    };
  }

  const sFold = new Map(schemaNames.map(n => [fold(n), n]));
  const gFold = new Map(guideNames.map(n => [fold(n), n]));

  const onlyInGuide = [...gFold].filter(([k]) => !sFold.has(k)).map(([, v]) => v);
  const onlyInSchema = [...sFold].filter(([k]) => !gFold.has(k)).map(([, v]) => v);
  const matched = schemaNames.length - onlyInSchema.length;

  const ok = onlyInGuide.length === 0 && onlyInSchema.length === 0;
  const parts: string[] = [];
  if (onlyInGuide.length) {
    parts.push(`${onlyInGuide.length} biến chỉ có trong hướng dẫn, schema không khai `
      + `(AI sẽ ghi vào đường không tồn tại): ${onlyInGuide.slice(0, 8).join(', ')}`);
  }
  if (onlyInSchema.length) {
    parts.push(`${onlyInSchema.length} biến chỉ có trong schema, hướng dẫn không nhắc `
      + `(AI không biết nên không bao giờ cập nhật): ${onlyInSchema.slice(0, 8).join(', ')}`);
  }

  return {
    ok,
    onlyInGuide,
    onlyInSchema,
    matched,
    skipped: false,
    summary: ok
      ? `Schema và hướng dẫn định dạng khớp nhau: ${matched}/${schemaNames.length} biến gốc.`
      : parts.join(' · '),
  };
}
