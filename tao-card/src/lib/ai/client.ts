/**
 * src/lib/ai/client.ts — Unified AI chat-completion caller
 * Spec Phần 5 + 9: gọi OpenAI-compatible, Claude, Gemini endpoints
 */

import type { ProxyProfile, GenerationParams, ChatMessage } from '../../types';
import { CallMonitor } from './callMonitor';

/**
 * In dev mode, route external API calls through Vite's CORS proxy
 * to avoid browser CORS blocks from endpoints like gcli.ggchan.dev.
 */
function proxyUrl(url: string): string {
  // Only proxy in dev mode and for external URLs
  if (import.meta.env.PROD) return url;
  // Don't proxy local URLs
  if (url.startsWith('/') || url.startsWith(window.location.origin)) return url;
  // Bypass proxy for Google API as it natively supports CORS
  if (url.includes('generativelanguage.googleapis.com')) return url;
  return `/api/cors-proxy/${encodeURIComponent(url)}`;
}

export interface AICallOptions {
  profile: ProxyProfile;
  params: GenerationParams;
  messages: ChatMessage[];
  signal?: AbortSignal;
  useSecondary?: boolean; // Use secondary (Flash) model if configured
  /** Optional short label shown in the live call monitor (e.g. "Lorebook batch 2/4"). */
  label?: string;
}

export interface AICallResult {
  text: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  finishReason?: string;
}

// Bộ giới hạn RPM kiểu "chốt giờ BẮT ĐẦU" (tham khảo app 3107): chỉ giãn cách thời điểm
// bắt đầu mỗi request tối thiểu interval = 60000/rpm (ms). Vì chỉ gate lúc bắt đầu nên các
// request VẪN CHẠY CHỒNG (overlap) → đạt throughput tối đa = rpm mà không vượt trần (429).
// Nhờ vậy Pro 5 RPM chạy ~5 luồng chồng, Flash 17 RPM chạy ~17 luồng chồng.
class RPMLimiter {
  private intervalMs = 12000;
  private lastStart = 0;
  private queue: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  async waitIfNecessary(rpm: number) {
    if (rpm <= 0) return;
    // +5% biên an toàn tránh đụng trần do lệch đồng hồ / latency.
    this.intervalMs = Math.ceil((60000 / Math.max(1, Math.floor(rpm))) * 1.05);
    return new Promise<void>((resolve) => { this.queue.push(resolve); this.pump(); });
  }

  private pump() {
    if (this.timer || this.queue.length === 0) return;
    const wait = Math.max(0, this.lastStart + this.intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastStart = Date.now();
      this.queue.shift()?.();
      this.pump();
    }, wait);
  }
}

// ─── Multi-key support (phân luồng API — giống tool Dịch) ─────────────────────
// Nhập NHIỀU API key (mỗi key 1 dòng, hoặc cách nhau bằng dấu phẩy) vào ô API Key.
// Mỗi request luân phiên (round-robin) 1 key và mỗi key có "ngân sách" RPM RIÊNG →
// tổng throughput = RPM × số key. Gặp 429/quá tải thì tự xoay sang key kế rồi thử lại.
export function parseApiKeys(raw: string): string[] {
  return (raw || '').split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
}

const keyLimiters = new Map<string, RPMLimiter>();
function getKeyLimiter(id: string): RPMLimiter {
  let l = keyLimiters.get(id);
  if (!l) { l = new RPMLimiter(); keyLimiters.set(id, l); }
  return l;
}
let rrCounter = 0;

export function getUniqueKeyCount(profile: ProxyProfile): number {
  return Math.max(1, new Set(parseApiKeys(profile.apiKey)).size);
}

// ─── Đa provider (pool) ───
// Store bơm danh sách profile vào đây. Pool = profile đang active + các profile inPool khác.
// Mỗi call round-robin sang provider kế → nhiều provider chạy SONG SONG (mỗi cái vẫn giữ đa-key +
// RPM riêng). 1 profile ⇒ pool 1 phần tử ⇒ hành vi y như cũ.
let _poolProfiles: ProxyProfile[] = [];
export function setPoolProfiles(list: ProxyProfile[]): void { _poolProfiles = list || []; }
let _providerCursor = 0;
export function resetProviderPool(): void { _providerCursor = 0; }

