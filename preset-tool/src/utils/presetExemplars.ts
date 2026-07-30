/**
 * src/utils/presetExemplars.ts — (bugNeedFix/169) HỌC TỪ CHÍNH CÁC PRESET HOÀN THIỆN ĐÃ NHẬP.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "bổ sung cho AI có thể nhìn ví dụ từ những preset hoàn thiện đã nhập để có thể tự tạo
 * nên một preset có đầy đủ chức năng và hoàn thiện như những preset gốc đã cho vào như ako hay
 * tawa; nếu chưa đủ thì người dùng vẫn có thể gọi bổ sung hoặc tạo mới dựa trên những preset đã nhập."
 *
 * ĐÂY LÀ CHỖ HỔNG THẬT, đo được: khung chat bơm cho AI đúng hai thứ —
 *   ① DỰ ÁN ĐANG MỞ (buildProjectContext), và
 *   ② thư viện preset kéo-thả riêng (buildPresetLibraryContext, localStorage st_studio_preset_lib).
 * Nhưng Ako / Tawa / Mie Mie mà user nhập vào lại nằm ở DANH SÁCH DỰ ÁN (st_studio_projects) —
 * không thuộc nhóm nào ở trên. Nên khi user bảo "tạo preset đầy đủ như Ako", AI không hề nhìn
 * thấy Ako; nó viết theo trí nhớ chung chung, ra 3 khối trong khi bản gốc có mấy chục.
 *
 * File này KHÔNG gọi AI. Nó làm ba việc tất định:
 *   1. profileProject()  — rút "hồ sơ cấu trúc" của một preset (số khối, vai trò, nhóm chức
 *      năng, tham số, regex). Rẻ, chạy lại bao nhiêu lần cũng được.
 *   2. compareToExemplars() — so preset đang làm với các preset gốc: THIẾU nhóm chức năng nào,
 *      ít hơn bao nhiêu khối. Đây là câu trả lời cho "đã đầy đủ chưa".
 *   3. buildExemplarContext() — dựng khối ngữ cảnh bơm vào chat, có ngân sách: preset được
 *      nhắc tên gửi nguyên văn khối prompt, còn lại chỉ gửi hồ sơ.
 */
import type { Project, PromptBlock, RegexScript } from '../types';

/* ═══ 1. NHÓM CHỨC NĂNG ═══════════════════════════════════════════════════
 * Một preset SillyTavern "hoàn thiện" không phải là preset dài, mà là preset có đủ VAI TRÒ.
 * Bảng dưới nhận dạng nhóm theo tên khối + nội dung, đa ngữ (Việt/Anh/Trung) vì preset cộng
 * đồng trộn cả ba. Nhận dạng theo từ khoá ĐẶC TRƯNG, không dùng từ chung chung dễ khớp bừa.
 */
export type FeatureGroup =
  | 'persona' | 'jailbreak' | 'style' | 'formatting' | 'history'
  | 'worldinfo' | 'nsfw' | 'antiloop' | 'cot' | 'summary' | 'system';

export const FEATURE_LABEL: Record<FeatureGroup, string> = {
  persona: 'Vai diễn / Đạo diễn',
  jailbreak: 'Jailbreak / Gỡ kiểm duyệt',
  style: 'Văn phong / Giọng kể',
  formatting: 'Định dạng đầu ra',
  history: 'Lịch sử trò chuyện',
  worldinfo: 'World Info / Lore',
  nsfw: 'NSFW / Nội dung người lớn',
  antiloop: 'Chống lặp / Chống nhạt',
  cot: 'Suy luận trước khi trả lời',
  summary: 'Tóm tắt / Nén ngữ cảnh',
  system: 'Khối hệ thống / Marker',
};

