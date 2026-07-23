/**
 * "Tạo thẻ từ truyện" — pipeline mô-đun học từ 小玉写卡器 (repo enterprise20020924-web/-).
 *
 * B1  Quét truyện → roster nhân vật (tên + bí danh + mô tả nhận diện).
 *     Truyện dài được CHUNK ra nhiều đoạn, quét song song rồi GỘP roster (dedupe tên/bí danh).
 * B2  Chọn 1 hoặc NHIỀU nhân vật → sinh thẻ theo mô-đun (basic → persona [giai đoạn] → scenario
 *     → first_mes → [world entries]), output bằng tag có cấu trúc để parse chắc.
 *
 * Bê từ repo gốc:
 *  - Chia giai đoạn theo hảo cảm 0–30 / 31–70 / 71–100 + xuyên suốt.
 *  - Nguyên tắc "hợp lý hoá": bổ sung hợp lý nhưng KHÔNG lật thiết lập rõ ràng của truyện.
 *  - Bộ lọc "artifact": không để lọt từ công trình/placeholder + (feedback PhatSiz) không tạo
 *    entry vụn vặt / sự thật hiển nhiên, chỉ giữ thông tin quan trọng có chiều sâu.
 *
 * Dùng callAI của tao-card → hưởng multi-key + chạy song song theo RPM.
 */
import { hasCjk, scanCjkResidue, buildCjkRetryHint } from './cjkResidue';
import type { ProxyProfile, GenerationParams } from '../../types';
import { callAI, computePoolConcurrency } from './client';

export interface ScannedCharacter { name: string; aliases: string[]; brief: string; }

export type StoryCardTemplate = 'chuẩn' | 'nhập vai đậm' | 'súc tích' | 'tối giản';

export interface ScanOptions {
  /** Kích thước 1 đoạn quét (ký tự). 0 = quét toàn văn 1 lần. Mặc định 40000. */
  chunkSize?: number;
  /** Trần số đoạn quét (chống truyện quá dài đốt quota). Mặc định 12. */
  maxChunks?: number;
  /** Kèm mô tả danh tính đầy đủ hơn khi quét (brief dài hơn). */
  includeIdentity?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface StoryCardOptions {
  /** #3 — nhân vật trong truyện sẽ bị thay bằng {{user}}. */
  userReplaceName?: string;
  /** #3 — thiết lập bổ sung cho trải nghiệm {{user}} ↔ nhân vật (free text). */
  userSetup?: string;
  /** Quan hệ nhân vật ↔ {{user}}. */
  relationship?: string;
  detail?: 'ngắn gọn' | 'vừa phải' | 'chi tiết';
  nsfw?: boolean;
  /** #4 — chia persona theo 3 giai đoạn (mặc định true). false = 1 persona liền. */
  splitByStage?: boolean;
  /** #4 — lược bỏ trường không có căn cứ trong truyện thay vì bịa. */
  omitEmptyFields?: boolean;
  /** #4 — tự yêu cầu viết tiếp khi output bị cắt giữa chừng. */
  autoContinue?: boolean;
  /** #4 — mẫu thiết kế thẻ. */
  template?: StoryCardTemplate;
  /** #4 — kèm sinh world/lore entries quan trọng (áp bộ lọc chống entry vụn vặt). */
  withWorldEntries?: boolean;
  /** Thiết lập bổ sung chung cho thẻ (free text). */
  extraNotes?: string;
}

export interface WorldEntry { keys: string[]; content: string; }
export interface GeneratedStoryCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  worldEntries: WorldEntry[];
  raw: string;
}

