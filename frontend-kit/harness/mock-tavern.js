/**
 * Bộ giả lập API SillyTavern để soi giao diện front-end ngoài quán rượu (bug 192).
 *
 * Dựng lại đúng những hàm mà runtime dùng, theo khai báo kiểu thật của JS-Slash-Runner
 * (@types/function/*.d.ts). Nhờ nó, luồng bấm nút → gửi lượt → áp biến → vẽ lại có thể
 * chạy và soi được trong trình duyệt thường, không cần API key và không đụng chat thật.
 */
(function () {
  'use strict';

  // Giữ nguyên qua các lần tải trang, để mô phỏng đúng chuyện "thoát card rồi quay lại".
  var LS = 'stfe-mock-state';
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { saved = null; }

  var CHAT_VARS = (saved && saved.chat) || {};
  var MSG = (saved && saved.msg)
    || [{ message_id: 0, name: 'Eldran', role: 'assistant', is_hidden: false, message: '<EldranBoot/>', data: {}, extra: {} }];

  function persist() {
    try { localStorage.setItem(LS, JSON.stringify({ chat: CHAT_VARS, msg: MSG })); } catch (e) { /* bỏ qua */ }
  }

  var INIT_STAT = {
    'Thế Giới': { 'Ngày': 1, 'Tháng': 1, 'Năm': 3000, 'Giờ': 8, 'Phút': 0, 'Khu Vực': 'Trung - Đồng Bằng Cộng Hưởng', 'Bối Cảnh': '' },
    'Nhân Vật': {
      'Tên': 'Vô Danh', 'Tuổi': 18, 'Avatar': '', 'Phả Hệ': 'Ignis', 'Veil-Tech': 'Không',
      'Veil-Tech Style': '', 'Phả Hệ Lai 1': '', 'Phả Hệ Lai 2': '', 'Thiên Phú': 'Ưu Tư',
      'Cảnh Giới': 'Sơ thức', 'Tầng': 1, 'Cấp Hiệu Trấn Minh': 'Chưa có',
      'VP': { 'Hiện Tại': 100, 'Tối Đa': 100 },
    },
    'Tài Sản': { 'Veil Coin': 0, 'Điểm Công Trấn': 0, 'Veil Essence': 0 },
    'Containers': [{ 'Tên': 'Balo', 'Loại': 'Balo', 'Dung Tích': 'trung bình', 'Vị Trí': 'Trên người' }],
    'Kho Đồ': [], 'Kỹ Năng': [], 'Mối Quan Hệ': [],
  };
  if (!MSG[0].data || !MSG[0].data.stat_data) {
    MSG[0].data = { stat_data: JSON.parse(JSON.stringify(INIT_STAT)), initialized_lorebooks: {} };
  }

  var listeners = {};

  window.iframe_events = {
    MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
    MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
    GENERATION_STARTED: 'js_generation_started',
    STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
    GENERATION_ENDED: 'js_generation_ended',
  };
  window.tavern_events = { MESSAGE_UPDATED: 'message_updated', CHAT_CHANGED: 'chat_id_changed', APP_READY: 'app_ready' };

  window.eventOn = function (type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
    return { stop: function () { listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; }); } };
  };
  function emit(type) {
    var args = [].slice.call(arguments, 1);
    (listeners[type] || []).forEach(function (f) { try { f.apply(null, args); } catch (e) { console.error(e); } });
  }

  window.getCurrentMessageId = function () { return 0; };
  window.getLastMessageId = function () { return MSG.length - 1; };
  window.waitGlobalInitialized = function () { return Promise.resolve(true); };

  function pick(opt) {
    if (opt && opt.type === 'message') {
      var id = opt.message_id === 'latest' || opt.message_id == null ? MSG.length - 1 : Number(opt.message_id);
      return MSG[id < 0 ? MSG.length + id : id];
    }
    return null;
  }

  window.getVariables = function (opt) {
    var m = pick(opt);
    if (m) return JSON.parse(JSON.stringify(m.data || {}));
    return JSON.parse(JSON.stringify(CHAT_VARS));
  };
  window.replaceVariables = function (vars, opt) {
    var m = pick(opt);
    if (m) { m.data = JSON.parse(JSON.stringify(vars)); persist(); return; }
    CHAT_VARS = JSON.parse(JSON.stringify(vars));
    persist();
    window.__mockDump();
  };

  window.getChatMessages = function (range) {
    var id = Number(range);
    if (id < 0) id = MSG.length + id;
    return MSG[id] ? [JSON.parse(JSON.stringify(MSG[id]))] : [];
  };
  window.setChatMessages = async function (rows, opt) {
    rows.forEach(function (r) {
      var m = MSG[r.message_id];
      if (!m) return;
      if (r.message !== undefined) m.message = r.message;
      if (r.data !== undefined) m.data = r.data;
    });
    persist();
    window.__mockDump();
    if (opt && opt.refresh === 'all') {
      document.getElementById('mock-banner').textContent =
        '⟳ [giả lập] setChatMessages(refresh:"all") — thật thì SillyTavern dựng lại lầu 0 và đổi sang MÀN CHÍNH ngay lúc này.';
    }
    emit('message_updated', 0);
  };

  /* MVU giả: hiểu <JSONPatch> với các op replace/delta/insert/remove. */
  function walk(obj, pointer) {
    var parts = pointer.replace(/^\//, '').split('/').map(function (s) { return s.replace(/~1/g, '/').replace(/~0/g, '~'); });
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur == null) return null;
      cur = Array.isArray(cur) ? cur[Number(parts[i])] : cur[parts[i]];
    }
    return { parent: cur, key: parts[parts.length - 1] };
  }

  window.Mvu = {
    events: {},
    getMvuData: function (opt) { return window.getVariables(opt); },
    replaceMvuData: async function (data, opt) { window.replaceVariables(data, opt); },
    parseMessage: async function (text, old) {
      var next = JSON.parse(JSON.stringify(old || {}));
      next.stat_data = next.stat_data || {};
      var m = String(text).match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/i);
      if (!m) return next;
      var ops;
      try { ops = JSON.parse(m[1].trim()); } catch (e) { console.warn('[mock] JSONPatch hỏng:', e); return next; }
      (ops || []).forEach(function (op) {
        var t = walk(next.stat_data, op.path || '');
        if (!t || t.parent == null) return;
        if (op.op === 'replace') t.parent[t.key] = op.value;
        else if (op.op === 'delta') t.parent[t.key] = (Number(t.parent[t.key]) || 0) + Number(op.value);
        else if (op.op === 'insert') {
          if (Array.isArray(t.parent)) {
            if (t.key === '-') t.parent.push(op.value); else t.parent.splice(Number(t.key), 0, op.value);
          } else t.parent[t.key] = op.value;
        } else if (op.op === 'remove') {
          if (Array.isArray(t.parent)) t.parent.splice(Number(t.key), 1); else delete t.parent[t.key];
        }
      });
      return next;
    },
  };

  /* generate giả: trả về một lượt kể mẫu + khối cập nhật biến hợp lệ, có stream. */
  window.__mockScript = null;
  window.generate = async function (cfg) {
    window.__mockLastCall = JSON.parse(JSON.stringify({
      user_input: cfg.user_input,
      injects: cfg.injects,
      history: (cfg.overrides && cfg.overrides.chat_history && cfg.overrides.chat_history.prompts) || [],
    }));
    window.__mockDump();

    var isOpening = /LƯỢT MỞ MÀN|HỒ SƠ NHÂN VẬT/.test(cfg.user_input || '');
    var text = window.__mockScript || (isOpening ? OPENING_REPLY : TURN_REPLY);
    if (window.__mockFail) { window.__mockFail = false; throw new Error('lỗi giả lập từ API'); }

    var i = 0;
    while (i < text.length) {
      i = Math.min(text.length, i + 90);
      emit('js_stream_token_received_fully', text.slice(0, i), cfg.generation_id);
      await new Promise(function (r) { setTimeout(r, 12); });
    }
    return text;
  };
  window.stopGenerationById = function () { return true; };
  window.stopAllGeneration = function () { return true; };

  var OPENING_REPLY = [
    'Sương Veil bám trên vai bạn như một lớp bụi kim loại ẩm. Cổng Học Viện Veil mở ra trước mặt,',
    'hai cánh thép Ferrum khắc phù văn cộng hưởng, rung lên từng nhịp theo tiếng ù trầm dưới lòng đất.',
    '',
    '**Giám sát viên Lễ** đứng ở bàn đăng ký, tay lật một cuốn sổ dày. "Tên?" bà hỏi, không ngẩng lên.',
    '',
    '> Phía sau bạn, một cô gái tóc ngắn đang cãi nhau với chiếc máy đo Cộng Hưởng Vị bị kẹt.',
    '',
    'Cây kim trên máy đo gần nhất giật một cái rồi đứng im ở vạch đỏ. Cả hàng người im bặt.',
    '',
    '<UpdateVariable>',
    '<Analysis>Mở màn tại Học Viện Veil. Cấp trang bị khởi đầu và NPC đầu tiên.</Analysis>',
    '<JSONPatch>',
    '[',
    '  { "op": "insert", "path": "/Kho Đồ/-", "value": { "ID": "it_001", "Tên": "Thẻ đăng ký học viện", "Số Lượng": 1, "Mô Tả": "Thẻ nhựa in phù văn cộng hưởng, dùng để qua cổng.", "Container": "Balo" } },',
    '  { "op": "insert", "path": "/Kho Đồ/-", "value": { "ID": "it_002", "Tên": "Ống ổn định Veil", "Số Lượng": 2, "Mô Tả": "Hồi 20 VP, vị đắng như kim loại.", "Container": "Balo" } },',
    '  { "op": "insert", "path": "/Kỹ Năng/-", "value": { "Tên": "Cảm Ứng Veil", "Mô Tả": "Dò dòng Veil quanh mình trong bán kính hẹp.", "Level": 1, "VP Tiêu Hao": 5, "Veil Essence": 0, "Veil Essence Cần": 100 } },',
    '  { "op": "insert", "path": "/Mối Quan Hệ/-", "value": { "Tên": "Giám sát viên Lễ", "Mức Độ": "Trung lập", "Ghi Chú": "Phụ trách đăng ký tân sinh, khó tính." } },',
    '  { "op": "replace", "path": "/Thế Giới/Bối Cảnh", "value": "Đang xếp hàng đo Cộng Hưởng Vị ở cổng Học Viện Veil; máy đo vừa báo bất thường." },',
    '  { "op": "delta", "path": "/Thế Giới/Phút", "value": 15 }',
    ']',
    '</JSONPatch>',
    '</UpdateVariable>',
  ].join('\n');

  var TURN_REPLY = [
    'Bạn bước tới. Cây kim trên máy đo rung lên lần nữa, lần này lệch hẳn sang phải.',
    '',
    '"Đứng yên," Lễ nói, giọng đổi hẳn. "Đừng vận Veil nữa."',
    '',
    'Một vệt sáng lệch màu bò dọc khe nứt dưới chân bạn, và không khí bỗng có mùi tro.',
    '',
    '<UpdateVariable>',
    '<Analysis>Người chơi tiến lại máy đo, tiêu hao chút VP, thời gian trôi 10 phút.</Analysis>',
    '<JSONPatch>',
    '[',
    '  { "op": "delta", "path": "/Nhân Vật/VP/Hiện Tại", "value": -8 },',
    '  { "op": "delta", "path": "/Thế Giới/Phút", "value": 10 },',
    '  { "op": "delta", "path": "/Tài Sản/Veil Essence", "value": 5 },',
    '  { "op": "replace", "path": "/Thế Giới/Bối Cảnh", "value": "Máy đo báo dị thường; Giám sát viên Lễ đã cảnh giác." }',
    ']',
    '</JSONPatch>',
    '</UpdateVariable>',
  ].join('\n');

  window.__mockDump = function () {
    var box = document.getElementById('mock-dump');
    if (!box) return;
    box.textContent = JSON.stringify({
      'lầu 0 (200 ký tự đầu)': String(MSG[0].message).slice(0, 200),
      'stat_data': MSG[0].data.stat_data,
      'biến chat': CHAT_VARS,
      'lần gọi generate gần nhất': window.__mockLastCall || null,
    }, null, 2);
  };

  window.__mockReset = function () {
    CHAT_VARS = {};
    MSG[0].message = '<EldranBoot/>';
    MSG[0].data = { stat_data: JSON.parse(JSON.stringify(INIT_STAT)), initialized_lorebooks: {} };
    persist();
    location.reload();
  };
})();
