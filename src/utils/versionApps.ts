/**
 * src/utils/versionApps.ts — (bug 148-1) PHÂN LOẠI MỖI PHIÊN BẢN THUỘC APP NÀO.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "nâng cấp thêm có khả năng phân loại mỗi phiên bản là nó fix của app nào".
 *
 * Dữ liệu đã có sẵn ngay trong tiêu đề commit — repo dùng conventional commit với scope là
 * chính tên thư mục app: `fix(tao-card): …`, `feat(dich-card): …`, `feat(preset-tool): …`.
 * Nên việc phân loại là ĐỌC HIỂU DỮ LIỆU CÓ SẴN, không cần AI, không cần đánh nhãn tay.
 *
 * Commit không có scope (hoặc scope lạ) thì đoán theo TỪ KHOÁ trong tiêu đề — và nếu vẫn không
 * chắc thì trả 'chung' chứ KHÔNG gán bừa cho một app: gán sai còn tệ hơn không gán, vì người
 * dùng lọc theo app sẽ tưởng bản đó không liên quan tới mình rồi bỏ qua.
 */

export type AppId =
  | 'dich-card' | 'dich-script' | 'dich-preset' | 'tao-card' | 'tao-preset'
  | 'mod-card' | 'crawler' | 'trich-card' | 'hub' | 'chung';

export interface AppTag {
  id: AppId;
  label: string;
  emoji: string;
}

export const APP_TAGS: Record<AppId, AppTag> = {
  'dich-card':   { id: 'dich-card',   label: 'Dịch Card',    emoji: '🌐' },
  'dich-script': { id: 'dich-script', label: 'Dịch Script',  emoji: '📜' },
  'dich-preset': { id: 'dich-preset', label: 'Dịch Preset',  emoji: '🈶' },
  'tao-card':    { id: 'tao-card',    label: 'Tạo Card',     emoji: '🃏' },
  'tao-preset':  { id: 'tao-preset',  label: 'Tạo Preset',   emoji: '🎛️' },
  'mod-card':    { id: 'mod-card',    label: 'Mod Card',     emoji: '🛠️' },
  'crawler':     { id: 'crawler',     label: 'Web Crawler',  emoji: '🧭' },
  'trich-card':  { id: 'trich-card',  label: 'Trích Card',   emoji: '🔍' },
  'hub':         { id: 'hub',         label: 'Hub / chung',  emoji: '🏠' },
  'chung':       { id: 'chung',       label: 'Khác',         emoji: '📦' },
};

/** scope trong `type(scope): subject` → AppId. */
const SCOPE_MAP: Record<string, AppId> = {
  'dich-card': 'dich-card', 'translate': 'dich-card', 'app': 'dich-card',
  'script-translate': 'dich-script', 'dich-script': 'dich-script',
  'preset-translate': 'dich-preset', 'dich-preset': 'dich-preset',
  'tao-card': 'tao-card', 'card-creator': 'tao-card',
  'preset-tool': 'tao-preset', 'tao-preset': 'tao-preset',
  'mod-card': 'mod-card', 'modcard': 'mod-card',
  'crawler': 'crawler', 'web-crawler': 'crawler',
  'novalcard': 'trich-card', 'trich-card': 'trich-card',
  'hub': 'hub', 'core': 'hub', 'repo': 'hub', 'deps': 'hub',
};

/** Từ khoá dự phòng khi commit KHÔNG có scope — chỉ dùng khi thật rõ ràng. */
const KEYWORD_HINTS: Array<[RegExp, AppId]> = [
  // Bộ front-end kit (STFE, khung chat nhúng) sống trong Tạo Card — các commit 192/201/206/209/212
  // toàn tả bằng mấy chữ này mà không nêu tên app.
  [/\b(front[- ]?end|frontend|khung chat|stfe|tra wiki|tạo card)\b/i, 'tao-card'],
  [/\b(auto ?creator|lorebook|mvuzod|ejs studio|opening form|status bar|tao[- ]card)\b/i, 'tao-card'],
  // Chuyện dịch sót/dịch lại/chunk là đặc sản của Dịch Card (bug 193/203/207/211…).
  [/\b(dịch lại|dich lai|tiếng trung|tieng trung|chữ hán|chu han|chunk)\b/i, 'dich-card'],
  [/\b(dich script|script translate)\b/i, 'dich-script'],
  [/\b(dich preset|preset translate)\b/i, 'dich-preset'],
  [/\b(preset[- ]tool|tao preset)\b/i, 'tao-preset'],
  [/\b(mod ?card)\b/i, 'mod-card'],
  [/\b(crawler|cào wiki|wiki import)\b/i, 'crawler'],
  [/\b(novalcard|trich card|trích card)\b/i, 'trich-card'],
  [/\b(dich card|dịch card|translation|regex manager)\b/i, 'dich-card'],
  // (bug 214) "bản dịch" / "hỏng thẻ" / "vào thẻ" là đặc sản của Dịch Card — chỉ app này mới sinh
  // ra bản dịch và ghi ngược vào thẻ. Thêm vì loạt commit bug 213 tả việc bằng đúng mấy chữ này
  // mà không nêu tên app, nên rơi hết vào "Khác".
  [/(bản dịch|ban dich|hỏng thẻ|hong the|vào thẻ|vao the|dịch thẻ|dich the)/i, 'dich-card'],
  [/\b(hub|header|rail|phiên bản|version)\b/i, 'hub'],
];