const _usableProfile = (p: ProxyProfile) => !!(p.apiKey?.trim() && p.selectedModel?.trim());

// (User 2026 — lỗi "[502] ECONNREFUSED 127.0.0.1:7861") Provider KHÔNG KẾT NỐI ĐƯỢC (server local
// tắt / URL sai) được cho NGHỈ 60s để pool round-robin né nó — hết còn cảnh 1 profile chết kéo sập
// call dù pool còn provider sống. Hết hạn tự thử lại (user bật server lên là chạy tiếp).
const _deadUntil = new Map<string, number>();
function markProfileDead(id: string): void { _deadUntil.set(id, Date.now() + 60_000); }
const _isDead = (p: ProxyProfile) => (_deadUntil.get(p.id) ?? 0) > Date.now();

function buildPool(active: ProxyProfile): ProxyProfile[] {
  const map = new Map<string, ProxyProfile>();
  if (_usableProfile(active)) map.set(active.id, active);
  for (const p of _poolProfiles) if (p.inPool && _usableProfile(p)) map.set(p.id, p);
  const pool = [...map.values()];
  if (!pool.length) return [active];
  // Né provider đang "nghỉ ốm" (ECONNREFUSED gần đây); nếu TẤT CẢ đều chết thì vẫn trả pool đầy đủ
  // (để lỗi hiện ra rõ ràng thay vì im lặng).
  const alive = pool.filter(p => !_isDead(p));
  return alive.length ? alive : pool;
}
/** #11 — Số luồng song song đề xuất = TỔNG ngân sách RPM toàn pool: mỗi provider (active + inPool),
 *  mỗi API key đóng góp (primaryRpm + secondaryRpm nếu bật). callAI đã tự gate nhịp RPM (RPMLimiter)
 *  nên đặt cao vẫn không vượt 429. Trần 256 chỉ chặn cấu hình gõ nhầm. Dùng thay các cap Math.min(8/4). */
export function computePoolConcurrency(active: ProxyProfile): number {
  let total = 0;
  for (const p of buildPool(active)) {
    const kc = Math.max(1, new Set(parseApiKeys(p.apiKey)).size);
    const per = (p.primaryRpm ?? 5) + (p.enableSecondaryModel ? (p.secondaryRpm ?? 10) : 0);
    total += Math.max(1, per) * kc;
  }
  return Math.max(1, Math.min(total, 256));
}

/** Chọn provider kế tiếp (round-robin) từ pool cho 1 call. */
function pickPoolProfile(active: ProxyProfile): ProxyProfile {
  const pool = buildPool(active);
  if (pool.length <= 1) return pool[0];
  const p = pool[_providerCursor % pool.length];
  _providerCursor = (_providerCursor + 1) % pool.length;
  return p;
}

/**
 * Gọi AI chat-completion theo provider type.
 * Trả về text response thuần (đã extract từ JSON response format).
 */
