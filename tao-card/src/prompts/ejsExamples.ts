/**
 * src/prompts/ejsExamples.ts — Few-shot examples cho AI EJS generation
 * Mỗi category có 2-3 ví dụ hoàn chỉnh để AI tham khảo phong cách.
 */

import type { EJSTemplateCategory } from './ejsPrompt';

export interface EJSExample {
  title: string;
  description: string;
  code: string;
}

export const EJS_FEWSHOT_EXAMPLES: Record<EJSTemplateCategory, EJSExample[]> = {
  conditional_entry: [
    {
      title: '[getwi] Controller phức tạp — load entries theo era + NPC',
      description: 'Strategy getwi cho card 100+ entries: đọc biến era, scan chat tìm NPC, load entries theo điều kiện',
      code: `@@preprocessing
<%_
// ═══ Đọc biến điều khiển chính ═══
var _era = getvar('stat_data.Trạng thái thế giới.Thời đại hiện tại', { defaults: 'Phần 1' });
var _area = getvar('stat_data.Trạng thái thế giới.Khu vực', { defaults: '' });

// ═══ Scan chat messages gần nhất ═══
var _txt = '';
var _um = getChatMessages(-1, 'user');
var _am = getChatMessages(-1, 'assistant');
if (_um) { var _un = Math.min(3, _um.length); for (var _i = _um.length - _un; _i < _um.length; _i++) { _txt += _um[_i] + ' '; } }
if (_am) { var _an = Math.min(3, _am.length); for (var _j = _am.length - _an; _j < _am.length; _j++) { _txt += _am[_j] + ' '; } }
var _f = (_area || '') + ' ' + _txt;

// ═══ Bảng ánh xạ NPC theo era ═══
var _nm = {};
if (_era === 'Phần 1') {
  _nm = { "Nhân vật A": 'Nhân vật A', "Biệt danh A": 'Nhân vật A', "Nhân vật B": 'Nhân vật B' };
} else if (_era === 'Phần 2') {
  _nm = { "Nhân vật C": 'Nhân vật C', "Nhân vật D": 'Nhân vật D' };
}

// ═══ Tìm NPC trong chat ═══
var _npcs = [];
for (var alias in _nm) {
  if (_f.includes(alias) && _npcs.indexOf(_nm[alias]) === -1) _npcs.push(_nm[alias]);
}
_%>

<%# ═══ Load entries thế giới theo era ═══ %>
<%- await getwi(null, _era + ': Cục diện thế giới') %>
<%- await getwi(null, _era + ': Niên biểu cốt truyện') %>

<%# ═══ Load NPC entries khi được nhắc đến ═══ %>
<%_ for (var _n = 0; _n < _npcs.length; _n++) { _%>
<%- await getwi(null, _era + ': ' + _npcs[_n]) %>
<%_ } _%>

<%# ═══ Load entries theo keyword context ═══ %>
<%_ if (_f.includes('Chiến đấu') || _f.includes('Đánh nhau')) { _%>
<%- await getwi(null, 'Quy tắc chiến đấu') %>
<%_ } _%>`,
    },
    {
      title: '[setEntryEnabled] Bật/tắt entry đơn giản',
      description: 'Strategy setEntryEnabled cho card <50 entries: bật/tắt trực tiếp theo biến',
      code: `@@preprocessing
<%_
var era = getvar('stat_data.Trạng thái thế giới.Thời đại hiện tại', { defaults: 'Hiện đại' });

setEntryEnabled('WB: Thiết lập cổ đại', era === 'Cổ đại');
setEntryEnabled('WB: Thiết lập hiện đại', era === 'Hiện đại');
setEntryEnabled('WB: Thiết lập tương lai', era === 'Tương lai');
_%>`,
    },
    {
      title: '[setEntryEnabled] Bật entry theo combo điều kiện',
      description: 'Kết hợp nhiều biến để quyết định entry nào bật',
      code: `@@preprocessing
<%_
var mood = getvar('stat_data.Nhân vật.Tâm trạng', { defaults: 'Bình thường' });
var location = getvar('stat_data.Thế giới.Địa điểm', { defaults: 'Nhà' });
var hp = Number(getvar('stat_data.Nhân vật.HP', { defaults: 100 }));
var maxHp = Number(getvar('stat_data.Nhân vật.MaxHP', { defaults: 100 }));
var ratio = maxHp > 0 ? hp / maxHp : 1;

// Toggle theo HP
setEntryEnabled('WB: Trạng thái nguy kịch', ratio < 0.2);
setEntryEnabled('WB: Trạng thái bị thương', ratio >= 0.2 && ratio < 0.5);

// Toggle theo mood
setEntryEnabled('WB: Persona giận dữ', mood === 'Tức giận');
setEntryEnabled('WB: Persona buồn bã', mood === 'Buồn');

// Combo: sự kiện đặc biệt ban đêm
var timeOfDay = getvar('stat_data.Thế giới.Thời gian', { defaults: 'Ngày' });
setEntryEnabled('WB: Sự kiện ma quỷ', location === 'Nghĩa địa' && timeOfDay === 'Đêm');
_%>`,
    },
    {
      title: '[getwi] Load entry theo context keyword + matchChatMessages',
      description: 'Dùng matchChatMessages() và keyword scan để load entries theo nội dung chat',
      code: `@@preprocessing
<%_
var _era = getvar('stat_data.Trạng thái.Era', { defaults: 'Era 1' });

// matchChatMessages scan 2 tin gần nhất
_%>

<%# Load hệ thống chiến đấu khi nhắc đến %>
<%_ if (matchChatMessages(['chiến đấu', 'tấn công', 'đánh', 'kỹ năng'])) { _%>
<%- await getwi(null, _era + ': Hệ thống chiến đấu') %>
<%_ } _%>

<%# Load hệ thống giao dịch khi nhắc đến %>
<%_ if (matchChatMessages(['mua', 'bán', 'giao dịch', 'tiền'])) { _%>
<%- await getwi(null, _era + ': Hệ thống giao dịch') %>
<%_ } _%>

<%# Load entries theo stat value %>
<%_
var soulLevel = Number(getvar('stat_data.Nhân vật.Hồn lực', { defaults: 10 }));
if (soulLevel >= 95) {
_%>
<%- await getwi(null, 'Thiết lập cấp bậc thượng thần') %>
<%_ } _%>`,
    },
  ],

  dynamic_content: [
    {
      title: 'Mô tả trạng thái động & ngoại hình nhân vật',
      description: 'Đọc HP, tâm trạng, vũ khí và sinh text mô tả động, in thẳng bằng print() — nội dung rơi đúng vị trí/độ sâu của chính entry',
      code: `@@preprocessing
<%_
var hp = Number(getvar('stat_data.Nhân vật.HP', { defaults: 100 }));
var maxHp = Number(getvar('stat_data.Nhân vật.MaxHP', { defaults: 100 }));
var ratio = maxHp > 0 ? hp / maxHp : 1;
var mood = getvar('stat_data.Nhân vật.Tâm trạng', { defaults: 'Bình thường' });
var weapon = getvar('stat_data.Nhân vật.Vũ khí', { defaults: 'Không' });

var desc = [];
if (ratio < 0.2) desc.push('đang kiệt sức, thở hổn hển, cơ thể rướm máu');
else if (ratio < 0.5) desc.push('có vài vết thương nhẹ, hơi đau đớn');

if (mood === 'Tức giận') desc.push('đôi mắt đỏ rực giận dữ, răng nghiến chặt');
else if (mood === 'Sợ hãi') desc.push('run rẩy, mắt liên tục liếc nhìn xung quanh');

if (weapon !== 'Không') desc.push('tay nắm chặt ' + weapon);

if (desc.length > 0) {
  /* print() chứ KHÔNG phải injectPrompt({text, position, depth}): chữ ký thật là
     injectPrompt(key, prompt, order, sticky, uid) và nó không tự vào prompt. */
  print('[Ngoại hình {{char}} lúc này: ' + desc.join(', ') + ']');
}
_%>`,
    },
    {
      title: 'Load mô tả cảnh quan động bằng getwi',
      description: 'Đọc biến địa điểm và load mô tả bối cảnh chi tiết từ entries disabled',
      code: `@@preprocessing
<%_
var location = getvar('stat_data.Thế giới.Khu vực', { defaults: 'Phòng khách' });
_%>
<%# Tự động load entry mô tả tương ứng %>
<%- await getwi(null, 'Mô tả cảnh: ' + location) %>`,
    },
  ],

  stat_reader: [
    {
      title: 'YAML Auto-display (khuyên dùng)',
      description: 'Dùng YAML.stringify tự động in ra toàn bộ biến trạng thái game cho AI biết mà không cần cấu hình thủ công',
      code: `@@preprocessing
[== TRẠNG THÁI TRẬN ĐẤU ==]
<%= YAML.stringify(getvar('stat_data'), { blockQuote: 'literal' }) %>
[== END ==]`,
    },
    {
      title: 'Đọc stats hiển thị dạng bảng đẹp',
      description: 'Chỉ đọc và hiển thị các biến quan trọng, bỏ qua biến ẩn',
      code: `@@preprocessing
<%_
var hp = getvar('stat_data.Nhân vật.HP', { defaults: 100 });
var mp = getvar('stat_data.Nhân vật.MP', { defaults: 50 });
var level = getvar('stat_data.Nhân vật.Level', { defaults: 1 });
var gold = getvar('stat_data.Nhân vật.Gold', { defaults: 0 });

print('═══ THÔNG TIN NHÂN VẬT ═══');
print('⚡ Level: ' + level);
print('❤️ HP: ' + hp + ' | 🧪 MP: ' + mp);
print('💰 Gold: ' + gold + 'G');
print('══════════════════════════');
_%>`,
    },
  ],

  multi_stage: [
    {
      title: '[getwi] Load persona theo giai đoạn thân mật',
      description: '4 giai đoạn persona lưu trong entries riêng biệt, load và inject vào cuối chat context',
      code: `@@preprocessing
<%_
var affinity = Number(getvar('stat_data.Nhân vật.Độ thân mật', { defaults: 0 }));

var stage = 'Lạnh lùng';
if (affinity >= 25 && affinity < 50) stage = 'Quen thuộc';
else if (affinity >= 50 && affinity < 75) stage = 'Thân thiện';
else if (affinity >= 75) stage = 'Gắn bó';

// Load entry persona của stage hiện tại
var personaContent = await getwi(null, 'Persona: ' + stage);

// In ra tại chỗ — vị trí do cấu hình position/depth của chính entry quyết định
if (personaContent) {
  print('[Hành vi & Cách nói của {{char}} lúc này: ' + personaContent.trim() + ']');
}
_%>`,
    },
    {
      title: 'Inline persona thay đổi cách xưng hô',
      description: 'Thay đổi cách {{char}} nói chuyện trực tiếp theo trạng thái tình cảm',
      code: `@@preprocessing
<%_
var status = getvar('stat_data.Nhân vật.Quan hệ', { defaults: 'Người lạ' });
var speech = '';

if (status === 'Kẻ thù') {
  speech = '{{char}} xưng hô cộc lốc mày-tao, dùng nhiều từ ngữ khiêu khích, khinh bỉ {{user}}.';
} else if (status === 'Vợ chồng') {
  speech = '{{char}} xưng hô thân mật anh-em/chồng-vợ ngọt ngào, thường dùng kính ngữ yêu thương.';
} else {
  speech = '{{char}} xưng hô lịch sự tôi-bạn, giữ khoảng cách chừng mực.';
}

print('[Cách nói chuyện của {{char}}: ' + speech + ']');
_%>`,
    },
  ],

  variable_display: [
    {
      title: 'Hiển thị bảng biến dạng YAML & filter biến private',
      description: 'Hiển thị toàn bộ stat dạng YAML, tự động lọc bỏ các biến private bắt đầu bằng dấu gạch dưới _',
      code: `@@preprocessing
<%_
var data = getvar('stat_data');
var filtered = {};

function cleanObj(src, dest) {
  for (var key in src) {
    if (src.hasOwnProperty(key) && key.charAt(0) !== '_') {
      var val = src[key];
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        dest[key] = {};
        cleanObj(val, dest[key]);
      } else {
        dest[key] = val;
      }
    }
  }
}

if (data) {
  cleanObj(data, filtered);
}
_%>
[== TRẠNG THÁI HIỆN TẠI ==]
<%= YAML.stringify(filtered, { blockQuote: 'literal' }) %>
[== END ==]`,
    },
  ],

  custom: [
    {
      title: 'Time-based content & System event',
      description: 'Lấy giờ thực tế và số tin nhắn chat để kích hoạt event đặc biệt hoặc bonus chỉ số',
      code: `@@preprocessing
<%_
var hours = (new Date()).getHours();
var isNight = hours >= 18 || hours < 6;
var msgId = TavernHelper.getLastMessageId();

// Ban đêm tăng chỉ số bóng tối hoặc kích hoạt mô tả
if (isNight) {
  print('[🌙 Bối cảnh: Đêm đã khuya. Ánh trăng mờ ảo chiếu rọi xung quanh.]');
}

// Mỗi 10 lượt chat, bonus ngẫu nhiên gold hoặc exp
if (msgId > 0 && msgId % 10 === 0) {
  var gold = Number(getvar('stat_data.Nhân vật.Gold', { defaults: 0 }));
  var bonus = _.random(5, 20);
  setvar('stat_data.Nhân vật.Gold', gold + bonus);
  toastr.success('Bonus +' + bonus + ' Gold sau 10 lượt trò chuyện!');
}
_%>`,
    },
    {
      title: 'Regex pattern trigger bằng matchChatMessages',
      description: 'Dùng RegExp scan chat để load entry chiến đấu tương ứng khi user tung chiêu',
      code: `@@preprocessing
<%_
// Phát hiện user dùng skill thông qua cú pháp: [Tấn công], [Chiêu thức], v.v.
var skillUsed = matchChatMessages([/\\[Tấn công\\]/i, /\\[Chiêu thức\\]/i]);
_%>

<%_ if (skillUsed) { _%>
<%- await getwi(null, 'Hệ thống phản đòn chiến đấu') %>
<%_ } _%>`,
    },
  ],
};

/**
 * Format few-shot examples cho injection vào prompt.
 */
export function formatExamplesForPrompt(category: EJSTemplateCategory): string {
  const examples = EJS_FEWSHOT_EXAMPLES[category];
  if (!examples || examples.length === 0) return '';

  const formatted = examples.map((ex, i) => (
    `--- Ví dụ ${i + 1}: ${ex.title} ---
Mô tả: ${ex.description}
\`\`\`
${ex.code}
\`\`\``
  )).join('\n\n');

  return `=== VÍ DỤ THAM KHẢO (${examples.length} examples) ===
Tham khảo phong cách viết từ các ví dụ dưới đây. KHÔNG copy y nguyên — hãy adapt theo schema và yêu cầu cụ thể.

${formatted}`;
}
