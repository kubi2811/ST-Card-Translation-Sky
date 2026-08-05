// ─── Xử lý extensions.regex_scripts[] của preset (pure phần quyết định/biến đổi) ───
// Mẫu thật 36 regex: 27 GIỮ NGUYÊN, 9 dịch — 9 cái đó dịch vì chúng khớp NGÔN NGỮ OUTPUT
// của AI (tên tag <状态面板>, header ### 正文…). Chính sách an toàn v1:
//  - Mọi cụm CJK trong regex ĐỀU nằm trong dict tag/var → thay deterministic ('auto').
//  - Có cụm CJK lạ (blocklist văn phong 死死的|一抹…) → GIỮ NGUYÊN + báo 'manual' —
//    tự chế lại ngữ nghĩa mấy regex đó là vượt quyền máy, thà để user quyết.
// Regex đã thay PHẢI compile lại được, không thì hoàn nguyên.
import type { PresetDict, RegexRow } from './types';
import { charClassRanges } from '../scriptTranslate/regexAlternation';

const CJK_RUN = /[一-鿿㐀-䶿぀-ヿ가-힯]+/g;

export const cjkRunsOf = (s: string): string[] => {
  CJK_RUN.lastIndex = 0;
  const out = new Set<string>();
  for (let m = CJK_RUN.exec(s); m; m = CJK_RUN.exec(s)) out.add(m[0]);
  return [...out];
};

/**
 * Cụm CJK này có được dict phủ TRỌN không (ghép từ các key tag/var liền nhau)?
 *
 * (bug 213) Có memo theo VỊ TRÍ. Bản cũ đệ quy thử mọi key prefix rồi backtrack mà không cache:
 * với dict nhiều key chồng lấn (状 / 状态 / 状态面…) và một run CJK dài trong findRegex — blocklist
 * văn phong dài là chuyện có thật trong preset — số nhánh phải thử tăng theo HÀM MŨ mỗi khi phủ
 * THẤT BẠI. Hàm này chạy cho từng regex trong buildInventory (tức là lúc render UI), đủ để đơ tab,
 * đúng họ với vụ catastrophic backtracking ở scanZodFields đã phải vá.
 */
export function runCoveredByDict(run: string, keys: string[]): boolean {
  if (!run) return true;
  const memo = new Map<number, boolean>();
  const go = (pos: number): boolean => {
    if (pos >= run.length) return true;
    const cached = memo.get(pos);
    if (cached !== undefined) return cached;
    let ok = false;
    for (const k of keys) {
      if (k && run.startsWith(k, pos) && go(pos + k.length)) { ok = true; break; }
    }
    memo.set(pos, ok);
    return ok;
  };
  return go(0);
}

/** Escape ký tự đặc biệt để chuỗi thay thế được hiểu là VĂN BẢN THUẦN trong regex. */
const escapeRegexLiteral = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function decideRegex(findRegex: string, dict: PresetDict): RegexRow['decision'] {
  const runs = cjkRunsOf(findRegex);
  if (!runs.length) return 'none';
  const keys = [...Object.keys(dict.tags), ...Object.keys(dict.vars)].filter(Boolean).sort((a, b) => b.length - a.length);
  return runs.every((r) => runCoveredByDict(r, keys)) ? 'auto' : 'manual';
}

/** Tách dạng ST: "/body/flags" hoặc body trần. */
export function splitStRegex(findRegex: string): { body: string; flags: string; wrapped: boolean } {
  const m = findRegex.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  if (m) return { body: m[1], flags: m[2], wrapped: true };
  return { body: findRegex, flags: '', wrapped: false };
}

export interface RegexPassResult {
  findRegex: string;
  changed: boolean;
  reverted: boolean;
  /** Cụm nằm trong [...] — cố ý KHÔNG đụng (xem giải thích ở transformRegex). */
  skippedInClass?: string[];
}

/**
 * Áp dict tag/var lên 1 findRegex 'auto'. Compile fail → hoàn nguyên.
 *
 * (bug 213) Hai lỗ hổng của bản cũ (nó gọi applyTagRenames — thay chuỗi trần toàn cục):
 *
 * 1. KHÔNG BIẾT GÌ VỀ CHARACTER CLASS. Dict có 状态 → "Trạng thái", regex là `/[状态栏]/` thì thân
 *    thành `[Trạng thái栏]` — từ "khớp 1 trong 3 ký tự" biến thành "khớp bất kỳ chữ cái nào trong
 *    'Trạng thái' cộng 栏". Compile vẫn OK nên chốt hoàn nguyên không bắt được: regex khớp sai
 *    lặng lẽ. Phía Dịch Script đã xử đúng ca này từ bug 200 (mục 1.3) — giờ dùng chung đúng hàm
 *    charClassRanges của nó thay vì chép lại logic.
 *
 * 2. KHÔNG ESCAPE bản dịch. Tên tag tiếng Việt chứa `(`, `.`, `?`… là thành cú pháp regex thay vì
 *    văn bản cần khớp. Giờ escape trước khi chèn.
 */
export function transformRegex(findRegex: string, dict: PresetDict): RegexPassResult {
  const { body, flags, wrapped } = splitStRegex(findRegex);
  // Var trong regex hiếm, nhưng tag thì phổ biến — dùng cùng bộ thay tag (dài trước).
  const merged: Record<string, string> = { ...dict.vars, ...dict.tags };
  const keys = Object.keys(merged).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!keys.length) return { findRegex, changed: false, reverted: false };

  const classes = charClassRanges(body);
  const inClass = (pos: number) => classes.some(([s, e]) => pos >= s && pos < e);

  let out = '';
  let i = 0;
  let changed = false;
  const skippedInClass = new Set<string>();

  while (i < body.length) {
    // Cặp escape `\x` copy nguyên xi — không được nhìn vào giữa nó.
    if (body[i] === '\\') { out += body.slice(i, i + 2); i += 2; continue; }

    let hit: string | null = null;
    for (const k of keys) {
      if (body.startsWith(k, i)) { hit = k; break; }
    }

    if (hit && inClass(i)) {
      // Trong [...] thì thay chuỗi là đổi hẳn ngữ nghĩa — bỏ qua, ghi nhận để báo lên.
      skippedInClass.add(hit);
      out += body[i];
      i++;
      continue;
    }

    if (hit) {
      out += escapeRegexLiteral(merged[hit]);
      i += hit.length;
      changed = true;
      continue;
    }

    out += body[i];
    i++;
  }

  const skipped = skippedInClass.size ? [...skippedInClass] : undefined;
  if (!changed) return { findRegex, changed: false, reverted: false, skippedInClass: skipped };
  try {
    void new RegExp(out, flags);
  } catch {
    return { findRegex, changed: false, reverted: true, skippedInClass: skipped };
  }
  return {
    findRegex: wrapped ? `/${out}/${flags}` : out,
    changed: true,
    reverted: false,
    skippedInClass: skipped,
  };
}
