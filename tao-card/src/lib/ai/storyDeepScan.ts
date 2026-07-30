/**
 * (bug 150) "Quét truyện bằng AI" — pipeline NGHIÊN CỨU TÁC PHẨM nhiều lượt (multi-pass).
 * ─────────────────────────────────────────────────────────────────────────────
 * Yêu cầu gốc của user: "Tạo thẻ từ truyện" cũ chỉ quét roster + sinh thẻ một lượt là quá sơ
 * sài. Mục tiêu thật là AI ĐỌC VÀ NGHIÊN CỨU TOÀN BỘ tác phẩm: chia batch, đọc nhiều lượt với
 * mục tiêu khác nhau, lưu kết quả vào BỘ NHỚ trung gian, đọc lại để bổ sung/đối chiếu cho đến
 * khi không còn thông tin mới, rồi tự tạo đủ Character Card + Lorebook + Style Profile.
 *
 * Các lượt đọc (pass):
 *   1. structure  — cấu trúc truyện, chương/hồi, bối cảnh, thực thể, ứng viên nhân vật chính.
 *   2. roster     — danh sách nhân vật đầy đủ (tái dùng scanCharacters) + phân vai chính/phụ.
 *   3. characters — đọc lại toàn truyện, gom DỮ KIỆN cho TỪNG nhân vật (rải rác ở mọi chương).
 *   4. world      — đọc lại, thu thập thiết lập thế giới theo CHỦ ĐỀ (hệ thống, luật, địa lý,
 *                   phe phái, vật phẩm, lịch sử, văn hoá, thuật ngữ…).
 *   5. timeline   — đọc lại, ghi sự kiện theo trình tự; không có ngày cụ thể thì dùng mốc
 *                   TƯƠNG ĐỐI (Ngày 1 / Sau sự kiện X), tuyệt đối không bịa.
 *   6. style      — học văn phong tác giả (mẫu đầu/giữa/cuối truyện) → Style Profile.
 *   7. verify     — LƯỢT ĐỐI CHIẾU: đưa bộ nhớ + từng đoạn, chỉ nhận cái MỚI/SAI; lặp nhiều
 *                   vòng đến khi một vòng gần như không còn dữ kiện mới (hoặc chạm trần vòng).
 *   8. synthesize — tổng hợp bộ nhớ thành Lorebook entry theo từng chủ đề (bọc thẻ <Character>,
 *                   <System>, <Location>… đúng chuẩn worldbook user đang dùng) + Character Card.
 *   9. quality    — khử trùng lặp bằng máy (key overlap + fingerprint) + 1 lượt AI soát mâu
 *                   thuẫn/nhất quán.
 *
 * Toàn bộ tiến trình (chunk nào đã xong, bộ nhớ, kết quả) nằm trong DeepScanState — UI persist
 * qua localStorage nên TẠM DỪNG / TIẾP TỤC / F5 đều không mất việc; đổi truyện thì storySig
 * lệch → bắt đầu lại. Không bịa: dữ liệu không rõ phải đánh dấu vào `unknowns`.
 */
import type { ProxyProfile, GenerationParams } from '../../types';
import { type LorebookEntry } from '../../types/lorebook.types';
import type { AIGeneratedEntry } from '../../types/aiAgent.types';
import { materializeEntry } from '../converters/cardDefaults';
import { callAI, computePoolConcurrency } from './client';
import { hasCjk, scanCjkResidue, buildCjkRetryHint } from './cjkResidue';
import { applyUserPersonaSwap } from './userPersonaSwap';
import { checkKeyOverlap, checkContentSimilarity } from './deduplicator';
import {
  chunkStory, scanCharacters, runPool, tag, allTags,
  LANGUAGE_RULE, QUALITY_RULE, NSFW_RULE, SFW_RULE,
  type ScannedCharacter, type GeneratedStoryCard,
} from './storyToCard';

// ═══════════════════════════════ Kiểu dữ liệu ═══════════════════════════════

export type DeepPassId =
  | 'structure' | 'roster' | 'characters' | 'world' | 'timeline'
  | 'style' | 'verify' | 'synthesize' | 'quality';

export type DeepPassStatus = 'pending' | 'running' | 'done' | 'skipped';

export interface PassState {
  id: DeepPassId;
  status: DeepPassStatus;
  done: number;
  total: number;
  /** verify: vòng hiện tại (1-based) — UI hiện "vòng 2/3". */
  round?: number;
}

export type CharRole = 'chính' | 'phụ' | 'quần chúng';

export interface CharacterDossier {
  name: string;
  aliases: string[];
  role: CharRole;
  brief: string;
  /** Dữ kiện gom qua các lượt đọc — mỗi phần tử một gạch đầu dòng. */
  facts: string[];
}

export type WorldCat =
  | 'worldview' | 'system' | 'mechanic' | 'rule' | 'location' | 'faction'
  | 'item' | 'history' | 'culture' | 'term' | 'other';

export interface WorldFact { topic: string; cat: WorldCat; fact: string; }
export interface TimelineEvent { time: string; what: string; chunk: number; }

export interface StoryMemory {
  /** Tóm tắt tổng quan (reduce từ lượt structure). */
  overview: string;
  /** Ghi chú cấu trúc theo từng đoạn — 【Đoạn i】… */
  partNotes: string[];
  mainCharacter: string;
  glossary: string[];
  characters: CharacterDossier[];
  worldFacts: WorldFact[];
  timeline: TimelineEvent[];
  styleNotes: string[];
  /** Mâu thuẫn phát hiện + cách xử lý (từ verify + quality). */
  corrections: string[];
  /** Dữ liệu CHƯA XÁC ĐỊNH — đánh dấu rõ thay vì bịa. */
  unknowns: string[];
}

export type EntryCat =
  | 'meta' | 'worldview' | 'system' | 'mechanic' | 'rule' | 'character'
  | 'faction' | 'location' | 'item' | 'history' | 'culture' | 'term'
  | 'timeline' | 'style' | 'other';

export interface DeepEntry {
  cat: EntryCat;
  title: string;
  keys: string[];
  content: string;
  /** Entry thường trú (constant) — theo chuẩn worldbook user cung cấp. */
  constant: boolean;
}

export interface DeepCardResult { name: string; card?: GeneratedStoryCard; error?: string; }

export interface DeepScanResult {
  entries: DeepEntry[];
  cards: DeepCardResult[];
  /** Báo cáo lượt quality (trùng lặp đã gỡ, mâu thuẫn cần để ý). */
  report: string[];
}

export interface DeepScanStats { aiCalls: number; facts: number; entries: number; }

export interface DeepScanState {
  v: 1;
  storySig: string;
  chunkCount: number;
  status: 'idle' | 'running' | 'paused' | 'done' | 'error';
  passIndex: number;
  passes: PassState[];
  /** Chunk đã xong theo từng pass — resume chỉ chạy phần thiếu. */
  chunkDone: Partial<Record<string, number[]>>;
  verifyRound: number;
  memory: StoryMemory;
  stats: DeepScanStats;
  result?: DeepScanResult;
  error?: string;
}

export interface DeepScanOptions {
  chunkSize?: number;        // mặc định 40000
  maxChunks?: number;        // mặc định 24
  /** Số vòng đối chiếu TỐI ĐA (0 = bỏ qua verify). Dừng sớm khi vòng không còn gì mới. */
  maxVerifyRounds?: number;  // mặc định 2
  nsfw?: boolean;
  learnStyle?: boolean;      // mặc định true
  makeCard?: boolean;        // mặc định true
  /** Tên nhân vật tạo thẻ; bỏ trống = nhân vật chính do AI nhận diện. */
  cardCharacters?: string[];
  /** CHỦ ĐỘNG nhập vai: nhân vật này trong truyện = {{user}}. Không đặt thì tuyệt đối
   *  không trộn {{user}} vào dữ liệu tác phẩm. */
  userReplaceName?: string;
  userSetup?: string;
  extraNotes?: string;
  signal?: AbortSignal;
  onState?: (s: DeepScanState) => void;
  onLog?: (msg: string) => void;
}

// ═══════════════════════════ Helpers thuần (test được) ═══════════════════════

/** Chữ ký truyện — đổi truyện thì tiến trình cũ vô hiệu. Hash FNV-1a gọn, đủ phân biệt. */
export function storySig(story: string): string {
  const s = story.trim();
  let h = 0x811c9dc5;
  // Lấy mẫu tối đa ~64k ký tự rải đều — truyện triệu chữ không cần hash từng ký tự.
  const step = Math.max(1, Math.floor(s.length / 65536));
  for (let i = 0; i < s.length; i += step) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

const normLine = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Thêm dòng mới vào danh sách, bỏ dòng đã có (so sau chuẩn hoá). Trả về số dòng THÊM được. */
export function addUniqueLines(list: string[], incoming: string[], cap = 400): number {
  const seen = new Set(list.map(normLine));
  let added = 0;
  for (const raw of incoming) {
    const line = raw.trim();
    if (!line) continue;
    const key = normLine(line);
    if (seen.has(key)) continue;
    if (list.length >= cap) break;
    seen.add(key);
    list.push(line);
    added++;
  }
  return added;
}

/**
 * (bug 163) Tách các khối <entry> — CHỊU ĐƯỢC THẺ ĐÓNG BỊ THIẾU.
 *
 * User hỏi: "nếu bị thiếu tag khi trả data về hay là khỏi cần tag luôn để đỡ lỗi?".
 * Bỏ tag hẳn thì KHÔNG nên: mỗi entry là một bản ghi NHIỀU TRƯỜNG (cat/title/keys/content), không
 * có ranh giới thì không tài nào biết đâu là tên đâu là nội dung — parser sẽ đẻ ra entry rác mà
 * vẫn báo thành công, tức đổi một lỗi thấy được lấy một lỗi im lặng. Cái đáng làm là giữ tag
 * nhưng ĐỪNG BẮT BUỘC thẻ đóng.
 *
 * Vì sao thẻ đóng hay mất thật: model chạm trần token thì bị cắt giữa chừng, entry CUỐI mất
 * </entry>. allTags() chỉ bắt cặp đóng-mở nên lặng lẽ vứt luôn entry đó. Cắt ở giữa một danh sách
 * dài thì mất đúng phần dài nhất — không có lỗi nào báo.
 *
 * Lưu ý: đây là lưới đỡ, KHÔNG phải nguyên nhân của bug 163. Nguyên nhân là mảng entry bị xoá
 * trước lượt soát chất lượng (xem ghi chú ở vòng chạy pass).
 */
export function splitEntryBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /<entry>/gi;
  let m: RegExpExecArray | null;
  const starts: number[] = [];
  while ((m = re.exec(text)) !== null) starts.push(m.index + m[0].length);
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    // Kết thúc ở </entry> nếu có; không thì tới <entry> kế tiếp; không nữa thì hết chuỗi.
    const close = text.toLowerCase().indexOf('</entry>', from);
    const nextOpen = i + 1 < starts.length ? text.toLowerCase().lastIndexOf('<entry>', starts[i + 1]) : -1;
    let end: number;
    if (close !== -1 && (nextOpen === -1 || close < nextOpen)) end = close;
    else if (nextOpen !== -1) end = nextOpen;
    else end = text.length;
    const block = text.slice(from, end).trim();
    if (block) out.push(block);
  }
  return out;
}

