// ─── Validate preset SAU dịch (pure) — hàng rào cuối trước khi cho tải file ───
// So với bản GỐC pristine: cấu trúc prompts (số lượng/identifier/thứ tự) + field đóng băng
// per-prompt + prompt_order + macro parity từng content + subtree KHÔNG ĐỤNG deep-equal.
import type { STPreset, PresetPromptEntry } from '../types/card';
import { validateMacroParity } from './macroGuard';
import { getPresetExtras } from './inventory';

/** Field per-prompt TUYỆT ĐỐI không được đổi khi dịch (chỉ name/content được dịch). */
export const FROZEN_PROMPT_FIELDS: Array<keyof PresetPromptEntry> = [
  'identifier', 'enabled', 'role', 'injection_position', 'injection_depth',
  'injection_order', 'system_prompt', 'marker', 'forbid_overrides',
];

export interface PresetValidation {
  structureOk: boolean;
  structureErrors: string[];
  macroParityOk: boolean;
  macroParityErrors: string[];
}

export function validatePreset(
  original: STPreset,
  translated: STPreset,
  varRenameMap: Record<string, string>,
): PresetValidation {
  const errs: string[] = [];
  const macroErrs: string[] = [];

  const oP = original.prompts || [];
  const tP = translated.prompts || [];
  if (oP.length !== tP.length) errs.push(`prompts: ${oP.length} → ${tP.length} (lệch số lượng)`);
  const n = Math.min(oP.length, tP.length);
  for (let i = 0; i < n; i++) {
    if (oP[i].identifier !== tP[i].identifier) {
      errs.push(`prompts[${i}]: identifier đổi ${oP[i].identifier} → ${tP[i].identifier}`);
      continue;
    }
    for (const f of FROZEN_PROMPT_FIELDS) {
      if (JSON.stringify(oP[i][f]) !== JSON.stringify(tP[i][f])) {
        errs.push(`prompts[${i}].${String(f)}: field đóng băng bị đổi`);
      }
    }
    const issues = validateMacroParity(oP[i].content || '', tP[i].content || '', varRenameMap);
    for (const is of issues) {
      macroErrs.push(
        is.kind === 'brace'
          ? `prompts[${i}] (${oP[i].identifier}): {{ }} mất cân bằng`
          : `prompts[${i}] (${oP[i].identifier}): {{${is.kind}::${is.name}}} ${is.before}→${is.after}`,
      );
    }
  }

  if (JSON.stringify(original.prompt_order) !== JSON.stringify(translated.prompt_order)) {
    errs.push('prompt_order bị đổi');
  }

  // ─── Subtree KHÔNG ĐỤNG phải deep-equal: mask các field được phép dịch rồi so cả cây ───
  const mask = (p: STPreset): unknown => {
    const clone = JSON.parse(JSON.stringify(p)) as STPreset;
    for (const pr of clone.prompts || []) { pr.name = ''; pr.content = ''; }
    const { regexScripts, helperScripts } = getPresetExtras(clone);
    for (const r of regexScripts) { r.scriptName = ''; r.findRegex = ''; }
    for (const h of helperScripts) { h.name = ''; h.content = ''; }
    return clone;
  };
  if (JSON.stringify(mask(original)) !== JSON.stringify(mask(translated))) {
    errs.push('Có thay đổi NGOÀI các field được phép dịch (name/content/scriptName/findRegex)');
  }

  return {
    structureOk: errs.length === 0,
    structureErrors: errs,
    macroParityOk: macroErrs.length === 0,
    macroParityErrors: macroErrs,
  };
}
