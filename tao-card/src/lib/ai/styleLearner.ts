/**
 * src/lib/ai/styleLearner.ts — (bugNeedFix/186) 🎨 HỌC PHONG CÁCH GIAO DIỆN từ card mẫu.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: import một card mẫu để AI phân tích và học phong cách thiết kế giao diện (Opening Form,
 * Status Bar, màu sắc/typography/animation, UX) — rồi áp phong cách đó lên SCHEMA CỦA BƯỚC 1.
 *
 * HAI LUẬT SẮT của yêu cầu, và cách mỗi luật được ép BẰNG MÁY chứ không bằng lời dặn:
 *
 * 1. "AI không được lấy và nhại lại các biến, dữ liệu, Lore, nhân vật hoặc logic của Card mẫu."
 *    → Trước khi gửi cho AI, máy tự bóc DANH SÁCH TÊN BIẾN của card mẫu (data-var, getvar,
 *      stat_data.…). Sau khi AI trả Style Profile, mọi ghi chú còn nhắc tới tên biến đó bị máy
 *      LỌC BỎ và đếm lại cho user thấy. Lời dặn trong prompt vẫn có, nhưng chốt là ở máy.
 *
 * 2. "Giao diện mới phải hoạt động dựa trên Schema ở Bước 1… giữ nguyên tương thích MVU/EJS/
 *    Regex/Lorebook."
 *    → Tái dùng đúng quyết định thiết kế của bug 145: AI KHÔNG sinh HTML. Phần thị giác của
 *      profile (màu, font, bo góc, đổ bóng, nhịp animation) thành một ThemePreset đè lên khung
 *      do buildProgrammaticRegex dựng TỪ CHÍNH SCHEMA BƯỚC 1 — nên "đối chiếu với schema" là
 *      cơ chế, không phải hy vọng: khung sinh từ schema thì không thể copy biến của mẫu.
 *      Phần bố cục/UX (thứ khung máy chưa cho tuỳ biến) thành GHI CHÚ tiếng Việt, nối vào ô
 *      "Yêu cầu/Quy tắc cho AI" (#147) để các bước AI viết nội dung làm theo.
 */
import type { ChatMessage } from '../../types';
import type { StyleProfile, StyleLearnScope } from '../../types/autoCreator.types';
import type { AiThemeSpec } from './themeDesigner';
import { AI_THEME_COLOR_KEYS } from './themeDesigner';
import { THEME_PRESETS, DEFAULT_THEME_ID } from '../mvuzod/gameHtmlTemplates';

export const STYLE_SCOPES: Array<{ id: StyleLearnScope; label: string; desc: string }> = [
  { id: 'all', label: 'Học toàn bộ phong cách', desc: 'Opening Form + Status Bar + màu sắc/animation + UX.' },
  { id: 'opening_form', label: 'Chỉ học Opening Form', desc: 'Bố cục, thứ tự bước, section, nút bấm của biểu mẫu mở đầu.' },
  { id: 'status_bar', label: 'Chỉ học Status Bar', desc: 'Bố cục, tab/menu, cách trình bày thông tin của thanh trạng thái.' },
  { id: 'visual', label: 'Chỉ học Visual / Animation', desc: 'Màu sắc, typography, bo góc, đổ bóng, hiệu ứng chuyển động.' },
];

/* ═══════════════ 1. BÓC UI TỪ CARD MẪU ═══════════════ */

/** Ngân sách ký tự gửi AI — card 3MB thì chỉ phần UI đậm đặc nhất mới lên tàu. */
const UI_BUDGET = 60_000;

interface UiChunk { source: string; text: string; score: number }

/** Điểm "đậm chất UI" của một khối text — càng nhiều HTML/CSS thật càng cao. */
export function uiScore(text: string): number {
  let s = 0;
  s += (text.match(/<(div|span|section|button|table|details|progress|input|select)\b/gi) ?? []).length * 2;
  s += (text.match(/<style\b|@keyframes|animation\s*:|transition\s*:/gi) ?? []).length * 6;
  s += (text.match(/linear-gradient|box-shadow|border-radius|backdrop-filter|hover/gi) ?? []).length * 3;
  s += (text.match(/class\s*=/gi) ?? []).length;
  return s;
}

