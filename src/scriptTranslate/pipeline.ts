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
import { applyRegexAlternation, analyzeSkippedInClass } from './regexAlternation';
import { checkDictCoverage } from './astExtract';
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
      // Worker chết (OOM prettier trên file bệnh hoạn…) → vứt xác, lần gọi sau spawn con mới —
      // không thì mọi thao tác về sau treo vĩnh viễn trên worker hỏng.
      try { _worker?.terminate(); } catch { /* ignore */ }
      _worker = null;
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
/** (bug 187 — Hạng mục A) Trích token: AST trước, regex-lookback chỉ là lưới dự phòng. */
export const extractInWorker = (
  code: string,
  dict?: Record<string, string>,
): Promise<import('./scriptPipeline.worker').ExtractResult> =>
  callWorker('extract', { code, dict });
/** (bug 187 — Hạng mục F) 4 phép kiểm AST trên cặp (gốc, dịch) — chạy trong worker. */
export const astVerifyInWorker = (
  original: string,
  translated: string,
  dict?: Record<string, string>,
): Promise<import('./astVerifier').AstVerifyReport> =>
  callWorker('astVerify', { original, code: translated, dict });

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
  preTranslated?: import('./persist').TokenMap,
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

  // 2) Extract token CJK — AST trước (bug 187), regex chỉ khi code không parse được.
  // (bug 151) Từ điển đi cùng ngay từ đây: khoá dữ liệu MVU (`t.人际网络`, `{身份:…}`) nằm
  // ngoài mọi đường dịch qua AI, chỉ từ điển mới đổi được — và phải đổi, vì card đã dịch biến
  // thì script đọc khoá Hán sẽ ra `undefined` mà không báo lỗi gì.
  // (bug 187 — Hạng mục B) keyMode 'keep' = user chốt GIỮ khoá tiếng Trung (card chưa đổi
  // biến) → không đưa từ điển vào đường đổi khoá; glossary vẫn dùng cho văn xuôi + alternation.
  cb({ stage: 'extract' });
  const glossaryDict: Record<string, string> = {};
  for (const g of deps.glossary) {
    const s = g.source.trim(), t = g.target.trim();
    if (s && t && s !== t) glossaryDict[s] = t;
  }
  // keyDict GIỮ CẢ mục identity (nguồn = đích): user chốt giữ nguyên khoá đó có chủ đích —
  // coverage tính là phủ, verifier xếp trung tính. Lọc s !== t ở đây là ba nơi ba luật,
  // user thêm mục identity xong vẫn bị chặn export với lời khuyên họ đã làm rồi (review 187).
  let keyDict: Record<string, string> | undefined;
  if (opts.keyMode !== 'keep') {
    keyDict = {};
    for (const g of deps.glossary) {
      const s = g.source.trim(), t = g.target.trim();
      if (s && t) keyDict[s] = t;
    }
  }
  const extracted = await extractInWorker(working, keyDict);
  const { tokens, extractMode, dataKeys } = extracted;
  const dictCoverage = opts.keyMode === 'keep' ? undefined : checkDictCoverage(dataKeys, deps.glossary);
  // (review 187) Cổng chặn coverage nằm TRONG pipeline chứ không chỉ ở nút UI — nút "Dịch lại
  // mục lỗi", khoảnh khắc chưa phân tích xong, hay bất kỳ caller nào cũng đập vào cùng bức
  // tường này, TRƯỚC khi tốn một call API nào (extract đứng trước mọi lô dịch).
  if (opts.enforceDictCoverage && dictCoverage && dictCoverage.missing.length > 0) {
    const names = dictCoverage.missing.slice(0, 8).map((m) => m.name).join(', ');
    const more = dictCoverage.missing.length > 8 ? ', …' : '';
    throw new Error(
      `Từ Điển thiếu ${dictCoverage.missing.length} khoá dữ liệu (${names}${more}) — bổ sung vào bảng hoặc chuyển sang chế độ "Giữ nguyên tiếng Trung".`,
    );
  }
  throwIfAborted(ctl.signal);

  // Resume: áp bản dịch đã lưu từ lần chạy trước. Hai dây an toàn chống áp nhầm:
  // (1) sig đã gồm cờ beautify (tầng persist), (2) ĐỐI CHIẾU chuỗi gốc — token.text phải
  // khớp `o` đã lưu mới áp; lệch (prettier đổi version, id trôi…) thì bỏ, dịch lại còn hơn sai.
  if (preTranslated) {
    for (const t of tokens) {
      const saved = preTranslated[t.id];
      if (saved && saved.o === t.text && isTranslatableToken(t)) t.translated = saved.t;
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

  // (bug 187 — Hạng mục D) Nhật ký retry: lỗi/miss nào cũng phải để lại dấu vết đọc được,
  // không được âm thầm trả về bản gốc chưa dịch. Trần 300 dòng để report không phình MB.
  const retryLog: string[] = [];
  const logRetry = (line: string): void => {
    if (retryLog.length < 300) retryLog.push(line);
    else if (retryLog.length === 300) retryLog.push('… (quá 300 dòng, cắt bớt)');
  };

  let round = 0;
  for (;;) {
    const batches = packTokens(tokens);
    if (!batches.length || round > 2) break;
    if (round > 0) {
      const left = batches.reduce((s, b) => s + b.batch.length, 0);
      logRetry(`🔁 Vòng retry ${round}: còn ${left} chuỗi chưa dịch được, chia ${batches.length} lô thử lại`);
    }
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
            meta: { label: `script-batch-${round}-${i + 1}`, charCount: user.length, preferSecondary },
          });
          const { translations, failedIds } = parseTokenBatchResponse(resp, batch);
          for (const item of batch) {
            const tr = translations.get(item.token.id);
            if (tr) item.token.translated = tr;
          }
          if (failedIds.length > 0) {
            // AI trả thiếu marker/echo lệch id — nói rõ CHUỖI NÀO chưa về, vòng sau nhặt lại.
            const sample = failedIds.slice(0, 3)
              .map((id) => batch.find((b) => b.token.id === id)?.token.text.slice(0, 24) ?? `#${id}`)
              .join(' · ');
            logRetry(`⚠️ Vòng ${round}, lô ${i + 1}: AI trả thiếu ${failedIds.length}/${batch.length} chuỗi (vd: ${sample}) — chờ vòng retry`);
          }
        } catch (e) {
          if ((e as Error)?.message === 'Cancelled' || ctl.signal.aborted) throw new Error('Cancelled');
          // Lô lỗi → token của nó còn trống, vòng retry sau nhặt lại — nhưng phải GHI SỔ.
          logRetry(`❌ Vòng ${round}, lô ${i + 1} (${batch.length} chuỗi): lỗi API "${(e as Error)?.message || String(e)}" — chờ vòng retry`);
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

  // (bug 160) SỐ DÒNG PHÌNH RA = có ký tự xuống dòng bị chèn vào giữa chuỗi.
  // Đây là dấu hiệu của cả một LỚP lỗi: model trả "nguyên_văn ⏎ bản_dịch" rồi cục đó bị nhét vào
  // một chuỗi JS một dòng ⇒ "Unterminated string constant", file chết hẳn (đúng ca bug/160: gốc 1
  // dòng, bản dịch 42 dòng). reinsert nay đã chặn, nhưng vẫn đo lại ở đây: nếu mai này có biến thể
  // khác lọt qua thì báo cáo phải nói được NGAY nguyên nhân, thay vì để user đọc "Unterminated
  // string constant" rồi không hiểu vì sao.
  const linesBefore = working.split('\n').length;
  const linesAfter = output.split('\n').length;
  throwIfAborted(ctl.signal);

  // Kiểm PARITY ngay tại đây — TRƯỚC bước alternation. Mỗi nhánh `(?:Hán|Việt)` thêm 1 cặp
  // ngoặc HỢP LỆ, kiểm sau sẽ luôn kêu "code lệch cấu trúc" dù mọi thứ đúng ⇒ báo động giả
  // mỗi lần tính năng regex chạy (bắt được khi chạy thật end-to-end với API).
  // (bug 154) Mỗi khoá đổi sang dạng bracket (`obj.键` → `obj['Tên']`) thêm đúng MỘT cặp [ ].
  // Không khai ra thì parity kêu "dấu [ THÊM 19" mỗi lần từ điển chạy — báo động giả, mà báo
  // động giả thì dạy người ta bỏ qua cảnh báo thật.
  const bracketPairs = tokens.filter((t) => t.fromDictionary && t.isDotNotation && t.translated).length;
  const parityCheck = await callWorker<{ parityOk: boolean; parityDetail?: string }>(
    'validate', { code: output, original: working, bracketPairs },
  );

  // 5) Regex alternation (giữ Hán + thêm nhánh Việt); thuật ngữ lạ → 1 lô AI bổ sung dict
  let regexChanged = 0;
  let regexReverted = 0;
  let regexSkippedInClass: import('./regexAlternation').SkippedInClassAnalysis[] | undefined;
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
    // (bug 200 — Mục 1.3/1.4) Cụm CJK trong character class được TÍNH từ trước nhưng bị vứt
    // trên đường về — nay nối vào report kèm truy nguồn Từ Điển. Trùng khoá đã dịch nghĩa là
    // trường dữ liệu regex này soi nhiều khả năng ĐÃ thành tiếng Việt ⇒ mọi nhánh .test()
    // vĩnh viễn false (ca hàm phân loại quân chủng của fixture Status Bar). Chỉ BÁO, không tự
    // viết lại — hiểu sai nghĩa một ký tự là phân loại hỏng theo hướng khác.
    if (r.skippedInClassTerms.length) {
      regexSkippedInClass = analyzeSkippedInClass(r.skippedInClassTerms, dict);
    }
  }

  // 5b) (bug 200 — Hạng mục G) Chuẩn hoá dấu câu CJK cosmetic — thứ user cuối NHÌN THẤY nhiều
  // nhất trên file lớn (fixture Status Bar: 1108 dấu 。 sót). Theo từng vị trí qua AST; chạy
  // SAU alternation (regex literal đã chốt, pass này không đụng regex) và TRƯỚC validate cuối
  // để mọi phép kiểm chạy trên đúng bản sẽ xuất ra.
  let punctNormalized = 0;
  let punctKeptFunctional = 0;
  if (opts.punctNormalize) {
    cb({ stage: 'punct' });
    const pn = await callWorker<{ code: string; normalized: number; keptFunctional: number }>(
      'punctNormalize', { code: output },
    );
    output = pn.code;
    punctNormalized = pn.normalized;
    punctKeptFunctional = pn.keptFunctional;
    throwIfAborted(ctl.signal);
  }

  // 6) Validate cuối
  cb({ stage: 'validate' });
  const v = await callWorker<{ parseOk: boolean; parseError?: string; parityOk: boolean; parityDetail?: string; cjkChars: number }>(
    'validate',
    { code: output, original: working, bracketPairs },
  );

  // 7) (bug 187 — Hạng mục F) 4 phép kiểm AST gốc↔dịch — cổng QA tự động trước export,
  // không đợi user report. Chạy trong worker (parse 2 file MB là long-task).
  cb({ stage: 'verify' });
  const astVerify = await astVerifyInWorker(working, output, keyDict);
  throwIfAborted(ctl.signal);

  const translatable = tokens.filter(isTranslatableToken);
  const residual = translatable.filter((t) => !t.translated);
  if (residual.length > 0) {
    logRetry(`⛔ Hết ${round} vòng: ${residual.length} chuỗi vẫn chưa dịch được (giữ nguyên văn) — xem danh sách ở mục kết quả`);
  }
  // (bug 151) Token giữ nguyên = khoá dữ liệu chưa có trong Từ Điển. Trước đây chỉ đếm số
  // lượng nên user thấy "0/82 chưa dịch" mà file vẫn còn 247 chữ Hán — hai con số đếm hai tập
  // khác nhau, trông như tool nói dối. Nay nói rõ: còn bao nhiêu chữ Hán, nằm ở tên nào.
  const preserved = tokens.filter((t) => !isTranslatableToken(t) && !t.translated);
  const preservedCjkChars = preserved.reduce((s, t) => s + (t.text.match(/[一-鿿㐀-䶿぀-ヿ가-힯]/g)?.length ?? 0), 0);
  const preservedSamples = [...new Set(preserved.map((t) => t.text))].slice(0, 12);
  const dictRenamed = tokens.filter((t) => t.fromDictionary).length;
  const report: ScriptTranslateReport = {
    parseOkBefore: preValidate.parseOk,
    parseOk: v.parseOk,
    parseError: v.parseError,
    parityOk: parityCheck.parityOk,
    parityDetail: parityCheck.parityDetail,
    residualTokens: residual.length,
    residualSamples: residual.slice(0, 20).map((t) => t.text),
    preservedTokens: tokens.length - translatable.length,
    tokenTotal: translatable.length,
    dictRenamed,
    preservedCjkChars,
    preservedSamples,
    cjkCharsIn,
    cjkCharsOut: v.cjkChars,
    regexChanged,
    regexReverted,
    ...(regexSkippedInClass ? { regexSkippedInClass } : {}),
    ...(opts.punctNormalize ? { punctNormalized, punctKeptFunctional } : {}),
    bytesIn,
    bytesOut: output.length,
    linesIn: linesBefore,
    linesOut: linesAfter,
    durationMs: Date.now() - t0,
    extractMode,
    dictCoverage,
    keyMode: opts.keyMode,
    astVerify,
    retryLog,
  };
  cb({ stage: 'done' });
  return { output, report, tokens };
}