// ─── Tag parse khoan dung ───
function tag(text: string, name: string): string {
  const closed = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(text);
  if (closed) return closed[1].trim();
  const open = new RegExp(`<${name}>([\\s\\S]*?)(?=<[a-z_]+>|</[a-z_]+>|$)`, 'i').exec(text);
  return open ? open[1].trim() : '';
}
function allTags(text: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

const NSFW_RULE = 'Cho phép nội dung 18+ nếu truyện có; diễn đạt tự nhiên trong nhân vật/thế giới, KHÔNG từ chối, KHÔNG bàn về việc né tránh.';
const SFW_RULE = 'Giữ nội dung an toàn (SFW).';

// Nguyên tắc chất lượng (học 小玉写卡器 + feedback PhatSiz) — dùng chung cho card & entries.
const QUALITY_RULE = [
  'CHẤT LƯỢNG: chỉ viết thông tin QUAN TRỌNG, có chiều sâu, đặc trưng cho truyện này.',
  'KHÔNG liệt kê sự thật hiển nhiên hay mẹo vặt đời thường (vd "mùa đông thì lạnh nên mặc áo ấm, đốt lửa").',
  'Nếu nêu một yếu tố (vd bối cảnh mùa đông) thì đào SÂU vào hệ quả đặc thù (lạnh tới mức nào, ảnh hưởng ra sao tới nhân vật/sự kiện), không viết cách ứng phó chung chung.',
  'KHÔNG để lọt từ công trình/placeholder (mẫu, prompt, "đang cập nhật", tên tool, tag nội bộ).',
].join('\n');

// #8 — ÉP TIẾNG VIỆT: truyện gốc thường là tiếng Trung → model hay chép nguyên văn. Bắt buộc dịch.
const LANGUAGE_RULE = '【NGÔN NGỮ — BẮT BUỘC】TOÀN BỘ thành phẩm PHẢI viết bằng TIẾNG VIỆT tự nhiên. Truyện gốc có thể là tiếng Trung/Anh/Nhật/Hàn — bạn phải DỊCH và diễn đạt lại sang tiếng Việt, TUYỆT ĐỐI KHÔNG chép nguyên văn ngôn ngữ gốc. Tên riêng: chữ Hán → âm Hán Việt (vd 夏冬 → Hạ Đông, 杨万春 → Dương Vạn Xuân); tên Nhật → Romaji; tên Hàn → Romanization; tên phương Tây bị phiên sang chữ Hán → khôi phục chữ Latinh. Sau khi viết xong, RÀ LẠI toàn bộ: nếu còn BẤT KỲ chữ Hán/Kanji/Hangul nào (kể cả trong ngoặc, nhãn, tiêu đề) thì dịch ngay. Chỉ giữ nguyên macro {{user}}, {{char}}.';

// ─── Chunk truyện theo ranh giới đoạn văn, gần size mong muốn ───
export function chunkStory(story: string, size: number): string[] {
  const s = story.trim();
  if (size <= 0 || s.length <= size) return [s];
  const paras = s.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && (buf.length + p.length + 2) > size) { chunks.push(buf); buf = ''; }
    // đoạn đơn quá dài → cắt cứng
    if (p.length > size) {
      if (buf) { chunks.push(buf); buf = ''; }
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Gộp nhiều roster (từ nhiều chunk): dedupe theo tên/bí danh, union bí danh, giữ brief dài nhất. */
export function mergeRosters(lists: ScannedCharacter[][]): ScannedCharacter[] {
  const byKey = new Map<string, ScannedCharacter>();
  const aliasIndex = new Map<string, string>(); // normalias -> canonical key
  for (const list of lists) {
    for (const c of list) {
      if (!c.name) continue;
      const keys = [c.name, ...c.aliases].map(norm).filter(Boolean);
      const existingKey = keys.map((k) => aliasIndex.get(k)).find(Boolean);
      if (existingKey && byKey.has(existingKey)) {
        const cur = byKey.get(existingKey)!;
        cur.aliases = Array.from(new Set([...cur.aliases, ...c.aliases].filter(Boolean)));
        if (c.brief.length > cur.brief.length) cur.brief = c.brief;
        keys.forEach((k) => aliasIndex.set(k, existingKey));
      } else {
        const key = norm(c.name);
        byKey.set(key, { name: c.name, aliases: [...c.aliases], brief: c.brief });
        keys.forEach((k) => aliasIndex.set(k, key));
      }
    }
  }
  return Array.from(byKey.values());
}

// ─── Pool chạy song song có trần đồng thời (RPM đã được callAI gate riêng) ───
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ═══ B1: Quét nhân vật (chunk + gộp) ═══
export async function scanCharacters(
  story: string,
  profile: ProxyProfile,
  params: GenerationParams,
  opts: ScanOptions = {},
): Promise<ScannedCharacter[]> {
  const chunkSize = opts.chunkSize ?? 40000;
  const maxChunks = opts.maxChunks ?? 12;
  let chunks = chunkStory(story, chunkSize);
  if (chunks.length > maxChunks) chunks = chunks.slice(0, maxChunks);
  const multi = chunks.length > 1;

  const briefRule = opts.includeIdentity
    ? '1–3 câu nhận diện đầy đủ: vai trò, ngoại hình nổi bật, xuất thân, quan hệ chính.'
    : '1–2 câu nhận diện: vai trò, đặc điểm nổi bật.';
  const system = `Bạn là trợ lý phân tích truyện để tạo thẻ nhân vật SillyTavern.
Nhiệm vụ: đọc ${multi ? 'ĐOẠN truyện' : 'truyện'} và LIỆT KÊ các nhân vật ĐÁNG tạo thẻ (chính/phụ quan trọng), kèm bí danh và mô tả nhận diện.
Bỏ qua nhân vật thoáng qua/không tên. Gộp các bí danh của cùng một người vào một mục.${multi ? '\nĐây chỉ là một phần truyện — chỉ liệt kê nhân vật XUẤT HIỆN trong đoạn này.' : ''}

${LANGUAGE_RULE}
【ÁP DỤNG RIÊNG CHO BƯỚC NÀY】TÊN và BÍ DANH nhân vật phải viết bằng tiếng Việt NGAY TỪ ĐÂY.
Tên ở bước này là tên được dùng cho MỌI bước sau (dựng thẻ, lorebook, biến) — để sót chữ Hán ở
đây là cả thẻ dính chữ Hán. Ví dụ: 夏冬 → "Hạ Đông" (KHÔNG viết "夏冬" hay "夏冬 (Hạ Đông)").
CHỈ xuất đúng khối sau, mọi tag đóng, ngoài tag không viết gì:
<roster>
<char><name>Tên chính</name><aliases>bí danh 1, bí danh 2</aliases><brief>${briefRule}</brief></char>
...
</roster>`;

  let done = 0;
  opts.onProgress?.(0, chunks.length);
  const lists = await runPool(chunks, Math.min(computePoolConcurrency(profile), chunks.length), async (chunk, i) => {
    const { text } = await callAI({
      profile, params, signal: opts.signal,
      label: multi ? `Quét nhân vật (đoạn ${i + 1}/${chunks.length})` : 'Quét nhân vật',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `【${multi ? `Đoạn ${i + 1}/${chunks.length}` : 'Truyện'}】\n${chunk}` },
      ],
    });
    const block = tag(text, 'roster') || text;
    const list = allTags(block, 'char').map((c) => ({
      name: tag(c, 'name'),
      aliases: tag(c, 'aliases').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      brief: tag(c, 'brief'),
    })).filter((c) => c.name);
    opts.onProgress?.(++done, chunks.length);
    return list;
  });
  const merged = mergeRosters(lists);

  // (bug 91) Tên ở bước này được dùng cho MỌI bước sau — sót chữ Hán ở đây là cả thẻ dính.
  // Gom những tên còn sót rồi nhờ AI dịch MỘT LƯỢT (rẻ hơn quét lại từng đoạn truyện).
  const dirty = merged.filter((c) => hasCjk(c.name) || c.aliases.some(hasCjk));
  if (dirty.length > 0) {
    try {
      const { text } = await callAI({
        profile, params, signal: opts.signal, label: 'Dịch nốt tên nhân vật còn chữ Hán',
        messages: [
          { role: 'system', content: `Bạn dịch TÊN RIÊNG sang tiếng Việt. Chữ Hán → âm Hán Việt (夏冬 → Hạ Đông), tên Nhật → Romaji, tên Hàn → Romanization.
CHỈ xuất đúng khối sau, mỗi tên một dòng, không giải thích:
<names>
<n><old>tên gốc</old><new>tên tiếng Việt</new></n>
</names>` },
          { role: 'user', content: dirty.flatMap((c) => [c.name, ...c.aliases]).filter(hasCjk).join('\n') },
        ],
      });
      const map = new Map<string, string>();
      for (const n of allTags(tag(text, 'names') || text, 'n')) {
        const o = tag(n, 'old').trim(), v = tag(n, 'new').trim();
        if (o && v && !hasCjk(v)) map.set(o, v);
      }
      for (const c of merged) {
        c.name = map.get(c.name.trim()) ?? c.name;
        c.aliases = c.aliases.map((a) => map.get(a.trim()) ?? a);
      }
    } catch {
      // Dịch tên hỏng thì vẫn trả danh sách — user tự sửa được ở bảng chọn nhân vật,
      // chặn cả luồng vì một lượt phụ thất bại thì tệ hơn.
    }
  }
  return merged;
}