const GROUP_PATTERNS: Array<{ g: FeatureGroup; re: RegExp }> = [
  { g: 'persona', re: /đạo diễn|director|persona|nhập vai|roleplay|role-play|扮演|character\s*card/i },
  { g: 'jailbreak', re: /jailbreak|\bjb\b|bypass|unfilter|gỡ kiểm duyệt|越狱|no\s*restriction/i },
  { g: 'style', re: /văn phong|writing\s*style|prose|giọng kể|tone|文风|narrative\s*style/i },
  { g: 'formatting', re: /định dạng|format|markdown|output\s*format|bố cục|排版|structure\s*of\s*reply/i },
  { g: 'history', re: /lịch sử|chat\s*history|history|hội thoại trước|聊天记录|conversation\s*log/i },
  { g: 'worldinfo', re: /world\s*info|lorebook|\bwi\b|thế giới|世界书|world\s*book/i },
  { g: 'nsfw', re: /nsfw|18\+|explicit|erotic|người lớn|色情|mature\s*content/i },
  { g: 'antiloop', re: /chống lặp|anti[-\s]?loop|repetit|lặp lại|nhàm|重复|avoid\s*repeat/i },
  { g: 'cot', re: /chain[-\s]?of[-\s]?thought|\bcot\b|suy luận|thinking|reasoning|思考|<think/i },
  { g: 'summary', re: /tóm tắt|summar|nén ngữ cảnh|compress|摘要|memory\s*bank/i },
];

/** Nhóm chức năng của MỘT khối prompt. Marker → 'system'. Không khớp gì → null. */
export function classifyBlock(b: PromptBlock): FeatureGroup | null {
  if (b.marker) return 'system';
  const hay = `${b.name} ${b.identifier} ${(b.content ?? '').slice(0, 1200)}`;
  for (const { g, re } of GROUP_PATTERNS) if (re.test(hay)) return g;
  return null;
}

/* ═══ 2. HỒ SƠ CẤU TRÚC ═══════════════════════════════════════════════════ */

export interface PresetProfile {
  projectId: string;
  name: string;
  blockCount: number;
  enabledCount: number;
  markerCount: number;
  /** Nhóm chức năng → số khối thuộc nhóm đó. */
  groups: Partial<Record<FeatureGroup, number>>;
  /** Khối không quy được về nhóm nào — vẫn đếm, để không nói dối là preset nghèo nàn. */
  ungrouped: number;
  roles: Record<'system' | 'user' | 'assistant', number>;
  regexCount: number;
  regexEnabled: number;
  /** Tổng ký tự nội dung các khối — thước đo "dày" thô nhưng thật. */
  contentChars: number;
  params: { temperature: number; max_tokens: number; max_context: number };
}

export function profileProject(p: Project): PresetProfile {
  const blocks = p.preset.prompts ?? [];
  const groups: Partial<Record<FeatureGroup, number>> = {};
  let ungrouped = 0;
  const roles = { system: 0, user: 0, assistant: 0 };
  let contentChars = 0;

  for (const b of blocks) {
    const g = classifyBlock(b);
    if (g) groups[g] = (groups[g] ?? 0) + 1; else ungrouped++;
    if (b.role in roles) roles[b.role]++;
    contentChars += (b.content ?? '').length;
  }

  const rx: RegexScript[] = p.regexes ?? [];
  return {
    projectId: p.id,
    name: p.name,
    blockCount: blocks.length,
    enabledCount: blocks.filter(b => b.enabled).length,
    markerCount: blocks.filter(b => b.marker).length,
    groups, ungrouped, roles,
    regexCount: rx.length,
    regexEnabled: rx.filter(r => !r.disabled).length,
    contentChars,
    params: {
      temperature: p.preset.temperature,
      max_tokens: p.preset.openai_max_tokens,
      max_context: p.preset.openai_max_context,
    },
  };
}

/**
 * Preset nào đủ "hoàn thiện" để làm MẪU?
 * Ngưỡng cố ý thấp và nói rõ lý do: một preset thật như Ako/Tawa có hàng chục khối; dự án nháp
 * 2-3 khối thì không dạy được gì. Lấy nhầm dự án nháp làm mẫu còn tệ hơn không có mẫu.
 */