export function emptyMemory(): StoryMemory {
  return {
    overview: '', partNotes: [], mainCharacter: '', glossary: [],
    characters: [], worldFacts: [], timeline: [], styleNotes: [],
    corrections: [], unknowns: [],
  };
}

export function buildPassList(opts: DeepScanOptions): PassState[] {
  const ids: DeepPassId[] = ['structure', 'roster', 'characters', 'world', 'timeline'];
  if (opts.learnStyle !== false) ids.push('style');
  if ((opts.maxVerifyRounds ?? 2) > 0) ids.push('verify');
  ids.push('synthesize', 'quality');
  return ids.map((id) => ({ id, status: 'pending' as const, done: 0, total: 0 }));
}

export function initDeepState(story: string, opts: DeepScanOptions, chunkCount: number): DeepScanState {
  return {
    v: 1, storySig: storySig(story), chunkCount,
    status: 'idle', passIndex: 0,
    passes: buildPassList(opts),
    chunkDone: {}, verifyRound: 0,
    memory: emptyMemory(),
    stats: { aiCalls: 0, facts: 0, entries: 0 },
  };
}

/** Tiến trình cũ còn dùng được không? (cùng truyện + cùng cấu hình pass + chưa lỗi cấu trúc) */
export function canResume(prev: DeepScanState | null | undefined, story: string, opts: DeepScanOptions): prev is DeepScanState {
  if (!prev || prev.v !== 1) return false;
  if (prev.storySig !== storySig(story)) return false;
  const wanted = buildPassList(opts).map((p) => p.id).join(',');
  const have = prev.passes.map((p) => p.id).join(',');
  return wanted === have;
}

/** Tìm dossier theo tên/bí danh (chuẩn hoá). */
export function findDossier(chars: CharacterDossier[], name: string): CharacterDossier | undefined {
  const k = normLine(name);
  if (!k) return undefined;
  return chars.find((c) => normLine(c.name) === k || c.aliases.some((a) => normLine(a) === k));
}

/** Gom worldFacts theo topic (giữ thứ tự xuất hiện). */
export function groupWorldFacts(facts: WorldFact[]): Array<{ topic: string; cat: WorldCat; facts: string[] }> {
  const map = new Map<string, { topic: string; cat: WorldCat; facts: string[] }>();
  for (const f of facts) {
    const key = `${f.cat}|${normLine(f.topic)}`;
    let g = map.get(key);
    if (!g) { g = { topic: f.topic, cat: f.cat, facts: [] }; map.set(key, g); }
    if (!g.facts.some((x) => normLine(x) === normLine(f.fact))) g.facts.push(f.fact);
  }
  return [...map.values()];
}

/** Cắt chuỗi theo trần ký tự, giữ nguyên dòng, chú thích phần bị cắt. */
export function capText(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap);
  const nl = cut.lastIndexOf('\n');
  return `${nl > cap * 0.6 ? cut.slice(0, nl) : cut}\n…(đã lược bớt cho gọn)`;
}

/**
 * Bản tóm tắt BỘ NHỚ đưa cho lượt verify/synthesize — phải gọn (không đem cả bộ nhớ nguyên
 * khối đi từng call) nhưng đủ để AI biết đã có gì rồi.
 */
export function buildMemoryDigest(m: StoryMemory, budget = 24000): string {
  const parts: string[] = [];
  if (m.overview) parts.push(`【TỔNG QUAN】\n${capText(m.overview, 2500)}`);
  if (m.mainCharacter) parts.push(`【NHÂN VẬT CHÍNH】${m.mainCharacter}`);
  if (m.characters.length) {
    const lines = m.characters.map((c) => {
      const facts = c.facts.slice(0, 10).map((f) => `  - ${f}`).join('\n');
      return `• ${c.name}${c.aliases.length ? ` (${c.aliases.join(', ')})` : ''} [${c.role}] — ${c.facts.length} dữ kiện${facts ? `\n${facts}` : ''}`;
    }).join('\n');
    parts.push(`【NHÂN VẬT ĐÃ GHI】\n${capText(lines, Math.floor(budget * 0.4))}`);
  }
  if (m.worldFacts.length) {
    const lines = groupWorldFacts(m.worldFacts)
      .map((g) => `• [${g.cat}] ${g.topic}: ${g.facts.slice(0, 6).join(' | ')}`)
      .join('\n');
    parts.push(`【THẾ GIỚI ĐÃ GHI】\n${capText(lines, Math.floor(budget * 0.35))}`);
  }
  if (m.timeline.length) {
    const lines = m.timeline.map((e) => `• [${e.time}] ${e.what}`).join('\n');
    parts.push(`【TIMELINE ĐÃ GHI】\n${capText(lines, Math.floor(budget * 0.2))}`);
  }
  if (m.unknowns.length) parts.push(`【CHƯA XÁC ĐỊNH】\n${m.unknowns.slice(0, 20).map((u) => `- ${u}`).join('\n')}`);
  return capText(parts.join('\n\n'), budget);
}

// ─── Map DeepEntry → LorebookEntry theo chuẩn worldbook user cung cấp (chinh lorebook.txt) ───
// Group 1 (Meta/System/Mechanic/Rule): constant, At Depth 0, role System, order 900.
// Group 2 (Worldview/Timeline):        constant, At Depth 4, role System, order 800.
// Group 3 (Character):                 normal, After Char, order 200.
// Group 4 (Faction/Tổ chức/Tôn giáo):  normal, Before Char, order 150.
// Group 5 (Location/Khu vực):          normal, Before Char, order 100.
interface EntryPlacement { constant: boolean; position: LorebookEntry['position']; extPosition: 0 | 1 | 4; depth: number; role: 0 | null; order: number; }
export function entryPlacement(cat: EntryCat): EntryPlacement {
  switch (cat) {
    case 'meta': case 'system': case 'mechanic': case 'rule':
      return { constant: true, position: 'before_char', extPosition: 4, depth: 0, role: 0, order: 900 };
    case 'worldview':
      return { constant: true, position: 'before_char', extPosition: 4, depth: 4, role: 0, order: 800 };
    case 'timeline':
      return { constant: true, position: 'before_char', extPosition: 4, depth: 4, role: 0, order: 790 };
    case 'style':
      return { constant: true, position: 'before_char', extPosition: 4, depth: 4, role: 0, order: 780 };
    case 'character':
      return { constant: false, position: 'after_char', extPosition: 1, depth: 4, role: null, order: 200 };
    case 'faction':
      return { constant: false, position: 'before_char', extPosition: 0, depth: 4, role: null, order: 150 };
    case 'item': case 'history': case 'culture': case 'term': case 'other':
      return { constant: false, position: 'before_char', extPosition: 0, depth: 4, role: null, order: 120 };
    case 'location':
      return { constant: false, position: 'before_char', extPosition: 0, depth: 4, role: null, order: 100 };
  }
}

/**
 * (lõi lorebook) Đi qua `materializeEntry` — CỔNG RA CHUNG của mọi đường sinh entry.
 *
 * Trước đây hàm này tự dựng LorebookEntry từ đầu. Kết quả vẫn đúng, nhưng nó là BẢN CHÉP của
 * phần ống nước: cứ ai sửa `materializeEntry` (thêm cờ ST mới, đổi cách đồng bộ disable/enabled,
 * bổ sung mặc định) thì "Tạo thẻ từ truyện" không được hưởng, và lệch dần một cách âm thầm.
 *
 * Điều KHÔNG gộp: bảng phân loại. `EntryCat` ở đây bám chuẩn worldbook của user (Group 1-5,
 * order 900/800/200/150/100) — khác hẳn taxonomy của worldbookConfig vốn xoay quanh thẻ đơn /
 * nhiều nhân vật. Ép hai bên dùng chung một bảng phân loại là phá mất cái đúng của cả hai.
 * Nên `entryPlacement` vẫn ở đây và được truyền xuống qua `config.placement`.
 */
export function toLorebookEntry(e: DeepEntry, id: number): LorebookEntry {
  const p = entryPlacement(e.cat);
  const constant = e.constant || p.constant;
  return materializeEntry(
    {
      comment: e.title,
      content: e.content,
      keys: constant ? [] : (e.keys.length ? e.keys : [e.title]),
      secondary_keys: [],
    } as AIGeneratedEntry,
    {
      useRegex: false,
      placement: {
        constant,
        selective: !constant,
        position: p.extPosition,
        depth: p.depth,
        role: p.role,
        insertion_order: p.order,
        scan_depth: null,
        positionName: p.position,   // giu ĐUNG chuoi cu (@depth -> before_char)
      },
    },
    id,
  );
}

// ═════════════════════════════════ Engine ════════════════════════════════════

const ABORT = () => new DOMException('Aborted', 'AbortError');
const isAbortErr = (e: unknown) =>
  (e instanceof DOMException && e.name === 'AbortError') || (e instanceof Error && /abort/i.test(e.message));

const CAT_SET: WorldCat[] = ['worldview', 'system', 'mechanic', 'rule', 'location', 'faction', 'item', 'history', 'culture', 'term', 'other'];

const NO_FABRICATE = 'CHỐNG BỊA — LỆNH TUYỆT ĐỐI: chỉ ghi thông tin CÓ TRONG truyện; suy luận hợp lý phải đánh dấu "(suy luận)"; thông tin truyện không nói rõ thì GHI VÀO <unk> thay vì tự chế.';
const NO_USER_MIX = 'TUYỆT ĐỐI KHÔNG nhầm nhân vật chính của truyện với {{user}} hay bất kỳ placeholder SillyTavern nào. Trong giai đoạn PHÂN TÍCH, không dùng {{user}}/{{char}} — dùng đúng TÊN nhân vật trong truyện.';

