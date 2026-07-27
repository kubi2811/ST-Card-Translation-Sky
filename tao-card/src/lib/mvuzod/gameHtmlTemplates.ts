/**
 * src/lib/mvuzod/gameHtmlTemplates.ts — HTML Template Fragments + Theme Presets
 * ──────────────────────────────────────────────────────────────────────────────
 * Building blocks cho ProgrammaticRegexBuilder và OrchestratedGenerator.
 *
 * Patterns extracted từ 4 reference files:
 * - regex-khởi_đầu.json (924KB opening wizard)
 * - regex-làm_đẹp_thanh_trạng_thái.json (64KB status dashboard)
 * - bảng_khởi_đầu_Ai_Cập.html (730KB Egypt opening)
 * - bảng_mvuzod_Ai_Cập.html (60KB Egypt dashboard)
 */
import { MVU_RUNTIME_HELPERS } from './mvuRuntime';

// ═══════════════════════════════════════════════════════════════════════════
// THEME PRESET TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Google Fonts @import URL */
  fontImport: string;
  /** Primary font-family */
  fontFamily: string;
  /** Display/heading font-family */
  headingFont: string;
  /** CSS variables block (inside :root or wrapper selector) */
  cssVars: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 THEME PRESETS
// ═══════════════════════════════════════════════════════════════════════════

/** Three Kingdoms — dark scholarly (from regex-khởi_đầu.json, regex-làm_đẹp_thanh_trạng_thái.json) */
const THREE_KINGDOMS: ThemePreset = {
  id: 'three_kingdoms',
  name: 'Three Kingdoms',
  description: 'Dark scholarly Chinese memorial style',
  icon: '🗡️',
  fontImport: "https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;700&display=swap",
  fontFamily: "'Noto Serif SC', 'Georgia', serif",
  headingFont: "'Ma Shan Zheng', cursive",
  cssVars: {
    '--bg-primary': '#181a1b',
    '--bg-card': '#222526',
    '--bg-section': 'rgba(255, 255, 255, 0.04)',
    '--bg-input': '#2a2d2e',
    '--bg-hover': 'rgba(154, 186, 180, 0.1)',

    '--theme-main': '#6b8e88',
    '--theme-light': '#9abab4',
    '--theme-dark': '#4a6b65',
    '--theme-muted': '#546e6a',
    '--theme-gradient-start': '#6b8e88',
    '--theme-gradient-end': '#9abab4',

    '--text-primary': '#d6d9d4',
    '--text-secondary': '#a0a5a0',
    '--text-muted': '#6b7070',
    '--text-heading': '#c8cec8',
    '--text-accent': '#9abab4',

    '--border-main': '#3a3f40',
    '--border-light': '#4a4f50',
    '--border-accent': '#6b8e88',

    '--positive-color': '#4caf50',
    '--negative-color': '#ef5350',
    '--warning-color': '#ff9800',
    '--info-color': '#42a5f5',

    '--bar-bg': '#2a3a38',
    '--bar-hp': 'linear-gradient(90deg, #c62828, #ef5350)',
    '--bar-mp': 'linear-gradient(90deg, #1565c0, #42a5f5)',
    '--bar-exp': 'linear-gradient(90deg, #f57f17, #fdd835)',
    '--bar-default': 'linear-gradient(90deg, var(--theme-dark), var(--theme-light))',

    '--shadow-sm': '0 1px 3px rgba(0,0,0,0.3)',
    '--shadow-md': '0 4px 12px rgba(0,0,0,0.4)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.5)',

    '--radius-sm': '4px',
    '--radius-md': '6px',
    '--radius-lg': '8px',

    '--fs-xs': 'clamp(10px, 2vw, 11px)',
    '--fs-sm': 'clamp(11px, 2.2vw, 12px)',
    '--fs-base': 'clamp(12px, 2.5vw, 14px)',
    '--fs-md': 'clamp(13px, 2.8vw, 15px)',
    '--fs-lg': 'clamp(15px, 3.2vw, 18px)',
    '--fs-xl': 'clamp(18px, 4vw, 22px)',
    '--fs-2xl': 'clamp(22px, 5vw, 28px)',

    '--transition-fast': '0.15s ease',
    '--transition-base': '0.3s ease',
    '--transition-slow': '0.5s ease-in-out',
  },
};

