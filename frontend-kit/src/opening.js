/**
 * Màn KHỞI TẠO (bug 192) — dựng từ `STFE_CONFIG.form`, không dính card nào.
 *
 * Bấm "Bắt đầu ván chơi" sẽ làm đúng 5 việc, theo thứ tự:
 *   1. ghi thẳng giá trị biểu mẫu vào stat_data (không nhờ AI đặt hộ);
 *   2. gọi `generate` để AI viết cảnh mở màn — chat gốc không hề bị đụng tới;
 *   3. áp khối cập nhật biến của AI qua Mvu.parseMessage;
 *   4. lưu nhật ký vào biến chat;
 *   5. ghi lượt trả lời xuống lầu 0 với refresh:'all'.
 * Việc thứ 5 khiến regex "màn hình chính" bắt được thẻ đóng khối cập nhật biến và SillyTavern
 * dựng lại lầu 0 thành giao diện chính — đó chính là bước "chuyển màn".
 */
(function () {
  'use strict';

  var S = window.STFE;
  var CFG = window.STFE_CONFIG;
  var form = {};
  var scenarioId = (CFG.scenarios && CFG.scenarios[0] && CFG.scenarios[0].id) || '';

  var el = function (id) { return document.getElementById(id); };

  function applyTheme() {
    var t = CFG.theme || {};
    Object.keys(t).forEach(function (k) { document.documentElement.style.setProperty(k, t[k]); });
  }

  function defaults() {
    var out = {};
    (CFG.form || []).forEach(function (f) { out[f.key] = f.value; });
    out.note = '';
    return out;
  }

  function visible(f) {
    if (!f.showIf) return true;
    return String(form[f.showIf.key]) === String(f.showIf.equals);
  }

  function fieldHtml(f) {
    var v = form[f.key];
    var h = '<div class="fe-field" data-field="' + S.esc(f.key) + '"'
      + (visible(f) ? '' : ' style="display:none"') + '>';
    h += '<label for="fld-' + S.esc(f.key) + '">' + S.esc(f.label) + '</label>';
    if (f.type === 'select') {
      var opts = (CFG.enums && CFG.enums[f.from]) || f.options || [];
      h += '<select id="fld-' + S.esc(f.key) + '" data-key="' + S.esc(f.key) + '">';
      if (f.allowEmpty) h += '<option value="">— chưa chọn —</option>';
      opts.forEach(function (o) {
        h += '<option value="' + S.esc(o) + '"' + (String(v) === String(o) ? ' selected' : '') + '>' + S.esc(o) + '</option>';
      });
      h += '</select>';
    } else if (f.type === 'number') {
      h += '<input id="fld-' + S.esc(f.key) + '" data-key="' + S.esc(f.key) + '" type="number" value="' + S.esc(v)
        + '"' + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + '>';
    } else {
      h += '<input id="fld-' + S.esc(f.key) + '" data-key="' + S.esc(f.key) + '" type="text" value="' + S.esc(v)
        + '" placeholder="' + S.esc(f.placeholder || '') + '">';
    }
    if (f.hint) h += '<span class="fe-hint">' + S.esc(f.hint) + '</span>';
    h += '</div>';
    return h;
  }

  function scenarioHtml() {
    var h = '<div class="fe-cards">';
    (CFG.scenarios || []).forEach(function (sc) {
      h += '<div class="fe-card' + (sc.id === scenarioId ? ' is-on' : '') + '" data-scenario="' + S.esc(sc.id) + '">'
        + '<div class="fe-card-title">' + S.esc(sc.title) + '</div>'
        + '<div class="fe-card-desc">' + S.esc(sc.desc) + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function render() {
    var h = '';
    h += '<div class="fe-head"><div class="fe-head-top">'
      + '<h2 class="fe-title">' + S.esc(CFG.title) + '</h2>'
      + '<span class="fe-sub">' + S.esc(CFG.subtitle || '') + '</span></div>'
      + '<div class="fe-sub" style="margin-top:6px">Điền hồ sơ rồi bấm <b>Bắt đầu ván chơi</b>. '
      + 'Sau khi bắt đầu, toàn bộ ván chơi diễn ra ngay trong khung này.</div></div>';

    h += '<div class="fe-body"><div class="fe-form">';
    h += '<div class="fe-form-grid">' + (CFG.form || []).map(fieldHtml).join('') + '</div>';
    h += '<div><div class="fe-cell-k" style="margin-bottom:6px">Bối cảnh mở màn</div>' + scenarioHtml() + '</div>';
    h += '<div class="fe-field"><label for="fld-note">' + S.esc((CFG.freeNote && CFG.freeNote.label) || 'Ghi chú')
      + '</label><textarea id="fld-note" data-key="note" placeholder="'
      + S.esc((CFG.freeNote && CFG.freeNote.placeholder) || '') + '">' + S.esc(form.note || '') + '</textarea></div>';
    h += '<div id="fe-msg"></div>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="fe-btn fe-btn-main" id="fe-start">▶ Bắt đầu ván chơi</button>'
      + '<button class="fe-btn fe-btn-ghost" id="fe-reset">Đặt lại biểu mẫu</button></div>';
    h += '</div></div>';

    h += '<div class="fe-veil" id="fe-veil"><div class="fe-spin"></div>'
      + '<div class="fe-veil-text" id="fe-veil-text">Đang dựng cảnh mở màn…</div>'
      + '<div class="fe-sub" id="fe-veil-peek" style="max-width:80%;text-align:center"></div></div>';

    el('fe-app').innerHTML = h;
    bind();
  }

  function bind() {
    el('fe-app').querySelectorAll('[data-key]').forEach(function (node) {
      node.addEventListener('input', function () {
        form[node.dataset.key] = node.value;
        saveDraft();
        if ((CFG.form || []).some(function (f) { return f.showIf; })) refreshVisibility();
      });
      node.addEventListener('change', function () {
        form[node.dataset.key] = node.value;
        saveDraft();
        refreshVisibility();
      });
    });
    el('fe-app').querySelectorAll('[data-scenario]').forEach(function (node) {
      node.addEventListener('click', function () {
        scenarioId = node.dataset.scenario;
        el('fe-app').querySelectorAll('[data-scenario]').forEach(function (n) { n.classList.remove('is-on'); });
        node.classList.add('is-on');
        saveDraft();
      });
    });
    el('fe-start').addEventListener('click', start);
    el('fe-reset').addEventListener('click', function () {
      form = defaults();
      scenarioId = (CFG.scenarios && CFG.scenarios[0] && CFG.scenarios[0].id) || '';
      saveDraft();
      render();
    });
  }

  function refreshVisibility() {
    (CFG.form || []).forEach(function (f) {
      var node = el('fe-app').querySelector('[data-field="' + f.key + '"]');
      if (node) node.style.display = visible(f) ? '' : 'none';
    });
  }

  function saveDraft() {
    S.state.ui = S.state.ui || {};
    S.state.ui.draft = { form: form, scenarioId: scenarioId };
    S.saveState();
  }

  function loadDraft() {
    var d = S.dig(S.state, 'ui.draft', null);
    form = defaults();
    if (d && d.form) Object.keys(d.form).forEach(function (k) { if (d.form[k] !== undefined) form[k] = d.form[k]; });
    if (d && d.scenarioId) scenarioId = d.scenarioId;
  }

  function note(text, bad) {
    el('fe-msg').innerHTML = '<div class="fe-note' + (bad ? ' is-bad' : '') + '">' + S.esc(text) + '</div>';
  }

  function veil(on, text) {
    el('fe-veil').classList.toggle('is-on', !!on);
    if (text) el('fe-veil-text').textContent = text;
    if (!on) el('fe-veil-peek').textContent = '';
  }

  /** AI quên khối cập nhật biến thì tự vá một khối rỗng, để màn chính vẫn dựng được. */
  function ensureUpdateBlock(text) {
    var tag = CFG.updateTag || 'UpdateVariable';
    if (new RegExp('<\\/' + tag + '>').test(text)) return text;
    return String(text).trimEnd() + '\n\n<' + tag + '>\n<JSONPatch>\n[]\n</JSONPatch>\n</' + tag + '>';
  }

  async function start() {
    if (S.isBusy()) return;
    var f = CFG.form || [];
    for (var i = 0; i < f.length; i++) {
      if (!visible(f[i])) continue;
      if (f[i].type === 'text' && !f[i].allowEmpty && !String(form[f[i].key] || '').trim() && f[i].key === 'ten') {
        note('Chưa đặt tên nhân vật.', true);
        return;
      }
    }
    var scenario = (CFG.scenarios || []).filter(function (s) { return s.id === scenarioId; })[0] || null;
    if (scenario && !scenario.seed && !String(form.note || '').trim()) {
      note('Bạn chọn bối cảnh tự do thì phải mô tả nó ở ô ghi chú bên dưới.', true);
      return;
    }

    el('fe-start').disabled = true;
    veil(true, 'Đang ghi hồ sơ vào biến…');

    try {
      // Tới đây thì bắt buộc phải có MVU, vì bước này ghi thẳng vào stat_data.
      if (!(await S.readyMvu())) throw new Error(S.mvuWarning());
      // Lấp bộ mặc định TRƯỚC rồi mới đè hồ sơ lên — xem chú thích defaultStat trong config.
      var stat = S.deepDefaults(CFG.defaultStat || {}, S.getStat());
      CFG.applyForm(stat, form, scenario);
      await S.setStat(stat);

      veil(true, 'Quản Trò đang dựng cảnh mở màn…');
      var prompt = CFG.buildOpeningPrompt(form, scenario, stat);

      var reply = await S.sendTurn({
        userText: prompt,
        historyOverride: [],
        systemInjects: [{
          role: 'system',
          content: CFG.buildStateBrief(stat),
          position: 'in_chat',
          depth: 0,
          should_scan: true,
        }],
        onStream: function (txt) {
          var peek = String(txt).slice(-220);
          el('fe-veil-peek').textContent = peek;
        },
      });

      reply = ensureUpdateBlock(reply);
      veil(true, 'Đang ghi biến khởi đầu…');
      await S.applyUpdate(reply);

      var parts = S.splitReply(reply);
      S.state.started = true;
      S.state.log = [{ role: 'assistant', text: reply, view: parts.narrative, at: S.nowStamp() }];
      // Giữ lại bản nháp biểu mẫu: bấm "Chơi lại từ đầu" thì hồ sơ cũ hiện sẵn, khỏi gõ lại.
      S.state.ui = { chatOpen: true, tab: 'chat', draft: { form: form, scenarioId: scenarioId } };
      S.state.snapshots = [];
      S.saveState();

      veil(true, 'Đang mở giao diện chính…');
      await S.commitTurn(reply, { refresh: 'all' });
    } catch (e) {
      console.error('[STFE/opening]', e);
      veil(false);
      el('fe-start').disabled = false;
      note('Không mở màn được: ' + (e && e.message ? e.message : e)
        + ' — kiểm tra lại API/preset rồi bấm Bắt đầu lần nữa. Hồ sơ vừa nhập vẫn được giữ.', true);
    }
  }

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
    loadDraft();
    render();
    // MVU chờ ở luồng nền: giao diện đã dùng được rồi, chỉ nút Bắt đầu là phải đợi nó.
    S.readyMvu().then(function (ok) { if (!ok) note(S.mvuWarning(), true); });
  })();
})();
