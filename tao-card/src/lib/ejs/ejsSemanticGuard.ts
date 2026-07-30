/**
 * src/lib/ejs/ejsSemanticGuard.ts — (bugNeedFix/168 mục 4) CHỐT CHẶN NGỮ NGHĨA cho code EJS.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bộ kiểm cũ (stptApi.validateWorldbookEjs + ejsParser.validateEJSEntry) chỉ soi CÚ PHÁP và
 * API: code parse được không, có gọi hàm bịa không, biến có trong schema không. Nó không hề
 * biết code chạy ra kết quả ĐÚNG hay SAI. Bản đánh giá chất lượng card Eldran v3 chỉ ra đúng
 * hai lỗi loại đó — code hợp lệ hoàn hảo, nhưng vận hành sai ngay từ lượt chơi đầu tiên:
 *
 * ① SO KHỚP BẰNG KÝ TỰ ĐƠN LẺ (entry 43 của card thật)
 *      var rank = getvar('stat_data.Thông Tin Shard.Cảnh Giới', { defaults: '' }).toLowerCase();
 *      if (rank.includes('f') || rank.includes('e') || ...)       → nhánh "Tân thủ"
 *      else if (rank.includes('s') || rank.includes('a') || ...)  → nhánh "Cao thủ"
 *    Giá trị khởi tạo thật là "Chưa bề" → hạ thường thành "chưa bề" → CHỨA chữ 'a' (trong
 *    "Chưa") → nhánh thứ hai trúng ngay. Nhân vật mới tinh bị xếp thành "Cao thủ", AI được
 *    chỉ dẫn quăng kỳ ngộ hiểm nghèo và quái A-S vào mặt người chơi từ lượt đầu.
 *    Đây là bản chất của cách viết: dùng một chữ cái đại diện cho hạng (A/E/S/F) thì bất kỳ
 *    từ tiếng Việt nào tình cờ chứa chữ đó cũng khớp.
 *
 * ② DEFAULT LỆCH VỚI GIÁ TRỊ THẬT TRONG [initvar] (entry 41 của card thật)
 *      var phaHe = getvar('stat_data.Thông Tin Shard.Phả Hệ', { defaults: 'Chưa rõ' });
 *      if (phaHe !== 'Chưa rõ') { await activewi('Meta Setup User & Quản Trò', true); }
 *    Giá trị thật trong [initvar] là "Chưa thức tỉnh". Vì "Chưa thức tỉnh" !== "Chưa rõ" LUÔN
 *    đúng, entry bị bật sai ngay từ đầu game. Đáng nói: cùng card đó, entry 42 lại viết đúng
 *    `defaults: 'Chưa thức tỉnh'` — tức công cụ không nhất quán với chính nó.
 *
 * Cả hai đều KHÔNG THỂ bắt bằng cách soi cú pháp. Chỉ bắt được khi đối chiếu code với DỮ LIỆU
 * THẬT của thẻ: giá trị khởi tạo trong [initvar] và miền giá trị (enum) trong schema. File này
 * làm đúng việc đó, và cố ý đứng TÁCH khỏi bộ kiểm cú pháp để hai tầng không lẫn vào nhau.
 */
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { parseInitVar } from '../mvuzod/simulateCard';
import { ejsToLintableJs } from './stptApi';

export type SemanticIssueKind =
  | 'default-mismatch'    // defaults trong code ≠ giá trị thật trong [initvar]
  | 'default-type'        // defaults là chuỗi trong khi biến là số/bool
  | 'fragile-match'       // so khớp bằng ký tự đơn lẻ / mảnh quá ngắn
  | 'enum-not-matched'    // so sánh với giá trị không có trong enum của schema
  | 'duplicate-read';     // nhiều entry cùng đọc một biến (gợi ý gộp)

export interface SemanticIssue {
  kind: SemanticIssueKind;
  /** 'error' = chắc chắn chạy sai; 'warning' = nên sửa nhưng chưa chắc sai. */
  level: 'error' | 'warning';
  /** Tên entry chứa lỗi (nếu biết). */
  entry?: string;
  /** Đường dẫn biến liên quan. */
  path?: string;
  message: string;
  /** Câu sửa cụ thể để đưa thẳng cho AI ở vòng tự vá. */
  fix: string;
}

