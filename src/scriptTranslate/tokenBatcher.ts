// ─── Gom token CJK thành lô + prompt + parse response (pure — test không cần AI) ───
// Mỗi lô là danh sách chuỗi đánh dấu <<<id>>>; AI phải echo đúng marker. Parse STRICT:
// id nào không khớp = fail id đó (KHÔNG BAO GIỜ đoán theo vị trí — lệch 1 dòng là
// bản dịch chui nhầm vào giữa code).
import type { CJKToken } from '../utils/surgical';
import { smartPackFields, type SmartPackedBatch } from '../utils/smartPack';
import type { GlossaryEntry } from '../types/card';
import { filterGlossaryForText } from '../utils/nameGlossary';
import { ADVANCED_NSFW_TRANSLATION_TACTICS, GOMORRAH_NSFW_PROTECTION_RULES } from '../utils/promptBuilder';
import { buildProperNounRules } from '../utils/masterPrompt';
import type { NameStyle } from '../types/card';

/** Token ĐƯỢC PHÉP dịch — object key / dot-notation / CSS class / HTML attr GIỮ NGUYÊN
 *  (bản dịch tay mẫu giữ nguyên `{子时:"00:00"}`; đổi key là vỡ hợp đồng dữ liệu). */
export const isTranslatableToken = (t: CJKToken): boolean =>
  !t.isObjectKey && !t.isDotNotation && !t.isCssClass && !t.isHtmlAttr && !t.isIdentifier;

// Token đa phần là chuỗi UI ngắn → gom đông hơn card entry (12/lô của smartPack mặc định
// sẽ đẻ ~270 call cho 3.2k token). 40 token/lô, ngân sách 6k ký tự vào (~2.5× ra vẫn an toàn).
export const TOKEN_BATCH_MAX_COUNT = 40;
export const TOKEN_BATCH_CHAR_BUDGET = 6000;
export const TOKEN_BATCH_SOLO_CHARS = 3000;

export interface TokenBatchItem {
  original: string; // bắt buộc cho smartPackFields
  token: CJKToken;
}

export function packTokens(tokens: CJKToken[]): SmartPackedBatch<TokenBatchItem>[] {
  const items = tokens
    .filter((t) => isTranslatableToken(t) && !t.translated)
    .map((t) => ({ original: t.text, token: t }));
  return smartPackFields(items, TOKEN_BATCH_MAX_COUNT, TOKEN_BATCH_CHAR_BUDGET, TOKEN_BATCH_SOLO_CHARS);
}

export interface TokenPromptOptions {
  nsfw: boolean;
  nameStyle: NameStyle;
  fandomMode: boolean;
  fandomName: string;
}

export function buildTokenBatchPrompt(
  batch: TokenBatchItem[],
  glossary: GlossaryEntry[],
  opts: TokenPromptOptions,
): { system: string; user: string } {
  const joined = batch.map((b) => b.original).join('\n');
  const gl = filterGlossaryForText(glossary, joined);
  const glossaryBlock = gl.length
    ? `\n[MANDATORY TERMINOLOGY — dùng ĐÚNG các bản dịch này, không tự chế]\n${gl.map((g) => `${g.source} → ${g.target}`).join('\n')}\n`
    : '';
  const nsfwBlock = opts.nsfw ? `\n${ADVANCED_NSFW_TRANSLATION_TACTICS}\n${GOMORRAH_NSFW_PROTECTION_RULES}\n` : '';

  const system = `You are translating USER-FACING STRINGS extracted from a SillyTavern TavernHelper script (a JS app). Each string below was cut out of string literals in the code — translate the Chinese into natural, friendly Vietnamese.

${buildProperNounRules(opts.nameStyle, opts.fandomMode, opts.fandomName)}

[IRON RULES — breaking any of these corrupts the script]
1. PRESERVE EXACTLY, byte-for-byte: \${...} interpolations, {{macros}}, HTML tags & attributes (<div class="...">), CSS property:value pairs, escape sequences (\\n, \\t, \\"), numbers, URLs, emoji, and any Latin identifiers (variable/function names).
2. Keep leading/trailing whitespace of each string unchanged.
3. Translate ONLY the human language. If an item is pure code/CSS with no prose, return it UNCHANGED.
4. Output format: for EVERY input item, echo its marker line <<<ID>>> then the translation on the following line(s). Same number of items, same IDs, in the same order. NO extra commentary, no markdown fences.
${glossaryBlock}${nsfwBlock}`;

  const user = batch.map((b) => `<<<${b.token.id}>>>\n${b.original}`).join('\n');
  return { system, user };
}

export interface ParsedTokenBatch {
  translations: Map<number, string>;
  failedIds: number[];
}

/**
 * Parse STRICT theo marker <<<id>>>. id lạ → bỏ; id thiếu / bản dịch rỗng → fail.
 * Response rác (không có marker nào) → fail toàn bộ lô.
 */
export function parseTokenBatchResponse(text: string, batch: TokenBatchItem[]): ParsedTokenBatch {
  const translations = new Map<number, string>();
  const expected = new Set(batch.map((b) => b.token.id));
  const parts = text.split(/<<<(\d+)>>>/);
  // parts = [trước-marker-đầu, id1, nội-dung-1, id2, nội-dung-2, ...]
  for (let i = 1; i + 1 < parts.length + 1; i += 2) {
    const id = Number(parts[i]);
    const raw = parts[i + 1] ?? '';
    if (!expected.has(id)) continue;
    // Cắt đúng 1 newline ngăn cách marker/nội dung; KHÔNG trim thân (luật giữ whitespace).
    const body = raw.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    if (body.trim()) translations.set(id, body);
  }
  const failedIds = batch.map((b) => b.token.id).filter((id) => !translations.has(id));
  return { translations, failedIds };
}
