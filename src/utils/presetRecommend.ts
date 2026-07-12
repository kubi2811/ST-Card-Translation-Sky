/**
 * src/utils/presetRecommend.ts — PHÂN TÍCH CARD khi import → gợi ý preset dịch phù hợp.
 * ────────────────────────────────────────────────────────────────────────────────────
 * Người mới không biết nên chọn ⚡ Dịch nhẹ / 📖 Dịch đầy đủ / 🚀 Dịch siêu tốc. Quét card:
 *
 *  1. Card có KHUNG MVU / SCRIPT NẶNG (ERA, stat_data, [initvar]/[mvu_update], registerMvuSchema,
 *     script TavernHelper nhiều chữ Hán) → khuyên ⚡ DỊCH NHẸ: logic/biến giữ nguyên 100% (bug #4
 *     đã chứng minh đụng vào là dễ vỡ), dịch phần người chơi thấy, AI tự đọc tiếng Trung.
 *     (Muốn UI trong game tiếng Việt hết → 📖 Dịch đầy đủ, chậm hơn + đã có covariance/sanitize.)
 *  2. Card THƯỜNG nhưng TO (nhiều entry / nhiều chữ) → khuyên 🚀 SIÊU TỐC: gom entry ngắn chung
 *     call, ít call hơn hàng chục lần mà vẫn dịch đủ.
 *  3. Card GỌN → khuyên 📖 DỊCH ĐẦY ĐỦ: dịch trọn vẹn, không tốn bao nhiêu call.
 */
import type { CharacterCard } from '../types/card';
import { HAN_RE_G } from './cjk';

export type RecommendedPreset = 'light' | 'full' | 'turbo';
export type RecommendReason = 'mvu' | 'script' | 'big' | 'small';

export interface PresetRecommendation {
  preset: RecommendedPreset;
  reason: RecommendReason;
  stats: {
    totalCjk: number;      // tổng chữ Hán ở phần văn bản (description/first_mes/entry content)
    scriptCjk: number;     // chữ Hán trong script TavernHelper
    entryCount: number;    // số entry lorebook
    hasMvu: boolean;       // có khung biến MVU/stat_data không
  };
}

const countHan = (s: string | undefined | null) => ((s || '').match(HAN_RE_G) || []).length;

/** Ngưỡng — chỉnh ở một chỗ. */
export const REC_SCRIPT_CJK_MIN = 500;   // script chứa ≥ chừng này chữ Hán = "script nặng"
export const REC_BIG_TOTAL_CJK = 40000;  // tổng chữ Hán vượt = card to
export const REC_BIG_ENTRIES = 15;       // số entry vượt = card to

export function recommendPreset(card: CharacterCard): PresetRecommendation {
  const d: any = (card as any).data || card || {};
  const ext = d.extensions || {};
  const entries: any[] = d.character_book?.entries || [];
  const scripts: any[] = ext.tavern_helper?.scripts || [];

  const scriptCjk = scripts.reduce((s, sc) => s + countHan(sc?.content), 0);
  const totalCjk =
    countHan(d.description) + countHan(d.first_mes) + countHan(d.personality) + countHan(d.scenario) +
    entries.reduce((s, e) => s + countHan(e?.content), 0);

  const entryText = entries.map(e => `${e?.comment || ''}\n${e?.content || ''}`).join('\n');
  const scriptText = scripts.map(sc => sc?.content || '').join('\n');
  const hasMvu =
    /\[initvar\]|\[mvu_update\]|\[mvu_plot\]/i.test(entryText) ||
    /registerMvuSchema|stat_data|Mvu\.|_\.set\(|InitVar/i.test(scriptText);

  const stats = { totalCjk, scriptCjk, entryCount: entries.length, hasMvu };

  if (hasMvu) return { preset: 'light', reason: 'mvu', stats };
  if (scriptCjk >= REC_SCRIPT_CJK_MIN) return { preset: 'light', reason: 'script', stats };
  if (totalCjk > REC_BIG_TOTAL_CJK || entries.length >= REC_BIG_ENTRIES) return { preset: 'turbo', reason: 'big', stats };
  return { preset: 'full', reason: 'small', stats };
}
