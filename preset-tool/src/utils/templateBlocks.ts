/**
 * templateBlocks.ts — "Tool tạo Template Preset".
 *
 * Sinh ra một cấu hình System Prompt hoàn chỉnh, CHIA THÀNH 5 KHỐI (Group) độc lập, mỗi khối
 * bọc bằng nhãn mở/đóng dạng [TÊN_KHỐI_START] … [TÊN_KHỐI_END] để hệ thống (và SillyTavern)
 * nhận diện + phân loại được từng khối, tách ra thành các prompt block riêng.
 *
 * QUAN TRỌNG: file này là logic THUẦN, KHÔNG gọi AI. Nhờ vậy người dùng chưa cắm API key vẫn
 * bấm 1 nút ra được template đầy đủ; AI chỉ là bước tuỳ chọn để "may đo" sâu hơn theo bối cảnh.
 */

export type TemplateBlockId =
  | 'SYSTEM_VARIABLES'
  | 'THINKING_COT'
  | 'NOVEL_GUIDELINES'
  | 'ANTI_AI_CLICHE'
  | 'SILLYTAVERN_FORMAT';

/** Thứ tự khối là CỐ ĐỊNH — biến phải khai báo trước khi khối 3 gọi [GetVar: …]. */
export const BLOCK_ORDER: TemplateBlockId[] = [
  'SYSTEM_VARIABLES',
  'THINKING_COT',
  'NOVEL_GUIDELINES',
  'ANTI_AI_CLICHE',
  'SILLYTAVERN_FORMAT',
];

/** Số thứ tự hiển thị trong nhãn: [1._SYSTEM_VARIABLES_START]. */
export const BLOCK_INDEX: Record<TemplateBlockId, number> = {
  SYSTEM_VARIABLES: 1,
  THINKING_COT: 2,
  NOVEL_GUIDELINES: 3,
  ANTI_AI_CLICHE: 4,
  SILLYTAVERN_FORMAT: 5,
};

/** Tên hiển thị (dùng làm `name` của prompt block khi nạp vào preset). */
export const BLOCK_TITLE: Record<TemplateBlockId, string> = {
  SYSTEM_VARIABLES: '1. Biến hệ thống',
  THINKING_COT: '2. Chuỗi tư duy (CoT)',
  NOVEL_GUIDELINES: '3. Chỉ dẫn văn học',
  ANTI_AI_CLICHE: '4. Chống AI hoá',
  SILLYTAVERN_FORMAT: '5. Định dạng SillyTavern',
};

export const startLabel = (id: TemplateBlockId) => `[${BLOCK_INDEX[id]}._${id}_START]`;
export const endLabel = (id: TemplateBlockId) => `[${BLOCK_INDEX[id]}._${id}_END]`;

// ─────────────────────────────────────────────────────────────────────────────
// Ngữ cảnh đầu vào
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateContext {
  /** Bối cảnh / thể loại / chủ đề cốt truyện do người dùng mô tả. */
  context: string;
  /** Thể loại ngắn gọn, ví dụ "Tu tiên", "Trinh thám", "Slice of life". Bỏ trống cũng được. */
  genre?: string;
  /** Ngôi kể. */
  pov?: 'third_limited' | 'third_omniscient' | 'first';
  /** Độ dài mỗi lượt trả lời (số đoạn văn). */
  paragraphs?: { min: number; max: number };
  /** Bật/tắt từng khối — khối tắt sẽ không xuất hiện trong template. */
  blocks?: Partial<Record<TemplateBlockId, boolean>>;
}

const POV_RULE: Record<NonNullable<TemplateContext['pov']>, string> = {
  third_limited:
    'Ngôi thứ ba giới hạn. Toàn bộ tường thuật bám sát giác quan, suy nghĩ và hiểu biết của {{char}}. TUYỆT ĐỐI CẤM viết thay hành động, lời thoại, cảm xúc hay quyết định của {{user}}; chỉ được mô tả {{user}} qua những gì {{char}} quan sát được từ bên ngoài.',
  third_omniscient:
    'Ngôi thứ ba toàn tri có kỷ luật. Được phép chuyển điểm nhìn giữa các nhân vật phụ, nhưng {{char}} luôn là trục chính. TUYỆT ĐỐI CẤM viết thay hành động, lời thoại hay quyết định của {{user}}.',
  first:
    'Ngôi thứ nhất, kể từ {{char}}. Mọi thứ đi qua lăng kính chủ quan của {{char}}. TUYỆT ĐỐI CẤM viết thay hành động, lời thoại hay quyết định của {{user}}.',
};