// ── Đọc dữ liệu thật của thẻ ────────────────────────────────────────────────

/** Làm phẳng cây initvar thành bảng 'đường.dẫn.chấm' → giá trị. */
export function flattenInitVar(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenInitVar(v, p));
    } else {
      out[p] = v;
    }
  }
  return out;
}

/**
 * Bảng "giá trị khởi tạo THẬT" của thẻ, khoá theo đường dẫn getvar dùng
 * (tức có tiền tố `stat_data.`). Lấy từ entry [initvar] — nguồn sự thật duy nhất.
 */
export function readInitVarTruth(entries: Array<{ comment?: string; content?: string }>): Record<string, unknown> {
  const iv = entries.find(e => /\[initvar\]/i.test(String(e.comment ?? '')));
  if (!iv?.content) return {};
  let tree: Record<string, unknown> = {};
  try { tree = parseInitVar(String(iv.content)); } catch { return {}; }
  const flat = flattenInitVar(tree);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) out[`stat_data.${k}`] = v;
  return out;
}

/**
 * Đường dẫn getvar của một field.
 *
 * Schema có HAI cách khai lồng nhau, phải chịu được cả hai: `path` dạng phẳng mang nguyên
 * đường ("/Chỉ Số/Máu"), và `children` dạng cây (cha "/Chỉ Số" + con "/Máu"). Bản đầu chỉ lấy
 * đoạn cuối của path nên "/Chỉ Số/Máu" ra "stat_data.Máu" — không khớp lời gọi thật
 * `getvar('stat_data.Chỉ Số.Máu')`, khiến mọi phép đối chiếu enum/kiểu trượt hết.
 */
function getvarPathOf(field: MVUZODField, prefix: string): string {
  const segs = String(field.path ?? '').split('/').filter(Boolean);
  const own = segs.join('.');
  return prefix ? `${prefix}.${own}` : own;
}

function walkFields(
  fields: MVUZODField[],
  prefix: string,
  visit: (leaf: MVUZODField, path: string) => void,
): void {
  for (const f of fields) {
    const p = getvarPathOf(f, prefix);
    const kids = (f.children ?? []).filter(c => !String(c.path ?? '').includes('/_child/'));
    if (kids.length) { walkFields(kids, p, visit); continue; }
    visit(f, p);
  }
}

/** Bảng enum khai trong schema, khoá theo đường dẫn getvar. */
export function readEnumMap(schema: MVUZODSchema | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  walkFields(schema?.fields ?? [], '', (f, p) => {
    const ev = f.constraints?.enumValues;
    if (Array.isArray(ev) && ev.length) out[`stat_data.${p}`] = ev.map(String);
  });
  return out;
}

/** Kiểu số/bool khai trong schema, khoá theo đường dẫn getvar. */
export function readTypeMap(schema: MVUZODSchema | null): Record<string, string> {
  const out: Record<string, string> = {};
  walkFields(schema?.fields ?? [], '', (f, p) => { out[`stat_data.${p}`] = String(f.type); });
  return out;
}

// ── Bóc lời gọi getvar kèm default (giữ nguyên KIỂU chữ của literal) ─────────

export interface GetvarCallInfo {
  path: string;
  /** Chuỗi literal của default y như trong code, hoặc null nếu không khai. */
  rawDefault: string | null;
  /** default có được viết dưới dạng chuỗi (có nháy) không. */
  isStringLiteral: boolean;
}

