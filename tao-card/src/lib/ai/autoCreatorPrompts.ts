/**
 * autoCreatorPrompts.ts — System prompts cho từng bước pipeline
 * v3: Blueprint-aware, prompt override support
 */

import { MVU_WORKING_CARD_EXAMPLE } from '../mvuzod/mvuReference';
import type {
  CardKind,
  CardBlueprint,
  BasicInfoStepConfig,
  RegexStepConfig,
  MvuzodStepConfig,
  SystemPromptStepConfig,
  FirstMessageStepConfig,
  MesExampleStepConfig,
  PromptMode,
} from '../../types/autoCreator.types';

const JSON_FORMAT_REQUIREMENT = `
TRẢ VỀ KẾT QUẢ DƯỚI DẠNG JSON. CHỈ XUẤT JSON KHÔNG KÈM THEO BẤT KỲ VĂN BẢN NÀO KHÁC BÊN NGOÀI (KHÔNG CODE BLOCK, KHÔNG MARKDOWN).
`;

/** Apply user prompt override */
function applyOverride(basePrompt: string, override?: string, mode: PromptMode = 'default'): string {
  if (!override?.trim()) return basePrompt;
  switch (mode) {
    case 'replace': return override;
    case 'append': return `${basePrompt}\n\n--- YÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG ---\n${override}`;
    default: return basePrompt;
  }
}

/** Build blueprint context injection */
function blueprintContext(bp: CardBlueprint | null): string {
  if (!bp) return '';
  return `
--- CARD BLUEPRINT (Phase 0 Analysis) ---
Nhân vật: ${bp.characterProfile.name}
Xuất thân: ${bp.characterProfile.origin}
Ngoại hình: ${bp.characterProfile.appearance}
Tính cách: ${bp.characterProfile.personality}
Kỹ năng: ${bp.characterProfile.abilities.join(', ')}
Mối quan hệ: ${bp.characterProfile.relationships.join(', ')}

Thế giới: ${bp.worldStructure.genre} — ${bp.worldStructure.setting}
Hệ thống: ${bp.worldStructure.systems.join(', ')}
Thế lực: ${bp.worldStructure.factions.join(', ')}

Tone: ${bp.toneAndStyle.narrativeVoice}, ${bp.toneAndStyle.mood}
Ngôn ngữ: ${bp.toneAndStyle.language}
Độ phức tạp: ${bp.estimatedComplexity}
`;
}


/**
 * (Goal 104b — yêu cầu gốc của user) KHỐI CHỈ THỊ "THẺ GAME / THẾ GIỚI".
 * "chúng ta không phải là làm một card truyền thống (thẻ nhân vật) mà đây là gần như một game
 *  một thế giới hoàn chỉnh, bỏ System prompt".
 *
 * Chèn vào ĐẦU mọi prompt bước khi cardKind='game_world' — chỉ đổi lời văn thôi không đủ, phải
 * đổi hẳn thứ AI coi là "đối tượng chính": không phải một con người mà là một THẾ GIỚI VẬN HÀNH.
 */
export function gameWorldDirective(kind: CardKind | undefined): string {
  if (kind !== 'game_world') return '';
  return `
═══ ⚠️ ĐÂY KHÔNG PHẢI THẺ NHÂN VẬT — ĐÂY LÀ MỘT GAME / THẾ GIỚI HOÀN CHỈNH ═══
Người chơi KHÔNG trò chuyện với một nhân vật. Họ BƯỚC VÀO một thế giới và chơi trong đó; AI
đóng vai QUẢN TRÒ (narrator/game master) điều hành thế giới ấy.

VÌ VẬY, MỌI NỘI DUNG BẠN VIẾT PHẢI THEO HƯỚNG NÀY:
1. Chủ thể của thẻ là THẾ GIỚI + HỆ THỐNG, không phải một cá nhân. Không viết "cô ấy cao 1m65,
   thích ăn ngọt" như thẻ waifu; hãy viết luật vận hành, phe phái, tài nguyên, hiểm hoạ.
2. Phải có VÒNG LẶP CHƠI rõ ràng: người chơi làm gì mỗi lượt, thắng/thua/tiến bộ ra sao, cái gì
   đo được bằng chỉ số (biến MVU).
3. NPC là DÂN CƯ của thế giới — mỗi NPC gắn với địa điểm/phe/vai trò và có chỉ số, không phải
   nhân vật chính.
4. Người chơi là NHÂN VẬT CHÍNH. Nhân xưng hướng về {{user}} như người đang chơi.
5. Văn phong: quản trò khách quan, mô tả hậu quả hành động, đưa lựa chọn — KHÔNG nhập vai tán tỉnh.
6. KHÔNG dùng System prompt để chứa luật chơi: luật sống trong lorebook, entry [mvu_update] và
   giao diện. (Bước system_prompt đã bị bỏ khỏi pipeline ở chế độ này.)
`;
}

