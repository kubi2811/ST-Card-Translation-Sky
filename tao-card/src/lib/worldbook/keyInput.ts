/**
 * Tách chuỗi người dùng gõ ở ô "từ khoá kích hoạt" thành nhiều key riêng.
 *
 * Trước đây cả chuỗi bị nhét thành MỘT key, nên gõ "giao hàng, ship hàng" tạo ra key
 * "giao hàng, ship hàng" — key này không bao giờ khớp trong SillyTavern vì người chơi
 * không gõ nguyên cụm có dấu phẩy.
 *
 * Chỉ tách theo DẤU PHẨY (cả `,` lẫn `，` toàn rộng), KHÔNG tách theo khoảng trắng —
 * key tiếng Việt gần như luôn có khoảng trắng ("giao hàng" là một key, không phải hai).
 */
export function splitKeyInput(input: string): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const part of input.split(/[,，]/)) {
    const key = part.trim();
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Dọn mảng keys do AI sinh ra.
 *
 * Hai lỗi AI hay mắc (đã sửa ở prompt, nhưng prompt không bao giờ chắc 100%):
 * 1. Dùng `_` nối chữ: "giao_hàng". Người chơi gõ "giao hàng" có khoảng trắng nên key
 *    dính gạch dưới KHÔNG BAO GIỜ kích hoạt → entry chết. Gạch dưới gần như không bao
 *    giờ là ký tự hợp lệ trong từ khoá SillyTavern, nên đổi hết về khoảng trắng.
 *    (KHÔNG đụng dấu gạch ngang `-` vì có từ thật dùng nó: "sci-fi", "Anti-Hero".)
 * 2. Gộp nhiều key thành một chuỗi có dấu phẩy: ["giao hàng, ship hàng"] → tách ra.
 */
export function sanitizeAiKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const out: string[] = [];
  for (const raw of keys) {
    if (typeof raw !== 'string') continue;
    // Gộp nhiều key trong 1 phần tử → tách; rồi mới dọn từng cái.
    for (const piece of splitKeyInput(raw)) {
      const cleaned = piece.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    }
  }
  return out;
}