/** Ghép mô tả bối cảnh thành một câu gọn để nhúng vào các khối. */
function settingLine(ctx: TemplateContext): string {
  const genre = ctx.genre?.trim();
  const body = ctx.context.trim().replace(/\s+/g, ' ');
  if (genre && body) return `${genre} — ${body}`;
  return genre || body || 'Chưa mô tả bối cảnh';
}

// ─────────────────────────────────────────────────────────────────────────────
// Nội dung từng khối
// ─────────────────────────────────────────────────────────────────────────────

function blockSystemVariables(ctx: TemplateContext): string {
  const pov = POV_RULE[ctx.pov ?? 'third_limited'];
  return [
    `[SetVar: setting = "${settingLine(ctx)}"]`,
    '',
    `[SetVar: pov_rule = "${pov}"]`,
    '',
    '[SetVar: style_rule = "Văn phong tiểu thuyết xuất bản. Ưu tiên tuyệt đối nguyên tắc SHOW, DON\'T TELL: không gọi tên cảm xúc mà dựng nó lên bằng hành động cơ thể, vi biểu cảm, thay đổi của môi trường và nhịp thở của câu. Từ ngữ ở mức văn xuôi in sách — chính xác, có sức nặng, không sáo. Nhịp câu phải biến thiên: câu dài trải cảnh xen câu ngắn dứt khoát để tạo tiết tấu."]',
    '',
    '[SetVar: end_rule = "CHỐNG KẾT BÀI. TUYỆT ĐỐI CẤM đặt ở cuối lượt trả lời bất kỳ câu tổng kết, câu chốt ý nghĩa, câu triết lý, câu bình luận về bài học hay câu hướng về tương lai (kiểu \'và rồi mọi thứ sẽ khác\', \'đó là khởi đầu của…\'). Lượt trả lời phải NGẮT ĐỘT NGỘT ngay tại một MÓC CÂU VĂN HỌC: một hành động còn dang dở, một câu hỏi vừa buông chưa có đáp, hoặc một chuyển động của bối cảnh còn treo lơ lửng."]',
  ].join('\n');
}

function blockThinkingCot(): string {
  return [
    'TRƯỚC KHI VIẾT, hãy suy luận trong đầu và bọc toàn bộ phần suy luận đó trong thẻ ẩn ở ĐẦU mỗi lượt trả lời:',
    '',
    '<thinking>',
    '1. TÂM LÝ: Ngay lúc này {{char}} đang thực sự cảm thấy gì? Cảm xúc đó có bị che giấu không, và che bằng cách nào?',
    '2. BỐI CẢNH: Chuyện đang xảy ra ở đâu, lúc nào? Ánh sáng, âm thanh, mùi, nhiệt độ nào đang tác động lên cảnh này?',
    '3. ĐỘNG CƠ: {{char}} muốn đạt được điều gì trong lượt này? Điều gì đang cản trở? Nhân vật sẵn sàng trả giá tới đâu?',
    '4. NGÔN NGỮ CƠ THỂ: Trạng thái bên trong sẽ RÒ RỈ ra ngoài qua cử chỉ nào — và cử chỉ đó phải RIÊNG của {{char}}, không dùng lại mấy động tác quen thuộc của AI.',
    '5. MÓC KẾT: Lượt này sẽ dừng ở hành động dang dở nào?',
    '</thinking>',
    '',
    'Phần <thinking> là suy luận nội bộ, KHÔNG phải văn kể. Sau khi đóng thẻ, viết thẳng vào truyện, không nhắc lại nội dung vừa suy luận.',
  ].join('\n');
}

