/**
 * src/lib/ai/themeDesigner.ts — (bugNeedFix/145) "NHỜ AI TẠO GIAO DIỆN" cho Bước 2 của
 * Xem trước & Tinh chỉnh.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "ngoài 3 mẫu giao diện có sẵn thì cũng nên có 1 ô Nhờ AI tạo 1 giao diện giống như ô ở
 * bước 1, hỏi phong cách thích, màu chủ đạo… Con AI này khi tạo xong cũng có thể chỉnh sửa chỗ
 * chưa ưng ý nếu người dùng yêu cầu, cho xem trước trước khi apply, AI cũng thích nghi để hiểu
 * những gì nó vừa tạo."
 *
 * QUYẾT ĐỊNH THIẾT KẾ QUAN TRỌNG — AI sinh BẢNG MÀU CÓ CẤU TRÚC, KHÔNG sinh HTML/CSS thô.
 * Giao diện thẻ ở đây không phải trang trí suông: Opening Form phải GHI được biến vào trình
 * quản lý biến và Status Bar phải ĐỌC đúng biến (chính là bug 114 và bug 78 từng làm card chết).
 * Nếu để AI viết HTML/JS tự do thì mỗi lần sinh là một lần đánh cược vào đường ghi biến đó.
 * Nên AI chỉ được quyết PHẦN THẨM MỸ (bảng màu + font) dưới dạng ThemePreset, còn khung HTML
 * vẫn do buildProgrammaticRegex dựng như 3 mẫu có sẵn — thẩm mỹ thì tự do, phần chạy được thì
 * bất biến. Nhờ vậy "chỉnh lại chỗ chưa ưng" chỉ là sinh lại bảng màu, không bao giờ làm hỏng
 * chức năng, và preview dùng chung một đường với các mẫu dựng sẵn.
 *
 * "AI hiểu những gì nó vừa tạo": mỗi lượt chỉnh sửa được gửi kèm NGUYÊN bảng màu hiện tại, nên
 * AI sửa đúng biến người dùng chê thay vì vẽ lại từ đầu.
 */
import type { ChatMessage } from '../../types';
import type { ThemePreset } from '../mvuzod/gameHtmlTemplates';
import { THEME_PRESETS, DEFAULT_THEME_ID } from '../mvuzod/gameHtmlTemplates';

/** Id dành riêng cho theme do AI sinh — không đụng 4 preset gốc. */
export const AI_THEME_ID = 'ai_custom';

/** Các khoá màu AI được phép đặt. Ngoài danh sách này thì kế thừa từ theme nền. */
export const AI_THEME_COLOR_KEYS = [
  '--bg-primary', '--bg-card', '--bg-section', '--bg-input', '--bg-hover',
  '--theme-main', '--theme-light', '--theme-dark', '--theme-muted',
  '--theme-gradient-start', '--theme-gradient-end',
  '--text-primary', '--text-secondary', '--text-muted', '--text-heading', '--text-accent',
  '--border-main', '--border-light', '--border-accent',
  '--positive-color', '--negative-color', '--warning-color',
] as const;

export interface AiThemeSpec {
  name: string;
  description: string;
  icon: string;
  fontImport: string;
  fontFamily: string;
  headingFont: string;
  colors: Record<string, string>;
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent)$/;