export function isExemplar(pr: PresetProfile): boolean {
  return pr.blockCount >= 8 && Object.keys(pr.groups).length >= 3 && pr.contentChars >= 2000;
}

/* ═══ 3. SO VỚI MẪU: ĐÃ ĐẦY ĐỦ CHƯA ═══════════════════════════════════════ */

export interface GapReport {
  /** Có mẫu nào để so không. Không có thì mọi kết luận bên dưới vô nghĩa. */
  hasExemplars: boolean;
  exemplarNames: string[];
  current: PresetProfile;
  /** Nhóm có ở ĐA SỐ preset mẫu nhưng preset đang làm KHÔNG có. */
  missingGroups: FeatureGroup[];
  /** Nhóm có nhưng mỏng hơn hẳn mẫu (mẫu trung bình ≥2 khối, mình chỉ 1). */
  thinGroups: FeatureGroup[];
  medianBlocks: number;
  medianRegex: number;
  /** Câu tiếng Việt tóm tắt — hiện thẳng cho user, không bắt đọc số. */
  verdict: string;
}

function median(ns: number[]): number {
  if (!ns.length) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function compareToExemplars(current: Project, exemplars: Project[]): GapReport {
  const cur = profileProject(current);
  const profs = exemplars.map(profileProject).filter(isExemplar);

  if (profs.length === 0) {
    return {
      hasExemplars: false, exemplarNames: [], current: cur,
      missingGroups: [], thinGroups: [], medianBlocks: 0, medianRegex: 0,
      verdict: 'Chưa có preset mẫu nào để đối chiếu. Hãy nhập một preset hoàn thiện (Ako, Tawa…) '
        + 'vào danh sách dự án — công cụ sẽ tự lấy nó làm chuẩn để biết preset của bạn còn thiếu gì.',
    };
  }

  // Nhóm được coi là "chuẩn" khi xuất hiện ở QUÁ NỬA số preset mẫu — một preset lẻ có nhóm lạ
  // thì đó là sở thích riêng của nó, không phải chuẩn để bắt mọi preset phải có.
  const half = profs.length / 2;
  const groupPresence = new Map<FeatureGroup, number>();
  const groupAvg = new Map<FeatureGroup, number>();
  for (const pr of profs) {
    for (const [g, n] of Object.entries(pr.groups) as Array<[FeatureGroup, number]>) {
      groupPresence.set(g, (groupPresence.get(g) ?? 0) + 1);
      groupAvg.set(g, (groupAvg.get(g) ?? 0) + n);
    }
  }

  const missingGroups: FeatureGroup[] = [];
  const thinGroups: FeatureGroup[] = [];
  for (const [g, seen] of groupPresence) {
    if (seen <= half) continue;                       // chưa phải chuẩn chung
    const mine = cur.groups[g] ?? 0;
    const avg = (groupAvg.get(g) ?? 0) / seen;
    if (mine === 0) missingGroups.push(g);
    else if (avg >= 2 && mine < Math.floor(avg)) thinGroups.push(g);
  }

  const medianBlocks = median(profs.map(p => p.blockCount));
  const medianRegex = median(profs.map(p => p.regexCount));

  const bits: string[] = [];
  bits.push(`Preset của bạn có ${cur.blockCount} khối prompt; các preset mẫu (${profs.map(p => p.name).join(', ')}) trung vị ${medianBlocks} khối.`);
  if (missingGroups.length) {
    bits.push(`Thiếu hẳn ${missingGroups.length} nhóm chức năng mà đa số preset mẫu đều có: ${missingGroups.map(g => FEATURE_LABEL[g]).join(', ')}.`);
  }
  if (thinGroups.length) {
    bits.push(`Mỏng hơn mẫu ở: ${thinGroups.map(g => FEATURE_LABEL[g]).join(', ')}.`);
  }
  if (!missingGroups.length && !thinGroups.length) {
    bits.push('Đã phủ đủ các nhóm chức năng mà preset mẫu có — phần còn lại là chất lượng câu chữ, không phải thiếu khối.');
  }
  if (medianRegex > 0 && cur.regexCount === 0) {
    bits.push(`Preset mẫu có regex đi kèm (trung vị ${medianRegex} script) còn bạn chưa có script nào.`);
  }

  return {
    hasExemplars: true,
    exemplarNames: profs.map(p => p.name),
    current: cur, missingGroups, thinGroups, medianBlocks, medianRegex,
    verdict: bits.join(' '),
  };
}

/* ═══ 4. NGỮ CẢNH BƠM VÀO CHAT ════════════════════════════════════════════ */

/** Ngân sách ký tự cho khối mẫu. Preset thật rất dài, không kèm trần là nổ context ngay. */
const EXEMPLAR_BUDGET = 40_000;
const FULL_PER_EXEMPLAR = 18_000;

function blocksDigest(p: Project, limit: number): string {
  const out: string[] = [];
  let used = 0;
  for (const b of p.preset.prompts ?? []) {
    if (b.marker) { out.push(`- [marker] "${b.name}"`); continue; }
    const g = classifyBlock(b);
    const head = `- "${b.name}" (${b.role}${b.enabled ? '' : ', tắt'}${g ? `, nhóm: ${FEATURE_LABEL[g]}` : ''}, depth=${b.injection_depth}, order=${b.injection_order})`;
    const body = (b.content ?? '').trim();
    const room = limit - used;
    if (room <= head.length) { out.push(`… (còn ${(p.preset.prompts.length - out.length)} khối nữa, cắt vì quá dài)`); break; }
    const slice = body.length > Math.max(0, room - head.length) ? body.slice(0, Math.max(0, room - head.length)) + '…' : body;
    out.push(`${head}\n  """${slice}"""`);
    used += head.length + slice.length;
  }
  return out.join('\n');
}

/**
 * Dựng khối "PRESET MẪU" cho MỖI lượt chat.
 *  • Mẫu được NHẮC TÊN trong câu hỏi → gửi nguyên văn khối prompt (trong ngân sách).
 *  • Còn lại → chỉ hồ sơ cấu trúc, kèm gợi ý cách xin xem đầy đủ.
 * Trả '' khi không có mẫu nào — không bơm khối rỗng làm loãng prompt.
 */
export function buildExemplarContext(
  exemplars: Project[],
  userText: string,
  gap?: GapReport,
): string {
  const profs = exemplars.map(p => ({ p, pr: profileProject(p) })).filter(x => isExemplar(x.pr));
  if (profs.length === 0) return '';

  const ask = (userText || '').toLowerCase();
  const parts: string[] = [
    `═══ PRESET MẪU HOÀN THIỆN CỦA NGƯỜI DÙNG (${profs.length}) ═══`,
    'Đây là các preset THẬT mà người dùng đã nhập và đang dùng được. Khi họ nhờ tạo mới hoặc bổ sung,',
    'hãy bám ĐỘ ĐẦY ĐỦ của các preset này: đủ nhóm chức năng, đủ số khối, độ dài nội dung tương đương.',
    'TUYỆT ĐỐI không chép nguyên văn câu chữ của mẫu — học CẤU TRÚC và ĐỘ PHỦ, còn nội dung phải viết mới.',
  ];

  let used = 0;
  for (const { p, pr } of profs) {
    const named = ask.includes(pr.name.toLowerCase());
    const groupLine = Object.entries(pr.groups)
      .map(([g, n]) => `${FEATURE_LABEL[g as FeatureGroup]}×${n}`).join(', ') || '(không nhận dạng được nhóm)';
    const head = `\n── MẪU "${pr.name}" ──\n`
      + `• ${pr.blockCount} khối (${pr.enabledCount} bật, ${pr.markerCount} marker), ${pr.regexCount} regex, ~${pr.contentChars.toLocaleString()} ký tự nội dung\n`
      + `• Nhóm chức năng: ${groupLine}\n`
      + `• Tham số: temperature=${pr.params.temperature}, max_tokens=${pr.params.max_tokens}, max_context=${pr.params.max_context}`;

    if (named && used < EXEMPLAR_BUDGET) {
      const room = Math.min(FULL_PER_EXEMPLAR, EXEMPLAR_BUDGET - used);
      const digest = blocksDigest(p, room);
      parts.push(`${head}\n• CÁC KHỐI (nguyên văn):\n${digest}`);
      used += digest.length;
    } else {
      parts.push(`${head}\n(Nhắc tên "${pr.name}" trong câu hỏi để tôi đọc nguyên văn các khối của nó.)`);
    }
  }

  if (gap?.hasExemplars) {
    parts.push(
      '\n── ĐỐI CHIẾU PRESET ĐANG LÀM VỚI MẪU ──',
      gap.verdict,
      gap.missingGroups.length
        ? `Nhóm còn thiếu (ưu tiên bổ sung): ${gap.missingGroups.map(g => FEATURE_LABEL[g]).join(', ')}.`
        : '',
    );
  }
  return parts.filter(Boolean).join('\n');
}

/* ═══ 5. LỜI NHỜ SẴN ══════════════════════════════════════════════════════
 * "nếu chưa đủ thì người dùng vẫn có thể gọi bổ sung hoặc tạo mới dựa trên những preset đã nhập"
 * → hai câu nhờ dựng sẵn từ CHÍNH kết quả đối chiếu, user chỉ bấm một nút.
 */

export function buildSupplementRequest(gap: GapReport): string {
  if (!gap.hasExemplars) return gap.verdict;
  const lines: string[] = [
    `Preset "${gap.current.name}" của tôi đang có ${gap.current.blockCount} khối, còn các preset mẫu (${gap.exemplarNames.join(', ')}) trung vị ${gap.medianBlocks} khối.`,
  ];
  if (gap.missingGroups.length) {
    lines.push(`Hãy VIẾT BỔ SUNG các khối còn thiếu, mỗi nhóm ít nhất một khối: ${gap.missingGroups.map(g => FEATURE_LABEL[g]).join(', ')}.`);
  }
  if (gap.thinGroups.length) {
    lines.push(`Và làm dày thêm các nhóm đang mỏng: ${gap.thinGroups.map(g => FEATURE_LABEL[g]).join(', ')}.`);
  }
  if (!gap.missingGroups.length && !gap.thinGroups.length) {
    lines.push('Các nhóm chức năng đã đủ; hãy rà lại chất lượng từng khối và đề xuất chỗ nào nên viết sâu hơn so với preset mẫu.');
  }
  lines.push(
    'Yêu cầu: GIỮ NGUYÊN các khối tôi đã có, chỉ THÊM khối mới.',
    'Học cấu trúc và độ phủ của preset mẫu nhưng nội dung phải viết mới, không chép câu chữ của mẫu.',
    'Trả về JSON các khối prompt để tôi chèn thẳng vào dự án.',
  );
  return lines.join('\n');
}

export function buildCloneRequest(exemplarNames: string[], theme: string): string {
  return [
    `Hãy tạo cho tôi một preset MỚI hoàn chỉnh, lấy ${exemplarNames.join(' và ')} làm chuẩn về độ đầy đủ.`,
    theme.trim() ? `Chủ đề/phong cách tôi muốn: ${theme.trim()}` : 'Chủ đề: dùng chung, hợp mọi thể loại roleplay.',
    'Bắt buộc: đủ các nhóm chức năng mà preset mẫu có (vai diễn, jailbreak, văn phong, định dạng, lịch sử hội thoại, world info, chống lặp…),',
    'số khối và độ dài nội dung tương đương mẫu — đừng trả về một preset 3 khối sơ sài.',
    'Nội dung phải viết mới hoàn toàn, không chép câu chữ của mẫu. Giữ tương thích SillyTavern, không bịa trường lạ.',
    'Trả về JSON để tôi nhập thẳng.',
  ].join('\n');
}
