/**
 * ─── Xem trước "như trong SillyTavern" (render TĨNH) ───
 *
 * Mô phỏng cách SillyTavern hiển thị một tin nhắn của nhân vật:
 *   text → thay macro {{user}}/{{char}} → áp các regex script HIỂN THỊ của card → render HTML.
 *
 * Mục đích: thấy ngay giao diện in-chat (status bar, khung HTML/CSS) sau khi dịch có vỡ không,
 * KHÔNG cần import card vào SillyTavern. Đây là render TĨNH — <script> trong card không chạy
 * (iframe sandbox chặn), nên card game UI động (TavernHelper/MVU) chỉ xem được phần khung HTML/CSS.
 *
 * File thuần logic (không React/store) để test vitest.
 */

export interface StRegexScript {
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  /** Nơi áp dụng theo chuẩn ST: 1 = user input, 2 = AI output (đường hiển thị) */
  placement?: number[];
  disabled?: boolean;
  /** true = chỉ áp vào prompt gửi AI, KHÔNG áp vào hiển thị */
  promptOnly?: boolean;
  markdownOnly?: boolean;
}

/** Lấy danh sách regex script của card (đúng chỗ ST đọc: extensions.regex_scripts). */
export function extractRegexScripts(card: unknown): StRegexScript[] {
  const c = card as any;
  const list = c?.data?.extensions?.regex_scripts ?? c?.extensions?.regex_scripts;
  return Array.isArray(list) ? list : [];
}

/** Parse findRegex kiểu ST: "/pattern/flags" (chuẩn) hoặc chuỗi trần (coi là pattern, flags g). */
export function parseFindRegex(find: string): RegExp | null {
  if (!find || !find.trim()) return null;
  try {
    const m = find.trim().match(/^\/([\s\S]+)\/([a-z]*)$/i);
    if (m) {
      const flags = m[2].includes('g') ? m[2] : m[2] + 'g';
      return new RegExp(m[1], flags);
    }
    return new RegExp(find, 'g');
  } catch {
    return null; // regex hỏng — bỏ qua script (đừng làm chết preview)
  }
}

/** Thay macro cơ bản mà ST xử lý trước khi hiển thị. */
export function substituteMacros(text: string, vars: { user: string; char: string }): string {
  return text
    .replace(/\{\{user\}\}/gi, vars.user)
    .replace(/\{\{char\}\}/gi, vars.char);
}

/**
 * Áp các regex script HIỂN THỊ (placement chứa 2 = AI output, không disabled, không promptOnly)
 * lên tin nhắn — đúng thứ tự trong card. `{{match}}` trong replaceString = cả đoạn khớp ($&);
 * $1..$9 dùng cơ chế replace chuẩn của JS (khớp hành vi ST).
 */
export interface AppliedRegexDetail {
  /** Tên script regex đã áp */
  name: string;
  /** Index trong extensions.regex_scripts — để dựng field path nhảy tới */
  index: number;
  /** Đoạn "vân tay" ổn định để tìm lại vị trí replaceString trong văn bản cuối */
  fingerprint: string;
  /** Số dòng của replaceString (ước lượng phạm vi) */
  lineCount: number;
}