export function buildBasicInfoPrompt(idea: string, config: BasicInfoStepConfig, bp: CardBlueprint | null): string {
  const base = `
Bạn là chuyên gia tạo character card cho SillyTavern. Hãy tạo thông tin cơ bản cho nhân vật dựa trên ý tưởng sau.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

CẤU HÌNH:
- Ngôn ngữ: ${config.language}
- Bao gồm Personality: ${config.includePersonality}
- Bao gồm Scenario: ${config.includeScenario}

QUY TẮC QUAN TRỌNG VỀ ĐỊNH DẠNG "DESCRIPTION":
- Nếu ý tưởng yêu cầu tạo một Hệ thống (System), Game Master, Người Kể Chuyện (Narrator) hoặc môi trường Game/RPG: TUYỆT ĐỐI KHÔNG mô tả nó như một con người hay chatbot cá nhân (không ghi tên định danh cá nhân, ngoại hình, thực thể). Thay vào đó, mục "description" CHỈ TẬP TRUNG mô tả bối cảnh thế giới, văn phong, cơ chế game, giao diện và quy tắc vận hành.
- Nếu là thẻ nhân vật bình thường: Viết mô tả chi tiết, khách quan ở ngôi thứ 3.

Yêu cầu định dạng JSON chính xác:
{
  "name": "Tên nhân vật (ngắn gọn)",
  "description": "Mô tả nhân vật (nếu là nhân vật) HOẶC mô tả hệ thống/cơ chế/bối cảnh (nếu là System/Game Master). Tuân thủ đúng Quy tắc quan trọng ở trên (ít nhất 200 từ, ngôi 3, khách quan)",
  "personality": "Mô tả tính cách (nếu được yêu cầu, ít nhất 100 từ)",
  "scenario": "Bối cảnh hiện tại (nếu được yêu cầu, ít nhất 50 từ)"
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildLorebookBatchPrompt(idea: string, cardContext: string, bp: CardBlueprint | null, override?: string, mode: PromptMode = 'default'): string {
  const topicHints = bp?.suggestedEntryTopics
    ?.map(t => `- [${t.category}] ${t.title}: ${t.description} (priority: ${t.priority})`)
    .join('\n') ?? '';

  // (User 21/07 - bug 71) Truoc day chi "goi y" chu de nen AI tu do gop nhieu thuc the vao 1 entry
  // roi dung => lorebook thieu tram trong. Nay liet ke DANH SACH BAT BUOC PHU va cam gop.
  const mustCover = [
    ...(bp?.suggestedEntryTopics?.map(t => t.title) ?? []),
    ...(bp?.worldStructure?.factions ?? []),
    ...(bp?.worldStructure?.systems ?? []),
    ...(bp?.characterProfile?.relationships ?? []),
    ...(bp?.characterProfile?.abilities ?? []),
  ].map(x => String(x || '').trim()).filter(Boolean);
  const coverBlock = mustCover.length
    ? '\n--- DANH SÁCH THỰC THỂ BẮT BUỘC PHỦ (' + mustCover.length + ' mục) ---\n'
      + mustCover.map((t, i) => (i + 1) + '. ' + t).join('\n')
      + '\n[LỆNH]: MỖI mục trên PHẢI có ÍT NHẤT 1 entry RIÊNG. TUYỆT ĐỐI KHÔNG gộp nhiều thực thể vào chung 1 entry, KHÔNG bỏ sót mục nào.'
      + '\nLô này phải nhắm vào các mục CHƯA có trong "NGỮ CẢNH HIỆN TẠI" bên dưới — không viết lại thứ đã có.'
      + '\nKeys mỗi entry phải ĐẶC TRƯNG cho đúng thực thể đó (tên riêng + biệt danh của CHÍNH nó), tránh key chung chung khiến entry bị coi là trùng.\n'
    : '';

  const base = `
Đây là tiến trình tạo hàng loạt Lorebook tự động cho ý tưởng card sau:
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

${topicHints ? `--- CHỦ ĐỀ GỢI Ý TỪ BLUEPRINT ---\n${topicHints}\n` : ''}

${coverBlock}
NGỮ CẢNH HIỆN TẠI:
${cardContext}
`;
  // (Fix 19/07) Trước đây step lorebook là bước DUY NHẤT không gọi applyOverride — user điền
  // promptOverride cho lorebook mà không có tác dụng gì.
  return applyOverride(base, override, mode);
}

export function buildRegexPrompt(idea: string, cardContext: string, config: RegexStepConfig, bp: CardBlueprint | null, schemaContext?: string): string {
  // (User 19/07 — "tích hợp Regex và MVU xử lý chung") schema MVU được bơm TƯỜNG MINH:
  // regex dashboard phải dùng ĐÚNG tên biến schema trong data-var, không được bịa tên mới.
  const schemaBlock = schemaContext?.trim()
    ? `\n--- SCHEMA BIẾN MVU CỦA CARD (BẮT BUỘC BÁM THEO) ---\n${schemaContext}\nQUY TẮC: mọi thuộc tính data-var="..." trong replaceString PHẢI dùng ĐÚNG tên biến/đường dẫn ở schema trên. TUYỆT ĐỐI KHÔNG tự bịa tên biến mới.\n`
    : '';
  const base = `
Bạn là chuyên gia viết Regex Scripts cho SillyTavern. Dựa trên ý tưởng card và ngữ cảnh, hãy tạo ${config.count} regex scripts phù hợp.
Loại regex được yêu cầu: ${config.types.join(', ')}.

Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}
${schemaBlock}
NGỮ CẢNH:
${cardContext}

