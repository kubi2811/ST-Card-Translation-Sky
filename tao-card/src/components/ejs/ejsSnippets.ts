/**
 * EJS Template Snippets — shared constants
 * Extracted to separate file to avoid Fast Refresh issues
 */

export const EJS_SNIPPETS = [
  {
    id: 'multi-stage',
    label: 'Multi-stage Persona',
    description: 'Thay đổi tính cách AI theo mức độ (ví dụ: 好感度)',
    code: `<%_
if (typeof _affinity === 'undefined') var _affinity = Number(getvar('stat_data.Nhân vật.Cảm xúc.Độ thân mật', { defaults: 0 }));

if (_affinity < 40) {
  print('【{{char}} hiện tại rất dè dặt, không muốn giao tiếp nhiều】');
} else if (_affinity < 80) {
  print('【{{char}} đã quen bạn, sẵn sàng trò chuyện thoải mái】');
} else {
  print('【{{char}} rất thân thiết với bạn, thường kể chuyện riêng tư】');
}
_%>`,
  },
  {
    id: 'variable-display',
    label: 'Variable Display',
    description: 'Hiển thị danh sách biến hiện tại cho AI đọc',
    code: `[Trạng thái hiện tại]
Thời gian: <%= getvar('stat_data.Thế giới.Thời gian hiện tại') %>
Địa điểm: <%= getvar('stat_data.Thế giới.Địa điểm hiện tại') %>
HP: <%= getvar('stat_data.Nhân vật.HP') %> / <%= getvar('stat_data.Nhân vật.MaxHP') %>
Gold: <%= getvar('stat_data.Nhân vật.Gold') %>`,
  },
  {
    id: 'conditional-inject',
    label: 'Conditional Worldbook',
    description: 'Bật entry theo điều kiện — các entry này phải để TẮT sẵn trong worldbook',
    code: `@@preprocessing
<%_
/* (bug 125/128) ST-Prompt-template KHÔNG có hàm tắt entry từ EJS — chỉ BẬT được entry
   đang tắt bằng await activewi(tên, true). Vậy 3 entry dưới đây phải để enabled=false
   sẵn trong worldbook; mỗi lượt chat controller chỉ bật đúng cái khớp thời đại. */
if (typeof _era === 'undefined') var _era = getvar('stat_data.Thế giới.Thời đại', { defaults: 'Hiện đại' });

if (_era === 'Hiện đại') { await activewi('WB: Thiết lập thế giới hiện đại', true); }
if (_era === 'Cổ đại') { await activewi('WB: Thiết lập thế giới cổ đại', true); }
if (_era === 'Tương lai') { await activewi('WB: Thiết lập thế giới tương lai', true); }
_%>`,
  },
  {
    id: 'inject-prompt',
    label: '@INJECT Prompt',
    description: 'Inject prompt vào vị trí cụ thể trong context',
    code: `@@preprocessing
<%_
if (typeof _scene === 'undefined') var _scene = getvar('stat_data.Thế giới.Loại cảnh', { defaults: 'Hàng ngày' });

// Inject prompt vào system position
injectPrompt({
  text: \`Hiện tại đang là cảnh \${_scene}. Hãy điều chỉnh phong cách viết phù hợp.\`,
  position: 'in_chat',
  depth: 4,
  scan: true,
});
_%>`,
  },
  {
    id: 'getwi-template',
    label: 'getwi() Template',
    description: 'Đọc và tổ chức worldbook entries theo nhóm',
    code: `<%_
/* getwi là hàm ASYNC — thiếu await thì nhận về Promise, in ra "[object Promise]". */
var skillList = await getwi('Danh sách kỹ năng');
var inventory = await getwi('Kho đồ');

if (skillList) {
  print('[Kỹ năng đã học]\\n');
  print(skillList);
}

if (inventory) {
  print('\\n[Vật phẩm trong túi]\\n');
  print(inventory);
}
_%>`,
  },
];

