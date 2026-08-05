/**
 * src/i18n/index.ts — Ngôn ngữ giao diện (VI / EN / 中文).
 * ──────────────────────────────────────────────────────────────────────────────
 * Đổi ngôn ngữ = ghi localStorage rồi RELOAD trang. Nhờ vậy chỉ cần nạp ĐÚNG 1 bộ chuỗi
 * (dynamic import → Vite tách chunk riêng cho từng ngôn ngữ) ⇒ app nhẹ, không phải giữ
 * 3 cây ngôn ngữ trong bộ nhớ, không cần re-render toàn app khi đổi.
 *
 * ⚠️ HAI BỘ TỪ ĐIỂN, HAI CÁCH TRA — cố ý:
 *   1. `locales/*`  (bộ CŨ, ~293 key)  → tra theo `resolveLocale(uiLang)`.
 *   2. `ui/*`       (bộ MỚI, chuỗi vốn hardcode) → tra theo `uiLang` TRỰC TIẾP.
 * Xem giải thích ở `resolveLocale`.
 */
import type { TranslationKeys } from './locales/en';
import type { UiKeys } from './ui/en';

/** Ngôn ngữ user chọn (thứ hiện trên nút). */
export type UiLang = 'vi' | 'en' | 'zh';
/** Locale nội bộ của bộ từ điển CŨ (`locales/*`) + 237 nhánh `isVi` trong code. */
export type Locale = 'en' | 'vi' | 'zh';

const LS_KEY = 'st-ui-lang';
const DEFAULT_LANG: UiLang = 'vi';

export const UI_LANGS: { id: UiLang; short: string; title: string }[] = [
  { id: 'vi', short: 'VI', title: 'Tiếng Việt' },
  { id: 'en', short: 'EN', title: 'English' },
  { id: 'zh', short: '中文', title: '简体中文' },
];

const isUiLang = (v: unknown): v is UiLang => v === 'vi' || v === 'en' || v === 'zh';

/** Ngôn ngữ hiện tại (ưu tiên ?lang= trên URL, rồi localStorage, mặc định Tiếng Việt). */
export function getUiLang(): UiLang {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isUiLang(fromUrl)) return fromUrl;
  } catch { /* SSR / test: bỏ qua */ }
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (isUiLang(saved)) return saved;
  } catch { /* localStorage bị chặn: bỏ qua */ }
  return DEFAULT_LANG;
}

/**
 * Đổi ngôn ngữ: lưu rồi RELOAD (theo đúng yêu cầu — nạp lại trang cho nhẹ app).
 *
 * (bug 213) Nhưng reload GIỮA LÚC ĐANG DỊCH là mất cả lượt chạy: vòng dịch sống trong bộ nhớ tab,
 * reload là nó chết ngang, các call đang bay thành công cốc. Ba nút VI/EN/中文 lại nằm ngay cạnh
 * nhau trên header nên bấm nhầm rất dễ. Giờ hỏi lại một câu trước khi nạp lại.
 */
export function setUiLang(lang: UiLang): void {
  try {
    const phase = (window as unknown as { __stPhase?: string }).__stPhase;
    if (phase === 'translating') {
      const msg = lang === 'vi'
        ? 'Đang dịch dở. Đổi ngôn ngữ sẽ NẠP LẠI TRANG và lượt dịch đang chạy sẽ dừng (phần đã xong vẫn được lưu). Vẫn đổi?'
        : lang === 'zh'
          ? '正在翻译中。切换语言会重新加载页面并中断当前翻译（已完成的部分仍会保存）。确定切换？'
          : 'A translation is running. Switching language reloads the page and stops it (finished fields are still saved). Switch anyway?';
      if (!window.confirm(msg)) return;
    }
  } catch { /* không có window (test/SSR) → cứ đổi như thường */ }
  try { localStorage.setItem(LS_KEY, lang); } catch { /* ignore */ }
  try { window.location.reload(); } catch { /* ignore */ }
}

/**
 * uiLang → locale cho bộ từ điển CŨ (`locales/*`).
 *
 * (User 2026-07) TRƯỚC ĐÂY map `vi → 'en'` cố ý (user cũ quen bộ mặt tiếng Anh) — nhưng nay user
 * phản ánh "đã chọn tiếng Việt mà giao diện còn nhiều chỗ tiếng Anh". Đó chính là do bộ CŨ (~293
 * key: Field Editor, cột Bản gốc/Bản dịch, Kiểm Tra Field…) bị ép về tiếng Anh. `locales/vi.ts` đã
 * có SẴN đủ 293 key tiếng Việt nhưng bị bỏ qua. Nay trả về đúng ngôn ngữ đang chọn → VI dùng vi.ts.
 */
export const resolveLocale = (ui: UiLang): Locale => ui;

// Mỗi loader = 1 chunk riêng do Vite tách; chỉ chunk của ngôn ngữ đang dùng được tải về.
const legacyLoaders: Record<Locale, () => Promise<{ default: TranslationKeys }>> = {
  en: () => import('./locales/en'),
  vi: () => import('./locales/vi'),
  zh: () => import('./locales/zh'),
};
const uiLoaders: Record<UiLang, () => Promise<{ default: UiKeys }>> = {
  vi: () => import('./ui/vi'),
  en: () => import('./ui/en'),
  zh: () => import('./ui/zh'),
};

let _t: TranslationKeys | null = null;
let _ui: UiKeys | null = null;

/** Nạp bộ chuỗi cho ngôn ngữ đang chọn. PHẢI await xong TRƯỚC khi render (xem main.tsx). */
export async function loadI18n(lang: UiLang): Promise<void> {
  const [legacy, uiMod] = await Promise.all([
    legacyLoaders[resolveLocale(lang)](),
    uiLoaders[lang](),
  ]);
  _t = legacy.default;
  _ui = uiMod.default;
}

export function getT(): TranslationKeys {
  if (!_t) throw new Error('[i18n] Chưa nạp: phải gọi loadI18n() trước khi render.');
  return _t;
}
export function getUi(): UiKeys {
  if (!_ui) throw new Error('[i18n] Chưa nạp: phải gọi loadI18n() trước khi render.');
  return _ui;
}

/** Thay {key} trong chuỗi bằng giá trị. VD: fmt(ui.acRunning, { count: 3 }). */
export function fmt(tpl: string, vars: Record<string, string | number>): string {
  // split/join thay cho replaceAll: tsconfig gốc target < ES2021.
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), tpl);
}

export type { TranslationKeys, UiKeys };
