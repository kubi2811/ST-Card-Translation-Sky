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
 * (Làm tiếp việc 87 — bằng chứng thứ HAI: thẻ One Piece 224 entry trong bug/116, thẻ MVU
 * tiếng Việt user xác nhận đang chạy tốt) Tập op mà MVU THỰC SỰ hỗ trợ, chép nguyên văn từ
 * entry "[mvu_update]Định Dạng Xuất Biến" của thẻ đó:
 *     replace · delta · insert (dùng `-` làm chỉ mục mảng để thêm vào cuối) · remove · move
 *
 * LỖ ĐÃ BỊT: đây KHÔNG phải RFC 6902 nguyên bản. RFC có `add`/`test`/`copy` — model nào quen
 * JSON Patch chuẩn sẽ hồn nhiên xuất "op":"add", mà op đó không nằm trong danh sách MVU nhận.
 * Trước giờ không chỗ nào trong tool chốt tập op này nên chẳng ai bắt được.
 */
export const MVU_PATCH_OPS = ['replace', 'delta', 'insert', 'remove', 'move'] as const;

/** Op RFC 6902 mà MVU KHÔNG hỗ trợ → gợi ý thay thế, dùng cho cả bộ kiểm lẫn prompt. */
export const MVU_UNSUPPORTED_OPS: Record<string, string> = {
  add: 'dùng "insert" (chèn vào object/mảng, chỉ mục "-" là thêm vào cuối)',
  test: 'bỏ hẳn — MVU không có op kiểm điều kiện',
  copy: 'dùng "replace" với giá trị chép tay',
};

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
 * (Làm tiếp việc 87) Soi các op xuất hiện trong nội dung dạy AI: op nào KHÔNG thuộc tập MVU
 * hỗ trợ thì báo kèm cách thay. Ca thật cần bắt: nội dung ví dụ dùng "op":"add" theo RFC —
 * AI học theo, patch trong game bị MVU bỏ qua im lặng, biến không đổi mà chẳng có lỗi nào.
 */
