/**
 * presetBuilder — hai preset Chat Completion đi kèm thẻ front-end (bug 192).
 * ─────────────────────────────────────────────────────────────────────────────
 * JS thuần có chủ ý: dùng chung cho app Tạo Card và bộ dựng dòng lệnh.
 *
 * VÌ SAO KHÔNG CHÉP PRESET MẪU: preset của "Sân Khấu Quỷ Bí" nặng 3,3 MB, trong đó có
 * 18 KB quy tắc biến viết riêng cho thẻ đó, các thẻ định dạng riêng của nó, và một bản sao
 * 1,35 MB giao diện cũ nằm trong SPresetSettings.RegexBinding (đã tắt sẵn). Bê nguyên sang
 * thẻ khác thì AI nhận hai bộ luật định dạng đá nhau — đúng bệnh của bug 198. Ở đây giữ
 * ĐÚNG SCHEMA preset (import vào SillyTavern là chạy), nội dung viết lại theo thẻ.
 *
 * Chia việc để không lặp lời với thẻ: định dạng khối cập nhật biến thường đã nằm trong
 * lorebook (entry constant, lượt nào cũng chèn). Nhưng đo được khi chạy thật là mô hình
 * VẪN trôi khỏi định dạng đó, nên preset nêu lại KHUNG BẮT BUỘC — chỉ khung, không chép
 * cả bảng quy tắc.
 */

function feBridge(title) {
  return `<giao_dien>
Lời kể của bạn KHÔNG hiện trong khung chat thường của SillyTavern. Nó được đổ vào một
giao diện HTML do thẻ "${title}" dựng ra, ở khung "Khung hội thoại".

Vì vậy:
- Viết VĂN XUÔI THUẦN. Không dùng tiêu đề markdown, không kẻ bảng, không chèn thẻ HTML,
  không chèn khối code, không tự vẽ thanh chỉ số bằng ký tự.
- Chỉ số đã có bảng riêng trong giao diện. Đừng liệt kê lại ở cuối lượt; phần cập nhật
  biến lo việc đó rồi.
- Đậm, nghiêng, lời thoại trong ngoặc kép, và dòng trích dẫn mở đầu bằng dấu lớn hơn —
  giao diện có kết xuất, dùng được.
- Người chơi gõ trực tiếp trong giao diện; mỗi lượt là một hành động của nhân vật họ.
</giao_dien>`;
}

const NO_HIJACK = `<khong_doat_vai>
{{user}} là của người chơi, không phải của bạn.
- Không viết suy nghĩ, cảm xúc, lời thoại hay quyết định của {{user}}.
- Không tóm tắt hộ kiểu "bạn quyết định đi về phía…". Dừng ở chỗ thế giới đã phản ứng xong
  và trả quyền quyết định về cho người chơi.
- Được phép mô tả hệ quả khách quan lên thân thể/đồ đạc của {{user}} — đó là thế giới tác
  động vào, không phải ý chí của họ.
</khong_doat_vai>`;

function varReminder(updateTag) {
  return `<nhac_bien>
Khối cập nhật biến phải nằm ở CUỐI mỗi lượt, đúng MỘT lần, kể cả khi không có gì đổi
(khi đó xuất mảng rỗng).

KHUNG BẮT BUỘC — sai một chữ là cả khối bị bỏ qua, người chơi mất sạch vật phẩm mà không
có thông báo nào:

<${updateTag}>
<Analysis>… tóm tắt ngắn vì sao đổi …</Analysis>
<JSONPatch>
[ … các thao tác … ]
</JSONPatch>
</${updateTag}>

- BẮT BUỘC có cặp thẻ JSONPatch bao quanh mảng. Xuất mảng trần là hỏng.
- Tên thao tác CHỈ được là: replace, delta, insert, remove, move.
  KHÔNG dùng "add", "set", "update", "increment" — đó là JSON Patch chuẩn, không phải bộ này.
- Đường dẫn phải chép ĐÚNG TỪNG CHỮ HOA VÀ DẤU của tên biến trong world info.
- Thêm phần tử mới vào danh sách thì dùng dấu gạch ngang làm chỉ số.
- Danh sách (kho đồ / kỹ năng / quan hệ) chỉ được đụng đúng phần tử liên quan.
  CẤM replace nguyên cả danh sách — làm thế là xoá sạch đồ của người chơi.
- Số thì dùng delta để cộng trừ, đừng replace bằng giá trị tự tính lại.
- Bịa ra đường dẫn không có trong thẻ thì lệnh bị bỏ qua và chỉ số sẽ đứng yên.
</nhac_bien>`;
}

function styleBlock(title, subtitle) {
  return `<van_phong>
Bối cảnh: ${title}${subtitle ? ' — ' + subtitle : ''}.

- Ngôi kể: ngôi thứ hai hướng về {{user}}, thì hiện tại.
- Chi tiết cảm quan cụ thể thay vì tính từ chung chung.
- Mỗi lượt phải có ít nhất một chi tiết mới về thế giới mà lượt trước chưa nói.
- NPC có tên riêng, có mục đích riêng, không phải cái loa phát thông tin.
- Không kết lượt bằng câu hỏi kiểu "Bạn sẽ làm gì?". Kết bằng một tình huống đang treo.
</van_phong>`;
}

