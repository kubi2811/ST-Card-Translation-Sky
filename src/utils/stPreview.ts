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
export function applyDisplayRegex(
  text: string,
  scripts: StRegexScript[],
): { text: string; applied: string[] } {
  let out = text;
  const applied: string[] = [];
  for (const s of scripts) {
    if (!s || s.disabled || s.promptOnly) continue;
    if (!(s.placement || []).includes(2)) continue;
    const re = parseFindRegex(s.findRegex || '');
    if (!re) continue;
    // {{match}} → token '$&' của String.replace (cả đoạn khớp). '$$&' vì trong replacement
    // string, '$&' có nghĩa đặc biệt — phải escape $$ để chèn literal '$&' cho lượt replace sau.
    const replStr = (s.replaceString ?? '').replace(/\{\{match\}\}/gi, '$$&');
    try {
      const before = out;
      out = out.replace(re, replStr);
      if (out !== before) applied.push(s.scriptName || '(không tên)');
    } catch {
      /* script lỗi — bỏ qua, xử tiếp script sau */
    }
  }
  return { text: out, applied };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Dựng HTML hoàn chỉnh cho iframe preview: bong bóng chat tối màu kiểu ST.
 * - Tin nhắn chứa thẻ HTML → render thẳng (card game UI); bọc trong ```fence thì mở fence.
 * - Văn bản thuần → escape + xuống dòng thành <br>, *nghiêng* / **đậm** tối thiểu.
 * iframe dùng sandbox rỗng nên <script> bên trong TỰ ĐỘNG bị chặn — an toàn.
 */
export function buildPreviewHtml(message: string, charName: string): string {
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

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#1e1e2e;color:#d4d4d8;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.55}
  .wrap{max-width:860px;margin:0 auto;padding:16px}
  .msg{background:#26263a;border:1px solid #38384f;border-radius:10px;padding:12px 14px}
  .name{font-weight:700;color:#a78bfa;margin-bottom:8px;font-size:0.95em}
  img{max-width:100%} table{border-collapse:collapse} td,th{border:1px solid #444;padding:2px 6px}
  </style></head><body><div class="wrap"><div class="msg"><div class="name">${escapeHtml(charName)}</div><div class="content">${body}</div></div></div></body></html>`;
}