/** Ancient Egypt — warm papyrus (from bảng_khởi_đầu_Ai_Cập.html, bảng_mvuzod_Ai_Cập.html) */
const ANCIENT_EGYPT: ThemePreset = {
  id: 'ancient_egypt',
  name: 'Ancient Egypt',
  description: 'Warm papyrus & gold hieroglyphic style',
  icon: '🏛️',
  fontImport: "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Noto+Serif:wght@400;700&display=swap",
  fontFamily: "'Noto Serif', 'Georgia', serif",
  headingFont: "'Cinzel', serif",
  cssVars: {
    '--bg-primary': '#f0e6d2',
    '--bg-card': '#fdf5e6',
    '--bg-section': 'rgba(139, 90, 43, 0.05)',
    '--bg-input': '#f5edd8',
    '--bg-hover': 'rgba(212, 175, 55, 0.1)',

    '--theme-main': '#195190',
    '--theme-light': '#2979ff',
    '--theme-dark': '#0d3b6e',
    '--theme-muted': '#5c7a99',
    '--theme-gradient-start': '#195190',
    '--theme-gradient-end': '#2979ff',

    '--text-primary': '#2b1810',
    '--text-secondary': '#5d4037',
    '--text-muted': '#8d6e63',
    '--text-heading': '#1a0f09',
    '--text-accent': '#d4af37',

    '--border-main': '#c9b896',
    '--border-light': '#d7c9a5',
    '--border-accent': '#d4af37',

    '--positive-color': '#2e7d32',
    '--negative-color': '#c62828',
    '--warning-color': '#e65100',
    '--info-color': '#0277bd',

    '--bar-bg': '#e8dcc8',
    '--bar-hp': 'linear-gradient(90deg, #b71c1c, #e53935)',
    '--bar-mp': 'linear-gradient(90deg, #0d47a1, #1976d2)',
    '--bar-exp': 'linear-gradient(90deg, #bf8f00, #d4af37)',
    '--bar-default': 'linear-gradient(90deg, var(--theme-dark), var(--theme-light))',

    '--shadow-sm': '0 1px 3px rgba(43,24,16,0.15)',
    '--shadow-md': '0 4px 12px rgba(43,24,16,0.2)',
    '--shadow-lg': '0 8px 24px rgba(43,24,16,0.25)',

    '--radius-sm': '4px',
    '--radius-md': '6px',
    '--radius-lg': '8px',

    '--fs-xs': 'clamp(10px, 2vw, 11px)',
    '--fs-sm': 'clamp(11px, 2.2vw, 12px)',
    '--fs-base': 'clamp(12px, 2.5vw, 14px)',
    '--fs-md': 'clamp(13px, 2.8vw, 15px)',
    '--fs-lg': 'clamp(15px, 3.2vw, 18px)',
    '--fs-xl': 'clamp(18px, 4vw, 22px)',
    '--fs-2xl': 'clamp(22px, 5vw, 28px)',

    '--transition-fast': '0.15s ease',
    '--transition-base': '0.3s ease',
    '--transition-slow': '0.5s ease-in-out',
  },
};

/** Fantasy Medieval — deep blue & purple magic */
const FANTASY_MEDIEVAL: ThemePreset = {
  id: 'fantasy_medieval',
  name: 'Fantasy Medieval',
  description: 'Deep blue mystic with purple accents',
  icon: '🧙',
  fontImport: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Inter:wght@400;500;600&display=swap",
  fontFamily: "'Inter', system-ui, sans-serif",
  headingFont: "'Cormorant Garamond', serif",
  cssVars: {
    '--bg-primary': '#0f172a',
    '--bg-card': '#1e293b',
    '--bg-section': 'rgba(129, 140, 248, 0.05)',
    '--bg-input': '#1e293b',
    '--bg-hover': 'rgba(129, 140, 248, 0.1)',

    '--theme-main': '#818cf8',
    '--theme-light': '#a5b4fc',
    '--theme-dark': '#6366f1',
    '--theme-muted': '#64748b',
    '--theme-gradient-start': '#6366f1',
    '--theme-gradient-end': '#c084fc',

    '--text-primary': '#e2e8f0',
    '--text-secondary': '#94a3b8',
    '--text-muted': '#64748b',
    '--text-heading': '#f1f5f9',
    '--text-accent': '#c084fc',

    '--border-main': '#334155',
    '--border-light': '#475569',
    '--border-accent': '#818cf8',

    '--positive-color': '#34d399',
    '--negative-color': '#fb7185',
    '--warning-color': '#fbbf24',
    '--info-color': '#60a5fa',

    '--bar-bg': '#1e293b',
    '--bar-hp': 'linear-gradient(90deg, #dc2626, #f87171)',
    '--bar-mp': 'linear-gradient(90deg, #6366f1, #a5b4fc)',
    '--bar-exp': 'linear-gradient(90deg, #d97706, #fbbf24)',
    '--bar-default': 'linear-gradient(90deg, var(--theme-dark), var(--theme-light))',

    '--shadow-sm': '0 1px 3px rgba(0,0,0,0.4)',
    '--shadow-md': '0 4px 12px rgba(0,0,0,0.5)',
    '--shadow-lg': '0 8px 24px rgba(99,102,241,0.15)',

    '--radius-sm': '6px',
    '--radius-md': '8px',
    '--radius-lg': '12px',

    '--fs-xs': 'clamp(10px, 2vw, 11px)',
    '--fs-sm': 'clamp(11px, 2.2vw, 12px)',
    '--fs-base': 'clamp(12px, 2.5vw, 14px)',
    '--fs-md': 'clamp(13px, 2.8vw, 15px)',
    '--fs-lg': 'clamp(15px, 3.2vw, 18px)',
    '--fs-xl': 'clamp(18px, 4vw, 22px)',
    '--fs-2xl': 'clamp(22px, 5vw, 28px)',

    '--transition-fast': '0.15s ease',
    '--transition-base': '0.3s ease',
    '--transition-slow': '0.5s ease-in-out',
  },
};

