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

/**
 * (bug 213) Mỗi mục lưu KÈM CHUỖI GỐC, không chỉ bản dịch.
 *
 * Bản cũ lưu `id → bản dịch` rồi lúc resume gán thẳng, không đối chiếu gì. Chữ ký file lại chỉ
 * gồm `độ dài + 64 ký tự đầu + 64 ký tự cuối`, nên sửa nội dung một prompt Ở GIỮA mà tổng độ dài
 * không đổi — chuyện rất dễ xảy ra khi tinh chỉnh câu chữ — thì chữ ký trùng, id trùng, và bản
 * dịch CŨ của nội dung CŨ được áp cho nội dung MỚI. Sai âm thầm, không có gì báo.
 *
 * Dịch Script đã có sẵn "dây an toàn thứ 2" đúng kiểu này (TokenMap `{o, t}`, chỉ áp khi
 * `saved.o === t.text`); phía preset chưa từng được nối theo.
 */
export type UnitEntry = { o: string; t: string };
export type UnitMap = Record<string, UnitEntry>;

export const unitsToMap = (units: PresetUnit[]): UnitMap => {
  const map: UnitMap = {};
  for (const u of units) if (u.translated) map[u.id] = { o: u.original, t: u.translated };
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
    if (j?.ok && j.data?.sig === sig && j.data.map && typeof j.data.map === 'object') {
      // (bug 213) Bỏ mục theo ĐỊNH DẠNG CŨ (chuỗi trần, không kèm bản gốc): không có gì để đối
      // chiếu thì không có cách nào biết nó còn đúng với nội dung hiện tại — thà dịch lại còn hơn
      // áp nhầm bản dịch của đoạn văn đã bị sửa.
      const raw = j.data.map as Record<string, unknown>;
      const clean: UnitMap = {};
      for (const [id, v] of Object.entries(raw)) {
        if (v && typeof v === 'object' && typeof (v as UnitEntry).o === 'string' && typeof (v as UnitEntry).t === 'string') {
          clean[id] = v as UnitEntry;
        }
      }
      return clean;
    }
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