export const THEME_DESIGNER_SYSTEM = `Bạn là nhà thiết kế giao diện cho thẻ nhân vật SillyTavern.
Người dùng mô tả phong cách họ muốn; bạn trả về BẢNG MÀU + FONT cho giao diện đó.

Bạn CHỈ quyết định phần thẩm mỹ. Khung HTML (Opening Form + thanh trạng thái) do công cụ dựng
sẵn và không đổi — nhiệm vụ của bạn là làm nó ĐẸP và ĐÚNG TÔNG với thế giới của thẻ.

Trả về DUY NHẤT JSON theo đúng khuôn:
{
  "name": "Tên giao diện ngắn (tiếng Việt)",
  "description": "1 câu tả phong cách",
  "icon": "1 emoji",
  "fontImport": "https://fonts.googleapis.com/css2?family=...&display=swap",
  "fontFamily": "'Font chữ thân', serif",
  "headingFont": "'Font tiêu đề', cursive",
  "colors": {
    "--bg-primary": "#...", "--bg-card": "#...", "--bg-section": "rgba(...)",
    "--bg-input": "#...", "--bg-hover": "rgba(...)",
    "--theme-main": "#...", "--theme-light": "#...", "--theme-dark": "#...",
    "--theme-muted": "#...", "--theme-gradient-start": "#...", "--theme-gradient-end": "#...",
    "--text-primary": "#...", "--text-secondary": "#...", "--text-muted": "#...",
    "--text-heading": "#...", "--text-accent": "#...",
    "--border-main": "#...", "--border-light": "#...", "--border-accent": "#...",
    "--positive-color": "#...", "--negative-color": "#...", "--warning-color": "#..."
  }
}

QUY TẮC BẮT BUỘC:
- Mỗi màu là mã hex (#rrggbb) hoặc rgba()/hsla(). KHÔNG dùng tên màu CSS ("red", "blue").
- CHỮ PHẢI ĐỌC ĐƯỢC trên nền: --text-primary tương phản mạnh với --bg-card và --bg-primary.
  Nền tối thì chữ sáng, nền sáng thì chữ tối. Đây là yêu cầu quan trọng nhất.
- --theme-main là màu chủ đạo người dùng yêu cầu; light/dark là biến thể sáng/tối của chính nó.
- --positive-color xanh lá, --negative-color đỏ, --warning-color vàng/cam (giữ quy ước quen thuộc
  để người chơi đọc thanh máu/chỉ số không bị nhầm), nhưng chỉnh sắc độ cho hợp tông chung.
- fontImport phải là URL Google Fonts thật và khớp với các font khai trong fontFamily/headingFont.
- KHÔNG viết HTML, KHÔNG viết CSS, KHÔNG giải thích. Chỉ JSON.`;

export function buildThemeDesignMessages(
  request: string,
  gameName: string,
  current?: AiThemeSpec,
): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'system', content: THEME_DESIGNER_SYSTEM }];
  if (current) {
    // (bugNeedFix/145) "AI thích nghi để hiểu những gì nó vừa tạo" — dựng lại đúng một lượt hội
    // thoại: yêu cầu ban đầu → bản AI đã trả → yêu cầu chỉnh. Nhờ có bảng màu cũ nằm ngay trong
    // lượt của chính nó, AI sửa đúng chỗ bị chê thay vì vẽ lại từ số không.
    // Lượt user phải đứng trước lượt assistant — nhiều API từ chối hội thoại mở đầu bằng assistant.
    msgs.push({ role: 'user', content: `Thẻ: "${gameName}". Hãy thiết kế giao diện cho thẻ này.` });
    msgs.push({ role: 'assistant', content: JSON.stringify(current, null, 1) });
    msgs.push({
      role: 'user',
      content: `Đây là giao diện bạn vừa tạo. Hãy CHỈNH theo yêu cầu sau, GIỮ NGUYÊN những phần không bị nhắc tới:\n${request}`,
    });
  } else {
    msgs.push({
      role: 'user',
      content: `Thẻ: "${gameName}".\nPhong cách giao diện tôi muốn:\n${request}`,
    });
  }
  return msgs;
}