/** Sci-fi Cyberpunk — neon dark */
const SCIFI_CYBERPUNK: ThemePreset = {
  id: 'scifi_cyberpunk',
  name: 'Sci-fi Cyberpunk',
  description: 'Neon dark cyberpunk terminal style',
  icon: '🤖',
  fontImport: "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Rajdhani:wght@400;500;600;700&display=swap",
  fontFamily: "'Rajdhani', system-ui, sans-serif",
  headingFont: "'Orbitron', monospace",
  cssVars: {
    '--bg-primary': '#0a0a0f',
    '--bg-card': '#111118',
    '--bg-section': 'rgba(0, 245, 212, 0.03)',
    '--bg-input': '#14141c',
    '--bg-hover': 'rgba(0, 245, 212, 0.08)',

    '--theme-main': '#00f5d4',
    '--theme-light': '#72efdd',
    '--theme-dark': '#00b4a0',
    '--theme-muted': '#4a5568',
    '--theme-gradient-start': '#00f5d4',
    '--theme-gradient-end': '#f72585',

    '--text-primary': '#e0e0e0',
    '--text-secondary': '#9e9e9e',
    '--text-muted': '#616161',
    '--text-heading': '#f5f5f5',
    '--text-accent': '#00f5d4',

    '--border-main': '#1a1a24',
    '--border-light': '#2a2a38',
    '--border-accent': '#00f5d4',

    '--positive-color': '#00e676',
    '--negative-color': '#f72585',
    '--warning-color': '#ffca28',
    '--info-color': '#29b6f6',

    '--bar-bg': '#14141c',
    '--bar-hp': 'linear-gradient(90deg, #f72585, #ff6b9d)',
    '--bar-mp': 'linear-gradient(90deg, #3a0ca3, #7209b7)',
    '--bar-exp': 'linear-gradient(90deg, #00b4a0, #00f5d4)',
    '--bar-default': 'linear-gradient(90deg, var(--theme-dark), var(--theme-light))',

    '--shadow-sm': '0 0 4px rgba(0,245,212,0.15)',
    '--shadow-md': '0 0 12px rgba(0,245,212,0.2)',
    '--shadow-lg': '0 0 24px rgba(0,245,212,0.25)',

    '--radius-sm': '2px',
    '--radius-md': '4px',
    '--radius-lg': '6px',

    '--fs-xs': 'clamp(10px, 2vw, 11px)',
    '--fs-sm': 'clamp(11px, 2.2vw, 12px)',
    '--fs-base': 'clamp(12px, 2.5vw, 14px)',
    '--fs-md': 'clamp(13px, 2.8vw, 15px)',
    '--fs-lg': 'clamp(15px, 3.2vw, 18px)',
    '--fs-xl': 'clamp(18px, 4vw, 22px)',
    '--fs-2xl': 'clamp(22px, 5vw, 28px)',

    '--transition-fast': '0.1s ease',
    '--transition-base': '0.2s ease',
    '--transition-slow': '0.4s ease-in-out',
  },
};

/** All theme presets keyed by ID */
export const THEME_PRESETS: Record<string, ThemePreset> = {
  three_kingdoms: THREE_KINGDOMS,
  ancient_egypt: ANCIENT_EGYPT,
  fantasy_medieval: FANTASY_MEDIEVAL,
  scifi_cyberpunk: SCIFI_CYBERPUNK,
};

export const DEFAULT_THEME_ID = 'three_kingdoms';

// ═══════════════════════════════════════════════════════════════════════════
// CSS GENERATION — Base styles + Component classes
// ═══════════════════════════════════════════════════════════════════════════

/** Generate CSS variables block from a theme preset */
export function generateCSSVars(theme: ThemePreset): string {
  return Object.entries(theme.cssVars)
    .map(([k, v]) => `    ${k}: ${v};`)
    .join('\n');
}

/**
 * Generate full <style> content for Status Bar component.
 * Pattern sourced from regex-làm_đẹp_thanh_trạng_thái.json
 */
