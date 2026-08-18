/**
 * characterQuality.ts — (Tawa 2.0) LUẬT CHẤT LƯỢNG NHÂN VẬT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Lấy từ bộ prompt của Tawa Worldbuilder 2.0 (ANTI-GARY-STU / ABSOLUTE HUMANITY / VIVIDNESS).
 *
 * Vì sao đáng port: prompt của tao-card vốn đã cấm "bát cổ" và tính từ sáo rỗng — tức cấm ở tầng
 * CÂU CHỮ. Nhưng thứ làm nhân vật nhạt lại nằm ở tầng THIẾT KẾ: mạnh mà không mất gì, tốt mà
 * không có góc tối, phản ứng lúc nào cũng đúng vai. Ba luật dưới đây bịt đúng ba lỗ đó, và chúng
 * là ràng buộc về NỘI DUNG nên không đụng gì tới quy tắc định dạng/độ dài sẵn có.
 *
 * Cố ý KHÔNG mang theo `ABSOLUTE_VERBOSITY_PROTOCOL` của bản gốc ("content phải ít nhất N token",
 * "thấy ngắn thì viết lại cho dài"): đó chính là kiểu sàn độ dài đã bị gỡ khỏi dự án này — nó dạy
 * mô hình viết chạm mốc rồi dừng, và đẻ ra vòng bắt viết lại không dứt. Xem `tokenBudget.ts`.
 */

/** Header dùng chung để entry không-phải-người biết đường bỏ qua. */
export const CHARACTER_QUALITY_PROTOCOL = `

--- LUẬT CHẤT LƯỢNG NHÂN VẬT (chỉ áp dụng cho phần mô tả CON NGƯỜI: nhân vật, NPC; entry cơ chế/địa danh bỏ qua) ---
1. CÂN BẰNG — CẤM NHÂN VẬT HOÀN HẢO:
   • Mọi năng lực/ưu thế phải kèm CÁI GIÁ tương xứng: tổn hại thân thể, sang chấn tâm lý, cái giá
     xã hội, điều kiện kích hoạt ngặt nghèo, hoặc số lần dùng có hạn.
   • PHẢI có khiếm khuyết thật và cụ thể: hèn nhát đúng lúc quan trọng, ích kỷ, định kiến sai lệch,
     thói xấu khó bỏ, hoặc một thất bại quá khứ không cứu vãn được.
   • CẤM: toàn năng, may mắn vô lý, ai gặp cũng quý, thắng mọi cuộc.
2. CHẤT NGƯỜI — CẤM GIỌNG "NPC TRẢ BÀI":
   • Phải có mâu thuẫn nội tâm: muốn một đằng làm một nẻo, biết sai vẫn làm.
   • Có khoảnh khắc bốc đồng, phi lý trí, yếu đuối — không phải lúc nào cũng đúng vai.
   • Cảm xúc là một PHỔ (yêu, ghét, giận, hờn, ghen tị, tham, lười, xấu hổ), không phải một nốt.
3. CHI TIẾT NHỎ LÀM NÊN NGƯỜI SỐNG:
   • Tật khi căng thẳng, cách cầm ly, dáng ngồi, mùi cơ thể, gu ăn mặc lệch chuẩn, nỗi sợ tầm
     thường (gián, độ cao, chỗ đông người).
   • Phản ứng phải đi qua CƠ THỂ — nét mặt, nhịp thở, ánh mắt, bàn tay — chứ không chỉ lời thoại.
4. CẤM KHUÔN MẪU RỖNG: "tổng tài bá đạo", "sát thủ lạnh lùng vô cảm", "thiên tài không đối thủ",
   "mỹ nhân hoàn mỹ". Mỗi tính từ tính cách PHẢI kèm một HÀNH VI cụ thể chứng minh nó — viết được
   hành vi thì giữ tính từ, không viết được thì bỏ tính từ đó đi.`;

/** Bản rút gọn cho các prompt vốn đã rất dài (bước basic info của Auto Creator). */
export const CHARACTER_QUALITY_SHORT = `
LUẬT CHẤT LƯỢNG NHÂN VẬT (bỏ qua nếu thẻ là hệ thống/game/thế giới):
- Mọi ưu thế phải có CÁI GIÁ đi kèm; nhân vật phải có khiếm khuyết thật. Cấm toàn năng, cấm ai
  cũng quý.
- Phải có mâu thuẫn nội tâm và khoảnh khắc phi lý trí — cấm giọng "NPC trả bài" lúc nào cũng đúng vai.
- Chi tiết nhỏ (tật khi căng thẳng, nỗi sợ tầm thường, thói quen cơ thể) quan trọng hơn mỹ từ.
- Mỗi tính từ tính cách phải kèm một hành vi cụ thể chứng minh; không chứng minh được thì bỏ.`;
