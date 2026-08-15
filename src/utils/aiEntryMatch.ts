/**
 * src/utils/aiEntryMatch.ts — (bug 235) GHÉP ENTRY BẰNG TÊN, DO AI ĐỐI CHIẾU.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "tính năng So Sánh Card, thêm tính năng so sánh bằng tên bởi AI, chứ so bằng UID nó sai
 * bét nhè… Đầu tiên là so sánh xem các entry có tên gốc tiếng Trung của bản raw nếu dịch ra sẽ
 * giống các tên entry nào của bản đã dịch. Sau đó tới khâu so sánh nội dung… Mục đích là để đôi
 * lúc chỉ cần 1 bản dịch cũ và 1 bản raw mới, AI tự phát hiện entry lorebook/schema/regex/script
 * nào có thể tái sử dụng lại được."
 *
 * VÌ SAO LỐI CŨ SAI BÉT: `planMergeTwoCard` ghép hai thẻ bằng CHỖ NGỒI của entry —
 * `data.character_book.entries[12]` bên này phải là entry thứ 12 bên kia. Nó có hai cái neo:
 * key tiếng Trung trùng nhau, và lấp khoảng theo vị trí giữa hai neo. Cả hai đều gãy đúng lúc
 * người ta cần nhất:
 *   • Neo key Hán chỉ sống khi bản dịch xuất ở chế độ "Merge" (giữ key gốc + thêm key dịch). Ai
 *     xuất ở chế độ THAY key thì bản dịch không còn chữ Hán nào ⇒ KHÔNG CÓ neo nào.
 *   • Lấp khoảng theo vị trí đòi số entry giữa hai neo phải BẰNG NHAU. Tác giả thêm 3 entry và
 *     bỏ 1 entry trong cùng một khoảng là cả khoảng bị bỏ, mọi entry trong đó thành "entry mới".
 *   • Tác giả đảo thứ tự entry (rất hay gặp khi họ dọn lại sách) thì chỗ ngồi vô nghĩa hoàn toàn.
 * Hậu quả đúng như user tả: bản dịch cũ đã sửa rất ổn, sang bản mới lại phải sửa lại từ đầu.
 *
 * LỐI MỚI — ghép bằng thứ mà con người vẫn dùng để nhận ra một entry: CÁI TÊN. Ba tầng, rẻ trước
 * đắt sau, và tầng nào chắc hơn thì đứng trước:
 *   Tầng 1 (miễn phí, chắc chắn): key Hán trùng · tên trùng y hệt · nội dung trùng y hệt.
 *   Tầng 2 (AI, 1 lượt cho cả danh sách): đưa AI hai danh sách TÊN — bên raw tiếng Trung, bên đã
 *          dịch tiếng Việt — hỏi "tên nào ứng tên nào". Đây là việc AI làm giỏi và máy chịu.
 *   Tầng 3 (AI, theo lô): với từng cặp đã ghép, hỏi "nội dung raw nếu dịch ra có khác bản dịch cũ
 *          không" — trả lời giống/khác/không chắc. Đây là khâu quyết định TÁI DÙNG hay DỊCH LẠI.
 *
 * NGUYÊN TẮC AN TOÀN xuyên suốt (học từ bug 213 đợt 3 — "bảy chỗ đoán mò không có chứng cứ"):
 * ghép sai còn tệ hơn không ghép, vì nó dán bản dịch của entry KHÁC vào. Nên mọi kết quả AI đều
 * phải qua kiểm máy: id phải có thật, một-đối-một tuyệt đối, thiếu bằng chứng thì bỏ cặp chứ
 * không đoán. Và "không chắc" luôn được xử theo hướng DỊCH LẠI, không phải tái dùng.
 */

/** Loại đơn vị có thể tái dùng. Khớp đúng ba thứ user liệt kê (schema nằm trong lorebook/script). */
export type UnitKind = 'lorebook' | 'regex' | 'script';

/**
 * Một ĐƠN VỊ TÁI DÙNG — gom mọi field rời rạc của cùng một entry/script về một mối.
 * Ghép ở mức đơn vị chứ không mức field: tái dùng nửa entry này nửa entry kia là vô nghĩa.
 */