export function generateStatusBarCSS(theme: ThemePreset): string {
  return `@import url('${theme.fontImport}');

#stcs-app {
${generateCSSVars(theme)}
}

#stcs-app {
    margin: 0;
    padding: 0;
    font-family: ${theme.fontFamily};
    background-color: transparent;
    color: var(--text-primary);
    font-size: var(--fs-base);
    user-select: none;
    overflow-x: hidden;
    box-sizing: border-box;
    line-height: 1.7;
}

#stcs-app * { box-sizing: border-box; }

/* ── Main Container ── */
.stcs-container {
    width: 100%;
    margin: 0;
    padding: 0 clamp(8px, 2vw, 12px) clamp(8px, 2vw, 12px);
    background-color: var(--bg-primary);
    border: 1px solid var(--border-main);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    position: relative;
    overflow: hidden;
}

/* ── Header ── */
.stcs-header {
    background: linear-gradient(135deg, var(--theme-gradient-start), var(--theme-gradient-end));
    color: #fff;
    padding: clamp(12px, 3vw, 18px);
    text-align: center;
    border-bottom: 2px solid var(--border-accent);
    margin: 0 clamp(-8px, -2vw, -12px);
    position: relative;
}

.stcs-header-title {
    font-family: ${theme.headingFont};
    font-size: var(--fs-2xl);
    letter-spacing: 3px;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.4);
}

.stcs-header-subtitle {
    font-size: var(--fs-sm);
    opacity: 0.85;
    margin-top: 6px;
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
}

/* ── Panel / Section (Accordion) ── */
.stcs-panel {
    margin-top: clamp(8px, 2vw, 12px);
    border: 1px solid var(--border-main);
    background: var(--bg-section);
    border-radius: var(--radius-md);
    overflow: hidden;
}

.stcs-panel-header {
    background: linear-gradient(to right, var(--theme-gradient-start), var(--theme-gradient-end));
    color: #fff;
    padding: clamp(8px, 2vw, 10px) clamp(10px, 2.5vw, 14px);
    font-weight: bold;
    font-size: var(--fs-md);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: filter var(--transition-fast);
}

.stcs-panel-header:hover {
    filter: brightness(1.1);
}

.stcs-panel-header::after {
    content: '▼';
    font-size: var(--fs-xs);
    transition: transform var(--transition-base);
}

.stcs-panel-header.collapsed::after {
    transform: rotate(-90deg);
}

.stcs-panel-content {
    padding: clamp(10px, 2.5vw, 14px);
    display: block;
}

.stcs-panel-content.hidden {
    display: none;
}

/* ── Data Grid ── */
.stcs-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(8px, 2vw, 12px);
}

.stcs-grid-3 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: clamp(8px, 2vw, 12px);
}

/* ── Data Item / Card ── */
.stcs-data-item {
    display: flex;
    flex-direction: column;
    border-bottom: 1px dashed var(--border-main);
    padding-bottom: 6px;
}

.stcs-data-item.no-border {
    border-bottom: none;
    padding-bottom: 0;
}

.stcs-data-label {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    font-weight: normal;
}

.stcs-data-value {
    font-size: var(--fs-base);
    font-weight: bold;
    color: var(--text-primary);
}

/* ── Progress Bar ── */
.stcs-bar-container {
    width: 100%;
    height: 8px;
    background-color: var(--bar-bg);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 4px;
}

.stcs-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width var(--transition-slow);
    min-width: 2px;
}

.stcs-bar-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
}

.stcs-bar-label {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
}

.stcs-bar-value {
    font-size: var(--fs-sm);
    font-weight: bold;
    color: var(--text-accent);
}

/* ── Scrollable List ── */
.stcs-scroll-list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 180px;
    overflow-y: auto;
}

.stcs-scroll-list::-webkit-scrollbar { width: 4px; }
.stcs-scroll-list::-webkit-scrollbar-thumb {
    background: var(--theme-main);
    border-radius: 2px;
}

.stcs-list-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px dotted var(--border-main);
    font-size: var(--fs-base);
    align-items: center;
    font-weight: bold;
}

.stcs-list-item:last-child { border-bottom: none; }

.stcs-list-item.interactive {
    cursor: pointer;
    transition: background-color var(--transition-fast);
    padding: 6px 4px;
    border-radius: var(--radius-sm);
}

.stcs-list-item.interactive:hover {
    background-color: var(--bg-hover);
}

/* ── Tags / Badges ── */
.stcs-tag {
    font-size: var(--fs-xs);
    padding: 2px 8px;
    background: var(--bg-section);
    color: var(--text-accent);
    border: 1px solid var(--theme-main);
    border-radius: 12px;
    display: inline-block;
    font-weight: bold;
    cursor: pointer;
    transition: background-color var(--transition-fast);
    margin: 2px;
}

.stcs-tag:hover {
    background: var(--bg-hover);
}

/* ── Narrative / Text Box ── */
.stcs-narrative {
    font-size: var(--fs-base);
    line-height: 1.7;
    text-align: justify;
    padding: clamp(8px, 2vw, 12px);
    background: var(--bg-section);
    border: 1px dashed var(--border-main);
    border-radius: var(--radius-sm);
    margin-top: 8px;
}

.stcs-narrative-title {
    font-weight: bold;
    margin-bottom: 4px;
    color: var(--text-accent);
}

/* ── Divider ── */
.stcs-divider {
    height: 1px;
    background: var(--border-main);
    margin: 12px 0;
}

/* ── Modal ── */
.stcs-modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    display: none;
    justify-content: center;
    align-items: center;
    z-index: 9999;
}

.stcs-modal-content {
    background: var(--bg-card);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-lg);
    padding: clamp(14px, 3vw, 20px);
    width: 90%;
    max-width: 400px;
    position: relative;
    box-shadow: var(--shadow-lg);
    max-height: 90vh;
    overflow-y: auto;
}

.stcs-modal-content::-webkit-scrollbar { width: 4px; }
.stcs-modal-content::-webkit-scrollbar-thumb {
    background: var(--theme-main);
    border-radius: 2px;
}

.stcs-modal-close {
    position: absolute;
    top: 8px; right: 12px;
    font-size: 18px;
    font-weight: bold;
    color: var(--text-muted);
    cursor: pointer;
    z-index: 10;
    transition: color var(--transition-fast);
}
.stcs-modal-close:hover { color: var(--negative-color); }

.stcs-modal-title {
    font-size: var(--fs-lg);
    font-weight: bold;
    color: var(--text-accent);
    border-bottom: 1px solid var(--border-main);
    padding-bottom: 6px;
    margin-bottom: 10px;
    padding-right: 24px;
}

.stcs-modal-body {
    font-size: var(--fs-base);
    line-height: 1.7;
}

.stcs-attr-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
}

.stcs-attr-row .val {
    font-weight: bold;
    color: var(--theme-main);
}

/* ── Status Colors ── */
.stcs-positive { color: var(--positive-color); }
.stcs-negative { color: var(--negative-color); }
.stcs-warning { color: var(--warning-color); }
.stcs-info { color: var(--info-color); }

/* ── Animation ── */
@keyframes stcs-fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
}

.stcs-panel { animation: stcs-fadeIn 0.3s ease forwards; }
`;
}

/**
 * Generate full <style> content for Opening Form wizard.
 * Pattern sourced from regex-khởi_đầu.json
 */
