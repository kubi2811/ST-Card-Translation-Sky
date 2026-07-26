/**
 * src/lib/regexEngine/regexRecipes.ts — (Goal 103b) THƯ VIỆN CÔNG THỨC REGEX ĐA DẠNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * Yêu cầu gốc của user: "tăng khả năng tạo ĐÚNG CHUẨN dạng regex của SillyTavern cũng như làm
 * các dạng regex với chức năng ĐA DẠNG — có thể là dùng entries với regex để làm AUDIO theo
 * diễn biến truyện, làm các MINI GAME…".
 *
 * Vì sao là CÔNG THỨC TĨNH chứ không nhờ AI viết mỗi lần:
 *   - Mấy dạng này có khuôn cố định (bắt marker → thay bằng widget HTML/JS). AI viết lại từ đầu
 *     mỗi lần là vừa tốn tiền vừa hay sai escape/fence;
 *   - Sinh tĩnh thì kết quả TẤT ĐỊNH, luôn compile, luôn đóng fence — đúng luật sắt Phase 103.
 * AI vẫn có việc: chọn công thức nào, đặt marker gì, và viết phần nội dung tự do.
 *
 * HỢP ĐỒNG CHUẨN SillyTavern (áp cho MỌI công thức ở đây):
 *   - findRegex viết dạng "/pattern/flags" — đúng thứ ST parse (regexFromString);
 *   - khối HTML bọc trong fence ```html … ``` (ST bóc fence rồi mới render);
 *   - script dùng onclick= phải gán hàm ra window (module scope không lên global);
 *   - markdownOnly=true cho widget hiển thị (giữ nguyên text gửi model),
 *     promptOnly=true cho script CHỈ dọn prompt.
 */
import type { RegexScript } from '../../types';

export type RecipeId =
  | 'audio_scene'      // audio đổi theo diễn biến truyện
  | 'dice_roll'        // mini game: gieo xúc xắc
  | 'choice_buttons'   // mini game: nút lựa chọn nhánh truyện
  | 'progress_bar'     // thanh tiến độ/định lượng
  | 'collapsible'      // khối gấp/mở (giấu spoiler, nhật ký)
  | 'hide_block';      // ẩn khối kỹ thuật khỏi màn hình

export interface RecipeParams {
  /** Nhãn marker AI/thẻ sẽ viết ra, mặc định theo từng công thức. */
  marker?: string;
  /** Tên script hiển thị trong Regex Lab. */
  scriptName?: string;
}

export interface RecipeDef {
  id: RecipeId;
  label: string;
  /** User đọc là hiểu ngay công thức làm gì. */
  desc: string;
  /** Marker mà thẻ/AI phải viết ra để công thức bắt được. */
  defaultMarker: string;
  /** Ví dụ dòng marker để dán vào entry/first_mes. */
  sample: string;
  build(params?: RecipeParams): Omit<RegexScript, 'id'>[];
}

// ═══ Hạ tầng chung ════════════════════════════════════════════════════════

const FENCE = '`'.repeat(3);
const wrapHtml = (html: string) => `${FENCE}html\n${html}\n${FENCE}`;

/** Escape để nhét chuỗi vào regex literal an toàn. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function baseScript(over: Partial<RegexScript> & { scriptName: string; findRegex: string; replaceString: string }): Omit<RegexScript, 'id'> {
  return {
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,   // widget hiển thị: không đụng text gửi model
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    ...over,
  };
}

/** Vế "ẩn khỏi prompt": marker không nên lọt vào context mỗi lượt. */
function hideFromPrompt(scriptName: string, findRegex: string): Omit<RegexScript, 'id'> {
  return baseScript({
    scriptName, findRegex, replaceString: '',
    markdownOnly: false, promptOnly: true,
  });
}

// ═══ Công thức ════════════════════════════════════════════════════════════

