import type { TranslationField, GlossaryEntry } from '../types/card';
import { isMacroPollutedTerm } from './macroGuard';
import { buildProperNounRules, buildFandomNameRules, type NameStyle } from './masterPrompt';

/**
 * ─── Pha 0: Bảng tên riêng tự động ───
 *
 * Vấn đề: dịch đa luồng nghĩa là 2 entry khác nhau có thể do 2 lane khác nhau dịch —
 * cùng nhân vật 叶凡 ra "Diệp Phàm" ở entry này, "Ye Fan" ở entry kia. Glossary thủ công
 * giải quyết được nhưng user phải tự biết trước tên nào sẽ loạn.
 *
 * Giải pháp: TRƯỚC khi dịch, đếm tần suất cục bộ (không tốn AI) các cụm Hán lặp lại
 * trong đúng những field sắp dịch + từ khoá lorebook, rồi gửi MỘT lượt gọi AI dịch cả
 * bảng tên (Hán-Việt cho tên người/địa danh/tông môn). Kết quả merge vào glossary —
 * mọi luồng dịch song song dùng chung ⇒ tên nhất quán toàn card.
 *
 * File này thuần logic (không gọi API, không đụng store) để test được bằng vitest;
 * lượt gọi AI nằm ở useTranslation (Pha 0).
 */

export interface NameCandidate {
  term: string;
  count: number;
  /** true = lấy từ keyword lorebook / tên card (ưu tiên giữ, không cần đủ tần suất) */
  fromKeys: boolean;
}

export interface ExtractOptions {
  /** Cụm trong thân văn bản phải xuất hiện ≥ minCount lần (mặc định 3) */
  minCount?: number;
  /** Trần số ứng viên gửi AI (mặc định 60) */
  maxCandidates?: number;
  /** Độ dài cụm Hán 2..maxLen (mặc định 6 — đủ cho tên công pháp/tông môn) */
  maxLen?: number;
  /** Trần ký tự corpus để đếm (card cực lớn thì cắt, mặc định 400K) */
  maxCorpusChars?: number;
}

// Field schema/logic (initvar, mvu_logic, controller) KHÔNG đưa vào corpus: tên biến MVU đã có
// từ điển riêng (Chiến lược B) — trộn vào đây dễ sinh bản dịch tên biến lệch với MVU dict.
const SCHEMA_ENTRY_TYPES = new Set(['initvar', 'mvu_logic', 'controller']);

// Ký tự ngữ pháp thuần — cụm chứa 1 trong các ký tự này gần như chắc chắn không phải tên riêng.
// CHỦ Ý giữ danh sách NGẮN (chỉ hư từ tuyệt đối): lọc hụt thì AI bỏ giúp ở bước dịch bảng,
// còn lọc lố thì tên thật không bao giờ tới được AI.
const PARTICLE_CHARS = new Set('的了着吗呢吧啊哦呀嘛么被们您咱就都也很挺这那哪谁个是没');

// Danh từ/cụm thông dụng hay lặp trong card (đặc biệt card system/game) nhưng không cần cố định
// bản dịch — model nào cũng dịch nhất quán sẵn. Match TUYỆT ĐỐI cả cụm.
const STOP_TERMS = new Set([
  '时候', '现在', '时间', '地方', '东西', '事情', '感觉', '声音', '眼睛', '身体',
  '什么', '怎么', '如果', '因为', '所以', '但是', '然后', '已经', '开始', '结束',
  '可以', '不能', '自己', '对方', '一个', '一些', '进行', '出现', '发生', '使用',
  '获得', '增加', '减少', '提升', '降低', '选择', '要求', '注意', '描述', '内容',
  '格式', '输出', '回复', '对话', '剧情', '当前', '角色', '玩家', '用户', '状态',
]);

