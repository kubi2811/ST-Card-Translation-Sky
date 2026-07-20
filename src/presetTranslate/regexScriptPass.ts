// ─── Xử lý extensions.regex_scripts[] của preset (pure phần quyết định/biến đổi) ───
// Mẫu thật 36 regex: 27 GIỮ NGUYÊN, 9 dịch — 9 cái đó dịch vì chúng khớp NGÔN NGỮ OUTPUT
// của AI (tên tag <状态面板>, header ### 正文…). Chính sách an toàn v1:
//  - Mọi cụm CJK trong regex ĐỀU nằm trong dict tag/var → thay deterministic ('auto').
//  - Có cụm CJK lạ (blocklist văn phong 死死的|一抹…) → GIỮ NGUYÊN + báo 'manual' —
//    tự chế lại ngữ nghĩa mấy regex đó là vượt quyền máy, thà để user quyết.
// Regex đã thay PHẢI compile lại được, không thì hoàn nguyên.
import type { PresetDict, RegexRow } from './types';
import { applyTagRenames } from './consistencyPass';

const CJK_RUN = /[一-鿿㐀-䶿぀-ヿ가-힯]+/g;

export const cjkRunsOf = (s: string): string[] => {
  CJK_RUN.lastIndex = 0;
  const out = new Set<string>();
  for (let m = CJK_RUN.exec(s); m; m = CJK_RUN.exec(s)) out.add(m[0]);
  return [...out];
};

/** Cụm CJK này có được dict phủ TRỌN không (ghép từ các key tag/var liền nhau)? */
function runCoveredByDict(run: string, keys: string[]): boolean {
  if (!run) return true;
  for (const k of keys) {
    if (run.startsWith(k) && runCoveredByDict(run.slice(k.length), keys)) return true;
  }
  return false;
}

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
}

/** Áp dict tag/var lên 1 findRegex 'auto'. Compile fail → hoàn nguyên. */
export function transformRegex(findRegex: string, dict: PresetDict): RegexPassResult {
  const { body, flags, wrapped } = splitStRegex(findRegex);
  // Var trong regex hiếm, nhưng tag thì phổ biến — dùng cùng bộ thay tag (dài trước).
  const merged: Record<string, string> = { ...dict.vars, ...dict.tags };
  const newBody = applyTagRenames(body, merged);
  if (newBody === body) return { findRegex, changed: false, reverted: false };
  try {
    void new RegExp(newBody, flags);
  } catch {
    return { findRegex, changed: false, reverted: true };
  }
  return { findRegex: wrapped ? `/${newBody}/${flags}` : newBody, changed: true, reverted: false };
}
