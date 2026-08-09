/**
 * src/utils/skillStore.ts — (bug 218) KHO KỸ NĂNG CHO TRỢ LÝ AI.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "tham khảo repo yeachan-heo/oh-my-claudecode và làm hệ thống System Prompt Core, cũng
 * như làm một nơi để người dùng có thể tải và dùng các repo skill cho agent."
 *
 * Học đúng cái đáng học từ repo đó, bỏ cái không hợp:
 *
 *   GIỮ — kỹ năng là MỘT FILE MARKDOWN có frontmatter YAML:
 *       ---
 *       name: Sửa lỗi biến MVU
 *       description: Biến MVU báo 变量更新失败 khi nhập Opening Form
 *       triggers: ["mvu", "biến", "变量更新失败"]
 *       ---
 *       Kiểm [initvar] trước, đối chiếu tên biến với stat_data…
 *     Định dạng này người thường đọc và sửa được bằng Notepad, chép qua lại giữa các máy được,
 *     và quan trọng nhất: nó là VĂN BẢN, nên nhét thẳng vào prompt không cần dịch qua gì cả.
 *
 *   GIỮ — TỰ CHÈN THEO TỪ KHOÁ: chỉ kỹ năng nào khớp câu người dùng vừa gõ mới vào prompt. Nạp
 *     cả kho vào mỗi lượt vừa đốt token vừa làm loãng chỉ thị.
 *
 *   BỎ — hai tầng "project/user scope" theo thư mục `.omc/skills`. Ở đây là ứng dụng chạy trong
 *     trình duyệt, không có hệ thống tệp; tầng lưu là IndexedDB, và phạm vi có nghĩa hơn với
 *     người dùng là "gắn với thẻ này" hay "dùng chung", giống hệt cách kho ký ức đang chia.
 */
import Dexie, { type Table } from 'dexie';

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  /** Từ khoá kích hoạt — thường hoá sẵn lúc lưu để lúc khớp khỏi phải xử lý lại. */
  triggers: string[];
  /** Thân kỹ năng (markdown) — phần thật sự đi vào prompt. */
  body: string;
  /** Gói/nguồn đã nạp: tên repo, tên file, hay "dán tay". */
  pack: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /** '' = dùng cho mọi thẻ. */
  cardKey?: string;
}

class SkillDB extends Dexie {
  skills!: Table<SkillRecord, string>;
  constructor(name = 'st_assistant_skills') {
    super(name);
    this.version(1).stores({ skills: 'id, pack, enabled, updatedAt, cardKey' });
  }
}

let _db: SkillDB | null = null;
export function skillDb(): SkillDB {
  if (!_db) _db = new SkillDB();
  return _db;
}
/** Chỉ dùng trong test — mỗi ca một DB sạch. */
export function _resetSkillDbForTest(name = `st_skills_test_${Math.random().toString(36).slice(2)}`): SkillDB {
  _db = new SkillDB(name);
  return _db;
}

