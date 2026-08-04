/**
 * STFE — SillyTavern Front-End Runtime  (bug 192)
 * ─────────────────────────────────────────────────────────────────────────────
 * Lõi CHUNG, không dính tới card nào. Mọi thứ riêng của từng card nằm ở `STFE_CONFIG`.
 *
 * Cơ chế (rút ra từ card mẫu "Sân Khấu Quỷ Bí", đã đối chiếu với API thật của
 * JS-Slash-Runner cài trên máy — xem @types/function/*.d.ts):
 *
 *  1. Ván chơi CHỈ dùng ĐÚNG MỘT tin nhắn của SillyTavern (lầu 0).
 *     Văn bản của lầu 0 luôn là lượt trả lời MỚI NHẤT của AI, nên nó luôn chứa thẻ
 *     cập nhật biến — và regex "màn hình chính" luôn bắt được để dựng lại giao diện.
 *
 *  2. Khung chat nằm TRONG iframe, không đụng khung chat gốc. Khi người chơi gửi:
 *        generate({ user_input, overrides.chat_history.prompts: <nhật ký của app> })
 *     `generate` chạy đúng pipeline sinh của SillyTavern (preset, world info, EJS...)
 *     nhưng KHÔNG tạo tin nhắn nào trong chat gốc. Đó chính là chỗ khác nhau giữa
 *     "chat thật trong giao diện" và "dán chữ vào khung chat gốc".
 *
 *  3. MVU KHÔNG tự chạy trong luồng này. MagVarUpdate chỉ móc vào `MESSAGE_SENT` /
 *     `MESSAGE_RECEIVED` (đã kiểm bằng cách đọc bundle.js thật), mà `generate` không
 *     phát hai sự kiện đó. Nên app phải TỰ gọi:
 *        Mvu.parseMessage(text, oldData) → Mvu.replaceMvuData(newData, {type:'message'})
 *     Đây là API công khai, có trong khai báo kiểu của chính extension.
 *
 *  4. Lưu trạng thái: nhật ký hội thoại + trạng thái giao diện nằm trong BIẾN CHAT
 *     (`getVariables({type:'chat'})`). Biến chat được ghi vào chính file chat của
 *     SillyTavern, nên đóng/mở lại khung chat, F5, thoát card rồi quay lại, thậm chí
 *     tắt hẳn SillyTavern — vẫn còn nguyên. (Card mẫu dùng IndexedDB; IndexedDB mất
 *     khi xoá cache trình duyệt hoặc đổi máy, nên ở đây dùng biến chat thì chắc hơn.)
 *
 * ⚠️ HAI LUẬT VIẾT CODE BẮT BUỘC (vì cả file này bị nhét vào `replaceString` của regex):
 *    • KHÔNG để dấu đô-la đứng ngay trước một chữ số, cũng không để dấu đô-la đứng
 *      ngay trước dấu bé hơn. SillyTavern hiểu đó là nhóm bắt của regex và sẽ NUỐT
 *      mất chúng. Nên khi cần nhóm bắt trong replace, hãy dùng hàm thay thế
 *      (m, a) => ... thay vì chuỗi thay thế.
 *    • KHÔNG để hai dấu ngoặc nhọn liền nhau (trừ macro cố ý như macro tên người
 *      dùng), vì cuối cùng SillyTavern còn chạy `substituteParams` lên toàn bộ
 *      chuỗi thay thế.
 *    Bộ dựng (build.mjs) có bước quét chặn hai lỗi này, đừng gỡ.
 */
