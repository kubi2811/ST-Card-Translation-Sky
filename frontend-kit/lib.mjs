/**
 * Phần dùng chung của bộ dựng front-end (bug 192) — tách ra để test dùng CHÍNH nó,
 * chứ không phải một bản chép tay gần giống.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const KIT_DIR = path.dirname(url.fileURLToPath(import.meta.url));
export const SRC_DIR = path.join(KIT_DIR, 'src');

/**
 * Hai thứ SillyTavern sẽ làm với `replaceString` trước khi nhả ra màn hình:
 *   • `replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, …)` — nuốt nhóm bắt;
 *   • `substituteParams(...)` — nuốt macro hai ngoặc nhọn.
 * Lọt hai thứ đó vào code là hỏng ÂM THẦM: giao diện vẫn hiện, chỉ vài ký tự bốc hơi
 * giữa một hàm JS. Nên phải chặn ngay từ khâu dựng.
 */
export const PAYLOAD_RULES = [
  { re: /\$\d/, why: 'dấu đô-la đứng trước chữ số — SillyTavern coi là nhóm bắt regex và xoá mất' },
  { re: /\$</, why: 'dấu đô-la đứng trước dấu bé hơn — bị coi là nhóm bắt có tên và xoá mất' },
  { re: /\{\{(?!user\}\}|char\}\})/, why: 'macro hai ngoặc nhọn không nằm trong danh sách cho phép — substituteParams sẽ ăn mất' },

  // Hai luật dưới đây KHÔNG suy ra từ tài liệu — đo được khi chạy thật lần đầu, cả hai đều
  // làm giao diện trắng trơn mà chẳng báo lỗi gì ở tầng SillyTavern.
  {
    re: /```/,
    why: 'ba dấu huyền Ở BẤT KỲ ĐÂU — script.js:1844 dùng một regex nuốt trọn khối ```…``` để '
      + 'che chắn; gặp cụm thứ ba là khối đóng sớm, phần còn lại bị bọc <q> quanh mọi cặp nháy kép '
      + '⇒ vỡ cú pháp JS. Dựng nó bằng String.fromCharCode(96,96,96).',
  },
  {
    re: /&(?:[a-zA-Z]{2,8}|#\d{2,5});/,
    why: 'thực thể HTML viết thẳng — showdown escape dấu và trong khối code, rồi script.js:1889 '
      + 'đổi ngược &amp; về &, trình duyệt giải mã nốt ⇒ thực thể biến thành ký tự thật. '
      + 'Dựng nó bằng String.fromCharCode(38) + "amp;" chẳng hạn.',
  },
];

export function scanPayload(html, label = 'payload') {
  const bad = [];
  for (const rule of PAYLOAD_RULES) {
    const r = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    let m;
    while ((m = r.exec(html))) {
      const line = html.slice(0, m.index).split('\n').length;
      bad.push(`${label}:${line}  ${rule.why} → ${JSON.stringify(html.slice(Math.max(0, m.index - 40), m.index + 40))}`);
      if (bad.length > 20) return bad;
    }
  }
  return bad;
}

/**
 * Luật thứ ba, học được lúc dựng chính bộ này: payload TUYỆT ĐỐI không được chứa nguyên
 * văn cái thẻ mà một script [FE] khác dùng làm mồi.
 *
 * Lần đầu dựng, docblock của opening.js có nhắc tên thẻ đóng khối cập nhật biến. Kết quả:
 * script "[FE] Màn Chính" chạy ngay sau, tìm thấy cái thẻ đó NẰM TRONG chú thích vừa được
 * chèn vào, rồi nhồi nguyên màn hình chính vào giữa một khối chú thích JS của màn khởi tạo.
 * Không có lỗi đỏ nào, chỉ là hai màn hình chồng lên nhau và JS vỡ. Test bắt được, giờ chặn luôn.
 */
export function scanTriggers(html, triggers, label = 'payload') {
  const bad = [];
  for (const t of triggers) {
    let i = html.indexOf(t);
    while (i !== -1) {
      const line = html.slice(0, i).split('\n').length;
      bad.push(`${label}:${line}  chứa nguyên văn thẻ mồi ${JSON.stringify(t)} — script [FE] kia sẽ khớp nhầm vào đây`);
      i = html.indexOf(t, i + 1);
      if (bad.length > 20) return bad;
    }
  }
  return bad;
}

export function buildPage(title, cssFiles, jsFiles) {
  const read = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  const css = cssFiles.map(read).join('\n');
  const js = jsFiles.map((f) => `\n/* ===== ${f} ===== */\n` + read(f)).join('\n');
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
<div class="fe-wrap"><div class="fe-root" id="fe-app"></div></div>
<script>
${js}
</script>
</body>
</html>`;
}

