/**
 * payloadRules — luật sống còn khi nhét cả một trang web vào `replaceString` của regex.
 * ─────────────────────────────────────────────────────────────────────────────
 * Viết bằng JS thuần (không phải .ts) CÓ CHỦ Ý: file này là nguồn DUY NHẤT, được dùng
 * bởi cả app Tạo Card (Vite import bình thường) lẫn bộ dựng dòng lệnh `frontend-kit/`
 * (Node import qua file URL). Hai bản chép tay sẽ lệch nhau, và lệch ở đây thì hỏng âm thầm.
 *
 * Mọi luật dưới đây ĐO ĐƯỢC khi chạy thật trên SillyTavern, không suy từ tài liệu. Cả năm
 * đều làm giao diện hỏng mà KHÔNG sinh một dòng lỗi nào ở tầng quán rượu.
 */

/** @typedef {{ re: RegExp, why: string }} PayloadRule */

/** @type {PayloadRule[]} */
export const PAYLOAD_RULES = [
  {
    re: /\$\d/,
    why: 'dấu đô-la đứng trước chữ số — regex/engine.js:422 coi là nhóm bắt và xoá mất. '
      + 'Cần nhóm bắt thì dùng hàm thay thế (m, a) => … chứ đừng dùng chuỗi.',
  },
  {
    re: /\$</,
    why: 'dấu đô-la đứng trước dấu bé hơn — bị coi là nhóm bắt có tên và xoá mất',
  },
  {
    re: /\{\{(?!user\}\}|char\}\})/,
    why: 'macro hai ngoặc nhọn ngoài danh sách cho phép — substituteParams sẽ ăn mất',
  },
  {
    re: /```/,
    why: 'ba dấu huyền Ở BẤT KỲ ĐÂU — script.js:1844 dùng một regex nuốt trọn khối ```…``` '
      + 'để che chắn; gặp cụm thứ ba là khối đóng sớm, phần còn lại bị bọc <q> quanh mọi cặp '
      + 'nháy kép ⇒ vỡ cú pháp JS. Dựng nó bằng String.fromCharCode(96,96,96).',
  },
  {
    re: /&(?:[a-zA-Z]{2,8}|#\d{2,5});/,
    why: 'thực thể HTML viết thẳng — showdown escape dấu và trong khối code, rồi script.js:1889 '
      + 'đổi ngược lại, trình duyệt giải mã nốt ⇒ thực thể thành ký tự thật. '
      + 'Dựng bằng String.fromCharCode(38) + "amp;" chẳng hạn.',
  },
];

/**
 * Quét payload theo 5 luật trên.
 * @param {string} html
 * @param {string} [label]
 * @returns {string[]} danh sách vi phạm; rỗng là sạch
 */
export function scanPayload(html, label = 'payload') {
  const bad = [];
  const src = String(html || '');
  for (const rule of PAYLOAD_RULES) {
    const r = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    let m;
    while ((m = r.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${label}:${line}  ${rule.why}\n    → ${JSON.stringify(src.slice(Math.max(0, m.index - 40), m.index + 40))}`);
      if (bad.length > 20) return bad;
    }
  }
  return bad;
}

/**
 * Luật thứ sáu, học được lúc dựng chính bộ này: payload TUYỆT ĐỐI không được chứa nguyên
 * văn cái thẻ mà một script [FE] khác dùng làm mồi.
 *
 * Lần đầu dựng, chú thích của màn khởi tạo có nhắc tên thẻ đóng khối cập nhật biến. Kết quả:
 * script "Màn Chính" chạy ngay sau, thấy thẻ đó NẰM TRONG chú thích vừa được chèn vào, rồi
 * nhồi nguyên màn hình chính vào giữa một khối chú thích JS. Không lỗi đỏ nào, chỉ là hai
 * màn hình chồng lên nhau và JS vỡ.
 *
 * @param {string} html
 * @param {string[]} triggers
 * @param {string} [label]
 * @returns {string[]}
 */
export function scanTriggers(html, triggers, label = 'payload') {
  const bad = [];
  const src = String(html || '');
  for (const t of triggers) {
    if (!t) continue;
    let i = src.indexOf(t);
    while (i !== -1) {
      const line = src.slice(0, i).split('\n').length;
      bad.push(`${label}:${line}  chứa nguyên văn thẻ mồi ${JSON.stringify(t)} — script [FE] kia sẽ khớp nhầm vào đây`);
      i = src.indexOf(t, i + 1);
      if (bad.length > 20) return bad;
    }
  }
  return bad;
}

/**
 * Mô phỏng ĐÚNG hai phép biến đổi SillyTavern làm với nội dung tin nhắn trên đường ra
 * iframe (script.js:1836-1892). Không suy diễn — đo bằng cách đọc lại chính đoạn script mà
 * quán rượu thật đã nhả vào iframe rồi so từng dòng với bản dựng.
 *
 *   Bước 1  bọc `<q>` quanh mọi cặp nháy kép, TRỪ vùng được che: <style>…</style>,
 *           khối ba / hai / một dấu huyền.
 *   Bước 2  trong khối code, thực thể HTML bị giải mã về ký tự thật.
 *
 * @param {string} mes
 * @returns {string}
 */
