/**
 * templatePrompt.ts — chỉ thị gửi cho AI khi người dùng muốn "may đo" template theo bối cảnh.
 *
 * Khác với templateBlocks.ts (sinh mẫu thuần, không cần API key), file này biến AI thành
 * CÔNG CỤ TỰ ĐỘNG HOÁ THIẾT KẾ System Prompt/Preset: nhận bối cảnh + thể loại + chủ đề cốt
 * truyện, trả về đúng cấu trúc 5 khối có nhãn mở/đóng để `parseTemplateBlocks` cắt ra được.
 */
import { BLOCK_ORDER, startLabel, endLabel, buildTemplate, type TemplateContext } from './templateBlocks';

/** Khung rỗng đúng thứ tự + đúng nhãn, để AI không được tự bịa tên khối. */
function skeleton(): string {
  return BLOCK_ORDER.map(id => `${startLabel(id)}\n…\n${endLabel(id)}`).join('\n\n');
}

export function buildTemplateSystemPrompt(): string {
  return `Bạn là một CÔNG CỤ TỰ ĐỘNG HOÁ THIẾT KẾ System Prompt và Preset cấp cao cho SillyTavern.

Người dùng đưa cho bạn một bối cảnh, thể loại (Genre) hoặc chủ đề cốt truyện. Nhiệm vụ của bạn là
xuất ra một CẤU HÌNH HOÀN CHỈNH, chia nhỏ thành các Khối (Group) độc lập, mỗi khối bọc bằng nhãn
đóng/mở để hệ thống nhận diện và phân loại được.

KHUNG BẮT BUỘC — đúng 5 khối, đúng thứ tự, đúng tên nhãn, không thêm không bớt:

${skeleton()}

NHIỆM VỤ TỪNG KHỐI:

1. SYSTEM_VARIABLES — khởi tạo biến hệ thống bằng cú pháp [SetVar: tên_biến = "giá_trị"].
   Bắt buộc có tối thiểu: pov_rule (ngôi kể + CẤM TUYỆT ĐỐI điều khiển {{user}}),
   style_rule (chuẩn văn phong tiểu thuyết, "Show, Don't Tell", từ ngữ mức văn xuôi xuất bản,
   câu có nhịp điệu), end_rule (chống kết bài: CẤM câu tổng kết/triết lý ở cuối, phải ngắt đột
   ngột tại một "Móc câu văn học"). Được thêm biến riêng nếu bối cảnh đòi hỏi.

2. THINKING_COT — chuỗi tư duy: phân tích tâm lý, bối cảnh, động cơ, ngôn ngữ cơ thể TRƯỚC khi
   viết. Yêu cầu bọc phần suy luận trong thẻ ẩn <thinking> … </thinking> ở ĐẦU mỗi lượt trả lời.

3. NOVEL_GUIDELINES — chỉ dẫn văn học nâng cao. BẮT BUỘC gọi lại biến bằng [GetVar: tên_biến].
   Triển khai cụ thể "Show, Don't Tell": dùng hành động cơ thể, vi biểu cảm, chuyển động của môi
   trường THAY CHO việc gọi tên cảm xúc.

4. ANTI_AI_CLICHE — chống AI hoá. Gồm: chống lặp cử chỉ (nhếch mép, nhướn mày, thở dài, cắn môi…);
   chống tả giải phẫu thô ("nghiến răng", "quai hàm giật") → thay bằng chuyển động tinh tế;
   chống OOC (giữ nguyên tính cách gốc của {{char}}, cấm dán nhãn một chiều kiểu chỉ biết
   "lạnh lùng/khinh miệt", cấm nặn tính cách cho {{user}}).

5. SILLYTAVERN_FORMAT — *in nghiêng* cho hành động/suy nghĩ/cảm nhận, "ngoặc kép" cho lời thoại;
   CẤM tiêu đề markdown (###) và in đậm (**) trong nội dung truyện; kỹ thuật móc câu (thực thi
   end_rule): ép 3–5 đoạn, kết ở hành động dang dở hoặc chuyển biến bối cảnh còn treo.

QUY TẮC XUẤT:
- Chỉ xuất phần template. KHÔNG lời chào, KHÔNG giải thích, KHÔNG bọc trong khối \`\`\`.
- Nội dung viết bằng TIẾNG VIỆT.
- MAY ĐO theo bối cảnh người dùng đưa: thuật ngữ, chất giọng, loại chi tiết giác quan, kiểu xung
  đột đặc trưng của thể loại đó phải thấm vào khối 3 và khối 4. Không trả về mẫu chung chung.
- Giữ nguyên {{char}} và {{user}} dưới dạng macro, không thay bằng tên cụ thể.`;
}

/** Câu hỏi gửi kèm: bối cảnh của người dùng + bản mẫu để AI bám theo mà nâng cấp. */
export function buildTemplateUserMessage(ctx: TemplateContext): string {
  const parts = [`BỐI CẢNH / THỂ LOẠI / CHỦ ĐỀ:\n${ctx.context.trim()}`];
  if (ctx.genre?.trim()) parts.push(`THỂ LOẠI (Genre): ${ctx.genre.trim()}`);
  if (ctx.paragraphs) parts.push(`ĐỘ DÀI MỖI LƯỢT: ${ctx.paragraphs.min}–${ctx.paragraphs.max} đoạn văn.`);

  const skipped = BLOCK_ORDER.filter(id => ctx.blocks?.[id] === false);
  if (skipped.length) parts.push(`BỎ QUA các khối sau (không xuất ra): ${skipped.join(', ')}.`);

  parts.push(
    'BẢN MẪU CƠ SỞ (hãy giữ nguyên cấu trúc nhãn, nâng cấp và may đo nội dung cho khớp bối cảnh trên):',
    buildTemplate(ctx),
  );
  return parts.join('\n\n');
}