/**
 * Gom mọi khối có thể chứa giao diện từ card mẫu: regex replaceString (nơi ở chính của status
 * bar/opening form), script TavernHelper, entry lorebook có HTML, first_mes.
 * Xếp theo điểm UI rồi cắt theo ngân sách — card mẫu thường chỉ có 2-3 khối thật sự là giao diện.
 */
export function extractUiFromCard(card: Record<string, unknown>): { chunks: UiChunk[]; truncated: boolean } {
  const data = (card?.data ?? card) as Record<string, unknown>;
  const ext = (data?.extensions ?? {}) as Record<string, unknown>;
  const out: UiChunk[] = [];
  const push = (source: string, text: unknown) => {
    const t = String(text ?? '').trim();
    if (t.length < 200) return;                    // mẩu vụn không dạy được phong cách
    const score = uiScore(t);
    if (score < 8) return;                         // văn xuôi thuần — không phải giao diện
    out.push({ source, text: t, score });
  };

  for (const [i, r] of ((ext.regex_scripts ?? []) as Array<Record<string, unknown>>).entries()) {
    push(`regex[${i}] "${String(r.scriptName ?? '')}"`, r.replaceString);
  }
  const th = (ext.tavern_helper as Record<string, unknown>)?.scripts ?? ext.TavernHelper_scripts ?? [];
  for (const [i, s] of (th as Array<Record<string, unknown>>).entries()) {
    push(`tavern_helper[${i}] "${String(s.name ?? '')}"`, s.content);
  }
  const book = (data.character_book as Record<string, unknown>)?.entries ?? [];
  for (const [i, e] of (book as Array<Record<string, unknown>>).entries()) {
    push(`lorebook[${i}] "${String(e.comment ?? e.name ?? '')}"`, e.content);
  }
  push('first_mes', data.first_mes);

  out.sort((a, b) => b.score - a.score);
  const kept: UiChunk[] = [];
  let used = 0;
  for (const c of out) {
    if (used >= UI_BUDGET) break;
    const room = UI_BUDGET - used;
    kept.push(c.text.length <= room ? c : { ...c, text: c.text.slice(0, room) + '\n…(cắt bớt)' });
    used += Math.min(c.text.length, room);
  }
  return { chunks: kept, truncated: kept.length < out.length || out.some(c => c.text.length > UI_BUDGET) };
}

/* ═══════════════ 2. BÓC TÊN BIẾN CỦA MẪU (để cấm nhại) ═══════════════ */

/**
 * Mọi tên biến/đường dẫn dữ liệu xuất hiện trong UI mẫu. Đây là danh sách CẤM: profile trả về
 * mà còn nhắc tên nào trong đây là ghi chú đó bị loại — "học phong cách" chứ không "chép ruột".
 */
