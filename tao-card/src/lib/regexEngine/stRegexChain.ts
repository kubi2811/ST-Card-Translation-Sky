/**
 * stRegexChain.ts — (bug 175) CHẠY CẢ CHUỖI REGEX ĐÚNG NHƯ SILLYTAVERN, KHÔNG PHẢI TỪNG CÁI MỘT.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Auto Creator tạo Card xong import vào SillyTavern, giao diện Opening Form các nút bị
 * liệt, test trong Regex Lab thì bình thường."
 *
 * Đo trên SillyTavern thật: form render đủ 47 nút nhưng `typeof window.goToPage === 'undefined'`,
 * và trong iframe có `Uncaught SyntaxError: Unexpected identifier 'color'`. Thủ phạm là chính
 * regex trang trí của thẻ:
 *
 *   [Render] Opening Form  chèn 40KB HTML+JS vào tin nhắn
 *   [Style] Tô màu Tài nguyên  chạy SAU, khớp "115 VP" nằm trong một chuỗi JSON TRONG JS, bọc nó
 *   bằng <span style="color: …"> — dấu nháy kép cắt đứt chuỗi JS ⇒ cả <script type="module">
 *   không biên dịch được ⇒ không handler nào lên window ⇒ mọi nút chết.
 *
 * SillyTavern áp regex hiển thị LẦN LƯỢT trên CÙNG một chuỗi (regex/engine.js:346-355):
 * GLOBAL trước, SCOPED sau, mỗi nhóm theo đúng thứ tự mảng. Nên bất cứ script nào đứng SAU một
 * script render đều có thể ăn vào code mà script render vừa chèn.
 *
 * Module này làm hai việc:
 *   1. Chạy đúng chuỗi đó (kể cả cách ST đọc findRegex) để tool THẤY được lỗi.
 *   2. Sắp lại thứ tự: script render phải đứng CUỐI trong nhóm hiển thị.
 */

export interface StRegexScript {
  scriptName?: string;
  findRegex: string;
  replaceString?: string;
  disabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  placement?: number[];
  trimStrings?: string[];
}

/**
 * Bản port trung thành của `regexFromString` trong SillyTavern (public/scripts/utils.js).
 *
 * ĐIỂM SỐNG CÒN: chuỗi TRẦN (không bọc `/…/`) vẫn được coi là MẪU REGEX, không phải chữ cần tìm
 * nguyên văn. Bản mô phỏng đầu tiên của tôi escape nó thành literal nên đo ra "0 lần khớp" và
 * suýt kết luận nhầm rằng regex trang trí vô hại — trong khi nó chính là thủ phạm.
 */
export function stRegexFromString(input: string): RegExp | undefined {
  try {
    const m = String(input ?? '').match(/(\/?)(.+)\1([a-z]*)/i);
    if (!m) return undefined;
    if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) return new RegExp(input);
    return new RegExp(m[2], m[3]);
  } catch {
    return undefined;
  }
}

/**
 * Script này có chạy ở luồng HIỂN THỊ không (engine.js:348-355 với isMarkdown = true)?
 *   (markdownOnly && isMarkdown) || (promptOnly && isPrompt) || (!md && !prompt && !md && !prompt)
 * Với isMarkdown = true, isPrompt = false thì chỉ vế đầu đúng ⇒ CHỈ script markdownOnly mới chạy.
 * Script không cờ nào chạy ở luồng "nguồn" (lịch sử chat), không phải luồng hiển thị.
 */
export function runsOnDisplay(s: StRegexScript): boolean {
  if (s.disabled) return false;
  if (Array.isArray(s.placement) && s.placement.length > 0 && !s.placement.includes(2)) return false;
  return s.markdownOnly === true;
}