export async function callAI(options: AICallOptions): Promise<AICallResult> {
  const { params, messages, signal, useSecondary } = options;

  // Retry lỗi TẠM THỜI (timeout/mạng/429/5xx/overload) — KHÔNG phụ thuộc số key (api kẹt thì cứ thử lại).
  // Nhiều key ⇒ mỗi lần xoay key khác; 1 key ⇒ thử lại chính key đó (hang thường là tạm thời).
  const attempts = 4;
  let lastErr: unknown;

  for (let a = 0; a < attempts; a++) {
    if (signal?.aborted) throw signal.reason || new Error('Aborted');

    // (User 2026 — fix "AI Inference 502 ECONNREFUSED") Chọn provider MỖI attempt thay vì 1 lần TRƯỚC
    // vòng retry: trước đây cả 4 lần retry đâm đúng 1 provider chết (vd local LLM 127.0.0.1:7861 đã
    // tắt) dù pool còn provider sống. Nay retry tự xoay sang provider khác (provider chết bị
    // markProfileDead nên pool né luôn).
    const profile = pickPoolProfile(options.profile);
    const base = profile.baseUrl.replace(/\/+$/, '');
    const keys = parseApiKeys(profile.apiKey);
    const tier = useSecondary && profile.enableSecondaryModel ? 's' : 'p';
    const rpm = tier === 's' ? (profile.secondaryRpm ?? 10) : (profile.primaryRpm ?? 5);

    const key = keys.length ? keys[(rrCounter++) % keys.length] : profile.apiKey;
    // Rate-limit RIÊNG cho từng (provider + key + tier) → nhiều key/provider = nhiều luồng thật.
    if (rpm > 0) await getKeyLimiter(`${profile.id}:${tier}:${key || 'default'}`).waitIfNecessary(rpm);
    const effProfile: ProxyProfile = (keys.length > 0 && key !== profile.apiKey) ? { ...profile, apiKey: key } : profile;

    // Smart AbortController with 30min hard timeout (large lorebooks need time)
    const timeoutMs = 1800_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Timeout: Yêu cầu AI vượt quá ${timeoutMs / 1000} giây.`));
    }, timeoutMs);
    const onAbort = () => { clearTimeout(timeoutId); controller.abort(signal!.reason); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    // Live monitor: register this in-flight call (model + which key) for the progress UI.
    const dispModel = (useSecondary && profile.enableSecondaryModel && profile.secondaryModel)
      ? profile.secondaryModel : profile.selectedModel;
    const keyLabel = `${profile.label}${keys.length > 1 ? ` · Key #${((rrCounter - 1) % keys.length) + 1}` : ''}`;
    const monId = CallMonitor.start({ model: dispModel || '?', keyLabel, label: options.label || '', startedAt: Date.now() });

    try {
      switch (profile.providerType) {
        case 'openai':
        case 'custom':
          return await callOpenAICompatible(base, effProfile, params, messages, controller.signal, useSecondary);
        case 'claude':
          return await callClaude(base, effProfile, params, messages, controller.signal, useSecondary);
        case 'gemini':
          return await callGemini(base, effProfile, params, messages, controller.signal, useSecondary);
        default:
          throw new Error(`Provider không được hỗ trợ: ${profile.providerType}`);
      }
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // (User 2026) KHÔNG KẾT NỐI ĐƯỢC endpoint (ECONNREFUSED qua cors-proxy = server local tắt /
      // Base URL sai): cho provider này nghỉ 60s (pool né) + đổi thông báo RÕ NGHĨA thay vì
      // "[502] Bad Gateway: Proxy error" khó hiểu.
      const connRefused = /econnrefused|err_connection_refused|proxy error: connect/i.test(msg);
      if (connRefused) {
        markProfileDead(profile.id);
        lastErr = new Error(
          `Không kết nối được provider "${profile.label}" (${base || 'chưa có Base URL'}) — server đã tắt hoặc Base URL sai. ` +
          `Vào Cài đặt → AI Profile để sửa; nếu đây là server local (vd 127.0.0.1) hãy bật nó lên, hoặc bỏ tick "dùng trong pool" để không gọi vào nữa.` +
          `\nChi tiết: ${msg}`,
        );
      }
      const retriable = connRefused
        || /\b(408|409|425|429|500|502|503|504|509|520|521|522|523|524|529)\b/.test(msg)
        || /rate.?limit|overloaded|quá tải|timeout|quá hạn|vượt quá .* giây|failed to fetch|load failed|network|econnreset|fetch failed|socket hang up|the operation was aborted due to timeout/i.test(msg);
      // Lỗi tạm thời (api kẹt/timeout/5xx/provider chết) → backoff rồi thử lại — lần sau pickPoolProfile
      // sẽ xoay sang provider còn sống.
      if (a < attempts - 1 && retriable && !signal?.aborted) {
        await new Promise(r => setTimeout(r, connRefused ? 150 : Math.min(1200 * (a + 1), 8000)));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
      CallMonitor.end(monId);
    }
  }
  throw lastErr;
}

// ─── OpenAI-Compatible ──────────────────────────────────────────────────────

async function callOpenAICompatible(
  base: string, profile: ProxyProfile, params: GenerationParams,
  messages: ChatMessage[], signal?: AbortSignal, useSecondary?: boolean,
): Promise<AICallResult> {
  const url = base.endsWith('/v1')
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${profile.apiKey}`,
  };
  for (const h of profile.customHeaders) {
    if (h.key && h.value) headers[h.key] = h.value;
  }

  const model = (useSecondary && profile.enableSecondaryModel && profile.secondaryModel)
    ? profile.secondaryModel
    : profile.selectedModel;

  const body: Record<string, unknown> = {
    model,
    messages: messages.map(m => {
      if (!m.attachments?.length) return { role: m.role, content: m.content };
      const parts: Record<string, unknown>[] = [{ type: 'text', text: m.content }];
      for (const att of m.attachments) {
        if (att.type === 'image') {
          parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.data}` } });
        } else {
          parts.push({ type: 'text', text: `\n\n--- Tệp đính kèm: ${att.name} ---\n${att.data}` });
        }
      }
      return { role: m.role, content: parts };
    }),
    max_tokens: params.max_tokens,
    temperature: params.temperature,
    top_p: params.top_p,
    frequency_penalty: params.frequency_penalty,
    presence_penalty: params.presence_penalty,
    stream: false,
  };
  if (params.stop.length > 0) body.stop = params.stop;
  if (params.seed !== -1) body.seed = params.seed;
  if (params.top_k > 0) body.top_k = params.top_k;
  if (params.min_p > 0) body.min_p = params.min_p;
  if (params.repetition_penalty !== 1) body.repetition_penalty = params.repetition_penalty;
  if (params.useJsonResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  let res: Response;
  try {
    res = await fetch(proxyUrl(url), { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`Lỗi kết nối tới AI (Failed to fetch). Vui lòng kiểm tra lại URL API, kết nối mạng, hoặc CORS Proxy: ${(err as Error).message}`, { cause: err });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 524) throw new Error(`[524 Timeout] Proxy hoặc máy chủ AI mất quá nhiều thời gian để phản hồi (>100s). Hãy thử giảm max_tokens hoặc đổi API khác.`);
    throw new Error(`[${res.status}] ${res.statusText}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`API Error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error(`API returned 200 OK but with no content choices. Response: ${JSON.stringify(json)}`);
  }
  // (Fix bug #8) 'tool_calls' / 'function_call' = model muốn gọi hàm — HOÀN TOÀN BÌNH THƯỜNG,
  // KHÔNG phải bị bộ lọc an toàn chặn. Trước đây gộp chung mọi finish_reason lạ vào "bị chặn" nên
  // Copilot (dùng tool calling) kiểu gì cũng báo lỗi. Chỉ 'content_filter' mới thật sự là bị chặn.
  let text = choice.message?.content ?? '';
  // Model đặt kết quả trong tool_call.arguments thay vì content → lấy ra làm text để parser xử lý tiếp.
  if (!text.trim() && Array.isArray(choice.message?.tool_calls) && choice.message.tool_calls.length > 0) {
    text = choice.message.tool_calls
      .map((tc: { function?: { arguments?: string } }) => tc?.function?.arguments || '')
      .filter(Boolean)
      .join('\n');
  }
  const benignReasons = ['stop', 'stop_sequence', 'length', 'tool_calls', 'function_call', 'end_turn', 'eos'];
  // Chỉ ném lỗi khi finish_reason bất thường VÀ không có nội dung nào để dùng (tránh báo "bị chặn" oan).
  if (choice.finish_reason && !benignReasons.includes(choice.finish_reason) && !text.trim()) {
    if (choice.finish_reason === 'content_filter') {
      throw new Error('Nội dung bị BỘ LỌC AN TOÀN của API chặn (content_filter). Thử đổi model/API khác, hoặc chỉnh lại yêu cầu cho bớt nhạy cảm.');
    }
    throw new Error(`API dừng thế sinh vì lý do: ${choice.finish_reason} (không có nội dung trả về). Thử lại hoặc đổi API khác.`);
  }
  return {
    text,
    model: json.model ?? profile.selectedModel,
    usage: json.usage,
    finishReason: choice.finish_reason,
  };
}

// ─── Claude (Anthropic) ─────────────────────────────────────────────────────

async function callClaude(
  base: string, profile: ProxyProfile, params: GenerationParams,
  messages: ChatMessage[], signal?: AbortSignal, useSecondary?: boolean,
): Promise<AICallResult> {
  const url = `${base}/v1/messages`;
  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': profile.apiKey,
    'anthropic-version': '2023-06-01',
  };
  for (const h of profile.customHeaders) {
    if (h.key && h.value) headers[h.key] = h.value;
  }

  const model = (useSecondary && profile.enableSecondaryModel && profile.secondaryModel)
    ? profile.secondaryModel
    : profile.selectedModel;

  const body: Record<string, unknown> = {
    model,
    max_tokens: params.max_tokens,
    messages: nonSystemMsgs.map(m => {
      if (!m.attachments?.length) return { role: m.role, content: m.content };
      const parts: Record<string, unknown>[] = [{ type: 'text', text: m.content }];
      for (const att of m.attachments) {
        if (att.type === 'image') {
          parts.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType, data: att.data } });
        } else {
          parts.push({ type: 'text', text: `\n\n--- Tệp đính kèm: ${att.name} ---\n${att.data}` });
        }
      }
      return { role: m.role, content: parts };
    }),
    temperature: params.temperature,
    top_p: params.top_p,
  };
  if (systemMsg) body.system = systemMsg.content;
  if (params.stop.length > 0) body.stop_sequences = params.stop;
  if (params.top_k > 0) body.top_k = params.top_k;

  let res: Response;
  try {
    res = await fetch(proxyUrl(url), { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`Lỗi kết nối tới Claude API (Failed to fetch). Vui lòng kiểm tra lại URL, API Key, hoặc mạng: ${(err as Error).message}`, { cause: err });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 524) throw new Error(`[524 Timeout] Proxy hoặc máy chủ AI mất quá nhiều thời gian để phản hồi (>100s). Hãy thử giảm max_tokens hoặc đổi API khác.`);
    throw new Error(`[${res.status}] ${res.statusText}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`Claude API Error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  if (!json.content || json.content.length === 0) {
    throw new Error(`Claude API returned no content. Response: ${JSON.stringify(json)}`);
  }
  const text = json.content.map((c: { text?: string }) => c.text ?? '').join('');
  return {
    text,
    model: json.model ?? profile.selectedModel,
    usage: json.usage ? {
      prompt_tokens: json.usage.input_tokens,
      completion_tokens: json.usage.output_tokens,
      total_tokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
    } : undefined,
    finishReason: json.stop_reason,
  };
}

// ─── Gemini (Google AI) ─────────────────────────────────────────────────────

async function callGemini(
  base: string, profile: ProxyProfile, params: GenerationParams,
  messages: ChatMessage[], signal?: AbortSignal, useSecondary?: boolean,
): Promise<AICallResult> {
  const selectedModel = (useSecondary && profile.enableSecondaryModel && profile.secondaryModel)
    ? profile.secondaryModel
    : profile.selectedModel;
  const model = selectedModel.replace('models/', '');
  const url = `${base}/v1beta/models/${model}:generateContent?key=${profile.apiKey}`;

  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const h of profile.customHeaders) {
    if (h.key && h.value) headers[h.key] = h.value;
  }

  const contents = nonSystemMsgs.map(m => {
    const parts: Record<string, unknown>[] = [{ text: m.content }];
    if (m.attachments) {
      for (const att of m.attachments) {
        if (att.type === 'image') {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
        } else {
          parts.push({ text: `\n\n--- Tệp đính kèm: ${att.name} ---\n${att.data}` });
        }
      }
    }
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature,
      topP: params.top_p,
      topK: params.top_k > 0 ? params.top_k : undefined,
      responseMimeType: params.useJsonResponseFormat ? 'application/json' : undefined,
    },
  };
  
  if (profile.enableGoogleSearchGrounding) {
    body.tools = [{ googleSearch: {} }];
  }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }
  if (params.stop.length > 0) {
    (body.generationConfig as Record<string, unknown>).stopSequences = params.stop;
  }

  let res: Response;
  try {
    res = await fetch(proxyUrl(url), { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`Lỗi kết nối tới Gemini API (Failed to fetch). Vui lòng kiểm tra lại mạng hoặc API Key: ${(err as Error).message}`, { cause: err });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 524) throw new Error(`[524 Timeout] Proxy hoặc máy chủ AI mất quá nhiều thời gian để phản hồi (>100s). Hãy thử giảm max_tokens hoặc đổi API khác.`);
    throw new Error(`[${res.status}] ${res.statusText}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`Gemini API Error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  const candidate = json.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini API returned no content candidates. Response: ${JSON.stringify(json)}`);
  }
  // (Fix bug #8) Lấy text TRƯỚC — nếu model có trả nội dung thì dùng luôn, đừng ném lỗi "bị chặn"
  // oan khi finishReason lạ nhưng vẫn có text (vd tool-call/partial). Chỉ chặn khi RỖNG.
  const text = candidate.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason) && !text.trim()) {
    throw new Error(`Gemini API dừng thế sinh vì lý do: ${candidate.finishReason}. Nội dung hoặc Prompt có thể đã bị chặn bởi bộ lọc an toàn hoặc Recitation check. Phản hồi đầy đủ: ${JSON.stringify(candidate)}`);
  }
  if (!text.trim() && candidate.finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini API dừng sinh ngay lập tức (MAX_TOKENS) mà không trả nội dung nào. Nguyên nhân: prompt đầu vào quá lớn (${json.usageMetadata?.promptTokenCount ?? '?'} tokens) chiếm hết context, không còn chỗ cho output. Thử: giảm số entries lorebook, hoặc tăng maxOutputTokens trong Settings.`);
  }
  return {
    text,
    finishReason: candidate.finishReason as string | undefined,
    model: profile.selectedModel,
    usage: json.usageMetadata ? {
      prompt_tokens: json.usageMetadata.promptTokenCount,
      completion_tokens: json.usageMetadata.candidatesTokenCount,
      total_tokens: json.usageMetadata.totalTokenCount,
    } : undefined,
  };
}

// ─── Connection Test ────────────────────────────────────────────────────────

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  modelUsed: string;
  supportsToolCalling: boolean;
  error?: string;
}

/**
 * Ping AI server + test tool-calling support
 */
export async function testConnection(
  profile: ProxyProfile, params: GenerationParams,
): Promise<ConnectionTestResult> {
  const start = performance.now();
  try {
    const result = await callAI({
      profile,
      params: { ...params, max_tokens: 50 },
      messages: [
        { role: 'system', content: 'You are a test assistant. Reply with exactly: {"test":"ok"}' },
        { role: 'user', content: 'ping' },
      ],
    });
    const latencyMs = Math.round(performance.now() - start);

    // Naive tool-calling detection: check if the model returns valid JSON
    let supportsToolCalling = false;
    try {
      const parsed = JSON.parse(result.text.trim());
      supportsToolCalling = typeof parsed === 'object' && parsed !== null;
    } catch { /* not JSON */ }

    return { ok: true, latencyMs, modelUsed: result.model, supportsToolCalling };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      modelUsed: profile.selectedModel,
      supportsToolCalling: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