export const REGEX_RECIPES: RecipeDef[] = [
  {
    id: 'audio_scene',
    label: '🎵 Audio theo diễn biến truyện',
    desc: 'AI viết [audio:tên-cảnh] trong truyện → thay bằng trình phát nhạc nền của cảnh đó. ' +
      'Đường dẫn nhạc lấy từ một entry lorebook "Bảng nhạc" (tên cảnh → URL), nên đổi nhạc không phải sửa regex.',
    defaultMarker: 'audio',
    sample: '[audio:chien-truong]',
    build(p) {
      const marker = p?.marker || 'audio';
      const name = p?.scriptName || 'Audio theo cảnh';
      const find = `/\\[${reEscape(marker)}:([a-zA-Z0-9_-]+)\\]/g`;
      // $1 = tên cảnh. Bảng nhạc đọc từ biến window.__stAudioMap do entry "Bảng nhạc" nạp;
      // không có bảng thì fallback theo quy ước audio/<tên>.mp3 — vẫn chạy, không vỡ giao diện.
      const html = `<div class="st-audio" data-scene="$1" style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin:6px 0;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:rgba(0,0,0,.25);font-size:12px">
  <span>🎵</span><span class="st-audio-label" style="opacity:.8">$1</span>
  <audio class="st-audio-el" controls loop preload="none" style="height:28px;flex:1"></audio>
</div>
<script>
(function(){
  var box = document.currentScript.previousElementSibling;
  if(!box) return;
  var scene = box.getAttribute('data-scene');
  var map = (window.__stAudioMap || {});
  var src = map[scene] || ('audio/' + scene + '.mp3');
  var el = box.querySelector('.st-audio-el');
  if (el) el.src = src;
  var lbl = box.querySelector('.st-audio-label');
  if (lbl && map[scene + ':label']) lbl.textContent = map[scene + ':label'];
})();
</script>`;
      return [
        baseScript({ scriptName: name, findRegex: find, replaceString: wrapHtml(html) }),
        hideFromPrompt(`${name} (ẩn khỏi prompt)`, find),
      ];
    },
  },

  {
    id: 'dice_roll',
    label: '🎲 Mini game: Gieo xúc xắc',
    desc: 'AI viết [roll:1d20] hoặc [roll:2d6+3] → thành nút bấm gieo xúc xắc ngay trong chat, ' +
      'hiện từng mặt và tổng. Dùng cho kiểm tra may rủi, đánh nhau, thử vận.',
    defaultMarker: 'roll',
    sample: '[roll:1d20+2]',
    build(p) {
      const marker = p?.marker || 'roll';
      const name = p?.scriptName || 'Mini game: Xúc xắc';
      const find = `/\\[${reEscape(marker)}:(\\d*)d(\\d+)([+-]\\d+)?\\]/g`;
      const html = `<div class="st-dice" data-n="$1" data-f="$2" data-mod="$3" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;margin:4px 0;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(0,0,0,.25);font-size:13px">
  <button class="st-dice-btn" style="cursor:pointer;border:0;border-radius:8px;padding:4px 10px;background:#6d28d9;color:#fff;font-weight:600">🎲 Gieo $1d$2$3</button>
  <span class="st-dice-out" style="opacity:.9"></span>
</div>
<script>
(function(){
  var box = document.currentScript.previousElementSibling;
  if(!box) return;
  var n = parseInt(box.getAttribute('data-n') || '1', 10) || 1;
  var f = parseInt(box.getAttribute('data-f') || '6', 10) || 6;
  var mod = parseInt(box.getAttribute('data-mod') || '0', 10) || 0;
  var btn = box.querySelector('.st-dice-btn'), out = box.querySelector('.st-dice-out');
  function roll(){
    var parts = [], sum = 0;
    for (var i=0;i<n;i++){ var v = 1 + Math.floor(Math.random()*f); parts.push(v); sum += v; }
    sum += mod;
    out.textContent = '→ ' + parts.join(' + ') + (mod ? (mod>0?' + '+mod:' - '+Math.abs(mod)) : '') + ' = ' + sum;
  }
  if (btn) btn.addEventListener('click', roll);
})();
</script>`;
      return [
        baseScript({ scriptName: name, findRegex: find, replaceString: wrapHtml(html) }),
        hideFromPrompt(`${name} (ẩn khỏi prompt)`, find),
      ];
    },
  },

  {
    id: 'choice_buttons',
    label: '🕹 Mini game: Nút lựa chọn nhánh',
    desc: 'AI viết [choice:Đi tiếp|Quay lại|Nghỉ ngơi] → thành hàng nút bấm; bấm nút nào thì ' +
      'câu đó được điền thẳng vào ô chat để người chơi gửi. Dùng làm game phân nhánh.',
    defaultMarker: 'choice',
    sample: '[choice:Đi tiếp|Quay lại|Nghỉ ngơi]',
    build(p) {
      const marker = p?.marker || 'choice';
      const name = p?.scriptName || 'Mini game: Nút lựa chọn';
      const find = `/\\[${reEscape(marker)}:([^\\]]+)\\]/g`;
      const html = `<div class="st-choices" data-opts="$1" style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0"></div>
<script>
(function(){
  var box = document.currentScript.previousElementSibling;
  if(!box) return;
  var opts = (box.getAttribute('data-opts') || '').split('|').map(function(s){return s.trim();}).filter(Boolean);
  opts.forEach(function(op){
    var b = document.createElement('button');
    b.textContent = op;
    b.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:6px 14px;background:rgba(109,40,217,.25);color:inherit;font-size:13px';
    b.addEventListener('click', function(){
      var ta = window.parent && window.parent.document && window.parent.document.querySelector('#send_textarea');
      if (ta) { ta.value = op; ta.dispatchEvent(new Event('input', {bubbles:true})); ta.focus(); }
    });
    box.appendChild(b);
  });
})();
</script>`;
      return [
        baseScript({ scriptName: name, findRegex: find, replaceString: wrapHtml(html) }),
        hideFromPrompt(`${name} (ẩn khỏi prompt)`, find),
      ];
    },
  },

  {
    id: 'progress_bar',
    label: '📊 Thanh tiến độ / định lượng',
    desc: 'AI viết [bar:Máu:70/100] → thanh tiến độ có nhãn và số. Dùng cho máu, độ đói, tiến độ ' +
      'nhiệm vụ — không cần biến MVU, hợp cho chỉ số tạm thời trong cảnh.',
    defaultMarker: 'bar',
    sample: '[bar:Máu:70/100]',
    build(p) {
      const marker = p?.marker || 'bar';
      const name = p?.scriptName || 'Thanh tiến độ';
      const find = `/\\[${reEscape(marker)}:([^:\\]]+):(\\d+)\\/(\\d+)\\]/g`;
      const html = `<div class="st-bar" data-cur="$2" data-max="$3" style="margin:6px 0;font-size:12px">
  <div style="display:flex;justify-content:space-between;opacity:.85"><span>$1</span><span>$2/$3</span></div>
  <div style="height:8px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:3px">
    <div class="st-bar-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#10b981,#34d399)"></div>
  </div>
</div>
<script>
(function(){
  var box = document.currentScript.previousElementSibling;
  if(!box) return;
  var cur = parseFloat(box.getAttribute('data-cur')) || 0;
  var max = parseFloat(box.getAttribute('data-max')) || 1;
  var pct = Math.max(0, Math.min(100, (cur / max) * 100));
  var fill = box.querySelector('.st-bar-fill');
  if (fill) fill.style.width = pct + '%';
})();
</script>`;
      return [
        baseScript({ scriptName: name, findRegex: find, replaceString: wrapHtml(html) }),
        hideFromPrompt(`${name} (ẩn khỏi prompt)`, find),
      ];
    },
  },

  {
    id: 'collapsible',
    label: '📕 Khối gấp/mở (spoiler, nhật ký)',
    desc: 'AI viết [fold:Nhật ký]…[/fold] → khối gấp lại, bấm mới mở. Dùng giấu nội dung dài ' +
      '(nhật ký, hồi tưởng, bảng tra) cho chat gọn.',
    defaultMarker: 'fold',
    sample: '[fold:Nhật ký ngày 3]\nNội dung…\n[/fold]',
    build(p) {
      const marker = p?.marker || 'fold';
      const name = p?.scriptName || 'Khối gấp/mở';
      const find = `/\\[${reEscape(marker)}:([^\\]]*)\\]([\\s\\S]*?)\\[\\/${reEscape(marker)}\\]/gs`;
      const html = `<details style="margin:8px 0;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:6px 10px;background:rgba(0,0,0,.2)">
  <summary style="cursor:pointer;font-weight:600;font-size:13px">$1</summary>
  <div style="margin-top:6px;font-size:13px;opacity:.92">$2</div>
</details>`;
      return [baseScript({ scriptName: name, findRegex: find, replaceString: wrapHtml(html) })];
    },
  },

  {
    id: 'hide_block',
    label: '🙈 Ẩn khối kỹ thuật khỏi màn hình',
    desc: 'Ẩn khối <thinking>/<UpdateVariable>… khỏi phần hiển thị nhưng GIỮ NGUYÊN trong tin nhắn ' +
      'thô để MVU/engine vẫn đọc được. Đây là lỗi hay gặp nhất: xoá luôn thì biến ngừng cập nhật.',
    defaultMarker: 'thinking',
    sample: '<thinking>suy nghĩ nội bộ</thinking>',
    build(p) {
      const tag = p?.marker || 'thinking';
      const name = p?.scriptName || `Ẩn khối <${tag}>`;
      const find = `/<${reEscape(tag)}>[\\s\\S]*?<\\/${reEscape(tag)}>/gs`;
      // markdownOnly=true, promptOnly=false ⇒ chỉ đổi phần HIỂN THỊ; tin nhắn thô còn nguyên.
      return [baseScript({ scriptName: name, findRegex: find, replaceString: '' })];
    },
  },
];

export function getRecipe(id: RecipeId): RecipeDef | undefined {
  return REGEX_RECIPES.find(r => r.id === id);
}

/** Sinh script từ công thức — dùng cho nút trong Regex Lab và cho Auto Creator. */
export function buildRecipeScripts(id: RecipeId, params?: RecipeParams): Omit<RegexScript, 'id'>[] {
  const r = getRecipe(id);
  if (!r) throw new Error(`Không có công thức regex "${id}"`);
  return r.build(params);
}

/** Tóm tắt cho prompt AI: agent biết có sẵn công thức nào để KHÔNG viết lại từ đầu. */
export function buildRecipeCatalogForPrompt(): string {
  return REGEX_RECIPES.map(r =>
    `- ${r.id} (${r.label}): ${r.desc.split('.')[0]}. Marker mẫu: ${r.sample.split('\n')[0]}`,
  ).join('\n');
}
