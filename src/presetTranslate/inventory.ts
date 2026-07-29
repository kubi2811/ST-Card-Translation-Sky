// ─── Inventory preset (pure): đếm gì dịch được, quyết regex nào auto/manual ───
import type { STPreset } from '../types/card';
import { countCjk } from '../utils/langDetect';
import type { PresetDict, PresetInventory, RegexRow } from './types';
import { cjkRunsOf, decideRegex } from './regexScriptPass';

export interface RegexScriptEntry {
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  [k: string]: unknown;
}

export interface HelperScriptEntry {
  name?: string;
  content?: string;
  [k: string]: unknown;
}

export interface PresetExtras {
  /** MỌI regex tìm được trong extensions (kể cả bản sao lồng trong SPreset/RegexBinding). */
  regexScripts: RegexScriptEntry[];
  helperScripts: HelperScriptEntry[];
  /** Số mục thuộc `extensions.regex_scripts` — phần còn lại là bản sao ở nơi khác. */
  primaryRegexCount: number;
}

/** (bug 153) Khoá cấp cao nhất KHÔNG phải văn xuôi — có chữ Hán cũng không được dịch. */
const NON_PROSE_TOP_KEYS = new Set([
  'chat_completion_source', 'openai_model', 'claude_model', 'openrouter_model', 'windowai_model',
  'custom_model', 'custom_url', 'google_model', 'ai21_model', 'mistralai_model', 'cohere_model',
  'perplexity_model', 'groq_model', 'zerooneai_model', 'blockentropy_model', 'nanogpt_model',
  'deepseek_model', 'vertexai_model', 'aimlapi_model', 'xai_model', 'pollinations_model',
  'proxy_preset', 'preset', 'name', 'custom_prompt_post_processing', 'reasoning_effort',
]);

/**
 * (bug 153) Trường prompt nằm THẲNG ở cấp cao nhất: `new_chat_prompt`, `assistant_prefill`, …
 * Pipeline xưa nay chỉ đi vào `prompts[]` nên chúng không bao giờ được chạm tới — preset của
 * user còn nguyên '这是一个故事的开始' và '思考已结束。' sau khi dịch xong.
 * Nhận theo HÌNH DẠNG (chuỗi có chữ Hán) trừ danh sách khoá kỹ thuật: SillyTavern thêm trường
 * prompt mới khá thường xuyên, liệt kê tên cứng thì lần nào cũng sót lần nữa.
 * Dùng CHUNG cho cả lúc dịch lẫn lúc validate — hai bên lệch danh sách là hàng rào cuối báo
 * động giả rồi chặn oan file đã dịch đúng.
 */
export function topProseKeys(preset: STPreset): string[] {
  const top = preset as unknown as Record<string, unknown>;
  return Object.keys(top).filter(
    (k) => !NON_PROSE_TOP_KEYS.has(k) && typeof top[k] === 'string' && countCjk(top[k] as string) > 0,
  );
}

/** Một mảng trông như danh sách regex script? (có ít nhất 1 mục mang findRegex/scriptName) */
const looksLikeRegexArray = (v: unknown): v is RegexScriptEntry[] =>
  Array.isArray(v) && v.some((x) => !!x && typeof x === 'object' && ('findRegex' in x || 'scriptName' in x));

/**
 * (bug 153) Quét ĐỆ QUY cả cây `extensions` để gom MỌI mảng regex, không chỉ `regex_scripts`.
 *
 * Preset thật của user (bug/153) chứa `extensions.SPreset.RegexBinding.regexes` — bản sao thứ
 * hai của đúng 23 regex đó, 775 ký tự Hán, và nó giống bản gốc TỪNG BYTE sau khi dịch vì
 * pipeline chỉ nhìn `ext.regex_scripts`. User mở preset ra thấy scriptName vẫn tiếng Trung và
 * báo "chưa dịch scriptname" — họ nhìn đúng, chỉ là nhìn vào bản sao mà tool không biết có.
 *
 * Quét theo HÌNH DẠNG thay vì theo tên khoá: extension của bên thứ ba đặt tên tuỳ ý, liệt kê
 * tên cứng thì cứ mỗi extension mới lại sót thêm một lần nữa.
 */
function collectRegexArrays(root: unknown, depth = 0, out: RegexScriptEntry[][] = []): RegexScriptEntry[][] {
  if (depth > 6 || !root || typeof root !== 'object') return out;
  if (looksLikeRegexArray(root)) { out.push(root); return out; }
  for (const v of Object.values(root as Record<string, unknown>)) {
    if (v && typeof v === 'object') collectRegexArrays(v, depth + 1, out);
  }
  return out;
}

/** Móc extensions.* ra với kiểu an toàn (STPreset không type phần này). */
export function getPresetExtras(preset: STPreset): PresetExtras {
  const ext = (preset as unknown as { extensions?: Record<string, unknown> }).extensions || {};
  // regex_scripts đứng ĐẦU danh sách để idx/report giữ nguyên ý nghĩa như trước.
  const groups = collectRegexArrays(ext);
  const primary = Array.isArray(ext.regex_scripts) ? (ext.regex_scripts as RegexScriptEntry[]) : [];
  const rest = groups.filter((g) => g !== primary);
  const regexScripts = [...primary, ...rest.flat()];
  const th = (ext.tavern_helper || {}) as Record<string, unknown>;
  const helperScripts = Array.isArray(th.scripts) ? (th.scripts as HelperScriptEntry[]) : [];
  return { regexScripts, helperScripts, primaryRegexCount: primary.length };
}

export function buildInventory(preset: STPreset, dict: PresetDict): PresetInventory {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
  let translateNameCount = 0;
  let translateContentCount = 0;
  let totalCjkChars = 0;
  for (const p of prompts) {
    const nameCjk = countCjk(p.name || '');
    const contentCjk = countCjk(p.content || '');
    if (nameCjk > 0) translateNameCount++;
    if (contentCjk > 0) translateContentCount++;
    totalCjkChars += nameCjk + contentCjk;
  }

  const { regexScripts, helperScripts, primaryRegexCount } = getPresetExtras(preset);
  // (bug 153) Bản sao (SPreset.RegexBinding…) VẪN được dịch, nhưng KHÔNG liệt kê lại trong
  // bảng: user thấy 46 dòng y hệt nhau thì tưởng preset lỗi. Nội dung hai bản giống nhau nên
  // quyết định auto/manual cũng giống — hiển thị một lần là đủ và đúng.
  const regexRows: RegexRow[] = regexScripts.slice(0, primaryRegexCount || regexScripts.length).map((r, idx) => ({
    idx,
    scriptName: r.scriptName || `regex #${idx + 1}`,
    findRegex: r.findRegex || '',
    cjkTerms: cjkRunsOf(r.findRegex || ''),
    decision: decideRegex(r.findRegex || '', dict),
  }));

  const helpers = helperScripts.map((h, idx) => ({
    idx,
    name: h.name || `script #${idx + 1}`,
    size: (h.content || '').length,
    cjk: countCjk(h.content || ''),
  }));
  for (const h of helpers) totalCjkChars += h.cjk;

  return {
    promptCount: prompts.length,
    translateNameCount,
    translateContentCount,
    regexRows,
    helperScripts: helpers,
    totalCjkChars,
  };
}
