// ─── Pipeline "Dịch Script" — thư viện dùng lại được (Phase C gọi cho script nhúng) ───
// beautify → extract (worker) → dịch token qua pool đa luồng (retry chọn lọc ≤2 vòng)
// → reinsert (worker) → regex alternation → validate (worker).
// Code KHÔNG BAO GIỜ đi qua AI; chỉ danh sách chuỗi CJK. Mọi quét chuỗi MB nằm trong worker.
import type { CJKToken } from '../utils/surgical';
import {
  callProviderHedged,
  setExtraProviders,
  resetProviderPool,
  computePoolConcurrency,
} from '../utils/apiClient';
import { runWorkerPool } from '../utils/runWorkerPool';
import { packTokens, buildTokenBatchPrompt, parseTokenBatchResponse, isTranslatableToken } from './tokenBatcher';
import { applyRegexAlternation } from './regexAlternation';
import type {
  ScriptPipelineDeps,
  ScriptProgress,
  ScriptRunControl,
  ScriptTranslateOptions,
  ScriptTranslateReport,
  ScriptTranslateResult,
} from './types';

// ─── Cầu nối worker: 1 worker dùng chung, gọi kiểu request/response theo id ───
let _worker: Worker | null = null;
let _reqId = 0;
const _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!_worker) {
    // Import kiểu ?worker của Vite (mẫu useCardParser) — bundle riêng, prettier nằm trong đó.
    _worker = new Worker(new URL('./scriptPipeline.worker.ts', import.meta.url), { type: 'module' });
    _worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; error?: string; result?: unknown }>) => {
      const p = _pending.get(ev.data.id);
      if (!p) return;
      _pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error || 'worker error'));
    };
    _worker.onerror = (e) => {
      for (const [, p] of _pending) p.reject(new Error(e.message || 'worker crashed'));
      _pending.clear();
    };
  }
  return _worker;
}

function callWorker<T>(op: string, payload: Record<string, unknown>): Promise<T> {
  const id = ++_reqId;
  return new Promise<T>((resolve, reject) => {
    _pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ id, op, ...payload });
  });
}

export interface WorkerStats { chars: number; cjkChars: number; lines: number; looksMinified: boolean }
export const scanStats = (code: string): Promise<WorkerStats> => callWorker('stats', { code });
export const beautifyInWorker = (code: string): Promise<string> => callWorker('beautify', { code });
export const extractInWorker = async (code: string): Promise<{ tokens: CJKToken[]; parseFailed: boolean }> => {
  const pz = await callWorker<{ zones: unknown[]; parseFailed: boolean }>('protectZones', { code });
  const tokens = await callWorker<CJKToken[]>('extract', { code, zones: pz.zones });
  return { tokens, parseFailed: pz.parseFailed };
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('Cancelled');
};

/**
 * Chạy trọn pipeline trên `source`. Glossary trong deps là bảng ĐÃ CHỐT (Pha 0 + user sửa);
 * `preTranslated` (resume sau F5) áp vào token trước khi gom lô.
 */
