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
import {
  runSig as scriptRunSig,
  loadTokenMap as loadScriptTokenMap,
  saveTokenMap as saveScriptTokenMap,
  tokensToMap as scriptTokensToMap,
} from '../scriptTranslate/persist';
import type { ScriptPipelineDeps, ScriptRunControl } from '../scriptTranslate/types';
import { applyPresetDict } from './consistencyPass';
import { transformRegex, decideRegex } from './regexScriptPass';
import { buildLabelMap, applyLabelMapToRegex, applyLabelMapToText } from './presetLabelSync';
import { getPresetExtras, topProseKeys } from './inventory';
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

/**
 * (bug 153) Bản dịch có bị BỎ DỞ GIỮA CHỪNG không?
 *
 * Ngưỡng đặt theo TỶ LỆ chứ không theo số tuyệt đối. Tên riêng và tên thẻ được giữ nguyên có
 * chủ đích luôn để lại vài ký tự Hán hợp lệ — bắt theo số tuyệt đối thì những mục đó bị dịch
 * lại mãi không dừng, mỗi vòng lại tốn tiền mà kết quả y hệt. Đơn vị quá ngắn cũng bỏ qua vì
 * ở đó một cái tên riêng đã chiếm phần lớn ký tự Hán.
 */
export function hasResidualCjk(original: string, translated: string): boolean {
  const before = countCjk(original);
  if (before < 12) return false;
  return countCjk(translated) / before >= 0.15;
}

