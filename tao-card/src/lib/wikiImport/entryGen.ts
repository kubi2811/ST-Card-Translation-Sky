/**
 * src/lib/wikiImport/entryGen.ts — SINH ENTRY TỪ NỘI DUNG TRANG (bug 121: ENTRY GENERATION
 * + CONTENT QUALITY + OUTPUT QUALITY).
 * ─────────────────────────────────────────────────────────────────────────
 * Khác batchGenerator (sáng tác từ ý tưởng): ở đây AI CHỈ CHƯNG CẤT nội dung wiki đã cào —
 * "không hallucination, không tự suy diễn, không thêm headcanon"; mâu thuẫn giữa các trang
 * thì ghi chú nguồn chứ không tự phán.
 */

import { buildLengthDirective } from '../ai/tokenBudget';

export function buildWikiEntrySystemPrompt(tokensPerEntry: number): string {
  const lenRule = tokensPerEntry > 0
    ? 'Độ dài mỗi entry theo mục §📏 ở cuối lời nhắc này — bám sát, viết hụt là lỗi nặng.'
    : 'Độ dài entry theo lượng thông tin thật — KHÔNG kéo dài bằng chữ thừa.';

  // (bug 229) Luật độ dài cũ tự mâu thuẫn ĐƠN VỊ: "dài KHOẢNG 250 token (≈ 875 ký tự) — không
  // ngắn hơn 175, không dài hơn 325". Hai con số cuối trần trụi, đứng ngay sau một con số KÝ TỰ,
  // nên đọc kiểu nào cũng có lý — và model nào đọc thành ký tự thì viết ra entry ngắn bằng 1/5
  // yêu cầu. `buildLengthDirective` (bug 194) nói bằng BA cách không thể hiểu nhầm: số token, số
  // ký tự, và CẤU TRÚC (mấy đoạn, mấy câu) — cái cuối là thứ model bám theo tốt nhất.
  const lengthDirective = buildLengthDirective(tokensPerEntry);

  return `Bạn là chuyên gia CHƯNG CẤT nội dung wiki thành Lorebook (World Info) cho SillyTavern.

NGUỒN DUY NHẤT là các trang wiki được cung cấp. LUẬT SẮT:
1. KHÔNG bịa, KHÔNG suy diễn, KHÔNG thêm headcanon — chỉ dùng thông tin CÓ trong nguồn.
2. Thông tin giữa các trang MÂU THUẪN → giữ bản của trang canon/chính; nếu không phân định
   được thì ghi cả hai kèm chú thích "(theo trang X / theo trang Y)". KHÔNG tự phán bản đúng.
3. MỖI ENTRY MỘT CHỦ ĐỀ RIÊNG. Không viết lại thông tin đã thuộc entry khác — kể cả bằng
   cách diễn đạt khác. Gom thông tin liên quan về cùng một thực thể vào MỘT entry.
4. CẤM entry vô nghĩa/trivia/hiển nhiên (vd "trời lạnh phải mặc áo", "nhân vật có hai mắt",
   "địa điểm nằm trên mặt đất"). Cấm entry chỉ chứa meta ngoài-thế-giới (diễn viên lồng
   tiếng, ngày phát sóng, doanh thu).
5. Trích đủ các mặt quan trọng nếu nguồn có: ngoại hình, tính cách, xuất thân/lịch sử,
   quan hệ, tổ chức, năng lực/kỹ năng, trang bị, chủng tộc/loài, nghề nghiệp, sự kiện lớn,
   trích dẫn đáng nhớ. Đọc cả infobox và bảng — đừng bỏ sót vì nó nằm trong template.
6. ${lenRule}
7. keys: MỖI phần tử một cách gọi — tên đầy đủ, bí danh, tên viết tắt, tên dịch, tên gốc
   tiếng Nhật/Trung/Anh nếu nguồn cung cấp. Key nhiều tiếng dùng KHOẢNG TRẮNG, không dùng _.

CHỈ trả về MỘT MẢNG JSON: [{"comment":"Tên entry","keys":["..."],"secondary_keys":["..."],
"content":"...","constant":false,"selective":true}]. KHÔNG markdown, KHÔNG lời dẫn.${lengthDirective}`;
}

export function buildWikiEntryUserPrompt(args: {
  source: string;
  count: number;
  laneIndex: number;
  laneTotal: number;
  claimedTitles: string[];
  extraInstructions?: string;
}): string {
  const { source, count, laneIndex, laneTotal, claimedTitles, extraInstructions } = args;
  const parts: string[] = [];

  parts.push(`### NGUỒN WIKI (batch ${laneIndex}/${laneTotal} — CHỈ những trang này thuộc phần của bạn)\n${source}`);

  if (claimedTitles.length > 0) {
    parts.push(`### THỰC THỂ ĐÃ CÓ ENTRY (batch khác/lorebook đã viết — TUYỆT ĐỐI KHÔNG viết lại, kể cả dưới tên khác)\n${claimedTitles.slice(0, 120).map(t => `- ${t}`).join('\n')}`);
  }

  if (extraInstructions?.trim()) {
    parts.push(`### YÊU CẦU THÊM TỪ NGƯỜI DÙNG (ưu tiên cao)\n${extraInstructions.trim()}`);
  }

  parts.push(`### SỐ LƯỢNG\nSinh TỐI ĐA ${count} entry từ phần nguồn trên. Nguồn không đủ thông tin cho ${count} entry chất lượng thì trả ÍT HƠN — thà thiếu còn hơn độn trivia.`);

  return parts.join('\n\n');
}