/**
 * (bug 158) KHUNG NHIỆM VỤ — dán vào MỌI prompt tổng hợp.
 *
 * Bằng chứng user gửi: chạy đủ 9 giai đoạn, 179 lượt AI, gom được 1.831 dữ kiện — rồi ra
 * ĐÚNG 0 entry, kèm 59 dòng "❓ Chưa xác định". Mà đọc nội dung mấy dòng đó thì chúng là entry
 * hoàn chỉnh: "Chưa xác định: Wright: Lão già say khướt làm chủ quán rượu 'Chó Săn', người giữ
 * vai trò chỉ điểm…". Tức là AI hiểu module này là công cụ SOI LỖ HỔNG cốt truyện, nên thay vì
 * chép lại tri thức thì nó đi liệt kê những gì truyện chưa nói.
 *
 * User nói rõ: "AI phải ưu tiên nguyên tắc GHI LẠI TẤT CẢ NHỮNG GÌ TRUYỆN ĐÃ XÁC NHẬN thay vì
 * đi tìm những gì truyện chưa giải thích". Bí ẩn chưa tiết lộ CHÍNH NÓ là lore đáng ghi, không
 * phải lý do để bỏ entry.
 */
export const MISSION_RULE = [
  'NHIỆM VỤ: chuyển tác phẩm thành CƠ SỞ TRI THỨC để nhập vai. Bạn là người CHÉP SỬ, không phải người soi lỗi.',
  'Đây KHÔNG phải công cụ review / kiểm tra tính hợp lý / tìm lỗ hổng cốt truyện. TUYỆT ĐỐI không trả về danh sách "chưa xác định", "thiếu dữ kiện", "cần làm rõ" thay cho entry.',
  'Truyện cố tình giữ bí mật hoặc chưa giải thích ⇒ VẪN TẠO ENTRY, ghi đúng theo nguyên tác rằng đây là điều chưa được tiết lộ tại thời điểm đó. Bí ẩn là LORE, không phải lý do bỏ qua.',
  'Có nhiều lời kể khác nhau về cùng một việc ⇒ ghi ĐỦ các góc nhìn kèm nguồn, không tự phán xử khi truyện chưa xác nhận.',
  'Mọi thực thể có tên và có ít nhất một dữ kiện đều ĐÁNG một entry: nhân vật, địa điểm, tổ chức, gia tộc, chủng tộc, vật phẩm, kỹ năng, cảnh giới, tiền tệ, luật lệ, phong tục, tôn giáo, truyền thuyết, thuật ngữ, sự kiện, mốc thời gian.',
  'Không bịa thông tin truyện không có — nhưng "không bịa" KHÔNG có nghĩa là "không viết". Có bao nhiêu dữ kiện thì viết bấy nhiêu.',
].join('\n');

/**
 * (bug 158) CHỐT CHẶN CUỐI: gom được dữ kiện mà không ra entry nào là HỎNG, không phải "xong".
 *
 * Lần chạy trong bằng chứng user kết thúc với `1.831 dữ kiện · 0 entry` mà MỌI giai đoạn vẫn
 * xanh, kết quả chỉ ghi "Thêm 0 entry vào Lorebook". Không chỗ nào nói cho họ biết là hỏng, nên
 * họ tưởng truyện thiếu dữ liệu — trong khi dữ liệu thừa thãi, chỉ khâu tổng hợp trượt.
 * Tách ra hàm thuần để test được: đây là thứ quyết định user có biết mình đang cầm kết quả hỏng
 * hay không.
 */
export function buildYieldWarnings(
  keptCount: number,
  factCount: number,
  emptyJobs: string[],
): string[] {
  if (keptCount === 0 && factCount > 0) {
    return [
      `❌ Đã gom ${factCount} dữ kiện nhưng KHÔNG tạo được entry nào — đây là lỗi, không phải "truyện thiếu dữ liệu". `
      + (emptyJobs.length
        ? `Các lượt tổng hợp trắng tay: ${emptyJobs.slice(0, 8).join(' · ')}${emptyJobs.length > 8 ? ' …' : ''}. `
        : '')
      // (bug 163) Câu cũ ở đây là "đổi model — model đang dùng không giữ được định dạng
      // <entries><entry>". Nói vậy là ĐỔ OAN cho model: nguyên nhân thật của mọi lần user báo lỗi
      // là entry bị code xoá sạch trước lượt soát chất lượng. Đã sửa. Nên câu cảnh báo cũng phải
      // đổi — chỉ sang đúng chỗ đáng ngờ còn lại, thay vì bắt user đi thay model vô ích.
      + 'Trường hợp này lẽ ra không còn xảy ra sau bản vá 163. Nếu vẫn gặp: bấm Chạy lại từ đầu, '
      + 'kiểm tra API key còn hạn không (khoá hỏng làm gãy giữa chừng), rồi gửi kèm ảnh màn hình này để dò tiếp.',
    ];
  }
  if (emptyJobs.length) {
    return [`⚠️ ${emptyJobs.length} lượt tổng hợp không ra entry nào: ${emptyJobs.slice(0, 6).join(' · ')}${emptyJobs.length > 6 ? ' …' : ''}`];
  }
  return [];
}