/**
 * Mô phỏng ĐÚNG hai phép biến đổi mà SillyTavern làm với nội dung tin nhắn trên đường
 * ra iframe (script.js:1836-1892). Không suy diễn — cả hai đều đo được bằng cách đọc
 * lại chính đoạn script mà quán rượu thật đã nhả vào iframe rồi so từng dòng.
 *
 *   Bước 1  bọc `<q>` quanh mọi cặp nháy kép, TRỪ những vùng được che: <style>…</style>,
 *           khối ba dấu huyền, khối hai dấu huyền, khối một dấu huyền.
 *   Bước 2  trong khối code, thực thể HTML bị giải mã về ký tự thật.
 *
 * Trả về nội dung khối code sau khi qua cả hai bước — tức đúng thứ trình duyệt sẽ chạy.
 */
export function simulateStDelivery(mes) {
  let out = String(mes);

  // Bước 1a: giấu nháy kép nằm trong thẻ, y như ST làm, để chúng khỏi bị bọc <q>.
  out = out.replace(/<([^>]+)>/g, (_, contents) => '<' + contents.replace(/"/g, '￾') + '>');

  // Bước 1b: chính cái regex của ST, chép nguyên si thứ tự các nhánh.
  out = out.replace(
    /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(“.*?”)|(«.*?»)|(「.*?」)|(『.*?』)|(＂.*?＂)/gim,
    (match, p1) => (p1 ? `<q>"${p1.slice(1, -1)}"</q>` : match),
  );

  out = out.replace(/￾/g, '"');

  // Bước 2: thực thể trong khối code bị giải mã.
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  out = out.replace(/&(?:([a-zA-Z]{2,8})|#(\d{2,5}));/g, (m, name, num) => {
    if (num) return String.fromCharCode(Number(num));
    return Object.prototype.hasOwnProperty.call(named, name) ? named[name] : m;
  });

  return out;
}

/** Bọc khối code đúng kiểu card mẫu: ba dấu huyền trần, không kèm tên ngôn ngữ. */
export function fence(html) {
  return '```\n' + html + '\n```';
}

/** Định danh tất định — dựng lại nhiều lần vẫn ra cùng một file, khỏi đẻ diff rác. */
export function stableId(seed) {
  const hex = [...seed].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(16).padStart(8, '0');
  return `${hex}-1920-4b92-9f${hex.slice(0, 2)}-${hex}${hex.slice(0, 4)}`;
}

/**
 * Script regex CHỈ tác động lên hiển thị.
 *   markdownOnly = true  → chạy ở luồng hiển thị
 *   promptOnly   = false → không bao giờ lọt vào prompt gửi cho AI
 * (Yêu cầu số 9 của user: đống HTML dài tuyệt đối không được đi ngược vào ngữ cảnh.)
 */
export function makeDisplayScript(name, findRegex, replaceString) {
  return {
    id: stableId(name),
    scriptName: name,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

/** Dựng đúng 2 payload của card Eldran. */
export function buildEldranPayloads() {
  return {
    opening: buildPage('Khởi tạo — Hành Tinh Eldran', ['theme.css'], ['eldran.config.js', 'runtime.js', 'opening.js']),
    main: buildPage('Hành Tinh Eldran', ['theme.css'], ['eldran.config.js', 'runtime.js', 'main.js']),
  };
}

/**
 * Chỉ config + runtime, KHÔNG kèm màn hình nào — để test gọi thẳng vào hàm thật của
 * runtime thay vì chép tay lại logic (chép tay thì test chỉ kiểm bản chép, vô nghĩa).
 */
export function buildRuntimeOnlyJs() {
  const read = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  return read('eldran.config.js') + '\n' + read('runtime.js');
}

export const ELDRAN = { bootTag: 'EldranBoot', updateTag: 'UpdateVariable' };

/** Những chuỗi mà không payload nào được chứa nguyên văn (xem scanTriggers). */
export const ELDRAN_TRIGGERS = [`<${ELDRAN.bootTag}/>`, `<${ELDRAN.bootTag} />`, `</${ELDRAN.updateTag}>`];

/** Hai script [FE] đã sẵn sàng cắm vào đầu mảng regex_scripts. */
export function buildEldranScripts() {
  const p = buildEldranPayloads();
  return [
    makeDisplayScript('[FE] Màn Khởi Tạo', `<${ELDRAN.bootTag}\\s*/>`, fence(p.opening)),
    makeDisplayScript('[FE] Màn Chính', `</${ELDRAN.updateTag}>`, `</${ELDRAN.updateTag}>\n` + fence(p.main)),
  ];
}
