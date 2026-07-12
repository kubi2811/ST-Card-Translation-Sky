import type { CharacterCard, ProxySettings } from '../types/card';
import { extractInitvarText, extractRegexScripts } from './stPreview';
import { callProvider } from './apiClient';

/**
 * ─── 🎲 Tạo DATA TEST cho preview bằng AI ───
 *
 * Vấn đề: nhiều card chưa được chơi thì `[initvar]` toàn giá trị mặc định ("Chưa Biết", 0…),
 * hoặc card KHÔNG có [initvar] → thanh trạng thái/game UI hiện trống, dịch giả không thấy
 * được giao diện thật sau khi dịch có ổn không.
 *
 * Giải pháp: gọi AI (dùng chính API đã cấu hình để dịch) điền GIÁ TRỊ MẪU thực tế như một
 * nhân vật đang chơi giữa chừng — GIỮ NGUYÊN tên khóa (không đụng logic), chỉ đổi giá trị.
 * Kết quả trả về dạng JSON để nạp thẳng làm stat_data cho iframe preview.
 */

/** Gom skeleton biến từ script thanh trạng thái khi card KHÔNG có [initvar]. */
function deriveSkeletonFromScripts(card: CharacterCard): string | null {
  const scripts = extractRegexScripts(card);
  const paths = new Set<string>();
  for (const s of scripts) {
    const rs = s.replaceString || '';
    // stat_data.A.B / stat_data['A'] ; getMvuVariable(data, 'A.B')
    for (const m of rs.matchAll(/stat_data(?:\.([\wÀ-ỹ]+))+/g)) paths.add(m[0].replace(/^stat_data\./, ''));
    for (const m of rs.matchAll(/getMvuVariable\([^,]+,\s*['"]([^'"]+)['"]/g)) paths.add(m[1]);
    if (paths.size > 80) break;
  }
  if (paths.size === 0) return null;
  // Dựng object lồng nhau rỗng từ các path "A.B.C"
  const root: Record<string, any> = {};
  for (const p of paths) {
    const parts = p.split('.').filter(Boolean).slice(0, 6);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const k = parts[i];
      if (i === parts.length - 1) { if (!(k in cur)) cur[k] = ''; }
      else { if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}; cur = cur[k]; }
    }
  }
  return JSON.stringify(root, null, 2);
}

function stripJson(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/```(?:json|yaml)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.search(/[{[]/);
  const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t;
}

export interface TestDataResult {
  /** JSON stat_data để nạp vào preview (initvarText override) */
  json: string;
  /** Nguồn cấu trúc: initvar của card / suy từ script */
  source: 'initvar' | 'script';
}

/**
 * Gọi AI điền data test. Trả về JSON stat_data, hoặc null nếu không dựng được cấu trúc
 * (card không có initvar lẫn biến trong script) hoặc AI trả rác.
 */
export async function generateTestVariables(
  card: CharacterCard,
  proxy: ProxySettings,
  signal?: AbortSignal,
): Promise<TestDataResult | null> {
  let structure = extractInitvarText(card);
  let source: 'initvar' | 'script' = 'initvar';
  if (!structure || !structure.trim()) {
    structure = deriveSkeletonFromScripts(card);
    source = 'script';
  }
  if (!structure || !structure.trim()) return null;

  const cardName = (card as any).data?.name || (card as any).name || 'nhân vật';
  const system = `Bạn tạo DATA TEST cho hệ thống biến trạng thái MVU của một thẻ nhập vai SillyTavern (thường là tu tiên/võ hiệp/game).
Người dùng gửi CẤU TRÚC biến (nhiều giá trị còn mặc định như "Chưa Biết", 0, {}). Nhiệm vụ:
1. Điền GIÁ TRỊ MẪU HỢP LÝ như một nhân vật đang chơi ĐƯỢC MỘT LÚC: có tên cụ thể, cảnh giới/cấp bậc vừa phải, chỉ số (HP/linh lực…) ở mức hợp lý, vài vật phẩm, 1-2 quan hệ, trạng thái bình thường.
2. GIỮ NGUYÊN 100% TÊN KHÓA (keys) và CẤU TRÚC lồng nhau — TUYỆT ĐỐI không đổi/dịch/thêm/bớt khóa. Chỉ thay GIÁ TRỊ.
3. Số phải là số (không phải chuỗi), mảng giữ là mảng, object giữ là object.
4. Giá trị chữ dùng ngôn ngữ giống trong cấu trúc gốc (nếu cấu trúc tiếng Việt thì điền tiếng Việt).
5. CHỈ trả về JSON THUẦN (không markdown, không giải thích).`;

  const user = `Nhân vật: ${cardName}\n\nCẤU TRÚC BIẾN (điền giá trị mẫu, giữ nguyên khóa):\n${structure.slice(0, 12000)}`;

  const raw = await callProvider(proxy, system, user, signal, undefined, {
    label: '🎲 Tạo data test', charCount: user.length,
  });
  const cleaned = stripJson(raw);
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === 'object') return { json: JSON.stringify(obj), source };
  } catch { /* AI trả không phải JSON hợp lệ */ }
  return null;
}