function blockNovelGuidelines(ctx: TemplateContext): string {
  return [
    `Bối cảnh đang vận hành: [GetVar: setting]`,
    'Ngôi kể bắt buộc tuân thủ: [GetVar: pov_rule]',
    'Chuẩn văn phong bắt buộc tuân thủ: [GetVar: style_rule]',
    '',
    'CÁCH THỰC THI "SHOW, DON\'T TELL":',
    '- Thay vì gọi tên cảm xúc, hãy dựng nó bằng HÀNH ĐỘNG CƠ THỂ có mục đích: nhân vật làm gì với đôi tay, đặt trọng tâm cơ thể ở đâu, khoảng cách với người đối diện thay đổi ra sao.',
    '- Dùng VI BIỂU CẢM thay cho tính từ: một nhịp ngập ngừng trước khi trả lời, ánh mắt rơi xuống nửa giây rồi nhấc lên, hơi thở đổi nhịp giữa câu.',
    '- Dùng CHUYỂN ĐỘNG CỦA MÔI TRƯỜNG làm gương phản chiếu nội tâm: ánh sáng dịch chuyển, tiếng động nền tắt đi, một vật rơi, gió đổi hướng.',
    '- Đối thoại phải mang sức nặng riêng: nhân vật nói lệch đi, nói nửa chừng, im lặng đúng chỗ. Điều quan trọng nhất thường nằm ở phần KHÔNG được nói ra.',
    `- Mỗi lượt phải đẩy tình huống tiến lên: có thêm một thông tin mới, một thay đổi trong quan hệ, hoặc một rủi ro mới xuất hiện. ${ctx.genre ? `Bám sát chất riêng của thể loại ${ctx.genre.trim()}.` : ''}`.trim(),
    '',
    'Giữ tính nhất quán: những gì đã thiết lập ở các lượt trước (vết thương, thời tiết, vị trí, lời hứa, món đồ trên tay) không được biến mất hay mâu thuẫn.',
  ].join('\n');
}

function blockAntiAiCliche(): string {
  return [
    'Đây là bộ lọc BẮT BUỘC, rà trước khi xuất mỗi lượt trả lời.',
    '',
    '① CHỐNG LẶP CỬ CHỈ — cấm dùng đi dùng lại kho động tác mặc định của AI:',
    '   nhếch mép/cười khẩy, nhướn mày, thở dài, cắn môi, đảo mắt, khoanh tay, hắng giọng, xoa gáy.',
    '   Mỗi cử chỉ trong danh sách trên TỐI ĐA 1 lần cho cả cuộc trò chuyện. Hết thì phải nghĩ cử chỉ mới, gắn với nghề nghiệp, thói quen và quá khứ riêng của {{char}}.',
    '',
    '② CHỐNG TẢ GIẢI PHẪU THÔ — cấm mô tả kiểu bảng cơ thể học:',
    '   "nghiến răng", "quai hàm giật", "cơ hàm co lại", "gân xanh nổi lên", "đồng tử co lại", "tim đập thình thịch trong lồng ngực".',
    '   Thay bằng chuyển động TINH TẾ và gián tiếp: một ngón tay dừng lại giữa chừng, giọng hạ xuống nửa quãng, câu nói bị cắt ngắn hơn bình thường.',
    '',
    '③ CHỐNG OOC (lệch vai):',
    '   - GIỮ NGUYÊN tính cách gốc của {{char}} như thẻ nhân vật đã định nghĩa. Không tự ý làm nhân vật dịu đi, ngoan hơn hay ác hơn để chiều tình huống.',
    '   - CẤM dán nhãn một chiều: không biến {{char}} thành cỗ máy chỉ biết "lạnh lùng", "khinh miệt", "bí ẩn". Nhân vật phải có mâu thuẫn nội tại và phản ứng khác nhau tuỳ hoàn cảnh.',
    '   - CẤM nặn tính cách cho {{user}}: không gán cho {{user}} cảm xúc, quá khứ, động cơ hay lời thoại mà chính {{user}} chưa hề đưa ra.',
    '',
    '④ CHỐNG GIỌNG TRỢ LÝ: không hỏi lại "bạn muốn làm gì tiếp theo?", không liệt kê lựa chọn, không xin phép, không phá vỡ hư cấu.',
  ].join('\n');
}

function blockSillyTavernFormat(ctx: TemplateContext): string {
  const min = ctx.paragraphs?.min ?? 3;
  const max = ctx.paragraphs?.max ?? 5;
  return [
    'ĐỊNH DẠNG ĐẦU RA (chuẩn hiển thị của SillyTavern):',
    '- *In nghiêng* cho hành động, suy nghĩ nội tâm và cảm nhận giác quan.',
    '- "Trong ngoặc kép" cho toàn bộ lời thoại nói ra miệng.',
    '- TUYỆT ĐỐI CẤM dùng tiêu đề markdown (#, ##, ###) và chữ in đậm (**) bên trong phần nội dung truyện.',
    '- Không dùng gạch đầu dòng, không đánh số, không bảng biểu trong phần kể chuyện.',
    '',
    'KỸ THUẬT MÓC CÂU (thực thi [GetVar: end_rule]):',
    `- Mỗi lượt trả lời viết ${min}–${max} đoạn văn.`,
    '- Đoạn cuối PHẢI kết thúc bằng một trong hai dạng: (a) một hành động đang dở dang — cánh cửa vừa hé, bàn tay vừa chạm tới, câu nói vừa bắt đầu; hoặc (b) một chuyển biến của bối cảnh còn treo — tiếng bước chân đến gần, ánh đèn vụt tắt, một cái tên vừa được nhắc.',
    '- Nhắc lại lần cuối: KHÔNG câu tổng kết, KHÔNG câu triết lý, KHÔNG mở ngoặc bình luận. Cắt đúng lúc người đọc đang muốn biết chuyện gì xảy ra tiếp.',
  ].join('\n');
}

