/**
 * src/lib/mvuzod/mvuReference.ts — ĐỊNH DẠNG MVU CHUẨN, ĐÚC TỪ CARD THẬT ĐANG CHẠY ĐƯỢC.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 23/07 — việc 87) "Auto Creator tạo xong vẫn còn bị lỗi đỏ của MVU. Hay cho con AI nó
 * học thêm các card có MVU hoạt động được thử xem."
 *
 * Soi ra thì phần lớn KHÔNG PHẢI lỗi của AI — chính BỘ SINH TẤT ĐỊNH của tool xuất sai định
 * dạng. `generateOutputFormatEntry` đang sinh ra:
 *     <UpdateVariable>
 *     [ {"op":"replace", ...} ]        ← mảng JSON ĐỂ TRẦN
 *     </UpdateVariable>
 * trong khi MVU đọc mảng lệnh BÊN TRONG <JSONPatch>. Để trần là parse không ra. Nên mọi thẻ
 * Auto Creator tạo đều dính đúng cái ❌ "Khối <UpdateVariable> THIẾU thẻ con <Analysis>
 * và/hoặc <JSONPatch>" — AI không hề có cơ hội làm đúng.
 *
 * ─── ĐỐI CHIẾU CARD THẬT (bug/MODDED_Tìm kiếm Ngụy nhân) ───
 *     <UpdateVariable>
 *       <Analysis>$(IN ENGLISH, no more than 160 words)
 *       - Time: day/period change?
 *       - Resources: ammo/drink/food/water deltas
 *       ...
 *       </Analysis>
 *       <JSONPatch>
 *       [
 *         {"op":"replace","path":"/Thế Giới/Ngày","value":1},
 *         ...
 *       ]
 *       </JSONPatch>
 *     </UpdateVariable>
 *
 * Card đó cũng cho thấy vài điều đáng học khác:
 *  - entry [InitVar] để `enabled: false, constant: true` (bật thì MVU không nhận làm template);
 *  - initvar viết YAML với giá trị TRẦN — MVU chấp nhận cả giá trị trần lẫn cặp
 *    [giá_trị, "mô tả"], nên bộ đọc phải bóc được cả hai (xem mvuRuntime.ts);
 *  - đường dẫn trong patch giữ NGUYÊN tên biến tiếng Việt có dấu và khoảng trắng.
 */

/** Tên thẻ bắt buộc — dùng chung cho bộ sinh, bộ kiểm và prompt, để ba nơi không bao giờ lệch. */
export const MVU_TAGS = {
  root: 'UpdateVariable',
  analysis: 'Analysis',
  patch: 'JSONPatch',
} as const;

/**
 * Khối đầu ra đúng chuẩn. `sampleOps` là các lệnh patch mẫu (mỗi phần tử một dòng JSON).
 * Phần <Analysis> viết bằng tiếng Anh + giới hạn độ dài đúng như card thật: model suy luận
 * bằng tiếng Anh ngắn gọn thì ra patch chính xác hơn, mà lại không tốn token của phần truyện.
 */
export function buildMvuOutputBlock(sampleOps: string[]): string {
  const ops = sampleOps.length ? sampleOps : ['{"op":"replace","path":"/Nhóm/Biến","value":"giá trị mới"}'];
  return [
    `<${MVU_TAGS.root}>`,
    `  <${MVU_TAGS.analysis}>$(IN ENGLISH, no more than 160 words)`,
    '  - What changed this turn? (time / location / relationship / resources)',
    '  - Numbers: show the math for every delta',
    '  - New records: list every field being inserted',
    `  </${MVU_TAGS.analysis}>`,
    `  <${MVU_TAGS.patch}>`,
    '  [',
    ops.map(o => `    ${o}`).join(',\n'),
    '  ]',
    `  </${MVU_TAGS.patch}>`,
    `</${MVU_TAGS.root}>`,
  ].join('\n');
}