/** Script này có phải bộ RENDER giao diện không — tức replaceString chèn nguyên một khối ```html. */
export function isRenderScript(s: StRegexScript): boolean {
  const rp = String(s.replaceString ?? '');
  return runsOnDisplay(s) && /```html/.test(rp) && /<script|<body|<head/i.test(rp);
}

export interface ChainStep { name: string; hits: number; before: number; after: number }

/** Chạy đúng chuỗi regex hiển thị của ST lên một tin nhắn. */
export function applyDisplayChain(
  text: string,
  scripts: StRegexScript[],
): { text: string; steps: ChainStep[] } {
  let out = String(text ?? '');
  const steps: ChainStep[] = [];
  for (const s of scripts) {
    if (!runsOnDisplay(s)) continue;
    const re = stRegexFromString(s.findRegex);
    if (!re) continue;
    const before = out.length;
    const hits = re.global ? (out.match(re) ?? []).length : (re.test(out) ? 1 : 0);
    // ST cho phép `{{match}}` trong replaceString; JS dùng `$&` cho cùng ý nghĩa.
    const rp = String(s.replaceString ?? '').replace(/\{\{match\}\}/gi, '$&');
    out = out.replace(re, rp);
    steps.push({ name: String(s.scriptName ?? '(không tên)'), hits, before, after: out.length });
  }
  return { text: out, steps };
}

/** Lấy phần JS trong mọi khối ```html của một tin nhắn đã render. */
function scriptBodiesOf(text: string): string[] {
  const out: string[] = [];
  for (const block of String(text).matchAll(/```html\n([\s\S]*?)\n```/g)) {
    for (const sc of block[1].matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) out.push(sc[1]);
  }
  return out;
}

/** Khối JS này còn biên dịch được không. `import`/`export` thì bỏ qua (new Function không nhận). */
function jsCompiles(body: string): { ok: boolean; err: string } {
  if (/^\s*(import|export)\s/m.test(body)) return { ok: true, err: '' };
  try {
    new Function(body);
    return { ok: true, err: '' };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

export interface ChainBreak {
  /** Script đã phá. */
  culprit: string;
  /** Script render bị phá (đoán theo khối bị vỡ). */
  victim: string;
  detail: string;
}

/**
 * Chạy cả chuỗi và chỉ đích danh script nào biến một khối <script> đang lành thành vỡ cú pháp.
 * Đây chính là phép kiểm mà Regex Lab thiếu: nó thử từng script một nên không đời nào thấy được.
 */
export function findChainBreaks(firstMes: string, scripts: StRegexScript[]): ChainBreak[] {
  const display = scripts.filter(runsOnDisplay);
  const breaks: ChainBreak[] = [];
  let text = String(firstMes ?? '');
  let prevBroken = new Set<number>();

  for (const s of display) {
    const re = stRegexFromString(s.findRegex);
    if (!re) continue;
    const rp = String(s.replaceString ?? '').replace(/\{\{match\}\}/gi, '$&');
    text = text.replace(re, rp);

    const bodies = scriptBodiesOf(text);
    const nowBroken = new Set<number>();
    bodies.forEach((b, i) => { if (!jsCompiles(b).ok) nowBroken.add(i); });

    for (const i of nowBroken) {
      if (prevBroken.has(i)) continue;               // đã vỡ từ trước — không đổ cho script này
      if (isRenderScript(s)) continue;               // chính nó vừa chèn khối đó vào: lỗi của khối, không phải của chuỗi
      const victim = [...display].reverse().find(x => isRenderScript(x) && x !== s);
      breaks.push({
        culprit: String(s.scriptName ?? '(không tên)'),
        victim: String(victim?.scriptName ?? '(khối giao diện)'),
        detail: jsCompiles(bodies[i]).err,
      });
    }
    prevBroken = nowBroken;
  }
  return breaks;
}

/**
 * Đẩy mọi script RENDER xuống CUỐI nhóm hiển thị.
 *
 * ST chạy GLOBAL trước rồi SCOPED, mỗi nhóm theo thứ tự mảng — nên để script render đứng cuối
 * thì mọi regex trang trí (của thẻ LẪN của user) đều đã chạy xong trên văn xuôi trước khi khối
 * HTML+JS được chèn vào, và không còn gì ăn vào code nữa. Văn xuôi vẫn được tô màu như thường.
 */
export function reorderRenderScriptsLast<T extends StRegexScript>(
  scripts: T[],
): { scripts: T[]; moved: string[] } {
  const list = [...scripts];
  const renderIdx = list.map((s, i) => (isRenderScript(s) ? i : -1)).filter(i => i >= 0);
  if (renderIdx.length === 0) return { scripts: list, moved: [] };

  const lastDisplayIdx = list.map((s, i) => (runsOnDisplay(s) ? i : -1)).filter(i => i >= 0).pop() ?? -1;
  // Đã nằm cuối cả rồi thì thôi — không đẻ diff vô nghĩa.
  const alreadyLast = renderIdx.every((idx, k) => idx === lastDisplayIdx - (renderIdx.length - 1 - k));
  if (alreadyLast) return { scripts: list, moved: [] };

  const renders = renderIdx.map(i => list[i]);
  const rest = list.filter((_, i) => !renderIdx.includes(i));
  return {
    scripts: [...rest, ...renders],
    moved: renders.map(s => String(s.scriptName ?? '(không tên)')),
  };
}
