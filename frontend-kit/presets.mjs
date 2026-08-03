/**
 * Hai preset Chat Completion đi kèm card front-end Eldran (bug 192).
 *
 * VÌ SAO KHÔNG CHÉP THẲNG 2 PRESET MẪU: preset mẫu của "Sân Khấu Quỷ Bí" nặng 3.3 MB,
 * trong đó có 18 KB quy tắc biến viết cho card đó, các thẻ định dạng riêng của nó
 * (`<开局>`, `<gametxt>`, `<当前线索>`…) và một bản sao 1.35 MB giao diện cũ nằm trong
 * `SPresetSettings.RegexBinding` (đã tắt sẵn). Đưa nguyên si sang Eldran thì AI sẽ nhận
 * hai bộ luật định dạng đá nhau — đúng cái bệnh của bug 198. Nên ở đây giữ nguyên
 * ĐÚNG SCHEMA preset (import vào SillyTavern là chạy), còn nội dung viết lại cho Eldran.
 *
 * Nguyên tắc chia việc, để không lặp lời với card:
 *   • Định dạng khối cập nhật biến ĐÃ nằm trong lorebook của card (entry #42/#43,
 *     constant:true nên lượt nào cũng được chèn) → preset CHỈ nhắc lại một dòng,
 *     không chép lại cả bảng, tránh hai nguồn luật mâu thuẫn.
 *   • Preset lo phần preset giỏi hơn: vai kể, độ dài, cấm đoạt vai, và cách cư xử
 *     khi lời kể được đổ vào một giao diện chứ không phải khung chat thường.
 */

const FE_BRIDGE = `<giao_dien>
Lời kể của bạn KHÔNG hiện trong khung chat thường của SillyTavern. Nó được đổ vào một
giao diện HTML do thẻ nhân vật dựng ra, ở khung "Khung hội thoại".

Vì vậy:
- Viết VĂN XUÔI THUẦN. Không dùng tiêu đề markdown (#, ##), không kẻ bảng, không chèn
  thẻ HTML, không chèn khối code, không tự vẽ thanh chỉ số bằng ký tự.
- Chỉ số của nhân vật đã có bảng riêng trong giao diện rồi. Đừng liệt kê lại HP/VP/kho đồ
  ở cuối lượt; cứ để phần cập nhật biến làm việc đó.
- Đậm (**...**), nghiêng (*...*), lời thoại trong ngoặc kép và dòng trích dẫn mở đầu bằng
  dấu ">" thì dùng được, giao diện có kết xuất.
- Người chơi gõ trực tiếp trong giao diện, mỗi lượt là một hành động của nhân vật họ.
</giao_dien>`;

const NO_HIJACK = `<khong_doat_vai>
{{user}} là của người chơi, không phải của bạn.
- Không viết suy nghĩ, cảm xúc, lời thoại hay quyết định của {{user}}.
- Không tóm tắt hộ "bạn quyết định đi về phía…". Dừng lại ở chỗ thế giới đã phản ứng xong
  và trả quyền quyết định về cho người chơi.
- Được phép mô tả hệ quả khách quan lên thân thể/đồ đạc của {{user}} (bị thương, mất đồ,
  cạn VP) vì đó là thế giới tác động vào, không phải ý chí của họ.
</khong_doat_vai>`;

const VAR_REMINDER = `<nhac_bien>
Card này chạy hệ biến MVU. Khối cập nhật biến phải nằm ở CUỐI mỗi lượt, đúng MỘT lần,
kể cả khi không có gì đổi (khi đó xuất mảng rỗng).

KHUNG BẮT BUỘC — sai một chữ là cả khối bị bỏ qua, người chơi mất sạch vật phẩm mà
không có thông báo nào:

<UpdateVariable>
<Analysis>… tóm tắt ngắn vì sao đổi …</Analysis>
<JSONPatch>
[ … các thao tác … ]
</JSONPatch>
</UpdateVariable>

- BẮT BUỘC có cặp thẻ JSONPatch bao quanh mảng. Xuất mảng trần là hỏng.
- Tên thao tác CHỈ được là: replace, delta, insert, remove, move.
  KHÔNG dùng "add", "set", "update", "increment" — đó là JSON Patch chuẩn, không phải bộ này.
- Đường dẫn phải chép ĐÚNG TỪNG CHỮ HOA VÀ DẤU của tên biến trong world info.
  Ví dụ đúng: /Kho Đồ/-   ·   sai: /Kho đồ/0, /kho_do/0, /Inventory/0
- Thêm phần tử mới vào mảng thì dùng dấu gạch ngang làm chỉ số: /Kho Đồ/-
- Kho đồ / kỹ năng / quan hệ là MẢNG: chỉ đụng đúng phần tử liên quan.
  CẤM replace nguyên cả mảng — làm thế là xoá sạch đồ của người chơi.
- Số thì dùng delta để cộng trừ, đừng replace bằng giá trị tự tính lại.
- Trường Container của vật phẩm phải là tên một túi chứa ĐANG CÓ trong Containers,
  không được bịa ra túi mới.
</nhac_bien>`;

