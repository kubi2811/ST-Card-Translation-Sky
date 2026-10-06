/**
 * src/utils/workspaceIO.ts — (bug 251) XUẤT / NHẬP WORKSPACE CỦA THẺ ĐANG DỊCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User (PhatSiz): "Thêm tính năng xuất và import workflow/workspace — toàn bộ dữ liệu hiện tại
 * của card đang dịch, từ mảng raw cho tới mảng dịch, bê nguyên si ra ngoài để dễ chia sẻ cho
 * người khác. Trừ chỗ kết nối và API: dữ liệu kết nối và API hoàn toàn không được đụng vào hoặc
 * chia sẻ, chỉ dùng dữ liệu đã có ở local, tránh tiết lộ API."
 *
 * File gồm: thẻ (bản đang làm việc), mọi field kèm bản dịch + tiến độ chunk, metadata biến MVU,
 * cấu hình dịch (từ điển MVU/EJS, thuật ngữ, prompt, tuỳ chọn), preset đang dùng, và các mục
 * Kho link ngoài thuộc thẻ. Người nhận nạp vào là làm tiếp ĐÚNG chỗ dở.
 *
 * KHÔNG BAO GIỜ có trong file — ba lớp chặn, lớp sau đỡ lớp trước:
 *   1. Không đọc tới `proxy` / `providers` (URL, key, model của bạn) — chúng không có trong danh
 *      sách thứ được chép.
 *   2. Gỡ mọi khoá mang tên kiểu api_key / token / password / reverse_proxy / proxy_url… ở phần
 *      cấu hình và preset (preset SillyTavern có `reverse_proxy`, `proxy_password`).
 *   3. Soát NGUYÊN VĂN cả file: chuỗi key thật nào của bạn (key provider, key phụ, GitHub token)
 *      lọt vào bất cứ đâu — kể cả bị dán nhầm vào nội dung thẻ — đều bị xoá trước khi ghi file.
 * Lúc NHẬP cũng vậy: mọi cấu hình kết nối trong file (nếu có ai tự chèn) bị bỏ qua, kết nối của
 * người nhận giữ nguyên.
 */
import type { CharacterCard, SavedPreset, TranslationField } from '../types/card';
import type { ExternalLinkEntry } from './externalLinkVault';

export const WORKSPACE_FORMAT = 'st-multitools-workspace';
export const WORKSPACE_VERSION = 1;

export interface WorkspaceFile {
  format: typeof WORKSPACE_FORMAT;
  version: number;
  appVersion: string;
  exportedAt: number;
  cardFileName: string;
  contentType: string;
  card: CharacterCard;
  fields: TranslationField[];
  phase: string;
  currentFieldIndex: number;
  mvuKeyMetadata: Record<string, unknown>;
  translationConfig: Record<string, unknown>;
  activePreset: SavedPreset | null;
  externalLinks: ExternalLinkEntry[];
  /**
   * (bug 255) Ảnh thẻ (data URL) — để người nhận xuất lại được PNG. Trước đây file không mang ảnh,
   * người nhận xuất PNG là nhét thẻ vào ẢNH CỦA THẺ CŨ đang mở trên máy họ.
   */
  image?: string | null;
  /** Thống kê để người nhận biết trước khi nạp. */
  stats: { fields: number; done: number; dictMvu: number; dictEjs: number; glossary: number; externalLinks: number };
}

/** Tên khoá mang dữ liệu kết nối — gỡ ở mọi tầng của phần cấu hình/preset. */
const SENSITIVE_KEY = /(api[_-]?key|apikeys?|access[_-]?token|auth[_-]?token|\btoken\b|^token$|secret|password|passwd|authorization|bearer|reverse[_-]?proxy|proxy[_-]?(url|password|key)|custom[_-]?url|endpoint|base[_-]?url)/i;

/** Gỡ khoá nhạy cảm (đệ quy). Trả bản sao, không đụng object gốc. */
export function stripSensitiveKeys<T>(value: T, removed: string[] = [], path = ''): T {
  if (Array.isArray(value)) return value.map((v, i) => stripSensitiveKeys(v, removed, `${path}[${i}]`)) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) { removed.push(path ? `${path}.${k}` : k); continue; }
    out[k] = stripSensitiveKeys(v, removed, path ? `${path}.${k}` : k);
  }
  return out as T;
}