(function (global) {
  'use strict';

  var CFG = global.STFE_CONFIG || {};
  var STORE_ROOT = '__stfe';

  /* ── tiện ích ─────────────────────────────────────────────────────────── */

  /**
   * Thực thể HTML phải DỰNG BẰNG MÃ KÝ TỰ, không viết thẳng.
   *
   * Đo trên SillyTavern thật: viết một thực thể HTML thẳng vào code thì tới iframe nó đã
   * bị giải mã thành ký tự thật. Đường đi: showdown escape dấu và trong khối code thành
   * thực thể, rồi script.js:1889 cố ý đổi ngược lại, cuối cùng trình duyệt giải mã nốt.
   * Hậu quả lần đầu chạy thật: cả hàm esc() thành vô dụng, và thực thể của dấu nháy đơn
   * biến thành ba dấu nháy liền nhau ⇒ SyntaxError, giao diện trắng trơn mà không báo gì.
   */
  var A = String.fromCharCode(38);   // dấu và
  var ENT = {
    amp: A + 'amp;', lt: A + 'lt;', gt: A + 'gt;', quot: A + 'quot;', apos: A + '#39;',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .split(A).join(ENT.amp)
      .split(String.fromCharCode(60)).join(ENT.lt)
      .split(String.fromCharCode(62)).join(ENT.gt)
      .split(String.fromCharCode(34)).join(ENT.quot)
      .split(String.fromCharCode(39)).join(ENT.apos);
  }

  var RE_QUOTE_LINE = new RegExp('^' + ENT.gt + '\\s?(.*)$', 'gm');

  /** Markdown rất nhẹ cho lời kể. Bắt buộc dùng hàm thay thế (xem luật ở đầu file). */
  function mdLite(raw) {
    var s = esc(raw);
    s = s.replace(/\*\*([^*]+)\*\*/g, function (m, a) { return '<b>' + a + '</b>'; });
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, function (m, pre, a) { return pre + '<i>' + a + '</i>'; });
    s = s.replace(new RegExp(ENT.quot + '([^' + A + '\\n]{1,400})' + ENT.quot, 'g'),
      function (m, a) { return '<q>' + a + '</q>'; });
    s = s.replace(RE_QUOTE_LINE, function (m, a) { return '<blockquote>' + a + '</blockquote>'; });
    s = s.replace(/\n{2,}/g, '</p><p>');
    s = s.replace(/\n/g, '<br>');
    return '<p>' + s + '</p>';
  }

  /* ── (bug 206) REGEX HIỂN THỊ CỦA THẺ ÁP LÊN KHUNG CHAT NHÚNG ─────────── */
  /**
   * Khung chat này tự vẽ lời kể, nên nó nằm NGOÀI đường đi của regex hiển thị SillyTavern:
   * mọi script làm đẹp mà người chơi đã cài (tô màu lời thoại, đổi ký hiệu, gắn nhãn nhân
   * vật…) chạy cho chat gốc thì được, còn vào tới đây là mất sạch — cùng một lượt kể mà hai
   * nơi hiện hai kiểu. Nay runtime tự đọc danh sách regex của thẻ rồi áp đúng thứ tự ấy.
   *
   * Ba chỗ phải cẩn thận:
   *  • BỎ chính hai script [FE] — chúng thay cả tin nhắn bằng trang giao diện này, áp vào
   *    lời kể là giao diện tự nuốt chính nó;
   *  • chỉ lấy script chạy ở luồng HIỂN THỊ và nhận đầu ra của AI (đúng như chat gốc);
   *  • regex của người dùng được phép sinh HTML (đó là mục đích của phần lớn script làm đẹp),
   *    nên khi có HTML thì hiển thị thẳng thay vì escape — chỉ gỡ trước mấy thẻ/thuộc tính
   *    có thể chạy mã.
   */

  var regexCache = null;
  var regexCacheAt = 0;
  var REGEX_TTL_MS = 5000;   // người chơi sửa regex trong quán rượu thì vài giây sau là thấy

  /** Chuỗi "/mẫu/cờ" hoặc "mẫu" → RegExp có cờ g. Hỏng thì trả null, KHÔNG ném. */
  function toRegExp(src) {
    var s = String(src == null ? '' : src);
    if (!s) return null;
    try {
      var m = s.match(/^\/(.+)\/([a-z]*)$/i);
      if (m) return new RegExp(m[1], m[2].indexOf('g') >= 0 ? m[2] : m[2] + 'g');
      return new RegExp(s, 'g');
    } catch (e) { return null; }
  }

  function cardRegexes() {
    if (CFG.skipCardRegexes) return [];
    if (regexCache && Date.now() - regexCacheAt < REGEX_TTL_MS) return regexCache;
    var list = [];
    try {
      if (typeof getTavernRegexes === 'function') list = getTavernRegexes() || [];
    } catch (e) { list = []; }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var name = String(r.script_name || r.scriptName || '');
      if (name.indexOf('[FE] ') === 0) continue;
      if (r.enabled === false || r.disabled === true) continue;
      var dst = r.destination || {};
      var from = r.source || {};
      if (dst.display === false) continue;      // chỉ-prompt: không phải việc của khung chat
      if (from.ai_output === false) continue;   // chỉ áp cho lời của người chơi thì bỏ qua
      var re = toRegExp(r.find_regex || r.findRegex);
      if (!re) continue;
      out.push({
        name: name,
        re: re,
        replace: String((r.replace_string !== undefined ? r.replace_string : r.replaceString) || ''),
        trims: Array.isArray(r.trim_strings) ? r.trim_strings : (Array.isArray(r.trimStrings) ? r.trimStrings : []),
      });
    }
    regexCache = out;
    regexCacheAt = Date.now();
    return out;
  }

  /**
   * Áp MỘT script, xử lý chuỗi thay thế đúng như quán rượu (nhóm bắt + macro đoạn khớp).
   * Trả kèm `ateAll`: có lần khớp nào ăn TRỌN chuỗi đầu vào không — dấu vân tay của script
   * "thay cả tin nhắn bằng màn hình khác" (xem applyCardRegexes, bug 209).
   */
  function applyOneRegex(text, rule) {
    var src = String(text);
    var ateAll = false;
    var out = src.replace(rule.re, function () {
      var args = Array.prototype.slice.call(arguments);
      // Đuôi của callback: [..., vị trí, chuỗi gốc] và có thể thêm object nhóm-có-tên.
      if (args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object') args.pop();
      var matched = String(args[0] == null ? '' : args[0]);
      var subject = String(args.pop());
      var offset = args.pop();
      if (offset === 0 && matched.length === subject.length) ateAll = true;
      var whole = matched;
      var groups = args.slice(1);
      for (var t = 0; t < rule.trims.length; t++) {
        if (rule.trims[t]) whole = whole.split(rule.trims[t]).join('');
      }
      var rep = rule.replace;
      rep = rep.replace(/\{\{match\}\}/gi, function () { return whole; });
      rep = rep.replace(/\$(\d+)/g, function (m, n) {
        var g = groups[Number(n) - 1];
        return g === undefined || g === null ? '' : String(g);
      });
      return rep;
    });
    return { text: out, ateAll: ateAll };
  }

  /**
   * (bug 209) BA LOẠI SCRIPT KHÔNG ĐƯỢC PHÉP CHẠM VÀO KHUNG CHAT NHÚNG.
   *
   * Bản 206 chỉ chối theo TÊN (`[FE] …`). Nhưng thứ nguy hiểm không nằm ở cái tên: gần như
   * thẻ nào có bảng giao diện riêng cũng mang thêm một script XOÁ SẠCH LỜI KỂ ở lớp hiển
   * thị — vì lời kể đã được vẽ lại bên trong bảng, để nguyên thì hiện hai lần. Script ấy
   * chạy cho chat gốc là đúng, nhưng chạy trong khung chat nhúng thì khung tự xoá đúng cái
   * mà nó sinh ra để hiện.
   *
   * Đo được ở bug 209: lúc AI nhả từng chữ vẫn đọc được bình thường (đường đó đi mdLite),
   * nhả xong là bong bóng trắng bong (đường này, thêm ở bản 206). Không phải mất tin nhắn —
   * là chính khung chat vừa xoá nó đi.
   *
   * Nên chối theo VIỆC NÓ LÀM chứ không theo tên:
   *   1. làm bay hết chữ người đọc được;
   *   2. nuốt trọn tin nhắn rồi nhả ra thứ chẳng còn mấy chữ cũ (script thay màn hình);
   *   3. nhồi nguyên một trang HTML vào (chính hai script [FE] của một thẻ khác).
   * Script làm đẹp thật — tô màu, gắn nhãn, bọc thẻ quanh cả bài — không phạm cái nào, kể cả
   * loại khớp trọn tin nhắn rồi trả lại nguyên chữ cũ trong một cái khung.
   */
  var FULL_PAGE_RE = /<!DOCTYPE|<html[\s>]|<body[\s>]/i;
  /** Dưới ngưỡng này thì coi như script đã vứt bài kể đi chứ không phải làm đẹp nó. */
  var KEEP_RATIO = 0.25;

  function applyCardRegexes(text) {
    var rules = cardRegexes();
    var out = String(text == null ? '' : text);
    var changed = false;
    for (var i = 0; i < rules.length; i++) {
      var res;
      try { res = applyOneRegex(out, rules[i]); } catch (e) { continue; }
      if (res.text === out) continue;

      var before = visibleTextOf(out);
      var after = visibleTextOf(res.text);
      var why = '';
      if (before && !after) why = 'nó làm bay sạch lời kể';
      else if (res.ateAll && after.length < before.length * KEEP_RATIO) why = 'nó nuốt trọn tin nhắn';
      else if (FULL_PAGE_RE.test(res.text) && !FULL_PAGE_RE.test(out)) why = 'nó nhồi cả một trang HTML vào';
      if (why) {
        console.warn('[STFE] Khung chat bỏ qua script regex ' + JSON.stringify(rules[i].name)
          + ': ' + why + '. Script vẫn chạy bình thường ở chat gốc.');
        continue;
      }

      out = res.text;
      changed = true;
    }
    return { text: out, changed: changed };
  }

  // Tên thẻ nguy hiểm phải nối chuỗi: cả file này được nhét vào giữa một khối mã của trang,
  // viết thẳng thì trình duyệt tưởng khối mã đóng ở đây và trang vỡ ngay từ đầu.
  var CODE_TAG = 'scr' + 'ipt';
  // Gỡ TRỌN khối (cả ruột) — gỡ mỗi cặp thẻ thì phần thân rơi ra thành chữ trần.
  var UNSAFE_BLOCK_RE = new RegExp('<(' + CODE_TAG + '|iframe|object|embed)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>', 'gi');
  var UNSAFE_TAG_RE = new RegExp('<\\/?(?:' + CODE_TAG + '|iframe|object|embed|link|meta|base)\\b[^>]*>', 'gi');
  var UNSAFE_ATTR_RE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
  var UNSAFE_URL_RE = /\s(?:href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi;

  /**
   * Regex của thẻ được phép sinh HTML, nhưng KHÔNG được phép chạy mã.
   * Giữ lại `style` — bảng trạng thái và phần lớn script làm đẹp sống nhờ nó, mà trang này
   * đã nằm trong khung cách ly của Trợ Thủ Tavern rồi.
   */
  function sanitizeDisplayHtml(html) {
    return String(html)
      .replace(UNSAFE_BLOCK_RE, '')
      .replace(UNSAFE_TAG_RE, '')
      .replace(UNSAFE_ATTR_RE, '')
      .replace(UNSAFE_URL_RE, '');
  }

  /**
   * (bug 209) Chữ người chơi THẬT SỰ đọc được: bỏ chú thích, bỏ ruột <style>/<script>, bỏ thẻ.
   * Đây là thước đo duy nhất đáng tin để nói "bong bóng này trống" — đếm ký tự thô thì một
   * đống thẻ rỗng cũng ra "có nội dung".
   */
  // Thực thể HTML phải dựng bằng mã ký tự, không viết thẳng — xem luật ở đầu file.
  var NBSP_RE = new RegExp(String.fromCharCode(38) + 'nbsp;', 'gi');

  function visibleTextOf(html) {
    return String(html == null ? '' : html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(new RegExp('<(' + CODE_TAG + '|style)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>', 'gi'), '')
      .replace(/<[^>]*>/g, '')
      .replace(NBSP_RE, ' ')
      .trim();
  }

  function hasVisibleText(html) { return visibleTextOf(html).length > 0; }

  /** Thẻ khối — có mặt nghĩa là script đã tự lo bố cục, đừng dựng đoạn chồng lên nữa. */
  var BLOCK_TAG_RE = /<(?:p|div|br|table|ul|ol|li|blockquote|pre|section|article|h[1-6])[\s>/]/i;

  /**
   * (bug 209) Đường HTML bỏ qua mdLite, mà mdLite mới là chỗ đổi xuống dòng thành ngắt đoạn.
   * Script chỉ tô màu vài chữ (toàn thẻ inline) thì cả bài kể dồn thành một cục chữ liền.
   */
  function blockify(html) {
    var s = String(html);
    if (BLOCK_TAG_RE.test(s)) return s;
    return '<p>' + s.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  }

  /**
   * Dựng thân bong bóng chat: áp regex của thẻ trước, rồi mới quyết định cách hiển thị.
   * Regex có sinh thẻ HTML ⇒ đó chính là ý đồ của script làm đẹp, hiện thẳng (đã lọc mã).
   * Không thì đi đường cũ — markdown nhẹ, escape hết.
   */
  function renderBody(raw) {
    var src = String(raw == null ? '' : raw);
    var r = applyCardRegexes(src);
    var body = (r.changed && /<[a-zA-Z][^>]*>/.test(r.text))
      ? blockify(sanitizeDisplayHtml(r.text))
      : mdLite(r.text);
    // (bug 209) CHỐT CHẶN CUỐI, sau cả bộ lọc trong applyCardRegexes: lời kể có chữ mà thân
    // bong bóng ra trắng ⇒ vứt bản đã qua regex, hiện lời kể gốc. Thà hiện không màu mè còn
    // hơn để người chơi nhìn một ô trống và tưởng tool nuốt mất lượt của mình.
    if (hasVisibleText(src) && !hasVisibleText(body)) return mdLite(src);
    return body;
  }

  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }

  /**
   * Trộn sâu: `base` là bộ mặc định, `over` là cái đang có thật.
   * Mảng thì lấy nguyên của `over` (một kho đồ rỗng vẫn là kho đồ rỗng, không phải "chưa có").
   */
  function deepDefaults(base, over) {
    var out = clone(base) || {};
    if (over == null || typeof over !== 'object') return out;
    Object.keys(over).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v)
        && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = deepDefaults(out[k], v);
      } else if (v !== undefined) {
        out[k] = clone(v);
      }
    });
    return out;
  }

  function nowStamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** Đọc sâu theo đường dẫn "A.B.C", chịu được key có dấu cách/tiếng Việt. */
  function dig(obj, path, dflt) {
    var cur = obj;
    var parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return dflt;
      cur = cur[parts[i]];
    }
    return cur === undefined || cur === null ? dflt : cur;
  }

  function setDeep(obj, path, value) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  /* ── chờ môi trường sẵn sàng ──────────────────────────────────────────── */

  function waitFor(check, ms) {
    var limit = ms || 15000;
    var step = 100;
    return new Promise(function (resolve, reject) {
      var spent = 0;
      (function tick() {
        var ok = false;
        try { ok = !!check(); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        spent += step;
        if (spent >= limit) return reject(new Error('Hết giờ chờ môi trường SillyTavern.'));
        setTimeout(tick, step);
      })();
    });
  }

  var readyPromise = null;
  var mvuPromise = null;
  var mvuReady = false;

  /**
   * Chờ API của quán rượu — CHỈ thế thôi, và rất nhanh (khoảng một nhịp 100ms).
   *
   * Bản đầu tiên gộp luôn `await waitGlobalInitialized('Mvu')` vào đây. Đo trên SillyTavern
   * thật: giao diện trắng trơn suốt 6 giây rồi mới hiện, vì cả màn hình bị treo chờ MVU.
   * Còn khi thẻ chưa được bật script nhúng thì lời hứa đó không bao giờ xong ⇒ trắng vĩnh
   * viễn, không một dòng lỗi. Nên tách hẳn: vẽ trước, MVU chờ ở luồng nền.
   */
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = waitFor(function () {
      return typeof getVariables === 'function' && typeof generate === 'function';
    });
    return readyPromise;
  }

  /** Chờ MVU ở luồng nền, có hạn giờ. Trả về true/false chứ không bao giờ ném. */
  function readyMvu() {
    if (mvuPromise) return mvuPromise;
    mvuPromise = (async function () {
      if (typeof global.Mvu !== 'undefined') { mvuReady = true; return true; }
      try {
        await Promise.race([
          (typeof waitGlobalInitialized === 'function'
            ? waitGlobalInitialized('Mvu')
            : Promise.reject(new Error('không có waitGlobalInitialized'))),
          new Promise(function (_, rej) { setTimeout(function () { rej(new Error('hết giờ chờ Mvu')); }, 10000); }),
        ]);
      } catch (e) { /* im lặng, xử lý ở dưới */ }
      mvuReady = typeof global.Mvu !== 'undefined';
      if (!mvuReady) console.warn('[STFE] Không thấy MVU — giao diện vẫn chạy nhưng chỉ số sẽ không tự cập nhật.');
      return mvuReady;
    })();
    return mvuPromise;
  }

  /** Có MVU không. Không có thì phần chỉ số đứng im, cần nói rõ chứ đừng im lặng. */
  function hasMvu() { return mvuReady || typeof global.Mvu !== 'undefined'; }

  /** Câu cảnh báo chuẩn khi thiếu MVU — cả hai màn hình dùng chung. */
  function mvuWarning() {
    return 'Chưa thấy hệ biến MVU. Vào biểu tượng Trợ Thủ Tavern (Tavern Helper) → tab '
      + 'Script, bật script nhúng của thẻ này lên rồi tải lại chat. Chưa bật thì giao diện '
      + 'vẫn chạy được nhưng mọi chỉ số sẽ đứng yên.';
  }

  /* ── lưu trữ: biến chat ───────────────────────────────────────────────── */

  function storeKey() { return STORE_ROOT + '.' + (CFG.id || 'card'); }

  function blankState() {
    return { v: 1, started: false, log: [], ui: {}, snapshots: [], lastError: '' };
  }

  function loadState() {
    var table;
    try { table = getVariables({ type: 'chat' }) || {}; } catch (e) { table = {}; }
    var saved = dig(table, storeKey(), null);
    if (!saved || typeof saved !== 'object') return blankState();
    var s = blankState();
    if (Array.isArray(saved.log)) s.log = saved.log;
    if (saved.ui && typeof saved.ui === 'object') s.ui = saved.ui;
    if (Array.isArray(saved.snapshots)) s.snapshots = saved.snapshots;
    s.started = !!saved.started;
    return s;
  }

  function saveState(state) {
    var table;
    try { table = getVariables({ type: 'chat' }) || {}; } catch (e) { table = {}; }
    var trimmed = {
      v: 1,
      started: !!state.started,
      log: state.log.slice(-(CFG.maxStoredTurns || 300)),
      ui: state.ui || {},
      snapshots: (state.snapshots || []).slice(-(CFG.maxSnapshots || 5)),
    };
    setDeep(table, storeKey(), trimmed);
    try {
      replaceVariables(table, { type: 'chat' });
      return true;
    } catch (e) {
      console.error('[STFE] Không ghi được biến chat:', e);
      return false;
    }
  }

  /* ── biến MVU của ván chơi ────────────────────────────────────────────── */

  /** Lầu chứa ván chơi. Bình thường là chính lầu đang render iframe này. */
  function gameMessageId() {
    try {
      var id = getCurrentMessageId();
      if (typeof id === 'number' && id >= 0) return id;
    } catch (e) { /* bỏ qua */ }
    return 0;
  }

  function getStat() {
    var opt = { type: 'message', message_id: gameMessageId() };
    try {
      if (global.Mvu && typeof Mvu.getMvuData === 'function') {
        return dig(Mvu.getMvuData(opt), 'stat_data', {}) || {};
      }
      return dig(getVariables(opt), 'stat_data', {}) || {};
    } catch (e) {
      console.warn('[STFE] Chưa đọc được stat_data:', e);
      return {};
    }
  }

  async function setStat(statData) {
    var opt = { type: 'message', message_id: gameMessageId() };
    var box;
    try {
      box = (global.Mvu && Mvu.getMvuData) ? Mvu.getMvuData(opt) : getVariables(opt);
    } catch (e) { box = {}; }
    box = box && typeof box === 'object' ? box : {};
    box.stat_data = statData;
    if (global.Mvu && typeof Mvu.replaceMvuData === 'function') {
      await Mvu.replaceMvuData(box, opt);
    } else {
      replaceVariables(box, opt);
    }
    return box.stat_data;
  }

  /* ── vá khối cập nhật biến trước khi đưa cho MVU ──────────────────────── */

  /** Bỏ dấu + hạ chữ thường, để so tên biến mà không chấp nhặt hoa/thường hay dấu. */
  function normKey(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Tên thao tác mà mô hình hay chế ra, quy về đúng bộ MVU hiểu. */
  var OP_ALIAS = {
    add: 'insert', append: 'insert', push: 'insert', create: 'insert',
    set: 'replace', update: 'replace', assign: 'replace',
    'delete': 'remove', unset: 'remove', del: 'remove',
    increment: 'delta', inc: 'delta', add_number: 'delta', change: 'delta',
  };

  /**
   * Sửa đường dẫn JSON Pointer cho khớp KHÓA THẬT trong stat_data.
   * Mô hình rất hay viết `/Kho đồ/0` trong khi biến tên là `Kho Đồ` — sai một chữ hoa là
   * cả lệnh trượt êm, không lỗi, chỉ mất đồ.
   */
  function fixPointer(pointer, stat, op) {
    var segs = String(pointer || '').split('/');
    if (segs[0] === '') segs.shift();
    var cur = stat;
    var out = [];
    var changed = false;
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i].replace(/~1/g, '/').replace(/~0/g, '~');
      if (Array.isArray(cur)) {
        // Thêm mới vào mảng mà chỉ số đã bằng hoặc vượt độ dài thì đó chính là "nối vào cuối".
        // Mô hình hay đánh 0,1,2 lên một mảng rỗng — ý nó là nối tiếp, cứ dịch thành dấu gạch.
        var idx = seg === '-' ? -1 : Number(seg);
        var limit = op === 'insert' ? cur.length : cur.length + 1;
        if (seg !== '-' && (!isFinite(idx) || idx >= limit)) { seg = '-'; changed = true; }
        out.push(seg);
        cur = seg === '-' ? undefined : cur[Number(seg)];
      } else if (cur && typeof cur === 'object') {
        if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
          var hit = null;
          var keys = Object.keys(cur);
          for (var k = 0; k < keys.length; k++) {
            if (normKey(keys[k]) === normKey(seg)) { hit = keys[k]; break; }
          }
          if (hit !== null) { seg = hit; changed = true; }
        }
        out.push(seg);
        cur = cur[seg];
      } else {
        out.push(seg);
        cur = undefined;
      }
    }
    return { pointer: '/' + out.join('/'), changed: changed };
  }

  /**
   * (Đo được khi chạy thật) Mô hình xuất khối cập nhật SAI ba chỗ cùng lúc:
   * thiếu hẳn thẻ JSONPatch, dùng op "add" thay vì "insert", và viết sai hoa/thường
   * đường dẫn. Kết quả: MVU bỏ qua toàn bộ, không một lời phàn nàn — vật phẩm, kỹ năng,
   * quan hệ khởi đầu bốc hơi sạch mà giao diện vẫn xanh mướt.
   *
   * Hàm này vá lại những chỗ đó rồi mới đưa cho MVU, và ĐẾM số chỗ đã vá để còn nói ra.
   */
  function normalizeUpdateBlock(text, stat) {
    var tag = updateTag();
    var reBlock = new RegExp('(<' + tag + '>)([\\s\\S]*?)(<\\/' + tag + '>)', 'i');
    var m = String(text || '').match(reBlock);
    if (!m) return { text: text, fixes: [] };

    var inner = m[2];
    var fixes = [];

    // 1. Không có thẻ JSONPatch nhưng có một mảng JSON trần → bọc lại.
    var hasTag = /<JSONPatch>/i.test(inner);
    var arrText = null;
    if (hasTag) {
      var mt = inner.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/i);
      arrText = mt ? mt[1] : null;
    } else {
      var ma = inner.match(/\[[\s\S]*\]/);
      if (ma) { arrText = ma[0]; fixes.push('thiếu thẻ JSONPatch'); }
    }
    if (!arrText) return { text: text, fixes: [] };

    var ops;
    try { ops = JSON.parse(arrText.trim()); } catch (e) { return { text: text, fixes: [] }; }
    if (!Array.isArray(ops)) return { text: text, fixes: [] };

    // 2 + 3. Sửa tên thao tác và đường dẫn.
    var opFixed = 0, pathFixed = 0;
    var unknown = [];
    ops.forEach(function (op) {
      if (!op || typeof op !== 'object') return;
      var o = String(op.op || '').toLowerCase();
      if (OP_ALIAS[o]) { op.op = OP_ALIAS[o]; opFixed++; }
      if (op.path) {
        var r = fixPointer(op.path, stat, op.op);
        if (r.changed) { op.path = r.pointer; pathFixed++; }
        // Gốc của đường dẫn không có trong stat_data ⇒ mô hình BỊA ra biến. MVU sẽ lặng lẽ
        // bỏ qua lệnh này. Không nói ra thì người chơi chỉ thấy "chỉ số không nhúc nhích".
        var head = String(r.pointer).split('/')[1];
        if (head && !Object.prototype.hasOwnProperty.call(stat || {}, head)) unknown.push(r.pointer);
      }
      if (op.from) {
        var r2 = fixPointer(op.from, stat, op.op);
        if (r2.changed) op.from = r2.pointer;
      }
    });
    if (opFixed) fixes.push('đổi tên ' + opFixed + ' thao tác');
    if (pathFixed) fixes.push('sửa ' + pathFixed + ' đường dẫn');

    if (!fixes.length) return { text: text, fixes: [], unknown: unknown };

    var rebuilt = m[1] + '\n<JSONPatch>\n' + JSON.stringify(ops, null, 2) + '\n</JSONPatch>\n' + m[3];
    return { text: String(text).replace(reBlock, rebuilt), fixes: fixes, unknown: unknown };
  }

  /**
   * Áp khối cập nhật biến của AI vào stat_data.
   * MVU tự hiểu cả `_.set(...)` lẫn khối JSONPatch — nhưng chỉ khi định dạng đúng,
   * nên phải đi qua bộ vá ở trên trước.
   */
  async function applyUpdate(aiText) {
    if (!global.Mvu || typeof Mvu.parseMessage !== 'function') return { ok: false, reason: 'no-mvu' };
    var opt = { type: 'message', message_id: gameMessageId() };
    try {
      var oldData = Mvu.getMvuData(opt) || {};
      var fixed = normalizeUpdateBlock(aiText, oldData.stat_data || {});
      if (fixed.fixes.length) console.warn('[STFE] Đã vá khối cập nhật biến:', fixed.fixes.join(', '));
      var next = await Mvu.parseMessage(fixed.text, oldData);
      if (!next) return { ok: false, reason: 'no-command', fixes: fixed.fixes, unknown: fixed.unknown || [] };
      await Mvu.replaceMvuData(next, opt);
      return { ok: true, stat: next.stat_data || {}, fixes: fixed.fixes, unknown: fixed.unknown || [] };
    } catch (e) {
      console.error('[STFE] Áp cập nhật biến thất bại:', e);
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  /* ── tách lời kể / khối biến ──────────────────────────────────────────── */

  function updateTag() { return CFG.updateTag || 'UpdateVariable'; }

  /* ── lọc khối kỹ thuật / khối tư duy khỏi phần hiển thị (bug 202) ─────── */

  /**
   * Đo trên máy người chơi: khung chat in NGUYÊN SI ba thứ lẽ ra không ai được thấy —
   * khối <tableThink> kèm chú thích HTML của tiện ích bảng trí nhớ, khối [metacognition]
   * của preset, và cả bảng trạng thái HTML mà thẻ tự vẽ (thứ mà chat gốc vốn dựng thành
   * giao diện, còn ở đây thì hiện ra dạng thẻ trần).
   *
   * Bản đầu chỉ lọc đúng năm cái tên thẻ đoán sẵn. Sai ngay từ giả định: rác đến từ PRESET
   * và TIỆN ÍCH của người dùng, không đoán trước được. Nên đổi cách nghĩ — khung chat chỉ
   * hiển thị VĂN XUÔI; mọi thứ mang hình dạng đánh dấu hay khối kỹ thuật đều bị cắt, và
   * thẻ nào cần thêm thì tự khai qua CFG.hideTags / CFG.hideBracketTags.
   */

  /** Thẻ mà NỘI DUNG bên trong không phải lời kể — cắt trọn cả khối. */
  var HIDDEN_TAGS = [
    'thinking', 'think', 'thought', 'thoughts', 'reasoning', 'reason', 'analysis', 'analyze',
    'plan', 'planning', 'outline', 'scratchpad', 'metacognition', 'cot', 'chain_of_thought',
    'tablethink', 'tableedit', 'tablerule', 'statusblock', 'status_block', 'statusbar',
    'mvu', 'mvuupdate', 'variableupdate', 'update_variable', 'system_note',
  ];

  /** Khối HTML dựng giao diện — luôn là thứ để vẽ, không bao giờ là lời kể. */
  var HTML_BLOCK_TAGS = [
    'div', 'table', 'style', 'script', 'details', 'svg', 'form', 'template',
    'iframe', 'button', 'canvas',
  ];

  /** Thẻ HTML còn sót: bỏ THẺ nhưng GIỮ chữ, vì chữ trong đó vẫn có thể là lời kể. */
  var HTML_INLINE_TAGS = [
    'p', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'big', 'font', 'a', 'img',
    'code', 'pre', 'blockquote', 'q', 'mark', 'sub', 'sup', 'center', 'label', 'summary',
    'del', 'ins', 'abbr', 'figcaption', 'figure', 'time', 'ul', 'ol', 'thead', 'tbody',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br', 'hr', 'tr', 'td', 'th',
  ];
  /** Trong nhóm trên, những thẻ vốn NGẮT DÒNG — bỏ đi mà không để lại gì thì chữ dính nhau. */
  var HTML_BREAK_TAGS = ['p', 'br', 'hr', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'];

  /** Nhãn kiểu [metacognition] — preset hay dùng, và thường KHÔNG có thẻ đóng. */
  var HIDDEN_BRACKETS = ['metacognition', 'thinking', 'think', 'reasoning', 'analysis', 'plan', 'cot', 'scratchpad'];

  /** Chỉ nhận tên thẻ an toàn để ghép vào regex — tên lạ do config đưa vào thì bỏ qua. */
  function safeNames(list, extra) {
    var all = (list || []).concat(Array.isArray(extra) ? extra : []);
    var seen = {};
    var out = [];
    all.forEach(function (n) {
      var k = String(n == null ? '' : n).trim().toLowerCase();
      if (!k || !/^[a-z][a-z0-9_-]*$/.test(k) || seen[k]) return;
      seen[k] = 1;
      out.push(k);
    });
    return out;
  }

  /**
   * Cắt trọn một khối thẻ, kể cả khi nó LỒNG NHAU (bảng trạng thái toàn div lồng div) và kể
   * cả khi thẻ đóng CHƯA VỀ — lúc đang nhả từng chữ thì khối luôn ở trạng thái mở dở, và đó
   * chính là lúc người chơi nhìn thấy ruột gan của nó chạy qua màn hình.
   */
  function stripBalancedTag(text, tag) {
    var s = String(text);
    var openRe = new RegExp('<' + tag + '(?![a-z0-9_-])[^>]*>', 'i');
    var closeRe = new RegExp('<\\/' + tag + '\\s*>', 'i');
    var guard = 0;
    while (guard++ < 400) {
      var mo = s.match(openRe);
      if (!mo) break;
      var start = mo.index;
      // Thẻ tự đóng: gỡ đúng nó, đừng nuốt phần sau.
      if (/\/>$/.test(mo[0])) {
        s = s.slice(0, start) + s.slice(start + mo[0].length);
        continue;
      }
      var i = start + mo[0].length;
      var depth = 1;
      var end = -1;
      while (depth > 0) {
        var rest = s.slice(i);
        var mc = rest.match(closeRe);
        if (!mc) { end = s.length; break; }
        var mn = rest.match(openRe);
        if (mn && mn.index < mc.index) {
          depth += /\/>$/.test(mn[0]) ? 0 : 1;
          i += mn.index + mn[0].length;
          continue;
        }
        depth--;
        i += mc.index + mc[0].length;
        if (depth === 0) end = i;
      }
      if (end < 0) end = s.length;
      s = s.slice(0, start) + s.slice(end);
    }
    return s;
  }

  /**
   * Nhãn ngoặc vuông. Có thẻ đóng thì cắt trọn; KHÔNG có thẻ đóng thì chỉ cắt hết đoạn văn
   * chứa nó (tới dòng trống đầu tiên). Cắt tham hơn là ăn nhầm lời kể — mà lời kể thì luôn
   * cách khối kỹ thuật bằng một dòng trống.
   */
  function stripBracketBlock(text, name) {
    var s = String(text);
    s = s.replace(new RegExp('^[ \\t]*\\[' + name + '\\][\\s\\S]*?\\[\\/' + name + '\\][ \\t]*', 'gim'), '');
    s = s.replace(new RegExp('^[ \\t]*\\[' + name + '\\][^\\n]*(?:\\n(?![ \\t]*\\n)[^\\n]*)*', 'gim'), '');
    return s;
  }

  /**
   * Dọn mọi khối không phải văn xuôi.
   * @param {string} text
   * @param {boolean} dropUpdate  có cắt luôn khối cập nhật biến của thẻ hay không
   */
  function stripHidden(text, dropUpdate) {
    var s = String(text == null ? '' : text);
    var tag = updateTag();

    if (dropUpdate) {
      s = stripBalancedTag(s, tag);
      // Đang stream thì khối mở ra mà chưa đóng — cắt từ chỗ mở tới hết, đừng để JSONPatch
      // chạy qua màn hình từng chữ một.
      s = s.replace(new RegExp('<' + tag + '(?![a-z0-9_-])[\\s\\S]*', 'i'), '');
    }

    safeNames(HIDDEN_TAGS, CFG.hideTags).forEach(function (t) {
      if (t === String(tag).toLowerCase()) return;
      s = stripBalancedTag(s, t);
    });
    HTML_BLOCK_TAGS.forEach(function (t) { s = stripBalancedTag(s, t); });

    // Chú thích HTML: tiện ích bảng trí nhớ gói cả bài toán của nó trong đây.
    s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*/, '');

    safeNames(HIDDEN_BRACKETS, CFG.hideBracketTags).forEach(function (n) { s = stripBracketBlock(s, n); });

    var breakRe = new RegExp('<\\/?(?:' + HTML_BREAK_TAGS.join('|') + ')(?:\\s[^>]*)?\\/?>', 'gi');
    var inlineRe = new RegExp('<\\/?(?:' + HTML_INLINE_TAGS.join('|') + ')(?:\\s[^>]*)?\\/?>', 'gi');
    s = s.replace(breakRe, '\n').replace(inlineRe, '');
    s = s.replace(/<\/?(gametxt|content|action)>/gi, '');

    // Ba dấu huyền phải dựng bằng mã ký tự: viết thẳng vào đây là ĐÓNG SỚM khối code bọc cả
    // giao diện, và mọi thứ phía sau bị SillyTavern bọc <q> quanh từng cặp nháy kép.
    var fence = String.fromCharCode(96, 96, 96);
    s = s.replace(new RegExp('^\\s*' + fence + '[a-zA-Z]*\\s*$', 'gm'), '');

    // Thẻ mới ra được một nửa (đang stream): chưa có dấu đóng thì không luật nào ở trên khớp,
    // và người chơi đọc được đúng mảnh vụn đó — đo được: `<div class="mvu` hiện ra rồi mới
    // biến mất. Chỉ cắt khi mảnh cuối THẬT SỰ có dạng mở thẻ, để "5 < 6" không bị đụng.
    s = s.replace(/<\/?[a-zA-Z][^>]*$/, '');

    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function splitReply(text) {
    var raw = String(text || '');
    var tag = updateTag();
    var block = '';
    var m = raw.match(new RegExp('<' + tag + '>[\\s\\S]*?<\\/' + tag + '>', 'i'));
    if (m) block = m[0];
    var narrative = stripHidden(raw, true);
    // Nhật ký gửi lại cho AI: sạch khối tư duy (đọc lại rác của chính mình thì lượt sau nó
    // càng nhả rác) nhưng GIỮ khối cập nhật biến, vì đó là mẫu định dạng duy nhất nó có.
    return {
      narrative: narrative,
      updateBlock: block,
      raw: raw,
      history: block ? narrative + '\n\n' + block : narrative,
    };
  }

  /* ── nhật ký hội thoại ────────────────────────────────────────────────── */

  /**
   * Phần hiển thị của một lượt đã nằm trong nhật ký.
   * `view` chỉ được TIN khi nó do chính bản này ghi ra: nhật ký lưu trước bản vá 202 còn
   * nguyên khối tư duy trong đó, mà nhật ký thì sống trong biến chat, mở lại là hiện lại.
   */
  var VIEW_VERSION = 2;

  function viewOf(entry) {
    if (!entry) return '';
    if (entry.role === 'user' || entry.role === 'system') return String(entry.text || '');
    if (entry.vc === VIEW_VERSION && typeof entry.view === 'string') return entry.view;
    return splitReply(entry.text).narrative;
  }

  /** Một lượt của AI đã dọn sạch, sẵn sàng đẩy vào nhật ký. */
  function logEntryOf(rawReply, at) {
    var parts = splitReply(rawReply);
    return { role: 'assistant', text: rawReply, view: parts.narrative, vc: VIEW_VERSION, at: at || '' };
  }

  function historyPrompts(state) {
    var keep = CFG.historyTurns || 12;
    var out = [];
    var log = state.log.slice(-keep * 2);
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if (!e || !e.text) continue;
      var isUser = e.role === 'user';
      // Tính lại từ `text` chứ không đọc trường đã lưu: nhật ký cũ ghi trước bản vá này vẫn
      // còn nguyên rác trong đó, mà lịch sử thì được gửi lại mỗi lượt.
      out.push({
        role: isUser ? 'user' : 'assistant',
        content: isUser ? String(e.text) : splitReply(e.text).history,
      });
    }
    return out;
  }

  /* ── gửi một lượt ─────────────────────────────────────────────────────── */

  var busy = false;
  var currentGenId = '';

  function isBusy() { return busy; }

  /**
   * Gửi một lượt tới SillyTavern và nhận trả lời NGAY TRONG iframe.
   *
   * @param {object} opt
   *   - userText      : chữ người chơi gõ (có thể rỗng khi mở màn)
   *   - systemInjects : mảng {role, content, position, depth} tiêm thêm
   *   - historyOverride: nếu truyền, dùng thay cho nhật ký (dùng lúc mở màn)
   *   - onStream(txt) : gọi mỗi lần có thêm chữ
   *   - onDone(res)   : xong
   *   - onError(err)  : lỗi
   */
  async function sendTurn(opt) {
    opt = opt || {};
    if (busy) throw new Error('Đang có một lượt chạy dở, chờ nó xong đã.');
    busy = true;
    currentGenId = 'stfe-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);

    var stops = [];
    var streamed = '';
    try {
      if (typeof eventOn === 'function' && global.iframe_events) {
        stops.push(eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, function (full, gid) {
          if (gid && gid !== currentGenId) return;
          streamed = full;
          if (opt.onStream) { try { opt.onStream(full); } catch (e) { /* UI lỗi không được chặn luồng */ } }
        }));
      }

      var cfg = {
        generation_id: currentGenId,
        user_input: opt.userText || '',
        should_stream: opt.stream !== false,
        should_silence: true,
        injects: opt.systemInjects || [],
        overrides: {
          chat_history: {
            with_depth_entries: true,
            prompts: opt.historyOverride || historyPrompts(STFE.state),
          },
        },
      };

      var result = await generate(cfg);
      var text = typeof result === 'string' ? result : (result && result.content) || streamed || '';
      if (!String(text).trim()) throw new Error('AI trả về rỗng.');

      if (opt.onDone) opt.onDone(text);
      return text;
    } catch (err) {
      if (opt.onError) opt.onError(err);
      throw err;
    } finally {
      busy = false;
      currentGenId = '';
      stops.forEach(function (s) { try { s && s.stop && s.stop(); } catch (e) { /* im lặng */ } });
    }
  }

  function stopTurn() {
    try {
      if (currentGenId && typeof stopGenerationById === 'function') return stopGenerationById(currentGenId);
      if (typeof stopAllGeneration === 'function') return stopAllGeneration();
    } catch (e) { console.warn('[STFE] Không dừng được:', e); }
    return false;
  }

  /* ── ghi lượt xuống lầu 0 (để lần sau mở lại vẫn dựng đúng màn hình) ──── */

  async function commitTurn(aiRawText, options) {
    var refresh = (options && options.refresh) || 'none';
    try {
      await setChatMessages(
        [{ message_id: gameMessageId(), message: String(aiRawText) }],
        { refresh: refresh },
      );
      return true;
    } catch (e) {
      console.error('[STFE] Không ghi được lầu chơi:', e);
      return false;
    }
  }

  /* ── bản TỔNG QUÁT chạy bằng dữ liệu ──────────────────────────────────── */
  /**
   * Bốn hàm dưới đây vốn phải viết tay cho từng thẻ. Nay runtime tự làm được từ mô tả
   * khai báo trong config, nên app Tạo Card SINH RA config chỉ gồm dữ liệu — an toàn hơn
   * hẳn so với sinh mã. Thẻ viết tay vẫn được ưu tiên: có hàm thì dùng hàm.
   */

  /** Thay mọi `{đường.dẫn}` trong mẫu bằng giá trị thật. Một ngoặc nhọn, không phải hai. */
  function fillTemplate(tpl, stat) {
    return String(tpl == null ? '' : tpl).replace(/\{([^{}]+)\}/g, function (m, p) {
      var v = dig(stat, p.trim(), '');
      return v === '' || v === null || v === undefined ? '—' : String(v);
    });
  }

  function headerOf(stat) {
    if (typeof CFG.header === 'function') return CFG.header(stat);
    var spec = CFG.headerSpec || {};
    return {
      name: dig(stat, spec.namePath || '', CFG.title || '—'),
      chips: (spec.chips || []).map(function (c) { return { k: c.k, v: fillTemplate(c.tpl, stat) }; }),
      money: (spec.money || []).map(function (c) { return { k: c.k, v: dig(stat, c.p, 0) }; }),
      bars: (spec.bars || []).map(function (b) {
        return {
          label: b.label,
          cur: Number(dig(stat, b.cur, 0)) || 0,
          max: Number(dig(stat, b.max, 0)) || 1,
          color: b.color || 'var(--fe-accent)',
        };
      }),
    };
  }

  /**
   * Ảnh chụp trạng thái gửi kèm mỗi lượt. Tự dựng từ chính danh sách tab, cộng BẢNG ĐƯỜNG
   * DẪN HỢP LỆ — đo được khi chạy thật: không đưa bảng đó thì mô hình bịa ra đường dẫn
   * (`/Thời gian`), MVU lặng lẽ bỏ qua, và người chơi chỉ thấy chỉ số không nhúc nhích.
   */
  function stateBriefOf(stat) {
    if (typeof CFG.buildStateBrief === 'function') return CFG.buildStateBrief(stat);
    var out = ['[TRẠNG THÁI HIỆN TẠI — nguồn sự thật, ưu tiên hơn mọi thứ trong nhật ký]'];

    (CFG.panels || []).forEach(function (p) {
      if (p.type === 'chat') return;
      if (p.type === 'fields') {
        var parts = (p.fields || []).map(function (f) {
          var v = dig(stat, f.p, '');
          if (f.suffix === 'p2') v = v + '/' + dig(stat, f.p2, '');
          return f.k + ': ' + (v === '' ? '(trống)' : v);
        });
        if (parts.length) out.push(String(p.label).replace(/^[^\p{L}]+/u, '') + ' — ' + parts.join(' · '));
      } else if (p.type === 'list') {
        var rows = dig(stat, p.path, []) || [];
        var label = String(p.label).replace(/^[^\p{L}]+/u, '');
        out.push(label + ' (' + rows.length + '): ' + (rows.length
          ? rows.map(function (r) {
            return r[p.name] + (p.tag && r[p.tag] !== undefined ? ' [' + r[p.tag] + ']' : '');
          }).join(', ')
          : 'trống'));
      }
    });

    var table = CFG.pathTable || [];
    if (table.length) {
      out.push('');
      out.push('[ĐƯỜNG DẪN HỢP LỆ — chép đúng từng chữ hoa và dấu, không có đường nào khác]');
      table.forEach(function (line) { out.push(line); });
      out.push('Bịa ra đường dẫn ngoài bảng này thì lệnh bị bỏ qua, chỉ số sẽ đứng yên.');
    }
    return out.join('\n');
  }

  /** Ghi thẳng giá trị biểu mẫu vào stat_data — không nhờ AI đặt hộ (bài học bug 116). */
  function applyFormOf(stat, form, scenario) {
    if (typeof CFG.applyForm === 'function') return CFG.applyForm(stat, form, scenario);

    (CFG.form || []).forEach(function (f) {
      if (!f.path) return;
      var v = form[f.key];
      if (f.showIf && String(form[f.showIf.key]) !== String(f.showIf.equals)) v = f.emptyValue !== undefined ? f.emptyValue : '';
      if (f.type === 'number') v = Number(v) || 0;
      setDeep(stat, f.path, v === undefined ? '' : v);
    });

    // Suy ra vài trường từ lựa chọn khác (VD thiên phú → thể lực tối đa).
    (CFG.derive || []).forEach(function (d) {
      var key = form[d.fromKey];
      var val = d.map && Object.prototype.hasOwnProperty.call(d.map, key) ? d.map[key] : d.fallback;
      if (val === undefined) return;
      (d.targets || []).forEach(function (t) { setDeep(stat, t, val); });
    });

    if (CFG.scenarioPath) setDeep(stat, CFG.scenarioPath, (scenario && scenario.seed) || form.note || '');
    return stat;
  }

  function openingPromptOf(form, scenario, stat) {
    if (typeof CFG.buildOpeningPrompt === 'function') return CFG.buildOpeningPrompt(form, scenario, stat);
    var lines = [];
    lines.push('[HỆ THỐNG] Người chơi vừa hoàn tất bảng khởi tạo. Hồ sơ dưới đây ĐÃ được ghi'
      + ' thẳng vào biến, đúng nguyên văn — tuyệt đối không sửa lại, không đặt tên khác.');
    lines.push('');
    lines.push('HỒ SƠ NHÂN VẬT');
    (CFG.form || []).forEach(function (f) {
      if (f.showIf && String(form[f.showIf.key]) !== String(f.showIf.equals)) return;
      var v = form[f.key];
      if (v === '' || v === undefined || v === null) return;
      lines.push('- ' + f.label + ': ' + v);
    });
    lines.push('');
    lines.push('BỐI CẢNH MỞ MÀN: ' + ((scenario && scenario.seed) || form.note || 'Người chơi tự do lựa chọn hướng đi.'));
    if (form.note && scenario && scenario.seed) lines.push('YÊU CẦU RIÊNG CỦA NGƯỜI CHƠI: ' + form.note);
    lines.push('');
    lines.push('VIỆC CẦN LÀM TRONG LƯỢT NÀY');
    lines.push('1. Viết cảnh mở màn đặt nhân vật vào đúng bối cảnh trên: có không khí, có ít nhất'
      + ' một NPC có tên, và một việc đang xảy ra ngay lúc này chứ không phải sắp xảy ra.');
    lines.push('2. Kết cảnh bằng một tình huống mở. KHÔNG hành động hay suy nghĩ thay người chơi.');
    lines.push('3. Sau phần kể, xuất khối cập nhật biến theo đúng định dạng bắt buộc, trong đó'
      + ' thêm trang bị/kỹ năng/NPC khởi đầu hợp lý vào các danh sách tương ứng.');
    lines.push('4. TUYỆT ĐỐI không ghi đè những trường do bảng khởi tạo quyết định — nếu thấy chúng'
      + ' chưa hợp lý thì hãy để thế giới phản ứng với chúng, đừng sửa chúng.');
    if (CFG.openingExtra) { lines.push(''); lines.push(CFG.openingExtra); }
    return lines.join('\n');
  }

  /* ── xuất ra ngoài ────────────────────────────────────────────────────── */

  var STFE = {
    cfg: CFG,
    state: blankState(),

    headerOf: headerOf,
    stateBriefOf: stateBriefOf,
    applyFormOf: applyFormOf,
    openingPromptOf: openingPromptOf,
    fillTemplate: fillTemplate,

    ready: ready,
    readyMvu: readyMvu,
    hasMvu: hasMvu,
    mvuWarning: mvuWarning,
    esc: esc,
    mdLite: mdLite,
    // (bug 206) Regex hiển thị của thẻ cũng chạm được vào khung chat nhúng.
    renderBody: renderBody,
    applyCardRegexes: applyCardRegexes,
    cardRegexes: cardRegexes,
    // (bug 209) main.js cần biết "bong bóng này có chữ không" để không bỏ mặc ô trống.
    hasVisibleText: hasVisibleText,
    resetCardRegexes: function () { regexCache = null; regexCacheAt = 0; },
    clone: clone,
    deepDefaults: deepDefaults,
    nowStamp: nowStamp,
    dig: dig,
    setDeep: setDeep,

    loadState: function () { STFE.state = loadState(); return STFE.state; },
    saveState: function () { return saveState(STFE.state); },

    getStat: getStat,
    setStat: setStat,
    applyUpdate: applyUpdate,
    normalizeUpdateBlock: normalizeUpdateBlock,
    splitReply: splitReply,
    stripHidden: stripHidden,
    viewOf: viewOf,
    logEntryOf: logEntryOf,
    gameMessageId: gameMessageId,

    sendTurn: sendTurn,
    stopTurn: stopTurn,
    isBusy: isBusy,
    commitTurn: commitTurn,
    historyPrompts: function () { return historyPrompts(STFE.state); },
  };

  global.STFE = STFE;
})(window);