const BUILDERS: Record<TemplateBlockId, (ctx: TemplateContext) => string> = {
  SYSTEM_VARIABLES: blockSystemVariables,
  THINKING_COT: blockThinkingCot,
  NOVEL_GUIDELINES: blockNovelGuidelines,
  ANTI_AI_CLICHE: blockAntiAiCliche,
  SILLYTAVERN_FORMAT: blockSillyTavernFormat,
};

// ─────────────────────────────────────────────────────────────────────────────
// Sinh / phân tích / kiểm tra
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedBlock {
  id: TemplateBlockId;
  title: string;
  /** Nội dung BÊN TRONG cặp nhãn, đã trim. */
  content: string;
}

/** Bật mặc định tất cả các khối; `blocks` chỉ dùng để TẮT bớt. */
const isOn = (ctx: TemplateContext, id: TemplateBlockId) => ctx.blocks?.[id] !== false;

/** Sinh template đầy đủ (chuỗi 1 mảnh, đã bọc nhãn mở/đóng). */
export function buildTemplate(ctx: TemplateContext): string {
  return BLOCK_ORDER.filter(id => isOn(ctx, id))
    .map(id => `${startLabel(id)}\n${BUILDERS[id](ctx).trim()}\n${endLabel(id)}`)
    .join('\n\n');
}

/** Sinh riêng từng khối (để nạp thẳng thành các prompt block độc lập). */
export function buildBlocks(ctx: TemplateContext): ParsedBlock[] {
  return BLOCK_ORDER.filter(id => isOn(ctx, id)).map(id => ({
    id,
    title: BLOCK_TITLE[id],
    content: BUILDERS[id](ctx).trim(),
  }));
}

/**
 * Tách một văn bản bất kỳ (kể cả do AI trả về) thành các khối theo nhãn mở/đóng.
 * Cố ý KHOAN DUNG: chấp nhận thiếu số thứ tự, thừa khoảng trắng, chữ thường/hoa lẫn lộn —
 * vì AI hay trả về hơi lệch. Khối nào không khớp nhãn thì bỏ qua, không ném lỗi.
 */
export function parseTemplateBlocks(text: string): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  for (const id of BLOCK_ORDER) {
    // [ (1.)? _? ID _START ]  …  [ (1.)? _? ID _END ]
    const re = new RegExp(
      `\\[\\s*(?:\\d+\\s*\\.?\\s*)?_?${id}_START\\s*\\]([\\s\\S]*?)\\[\\s*(?:\\d+\\s*\\.?\\s*)?_?${id}_END\\s*\\]`,
      'i',
    );
    const m = re.exec(text);
    if (m) out.push({ id, title: BLOCK_TITLE[id], content: m[1].trim() });
  }
  return out;
}

export interface TemplateIssue {
  id: TemplateBlockId;
  /** 'missing' = không thấy khối; 'empty' = có nhãn nhưng rỗng; 'unclosed' = có mở không có đóng. */
  kind: 'missing' | 'empty' | 'unclosed';
}

/**
 * Kiểm tra template: đủ 5 khối chưa, có nhãn nào mở mà quên đóng không, khối nào rỗng.
 * Trả về danh sách vấn đề — rỗng nghĩa là template hợp lệ.
 */
export function validateTemplate(text: string, expected: TemplateBlockId[] = BLOCK_ORDER): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const found = new Map(parseTemplateBlocks(text).map(b => [b.id, b]));

  for (const id of expected) {
    const block = found.get(id);
    if (block) {
      if (!block.content) issues.push({ id, kind: 'empty' });
      continue;
    }
    // Không parse được cặp đầy đủ → phân biệt "mở mà không đóng" với "không có gì".
    const hasStart = new RegExp(`\\[\\s*(?:\\d+\\s*\\.?\\s*)?_?${id}_START\\s*\\]`, 'i').test(text);
    issues.push({ id, kind: hasStart ? 'unclosed' : 'missing' });
  }
  return issues;
}
