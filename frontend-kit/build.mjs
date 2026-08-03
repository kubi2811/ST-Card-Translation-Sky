/**
 * Bộ dựng front-end cho card SillyTavern (bug 192).
 *
 *   node frontend-kit/build.mjs
 *
 * Việc nó làm:
 *   1. ghép runtime.js + theme.css + <card>.config.js + opening.js / main.js thành 2 trang HTML;
 *   2. QUÉT CHẶN hai lớp lỗi chỉ lộ ra khi đã nhét vào regex (xem scanPayload trong lib.mjs);
 *   3. gắn 2 regex script "chỉ ảnh hưởng hiển thị" vào ĐẦU mảng regex_scripts của card;
 *   4. sửa first_mes thành thẻ mở màn;
 *   5. xuất card + 2 preset ra thư mục đích.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildEldranPayloads, buildEldranScripts, scanPayload, scanTriggers,
  KIT_DIR, ELDRAN, ELDRAN_TRIGGERS,
} from './lib.mjs';
import { buildPresets } from './presets.mjs';

const REPO = path.resolve(KIT_DIR, '..');
const BASE_CARD = path.join(REPO, 'bug', '192', 'Hành Tinh Eldran (1).json');
const OUT_DIR = path.join(REPO, 'bug', '192', 'output');

function main() {
  const payloads = buildEldranPayloads();
  for (const [name, html] of Object.entries(payloads)) {
    const bad = [
      ...scanPayload(html, name + '.html'),
      ...scanTriggers(html, ELDRAN_TRIGGERS, name + '.html'),
    ];
    if (bad.length) {
      console.error('\n❌ Payload không hợp lệ:\n' + bad.join('\n') + '\n');
      process.exit(1);
    }
  }

  if (!fs.existsSync(BASE_CARD)) {
    console.error('❌ Không thấy card gốc: ' + BASE_CARD);
    process.exit(1);
  }
  const card = JSON.parse(fs.readFileSync(BASE_CARD, 'utf8'));
  const d = card.data;

  // Thứ tự là BẮT BUỘC: card đã có sẵn script xoá khối cập nhật biến khi hiển thị.
  // Nếu script đó chạy trước thì tới lượt "[FE] Màn Chính" sẽ chẳng còn gì để bắt.
  const kept = (d.extensions.regex_scripts || []).filter((s) => !/^\[FE\] /.test(s.scriptName || ''));
  d.extensions.regex_scripts = [...buildEldranScripts(), ...kept];

  d.first_mes = `<${ELDRAN.bootTag}/>`;
  card.first_mes = d.first_mes;

  // Entry EJS #61 đang gọi activateRegex tới một script KHÔNG tồn tại trong card
  // ('[Render] Status Bar'); nó nằm trong try/catch nên nuốt lỗi im lặng. Bỏ dòng chết đó đi.
  const e61 = (d.character_book?.entries || []).find((e) => e.id === 61);
  if (e61 && /\[Render\] Status Bar/.test(e61.content)) {
    e61.content = e61.content.replace(/\s*activateRegex\('\[Render\] Status Bar'\);\n?/, '\n    ');
  }

  d.character_version = '1.1-fe';
  card.character_version = d.character_version;
  d.creator_notes = [
    'Bản có giao diện front-end (STFE, bug 192).',
    'Cần bật extension "Trợ Thủ Tavern" (JS-Slash-Runner) và script MVU trong thẻ.',
    'Toàn bộ ván chơi diễn ra trong giao diện của lầu 0; nhật ký lưu trong biến chat nên',
    'đóng/mở khung, F5, thoát card rồi vào lại đều không mất tiến trình.',
  ].join('\n');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cardOut = path.join(OUT_DIR, 'Hành Tinh Eldran - Front-End.json');
  fs.writeFileSync(cardOut, JSON.stringify(card, null, 2), 'utf8');

  const presets = buildPresets();
  const p1 = path.join(OUT_DIR, '【Khởi Đầu】Preset Eldran Front-End.json');
  const p2 = path.join(OUT_DIR, '【Chơi Thẻ】Preset Eldran Front-End.json');
  fs.writeFileSync(p1, JSON.stringify(presets.khoiDau, null, 2), 'utf8');
  fs.writeFileSync(p2, JSON.stringify(presets.choiThe, null, 2), 'utf8');

  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('✅ Đã dựng xong:');
  console.log('   ' + cardOut + '  (' + kb(fs.statSync(cardOut).size) + ')');
  console.log('   ' + p1 + '  (' + kb(fs.statSync(p1).size) + ')');
  console.log('   ' + p2 + '  (' + kb(fs.statSync(p2).size) + ')');
  console.log('   giao diện: khởi tạo ' + kb(payloads.opening.length) + ' · chính ' + kb(payloads.main.length));
  console.log('   regex_scripts: ' + d.extensions.regex_scripts.length
    + ' (2 script [FE] đứng đầu, markdownOnly=true / promptOnly=false)');
}

main();
