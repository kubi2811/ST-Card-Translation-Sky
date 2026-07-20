// ─── Pipeline "Dịch Preset" ───
// parse (MUTATE IN PLACE — không xoá/thêm key để giữ thứ tự khi stringify) → dịch lô
// name/content/scriptName qua pool → consistencyPass deterministic (tag+var, đè cả output AI)
// → regex pass (auto/manual) → script nhúng đi NGUYÊN pipeline Dịch Script với dict chung
// → validate (cấu trúc + macro parity + subtree không đụng) → stringify 4-space.
import type { STPreset } from '../types/card';
import { parsePresetJSON } from '../utils/presetParser';
import { countCjk } from '../utils/langDetect';
import { smartPackFields } from '../utils/smartPack';
import { filterGlossaryForText } from '../utils/nameGlossary';
import { ADVANCED_NSFW_TRANSLATION_TACTICS, GOMORRAH_NSFW_PROTECTION_RULES } from '../utils/promptBuilder';
import { buildProperNounRules } from '../utils/masterPrompt';
import {
  callProviderHedged, setExtraProviders, resetProviderPool, computePoolConcurrency,
} from '../utils/apiClient';
import { runWorkerPool } from '../utils/runWorkerPool';
import { runScriptTranslation } from '../scriptTranslate/pipeline';
import type { ScriptPipelineDeps, ScriptRunControl } from '../scriptTranslate/types';
import { applyPresetDict } from './consistencyPass';
import { transformRegex, decideRegex } from './regexScriptPass';
import { getPresetExtras } from './inventory';
import { validatePreset } from './validatePreset';
import type {
  PresetDict, PresetProgress, PresetTranslateOptions, PresetTranslateReport, PresetTranslateResult,
} from './types';

/** 1 đơn vị dịch — id ổn định theo identifier/idx để resume qua fs-cache */
export interface PresetUnit {
  id: string;
  original: string;
  translated?: string;
  apply: (text: string) => void;
}

export function collectUnits(preset: STPreset): PresetUnit[] {
  const units: PresetUnit[] = [];
  for (const p of preset.prompts || []) {
    if (countCjk(p.name || '') > 0) {
      units.push({ id: `name:${p.identifier}`, original: p.name, apply: (t) => { p.name = t; } });
    }
    if (countCjk(p.content || '') > 0) {
      units.push({ id: `content:${p.identifier}`, original: p.content, apply: (t) => { p.content = t; } });
    }
  }
  const { regexScripts, helperScripts } = getPresetExtras(preset);
  regexScripts.forEach((r, i) => {
    if (countCjk(r.scriptName || '') > 0) {
      units.push({ id: `rxname:${i}`, original: r.scriptName!, apply: (t) => { r.scriptName = t; } });
    }
  });
  helperScripts.forEach((h, i) => {
    if (countCjk(h.name || '') > 0) {
      units.push({ id: `hsname:${i}`, original: h.name!, apply: (t) => { h.name = t; } });
    }
  });
  return units;
}