/**
 * (bugNeedFix/180) Macro {{…}} TUYỆT ĐỐI không được vào glossary.
 * Glossary được bơm thẳng vào prompt dưới dạng "nguồn → đích" và model làm theo rất ngoan; chỉ
 * cần một mục dính macro là nó đổi macro đó ở MỌI entry — đúng cảnh user gặp với {{user}}.
 */
/** Tách chuỗi keyword lorebook (phẩy Anh/Trung, chấm phẩy, xuống dòng) thành từng key. */
function splitKeywordList(text: string): string[] {
  return text.split(/[,，、;；\n]+/).map(s => s.trim()).filter(Boolean);
}

function hasParticle(term: string): boolean {
  for (const ch of term) if (PARTICLE_CHARS.has(ch)) return true;
  return false;
}

const HAN_RUN_RE = /\p{Script=Han}+/gu;

/**
 * Quét các field SẮP DỊCH, trả về ứng viên tên riêng/thuật ngữ theo tần suất.
 * - Keyword lorebook + tên card: ưu tiên (fromKeys) — vào thẳng danh sách dù ít lặp.
 * - Thân văn bản: đếm n-gram Hán 2..maxLen, giữ cụm lặp ≥ minCount, lọc hư từ +
 *   stoplist, rồi khử cụm con (cụm ngắn gần như chỉ xuất hiện bên trong cụm dài hơn).
 */
export function extractNameCandidates(
  fields: TranslationField[],
  opts: ExtractOptions = {},
): NameCandidate[] {
  const minCount = opts.minCount ?? 3;
  const maxCandidates = opts.maxCandidates ?? 60;
  const maxLen = opts.maxLen ?? 6;
  const maxCorpusChars = opts.maxCorpusChars ?? 400_000;

  const active = fields.filter(f =>
    (f.status === 'pending' || f.status === 'error') &&
    !SCHEMA_ENTRY_TYPES.has(f.entryType || ''),
  );

  // ── Nguồn ưu tiên: keyword lorebook + tên card ──
  const keyTerms = new Map<string, number>();
  for (const f of active) {
    const isKeys = f.group === 'lorebook_keys';
    const isName = /(^|\.)name$/.test(f.path) && f.group === 'core';
    if (!isKeys && !isName) continue;
    for (const key of splitKeywordList(f.original)) {
      // Chỉ nhận key thuần Hán 2..8 ký tự (key dài/lẫn Latin thường là câu mô tả)
      const chars = Array.from(key);
      if (chars.length < 2 || chars.length > 8) continue;
      if (!/^\p{Script=Han}+$/u.test(key)) continue;
      if (hasParticle(key) || STOP_TERMS.has(key)) continue;
      if (isMacroPollutedTerm(key)) continue;   // (bug 180)
      keyTerms.set(key, (keyTerms.get(key) || 0) + 1);
    }
  }

  // ── Corpus thân văn bản ──
  let corpus = '';
  for (const f of active) {
    if (f.group === 'lorebook_keys') continue; // đã xử lý riêng ở trên
    corpus += f.original + '\n';
    if (corpus.length >= maxCorpusChars) { corpus = corpus.slice(0, maxCorpusChars); break; }
  }

  // Đếm n-gram trong từng run Hán liên tục (Array.from để không cắt đôi surrogate pair)
  const counts = new Map<string, number>();
  for (const m of corpus.matchAll(HAN_RUN_RE)) {
    const chars = Array.from(m[0]);
    for (let n = 2; n <= maxLen; n++) {
      for (let i = 0; i + n <= chars.length; i++) {
        const gram = chars.slice(i, i + n).join('');
        counts.set(gram, (counts.get(gram) || 0) + 1);
      }
    }
  }

  // Cộng thêm tần suất corpus cho key ưu tiên (để xếp hạng đẹp hơn)
  for (const [term, kCount] of keyTerms) {
    counts.set(term, (counts.get(term) || 0) + kCount);
  }

  // ── Lọc ──
  const passed: { term: string; count: number }[] = [];
  for (const [term, count] of counts) {
    const isKey = keyTerms.has(term);
    if (!isKey && count < minCount) continue;
    if (hasParticle(term) || STOP_TERMS.has(term)) continue;
    if (isMacroPollutedTerm(term)) continue;   // (bug 180)
    passed.push({ term, count });
  }

  // ── Khử cụm con: duyệt cụm DÀI trước; cụm ngắn bị loại nếu nó gần như chỉ sống bên trong
  // một cụm dài đã giữ (count ngắn ≤ count dài × 1.6). 青云宗(40) vs 青云宗弟子(10) → giữ cả hai;
  // 云宗弟(10) trong 青云宗弟子(10) → loại. Key ưu tiên không bao giờ bị loại.
  passed.sort((a, b) => (b.term.length - a.term.length) || (b.count - a.count));
  const accepted: { term: string; count: number }[] = [];
  for (const cand of passed) {
    const swallowed = !keyTerms.has(cand.term) && accepted.some(a =>
      a.term.length > cand.term.length &&
      a.term.includes(cand.term) &&
      cand.count <= a.count * 1.6,
    );
    if (!swallowed) accepted.push(cand);
  }

  // ── Xếp hạng: key ưu tiên trước, rồi theo tần suất ──
  const result: NameCandidate[] = accepted.map(c => ({
    term: c.term,
    count: c.count,
    fromKeys: keyTerms.has(c.term),
  }));
  result.sort((a, b) => (Number(b.fromKeys) - Number(a.fromKeys)) || (b.count - a.count));
  return result.slice(0, maxCandidates);
}