// ─── Build system prompt cho sinh thẻ ───
function buildCardSystem(characterName: string, opts: StoryCardOptions): string {
  const directives: string[] = [];
  if (opts.userReplaceName?.trim()) {
    const n = opts.userReplaceName.trim();
    directives.push(`Nhân vật "${n}" trong truyện CHÍNH LÀ {{user}} (người chơi). Thay mọi chỗ nhắc "${n}" bằng {{user}}; KHÔNG mô tả nội tâm/hành động/lời thoại thay cho {{user}}. Thẻ này viết cho nhân vật "${characterName}" tương tác VỚI {{user}}.`);
    if (opts.userSetup?.trim()) directives.push(`Thiết lập bổ sung về {{user}} và trải nghiệm chung: ${opts.userSetup.trim()}`);
  }
  if (opts.relationship?.trim()) directives.push(`Thể hiện rõ mối quan hệ giữa "${characterName}" và {{user}}: ${opts.relationship.trim()}`);
  if (opts.extraNotes?.trim()) directives.push(`Yêu cầu thêm: ${opts.extraNotes.trim()}`);
  if (opts.omitEmptyFields) directives.push('Trường nào truyện KHÔNG có căn cứ thì để trống/bỏ qua, TUYỆT ĐỐI không bịa cho đủ.');

  const tpl: Record<StoryCardTemplate, string> = {
    'chuẩn': 'Văn phong cân bằng: đủ chi tiết nhưng gọn, dễ dùng.',
    'nhập vai đậm': 'Văn phong nhập vai đậm chất: giàu cảm xúc, chi tiết cảm quan, giọng nhân vật rõ.',
    'súc tích': 'Súc tích, gạch đầu dòng, ưu tiên thông tin then chốt.',
    'tối giản': 'Tối giản: chỉ những gì cốt lõi nhất, câu ngắn.',
  };
  const templateRule = tpl[opts.template ?? 'chuẩn'];

  const persona = opts.splitByStage === false
    ? '<persona>Tính cách + cách cư xử tổng thể với {{user}} (không chia giai đoạn).</persona>'
    : `<persona>Tính cách + cách cư xử, chia theo 3 giai đoạn quan hệ với {{user}}:
[Sơ giao 0–30] ...
[Quen thân 31–70] ...
[Thân mật 71–100] ...
[Xuyên suốt] nét chung mọi giai đoạn.</persona>`;

  const worldBlock = opts.withWorldEntries
    ? '\n<world_entries>\n<entry><keys>từ khoá 1, từ khoá 2</keys><content>Nội dung lore QUAN TRỌNG (địa danh/thế lực/vật phẩm/sự kiện then chốt). Áp dụng quy tắc CHẤT LƯỢNG ở trên.</content></entry>\n... (chỉ 3–8 entry thật sự đáng có)\n</world_entries>'
    : '';

  return `Bạn là chuyên gia viết THẺ NHÂN VẬT SillyTavern chất lượng cao, viết bằng tiếng Việt tự nhiên, văn phong nhập vai.
${LANGUAGE_RULE}
Từ truyện + tên nhân vật mục tiêu, viết một thẻ HOÀN CHỈNH cho nhân vật đó. Mức chi tiết: ${opts.detail ?? 'vừa phải'}. ${templateRule} ${opts.nsfw ? NSFW_RULE : SFW_RULE}
${QUALITY_RULE}
QUY TẮC:
- Chỉ dựa vào truyện; được suy luận hợp lý nhưng KHÔNG phủ định thiết lập rõ ràng.
- Giữ nguyên macro {{user}}, {{char}}. KHÔNG viết chú thích meta/quy trình.
${directives.length ? directives.map((d) => `- ${d}`).join('\n') + '\n' : ''}ĐỊNH DẠNG BẮT BUỘC — chỉ xuất đúng khối, mọi tag đóng, ngoài tag không viết gì:
<card>
<name>Tên nhân vật</name>
<basic>Thông tin cơ bản (gạch đầu dòng): ngoại hình nhận diện, xuất thân/lai lịch, năng lực, vai trò trong truyện.</basic>
${persona}
<scenario>Bối cảnh {{char}} gặp/tương tác với {{user}} (2–4 câu).</scenario>
<first_mes>Lời chào/mở màn nhập vai của {{char}} với {{user}} — có hành động *nghiêng*, lời thoại, không thay lời {{user}}.</first_mes>${worldBlock}
</card>`;
}