export function newSkillId(): string {
  return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ═══════════════ ĐỌC FRONTMATTER ═══════════════ */

export interface ParsedSkill {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}

/**
 * Đọc một file kỹ năng.
 *
 * CỐ Ý KHÔNG kéo cả thư viện YAML về: frontmatter kỹ năng chỉ có ba khoá, mà thêm một phụ thuộc
 * mới vào bundle chỉ để đọc ba dòng là không đáng. Bù lại phải chịu khó nhận nhiều cách viết mà
 * người dùng hay gõ, vì file này người thường viết tay:
 *   • `triggers: ["a", "b"]`  — mảng kiểu JSON
 *   • `triggers: a, b`        — liệt kê bằng dấu phẩy
 *   • `triggers:` rồi xuống dòng `  - a` — kiểu YAML gạch đầu dòng
 *
 * Thiếu frontmatter thì KHÔNG vứt file đi: lấy dòng tiêu đề `# ...` làm tên, cả file làm thân.
 * Người ta chép một ghi chú markdown vào cũng phải dùng được.
 */
export function parseSkillMarkdown(raw: string, fallbackName = 'Kỹ năng chưa đặt tên'): ParsedSkill {
  const text = (raw || '').replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    const h1 = text.match(/^#\s+(.+)$/m);
    return {
      name: (h1?.[1] || fallbackName).trim(),
      description: '',
      triggers: [],
      body: text.trim(),
    };
  }
  const [, fmRaw, body] = m;
  const lines = fmRaw.split('\n');
  const get = (key: string): string => {
    const line = lines.find((l) => new RegExp(`^${key}\\s*:`, 'i').test(l.trim()));
    if (!line) return '';
    return line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '');
  };

  let triggers: string[] = [];
  const trigInline = get('triggers');
  if (trigInline.startsWith('[')) {
    try { triggers = JSON.parse(trigInline.replace(/'/g, '"')); } catch { triggers = []; }
  } else if (trigInline) {
    triggers = trigInline.split(',');
  } else {
    // kiểu gạch đầu dòng
    const i = lines.findIndex((l) => /^triggers\s*:/i.test(l.trim()));
    if (i >= 0) {
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t.startsWith('- ')) break;
        triggers.push(t.slice(2));
      }
    }
  }

  return {
    name: get('name') || fallbackName,
    description: get('description'),
    triggers: normalizeTriggers(triggers),
    body: body.trim(),
  };
}

/** Thường hoá từ khoá: bỏ nháy, gộp khoảng trắng, thường hoá, bỏ rỗng và trùng. */
export function normalizeTriggers(list: (string | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of list || []) {
    const s = (t ?? '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/* ═══════════════ KHỚP TỪ KHOÁ ═══════════════ */

/**
 * Chọn kỹ năng khớp với câu người dùng vừa gõ.
 *
 * So khớp trên bản đã thường hoá của CẢ HAI phía, và chấm điểm bằng ĐỘ DÀI từ khoá khớp được:
 * kỹ năng bắt trúng "变量更新失败" đáng tin hơn hẳn kỹ năng chỉ bắt trúng "mvu", nên phải xếp
 * trước — nhất là khi có trần số kỹ năng.
 *
 * Kỹ năng KHÔNG có từ khoá nào thì không bao giờ tự chèn. Nếu không sẽ thành "luôn luôn bật",
 * và người dùng nạp một gói 40 kỹ năng là prompt phình gấp mấy lần mà không hiểu vì sao.
 */
export interface SkillMatch {
  skill: SkillRecord;
  hits: string[];
  score: number;
}

export function matchSkills(
  userText: string,
  skills: SkillRecord[],
  opts: { max?: number; cardKey?: string } = {},
): SkillMatch[] {
  const { max = 3, cardKey } = opts;
  const hay = (userText || '').toLowerCase();
  if (!hay.trim()) return [];
  const out: SkillMatch[] = [];
  for (const s of skills || []) {
    if (!s.enabled) continue;
    if (cardKey !== undefined && s.cardKey && s.cardKey !== cardKey) continue;
    const hits = (s.triggers || []).filter((t) => t && hay.includes(t));
    if (!hits.length) continue;
    out.push({ skill: s, hits, score: hits.reduce((n, t) => n + t.length, 0) });
  }
  out.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  return out.slice(0, Math.max(0, max));
}

/**
 * Dựng khối kỹ năng để nhét vào system prompt.
 *
 * Có trần ký tự vì kỹ năng là thứ người dùng nạp hàng loạt từ repo người khác — không kiểm soát
 * được độ dài. Cắt nguyên CẢ kỹ năng chứ không cắt giữa thân: một kỹ năng cụt nửa chừng còn tệ
 * hơn không có, vì Trợ Lý sẽ làm theo hướng dẫn thiếu vế sau.
 */
export function buildSkillBlock(matches: SkillMatch[], maxChars = 6_000): string {
  if (!matches.length) return '';
  const parts: string[] = [];
  let used = 0;
  let bo = 0;
  for (const m of matches) {
    const piece = `### ${m.skill.name}${m.skill.description ? ` — ${m.skill.description}` : ''}\n${m.skill.body}`;
    if (used + piece.length > maxChars) { bo++; continue; }
    parts.push(piece);
    used += piece.length;
  }
  if (!parts.length) return '';
  const ghiChu = bo > 0 ? `\n(Còn ${bo} kỹ năng khớp nhưng đã lược cho vừa ngữ cảnh.)` : '';
  return `[KỸ NĂNG ÁP DỤNG CHO YÊU CẦU NÀY — làm theo hướng dẫn dưới đây khi nó liên quan]\n${parts.join('\n\n')}${ghiChu}`;
}

/* ═══════════════ CRUD ═══════════════ */

export async function putSkill(rec: SkillRecord, db = skillDb()): Promise<void> {
  await db.skills.put({ ...rec, updatedAt: Date.now() });
}

export async function listSkills(
  opts: { pack?: string; cardKey?: string } = {},
  db = skillDb(),
): Promise<SkillRecord[]> {
  let rows = await db.skills.toArray();
  if (opts.pack) rows = rows.filter((s) => s.pack === opts.pack);
  if (opts.cardKey !== undefined) rows = rows.filter((s) => !s.cardKey || s.cardKey === opts.cardKey);
  rows.sort((a, b) => a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name));
  return rows;
}

export async function deleteSkill(id: string, db = skillDb()): Promise<void> {
  await db.skills.delete(id);
}

/** Gỡ cả một gói — nạp nhầm repo thì phải dọn được bằng một nút, không phải xoá tay 40 mục. */
export async function deletePack(pack: string, db = skillDb()): Promise<number> {
  const rows = await db.skills.where('pack').equals(pack).toArray();
  await db.skills.bulkDelete(rows.map((r) => r.id));
  return rows.length;
}

export async function setSkillEnabled(id: string, enabled: boolean, db = skillDb()): Promise<void> {
  const s = await db.skills.get(id);
  if (s) await db.skills.put({ ...s, enabled, updatedAt: Date.now() });
}

/**
 * Nạp nhiều file kỹ năng vào một gói.
 *
 * TRÙNG TÊN TRONG CÙNG GÓI THÌ GHI ĐÈ, không đẻ bản sao: nạp lại repo sau khi tác giả cập nhật
 * là việc thường xuyên, mà mỗi lần nạp lại phình gấp đôi kho thì dùng vài lần là hỏng.
 */
export async function installSkillFiles(
  files: { fileName: string; content: string }[],
  pack: string,
  opts: { cardKey?: string; enabled?: boolean } = {},
  db = skillDb(),
): Promise<{ added: number; updated: number; skipped: number }> {
  const existing = await db.skills.where('pack').equals(pack).toArray();
  const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
  let added = 0, updated = 0, skipped = 0;
  const now = Date.now();
  for (const f of files || []) {
    const parsed = parseSkillMarkdown(f.content, f.fileName.replace(/\.mdx?$/i, ''));
    if (!parsed.body.trim()) { skipped++; continue; }
    const prev = byName.get(parsed.name.toLowerCase());
    const rec: SkillRecord = {
      id: prev?.id || newSkillId(),
      name: parsed.name,
      description: parsed.description,
      triggers: parsed.triggers,
      body: parsed.body,
      pack,
      enabled: opts.enabled ?? prev?.enabled ?? true,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      cardKey: opts.cardKey ?? prev?.cardKey,
    };
    await db.skills.put(rec);
    if (prev) updated++; else added++;
  }
  return { added, updated, skipped };
}

/* ═══════════════ NẠP TỪ REPO GITHUB ═══════════════ */

export interface RepoRef { owner: string; repo: string; branch?: string; dir?: string }

/**
 * Tách địa chỉ repo người dùng dán vào. Nhận cả link trang web lẫn link thư mục con, vì người
 * dùng thường copy thẳng thanh địa chỉ trình duyệt đang đứng ở đúng thư mục skills.
 *   https://github.com/chu/repo
 *   https://github.com/chu/repo/tree/main/skills
 *   chu/repo
 */
export function parseRepoUrl(input: string): RepoRef | null {
  // Gỡ dấu / thừa TRƯỚC rồi mới gỡ .git — làm ngược lại thì "repo.git/" lọt lưới vì lúc đó
  // `.git` chưa nằm ở cuối chuỗi. Người dùng copy từ nút Code của GitHub hay dính đúng dạng này.
  const s = (input || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!s) return null;
  const gh = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?$/i);
  if (gh) return { owner: gh[1], repo: gh[2], branch: gh[3] || undefined, dir: gh[4] || undefined };
  const short = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], repo: short[2] };
  return null;
}

