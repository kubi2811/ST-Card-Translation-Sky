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
  regexScripts: RegexScriptEntry[];
  helperScripts: HelperScriptEntry[];
}

/** Móc extensions.* ra với kiểu an toàn (STPreset không type phần này). */
export function getPresetExtras(preset: STPreset): PresetExtras {
  const ext = (preset as unknown as { extensions?: Record<string, unknown> }).extensions || {};
  const regexScripts = Array.isArray(ext.regex_scripts) ? (ext.regex_scripts as RegexScriptEntry[]) : [];
  const th = (ext.tavern_helper || {}) as Record<string, unknown>;
  const helperScripts = Array.isArray(th.scripts) ? (th.scripts as HelperScriptEntry[]) : [];
  return { regexScripts, helperScripts };
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

  const { regexScripts, helperScripts } = getPresetExtras(preset);
  const regexRows: RegexRow[] = regexScripts.map((r, idx) => ({
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