export interface MatchUnit {
  /** Khoá hiển thị + khoá ghép: 'lorebook[12]' · 'regex[3]' · 'tavernHelper[0]'. */
  id: string;
  kind: UnitKind;
  index: number;
  /** TÊN của đơn vị — thứ dùng để ghép. lorebook: comment (không có thì name); regex/script: tên script. */
  name: string;
  /** Key lorebook (chuỗi đã nối bằng dấu phẩy). Rỗng với regex/script. */
  keys: string;
  /** Nội dung chính, để so ở pha 2 và để ghép theo nội-dung-trùng ở tầng 1. */
  content: string;
  /** Mọi path thuộc đơn vị này → dùng để dựng kế hoạch tái dùng. */
  paths: string[];
}

/** Field tối thiểu mà bộ gom cần — khai hẹp để test khỏi dựng cả TranslationField. */
export interface UnitScanField {
  path: string;
  label: string;
  group: string;
  original: string;
}

/**
 * Tách nhãn dạng `lorebook[12].content [initvar]` / `regex[3].replaceString (Bảng trạng thái)`
 * thành { kind, index, field }.
 *
 * CỐ Ý đọc NHÃN chứ không đọc PATH: path của script TavernHelper có tới bốn dạng khác nhau tuỳ
 * thẻ (`data.extensions.TavernHelper.scripts[i]`, `data.extensions.TavernHelper_scripts[i]`,
 * dạng tuple `[…][1][i]`…), còn nhãn thì cardFields luôn dựng về đúng một dạng.
 */
export function parseUnitLabel(label: string): { kind: UnitKind; index: number; field: string } | null {
  const m = /^(lorebook|regex|tavernHelper)\[(\d+)\]\.([^\s(]+)/.exec(label || '');
  if (!m) return null;
  const kind: UnitKind = m[1] === 'lorebook' ? 'lorebook' : m[1] === 'regex' ? 'regex' : 'script';
  return { kind, index: Number(m[2]), field: m[3] };
}

/** Tên field mang NỘI DUNG CHÍNH của từng loại đơn vị. */
const CONTENT_FIELD: Record<UnitKind, string[]> = {
  lorebook: ['content'],
  regex: ['replaceString', 'findRegex'],
  script: ['content', 'code', 'source', 'info'],
};
/** Tên field mang TÊN của từng loại đơn vị, ưu tiên từ trái sang. */
const NAME_FIELD: Record<UnitKind, string[]> = {
  lorebook: ['comment', 'name'],
  regex: ['scriptName'],
  script: ['name'],
};

/**
 * Gom field rời thành đơn vị tái dùng. Đơn vị KHÔNG có tên lẫn nội dung thì bỏ — không có gì để
 * ghép, giữ lại chỉ làm nhiễu danh sách gửi cho AI.
 */
export function collectMatchUnits(fields: UnitScanField[]): MatchUnit[] {
  const byId = new Map<string, MatchUnit & { _fields: Map<string, string> }>();
  for (const f of fields || []) {
    const parsed = parseUnitLabel(f.label);
    if (!parsed) continue;
    const id = `${parsed.kind === 'script' ? 'tavernHelper' : parsed.kind}[${parsed.index}]`;
    let u = byId.get(id);
    if (!u) {
      u = { id, kind: parsed.kind, index: parsed.index, name: '', keys: '', content: '', paths: [], _fields: new Map() };
      byId.set(id, u);
    }
    u.paths.push(f.path);
    // Field trùng tên trong cùng đơn vị (vd trimStrings[0], trimStrings[1]) — giữ cái đầu là đủ.
    if (!u._fields.has(parsed.field)) u._fields.set(parsed.field, f.original ?? '');
  }

  const out: MatchUnit[] = [];
  for (const u of byId.values()) {
    for (const k of NAME_FIELD[u.kind]) {
      const v = (u._fields.get(k) || '').trim();
      if (v) { u.name = v; break; }
    }
    for (const k of CONTENT_FIELD[u.kind]) {
      const v = (u._fields.get(k) || '').trim();
      if (v) { u.content = v; break; }
    }
    u.keys = (u._fields.get('keys') || '').trim();
    if (!u.name && !u.content) continue;
    const { _fields, ...rest } = u;
    void _fields;
    out.push(rest);
  }
  out.sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind < b.kind ? -1 : 1));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * TẦNG 1 — ghép bằng LUẬT, miễn phí và chắc chắn
 * ════════════════════════════════════════════════════════════════════════ */