/** Chọn 1 dòng "vân tay" đủ dài + không dính các tham chiếu sẽ bị rewrite (window.parent…). */
function pickFingerprint(replaceString: string): string {
  for (const line of replaceString.split('\n')) {
    const t = line.trim();
    if (t.length >= 30 && !/parent|\btop\b|\{\{|\$\d/.test(t)) return t.slice(0, 80);
  }
  return replaceString.trim().slice(0, 60);
}

export function applyDisplayRegex(
  text: string,
  scripts: StRegexScript[],
): { text: string; applied: string[]; appliedDetails: AppliedRegexDetail[] } {
  let out = text;
  const applied: string[] = [];
  const appliedDetails: AppliedRegexDetail[] = [];
  scripts.forEach((s, index) => {
    if (!s || s.disabled || s.promptOnly) return;
    if (!(s.placement || []).includes(2)) return;
    const re = parseFindRegex(s.findRegex || '');
    if (!re) return;
    // {{match}} → token '$&' của String.replace (cả đoạn khớp). '$$&' vì trong replacement
    // string, '$&' có nghĩa đặc biệt — phải escape $$ để chèn literal '$&' cho lượt replace sau.
    const replStr = (s.replaceString ?? '').replace(/\{\{match\}\}/gi, '$$&');
    try {
      const before = out;
      out = out.replace(re, replStr);
      if (out !== before) {
        applied.push(s.scriptName || '(không tên)');
        appliedDetails.push({
          name: s.scriptName || '(không tên)',
          index,
          fingerprint: pickFingerprint(s.replaceString ?? ''),
          lineCount: (s.replaceString ?? '').split('\n').length,
        });
      }
    } catch {
      /* script lỗi — bỏ qua, xử tiếp script sau */
    }
  });
  return { text: out, applied, appliedDetails };
}

export interface PreviewLineRange {
  from: number; // dòng bắt đầu (1-based, trong srcdoc)
  to: number;
  label: string;      // ví dụ 「MVU Thanh Trạng Thái」
  fieldPath?: string; // path field để nhảy tới trong Field Editor
}

/**
 * Dựng BẢN ĐỒ dòng → nguồn cho srcdoc preview: lỗi script báo "dòng N" sẽ tra được là nằm
 * trong regex script nào của card → dịch giả bấm 1 nút nhảy thẳng tới field đó để sửa.
 */
export function buildLineMap(
  srcDoc: string,
  appliedDetails: AppliedRegexDetail[],
  messageLabel: string,
  messageFieldPath?: string,
): PreviewLineRange[] {
  const map: PreviewLineRange[] = [];
  const lineOf = (idx: number) => srcDoc.slice(0, idx).split('\n').length;
  const bodyStart = srcDoc.indexOf('<div class="content">');
  const bodyStartLine = bodyStart >= 0 ? lineOf(bodyStart) : 1;
  const totalLines = srcDoc.split('\n').length;

  for (const d of appliedDetails) {
    if (!d.fingerprint) continue;
    const at = srcDoc.indexOf(d.fingerprint);
    if (at < 0) continue;
    // fingerprint nằm đâu đó TRONG replaceString — nới biên mỗi phía bằng cả lineCount cho an toàn
    const fpLine = lineOf(at);
    map.push({
      from: Math.max(bodyStartLine, fpLine - d.lineCount),
      to: Math.min(totalLines, fpLine + d.lineCount),
      label: `「${d.name}」 (regex #${d.index + 1})`,
      fieldPath: `data.extensions.regex_scripts[${d.index}].replaceString`,
    });
  }
  // phần thân còn lại = chính tin nhắn
  map.push({ from: bodyStartLine, to: totalLines, label: messageLabel, fieldPath: messageFieldPath });
  // phần đầu = môi trường giả lập (lỗi ở đây là lỗi tool, không phải card)
  map.push({ from: 1, to: bodyStartLine - 1, label: 'môi trường giả lập (không phải lỗi card)' });
  return map;
}

/** Tra bản đồ: range hẹp khớp trước (regex cụ thể), rồi mới tới range rộng (tin nhắn). */
export function resolveErrorSource(map: PreviewLineRange[], line: number): PreviewLineRange | null {
  const hits = map.filter(r => line >= r.from && line <= r.to);
  if (hits.length === 0) return null;
  hits.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  return hits[0];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Lấy nội dung entry [initvar] của card (nguồn data test cho chế độ chạy script). */
export function extractInitvarText(card: unknown): string | null {
  const c = card as any;
  const entries = c?.data?.character_book?.entries ?? c?.character_book?.entries;
  if (!Array.isArray(entries)) return null;
  for (const e of entries) {
    const cm = String(e?.comment || '');
    const ct = String(e?.content || '');
    if (/\[initvar\]/i.test(cm) || /^\s*\[initvar\]/i.test(ct)) {
      return ct.replace(/^\s*\[initvar\]\s*/i, '');
    }
  }
  return null;
}

/**
 * Danh sách ĐẦY ĐỦ 178 hàm TavernHelper (trích từ bundle dist của JS-Slash-Runner v3 —
 * extension mà user ST thật sự cài). predefine.js của extension merge TẤT CẢ các hàm này
 * thành window globals trong iframe, nên shim phải phủ kín tên (noop an toàn) để script card
 * không chết vì ReferenceError; hàm nào ảnh hưởng hiển thị thì shim đúng semantics ở dưới.
 */
/**
 * (bug 164 · HM0-B) NGUỒN THAM CHIẾU DUY NHẤT cho "tên hàm TavernHelper không được dịch".
 * Trước đây đây là `const` cục bộ, chỉ nội suy vào chuỗi HTML preview — không file nào khác dùng
 * được, nên `masterPrompt.ts` phải liệt kê TAY một tập nhỏ, và trong tập đó có 4 tên KHÔNG TỒN TẠI
 * trong API thật (`setVariable`, `getVariable`, `sendMessage`, `executeSlashCommands` — tên thật là
 * `getVariables`/`replaceVariables`/`insertOrAssignVariables` và `triggerSlash`). Export ra để mọi
 * nơi lấy từ đúng một chỗ.
 */
export const TH_FUNCTION_NAMES = 'RawCharacter,appendAudioList,appendInexistentScriptButtons,audioEnable,audioImport,audioMode,audioPlay,audioSelect,builtin,builtin_prompt_default_order,createCharacter,createChatMessages,createLorebook,createLorebookEntries,createLorebookEntry,createOrReplaceCharacter,createOrReplacePersona,createOrReplacePreset,createOrReplaceWorldbook,createPersona,createPreset,createWorldbook,createWorldbookEntries,default_preset,deleteCharacter,deleteChatMessages,deleteLorebook,deleteLorebookEntries,deleteLorebookEntry,deletePersona,deletePreset,deleteVariable,deleteWorldbook,errorCatched,eventClearAll,eventClearEvent,eventClearListener,eventEmit,eventEmitAndWait,eventMakeFirst,eventMakeLast,eventOn,eventOnButton,eventOnce,eventRemoveListener,formatAsDisplayedMessage,formatAsTavernRegexedString,generate,generateRaw,getAllEnabledScriptButtons,getAllVariables,getAudioList,getAudioSettings,getButtonEvent,getCharAvatarPath,getCharData,getCharLorebooks,getCharWorldbookNames,getCharacter,getCharacterIds,getCharacterNames,getChatHistoryBrief,getChatHistoryDetail,getChatLorebook,getChatMessages,getChatWorldbookName,getCurrentAudio,getCurrentCharPrimaryLorebook,getCurrentCharacterId,getCurrentCharacterName,getCurrentMessageId,getCurrentPersonaId,getCurrentPersonaName,getExtensionStatus,getExtensionType,getFrontendVersion,getGlobalWorldbookNames,getIframeName,getLastMessageId,getLoadedPresetName,getLorebookEntries,getLorebookSettings,getLorebooks,getMessageId,getModelList,getOrCreateChatLorebook,getOrCreateChatWorldbook,getPersona,getPersonaAvatarPath,getPersonaIds,getPersonaNames,getPreset,getPresetNames,getProxyPresetNames,getScriptButtons,getScriptId,getScriptInfo,getScriptName,getScriptTrees,getTavernHelperExtensionId,getTavernHelperVersion,getTavernRegexes,getTavernVersion,getVariables,getWorldbook,getWorldbookNames,iframe_events,importRawCharacter,importRawChat,importRawPreset,importRawTavernRegex,importRawWorldbook,initializeGlobal,injectPrompts,insertOrAssignVariables,insertVariables,installExtension,isAdmin,isCharacterTavernRegexesEnabled,isInstalledExtension,isPresetNormalPrompt,isPresetPlaceholderPrompt,isPresetSystemPrompt,loadPreset,pauseAudio,playAudio,rebindCharWorldbooks,rebindChatWorldbook,rebindGlobalWorldbooks,refreshOneMessage,registerMacroLike,registerVariableSchema,reinstallExtension,reloadIframe,renamePreset,replaceAudioList,replaceCharacter,replaceLorebookEntries,replacePersona,replacePreset,replaceScriptButtons,replaceScriptInfo,replaceScriptTrees,replaceTavernRegexes,replaceVariables,replaceWorldbook,retrieveDisplayedMessage,rotateChatMessages,setAudioSettings,setChatLorebook,setChatMessage,setChatMessages,setCurrentCharLorebooks,setLorebookEntries,setLorebookSettings,setPreset,stopAllGeneration,stopGenerationById,substitudeMacros,tavern_events,triggerSlash,triggerSlashWithResult,uninjectPrompts,uninstallExtension,unregisterMacroLike,updateCharacterWith,updateExtension,updateFrontendVersion,updateLorebookEntriesWith,updatePersonaWith,updatePresetWith,updateScriptButtonsWith,updateScriptTreesWith,updateTavernHelper,updateTavernRegexesWith,updateVariablesWith,updateWorldbookWith,waitGlobalInitialized';

/** (bug 164 · HM0-B) Whitelist dạng mảng — dùng cho prompt và cho bước kiểm sau dịch. */
export const TH_FUNCTION_LIST: readonly string[] = TH_FUNCTION_NAMES.split(',').filter(Boolean);

/**
 * (bug 164 · HM0-B) Tên hàm API dễ bị dịch/đổi nhất — đưa vào prompt làm ví dụ.
 * Lấy TỪ whitelist thật thay vì gõ tay, nên không thể lệch: những tên chứa các gốc từ dưới đây là
 * nhóm hay bị model "Việt hoá" nhất (get/set/create/delete + variable/message/lorebook).
 * KHÔNG dump cả 178 tên vào prompt — chi phí token trên MỌI chunk code, không đáng; bước kiểm tất
 * định sau dịch (aiVerify) mới là chỗ bắt đủ 178 tên mà không tốn token nào.
 */
export function thApiPromptSample(max = 24): string[] {
  const priority = /^(get|set|create|delete|replace|insert|update)(All)?(Variable|Chat|Lorebook|Worldbook|Message|Preset)/;
  const hot = TH_FUNCTION_LIST.filter((n) => priority.test(n));
  return hot.slice(0, max);
}

/**
 * Shim môi trường TavernHelper/MVU cho chế độ 🧪 CHẠY SCRIPT (thử nghiệm).
 * Mô phỏng theo đúng template iframe của extension JS-Slash-Runner (酒馆助手): trong ST thật,
 * script của card chạy trong iframe được bơm sẵn jQuery/lodash/Vue/tailwind + toàn bộ API
 * TavernHelper/Mvu từ parent. Ở đây: phủ kín 178 tên hàm thật (noop an toàn), shim đúng
 * semantics nhóm hiển thị, bơm data test = stat_data parse từ entry [initvar].
 * Lỗi script được postMessage ra modal — chính là công cụ soi "biến bị dịch vỡ".
 */
function buildScriptShim(initvarText: string | null, charName: string, sideLabel = ''): string {
  // Chặn chuỗi </script> trong initvar phá vỡ thẻ script
  const rawInitvar = JSON.stringify(initvarText || '').replace(/<\//g, '<\\/');
  const charJson = JSON.stringify(charName).replace(/<\//g, '<\\/');
  const sideJson = JSON.stringify(sideLabel);
  return `<script>
(function () {
  var noop = function () {};
  var SIDE = ${sideJson};
  var reportErr = function (e, line) {
    try { parent.postMessage({ __stPreviewError: String(e && e.message || e).slice(0, 300), line: line || 0, side: SIDE }, '*'); } catch (_e) {}
  };

  // ── localStorage/sessionStorage: sandbox (không same-origin) chặn → polyfill in-memory ──
  // Card hay lưu setting UI vào localStorage; thiếu là SecurityError chết script.
  var makeStorage = function () {
    var mem = {};
    return {
      getItem: function (k) { return (k in mem) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      clear: function () { mem = {}; },
      key: function (i) { return Object.keys(mem)[i] != null ? Object.keys(mem)[i] : null; },
      get length() { return Object.keys(mem).length; },
    };
  };
  var storageBlocked = false;
  try { void window.localStorage.length; } catch (e) { storageBlocked = true; }
  if (storageBlocked) {
    try {
      Object.defineProperty(window, 'localStorage', { value: makeStorage(), configurable: true });
      Object.defineProperty(window, 'sessionStorage', { value: makeStorage(), configurable: true });
    } catch (e) { /* trình duyệt không cho override — đành chịu */ }
  }

  // ── Phủ kín 178 hàm TavernHelper (predefine.js của extension merge hết thành window globals) ──
  '${TH_FUNCTION_NAMES}'.split(',').forEach(function (n) {
    if (!(n in window)) { try { window[n] = noop; } catch (e) {} }
  });
  // ── stat_data test từ [initvar] (YAML trước, JSON fallback) ──
  var STAT = {};
  try {
    var raw = ${rawInitvar};
    if (raw) {
      try { STAT = window.jsyaml ? (jsyaml.load(raw) || {}) : JSON.parse(raw); }
      catch (e) { try { STAT = JSON.parse(raw); } catch (e2) { STAT = {}; } }
    }
  } catch (e) { STAT = {}; }
  var clone = function (o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return {}; } };
  var VAR_TABLE = { stat_data: STAT };
  var MVU_DATA = { initialized_lorebooks: {}, stat_data: STAT, display_data: clone(STAT), delta_data: {} };

  // ── API biến (variables.d.ts) ──
  window.getAllVariables = function () { return clone(VAR_TABLE); };
  window.getVariables = function () { return clone(VAR_TABLE); };
  window.insertOrAssignVariables = noop; window.replaceVariables = noop; window.updateVariablesWith = noop;

  // ── API tin nhắn ──
  window.getLastMessageId = function () { return 0; };
  window.getCurrentMessageId = function () { return 0; };
  window.getChatMessages = function () {
    return [{ message_id: 0, role: 'assistant', name: ${charJson}, message: '', data: clone(VAR_TABLE), swipe_id: 0, swipes: [] }];
  };

  // ── Events (no-op — không có vòng đời chat thật) ──
  window.eventOn = noop; window.eventOnce = noop; window.eventEmit = noop; window.eventOnButton = noop;
  window.eventRemoveListener = noop; window.eventClearAll = noop; window.eventMakeFirst = noop; window.eventMakeLast = noop;
  window.tavern_events = new Proxy({}, { get: function (_t, k) { return String(k); } });
  window.iframe_events = new Proxy({}, { get: function (_t, k) { return String(k); } });
  window.getIframeName = function () { return 'st-preview'; };
  window.waitGlobalInitialized = function () { return Promise.resolve(); };

  // ── Mvu (exported.mvu.d.ts của JS-Slash-Runner) ──
  window.Mvu = {
    events: {
      VARIABLE_INITIALIZED: 'mag_variable_initiailized',
      VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
      VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
      SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    },
    getMvuData: function () { return clone(MVU_DATA); },
    replaceMvuData: noop,
    parseMessage: function (_m, d) { return Promise.resolve(clone(d)); },
    getMvuVariable: function (data, path) { return window._ ? _.get((data || MVU_DATA).stat_data, path) : undefined; },
    setMvuVariable: function () { return Promise.resolve(true); },
  };

  // ── Semantics thật cho nhóm hàm ảnh hưởng hiển thị (đè lên noop ở trên) ──
  // errorCatched: wrapper try/catch THẬT của TavernHelper (@types/function/util.d.ts) —
  // rất nhiều card bọc điểm vào bằng $(errorCatched(init)). Vẫn report lỗi ra modal.
  window.errorCatched = function (fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { reportErr(e); }
    };
  };
  window.getCharData = function () { return Promise.resolve({ name: ${charJson}, avatar: '', description: '' }); };
  window.getCurrentCharacterName = function () { return ${charJson}; };
  window.getCharAvatarPath = function () { return ''; };
  window.getTavernHelperVersion = function () { return '3.0.0'; };
  window.getFrontendVersion = function () { return '3.0.0'; };
  window.getTavernVersion = function () { return '1.13.0'; };
  window.getIframeName = function () { return 'st-preview'; };
  window.substitudeMacros = function (s) { return s; };
  window.formatAsDisplayedMessage = function (s) { return s; };
  window.formatAsTavernRegexedString = function (s) { return s; };
  window.generate = function () { return Promise.resolve(''); };
  window.generateRaw = function () { return Promise.resolve(''); };
  window.triggerSlash = function () { return Promise.resolve(''); };
  window.triggerSlashWithResult = function () { return Promise.resolve(''); };
  window.getTavernRegexes = function () { return []; };
  window.getLorebookEntries = function () { return Promise.resolve([]); };
  window.getLorebooks = function () { return []; };
  window.getCharLorebooks = function () { return { primary: null, additional: [] }; };
  window.getModelList = function () { return Promise.resolve([]); };

  // ── (User 2026 — đối chiếu predefine.js của JS-Slash-Runner thật) Globals script được cấp:
  // EjsTemplate, TavernHelper, YAML, showdown, toastr, z + getScriptId trả ID iframe thật. ──
  window.getScriptId = function () { return 'st-preview-script'; };
  window.getScriptName = function () { return 'st-preview'; };
  // YAML: bản thật là package yaml (parse/stringify); CDN mình nạp js-yaml (load/dump) → alias.
  if (!window.YAML && window.jsyaml) {
    window.YAML = {
      parse: function (s, o) { return window.jsyaml.load(s, o); },
      stringify: function (v, o) { return window.jsyaml.dump(v, o); },
    };
  }
  // EjsTemplate (ST-Prompt-Template): stub tối thiểu — render trả nguyên văn để card không crash.
  if (!window.EjsTemplate) {
    window.EjsTemplate = {
      render: function (t) { return Promise.resolve(String(t == null ? '' : t)); },
      evalTemplate: function (t) { return Promise.resolve(String(t == null ? '' : t)); },
      getTemplateOptions: function () { return {}; },
    };
  }

  // ── TavernHelper object: gương của toàn bộ globals (extension cũng làm vậy) ──
  var TH = {};
  '${TH_FUNCTION_NAMES}'.split(',').forEach(function (n) { TH[n] = window[n]; });
  window.TavernHelper = new Proxy(TH, { get: function (t, k) { return (k in t) ? t[k] : noop; } });
  window.SillyTavern = { getContext: function () { return { chat: [], characters: [], chatId: 'st-preview' }; } };
  window.toastr = { success: noop, info: noop, warning: noop, error: noop };
  // zod: template thật merge window.z từ parent — CDN UMD expose Zod
  if (!window.z && window.Zod) { window.z = window.Zod.z || window.Zod; }

  // (User 2026) Expose reporter cho các script CARD tiêm phía sau (bọc try/catch theo TÊN script).
  window.__stReportErr = reportErr;

  // ── Báo lỗi script ra modal (bắt biến bị dịch vỡ) — kèm line để tra ra field nguồn ──
  window.onerror = function (msg, src, line, _col, _err) {
    var isCdn = src && src.indexOf('http') === 0;
    var text = String(msg) + (isCdn ? ' [' + src.split('/').pop() + ']' : '');
    reportErr(text, isCdn ? 0 : (line || 0));
  };
  window.addEventListener('unhandledrejection', function (ev) {
    reportErr('Promise: ' + String(ev.reason).slice(0, 300), 0);
  });
})();
<\/script>`;
}

export interface PreviewHtmlOptions {
  /** 🧪 Chạy script của card (iframe cần sandbox="allow-scripts") + bơm data test từ initvar */
  runScripts?: boolean;
  /** Nội dung entry [initvar] (YAML/JSON) làm stat_data test */
  initvarText?: string | null;
  /** Nhãn bên (Gốc/Đã dịch) đính vào lỗi script — cho chế độ so 2 bản */
  sideLabel?: string;
  /** (User 2026) Script TavernHelper của CARD (Norma, Thiên Ý…) cần chạy trong preview. */
  helperScripts?: { name: string; content: string }[];
}

/**
 * (User 2026 — card Long Tộc v8.1) Lấy script TavernHelper của card cho preview.
 * Trong ST thật, 酒馆助手 nạp các script này TOÀN CỤC (không nằm trong tin nhắn) — Norma vẽ quả cầu
 * nổi + panel NORMA SYSTEM, Thiên Ý vẽ quả cầu 诺… Preview trước đây chỉ chạy <script> TRONG tin
 * nhắn nên các UI này không hiện. Phân loại:
 *  - runnable: IIFE/JS thường → chạy được trong sandbox (đã shim API TavernHelper).
 *  - skipped: script có top-level `import` (mvu/zod nạp framework từ CDN) — KHÔNG chạy: bundle thật
 *    cần cả SillyTavern, đè lên shim Mvu là vỡ; logic của chúng đã được stub giả lập đủ cho UI.
 */
export function extractHelperScriptsForPreview(card: unknown): {
  runnable: { name: string; content: string }[];
  skipped: string[];
} {
  const runnable: { name: string; content: string }[] = [];
  const skipped: string[] = [];
  const data = (card as { data?: Record<string, unknown> })?.data ?? (card as Record<string, unknown>) ?? {};
  const ext = (data as { extensions?: Record<string, unknown> }).extensions || {};
  for (const key of ['tavern_helper', 'TavernHelper', 'TavernHelper_scripts', 'js_slash_runner']) {
    const raw = ext[key];
    let scripts: unknown[] = [];
    if (Array.isArray(raw)) {
      const tuple = raw.find((it) => Array.isArray(it) && it[0] === 'scripts' && Array.isArray(it[1])) as [string, unknown[]] | undefined;
      scripts = tuple ? tuple[1] : raw;
    } else if (raw && typeof raw === 'object' && Array.isArray((raw as { scripts?: unknown[] }).scripts)) {
      scripts = (raw as { scripts: unknown[] }).scripts;
    }
    for (const s of scripts) {
      if (!s || typeof s !== 'object') continue;
      const sc = s as { name?: string; content?: string; script?: string; code?: string; enabled?: boolean };
      const content = sc.content || sc.script || sc.code || '';
      if (typeof content !== 'string' || !content.trim()) continue;
      if (sc.enabled === false) continue;
      const name = sc.name || 'script';
      if (/^\s*import\b/m.test(content)) skipped.push(name);
      else runnable.push({ name, content });
    }
    if (runnable.length || skipped.length) break; // đã tìm thấy đúng key chứa scripts
  }
  return { runnable, skipped };
}

/**
 * Dựng HTML hoàn chỉnh cho iframe preview: bong bóng chat tối màu kiểu ST.
 * - Tin nhắn chứa thẻ HTML → render thẳng (card game UI); bọc trong ```fence thì mở fence.
 * - Văn bản thuần → escape + xuống dòng thành <br>, *nghiêng* / **đậm** tối thiểu.
 * - Mặc định iframe sandbox RỖNG → <script> bị chặn (an toàn tuyệt đối).
 * - runScripts: bơm jQuery/lodash/js-yaml (CDN, giống môi trường TavernHelper thật) + shim
 *   Mvu/getVariables với data test từ [initvar] → script card tự đổ số vào thanh trạng thái.
 *   iframe vẫn KHÔNG allow-same-origin: script bị nhốt origin riêng, không đụng được app.
 */
export function buildPreviewHtml(message: string, charName: string, opts: PreviewHtmlOptions = {}): string {
  let body = message.trim();

  // Mở code fence bao NGUYÊN tin nhắn (một số card bọc HTML trong ```)
  const fence = body.match(/^```[a-z]*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fence) body = fence[1];

  const looksHtml = /<[a-z][^>]*>/i.test(body);
  if (!looksHtml) {
    body = escapeHtml(body)
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
      .replace(/\r?\n/g, '<br>');
  }

  // Trong ST thật, iframe tin nhắn SAME-ORIGIN với ST nên script card thoải mái đọc
  // window.parent/top (đo layout, tìm mesid…). Sandbox của mình chặn (đúng nguyên tắc an
  // toàn) → SecurityError chết script ngay. Rewrite các tham chiếu đó trỏ về CHÍNH iframe —
  // shim đã đặt đủ API TavernHelper lên window nên parent ≈ window là xấp xỉ hợp lý.
  const rewriteParentRefs = (s: string) => s
    .replace(/\bwindow\.parent\b/g, 'window')
    .replace(/\bwindow\.top\b/g, 'window')
    .replace(/\bparent\.document\b/g, 'document')
    .replace(/\btop\.document\b/g, 'document');
  if (opts.runScripts) {
    body = rewriteParentRefs(body);
  }

  // (User 2026 — card Long Tộc) SCRIPT TAVERNHELPER CỦA CARD (Norma, Thiên Ý…): trong ST thật do
  // 酒馆助手 nạp toàn cục, KHÔNG nằm trong tin nhắn → phải tiêm riêng vào cuối body để UI (quả cầu
  // nổi, panel NORMA…) hiện như chơi thật. Mỗi script bọc IIFE + try/catch gắn TÊN script vào lỗi.
  // `<\/script` phải escape để không cắt cụt srcdoc.
  let helperScriptTags = '';
  if (opts.runScripts && opts.helperScripts?.length) {
    helperScriptTags = opts.helperScripts
      .map(({ name, content }) => {
        const safe = rewriteParentRefs(content).replace(/<\/script/gi, '<\\/script');
        const nameJson = JSON.stringify(name);
        return `<script>/* card script: ${name.replace(/\*\//g, '')} */
try { (function () {
${safe}
})(); } catch (e) { if (window.__stReportErr) window.__stReportErr('[' + ${nameJson} + '] ' + (e && e.message ? e.message : e), 0); }
<\/script>`;
      })
      .join('\n');
  }

  // Môi trường script (chỉ khi runScripts): ĐÚNG bộ thư viện mà template iframe của
  // JS-Slash-Runner (third_party_message.html) bơm cho mọi tin nhắn trong ST thật.
  // crossorigin="anonymous" để lỗi từ script CDN hiện chi tiết (không bị che thành "Script error.").
  // KHÔNG bơm vue-router: nó đụng history API — sandbox opaque origin chặn → throw vô ích.
  const scriptEnv = opts.runScripts
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free/css/all.min.css" />
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/jquery/dist/jquery.min.js"><\/script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/jquery-ui/dist/jquery-ui.min.js"><\/script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/vue/dist/vue.runtime.global.prod.min.js"><\/script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js"><\/script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/js-yaml@4/dist/js-yaml.min.js"><\/script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/showdown@2/dist/showdown.min.js"><\/script>
<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/zod@3/lib/index.umd.js"><\/script>
${buildScriptShim(opts.initvarText ?? null, charName, opts.sideLabel || '')}`
    : '';

  // ── Card "app toàn màn hình" (wizard tạo NV, game UI có position:fixed/100vh, HTML lớn) vs
  //    tin nhắn thường ──
  // ST thật render nội dung tin nhắn TRỰC TIẾP vào <body> iframe (không có bong bóng chat —
  // bong bóng nằm NGOÀI iframe). Bong bóng .msg (rộng 860px, căn giữa) của mình BÓP app
  // full-screen vào cột hẹp → nhìn như vỡ. Nên: app lớn → render thẳng body giống ST; chỉ
  // văn bản/UI nhỏ mới bọc bong bóng cho đẹp.
  const isFullApp = looksHtml && (
    /<html[\s>]/i.test(body) || /<body[\s>]/i.test(body) ||
    /position\s*:\s*fixed/i.test(body) || /\d+vh\b/i.test(body) || body.length > 6000
  );

  const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  html,body{margin:0;padding:0;background:#1e1e2e;color:#d4d4d8;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.55}
  img{max-width:100%} table{border-collapse:collapse} td,th{border:1px solid #444;padding:2px 6px}
  </style>${scriptEnv}</head>`;

  if (isFullApp) {
    // Render THẲNG như ST: body = nội dung card. Không bong bóng, không containing-block hack
    // (để position:fixed của card phủ đúng khung iframe như trong ST thật). Vẫn cho cuộn.
    return `${head}<body>${body}
${helperScriptTags}
<style>html,body{overflow:auto !important}</style></body></html>`;
  }

  // Tin nhắn thường / UI nhỏ → bong bóng chat cho dễ nhìn.
  return `${head}<body><div style="max-width:860px;margin:0 auto;padding:16px">
  <div style="background:#26263a;border:1px solid #38384f;border-radius:10px;padding:12px 14px">
    <div style="font-weight:700;color:#a78bfa;margin-bottom:8px;font-size:0.95em">${escapeHtml(charName)}</div>
    <div>${body}</div>
  </div></div>
${helperScriptTags}
<style>html,body{overflow:auto !important;height:auto !important;max-height:none !important}</style></body></html>`;
}
