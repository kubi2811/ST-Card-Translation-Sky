// ─── Tool flows for the Hub switcher ───
// The translate tool is the HOST app (kind: 'native' — rendered in-process, never unmounted
// so a running translation keeps going when you switch away). Other tools are embedded as
// iframes (kind: 'iframe') that also stay mounted when hidden, so their state/progress is
// preserved across switches. Add more flows here later (e.g. a card-mod tool) — one entry each.
import type { UiKeys } from './i18n/ui/en';

export type FlowKind = 'native' | 'iframe';

export interface FlowDef {
  id: string;
  /** Short label under the rail icon (tiếng Việt — dùng làm fallback) */
  label: string;
  /** Key trong bộ `ui` để dịch nhãn theo ngôn ngữ giao diện */
  labelKey: keyof UiKeys;
  /** Emoji shown as the rail icon (keeps the rail dependency-free) */
  emoji: string;
  kind: FlowKind;
  /** For iframe flows: the dev-server URL of that tool. Overridable via env. */
  url?: string;
  /** Accent color for the active state */
  color?: string;
  /**
   * Id trong TOOL_SERVERS (src/hub/toolCatalog.ts) nếu tab này có dev server riêng cần
   * lazy-start. Không có (novalcard tĩnh, flow native) → tab luôn sẵn sàng, không chấm trạng thái.
   */
  serverToolId?: string;
}

export const FLOWS: FlowDef[] = [
  {
    id: 'translate',
    label: 'Dịch Card',
    labelKey: 'railTranslate',
    emoji: '🌐',
    kind: 'native',
    color: 'var(--accent-primary)',
  },
  {
    id: 'card-creator',
    serverToolId: 'card-creator',
    label: 'Tạo Card',
    labelKey: 'railCardCreator',
    emoji: '🃏',
    kind: 'iframe',
    // Card-creator (tao-card) runs on its own fixed vite port. Override with VITE_CARD_TOOL_URL.
    url: (import.meta as any).env?.VITE_CARD_TOOL_URL || 'http://localhost:5174',
    color: '#f59e0b',
  },
  {
    id: 'preset',
    serverToolId: 'preset',
    label: 'Tạo Preset',
    labelKey: 'railPreset',
    emoji: '🎛️',
    kind: 'iframe',
    // preset-tool (Vite) on fixed port 5175.
    url: (import.meta as any).env?.VITE_PRESET_TOOL_URL || 'http://localhost:5175',
    color: '#22c55e',
  },
  {
    id: 'mod-card',
    serverToolId: 'mod-card',
    label: 'Mod Card',
    labelKey: 'railModCard',
    emoji: '🛠️',
    kind: 'iframe',
    // mod-card (Next.js) on fixed port 5176.
    url: (import.meta as any).env?.VITE_MODCARD_TOOL_URL || 'http://localhost:5176',
    color: '#a855f7',
  },
  {
    id: 'crawler',
    serverToolId: 'crawler',
    label: 'Web Crawler',
    labelKey: 'railCrawler',
    emoji: '🧭',
    kind: 'iframe',
    // crawler (Next.js) on fixed port 5177.
    url: (import.meta as any).env?.VITE_CRAWLER_TOOL_URL || 'http://localhost:5177',
    color: '#6366f1',
  },
  {
    id: 'novalcard',
    label: 'Trích Card',
    labelKey: 'railExtract',
    emoji: '🔍',
    kind: 'iframe',
    // NovalCard — công cụ trích xuất thẻ (1 file HTML tĩnh tự chứa). Không cần dev-server
    // riêng: hub tự serve từ public/apps → cùng origin, load tức thì, không thêm port/start.bat.
    url: '/apps/novalcard-vi.html',
    color: '#c8a86b',
  },
];