/** Prompt cho lượt gọi duy nhất của Pha 0: dịch bảng ứng viên, AI tự loại từ thông dụng. */
export function buildNameGlossaryPrompt(
  candidates: NameCandidate[],
  targetLanguage: string,
  nameStyle: NameStyle = 'hanviet',
  fandomMode = false,
  fandomName = '',
): { system: string; user: string } {
  // (User 19/07) 🎌 ĐỒNG NHÂN — persona KHÁC HẲN. Bản thường tự nhận là "chuyên gia thẻ tiếng Trung"
  // + đòi "dịch thuật ngữ tu luyện", nên card đồng nhân IP Nhật bị đọc qua lăng kính Trung ngay từ
  // bước lập bảng tên; mà bảng tên này lại được ép cho TOÀN BỘ card ở các field sau ⇒ 1 tên sai ở
  // đây là sai lan ra cả thẻ (và ghi đè cả field trước đó đã dịch đúng).
  if (fandomMode) {
    const ip = fandomName.trim();
    const system = `Bạn là chuyên gia về ĐỒNG NHÂN (fan-fiction) và tên gọi chính tắc của các tác phẩm anime/manga/game/light novel${ip ? `, đặc biệt là tác phẩm "${ip}"` : ''}.
Người dùng gửi danh sách cụm từ XUẤT HIỆN NHIỀU LẦN trong một thẻ nhân vật đồng nhân (thẻ viết bằng tiếng Trung nhưng nhân vật thuộc tác phẩm gốc). Nhiệm vụ:

1. CHỈ GIỮ tên riêng / thuật ngữ cần cố định: tên nhân vật, địa danh, tổ chức, chiêu thức, vật phẩm, biệt danh.
2. QUY TẮC TÊN — TUÂN THỦ TUYỆT ĐỐI:
${buildFandomNameRules(ip)}
3. Với MỖI cụm, hãy tự hỏi: "đây có phải tên của một nhân vật/địa danh trong tác phẩm gốc không?"
   - CÓ → dùng ĐÚNG tên chính tắc mà fandom dùng (dạng Latin). Ví dụ 雪乃 trong Oregairu là "Yukino", KHÔNG phải "Tuyết Nãi", KHÔNG phải "Xue Nai".
   - KHÔNG chắc → BỎ HẲN dòng đó (thà thiếu còn hơn chốt sai, vì bảng này sẽ được ép cho toàn thẻ).
4. Từ thông dụng, động từ, cụm mô tả vô danh → BỎ HẲN (không ghi dòng nào).

FORMAT KẾT QUẢ — mỗi mục 1 dòng, KHÔNG giải thích, KHÔNG đánh số, KHÔNG markdown:
原文=Tên chính tắc`;
    const user = `Danh sách cụm từ (kèm số lần xuất hiện trong thẻ):\n\n`
      + candidates.map(c => `${c.term} (${c.count} lần${c.fromKeys ? ', là keyword lorebook' : ''})`).join('\n');
    return { system, user };
  }

  const system = `Bạn là chuyên gia dịch TÊN RIÊNG và THUẬT NGỮ trong thẻ nhân vật (character card) tiếng Trung sang ${targetLanguage}.
Người dùng gửi danh sách cụm từ XUẤT HIỆN NHIỀU LẦN trong thẻ. Nhiệm vụ của bạn:

1. CHỈ GIỮ tên riêng hoặc thuật ngữ cần cố định bản dịch: tên người, địa danh, tông môn/tổ chức, công pháp/chiêu thức, vật phẩm đặc biệt, xưng hiệu, cảnh giới tu luyện.
2. QUY TẮC PHIÊN ÂM TÊN RIÊNG — TUÂN THỦ NGHIÊM NGẶT:
${buildProperNounRules(nameStyle)}
3. Thuật ngữ tu luyện/game → dịch nghĩa chuẩn cộng đồng (金丹 → Kim Đan, 灵气 → linh khí).
4. Từ thông dụng, động từ, cụm mô tả vô danh → BỎ HẲN khỏi kết quả (không ghi dòng nào).
5. Cụm = tên riêng + từ thông dụng dính kèm (ví dụ 青云宗弟子) → BỎ nếu phần tên riêng đã có dòng riêng.

FORMAT KẾT QUẢ — mỗi mục 1 dòng, KHÔNG giải thích, KHÔNG đánh số, KHÔNG markdown:
原文=Bản dịch`;

  const user = `Danh sách cụm từ (kèm số lần xuất hiện trong thẻ):\n\n`
    + candidates.map(c => `${c.term} (${c.count} lần${c.fromKeys ? ', là keyword lorebook' : ''})`).join('\n');

  return { system, user };
}