const HAN_RE = /[㐀-鿿]/;

/** Chuẩn hoá tên để so "trùng y hệt": bỏ khoảng trắng thừa, gộp hoa/thường, bỏ dấu trang trí. */
function normName(s: string): string {
  return (s || '')
    .replace(/[【】《》〈〉「」『』\[\]()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Tập key Hán của một đơn vị, sort + nối — danh tính bền nhất khi bản dịch giữ key gốc. */
function hanKeySig(u: MatchUnit): string {
  if (!u.keys) return '';
  const han = u.keys.split(/[,，]/).map((s) => s.trim()).filter((s) => s && HAN_RE.test(s));
  if (!han.length) return '';
  return [...new Set(han)].sort().join(' ');
}

export type MatchMethod = 'key-han' | 'ten-trung' | 'noi-dung-trung' | 'ai-ten';

export interface UnitPair {
  oldId: string;
  newId: string;
  method: MatchMethod;
  /** 'cao' | 'vua' | 'thap' — tầng luật luôn 'cao'; tầng AI lấy theo AI khai báo. */
  confidence: 'cao' | 'vua' | 'thap';
  /** Câu giải thích ngắn (AI trả về, hoặc do luật sinh) — hiện cho user tự soi. */
  why: string;
}

export interface RuleMatchResult {
  pairs: UnitPair[];
  /** Đơn vị chưa ghép được — đây là phần phải nhờ AI. */
  restOld: MatchUnit[];
  restNew: MatchUnit[];
}

/**
 * Ghép theo ba dấu hiệu CHẮC CHẮN, mỗi dấu hiệu chỉ nhận khi nó DUY NHẤT ở cả hai bên.
 * Trùng ở nhiều chỗ = không biết chọn cái nào = bỏ, để AI hoặc người quyết.
 */
export function matchUnitsByRule(oldUnits: MatchUnit[], newUnits: MatchUnit[]): RuleMatchResult {
  const pairs: UnitPair[] = [];
  const usedOld = new Set<string>();
  const usedNew = new Set<string>();

  const pass = (
    sigOf: (u: MatchUnit) => string,
    method: MatchMethod,
    why: string,
  ) => {
    const index = (list: MatchUnit[], used: Set<string>) => {
      const seen = new Map<string, MatchUnit>();
      const dup = new Set<string>();
      for (const u of list) {
        if (used.has(u.id)) continue;
        const sig = sigOf(u);
        if (!sig) continue;
        if (seen.has(sig)) { dup.add(sig); continue; }
        seen.set(sig, u);
      }
      for (const d of dup) seen.delete(d);
      return seen;
    };
    const oldIdx = index(oldUnits, usedOld);
    const newIdx = index(newUnits, usedNew);
    for (const [sig, nu] of newIdx) {
      const ou = oldIdx.get(sig);
      if (!ou) continue;
      // Không ghép chéo loại: một entry lorebook không thể là một regex script.
      if (ou.kind !== nu.kind) continue;
      pairs.push({ oldId: ou.id, newId: nu.id, method, confidence: 'cao', why });
      usedOld.add(ou.id);
      usedNew.add(nu.id);
    }
  };

  pass(hanKeySig, 'key-han', 'Trùng nguyên tập key tiếng Trung.');
  pass((u) => normName(u.name), 'ten-trung', 'Tên trùng y hệt ở cả hai bản.');
  pass((u) => (u.content ? u.content.replace(/\r\n/g, '\n') : ''), 'noi-dung-trung', 'Nội dung trùng y hệt (chưa dịch hoặc không đổi).');

  return {
    pairs,
    restOld: oldUnits.filter((u) => !usedOld.has(u.id)),
    restNew: newUnits.filter((u) => !usedNew.has(u.id)),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * TẦNG 2 — AI ghép TÊN (bước user mô tả là "đầu tiên")
 * ════════════════════════════════════════════════════════════════════════ */

/** Cắt gọn để prompt không phình: tên entry dài hiếm khi cần quá ngần này để nhận ra nhau. */
const NAME_MAX = 160;
const KEYS_MAX = 120;
const clip = (s: string, n: number) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const NAME_SYSTEM = `Bạn là trợ lý đối chiếu phiên bản card SillyTavern.

Người dùng có HAI bản của cùng một thẻ:
 • DANH SÁCH A — bản RAW MỚI của tác giả, tên mục còn nguyên ngữ (thường tiếng Trung).
 • DANH SÁCH B — bản ĐÃ DỊCH CŨ của người dùng, tên mục đã sang tiếng Việt.

Việc của bạn: với mỗi mục ở A, tìm mục ở B mà NẾU DỊCH TÊN CỦA A RA TIẾNG VIỆT thì trùng hoặc
tương đương. Đây là ghép theo Ý NGHĨA CỦA TÊN, không phải theo số thứ tự — tác giả có thể đã
thêm, bớt, đổi chỗ mục, nên số thứ tự hoàn toàn không đáng tin.

QUY TẮC BẮT BUỘC:
 • Mỗi mục A ghép nhiều nhất MỘT mục B, và mỗi mục B chỉ được dùng cho MỘT mục A.
 • Chỉ ghép khi hai mục CÙNG LOẠI (loại ghi trong ngoặc vuông ở đầu mỗi dòng).
 • KHÔNG ghép bừa cho đủ. Mục A không có ai ở B tương ứng thì BỎ QUA — đó là mục tác giả mới
   thêm, người dùng sẽ dịch mới. Ghép sai tai hại hơn nhiều so với không ghép, vì nó sẽ dán bản
   dịch của mục khác vào.
 • Từ khoá (keys) và đoạn nội dung mẫu chỉ là chứng cứ PHỤ để phân biệt hai tên na ná nhau.

Với mỗi cặp, cho biết độ tin:
 • "cao"  — nghĩa của tên khớp rõ ràng, không có ứng viên nào khác gần bằng;
 • "vua"  — hợp lý nhưng có ứng viên khác cũng na ná;
 • "thap" — đoán dựa trên chứng cứ yếu.

Trả về DUY NHẤT JSON, không kèm lời nào khác:
{"pairs":[{"a":"<id bên A>","b":"<id bên B>","tin":"cao|vua|thap","vi_sao":"<một câu tiếng Việt>"}]}`;

/** Một dòng mô tả đơn vị trong prompt — đủ để nhận ra nhau, không hơn. */
function unitLine(u: MatchUnit): string {
  const kindVi = u.kind === 'lorebook' ? 'lorebook' : u.kind === 'regex' ? 'regex' : 'script';
  const bits = [`${u.id} [${kindVi}]`, `tên: ${clip(u.name, NAME_MAX) || '(không có tên)'}`];
  if (u.keys) bits.push(`keys: ${clip(u.keys, KEYS_MAX)}`);
  bits.push(`dài ${u.content.length} ký tự`);
  return `- ${bits.join(' · ')}`;
}

export function buildNameMatchMessages(
  oldUnits: MatchUnit[],
  newUnits: MatchUnit[],
): { system: string; user: string } {
  const user = [
    '══ DANH SÁCH A — bản RAW MỚI (nguyên ngữ) ══',
    ...newUnits.map(unitLine),
    '',
    '══ DANH SÁCH B — bản ĐÃ DỊCH CŨ (tiếng Việt) ══',
    ...oldUnits.map(unitLine),
    '',
    `Ghép A→B theo đúng định dạng JSON đã nêu. A có ${newUnits.length} mục, B có ${oldUnits.length} mục.`,
  ].join('\n');
  return { system: NAME_SYSTEM, user };
}

/** Bóc khối JSON đầu tiên trong câu trả lời (AI hay bọc ```json). */
function extractJson(rawText: string): string {
  const m = (rawText || '').replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON.');
  return m[0];
}

const CONF = new Set(['cao', 'vua', 'thap']);

/**
 * Đọc kết quả ghép tên + KIỂM MÁY. Đây là chỗ chặn mọi kiểu bịa của AI:
 *  • id không có trong danh sách gửi đi → bỏ (AI tự chế id là chuyện có thật);
 *  • ghép chéo loại → bỏ;
 *  • một-đối-một: cùng một mục bị ghép hai lần thì chỉ giữ cặp tin cậy cao nhất, phần còn lại bỏ
 *    hẳn chứ không "chia đều" — thà mất một cặp còn hơn dán nhầm bản dịch.
 */
export function parseNameMatchResponse(
  rawText: string,
  oldUnits: MatchUnit[],
  newUnits: MatchUnit[],
): UnitPair[] {
  const parsed = JSON.parse(extractJson(rawText)) as { pairs?: unknown };
  const rows = Array.isArray(parsed.pairs) ? parsed.pairs : [];
  const oldById = new Map(oldUnits.map((u) => [u.id, u]));
  const newById = new Map(newUnits.map((u) => [u.id, u]));

  const rank = { cao: 3, vua: 2, thap: 1 } as const;
  const cand: UnitPair[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const newId = String(o.a ?? '').trim();
    const oldId = String(o.b ?? '').trim();
    const nu = newById.get(newId);
    const ou = oldById.get(oldId);
    if (!nu || !ou) continue;             // AI bịa id
    if (nu.kind !== ou.kind) continue;    // ghép chéo loại
    const tin = String(o.tin ?? 'vua').trim().toLowerCase();
    cand.push({
      oldId, newId, method: 'ai-ten',
      confidence: (CONF.has(tin) ? tin : 'vua') as UnitPair['confidence'],
      why: String(o.vi_sao ?? '').trim().slice(0, 200) || 'AI đối chiếu theo nghĩa của tên.',
    });
  }

  // Một-đối-một: sắp theo độ tin giảm dần rồi lấy lượt đầu; mọi lượt sau đụng id đã dùng thì bỏ.
  cand.sort((a, b) => rank[b.confidence] - rank[a.confidence]);
  const usedOld = new Set<string>();
  const usedNew = new Set<string>();
  const out: UnitPair[] = [];
  for (const p of cand) {
    if (usedOld.has(p.oldId) || usedNew.has(p.newId)) continue;
    usedOld.add(p.oldId); usedNew.add(p.newId);
    out.push(p);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * TẦNG 3 — AI so NỘI DUNG của từng cặp (bước user mô tả là "sau đó")
 * ════════════════════════════════════════════════════════════════════════ */

export type ContentVerdict = 'giong' | 'khac' | 'khong-chac';

export interface ContentJob {
  /** id bên bản RAW MỚI — dùng làm khoá trả kết quả. */
  newId: string;
  name: string;
  /** Nội dung bản RAW MỚI (nguyên ngữ). */
  rawContent: string;
  /** Nội dung bản ĐÃ DỊCH CŨ (tiếng Việt). */
  oldTranslated: string;
}

export interface ContentAnswer {
  newId: string;
  verdict: ContentVerdict;
  note: string;
}

/** Cắt nội dung trước khi gửi — so "có khác không" không cần đọc hết entry 20.000 chữ. */
export const CONTENT_SAMPLE = 2500;
function sample(s: string): string {
  const t = (s || '').replace(/\r\n/g, '\n');
  if (t.length <= CONTENT_SAMPLE) return t;
  // Lấy cả ĐẦU và CUỐI: tác giả hay thêm/bớt ở cuối entry, chỉ lấy đầu là mù đúng chỗ hay đổi.
  const half = Math.floor(CONTENT_SAMPLE / 2);
  return `${t.slice(0, half)}\n…[cắt bớt ${t.length - CONTENT_SAMPLE} ký tự giữa]…\n${t.slice(-half)}`;
}

const CONTENT_SYSTEM = `Bạn là trợ lý đối chiếu phiên bản card SillyTavern.

Với mỗi mục, bạn nhận NỘI DUNG BẢN RAW MỚI (nguyên ngữ, thường tiếng Trung) và BẢN DỊCH CŨ
(tiếng Việt) của cùng mục đó. Câu hỏi DUY NHẤT: nếu dịch bản raw mới ra tiếng Việt thì nó có
KHÁC bản dịch cũ về NỘI DUNG không?

Phán quyết:
 • "giong"      — cùng nội dung. Khác cách diễn đạt, khác dấu câu, khác thứ tự trình bày, thừa
                  thiếu khoảng trắng đều tính là GIỐNG.
 • "khac"       — tác giả đã thêm/bớt/sửa thông tin thật: thêm quy tắc, đổi con số, đổi tên,
                  bỏ một đoạn, viết lại một mục.
 • "khong-chac" — không đủ căn cứ để kết luận (nội dung bị cắt bớt quá nhiều, hai bên lệch hẳn
                  cấu trúc, hoặc bản dịch cũ có vẻ không phải bản dịch của mục này).

QUAN TRỌNG: nghi ngờ thì chọn "khong-chac" hoặc "khac", TUYỆT ĐỐI đừng chọn "giong" cho chắc
việc. Người dùng sẽ TÁI DÙNG nguyên bản dịch cũ cho mục nào bạn nói "giong" — nói sai là thẻ
mang nội dung lỗi thời mà không ai biết.

Với mục là CODE (regex, script, schema): chỉ xét phần LOGIC và phần CHỮ HIỂN THỊ. Tên biến/hàm
giữ nguyên tiếng Anh ở cả hai bên là bình thường, không tính là khác.

Trả về DUY NHẤT JSON:
{"ket_qua":[{"id":"<id mục>","ket_luan":"giong|khac|khong-chac","ghi_chu":"<một câu tiếng Việt>"}]}`;

export function buildContentVerdictMessages(jobs: ContentJob[]): { system: string; user: string } {
  const parts: string[] = [];
  for (const j of jobs) {
    parts.push(`\n══════ MỤC ${j.newId} — ${clip(j.name, NAME_MAX) || '(không tên)'} ══════`);
    parts.push('── BẢN RAW MỚI (nguyên ngữ) ──');
    parts.push(sample(j.rawContent));
    parts.push('── BẢN DỊCH CŨ (tiếng Việt) ──');
    parts.push(sample(j.oldTranslated));
  }
  parts.push(`\nTrả kết luận cho ĐỦ ${jobs.length} mục theo đúng định dạng JSON đã nêu.`);
  return { system: CONTENT_SYSTEM, user: parts.join('\n') };
}

/**
 * Đọc phán quyết nội dung. Mục nào AI KHÔNG trả lời thì mặc định 'khong-chac' — im lặng không
 * bao giờ được hiểu là "giống", vì hiểu thế là tái dùng một bản dịch chưa ai kiểm.
 */
export function parseContentVerdictResponse(rawText: string, jobs: ContentJob[]): ContentAnswer[] {
  const parsed = JSON.parse(extractJson(rawText)) as { ket_qua?: unknown };
  const rows = Array.isArray(parsed.ket_qua) ? parsed.ket_qua : [];
  const wanted = new Map(jobs.map((j) => [j.newId, j]));
  const got = new Map<string, ContentAnswer>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = String(o.id ?? '').trim();
    if (!wanted.has(id) || got.has(id)) continue;
    const kl = String(o.ket_luan ?? '').trim().toLowerCase();
    const verdict: ContentVerdict = kl === 'giong' ? 'giong' : kl === 'khac' ? 'khac' : 'khong-chac';
    got.set(id, { newId: id, verdict, note: String(o.ghi_chu ?? '').trim().slice(0, 200) });
  }
  return jobs.map((j) => got.get(j.newId) ?? {
    newId: j.newId, verdict: 'khong-chac' as const,
    note: 'AI không trả lời mục này — mặc định coi là chưa chắc, sẽ dịch lại cho an toàn.',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * KẾT QUẢ CUỐI — dựng kế hoạch tái dùng ở mức FIELD
 * ════════════════════════════════════════════════════════════════════════ */

export interface MatchRow {
  pair: UnitPair;
  /** Tên hai bên, để bảng duyệt hiện cho người đọc. */
  newName: string;
  oldName: string;
  verdict: ContentVerdict;
  note: string;
  /** Người dùng có chọn tái dùng cặp này không (mặc định theo verdict). */
  reuse: boolean;
}

/** Mặc định tái dùng CHỈ khi AI nói "giống". 'khac' và 'khong-chac' đều đi dịch lại. */
export function defaultReuse(verdict: ContentVerdict): boolean {
  return verdict === 'giong';
}

export interface FieldReusePlan {
  /** path bên bản RAW MỚI → bản dịch cũ để đắp vào. */
  reused: Map<string, string>;
  /** Số đơn vị được tái dùng / bị loại, để báo cho người dùng. */
  counts: { units: number; fields: number; skipped: number };
}

/**
 * Đổi các cặp ĐƠN VỊ đã duyệt thành bản đồ path→bản dịch, bằng cách ghép field CÙNG TÊN trong
 * hai đơn vị (content↔content, comment↔comment, keys↔keys…).
 *
 * Vì sao ghép theo tên field chứ không theo thứ tự: hai đơn vị có thể lệch nhau về số field
 * (bản mới có `secondary_keys`, bản cũ không) — ghép theo thứ tự là dán `keys` vào ô `comment`.
 * Field nào bên cũ không có thì BỎ, để nó đi đường dịch bình thường.
 */
export function buildFieldReusePlan(
  rows: MatchRow[],
  oldFields: UnitScanField[],
  newFields: UnitScanField[],
): FieldReusePlan {
  const fieldKey = (f: UnitScanField) => {
    const p = parseUnitLabel(f.label);
    if (!p) return null;
    const id = `${p.kind === 'script' ? 'tavernHelper' : p.kind}[${p.index}]`;
    return { id, field: p.field };
  };
  // id → (tên field → giá trị) cho bên CŨ, và id → (tên field → path) cho bên MỚI.
  const oldVal = new Map<string, Map<string, string>>();
  for (const f of oldFields) {
    const k = fieldKey(f);
    if (!k) continue;
    let m = oldVal.get(k.id);
    if (!m) { m = new Map(); oldVal.set(k.id, m); }
    if (!m.has(k.field)) m.set(k.field, f.original ?? '');
  }
  const newPath = new Map<string, Map<string, string>>();
  for (const f of newFields) {
    const k = fieldKey(f);
    if (!k) continue;
    let m = newPath.get(k.id);
    if (!m) { m = new Map(); newPath.set(k.id, m); }
    if (!m.has(k.field)) m.set(k.field, f.path);
  }

  const reused = new Map<string, string>();
  let units = 0, skipped = 0;
  for (const r of rows) {
    if (!r.reuse) { skipped++; continue; }
    const from = oldVal.get(r.pair.oldId);
    const to = newPath.get(r.pair.newId);
    if (!from || !to) { skipped++; continue; }
    let touched = 0;
    for (const [field, path] of to) {
      const v = from.get(field);
      if (v === undefined || v.trim() === '') continue;   // bên cũ không có field này → dịch bình thường
      reused.set(path, v);
      touched++;
    }
    if (touched > 0) units++; else skipped++;
  }
  return { reused, counts: { units, fields: reused.size, skipped } };
}

/**
 * Chia danh sách cặp thành các LÔ để gọi API pha 2 — cắt theo TỔNG SỐ KÝ TỰ chứ không theo số
 * mục: một entry 20.000 chữ đi cùng chín entry ngắn vẫn làm vỡ cửa sổ ngữ cảnh.
 */
export function batchContentJobs(jobs: ContentJob[], maxCharsPerBatch = 24_000, maxPerBatch = 8): ContentJob[][] {
  const out: ContentJob[][] = [];
  let cur: ContentJob[] = [];
  let size = 0;
  for (const j of jobs) {
    const cost = Math.min(j.rawContent.length, CONTENT_SAMPLE) + Math.min(j.oldTranslated.length, CONTENT_SAMPLE);
    if (cur.length > 0 && (size + cost > maxCharsPerBatch || cur.length >= maxPerBatch)) {
      out.push(cur); cur = []; size = 0;
    }
    cur.push(j); size += cost;
  }
  if (cur.length) out.push(cur);
  return out;
}