/** Mọi chuỗi bí mật đang có trong máy — để soát nguyên văn file xuất. */
export function collectSecrets(state: {
  proxy?: { apiKey?: string; apiKeys?: string[] };
  providers?: Array<{ apiKey?: string; apiKeys?: string[] }>;
}, extra: string[] = []): string[] {
  const all = [
    state.proxy?.apiKey, ...(state.proxy?.apiKeys || []),
    ...(state.providers || []).flatMap(p => [p.apiKey, ...(p.apiKeys || [])]),
    ...extra,
  ];
  // Chuỗi quá ngắn thì không phải key thật (và xoá nó là phá nội dung) — bỏ.
  return [...new Set(all.filter((s): s is string => typeof s === 'string' && s.trim().length >= 12).map(s => s.trim()))];
}

/** Xoá nguyên văn mọi bí mật khỏi chuỗi JSON. Trả số chỗ đã xoá. */
export function scrubSecrets(json: string, secrets: string[]): { json: string; hits: number } {
  let hits = 0;
  let out = json;
  for (const sec of secrets) {
    // So trên dạng JSON-escape của key (key hiếm khi có ký tự cần escape, nhưng cho chắc).
    const needle = JSON.stringify(sec).slice(1, -1);
    if (!needle || !out.includes(needle)) continue;
    const parts = out.split(needle);
    hits += parts.length - 1;
    out = parts.join('[ĐÃ XOÁ KEY]');
  }
  return { json: out, hits };
}

export interface WorkspaceSource {
  card: CharacterCard | null;
  cardFileName: string;
  contentType?: string;
  fields: TranslationField[];
  phase: string;
  currentFieldIndex: number;
  mvuKeyMetadata: Record<string, unknown>;
  translationConfig: object;
  activePreset: SavedPreset | null;
  /** (bug 255) Ảnh thẻ dạng data URL, nếu có. */
  image?: string | null;
}

/**
 * (bug 255) CHỈ GIỮ MỤC TỪ ĐIỂN THUỘC THẺ NÀY.
 *
 * User: "với dữ liệu mvu, ejs thì càng đưa qua nhiều lần tổng số key càng nhiều hơn (phình to)".
 * Từ điển MVU sống ở cấp MÁY (khoá 🔒 thì giữ qua mọi thẻ), nên file workspace cũ chép NGUYÊN cả
 * từ điển — tên biến của mọi thẻ khác người gửi từng dịch — và người nhận nạp vào là thừa kế hết,
 * lần chuyền sau lại cộng thêm phần của họ. Mục thuộc thẻ = khoá xuất hiện trong văn bản GỐC của
 * thẻ; mục không xuất hiện ở đâu cả không có tác dụng gì với thẻ này.
 */
export function scopeDictToCard<T>(dict: Record<string, T> | undefined, haystack: string): { dict: Record<string, T>; dropped: number } {
  const out: Record<string, T> = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(dict || {})) {
    if (k && haystack.includes(k)) out[k] = v;
    else dropped++;
  }
  return { dict: out, dropped };
}

/** Văn bản GỐC của thẻ — thước đo "mục này thuộc thẻ". */
export function cardSourceText(fields: Array<{ original?: string }>): string {
  return fields.map(f => f.original || '').join('\n');
}

export interface MergeReport {
  /** Field lấy bản dịch từ file (máy mình chưa dịch). */
  taken: number;
  /** Field cả hai cùng dịch nhưng KHÁC nhau — giữ bản của máy mình. */
  conflicts: string[];
  /** Field có trong file nhưng không khớp thẻ đang mở (khác gốc) — bỏ qua. */
  mismatched: number;
  dictAdded: number;
}

type MergeField = TranslationField & { completedChunks?: string[]; totalChunks?: number; rawChunks?: string[] };

const progressOf = (f: MergeField) => (f.status === 'done' ? 1e9 : 0) + (f.completedChunks || []).filter(Boolean).length;

/**
 * (bug 255) GỘP TIẾN ĐỘ của một workspace vào thẻ ĐANG MỞ — chia việc cho nhiều người.
 * Khớp field theo `path` + văn bản GỐC giống hệt (khác gốc = thẻ khác/phiên bản khác ⇒ bỏ qua).
 *  • máy mình chưa xong mà file đã tiến xa hơn ⇒ lấy của file (bản dịch + tiến độ chunk);
 *  • cả hai đều xong mà khác nhau ⇒ GIỮ bản của máy mình, liệt kê ra để người dùng tự xem;
 *  • từ điển: chỉ THÊM mục máy mình chưa có — mục đang có không bao giờ bị đè.
 */