export function generateOpeningFormCSS(theme: ThemePreset): string {
  return `@import url('${theme.fontImport}');

#stcs-app {
${generateCSSVars(theme)}
}

#stcs-app {
    margin: 0;
    padding: 0;
    font-family: ${theme.fontFamily};
    background-color: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--fs-base);
    user-select: none;
    overflow-x: hidden;
    box-sizing: border-box;
    line-height: 1.7;
    min-height: 80vh;
}

#stcs-app * { box-sizing: border-box; }

/* ── Wizard Container ── */
.stcs-wizard {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: clamp(16px, 4vw, 24px);
    position: relative;
}

/* ── Page System ── */
.stcs-page {
    display: none;
    animation: stcs-pageIn 0.4s ease forwards;
}

.stcs-page.active {
    display: block;
}

@keyframes stcs-pageIn {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
}

/* ── Page Header ── */
.stcs-page-title {
    font-family: ${theme.headingFont};
    font-size: var(--fs-xl);
    color: var(--text-heading);
    text-align: center;
    margin-bottom: 8px;
    letter-spacing: 2px;
}

.stcs-page-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    text-align: center;
    margin-bottom: clamp(16px, 4vw, 24px);
}

/* ── Card Grid (Selection) ── */
.stcs-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: clamp(8px, 2vw, 12px);
}

.stcs-card {
    background: var(--bg-card);
    border: 1px solid var(--border-main);
    border-radius: var(--radius-md);
    padding: clamp(12px, 3vw, 16px);
    cursor: pointer;
    transition: all var(--transition-base);
    position: relative;
}

.stcs-card:hover {
    border-color: var(--theme-main);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
}

.stcs-card.selected {
    border-color: var(--theme-main);
    background: var(--bg-hover);
    box-shadow: 0 0 0 2px var(--theme-main), var(--shadow-md);
}

.stcs-card.selected::after {
    content: '✓';
    position: absolute;
    top: 8px;
    right: 10px;
    color: var(--theme-main);
    font-weight: bold;
    font-size: var(--fs-lg);
}

.stcs-card-title {
    font-size: var(--fs-md);
    font-weight: bold;
    color: var(--text-heading);
    margin-bottom: 4px;
}

.stcs-card-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.5;
}

/* ── Input Field ── */
.stcs-input-group {
    margin-bottom: clamp(12px, 3vw, 16px);
}

.stcs-input-label {
    display: block;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin-bottom: 4px;
    font-weight: 500;
}

.stcs-input {
    width: 100%;
    padding: clamp(8px, 2vw, 12px) clamp(12px, 3vw, 16px);
    font-size: var(--fs-md);
    font-family: inherit;
    background: var(--bg-input);
    border: 1px solid var(--border-main);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.stcs-input:focus {
    border-color: var(--theme-main);
    box-shadow: 0 0 0 2px rgba(var(--theme-main), 0.2);
}

/* ── Slider ── */
.stcs-slider-group {
    margin-bottom: clamp(12px, 3vw, 16px);
}

.stcs-slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
}

.stcs-slider-label {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
}

.stcs-slider-value {
    font-size: var(--fs-md);
    font-weight: bold;
    color: var(--text-accent);
    min-width: 40px;
    text-align: right;
}

.stcs-slider {
    width: 100%;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    background: var(--bar-bg);
    border-radius: 3px;
    outline: none;
}

.stcs-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--theme-main);
    cursor: pointer;
    transition: transform var(--transition-fast);
}

.stcs-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
}

/* ── Button Row ── */
.stcs-btn-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: clamp(20px, 5vw, 32px);
}

.stcs-btn {
    padding: clamp(8px, 2vw, 12px) clamp(20px, 5vw, 32px);
    font-size: var(--fs-md);
    font-family: inherit;
    font-weight: bold;
    letter-spacing: 0.15em;
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-base);
    background: transparent;
    color: var(--text-primary);
}

.stcs-btn:hover {
    background: var(--bg-hover);
    box-shadow: var(--shadow-sm);
}

.stcs-btn-primary {
    background: linear-gradient(135deg, var(--theme-gradient-start), var(--theme-gradient-end));
    color: #fff;
    border-color: transparent;
}

.stcs-btn-primary:hover {
    filter: brightness(1.1);
    box-shadow: var(--shadow-md);
}

/* ── Step Indicator ── */
.stcs-steps {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-bottom: clamp(16px, 4vw, 24px);
}

.stcs-step-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border-main);
    transition: all var(--transition-base);
}

.stcs-step-dot.active {
    background: var(--theme-main);
    box-shadow: 0 0 6px var(--theme-main);
    transform: scale(1.2);
}

.stcs-step-dot.done {
    background: var(--positive-color);
}

/* ── Summary Table ── */
.stcs-summary-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-base);
}

.stcs-summary-table td {
    padding: 6px 10px;
    border-bottom: 1px dashed var(--border-main);
}

.stcs-summary-table td:first-child {
    color: var(--text-secondary);
    font-weight: normal;
    width: 40%;
}

.stcs-summary-table td:last-child {
    color: var(--text-primary);
    font-weight: bold;
}
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HTML FRAGMENT BUILDERS — For ProgrammaticRegexBuilder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-assign emoji icon for a field based on label keywords
 */
export function guessFieldIcon(label: string): string {
  const lower = label.toLowerCase();
  // HP/health
  if (/\b(hp|health|máu|sức khỏe|sinh mệnh|生命)\b/i.test(lower)) return '❤️';
  if (/\b(mp|mana|nội lực|魔力|法力)\b/i.test(lower)) return '💎';
  if (/\b(exp|kinh nghiệm|经验)\b/i.test(lower)) return '⭐';
  if (/\b(atk|attack|công|攻击)\b/i.test(lower)) return '⚔️';
  if (/\b(def|defense|phòng|防御)\b/i.test(lower)) return '🛡️';
  if (/\b(spd|speed|tốc|速度)\b/i.test(lower)) return '💨';
  if (/\b(lv|level|cấp|等级)\b/i.test(lower)) return '📊';
  if (/\b(gold|vàng|bạc|tiền|金|银|钱)\b/i.test(lower)) return '💰';
  if (/\b(food|thực|粮|食)\b/i.test(lower)) return '🍚';
  // Location
  if (/\b(khu vực|vị trí|location|地点|位置)\b/i.test(lower)) return '📍';
  if (/\b(thời|time|时间|ngày|tháng)\b/i.test(lower)) return '🕐';
  if (/\b(cảnh|scene|场景)\b/i.test(lower)) return '🎬';
  // Social
  if (/\b(hảo cảm|quan hệ|好感|关系|reputation|danh tiếng)\b/i.test(lower)) return '💕';
  if (/\b(npc|nhân vật|人物|角色)\b/i.test(lower)) return '👤';
  if (/\b(phe|faction|势力|阵营)\b/i.test(lower)) return '🏴';
  // Items
  if (/\b(túi|hành trang|inventory|背包|物品)\b/i.test(lower)) return '🎒';
  if (/\b(kỹ năng|skill|技能)\b/i.test(lower)) return '📜';
  if (/\b(vũ khí|weapon|武器)\b/i.test(lower)) return '🗡️';
  if (/\b(giáp|armor|防具)\b/i.test(lower)) return '🛡️';
  // Military
  if (/\b(quân|binh|army|军|兵)\b/i.test(lower)) return '⚔️';
  if (/\b(gia tộc|family|家族)\b/i.test(lower)) return '🏠';
  // Status
  if (/\b(trạng thái|status|state|状态)\b/i.test(lower)) return '📋';
  // Default by type heuristic
  return '📌';
}

/**
 * Determine progress bar color class from field label.
 * Returns CSS background value.
 */
export function guessBarColor(label: string): string {
  const lower = label.toLowerCase();
  if (/\b(hp|health|máu|sức khỏe|sinh mệnh|生命)\b/i.test(lower)) return 'var(--bar-hp)';
  if (/\b(mp|mana|nội lực|魔力|法力)\b/i.test(lower)) return 'var(--bar-mp)';
  if (/\b(exp|kinh nghiệm|经验)\b/i.test(lower)) return 'var(--bar-exp)';
  return 'var(--bar-default)';
}

/**
 * Render a progress bar HTML fragment.
 * The JS data binding will use element IDs to update values.
 */
export function renderProgressBarHTML(
  elementIdPrefix: string,
  label: string,
  icon: string,
  barColor: string,
  maxValue: number,
): string {
  return `<div style="margin-bottom:8px">` +
    `<div class="stcs-bar-row">` +
    `<span class="stcs-bar-label">${icon} ${label}</span>` +
    `<span class="stcs-bar-value" id="${elementIdPrefix}-val">0/${maxValue}</span>` +
    `</div>` +
    `<div class="stcs-bar-container">` +
    `<div class="stcs-bar-fill" id="${elementIdPrefix}-bar" style="width:0%;background:${barColor}"></div>` +
    `</div>` +
    `</div>`;
}

/**
 * (bugNeedFix/113) BỘ ĐẾM không trần — chỉ hiện con số, KHÔNG vẽ thanh tiến trình.
 *
 * Ngày, tiền, số lượng vật phẩm không có mức tối đa nên "75/100" kèm thanh gần trống là vừa sai
 * vừa gây hiểu nhầm (người chơi tưởng 100 là trần). Hàng này in đúng con số, giữ nguyên khung
 * hàng của thanh tiến trình để bố cục không lệch.
 */
export function renderCounterHTML(
  elementId: string,
  label: string,
  icon: string,
): string {
  return `<div style="margin-bottom:8px">` +
    `<div class="stcs-bar-row">` +
    `<span class="stcs-bar-label">${icon} ${label}</span>` +
    `<span class="stcs-bar-value stcs-counter" id="${elementId}">0</span>` +
    `</div>` +
    `</div>`;
}

/**
 * Render a data card (label + value) HTML fragment.
 */
export function renderDataCardHTML(
  elementId: string,
  label: string,
  icon: string,
): string {
  return `<div class="stcs-data-item">` +
    `<span class="stcs-data-label">${icon} ${label}</span>` +
    `<span class="stcs-data-value" id="${elementId}">—</span>` +
    `</div>`;
}

/**
 * Render an accordion panel (section) HTML fragment.
 */
export function renderPanelHTML(
  panelId: string,
  title: string,
  icon: string,
  contentHTML: string,
  collapsed?: boolean,
): string {
  const collapsedClass = collapsed ? ' collapsed' : '';
  const hiddenClass = collapsed ? ' hidden' : '';
  return `<div class="stcs-panel" id="${panelId}">` +
    `<div class="stcs-panel-header${collapsedClass}"><span>${icon} ${title}</span></div>` +
    `<div class="stcs-panel-content${hiddenClass}">` +
    contentHTML +
    `</div>` +
    `</div>`;
}

/**
 * Render a scrollable record list placeholder.
 * JS will populate this dynamically.
 */
export function renderRecordListHTML(
  listId: string,
  emptyMessage: string,
  interactive?: boolean,
): string {
  const cls = interactive ? 'stcs-list-item interactive' : 'stcs-list-item';
  return `<ul class="stcs-scroll-list" id="${listId}">` +
    `<li class="${cls}" style="justify-content:center;font-weight:normal;color:var(--text-muted)">${emptyMessage}</li>` +
    `</ul>`;
}

/**
 * Render a modal popup HTML fragment.
 */
export function renderModalHTML(
  modalId: string,
  titleId: string,
  bodyId: string,
): string {
  return `<div class="stcs-modal-overlay" id="${modalId}">` +
    `<div class="stcs-modal-content">` +
    `<span class="stcs-modal-close" data-modal="${modalId}">✕</span>` +
    `<div class="stcs-modal-title" id="${titleId}">Chi tiết</div>` +
    `<div class="stcs-modal-body" id="${bodyId}"></div>` +
    `</div>` +
    `</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// JAVASCRIPT FRAGMENTS — For data binding
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate shared JS utilities for status bar:
 * - Accordion toggle
 * - Modal open/close
 * - Helper functions
 */
export function generateStatusBarSharedJS(): string {
  return `
    // ── Accordion Toggle ──
    document.querySelectorAll('.stcs-panel-header').forEach(function(header) {
        header.addEventListener('click', function() {
            this.classList.toggle('collapsed');
            var content = this.nextElementSibling;
            if (content) content.classList.toggle('hidden');
        });
    });

    // ── Modal Close ──
    document.querySelectorAll('.stcs-modal-close').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var modalId = this.getAttribute('data-modal');
            if (modalId) document.getElementById(modalId).style.display = 'none';
        });
    });
    document.querySelectorAll('.stcs-modal-overlay').forEach(function(overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === this) this.style.display = 'none';
        });
    });

${MVU_RUNTIME_HELPERS}

    // ── Helpers ──
    // Nhận cả cặp [giá trị, "mô tả"] lẫn giá trị trần — luôn bóc qua mvuText trước khi in,
    // nếu không bảng sẽ hiện kèm phần mô tả (lỗi "bảng không ăn biến").
    function stcsSetText(id, value, fallback) {
        var el = document.getElementById(id);
        var v = mvuText(value, '');
        if (el) el.textContent = (v !== undefined && v !== null && v !== '') ? v : (fallback || '—');
    }

    function stcsSetHtml(id, html) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function stcsSetBar(barId, valId, current, max, suffix) {
        // current có thể là cặp [số, "mô tả"] → bóc ra, tránh NaN% trên thanh máu.
        current = mvuNum(current, 0);
        max = mvuNum(max, 0);
        var pct = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
        var barEl = document.getElementById(barId);
        var valEl = document.getElementById(valId);
        if (barEl) barEl.style.width = pct + '%';
        if (valEl) valEl.textContent = current + '/' + max + (suffix || '');
    }

    function stcsShowModal(modalId) {
        var el = document.getElementById(modalId);
        if (el) el.style.display = 'flex';
    }
`;
}

/**
 * Generate JS for a single field binding (setText or setBar).
 *
 * @param fieldPath - Array of keys: ['Người chơi', 'Chỉ số', 'HP']
 * @param elementId - DOM element ID prefix
 * @param fieldType - 'number' | 'string' | 'boolean' | 'record'
 * @param barMax - If provided, render as progress bar with this max
 */
export function generateFieldBindingJS(
  fieldPath: string[],
  elementId: string,
  fieldType: string,
  barMax?: number,
): string {
  const pathExpr = fieldPath.map(k => `'${k.replace(/'/g, "\\'")}'`).join(', ');
  const getter = `_.get(d, [${pathExpr}], ${fieldType === 'number' ? '0' : "'—'"})`;

  if (fieldType === 'number' && barMax !== undefined) {
    return `    stcsSetBar('${elementId}-bar', '${elementId}-val', ${getter}, ${barMax});`;
  }
  return `    stcsSetText('${elementId}', ${getter});`;
}

/**
 * Generate the populateData() main function body from an array of field bindings.
 */
export function generatePopulateFunction(bindings: string[]): string {
  return `
    function populateData() {
        var all = getAllVariables();
        var d = _.get(all, ['stat_data'], {});
${bindings.join('\n')}
    }
`;
}

/**
 * Generate the init() + event binding wrapper.
 * Pattern from regex-làm_đẹp_thanh_trạng_thái.json
 */
export function generateInitWrapper(populateFnBody: string, sharedJS: string): string {
  return `
${sharedJS}

${populateFnBody}

    async function init() {
        await waitGlobalInitialized('Mvu');
        populateData();
        eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, populateData);
    }

    $(errorCatched(init));
`;
}

/**
 * Generate opening form shared JS: page navigation, card selection, slider sync.
 */
export function generateOpeningFormSharedJS(totalPages: number): string {
  return `
    var currentPage = 0;
    var totalPages = ${totalPages};
    var formData = {};

    // (bug 116 — GỐC RỄ THẬT của "bấm Xác nhận không cập nhật biến") Hàm này trước đây CHỈ có
    // trong sharedJS của STATUS BAR, không có ở đây — mà onConfirm của form lại gọi nó ngay
    // DÒNG ĐẦU TIÊN để đổ bảng tóm tắt. Kết quả: ReferenceError ngay khi bấm nút, toàn bộ phần
    // ghi biến phía sau (kể cả bản đã fix ở bug 114) KHÔNG BAO GIỜ chạy tới. Không toast, không
    // báo gì — chỉ một dòng đỏ trong console của iframe mà chẳng ai mở.
    function stcsSetHtml(id, html) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function goToPage(n) {
        if (n < 0 || n >= totalPages) return;
        document.querySelectorAll('.stcs-page').forEach(function(p) { p.classList.remove('active'); });
        var target = document.getElementById('stcs-page-' + n);
        if (target) target.classList.add('active');
        currentPage = n;
        updateSteps();
    }

    function updateSteps() {
        document.querySelectorAll('.stcs-step-dot').forEach(function(dot, i) {
            dot.classList.remove('active', 'done');
            if (i === currentPage) dot.classList.add('active');
            else if (i < currentPage) dot.classList.add('done');
        });
    }

    function selectCard(card, groupId) {
        var group = document.getElementById(groupId);
        if (!group) return;
        group.querySelectorAll('.stcs-card').forEach(function(c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        var value = card.getAttribute('data-value');
        formData[groupId] = value;
    }

    function syncSlider(sliderId, valueId) {
        var slider = document.getElementById(sliderId);
        var display = document.getElementById(valueId);
        if (slider && display) {
            display.textContent = slider.value;
            slider.addEventListener('input', function() {
                display.textContent = this.value;
                formData[sliderId] = parseInt(this.value);
            });
        }
    }

    function collectFormData() {
        // (bugNeedFix/114) TRƯỚC ĐÂY chỉ quét input[type=text|number] + textarea. Nghĩa là:
        //   • thanh trượt (input[type=range]) chỉ có giá trị nếu người chơi ĐỘNG vào nó,
        //   • checkbox và lưới thẻ lựa chọn KHÔNG BAO GIỜ được thu.
        // Cộng với lỗi lệch id (xem programmaticRegexBuilder), kết quả là bấm Xác nhận xong
        // chẳng có biến nào được ghi mà cũng không báo lỗi gì.
        // Nay thu ĐỦ mọi loại, và thu theo TRẠNG THÁI HIỆN TẠI của DOM chứ không chờ event.
        document.querySelectorAll('#stcs-app input[type=text], #stcs-app input[type=number], #stcs-app input[type=range]').forEach(function(inp) {
            if (inp.id) formData[inp.id] = inp.value;
        });
        document.querySelectorAll('#stcs-app textarea').forEach(function(ta) {
            if (ta.id) formData[ta.id] = ta.value;
        });
        document.querySelectorAll('#stcs-app input[type=checkbox]').forEach(function(cb) {
            if (cb.id) formData[cb.id] = cb.checked;
        });
        // Lưới thẻ lựa chọn: giá trị nằm ở data-value của thẻ đang .selected.
        document.querySelectorAll('#stcs-app .stcs-card-grid').forEach(function(grid) {
            if (!grid.id) return;
            var sel = grid.querySelector('.stcs-card.selected');
            if (sel) formData[grid.id] = sel.getAttribute('data-value') || '';
        });
        return formData;
    }
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL DOCUMENT ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assemble CSS + HTML body + JS into a complete HTML document string.
 * Output format matches regex JSON replaceString convention.
 */
/**
 * (User 22/07 — bug 75) "Opening Form giao diện đã hiện ra nhưng lại không tương tác nút bấm được."
 *
 * GỐC RỄ: khối JS nằm trong `<script type="module">` (bắt buộc, vì TavernHelper cần `import`),
 * nhưng nút lại gắn handler bằng thuộc tính inline `onclick="goToPage(1)"`. Hàm khai báo bên
 * trong module chỉ sống trong SCOPE CỦA MODULE, không bao giờ trở thành thuộc tính của `window`.
 * Trình duyệt lại đánh giá nội dung `onclick=` ở GLOBAL scope ⇒ mỗi lần bấm là
 * `ReferenceError: goToPage is not defined`. Nút vẫn hiện, hover vẫn đổi màu (CSS chạy bình
 * thường), nhưng bấm không làm gì — đúng y triệu chứng user mô tả.
 *
 * Cách chữa: quét chính HTML để lấy mọi tên hàm đang được gọi từ handler inline, rồi gán chúng
 * lên `window` ở cuối module. Quét tự động nên sau này thêm nút mới cũng không tái phát.
 */
export function exportInlineHandlersToWindow(bodyHtml: string, js: string): string {
  const names = new Set<string>();
  for (const m of bodyHtml.matchAll(/\son(?:click|change|input|submit|blur|focus)\s*=\s*["']([A-Za-z_$][\w$]*)\s*\(/g)) {
    names.add(m[1]);
  }
  // Chỉ xuất hàm THẬT SỰ có khai báo trong khối JS — tránh gán window.X = undefined rồi
  // che mất lỗi "thiếu hàm" (lỗi đó phải để nó nổ ra cho thấy).
  const declared = [...names].filter(n =>
    new RegExp(`(?:function\\s+${n}\\b|(?:const|let|var)\\s+${n}\\s*=)`).test(js),
  );
  if (declared.length === 0) return '';
  return '\n    // (bug 75) Đưa handler ra global — `onclick=` inline không thấy được scope của module.\n' +
    declared.map(n => `    window.${n} = ${n};`).join('\n') + '\n';
}

export function assembleHtmlDocument(
  css: string,
  bodyHtml: string,
  js: string,
  fontImport?: string,
): string {
  const fontLink = fontImport
    ? `\n    <link rel="stylesheet" href="${fontImport}">`
    : '';
  const handlerExports = exportInlineHandlersToWindow(bodyHtml, js);

  return '```html\n' +
    '<!DOCTYPE html>\n' +
    '<html lang="vi">\n' +
    '<head>\n' +
    '    <meta charset="UTF-8">\n' +
    `${fontLink}\n` +
    '    <style>\n' +
    css + '\n' +
    '    </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '    <div id="stcs-app">\n' +
    bodyHtml + '\n' +
    '    </div>\n' +
    '    <script type="module">\n' +
    js + '\n' +
    handlerExports +
    '    </script>\n' +
    '</body>\n' +
    // (bug 72 - user tu soi ra) Khoi mo bang fence html ma THIEU fence dong o cuoi thi
    // SillyTavern khong dong code fence => khong render HTML. Card MVU that: 100%
    // replaceString ket thuc bang xuong dong + fence dong.
    '</html>\n' +
    '```';
}