// ═══ B2: Sinh thẻ cho 1 nhân vật ═══
export async function generateCardFromStory(
  story: string,
  characterName: string,
  profile: ProxyProfile,
  params: GenerationParams,
  opts: StoryCardOptions = {},
  signal?: AbortSignal,
): Promise<GeneratedStoryCard> {
  const system = buildCardSystem(characterName, opts);
  const userMsg = `【Nhân vật mục tiêu】\n${characterName}\n\n【Truyện】\n${story.trim()}`;

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userMsg },
  ];
  let { text } = await callAI({ profile, params, signal, label: `Tạo thẻ: ${characterName}`, messages });

  // #4 — tự viết tiếp khi bị cắt (thiếu </card>)
  if (opts.autoContinue) {
    let tries = 0;
    while (!/<\/card>/i.test(text) && tries < 2) {
      tries++;
      const cont = await callAI({
        profile, params, signal, label: `Tạo thẻ: ${characterName} (viết tiếp ${tries})`,
        messages: [
          ...messages,
          { role: 'assistant' as const, content: text },
          { role: 'user' as const, content: 'Output bị cắt. Viết TIẾP từ đúng chỗ vừa dừng, KHÔNG lặp lại phần đã có, và đóng đủ các tag còn thiếu.' },
        ],
      });
      text += cont.text;
    }
  }

  // (User 23/07 — bug 91) Prompt đã dặn dịch, nhưng dặn không phải là bảo đảm — model vẫn hay
  // bê nguyên tên/câu tiếng gốc. Đo lại bằng luật, còn sót thì bắt làm lại kèm ĐÍCH DANH chữ
  // còn sót (nhắc chung chung thì model hay trả lại y nguyên). Tối đa 2 lượt để không đốt quota.
  for (let pass = 0; pass < 2; pass++) {
    const blk = tag(text, 'card') || text;
    const rep = scanCjkResidue({
      'Tên': tag(blk, 'name'),
      'Thông tin cơ bản': tag(blk, 'basic'),
      'Tính cách': tag(blk, 'persona'),
      'Bối cảnh': tag(blk, 'scenario'),
      'Lời mở đầu': tag(blk, 'first_mes'),
      'Lore': tag(blk, 'world_entries'),
    });
    if (rep.clean) break;
    const fixed = await callAI({
      profile, params, signal,
      label: `Tạo thẻ: ${characterName} (dịch nốt chữ Hán ${pass + 1})`,
      messages: [
        ...messages,
        { role: 'assistant' as const, content: text },
        { role: 'user' as const, content: buildCjkRetryHint(rep) },
      ],
    });
    if (!fixed.text.trim()) break;
    text = fixed.text;
  }

  const block = tag(text, 'card') || text;
  const worldEntries: WorldEntry[] = opts.withWorldEntries
    ? allTags(tag(block, 'world_entries') || block, 'entry')
        .map((e) => ({
          keys: tag(e, 'keys').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          content: tag(e, 'content'),
        }))
        .filter((e) => e.content)
    : [];

  return {
    name: tag(block, 'name') || characterName,
    description: [tag(block, 'basic'), tag(block, 'persona')].filter(Boolean).join('\n\n'),
    personality: '',
    scenario: tag(block, 'scenario'),
    firstMes: tag(block, 'first_mes'),
    worldEntries,
    raw: text,
  };
}

// ═══ B2b: Sinh thẻ HÀNG LOẠT cho nhiều nhân vật (chạy song song theo RPM) ═══
export interface BatchCardResult { name: string; card?: GeneratedStoryCard; error?: string; }
export async function generateCardsForMany(
  story: string,
  names: string[],
  profile: ProxyProfile,
  params: GenerationParams,
  opts: StoryCardOptions = {},
  signal?: AbortSignal,
  onEach?: (done: number, total: number, name: string) => void,
): Promise<BatchCardResult[]> {
  let done = 0;
  // Trần đồng thời rộng — callAI tự gate theo RPM/đa key nên không lo vượt.
  return runPool(names, Math.min(computePoolConcurrency(profile), names.length), async (name) => {
    try {
      const card = await generateCardFromStory(story, name, profile, params, opts, signal);
      onEach?.(++done, names.length, name);
      return { name, card };
    } catch (e: any) {
      onEach?.(++done, names.length, name);
      return { name, error: e?.message || String(e) };
    }
  });
}
