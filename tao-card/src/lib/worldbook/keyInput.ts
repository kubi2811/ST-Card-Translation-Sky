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
