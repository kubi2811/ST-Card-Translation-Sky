/**
 * Màn CHÍNH (bug 192) — thanh chỉ số + các tab dữ liệu + KHUNG CHAT NHÚNG.
 *
 * Khung chat ở đây nói chuyện thẳng với SillyTavern qua `generate`, nên:
 *   • không có chữ nào bị dán vào khung chat gốc;
 *   • preset, world info, EJS, lorebook vẫn chạy đủ như một lượt chat bình thường;
 *   • biến MVU do chính app áp bằng Mvu.parseMessage sau mỗi lượt.
 *
 * Trạng thái (nhật ký, tab đang mở, khung chat đang đóng hay mở, ô nhập đang gõ dở)
 * nằm trong BIẾN CHAT nên đóng/mở khung, F5, thoát card rồi vào lại đều không mất.
 */
(function () {
  'use strict';

  var S = window.STFE;
  var CFG = window.STFE_CONFIG;
  var stat = {};
  var streamingNode = null;

  var el = function (id) { return document.getElementById(id); };

  function applyTheme() {
    var t = CFG.theme || {};
    Object.keys(t).forEach(function (k) { document.documentElement.style.setProperty(k, t[k]); });
  }

  function ui() {
    S.state.ui = S.state.ui || {};
    if (S.state.ui.chatOpen === undefined) S.state.ui.chatOpen = true;
    if (!S.state.ui.tab) S.state.ui.tab = 'chat';
    return S.state.ui;
  }

  /* ── thanh đầu ────────────────────────────────────────────────────────── */

  function headHtml() {
    var h = CFG.header(stat);
    var out = '<div class="fe-head"><div class="fe-head-top">'
      + '<h2 class="fe-title">' + S.esc(h.name) + '</h2>'
      + '<span class="fe-sub">' + S.esc(CFG.title) + '</span></div>';

    out += '<div class="fe-chips">';
    (h.chips || []).forEach(function (c) {
      out += '<span class="fe-chip">' + S.esc(c.k) + ' <b>' + S.esc(c.v) + '</b></span>';
    });
    (h.money || []).forEach(function (c) {
      out += '<span class="fe-chip">' + S.esc(c.k) + ' <b>' + S.esc(c.v) + '</b></span>';
    });
    out += '</div>';

    if ((h.bars || []).length) {
      out += '<div class="fe-bars">';
      (h.bars || []).forEach(function (b) {
        var max = Number(b.max) || 1;
        var cur = Math.max(0, Math.min(Number(b.cur) || 0, max));
        var pct = Math.round((cur / max) * 100);
        out += '<div class="fe-bar-row"><span class="fe-bar-label">' + S.esc(b.label) + '</span>'
          + '<span class="fe-bar-track"><span class="fe-bar-fill" style="width:' + pct + '%;background:'
          + S.esc(b.color || 'var(--fe-accent)') + '"></span></span>'
          + '<span class="fe-bar-num">' + cur + ' / ' + max + '</span></div>';
      });
      out += '</div>';
    }
    out += '</div>';
    return out;
  }

  /* ── các tab dữ liệu ──────────────────────────────────────────────────── */

  function valueOf(field) {
    var v = S.dig(stat, field.p, '');
    if (field.suffix === 'p2') v = v + ' / ' + S.dig(stat, field.p2, '');
    return v;
  }

  function fieldsPane(panel) {
    var cells = (panel.fields || []).filter(function (f) {
      if (!f.hideEmpty) return true;
      var v = S.dig(stat, f.p, '');
      return v !== '' && v !== null && v !== undefined;
    });
    if (!cells.length) return '<div class="fe-empty">Chưa có dữ liệu.</div>';
    return '<div class="fe-grid">' + cells.map(function (f) {
      return '<div class="fe-cell"' + (f.wide ? ' style="grid-column:1/-1"' : '') + '>'
        + '<div class="fe-cell-k">' + S.esc(f.k) + '</div>'
        + '<div class="fe-cell-v">' + S.esc(valueOf(f) === '' ? '—' : valueOf(f)) + '</div></div>';
    }).join('') + '</div>';
  }

  function itemHtml(panel, it) {
    var name = S.esc(it[panel.name] || '(không tên)');
    var tag = panel.tag ? S.esc((panel.tagPrefix || '') + (it[panel.tag] === undefined ? '' : it[panel.tag])) : '';
    var out = '<div class="fe-item"><div class="fe-item-head"><span class="fe-item-name">' + name + '</span>'
      + (tag ? '<span class="fe-item-tag">' + tag + '</span>' : '') + '</div>';
    if (panel.desc && it[panel.desc]) out += '<div class="fe-item-desc">' + S.esc(it[panel.desc]) + '</div>';
    (panel.note || []).forEach(function (n) {
      if (it[n.p] === undefined) return;
      out += '<div class="fe-item-desc">' + S.esc(n.k) + ': ' + S.esc(it[n.p]) + '</div>';
    });
    if (panel.bar) {
      var max = Number(it[panel.bar.max]) || 0;
      var cur = Number(it[panel.bar.cur]) || 0;
      if (max > 0) {
        var pct = Math.max(0, Math.min(100, Math.round((cur / max) * 100)));
        out += '<div class="fe-bar-row" style="margin-top:6px">'
          + '<span class="fe-bar-label">' + S.esc(panel.bar.label) + '</span>'
          + '<span class="fe-bar-track"><span class="fe-bar-fill" style="width:' + pct
          + '%;background:var(--fe-accent-2)"></span></span>'
          + '<span class="fe-bar-num">' + cur + ' / ' + max + '</span></div>';
      }
    }
    out += '</div>';
    return out;
  }

  function listPane(panel) {
    var out = '';
    if (panel.before && panel.before.listPath) {
      var pre = S.dig(stat, panel.before.listPath, []) || [];
      if (pre.length) {
        out += '<div class="fe-cell-k" style="margin-bottom:6px">' + S.esc(panel.before.title) + '</div>';
        out += '<div class="fe-grid" style="margin-bottom:12px">' + pre.map(function (c) {
          return '<div class="fe-cell"><div class="fe-cell-k">' + S.esc(c[panel.before.tag] || '') + '</div>'
            + '<div class="fe-cell-v">' + S.esc(c[panel.before.name] || '') + '</div>'
            + '<div class="fe-cell-k">' + S.esc(c[panel.before.desc] || '') + '</div></div>';
        }).join('') + '</div>';
      }
    }

    var rows = S.dig(stat, panel.path, []) || [];
    if (!Array.isArray(rows) || !rows.length) return out + '<div class="fe-empty">' + S.esc(panel.empty || 'Trống.') + '</div>';

    if (panel.groupBy) {
      var groups = {};
      rows.forEach(function (r) {
        var g = r[panel.groupBy] || '(không rõ)';
        (groups[g] = groups[g] || []).push(r);
      });
      Object.keys(groups).forEach(function (g) {
        out += '<div class="fe-cell-k" style="margin:10px 0 6px">' + S.esc(g)
          + ' <span style="opacity:.6">(' + groups[g].length + ')</span></div>';
        out += '<div class="fe-list">' + groups[g].map(function (it) { return itemHtml(panel, it); }).join('') + '</div>';
      });
      return out;
    }
    return out + '<div class="fe-list">' + rows.map(function (it) { return itemHtml(panel, it); }).join('') + '</div>';
  }

  function paneHtml(panel) {
    if (panel.type === 'chat') return '';
    if (panel.type === 'list') return listPane(panel);
    return fieldsPane(panel);
  }

  /* ── khung chat ───────────────────────────────────────────────────────── */

  function msgHtml(entry, idx) {
    var cls = entry.role === 'user' ? 'is-user' : (entry.role === 'system' ? 'is-sys' : '');
    var who = entry.role === 'user' ? 'Bạn' : (entry.role === 'system' ? 'Hệ thống' : 'Quản Trò');
    var body = entry.role === 'user' || entry.role === 'system'
      ? '<p>' + S.esc(entry.text).replace(/\n/g, '<br>') + '</p>'
      : S.mdLite(entry.view || S.splitReply(entry.text).narrative);
    return '<div class="fe-msg ' + cls + '" data-idx="' + idx + '">'
      + '<div class="fe-msg-meta">' + who + (entry.at ? ' · ' + S.esc(entry.at) : '') + '</div>'
      + '<div class="fe-msg-body">' + body + '</div></div>';
  }

  function chatHtml() {
    var u = ui();
    var out = '<div class="fe-chat' + (u.chatOpen ? '' : ' is-closed') + '" id="fe-chat">';
    out += '<div class="fe-chat-head" id="fe-chat-toggle">'
      + '<span class="fe-title">💬 Khung hội thoại</span>'
      + '<span class="fe-sub" id="fe-chat-count">' + S.state.log.length + ' lượt</span>'
      + '<span class="fe-chat-caret" id="fe-chat-caret">' + (u.chatOpen ? '▼ thu gọn' : '▶ mở ra') + '</span></div>';

    out += '<div class="fe-chat-box">';
    out += '<div class="fe-log" id="fe-log">'
      + S.state.log.map(function (e, i) { return msgHtml(e, i); }).join('') + '</div>';

    out += '<div class="fe-toolbar" id="fe-quick">'
      + (CFG.quickActions || []).map(function (q) {
        return '<button class="fe-btn fe-btn-sm fe-btn-ghost" data-quick="' + S.esc(q) + '">' + S.esc(q) + '</button>';
      }).join('')
      + '<button class="fe-btn fe-btn-sm" id="fe-regen">↻ Kể lại lượt này</button>'
      + '<button class="fe-btn fe-btn-sm fe-btn-danger" id="fe-restart">⟲ Chơi lại từ đầu</button>'
      + '</div>';

    out += '<div class="fe-compose">'
      + '<textarea class="fe-input" id="fe-input" placeholder="Bạn làm gì? (Ctrl+Enter để gửi)"></textarea>'
      + '<button class="fe-btn fe-btn-main" id="fe-send">Gửi</button>'
      + '<button class="fe-btn fe-btn-danger" id="fe-stop" style="display:none">Dừng</button>'
      + '</div>';
    out += '</div></div>';
    return out;
  }

  /* ── dựng toàn bộ ─────────────────────────────────────────────────────── */

  function render() {
    var u = ui();
    var tabs = (CFG.panels || []);
    var out = headHtml();

    out += '<div class="fe-tabs">' + tabs.map(function (p) {
      return '<button class="fe-tab' + (p.id === u.tab ? ' is-on' : '') + '" data-tab="' + S.esc(p.id) + '">'
        + S.esc(p.label) + '</button>';
    }).join('') + '</div>';

    out += '<div class="fe-body">' + tabs.filter(function (p) { return p.type !== 'chat'; }).map(function (p) {
      return '<div class="fe-pane' + (p.id === u.tab ? ' is-on' : '') + '" data-pane="' + S.esc(p.id) + '">'
        + paneHtml(p) + '</div>';
    }).join('') + '<div id="fe-msg"></div></div>';

    out += chatHtml();
    out += '<div class="fe-veil" id="fe-veil"><div class="fe-spin"></div>'
      + '<div class="fe-veil-text" id="fe-veil-text">Đang xử lý…</div></div>';

    el('fe-app').innerHTML = out;
    bind();
    restoreDraftInput();
    scrollLog();
  }

  /** Vẽ lại phần dữ liệu mà KHÔNG đụng tới khung chat (giữ nguyên ô nhập, vị trí cuộn). */
  function renderData() {
    stat = S.getStat();
    var headBox = el('fe-app').querySelector('.fe-head');
    if (headBox) headBox.outerHTML = headHtml();
    (CFG.panels || []).forEach(function (p) {
      if (p.type === 'chat') return;
      var node = el('fe-app').querySelector('[data-pane="' + p.id + '"]');
      if (node) node.innerHTML = paneHtml(p);
    });
    bindTabs();
  }

  function bindTabs() {
    el('fe-app').querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.tab;
        ui().tab = id;
        S.saveState();
        el('fe-app').querySelectorAll('[data-tab]').forEach(function (n) { n.classList.toggle('is-on', n.dataset.tab === id); });
        el('fe-app').querySelectorAll('[data-pane]').forEach(function (n) { n.classList.toggle('is-on', n.dataset.pane === id); });
        if (id === 'chat') {
          ui().chatOpen = true;
          el('fe-chat').classList.remove('is-closed');
          el('fe-chat-caret').textContent = '▼ thu gọn';
          S.saveState();
          scrollLog();
        }
      };
    });
  }

  function bind() {
    bindTabs();

    el('fe-chat-toggle').onclick = function () {
      var open = !ui().chatOpen;
      ui().chatOpen = open;
      S.saveState();
      el('fe-chat').classList.toggle('is-closed', !open);
      el('fe-chat-caret').textContent = open ? '▼ thu gọn' : '▶ mở ra';
      if (open) scrollLog();
    };

    el('fe-send').onclick = function () { send(el('fe-input').value); };
    el('fe-stop').onclick = function () { S.stopTurn(); };
    el('fe-regen').onclick = regenerate;
    el('fe-restart').onclick = restart;

    el('fe-input').addEventListener('input', function () {
      ui().draftInput = el('fe-input').value;
    });
    el('fe-input').addEventListener('blur', function () { S.saveState(); });
    el('fe-input').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(el('fe-input').value); }
    });

    el('fe-quick').querySelectorAll('[data-quick]').forEach(function (b) {
      b.onclick = function () {
        var box = el('fe-input');
        box.value = (box.value ? box.value.trimEnd() + ' ' : '') + b.dataset.quick;
        ui().draftInput = box.value;
        box.focus();
      };
    });
  }

  function restoreDraftInput() {
    var d = ui().draftInput;
    if (d) el('fe-input').value = d;
  }

  function scrollLog() {
    var log = el('fe-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function note(text, bad) {
    var box = el('fe-msg');
    if (!box) return;
    box.innerHTML = '<div class="fe-note' + (bad ? ' is-bad' : '') + '">' + S.esc(text) + '</div>';
  }

  function busyUI(on) {
    el('fe-send').disabled = on;
    el('fe-regen').disabled = on;
    el('fe-restart').disabled = on;
    el('fe-stop').style.display = on ? '' : 'none';
    el('fe-input').disabled = on;
  }

  function appendMsg(entry) {
    S.state.log.push(entry);
    var log = el('fe-log');
    log.insertAdjacentHTML('beforeend', msgHtml(entry, S.state.log.length - 1));
    el('fe-chat-count').textContent = S.state.log.length + ' lượt';
    scrollLog();
    return log.lastElementChild;
  }

  function ensureUpdateBlock(text) {
    var tag = CFG.updateTag || 'UpdateVariable';
    if (new RegExp('<\\/' + tag + '>').test(text)) return text;
    return String(text).trimEnd() + '\n\n<' + tag + '>\n<JSONPatch>\n[]\n</JSONPatch>\n</' + tag + '>';
  }

  /* ── một lượt chơi ────────────────────────────────────────────────────── */

  async function runTurn(userText, opts) {
    opts = opts || {};
    busyUI(true);
    note('');

    // Ảnh chụp trạng thái TRƯỚC lượt, để "kể lại lượt này" quay về được đúng chỗ cũ.
    S.state.snapshots = S.state.snapshots || [];
    S.state.snapshots.push({ at: Date.now(), stat: S.clone(stat), logLen: S.state.log.length, userText: userText });

    if (!opts.skipUserBubble) {
      appendMsg({ role: 'user', text: userText, at: S.nowStamp() });
      S.saveState();
    }

    streamingNode = appendMsg({ role: 'assistant', text: '', view: '<span class="fe-typing"></span>', at: S.nowStamp() });
    S.state.log.pop(); // bong bóng đang chạy chưa vào nhật ký thật

    try {
      var reply = await S.sendTurn({
        userText: userText,
        systemInjects: [{
          role: 'system',
          content: CFG.buildStateBrief(stat),
          position: 'in_chat',
          depth: 0,
          should_scan: true,
        }],
        onStream: function (full) {
          var parts = S.splitReply(full);
          streamingNode.querySelector('.fe-msg-body').innerHTML =
            S.mdLite(parts.narrative || full) + '<span class="fe-typing"></span>';
          scrollLog();
        },
      });

      reply = ensureUpdateBlock(reply);
      var parts2 = S.splitReply(reply);
      streamingNode.querySelector('.fe-msg-body').innerHTML = S.mdLite(parts2.narrative);

      S.state.log.push({ role: 'assistant', text: reply, view: parts2.narrative, at: S.nowStamp() });

      var res = await S.applyUpdate(reply);
      if (!res.ok && res.reason !== 'no-command') {
        note('Lượt kể đã xong nhưng khối cập nhật biến không áp được (' + res.reason
          + '). Chỉ số có thể chưa đổi — bấm "Kể lại lượt này" nếu thấy sai.', true);
      } else {
        // Nói ra chứ không vá lén: người chơi cần biết mô hình đang xuất sai định dạng.
        var msgs = [];
        if (res.fixes && res.fixes.length) {
          msgs.push('Khối cập nhật biến sai định dạng, đã tự vá (' + res.fixes.join(', ') + ').');
        }
        if (res.unknown && res.unknown.length) {
          msgs.push('AI ghi vào biến KHÔNG có trong thẻ nên lệnh bị bỏ qua: ' + res.unknown.join(', ')
            + ' — chỉ số liên quan sẽ đứng yên.');
        }
        if (msgs.length) note(msgs.join(' '), !!(res.unknown && res.unknown.length));
      }

      ui().draftInput = '';
      el('fe-input').value = '';
      S.saveState();
      await S.commitTurn(reply, { refresh: 'none' });
      renderData();
      el('fe-chat-count').textContent = S.state.log.length + ' lượt';
    } catch (e) {
      console.error('[STFE/turn]', e);
      if (streamingNode && streamingNode.parentNode) streamingNode.parentNode.removeChild(streamingNode);
      note('Lượt này hỏng: ' + (e && e.message ? e.message : e)
        + ' — nội dung bạn gõ vẫn còn trong ô nhập, cứ gửi lại.', true);
      el('fe-input').value = userText;
      ui().draftInput = userText;
      // gỡ luôn bong bóng người chơi vừa thêm, tránh nhật ký lệch
      if (!opts.skipUserBubble && S.state.log.length && S.state.log[S.state.log.length - 1].role === 'user') {
        S.state.log.pop();
        var last = el('fe-log').querySelector('.fe-msg.is-user:last-of-type');
        if (last && last.parentNode) last.parentNode.removeChild(last);
      }
      S.state.snapshots.pop();
      S.saveState();
    } finally {
      streamingNode = null;
      busyUI(false);
    }
  }

  function send(text) {
    var t = String(text || '').trim();
    if (!t) { note('Chưa gõ gì cả.', true); return; }
    if (S.isBusy()) { note('Đang chạy một lượt rồi, chờ chút.', true); return; }
    runTurn(t, {});
  }

  async function regenerate() {
    if (S.isBusy()) return;
    var snap = (S.state.snapshots || []).pop();
    if (!snap) { note('Không còn mốc nào để quay lại.', true); return; }
    if (!confirm('Bỏ lượt kể gần nhất và bảo Quản Trò kể lại?')) {
      S.state.snapshots.push(snap);
      return;
    }
    S.state.log = S.state.log.slice(0, snap.logLen);
    await S.setStat(snap.stat);
    stat = S.getStat();
    S.saveState();
    render();
    await runTurn(snap.userText, { skipUserBubble: false });
  }

  async function restart() {
    if (S.isBusy()) return;
    if (!confirm('Xoá sạch ván này và quay về màn khởi tạo? Không lấy lại được.')) return;
    var draft = S.dig(S.state, 'ui.draft', null);
    S.state.log = [];
    S.state.snapshots = [];
    S.state.started = false;
    S.state.ui = draft ? { draft: draft } : {};
    S.saveState();
    var tag = CFG.bootTag || 'GameStart';
    await S.commitTurn('<' + tag + '/>', { refresh: 'all' });
  }

  /* ── khởi động ────────────────────────────────────────────────────────── */

  (async function boot() {
    applyTheme();
    try {
      await S.ready();
    } catch (e) {
      el('fe-app').innerHTML = '<div class="fe-body"><div class="fe-note is-bad">'
        + 'Không thấy API của Trợ Thủ Tavern (JS-Slash-Runner). Hãy bật extension đó rồi tải lại chat.</div></div>';
      return;
    }
    S.loadState();
    stat = S.getStat();

    // Vào lại card mà nhật ký rỗng (VD: chat được nhập từ máy khác) thì ít nhất
    // dựng lại lượt gần nhất từ chính nội dung của lầu chơi.
    if (!S.state.log.length) {
      try {
        var msgs = getChatMessages(S.gameMessageId());
        var raw = msgs && msgs[0] ? msgs[0].message : '';
        if (raw && new RegExp('<\\/' + (CFG.updateTag || 'UpdateVariable') + '>').test(raw)) {
          var p = S.splitReply(raw);
          S.state.log = [{ role: 'assistant', text: raw, view: p.narrative, at: '' }];
          S.state.started = true;
          S.saveState();
        }
      } catch (e) { console.warn('[STFE] Không dựng lại được nhật ký từ lầu chơi:', e); }
    }

    render();

    // MVU chờ ở luồng nền. Nếu nó lên muộn thì vẽ lại phần chỉ số, không bắt cả màn hình đợi.
    S.readyMvu().then(function (ok) {
      if (!ok) { note(S.mvuWarning(), true); return; }
      try { renderData(); } catch (e) { /* im lặng */ }
    });

    // Người chơi bấm swipe / sửa tay ở chat gốc thì đồng bộ lại chỉ số.
    if (typeof eventOn === 'function' && window.tavern_events) {
      eventOn(tavern_events.MESSAGE_UPDATED, function () {
        if (S.isBusy()) return;
        try { renderData(); } catch (e) { /* im lặng */ }
      });
    }
  })();
})();