/**
 * Một commit có thể đụng NHIỀU app (`feat(hub+tao-card): …`) — trả về TẤT CẢ, không ép về một.
 * Luôn trả ít nhất một phần tử.
 */
/** Bỏ dấu tiếng Việt + hạ chữ thường — để so nhãn app không phụ thuộc cách gõ có/không dấu. */
const foldVi = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/**
 * (bug 214) Nhãn app viết trong NGOẶC — quy ước mới của repo từ khoảng bug 204 trở đi:
 *   `Bug 205 (Dich Card): …`, `Bug 212 (Tạo Card · Front-End): …`
 * Trước đây chỉ có nhánh `type(scope):` kiểu conventional-commit nên cả loạt commit theo quy ước
 * mới rơi hết vào "Khác" trong tab Giới thiệu — user đọc changelog không biết bản đó sửa app nào.
 */
const LABEL_MAP: Record<string, AppId> = {
  'dich card': 'dich-card', 'dich script': 'dich-script', 'dich preset': 'dich-preset',
  'tao card': 'tao-card', 'tao preset': 'tao-preset', 'mod card': 'mod-card',
  'web crawler': 'crawler', 'crawler': 'crawler', 'trich card': 'trich-card',
  'hub': 'hub',
};

function appsFromParenLabel(s: string): AppId[] {
  // Lấy cụm trong ngoặc đầu tiên đứng TRƯỚC dấu hai chấm — `Bug 212 (Tạo Card · Front-End):`
  const m = /^[^:]*?\(([^)]+)\)\s*:/.exec(s.trim());
  if (!m) return [];
  const ids = m[1]
    .split(/[+,/&·|]/)                       // "Tạo Card · Front-End", "Hub + Tạo Card"
    .map(part => LABEL_MAP[foldVi(part)])
    .filter((x): x is AppId => !!x);
  return [...new Set(ids)];
}

export function classifyCommitApps(subject: string): AppId[] {
  const s = String(subject ?? '');
  const scopeMatch = /^[a-z]+\(([^)]+)\)!?:/i.exec(s.trim());
  if (scopeMatch) {
    const ids = scopeMatch[1]
      .split(/[+,/&]/)
      .map(x => SCOPE_MAP[x.trim().toLowerCase()])
      .filter((x): x is AppId => !!x);
    if (ids.length) return [...new Set(ids)];
  }
  const byLabel = appsFromParenLabel(s);
  if (byLabel.length) return byLabel;

  for (const [re, id] of KEYWORD_HINTS) {
    if (re.test(s)) return [id];
  }
  return ['chung'];
}

export interface VersionRowLike { subject: string }

/** Đếm số bản theo app — dựng bộ lọc mà không phải quét lại danh sách nhiều lần. */
export function countByApp<T extends VersionRowLike>(rows: T[]): Map<AppId, number> {
  const m = new Map<AppId, number>();
  for (const r of rows) {
    for (const id of classifyCommitApps(r.subject)) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

/** Lọc theo app đang chọn; `null` = tất cả. */
export function filterByApp<T extends VersionRowLike>(rows: T[], app: AppId | null): T[] {
  if (!app) return rows;
  return rows.filter(r => classifyCommitApps(r.subject).includes(app));
}

/** Bỏ tiền tố `type(scope):` cho gọn khi hiển thị — nhãn app đã nói scope rồi. */
export function stripConventionalPrefix(subject: string): string {
  return String(subject ?? '').replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '');
}
