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

/**
 * Sig của 1 LẦN CHẠY = sig nguồn + cờ beautify. Id token sinh theo thứ tự offset trên văn bản
 * SAU beautify — đổi cờ là id lệch hết, map cũ mà áp bừa là bản dịch gắn nhầm chuỗi (lỗi câm).
 * (bug 187) Hậu tố :v2 — bộ trích AST đánh id khác hệ regex cũ, map cũ phải vô hiệu sạch sẽ
 * (lớp đối chiếu `o === token.text` vẫn là dây an toàn thứ hai).
 */
export const runSig = (source: string, beautify: boolean): string =>
  `${sourceSig(source)}:b${beautify ? 1 : 0}:v2`;

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

/**
 * id token → { o: chuỗi GỐC, t: bản dịch }. Lưu kèm chuỗi gốc để lúc resume ĐỐI CHIẾU:
 * token.text phải khớp o mới áp — dây an toàn thứ 2 chống áp nhầm khi id lệch vì bất kỳ lý do gì.
 */
export type TokenMap = Record<number, { o: string; t: string }>;

export const tokensToMap = (tokens: Array<{ id: number; text: string; translated?: string }>): TokenMap => {
  const map: TokenMap = {};
  for (const tk of tokens) if (tk.translated) map[tk.id] = { o: tk.text, t: tk.translated };
  return map;
};

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
    if (j?.ok && j.data?.sig === sig && j.data.map && typeof j.data.map === 'object') {
      const map = j.data.map as Record<string, unknown>;
      // Chỉ nhận format mới {o,t} — map format cũ (chuỗi trần, thiếu đối chiếu) bị bỏ qua an toàn.
      const out: TokenMap = {};
      for (const [k, v] of Object.entries(map)) {
        if (v && typeof v === 'object' && typeof (v as { o?: unknown }).o === 'string' && typeof (v as { t?: unknown }).t === 'string') {
          out[Number(k)] = v as { o: string; t: string };
        }
      }
      return Object.keys(out).length ? out : null;
    }
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
