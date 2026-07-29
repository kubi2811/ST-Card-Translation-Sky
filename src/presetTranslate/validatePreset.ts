// ─── Validate preset SAU dịch (pure) — hàng rào cuối trước khi cho tải file ───
// So với bản GỐC pristine: cấu trúc prompts (số lượng/identifier/thứ tự) + field đóng băng
// per-prompt + prompt_order + macro parity từng content + subtree KHÔNG ĐỤNG deep-equal.
import type { STPreset, PresetPromptEntry } from '../types/card';
import { validateMacroParity } from './macroGuard';
import { getPresetExtras, topProseKeys } from './inventory';

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
  // Lỗi trả về dạng MÃ MÁY `KEY|k=v|k=v` — Flow dịch sang ngôn ngữ đang chọn (i18n),
  // không nhét câu tiếng Việt vào báo cáo của user EN/中文.
  if (oP.length !== tP.length) errs.push(`psTrVdCount|before=${oP.length}|after=${tP.length}`);
  const n = Math.min(oP.length, tP.length);
  for (let i = 0; i < n; i++) {
    if (oP[i].identifier !== tP[i].identifier) {
      errs.push(`psTrVdIdentifier|i=${i}|before=${oP[i].identifier}|after=${tP[i].identifier}`);
      continue;
    }
    for (const f of FROZEN_PROMPT_FIELDS) {
      if (JSON.stringify(oP[i][f]) !== JSON.stringify(tP[i][f])) {
        errs.push(`psTrVdFrozen|i=${i}|field=${String(f)}`);
      }
    }
    const issues = validateMacroParity(oP[i].content || '', tP[i].content || '', varRenameMap);
    for (const is of issues) {
      macroErrs.push(
        is.kind === 'brace'
          ? `psTrVdBrace|i=${i}|id=${oP[i].identifier}`
          : `psTrVdMacro|i=${i}|id=${oP[i].identifier}|kind=${is.kind}|name=${is.name}|before=${is.before}|after=${is.after}`,
      );
    }
  }

  if (JSON.stringify(original.prompt_order) !== JSON.stringify(translated.prompt_order)) {
    errs.push('psTrVdOrder');
  }

  // ─── Subtree KHÔNG ĐỤNG phải deep-equal: mask các field được phép dịch rồi so cả cây ───
  // (bug 153) Danh sách trường cấp cao nhất được phép dịch phải lấy từ bản GỐC: sau khi dịch
  // xong chúng hết chữ Hán nên topProseKeys(translated) sẽ trả rỗng, mask hai bên lệch nhau và
  // hàng rào này báo động giả — chặn oan đúng cái file vừa dịch đúng.
  const proseKeys = topProseKeys(original);
  const mask = (p: STPreset): unknown => {
    const clone = JSON.parse(JSON.stringify(p)) as STPreset;
    for (const pr of clone.prompts || []) { pr.name = ''; pr.content = ''; }
    const { regexScripts, helperScripts } = getPresetExtras(clone);
    for (const r of regexScripts) { r.scriptName = ''; r.findRegex = ''; }
    for (const h of helperScripts) { h.name = ''; h.content = ''; }
    const top = clone as unknown as Record<string, unknown>;
    for (const k of proseKeys) if (typeof top[k] === 'string') top[k] = '';
    return clone;
  };
  if (JSON.stringify(mask(original)) !== JSON.stringify(mask(translated))) {
    errs.push('psTrVdOutside');
  }

  return {
    structureOk: errs.length === 0,
    structureErrors: errs,
    macroParityOk: macroErrs.length === 0,
    macroParityErrors: macroErrs,
  };
}