export function collectSampleVarNames(uiCode: string): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const seg of String(s).split(/[.[\]'"]+/)) {
      const t = seg.trim();
      if (t.length >= 2 && !/^\d+$/.test(t) && !['value', 'stat_data', 'display'].includes(t)) out.add(t);
    }
  };
  for (const m of uiCode.matchAll(/data-var\s*=\s*["']([^"']+)["']/g)) add(m[1]);
  for (const m of uiCode.matchAll(/\{\{(?:get|set|add)(?:global)?var::([^:}]+)/g)) add(m[1]);
  for (const m of uiCode.matchAll(/\b(?:get|set|add)(?:global)?[Vv]ar(?:iable)?s?\s*\(\s*['"]([^'"]+)['"]/g)) add(m[1]);
  for (const m of uiCode.matchAll(/stat_data((?:\s*\.\s*[\w一-鿿$]+|\s*\[\s*['"][^'"]+['"]\s*\])+)/g)) add(m[1]);
  for (const m of uiCode.matchAll(/_\s*\.\s*(?:get|set|has)\s*\(\s*[^,()]+,\s*['"]([^'"]+)['"]/g)) add(m[1]);
  return out;
}

/* ═══════════════ 3. PROMPT ═══════════════ */

/** Khoá thị giác NGOÀI màu mà profile được phép đặt — đều là biến khung máy đã hiểu. */
export const STYLE_EXTRA_PREFIXES = ['--radius-', '--shadow-', '--transition-', '--bar-', '--fs-'] as const;

const SCOPE_FOCUS: Record<StyleLearnScope, string> = {
  all: 'Phân tích ĐỦ 4 mảng: Opening Form, Status Bar, phong cách thị giác, UX.',
  opening_form: 'CHỈ tập trung Opening Form: bố cục, thứ tự bước, section, card/grid, nút bấm, icon, animation, hover/focus. Mảng khác trả mảng rỗng.',
  status_bar: 'CHỈ tập trung Status Bar: bố cục, tab/menu, cách hiển thị thông tin, tương tác. Mảng khác trả mảng rỗng.',
  visual: 'CHỈ tập trung phong cách thị giác: màu, typography, border, bo góc, spacing, shadow, vật trang trí, animation. openingForm/statusBar/ux trả mảng rỗng.',
};

export const STYLE_LEARN_SYSTEM = `Bạn là nhà phân tích giao diện cho thẻ SillyTavern. Người dùng đưa CODE
GIAO DIỆN của một card mẫu (regex HTML, script, CSS). Việc của bạn: rút ra PHONG CÁCH THIẾT KẾ —
để áp cho một card KHÁC có bộ dữ liệu KHÁC hẳn.

LUẬT SẮT — vi phạm là kết quả bị máy loại:
• TUYỆT ĐỐI KHÔNG nhắc lại tên biến, tên nhân vật, lore, dữ liệu hay logic của card mẫu trong
  bất kỳ ghi chú nào. Card mẫu có tab "Kỹ năng/Kho đồ" thì bạn ghi "chia thông tin thành tab
  theo nhóm" — KHÔNG ghi "tab Kỹ năng, tab Kho đồ".
• Ghi chú phải nói về HÌNH THỨC (bố cục, nhịp, hiệu ứng, cách tổ chức) — thứ áp được cho mọi
  bộ dữ liệu. Dữ liệu hiển thị sẽ lấy từ schema của card hiện tại, không phải của mẫu.

Trả về DUY NHẤT JSON:
{
  "name": "tên phong cách ngắn (tiếng Việt)",
  "description": "1 câu tả không khí tổng thể",
  "icon": "1 emoji",
  "visual": {
    "fontImport": "https://fonts.googleapis.com/css2?family=...&display=swap",
    "fontFamily": "'Font thân', serif",
    "headingFont": "'Font tiêu đề', cursive",
    "colors": { "--bg-primary": "#...", "--bg-card": "#...", "--theme-main": "#...", "--text-primary": "#...", "...": "các khoá màu khác nhìn thấy trong mẫu" },
    "extras": { "--radius-md": "8px", "--shadow-md": "0 4px 12px rgba(...)", "--transition-base": "0.3s ease", "--bar-hp": "linear-gradient(...)" }
  },
  "openingForm": ["ghi chú bố cục/UX của Opening Form, mỗi ý một dòng, tiếng Việt"],
  "statusBar": ["ghi chú bố cục/cách trình bày của Status Bar"],
  "decorations": ["vật thể trang trí, hoạ tiết, animation đặc trưng"],
  "ux": ["cách tổ chức thông tin & trải nghiệm nhập liệu"]
}

Màu lấy TỪ MẪU (đọc CSS của nó): hex hoặc rgba()/hsla(), không dùng tên màu CSS. Chữ phải đọc
được trên nền. extras chỉ dùng các khoá --radius-* --shadow-* --transition-* --bar-* --fs-*.
Không chắc khoá nào thì bỏ qua khoá đó. KHÔNG viết HTML, KHÔNG giải thích ngoài JSON.`;

export function buildStyleLearnMessages(
  uiChunks: UiChunk[],
  scope: StyleLearnScope,
  schemaLabels: string[],
): ChatMessage[] {
  const parts: string[] = [SCOPE_FOCUS[scope]];
  if (schemaLabels.length > 0) {
    parts.push(
      `\nSchema của card HIỆN TẠI (dữ liệu sẽ hiển thị — chỉ để bạn biết ghi chú phải áp được cho bộ này, KHÔNG phải để phân tích): ${schemaLabels.slice(0, 25).join(', ')}.`,
    );
  }
  parts.push('\n══ CODE GIAO DIỆN CỦA CARD MẪU ══');
  for (const c of uiChunks) parts.push(`\n--- ${c.source} ---\n${c.text}`);
  return [
    { role: 'system', content: STYLE_LEARN_SYSTEM },
    { role: 'user', content: parts.join('\n') },
  ];
}

/* ═══════════════ 4. PARSE + CHỐT MÁY ═══════════════ */

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent)$/;
/** extras: giá trị CSS ngắn gọn, cấm url()/expression()/dấu chấm phẩy — chỉ là token trang trí. */
const EXTRA_RE = /^[\w\s#%(),.\/-]{1,120}$/;

export function parseStyleProfile(raw: string, scope: StyleLearnScope): StyleProfile {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON.');
  const p = JSON.parse(m[0]) as Record<string, unknown>;
  const vis = (p.visual ?? {}) as Record<string, unknown>;

  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries((vis.colors ?? {}) as Record<string, unknown>)) {
    const key = k.startsWith('--') ? k : `--${k}`;
    if (!(AI_THEME_COLOR_KEYS as readonly string[]).includes(key)) continue;
    const val = String(v).trim();
    if (COLOR_RE.test(val)) colors[key] = val;
  }
  const extras: Record<string, string> = {};
  for (const [k, v] of Object.entries((vis.extras ?? {}) as Record<string, unknown>)) {
    const key = k.startsWith('--') ? k : `--${k}`;
    if (!STYLE_EXTRA_PREFIXES.some(pre => key.startsWith(pre))) continue;
    const val = String(v).trim();
    if (EXTRA_RE.test(val) && !/url\s*\(|expression|;/i.test(val)) extras[key] = val;
  }

  const list = (x: unknown) => (Array.isArray(x) ? x.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12) : []);
  const profile: StyleProfile = {
    name: String(p.name ?? 'Phong cách học từ mẫu').trim() || 'Phong cách học từ mẫu',
    description: String(p.description ?? '').trim(),
    icon: String(p.icon ?? '🎨').trim().slice(0, 4) || '🎨',
    scope,
    fontImport: /^https:\/\/fonts\.googleapis\.com\//.test(String(vis.fontImport ?? '')) ? String(vis.fontImport) : '',
    fontFamily: String(vis.fontFamily ?? '').trim(),
    headingFont: String(vis.headingFont ?? '').trim(),
    colors,
    extras,
    openingForm: list(p.openingForm),
    statusBar: list(p.statusBar),
    decorations: list(p.decorations),
    ux: list(p.ux),
  };

  const wantsVisual = scope === 'all' || scope === 'visual';
  const noteCount = profile.openingForm.length + profile.statusBar.length + profile.decorations.length + profile.ux.length;
  if ((wantsVisual && Object.keys(colors).length < 4) && noteCount === 0) {
    throw new Error('AI không rút được gì dùng được từ card mẫu — mẫu có thể không chứa giao diện.');
  }
  return profile;
}

/**
 * LUẬT SẮT SỐ 1 chạy bằng máy: ghi chú nào còn nhắc tên biến của card mẫu là bị loại.
 * So không phân biệt hoa thường; tên quá ngắn (<3 ký tự, trừ CJK) bỏ qua để khỏi bắt oan từ
 * tiếng Việt thường ("HP" thì vẫn bắt vì là tên biến kinh điển của mẫu).
 */
export function sanitizeStyleProfile(
  profile: StyleProfile,
  sampleVars: Set<string>,
): { profile: StyleProfile; removed: string[] } {
  const names = [...sampleVars].filter(v => /[一-鿿]/.test(v) || v.length >= 2);
  const hit = (note: string) => {
    const low = note.toLowerCase();
    return names.find(n => (/[一-鿿]/.test(n) ? note.includes(n) : new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()}(?![\\p{L}\\p{N}])`, 'u').test(low)));
  };
  const removed: string[] = [];
  const clean = (arr: string[]) => arr.filter(note => {
    const bad = hit(note);
    if (bad) { removed.push(`"${note.slice(0, 60)}" (dính biến mẫu "${bad}")`); return false; }
    return true;
  });
  return {
    profile: {
      ...profile,
      openingForm: clean(profile.openingForm),
      statusBar: clean(profile.statusBar),
      decorations: clean(profile.decorations),
      ux: clean(profile.ux),
    },
    removed,
  };
}

/* ═══════════════ 4b. (bug 188) TÁI THIẾT KẾ GIAO DIỆN RIÊNG ═══════════════ */

/**
 * (bug 188) Biến Style Profile thành BẢN THIẾT KẾ (design brief) cho máy sinh UI thật
 * (generateOrchestrated). Khác bug 186 (chỉ đổi màu template): brief này yêu cầu AI TÁI THIẾT
 * KẾ một giao diện MỚI — bố cục, tỷ lệ, cấu trúc component, phân cấp thông tin, khoảng cách,
 * typography, icon, animation, trạng thái tương tác, UX — mang tinh thần mẫu nhưng không clone.
 */
export function styleProfileToDesignBrief(profile: StyleProfile): string {
  const lines: string[] = [
    'BẢN THIẾT KẾ — TÁI THIẾT KẾ GIAO DIỆN THEO PHONG CÁCH ĐÃ HỌC TỪ MỘT CARD MẪU.',
    'LUẬT SẮT (vi phạm là kết quả bị máy loại):',
    '1. Đây là THIẾT KẾ MỚI của riêng bạn — TUYỆT ĐỐI KHÔNG chép lại giao diện mẫu, không dùng lại nguyên khối HTML/CSS nào của bất kỳ template nào. Học tinh thần, không chép hình hài.',
    '2. CHỈ dùng các biến trong schema hiện tại (danh sách allowed variables bên dưới). Không bịa biến, không dùng tên biến của card mẫu.',
    '3. Ưu tiên KHẢ NĂNG SỬ DỤNG THẬT: dễ đọc, tương phản đủ, phân cấp thông tin rõ, nhất quán giữa Opening Form và Status Bar, hợp với dữ liệu của thẻ.',
    '',
    `Tinh thần mẫu: ${profile.icon} ${profile.name} — ${profile.description}.`,
  ];
  const tokens = [...Object.entries(profile.colors), ...Object.entries(profile.extras)];
  if (tokens.length) {
    lines.push(`Bảng phong cách thị giác (dùng làm cảm hứng, được phép biến tấu): ${tokens.map(([k, v]) => `${k}=${v}`).join('; ')}.`);
  }
  if (profile.fontFamily) lines.push(`Typography: font chính ${profile.fontFamily}${profile.headingFont ? `, heading ${profile.headingFont}` : ''}${profile.fontImport ? ` (import: ${profile.fontImport})` : ''}.`);
  const sec = (title: string, notes: string[]) => {
    if (notes.length) lines.push(`${title}:`, ...notes.map(n => `- ${n}`));
  };
  sec('Ghi chú Opening Form (bố cục, luồng bước, ô nhập)', profile.openingForm);
  sec('Ghi chú Status Bar (cấu trúc component, phân cấp, tab/nhóm)', profile.statusBar);
  sec('Trang trí & animation (hiệu ứng, trạng thái hover/active)', profile.decorations);
  sec('UX (tổ chức thông tin, khoảng cách, tỷ lệ)', profile.ux);
  return lines.join('\n');
}

/** So MỘT tên biến với một khối văn bản — CJK: chứa là dính; ASCII: theo ranh giới từ. */
export function nameHitsText(text: string, name: string): boolean {
  if (/[一-鿿]/.test(name)) return text.includes(name);
  if (name.length < 2) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').test(text.toLowerCase());
}

/**
 * (bug 188) CHỐT MÁY chống clone: soi bộ script tái thiết kế xem có RÒ tên biến của card mẫu
 * không. AI dùng biến mẫu = nó đang chép ruột mẫu chứ không tái thiết kế — loại, không thương.
 */
export function checkRedesignLeaks(
  scripts: Array<{ replaceString?: unknown; findRegex?: unknown }>,
  bannedVars: string[] | undefined,
): string[] {
  if (!bannedVars?.length) return [];
  const body = scripts.map(s => `${String(s.findRegex ?? '')}\n${String(s.replaceString ?? '')}`).join('\n');
  return bannedVars.filter(v => nameHitsText(body, v));
}

/* ═══════════════ 5. ÁP PROFILE ═══════════════ */

/** Phần thị giác của profile → AiThemeSpec, để registerAiTheme cắm vào chung đường với bug 145. */
export function styleProfileToThemeSpec(profile: StyleProfile): AiThemeSpec {
  const base = THEME_PRESETS[DEFAULT_THEME_ID];
  return {
    name: profile.name,
    description: profile.description || 'Phong cách học từ card mẫu',
    icon: profile.icon,
    fontImport: profile.fontImport || base.fontImport,
    fontFamily: profile.fontFamily || base.fontFamily,
    headingFont: profile.headingFont || base.headingFont,
    // specToThemePreset spread thẳng vào cssVars nên extras (bo góc/đổ bóng/nhịp animation)
    // đi cùng chuyến với màu — khung máy đã hiểu sẵn các biến này.
    colors: { ...profile.colors, ...profile.extras },
  };
}

const RULES_MARK_START = '--- 🎨 Phong cách học từ card mẫu (tự sinh — đừng sửa tay dòng này) ---';
const RULES_MARK_END = '--- hết phong cách học từ card mẫu ---';

/**
 * Ghi chú bố cục/UX → khối văn bản nối vào ô "Yêu cầu/Quy tắc cho AI" (#147 — được thread vào
 * mọi bước pipeline). Khung Opening Form/Status Bar vẫn do máy dựng từ schema (bất biến để không
 * vỡ biến), nên phần bố cục là chỉ dẫn cho các bước AI VIẾT NỘI DUNG (first_mes, EJS, lorebook
 * trình bày) bám theo không khí của mẫu.
 */
export function styleNotesToRulesBlock(profile: StyleProfile): string {
  const secs: string[] = [];
  const add = (title: string, arr: string[]) => {
    if (arr.length) secs.push(`${title}:\n${arr.map(s => `- ${s}`).join('\n')}`);
  };
  add('Opening Form (phong cách mẫu)', profile.openingForm);
  add('Status Bar (phong cách mẫu)', profile.statusBar);
  add('Trang trí & animation', profile.decorations);
  add('UX / tổ chức thông tin', profile.ux);
  if (!secs.length) return '';
  return [
    RULES_MARK_START,
    `Phong cách "${profile.name}" — ${profile.description}`,
    'LƯU Ý: đây là phong cách HÌNH THỨC học từ một card mẫu. Dữ liệu, biến, lore vẫn theo card hiện tại.',
    ...secs,
    RULES_MARK_END,
  ].join('\n');
}

/** Nối/thay khối phong cách trong userRules — học mẫu mới là thay khối cũ, không chồng đống. */
export function applyStyleRules(currentRules: string, block: string): string {
  const re = new RegExp(
    `${RULES_MARK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${RULES_MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  );
  const stripped = currentRules.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!block) return stripped;
  return [stripped, block].filter(Boolean).join('\n\n');
}