export async function runScriptTranslation(
  source: string,
  opts: ScriptTranslateOptions,
  deps: ScriptPipelineDeps,
  ctl: ScriptRunControl,
  cb: (p: ScriptProgress) => void,
  preTranslated?: Record<number, string>,
): Promise<ScriptTranslateResult> {
  const t0 = Date.now();
  const bytesIn = source.length;

  // 1) Beautify (tuỳ chọn; fail thì dịch bản gốc — beautify là tiện nghi, không phải điều kiện)
  let working = source;
  if (opts.beautify) {
    cb({ stage: 'beautify' });
    try {
      working = await beautifyInWorker(source);
    } catch {
      cb({ stage: 'beautify', note: 'beautify-failed' });
    }
    throwIfAborted(ctl.signal);
  }

  // Validate ĐẦU VÀO một lần — gốc vỡ sẵn thì lỗi cuối không phải do mình.
  const preValidate = await callWorker<{ parseOk: boolean; cjkChars: number }>('validate', { code: working, original: working });
  const cjkCharsIn = preValidate.cjkChars;

  // 2) Extract token CJK (kèm zone bảo vệ: regex literal + sourcemap)
  cb({ stage: 'extract' });
  const { tokens } = await extractInWorker(working);
  throwIfAborted(ctl.signal);

  // Resume: áp bản dịch đã lưu từ lần chạy trước (đúng id — id sinh theo thứ tự offset,
  // cùng nguồn + cùng beautify ⇒ cùng id; sig nguồn đã khoá điều đó ở tầng persist).
  if (preTranslated) {
    for (const t of tokens) {
      const saved = preTranslated[t.id];
      if (saved && isTranslatableToken(t)) t.translated = saved;
    }
  }

  // 3) Dịch qua pool — retry chọn lọc tối đa 2 vòng cho id fail
  setExtraProviders(deps.providers);
  resetProviderPool();
  const concurrency = Math.max(1, computePoolConcurrency(deps.proxy));

  const promptOpts = {
    nsfw: opts.nsfw,
    nameStyle: deps.nameStyle,
    fandomMode: deps.fandomMode,
    fandomName: deps.fandomName,
  };

  let round = 0;
  for (;;) {
    const batches = packTokens(tokens);
    if (!batches.length || round > 2) break;
    let done = 0;
    cb({ stage: 'translate', done: 0, total: batches.length, note: round ? `retry-${round}` : undefined });

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
        const { system, user } = buildTokenBatchPrompt(batch, deps.glossary, promptOpts);
        try {
          const resp = await callProviderHedged(deps.proxy, system, user, {
            signal: ctl.signal,
            meta: { label: `script-lô-${round}-${i + 1}`, charCount: user.length, preferSecondary },
          });
          const { translations } = parseTokenBatchResponse(resp, batch);
          for (const item of batch) {
            const tr = translations.get(item.token.id);
            if (tr) item.token.translated = tr;
          }
        } catch (e) {
          if ((e as Error)?.message === 'Cancelled' || ctl.signal.aborted) throw new Error('Cancelled');
          // Lô lỗi → token của nó còn trống, vòng retry sau nhặt lại.
        }
      },
      onSettled: () => {
        done++;
        cb({ stage: 'translate', done, total: batches.length, note: round ? `retry-${round}` : undefined });
        ctl.onTokensUpdated?.(tokens);
      },
    });
    throwIfAborted(ctl.signal);
    round++;
  }

  // 4) Reinsert — chỉ token có translated được thay, còn lại giữ nguyên văn
  cb({ stage: 'reinsert' });
  let output = await callWorker<string>('reinsert', { code: working, tokens });
  throwIfAborted(ctl.signal);

  // 5) Regex alternation (giữ Hán + thêm nhánh Việt); thuật ngữ lạ → 1 lô AI bổ sung dict
  let regexChanged = 0;
  let regexReverted = 0;
  if (opts.regexAlternation) {
    cb({ stage: 'regex' });
    const dict: Record<string, string> = {};
    for (const g of deps.glossary) if (g.source.trim()) dict[g.source.trim()] = g.target.trim();
    // Token đã dịch cũng là dict tốt (cho nhãn không nằm trong glossary)
    for (const t of tokens) if (t.translated && t.text.length <= 12) dict[t.text] = t.translated;

    let r = applyRegexAlternation(output, dict);
    if (r.unknownTerms.length && !ctl.signal.aborted) {
      try {
        const fakeBatch = r.unknownTerms.map((term, i) => ({ original: term, token: { id: 1_000_000 + i, text: term, start: 0, end: 0 } as CJKToken }));
        const { system, user } = buildTokenBatchPrompt(fakeBatch, deps.glossary, promptOpts);
        const resp = await callProviderHedged(deps.proxy, system, user, {
          signal: ctl.signal,
          meta: { label: 'script-regex-terms', charCount: user.length, preferSecondary: true },
        });
        const { translations } = parseTokenBatchResponse(resp, fakeBatch);
        fakeBatch.forEach((b) => {
          const tr = translations.get(b.token.id);
          if (tr) dict[b.original] = tr;
        });
        r = applyRegexAlternation(output, dict);
      } catch { /* không có mạng/hủy → giữ kết quả vòng 1 */ }
    }
    output = r.code;
    regexChanged = r.changed;
    regexReverted = r.reverted;
  }

  // 6) Validate cuối
  cb({ stage: 'validate' });
  const v = await callWorker<{ parseOk: boolean; parseError?: string; parityOk: boolean; parityDetail?: string; cjkChars: number }>(
    'validate',
    { code: output, original: working },
  );

  const translatable = tokens.filter(isTranslatableToken);
  const residual = translatable.filter((t) => !t.translated);
  const report: ScriptTranslateReport = {
    parseOkBefore: preValidate.parseOk,
    parseOk: v.parseOk,
    parseError: v.parseError,
    parityOk: v.parityOk,
    parityDetail: v.parityDetail,
    residualTokens: residual.length,
    residualSamples: residual.slice(0, 20).map((t) => t.text),
    preservedTokens: tokens.length - translatable.length,
    tokenTotal: translatable.length,
    cjkCharsIn,
    cjkCharsOut: v.cjkChars,
    regexChanged,
    regexReverted,
    bytesIn,
    bytesOut: output.length,
    durationMs: Date.now() - t0,
  };
  cb({ stage: 'done' });
  return { output, report, tokens };
}