const GETVAR_RE = /getvar\(\s*(['"])([^'"]+)\1\s*(?:,\s*\{[^}]*?defaults\s*:\s*([^,}]+?)\s*[,}])?/g;

export function extractGetvarCalls(code: string): GetvarCallInfo[] {
  const out: GetvarCallInfo[] = [];
  for (const m of String(code).matchAll(GETVAR_RE)) {
    const raw = (m[3] ?? '').trim();
    const isStr = /^['"]/.test(raw);
    out.push({
      path: m[2],
      rawDefault: raw === '' ? null : raw,
      isStringLiteral: isStr,
    });
  }
  return out;
}

/** Bỏ nháy quanh literal chuỗi. */
function unquote(s: string): string {
  const t = s.trim();
  return /^(['"])([\s\S]*)\1$/.test(t) ? t.slice(1, -1) : t;
}

// ── Bắt so khớp mong manh ───────────────────────────────────────────────────

/**
 * Từ được phép so khớp ngắn — những cụm THỰC SỰ là một từ có nghĩa. Ngoài danh sách này,
 * mảnh dưới 3 ký tự dùng cho .includes() đều bị coi là mong manh.
 */
const SHORT_OK = new Set(['nam', 'nữ', 'có', 'hết', 'chết', 'yes', 'no', 'on', 'off']);

/** Lời gọi .includes('x') với x quá ngắn — nguồn của lỗi "chưa bề" khớp 'a'. */
export function findFragileMatches(code: string): Array<{ frag: string; line: number }> {
  const out: Array<{ frag: string; line: number }> = [];
  const lines = String(code).split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/\.\s*(?:includes|startsWith|endsWith|indexOf|search)\s*\(\s*(['"])([^'"]*)\1/g)) {
      const frag = m[2];
      // Mảnh 1-2 ký tự (bỏ dấu cách) và không nằm trong danh sách từ ngắn hợp lệ.
      const bare = frag.trim();
      if (bare.length > 0 && bare.length <= 2 && !SHORT_OK.has(bare.toLowerCase())) {
        out.push({ frag: bare, line: i + 1 });
      }
    }
  }
  return out;
}

// ── Bộ kiểm chính ───────────────────────────────────────────────────────────

export interface SemanticCheckInput {
  /** Các khối EJS cần soi: tên entry + code. */
  blocks: Array<{ name: string; code: string }>;
  /** Toàn bộ entry của thẻ — để đọc [initvar]. */
  entries: Array<{ comment?: string; content?: string }>;
  schema: MVUZODSchema | null;
}

/**
 * Soi NGỮ NGHĨA code EJS so với dữ liệu thật của thẻ.
 * Chỉ báo những thứ ĐO ĐƯỢC — không đoán ý đồ người viết.
 */
export function checkEjsSemantics(input: SemanticCheckInput): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const truth = readInitVarTruth(input.entries);
  const enums = readEnumMap(input.schema);
  const types = readTypeMap(input.schema);
  const hasTruth = Object.keys(truth).length > 0;

  /** Đếm số entry đọc mỗi biến — để gợi ý gộp (mục 4 của bản đánh giá). */
  const readers = new Map<string, Set<string>>();

  for (const b of input.blocks) {
    // Chỉ soi phần JS trong scriptlet, bỏ phần văn bản thuần.
    const js = ejsToLintableJs(b.code).js;

    // ① SO KHỚP MONG MANH
    for (const f of findFragileMatches(js)) {
      issues.push({
        kind: 'fragile-match',
        level: 'error',
        entry: b.name,
        message:
          `Dòng ~${f.line} so khớp bằng mảnh "${f.frag}" chỉ ${f.frag.length} ký tự. `
          + `Bất kỳ giá trị nào tình cờ chứa ký tự đó cũng khớp — ví dụ có thật: "Chưa bề" chứa chữ "a" `
          + `nên bị xếp nhầm vào hạng A ngay từ lượt đầu.`,
        fix:
          `Thay .includes("${f.frag}") bằng SO SÁNH ĐÚNG cả giá trị: dùng === với đúng chuỗi trong `
          + `enum của schema, hoặc includes("<cụm từ đầy đủ>"). Tuyệt đối không dùng một hai ký tự để đại diện cho hạng/cấp.`,
      });
    }

    for (const g of extractGetvarCalls(b.code)) {
      if (!readers.has(g.path)) readers.set(g.path, new Set());
      readers.get(g.path)!.add(b.name);

      if (g.rawDefault === null) continue;
      const declaredType = types[g.path];

      // ② DEFAULT LỆCH VỚI [initvar] THẬT
      if (hasTruth && Object.prototype.hasOwnProperty.call(truth, g.path)) {
        const real = truth[g.path];
        const realStr = typeof real === 'string' ? real : String(real);
        const codeVal = g.isStringLiteral ? unquote(g.rawDefault) : g.rawDefault;
        // Chỉ so khi cả hai đều là giá trị nguyên thuỷ đọc được. Default rỗng ('' hoặc 0) là
        // cách viết "không quan tâm", chấp nhận được — không bắt bẻ.
        const codeIsBlank = codeVal === '' || codeVal === '0' || codeVal === 'null' || codeVal === 'undefined';
        if (!codeIsBlank && typeof real !== 'object' && codeVal !== realStr) {
          issues.push({
            kind: 'default-mismatch',
            level: 'error',
            entry: b.name,
            path: g.path,
            message:
              `defaults ghi ${g.rawDefault} nhưng giá trị khởi tạo THẬT trong [initvar] là "${realStr}". `
              + `Mọi phép so sánh với default này sẽ cho kết quả sai ngay từ lượt chơi đầu tiên `
              + `(ví dụ \`x !== ${g.rawDefault}\` luôn đúng vì x thật là "${realStr}").`,
            fix: `Đổi defaults thành ${typeof real === 'string' ? `'${realStr}'` : realStr} cho khớp [initvar].`,
          });
        }
      }

      // ③ DEFAULT SAI KIỂU (bug 162 chốt "cấm default chuỗi cho biến số")
      if ((declaredType === 'number' || declaredType === 'boolean') && g.isStringLiteral) {
        const v = unquote(g.rawDefault);
        issues.push({
          kind: 'default-type',
          level: 'warning',
          entry: b.name,
          path: g.path,
          message:
            `Biến khai kiểu ${declaredType} nhưng defaults viết dạng chuỗi ${g.rawDefault}. `
            + `Chạy vẫn ra kết quả đúng nếu có Number() bọc ngoài, nhưng lệch quy ước và dễ sinh so sánh "10" > "9" = false.`,
          fix: `Bỏ nháy: defaults: ${declaredType === 'boolean' ? (v === 'true' ? 'true' : 'false') : (Number(v) || 0)}.`,
        });
      }

      // ④ SO SÁNH VỚI GIÁ TRỊ NGOÀI ENUM
      const ev = enums[g.path];
      if (ev && g.isStringLiteral) {
        const v = unquote(g.rawDefault);
        if (v !== '' && !ev.includes(v)) {
          issues.push({
            kind: 'enum-not-matched',
            level: 'warning',
            entry: b.name,
            path: g.path,
            message:
              `defaults "${v}" không nằm trong miền giá trị đã khai của biến (${ev.join(' / ')}).`,
            fix: `Dùng một trong các giá trị hợp lệ, hoặc để defaults: '' nếu cố ý không đặt.`,
          });
        }
      }
    }
  }

  // ⑤ NHIỀU ENTRY CÙNG ĐỌC MỘT BIẾN — gợi ý gộp (mục 4 bản đánh giá: 3 entry cùng đọc Máu)
  for (const [path, names] of readers) {
    if (names.size >= 3) {
      issues.push({
        kind: 'duplicate-read',
        level: 'warning',
        path,
        message:
          `${names.size} entry cùng đọc lại biến này mỗi lượt (${[...names].join(', ')}). `
          + `Chức năng có thể khác nhau, nhưng chạy ba bộ điều khiển đọc trùng một biến là phí.`,
        fix: `Gộp thành MỘT entry dùng if / else if phân theo ngưỡng, đọc biến đúng một lần.`,
      });
    }
  }

  return issues;
}

/** Câu tóm tắt cho log/UI. */
export function summarizeSemantics(issues: SemanticIssue[]): string {
  if (issues.length === 0) return 'Kiểm ngữ nghĩa: code EJS khớp đúng dữ liệu thật của thẻ.';
  const err = issues.filter(i => i.level === 'error').length;
  const warn = issues.length - err;
  return `Kiểm ngữ nghĩa: ${err} lỗi chắc chắn sai${warn ? `, ${warn} cảnh báo` : ''}.`;
}