/**
 * Kiểm một đoạn nội dung có đúng hợp đồng với engine MVU không.
 * Dùng CHUNG với báo cáo Kiểm tra tổng thể để bộ sinh và bộ kiểm không thể lệch nhau —
 * đúng cái đã xảy ra: bộ sinh xuất một kiểu, bộ kiểm đòi một kiểu, không ai phát hiện.
 */
export function checkMvuOutputContract(text: string): { ok: boolean; missing: string[] } {
  const s = String(text || '');
  const missing: string[] = [];
  if (!new RegExp(`<${MVU_TAGS.root}>`, 'i').test(s)) missing.push(MVU_TAGS.root);
  if (!new RegExp(`<${MVU_TAGS.analysis}>`, 'i').test(s)) missing.push(MVU_TAGS.analysis);
  if (!new RegExp(`<${MVU_TAGS.patch}>`, 'i').test(s)) missing.push(MVU_TAGS.patch);
  return { ok: missing.length === 0, missing };
}

/**
 * Ví dụ CÓ THẬT để nhét vào prompt — dạy bằng mẫu chạy được thay vì chỉ dặn suông.
 * Rút gọn từ card trong bug/ nhưng giữ nguyên cấu trúc và cách đặt tên biến tiếng Việt.
 */
export const MVU_WORKING_CARD_EXAMPLE = `
=== MẪU MVU LẤY TỪ THẺ THẬT ĐANG CHẠY ĐƯỢC — LÀM THEO ĐÚNG CẤU TRÚC NÀY ===

【1. Entry khởi tạo biến】comment "[InitVar] Vui lòng không mở" — BẮT BUỘC enabled=false, constant=true.
Bật lên là MVU không nhận nó làm template, vào game báo "变量更新失败". Nội dung YAML:
'Thế Giới':
  'Ngày': 1
  'Khung Giờ': Sáng
  'Thời Tiết': Âm u
'Người Chơi':
  'Máu': 100
  'Thể Lực': 100

【2. Entry định dạng đầu ra】comment bắt đầu bằng "[mvu_update]". Đây là chỗ HAY SAI NHẤT —
mảng lệnh phải nằm TRONG <JSONPatch>, để trần là MVU parse không ra:
<UpdateVariable>
  <Analysis>$(IN ENGLISH, no more than 160 words)
  - Time: day/period change?
  - Resources: deltas with the math shown
  - New records: every field inserted
  </Analysis>
  <JSONPatch>
  [
    {"op":"replace","path":"/Thế Giới/Ngày","value":2},
    {"op":"delta","path":"/Người Chơi/Máu","value":-15}
  ]
  </JSONPatch>
</UpdateVariable>

【3. Entry quy tắc cập nhật】comment bắt đầu bằng "[mvu_update]", liệt kê từng biến được phép
đổi thế nào, giới hạn giá trị, khi nào tăng/giảm.

【QUY TẮC RÚT RA】
- Đường dẫn patch giữ NGUYÊN tên biến tiếng Việt có dấu và khoảng trắng: "/Thế Giới/Ngày".
  KHÔNG bỏ dấu, KHÔNG đổi sang snake_case, KHÔNG dịch sang tiếng Anh.
- op "delta" chỉ dùng cho SỐ và value là số trần (không có nháy).
- Biến bắt đầu bằng _ là chỉ đọc, không bao giờ patch.
- Không có gì đổi thì vẫn xuất khối, với mảng rỗng [].
`.trim();

/** Luật ngắn gọn bơm kèm khi nhờ AI sinh/sửa phần MVU. */
export const MVU_FORMAT_RULES = [
  'ĐỊNH DẠNG ĐẦU RA BIẾN (sai là card hỏng, vào game báo "变量更新失败"):',
  `khối <${MVU_TAGS.root}> PHẢI có đủ HAI thẻ con <${MVU_TAGS.analysis}> và <${MVU_TAGS.patch}>.`,
  `Mảng lệnh JSON nằm TRONG <${MVU_TAGS.patch}> — để trần trong <${MVU_TAGS.root}> là MVU không bóc được.`,
  'Entry khởi tạo biến phải TẮT (enabled=false) thì MVU mới đọc làm template.',
].join('\n');