Yêu cầu định dạng JSON array:
[
  {
    "scriptName": "Tên script",
    "regex": "Mẫu regex cần tìm",
    "replaceString": "Chuỗi thay thế (có thể chứa HTML/CSS)",
    "placement": [1, 2],
    "minDepth": null,
    "maxDepth": null,
    "markdownOnly": false,
    "promptOnly": false
  }
]
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildMvuzodPrompt(idea: string, cardContext: string, config: MvuzodStepConfig, bp: CardBlueprint | null): string {
  const varHints = bp?.suggestedVariables
    ?.map(v => `- ${v.path} (${v.type}): ${v.description} [nhóm: ${v.group}]`)
    .join('\n') ?? '';

  const base = `
Bạn là chuyên gia về hệ thống biến trạng thái MVUZOD cho SillyTavern. Hãy tạo MVUZOD schema và các entries cần thiết.

${MVU_WORKING_CARD_EXAMPLE}

Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

${varHints ? `--- BIẾN GỢI Ý TỪ BLUEPRINT ---\n${varHints}\n` : ''}

NGỮ CẢNH LOREBOOK (đã tạo từ bước trước):
${cardContext}

CẤU HÌNH:
- Auto-detect từ lorebook: ${config.autoDetect}
- Tạo InitVar: ${config.createInitVar}
- Tạo Update Rules: ${config.createUpdateRules}
- Tạo Variable List: ${config.createVarList}

Yêu cầu định dạng JSON chính xác:
{
  "schema": {
    "version": "1.0",
    "fields": [
      {
        "path": "/Group/VarName",
        "type": "number|string|boolean",
        "label": "Tên hiển thị",
        "defaultValue": 0,
        "constraints": { "min": 0 },
        "description": "Mô tả cho AI"
      }
    ],
    "statRelations": [
      {
        "anchorPath": "/Nhân vật/Cảnh giới",
        "dependentPath": "/Nhân vật/Linh lực",
        "basis": "Căn cứ tổng, trích/diễn đạt lại từ mô tả ý tưởng hoặc lore ở trên",
        "landmarks": [
          { "anchor": "Luyện Khí", "plausibleMin": 10, "plausibleMax": 500, "note": "Căn cứ lore của riêng mốc này" }
        ]
      }
    ]
  },
  "initVarEntry": "Nội dung cho [initvar] dưới dạng YAML/JSON (nếu được yêu cầu)",
  "updateRulesEntry": "Cây YAML quy tắc cập nhật — xem QUY TẮC VỀ updateRulesEntry bên dưới",
  "varListEntry": "Nội dung hiển thị biến (nếu được yêu cầu)"
}

QUY TẮC BẮT BUỘC VỀ SCHEMA:
- MỌI field (kể cả field lồng trong "children") BẮT BUỘC phải có key "constraints" — nếu không có ràng buộc nào thì dùng object rỗng {}.
- "constraints.enumValues" (nếu dùng) phải là MẢNG chuỗi, ví dụ ["Thấp","Trung","Cao"].
- MỌI field phải có đủ "path", "type", "label", "defaultValue".
- PHẢI trả về dạng CÂY: field nhóm có "type": "object" và mảng "children" chứa field con, KHÔNG
  trả danh sách phẳng chỉ dựa vào dấu "/" trong "path". Bảng nhập liệu đầu game dựng trang theo
  "children" — trả phẳng thì người chơi không có ô nào để nhập. Ví dụ đúng:
  { "path": "/Nhân vật", "type": "object", "label": "Nhân vật", "defaultValue": {}, "constraints": {},
    "children": [ { "path": "/Nhân vật/Tên", "type": "string", "label": "Tên", "defaultValue": "", "constraints": {} } ] }
- Ít nhất vài field phải cho người chơi nhập (KHÔNG đặt "constraints.readOnly" hay "hidden" cho tất cả).

QUY TẮC VỀ RÀNG BUỘC SỐ HỌC (BẮT BUỘC — bugNeedFix/113):
Có HAI loại biến số, đừng lẫn:
  • ĐỒNG HỒ ĐO — có trần rõ ràng, ý nghĩa nằm ở TỈ LỆ so với trần: HP/máu, VP/năng lượng, độ hảo
    cảm, tiến độ %, thang sao 1-5, cấp độ 1-10. Loại này PHẢI ghi "min" và "max" đúng thang thật.
  • BỘ ĐẾM — tăng/giảm không có trần, ý nghĩa nằm ở CON SỐ: ngày/thời gian, tiền tệ, số lượng vật
    phẩm, điểm tích luỹ, kinh nghiệm, điểm cống hiến. Loại này chỉ ghi "min" (thường 0) và
    TUYỆT ĐỐI KHÔNG ghi "max" cũng không ghi "clamp".
KHÔNG áp bừa 0-100 cho mọi biến số. Kẹp trần 100 lên tiền hay ngày là lỗi nặng: chơi tới ngày 101
hay kiếm quá 100 đồng là giá trị bị cắt về 100, mất dữ liệu thật của người chơi.

QUY TẮC VỀ "statRelations" (RÀNG BUỘC MỀM GIỮA CHỈ SỐ LIÊN QUAN — đọc kỹ):
Nhiều chỉ số liên quan logic với nhau: cấp độ/cảnh giới ↔ năng lượng/linh lực, cấp độ ↔ tiền/
tài sản, cấp độ ↔ năm tu luyện/kinh nghiệm, danh vọng ↔ ảnh hưởng… Người chơi chọn cấp thấp mà
nhập năng lượng 99999 thì bảng nhập đầu game sẽ NHẮC NHẸ (không chặn) kèm căn cứ. Dữ liệu nhắc
lấy từ "statRelations" bạn khai ở đây. Luật BẮT BUỘC:
  • CHỈ tạo relation khi ý tưởng hoặc lore ở trên THẬT SỰ mô tả mối liên hệ đó (vd lore có hệ
    thống cảnh giới kèm mức sức mạnh). KHÔNG đủ căn cứ ⇒ trả mảng rỗng []. TUYỆT ĐỐI KHÔNG bịa
    công thức hay ước lượng suông để lấp chỗ trống.
  • CẤM công thức toán ("max = cấp × 10") và CẤM chia block máy móc đều tăm tắp (1-10 → 10-100,
    10-20 → 100-500…) — thứ đó biến thế giới thành game phổ thông. "landmarks" phải bám các mốc
    CÓ THẬT trong lore: tên cảnh giới (anchor là chuỗi đúng giá trị enum), hoặc khoảng cấp mà
    lore có nhắc (anchor là số hoặc [từ, đến]).
  • "basis" và "note" là CĂN CỨ hiện nguyên văn cho người chơi đọc — phải nói rõ dựa vào câu
    mô tả nào (vd "theo mô tả cảnh giới trong World Book, Trúc Cơ đã có thể ngự khí phi hành").
  • Đây là CẢNH BÁO MỀM: plausibleMin/plausibleMax là khoảng "thường thấy", KHÔNG phải giới hạn.
    Người chơi được quyền giữ giá trị lệch (nhân vật thiên tài, vật phẩm bị nguyền…).
  • anchorPath/dependentPath phải trùng "path" của field lá trong schema; trường phụ thuộc là
    chỉ số tiến triển mở ⇒ khai như BỘ ĐẾM (không "max").

QUY TẮC VỀ "updateRulesEntry" (BẮT BUỘC — đọc kỹ):
Đây KHÔNG phải đoạn văn xuôi. Viết một CÂY YAML, và phải có mục riêng cho TỪNG BIẾN LÁ trong
schema ở trên — không sót biến nào, không gộp bằng dấu "*", không dùng đường dẫn kiểu "/A/B".
Biến nào không có mục riêng thì AI trong game sẽ không bao giờ cập nhật nó, người chơi thấy chỉ
số đó đứng im cả ván.

Mỗi biến lá gồm:
  • type   — number / string / boolean (bỏ qua nếu không rõ)
  • range  — miền giá trị, ví dụ 0~100 hoặc 1~Infinity (chỉ cho số)
  • format — "Enum: A, B, C" nếu biến chỉ nhận vài giá trị cố định
  • check  — 2-3 gạch đầu dòng nói RÕ khi nào tăng, khi nào giảm, ràng buộc gì, bám đúng cốt
             truyện và cơ chế của thẻ này (đừng viết chung chung kiểu "cập nhật khi cần").

Mẫu đúng:
Quy tắc cập nhật biến:
  Thế Giới:
    Ngày:
      type: number
      range: 1~Infinity
      check:
        - Tăng 1 mỗi khi nhân vật ngủ qua đêm hoặc hết một chu kỳ sáng-đêm
        - Không tự nhảy ngày khi cảnh vẫn diễn ra liên tục
    Khung Giờ:
      format: "Enum: Sáng, Trưa, Chiều, Tối, Đêm"
      check:
        - Chuyển tuần tự theo thời lượng hành động trong cảnh
        - Tối/Đêm làm tỷ lệ quái vật xuất hiện cao hơn
  Chiến Đấu:
    VP Hiện Tại:
      type: number
      range: 0~VP Tối Đa
      check:
        - Dùng op 'delta' trừ khi dùng kỹ năng hoặc chịu sát thương
        - Hồi lại khi nghỉ ngơi hoặc dùng vật phẩm hồi phục
        - Rớt về 0 thì kích hoạt trạng thái kiệt sức, mô tả hệ quả trong truyện
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildSystemPromptPrompt(idea: string, cardContext: string, config: SystemPromptStepConfig, bp: CardBlueprint | null): string {
  const base = `
Hãy tạo system prompt hướng dẫn AI cách đóng vai nhân vật này. System prompt phải chi tiết, bao gồm quy tắc viết, phong cách, và các lưu ý quan trọng.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

CẤU HÌNH:
- Tạo Depth Prompt: ${config.includeDepthPrompt}
- Depth level: ${config.depthValue}

Yêu cầu định dạng JSON chính xác:
{
  "system_prompt": "Nội dung system prompt chi tiết (ít nhất 200 từ)",
  "depth_prompt": "Nội dung depth prompt (nếu có, ít nhất 100 từ)"
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildFirstMessagePrompt(
  idea: string,
  cardContext: string,
  config: FirstMessageStepConfig,
  bp: CardBlueprint | null,
  /**
   * (bug 116) Card có Opening Form: tin nhắn đầu LÀ giao diện điền thông tin, nên KHÔNG cần
   * kèm một bài văn mở màn dài — người chơi điền form → bấm Xác nhận → sao chép hồ sơ gửi
   * làm tin nhắn đầu, AI mở màn dựa trên hồ sơ đó. Văn dài đứng cạnh form vừa thừa vừa
   * mâu thuẫn với bối cảnh người chơi sẽ chọn. (Không TẮT bước này — tắt bật thủ công làm
   * tool rối với người mới; bước tự thích nghi là đủ.)
   */
  hasOpeningForm = false,
): string {
  const base = hasOpeningForm
    ? `
Card này có OPENING FORM: tin nhắn đầu tiên hiển thị giao diện để người chơi điền thông tin nhân
vật, chọn bối cảnh, rồi gửi hồ sơ làm tin nhắn mở đầu. Vì vậy first_mes KHÔNG ĐƯỢC là bài văn
mở màn dài — nó chỉ là lời dẫn NGẮN (2-4 câu) chào mừng vào thế giới và mời điền form bên dưới.
TUYỆT ĐỐI không viết cảnh truyện, không thoại nhân vật, không mô tả dài dòng.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

Yêu cầu định dạng JSON chính xác:
{
  "first_mes": "Lời dẫn ngắn 2-4 câu (giới thiệu không khí thế giới + mời thiết lập nhân vật ở form bên dưới)...",
  "alternate_greetings": []
}
LƯU Ý: alternate_greetings để MẢNG RỖNG — mở màn thật sự do AI viết sau khi người chơi gửi hồ sơ,
nhiều lời chào phụ chỉ gây lệch với bối cảnh người chơi chọn trong form.
${JSON_FORMAT_REQUIREMENT}
`
    : `
Hãy tạo first message mở đầu câu chuyện và ${config.alternateGreetings} alternate greetings.
First message phải viết chi tiết, sống động, mô tả bối cảnh, hành động và cảm xúc nhân vật.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

Yêu cầu định dạng JSON chính xác:
{
  "first_mes": "Lời mở đầu chính (ít nhất 150 từ, viết theo ngôi và tone phù hợp)...",
  "alternate_greetings": [
    "Lời mở đầu phụ 1 (khác bối cảnh/mood)...",
    "Lời mở đầu phụ 2..."
  ]
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildMesExamplePrompt(idea: string, cardContext: string, config: MesExampleStepConfig, bp: CardBlueprint | null): string {
  const base = `
Hãy tạo ${config.exampleCount} đoạn hội thoại mẫu (Message Examples) giữa {{user}} và {{char}}.
Mỗi đoạn phải thể hiện tính cách nhân vật, phong cách viết, và format đối thoại.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

Yêu cầu định dạng JSON chính xác:
{
  "mes_example": "<START>\\n{{user}}: ...\\n{{char}}: ...\\n<START>\\n{{user}}: ...\\n{{char}}: ..."
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}