export async function runDeepScan(
  story: string,
  profile: ProxyProfile,
  params: GenerationParams,
  opts: DeepScanOptions = {},
  prev?: DeepScanState | null,
): Promise<DeepScanState> {
  const chunkSize = opts.chunkSize ?? 40000;
  const maxChunks = opts.maxChunks ?? 24;
  let chunks = chunkStory(story.trim(), chunkSize);
  if (chunks.length > maxChunks) chunks = chunks.slice(0, maxChunks);

  const st: DeepScanState = canResume(prev, story, opts)
    ? JSON.parse(JSON.stringify(prev)) as DeepScanState
    : initDeepState(story, opts, chunks.length);
  st.chunkCount = chunks.length;
  st.status = 'running';
  st.error = undefined;

  const log = (m: string) => opts.onLog?.(m);
  const emit = () => opts.onState?.(JSON.parse(JSON.stringify(st)));
  const checkAbort = () => { if (opts.signal?.aborted) throw ABORT(); };
  const conc = Math.max(1, computePoolConcurrency(profile));

  /** callAI + đếm lượt gọi (stat "số lượt AI đã quét" trên UI). */
  const ai = async (label: string, system: string, user: string, useSecondary = false): Promise<string> => {
    checkAbort();
    // (bug 163) Gửi lượt AI với phần nội dung RỖNG thì provider trả về lỗi khó hiểu — trong log
    // của user là `[400] Bad Request: "Unable to submit request because at least one contents
    // field is required"`, đọc xong không ai đoán nổi là do đâu. Chặn ngay tại chỗ và nói rõ lượt
    // nào rỗng, vì rỗng ở đây luôn là hệ quả của một khâu TRƯỚC đó đã hỏng.
    if (!user.trim()) throw new Error(`Lượt "${label}" không có dữ liệu đầu vào — khâu trước đó đã hỏng.`);
    const { text } = await callAI({
      profile, params, signal: opts.signal, label, useSecondary,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    st.stats.aiCalls++;
    return text;
  };

  /**
   * (bug 163) Lượt ĐỌC dùng MODEL PHỤ nếu user có đặt; lượt VIẾT vẫn dùng model chính.
   *
   * Trước đây pipeline này không đụng tới model phụ lần nào — đặt model phụ trong Cài đặt cũng
   * không có tác dụng gì ở đây, chỉ deduplicator dùng. Trong khi phần lớn số lượt gọi lại nằm ở
   * khâu ĐỌC (bóc dữ kiện theo từng chunk: cấu trúc, nhân vật, thế giới, timeline, văn phong, đối
   * chiếu) — việc máy móc, đúng tầm model nhanh. Khâu VIẾT ENTRY mới là chỗ cần model mạnh.
   * App "Trích Card" đã đi đúng lối này sẵn ("quét bằng model phụ, tạo thẻ vẫn dùng model chính").
   *
   * Không đặt model phụ thì `useSecondary` bị client bỏ qua → mọi thứ chạy bằng model chính, y như
   * cũ. Nên đây là tuỳ chọn, không phải thay đổi bắt buộc.
   */
  const aiRead = (label: string, system: string, user: string) => ai(label, system, user, true);

  const m = st.memory;
  const pass = () => st.passes[st.passIndex];

  /** (bug 163) Các phần bị bỏ qua vì lỗi — đưa vào báo cáo cuối để user biết bản quét chưa trọn. */
  const chunkFailures: string[] = [];
  /** (bug 163) Chỗ bị cắt vì chạm trần — cũng phải nói ra, cắt âm thầm là lỗi im lặng. */
  const capNotices: string[] = [];
  const capHit = { world: false };

  /** Chạy pass dạng map-trên-chunk, có ghi nhớ chunk đã xong để resume. */
  const mapPass = async (key: string, chunkIdxs: number[], worker: (chunk: string, i: number) => Promise<void>) => {
    const doneSet = new Set(st.chunkDone[key] ?? []);
    const todo = chunkIdxs.filter((i) => !doneSet.has(i));
    const p = pass();
    p.total = chunkIdxs.length;
    p.done = doneSet.size;
    emit();
    // (bug 163) MỘT CHUNK HỎNG KHÔNG ĐƯỢC GIẾT CẢ LƯỢT QUÉT.
    // Đo được trên API thật: provider giới hạn 10 lượt/phút, một lượt dính 429 sau khi hết số lần
    // thử lại là ném thẳng ra ngoài → toàn bộ pass chết → pipeline dừng ở trạng thái error → user
    // nhận về 0 entry và mất trắng mọi thứ đã gom. Với truyện dài (hàng trăm lượt gọi, chạy hàng
    // giờ) thì xác suất dính ít nhất một lỗi tạm thời gần như là chắc chắn — nên đây cũng là một
    // nguồn thật của chính triệu chứng "0 entry", độc lập với chỗ xoá mảng đã sửa ở trên.
    // Bỏ qua chunk hỏng và chạy tiếp: thiếu vài chunk thì lorebook mỏng hơn một chút, còn hơn là
    // không có gì. Hỏng SẠCH thì mới báo lỗi thật.
    let failed = 0;
    await runPool(todo, Math.min(conc, Math.max(1, todo.length)), async (i) => {
      checkAbort();
      try {
        await worker(chunks[i], i);
      } catch (e) {
        if (isAbortErr(e)) throw e;          // user bấm dừng thì phải dừng thật
        failed++;
        chunkFailures.push(`${key}#${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
        log(`⚠️ Bỏ qua phần ${i + 1} của lượt "${key}" — ${e instanceof Error ? e.message : String(e)}`);
        return;                              // KHÔNG đánh dấu done → lần resume sau còn chạy lại
      }
      doneSet.add(i);
      st.chunkDone[key] = [...doneSet];
      p.done = doneSet.size;
      emit();
    });
    if (failed > 0 && failed === todo.length && todo.length > 0) {
      throw new Error(`Lượt "${key}" hỏng toàn bộ ${failed}/${todo.length} phần — ${chunkFailures[chunkFailures.length - 1] ?? ''}`);
    }
  };

  const allIdx = chunks.map((_, i) => i);
  const multi = chunks.length > 1;
  const chunkLabel = (i: number) => (multi ? `đoạn ${i + 1}/${chunks.length}` : 'toàn văn');

  // ───────────────────────────── các pass ─────────────────────────────

  const passStructure = async () => {
    await mapPass('structure', allIdx, async (chunk, i) => {
      const text = await aiRead(`Đọc lượt 1 — cấu trúc (${chunkLabel(i)})`,
        `Bạn là nhà nghiên cứu văn học, đang đọc LƯỢT ĐẦU một tác phẩm để lập hồ sơ.
Nhiệm vụ: đọc ${multi ? 'ĐOẠN truyện' : 'truyện'} và ghi chú CẤU TRÚC — không phân tích sâu nhân vật ở lượt này.
${NO_FABRICATE}
${NO_USER_MIX}
${LANGUAGE_RULE}
CHỈ xuất đúng khối sau, mọi tag đóng, ngoài tag không viết gì:
<part>
<summary>3–6 gạch đầu dòng: đoạn thuộc chương/hồi nào (nếu truyện ghi), bối cảnh không-thời gian, ai xuất hiện, diễn biến chính, POV.</summary>
<terms>thuật ngữ riêng của thế giới xuất hiện trong đoạn, cách nhau dấu phẩy (không có thì để trống)</terms>
<main>tên nhân vật có vẻ là NHÂN VẬT CHÍNH dựa trên đoạn này (không chắc thì để trống)</main>
<unk>mỗi dòng một điều đoạn này nhắc tới nhưng CHƯA đủ dữ liệu để hiểu (không có thì để trống)</unk>
</part>`,
        `【${multi ? `Đoạn ${i + 1}/${chunks.length}` : 'Truyện'}】\n${chunk}`);
      const block = tag(text, 'part') || text;
      const summary = tag(block, 'summary');
      if (summary) {
        m.partNotes[i] = `【Đoạn ${i + 1}】\n${summary}`;
      }
      addUniqueLines(m.glossary, tag(block, 'terms').split(/[,，]/).map((s) => s.trim()), 300);
      const main = tag(block, 'main').trim();
      if (main && !hasCjk(main)) m.partNotes[i] = `${m.partNotes[i] ?? ''}\n(ứng viên chính: ${main})`;
      addUniqueLines(m.unknowns, tag(block, 'unk').split('\n').map((s) => s.replace(/^[-•+]\s*/, '')), 100);
    });
    // Reduce: gộp ghi chú từng đoạn thành TỔNG QUAN — nền cho mọi lượt sau.
    const notes = m.partNotes.filter(Boolean).join('\n\n');
    const text = await aiRead('Đọc lượt 1 — tổng hợp cấu trúc',
      `Bạn nhận ghi chú đọc lượt đầu của TỪNG ĐOẠN một tác phẩm. Hãy tổng hợp thành TỔNG QUAN CẤU TRÚC toàn truyện.
${NO_FABRICATE}
${LANGUAGE_RULE}
CHỈ xuất đúng khối:
<overview>8–15 gạch đầu dòng: thể loại + bầu không khí; bối cảnh không-thời gian; cấu trúc chương/hồi/tuyến truyện; POV; nhân vật chính THẬT của truyện và vì sao; các tuyến sự kiện lớn theo thứ tự; phong cách đặt tên/thuật ngữ.</overview>
<main>tên nhân vật chính</main>`,
      notes || '(không có ghi chú — truyện quá ngắn)');
    m.overview = tag(text, 'overview') || notes.slice(0, 3000);
    const main = tag(text, 'main').trim();
    if (main) m.mainCharacter = main;
    pass().done = pass().total;
  };

  const passRoster = async () => {
    const p = pass();
    p.total = chunks.length + 1;
    emit();
    const roster = await scanCharacters(story, profile, params, {
      chunkSize, maxChunks, includeIdentity: true, signal: opts.signal,
      onProgress: (d) => { p.done = Math.min(d, chunks.length); emit(); },
    });
    st.stats.aiCalls += chunks.length; // scanCharacters gọi AI theo chunk (xấp xỉ, đủ cho stat).
    // Phân vai + chốt nhân vật chính (đối chiếu với overview lượt 1).
    const text = await aiRead('Tổng hợp nhân vật — phân vai',
      `Từ TỔNG QUAN truyện và DANH SÁCH nhân vật đã quét, phân vai từng người và chốt NHÂN VẬT CHÍNH thật của truyện.
${NO_USER_MIX}
${NO_FABRICATE}
CHỈ xuất đúng khối:
<cast>
<c><name>tên đúng như danh sách</name><role>chính|phụ|quần chúng</role></c>
...
</cast>
<main>tên nhân vật chính</main>`,
      `【TỔNG QUAN】\n${capText(m.overview, 3000)}\n\n【DANH SÁCH】\n${roster.map((c) => `- ${c.name}${c.aliases.length ? ` (${c.aliases.join(', ')})` : ''}: ${c.brief}`).join('\n')}`);
    const roleMap = new Map<string, CharRole>();
    for (const c of allTags(tag(text, 'cast') || text, 'c')) {
      const n = normLine(tag(c, 'name'));
      const r = tag(c, 'role').trim() as CharRole;
      if (n && (r === 'chính' || r === 'phụ' || r === 'quần chúng')) roleMap.set(n, r);
    }
    const main = tag(text, 'main').trim();
    if (main) m.mainCharacter = main;
    m.characters = roster.map((c: ScannedCharacter) => {
      const existing = findDossier(m.characters, c.name);
      return {
        name: c.name, aliases: c.aliases, brief: c.brief,
        role: roleMap.get(normLine(c.name)) ?? (normLine(c.name) === normLine(m.mainCharacter) ? 'chính' : 'phụ'),
        facts: existing?.facts ?? [],
      };
    });
    p.done = p.total;
  };

  const rosterListForPrompt = () =>
    m.characters.slice(0, 80).map((c) => `- ${c.name}${c.aliases.length ? ` (bí danh: ${c.aliases.join(', ')})` : ''}`).join('\n');

  const mergeCharFacts = (block: string): number => {
    let added = 0;
    for (const cf of allTags(block, 'cf')) {
      const name = tag(cf, 'name').trim();
      if (!name) continue;
      let d = findDossier(m.characters, name);
      if (!d) {
        // Nhân vật lọt lưới roster — vẫn ghi nhận, hợp nhất về sau thay vì vứt dữ liệu.
        d = { name, aliases: [], role: 'quần chúng', brief: '', facts: [] };
        m.characters.push(d);
      }
      added += addUniqueLines(d.facts, allTags(cf, 'f'), 120);
    }
    return added;
  };

  const passCharacters = async () => {
    await mapPass('characters', allIdx, async (chunk, i) => {
      const text = await aiRead(`Phân tích nhân vật (${chunkLabel(i)})`,
        `Bạn đang đọc lại tác phẩm LƯỢT ${multi ? '3' : 'phân tích nhân vật'}: gom DỮ KIỆN cho TỪNG nhân vật trong danh sách.
Thông tin một nhân vật thường RẢI RÁC nhiều chương — nhiệm vụ của bạn là nhặt hết những gì đoạn này nói về họ.
Ghi các loại dữ kiện: ngoại hình; tuổi/giới tính; tính cách biểu hiện qua hành động; mục tiêu/động cơ; năng lực + điểm mạnh/yếu; CÁCH XƯNG HÔ và giọng điệu khi nói (kèm ví dụ ngắn); thói quen/sở thích; quan hệ với nhân vật khác (rõ quan hệ gì); biến cố quan trọng họ trải qua trong đoạn + hậu quả; thay đổi tâm lý so với trước.
Mỗi dữ kiện 1 dòng <f>, cụ thể, tự đứng được (nêu tên riêng, không viết "anh ấy").
${NO_FABRICATE}
${NO_USER_MIX}
${LANGUAGE_RULE}
CHỈ xuất đúng khối:
<facts>
<cf><name>tên đúng như danh sách</name><f>dữ kiện 1</f><f>dữ kiện 2</f></cf>
...
</facts>
<unk>mỗi dòng một điều về nhân vật mà đoạn nhắc nhưng không rõ (không có thì để trống)</unk>`,
        `【DANH SÁCH NHÂN VẬT】\n${rosterListForPrompt()}\n\n【${multi ? `Đoạn ${i + 1}/${chunks.length}` : 'Truyện'}】\n${chunk}`);
      st.stats.facts += mergeCharFacts(tag(text, 'facts') || text);
      addUniqueLines(m.unknowns, tag(text, 'unk').split('\n').map((s) => s.replace(/^[-•+]\s*/, '')), 100);
    });
  };

  const passWorld = async () => {
    await mapPass('world', allIdx, async (chunk, i) => {
      const text = await aiRead(`Thu thập thế giới (${chunkLabel(i)})`,
        `Bạn đang đọc lại tác phẩm để thu thập THIẾT LẬP THẾ GIỚI (worldbuilding) — mọi thứ KHÔNG phải diễn biến nhân vật.
Phân loại (cat): worldview (vũ trụ/bối cảnh vĩ mô) | system (hệ thống sức mạnh/tu luyện/kinh tế/chính trị, kèm cấp bậc) | mechanic (cơ chế vận hành cụ thể) | rule (luật lệ/quy tắc/lời nguyền + hệ quả vi phạm) | location (quốc gia/thành phố/địa danh/kiến trúc) | faction (phe phái/tổ chức/gia tộc/tôn giáo) | item (vật phẩm/trang bị/công nghệ) | history (sự kiện lịch sử/truyền thuyết/bí mật) | culture (văn hoá/phong tục/tôn giáo/tiền tệ/đơn vị đo/nghề nghiệp) | term (thuật ngữ riêng cần định nghĩa) | other.
topic = TÊN RIÊNG của thực thể/chủ đề (vd "Kiếm Tông", "Hệ thống linh căn"). Mỗi dữ kiện 1 dòng <f>, cụ thể (số liệu, cấp bậc, vị trí, quan hệ), tự đứng được.
${NO_FABRICATE}
${NO_USER_MIX}
${LANGUAGE_RULE}
CHỈ xuất đúng khối:
<world>
<wf><topic>tên chủ đề</topic><cat>system</cat><f>dữ kiện</f><f>dữ kiện</f></wf>
...
</world>
<unk>điều được nhắc nhưng chưa đủ dữ liệu (không có thì để trống)</unk>`,
        `【${multi ? `Đoạn ${i + 1}/${chunks.length}` : 'Truyện'}】\n${chunk}`);
      let added = 0;
      for (const wf of allTags(tag(text, 'world') || text, 'wf')) {
        const topic = tag(wf, 'topic').trim();
        const catRaw = tag(wf, 'cat').trim().toLowerCase() as WorldCat;
        const cat = CAT_SET.includes(catRaw) ? catRaw : 'other';
        if (!topic) continue;
        for (const f of allTags(wf, 'f')) {
          const fact = f.trim();
          if (!fact) continue;
          if (m.worldFacts.some((x) => normLine(x.topic) === normLine(topic) && normLine(x.fact) === normLine(fact))) continue;
          // (bug 163) Trần này chặn số CHỦ ĐỀ thế giới, mà chủ đề là nguồn entry lớn nhất (đo
          // được: 503 chủ đề → 400+ entry). Truyện thật 48 đoạn đã lên 1851/2000, tức truyện dài
          // hơn là chạm trần và mất dữ kiện âm thầm. Nâng lên 5000 và ghi lại khi chạm.
          if (m.worldFacts.length >= 5000) {
            if (!capHit.world) { capHit.world = true; capNotices.push('Đã chạm trần 5000 dữ kiện thế giới — truyện quá lớn, phần sau không được thu thập thêm.'); }
            break;
          }
          m.worldFacts.push({ topic, cat, fact });
          added++;
        }
      }
      st.stats.facts += added;
      addUniqueLines(m.unknowns, tag(text, 'unk').split('\n').map((s) => s.replace(/^[-•+]\s*/, '')), 100);
    });
  };

  const passTimeline = async () => {
    await mapPass('timeline', allIdx, async (chunk, i) => {
      const text = await aiRead(`Dựng timeline (${chunkLabel(i)})`,
        `Bạn đang đọc lại tác phẩm để dựng DÒNG THỜI GIAN chi tiết.
Ghi MỌI sự kiện đáng kể theo đúng trình tự trong đoạn: ai làm gì, ở đâu, gặp ai, hậu quả gì.
MỐC THỜI GIAN: truyện ghi ngày/tháng/năm/mùa/giờ thì chép CHÍNH XÁC; không ghi thì dùng mốc TƯƠNG ĐỐI nhất quán ("Ngày 1", "3 ngày sau", "Sau sự kiện X") — TUYỆT ĐỐI không bịa ngày cụ thể. Không xác định nổi thì dùng "?".
${NO_FABRICATE}
${NO_USER_MIX}
${LANGUAGE_RULE}
CHỈ xuất đúng khối:
<tl>
<ev><time>mốc thời gian</time><f>ai làm gì, ở đâu, hậu quả</f></ev>
...
</tl>`,
        `【${multi ? `Đoạn ${i + 1}/${chunks.length}` : 'Truyện'}】\n${chunk}`);
      const evs: TimelineEvent[] = [];
      for (const ev of allTags(tag(text, 'tl') || text, 'ev')) {
        const time = tag(ev, 'time').trim() || '?';
        const what = tag(ev, 'f').trim();
        if (!what) continue;
        if (m.timeline.some((x) => normLine(x.what) === normLine(what))) continue;
        evs.push({ time, what, chunk: i });
      }
      m.timeline.push(...evs);
      // Chunk chạy song song nhưng thứ tự đọc = thứ tự chunk → sort ổn định theo chunk.
      m.timeline.sort((a, b) => a.chunk - b.chunk);
      st.stats.facts += evs.length;
    });
  };

  const passStyle = async () => {
    // Học văn phong không cần cả truyện — mẫu đầu / giữa / cuối là đủ đại diện.
    const sample = chunks.length <= 3 ? allIdx : [0, Math.floor(chunks.length / 2), chunks.length - 1];
    await mapPass('style', sample, async (chunk, i) => {
      const text = await aiRead(`Học văn phong (${chunkLabel(i)})`,
        `Bạn là nhà phê bình văn học. Phân tích VĂN PHONG tác giả từ đoạn trích — KHÔNG phân tích nội dung.
Soi từng mặt: cấu trúc câu (dài/ngắn, đảo, điệp); nhịp kể + tốc độ; mật độ + kiểu miêu tả (thị giác? cảm giác?); cách dựng hội thoại + khẩu khí nhân vật; từ ngữ/thành ngữ đặc trưng; sắc thái cảm xúc chủ đạo; mức hài hước vs nghiêm túc; cách đẩy cao trào; cách miêu tả nội tâm; cách giới thiệu nhân vật mới. Mỗi nhận xét 1 dòng <s>, kèm VÍ DỤ NGẮN trích từ đoạn (dịch sang tiếng Việt nếu truyện gốc tiếng nước ngoài).
${NO_FABRICATE}
${LANGUAGE_RULE}
CHỈ xuất đúng khối:
<style>
<s>nhận xét + ví dụ</s>
...
</style>`,
        `【Đoạn trích】\n${chunk.slice(0, 30000)}`);
      st.stats.facts += addUniqueLines(m.styleNotes, allTags(tag(text, 'style') || text, 's'), 60);
    });
  };

  const passVerify = async () => {
    const maxRounds = opts.maxVerifyRounds ?? 2;
    const p = pass();
    for (;;) {
      checkAbort();
      const round = st.verifyRound + 1;
      if (round > maxRounds) break;
      p.round = round;
      let roundNew = 0;
      const digest = buildMemoryDigest(m);
      const key = `verify${round}`;
      await mapPass(key, allIdx, async (chunk, i) => {
        const text = await aiRead(`Đối chiếu vòng ${round} (${chunkLabel(i)})`,
          `Bạn đang ở LƯỢT ĐỌC ĐỐI CHIẾU vòng ${round}: so sánh đoạn truyện với BỘ NHỚ nghiên cứu hiện có.
CHỈ báo những gì bộ nhớ CHƯA CÓ hoặc GHI SAI — không lặp lại điều đã có. Đối chiếu cả thông tin ở đoạn này với những gì các chương khác đã ghi để phát hiện mâu thuẫn/hiểu sai.
${NO_FABRICATE}
${NO_USER_MIX}
${LANGUAGE_RULE}
CHỈ xuất đúng khối (không có gì mới thì xuất <none/>):
<delta>
<cf><name>tên nhân vật</name><f>dữ kiện MỚI</f></cf>
<wf><topic>chủ đề</topic><cat>system</cat><f>dữ kiện MỚI</f></wf>
<ev><time>mốc</time><f>sự kiện MỚI</f></ev>
<fix>bộ nhớ ghi sai chỗ nào + bản đúng theo truyện</fix>
<unk>dữ liệu chưa xác định</unk>
</delta>`,
          `【BỘ NHỚ HIỆN CÓ】\n${digest}\n\n【${multi ? `Đoạn ${i + 1}/${chunks.length}` : 'Truyện'}】\n${chunk}`);
        const block = tag(text, 'delta') || text;
        let added = mergeCharFacts(block);
        for (const wf of allTags(block, 'wf')) {
          const topic = tag(wf, 'topic').trim();
          const catRaw = tag(wf, 'cat').trim().toLowerCase() as WorldCat;
          const cat = CAT_SET.includes(catRaw) ? catRaw : 'other';
          for (const f of allTags(wf, 'f')) {
            const fact = f.trim();
            if (!topic || !fact) continue;
            if (m.worldFacts.some((x) => normLine(x.topic) === normLine(topic) && normLine(x.fact) === normLine(fact))) continue;
            m.worldFacts.push({ topic, cat, fact });
            added++;
          }
        }
        for (const ev of allTags(block, 'ev')) {
          const what = tag(ev, 'f').trim();
          if (!what || m.timeline.some((x) => normLine(x.what) === normLine(what))) continue;
          m.timeline.push({ time: tag(ev, 'time').trim() || '?', what, chunk: i });
          m.timeline.sort((a, b) => a.chunk - b.chunk);
          added++;
        }
        addUniqueLines(m.corrections, allTags(block, 'fix'), 100);
        addUniqueLines(m.unknowns, allTags(block, 'unk'), 100);
        roundNew += added;
        st.stats.facts += added;
      });
      st.verifyRound = round;
      log(`Vòng đối chiếu ${round}: +${roundNew} dữ kiện mới.`);
      emit();
      // Hết thông tin mới (≤2 dữ kiện lặt vặt cả vòng) → tác phẩm đã "vắt kiệt", dừng sớm.
      if (roundNew <= 2) break;
    }
  };

  // ─── synthesize: bộ nhớ → entries + card ───

  // (bug 158) `kind` để biết job nào PHẢI ra entry — job thẻ nhân vật thì không, nên không
  // được đem ra bắt lỗi "0 entry".
  interface SynthJob { label: string; kind: 'entries' | 'card'; run: () => Promise<void>; }
  /** Job đáng lẽ phải ra entry mà trắng tay — nêu đích danh trong báo cáo. */
  const emptySynthJobs: string[] = [];

  const ENTRY_CATS: EntryCat[] = ['meta', 'worldview', 'system', 'mechanic', 'rule', 'character', 'faction', 'location', 'item', 'history', 'culture', 'term', 'timeline', 'style', 'other'];
  const parseEntries = (text: string, fallbackCat: EntryCat): DeepEntry[] =>
    splitEntryBlocks(tag(text, 'entries') || text).map((e) => {
      const catRaw = tag(e, 'cat').trim().toLowerCase() as EntryCat;
      const cat: EntryCat = ENTRY_CATS.includes(catRaw) ? catRaw : fallbackCat;
      return {
        cat,
        title: tag(e, 'title').trim(),
        keys: tag(e, 'keys').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        content: tag(e, 'content').trim(),
        constant: entryPlacement(cat).constant,
      };
    }).filter((e) => e.title && e.content);

  const FORMAT_RULE = `TRÌNH BÀY (bắt buộc): CẤM wall-of-text — chia ý bằng gạch đầu dòng (-, +); **in đậm** danh từ riêng/khái niệm/cấp bậc; văn phong DATABASE khách quan (không so sánh tu từ, không tính từ sáo rỗng); nội dung mỗi entry bọc trong đúng MỘT thẻ phân loại dạng <Character>…</Character>, <System>…</System>, <Mechanic>…</Mechanic>, <Rule>…</Rule>, <Location>…</Location>, <Faction>…</Faction>, <Worldview>…</Worldview>, <Timeline>…</Timeline>, <Item>…</Item>, <Culture>…</Culture>, <Term>…</Term> (thẻ này nằm BÊN TRONG <content>).`;
  const KEY_RULE = 'keys = mọi cách gọi có thể kích hoạt entry: tên đầy đủ, tên ngắn, bí danh, danh hiệu, chức vụ — cách nhau dấu phẩy; các entry liên quan nên nhắc TÊN của nhau trong nội dung để liên kết ngữ nghĩa.';

  const catTagName: Partial<Record<EntryCat, string>> = {
    system: 'System', mechanic: 'Mechanic', rule: 'Rule', location: 'Location',
    faction: 'Faction', item: 'Item', history: 'Timeline', culture: 'Culture', term: 'Term', other: 'Term',
  };

  const synthEntries: DeepEntry[] = [];
  const synthCards: DeepCardResult[] = [];

  const buildSynthJobs = (): SynthJob[] => {
    const jobs: SynthJob[] = [];
    const nsfwRule = opts.nsfw ? NSFW_RULE : SFW_RULE;

    // 1) Thế giới quan + Meta (chuẩn Bước 1 của quy trình worldbook user cung cấp).
    jobs.push({
      kind: 'entries',
      label: 'Entry Thế giới quan + Meta',
      run: async () => {
        const wvFacts = m.worldFacts.filter((f) => f.cat === 'worldview' || f.cat === 'history');
        const text = await ai('Tổng hợp — Thế giới quan + Meta',
          `Từ hồ sơ nghiên cứu, tạo ĐÚNG 2 entry nền tảng cho lorebook SillyTavern: THẾ GIỚI QUAN và META_SETUP.
Entry 1 (cat=worldview, title="Thế Giới Quan"): nội dung bọc <Worldview>: **Khái niệm vũ trụ**, **Bối cảnh thời đại**, **Luật lệ tự nhiên cốt lõi** — chỉ vĩ mô, CẤM liệt kê nhân vật/hệ thống/khu vực chi tiết.
Entry 2 (cat=meta, title="META_SETUP"): nội dung bọc <Meta>: quy tắc biến số <user> là THỰC THỂ VÔ ĐỊNH tồn tại song song với nhân vật chính "${m.mainCharacter}" của truyện — <user> KHÔNG PHẢI ${m.mainCharacter}; cấm AI tự phác hoạ ngoại hình/tính cách cho <user>.
${MISSION_RULE}
${QUALITY_RULE}
${FORMAT_RULE}
${LANGUAGE_RULE}
${nsfwRule}
CHỈ xuất đúng khối:
<entries>
<entry><cat>worldview</cat><title>Thế Giới Quan</title><keys></keys><content>…</content></entry>
<entry><cat>meta</cat><title>META_SETUP</title><keys></keys><content>…</content></entry>
</entries>`,
          `【TỔNG QUAN】\n${capText(m.overview, 4000)}\n\n【DỮ KIỆN VĨ MÔ】\n${wvFacts.map((f) => `- [${f.topic}] ${f.fact}`).join('\n') || '(ít dữ kiện — dựa vào tổng quan)'}`);
        synthEntries.push(...parseEntries(text, 'worldview'));
      },
    });

    // 2) Nhân vật — MỖI NHÂN VẬT CÓ DỮ KIỆN một entry riêng, gộp theo lô để tiết kiệm call.
    // (bug 163) Trần 60 nhân vật là quá chặt và cắt ÂM THẦM. Đo trên truyện thật (11 triệu ký tự,
    // 48 đoạn): gom được 153 nhân vật CÓ dữ kiện, tổng hợp chỉ lấy 60 → 93 nhân vật bị bỏ mà không
    // một dòng nào nói ra. User lấy mốc "truyện lớn thì phải trên 500 entry" nên cắt như vậy là
    // chặn đúng thứ họ đang đo. Nâng lên 200 (đủ cho dàn nhân vật của truyện dài), và nếu vẫn phải
    // cắt thì NÓI RA trong báo cáo.
    const CHAR_CAP = 200;
    const allWithFacts = m.characters.filter((c) => c.facts.length > 0);
    const withFacts = allWithFacts.slice(0, CHAR_CAP);
    if (allWithFacts.length > CHAR_CAP) {
      capNotices.push(`Chỉ tổng hợp ${CHAR_CAP}/${allWithFacts.length} nhân vật có dữ kiện (trần an toàn) — ${allWithFacts.length - CHAR_CAP} nhân vật phụ bị lược.`);
    }
    const CHAR_BATCH = 4;
    for (let b = 0; b < withFacts.length; b += CHAR_BATCH) {
      const batch = withFacts.slice(b, b + CHAR_BATCH);
      jobs.push({
        kind: 'entries',
        label: `Entry nhân vật: ${batch.map((c) => c.name).join(', ')}`,
        run: async () => {
          const dossiers = batch.map((c) =>
            `### ${c.name}${c.aliases.length ? ` (bí danh: ${c.aliases.join(', ')})` : ''} — vai ${c.role}\n${c.brief ? `${c.brief}\n` : ''}${c.facts.map((f) => `- ${f}`).join('\n')}`).join('\n\n');
          const text = await ai(`Tổng hợp entry nhân vật (${batch[0].name}…)`,
            `Từ HỒ SƠ DỮ KIỆN đã gom qua nhiều lượt đọc, viết MỘT entry lorebook CỰC KỲ CHI TIẾT cho TỪNG nhân vật dưới đây (cat=character, title=tên nhân vật).
Nội dung bọc <Character>, gồm: **Tên** + bí danh/danh hiệu; chủng tộc/thế lực; thân thế/vị trí; tuổi/giới tính; **Ngoại hình** (chỉ ĐẶC ĐIỂM nhận diện — không mỹ từ sáo rỗng); **Tính cách** + mục tiêu/động cơ; **Năng lực** (điểm mạnh/yếu, mô tả hiệu ứng bề ngoài); **Cách xưng hô & giọng điệu** (từ ngữ đặc trưng, ví dụ ngắn); thói quen/sở thích; **Quan hệ** với các nhân vật khác (nêu đích danh); **Phát triển qua các giai đoạn truyện** (biến cố quan trọng + thay đổi tâm lý, theo trình tự).
Thông tin rải rác ở nhiều chương ĐÃ được gom sẵn trong hồ sơ — tổng hợp thành bức tranh HOÀN CHỈNH, mâu thuẫn thì ghi cả hai kèm "(mâu thuẫn giữa các chương)".
${NO_USER_MIX}
${MISSION_RULE}
${QUALITY_RULE}
${KEY_RULE}
${FORMAT_RULE}
${LANGUAGE_RULE}
${nsfwRule}
CHỈ xuất đúng khối:
<entries>
<entry><cat>character</cat><title>Tên</title><keys>tên, bí danh, danh hiệu</keys><content><Character>…</Character></content></entry>
…(một entry cho MỖI nhân vật trong hồ sơ)
</entries>`,
            dossiers);
          synthEntries.push(...parseEntries(text, 'character'));
        },
      });
    }

    // 3) Thế giới — theo cụm chủ đề (mỗi cat một lô, cat nhiều topic thì chia nhỏ).
    const groups = groupWorldFacts(m.worldFacts.filter((f) => f.cat !== 'worldview'));
    const byCat = new Map<WorldCat, typeof groups>();
    for (const g of groups) {
      const list = byCat.get(g.cat) ?? [];
      list.push(g);
      byCat.set(g.cat, list);
    }
    for (const [cat, list] of byCat) {
      const TOPIC_BATCH = 8;
      for (let b = 0; b < list.length; b += TOPIC_BATCH) {
        const batch = list.slice(b, b + TOPIC_BATCH);
        jobs.push({
          kind: 'entries',
          label: `Entry thế giới [${cat}] (${batch.length} chủ đề)`,
          run: async () => {
            const entryCat: EntryCat = cat === 'history' ? 'history' : cat === 'term' ? 'term' : cat === 'culture' ? 'culture'
              : cat === 'item' ? 'item' : cat === 'faction' ? 'faction' : cat === 'location' ? 'location'
              : cat === 'rule' ? 'rule' : cat === 'mechanic' ? 'mechanic' : cat === 'system' ? 'system' : 'other';
            const tagName = catTagName[entryCat] ?? 'Term';
            const text = await ai(`Tổng hợp entry thế giới [${cat}]`,
              `Từ dữ kiện đã gom, viết entry lorebook cho TỪNG CHỦ ĐỀ dưới đây (cat=${entryCat}). Mỗi chủ đề MỘT entry riêng — không gộp nhiều chủ đề vào một entry.
Nội dung bọc <${tagName}>: tổng hợp MỌI dữ kiện của chủ đề thành mô tả có cấu trúc (bản chất cốt lõi; cấu trúc/cấp bậc nếu có; quan hệ với chủ đề/nhân vật khác — nêu đích danh để liên kết). Chủ đề chỉ có 1 dòng lặt vặt thì GỘP vào entry cùng loại gần nhất — không bỏ mất dữ kiện.
${MISSION_RULE}
${QUALITY_RULE}
${KEY_RULE}
${FORMAT_RULE}
${LANGUAGE_RULE}
${nsfwRule}
CHỈ xuất đúng khối:
<entries>
<entry><cat>${entryCat}</cat><title>Tên chủ đề</title><keys>tên, cách gọi khác</keys><content><${tagName}>…</${tagName}></content></entry>
…
</entries>`,
              batch.map((g) => `### ${g.topic}\n${g.facts.map((f) => `- ${f}`).join('\n')}`).join('\n\n'));
            synthEntries.push(...parseEntries(text, entryCat));
          },
        });
      }
    }

    // 4) Timeline — chuẩn Bước 5 (cảnh báo hiệu ứng cánh bướm ở batch đầu).
    if (m.timeline.length > 0) {
      const EV_BATCH = 60;
      const evChunks: TimelineEvent[][] = [];
      for (let b = 0; b < m.timeline.length; b += EV_BATCH) evChunks.push(m.timeline.slice(b, b + EV_BATCH));
      evChunks.forEach((evs, bi) => {
        jobs.push({
          kind: 'entries',
          label: `Entry timeline (phần ${bi + 1}/${evChunks.length})`,
          run: async () => {
            const text = await ai(`Tổng hợp timeline (${bi + 1}/${evChunks.length})`,
              `Từ nhật ký sự kiện đã gom, viết entry DÒNG THỜI GIAN (cat=timeline, title="Dòng Thời Gian${evChunks.length > 1 ? ` — Phần ${bi + 1}` : ''}").
Nội dung bọc <Timeline>; ${bi === 0 ? 'MỞ ĐẦU bằng nguyên văn: "[CẢNH BÁO HỆ THỐNG - HIỆU ỨNG CÁNH BƯỚM]: Dòng thời gian gốc dưới đây CHỈ MANG TÍNH CHẤT THAM KHẢO. Khi biến số <user> chính thức giáng lâm và có bất kỳ hành động tương tác nào, Timeline gốc này sẽ ngay lập tức bị phá vỡ. Mọi sự kiện tương lai sẽ rẽ nhánh, bóp méo và thay đổi hoàn toàn dựa trên quỹ đạo hành động của <user>, vô hiệu hóa định mệnh đã được sắp đặt sẵn của thế giới này."; sau đó ' : ''}mỗi sự kiện dạng "- **[Mốc thời gian]** — <Event>ai làm gì, ở đâu, gặp ai, hậu quả</Event>" theo ĐÚNG trình tự.
Mốc thời gian: giữ nguyên mốc truyện ghi; mốc tương đối ("Ngày 1", "Sau sự kiện X") phải NHẤT QUÁN; "?" thì suy mốc tương đối từ ngữ cảnh, KHÔNG bịa ngày cụ thể.
${MISSION_RULE}
${QUALITY_RULE}
${FORMAT_RULE}
${LANGUAGE_RULE}
CHỈ xuất đúng khối:
<entries>
<entry><cat>timeline</cat><title>Dòng Thời Gian${evChunks.length > 1 ? ` — Phần ${bi + 1}` : ''}</title><keys></keys><content><Timeline>…</Timeline></content></entry>
</entries>`,
              evs.map((e) => `- [${e.time}] ${e.what}`).join('\n'));
            synthEntries.push(...parseEntries(text, 'timeline'));
          },
        });
      });
    }

    // 5) Style Profile — (bug 150) "Học văn phong" thành sản phẩm THẬT: entry constant.
    if (opts.learnStyle !== false && m.styleNotes.length > 0) {
      jobs.push({
        kind: 'entries',
        label: 'Entry Style Profile (văn phong tác giả)',
        run: async () => {
          const text = await ai('Tổng hợp Style Profile',
            `Từ các ghi chú phân tích văn phong (mẫu đầu/giữa/cuối truyện), viết STYLE PROFILE hoàn chỉnh (cat=style, title="Văn Phong Tác Giả").
Nội dung: 10–18 gạch đầu dòng CHỈ DẪN để một AI khác viết tiếp GẦN GIỌNG nguyên tác — cấu trúc câu, nhịp kể, tốc độ, cách miêu tả, cách dựng hội thoại, từ ngữ đặc trưng, sắc thái cảm xúc, mức hài hước/nghiêm túc, cách đẩy cao trào, cách tả nội tâm, cách xây dựng nhân vật. Mỗi ý kèm ví dụ ngắn.
${MISSION_RULE}
${QUALITY_RULE}
${LANGUAGE_RULE}
CHỈ xuất đúng khối:
<entries>
<entry><cat>style</cat><title>Văn Phong Tác Giả</title><keys></keys><content>[Văn phong tác giả — bám theo khi kể chuyện]\n…</content></entry>
</entries>`,
            m.styleNotes.map((s) => `- ${s}`).join('\n'));
          synthEntries.push(...parseEntries(text, 'style'));
        },
      });
    }

    // 5b) (bug 158) BÍ ẨN → ENTRY, không phải sọt rác.
    // Trong bằng chứng user, 59 dòng nằm dưới nhãn "❓ Chưa xác định" hoá ra là entry hoàn chỉnh
    // ("Wright: Lão già say khướt làm chủ quán rượu 'Chó Săn', người giữ vai trò chỉ điểm…").
    // Chúng bị chôn ở đó thay vì thành lore. User nói thẳng: truyện giữ bí mật thì cứ ghi nhận
    // đó là bí mật rồi VẪN tạo entry. Nên đây là nguồn tư liệu, không phải danh sách từ chối.
    if (m.unknowns.length > 0) {
      const UNK_BATCH = 25;
      for (let b = 0; b < m.unknowns.length; b += UNK_BATCH) {
        const batch = m.unknowns.slice(b, b + UNK_BATCH);
        jobs.push({
          kind: 'entries',
          label: `Entry bí ẩn & thông tin chưa tiết lộ (${batch.length} mục)`,
          run: async () => {
            const text = await ai('Tổng hợp entry bí ẩn / chưa tiết lộ',
              `Dưới đây là những ghi chép mà lượt đọc trước xếp vào diện "chưa xác định". Phần lớn THỰC RA là tri thức dùng được — hoặc là một thực thể đã có đủ mô tả, hoặc là một bí ẩn mà chính truyện cố ý chưa tiết lộ.
Nhiệm vụ: biến chúng thành entry lorebook.
- Ghi chép đã đủ tả một thực thể (nhân vật, nơi chốn, tổ chức, vật phẩm, thuật ngữ…) ⇒ tạo entry ĐÚNG loại đó, viết như tri thức bình thường.
- Là bí ẩn/điều truyện chưa giải thích ⇒ vẫn tạo entry (cat=term), nêu rõ đây là điều CHƯA ĐƯỢC TIẾT LỘ tính đến thời điểm đó, kèm mọi manh mối truyện đã đưa. Đây là lore hợp lệ, người nhập vai cần biết là "chưa ai biết".
- Chỉ BỎ những dòng thuần kỹ thuật (lỗi định dạng, ghi chú của công cụ) — không bỏ vì "thiếu dữ kiện".
${MISSION_RULE}
${QUALITY_RULE}
${KEY_RULE}
${FORMAT_RULE}
${LANGUAGE_RULE}
${nsfwRule}
CHỈ xuất đúng khối:
<entries>
<entry><cat>character|location|faction|item|term|rule|other</cat><title>Tên</title><keys>…</keys><content><Term>…</Term></content></entry>
</entries>`,
              batch.map((u) => `- ${u}`).join('\n'));
            synthEntries.push(...parseEntries(text, 'term'));
          },
        });
      }
    }

    // 6) Character Card(s).
    if (opts.makeCard !== false) {
      const wanted = (opts.cardCharacters?.length ? opts.cardCharacters : [m.mainCharacter]).filter(Boolean);
      const uName = opts.userReplaceName?.trim();
      for (const name of wanted) {
        jobs.push({
          kind: 'card',
          label: `Character Card: ${name}`,
          run: async () => {
            try {
              const d = findDossier(m.characters, name);
              if (uName && normLine(uName) === normLine(name)) {
                synthCards.push({ name, error: `"${name}" đang được đặt làm {{user}} nên không tạo thẻ cho chính người chơi.` });
                return;
              }
              const userRule = uName
                ? `Người dùng CHỦ ĐỘNG nhập vai: nhân vật "${uName}" trong truyện chính là {{user}} — mọi chỗ nhắc "${uName}" phải viết {{user}}, không để hai người gặp nhau.${opts.userSetup?.trim() ? ` Thiết lập thêm về {{user}}: ${opts.userSetup.trim()}` : ''}`
                : `{{user}} là NGƯỜI MỚI bước vào thế giới của truyện, KHÔNG phải bất kỳ nhân vật nào có sẵn (đặc biệt KHÔNG phải nhân vật chính "${m.mainCharacter}"). Không gán vai nhân vật trong truyện cho {{user}}.`;
              const system = `Bạn là chuyên gia viết THẺ NHÂN VẬT SillyTavern chất lượng cao từ HỒ SƠ NGHIÊN CỨU tác phẩm.
Viết thẻ HOÀN CHỈNH cho nhân vật "${name}".
- ${userRule}
${opts.extraNotes?.trim() ? `- Yêu cầu thêm: ${opts.extraNotes.trim()}\n` : ''}${MISSION_RULE}
${QUALITY_RULE}
${LANGUAGE_RULE}
${opts.nsfw ? NSFW_RULE : SFW_RULE}
CHỈ xuất đúng khối, mọi tag đóng, ngoài tag không viết gì:
<card>
<name>Tên nhân vật</name>
<basic>Thông tin cơ bản (gạch đầu dòng): ngoại hình nhận diện, xuất thân, năng lực, vai trò trong truyện.</basic>
<persona>Tính cách + cách cư xử với {{user}}, chia 3 giai đoạn quan hệ:
[Sơ giao 0–30] … [Quen thân 31–70] … [Thân mật 71–100] … [Xuyên suốt] …</persona>
<scenario>Bối cảnh {{char}} gặp/tương tác với {{user}} — bám thế giới của truyện (2–4 câu).</scenario>
<first_mes>Lời mở màn nhập vai của {{char}} với {{user}} — hành động *nghiêng*, lời thoại đúng giọng nhân vật, không thay lời {{user}}.</first_mes>
</card>`;
              const userMsg = `【HỒ SƠ NHÂN VẬT】\n${d ? `${d.name} (${d.aliases.join(', ')}) — vai ${d.role}\n${d.facts.map((f) => `- ${f}`).join('\n')}` : `(chưa có hồ sơ — dựa vào tổng quan)`}\n\n【TỔNG QUAN TRUYỆN】\n${capText(m.overview, 3000)}\n\n【VĂN PHONG】\n${m.styleNotes.slice(0, 8).map((s) => `- ${s}`).join('\n') || '(không có)'}`;
              let text = await ai(`Tạo thẻ: ${name}`, system, userMsg);
              // Chốt chặn chữ Hán sót (một lượt sửa — như pipeline cũ).
              const blk = tag(text, 'card') || text;
              const rep = scanCjkResidue({
                'Tên': tag(blk, 'name'), 'Thông tin cơ bản': tag(blk, 'basic'),
                'Tính cách': tag(blk, 'persona'), 'Bối cảnh': tag(blk, 'scenario'), 'Lời mở đầu': tag(blk, 'first_mes'),
              });
              if (!rep.clean) {
                const fixed = await ai(`Tạo thẻ: ${name} (dịch nốt chữ Hán)`, system, `${userMsg}\n\n${buildCjkRetryHint(rep)}\n\n【BẢN NHÁP CẦN SỬA】\n${text}`);
                if (fixed.trim()) text = fixed;
              }
              const block = tag(text, 'card') || text;
              let card: GeneratedStoryCard = {
                name: tag(block, 'name') || name,
                description: [tag(block, 'basic'), tag(block, 'persona')].filter(Boolean).join('\n\n'),
                personality: '',
                scenario: tag(block, 'scenario'),
                firstMes: tag(block, 'first_mes'),
                worldEntries: [],
                raw: text,
              };
              if (uName) card = applyUserPersonaSwap(card, uName, []).card;
              synthCards.push({ name, card });
            } catch (e) {
              if (isAbortErr(e)) throw e;
              synthCards.push({ name, error: e instanceof Error ? e.message : String(e) });
            }
          },
        });
      }
    }
    return jobs;
  };

  const passSynthesize = async () => {
    const jobs = buildSynthJobs();
    const p = pass();
    p.total = jobs.length;
    p.done = 0;
    emit();
    // (bug 158) Job KHÔNG ra entry nào thì KHÔNG phải thành công.
    // Bản cũ cứ `p.done++` bất kể job có sinh gì hay không, nên 54 job trả 0 entry vẫn hiện
    // "54/54 ✅" rồi kết thúc bằng "Thêm 0 entry vào Lorebook" — hỏng mà không ai biết hỏng ở đâu.
    // Chạy lại MỘT lần (lấy mẫu khác thường là ra), vẫn trắng thì ghi tên job vào báo cáo.
    await runPool(jobs, Math.min(conc, jobs.length), async (job) => {
      checkAbort();
      log(job.label);
      const before = synthEntries.length;
      // (bug 163) Job tổng hợp hỏng cũng KHÔNG được giết cả pass — cùng lý do như mapPass: một lỗi
      // tạm thời (429/timeout) ở job thứ 40 sẽ vứt luôn 39 job đã chạy xong trước đó.
      const tryRun = async (): Promise<boolean> => {
        try { await job.run(); return true; } catch (e) {
          if (isAbortErr(e)) throw e;
          log(`⚠️ ${job.label} — lỗi: ${e instanceof Error ? e.message : String(e)}`);
          chunkFailures.push(`${job.label}: ${e instanceof Error ? e.message : String(e)}`);
          return false;
        }
      };
      const ok = await tryRun();
      if (job.kind === 'entries' && synthEntries.length === before) {
        log(`↻ ${job.label} — ${ok ? 'không ra entry nào' : 'lỗi'}, thử lại`);
        checkAbort();
        await tryRun();
        if (synthEntries.length === before) {
          emptySynthJobs.push(job.label);
          log(`⚠️ ${job.label} — vẫn không ra entry sau khi thử lại`);
        }
      }
      p.done++;
      st.stats.entries = synthEntries.length;
      emit();
    });
  };

  const passQuality = async () => {
    const p = pass();
    p.total = 2;
    p.done = 0;
    emit();
    const report: string[] = [];

    // (a) Khử trùng lặp bằng máy — key overlap + content fingerprint (tái dùng deduplicator).
    const kept: DeepEntry[] = [];
    const asLb = (e: DeepEntry, i: number) => toLorebookEntry(e, i);
    for (const e of synthEntries) {
      const existing = kept.map(asLb);
      const byTitle = kept.find((k) => k.cat === e.cat && normLine(k.title) === normLine(e.title));
      if (byTitle) {
        // Cùng cat + cùng tên → một thực thể bị hai lô cùng viết. Giữ bản dài hơn, gộp keys.
        if (e.content.length > byTitle.content.length) byTitle.content = e.content;
        byTitle.keys = [...new Set([...byTitle.keys, ...e.keys])];
        report.push(`Gộp entry trùng tên: "${e.title}" [${e.cat}]`);
        continue;
      }
      const keyDup = e.keys.length ? checkKeyOverlap(e.keys, existing) : { isDuplicate: false as const, conflictWith: undefined };
      const contentDup = checkContentSimilarity(e.content, existing);
      if (keyDup.isDuplicate || contentDup.isDuplicate) {
        report.push(`Bỏ entry trùng lặp: "${e.title}" (đụng "${keyDup.conflictWith ?? contentDup.conflictWith}")`);
        continue;
      }
      kept.push({ ...e });
    }
    p.done = 1;
    emit();

    // (b) Một lượt AI soát MÂU THUẪN giữa các entry (tên gọi lệch nhau, số liệu vênh, quan hệ ngược).
    // (bug 163) Không entry nào thì KHÔNG gọi AI: soát mâu thuẫn giữa số không entry là vô nghĩa,
    // và nó chính là lượt đã ném ra lỗi 400 trong log của user. Bỏ qua ở đây không giấu chuyện gì
    // — chốt chặn ngay bên dưới mới là chỗ nói thẳng "0 entry là hỏng".
    if (kept.length === 0) report.push('(bỏ qua lượt soát nhất quán: chưa có entry nào để soát)');
    else try {
      const digest = kept.map((e) => `- [${e.cat}] ${e.title}: ${capText(e.content.replace(/\s+/g, ' '), 300)}`).join('\n');
      const text = await ai('Kiểm tra tính nhất quán',
        `Bạn soát LẦN CUỐI bộ lorebook vừa tổng hợp từ một tác phẩm. Tìm MÂU THUẪN giữa các entry: cùng thực thể nhưng tên/số liệu/quan hệ vênh nhau; sự kiện timeline ngược thứ tự; nhân vật được mô tả trái ngược không có ghi chú.
CHỈ nêu vấn đề THẬT — không có thì xuất <none/>. Mỗi vấn đề 1 dòng <issue>, nêu đích danh entry.
CHỈ xuất: <issues><issue>…</issue>…</issues> hoặc <none/>`,
        capText(digest, 40000));
      const issues = allTags(tag(text, 'issues') || text, 'issue');
      for (const it of issues) report.push(`⚠ Mâu thuẫn: ${it}`);
      addUniqueLines(m.corrections, issues, 100);
    } catch (e) {
      if (isAbortErr(e)) throw e;
      report.push(`(bỏ qua lượt soát nhất quán: ${e instanceof Error ? e.message : String(e)})`);
    }
    p.done = 2;

    // (bug 158) CHỐT CHẶN CUỐI: có dữ kiện mà không ra entry nào là HỎNG, không phải "xong".
    // Lần chạy user gửi kết thúc với 1.831 dữ kiện · 0 entry mà mọi giai đoạn vẫn xanh — không
    // có chỗ nào nói cho họ biết là hỏng. Nói thẳng ra, kèm tên job trắng tay để lần sau còn dò.
    const factCount = m.characters.reduce((n, c) => n + c.facts.length, 0)
      + m.worldFacts.length + m.timeline.length;
    report.unshift(...buildYieldWarnings(kept.length, factCount, emptySynthJobs));
    // (bug 163) Phần bị bỏ qua vì lỗi phải NÓI RA. Bỏ qua âm thầm thì user cầm một bản lorebook
    // thiếu mà tưởng là đủ — đúng kiểu lỗi im lặng tệ nhất.
    if (chunkFailures.length) {
      report.unshift(`⚠️ ${chunkFailures.length} phần bị bỏ qua do lỗi (bản quét chưa trọn — chạy lại để bù): `
        + `${chunkFailures.slice(0, 5).join(' · ')}${chunkFailures.length > 5 ? ' …' : ''}`);
    }
    for (const n of capNotices) report.unshift(`ℹ️ ${n}`);

    st.result = { entries: kept, cards: synthCards, report };
    st.stats.entries = kept.length;
    emit();
  };

  const runners: Record<DeepPassId, () => Promise<void>> = {
    structure: passStructure, roster: passRoster, characters: passCharacters,
    world: passWorld, timeline: passTimeline, style: passStyle,
    verify: passVerify, synthesize: passSynthesize, quality: passQuality,
  };

  emit();
  try {
    for (; st.passIndex < st.passes.length; st.passIndex++) {
      const p = st.passes[st.passIndex];
      if (p.status === 'done' || p.status === 'skipped') continue;
      p.status = 'running';
      emit();
      // (bug 163) ĐÂY LÀ CHỖ LÀM MẤT SẠCH ENTRY, từ bug 150 tới giờ — tức tính năng này CHƯA BAO
      // GIỜ chạy đúng, không phải "thỉnh thoảng lỗi".
      // Bản cũ: `if (p.id === 'synthesize' || p.id === 'quality') synthEntries.length = 0;`
      // synthesize sinh ra vài trăm entry (UI hiện đúng con số đó), vòng lặp bước sang quality,
      // dòng trên xoá sạch mảng NGAY TRƯỚC KHI passQuality đọc nó → kept = [] → "Thêm 0 entry".
      // Khớp từng chữ với mô tả của user: "lúc quét có ghi 200 entry, xong thì không có entry nào".
      // synthesize thì xoá là ĐÚNG (chạy lại pass mà không xoá thì entry nhân đôi); quality thì
      // xoá là tự huỷ đầu vào của chính mình — nó chỉ ĐỌC entry chứ không sinh ra entry nào.
      if (p.id === 'synthesize') { synthEntries.length = 0; synthCards.length = 0; }
      // Resume từ một tiến trình cũ có thể nhảy thẳng vào quality trong khi synthEntries (biến
      // cục bộ, không nằm trong state lưu xuống đĩa) đang rỗng. Trước đây chuyện đó cũng ra 0
      // entry. Nay tự dựng lại: chạy bù synthesize rồi mới soát.
      if (p.id === 'quality' && synthEntries.length === 0) {
        log('Chưa có entry trong bộ nhớ (tiến trình được nạp lại) — chạy bù lượt tổng hợp.');
        synthCards.length = 0;
        await runners.synthesize();
      }
      // (bug 163) LƯỚI CUỐI: pipeline phải LUÔN đi tới được lượt soát chất lượng.
      // Ngoài các lượt đọc theo chunk (đã chịu lỗi ở mapPass) còn vài lượt gọi GỘP đứng một mình
      // — gộp cấu trúc, phân vai nhân vật. Một lỗi tạm thời ở đúng những lượt đó vẫn ném thẳng ra
      // ngoài và giết cả buổi quét, y như trước. Nên chặn ở đây, chỗ duy nhất bao hết mọi đường.
      // Nguyên tắc: chỉ user bấm Dừng mới được phép làm dừng pipeline. Còn lại thì thà ra một
      // lorebook mỏng kèm lời cảnh báo, còn hơn trả về con số 0 và mất sạch hàng giờ chạy.
      // Riêng 'quality' hỏng thì phải ném thật — nó là chỗ dựng st.result, không có nó thì user
      // không nhận được gì để mà mỏng hay dày.
      try {
        await runners[p.id]();
      } catch (e) {
        if (isAbortErr(e) || p.id === 'quality') throw e;
        const msg = e instanceof Error ? e.message : String(e);
        chunkFailures.push(`Lượt "${p.id}": ${msg}`);
        log(`⚠️ Lượt "${p.id}" hỏng (${msg}) — bỏ qua, chạy tiếp các lượt sau.`);
      }
      p.status = 'done';
      emit();
    }
    st.status = 'done';
    log('Hoàn tất nghiên cứu tác phẩm.');
  } catch (e) {
    if (isAbortErr(e)) {
      st.status = 'paused';
      const p = st.passes[st.passIndex];
      if (p && p.status === 'running') p.status = 'pending';
      log('Đã tạm dừng — tiến trình được giữ nguyên, bấm Tiếp tục để chạy nốt.');
    } else {
      st.status = 'error';
      st.error = e instanceof Error ? e.message : String(e);
      const p = st.passes[st.passIndex];
      if (p && p.status === 'running') p.status = 'pending';
    }
  }
  emit();
  return st;
}
