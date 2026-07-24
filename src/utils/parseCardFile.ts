/**
 * src/utils/parseCardFile.ts — Parse 1 file card (JSON hoặc PNG) → object card, ĐỘC LẬP với store.
 * ──────────────────────────────────────────────────────────────────────────────
 * Dùng cho chức năng "So Sánh Card" (nạp 3 card riêng, KHÔNG đụng card đang dịch ở store).
 * Mirror logic `parseOnMainThread` trong hooks/useCardParser.ts nhưng chỉ trả dữ liệu, không side-effect.
 */
import type { CharacterCard } from '../types/card';
import { validateCard } from './cardFields';
import { extractCharaFromPNG } from './pngHandler';
import { isWorldbookFormat, worldbookToCard } from './worldbookParser';

/**
 * (User 24/07) Nhận CẢ file World Info / lorebook rời, không chỉ card đầy đủ.
 *
 * Màn Dịch Card vốn đã nhận lorebook (useCardParser.ts gọi đúng cặp hàm này), nhưng So Sánh Card
 * đi đường parse riêng nên trước giờ chỉ `validateCard` rồi ném "missing spec, first_mes…" —
 * user nạp file lorebook vào là bị chặn dù dữ liệu hoàn toàn dùng được.
 *
 * `worldbookToCard` dựng pseudo-card có `data.character_book.entries[]`, nên mọi thứ phía sau
 * (gióng hàng, gộp thông minh, xuất JSON/PNG) chạy nguyên vẹn, không phải sửa gì thêm.
 */
function toCardOrWorldbook(json: unknown, fileName: string): CharacterCard {
  const v = validateCard(json);
  if (v.valid) return json as CharacterCard;
  if (isWorldbookFormat(json)) return worldbookToCard(json, fileName);
  throw new Error(
    `${v.error || 'Định dạng không hợp lệ'} — cũng không phải file World Info/lorebook (cần \`entries\` dạng object).`,
  );
}

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

  return { card: toCardOrWorldbook(json, file.name), dataUrl, isPng, fileName: file.name };
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

  return { card: toCardOrWorldbook(json, fileName), dataUrl: null, isPng: false, fileName };
}
