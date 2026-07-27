/**
 * src/presetTranslate/presetLabelSync.ts — ĐỒNG BỘ NHÃN VĂN BẢN GIỮA PROMPT VÀ REGEX CỦA PRESET.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 27/07 — việc 118) Preset dạy AI xuất theo khuôn có NHÃN:
 *     {{setvar::options_fmt::<options>
 *     >选项一：{hành động...}
 *     >选项二：{...}}}
 * và có regex bám đúng nhãn đó để làm đẹp:
 *     <options>\s*?>选项一：\s*([^>]+?)\s*?>选项二：...
 *
 * Pipeline dịch prompt → "Lựa chọn 1:", nhưng regex pass chỉ biết thay TAG/VAR theo từ điển;
 * nhãn văn bản không phải tag nên `decideRegex` trả 'manual' và bỏ qua NGUYÊN script. Kết quả
 * đúng như user báo: AI xuất "Lựa chọn 1:" mà regex vẫn rình "选项一：" — không bao giờ khớp.
 *
 * Nguồn ánh xạ đáng tin nhất là CHÍNH cặp prompt trước/sau dịch (ghép theo identifier):
 * cùng một prompt, nhãn dòng thứ N bên gốc ứng với nhãn dòng thứ N bên dịch. Không đoán,
 * không gọi AI — lệch số lượng thì không ghép (ghép bừa còn tệ hơn bỏ).
 */

const HAN_RE = /[一-鿿㐀-䶿]/;

export interface PromptLike {
  identifier?: string;
  content?: string;
}

/**
 * Trích các NHÃN ĐẦU DÒNG dạng `>NHÃN：` / `NHÃN:` theo thứ tự xuất hiện.
 * Nhãn = chuỗi ngắn (≤30 ký tự) đứng đầu dòng (cho phép `>`/`-`/`•`/số thứ tự đằng trước),
 * kết thúc bằng dấu hai chấm (cả ： fullwidth lẫn : thường).
 */
export function extractLineLabels(text: string): string[] {
  return extractLineLabelTokens(text).map(t => t.label);
}

/**
 * Như trên nhưng giữ cả DẤU HAI CHẤM đi kèm. Chi tiết này ăn tiền: preset gốc dùng `：`
 * fullwidth (>选项一：) còn bản dịch dùng `:` thường (>Lựa chọn 1: ) — chỉ thay nhãn mà giữ
 * dấu cũ thì regex thành ">Lựa chọn 1：" vẫn trượt đầu ra thật của AI. Test trên dữ liệu
 * bug/118 bắt được đúng ca này.
 */
export function extractLineLabelTokens(text: string): Array<{ label: string; colon: string }> {
  const out: Array<{ label: string; colon: string }> = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[>\-•*]?\s*([^：:{}<>\n]{1,30}?)\s*([：:])/);
    if (!m) continue;
    const label = m[1].trim();
    if (!label) continue;
    // Loại nhiễu: macro/cú pháp ({{setvar, http...) — nhãn thật là chữ nghĩa thuần.
    if (/[{}\\/=]|^https?$/i.test(label)) continue;
    out.push({ label, colon: m[2] });
  }
  return out;
}

/**
 * Dựng bảng "nhãn gốc → nhãn đã dịch" từ hai danh sách prompt (trước / sau dịch).
 * Ghép prompt theo identifier; trong từng cặp, nhãn ghép 1-1 theo thứ tự dòng và CHỈ khi
 * số nhãn hai bên bằng nhau. Chỉ nhận nhãn gốc CÓ chữ Hán (thứ cần dịch) và bản dịch
 * KHÔNG còn chữ Hán (đã dịch thật). Nhiều prompt bất đồng → bản gặp nhiều nhất thắng.
 */