/** Tên gói hiện cho người dùng — đủ để phân biệt hai thư mục skill trong cùng một repo. */
export function packNameOf(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}${ref.dir ? `/${ref.dir}` : ''}`;
}

export function apiListUrl(ref: RepoRef): string {
  const path = ref.dir ? `/${ref.dir.replace(/^\/+/, '')}` : '';
  const branch = ref.branch ? `?ref=${encodeURIComponent(ref.branch)}` : '';
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/contents${path}${branch}`;
}

interface GhEntry { name: string; type: string; download_url?: string | null }

/**
 * Tải các file .md trong một thư mục của repo.
 *
 * Chỉ đi MỘT tầng, cố ý: đệ quy toàn repo có thể kéo về hàng trăm file README/CHANGELOG không
 * liên quan và ăn sạch hạn ngạch API GitHub cho người dùng không đăng nhập (60 lượt/giờ).
 * Muốn lấy thư mục con thì dán thẳng link thư mục đó.
 */
export async function fetchSkillFilesFromRepo(
  ref: RepoRef,
  fetchImpl: typeof fetch = fetch,
): Promise<{ fileName: string; content: string }[]> {
  const res = await fetchImpl(apiListUrl(ref));
  if (!res.ok) {
    if (res.status === 404) throw new Error('Không tìm thấy repo hoặc thư mục đó (404). Kiểm tra lại địa chỉ.');
    if (res.status === 403) throw new Error('GitHub tạm chặn vì gọi quá nhiều (403) — chờ ít phút rồi thử lại.');
    throw new Error(`GitHub trả lỗi ${res.status}.`);
  }
  const list = (await res.json()) as GhEntry[];
  if (!Array.isArray(list)) throw new Error('Địa chỉ đó là một FILE, không phải thư mục — hãy dán link thư mục chứa các file .md.');
  const mdFiles = list.filter((e) => e.type === 'file' && /\.mdx?$/i.test(e.name) && e.download_url);
  if (!mdFiles.length) throw new Error('Thư mục này không có file .md nào.');
  const out: { fileName: string; content: string }[] = [];
  for (const f of mdFiles) {
    try {
      const r = await fetchImpl(f.download_url!);
      if (!r.ok) continue;
      out.push({ fileName: f.name, content: await r.text() });
    } catch { /* một file hỏng không được làm hỏng cả lượt nạp */ }
  }
  if (!out.length) throw new Error('Tải được danh sách nhưng không đọc nổi file nào.');
  return out;
}