/**
 * Parse kết quả AI thành GlossaryEntry[]. Phòng thủ:
 * - chỉ nhận source nằm trong danh sách ứng viên đã gửi (chặn AI bịa thêm),
 * - target phải sạch (không rỗng, không còn chữ Hán, khác nguyên văn),
 * - chấp nhận phân cách = / ＝ / → / tab, bỏ code fence + đánh số nếu AI lỡ thêm.
 */
export function parseNameGlossaryResponse(
  raw: string,
  candidates: NameCandidate[],
): GlossaryEntry[] {
  const allowed = new Set(candidates.map(c => c.term));
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();

  for (let line of raw.split('\n')) {
    line = line.replace(/^```.*$/, '').replace(/^[\s\-*•\d.)]+/, '').trim();
    if (!line) continue;
    const m = line.split(/[=＝→\t]/);
    if (m.length < 2) continue;
    const source = m[0].trim();
    const target = m.slice(1).join('=').trim().replace(/^["'「]|["'」]$/g, '').trim();
    if (!allowed.has(source) || seen.has(source)) continue;
    if (!target || target === source) continue;
    if (/skip|bỏ qua/i.test(target) && target.length <= 8) continue;
    if (/\p{Script=Han}/u.test(target)) continue; // bản dịch còn chữ Hán = hỏng
    out.push({ source, target });
    seen.add(source);
  }
  return out;
}

/**
 * ─── HỌC TỪ ĐIỂN TRONG KHI DỊCH (harvest, non-AI) ───
 * Sau khi dịch xong, "gặt" các cặp tên NGUỒN→ĐÍCH đã được xác lập từ field ĐÃ DỊCH — chủ yếu từ
 * KEYWORD lorebook (mỗi entry lorebook thường là 1 nhân vật/vật phẩm: source keyword ↔ translated
 * keyword = tên + biệt danh + alias) và TÊN thẻ. Đây là nguồn tên/biệt danh tin cậy nhất (do chính
 * bản dịch tạo ra), bổ sung cho Pha 0 (chỉ đoán theo tần suất). Thuần luật, KHÔNG gọi AI.
 * Điều kiện an toàn: chỉ nhận cặp khi source có chữ Hán, target KHÔNG còn chữ Hán, và (với keyword)
 * số lượng key nguồn/đích KHỚP nhau để zip đúng thứ tự.
 */
export function harvestGlossaryFromFields(fields: TranslationField[]): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  const add = (rawSource: string, rawTarget: string) => {
    const source = rawSource.trim();
    const target = rawTarget.trim().replace(/^["'「『]|["'」』]$/g, '').trim();
    if (!source || !target || source === target || seen.has(source)) return;
    // (bugNeedFix/180) Dính macro là loại thẳng — cả hai phía.
    if (isMacroPollutedTerm(source) || isMacroPollutedTerm(target)) return;
    if (!/\p{Script=Han}/u.test(source)) return;   // nguồn phải có chữ Hán (là tên Trung)
    if (/\p{Script=Han}/u.test(target)) return;    // đích còn chữ Hán = chưa dịch xong → bỏ
    const slen = Array.from(source).length;
    if (slen < 1 || slen > 12) return;             // tên/biệt danh hợp lý
    if (hasParticle(source) || STOP_TERMS.has(source)) return;
    seen.add(source);
    out.push({ source, target, auto: true, origin: 'harvest' });
  };
  for (const f of fields) {
    if (f.status !== 'done' || typeof f.translated !== 'string' || !f.translated) continue;
    if (f.group === 'lorebook_keys') {
      const src = splitKeywordList(f.original);
      const tgt = splitKeywordList(f.translated);
      if (src.length > 0 && src.length === tgt.length) {
        for (let i = 0; i < src.length; i++) add(src[i], tgt[i]);
      }
    } else if (/(^|\.)name$/.test(f.path) && f.group === 'core') {
      add(f.original, f.translated);
    }
  }
  return out;
}

/** Merge entry mới vào glossary hiện có — entry user nhập tay/đã có LUÔN thắng. */
export function mergeGlossary(
  existing: GlossaryEntry[],
  incoming: GlossaryEntry[],
): { merged: GlossaryEntry[]; added: number } {
  const have = new Set(existing.map(g => g.source.trim()).filter(Boolean));
  const fresh = incoming.filter(g => !have.has(g.source.trim()));
  return { merged: [...existing, ...fresh], added: fresh.length };
}

/**
 * Lọc glossary theo văn bản sắp dịch — glossary to (auto Pha 0 có thể 40-60 mục) mà nhét
 * nguyên vào MỌI prompt thì vừa phình token vừa dễ khiến model áp tên không liên quan.
 * Chỉ lọc khi glossary > threshold để glossary thủ công nhỏ giữ NGUYÊN hành vi cũ.
 */
export function filterGlossaryForText(
  glossary: GlossaryEntry[],
  text: string,
  threshold = 8,
): GlossaryEntry[] {
  if (glossary.length <= threshold || !text) return glossary;
  const filtered = glossary.filter(g => g.source.trim() && text.includes(g.source.trim()));
  // An toàn: lọc xong rỗng (field toàn code chẳng hạn) thì trả rỗng luôn — đúng nghĩa
  // "không tên nào xuất hiện trong field này".
  return filtered;
}