export function buildLabelMap(
  pristinePrompts: PromptLike[] | undefined,
  translatedPrompts: PromptLike[] | undefined,
): Record<string, string> {
  const votes = new Map<string, Map<string, number>>();
  const byId = new Map<string, PromptLike>();
  for (const p of translatedPrompts || []) {
    if (p?.identifier) byId.set(String(p.identifier), p);
  }

  for (const zp of pristinePrompts || []) {
    if (!zp?.identifier || !zp.content) continue;
    const vp = byId.get(String(zp.identifier));
    if (!vp?.content || vp.content === zp.content) continue;

    const zTokens = extractLineLabelTokens(zp.content);
    const vTokens = extractLineLabelTokens(String(vp.content));
    if (zTokens.length === 0 || zTokens.length !== vTokens.length) continue;

    for (let i = 0; i < zTokens.length; i++) {
      // Map KÈM dấu hai chấm: "选项一：" → "Lựa chọn 1: " đổi được cả ： fullwidth sang : thường
      // theo đúng những gì AI sẽ xuất — thay mỗi nhãn mà giữ dấu cũ thì regex vẫn trượt.
      const from = zTokens[i].label + zTokens[i].colon;
      const to = vTokens[i].label + vTokens[i].colon;
      if (from === to) continue;
      if (!HAN_RE.test(zTokens[i].label)) continue;  // nhãn gốc phải là thứ cần dịch
      if (HAN_RE.test(vTokens[i].label)) continue;   // bản dịch còn chữ Hán = chưa dịch xong, đừng học
      if (!votes.has(from)) votes.set(from, new Map());
      const inner = votes.get(from)!;
      inner.set(to, (inner.get(to) || 0) + 1);
    }
  }

  const map: Record<string, string> = {};
  for (const [from, inner] of votes) {
    let best = '', bestN = 0;
    for (const [to, n] of [...inner].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (n > bestN) { best = to; bestN = n; }
    }
    if (best) map[from] = best;
  }
  return map;
}

/** Escape một chuỗi chữ nghĩa để nhét an toàn vào THÂN regex. */
function escapeForRegexBody(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface LabelApplyResult {
  text: string;
  changed: boolean;
  /** true = đổi xong regex không compile được nên đã hoàn nguyên. */
  reverted: boolean;
  applied: string[];
}

/**
 * Áp bảng nhãn lên MỘT findRegex: thay nhãn gốc (chữ nghĩa thuần trong body) bằng bản dịch
 * ĐÃ ESCAPE. Đổi xong compile thử — fail thì hoàn nguyên, thà giữ regex cũ còn hơn phá nó.
 */
export function applyLabelMapToRegex(findRegex: string, map: Record<string, string>): LabelApplyResult {
  const src = String(findRegex || '');
  if (!src) return { text: src, changed: false, reverted: false, applied: [] };
  let out = src;
  const applied: string[] = [];
  // Nhãn dài thay trước để "选项一" không ăn mất một phần "选项一十".
  for (const from of Object.keys(map).sort((a, b) => b.length - a.length)) {
    if (!out.includes(from)) continue;
    out = out.split(from).join(escapeForRegexBody(map[from]));
    applied.push(from);
  }
  if (out === src) return { text: src, changed: false, reverted: false, applied: [] };

  // Compile check — tôn trọng vỏ /.../flags của SillyTavern.
  const m = out.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  try {
    if (m) void new RegExp(m[1], m[2]);
    else void new RegExp(out);
  } catch {
    return { text: src, changed: false, reverted: true, applied: [] };
  }
  return { text: out, changed: true, reverted: false, applied };
}

/** Áp bảng nhãn lên văn bản thường (replaceString/HTML) — thay trần, dài trước. */
export function applyLabelMapToText(text: string, map: Record<string, string>): { text: string; changed: boolean } {
  const src = String(text || '');
  let out = src;
  for (const from of Object.keys(map).sort((a, b) => b.length - a.length)) {
    if (!out.includes(from)) continue;
    out = out.split(from).join(map[from]);
  }
  return { text: out, changed: out !== src };
}
