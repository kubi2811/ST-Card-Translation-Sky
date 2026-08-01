/**
 * src/lib/ai/wandMemory.ts — (bugNeedFix/185) ĐŨA THẦN HỌC THEO NGƯỜI DÙNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "AI phải được train và thích nghi theo thời gian sử dụng để hiểu cách người dùng tổ
 * chức ý tưởng, phong cách viết và loại thế giới đang xây dựng."
 *
 * "Train" thật thì không làm được trong trình duyệt — nhưng cái user thực sự cần thì làm được:
 * NHỚ những lần dùng trước và đưa vào ngữ cảnh của lần sau. Mỗi lần đũa thần chạy THÀNH CÔNG
 * (qua được chốt 1-1) ta ghi lại dấu vết ĐO ĐƯỢC: các tiêu đề "## …" user chấp nhận, thể loại
 * thế giới đoán từ từ khoá, ngôn ngữ, độ dài. Lần sau, đúc thành một khối "hồ sơ người dùng"
 * ngắn nối vào prompt — AI đọc rồi tự thích nghi, thay vì mỗi lần đều bắt đầu từ số 0.
 *
 * KHÔNG lưu nguyên văn ý tưởng: ý tưởng có thể rất dài và riêng tư; hồ sơ chỉ giữ CẤU TRÚC.
 */

export type WandRunMode = 'polish' | 'world' | 'enrich';

export interface WandRunTrace {
  mode: WandRunMode;
  /** Tiêu đề "## …" trong bản kết quả user đã nhận. */
  sections: string[];
  /** Thể loại thế giới đoán từ từ khoá (tu tiên / fantasy / hiện đại / sci-fi…). */
  genre: string | null;
  /** Số ký tự của ý tưởng ĐẦU VÀO — biết user hay đưa nháp ngắn hay dàn ý dài. */
  ideaChars: number;
  at: number;
}

export interface WandMemory {
  runs: WandRunTrace[];
}

const KEY = 'tc-wand-memory-v1';
const MAX_RUNS = 12;

export function loadWandMemory(): WandMemory {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const p = raw ? (JSON.parse(raw) as WandMemory) : null;
    return p && Array.isArray(p.runs) ? p : { runs: [] };
  } catch {
    return { runs: [] };
  }
}

function save(mem: WandMemory): void {
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* quota/private */ }
}

/** Bóc tiêu đề "## …" từ một bản kết quả. */
export function extractSections(polished: string): string[] {
  return [...polished.matchAll(/^##\s+(.+)$/gm)]
    .map(m => m[1].replace(/^✚\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Đoán thể loại thế giới từ từ khoá — đủ dùng cho hồ sơ, sai thì cũng chỉ lệch một dòng gợi ý. */
export function guessGenre(text: string): string | null {
  const t = text.toLowerCase();
  const RULES: Array<[string, RegExp]> = [
    ['tu tiên / huyền huyễn', /tu tiên|tu luyện|linh khí|cảnh giới|tông môn|đan dược|nguyên anh|kim đan|linh thạch/],
    ['võ hiệp', /võ công|giang hồ|môn phái|nội lực|kiếm pháp|chưởng môn/],
    ['fantasy phương Tây', /ma pháp|phép thuật|hiệp sĩ|rồng|elf|dungeon|guild|mạo hiểm giả|quỷ vương/],
    ['sci-fi / tương lai', /tàu vũ trụ|robot|ai\b|cyber|hành tinh|thuộc địa|công nghệ sinh học|mecha/],
    ['kinh dị / huyền bí', /ma quỷ|linh hồn|lời nguyền|kinh dị|cthulhu|quỷ dị|tà thần/],
    ['học đường / đời thường', /học viện|trường học|lớp học|câu lạc bộ|đời thường|công sở/],
    ['hậu tận thế', /tận thế|zombie|sinh tồn|hoang tàn|bức xạ|dị biến/],
  ];
  for (const [name, re] of RULES) if (re.test(t)) return name;
  return null;
}

/** Ghi lại một lần đũa thần chạy THÀNH CÔNG (đã qua chốt 1-1, user đã nhận kết quả). */
export function recordWandRun(mode: WandRunMode, idea: string, polished: string): void {
  const mem = loadWandMemory();
  mem.runs.push({
    mode,
    sections: extractSections(polished),
    genre: guessGenre(idea + '\n' + polished),
    ideaChars: idea.length,
    at: Date.now(),
  });
  if (mem.runs.length > MAX_RUNS) mem.runs = mem.runs.slice(-MAX_RUNS);
  save(mem);
}

/**
 * Đúc hồ sơ người dùng từ các lần trước thành một khối prompt ngắn. Chưa có gì thì trả '' —
 * lần đầu dùng không được bịa hồ sơ.
 *
 * Cách dùng trong prompt: chỉ là GỢI Ý ưu tiên, không phải khuôn ép — chốt câu cuối nói rõ,
 * vì chính user cũng đòi "tự điều chỉnh... thay vì luôn sử dụng một khuôn mẫu cố định".
 */
export function buildWandStyleContext(mem: WandMemory = loadWandMemory()): string {
  if (mem.runs.length === 0) return '';

  // Tiêu đề hay dùng — đếm tần suất, lấy các tiêu đề xuất hiện ≥ 2 lần (1 lần thì chưa là thói quen).
  const freq = new Map<string, number>();
  for (const r of mem.runs) for (const s of r.sections) freq.set(s, (freq.get(s) ?? 0) + 1);
  const habitual = [...freq.entries()].filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 8);

  const genres = new Map<string, number>();
  for (const r of mem.runs) if (r.genre) genres.set(r.genre, (genres.get(r.genre) ?? 0) + 1);
  const topGenre = [...genres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Không rút được thói quen nào (chưa đủ lần lặp lại) thì coi như CHƯA có hồ sơ — thà im còn
  // hơn bơm vào prompt vài con số vô thưởng vô phạt.
  if (habitual.length === 0 && !topGenre) return '';

  const lines: string[] = ['HỒ SƠ NGƯỜI DÙNG (đúc từ các lần dùng đũa thần trước — chỉ để tham khảo):'];
  if (habitual.length > 0) {
    lines.push(`• Người dùng quen tổ chức ý tưởng theo các phần: ${habitual.map(s => `"${s}"`).join(', ')}.`);
  }
  if (topGenre) {
    lines.push(`• Thế giới họ hay xây thuộc thể loại: ${topGenre} — ưu tiên thuật ngữ và không khí của thể loại này khi phù hợp.`);
  }
  lines.push('Hồ sơ này là GỢI Ý ưu tiên, không phải khuôn ép: nội dung thực tế của ý tưởng lần này luôn thắng hồ sơ.');
  return lines.join('\n');
}
