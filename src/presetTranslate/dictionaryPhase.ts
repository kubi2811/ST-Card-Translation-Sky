// ─── Pha 0 của Dịch Preset: từ điển hợp nhất tag + biến + tên riêng (1 lượt AI) ───
// Đây là trái tim của yêu cầu NHẤT QUÁN: tag 正文 phải thành "Chính văn" ở CẢ 148 chỗ
// prompt + regex + script nhúng; biến 美型化 phải thành cùng 1 identifier ở mọi setvar/getvar.
// AI chỉ ĐỀ XUẤT — bảng hiện lên UI cho user sửa; áp dụng thì code thay deterministic.
import type { STPreset, TranslationField } from '../types/card';
import { countCjk } from '../utils/langDetect';
import { extractNameCandidates, buildNameGlossaryPrompt, parseNameGlossaryResponse } from '../utils/nameGlossary';
import { callProviderHedged, setExtraProviders, resetProviderPool } from '../utils/apiClient';
import { countMacros } from './macroGuard';
import { getPresetExtras } from './inventory';
import { sanitizeVarName } from './consistencyPass';
import { emptyPresetDict, type PresetDict } from './types';
import type { ScriptPipelineDeps } from '../scriptTranslate/types';

const TAG_RE = /<\/?([^\s>/!<][^\s>/<]*)\s*\/?>/g;
const hasCjk = (s: string) => countCjk(s) > 0;

export interface PresetDictCandidates {
  tags: string[];
  vars: string[];
}

/** Gặt ứng viên tag XML-ish CJK + tên biến CJK từ toàn preset (contents + regex + script nhúng). */
export function harvestDictCandidates(preset: STPreset): PresetDictCandidates {
  const tagCount = new Map<string, number>();
  const vars = new Set<string>();

  const scanText = (text: string) => {
    if (!text) return;
    TAG_RE.lastIndex = 0;
    for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
      const name = m[1];
      if (hasCjk(name) && name.length <= 12) tagCount.set(name, (tagCount.get(name) || 0) + 1);
    }
    const mc = countMacros(text);
    for (const v of mc.setvar.keys()) if (hasCjk(v)) vars.add(v);
    for (const v of mc.getvar.keys()) if (hasCjk(v)) vars.add(v);
  };

  for (const p of preset.prompts || []) { scanText(p.content || ''); }
  const { regexScripts, helperScripts } = getPresetExtras(preset);
  for (const r of regexScripts) scanText(r.findRegex || '');
  for (const h of helperScripts) scanText((h.content || '').slice(0, 200_000)); // script 392KB — quét khúc đầu đủ gặt tag

  // Tag xuất hiện ≥2 lần mới đáng vào dict (1 lần thường là markup nội dung, không phải "giao thức")
  const tags = [...tagCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 40);
  return { tags, vars: [...vars].slice(0, 40) };
}

const parseSection = (raw: string, header: string): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const lines = raw.split('\n');
  let inSec = false;
  for (let line of lines) {
    line = line.trim();
    if (/^\[.*\]$/.test(line)) { inSec = line.toUpperCase().includes(header); continue; }
    if (!inSec || !line) continue;
    const m = line.replace(/^[\s\-*•\d.)]+/, '').match(/^(.+?)\s*(?:→|->|=|:)\s*(.+)$/);
    if (m) out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
};

/**
 * Chạy Pha 0: 1 call AI đề xuất tag→tag Việt + var→identifier ASCII, và (tuỳ) 1 call
 * bảng tên riêng theo pattern nameGlossary có sẵn. Kết quả để UI đổ vào bảng edit.
 */
export async function runPresetDictionaryPhase(
  preset: STPreset,
  deps: ScriptPipelineDeps,
  signal?: AbortSignal,
): Promise<PresetDict> {
  const dict = emptyPresetDict();
  const cands = harvestDictCandidates(preset);

  setExtraProviders(deps.providers);
  resetProviderPool();

  if (cands.tags.length || cands.vars.length) {
    const system = `You are localizing a SillyTavern completion preset from Chinese to Vietnamese. Two naming tables are needed. Output EXACTLY two sections with these headers, one mapping per line, "source → translation", nothing else.

[TAGS] — custom XML-ish tag names the AI is instructed to emit (e.g. <正文>). Translate each into a SHORT natural Vietnamese tag name (may contain spaces, keep it concise, no angle brackets). These will be replaced EVERYWHERE (prompts, regexes, scripts), so keep them unambiguous.

[VARS] — {{setvar}}/{{getvar}} variable names. Translate each into a short English snake_case identifier (ASCII letters/digits/underscore ONLY, must start with a letter). Example: 美型化 → beautify.`;
    const user = `[TAGS]\n${cands.tags.join('\n') || '(none)'}\n\n[VARS]\n${cands.vars.join('\n') || '(none)'}`;
    const resp = await callProviderHedged(deps.proxy, system, user, {
      signal,
      meta: { label: 'preset-pha0-dict', charCount: user.length },
    });
    for (const [zh, vi] of parseSection(resp, 'TAG')) {
      if (cands.tags.includes(zh) && vi && !vi.includes('<')) dict.tags[zh] = vi;
    }
    for (const [zh, en] of parseSection(resp, 'VAR')) {
      if (cands.vars.includes(zh)) {
        const safe = sanitizeVarName(en, `var_${Object.keys(dict.vars).length + 1}`);
        dict.vars[zh] = safe;
      }
    }
  }

  // Tên riêng: tái dùng Pha 0 của Dịch Card trên corpus content
  let corpus = '';
  for (const p of preset.prompts || []) {
    corpus += (p.content || '') + '\n';
    if (corpus.length > 300_000) break;
  }
  const fakeField = { path: 'preset', group: 'description', original: corpus, status: 'pending' } as unknown as TranslationField;
  const nameCands = extractNameCandidates([fakeField]);
  if (nameCands.length) {
    const { system, user } = buildNameGlossaryPrompt(nameCands, 'Tiếng Việt', deps.nameStyle, deps.fandomMode, deps.fandomName);
    try {
      const resp = await callProviderHedged(deps.proxy, system, user, {
        signal,
        meta: { label: 'preset-pha0-names', charCount: user.length },
      });
      dict.names = parseNameGlossaryResponse(resp, nameCands).map((e) => ({ ...e, auto: true }));
    } catch { /* bảng tên là phụ trợ — lỗi thì bỏ qua, dict tag/var vẫn dùng được */ }
  }

  return dict;
}
