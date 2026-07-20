// ─── Lưu/khôi phục tiến độ "Dịch Script" ───
// Map token đã dịch cỡ MB → fs-cache của dev server (/api/progress/*, xây từ trước) —
// sống qua F5/đổi trình duyệt; localStorage chỉ giữ options + glossary (nhỏ).
// Khoá theo chữ ký nguồn (len:head64:tail64 — cùng công thức HeavyScriptMode): đổi file
// là khác sig → không bao giờ áp nhầm bản dịch của script khác.
import { safeSetItem } from '../utils/safeStorage';
import type { GlossaryEntry } from '../types/card';
import type { ScriptTranslateOptions } from './types';
import { DEFAULT_SCRIPT_OPTIONS } from './types';

export const LS_OPTS = 'st-script-opts';
export const LS_GLOSSARY = 'st-script-glossary';

export const sourceSig = (s: string): string => `${s.length}:${s.slice(0, 64)}:${s.slice(-64)}`;

export function loadOpts(): ScriptTranslateOptions {
  try {
    const raw = localStorage.getItem(LS_OPTS);
    if (raw) return { ...DEFAULT_SCRIPT_OPTIONS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SCRIPT_OPTIONS };
}
export const saveOpts = (o: ScriptTranslateOptions): void => safeSetItem(LS_OPTS, JSON.stringify(o));

export function loadGlossary(): GlossaryEntry[] {
  try {
    const raw = localStorage.getItem(LS_GLOSSARY);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v; }
  } catch { /* ignore */ }
  return [];
}
export const saveGlossary = (g: GlossaryEntry[]): void => safeSetItem(LS_GLOSSARY, JSON.stringify(g));

/** id token → bản dịch (chỉ token đã dịch xong) */
export type TokenMap = Record<number, string>;

export async function saveTokenMap(sig: string, map: TokenMap): Promise<void> {
  try {
    await fetch('/api/progress/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `script:${sig}`, data: { sig, map } }),
    });
  } catch { /* dev server hắt hơi — lần lưu sau bù */ }
}

export async function loadTokenMap(sig: string): Promise<TokenMap | null> {
  try {
    const res = await fetch(`/api/progress/load?key=${encodeURIComponent(`script:${sig}`)}`);
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.ok && j.data?.sig === sig && j.data.map && typeof j.data.map === 'object') return j.data.map as TokenMap;
  } catch { /* ignore */ }
  return null;
}

export async function deleteTokenMap(sig: string): Promise<void> {
  try {
    await fetch('/api/progress/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `script:${sig}` }),
    });
  } catch { /* ignore */ }
}