export function simulateStDelivery(mes) {
  let out = String(mes);

  // 1a: giấu nháy kép nằm trong thẻ, y như ST làm, để chúng khỏi bị bọc <q>.
  out = out.replace(/<([^>]+)>/g, (_, contents) => '<' + contents.replace(/"/g, '￾') + '>');

  // 1b: chính regex của ST, giữ nguyên thứ tự các nhánh.
  out = out.replace(
    /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(“.*?”)|(«.*?»)|(「.*?」)|(『.*?』)|(＂.*?＂)/gim,
    (match, p1) => (p1 ? `<q>"${p1.slice(1, -1)}"</q>` : match),
  );

  out = out.replace(/￾/g, '"');

  // 2: thực thể trong khối code bị giải mã.
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  out = out.replace(/&(?:([a-zA-Z]{2,8})|#(\d{2,5}));/g, (m, name, num) => {
    if (num) return String.fromCharCode(Number(num));
    return Object.prototype.hasOwnProperty.call(named, name) ? named[name] : m;
  });

  return out;
}

/**
 * (bug 206) MỒI CỦA HAI MÀN PHẢI NUỐT TRỌN TIN NHẮN.
 *
 * Bản đầu chỉ tìm đúng cái thẻ (`</UpdateVariable>` hoặc `<GameStart/>`) rồi chèn giao diện
 * vào CHỖ ĐÓ. Nghĩa là mọi thứ nằm ngoài cái thẻ — nguyên đoạn kể của AI, cả khối JSON cập
 * nhật biến — vẫn được SillyTavern in ra như chữ thường, NGAY PHÍA TRÊN khung giao diện. Đó
 * chính là "chữ tràn ra ngoài giao diện" mà người chơi thấy sau khi bấm Bắt đầu hành trình:
 * không phải lỗi bố cục, mà là phần văn bản lẽ ra phải bị giao diện thay thế trọn vẹn.
 *
 * (Thẻ mẫu Eldran không lộ ra vì nó có sẵn một regex khác xoá lời kể; thẻ do app sinh ra thì
 * không có, nên lộ hết. Đây là lý do bản vá 201 — vốn chỉ chỉnh CSS — không chạm tới bệnh.)
 *
 * Lời kể KHÔNG mất: khung chat nhúng tự đọc nó từ chính nội dung tin nhắn và hiển thị bên
 * trong. Và vì hai script này `markdownOnly`, phần bị nuốt chỉ biến mất Ở LỚP HIỂN THỊ —
 * tin nhắn thật, prompt gửi cho AI và dữ liệu MVU đều còn nguyên.
 *
 * NEO `^` LÀ BẮT BUỘC, không phải cho đẹp. Thiếu nó thì khi tin nhắn KHÔNG chứa thẻ mồi,
 * bộ máy regex phải thử `[\s\S]*` từ mọi vị trí bắt đầu — bình phương độ dài. Payload giao
 * diện dài gần 60 nghìn ký tự, nên script màn chính soi một tin nhắn đã mang màn khởi tạo là
 * treo cứng luôn (đo được: quá 5 giây, chưa xong). Có `^` thì chỉ còn một lượt duyệt.
 *
 * @param {string} tag  tên thẻ đã được kiểm (chỉ chữ cái/số/gạch dưới — xem validateOptions)
 */
export function openingFindRegex(tag) {
  return `^[\\s\\S]*<${tag}\\s*/>[\\s\\S]*$`;
}

/** Cặp song sinh cho màn chính: mồi là thẻ ĐÓNG của khối cập nhật biến. */
export function mainFindRegex(tag) {
  return `^[\\s\\S]*<\\/${tag}>[\\s\\S]*$`;
}

/** Bọc khối code đúng kiểu card mẫu: ba dấu huyền trần, không kèm tên ngôn ngữ. */
export function fenceBlock(html) {
  const f = String.fromCharCode(96, 96, 96);
  return f + '\n' + html + '\n' + f;
}

/** Định danh tất định — dựng lại nhiều lần vẫn ra cùng một file, khỏi đẻ diff rác. */
export function stableId(seed) {
  const hex = [...String(seed)].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381)
    .toString(16).padStart(8, '0');
  return `${hex}-1920-4b92-9f${hex.slice(0, 2)}-${hex}${hex.slice(0, 4)}`;
}

/**
 * Ghép một trang HTML hoàn chỉnh từ CSS + các mảnh JS.
 * Trợ Thủ Tavern chỉ nhận ra đây là giao diện khi text có `html>` / `<head>` / `<body`
 * (src/util/is_frontend.ts của JS-Slash-Runner), nên khung dưới đây là bắt buộc.
 */
export function composePage(title, css, jsParts) {
  const js = jsParts.map((p) => `\n/* ===== ${p.name} ===== */\n` + p.code).join('\n');
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