export function checkMvuPatchOps(text: string): { ok: boolean; bad: { op: string; hint: string }[] } {
  const s = String(text || '');
  const bad: { op: string; hint: string }[] = [];
  const seen = new Set<string>();
  for (const m of s.matchAll(/"op"\s*:\s*"([a-zA-Z_]+)"/g)) {
    const op = m[1];
    if ((MVU_PATCH_OPS as readonly string[]).includes(op) || seen.has(op)) continue;
    seen.add(op);
    bad.push({ op, hint: MVU_UNSUPPORTED_OPS[op] ?? `không nằm trong tập MVU hỗ trợ (${MVU_PATCH_OPS.join('/')})` });
  }
  return { ok: bad.length === 0, bad };
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
- CHỈ dùng đúng 5 op MVU hỗ trợ: replace / delta / insert / remove / move (đối chiếu từ 2 thẻ
  thật đang chạy). Đây KHÔNG phải RFC 6902 nguyên bản — TUYỆT ĐỐI KHÔNG dùng "add"/"test"/"copy":
  cần thêm phần tử thì dùng "insert" (chỉ mục mảng "-" = thêm vào cuối).
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

/* ═══════════════════════════════════════════════════════════════════════════════
 * (Goal 100.1 — 24/07) HỢP ĐỒNG ĐỐI CHIẾU TỪ SOURCE MVU THẬT
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần trên đúc từ card thật (quan sát bên ngoài). Phần dưới đây đúc từ CHÍNH SOURCE
 * của extension MagVarUpdate (bugNeedFix/mvu-reference/ — clone từ GitHub
 * MagicalAstrogy/MagVarUpdate). Không còn phải đoán: đây là những gì engine THẬT SỰ làm.
 * File nguồn dẫn chiếu ghi cạnh từng mục. Mọi generator/validator/harness của tool
 * import từ đây — MỘT nguồn sự thật, ba nơi (sinh, kiểm, giả lập) không bao giờ lệch.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Marker entry mà engine dò trong `comment` — regex NGUYÊN VĂN từ src/variable_def.ts:316.
 * Khớp bất kỳ đâu trong comment, không phân biệt hoa thường. `[initvar]` do luồng nạp
 * biến đọc (initvar/variable_init.ts), 2 cái sau lọc entry khi build prompt.
 */
export const MVU_ENTRY_MARKERS = {
  initvar: /\[initvar\]/i,
  update: /\[mvu_update\]/i,
  plot: /\[mvu_plot\]/i,
} as const;

/**
 * HAI PHƯƠNG NGỮ CẬP NHẬT ĐỀU HỢP LỆ (src/function/update/invoke_extra_model.ts:351-354):
 * engine chấp nhận khối <UpdateVariable> chứa HOẶC lệnh hàm `_.set(...)` HOẶC JSON Patch —
 * `fn_call_match || json_patch_match`. Tool SINH ra JSONPatch (nhất quán, dễ kiểm), nhưng
 * bộ KIỂM card ngoài phải chấp nhận cả hai — bắt card `_.set` là báo lỗi oan.
 *
 * Lệnh hàm được parse bằng MÁY TRẠNG THÁI đếm ngoặc (update_variables.ts:269-380),
 * KHÔNG phải regex thô — chuỗi lồng `_.set('a',["x);"])` vẫn parse đúng. Danh sách lệnh:
 * `_.set(path, new)` · `_.set(path, old, new)` · `_.insert(path, [idx,] value)` ·
 * `_.delete(path[, key])` · `_.add(path, delta)` (số hoặc mốc thời gian ms) ·
 * `_.assign(path, [key,] value)` · `_.move(from, to)`.
 * Giá trị số: chuỗi số tự ép về number (update_variables.ts:791).
 */
export const MVU_UPDATE_DIALECTS = ['json_patch', 'function_call'] as const;
/** Regex nhận diện phương ngữ trong một khối update — mirror invoke_extra_model.ts:351-352. */
export const MVU_DIALECT_RE = {
  functionCall: /_\.(set|insert|delete|add|assign|remove|move)\s*\(/,
  jsonPatch: /json_?patch/i,
} as const;

/** Một khối <UpdateVariable> có được ENGINE THẬT chấp nhận không (chuẩn nhận card NGOÀI —
 * lỏng hơn checkMvuOutputContract vốn là chuẩn CHẶT cho card tool tự sinh). */
export function isMvuUpdateBlockAccepted(block: string): boolean {
  const s = String(block || '');
  return MVU_DIALECT_RE.functionCall.test(s) || MVU_DIALECT_RE.jsonPatch.test(s);
}

/**
 * INITVAR — cách engine THẬT nạp biến (initvar/variable_init.ts + util/common.ts:parseString):
 * - Thử YAML trước (bật merge `<<:`), fallback JSON5, fallback JSON đã qua jsonrepair.
 *   → viết YAML là chuẩn nhất, nhưng JSON cũng chạy.
 * - Nạp từ MỌI lorebook đang bật (global + primary + additional của nhân vật), merge dần.
 * - Khối `<initvar>...</initvar>` trong LỜI MỞ ĐẦU (first_mes) — nếu có — ĐÈ toàn bộ
 *   [initvar] của worldbook nhân vật (variable_init.ts:154-171). Card tự sinh không nên
 *   dùng cả hai kiểu cùng lúc kẻo khó lần.
 * - Giá trị chấp nhận cả TRẦN (`Máu: 100`) lẫn CẶP MÔ TẢ `[100, "máu tối đa 100"]`
 *   (ValueWithDescription — variable_def.ts:52): cập nhật chỉ ghi đè phần tử [0], giữ mô tả.
 * - `$meta` trên node: `extensible` (cho phép thêm khoá mới), `recursiveExtensible`,
 *   `required`, `template` (mẫu tự điền khi thêm phần tử). Gốc thêm được `strictTemplate`,
 *   `concatTemplateArray`, `strictSet` (variable_def.ts:5-11, 87-91).
 * - Từ initvar engine TỰ SINH `schema` (function/schema.ts:generateSchema) và lưu vào
 *   MvuData cạnh stat_data — tool không cần (và không nên) tự chế schema khác kiểu.
 * - Biến của MỖI TẦNG TIN NHẮN (type:'message'), không phải chatvar toàn cục: cấu trúc
 *   MvuData = { initialized_lorebooks, stat_data, schema, display_data?, delta_data? }.
 */
export const MVU_INITVAR_NOTES = 'xem docblock MVU_INITVAR — nguồn: mvu-reference/src/function/initvar/';

/**
 * API MẶT TIỀN (Opening Form / Status Bar) — LỜI GIẢI CHO BUG #162.
 * Nguồn: src/function/global/index.ts. Extension gắn đối tượng `Mvu` lên `window.parent`
 * (script thẻ chạy trong iframe của TavernHelper) và phát event `global_Mvu_initialized`.
 *
 * ĐỌC biến (Status Bar):
 *   const d = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
 *   // giá trị: _.get(d.stat_data, 'Người Chơi.Máu') — nếu là cặp [value, desc] thì lấy [0]
 *
 * GHI biến (Opening Form) — 2 đường đều đúng:
 *   // a) qua parseMessage (được khuyên dùng — đi đúng luồng lệnh, có event, có clamp rule):
 *   const nd = await Mvu.parseMessage(`_.set('Người Chơi.Tên', 'A');//form`, d);
 *   await Mvu.replaceMvuData(nd, { type: 'message', message_id: 'latest' });
 *   // b) sửa thẳng rồi thay: _.set(d, 'stat_data.X', v); await Mvu.replaceMvuData(d, ...);
 *
 * TUYỆT ĐỐI KHÔNG dùng /setvar hay getvar của SillyTavern cho biến MVU — đó là kho biến
 * KHÁC, ghi vào đấy thì stat_data không hề đổi (đúng hiện tượng bug #162: form nhập xong
 * trình quản lý biến không thấy gì, status bar không cập nhật).
 *
 * Script nên chờ Mvu sẵn sàng:  if (!window.parent.Mvu) await new Promise(r =>
 *   eventOn('global_Mvu_initialized', r));
 *
 * Event lắng nghe được (variable_def.ts:175-242): 'mag_variable_initialized',
 * 'mag_variable_update_started', 'mag_command_parsed' (sửa/chèn lệnh trước khi áp),
 * 'mag_variable_update_ended' (clamp giá trị sau cập nhật), 'mag_before_message_update'.
 * Event gọi từ ngoài (variable_def.ts:114-119): 'mag_invoke_mvu', 'mag_update_variable'.
 *
 * Yêu cầu môi trường: TavernHelper (酒馆助手) ≥ 3.4.17 (src/main.ts:18).
 */
export const MVU_FRONTEND_API = {
  globalObject: 'Mvu',
  attachedTo: 'window.parent',
  readyEvent: 'global_Mvu_initialized',
  read: 'Mvu.getMvuData({ type, message_id })',
  write: 'Mvu.parseMessage(cmds, data) → Mvu.replaceMvuData(newData, { type, message_id })',
  events: {
    initialized: 'mag_variable_initialized',
    updateStarted: 'mag_variable_update_started',
    commandParsed: 'mag_command_parsed',
    updateEnded: 'mag_variable_update_ended',
    beforeMessageUpdate: 'mag_before_message_update',
    invoke: 'mag_invoke_mvu',
    updateVariable: 'mag_update_variable',
  },
  minTavernHelper: '3.4.17',
} as const;

/**
 * LUỒNG "额外模型" (model phụ phân tích biến) — nguồn của lỗi đỏ
 * "[MVU额外模型解析]变量更新失败" trong bug 72/75: khi card bật chế độ model phụ, MỘT model
 * riêng nhận ngữ cảnh + PHẢI trả về khối <UpdateVariable> hợp lệ (một trong hai phương ngữ).
 * Không tìm thấy thẻ → lỗi "没有能从回复中找到<UpdateVariable>标签"; thấy thẻ nhưng lệnh
 * không hợp lệ → "其内的更新命令无效" (invoke_extra_model.ts:333-360). Chế độ
 * "格式化输出" thì trả JSON {"analysis","json_patch"} theo json_schema thay vì thẻ.
 * → final_check của tool phải kiểm ĐÚNG các điều kiện này trên entry [mvu_update].
 */
export const MVU_EXTRA_MODEL_ERRORS = {
  noTag: '没有能从回复中找到<UpdateVariable>标签',
  invalidCommands: '其内的更新命令无效',
} as const;