function buildUnitPrompt(
  batch: Array<{ original: string; unit: PresetUnit }>,
  dict: PresetDict,
  deps: ScriptPipelineDeps,
  nsfw: boolean,
): { system: string; user: string } {
  const joined = batch.map((b) => b.original).join('\n');
  const names = filterGlossaryForText(dict.names, joined);
  const nameBlock = names.length
    ? `\n[MANDATORY TERMINOLOGY — proper nouns, use EXACTLY these]\n${names.map((g) => `${g.source} → ${g.target}`).join('\n')}\n`
    : '';
  const tagLines = Object.entries(dict.tags).map(([z, v]) => `${z} → ${v}`).join('\n');
  const tagBlock = tagLines ? `\n[TAG NAMES — when these custom tag/section names appear, use EXACTLY these Vietnamese forms]\n${tagLines}\n` : '';
  const nsfwBlock = nsfw ? `\n${ADVANCED_NSFW_TRANSLATION_TACTICS}\n${GOMORRAH_NSFW_PROTECTION_RULES}\n` : '';

  const system = `You are translating entries of a SillyTavern completion PRESET from Chinese to Vietnamese. Each item is either a prompt NAME or a prompt CONTENT (instruction text for an AI roleplay model). Translate into natural, precise Vietnamese that keeps the instructional force.

${buildProperNounRules(deps.nameStyle, deps.fandomMode, deps.fandomName)}

[IRON RULES]
1. {{macros}} are SACRED: keep {{setvar::name::value}}, {{getvar::name}}, {{char}}, {{user}}, etc. byte-identical (do NOT translate variable names — a separate deterministic pass handles renames). ONLY the human text inside {{// comment}} may be translated (keep the {{// }} shell).
2. Preserve markdown structure (#/##/###, lists, tables), XML-ish tags, code fences, and line breaks.
3. Do not add, drop, merge or reorder items.
4. Output format: for EVERY input item echo its marker line <<<ID>>> then the translation. No commentary, no markdown fences around the whole answer.
${tagBlock}${nameBlock}${nsfwBlock}`;

  const user = batch.map((b, i) => `<<<${i}>>>\n${b.original}`).join('\n');
  return { system, user };
}

/** Parse strict theo marker <<<i>>> (index trong lô) — thiếu/rỗng = fail item đó. */
function parseUnitResponse(text: string, batchLen: number): Map<number, string> {
  const out = new Map<number, string>();
  const parts = text.split(/<<<(\d+)>>>/);
  for (let i = 1; i < parts.length; i += 2) {
    const idx = Number(parts[i]);
    if (idx < 0 || idx >= batchLen) continue;
    const body = (parts[i + 1] ?? '').replace(/^\r?\n/, '').replace(/\s+$/, '');
    if (body.trim()) out.set(idx, body);
  }
  return out;
}