const STYLE = `<van_phong>
Eldran là khoa học huyễn tưởng hậu tận thế: năng lượng Veil, phả hệ Shard, thợ săn Trấn Minh,
đảo bay, vết Rift. Giọng kể tỉnh táo, chi tiết cảm quan cụ thể (mùi kim loại nung, tiếng ù của
bức xạ Veil, ánh sáng lệch màu quanh vết Rift), tránh sáo ngữ tu tiên.

- Ngôi kể: ngôi thứ hai hướng về {{user}} ("bạn"), thì hiện tại.
- Mỗi lượt phải có ít nhất một chi tiết mới về thế giới mà lượt trước chưa nói.
- NPC có tên riêng, có mục đích riêng, không phải cái loa phát thông tin.
- Không kết thúc lượt bằng câu hỏi kiểu "Bạn sẽ làm gì?". Kết bằng một tình huống đang treo.
</van_phong>`;

function prompt(identifier, name, content, extra = {}) {
  return {
    identifier,
    name,
    system_prompt: true,
    role: 'system',
    content,
    injection_position: 0,
    injection_depth: 4,
    injection_order: 100,
    forbid_overrides: false,
    injection_trigger: [],
    ...extra,
  };
}

/** Các ô cắm sẵn của SillyTavern — phải có đủ, nếu không preset import vào sẽ thiếu chỗ. */
function builtins(mainContent) {
  return [
    prompt('main', '🎬 [Lõi] Quản Trò Eldran', mainContent, { forbid_overrides: true }),
    prompt('nsfw', 'NSFW Prompt', ''),
    prompt('dialogueExamples', 'Chat Examples', '', { marker: true }),
    prompt('jailbreak', 'Post-History Instructions', ''),
    prompt('chatHistory', 'Chat History', '', { marker: true }),
    prompt('worldInfoAfter', 'World Info (sau định nghĩa)', '', { marker: true }),
    prompt('worldInfoBefore', 'World Info (trước định nghĩa)', '', { marker: true }),
    prompt('enhanceDefinitions', 'Enhance Definitions', ''),
    prompt('charDescription', 'Mô tả nhân vật', '', { marker: true }),
    prompt('charPersonality', 'Tính cách nhân vật', '', { marker: true }),
    prompt('scenario', 'Bối cảnh', '', { marker: true }),
    prompt('personaDescription', 'Mô tả persona', '', { marker: true }),
  ];
}

const ORDER_BASE = [
  'main', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality',
  'scenario', 'enhanceDefinitions', 'nsfw', 'worldInfoAfter', 'dialogueExamples',
  'fe_bridge', 'fe_style', 'fe_nohijack', 'fe_var', 'fe_phase', 'chatHistory', 'jailbreak',
];

function order(identifiers) {
  return identifiers.map((identifier) => ({ identifier, enabled: true }));
}

function base(extraTop = {}) {
  return {
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    top_p: 0.95,
    top_k: 40,
    top_a: 1,
    min_p: 0,
    repetition_penalty: 1,
    openai_max_context: 1000000,
    openai_max_tokens: 8000,
    wrap_in_quotes: false,
    names_behavior: -1,
    send_if_empty: '',
    impersonation_prompt: '[System Note: Bạn là người kể, KHÔNG phải {{user}}. Chỉ mô tả thế giới quanh {{user}} rồi dừng.]',
    new_chat_prompt: '',
    new_group_chat_prompt: '',
    new_example_chat_prompt: '[Example Chat]',
    continue_nudge_prompt: '[Viết tiếp mạch đang dở, không mở tình tiết mới.]',
    bias_preset_selected: 'Default (none)',
    max_context_unlocked: true,
    wi_format: '[data:\n{0}]\n',
    scenario_format: '[Bối cảnh: {{scenario}}]',
    personality_format: '[Tính cách {{char}}: {{personality}}]',
    group_nudge_prompt: '[Viết lượt tiếp theo với vai {{char}}.]',
    stream_openai: true,
    assistant_prefill: '',
    assistant_impersonation: '',
    claude_use_sysprompt: false,
    use_makersuite_sysprompt: true,
    squash_system_messages: false,
    image_inlining: false,
    inline_image_quality: 'low',
    video_inlining: false,
    audio_inlining: false,
    continue_prefill: false,
    continue_postfix: ' ',
    function_calling: false,
    show_thoughts: false,
    reasoning_effort: 'high',
    enable_web_search: false,
    request_images: false,
    seed: -1,
    n: 1,
    ...extraTop,
  };
}

