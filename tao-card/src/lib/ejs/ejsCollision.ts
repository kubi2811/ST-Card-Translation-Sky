/**
 * src/lib/ejs/ejsCollision.ts — (bug 126) EJS KHÔNG ĐƯỢC ĐỤNG NHAU.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "EJS thì không được đồng nhau, giống với MVU thì không được đồng biến vì sẽ xung đột
 * với nhau và bị lỗi → nâng cấp cho AI khi tạo EJS không được đồng nhau + khi tạo xong nếu vẫn
 * còn lỗi thì tự check lại tìm ra lỗi và tự vá lại".
 *
 * Vì sao đây là lỗi thật chứ không phải chuyện thẩm mỹ: mọi entry @@preprocessing của
 * ST-Prompt-template chạy trong CÙNG MỘT context. Bản cũ (và AI) đều khai biến bằng mẫu
 *     if (typeof _x === 'undefined') var _x = getvar('...');
 * Hai entry cùng đặt tên `_x` mà lấy từ hai đường dẫn khác nhau thì entry chạy sau KHÔNG ghi
 * đè — mệnh đề `typeof === 'undefined'` làm nó im lặng dùng giá trị của entry chạy trước.
 * Kết quả: điều kiện đúng cú pháp, chạy không báo lỗi, nhưng bật nhầm entry. Loại hỏng khó
 * chẩn đoán nhất, và nó chỉ lộ ra khi chơi.
 *
 * Bản cũ chỉ bắt trùng TÊN ENTRY. File này bắt thêm:
 *   1. trùng tên biến mà khác nguồn getvar  (ca im lặng ở trên);
 *   2. hai khối cùng setvar một đường dẫn    (ghi đè lẫn nhau);
 *   3. trùng tên entry, kể cả với entry ĐÃ CÓ SẴN trong card (bản cũ chỉ so giữa các bước mới).
 * Và vá được thì vá tất định — đổi tên biến theo đường dẫn nguồn, khỏi tốn call AI.
 */

export interface EjsBlock {
  /** Tên entry (comment) hoặc nhãn nhận dạng khối. */
  name: string;
  code: string;
}

export interface VarDecl {
  varName: string;
  /** Đường dẫn getvar mà biến này lấy, '' nếu không đọc getvar. */
  source: string;
}

export interface CollisionIssue {
  code: 'ejs-var-conflict' | 'ejs-setvar-conflict' | 'ejs-name-conflict';
  message: string;
  where: string;
  /** Máy sửa được không (quyết định có cần gọi AI hay không). */
  autofixable: boolean;
}