export function parseThemeSpec(raw: string): AiThemeSpec {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON.');
  const p = JSON.parse(m[0]) as Partial<AiThemeSpec> & { colors?: Record<string, string> };
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.colors ?? {})) {
    const key = k.startsWith('--') ? k : `--${k}`;
    if (!(AI_THEME_COLOR_KEYS as readonly string[]).includes(key)) continue;
    const val = String(v).trim();
    if (!COLOR_RE.test(val)) continue;   // giá trị rác thì bỏ, khoá đó kế thừa theme nền
    colors[key] = val;
  }
  if (Object.keys(colors).length < 5) {
    throw new Error('AI trả về quá ít màu hợp lệ — thử mô tả rõ hơn.');
  }
  return {
    name: String(p.name ?? 'Giao diện AI').trim() || 'Giao diện AI',
    description: String(p.description ?? '').trim(),
    icon: String(p.icon ?? '🎨').trim().slice(0, 4) || '🎨',
    fontImport: /^https:\/\/fonts\.googleapis\.com\//.test(String(p.fontImport ?? ''))
      ? String(p.fontImport) : THEME_PRESETS[DEFAULT_THEME_ID].fontImport,
    fontFamily: String(p.fontFamily ?? '').trim() || THEME_PRESETS[DEFAULT_THEME_ID].fontFamily,
    headingFont: String(p.headingFont ?? '').trim() || THEME_PRESETS[DEFAULT_THEME_ID].headingFont,
    colors,
  };
}

/** #rgb / #rrggbb / rgba() → [r,g,b] (0-255). Không đọc được thì null. */
function toRgb(c: string): [number, number, number] | null {
  const s = c.trim();
  let m = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m) return [0, 1, 2].map(i => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = s.match(/^#([0-9a-fA-F]{6})/);
  if (m) return [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

/** Độ tương phản WCAG giữa 2 màu (1 = giống hệt, 21 = đen/trắng). */
export function contrastRatio(a: string, b: string): number {
  const ca = toRgb(a), cb = toRgb(b);
  if (!ca || !cb) return 21;   // không đọc được thì đừng báo động giả
  const lum = (rgb: [number, number, number]) => {
    const [r, g, bl] = rgb.map(v => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(ca), lb = lum(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Cảnh báo chữ chìm vào nền. AI rất hay chọn bảng màu "đẹp ảnh" mà chữ không đọc nổi —
 * thà nói thẳng cho user thấy trước khi họ chốt còn hơn để họ phát hiện lúc đang chơi.
 */
export function checkThemeReadability(spec: AiThemeSpec): string[] {
  const warn: string[] = [];
  const base = THEME_PRESETS[DEFAULT_THEME_ID].cssVars;
  const get = (k: string) => spec.colors[k] ?? base[k];
  const pairs: Array<[string, string, string]> = [
    ['--text-primary', '--bg-card', 'Chữ chính trên nền thẻ'],
    ['--text-primary', '--bg-primary', 'Chữ chính trên nền ngoài'],
    ['--text-heading', '--bg-card', 'Chữ tiêu đề trên nền thẻ'],
  ];
  for (const [fg, bg, label] of pairs) {
    const r = contrastRatio(get(fg), get(bg));
    if (r < 4.5) warn.push(`${label}: tương phản ${r.toFixed(1)}:1 — dưới mức đọc thoải mái (4.5:1), chữ sẽ bị chìm.`);
  }
  return warn;
}

/** Ghép spec của AI lên theme nền → ThemePreset đầy đủ để buildProgrammaticRegex dùng. */
export function specToThemePreset(spec: AiThemeSpec, baseId = DEFAULT_THEME_ID): ThemePreset {
  const base = THEME_PRESETS[baseId] ?? THEME_PRESETS[DEFAULT_THEME_ID];
  return {
    id: AI_THEME_ID,
    name: spec.name,
    description: spec.description,
    icon: spec.icon,
    fontImport: spec.fontImport,
    fontFamily: spec.fontFamily,
    headingFont: spec.headingFont,
    // Kế thừa TOÀN BỘ biến của theme nền (khoảng cách, bo góc, cỡ chữ, hiệu ứng…) rồi mới đè
    // màu của AI lên — nhờ vậy AI chỉ cần lo màu, không thể làm vỡ bố cục.
    cssVars: { ...base.cssVars, ...spec.colors },
  };
}

/** Cắm theme AI vào bảng THEME_PRESETS để mọi đường dựng sẵn (preview, pipeline) dùng được. */
export function registerAiTheme(spec: AiThemeSpec, baseId = DEFAULT_THEME_ID): ThemePreset {
  const preset = specToThemePreset(spec, baseId);
  THEME_PRESETS[AI_THEME_ID] = preset;
  return preset;
}