const MAIN_CORE = `<vai_tro>
Bạn là Quản Trò của Hành Tinh Eldran — vừa là người kể, vừa là trọng tài luật chơi.
Bạn cầm cả thế giới: thời tiết, NPC, phe phái, hậu quả. Bạn KHÔNG cầm {{user}}.

Nguyên tắc trọng tài:
- Thế giới có luật riêng và luật đó không nể người chơi. Hành động liều thì trả giá.
- Mọi con số (VP, Veil Essence, tiền, cấp hiệu) chỉ đổi khi có lý do đã kể ra trong lượt.
- Không đưa vật phẩm/kỹ năng "trên trời rơi xuống" nếu lời kể chưa dựng đường cho nó.
- Không tự nhảy thời gian nhiều ngày trừ khi người chơi nói rõ là muốn.
</vai_tro>`;

function makePreset(phaseName, phaseContent, top) {
  const prompts = [
    ...builtins(MAIN_CORE),
    prompt('fe_bridge', '🖥️ Giao diện front-end', FE_BRIDGE, { forbid_overrides: true }),
    prompt('fe_style', '🌫️ Văn phong Eldran', STYLE),
    prompt('fe_nohijack', '🛡️ Không đoạt vai người chơi', NO_HIJACK, { forbid_overrides: true }),
    prompt('fe_var', '💠 Nhắc khối cập nhật biến', VAR_REMINDER, { forbid_overrides: true }),
    prompt('fe_phase', phaseName, phaseContent, { forbid_overrides: true }),
  ];
  return {
    ...base(top),
    prompts,
    prompt_order: [
      { character_id: 100000, order: order(ORDER_BASE) },
      { character_id: 100001, order: order(ORDER_BASE) },
    ],
  };
}

const PHASE_OPENING = `<giai_doan_mo_man>
Đây là LƯỢT MỞ MÀN. Hồ sơ nhân vật vừa được bảng khởi tạo ghi thẳng vào biến, chính xác
từng chữ. Nhiệm vụ của bạn:

1. Dựng cảnh đầu tiên, dài rộng hơn một lượt thường (khoảng 500-800 từ): nơi chốn, thời
   tiết Veil, âm thanh, ít nhất một NPC có tên đang làm một việc cụ thể, và một sự việc
   đang diễn ra ngay lúc này chứ không phải sắp diễn ra.
2. Cài sẵn 2-3 hướng đi khác nhau cho người chơi, nhưng đừng liệt kê chúng thành danh sách
   — để chúng lộ ra qua chi tiết trong cảnh.
3. TUYỆT ĐỐI không đặt lại Tên, Tuổi, Phả Hệ, Thiên Phú, Cảnh Giới hay VP Tối Đa của nhân
   vật: đó là lựa chọn của người chơi, đã chốt rồi. Nếu thấy chúng "chưa hợp lý" thì hãy
   viết thế giới phản ứng với chúng, đừng sửa chúng.
4. Trong khối cập nhật biến cuối lượt: thêm 2-4 vật phẩm khởi đầu vào Kho Đồ (đủ mọi trường),
   1-2 kỹ năng hợp phả hệ vào Kỹ Năng (đủ mọi trường), NPC vừa xuất hiện vào Mối Quan Hệ,
   và ghi Thế Giới.Bối Cảnh thành một câu tóm tắt tình hình sau cảnh này.
</giai_doan_mo_man>`;

const PHASE_PLAY = `<giai_doan_choi>
Đây là một LƯỢT CHƠI bình thường. Người chơi vừa đưa ra một hành động.

1. Xử lý đúng hành động đó trước tiên: nó thành công tới đâu, thế giới đáp lại thế nào.
   Đừng lờ đi để kể sang chuyện khác.
2. Độ dài vừa phải, khoảng 300-500 từ. Đủ để có không khí, không lê thê.
3. Thời gian trôi hợp lý theo việc vừa làm (nói chuyện vài phút, đi bộ qua khu vực khác
   thì hàng giờ) và phải phản ánh đúng vào biến Giờ/Phút.
4. Nếu người chơi định làm điều vượt quá Cảnh Giới hoặc VP hiện có, cứ để họ thử và chịu
   hậu quả — đừng chặn bằng lời của người kể.
5. Cứ khoảng 4-6 lượt thì đẩy một biến cố của thế giới (phe phái, Mùa Rift, hợp đồng, NPC
   cũ quay lại) để mạch không đứng yên chờ người chơi.
</giai_doan_choi>`;

export function buildPresets() {
  return {
    khoiDau: makePreset('🚀 Giai đoạn: MỞ MÀN', PHASE_OPENING, {
      temperature: 1.0,
      openai_max_tokens: 12000,
    }),
    choiThe: makePreset('🎲 Giai đoạn: CHƠI', PHASE_PLAY, {
      temperature: 0.95,
      openai_max_tokens: 8000,
    }),
  };
}
