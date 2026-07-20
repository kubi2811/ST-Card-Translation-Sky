// ─── Lưu/khôi phục tiến độ "Dịch Preset" — cùng cơ chế fs-cache như Dịch Script ───
import { safeSetItem } from '../utils/safeStorage';
import type { PresetDict, PresetTranslateOptions } from './types';
import { DEFAULT_PRESET_OPTIONS, emptyPresetDict } from './types';
import type { PresetUnit } from './presetPipeline';

export const LS_OPTS = 'st-preset-tr-opts';
export const LS_DICT = 'st-preset-tr-dict';

export const presetSig = (s: string): string => `${s.length}:${s.slice(0, 64)}:${s.slice(-64)}`;

export function loadOpts(): PresetTranslateOptions {
  try {
    const raw = localStorage.getItem(LS_OPTS);
    if (raw) return { ...DEFAULT_PRESET_OPTIONS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PRESET_OPTIONS };
}
export const saveOpts = (o: PresetTranslateOptions): void => safeSetItem(LS_OPTS, JSON.stringify(o));

export function loadDict(): PresetDict {
  try {
    const raw = localStorage.getItem(LS_DICT);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') return { ...emptyPresetDict(), ...v };
    }
  } catch { /* ignore */ }
  return emptyPresetDict();
}
export const saveDict = (d: PresetDict): void => safeSetItem(LS_DICT, JSON.stringify(d));

export type UnitMap = Record<string, string>;

export const unitsToMap = (units: PresetUnit[]): UnitMap => {
  const map: UnitMap = {};
  for (const u of units) if (u.translated) map[u.id] = u.translated;
  return map;
};

export async function saveUnitMap(sig: string, map: UnitMap): Promise<void> {
  try {
    await fetch('/api/progress/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `preset:${sig}`, data: { sig, map } }),
    });
  } catch { /* ignore */ }
}

export async function loadUnitMap(sig: string): Promise<UnitMap | null> {
  try {
    const res = await fetch(`/api/progress/load?key=${encodeURIComponent(`preset:${sig}`)}`);
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.ok && j.data?.sig === sig && j.data.map && typeof j.data.map === 'object') return j.data.map as UnitMap;
  } catch { /* ignore */ }
  return null;
}

export async function deleteUnitMap(sig: string): Promise<void> {
  try {
    await fetch('/api/progress/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `preset:${sig}` }),
    });
  } catch { /* ignore */ }
}