export function mergeWorkspaceInto(
  current: { fields: MergeField[]; dicts: Record<string, Record<string, string>> },
  ws: Pick<WorkspaceFile, 'fields' | 'translationConfig'>,
): { fields: MergeField[]; dicts: Record<string, Record<string, string>>; report: MergeReport } {
  const byPath = new Map((ws.fields as MergeField[]).map(f => [f.path, f]));
  const report: MergeReport = { taken: 0, conflicts: [], mismatched: 0, dictAdded: 0 };
  const fields = current.fields.map((cur) => {
    const other = byPath.get(cur.path);
    if (!other) return cur;
    if (other.original !== cur.original) { report.mismatched++; return cur; }
    if (cur.status === 'done' && other.status === 'done') {
      if ((other.translated || '') !== (cur.translated || '')) report.conflicts.push(cur.label || cur.path);
      return cur;
    }
    if (progressOf(other) > progressOf(cur)) {
      report.taken++;
      return {
        ...cur,
        status: other.status === 'translating' ? 'pending' : other.status,
        translated: other.translated,
        completedChunks: other.completedChunks,
        rawChunks: other.rawChunks,
        totalChunks: other.totalChunks,
        error: undefined,
      } as MergeField;
    }
    return cur;
  });
  const dicts: Record<string, Record<string, string>> = {};
  const tc = (ws.translationConfig || {}) as Record<string, unknown>;
  for (const name of Object.keys(current.dicts)) {
    const mine = { ...(current.dicts[name] || {}) };
    for (const [k, v] of Object.entries((tc[name] as Record<string, string>) || {})) {
      if (!(k in mine) && v) { mine[k] = v; report.dictAdded++; }
    }
    dicts[name] = mine;
  }
  return { fields, dicts, report };
}

/** Thẻ trong file có phải CÙNG thẻ đang mở không (≥ 80% field trùng path + gốc). */
export function isSameCardWorkspace(curFields: Array<{ path: string; original?: string }>, ws: Pick<WorkspaceFile, 'fields'>): boolean {
  if (!curFields.length || !ws.fields.length) return false;
  const mine = new Map(curFields.map(f => [f.path, f.original]));
  let same = 0;
  for (const f of ws.fields) if (mine.get(f.path) === f.original) same++;
  return same / Math.max(curFields.length, ws.fields.length) >= 0.8;
}

/** Dựng file workspace + soát bí mật. Ném lỗi khi chưa có thẻ. */
export function buildWorkspace(
  src: WorkspaceSource,
  externalLinks: ExternalLinkEntry[],
  secrets: string[],
  appVersion: string,
): { json: string; removedKeys: string[]; scrubbedHits: number; droppedForeign: number; file: WorkspaceFile } {
  if (!src.card) throw new Error('Chưa nạp thẻ nào để xuất workspace.');
  const removedKeys: string[] = [];
  const tc = stripSensitiveKeys(src.translationConfig as Record<string, unknown>, removedKeys, 'translationConfig');
  // (bug 255) Từ điển / thuật ngữ / metadata: chỉ phần thuộc thẻ này — xem scopeDictToCard.
  const hay = cardSourceText(src.fields);
  let droppedForeign = 0;
  for (const name of ['mvuDictionary', 'ejsEntryNameDict', 'ejsKeywordDict', 'codeLiteralDict']) {
    if (tc[name] && typeof tc[name] === 'object') {
      const r = scopeDictToCard(tc[name] as Record<string, string>, hay);
      tc[name] = r.dict;
      droppedForeign += r.dropped;
    }
  }
  if (Array.isArray(tc.glossary)) {
    const before = (tc.glossary as Array<{ source?: string }>).length;
    tc.glossary = (tc.glossary as Array<{ source?: string }>).filter(g => !!g?.source && hay.includes(g.source));
    droppedForeign += before - (tc.glossary as unknown[]).length;
  }
  const meta = scopeDictToCard(src.mvuKeyMetadata || {}, hay).dict;
  const preset = src.activePreset ? stripSensitiveKeys(src.activePreset, removedKeys, 'activePreset') : null;
  const links = externalLinks.map(e => ({ ...e }));
  const fields = src.fields.map(f => (f.status === 'translating' ? { ...f, status: 'pending' as const } : f));

  const file: WorkspaceFile = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    appVersion,
    exportedAt: Date.now(),
    cardFileName: src.cardFileName,
    contentType: src.contentType || 'card',
    card: src.card,
    fields,
    phase: src.phase === 'translating' ? 'paused' : src.phase,
    currentFieldIndex: src.currentFieldIndex || 0,
    mvuKeyMetadata: meta,
    translationConfig: tc,
    activePreset: preset,
    externalLinks: links,
    image: src.image || null,
    stats: {
      fields: fields.length,
      done: fields.filter(f => f.status === 'done').length,
      dictMvu: Object.keys((tc.mvuDictionary as object) || {}).length,
      dictEjs: Object.keys((tc.ejsEntryNameDict as object) || {}).length + Object.keys((tc.ejsKeywordDict as object) || {}).length,
      glossary: Array.isArray(tc.glossary) ? (tc.glossary as unknown[]).length : 0,
      externalLinks: links.length,
    },
  };
  const scrub = scrubSecrets(JSON.stringify(file), secrets);
  return { json: scrub.json, removedKeys, scrubbedHits: scrub.hits, droppedForeign, file: JSON.parse(scrub.json) };
}