function mainCore(title) {
  return `<vai_tro>
Bạn là Quản Trò của "${title}" — vừa là người kể, vừa là trọng tài luật chơi.
Bạn cầm cả thế giới: thời tiết, NPC, phe phái, hậu quả. Bạn KHÔNG cầm {{user}}.

Nguyên tắc trọng tài:
- Thế giới có luật riêng và luật đó không nể người chơi. Hành động liều thì trả giá.
- Mọi con số chỉ đổi khi có lý do đã kể ra trong lượt.
- Không đưa vật phẩm/kỹ năng "trên trời rơi xuống" nếu lời kể chưa dựng đường cho nó.
- Không tự nhảy thời gian nhiều ngày trừ khi người chơi nói rõ là muốn.
</vai_tro>`;
}

const PHASE_OPENING = `<giai_doan_mo_man>
Đây là LƯỢT MỞ MÀN. Hồ sơ nhân vật vừa được bảng khởi tạo ghi thẳng vào biến, chính xác
từng chữ. Nhiệm vụ của bạn:

1. Dựng cảnh đầu tiên, dài rộng hơn một lượt thường (khoảng 500-800 từ): nơi chốn, thời
   tiết, âm thanh, ít nhất một NPC có tên đang làm một việc cụ thể, và một sự việc đang
   diễn ra ngay lúc này chứ không phải sắp diễn ra.
2. Cài sẵn 2-3 hướng đi khác nhau, nhưng đừng liệt kê thành danh sách — để chúng lộ ra
   qua chi tiết trong cảnh.
3. TUYỆT ĐỐI không đặt lại những trường mà bảng khởi tạo đã chốt. Thấy chúng "chưa hợp lý"
   thì hãy viết thế giới phản ứng với chúng, đừng sửa chúng.
4. Trong khối cập nhật biến cuối lượt: thêm trang bị, kỹ năng và NPC khởi đầu hợp lý vào
   các danh sách tương ứng, đủ mọi trường; và ghi một câu tóm tắt tình hình sau cảnh này.
</giai_doan_mo_man>`;

const PHASE_PLAY = `<giai_doan_choi>
Đây là một LƯỢT CHƠI bình thường. Người chơi vừa đưa ra một hành động.

1. Xử lý đúng hành động đó trước tiên: nó thành công tới đâu, thế giới đáp lại thế nào.
   Đừng lờ đi để kể sang chuyện khác.
2. Độ dài vừa phải, khoảng 300-500 từ. Đủ để có không khí, không lê thê.
3. Thời gian trôi hợp lý theo việc vừa làm, và phải phản ánh đúng vào biến thời gian.
4. Người chơi định làm điều vượt quá năng lực hiện có thì cứ để họ thử và chịu hậu quả —
   đừng chặn bằng lời của người kể.
5. Cứ khoảng 4-6 lượt thì đẩy một biến cố của thế giới để mạch không đứng yên chờ người chơi.
</giai_doan_choi>`;

function prompt(identifier, name, content, extra) {
  return Object.assign({
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
  }, extra || {});
}

/** Các ô cắm sẵn của SillyTavern — phải có đủ, thiếu là preset import vào bị hụt chỗ. */
function builtins(mainContent) {
  return [
    prompt('main', '🎬 [Lõi] Quản Trò', mainContent, { forbid_overrides: true }),
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

function baseParams(extraTop) {
  return Object.assign({
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
  }, extraTop || {});
}

function makePreset(meta, phaseName, phaseContent, top) {
  const prompts = builtins(mainCore(meta.title)).concat([
    prompt('fe_bridge', '🖥️ Giao diện front-end', feBridge(meta.title), { forbid_overrides: true }),
    prompt('fe_style', '🌫️ Văn phong', styleBlock(meta.title, meta.subtitle), {}),
    prompt('fe_nohijack', '🛡️ Không đoạt vai người chơi', NO_HIJACK, { forbid_overrides: true }),
    prompt('fe_var', '💠 Khung khối cập nhật biến', varReminder(meta.updateTag), { forbid_overrides: true }),
    prompt('fe_phase', phaseName, phaseContent, { forbid_overrides: true }),
  ]);
  const order = ORDER_BASE.map((identifier) => ({ identifier, enabled: true }));
  return Object.assign(baseParams(top), {
    prompts,
    prompt_order: [
      { character_id: 100000, order },
      { character_id: 100001, order },
    ],
  });
}

/**
 * @param {{ title: string, subtitle?: string, updateTag: string }} meta
 * @returns {{ khoiDau: object, choiThe: object, names: { khoiDau: string, choiThe: string } }}
 */
export function buildPresets(meta) {
  const m = {
    title: (meta && meta.title) || 'Thẻ nhập vai',
    subtitle: (meta && meta.subtitle) || '',
    updateTag: (meta && meta.updateTag) || 'UpdateVariable',
  };
  return {
    khoiDau: makePreset(m, '🚀 Giai đoạn: MỞ MÀN', PHASE_OPENING, { temperature: 1.0, openai_max_tokens: 12000 }),
    choiThe: makePreset(m, '🎲 Giai đoạn: CHƠI', PHASE_PLAY, { temperature: 0.95, openai_max_tokens: 8000 }),
    names: {
      khoiDau: `【Khởi Đầu】${m.title} Front-End`,
      choiThe: `【Chơi Thẻ】${m.title} Front-End`,
    },
  };
}