export async function runPresetTranslation(
  rawJson: string,
  opts: PresetTranslateOptions,
  dict: PresetDict,
  deps: ScriptPipelineDeps,
  ctl: ScriptRunControl & { onUnitsUpdated?: (units: PresetUnit[]) => void },
  cb: (p: PresetProgress) => void,
  preTranslated?: Record<string, string>,
): Promise<PresetTranslateResult> {
  const t0 = Date.now();

  // 1) Parse — giữ 1 bản pristine để validate subtree không đụng
  cb({ stage: 'parse' });
  const parsed = JSON.parse(rawJson) as unknown;
  const preset = parsePresetJSON(parsed);
  if (!preset) throw new Error('File không phải preset SillyTavern hợp lệ (thiếu prompts/temperature).');
  const pristine = JSON.parse(rawJson) as STPreset;

  // 2) Gom đơn vị + resume
  const units = collectUnits(preset);
  if (preTranslated) {
    for (const u of units) {
      const saved = preTranslated[u.id];
      if (saved) u.translated = saved;
    }
  }

  // 3) Dịch lô qua pool (budget giảm vì tiếng Việt nở ~2.8×; KHÔNG BAO GIỜ cắt 1 đơn vị)
  setExtraProviders(deps.providers);
  resetProviderPool();
  const concurrency = Math.max(1, computePoolConcurrency(deps.proxy));
  const pending = units.filter((u) => !u.translated).map((u) => ({ original: u.original, unit: u }));
  const batches = smartPackFields(pending, 10, 5000, 3000);
  let done = 0;
  let unitsFailed = 0;
  cb({ stage: 'translate', done: 0, total: batches.length });

  await runWorkerPool({
    total: batches.length,
    concurrency,
    shouldStop: () => !!ctl.signal.aborted,
    waitIfPaused: async () => {
      while (ctl.isPaused?.() && !ctl.signal.aborted) await new Promise((r) => setTimeout(r, 300));
      return !!ctl.signal.aborted;
    },
    runOne: async (i) => {
      const { batch, preferSecondary } = batches[i];
      const { system, user } = buildUnitPrompt(batch, dict, deps, opts.nsfw);
      try {
        const resp = await callProviderHedged(deps.proxy, system, user, {
          signal: ctl.signal,
          meta: { label: `preset-lô-${i + 1}`, charCount: user.length, preferSecondary },
        });
        const map = parseUnitResponse(resp, batch.length);
        batch.forEach((b, j) => {
          const tr = map.get(j);
          if (tr) b.unit.translated = tr;
        });
      } catch (e) {
        if ((e as Error)?.message === 'Cancelled' || ctl.signal.aborted) throw new Error('Cancelled');
      }
    },
    onSettled: () => {
      done++;
      cb({ stage: 'translate', done, total: batches.length });
      ctl.onUnitsUpdated?.(units);
    },
  });
  if (ctl.signal.aborted) throw new Error('Cancelled');
  unitsFailed = units.filter((u) => !u.translated).length;

  // 4) Áp bản dịch vào preset + consistencyPass đè toàn bộ (tag + var, nghiền phi-nhất-quán của AI)
  cb({ stage: 'consistency' });
  for (const u of units) if (u.translated) u.apply(applyPresetDict(u.translated, dict));
  // Content KHÔNG có CJK (không vào units) vẫn có thể chứa tag/var cần rename → quét hết
  for (const p of preset.prompts || []) {
    if (p.content) p.content = applyPresetDict(p.content, dict);
    if (p.name) p.name = applyPresetDict(p.name, dict);
  }

  // 5) Regex pass
  cb({ stage: 'regex' });
  const { regexScripts, helperScripts } = getPresetExtras(preset);
  let regexChanged = 0;
  let regexReverted = 0;
  const regexManual: string[] = [];
  for (const r of regexScripts) {
    const fr = r.findRegex || '';
    const decision = decideRegex(fr, dict);
    if (decision === 'manual') { regexManual.push(r.scriptName || fr.slice(0, 40)); continue; }
    if (decision === 'none') continue;
    const res = transformRegex(fr, dict);
    if (res.changed) { r.findRegex = res.findRegex; regexChanged++; }
    if (res.reverted) regexReverted++;
  }

  // 6) Script TavernHelper nhúng → NGUYÊN pipeline Dịch Script, dict chung làm glossary
  let scriptsTranslated = 0;
  if (opts.translateEmbeddedScripts) {
    const scriptDeps: ScriptPipelineDeps = {
      ...deps,
      glossary: [
        ...dict.names,
        ...Object.entries(dict.tags).map(([source, target]) => ({ source, target })),
      ],
    };
    const jobs = helperScripts.filter((h) => countCjk(h.content || '') > 0);
    let si = 0;
    for (const h of jobs) {
      si++;
      cb({ stage: 'scripts', done: si, total: jobs.length, note: h.name });
      if (ctl.signal.aborted) throw new Error('Cancelled');
      const r = await runScriptTranslation(
        h.content!,
        { beautify: false, nsfw: opts.nsfw, regexAlternation: true },
        scriptDeps,
        { signal: ctl.signal, isPaused: ctl.isPaused },
        () => { /* progress con gộp vào stage scripts */ },
      );
      h.content = applyPresetDict(r.output, dict);
      scriptsTranslated++;
    }
  }

  // 7) Validate
  cb({ stage: 'validate' });
  const v = validatePreset(pristine, preset, dict.vars);

  const outputJson = JSON.stringify(preset, null, 4);
  const report: PresetTranslateReport = {
    jsonOk: true,
    structureOk: v.structureOk,
    structureErrors: v.structureErrors,
    macroParityOk: v.macroParityOk,
    macroParityErrors: v.macroParityErrors.slice(0, 30),
    regexChanged,
    regexReverted,
    regexManual,
    scriptsTranslated,
    unitsTotal: units.length,
    unitsFailed,
    bytesIn: rawJson.length,
    bytesOut: outputJson.length,
    durationMs: Date.now() - t0,
  };
  cb({ stage: 'done' });
  return { outputJson, preset, report };
}