export function collectUnits(preset: STPreset): PresetUnit[] {
  const units: PresetUnit[] = [];

  // (bug 153) Trường prompt nằm THẲNG ở cấp cao nhất (new_chat_prompt, assistant_prefill…) —
  // xem topProseKeys trong inventory.ts để biết vì sao nhận theo hình dạng chứ không theo tên.
  const top = preset as unknown as Record<string, unknown>;
  for (const key of topProseKeys(preset)) {
    units.push({ id: `top:${key}`, original: top[key] as string, apply: (t) => { top[key] = t; } });
  }

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
  /** (bug 153) Vòng vá lại: lần trước AI để sót chữ Hán — nói thẳng ra thay vì hỏi lại y hệt. */
  retry = false,
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
${tagBlock}${nameBlock}${nsfwBlock}${
    retry
      ? '\n[RETRY — the previous attempt left Chinese text behind]\nTranslate EVERY Chinese sentence, heading, list item and table cell. Long items must be translated to the very end — do not stop partway and do not summarise. The only Chinese allowed in your output is inside {{macros}}, XML-ish tag NAMES, and proper nouns listed above.\n'
      : ''
  }`;

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
  if (!preset) throw new Error('NOT_PRESET');
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
  // (bug 153) GỘP ĐƠN VỊ TRÙNG NỘI DUNG — gửi AI đúng MỘT lần cho mỗi chuỗi gốc.
  // Preset thật có regex nằm ở hai nơi (regex_scripts + SPreset.RegexBinding), nên cùng một
  // scriptName xuất hiện hai lần. Dịch riêng từng bản thì vừa tốn gấp đôi token vừa có nguy cơ
  // AI trả hai bản khác nhau — đúng cái "chưa hoàn toàn đồng bộ" mà user báo. Gộp lại thì hai
  // bản sao BUỘC phải giống nhau, không còn trông chờ vào việc AI ngoan.
  const byOriginal = new Map<string, PresetUnit[]>();
  for (const u of units.filter((x) => !x.translated)) {
    const g = byOriginal.get(u.original);
    if (g) g.push(u); else byOriginal.set(u.original, [u]);
  }
  const pending = [...byOriginal.values()].map((g) => ({ original: g[0].original, unit: g[0] }));
  /** Sau khi lô xong: chép bản dịch của đại diện sang mọi bản sao cùng nội dung. */
  const mirrorToDuplicates = () => {
    for (const g of byOriginal.values()) {
      if (g.length < 2 || !g[0].translated) continue;
      for (let i = 1; i < g.length; i++) g[i].translated = g[0].translated;
    }
  };
  let batches = smartPackFields(pending, 10, 5000, 3000);
  let done = 0;
  let unitsFailed = 0;
  let residualRetried = 0;
  cb({ stage: 'translate', done: 0, total: batches.length });

  // ═══ (bug 153) VÒNG QUÉT LẠI CHỮ HÁN SÓT ═══
  // Dịch Card có cơ chế này từ bug 80, Dịch Preset thì chưa: mỗi đơn vị chỉ được dịch ĐÚNG MỘT
  // LẦN, AI bỏ sót giữa một prompt dài thì không gì bắt lại. Preset của user còn 1.274 ký tự
  // Hán trong `prompts`, dồn vào đúng hai mục dài nhất — dấu hiệu kinh điển của dịch nửa chừng.
  //
  // Ngưỡng đặt theo TỶ LỆ chứ không theo số tuyệt đối: tên riêng và tên thẻ giữ nguyên có chủ
  // đích luôn để lại vài ký tự Hán hợp lệ, gặp cái đó mà dịch lại thì lặp vô hạn. Chỉ coi là
  // sót khi phần Hán còn lại chiếm ≥15% bản gốc.
  const residualUnits = () => units.filter((u) => u.translated && hasResidualCjk(u.original, u.translated));

  for (let round = 0; ; round++) {
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
      const { system, user } = buildUnitPrompt(batch, dict, deps, opts.nsfw, round > 0);
      try {
        const resp = await callProviderHedged(deps.proxy, system, user, {
          signal: ctl.signal,
          meta: { label: `preset-batch-${round}-${i + 1}`, charCount: user.length, preferSecondary },
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
      mirrorToDuplicates();   // (bug 153) bản sao bám sát bản chính ngay, kể cả khi resume giữa chừng
      cb({ stage: 'translate', done, total: batches.length });
      ctl.onUnitsUpdated?.(units);
    },
  });
  if (ctl.signal.aborted) throw new Error('Cancelled');
  mirrorToDuplicates();

    // Tối đa 2 vòng vá thêm. Đơn vị nào sót thì XOÁ bản dịch cũ rồi dịch lại nguyên văn gốc —
    // vá chắp vá lên bản dở dang dễ đẻ ra câu nửa Việt nửa Trung hơn là dịch lại từ đầu.
    if (round >= 2) break;
    const stuck = residualUnits();
    if (stuck.length === 0) break;
    residualRetried += stuck.length;
    for (const u of stuck) u.translated = undefined;
    const retryPending = stuck.map((u) => ({ original: u.original, unit: u }));
    batches = smartPackFields(retryPending, 6, 4000, 2500);   // lô nhỏ hơn: bớt cớ để AI cắt bớt
    done = 0;
    cb({ stage: 'translate', done: 0, total: batches.length, note: `retry-${round + 1}` });
  }

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
  let regexLabelSynced = 0;
  const regexManual: string[] = [];

  // (User 27/07 — việc 118) ĐỒNG BỘ NHÃN VĂN BẢN với prompt ĐÃ DỊCH. Prompt dạy AI xuất
  // ">Lựa chọn 1:" nhưng findRegex vẫn rình ">选项一：" — nhãn không phải tag/var nên pass cũ
  // trả 'manual' rồi bỏ qua NGUYÊN script, regex không bao giờ khớp đầu ra mới. Bảng nhãn dựng
  // từ chính cặp prompt trước/sau dịch (pristine ↔ preset, ghép theo identifier) nên regex và
  // prompt không thể lệch nhau. Map kèm CẢ dấu hai chấm: preset gốc dùng ： fullwidth, bản dịch
  // dùng : thường — chỉ thay nhãn mà giữ dấu cũ thì vẫn trượt.
  //
  // (bug 124) User báo VẪN CÒN LỖI. Đo trên preset thật trong repo (三人逆行 v11 ↔ bản dịch
  // chính thức) ra hai lỗ của bản 118, nay đã vá trong presetLabelSync: (a) đòi số nhãn hai
  // bên bằng nhau nên vứt 89/213 cặp prompt — giờ neo bằng LCS, lệch đoạn nào chỉ mất đoạn đó;
  // (b) chỉ học nhãn "NHÃN:" nên mù với TÊN THẺ GIẢ (<状态面板>) và nhãn <summary> — mà 4/36
  // regex của preset thật bám đúng vào chúng.
  const labelMap = buildLabelMap(pristine.prompts, preset.prompts);
  for (const r of regexScripts) {
    // 5a. Nhãn văn bản (đồng bộ prompt) — chạy TRƯỚC để phần CJK còn lại (nếu có) mới tính
    //     là việc của dict tag/var.
    if (Object.keys(labelMap).length > 0) {
      const ls = applyLabelMapToRegex(r.findRegex || '', labelMap);
      if (ls.changed) { r.findRegex = ls.text; regexLabelSynced++; }
      if (ls.reverted) regexReverted++;
      // replaceString (HTML làm đẹp) cũng phải gọi đúng nhãn mới — thay trần, không cần compile.
      if (r.replaceString) {
        const ts = applyLabelMapToText(String(r.replaceString), labelMap);
        if (ts.changed) r.replaceString = ts.text;
      }
    }
    // 5b. Tag/var theo từ điển như cũ.
    const fr = r.findRegex || '';
    const decision = decideRegex(fr, dict);
    if (decision === 'manual') {
      // (bug 153) Bản sao cùng nội dung sẽ ra cùng quyết định — chỉ ghi tên MỘT lần vào danh
      // sách cần xem tay, kẻo user thấy mỗi regex hiện hai dòng.
      const label = r.scriptName || fr.slice(0, 40);
      if (!regexManual.includes(label)) regexManual.push(label);
      continue;
    }
    if (decision === 'none') continue;
    const res = transformRegex(fr, dict);
    if (res.changed) { r.findRegex = res.findRegex; regexChanged++; }
    if (res.reverted) regexReverted++;
  }

  // 6) Script TavernHelper nhúng → NGUYÊN pipeline Dịch Script, dict chung làm glossary
  let scriptsTranslated = 0;
  let regexHtmlTranslated = 0;
  if (opts.translateEmbeddedScripts) {
    const scriptDeps: ScriptPipelineDeps = {
      ...deps,
      glossary: [
        ...dict.names,
        ...Object.entries(dict.tags).map(([source, target]) => ({ source, target })),
        // (việc 118) Nhãn đồng bộ prompt cũng vào glossary — AI dịch replaceString phải gọi
        // đúng "Lựa chọn 1:" như prompt, không được tự chế cách dịch khác cho 选项一.
        ...Object.entries(labelMap).map(([source, target]) => ({ source, target })),
      ],
    };

    // 6a. (việc 118) replaceString của REGEX SCRIPT — khối HTML/CSS làm đẹp 4-5KB, trước giờ
    // KHÔNG BAO GIỜ được dịch: bước này chỉ chạy helperScripts, còn regex pass chỉ đụng
    // findRegex. Đó là nửa còn lại của lời báo "phần đó nó không dịch". Đi cùng pipeline
    // Dịch Script như helper (giữ cấu trúc code, chỉ dịch chuỗi hiển thị).
    const htmlJobs = regexScripts.filter((r) => countCjk(String(r.replaceString || '')) > 0);
    let hi = 0;
    for (const r of htmlJobs) {
      hi++;
      const label = r.scriptName || `regex #${hi}`;
      cb({ stage: 'scripts', done: 0, total: htmlJobs.length + helperScripts.filter((h) => countCjk(h.content || '') > 0).length, note: `${label} (HTML regex)` });
      if (ctl.signal.aborted) throw new Error('Cancelled');
      const sig = scriptRunSig(String(r.replaceString), false);
      const saved = (await loadScriptTokenMap(sig)) || undefined;
      try {
        const res = await runScriptTranslation(
          String(r.replaceString),
          { beautify: false, nsfw: opts.nsfw, regexAlternation: true, keyMode: 'rename', enforceDictCoverage: false },
          scriptDeps,
          {
            signal: ctl.signal,
            isPaused: ctl.isPaused,
            onTokensUpdated: (tokens) => {
              const map = scriptTokensToMap(tokens);
              if (Object.keys(map).length) void saveScriptTokenMap(sig, map);
            },
          },
          (p) => {
            if (p.stage === 'translate' && p.total) {
              cb({ stage: 'scripts', done: hi, total: htmlJobs.length, note: `${label} — ${p.done ?? 0}/${p.total}` });
            }
          },
          saved,
        );
        // Sau khi AI dịch, ép lại nhãn theo prompt lần nữa — AI có thể dịch 选项一 kiểu khác.
        r.replaceString = applyLabelMapToText(res.output, labelMap).text;
        regexHtmlTranslated++;
      } catch (e) {
        if ((e as Error)?.message === 'Cancelled' || ctl.signal.aborted) throw new Error('Cancelled');
        // Một khối hỏng không được giết cả lượt dịch preset — giữ nguyên bản gốc khối đó.
      }
    }

    const jobs = helperScripts.filter((h) => countCjk(h.content || '') > 0);
    let si = 0;
    for (const h of jobs) {
      si++;
      cb({ stage: 'scripts', done: si, total: jobs.length, note: h.name });
      if (ctl.signal.aborted) throw new Error('Cancelled');
      // Resume riêng cho từng script nhúng (384KB = nhiều lô AI — đứt giữa chừng phải nối được)
      const scriptSig = scriptRunSig(h.content!, false);
      const savedTokens = (await loadScriptTokenMap(scriptSig)) || undefined;
      const r = await runScriptTranslation(
        h.content!,
        { beautify: false, nsfw: opts.nsfw, regexAlternation: true, keyMode: 'rename', enforceDictCoverage: false },
        scriptDeps,
        {
          signal: ctl.signal,
          isPaused: ctl.isPaused,
          onTokensUpdated: (tokens) => {
            const map = scriptTokensToMap(tokens);
            if (Object.keys(map).length) void saveScriptTokenMap(scriptSig, map);
          },
        },
        (p) => {
          // Nối tiến độ lô của script con vào note để user thấy nó đang chạy thật
          if (p.stage === 'translate' && p.total) {
            cb({ stage: 'scripts', done: si, total: jobs.length, note: `${h.name} — ${p.done ?? 0}/${p.total}` });
          }
        },
        savedTokens,
      );
      // KHÔNG applyPresetDict lên code JS: thay tag "trần" trong code có thể đổi cả object key
      // tiếng Trung (hợp đồng dữ liệu) — tag trong CHUỖI đã được dịch đúng qua glossary của
      // script pipeline rồi. (Bug tự soi khi rà trước khi giao client.)
      h.content = r.output;
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
    regexLabelSynced,
    residualRetried,
    regexHtmlTranslated,
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