/** Bóc các khai báo `var _x = getvar('path')` trong một khối EJS. */
export function extractVarDecls(code: string): VarDecl[] {
  const out: VarDecl[] = [];
  const re = /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(code || ''))) !== null) {
    const varName = m[1];
    const rhs = m[2];
    const g = rhs.match(/getvar\s*\(\s*['"`]([^'"`]+)['"`]/);
    out.push({ varName, source: g ? g[1] : '' });
  }
  return out;
}

/** Bóc các đường dẫn bị GHI bằng setvar. */
export function extractSetvarPaths(code: string): string[] {
  const out: string[] = [];
  const re = /\bsetvar\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(code || ''))) !== null) out.push(m[1]);
  return out;
}

/** Tên biến an toàn suy từ đường dẫn getvar — tất định, hai đường dẫn khác nhau ra hai tên. */
export function varNameFromPath(path: string): string {
  const tail = String(path || '').replace(/^stat_data\./, '');
  const safe = tail
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return '_' + (safe || 'var');
}

/**
 * Soát xung đột trên TOÀN BỘ khối EJS sẽ cùng tồn tại trong card
 * (khối mới sinh + khối đã có sẵn). Trả về danh sách vấn đề.
 */
export function findCollisions(blocks: EjsBlock[]): CollisionIssue[] {
  const issues: CollisionIssue[] = [];

  // 1. Trùng tên entry.
  const nameCount = new Map<string, number>();
  for (const b of blocks) {
    const k = b.name.trim().toLowerCase();
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  for (const [k, n] of nameCount) {
    if (n > 1) {
      issues.push({
        code: 'ejs-name-conflict',
        message: `Có ${n} khối EJS cùng tên "${k}" — khi lưu sẽ đè nhau và getwi() gọi theo tên sẽ trỏ nhầm.`,
        where: k,
        autofixable: true,
      });
    }
  }

  // 2. Trùng tên biến nhưng khác nguồn getvar — ca hỏng IM LẶNG.
  const varSources = new Map<string, Map<string, string[]>>(); // varName → source → [entry]
  for (const b of blocks) {
    for (const d of extractVarDecls(b.code)) {
      if (!d.source) continue;   // không đọc getvar thì không phải biến chia sẻ
      if (!varSources.has(d.varName)) varSources.set(d.varName, new Map());
      const inner = varSources.get(d.varName)!;
      inner.set(d.source, [...(inner.get(d.source) ?? []), b.name]);
    }
  }
  for (const [varName, sources] of varSources) {
    if (sources.size <= 1) continue;
    const detail = [...sources.entries()]
      .map(([src, owners]) => `"${src}" (${owners.join(', ')})`)
      .join(' vs ');
    issues.push({
      code: 'ejs-var-conflict',
      message:
        `Biến ${varName} được khai từ ${sources.size} nguồn khác nhau: ${detail}. ` +
        `Mọi khối @@preprocessing chạy chung một context, mà mẫu "if (typeof … === 'undefined')" ` +
        `khiến khối chạy sau im lặng dùng giá trị của khối chạy trước — điều kiện sẽ sai mà không báo lỗi.`,
      where: varName,
      autofixable: true,
    });
  }

  // 3. Hai khối cùng setvar một đường dẫn — ghi đè lẫn nhau.
  const setOwners = new Map<string, string[]>();
  for (const b of blocks) {
    for (const p of extractSetvarPaths(b.code)) {
      setOwners.set(p, [...(setOwners.get(p) ?? []), b.name]);
    }
  }
  for (const [path, owners] of setOwners) {
    const uniq = [...new Set(owners)];
    if (uniq.length > 1) {
      issues.push({
        code: 'ejs-setvar-conflict',
        message: `Đường dẫn biến "${path}" bị GHI bởi ${uniq.length} khối (${uniq.join(', ')}) — khối chạy sau đè khối chạy trước, giá trị cuối cùng phụ thuộc thứ tự entry.`,
        where: path,
        autofixable: false,   // máy không biết khối nào mới là chủ — phải để AI/user quyết
      });
    }
  }

  return issues;
}

export interface PatchResult {
  blocks: EjsBlock[];
  /** Mô tả từng việc đã vá — hiện cho user để họ biết máy đã đụng vào gì. */
  fixed: string[];
}

/**
 * Tự vá phần máy chắc tay: đổi tên biến trùng-khác-nguồn thành tên suy từ chính đường dẫn,
 * và đổi tên entry trùng. Không đụng tới setvar-conflict (máy không đủ căn cứ để chọn chủ).
 */
export function autopatchCollisions(blocks: EjsBlock[]): PatchResult {
  const fixed: string[] = [];
  let out = blocks.map(b => ({ ...b }));

  // ── Biến trùng tên khác nguồn ──
  const varSources = new Map<string, Set<string>>();
  for (const b of out) {
    for (const d of extractVarDecls(b.code)) {
      if (!d.source) continue;
      if (!varSources.has(d.varName)) varSources.set(d.varName, new Set());
      varSources.get(d.varName)!.add(d.source);
    }
  }

  for (const [varName, sources] of varSources) {
    if (sources.size <= 1) continue;
    // Giữ nguyên nguồn đầu tiên (theo thứ tự khối) để hạn chế thay đổi; đổi tên các nguồn còn lại.
    const ordered = [...sources];
    for (const src of ordered.slice(1)) {
      const fresh = uniqueVarName(varNameFromPath(src), varSources, varName);
      for (const b of out) {
        const decls = extractVarDecls(b.code);
        const owns = decls.some(d => d.varName === varName && d.source === src);
        if (!owns) continue;
        // Thay đúng danh giới từ để không ăn vào _x_khac.
        b.code = b.code.replace(new RegExp(`(?<![\\w$])${escapeRe(varName)}(?![\\w$])`, 'g'), fresh);
        fixed.push(`đổi biến ${varName} → ${fresh} trong "${b.name}" (nguồn ${src}) để hai khối không dùng chung tên cho hai biến khác nhau`);
      }
      varSources.set(fresh, new Set([src]));
    }
  }

  // ── Trùng tên entry ──
  const used = new Set<string>();
  out = out.map(b => {
    let name = b.name;
    let k = 2;
    while (used.has(name.trim().toLowerCase())) name = `${b.name} (${k++})`;
    used.add(name.trim().toLowerCase());
    if (name !== b.name) fixed.push(`đổi tên khối trùng "${b.name}" → "${name}"`);
    return name === b.name ? b : { ...b, name };
  });

  return { blocks: out, fixed };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueVarName(base: string, taken: Map<string, Set<string>>, avoid: string): string {
  let name = base;
  let i = 2;
  while (name === avoid || taken.has(name)) name = `${base}_${i++}`;
  return name;
}
