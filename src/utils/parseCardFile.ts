/**
 * src/utils/parseCardFile.ts — Parse 1 file card (JSON hoặc PNG) → object card, ĐỘC LẬP với store.
 * ──────────────────────────────────────────────────────────────────────────────
 * Dùng cho chức năng "So Sánh Card" (nạp 3 card riêng, KHÔNG đụng card đang dịch ở store).
 * Mirror logic `parseOnMainThread` trong hooks/useCardParser.ts nhưng chỉ trả dữ liệu, không side-effect.
 */
import type { CharacterCard } from '../types/card';
import { validateCard } from './cardFields';
import { extractCharaFromPNG } from './pngHandler';

export interface ParsedCard {
  card: CharacterCard;
  /** dataUrl ảnh gốc (chỉ có khi import từ PNG) — dùng để xuất lại PNG. */
  dataUrl: string | null;
  isPng: boolean;
  fileName: string;
}

/** Parse 1 File (.json / .png) thành card. Ném Error tiếng Việt nếu không hợp lệ. */
export async function parseCardFile(file: File): Promise<ParsedCard> {
  const name = file.name.toLowerCase();
  const isPng = name.endsWith('.png');
  const isJson = name.endsWith('.json');
  if (!isPng && !isJson) {
    throw new Error('Chỉ nhận file .json hoặc .png');
  }

  let text = '';
  let dataUrl: string | null = null;
  if (isPng) {
    try {
      const extracted = await extractCharaFromPNG(file);
      text = extracted.json;
      dataUrl = extracted.dataUrl;
    } catch {
      throw new Error('Không đọc được dữ liệu nhân vật trong PNG (thiếu chunk chara?)');
    }
  } else {
    text = await file.text();
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`File không phải JSON hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
  }

  const validation = validateCard(json);
  if (!validation.valid) {
    throw new Error(validation.error || 'Định dạng card không hợp lệ');
  }

  return { card: json as CharacterCard, dataUrl, isPng, fileName: file.name };
}

/**
 * Parse card từ CHUỖI JSON dán trực tiếp (không cần file). Dùng cho So Sánh Card khi user tạo card
 * từ worldbook / copy JSON từ nơi khác mà không có file để import.
 * `fileName` là tên hiển thị/tên xuất mặc định (không bắt buộc).
 */
export function parseCardJsonText(text: string, fileName = 'card-dán.json'): ParsedCard {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Chưa dán nội dung JSON');

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`JSON dán không hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
  }

  const validation = validateCard(json);
  if (!validation.valid) {
    throw new Error(validation.error || 'Định dạng card không hợp lệ');
  }

  return { card: json as CharacterCard, dataUrl: null, isPng: false, fileName };
}