// ─── ADVANCED TEMPLATES (Phase 3) ───────────────────────────────────────────

export interface EJSAdvancedTemplate {
  id: string;
  label: string;
  description: string;
  category: 'flow' | 'ui' | 'mvu' | 'event' | 'advanced';
  tags: string[];
  code: string;
}

export const EJS_ADVANCED_TEMPLATES: EJSAdvancedTemplate[] = [
  // ── Control Flow ──
  {
    id: 'adv-multi-era-switch',
    label: 'Multi-era Switch',
    description: 'Bật đúng nhóm entry của era hiện tại (toàn bộ entry era phải TẮT sẵn)',
    category: 'flow',
    tags: ['era', 'switch', 'activewi'],
    code: `@@preprocessing
<%_
/* (bug 125/128) Mô hình đúng của ST-Prompt-template: KHÔNG có API tắt entry từ EJS.
   Để TẤT CẢ entry era ở trạng thái tắt (enabled=false) trong worldbook — thế là "tắt
   tất cả" miễn phí, không cần code — rồi mỗi lượt chỉ BẬT nhóm của era hiện tại. */
var era = getvar('stat_data.Thế giới.Thời đại', { defaults: 'Hiện đại' });

var eraMap = {
  'Cổ đại': ['WB: Cổ đại', 'WB: Vũ khí cổ', 'WB: Ma thuật cổ'],
  'Trung cổ': ['WB: Trung cổ', 'WB: Hiệp sĩ', 'WB: Phong kiến'],
  'Hiện đại': ['WB: Hiện đại', 'WB: Công nghệ', 'WB: Thành phố'],
  'Tương lai': ['WB: Tương lai', 'WB: Cyberpunk', 'WB: AI Technology'],
};

if (eraMap[era]) {
  for (var j = 0; j < eraMap[era].length; j++) {
    await activewi(eraMap[era][j], true);
  }
}
_%>`,
  },
  {
    id: 'adv-threshold-cascade',
    label: 'Threshold Cascade',
    description: 'Bật entries cascade theo ngưỡng stat (HP thấp → entries nguy hiểm)',
    category: 'flow',
    tags: ['threshold', 'cascade', 'HP', 'danger'],
    code: `@@preprocessing
<%_
var hp = Number(getvar('stat_data.Nhân vật.HP', { defaults: 100 }));
var maxHp = Number(getvar('stat_data.Nhân vật.MaxHP', { defaults: 100 }));
var ratio = maxHp > 0 ? hp / maxHp : 1;
var danger = Number(getvar('stat_data.Thế giới.Mức nguy hiểm', { defaults: 0 }));

/* Cascade: càng nguy hiểm càng nhiều entry được BẬT (cả 4 entry phải TẮT sẵn —
   EJS không tắt được entry, chỉ bật entry đang tắt bằng await activewi). */
if (ratio > 0.5 && danger < 30) { await activewi('WB: Trạng thái bình thường', true); }
if (ratio <= 0.5 || danger >= 30) { await activewi('WB: Cẩn thận', true); }
if (ratio <= 0.3 || danger >= 60) { await activewi('WB: Nguy hiểm', true); }
if (ratio <= 0.1 || danger >= 90) { await activewi('WB: Sắp chết', true); }

// Inject cảnh báo cho AI
if (ratio <= 0.2) {
  print('[⚠️ CẢNH BÁO: {{char}} sắp chết! HP=' + hp + '/' + maxHp + ']');
}
_%>`,
  },
  {
    id: 'adv-combo-condition',
    label: 'Combo Conditions',
    description: 'Kết hợp nhiều biến để tạo điều kiện phức tạp',
    category: 'flow',
    tags: ['combo', 'condition', 'multiple'],
    code: `@@preprocessing
<%_
var mood = getvar('stat_data.Nhân vật.Tâm trạng', { defaults: 'Bình thường' });
var location = getvar('stat_data.Thế giới.Địa điểm', { defaults: 'Nhà' });
var time = getvar('stat_data.Thế giới.Thời gian', { defaults: 'Ngày' });
var trust = Number(getvar('stat_data.Nhân vật.Độ tin tưởng', { defaults: 50 }));

/* Ba entry combo dưới đây phải TẮT sẵn trong worldbook — controller chỉ BẬT khi đủ điều kiện. */
var intimateMode = (mood === 'Buồn' || mood === 'Cô đơn') && time === 'Đêm' && location === 'Nhà';
if (intimateMode && trust > 60) { await activewi('WB: Hội thoại tâm sự', true); }

var restrainMode = mood === 'Tức giận' && (location === 'Trường học' || location === 'Công ty');
if (restrainMode) { await activewi('WB: Persona kiềm chế', true); }

var dateMode = mood === 'Vui vẻ' && time === 'Ngày' && trust > 80;
if (dateMode) { await activewi('WB: Sự kiện hẹn hò', true); }
_%>`,
  },

  // ── UI / Display ──
  {
    id: 'adv-stat-bar',
    label: 'Stat Bar Display',
    description: 'Hiển thị thanh HP/MP bằng ký tự Unicode',
    category: 'ui',
    tags: ['bar', 'HP', 'MP', 'unicode'],
    code: `@@preprocessing
<%_
function makeBar(current, max, length, fillChar, emptyChar) {
  var ratio = max > 0 ? current / max : 0;
  var filled = Math.round(ratio * length);
  var empty = length - filled;
  var bar = '';
  for (var i = 0; i < filled; i++) bar += fillChar;
  for (var j = 0; j < empty; j++) bar += emptyChar;
  return bar;
}

var hp = Number(getvar('stat_data.Nhân vật.HP', { defaults: 100 }));
var maxHp = Number(getvar('stat_data.Nhân vật.MaxHP', { defaults: 100 }));
var mp = Number(getvar('stat_data.Nhân vật.MP', { defaults: 50 }));
var maxMp = Number(getvar('stat_data.Nhân vật.MaxMP', { defaults: 50 }));

print('┌─────────────────┐');
print('│ ❤️ HP: ' + hp + '/' + maxHp);
print('│ ' + makeBar(hp, maxHp, 15, '█', '░'));
print('│ 💙 MP: ' + mp + '/' + maxMp);
print('│ ' + makeBar(mp, maxMp, 15, '█', '░'));
print('└─────────────────┘');
_%>`,
  },
  {
    id: 'adv-relationship-display',
    label: 'Relationship Status',
    description: 'Hiển thị trạng thái quan hệ với NPC',
    category: 'ui',
    tags: ['relationship', 'NPC', 'affinity'],
    code: `@@preprocessing
<%_
var affinity = Number(getvar('stat_data.Quan hệ.Độ thân mật', { defaults: 0 }));
var trust = Number(getvar('stat_data.Quan hệ.Độ tin tưởng', { defaults: 50 }));
var romance = Number(getvar('stat_data.Quan hệ.Lãng mạn', { defaults: 0 }));

function getEmoji(val) {
  if (val >= 80) return '💖';
  if (val >= 60) return '😊';
  if (val >= 40) return '🙂';
  if (val >= 20) return '😐';
  return '😒';
}

function getLevel(val) {
  if (val >= 90) return 'Rất thân thiết';
  if (val >= 70) return 'Thân thiết';
  if (val >= 50) return 'Quen biết';
  if (val >= 30) return 'Sơ giao';
  return 'Xa lạ';
}

print('[Quan hệ với {{user}}]');
print(getEmoji(affinity) + ' Thân mật: ' + affinity + '/100 (' + getLevel(affinity) + ')');
print((trust > 50 ? '🤝' : '🤨') + ' Tin tưởng: ' + trust + '/100');
if (romance > 20) {
  print('💝 Lãng mạn: ' + romance + '/100');
}
_%>`,
  },
  {
    id: 'adv-inventory-display',
    label: 'Inventory Display',
    description: 'Hiển thị kho đồ dạng bảng gọn gàng',
    category: 'ui',
    tags: ['inventory', 'items', 'display'],
    code: `@@preprocessing
<%_
var gold = Number(getvar('stat_data.Nhân vật.Gold', { defaults: 0 }));
var weapon = getvar('stat_data.Trang bị.Vũ khí', { defaults: 'Không' });
var armor = getvar('stat_data.Trang bị.Giáp', { defaults: 'Không' });
var accessory = getvar('stat_data.Trang bị.Phụ kiện', { defaults: 'Không' });

print('╔══ TRANG BỊ ══╗');
print('│ ⚔️ ' + weapon);
print('│ 🛡️ ' + armor);
print('│ 💍 ' + accessory);
print('│ 💰 ' + gold + 'G');
print('╚══════════════╝');
_%>`,
  },

  // ── MVU / State ──
  {
    id: 'adv-mvu-full-read',
    label: 'MVU Full State Reader',
    description: 'Đọc toàn bộ MVU state và xuất dạng structured',
    category: 'mvu',
    tags: ['MVU', 'state', 'getMvuData', 'full'],
    code: `@@preprocessing
<%_
var data = Mvu.getMvuData({type:'message', message_id:'latest'});
var stats = data?.stat_data ?? {};

var lines = ['[== TRẠNG THÁI GAME ==]'];

function printObj(obj, indent) {
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      var val = obj[key];
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        lines.push(indent + '【' + key + '】');
        printObj(val, indent + '  ');
      } else if (Array.isArray(val)) {
        lines.push(indent + key + ': [' + val.join(', ') + ']');
      } else {
        lines.push(indent + key + ': ' + String(val));
      }
    }
  }
}

printObj(stats, '');
lines.push('[== END ==]');
print(lines.join('\\n'));
_%>`,
  },
  {
    id: 'adv-mvu-delta',
    label: 'MVU Delta Detector',
    description: 'Phát hiện thay đổi state giữa 2 messages',
    category: 'mvu',
    tags: ['MVU', 'delta', 'change', 'compare'],
    code: `@@preprocessing
<%_
var latest = Mvu.getMvuData({type:'message', message_id:'latest'});
var prev = Mvu.getMvuData({type:'message', message_id:'previous'});

if (latest && prev) {
  var latestStats = latest.stat_data ?? {};
  var prevStats = prev.stat_data ?? {};
  
  var changes = [];
  
  function findChanges(obj1, obj2, path) {
    for (var key in obj1) {
      if (obj1.hasOwnProperty(key)) {
        var newPath = path ? path + '.' + key : key;
        if (typeof obj1[key] === 'object' && obj1[key] !== null) {
          findChanges(obj1[key], obj2[key] || {}, newPath);
        } else if (String(obj1[key]) !== String(obj2[key] ?? '')) {
          changes.push(newPath + ': ' + String(obj2[key] ?? '?') + ' → ' + String(obj1[key]));
        }
      }
    }
  }
  
  findChanges(latestStats, prevStats, '');
  
  if (changes.length > 0) {
    print('[📊 Thay đổi gần nhất]');
    for (var i = 0; i < changes.length; i++) {
      print('  • ' + changes[i]);
    }
  }
}
_%>`,
  },

  // ── Events ──
  {
    id: 'adv-event-queue',
    label: 'Event Queue Processor',
    description: 'Xử lý hàng đợi sự kiện game (battle win, item found...)',
    category: 'event',
    tags: ['event', 'queue', 'processor'],
    code: `@@preprocessing
<%_
var lastEvent = getvar('stat_data.Events.LastEvent', { defaults: '' });
var eventData = getvar('stat_data.Events.EventData', { defaults: '' });

if (lastEvent) {
  // Xử lý sự kiện
  if (lastEvent === 'BATTLE_WON') {
    var exp = Number(getvar('stat_data.Nhân vật.EXP', { defaults: 0 }));
    var reward = eventData ? Number(eventData) : 50;
    setvar('stat_data.Nhân vật.EXP', exp + reward);
    print('[🎉 Chiến thắng! +' + reward + ' EXP]');
    
    // Level up check
    if (exp + reward >= 100) {
      var level = Number(getvar('stat_data.Nhân vật.Level', { defaults: 1 }));
      setvar('stat_data.Nhân vật.Level', level + 1);
      setvar('stat_data.Nhân vật.EXP', (exp + reward) - 100);
      print('[⬆️ LEVEL UP! Level ' + (level + 1) + '!]');
    }
  } else if (lastEvent === 'ITEM_FOUND') {
    print('[📦 Tìm được: ' + (eventData || 'vật phẩm bí ẩn') + ']');
  } else if (lastEvent === 'SCENE_CHANGE') {
    await activewi('WB: Cảnh ' + eventData, true);
  }
  
  // Clear event
  setvar('stat_data.Events.LastEvent', '');
  setvar('stat_data.Events.EventData', '');
}
_%>`,
  },
  {
    id: 'adv-time-system',
    label: 'Time Progression',
    description: 'Hệ thống thời gian tự động (ngày/đêm/mùa)',
    category: 'event',
    tags: ['time', 'day', 'night', 'season'],
    code: `@@preprocessing
<%_
var timeSlot = getvar('stat_data.Thế giới.Khung giờ', { defaults: 'Sáng' });
var day = Number(getvar('stat_data.Thế giới.Ngày', { defaults: 1 }));

// Time-based effects
var isNight = (timeSlot === 'Đêm' || timeSlot === 'Khuya');
var isDawn = (timeSlot === 'Sáng sớm');

/* Cả 4 entry thời gian phải TẮT sẵn — mỗi lượt chỉ bật những cái khớp khung giờ. */
if (isNight) { await activewi('WB: Bầu trời đêm', true); }
if (!isNight) { await activewi('WB: Bầu trời ngày', true); }
if (isNight && day > 3) { await activewi('WB: Quái vật đêm', true); }
if (!isNight) { await activewi('WB: NPC cửa hàng', true); }

// Inject time context
var timeDesc = '';
if (timeSlot === 'Sáng sớm') timeDesc = 'Bình minh vừa ló dạng, sương mù còn phủ mặt đất.';
else if (timeSlot === 'Sáng') timeDesc = 'Buổi sáng trong lành, ánh nắng ấm áp.';
else if (timeSlot === 'Trưa') timeDesc = 'Giữa trưa nắng gắt, mọi người tìm bóng râm.';
else if (timeSlot === 'Chiều') timeDesc = 'Buổi chiều tà, ánh hoàng hôn nhuộm đỏ bầu trời.';
else if (timeSlot === 'Tối') timeDesc = 'Trời đã tối, đèn lồng bắt đầu thắp sáng.';
else if (timeSlot === 'Đêm') timeDesc = 'Đêm khuya tĩnh lặng, trăng sáng trên cao.';
else if (timeSlot === 'Khuya') timeDesc = 'Khuya lắm rồi, vạn vật chìm trong giấc ngủ.';

if (timeDesc) print('[🕐 ' + timeDesc + ' (Ngày ' + day + ')]');
_%>`,
  },

  // ── Advanced ──
  {
    id: 'adv-dynamic-persona',
    label: 'Dynamic Persona Builder',
    description: 'Xây dựng persona phức tạp từ nhiều biến',
    category: 'advanced',
    tags: ['persona', 'dynamic', 'multi-stat'],
    code: `@@preprocessing
<%_
var corruption = Number(getvar('stat_data.Nhân vật.Corruption', { defaults: 0 }));
var affinity = Number(getvar('stat_data.Nhân vật.Độ thân mật', { defaults: 50 }));
var mood = getvar('stat_data.Nhân vật.Tâm trạng', { defaults: 'Bình thường' });

var traits = [];

// Corruption axis
if (corruption < 30) traits.push('trong sáng, ngại ngùng');
else if (corruption < 60) traits.push('tò mò, đôi khi khiêu khích nhẹ');
else traits.push('táo bạo, chủ động, không kiềm chế');

// Affinity axis
if (affinity < 30) traits.push('lạnh lùng, giữ khoảng cách');
else if (affinity < 70) traits.push('thân thiện nhưng còn dè dặt');
else traits.push('gắn bó sâu sắc, chia sẻ mọi thứ');

// Mood modifier
if (mood === 'Tức giận') traits.push('đang giận, lời lẽ gay gắt');
else if (mood === 'Buồn') traits.push('ủ rũ, hay thở dài');
else if (mood === 'Vui vẻ') traits.push('tươi cười, hay đùa giỡn');

print('[Persona hiện tại: ' + traits.join('. ') + '.]');
_%>`,
  },
  {
    id: 'adv-content-injection',
    label: 'Smart Content Injection',
    description: 'Inject nội dung vào nhiều vị trí khác nhau trong prompt',
    category: 'advanced',
    tags: ['inject', 'prompt', 'multi-position'],
    code: `@@preprocessing
<%_
var scene = getvar('stat_data.Thế giới.Loại cảnh', { defaults: 'Hàng ngày' });
var importance = Number(getvar('stat_data.Thế giới.Mức quan trọng', { defaults: 5 }));

// Inject background context (sâu trong lịch sử)
injectPrompt({
  text: '[Bối cảnh: Đang trong cảnh ' + scene + ']',
  position: 'in_chat',
  depth: 8,
  scan: true,
});

// Inject hướng dẫn viết (gần đây)
if (scene === 'Chiến đấu') {
  injectPrompt({
    text: '[Hướng dẫn: Viết chi tiết hành động chiến đấu, mô tả chuyển động cơ thể.]',
    position: 'in_chat',
    depth: 2,
  });
} else if (scene === 'Lãng mạn') {
  injectPrompt({
    text: '[Hướng dẫn: Viết nhẹ nhàng, tập trung cảm xúc và chi tiết lãng mạn.]',
    position: 'in_chat',
    depth: 2,
  });
}

// High importance: inject vào system prompt
if (importance >= 8) {
  injectPrompt({
    text: '[‼️ SỰ KIỆN QUAN TRỌNG: Ưu tiên cao cho cảnh hiện tại!]',
    position: 'in_chat',
    depth: 0,
  });
}
_%>`,
  },
  {
    id: 'adv-chat-history',
    label: 'Chat History Reader',
    description: 'Đọc và phân tích tin nhắn gần nhất',
    category: 'advanced',
    tags: ['chat', 'history', 'getChatMessages'],
    code: `@@preprocessing
<%_
// Đọc tin nhắn cuối cùng của AI
var lastAiMsg = getChatMessages(-1, 'assistant');

// Đọc tin nhắn cuối của user
var lastUserMsg = getChatMessages(-1, 'user');

// Phân tích đơn giản
if (lastAiMsg) {
  var hasQuestion = lastAiMsg.indexOf('?') !== -1;
  if (hasQuestion) {
    print('[{{char}} vừa hỏi {{user}} một câu hỏi, đang chờ trả lời]');
  }
}

if (lastUserMsg) {
  var msgLen = lastUserMsg.length;
  if (msgLen < 20) {
    print('[{{user}} đang trả lời ngắn gọn, có thể đang bận hoặc không muốn nói nhiều]');
  } else if (msgLen > 300) {
    print('[{{user}} đang viết rất chi tiết, hãy đáp lại tương xứng]');
  }
}
_%>`,
  },
];