/** Đọc + kiểm file workspace. Ném lỗi tiếng Việt dễ hiểu khi file không hợp lệ. */
export function parseWorkspace(text: string): WorkspaceFile {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new Error('File không phải JSON hợp lệ.'); }
  if (!raw || raw.format !== WORKSPACE_FORMAT) {
    throw new Error('Đây không phải file workspace của SillyTavern Multitools (thiếu dấu nhận dạng).');
  }
  if (typeof raw.version !== 'number' || raw.version > WORKSPACE_VERSION) {
    throw new Error(`File workspace phiên bản ${raw.version} mới hơn bản tool này hỗ trợ (${WORKSPACE_VERSION}) — hãy cập nhật tool.`);
  }
  if (!raw.card || typeof raw.card !== 'object') throw new Error('File workspace thiếu dữ liệu thẻ.');
  if (!Array.isArray(raw.fields)) throw new Error('File workspace thiếu danh sách field.');
  // Lớp chặn lúc NHẬP: bỏ mọi dấu vết kết nối nếu có ai tự chèn vào file.
  delete raw.proxy;
  delete raw.providers;
  raw.translationConfig = stripSensitiveKeys(raw.translationConfig || {});
  raw.activePreset = raw.activePreset ? stripSensitiveKeys(raw.activePreset) : null;
  raw.externalLinks = Array.isArray(raw.externalLinks) ? raw.externalLinks.filter((e: any) => e && typeof e.id === 'string') : [];
  raw.fields = raw.fields.map((f: any) => (f?.status === 'translating' ? { ...f, status: 'pending' } : f));
  // Ảnh chỉ nhận data URL ảnh thật — không nạp URL ngoài/blob lạ từ file người khác gửi.
  if (typeof raw.image !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(raw.image)) raw.image = null;
  // (bug 255) File cũ (trước bản này) chép cả từ điển của máy người gửi — lọc lại theo thẻ.
  const hay = cardSourceText(raw.fields);
  const tc = raw.translationConfig as Record<string, unknown>;
  for (const name of ['mvuDictionary', 'ejsEntryNameDict', 'ejsKeywordDict', 'codeLiteralDict']) {
    if (tc[name] && typeof tc[name] === 'object') tc[name] = scopeDictToCard(tc[name] as Record<string, string>, hay).dict;
  }
  if (raw.mvuKeyMetadata && typeof raw.mvuKeyMetadata === 'object') raw.mvuKeyMetadata = scopeDictToCard(raw.mvuKeyMetadata, hay).dict;
  return raw as WorkspaceFile;
}

/** Tên file gợi ý: <tên thẻ>.workspace.json */
export function workspaceFileName(file: Pick<WorkspaceFile, 'card' | 'cardFileName'>): string {
  const base = String((file.card as any)?.data?.name || (file.card as any)?.name || file.cardFileName || 'the')
    .replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'the';
  return `${base}.workspace.json`;
}
